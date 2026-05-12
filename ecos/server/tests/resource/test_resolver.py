from pathlib import Path

import pytest

from ecos_server.resource.inventory import InventoryService
from ecos_server.resource.resolver import resolve_active_pdk, resolve_tool


@pytest.fixture
def manifest_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    state_home = tmp_path / "state"
    monkeypatch.setenv("XDG_STATE_HOME", str(state_home))
    return state_home / "ecos-studio" / "resources" / "manifest.json"


def test_resolve_tool_returns_recorded_executable(manifest_path: Path, tmp_path: Path) -> None:
    tool_root = tmp_path / "tools" / "yosys" / "0.61"
    executable = tool_root / "bin" / "yosys"
    executable.parent.mkdir(parents=True)
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)

    inventory = InventoryService(resource_manifest_path=manifest_path)
    inventory.add_tool(
        name="yosys",
        version="0.61",
        path=str(tool_root),
        sha256="abc123",
        detected_executables=["bin/yosys"],
    )

    assert resolve_tool("yosys") == executable


def test_resolve_tool_ignores_non_executable_manifest_entry(
    manifest_path: Path, tmp_path: Path
) -> None:
    tool_root = tmp_path / "tools" / "yosys" / "0.61"
    executable = tool_root / "bin" / "yosys"
    executable.parent.mkdir(parents=True)
    executable.write_text("#!/bin/sh\n", encoding="utf-8")

    inventory = InventoryService(resource_manifest_path=manifest_path)
    inventory.add_tool(
        name="yosys",
        version="0.61",
        path=str(tool_root),
        sha256="abc123",
        detected_executables=["bin/yosys"],
    )

    assert resolve_tool("yosys") is None


def test_resolve_active_pdk_returns_active_matching_pdk(
    manifest_path: Path, tmp_path: Path
) -> None:
    pdk_root = tmp_path / "pdks" / "ics55"
    pdk_root.mkdir(parents=True)

    inventory = InventoryService(resource_manifest_path=manifest_path)
    inventory.add_or_update_pdk("ics55", canonical_path=str(pdk_root))
    inventory.set_pdk_active("ics55", True)

    assert resolve_active_pdk("ics55") == pdk_root.resolve()


def test_resolve_active_pdk_returns_none_for_missing_directory(
    manifest_path: Path, tmp_path: Path
) -> None:
    pdk_root = tmp_path / "pdks" / "ics55"

    inventory = InventoryService(resource_manifest_path=manifest_path)
    inventory.add_or_update_pdk("ics55", canonical_path=str(pdk_root))
    inventory.set_pdk_active("ics55", True)

    assert resolve_active_pdk("ics55") is None
