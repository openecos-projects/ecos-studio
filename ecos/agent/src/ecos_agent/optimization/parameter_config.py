"""Observation helpers for workspace parameter evidence."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ecos_agent.optimization.metrics.extraction import OptimizationObservationError
from ecos_agent.workspace.parameters import (
    WorkspaceParametersError,
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


def mpc_configured(parameters: dict[str, Any]) -> bool:
    mpc = parameters.get("mpc")
    return isinstance(mpc, dict) and isinstance(mpc.get("core_template"), dict)
