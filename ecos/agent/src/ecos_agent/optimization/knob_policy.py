"""Task permissions and deterministic search layers for the seven controlled knobs."""

from enum import StrEnum

from ecos_agent.optimization.contracts import (
    LegalAction,
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationObjectiveContract,
    StrategyDirection,
)
from ecos_agent.optimization.rules import IncumbentDecision

KNOB_ROLES = {
    OptimizationKnob.TARGET_DENSITY: "physical",
    OptimizationKnob.CELL_PADDING_X: "physical",
    OptimizationKnob.TARGET_OVERFLOW: "convergence",
    OptimizationKnob.ROUTABILITY_OPT: "strategy",
    OptimizationKnob.FLOORPLAN_CORE_UTIL: "floorplan_area",
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "floorplan_shape",
    OptimizationKnob.DENSITY_WEIGHT: "advanced",
}


class SearchLayerSignal(StrEnum):
    """Layer feedback derived from stage identity and metric change, not labels."""

    RETAIN = "retain"  # current stage's active metric improved, stage unchanged
    ADVANCE = "advance"  # stage unchanged, no current-stage progress
    RESET = "reset"  # recovery stage changed; clear the old stage layer basis


def history_layer_signal(
    *,
    incumbent_decision: IncumbentDecision | str | None,
    recovery_transition: str | None,
    active_stage: str | None,
    active_primary: str | None,
    decisive_metric: str | None,
) -> SearchLayerSignal:
    """Decide whether the last intervention keeps its layer, advances, or resets."""
    decision = (
        IncumbentDecision(incumbent_decision)
        if incumbent_decision is not None
        else None
    )
    if recovery_transition is not None:
        return SearchLayerSignal.RESET
    if (
        decision is IncumbentDecision.RECOVERY_PROGRESS
        and decisive_metric is not None
        and decisive_metric == active_primary
    ):
        return SearchLayerSignal.RETAIN
    # Episodes without an alignment have no recovery stage, so their primary
    # objective improvement is original-stage progress.
    if (
        decision is IncumbentDecision.CANDIDATE_BETTER
        and active_stage in (None, "original")
    ):
        return SearchLayerSignal.RETAIN
    return SearchLayerSignal.ADVANCE


def allowed_knobs(
    objective: OptimizationObjectiveContract | None,
) -> tuple[OptimizationKnob, ...]:
    # Objective-free controllers are used by the isolated parameter experiments.
    # The production runtime requires a frozen objective with an explicit policy.
    if objective is None:
        return tuple(OptimizationKnob)
    policy = objective.parameter_policy
    if policy is None:
        return ()
    return tuple(
        knob for knob, role in KNOB_ROLES.items()
        if (not role.startswith("floorplan_") or policy.geometry_mode == "variable")
        and (role != "advanced" or policy.advanced_parameters_enabled)
    )


def _layer_rotation(
    objective: OptimizationObjectiveContract | None,
    *,
    history: tuple[tuple[OptimizationKnob, SearchLayerSignal | str], ...] = (),
    recovering: bool = False,
) -> tuple[tuple[str, ...], int]:
    """Return the advisory layer order and its rotation start index."""
    area_first = not recovering and objective is not None and objective.primary_metric in {
        ObjectiveMetric.DIE_AREA, ObjectiveMetric.CORE_AREA,
    }
    order = (
        ("floorplan_area", "physical", "floorplan_shape", "convergence", "strategy", "advanced")
        if area_first else
        ("physical", "convergence", "strategy", "floorplan_shape", "floorplan_area", "advanced")
    )
    start = 0
    if history:
        last_knob, signal = history[-1]
        role = KNOB_ROLES[last_knob]
        if signal == SearchLayerSignal.RETAIN:
            start = order.index(role)
        elif signal == SearchLayerSignal.RESET:
            # A new recovery stage restarts from that stage's initial layer order.
            start = 0
        else:
            start = order.index(role) + 1
        if recovering and role.startswith("floorplan_") and signal != SearchLayerSignal.RETAIN:
            start = 0
    return order, start


def layer_priority(
    objective: OptimizationObjectiveContract | None,
    *,
    history: tuple[tuple[OptimizationKnob, SearchLayerSignal | str], ...] = (),
    recovering: bool = False,
) -> tuple[str, ...]:
    """Advisory layer order for the next planning turn, most promising first."""
    order, start = _layer_rotation(objective, history=history, recovering=recovering)
    return tuple(order[(start + offset) % len(order)] for offset in range(len(order)))


def select_search_actions(
    objective: OptimizationObjectiveContract | None,
    available: tuple[LegalAction, ...],
    *,
    history: tuple[tuple[OptimizationKnob, SearchLayerSignal | str], ...] = (),
    recovering: bool = False,
) -> tuple[str, tuple[LegalAction, ...]]:
    """Return the recommended layer plus every task-permitted legal action.

    The historical layer rotation stays as a planning reference: the returned
    layer is only the first layer that still has feasible actions in the
    advisory priority order.  Hard permissions stay binding on the returned
    actions: geometry mode, advanced opt-in, and the area-first direction
    policy for floorplan area knobs.
    """
    allowed = set(allowed_knobs(objective))
    available = tuple(action for action in available if action.knob_id in allowed)
    if objective is None:
        return "unrestricted_experiment", available
    available = tuple(
        action for action in available
        if not (
            KNOB_ROLES[action.knob_id] == "floorplan_area"
            and not recovering
            and objective.primary_metric in {
                ObjectiveMetric.DIE_AREA, ObjectiveMetric.CORE_AREA,
            }
            and action.direction != StrategyDirection.INCREASE
        )
    )
    if not available:
        return "unavailable", ()
    priority = layer_priority(
        objective, history=history, recovering=recovering
    )
    for role in priority:
        if any(KNOB_ROLES[action.knob_id] == role for action in available):
            return role, available
    return "unavailable", ()


def policy_payload(
    objective: OptimizationObjectiveContract | None, layer: str, *,
    priority: tuple[str, ...] = (),
) -> dict[str, object]:
    allowed = set(allowed_knobs(objective))
    payload: dict[str, object] = {
        "active_layer": layer,
        "knobs": [
            {
                "knob_id": knob.value,
                "role": role,
                "enabled": knob in allowed,
                "disabled_reason": (
                    None if knob in allowed else
                    "parameter_policy_unavailable" if objective is not None and objective.parameter_policy is None else
                    "advanced_parameters_disabled" if role == "advanced" else
                    "geometry_fixed" if role.startswith("floorplan_") else
                    "parameter_policy_unavailable"
                ),
            }
            for knob, role in KNOB_ROLES.items()
        ],
    }
    if priority:
        # The rotation is advisory: the model may pick any legal action, but
        # should justify departing from the recommended layer priority.
        payload["layer_priority"] = list(priority)
        payload["layer_priority_is_advisory"] = True
    return payload

