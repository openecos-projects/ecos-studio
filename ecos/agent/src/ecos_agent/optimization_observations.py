"""Read fixed ECOS workspace artifacts into optimization observations."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.hashing import file_sha256
from ecos_agent.optimization_contracts import (
    ROUTABILITY_OBJECTIVE_ORDER,
    BudgetSnapshot,
    GateResult,
    SignoffGates,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization_controller import CandidateExecutionEvidence
from ecos_agent.optimization_ledger import build_optimization_artifact_manifest

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
_TERMINAL_FILES = (
    "home/flow.json",
    "home/parameters.json",
    "route_ecc/analysis/qor_metrics.json",
    "drc_ecc/analysis/qor_metrics.json",
    "sta_ecc/analysis/qor_metrics.json",
    "Harden_ecc/analysis/qor_metrics.json",
    "drc_ecc/checklist.json",
    "sta_ecc/checklist.json",
    "Harden_ecc/checklist.json",
)


class OptimizationObservationError(ValueError):
    """The frozen workspace evidence cannot form a trusted observation."""


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
    manifest = build_optimization_artifact_manifest(
        root,
        ("home/flow.json", "home/parameters.json", metrics_path),
    )
    return StageObservation(
        observation_id=f"stage-{canonical_stage.value}",
        stage=canonical_stage,
        evidence_manifest_sha256=manifest.manifest_sha256,
        metrics=metrics,
        budget=budget,
    )


def build_terminal_observation(workspace_root: Path) -> TerminalObservation:
    """Build the fixed routability terminal observation without running ECC."""
    root = _workspace_root(workspace_root)
    files = {path: _read_json(root, path) for path in _TERMINAL_FILES}
    flow = files["home/flow.json"]
    for stage in (ECCStepName.ROUTING, ECCStepName.DRC, ECCStepName.STA, ECCStepName.HARDEN):
        _require_successful_stage(flow, stage)
    route_metrics = _qor_metrics(files["route_ecc/analysis/qor_metrics.json"])
    terminal_metrics = {
        metric: _required_metric(route_metrics, metric.value) for metric in _TERMINAL_METRICS
    }
    harden_metrics = _qor_metrics(files["Harden_ecc/analysis/qor_metrics.json"])
    output_paths = _harden_output_paths(files["home/parameters.json"])
    complete_outputs = all(_is_nonempty_file(root, path) for path in output_paths)
    missing_artifacts = harden_metrics.get("harden_artifact_missing_count")
    harden_complete = complete_outputs and missing_artifacts == 0
    manifest_paths = (*_TERMINAL_FILES, *(path for path in output_paths if _is_file(root, path)))
    manifest = build_optimization_artifact_manifest(root, manifest_paths)
    return TerminalObservation(
        observation_id="terminal-Harden",
        evidence_manifest_sha256=manifest.manifest_sha256,
        evidence_valid=True,
        harden_artifacts_complete=harden_complete,
        signoff_gates=SignoffGates(
            drc_clean=_checklist_gate(files["drc_ecc/checklist.json"], "quality.drc.clean"),
            lvs_clean=GateResult.UNAVAILABLE,
            rcx_corner_coverage=GateResult.UNAVAILABLE,
            rcx_spef_parse_health=GateResult.UNAVAILABLE,
            sta_setup_closed=_checklist_gate(
                files["sta_ecc/checklist.json"], "quality.sta.setup_closed"
            ),
            sta_hold_closed=_checklist_gate(
                files["sta_ecc/checklist.json"], "quality.sta.hold_closed"
            ),
            mpc_minimum_area=_checklist_gate(
                files["Harden_ecc/checklist.json"], "quality.mpc.minimum_area"
            ),
            mpc_maximum_area=_checklist_gate(
                files["Harden_ecc/checklist.json"], "quality.mpc.maximum_area"
            ),
        ),
        metrics=terminal_metrics,
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
    parent_flow = _safe_file(parent, "home/flow.json")
    if file_sha256(parent_flow) != payload.get("parent_flow_sha256"):
        raise OptimizationObservationError("candidate parent flow does not match the baseline")
    return build_terminal_observation(candidate_root)


def _workspace_root(workspace_root: Path) -> Path:
    root = Path(workspace_root)
    if root.is_symlink() or not root.is_dir():
        raise OptimizationObservationError("workspace root is unavailable or unsafe")
    return root.resolve()


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


def _harden_output_paths(parameters: dict[str, Any]) -> tuple[str, str, str]:
    design = parameters.get("Design")
    if not isinstance(design, str) or not _DESIGN_ID.fullmatch(design):
        raise OptimizationObservationError("workspace design identifier is invalid")
    prefix = f"Harden_ecc/output/{design}_Harden"
    return (f"{prefix}.gds", f"{prefix}.lef", f"{prefix}.lib")


def _checklist_gate(payload: dict[str, Any], gate_id: str) -> GateResult:
    if payload.get("status") != "ready" or not isinstance(payload.get("checklist"), list):
        raise OptimizationObservationError("workspace signoff checklist is invalid")
    matches = [item for item in payload["checklist"] if isinstance(item, dict) and item.get("id") == gate_id]
    if len(matches) != 1:
        return GateResult.UNAVAILABLE
    state = matches[0].get("state")
    if state == "pass":
        return GateResult.PASS
    if state in {"fail", "blocked"}:
        return GateResult.FAIL
    return GateResult.UNAVAILABLE
