"""Validate structured objective semantics before user confirmation and freezing."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, StrictBool

if TYPE_CHECKING:
    from ecos_agent.optimization.contracts import ObjectiveMetric, OptimizationObjectiveProposal


class OptimizationParameterPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.optimization_parameter_policy.v1"] = (
        "ecos.optimization_parameter_policy.v1"
    )
    geometry_mode: Literal["fixed", "variable"] = "fixed"
    advanced_parameters_enabled: StrictBool = True


def resolve_objective_intent(
    goal: str, proposal: OptimizationObjectiveProposal,
) -> tuple[ObjectiveMetric, OptimizationParameterPolicy]:
    """Check semantic field conflicts without reparsing language as permissions.

    The structured provider interprets scope, negation and explicit opt-in. ECOS
    validates the policy and presents it for confirmation before execution. Old
    proposals infer geometry only from their typed metric; old frozen episodes
    retain their missing policy and are handled separately by recovery.
    """
    from ecos_agent.optimization.contracts import ObjectiveMetric

    if proposal.unsupported_reason is not None:
        raise ValueError(f"Unsupported optimization intent: {proposal.unsupported_reason}")
    primary = proposal.primary_metric
    physical_area = primary in (ObjectiveMetric.DIE_AREA, ObjectiveMetric.CORE_AREA)
    policy = proposal.parameter_policy or OptimizationParameterPolicy(
        geometry_mode="variable" if physical_area else "fixed",
    )
    if physical_area and policy.geometry_mode != "variable":
        raise ValueError("Reducing physical area requires an explicitly variable outline policy.")
    return primary, policy


_DRC_GOAL_MARKERS = (
    "drc",
    "design rule",
    "design-rule",
    "设计规则",
    "规则违例",
)


def effective_preserve_metrics(
    goal_text: str,
    proposal: "OptimizationObjectiveProposal",
    *,
    geometry_fixed: bool = False,
) -> "tuple[ObjectiveMetric, ...]":
    """Freeze the user's binding preserve constraints after semantic cleanup.

    Timing metrics drop out because shared WNS/TNS tolerances and
    recovery/signoff gates already protect them; fixed geometry protects
    area independently; an explicit DRC goal binds drc_count as a preserve
    metric.  At most two preserve metrics survive.
    """
    from ecos_agent.optimization.contracts import (
        TIMING_OBJECTIVE_ORDER,
        ObjectiveMetric,
    )

    preserve_metrics = [
        metric
        for metric in proposal.preserve_metrics
        if metric
        not in (
            *TIMING_OBJECTIVE_ORDER,
            ObjectiveMetric.STA_SETUP_VIOLATION_COUNT,
            ObjectiveMetric.STA_HOLD_VIOLATION_COUNT,
        )
    ]
    if geometry_fixed:
        preserve_metrics = [
            metric for metric in preserve_metrics
            if metric not in (ObjectiveMetric.DIE_AREA, ObjectiveMetric.CORE_AREA)
        ]
    mentions_drc = any(marker in goal_text.casefold() for marker in _DRC_GOAL_MARKERS)
    drc_metric = ObjectiveMetric.DRC_COUNT
    if (
        mentions_drc
        and proposal.primary_metric != drc_metric
        and drc_metric not in preserve_metrics
    ):
        preserve_metrics.insert(0, drc_metric)
    if len(preserve_metrics) > 2:
        raise ValueError("optimization objective preserves too many metrics after DRC binding")
    return tuple(preserve_metrics)
