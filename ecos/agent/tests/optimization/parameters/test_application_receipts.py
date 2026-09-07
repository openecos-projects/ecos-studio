from __future__ import annotations

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.parameters.semantics import (
    ParameterSemanticsError,
    load_parameter_cards,
    validate_application_receipt,
)
from ecos_agent.optimization.rules import (
    native_receipt_is_effective,
)
from tests.optimization.parameters.effectiveness_support import (
    density_receipt,
    domain_context,
    routability_false_receipt,
)


def _rehash(payload: dict) -> ParameterApplicationReceipt:
    payload.pop("evidence_sha256", None)
    return ParameterApplicationReceipt(**payload, evidence_sha256=canonical_sha256(payload))


def _receipt(knob, requested, actual, observation, *, status="effective"):
    card = load_parameter_cards()[knob]
    payload = density_receipt(domain_context()).model_dump(mode="json")
    payload.update(
        tool=card.tool.model_dump(mode="json"),
        context={"stage": card.stage, "lattice_version": "ecos.optimization_lattice.v1"},
        requested={"knob_id": knob.value, "value": requested, "unit": card.surface.unit},
        actual_value=actual,
        status=status,
        observation=observation,
    )
    payload["materialization"].update(
        written_value=requested * 200 if knob == OptimizationKnob.CELL_PADDING_X else requested,
        unit="dbu" if knob == OptimizationKnob.CELL_PADDING_X else card.surface.unit,
    )
    return _rehash(payload)


def test_receipt_hash_binds_actual_value_and_observation() -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    for field, value in (("actual_value", 0.85), ("observation", {})):
        with pytest.raises(ValueError, match="evidence hash"):
            ParameterApplicationReceipt.model_validate({**payload, field: value})


def test_receipt_rejects_old_schema_and_states() -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    with pytest.raises(ValueError):
        _rehash({**payload, "schema_version": "tool.parameter_application_receipt.v1"})
    with pytest.raises(ValueError):
        _rehash({**payload, "application_status": "applied"})
    with pytest.raises(ValueError):
        _rehash({**payload, "status": "used"})


def test_receipt_hash_does_not_accept_omitted_default_fields() -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    del payload["reason"]
    with pytest.raises(ValueError, match="evidence hash"):
        _rehash(payload)


@pytest.mark.parametrize("actual", (None, True, float("inf")))
def test_effective_receipt_requires_a_finite_correctly_typed_actual_value(actual) -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    payload["actual_value"] = actual
    with pytest.raises(ValueError):
        _rehash(payload)


def test_requested_boolean_cannot_bind_integer_written_value() -> None:
    payload = routability_false_receipt().model_dump(mode="json")
    payload["materialization"]["written_value"] = 0
    with pytest.raises(ValueError, match="written value"):
        _rehash(payload)


@pytest.mark.parametrize("field", ("stage", "lattice_version"))
def test_receipt_requires_stage_and_lattice_context(field) -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    del payload["context"][field]
    with pytest.raises(ParameterSemanticsError, match=field.replace("_", " ")):
        validate_application_receipt(_rehash(payload), load_parameter_cards())


def test_receipt_requires_card_bound_tool_source() -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    payload["tool"]["source_sha256"] = None
    with pytest.raises(ParameterSemanticsError, match="tool source"):
        validate_application_receipt(_rehash(payload), load_parameter_cards())


@pytest.mark.parametrize("observation", ({}, {"density_operator_call_count": 0}))
def test_effective_density_requires_matching_runtime_observation(observation) -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    payload["observation"] = observation
    with pytest.raises(ParameterSemanticsError, match="observation"):
        validate_application_receipt(_rehash(payload), load_parameter_cards())


def test_density_floor_must_match_actual_value() -> None:
    payload = density_receipt(domain_context()).model_dump(mode="json")
    payload["observation"]["utilization_floor"] = 0.9
    with pytest.raises(ParameterSemanticsError, match="observation"):
        validate_application_receipt(_rehash(payload), load_parameter_cards())


