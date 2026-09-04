"""Build terminal metric records from validated workspace QoR values."""

from __future__ import annotations

import math

from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)

_GUI_DIMENSION_WEIGHTS = {
    "timing": 0.35,
    "power_integrity": 0.25,
    "routability_physical": 0.2,
    "area_cost": 0.1,
    "clock_robustness_dfm": 0.1,
    "runtime": 0.0,
}
_GUI_METRIC_FAIL_VALUES = {
    "drc_count": 10.0,
    "lvs_count": 10.0,
    "route_wirelength": 6000.0,
    "route_via_count": 2000.0,
    "cts_buffer_count": 20.0,
    "cts_buffer_area": 40.0,
    "clock_wirelength": 400000.0,
    "cts_clock_wirelength_max": 100000.0,
    "cts_clock_tree_max_level": 20.0,
    "die_area": 3000.0,
    "core_area": 2500.0,
    "core_utilization": 0.85,
    "synthesis_cell_area": 3000.0,
    "place_hpwl": 10000.0,
    "place_grwl": 12000.0,
    "place_flute_wirelength": 10000.0,
    "place_congestion_egr_overflow_total": 100.0,
    "place_congestion_egr_overflow_max": 20.0,
    "place_rudy_utilization_max": 1.0,
    "place_lutrudy_utilization_max": 1.0,
    "route_dr_total_violation_count": 50.0,
    "route_dr_total_patch_count": 100.0,
    "route_dr_total_wirelength": 6000.0,
    "route_dr_total_via_count": 2000.0,
    "route_la_total_overflow": 100.0,
    "rcx_missing_corner_count": 9.0,
    "sta_setup_wns": -0.2,
    "sta_setup_tns": -1.0,
    "sta_hold_wns": -0.2,
    "sta_hold_tns": -1.0,
    "sta_frequency_mhz": 100.0,
    "sta_setup_violation_count": 1.0,
    "sta_hold_violation_count": 1.0,
    "sta_missing_corner_count": 1.0,
    "harden_artifact_missing_count": 6.0,
}
_GUI_TIMING_METRICS = frozenset(
    {"sta_setup_wns", "sta_setup_tns", "sta_hold_wns", "sta_hold_tns"}
)
_GUI_PROJECT_ROLE_PRIORITY = {"final": 0, "gate": 1, "trend": 2, "none": 3}
_GUI_DIRECTIONS = frozenset(
    {"higher_is_better", "lower_is_better", "target_range", "trend_only"}
)
_GUI_STEP_ROLES = frozenset({"primary", "secondary", "detail", "hidden"})


class OptimizationObservationError(ValueError):
    """The frozen workspace evidence cannot form a trusted observation."""


def build_gui_overall_qor_metric(
    payloads_by_path: dict[str, dict[str, object]], qor_files: tuple[str, ...]
) -> tuple[TerminalEvaluationMetric, ...]:
    rows = [
        row
        for step_index, path in enumerate(qor_files)
        for row in _gui_qor_rows(payloads_by_path.get(path), path, step_index)
    ]
    selected = _gui_project_rows(rows)
    dimension_scores, contributing_paths = _gui_dimension_scores(selected)
    sources = tuple(path for path in qor_files if path in contributing_paths)
    if not sources:
        return ()
    weighted = sum(
        score * _GUI_DIMENSION_WEIGHTS[dimension]
        for dimension, score in dimension_scores.items()
        if _GUI_DIMENSION_WEIGHTS[dimension] > 0
    )
    return (
        metric_record(
            "gui_overall_qor_score",
            _gui_round(weighted),
            "score",
            EvaluationMetricCategory.QOR,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.HIGHER_IS_BETTER,
            sources,
        ),
    )


def _gui_project_rows(
    rows: list[dict[str, object]],
) -> tuple[dict[str, object], ...]:
    area_steps = [
        row["step_index"]
        for row in rows
        if row["dimension"] == "area_cost" and row["score_enabled"]
    ]
    area_step = max(area_steps, default=None)
    selected: dict[tuple[object, ...], dict[str, object]] = {}
    for row in rows:
        if row["project_role"] == "none" or (
            row["dimension"] == "area_cost" and row["step_index"] != area_step
        ):
            continue
        key = (row["metric_id"], row["scope"], row["corner"], row["corner_context"])
        current = selected.get(key)
        rank = (_GUI_PROJECT_ROLE_PRIORITY[row["project_role"]], -row["step_index"])
        if current is None or rank < (
            _GUI_PROJECT_ROLE_PRIORITY[current["project_role"]],
            -current["step_index"],
        ):
            selected[key] = row
    return tuple(selected.values())


def _gui_dimension_scores(
    rows: tuple[dict[str, object], ...],
) -> tuple[dict[str, float], set[str]]:
    scores: dict[str, list[float]] = {}
    contributing_paths: set[str] = set()
    for row in rows:
        score = _gui_record_score(row) if row["score_enabled"] else None
        if score is None:
            continue
        scores.setdefault(row["dimension"], []).append(score)
        if _GUI_DIMENSION_WEIGHTS[row["dimension"]] > 0:
            contributing_paths.add(row["path"])
    return (
        {
            dimension: _gui_round(sum(values) / len(values))
            for dimension, values in scores.items()
        },
        contributing_paths,
    )


