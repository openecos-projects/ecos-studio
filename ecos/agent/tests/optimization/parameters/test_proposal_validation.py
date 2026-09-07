from __future__ import annotations

import pytest

from ecos_agent.optimization.contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.optimization.parameters.contracts import (
    NumericProposalActionV2,
    OptimizationProposalV2,
)
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainError,
    compile_effective_domain,
    validate_numeric_proposal,
    validate_optimization_proposal_v2,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards
from tests.optimization.parameters.effectiveness_support import (
    HASH,
    domain_context,
)


def test_proposal_accepts_llm_probe_without_threshold_authority() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    context = domain_context()
    domain = compile_effective_domain(card, context=context)
    proposal = OptimizationProposalV2(
        context_ref={
            "episode_id": "episode-1",
            "checkpoint_id": "place",
            "input_sha256": HASH,
        },
        decision="propose",
        reason_code="observation",
        rationale_summary="bounded proposal",
        observation_refs=({"observation_id": "obs-1", "sha256": HASH},),
        action=NumericProposalActionV2(
            knob_id=card.knob_id,
            direction="increase",
            requested_value=0.7779,
            effective_domain_sha256=domain.snapshot_sha256,
            expected_effects=(
                {"metric_id": "route_wirelength", "direction": "decrease"},
            ),
        ),
    )

    validate_numeric_proposal(proposal, domain)
    assert proposal.schema_version == "ecos.optimization_proposal.v3"
    payload = proposal.model_dump(mode="json")
    payload["schema_version"] = "ecos.optimization_proposal.v2"
    with pytest.raises(ValueError):
        OptimizationProposalV2.model_validate(payload)
    payload["schema_version"] = "ecos.optimization_proposal.v3"
    payload["action"]["threshold_refs"] = []
    with pytest.raises(ValueError):
        OptimizationProposalV2.model_validate(payload)


def test_v2_proposal_expected_effect_uses_controller_objective_metrics() -> None:
    with pytest.raises(ValueError, match="route_dr_total_violation_count"):
        NumericProposalActionV2(
            knob_id="place.cell_padding_x",
            direction="increase",
            requested_value=2,
            effective_domain_sha256=HASH,
            expected_effects=(
                {
                    "metric_id": "place_congestion_egr_overflow_total",
                    "direction": "decrease",
                },
            ),
        )


def test_v2_validator_binds_action_to_compiled_knowledge_support() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    domain = compile_effective_domain(
        card, context=domain_context(), baseline_surface_value=0.2
    )
    context_ref = {
        "episode_id": "episode-1",
        "checkpoint_id": "place",
        "input_sha256": HASH,
    }
    supported = {
        "claim_ref": {"entity_id": "claim.one", "chunk_sha256": HASH},
        "claim_sha256": "sha256:" + "b" * 64,
        "binding_id": "binding.one",
        "binding_sha256": "sha256:" + "c" * 64,
        "knob_id": card.knob_id.value,
        "direction": "increase",
        "effective_domain_sha256": domain.snapshot_sha256,
        "requested_value_bounds": domain.value_bounds.model_dump(mode="json"),
    }
    payload = {
        "context_ref": context_ref,
        "decision": "propose",
        "reason_code": "observation",
        "rationale_summary": "bounded proposal",
        "observation_refs": [{"observation_id": "obs-1", "sha256": HASH}],
        "action": {
            "claim_id": "claim.one",
            "claim_sha256": "sha256:" + "b" * 64,
            "binding_id": "binding.one",
            "binding_sha256": "sha256:" + "c" * 64,
            "knob_id": card.knob_id.value,
            "direction": "increase",
            "requested_value": 0.575,
            "effective_domain_sha256": domain.snapshot_sha256,
            "expected_effects": [
                {"metric_id": "route_wirelength", "direction": "decrease"}
            ],
        },
    }

    validate_optimization_proposal_v2(
        payload, domain, context_ref=context_ref, supported_action=supported
    )
    payload["action"]["binding_id"] = "binding.other"
    with pytest.raises(EffectiveDomainError, match="knowledge support"):
        validate_optimization_proposal_v2(
            payload, domain, context_ref=context_ref, supported_action=supported
        )
    payload["action"].pop("binding_sha256")
    with pytest.raises(EffectiveDomainError, match="invalid"):
        validate_optimization_proposal_v2(
            payload, domain, context_ref=context_ref, supported_action=supported
        )


