"""Read fixed ECOS workspace artifacts into optimization observations."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import (
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    BudgetSnapshot,
    GateResult,
    SignoffGates,
    StageEvidenceFeature,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization.execution import CandidateExecutionEvidence
from ecos_agent.optimization.ledger import build_optimization_artifact_manifest
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.metrics.extraction import (
    OptimizationObservationError,
    build_cost_metrics,
    build_eligibility_metrics,
    build_routing_diagnostics,
    metric_record,
    required_nonnegative_metric,
)

_METRIC_ID = re.compile(r"^[a-z][a-z0-9_]*$")
_DESIGN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_STAGE_DIRECTORIES = {
    ECCStepName.SYNTHESIS: "Synthesis_yosys",
    ECCStepName.FLOORPLAN: "Floorplan_ecc",
    ECCStepName.NETLIST_OPT: "fixFanout_ecc",
    ECCStepName.PLACEMENT: "place_dreamplace",
    ECCStepName.CTS: "CTS_ecc",
    ECCStepName.LEGALIZATION: "legalization_dreamplace",
    ECCStepName.ROUTING: "route_ecc",
    ECCStepName.DRC: "drc_ecc",
    ECCStepName.LVS: "lvs_ecc",
    ECCStepName.FILLER: "filler_ecc",
    ECCStepName.RCX: "RCX_ecc",
    ECCStepName.STA: "sta_ecc",
    ECCStepName.HARDEN: "Harden_ecc",
}
_TERMINAL_METRICS = ROUTABILITY_OBJECTIVE_ORDER
_TERMINAL_FLOW_STEPS = (
    ECCStepName.PLACEMENT,
    ECCStepName.CTS,
    ECCStepName.LEGALIZATION,
    ECCStepName.ROUTING,
    ECCStepName.DRC,
    ECCStepName.LVS,
    ECCStepName.FILLER,
    ECCStepName.RCX,
    ECCStepName.STA,
    ECCStepName.HARDEN,
)
_TERMINAL_QOR_FILES = tuple(
    f"{_STAGE_DIRECTORIES[stage]}/analysis/qor_metrics.json"
    for stage in _TERMINAL_FLOW_STEPS
)
_REQUIRED_TERMINAL_QOR_FILES = tuple(
    f"{_STAGE_DIRECTORIES[stage]}/analysis/qor_metrics.json"
    for stage in (
        ECCStepName.ROUTING,
        ECCStepName.DRC,
        ECCStepName.LVS,
        ECCStepName.RCX,
        ECCStepName.STA,
        ECCStepName.HARDEN,
    )
)
_TERMINAL_FILES = (
    "home/flow.json",
    "home/parameters.json",
    *_REQUIRED_TERMINAL_QOR_FILES,
    "drc_ecc/checklist.json",
    "lvs_ecc/checklist.json",
    "RCX_ecc/checklist.json",
    "sta_ecc/checklist.json",
    "sta_ecc/feature/sta.step.json",
    "Harden_ecc/checklist.json",
)


def build_stage_observation(
    workspace_root: Path,
    stage: ECCStepName | str,
    *,
    budget: BudgetSnapshot,
) -> StageObservation:
    """Build one checkpoint from a successful canonical stage only."""
    root = _workspace_root(workspace_root)
    canonical_stage = _canonical_stage(stage)
    flow = _read_json(root, "home/flow.json")
    _require_successful_stage(flow, canonical_stage)
    _read_json(root, "home/parameters.json")
    metrics_path = f"{_STAGE_DIRECTORIES[canonical_stage]}/analysis/qor_metrics.json"
    metrics_payload = _read_json(root, metrics_path)
    metrics = _qor_metrics(metrics_payload)
    hotspots_path = f"{_STAGE_DIRECTORIES[canonical_stage]}/analysis/qor_hotspots.json"
    state_evidence = _hotspot_state_evidence(root, hotspots_path)
    manifest_paths = (
        "home/flow.json",
        "home/parameters.json",
        metrics_path,
        *((hotspots_path,) if state_evidence else ()),
    )
    manifest = build_optimization_artifact_manifest(
        root,
        manifest_paths,
    )
    return StageObservation(
        observation_id=f"stage-{canonical_stage.value}",
        stage=canonical_stage,
        evidence_manifest_sha256=manifest.manifest_sha256,
        metrics=metrics,
        state_evidence=state_evidence,
        budget=budget,
    )


def _hotspot_state_evidence(
    root: Path, relative_path: str
) -> tuple[StageEvidenceFeature, ...]:
    if not _is_file(root, relative_path):
        return ()
    payload = _read_json(root, relative_path)
    hotspots = payload.get("hotspots")
    if payload.get("schema_version") != 3 or not isinstance(hotspots, list):
        raise OptimizationObservationError("stage hotspot evidence is invalid")
    artifact_sha256 = file_sha256(_workspace_path(root, relative_path))
    features = []
    seen_metrics: dict[str, int] = {}
    for index, hotspot in enumerate(hotspots):
        if not isinstance(hotspot, dict):
            raise OptimizationObservationError("stage hotspot evidence is invalid")
        try:
            metric_id = hotspot.get("metric_id")
            occurrence = seen_metrics.get(metric_id, 0)
            seen_metrics[metric_id] = occurrence + 1
            evidence_ref = f"{relative_path}#/hotspots/{index}"
            features.append(
                StageEvidenceFeature(
                    feature_id=(
                        metric_id
                        if occurrence == 0
                        else f"{metric_id}_hotspot_{occurrence}"
                    ),
                    value=hotspot.get("value"),
                    evidence_sha256=canonical_sha256(
                        {
                            "artifact_sha256": artifact_sha256,
                            "evidence_ref": evidence_ref,
                            "hotspot": hotspot,
                        }
                    ),
                    evidence_ref=evidence_ref,
                )
            )
        except ValueError as exc:
            raise OptimizationObservationError(
                "stage hotspot evidence is invalid"
            ) from exc
    return tuple(features)


def build_terminal_observation(workspace_root: Path) -> TerminalObservation:
    """Build the fixed routability terminal observation without running ECC."""
    root = _workspace_root(workspace_root)
    files = {path: _read_json(root, path) for path in _TERMINAL_FILES}
    flow = files["home/flow.json"]
    for stage in _TERMINAL_FLOW_STEPS:
        _require_successful_stage(flow, stage)
    metrics_by_path = {
        path: _qor_metrics(files[path]) for path in _REQUIRED_TERMINAL_QOR_FILES
    }
    for path in _TERMINAL_QOR_FILES:
        if path not in metrics_by_path and _is_file(root, path):
            metrics_by_path[path] = _qor_metrics(_read_json(root, path))
    route_metrics = metrics_by_path["route_ecc/analysis/qor_metrics.json"]
    terminal_metrics = {
        metric: _required_metric(route_metrics, metric.value) for metric in _TERMINAL_METRICS
    }
    sta_metrics = metrics_by_path["sta_ecc/analysis/qor_metrics.json"]
    timing_guardrail = {
        metric: _required_timing_metric(sta_metrics, metric.value)
        for metric in TIMING_GUARDRAIL_ORDER
    }
    harden_metrics = metrics_by_path["Harden_ecc/analysis/qor_metrics.json"]
    output_paths = _harden_output_paths(files["home/parameters.json"])
    mpc_configured = _mpc_configured(files["home/parameters.json"])
    complete_outputs = all(_is_nonempty_file(root, path) for path in output_paths)
    missing_artifacts = harden_metrics.get("harden_artifact_missing_count")
    harden_complete = complete_outputs and missing_artifacts == 0
    evaluation, corner_ids, corner_paths, evaluation_complete = _evaluation_metrics(
        root, metrics_by_path, files["sta_ecc/feature/sta.step.json"]
    )
    manifest_paths = (
        *_TERMINAL_FILES,
        *(path for path in metrics_by_path if path not in _REQUIRED_TERMINAL_QOR_FILES),
        *corner_paths,
        *(path for path in output_paths if _is_file(root, path)),
    )
    manifest = build_optimization_artifact_manifest(root, manifest_paths)
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id="terminal-Harden",
        evidence_manifest_sha256=manifest.manifest_sha256,
        evidence_valid=True,
        harden_artifacts_complete=harden_complete,
        signoff_gates=SignoffGates(
            drc_clean=_checklist_gate(files["drc_ecc/checklist.json"], "quality.drc.clean"),
            lvs_clean=_checklist_gate(files["lvs_ecc/checklist.json"], "quality.lvs.clean"),
            rcx_corner_coverage=_checklist_gate(
                files["RCX_ecc/checklist.json"], "quality.rcx.corner_coverage"
            ),
            rcx_spef_parse_health=_checklist_gate(
                files["RCX_ecc/checklist.json"], "quality.rcx.spef_parse_health"
            ),
            sta_setup_closed=_checklist_gate(
                files["sta_ecc/checklist.json"], "quality.sta.setup_closed"
            ),
            sta_hold_closed=_checklist_gate(
                files["sta_ecc/checklist.json"], "quality.sta.hold_closed"
            ),
            mpc_minimum_area=_optional_mpc_gate(
                files["Harden_ecc/checklist.json"], "quality.mpc.minimum_area", mpc_configured
            ),
            mpc_maximum_area=_optional_mpc_gate(
                files["Harden_ecc/checklist.json"], "quality.mpc.maximum_area", mpc_configured
            ),
        ),
        metrics=terminal_metrics,
        timing_guardrail=timing_guardrail,
        evaluation_metrics=evaluation,
        evaluation_metrics_complete=evaluation_complete,
        sta_corner_ids=corner_ids,
        sta_corner_set_sha256=canonical_sha256({"corners": corner_ids}),
    )


def build_candidate_terminal_observation(
    parent_workspace_root: Path,
    evidence: CandidateExecutionEvidence,
) -> TerminalObservation:
    """Build terminal evidence only from a verified child-workspace receipt."""
    parent = _workspace_root(parent_workspace_root)
    candidate_path = _workspace_path(parent, evidence.candidate_root_ref)
    manifest_path = _workspace_path(parent, evidence.candidate_manifest_ref)
    try:
        candidate_root = candidate_path.resolve(strict=True)
        resolved_manifest = manifest_path.resolve(strict=True)
        candidate_root.relative_to(parent)
        resolved_manifest.relative_to(candidate_root)
    except (OSError, ValueError) as exc:
        raise OptimizationObservationError(
            "candidate evidence path is unsafe or unavailable"
        ) from exc
    if not candidate_root.is_dir() or not resolved_manifest.is_file():
        raise OptimizationObservationError("candidate evidence path is unsafe or unavailable")
    if file_sha256(resolved_manifest) != evidence.candidate_manifest_sha256:
        raise OptimizationObservationError("candidate manifest hash does not match the receipt")
    payload = _read_json(parent, evidence.candidate_manifest_ref)
    if (
        payload.get("schema") != "ecc.workspace.candidate_workspace.v1"
        or payload.get("candidate_root_ref") != evidence.candidate_root_ref
    ):
        raise OptimizationObservationError("candidate workspace manifest is invalid")
    if file_sha256(candidate_root / "home/flow.json") != payload.get("candidate_flow_sha256"):
        raise OptimizationObservationError("candidate flow does not match its manifest")
    artifacts = payload.get("artifacts", {})
    if not isinstance(artifacts, dict):
        raise OptimizationObservationError("candidate artifact manifest is invalid")
    parameters = _read_json(candidate_root, "home/parameters.json")
    harden_refs = dict(
        zip(
            ("harden_gds", "harden_lef", "harden_lib"),
            _harden_output_paths(parameters),
            strict=True,
        )
    )
    if any(
        not isinstance(artifacts.get(key), dict)
        or artifacts[key].get("ref") != ref
        for key, ref in harden_refs.items()
    ):
        raise OptimizationObservationError("candidate Harden artifact manifest is incomplete")
    for item in artifacts.values():
        if not isinstance(item, dict) or not isinstance(item.get("ref"), str):
            raise OptimizationObservationError("candidate artifact manifest is invalid")
        artifact_path = candidate_root / item["ref"]
        try:
            artifact_path.resolve(strict=True).relative_to(candidate_root)
        except (OSError, ValueError) as exc:
            raise OptimizationObservationError("candidate artifact path is unsafe") from exc
        expected_hash = item.get("sha256")
        if not isinstance(expected_hash, str) or file_sha256(artifact_path) != expected_hash:
            raise OptimizationObservationError("candidate artifact hash does not match manifest")
    contract = (evidence.target_step, evidence.end_step, evidence.execution_scope)
    if any(value is not None for value in contract):
        if contract != (
            payload.get("target_step"),
            payload.get("end_step"),
            payload.get("execution_scope"),
        ):
            raise OptimizationObservationError(
                "candidate execution contract is not bound to manifest"
            )
    parent_flow = _candidate_parent_flow(parent, payload.get("parent_candidate_root_ref"))
    if file_sha256(parent_flow) != payload.get("parent_flow_sha256"):
        raise OptimizationObservationError("candidate parent flow does not match its manifest")
    return build_terminal_observation(candidate_root)


def _evaluation_metrics(
    root: Path,
    metrics_by_path: dict[str, dict[str, float]],
    sta_step: dict[str, Any],
) -> tuple[tuple[TerminalEvaluationMetric, ...], tuple[str, ...], tuple[str, ...], bool]:
    corner_metrics, ppa_metrics, corner_ids, corner_paths, complete = _sta_corner_metrics(
        root, metrics_by_path["sta_ecc/analysis/qor_metrics.json"], sta_step
    )
    routing_metrics, routing_complete = build_routing_diagnostics(
        metrics_by_path["route_ecc/analysis/qor_metrics.json"]
    )
    cost_metrics, cost_complete = build_cost_metrics(metrics_by_path, _TERMINAL_QOR_FILES)
    metrics = (
        *build_eligibility_metrics(metrics_by_path),
        *routing_metrics,
        *cost_metrics,
        *ppa_metrics,
        *corner_metrics,
    )
    return tuple(metrics), corner_ids, corner_paths, complete and routing_complete and cost_complete


def _sta_corner_metrics(
    root: Path, sta_metrics: dict[str, float], sta_step: dict[str, Any]
) -> tuple[
    tuple[TerminalEvaluationMetric, ...],
    tuple[TerminalEvaluationMetric, ...],
    tuple[str, ...],
    tuple[str, ...],
    bool,
]:
    rows, evidence_paths = _read_sta_corner_rows(root)
    discovered_ids = tuple(row["corner"] for row in rows)
    corner_ids = _configured_sta_corner_ids(sta_step)
    expected = int(required_nonnegative_metric(sta_metrics, "sta_expected_corner_count"))
    if expected != len(corner_ids) or set(discovered_ids) != set(corner_ids):
        raise OptimizationObservationError(
            "terminal STA corner evidence does not match configured corners"
        )
    complete = all(row["power"] is not None for row in rows)
    corner_metrics = tuple(
        metric
        for row in rows
        for metric in _corner_metric_records(row)
    )
    ppa_metrics, ppa_complete = _ppa_metric_records(rows, complete)
    return corner_metrics, ppa_metrics, corner_ids, evidence_paths, complete and ppa_complete


def _configured_sta_corner_ids(sta_step: dict[str, Any]) -> tuple[str, ...]:
    try:
        corners = sta_step["sta"]["signoff_metrics"]["corners"]
        values = tuple(item["sta_corner"] for item in corners)
    except (KeyError, TypeError) as exc:
        raise OptimizationObservationError("terminal STA corner configuration is invalid") from exc
    if not values:
        raise OptimizationObservationError("terminal STA corner configuration is invalid")
    for value in values:
        parts = value.split("/") if isinstance(value, str) else ()
        if len(parts) != 2 or any(not _DESIGN_ID.fullmatch(part) for part in parts):
            raise OptimizationObservationError("terminal STA corner configuration is invalid")
    ordered = tuple(sorted(set(values)))
    if len(ordered) != len(values):
        raise OptimizationObservationError("terminal STA corner configuration is invalid")
    return ordered


def _read_sta_corner_rows(
    root: Path,
) -> tuple[tuple[dict[str, Any], ...], tuple[str, ...]]:
    feature_root = root / "sta_ecc/feature"
    if not feature_root.is_dir() or feature_root.is_symlink():
        return (), ()
    rows: list[dict[str, Any]] = []
    paths: list[str] = []
    for process_dir in sorted(feature_root.iterdir()):
        if not process_dir.is_dir() or process_dir.is_symlink():
            continue
        for rc_dir in sorted(process_dir.iterdir()):
            if not rc_dir.is_dir() or rc_dir.is_symlink():
                continue
            corner = f"{process_dir.name}/{rc_dir.name}"
            qor_ref = f"sta_ecc/feature/{corner}/qor_summary.json"
            if not _is_file(root, qor_ref):
                continue
            power_ref = f"sta_ecc/feature/{corner}/power_summary.json"
            power = _read_json(root, power_ref) if _is_file(root, power_ref) else None
            rows.append({"corner": corner, "qor": _read_json(root, qor_ref), "power": power})
            paths.extend((qor_ref, power_ref) if power is not None else (qor_ref,))
    return tuple(rows), tuple(paths)


def _corner_metric_records(row: dict[str, Any]) -> tuple[TerminalEvaluationMetric, ...]:
    corner = row["corner"]
    qor = row["qor"]
    qor_ref = f"sta_ecc/feature/{corner}/qor_summary.json"
    records = [
        _corner_metric(qor, ("summary", "setup", "wns"), "sta_setup_wns", "ns", corner, qor_ref),
        _corner_metric(qor, ("summary", "setup", "tns"), "sta_setup_tns", "ns", corner, qor_ref),
        _corner_metric(
            qor,
            ("summary", "setup", "nvp"),
            "sta_setup_violation_count",
            "count",
            corner,
            qor_ref,
        ),
        _corner_metric(
            qor,
            ("summary", "setup", "frequency_mhz"),
            "sta_frequency",
            "MHz",
            corner,
            qor_ref,
        ),
        _corner_metric(qor, ("summary", "hold", "wns"), "sta_hold_wns", "ns", corner, qor_ref),
        _corner_metric(qor, ("summary", "hold", "tns"), "sta_hold_tns", "ns", corner, qor_ref),
        _corner_metric(
            qor,
            ("summary", "hold", "nvp"),
            "sta_hold_violation_count",
            "count",
            corner,
            qor_ref,
        ),
    ]
    power = row["power"]
    if power is not None:
        power_ref = f"sta_ecc/feature/{corner}/power_summary.json"
        for source_id, metric_id in (
            ("internal_uw", "sta_internal_power"),
            ("switching_uw", "sta_switching_power"),
            ("dynamic_uw", "sta_dynamic_power"),
            ("leakage_uw", "sta_leakage_power"),
        ):
            records.append(
                metric_record(
                    metric_id,
                    _required_payload_number(power, (source_id,), nonnegative=True),
                    "uW",
                    EvaluationMetricCategory.CORNER_ROBUSTNESS,
                    EvaluationMetricRole.REPORT,
                    EvaluationMetricDirection.LOWER_IS_BETTER,
                    (power_ref,),
                    corner,
                )
            )
    return tuple(records)


def _ppa_metric_records(
    rows: tuple[dict[str, Any], ...], complete: bool
) -> tuple[tuple[TerminalEvaluationMetric, ...], bool]:
    typical = next((row for row in rows if row["corner"] == "TYP_25/TYPICAL"), None)
    if typical is None or typical["power"] is None:
        return (), False
    qor_ref = "sta_ecc/feature/TYP_25/TYPICAL/qor_summary.json"
    records = [
        metric_record(
            "sta_standard_cell_area",
            _required_payload_number(
                typical["qor"], ("design_statistics", "cella"), nonnegative=True
            ),
            "um^2",
            EvaluationMetricCategory.PPA,
            EvaluationMetricRole.REPORT,
            EvaluationMetricDirection.LOWER_IS_BETTER,
            (qor_ref,),
        ),
        _power_summary_metric(typical, "dynamic_uw", "sta_typical_dynamic_power"),
        _power_summary_metric(typical, "leakage_uw", "sta_typical_leakage_power"),
    ]
    if complete:
        records.extend(
            (
                _worst_power_metric(rows, "dynamic_uw", "sta_worst_dynamic_power"),
                _worst_power_metric(rows, "leakage_uw", "sta_worst_leakage_power"),
            )
        )
    return tuple(records), complete


def _power_summary_metric(
    row: dict[str, Any], source_id: str, metric_id: str
) -> TerminalEvaluationMetric:
    corner = row["corner"]
    return metric_record(
        metric_id,
        _required_payload_number(row["power"], (source_id,), nonnegative=True),
        "uW",
        EvaluationMetricCategory.PPA,
        EvaluationMetricRole.REPORT,
        EvaluationMetricDirection.LOWER_IS_BETTER,
        (f"sta_ecc/feature/{corner}/power_summary.json",),
        corner,
    )


def _worst_power_metric(
    rows: tuple[dict[str, Any], ...], source_id: str, metric_id: str
) -> TerminalEvaluationMetric:
    worst = max(
        rows,
        key=lambda row: _required_payload_number(row["power"], (source_id,), nonnegative=True),
    )
    metric = _power_summary_metric(worst, source_id, metric_id)
    return metric.model_copy(update={"corner": worst["corner"]})


def _corner_metric(
    payload: dict[str, Any],
    path: tuple[str, ...],
    metric_id: str,
    unit: str,
    corner: str,
    source_ref: str,
) -> TerminalEvaluationMetric:
    direction = (
        EvaluationMetricDirection.HIGHER_IS_BETTER
        if metric_id
        in {
            "sta_setup_wns",
            "sta_setup_tns",
            "sta_hold_wns",
            "sta_hold_tns",
            "sta_frequency",
        }
        else EvaluationMetricDirection.LOWER_IS_BETTER
    )
    return metric_record(
        metric_id,
        _required_payload_number(
            payload,
            path,
            nonnegative=metric_id
            in {"sta_setup_violation_count", "sta_hold_violation_count", "sta_frequency"},
        ),
        unit,
        EvaluationMetricCategory.CORNER_ROBUSTNESS,
        EvaluationMetricRole.REPORT,
        direction,
        (source_ref,),
        corner,
    )


def _required_payload_number(
    payload: dict[str, Any], path: tuple[str, ...], *, nonnegative: bool = False
) -> float:
    value: object = payload
    for key in path:
        if not isinstance(value, dict):
            raise OptimizationObservationError("terminal metric payload is invalid")
        value = value.get(key)
    if type(value) not in {int, float} or not math.isfinite(float(value)):
        raise OptimizationObservationError("terminal metric payload is invalid")
    number = float(value)
    if nonnegative and number < 0:
        raise OptimizationObservationError("terminal metric payload is invalid")
    return number


def _workspace_root(workspace_root: Path) -> Path:
    root = Path(workspace_root)
    if root.is_symlink() or not root.is_dir():
        raise OptimizationObservationError("workspace root is unavailable or unsafe")
    return root.resolve()


def _candidate_parent_flow(parent: Path, candidate_root_ref: object) -> Path:
    if candidate_root_ref is None:
        return _safe_file(parent, "home/flow.json")
    if not isinstance(candidate_root_ref, str):
        raise OptimizationObservationError("candidate parent workspace reference is invalid")
    parts = Path(candidate_root_ref).parts
    if len(parts) != 3 or parts[:2] != (".agent", "candidates") or not parts[2]:
        raise OptimizationObservationError("candidate parent workspace reference is invalid")
    return _safe_file(parent, f"{candidate_root_ref}/home/flow.json")


def _canonical_stage(stage: ECCStepName | str) -> ECCStepName:
    try:
        return ECCStepName(stage)
    except ValueError as exc:
        raise OptimizationObservationError("stage is not canonical") from exc


def _read_json(root: Path, relative_path: str) -> dict[str, Any]:
    path = _safe_file(root, relative_path)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OptimizationObservationError("workspace evidence JSON is invalid") from exc
    if not isinstance(value, dict):
        raise OptimizationObservationError("workspace evidence JSON must be an object")
    return value


def _safe_file(root: Path, relative_path: str) -> Path:
    path = _workspace_path(root, relative_path)
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise OptimizationObservationError("workspace evidence path is unsafe or unavailable") from exc
    if path.is_symlink() or not resolved.is_file():
        raise OptimizationObservationError("workspace evidence path is unsafe or unavailable")
    return resolved


def _is_file(root: Path, relative_path: str) -> bool:
    path = _workspace_path(root, relative_path)
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        if path.exists():
            raise OptimizationObservationError("workspace evidence path is unsafe or unavailable") from exc
        return False
    return resolved.is_file()


def _is_nonempty_file(root: Path, relative_path: str) -> bool:
    return _is_file(root, relative_path) and (root / relative_path).stat().st_size > 0


def _workspace_path(root: Path, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise OptimizationObservationError("workspace evidence path is unsafe or unavailable")
    path = root
    for part in relative.parts:
        path /= part
        if path.is_symlink():
            raise OptimizationObservationError("workspace evidence path is unsafe or unavailable")
    return path


def _require_successful_stage(flow: dict[str, Any], stage: ECCStepName) -> None:
    steps = flow.get("steps")
    if not isinstance(steps, list):
        raise OptimizationObservationError("workspace flow is invalid")
    matches = [item for item in steps if isinstance(item, dict) and item.get("name") == stage.value]
    if len(matches) != 1:
        raise OptimizationObservationError("workspace flow does not contain one canonical stage")
    if matches[0].get("state") != "Success":
        raise OptimizationObservationError("workspace stage is not successful")


def _qor_metrics(payload: dict[str, Any]) -> dict[str, float]:
    if payload.get("status") != "success" or not isinstance(payload.get("metrics"), list):
        raise OptimizationObservationError("workspace QoR evidence is not successful")
    values: dict[str, float] = {}
    for item in payload["metrics"]:
        if not isinstance(item, dict):
            raise OptimizationObservationError("workspace QoR metric is invalid")
        metric_id, value = item.get("id"), item.get("value")
        if (
            not isinstance(metric_id, str)
            or not _METRIC_ID.fullmatch(metric_id)
            or type(value) not in {int, float}
            or not math.isfinite(float(value))
            or metric_id in values
        ):
            raise OptimizationObservationError("workspace QoR metric is invalid")
        values[metric_id] = float(value)
    if not values:
        raise OptimizationObservationError("workspace QoR evidence has no numeric metrics")
    return values


def _required_metric(metrics: dict[str, float], metric_id: str) -> float:
    try:
        value = metrics[metric_id]
    except KeyError as exc:
        raise OptimizationObservationError("terminal QoR objective metric is unavailable") from exc
    if value < 0:
        raise OptimizationObservationError("terminal QoR objective metric is invalid")
    return value


def _required_timing_metric(metrics: dict[str, float], metric_id: str) -> float:
    try:
        return metrics[metric_id]
    except KeyError as exc:
        raise OptimizationObservationError(
            "terminal timing guardrail metric is unavailable"
        ) from exc


def _harden_output_paths(parameters: dict[str, Any]) -> tuple[str, str, str]:
    design = parameters.get("Design")
    if not isinstance(design, str) or not _DESIGN_ID.fullmatch(design):
        raise OptimizationObservationError("workspace design identifier is invalid")
    prefix = f"Harden_ecc/output/{design}_Harden"
    return (f"{prefix}.gds", f"{prefix}.lef", f"{prefix}.lib")


def _checklist_gate(payload: dict[str, Any], gate_id: str) -> GateResult:
    if payload.get("status") not in {"ready", "blocked"} or not isinstance(
        payload.get("checklist"), list
    ):
        raise OptimizationObservationError("workspace signoff checklist is invalid")
    matches = [item for item in payload["checklist"] if isinstance(item, dict) and item.get("id") == gate_id]
    if len(matches) != 1:
        return GateResult.UNAVAILABLE
    state = matches[0].get("state")
    if state == "pass":
        return GateResult.PASS
    if state in {"fail", "failed", "blocked"}:
        return GateResult.FAIL
    return GateResult.UNAVAILABLE


def _optional_mpc_gate(
    payload: dict[str, Any], gate_id: str, configured: bool
) -> GateResult:
    if not configured:
        return GateResult.NOT_APPLICABLE
    return _checklist_gate(payload, gate_id)


def _mpc_configured(parameters: dict[str, Any]) -> bool:
    mpc = parameters.get("MPC")
    return isinstance(mpc, dict) and isinstance(mpc.get("core_template"), dict)