@pytest.mark.parametrize("threshold,final,valid", (
    (0.1, 0.09, True), (0.1, 0.1, False), (0.1, 0.3, False), (0.1, None, False),
    (1.0, 0.3, True), (1.0, 1.0, False), (0.0, 0.0, False), (0.0, -0.1, False),
))
def test_overflow_requires_final_overflow_below_threshold(threshold, final, valid) -> None:
    receipt = _receipt(
        OptimizationKnob.TARGET_OVERFLOW, 0.1, threshold,
        {"stop_overflow": threshold, "final_overflow": final},
    )
    if valid:
        validate_application_receipt(receipt, load_parameter_cards())
    else:
        with pytest.raises(ParameterSemanticsError, match="observation"):
            validate_application_receipt(receipt, load_parameter_cards())


def test_routability_false_is_effective_without_a_special_downstream_state() -> None:
    receipt = routability_false_receipt()
    validate_application_receipt(receipt, load_parameter_cards())
    assert native_receipt_is_effective(receipt)
    assert receipt.actual_value is False


def test_routability_true_requires_an_optimization_round() -> None:
    receipt = _receipt(
        OptimizationKnob.ROUTABILITY_OPT, True, True,
        {"configured_routability_opt": True, "branch_round_count": 0,
         "placement_completed": True, "place_object_count": 1},
    )
    with pytest.raises(ParameterSemanticsError, match="observation"):
        validate_application_receipt(receipt, load_parameter_cards())


def test_routability_observed_round_survives_later_failure() -> None:
    receipt = _receipt(
        OptimizationKnob.ROUTABILITY_OPT, True, True,
        {"configured_routability_opt": True, "branch_round_count": 1,
         "placement_completed": False, "place_object_count": 1},
    )
    validate_application_receipt(receipt, load_parameter_cards())


@pytest.mark.parametrize("requested,actual", ((0, 0), (2, 1.5)))
def test_padding_actual_value_uses_sites_including_intentional_zero(requested, actual) -> None:
    receipt = _receipt(
        OptimizationKnob.CELL_PADDING_X, requested, actual,
        {"padding_sites": actual, "geometry_apply_count": 1},
    )
    validate_application_receipt(receipt, load_parameter_cards())
    assert receipt.materialization.unit == "dbu"
    assert receipt.actual_value == actual
    assert native_receipt_is_effective(receipt)


def test_padding_clipped_to_zero_is_not_effective() -> None:
    receipt = _receipt(
        OptimizationKnob.CELL_PADDING_X, 2, 0,
        {"padding_sites": 0, "geometry_apply_count": 1}, status="inactive",
    )
    validate_application_receipt(receipt, load_parameter_cards())
    assert not native_receipt_is_effective(receipt)


def test_density_weight_actual_value_is_the_initialization_coefficient() -> None:
    receipt = _receipt(
        OptimizationKnob.DENSITY_WEIGHT, 0.001, 0.001,
        {"configured_density_weight": 0.001, "initialization_count": 1},
    )
    validate_application_receipt(receipt, load_parameter_cards())
    assert receipt.actual_value == 0.001


@pytest.mark.parametrize("knob,value", (
    (OptimizationKnob.FLOORPLAN_CORE_UTIL, 0.8),
    (OptimizationKnob.FLOORPLAN_ASPECT_RATIO, 1.33),
))
def test_floorplan_actual_value_is_the_geometry_input(knob, value) -> None:
    receipt = _receipt(knob, value, value, {
        "mode": "die_util", "configured_value": value,
        "init_fp_call_count": 1, "run_fp_call_count": 1, "geometry_constructed": True,
    })
    validate_application_receipt(receipt, load_parameter_cards())
    assert receipt.actual_value == value


