"""Deterministic maintenance of the planner's declared multi-step strategy.

The strategy object is declarative: it sequences single-knob probes and
conditions later steps on earlier outcomes, but only the per-turn ``action``
dispatches and every step still passes the full per-turn validation when it
becomes that action.  This module computes the deterministic annotations the
controller exposes back to the planner (attempted, legality, condition state)
and the viability count that keeps "continue with a reasonable hypothesis"
from counting as a planning stall.
"""

from __future__ import annotations

from typing import Literal, Sequence

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    HIGHER_IS_BETTER_OBJECTIVES,
    LegalAction,
    ObjectiveMetric,
    RequestedKnobValue,
    TerminalObservation,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationStrategyV4,
    StrategyStepCondition,
)
from ecos_agent.optimization.planning import OptimizationHistory
from ecos_agent.optimization.rules import PROMOTING_DECISIONS

ConditionState = Literal["satisfied", "unsatisfied", "unknown"]

_PROMOTED = {decision.value for decision in PROMOTING_DECISIONS}


def strategy_sha256(strategy: OptimizationStrategyV4) -> str:
    return canonical_sha256(strategy.model_dump(mode="json"))


def _better_direction(
    metric_id: ObjectiveMetric,
) -> Literal["lower", "higher"]:
    """Which way is 'better', from the adjudication's own direction table."""
    return (
        "higher" if metric_id in HIGHER_IS_BETTER_OBJECTIVES else "lower"
    )


def evaluate_step_condition(
    condition: StrategyStepCondition,
    *,
    history: Sequence[OptimizationHistory],
    incumbent: TerminalObservation | None,
) -> ConditionState:
    """Evaluate a step condition against the most recent completed probe."""
    item = next(
        (
            entry
            for entry in reversed(history)
            if entry.terminal_observation is not None
        ),
        None,
    )
    if item is None or incumbent is None:
        return "unknown"
    if item.incumbent_decision in _PROMOTED:
        # The probe became the incumbent, so the pre-probe baseline is no
        # longer reconstructible; the planner reads the promotion itself.
        return "unknown"
    candidate = item.terminal_observation.metrics.get(condition.metric_id)
    baseline = incumbent.metrics.get(condition.metric_id)
    if candidate is None or baseline is None:
        return "unknown"
    delta = candidate - baseline
    if condition.expects == "unchanged":
        return "satisfied" if delta == 0 else "unsatisfied"
    better = _better_direction(condition.metric_id)
    if condition.expects == "improved":
        improved = delta < 0 if better == "lower" else delta > 0
        return "satisfied" if improved else "unsatisfied"
    degraded = delta > 0 if better == "lower" else delta < 0
    return "satisfied" if degraded else "unsatisfied"


def _step_attempted(
    step, attempted: Sequence[RequestedKnobValue]
) -> bool:
    for request in attempted:
        if request.knob_id != step.knob_id:
            continue
        if step.requested_value is None or request.value == step.requested_value:
            return True
    return False


def annotate_strategy(
    strategy: OptimizationStrategyV4,
    *,
    incumbent: TerminalObservation | None,
    history: Sequence[OptimizationHistory],
    legal_actions: Sequence[LegalAction],
    attempted: Sequence[RequestedKnobValue],
    parent_config_sha256: str | None,
    current_parent_config_sha256: str | None,
) -> dict[str, object]:
    """Project the declared strategy into its planner-facing annotated form."""
    legal = {(action.knob_id, action.direction) for action in legal_actions}
    steps = []
    viable = 0
    for step in strategy.steps:
        condition_state = (
            evaluate_step_condition(
                step.condition, incumbent=incumbent, history=history
            )
            if step.condition is not None
            else None
        )
        attempted_now = _step_attempted(step, attempted)
        step_legal = (step.knob_id, step.direction) in legal
        if step_legal and not attempted_now and condition_state != "unsatisfied":
            viable += 1
        entry: dict[str, object] = {
            "step_id": step.step_id,
            "knob_id": step.knob_id.value,
            "direction": step.direction.value,
            "requested_value": step.requested_value,
            "intent": step.intent,
            "depends_on": list(step.depends_on),
            "rationale": step.rationale,
            "legal": step_legal,
            "status": "attempted" if attempted_now else "pending",
        }
        if step.condition is not None:
            entry["condition"] = {
                "metric_id": step.condition.metric_id.value,
                "expects": step.condition.expects,
                "state": condition_state,
            }
        steps.append(entry)
    payload: dict[str, object] = {
        "schema_version": strategy.schema_version,
        "strategy_sha256": strategy_sha256(strategy),
        "goal": strategy.goal,
        "steps": steps,
        "viable_step_count": viable,
    }
    if strategy.supersede_of is not None:
        payload["supersede_of"] = strategy.supersede_of
    if parent_config_sha256 is not None:
        payload["declared_parent_config_sha256"] = parent_config_sha256
        payload["values_stale"] = (
            current_parent_config_sha256 != parent_config_sha256
        )
    return payload


def viable_strategy_step_count(
    strategy: OptimizationStrategyV4 | None,
    *,
    incumbent: TerminalObservation | None,
    history: Sequence[OptimizationHistory],
    legal_actions: Sequence[LegalAction],
    attempted: Sequence[RequestedKnobValue],
) -> int:
    """Count declared steps that are still legal, unattempted, and unblocked."""
    if strategy is None:
        return 0
    payload = annotate_strategy(
        strategy,
        incumbent=incumbent,
        history=history,
        legal_actions=legal_actions,
        attempted=attempted,
        parent_config_sha256=None,
        current_parent_config_sha256=None,
    )
    count = payload["viable_step_count"]
    return count if isinstance(count, int) else 0


__all__ = [
    "ConditionState",
    "annotate_strategy",
    "evaluate_step_condition",
    "strategy_sha256",
    "viable_strategy_step_count",
]
