"""Build terminal metric records from validated workspace QoR values."""

from __future__ import annotations

from ecos_agent.optimization_metric_contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)


class OptimizationObservationError(ValueError):
    """The frozen workspace evidence cannot form a trusted observation."""


def build_eligibility_metrics(
    metrics_by_path: dict[str, dict[str, float]],
) -> tuple[TerminalEvaluationMetric, ...]:
    specifications = (
        ("drc_ecc/analysis/qor_metrics.json", "drc_count"),
        ("lvs_ecc/analysis/qor_metrics.json", "lvs_count"),
        ("RCX_ecc/analysis/qor_metrics.json", "rcx_expected_corner_count"),
        ("RCX_ecc/analysis/qor_metrics.json", "rcx_spef_file_count"),
        ("RCX_ecc/analysis/qor_metrics.json", "rcx_missing_corner_count"),
        ("RCX_ecc/analysis/qor_metrics.json", "rcx_spef_parse_failure_count"),
        ("sta_ecc/analysis/qor_metrics.json", "sta_corner_count"),
        ("sta_ecc/analysis/qor_metrics.json", "sta_expected_corner_count"),
        ("sta_ecc/analysis/qor_metrics.json", "sta_missing_corner_count"),
        ("sta_ecc/analysis/qor_metrics.json", "sta_setup_violation_count"),
        ("sta_ecc/analysis/qor_metrics.json", "sta_hold_violation_count"),
        ("Harden_ecc/analysis/qor_metrics.json", "harden_artifact_missing_count"),
    )
    return tuple(
        metric_record(
            metric_id,
            required_nonnegative_metric(metrics_by_path[path], metric_id),
            "count",
            EvaluationMetricCategory.ELIGIBILITY,
            EvaluationMetricRole.GATE,
            EvaluationMetricDirection.EXACT,
            (path,),
        )
        for path, metric_id in specifications
    )


def build_routing_diagnostics(
    route_metrics: dict[str, float],
) -> tuple[tuple[TerminalEvaluationMetric, ...], bool]:
    source = "route_ecc/analysis/qor_metrics.json"
    metric_ids = ("route_via_count", "route_dr_total_patch_count")
    records = tuple(
        metric_record(
            metric_id,
            route_metrics[metric_id],
            "count",
            EvaluationMetricCategory.ROUTING_DIAGNOSTIC,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.LOWER_IS_BETTER,
            (source,),
        )
        for metric_id in metric_ids
        if metric_id in route_metrics
    )
    if any(record.value < 0 for record in records):
        raise OptimizationObservationError("terminal evaluation metric is invalid")
    return records, len(records) == len(metric_ids)


def build_cost_metrics(
    metrics_by_path: dict[str, dict[str, float]], terminal_qor_files: tuple[str, ...]
) -> tuple[tuple[TerminalEvaluationMetric, ...], bool]:
    rows = []
    for path in terminal_qor_files:
        metrics = metrics_by_path.get(path, {})
        runtime = optional_nonnegative_metric(metrics, "runtime_seconds")
        memory = optional_nonnegative_metric(metrics, "peak_memory_mb")
        if runtime is not None and memory is not None:
            rows.append((path, runtime, memory))
    sources = tuple(path for path, _, _ in rows)
    records = [
        metric_record(
            "flow_stage_count",
            float(len(terminal_qor_files)),
            "count",
            EvaluationMetricCategory.COST,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.EXACT,
            ("home/flow.json",),
        ),
        metric_record(
            "flow_cost_covered_stage_count",
            float(len(rows)),
            "count",
            EvaluationMetricCategory.COST,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.HIGHER_IS_BETTER,
            sources or ("home/flow.json",),
        ),
    ]
    complete = len(rows) == len(terminal_qor_files)
    if complete:
        records.extend(_complete_cost_metrics(rows, sources))
    return tuple(records), complete


def _complete_cost_metrics(
    rows: list[tuple[str, float, float]], sources: tuple[str, ...]
) -> tuple[TerminalEvaluationMetric, ...]:
    values = (
        (
            "flow_tool_runtime",
            sum(runtime for _, runtime, _ in rows),
            "s",
            EvaluationMetricDirection.LOWER_IS_BETTER,
        ),
        (
            "flow_peak_memory",
            max(memory for _, _, memory in rows),
            "MB",
            EvaluationMetricDirection.LOWER_IS_BETTER,
        ),
        (
            "flow_nonzero_peak_memory_stage_count",
            float(sum(memory > 0 for _, _, memory in rows)),
            "count",
            EvaluationMetricDirection.HIGHER_IS_BETTER,
        ),
    )
    return tuple(
        metric_record(
            metric_id,
            value,
            unit,
            EvaluationMetricCategory.COST,
            EvaluationMetricRole.REPORT,
            direction,
            sources,
        )
        for metric_id, value, unit, direction in values
    )


def metric_record(
    metric_id: str,
    value: float,
    unit: str,
    category: EvaluationMetricCategory,
    role: EvaluationMetricRole,
    direction: EvaluationMetricDirection,
    source_refs: tuple[str, ...],
    corner: str | None = None,
) -> TerminalEvaluationMetric:
    return TerminalEvaluationMetric(
        metric_id=metric_id,
        value=value,
        unit=unit,
        category=category,
        role=role,
        direction=direction,
        source_refs=source_refs,
        corner=corner,
    )


def required_nonnegative_metric(metrics: dict[str, float], metric_id: str) -> float:
    try:
        value = metrics[metric_id]
    except KeyError as exc:
        raise OptimizationObservationError("terminal evaluation metric is unavailable") from exc
    if value < 0:
        raise OptimizationObservationError("terminal evaluation metric is invalid")
    return value


def optional_nonnegative_metric(
    metrics: dict[str, float], metric_id: str
) -> float | None:
    value = metrics.get(metric_id)
    if value is not None and value < 0:
        raise OptimizationObservationError("terminal evaluation metric is invalid")
    return value
