"""Deterministic baseline policies driven through the standard episode runtime.

The adapter speaks the planner protocol (``propose_v2``) so baselines run the
same controller, budget, receipts, ledger, and promotion contract as the LLM
treatments; only the selection policy differs.  Requested values always come
from the frozen lattice selector, and policy choices outside the task-permitted
legal surface fall back deterministically instead of triggering repair.
"""

from __future__ import annotations

from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationKnob,
    RequestedKnobValue,
)
from ecos_agent.optimization.experiments.baselines import (
    BaselineMethod,
    BaselineSelection,
    select_baseline_candidate,
)
from ecos_agent.optimization.parameters.contracts import (
    ExpectedEffectV2,
    NumericProposalActionV2,
    OptimizationProposalV2,
)
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainSnapshot,
)
from ecos_agent.optimization.planning import (
    OptimizationPlanningContext,
)
from ecos_agent.optimization.rules import select_requested_value

# Deterministic policies declare no hypothesis: the audited effect direction
# is "unknown", so expected-effect realization metrics exclude baselines.
_NO_HYPOTHESIS_EFFECT = ExpectedEffectV2(
    metric_id=ObjectiveMetric.ROUTE_WIRELENGTH, direction="unknown"
)


class BaselineProposalProvider:
    """One frozen baseline policy behind the standard planner protocol."""

    def __init__(
        self,
        method: BaselineMethod | str,
        *,
        design_id: str,
        seed: int = 0,
    ) -> None:
        self._method = BaselineMethod(method)
        self._design_id = design_id
        self._seed = seed
        self._turn = 0
        self._coordinate_index = 0

    # The episode driver configures a provider model; deterministic policies
    # have none, so these mirror the Codex provider interface as no-ops.
    def select_model(self, model: str) -> None:  # noqa: ARG002
        return None

    def set_model_settings(self, *, model: str, reasoning_effort: str) -> None:  # noqa: ARG002
        return None

    def close(self) -> None:
        return None

    @property
    def method(self) -> BaselineMethod:
        return self._method

    def propose_v2(
        self,
        context: OptimizationPlanningContext,
        domains: tuple[EffectiveDomainSnapshot, ...],
    ) -> OptimizationProposalV2:
        attempted = tuple(
            RequestedKnobValue(knob_id=domain.knob_id, value=value)
            for domain in domains
            for value in domain.attempted_values
        )
        current_values = dict(context.current_values or {})
        method = self._method
        if method == BaselineMethod.RULE_GUIDED_DIRECTION and context.incumbent is None:
            # The rule table reads incumbent overflow; an uninitialized
            # episode falls back to coordinate order deterministically.
            method = BaselineMethod.CONTROLLED_COORDINATE
        selection = select_baseline_candidate(
            method,
            design_id=self._design_id,
            turn_index=self._turn,
            coordinate_index=self._coordinate_index,
            random_seed=self._seed,
            current_values=current_values,
            attempted=attempted,
            incumbent=context.incumbent,
        )
        self._turn += 1
        legal = {
            (action.knob_id, action.direction) for action in context.legal_actions
        }
        if selection is not None and (
            selection.action.knob_id,
            selection.action.direction,
        ) not in legal:
            selection = None
        if selection is None:
            selection = _fallback_selection(
                context, current_values, attempted, legal
            )
        if selection is None:
            return OptimizationProposalV2(
                context_ref=context.context_ref,
                decision="continue",
                reason_code=f"baseline_{self._method.value}_exhausted",
                rationale_summary="no legal baseline action remains",
                observation_refs=(context.observation_ref,),
            )
        domain = next(
            item
            for item in domains
            if item.knob_id == selection.requested.knob_id
        )
        self._coordinate_index = selection.next_coordinate_index
        return OptimizationProposalV2(
            context_ref=context.context_ref,
            decision="propose",
            reason_code=f"baseline_{method.value}",
            rationale_summary=(
                f"{method.value} deterministic selection from the static legal domain"
            ),
            observation_refs=(context.observation_ref,),
            knowledge_refs=(
                (selection.knowledge_ref,) if selection.knowledge_ref else ()
            ),
            action=NumericProposalActionV2(
                knob_id=selection.requested.knob_id,
                direction=selection.action.direction,
                requested_value=selection.requested.value,
                effective_domain_sha256=domain.snapshot_sha256,
                expected_effects=(_NO_HYPOTHESIS_EFFECT,),
            ),
        )


def _fallback_selection(
    context: OptimizationPlanningContext,
    current_values: dict[str, bool | int | float],
    attempted: tuple[RequestedKnobValue, ...],
    legal: set[tuple[OptimizationKnob, object]],
) -> BaselineSelection | None:
    """First task-permitted legal action with an unrequested lattice value."""
    for action in context.legal_actions:
        requested = select_requested_value(
            action, current_values=current_values, attempted=attempted
        )
        if requested is None:
            continue
        return BaselineSelection(action, requested, 0)
    return None
