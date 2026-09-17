"""Direction-only ablation wrapper: lattice values behind an LLM planner."""

from __future__ import annotations

from types import SimpleNamespace

from tests.optimization.parameters.effectiveness_support import (
    HASH,
    domain_context,
)

from ecos_agent.optimization.contracts import (
    ObservationReference,
    OptimizationKnob,
    ProposalContextRef,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.experiments.direction_only_provider import (
    DirectionOnlyProposalProvider,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
)
from ecos_agent.optimization.parameters.effective_domain import (
    compile_effective_domain,
    validate_optimization_proposal_v2,
)
from ecos_agent.optimization.parameters.semantics import (
    load_parameter_cards,
)

_ALL_CURRENT_VALUES = {
    "place.target_density": 0.45,
    "place.cell_padding_x": 2,
    "place.target_overflow": 0.1,
    "place.routability_opt": True,
    "floorplan.core_util": 0.3,
    "floorplan.aspect_ratio": 1.0,
    "place.density_weight": 0.00085,
}


def _density_domain(attempted=()):
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    return compile_effective_domain(
        card,
        context=domain_context(attempted_values=tuple(attempted)),
        attempted=tuple(attempted),
        baseline_surface_value=0.2,
    )


def _planning_context():
    return SimpleNamespace(
        current_values={**_ALL_CURRENT_VALUES, "place.target_density": 0.2},
    )


def _planning_context_ref():
    return {
        "episode_id": "episode-1",
        "checkpoint_id": "place",
        "input_sha256": HASH,
    }


def _model_proposal(domain, *, direction, value):
    """A canned planner payload the way the Codex provider emits one."""
    return {
        "schema_version": "ecos.optimization_proposal.v3",
        "context_ref": _planning_context_ref(),
        "decision": "propose",
        "reason_code": "observation",
        "rationale_summary": "raise density to relieve routing detours",
        "observation_refs": [{"observation_id": "obs-1", "sha256": HASH}],
        "action": {
            "knob_id": "place.target_density",
            "direction": direction.value,
            "requested_value": value,
            "effective_domain_sha256": domain.snapshot_sha256,
            "expected_effects": [
                {"metric_id": "route_wirelength", "direction": "decrease"}
            ],
        },
    }


class _StubProvider:
    def __init__(self, payload):
        self._payload = payload

    def propose_v2(self, context, domains):
        return dict(self._payload)


def test_wrapper_rewrites_a_free_value_to_the_lattice() -> None:
    domain = _density_domain()
    context = _planning_context()
    inner = _StubProvider(
        _model_proposal(domain, direction=StrategyDirection.INCREASE, value=0.47)
    )
    provider = DirectionOnlyProposalProvider(inner)
    payload = provider.propose_v2(context, (domain,))
    assert payload["decision"] == "propose"
    assert payload["action"]["requested_value"] == 0.55
    assert payload["action"]["direction"] == "increase"
    # The rewritten proposal must survive the controller's domain validation.
    validated = validate_optimization_proposal_v2(
        payload,
        domain,
        context_ref=_planning_context_ref(),
        attempted=domain.attempted_values,
    )
    assert validated.action is not None
    assert validated.action.requested_value == 0.55


def test_wrapper_passes_through_continue_decisions() -> None:
    domain = _density_domain()
    payload = _model_proposal(
        domain, direction=StrategyDirection.INCREASE, value=0.55
    )
    payload["decision"] = "continue"
    payload.pop("action")
    result = DirectionOnlyProposalProvider(_StubProvider(payload)).propose_v2(
        _planning_context(), (domain,)
    )
    assert result == payload
    # A continue payload must stay a valid v3 proposal for v2_to_v1.
    OptimizationProposalV2.model_validate(result)


def test_wrapper_reports_continue_when_the_lattice_is_exhausted() -> None:
    domain = _density_domain(
        attempted=[
            RequestedKnobValue(knob_id="place.target_density", value=0.1),
            RequestedKnobValue(knob_id="place.target_density", value=0.15),
        ]
    )
    inner = _StubProvider(
        _model_proposal(
            domain, direction=StrategyDirection.DECREASE, value=0.15
        )
    )
    result = DirectionOnlyProposalProvider(inner).propose_v2(
        _planning_context(), (domain,)
    )
    assert result["decision"] == "continue"
    assert result["reason_code"] == "no_legal_candidate"
    assert "action" not in result
    assert len(result["rationale_summary"]) <= 512
    OptimizationProposalV2.model_validate(result)