def test_v2_validator_rejects_value_outside_hash_bound_domain() -> None:
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    domain = compile_effective_domain(
        card, context=domain_context(), baseline_surface_value=0.2
    )
    proposal = OptimizationProposalV2(
        context_ref={
            "episode_id": "episode-1",
            "checkpoint_id": "place",
            "input_sha256": HASH,
        },
        decision="propose",
        reason_code="observation",
        rationale_summary="bounded proposal",
        observation_refs=({"observation_id": "obs-1", "sha256": HASH},),
        action=NumericProposalActionV2(
            knob_id=card.knob_id,
            direction="increase",
            requested_value=0.575,
            effective_domain_sha256=domain.snapshot_sha256,
            expected_effects=(
                {"metric_id": "route_wirelength", "direction": "decrease"},
            ),
        ),
    )
    validate_numeric_proposal(proposal, domain)
    invalid = proposal.model_copy(
        update={"action": proposal.action.model_copy(update={"requested_value": 0.96})}
    )
    try:
        validate_numeric_proposal(invalid, domain)
    except EffectiveDomainError:
        pass
    else:
        raise AssertionError("out-of-domain proposal was accepted")

    for value, error in ((True, "type"), (float("inf"), "bounds"), (0.1, "direction")):
        invalid = proposal.model_copy(
            update={"action": proposal.action.model_copy(update={"requested_value": value})}
        )
        with pytest.raises(EffectiveDomainError, match=error):
            validate_numeric_proposal(invalid, domain)
    with pytest.raises(EffectiveDomainError, match="already attempted"):
        validate_numeric_proposal(
            proposal, domain,
            attempted=(RequestedKnobValue(knob_id=card.knob_id, value=0.575),),
        )
    stale = proposal.model_copy(
        update={"action": proposal.action.model_copy(update={"effective_domain_sha256": HASH})}
    )
    with pytest.raises(EffectiveDomainError, match="current context"):
        validate_numeric_proposal(stale, domain)


@pytest.mark.parametrize(
    ("current", "direction", "requested"),
    (
        (False, "enable", False),
        (False, "disable", True),
        (True, "enable", True),
        (True, "disable", True),
    ),
)
def test_v2_boolean_validator_rejects_direction_mismatch_and_noop(
    current: bool, direction: str, requested: bool
) -> None:
    card = load_parameter_cards()[OptimizationKnob.ROUTABILITY_OPT]
    context = domain_context(
        stage=card.stage,
        tool_revision=card.tool.revision,
        tool_source_sha256=card.tool.source_sha256,
        parameter_card_sha256=card_hash(card),
        unit=card.surface.unit,
        current_values={"place.routability_opt": current},
    )
    domain = compile_effective_domain(
        card, context=context, baseline_surface_value=current
    )
    proposal = OptimizationProposalV2(
        context_ref={
            "episode_id": "episode-1",
            "checkpoint_id": "place",
            "input_sha256": HASH,
        },
        decision="propose",
        reason_code="observation",
        rationale_summary="bounded boolean proposal",
        observation_refs=({"observation_id": "obs-1", "sha256": HASH},),
        action=NumericProposalActionV2(
            knob_id=card.knob_id,
            direction=direction,
            requested_value=requested,
            effective_domain_sha256=domain.snapshot_sha256,
            expected_effects=(
                {"metric_id": "route_wirelength", "direction": "decrease"},
            ),
        ),
    )

    with pytest.raises(EffectiveDomainError, match="boolean|no-op"):
        validate_numeric_proposal(proposal, domain)


@pytest.mark.parametrize(
    ("current", "direction", "requested"),
    ((False, "enable", True), (True, "disable", False)),
)
def test_v2_boolean_validator_accepts_exact_state_transition(
    current: bool, direction: str, requested: bool
) -> None:
    card = load_parameter_cards()[OptimizationKnob.ROUTABILITY_OPT]
    context = domain_context(
        stage=card.stage,
        tool_revision=card.tool.revision,
        tool_source_sha256=card.tool.source_sha256,
        parameter_card_sha256=card_hash(card),
        unit=card.surface.unit,
        current_values={"place.routability_opt": current},
    )
    domain = compile_effective_domain(
        card, context=context, baseline_surface_value=current
    )
    proposal = OptimizationProposalV2(
        context_ref={
            "episode_id": "episode-1",
            "checkpoint_id": "place",
            "input_sha256": HASH,
        },
        decision="propose",
        reason_code="observation",
        rationale_summary="bounded boolean proposal",
        observation_refs=({"observation_id": "obs-1", "sha256": HASH},),
        action=NumericProposalActionV2(
            knob_id=card.knob_id,
            direction=direction,
            requested_value=requested,
            effective_domain_sha256=domain.snapshot_sha256,
            expected_effects=(
                {"metric_id": "route_wirelength", "direction": "decrease"},
            ),
        ),
    )

    validate_numeric_proposal(proposal, domain)