@pytest.mark.parametrize("knob,requested,observation,expected,actual", (
    (OptimizationKnob.TARGET_DENSITY, 0.2,
     {"target_density": 0.8, "density_tensor_value": 0.8, "density_operator_call_count": 1},
     "effective", 0.8),
    (OptimizationKnob.TARGET_OVERFLOW, 0.1,
     {"stop_overflow": 0.1, "final_overflow": 0.08}, "effective", 0.1),
    (OptimizationKnob.TARGET_OVERFLOW, 0.1,
     {"stop_overflow": 0.1, "final_overflow": 0.3}, "inactive", None),
    (OptimizationKnob.TARGET_OVERFLOW, 0.1,
     {"stop_overflow": 0.1, "final_overflow": None}, "unknown", None),
    (OptimizationKnob.ROUTABILITY_OPT, False,
     {"configured_routability_opt": False, "branch_round_count": 0,
      "placement_completed": True, "place_object_count": 1}, "effective", False),
    (OptimizationKnob.ROUTABILITY_OPT, True,
     {"configured_routability_opt": True, "branch_round_count": 0,
      "placement_completed": True, "place_object_count": 1}, "inactive", None),
    (OptimizationKnob.CELL_PADDING_X, 0,
     {"padding_sites": 0, "geometry_apply_count": 1}, "effective", 0),
    (OptimizationKnob.CELL_PADDING_X, 2,
     {"padding_sites": 0, "geometry_apply_count": 1}, "inactive", 0),
    (OptimizationKnob.DENSITY_WEIGHT, 0.001,
     {"configured_density_weight": 0.001, "initialization_count": 1}, "effective", 0.001),
    (OptimizationKnob.FLOORPLAN_CORE_UTIL, 0.8,
     {"mode": "die_util", "configured_value": 0.8, "init_fp_call_count": 1,
      "run_fp_call_count": 1, "geometry_constructed": True}, "effective", 0.8),
    (OptimizationKnob.FLOORPLAN_ASPECT_RATIO, 1.33,
     {"mode": "die_util", "configured_value": 1.33, "init_fp_call_count": 1,
      "run_fp_call_count": 1, "geometry_constructed": True}, "effective", 1.33),
    (OptimizationKnob.FLOORPLAN_ASPECT_RATIO, 1.33,
     {"mode": "die_size", "configured_value": 1.33, "init_fp_call_count": 1,
      "run_fp_call_count": 1, "geometry_constructed": True}, "inactive", None),
))
def test_all_parameter_states_must_match_runtime_observation(
    knob, requested, observation, expected, actual,
) -> None:
    cards = load_parameter_cards()
    for status in ("effective", "inactive", "unknown"):
        value = actual if status == expected else requested if status == "effective" else None
        receipt = _receipt(knob, requested, value, observation, status=status)
        if status == expected:
            validate_application_receipt(receipt, cards)
        else:
            with pytest.raises(ParameterSemanticsError, match="observation"):
                validate_application_receipt(receipt, cards)


@pytest.mark.parametrize("knob", tuple(OptimizationKnob))
def test_missing_observation_remains_unknown(knob) -> None:
    requested = {
        OptimizationKnob.ROUTABILITY_OPT: False,
        OptimizationKnob.CELL_PADDING_X: 2,
        OptimizationKnob.DENSITY_WEIGHT: 0.001,
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO: 1.33,
    }.get(knob, 0.8)
    validate_application_receipt(
        _receipt(knob, requested, None, {}, status="unknown"), load_parameter_cards()
    )


@pytest.mark.parametrize("status", ("unknown", "inactive"))
def test_fixed_size_floorplan_without_geometry_cannot_confirm_run_completion(status) -> None:
    receipt = _receipt(OptimizationKnob.FLOORPLAN_CORE_UTIL, 0.8, None, {
        "mode": "die_size", "configured_value": 0.8, "init_fp_call_count": 1,
        "run_fp_call_count": 1, "geometry_constructed": False,
    }, status=status)
    validate_application_receipt(receipt, load_parameter_cards())
