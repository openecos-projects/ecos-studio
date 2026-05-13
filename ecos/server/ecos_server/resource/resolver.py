#!/usr/bin/env python

from pathlib import Path

from .inventory import InventoryService


def resolve_tool(name: str) -> Path | None:
    """Resolve an executable for a managed Resource Manager tool."""
    if not name:
        return None
    entry = InventoryService().get_tool(name)
    if entry is None or not entry.active:
        return None
    executable = (Path(entry.path) / entry.executable).resolve()
    if executable.is_file() and executable.stat().st_mode & 0o111:
        return executable
    return None


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
