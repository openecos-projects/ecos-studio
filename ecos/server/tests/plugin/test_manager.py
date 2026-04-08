import json
from pathlib import Path

import pytest

from ecos_server.plugin.services.manager import ManagerService


@pytest.fixture()
def tools_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".ecos" / "tools"
    d.mkdir(parents=True)
    return d


@pytest.fixture()
def manager(tools_dir: Path) -> ManagerService:
    return ManagerService(tools_dir=tools_dir)


def test_empty_manifest(manager: ManagerService) -> None:
    installed = manager.get_installed()
    assert installed == {}


def test_add_tool(manager: ManagerService, tools_dir: Path) -> None:
    manager.add_tool(
        name="yosys",
        version="0.61",
        path=str(tools_dir / "yosys" / "0.61"),
        sha256="abc123",
    )
    installed = manager.get_installed()
    assert "yosys" in installed
    assert installed["yosys"]["version"] == "0.61"
    assert installed["yosys"]["sha256"] == "abc123"
    assert "installed_at" in installed["yosys"]


def test_remove_tool(manager: ManagerService, tools_dir: Path) -> None:
    manager.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
    manager.remove_tool("yosys")
    assert manager.get_installed() == {}


def test_remove_nonexistent_tool(manager: ManagerService) -> None:
    manager.remove_tool("nonexistent")


def test_get_tool_path_found(manager: ManagerService, tools_dir: Path) -> None:
    tool_path = str(tools_dir / "yosys" / "0.61")
    manager.add_tool(name="yosys", version="0.61", path=tool_path, sha256="abc")
    assert manager.get_tool_path("yosys") == Path(tool_path)


def test_get_tool_path_not_found(manager: ManagerService) -> None:
    assert manager.get_tool_path("yosys") is None


def test_manifest_persists_to_disk(manager: ManagerService, tools_dir: Path) -> None:
    manager.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
    manifest_path = tools_dir / "manifest.json"
    assert manifest_path.exists()
    data = json.loads(manifest_path.read_text())
    assert data["schema_version"] == 1
    assert "yosys" in data["installed"]
