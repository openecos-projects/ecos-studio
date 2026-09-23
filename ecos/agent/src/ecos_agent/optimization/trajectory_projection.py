"""Compact planner-facing projection of replayable optimization history."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ecos_agent.optimization.contracts import ObjectiveMetric, TerminalObservation

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


def planner_trajectory_payload(
    item: OptimizationHistory,
    *,
    incumbent: TerminalObservation | None,
    primary_metric: ObjectiveMetric | None,
    preserve_metrics: tuple[ObjectiveMetric, ...],
) -> dict[str, object]:
    """Keep decision evidence model-visible and full evidence ledger-bound."""
    receipt = item.parameter_application_receipt
    payload: dict[str, object] = {
        "schema_version": "ecos.planner_trajectory.v1",
        "reference": item.reference.model_dump(mode="json"),
        "outcome": item.outcome.value,
        "knob_id": item.action.knob_id.value,
        "requested_value": item.requested.value,
        "actual_value": receipt.actual_value if receipt is not None else None,
        "receipt_status": receipt.status if receipt is not None else None,
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
    if receipt is not None:
        materialization = getattr(receipt, "materialization", None)
        if materialization is not None:
            payload["written_value"] = materialization.written_value
            payload["written_unit"] = materialization.unit
        if receipt.reason is not None:
            payload["receipt_reason"] = receipt.reason
        if receipt.observation:
            payload["receipt_observation"] = receipt.observation
    if item.rationale_summary is not None:
        payload["rationale_summary"] = item.rationale_summary
    return payload
