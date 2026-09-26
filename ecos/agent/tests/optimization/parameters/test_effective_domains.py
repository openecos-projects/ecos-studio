from __future__ import annotations

import pytest

from ecos_agent.optimization.contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainError,
    EffectiveDomainSnapshot,
    RequestedValueBounds,
    build_context_fingerprint,
    compile_effective_domain,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards
from tests.optimization.parameters.effectiveness_support import domain_context


def make_domain(knob=OptimizationKnob.TARGET_DENSITY, current=0.2, attempted=()):
    card = load_parameter_cards()[knob]
    context = domain_context(
        stage=card.stage,
        tool_revision=card.tool.revision,
        tool_source_sha256=card.tool.source_sha256,
        parameter_card_sha256=card_hash(card),
        unit=card.surface.unit,
        current_values={knob.value: current},
    )
    return compile_effective_domain(
        card, context=context, baseline_surface_value=current, attempted=attempted
    )


def test_domain_preserves_full_static_range_without_sampling_or_floor_rules():
    domain = make_domain(current=0.1)
    assert domain.schema_version == "ecos.effective_domain.v4"
    assert domain.current_coordinate == {"surface_value": 0.1}
    assert domain.value_bounds.json_schema() == {
        "type": "number", "minimum": 0.1, "maximum": 0.95
    }
    assert all(domain.accepts(value) for value in (0.15, 0.25, 0.6678, 0.7779, 0.9137))
    assert set(domain.model_dump()) == {
        "schema_version", "knob_id", "context_sha256", "current_coordinate",
        "value_bounds", "attempted_values", "snapshot_sha256",
    }


def test_attempt_history_excludes_exact_request_not_an_interval():
    attempted = (RequestedKnobValue(knob_id="place.target_density", value=0.15),)
    domain = make_domain(current=0.1, attempted=attempted)
    assert domain.attempted_values == (0.15,)
    assert not domain.accepts(0.15)
    assert domain.accepts(0.150001)
    assert domain.accepts(0.25)
    assert domain == make_domain(current=0.1, attempted=attempted)
    assert domain.snapshot_sha256 != make_domain(current=0.1).snapshot_sha256


def test_domain_no_longer_accepts_receipts_as_search_constraints():
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    with pytest.raises(TypeError, match="receipts"):
        compile_effective_domain(card, context=domain_context(), receipts=())


@pytest.mark.parametrize("anchor", (0.0, 0.01, 0.1, 0.9, 1.0))
def test_overflow_bounds_preserve_entire_open_interval(anchor):
    domain = make_domain(OptimizationKnob.TARGET_OVERFLOW, anchor)
    assert domain.value_bounds.json_schema() == {
        "type": "number", "exclusiveMinimum": 0.0, "exclusiveMaximum": 1.0
    }
    assert domain.accepts(0.000001) and domain.accepts(0.999999)
    assert not domain.accepts(0.0) and not domain.accepts(1.0)


@pytest.mark.parametrize(
    "value", (True, "0.5", None, float("inf"), float("nan"), 10**400)
)
def test_numeric_bounds_reject_invalid_types_and_nonfinite_values(value):
    assert not make_domain().accepts(value)


def test_integer_and_boolean_bounds_are_strict():
    integer = make_domain(OptimizationKnob.CELL_PADDING_X, 2)
    assert integer.accepts(9)
    assert not integer.accepts(9.0)
    assert not integer.accepts(True)
    boolean = make_domain(OptimizationKnob.ROUTABILITY_OPT, False)
    assert boolean.accepts(True)
    assert not boolean.accepts(1)
    assert boolean.direction_schema("enable") == {"type": "boolean", "enum": [True]}
    assert boolean.direction_schema("disable") is None


@pytest.mark.parametrize("current", (2.0, 1.5))
def test_integer_requests_allow_unit_converted_fractional_baseline(current):
    domain = make_domain(OptimizationKnob.CELL_PADDING_X, current)
    assert domain.current_coordinate == {"surface_value": current}
    assert domain.direction_schema("increase") == {
        "type": "integer", "exclusiveMinimum": current, "maximum": 16
    }
    assert domain.direction_schema("decrease") == {
        "type": "integer", "minimum": 0, "exclusiveMaximum": current
    }
    assert domain.accepts(2)
    assert not domain.accepts(2.0)
    assert not domain.accepts(current)


@pytest.mark.parametrize("current", (True, float("inf"), float("nan")))
def test_integer_baseline_rejects_boolean_and_nonfinite_values(current):
    with pytest.raises(EffectiveDomainError, match="current coordinate"):
        make_domain(OptimizationKnob.CELL_PADDING_X, current)


def test_direction_schema_uses_requested_coordinate_and_static_bounds():
    domain = make_domain(current=0.2)
    assert domain.direction_schema("increase") == {
        "type": "number", "exclusiveMinimum": 0.2, "maximum": 0.95
    }
    assert domain.direction_schema("decrease") == {
        "type": "number", "minimum": 0.1, "exclusiveMaximum": 0.2
    }
    assert make_domain(current=1.0).direction_schema("increase") is None
    assert make_domain(current=0.0).direction_schema("decrease") is None
    assert make_domain(OptimizationKnob.CELL_PADDING_X, 0).direction_schema("decrease") is None


def test_integer_direction_is_unavailable_when_every_value_was_attempted():
    domain = make_domain(
        OptimizationKnob.CELL_PADDING_X,
        2,
        attempted=tuple(
            RequestedKnobValue(knob_id="place.cell_padding_x", value=value)
            for value in (0, 1)
        ),
    )
    assert domain.direction_schema("decrease") is None
    assert domain.direction_schema("increase") is not None


def test_domain_hash_prevents_range_tampering():
    payload = make_domain().model_dump(mode="json")
    payload["value_bounds"]["maximum"] = 1.0
    with pytest.raises(ValueError, match="snapshot hash"):
        EffectiveDomainSnapshot.model_validate(payload)


@pytest.mark.parametrize("bounds", (
    {"type": "number", "minimum": float("nan")},
    {"type": "number", "minimum": 2, "maximum": 1},
    {"type": "boolean", "minimum": 0},
    {"type": "number", "exclusive_minimum": True},
))
def test_invalid_bounds_are_rejected(bounds):
    with pytest.raises(ValueError):
        RequestedValueBounds.model_validate(bounds)


def test_context_fingerprint_ignores_run_id_but_binds_inputs():
    context = domain_context(run_id="candidate-1")
    assert build_context_fingerprint(context) == build_context_fingerprint(
        {**context, "run_id": "candidate-2"}
    )
    for key, value in (("site_width_dbu", 400), ("incumbent_state_sha256", "sha256:" + "b" * 64),
                       ("ecc_revision", "0.1.0-alpha.12")):
        assert build_context_fingerprint(context) != build_context_fingerprint({**context, key: value})


def test_context_fingerprint_requires_every_binding_field():
    context = domain_context()
    for key in tuple(context):
        with pytest.raises(EffectiveDomainError, match="missing binding fields"):
            build_context_fingerprint({name: value for name, value in context.items() if name != key})
