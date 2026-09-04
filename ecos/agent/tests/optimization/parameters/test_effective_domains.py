from __future__ import annotations

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainError,
    build_context_fingerprint,
    compile_effective_domain,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards
from tests.optimization.parameters.effectiveness_support import (
    density_receipt,
    domain_context,
)


def test_density_floor_excludes_only_values_supported_by_typed_rule() -> None:
    cards = load_parameter_cards()
    card = cards[OptimizationKnob.TARGET_DENSITY]
    context = domain_context()
    receipt = density_receipt(context)
    domain = compile_effective_domain(
        card,
        context=context,
        receipts=(receipt,),
        current_receipts=(receipt,),
    )
    assert domain.allowed_requested_values == (0.825, 0.875, 0.95)
    assert domain.current_coordinate["effective_anchor"] == 0.8
    assert domain.thresholds[0].evidence_refs == (
        {
            "kind": "parameter_card",
            "ref": "optimization/place.target_density.json",
            "sha256": card_hash(card),
        },
        {
            "kind": "application_receipt",
            "ref": receipt.receipt_id,
            "sha256": receipt.evidence_sha256,
        },
    )


def test_density_floor_without_runtime_trigger_excludes_only_observed_request() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = domain_context()
    receipt = density_receipt(context, with_runtime_trigger=False)

    domain = compile_effective_domain(
        card,
        context=context,
        receipts=(receipt,),
        current_receipts=(receipt,),
    )

    assert domain.excluded_aliases == (0.2,)
    assert 0.5 in domain.allowed_requested_values
    assert 0.2 not in domain.allowed_requested_values


def test_rules_empty_does_not_infer_aliases() -> None:
    cards = load_parameter_cards()
    card = cards[OptimizationKnob.FLOORPLAN_ASPECT_RATIO]
    context = domain_context(
        stage="Floorplan",
        tool_revision=card.tool.revision,
        tool_source_sha256=card.tool.source_sha256,
        parameter_card_sha256=card_hash(card),
    )
    domain = compile_effective_domain(card, context=context, baseline_surface_value=1.0)
    assert domain.excluded_aliases == ()
    assert domain.allowed_requested_values == (0.2, 0.6, 0.75, 1.33, 3.0, 5.0)


def test_dynamic_allowlist_refines_the_largest_unexplored_interval() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = domain_context(current_values={"place.target_density": 0.7})

    initial = compile_effective_domain(
        card,
        context=context,
        baseline_surface_value=0.7,
    )
    refined = compile_effective_domain(
        card,
        context=context,
        attempted=(
            RequestedKnobValue(knob_id="place.target_density", value=0.825),
        ),
        baseline_surface_value=0.7,
    )

    assert initial.schema_version == "ecos.effective_domain.v2"
    assert initial.allowed_requested_values == (0.1, 0.4, 0.65, 0.75, 0.825, 0.95)
    assert refined.allowed_requested_values == (0.1, 0.4, 0.65, 0.75, 0.7625, 0.95)
    assert compile_effective_domain(
        card,
        context=context,
        attempted=(
            RequestedKnobValue(knob_id="place.target_density", value=0.825),
        ),
        baseline_surface_value=0.7,
    ) == refined


def test_dynamic_allowlist_uses_log_midpoint_for_density_weight() -> None:
    card = load_parameter_cards()[OptimizationKnob.DENSITY_WEIGHT]
    context = domain_context(
        current_values={"place.density_weight": 0.001},
        parameter_card_sha256=card_hash(card),
        unit=card.surface.unit,
    )

    domain = compile_effective_domain(
        card,
        context=context,
        baseline_surface_value=0.001,
    )

    assert 0.00316227766017 in domain.allowed_requested_values


def test_dynamic_allowlist_generates_integer_values_between_references() -> None:
    card = load_parameter_cards()[OptimizationKnob.CELL_PADDING_X]
    context = domain_context(
        current_values={"place.cell_padding_x": 2},
        parameter_card_sha256=card_hash(card),
        unit=card.surface.unit,
    )

    domain = compile_effective_domain(
        card,
        context=context,
        baseline_surface_value=2,
    )

    assert 9 in domain.allowed_requested_values
    assert 9 not in card.requested_domain.values


def test_dynamic_allowlist_stays_within_bounds_when_current_value_is_outside() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = domain_context(current_values={"place.target_density": 1.0})

    domain = compile_effective_domain(
        card,
        context=context,
        baseline_surface_value=1.0,
    )

    assert domain.allowed_requested_values
    assert all(0.1 <= value <= 0.95 for value in domain.allowed_requested_values)


def test_context_fingerprint_ignores_run_id_but_binds_inputs() -> None:
    context = domain_context(run_id="candidate-1")
    assert build_context_fingerprint(context) == build_context_fingerprint(
        {**context, "run_id": "candidate-2"}
    )
    assert build_context_fingerprint(context) != build_context_fingerprint(
        {**context, "site_width_dbu": 400}
    )
    assert build_context_fingerprint(context) != build_context_fingerprint(
        {**context, "incumbent_state_sha256": "sha256:" + "b" * 64}
    )
    assert build_context_fingerprint(context) != build_context_fingerprint(
        {**context, "ecc_revision": "0.1.0-alpha.12"}
    )


def test_context_fingerprint_requires_every_binding_field() -> None:
    context = domain_context()

    for key in tuple(context):
        with pytest.raises(EffectiveDomainError, match="missing binding fields"):
            build_context_fingerprint(
                {name: value for name, value in context.items() if name != key}
            )


def test_effective_domain_rejects_partial_or_mismatched_receipt_context() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = domain_context()
    receipt = density_receipt(context)
    partial = receipt.model_dump(mode="json", exclude={"evidence_sha256"})
    partial["context"].pop("pdk_sha256")
    partial_receipt = ParameterApplicationReceipt(
        **partial, evidence_sha256=canonical_sha256(partial)
    )
    mismatched = receipt.model_dump(mode="json", exclude={"evidence_sha256"})
    mismatched["context"]["seed"] = 1
    mismatched_receipt = ParameterApplicationReceipt(
        **mismatched, evidence_sha256=canonical_sha256(mismatched)
    )
    unbound = receipt.model_dump(mode="json", exclude={"evidence_sha256"})
    unbound["context"].pop("context_sha256")
    unbound_receipt = ParameterApplicationReceipt(
        **unbound, evidence_sha256=canonical_sha256(unbound)
    )

    for candidate in (partial_receipt, mismatched_receipt, unbound_receipt):
        domain = compile_effective_domain(card, context=context, receipts=(candidate,))
        assert domain.current_coordinate is None
        assert domain.observed_application_signatures == ()
