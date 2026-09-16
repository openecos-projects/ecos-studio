"""Baseline proposal provider: policy selections through the planner protocol."""

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
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.experiments.baseline_provider import (
    BaselineProposalProvider,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
)
from ecos_agent.optimization.parameters.effective_domain import (
    compile_effective_domain,
    validate_optimization_proposal_v2,
)
from ecos_agent.optimization.parameters.semantics import (
    card_hash,
    load_parameter_cards,
)
from ecos_agent.optimization.rules import legal_actions as rules_legal_actions

# Production current-values are keyed by knob id across the full frozen face.
_ALL_CURRENT_VALUES = {
    "place.target_density": 0.45,
    "place.cell_padding_x": 2,
    "place.target_overflow": 0.1,
    "place.routability_opt": True,
    "floorplan.core_util": 0.3,
    "floorplan.aspect_ratio": 1.0,
    "place.density_weight": 0.00085,
}


def _planning_context(domain, *, legal_actions, incumbent=None, current_values=None):
    return SimpleNamespace(
        context_ref=ProposalContextRef(
            episode_id="episode-1",
            checkpoint_id="place",
            input_sha256=HASH,
        ),
        observation_ref=ObservationReference(observation_id="obs-1", sha256=HASH),
        incumbent=incumbent,
        # The compiled domain anchors its current coordinate at 0.2; the
        # direction/value pairing is validated against that coordinate.
        current_values=current_values
        if current_values is not None
        else {**_ALL_CURRENT_VALUES, "place.target_density": 0.2},
        legal_actions=legal_actions,
        effective_domains=(domain,),
    )


def _density_domain(attempted=()):
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    return compile_effective_domain(
        card,
        context=domain_context(attempted_values=tuple(attempted)),
        baseline_surface_value=0.2,
    )


def _legal_surface():
    return tuple(
        action
        for action in rules_legal_actions(
            current_values=dict(_ALL_CURRENT_VALUES), attempted=()
        )
        if action.knob_id == OptimizationKnob.TARGET_DENSITY
    )


def test_coordinate_provider_proposes_a_domain_bound_action() -> None:
    domain = _density_domain()
    context = _planning_context(domain, legal_actions=_legal_surface())
    provider = BaselineProposalProvider(
        "controlled_coordinate", design_id="gcd", seed=0
    )
    proposal = provider.propose_v2(context, (domain,))
    assert isinstance(proposal, OptimizationProposalV2)
    assert proposal.decision == "propose"
    # The proposal contract only accepts ProposalReason enum values; free-form
    # baseline codes fail planner validation and escalate real episodes.
    ProposalReason(proposal.reason_code)
    action = proposal.action
    assert action is not None
    assert (action.knob_id, action.direction) in {
        (item.knob_id, item.direction) for item in context.legal_actions
    }
    assert domain.accepts(action.requested_value)
    assert action.effective_domain_sha256 == domain.snapshot_sha256
    assert action.claim_id is None and action.binding_id is None
    assert action.expected_effects[0].direction == "unknown"
    # The full static-domain validator must accept the provider's proposal.
    validated = validate_optimization_proposal_v2(
        proposal.model_dump(mode="json"),
        domain,
        context_ref={
            "episode_id": "episode-1",
            "checkpoint_id": "place",
            "input_sha256": HASH,
        },
        attempted=domain.attempted_values,
    )
    assert validated.action.requested_value == action.requested_value


def test_random_provider_is_seed_deterministic() -> None:
    domain = _density_domain()
    context = _planning_context(domain, legal_actions=_legal_surface())
    first = BaselineProposalProvider("random_action", design_id="gcd", seed=7)
    second = BaselineProposalProvider("random_action", design_id="gcd", seed=7)
    left = first.propose_v2(context, (domain,))
    right = second.propose_v2(context, (domain,))
    assert left.action.requested_value == right.action.requested_value


def test_provider_falls_back_to_continue_without_legal_actions() -> None:
    domain = _density_domain()
    context = _planning_context(domain, legal_actions=())
    provider = BaselineProposalProvider("random_action", design_id="gcd", seed=0)
    proposal = provider.propose_v2(context, (domain,))
    assert proposal.decision == "continue"
    assert proposal.action is None


def test_policy_choice_outside_the_legal_surface_falls_back() -> None:
    domain = _density_domain()
    # Restrict the legal surface to the decrease direction only; whichever
    # direction the coordinate policy prefers, the provider must stay legal.
    restricted = tuple(
        item
        for item in _legal_surface()
        if item.direction == StrategyDirection.DECREASE
    )
    context = _planning_context(domain, legal_actions=restricted)
    provider = BaselineProposalProvider(
        "controlled_coordinate", design_id="gcd", seed=0
    )
    proposal = provider.propose_v2(context, (domain,))
    assert proposal.decision == "propose"
    assert (proposal.action.knob_id, proposal.action.direction) in {
        (item.knob_id, item.direction) for item in restricted
    }
