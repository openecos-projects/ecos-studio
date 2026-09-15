"""Observation helpers for workspace parameter evidence."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import StageEvidenceFeature
from ecos_agent.optimization.metrics.extraction import OptimizationObservationError
from ecos_agent.workspace.parameters import (
    WorkspaceParametersError,
    _read_json,
    read_workspace_parameters as _read_workspace_parameters,
)

_DESIGN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")


def read_workspace_parameters(root: Path) -> tuple[str, dict[str, Any]]:
    try:
        return _read_workspace_parameters(root)
    except WorkspaceParametersError as exc:
        raise OptimizationObservationError(str(exc)) from exc


def harden_output_paths(parameters: dict[str, Any]) -> tuple[str, str, str]:
    design = parameters.get("design")
    if not isinstance(design, str) or not _DESIGN_ID.fullmatch(design):
        raise OptimizationObservationError("workspace design identifier is invalid")
    prefix = f"Harden_ecc/output/{design}_Harden"
    return (f"{prefix}.gds", f"{prefix}.lef", f"{prefix}.lib")


def floorplan_mode_state_evidence(
    root: Path, stage: ECCStepName,
) -> tuple[StageEvidenceFeature, ...]:
    relative_path = "config/floorplan_ecc.json"
    path = root / relative_path
    if stage != ECCStepName.POST_FLOORPLAN or not (path.exists() or path.is_symlink()):
        return ()
    try:
        builder = _read_json(root, relative_path).get("die_builder")
    except WorkspaceParametersError as exc:
        raise OptimizationObservationError(str(exc)) from exc
    mode = builder.get("mode") if isinstance(builder, dict) else None
    if mode not in ("die_util", "die_size"):
        return ()
    return (StageEvidenceFeature(
        feature_id="floorplan_die_util_mode",
        value=mode == "die_util",
        evidence_ref=relative_path,
        evidence_sha256=file_sha256(path),
    ),)


def mpc_configured(parameters: dict[str, Any]) -> bool:
    mpc = parameters.get("mpc")
    return isinstance(mpc, dict) and isinstance(mpc.get("core_template"), dict)


def placement_convergence_state_evidence(root: Path) -> tuple[StageEvidenceFeature, ...]:
    # Read the same incumbent evidence before and after choosing a planning stage.
    relative_path = "analysis/parameter_runtime_report.v2.json"
    path = root / relative_path
    if not (path.exists() or path.is_symlink()):
        return ()
    try:
        report = _read_json(root, relative_path)
    except WorkspaceParametersError as exc:
        raise OptimizationObservationError(str(exc)) from exc
    tool = report.get("tool")
    observation = report.get("observation")
    if (report.get("schema_version") != "tool.parameter_runtime_report.v2"
            or report.get("knob_id") != "place.target_overflow"
            or not isinstance(tool, dict) or tool.get("name") != "DREAMPlace"
            or not isinstance(observation, dict)):
        return ()
    value = observation.get("final_overflow")
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        return ()
    return (StageEvidenceFeature(
        feature_id="place_final_density_overflow", value=value,
        evidence_ref=relative_path, evidence_sha256=file_sha256(path),
    ),)
