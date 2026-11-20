"""Development-only helpers for offline ECC research clients."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from ecos_agent.optimization.runtime import OptimizationRuntimeError


def ecc_cli_executable() -> Path:
    """Resolve the same external runtime override used by Studio."""
    override = os.environ.get("ECOS_ECC_BIN_DIR")
    if override:
        path = Path(override) / "ecc"
        if path.is_file() and os.access(path, os.X_OK):
            return path.resolve()
        raise OptimizationRuntimeError(f"ECC executable is unavailable in {override}")
    resolved = shutil.which("ecc")
    if resolved:
        path = Path(resolved).resolve()
        if path.is_file() and os.access(path, os.X_OK):
            return path
    repo_root = Path(__file__).resolve().parents[6]
    for relative in (
        "ecc/.venv/bin/ecc",
        "ecc/.venv/Scripts/ecc.exe",
        "ecc/dist/ecc/ecc",
    ):
        path = repo_root / relative
        if path.is_file() and os.access(path, os.X_OK):
            return path.resolve()
    raise OptimizationRuntimeError("ECC CLI executable is unavailable")
