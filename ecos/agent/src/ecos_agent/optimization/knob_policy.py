"""Task permissions and deterministic search layers for the seven controlled knobs."""

from ecos_agent.optimization.contracts import (
    LegalAction,
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationObjectiveContract,
    StrategyDirection,
)

KNOB_ROLES = {
    OptimizationKnob.TARGET_DENSITY: "physical",
    OptimizationKnob.CELL_PADDING_X: "physical",
    OptimizationKnob.TARGET_OVERFLOW: "convergence",
    OptimizationKnob.ROUTABILITY_OPT: "strategy",
    OptimizationKnob.FLOORPLAN_CORE_UTIL: "floorplan_area",
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "floorplan_shape",
    OptimizationKnob.DENSITY_WEIGHT: "advanced",
}


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


def select_search_actions(
    objective: OptimizationObjectiveContract | None,
    available: tuple[LegalAction, ...],
    *,
    history: tuple[tuple[OptimizationKnob, str], ...] = (),
    recovering: bool = False,
    convergence_evidence: bool = False,
) -> tuple[str, tuple[LegalAction, ...]]:
    """Keep an improving layer; otherwise try the next nonempty permitted layer."""
    allowed = set(allowed_knobs(objective))
    available = tuple(action for action in available if action.knob_id in allowed)
    if objective is None:
        return "unrestricted_experiment", available
    if not convergence_evidence:
        available = tuple(action for action in available if action.knob_id != OptimizationKnob.TARGET_OVERFLOW)
    if not available:
        return "unavailable", ()
    area_first = not recovering and objective.primary_metric in {
        ObjectiveMetric.DIE_AREA, ObjectiveMetric.CORE_AREA,
    }
    order = (
        ("floorplan_area", "physical", "floorplan_shape", "convergence", "strategy", "advanced")
        if area_first else
        ("physical", "convergence", "strategy", "floorplan_shape", "floorplan_area", "advanced")
    )
    start = 0
    if history:
        last_knob, outcome = history[-1]
        role = KNOB_ROLES[last_knob]
        start = order.index(role) + (outcome != "improved")
        # A new recovery stage must start with its physical search layer.
        if recovering and role.startswith("floorplan_"):
            start = 0
    for offset in range(len(order)):
        role = order[(start + offset) % len(order)]
        selected = tuple(
            action for action in available
            if KNOB_ROLES[action.knob_id] == role
            and not (
                area_first and role == "floorplan_area"
                and action.direction != StrategyDirection.INCREASE
            )
        )
        if selected:
            return role, selected
    return "unavailable", ()


def policy_payload(
    objective: OptimizationObjectiveContract | None, layer: str, *,
    convergence_evidence: bool = False,
) -> dict[str, object]:
    allowed = set(allowed_knobs(objective))
    convergence_disabled = objective is not None and not convergence_evidence
    return {
        "active_layer": layer,
        "knobs": [
            {
                "knob_id": knob.value,
                "role": role,
                "enabled": knob in allowed and not (role == "convergence" and convergence_disabled),
                "disabled_reason": (
                    "placement_convergence_evidence_unavailable"
                    if knob in allowed and role == "convergence" and convergence_disabled else
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
