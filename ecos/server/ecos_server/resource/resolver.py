#!/usr/bin/env python

import os
from collections.abc import Iterable, Mapping
from pathlib import Path

from .inventory import InventoryService


def _resolve_tool_entry(name: str):
    if not name:
        return None
    entry = InventoryService().get_tool(name)
    if entry is None or not entry.active:
        return None
    executable = (Path(entry.path) / entry.executable).resolve()
    if executable.is_file() and executable.stat().st_mode & 0o111:
        return entry, executable
    return None


def resolve_tool(name: str) -> Path | None:
    """Resolve an executable for a managed Resource Manager tool."""
    resolved = _resolve_tool_entry(name)
    if resolved is None:
        return None
    _entry, executable = resolved
    return executable


def resolve_tool_environment(
    names: Iterable[str], base_env: Mapping[str, str] | None = None
) -> dict[str, str]:
    """Build an environment that exposes active Resource Manager tools."""
    env = dict(base_env) if base_env is not None else os.environ.copy()
    for name in names:
        resolved = _resolve_tool_entry(name)
        if resolved is None:
            continue
        entry, executable = resolved
        bin_dir = str(executable.parent)
        path_parts = [part for part in env.get("PATH", "").split(os.pathsep) if part]
        path_parts = [part for part in path_parts if part != bin_dir]
        env["PATH"] = os.pathsep.join([bin_dir, *path_parts])
        if name.lower() == "yosys":
            env["CHIPCOMPILER_OSS_CAD_DIR"] = str(Path(entry.path).resolve())
    return env


def resolve_active_pdk(pdk_id: str | None = None) -> Path | None:
    """Resolve the active imported PDK root from Resource Manager inventory."""
    entry = InventoryService().get_active_pdk()
    if entry is None:
        return None
    if pdk_id and entry.id.lower() != pdk_id.lower():
        return None
    if entry.health in {"missing", "invalid"}:
        return None
    root = Path(entry.canonical_path).resolve()
    if not root.is_dir():
        return None
    return root