def _gui_qor_rows(
    payload: dict[str, object] | None, path: str, step_index: int
) -> tuple[dict[str, object], ...]:
    if not payload or payload.get("schema_version") != 3:
        return ()
    metrics = payload.get("metrics")
    if not isinstance(metrics, list):
        return ()
    rows = []
    for metric in metrics:
        row = _gui_qor_row(metric, path, step_index)
        if row is not None:
            rows.append(row)
    return tuple(rows)


def _gui_qor_row(
    metric: object, path: str, step_index: int
) -> dict[str, object] | None:
    if not isinstance(metric, dict):
        return None
    metric_id = _gui_text(metric.get("id"))
    value = _gui_number(metric.get("value"))
    dimension = _gui_text(metric.get("category"))
    direction = _gui_text(metric.get("direction"))
    scope = _gui_text(metric.get("scope"))
    project_role = _gui_text(metric.get("project_role"))
    step_role = _gui_text(metric.get("step_role"))
    analysis_group = _gui_text(metric.get("analysis_group"))
    rating = metric.get("rating")
    corner = None if metric.get("corner") is None else _gui_text(metric.get("corner"))
    valid = (
        metric_id is not None
        and value is not None
        and dimension in _GUI_DIMENSION_WEIGHTS
        and direction in _GUI_DIRECTIONS
        and scope is not None
        and project_role in _GUI_PROJECT_ROLE_PRIORITY
        and step_role in _GUI_STEP_ROLES
        and analysis_group is not None
        and (metric.get("corner") is None or corner is not None)
        and _gui_rating(rating)
        and _gui_feature_source(metric.get("source"))
    )
    if not valid or not isinstance(rating, dict):
        return None
    return {
        "metric_id": metric_id,
        "value": value,
        "dimension": dimension,
        "direction": direction,
        "scope": scope,
        "corner": corner,
        "corner_context": _gui_corner_context(metric.get("corner_context")),
        "project_role": project_role,
        "score_enabled": rating["score"],
        "path": path,
        "step_index": step_index,
    }


def _gui_record_score(row: dict[str, object]) -> float | None:
    metric_id = row["metric_id"]
    value = row["value"]
    direction = row["direction"]
    if not isinstance(metric_id, str) or not isinstance(value, float):
        return None
    fail_value = _GUI_METRIC_FAIL_VALUES.get(metric_id)
    if fail_value is None:
        return None
    if metric_id in _GUI_TIMING_METRICS:
        return 100.0 if value >= 0 else _gui_clamp(100 * (value - fail_value) / -fail_value)
    if direction == "target_range" and metric_id == "core_utilization":
        if 0.45 <= value <= 0.7:
            return 100.0
        if value < 0.45:
            return _gui_clamp(100 * value / 0.45)
        return _gui_clamp(100 * (fail_value - value) / (fail_value - 0.7))
    if fail_value <= 0:
        return None
    if direction == "lower_is_better":
        return _gui_clamp(100 * (fail_value - value) / fail_value)
    if direction == "higher_is_better":
        return _gui_clamp(100 * value / fail_value)
    return None


def _gui_text(value: object) -> str | None:
    text = value.strip() if isinstance(value, str) else ""
    return text or None


def _gui_number(value: object) -> float | None:
    if type(value) in {int, float}:
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in {"n/a", "na"}:
            return None
        percent = text.endswith("%")
        try:
            number = float(text.replace(",", "").removesuffix("%"))
        except ValueError:
            return None
        if percent:
            number /= 100
    else:
        return None
    return number if math.isfinite(number) else None


def _gui_rating(value: object) -> bool:
    return isinstance(value, dict) and all(
        type(value.get(key)) is bool for key in ("gate", "score", "trend")
    )


def _gui_feature_source(value: object) -> bool:
    if not isinstance(value, dict) or _gui_text(value.get("kind")) != "feature":
        return False
    path = _gui_text(value.get("path"))
    selector = value.get("selector")
    return bool(
        path
        and path.startswith("feature/")
        and ".." not in path.split("/")
        and isinstance(selector, str)
        and (not selector or selector.startswith("/"))
    )


def _gui_corner_context(value: object) -> tuple[object, ...]:
    if not isinstance(value, dict):
        return ()
    return (
        _gui_text(value.get("configured_role")),
        _gui_text(value.get("process_corner")),
        _gui_number(value.get("voltage_v")),
        _gui_number(value.get("temperature_c")),
        _gui_text(value.get("rc_corner")),
    )


def _gui_clamp(value: float) -> float:
    return max(0.0, min(100.0, value))


def _gui_round(value: float) -> float:
    return math.floor(value * 10 + 0.5) / 10


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


def build_area_metrics(
    metrics_by_path: dict[str, dict[str, float]],
) -> tuple[TerminalEvaluationMetric, ...]:
    specifications = (
        ("Synthesis_yosys/analysis/qor_metrics.json", "synthesis_cell_area"),
        ("Floorplan_ecc/analysis/qor_metrics.json", "die_area"),
        ("Floorplan_ecc/analysis/qor_metrics.json", "core_area"),
    )
    return tuple(
        metric_record(
            metric_id,
            required_nonnegative_metric(metrics_by_path[path], metric_id),
            "um^2",
            EvaluationMetricCategory.PPA,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.LOWER_IS_BETTER,
            (path,),
        )
        for path, metric_id in specifications
    )


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
