"""Compact planner-facing projection of replayable optimization history."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ecos_agent.optimization.contracts import ObjectiveMetric, TerminalObservation
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt

if TYPE_CHECKING:
    from ecos_agent.optimization.planning import (
        OptimizationHistory,
        OptimizationPlanningContext,
    )


def trajectory_objective(
    context: OptimizationPlanningContext,
) -> tuple[ObjectiveMetric | None, tuple[ObjectiveMetric, ...]]:
    if context.active_objective is not None:
        return (
            context.active_objective.active_primary_metric,
            context.active_objective.active_preserve_metrics,
        )
    if context.objective is not None:
        return context.objective.primary_metric, context.objective.preserve_metrics
    return None, ()


def _metric(
    metric: ObjectiveMetric,
    observation: TerminalObservation | None,
    incumbent: TerminalObservation | None,
) -> dict[str, object]:
    value = (
        observation.objective_metrics.get(metric)
        if observation is not None
        else None
    )
    payload: dict[str, object] = {"metric_id": metric.value, "value": value}
    if value is not None and incumbent is not None:
        incumbent_value = incumbent.objective_metrics.get(metric)
        if incumbent_value is not None:
            payload["delta_vs_incumbent"] = round(value - incumbent_value, 12)
    return payload


def planner_terminal_observation_payload(
    observation: TerminalObservation,
    *,
    incumbent: TerminalObservation | None = None,
) -> dict[str, object]:
    """Remove audit-only terminal references from the planner projection."""
    # Deferred import avoids the planning <-> trajectory projection cycle.
    from ecos_agent.optimization.planning import projected_terminal_observation

    payload = projected_terminal_observation(observation, incumbent=incumbent)
    for key in (
        "observation_id",
        "sta_corner_set_sha256",
        "evidence_manifest_sha256",
    ):
        payload.pop(key, None)
    return payload


def planner_receipt_payload(receipt: ParameterApplicationReceipt) -> dict[str, object]:
    """Expose parameter semantics while omitting receipt provenance."""
    return {
        "parameter": receipt.parameter.model_dump(mode="json"),
        "application": receipt.application.model_dump(mode="json"),
        "observation": receipt.observation,
    }


def planner_trajectory_payload(
    item: OptimizationHistory,
    *,
    incumbent: TerminalObservation | None,
    primary_metric: ObjectiveMetric | None,
    preserve_metrics: tuple[ObjectiveMetric, ...],
) -> dict[str, object]:
    """Keep v3 decision evidence model-visible and full evidence ledger-bound."""
    receipt = item.parameter_application_receipt
    payload: dict[str, object] = {
        "schema_version": "ecos.planner_trajectory.v2",
        "reference": {"intervention_id": item.reference.intervention_id},
        "outcome": item.outcome.value,
        "knob_id": item.action.knob_id.value,
        "requested": item.requested.model_dump(mode="json"),
        "parameter_application_receipt": (
            planner_receipt_payload(receipt) if receipt is not None else None
        ),
        "primary_metric": (
            _metric(primary_metric, item.terminal_observation, incumbent)
            if primary_metric is not None
            else None
        ),
        "preserve_metrics": [
            _metric(metric, item.terminal_observation, incumbent)
            for metric in preserve_metrics
        ],
        "incumbent_decision": item.incumbent_decision,
    }
    if item.rationale_summary is not None:
        payload["rationale_summary"] = item.rationale_summary
    return payload
