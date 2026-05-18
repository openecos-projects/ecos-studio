import json
import threading
from pathlib import Path

import pytest

import ecos_server.resource.inventory as inventory_module
from ecos_server.resource.inventory import (
    InventoryService,
    PdkInventoryEntry,
    ResourceManifest,
    ToolInventoryEntry,
)


def test_default_manifest_path_uses_xdg_state_home(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    svc = InventoryService()
    assert svc.manifest_path == tmp_path / "state" / "ecos-studio" / "resources" / "manifest.json"
    assert ".ecos" not in str(svc.manifest_path)


def test_default_manifest_path_uses_xdg_default_when_env_empty(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(inventory_module.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("XDG_STATE_HOME", "")
    svc = InventoryService()
    assert (
        svc.manifest_path
        == tmp_path / ".local" / "state" / "ecos-studio" / "resources" / "manifest.json"
    )


def test_default_pdks_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    inventory = InventoryService(resource_manifest_path=tmp_path / "state" / "manifest.json")

    assert inventory.pdks_dir == tmp_path / "data" / "ecos-studio" / "pdks"


def test_add_managed_pdk_metadata(tmp_path: Path) -> None:
    inventory = InventoryService(resource_manifest_path=tmp_path / "resources" / "manifest.json")
    pdk_root = tmp_path / "pdks" / "ics55" / "1.01"
    pdk_root.mkdir(parents=True)

    entry = inventory.add_or_update_pdk(
        "ics55",
        name="ICSPROUT 55nm PDK",
        canonical_path=str(pdk_root),
        detected_files=["prtech", "IP"],
        detected_file_groups={"directories": ["IP", "prtech"], "files": []},
        version="1.01",
        sha256="3" * 64,
        source="registry",
        source_url="https://example.com/ics55.tar.gz",
        managed=True,
        active=True,
    )

    assert entry.id == "ics55"
    assert entry.version == "1.01"
    assert entry.sha256 == "3" * 64
    assert entry.source == "registry"
    assert entry.source_url == "https://example.com/ics55.tar.gz"
    assert entry.managed is True
    assert entry.active is True

    loaded = InventoryService(resource_manifest_path=inventory.manifest_path).get_pdk("ics55")
    assert loaded is not None
    assert loaded.version == "1.01"
    assert loaded.managed is True

    refreshed = inventory.add_or_update_pdk(
        "ics55",
        canonical_path=str(pdk_root),
        managed=False,
    )
    assert refreshed.version == "1.01"
    assert refreshed.sha256 == "3" * 64
    assert refreshed.source == "registry"
    assert refreshed.source_url == "https://example.com/ics55.tar.gz"
    assert refreshed.managed is False
    assert refreshed.active is True


@pytest.fixture
def temp_dirs(tmp_path: Path) -> tuple[Path, Path]:
    """Create temp resource manifest and legacy sentinel paths."""
    resource_manifest = tmp_path / "resources" / "manifest.json"
    tools_manifest = tmp_path / "tools" / "manifest.json"
    return resource_manifest, tools_manifest


@pytest.fixture
def inventory(temp_dirs: tuple[Path, Path]) -> InventoryService:
    resource_manifest, _tools_manifest = temp_dirs
    return InventoryService(resource_manifest_path=resource_manifest)


class TestManifestPersistence:
    """Positive: CRUD operations on local manifest.json."""

    def test_empty_manifest_on_init(self, inventory: InventoryService) -> None:
        tools = inventory.get_installed_tools()
        pdks = inventory.get_imported_pdks()
        assert tools == {}
        assert pdks == {}

    def test_add_tool_persists(self, inventory: InventoryService) -> None:
        inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
        )
        tools = inventory.get_installed_tools()
        assert "yosys" in tools
        assert "tool:yosys" in inventory._read_manifest().installed
        assert tools["yosys"].version == "0.61"
        assert tools["yosys"].path == "/tmp/tools/yosys/0.61"
        assert tools["yosys"].sha256 == "abc123"
        assert tools["yosys"].detected_executables == ["bin/yosys"]
        assert tools["yosys"].executable == "bin/yosys"
        assert tools["yosys"].active is True
        assert tools["yosys"].managed is True
        assert tools["yosys"].installed_at.endswith("Z")

    def test_manifest_file_uses_unified_installed_shape(self, inventory: InventoryService) -> None:
        inventory.add_tool(
            name="yosys",
            version="0.61",
            path="/tmp/tools/yosys/0.61",
            sha256="abc123",
            detected_executables=["bin/yosys"],
        )
        inventory.add_or_update_pdk(
            "ics55",
            name="ics55",
            canonical_path="/tmp/pdks/ics55",
            detected_files=["prtech", "IP", "libs.ref"],
        )

        data = json.loads(inventory.manifest_path.read_text(encoding="utf-8"))
        assert data["schema_version"] == 1
        assert data["resources_dir"] == str(inventory.manifest_path.parent)
        assert data["tools_dir"] == str(inventory.tools_dir)
        assert data["pdks_dir"] == str(inventory.pdks_dir)
        assert "tools" not in data
        assert "pdks" not in data
        assert "pdks" not in data["installed"]
        assert set(data["installed"]) == {"tool:yosys", "pdk:ics55"}
        assert data["installed"]["tool:yosys"]["type"] == "tool"
        assert data["installed"]["tool:yosys"]["executable"] == "bin/yosys"
        assert data["installed"]["pdk:ics55"]["type"] == "pdk"
        assert data["installed"]["pdk:ics55"]["pdk_id"] == "ics55"

    def test_add_and_read_tool(self, inventory: InventoryService) -> None:
        inventory.add_tool(name="openroad", version="2.0", path="/tmp/or", sha256="def456")
        entry = inventory.get_tool("openroad")
        assert entry is not None
        assert entry.version == "2.0"

    def test_remove_tool(self, inventory: InventoryService) -> None:
        inventory.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
        inventory.remove_tool("yosys")
        assert inventory.get_tool("yosys") is None
        assert "yosys" not in inventory.get_installed_tools()

    def test_remove_nonexistent_tool_does_not_error(self, inventory: InventoryService) -> None:
        inventory.remove_tool("nonexistent")

    def test_manifest_survives_reload(self, temp_dirs: tuple[Path, Path]) -> None:
        """Data persists across service instances using the same file."""
        resource_manifest, _tools_manifest = temp_dirs
        svc1 = InventoryService(resource_manifest_path=resource_manifest)
        svc1.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")

        svc2 = InventoryService(resource_manifest_path=resource_manifest)
        assert svc2.get_tool("yosys") is not None
        assert svc2.get_tool("yosys").version == "0.61"

    def test_concurrent_add_tool_preserves_all_entries(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manifest_path = tmp_path / "resources" / "manifest.json"
        services = [
            InventoryService(resource_manifest_path=manifest_path),
            InventoryService(resource_manifest_path=manifest_path),
        ]
        original_read = InventoryService._read_manifest
        read_count = 0
        read_lock = threading.Lock()
        second_read = threading.Event()

        def delayed_read(self):
            nonlocal read_count
            manifest = original_read(self)
            with read_lock:
                read_count += 1
                if read_count == 2:
                    second_read.set()
            second_read.wait(timeout=0.2)
            return manifest

        monkeypatch.setattr(InventoryService, "_read_manifest", delayed_read)

        threads = [
            threading.Thread(
                target=services[0].add_tool,
                kwargs={"name": "yosys", "version": "0.61", "path": "/tmp/y", "sha256": "abc"},
            ),
            threading.Thread(
                target=services[1].add_tool,
                kwargs={"name": "openroad", "version": "2.0", "path": "/tmp/or", "sha256": "def"},
            ),
        ]

        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=1)

        installed = InventoryService(resource_manifest_path=manifest_path).get_installed_tools()
        assert set(installed) == {"yosys", "openroad"}


class TestNoLegacyToolManifest:
    """Resource Manager inventory does not write legacy tools/manifest.json."""

    def test_add_tool_does_not_generate_legacy_manifest(
        self, inventory: InventoryService, temp_dirs: tuple[Path, Path]
    ) -> None:
        _resource_manifest, tools_manifest = temp_dirs
        inventory.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
        inventory.add_tool(name="openroad", version="2.0", path="/tmp/or", sha256="def")

        assert not tools_manifest.exists()

    def test_remove_tool_does_not_generate_legacy_manifest(
        self, inventory: InventoryService, temp_dirs: tuple[Path, Path]
    ) -> None:
        _resource_manifest, tools_manifest = temp_dirs
        inventory.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
        inventory.remove_tool("yosys")

        assert not tools_manifest.exists()


class TestPdkInventory:
    """Positive: PDK entries with canonical paths, detected files, etc."""

    def test_add_pdk_stores_all_fields(self, inventory: InventoryService) -> None:
        entry = inventory.add_or_update_pdk(
            "ics55",
            name="IC-S55",
            canonical_path="/home/user/pdks/ics55",
            detected_files=["libs.ref", "tech.lef"],
        )
        assert entry.id == "ics55"
        assert entry.name == "IC-S55"
        assert entry.canonical_path == "/home/user/pdks/ics55"
        assert entry.detected_files == ["libs.ref", "tech.lef"]
        assert entry.detected_file_groups["files"] == ["libs.ref", "tech.lef"]
        assert entry.imported_at.endswith("Z")
        assert entry.active is False
        assert entry.managed is False
        assert entry.health == "ok"

    def test_add_pdk_default_fields(self, inventory: InventoryService) -> None:
        entry = inventory.add_or_update_pdk("test", canonical_path="/tmp/test")
        assert entry.name == ""
        assert entry.detected_files == []
        assert entry.managed is False

    def test_get_imported_pdks(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a")
        inventory.add_or_update_pdk("b", canonical_path="/tmp/b")
        pdks = inventory.get_imported_pdks()
        assert len(pdks) == 2
        assert "a" in pdks
        assert "b" in pdks

    def test_get_single_pdk(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("ics55", canonical_path="/tmp/ics55")
        pdk = inventory.get_pdk("ics55")
        assert pdk is not None
        assert pdk.id == "ics55"

    def test_get_nonexistent_pdk(self, inventory: InventoryService) -> None:
        assert inventory.get_pdk("nope") is None

    def test_update_pdk_preserves_active(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("ics55", canonical_path="/tmp/ics55")
        inventory.set_pdk_active("ics55", True)

        # Update with new path keeps active state
        entry = inventory.add_or_update_pdk(
            "ics55", canonical_path="/tmp/newpath", detected_files=["a", "b"]
        )
        assert entry.active is True
        assert entry.canonical_path == "/tmp/newpath"
        assert entry.detected_files == ["a", "b"]

    def test_add_or_update_pdk_active_true_is_exclusive(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a", active=True)
        inventory.add_or_update_pdk("b", canonical_path="/tmp/b", active=True)

        assert inventory.get_pdk("a").active is False
        assert inventory.get_pdk("b").active is True
        assert inventory.get_active_pdk().id == "b"

    def test_add_or_update_pdk_can_clear_metadata(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk(
            "ics55",
            canonical_path="/tmp/managed",
            version="1.01",
            sha256="3" * 64,
            source="registry",
            source_url="https://example.com/ics55.tar.gz",
            managed=True,
        )

        entry = inventory.add_or_update_pdk(
            "ics55",
            canonical_path="/tmp/local",
            version="",
            sha256="",
            source="",
            source_url="",
            managed=False,
        )

        assert entry.version == ""
        assert entry.sha256 == ""
        assert entry.source == ""
        assert entry.source_url == ""
        assert entry.managed is False

    def test_remove_pdk(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("ics55", canonical_path="/tmp/ics55")
        inventory.remove_pdk("ics55")
        assert inventory.get_pdk("ics55") is None

    def test_set_pdk_active(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a")
        inventory.add_or_update_pdk("b", canonical_path="/tmp/b")
        inventory.set_pdk_active("a", True)

        assert inventory.get_pdk("a").active is True
        assert inventory.get_pdk("b").active is False

    def test_set_pdk_active_exclusive(self, inventory: InventoryService) -> None:
        """Only one PDK can be active at a time."""
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a")
        inventory.add_or_update_pdk("b", canonical_path="/tmp/b")
        inventory.set_pdk_active("a", True)
        inventory.set_pdk_active("b", True)

        assert inventory.get_pdk("a").active is False
        assert inventory.get_pdk("b").active is True

    def test_deactivate_pdk(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a")
        inventory.set_pdk_active("a", True)
        inventory.set_pdk_active("a", False)

        assert inventory.get_pdk("a").active is False
        assert inventory.get_active_pdk() is None

    def test_get_active_pdk(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a")
        inventory.add_or_update_pdk("b", canonical_path="/tmp/b")
        inventory.set_pdk_active("b", True)

        active = inventory.get_active_pdk()
        assert active is not None
        assert active.id == "b"

    def test_get_active_pdk_none(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("a", canonical_path="/tmp/a")
        assert inventory.get_active_pdk() is None

    def test_set_pdk_health(self, inventory: InventoryService) -> None:
        inventory.add_or_update_pdk("ics55", canonical_path="/tmp/ics55")
        inventory.set_pdk_health("ics55", "missing")
        assert inventory.get_pdk("ics55").health == "missing"

        inventory.set_pdk_health("ics55", "invalid")
        assert inventory.get_pdk("ics55").health == "invalid"


class TestInventoryNegative:
    """Negative tests per AC-2."""

    def test_corrupt_manifest_backed_up(self, inventory: InventoryService) -> None:
        """Corrupt manifest is preserved before recovery, not overwritten silently."""
        # Write valid data first so we know the file exists
        inventory.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")

        # Corrupt the file
        inventory.manifest_path.write_text("{this is not valid json [[[", encoding="utf-8")

        # Reading should not raise and should return empty data
        tools = inventory.get_installed_tools()
        assert tools == {}

        # Backup file should exist with corrupt content
        backup = inventory.manifest_path.with_suffix(".json.bak")
        assert backup.exists()
        corrupt = backup.read_text(encoding="utf-8")
        assert "this is not valid json" in corrupt

    def test_remove_pdk_does_not_delete_source(
        self, inventory: InventoryService, tmp_path: Path
    ) -> None:
        """Removing PDK inventory reference does not delete the source directory."""
        source_dir = tmp_path / "user_pdks" / "ics55"
        source_dir.mkdir(parents=True)
        (source_dir / "libs.ref").write_text("data")
        assert source_dir.exists()

        inventory.add_or_update_pdk("ics55", canonical_path=str(source_dir))
        inventory.remove_pdk("ics55")

        # Inventory reference is gone
        assert inventory.get_pdk("ics55") is None
        # Source directory still exists
        assert source_dir.exists()
        assert (source_dir / "libs.ref").exists()

    def test_no_production_files_required(self, tmp_path: Path) -> None:
        """Tests do not depend on production registry/manifest files."""
        rm = tmp_path / "manifest.json"
        tm = tmp_path / "tools" / "manifest.json"
        svc = InventoryService(resource_manifest_path=rm)

        # Service works without any pre-existing files
        svc.add_tool(name="test", version="1.0", path="/tmp/t", sha256="abc")
        assert svc.get_tool("test") is not None
        assert not tm.exists()

        # No files in the repo are touched
        assert not Path("tool-registry.json").exists()
        assert not Path("resource-registry.json").exists()

    def test_set_active_nonexistent_pdk_raises(self, inventory: InventoryService) -> None:
        with pytest.raises(KeyError, match="not found"):
            inventory.set_pdk_active("nonexistent", True)

    def test_set_health_nonexistent_pdk_raises(self, inventory: InventoryService) -> None:
        with pytest.raises(KeyError, match="not found"):
            inventory.set_pdk_health("nonexistent", "ok")


class TestResourceManifestModel:
    def test_default_manifest(self) -> None:
        m = ResourceManifest(resources_dir="/tmp/resources", tools_dir="/tmp/tools")
        assert m.schema_version == 1
        assert m.resources_dir == "/tmp/resources"
        assert m.tools_dir == "/tmp/tools"
        assert m.pdks_dir == ""
        assert m.installed == {}

    def test_manifest_with_tools(self) -> None:
        m = ResourceManifest(
            resources_dir="/tmp/resources",
            tools_dir="/tmp/tools",
            installed={
                "tool:yosys": ToolInventoryEntry(
                    type="tool",
                    name="yosys",
                    version="0.61",
                    path="/tmp/y",
                    installed_at="2026-05-11T00:00:00Z",
                    sha256="abc",
                    detected_executables=["bin/yosys"],
                    executable="bin/yosys",
                    active=True,
                    managed=True,
                )
            },
        )
        assert "tool:yosys" in m.installed
        tool = m.installed["tool:yosys"]
        assert isinstance(tool, ToolInventoryEntry)
        assert tool.detected_executables == ["bin/yosys"]
        assert tool.active is True
        assert tool.managed is True

    def test_manifest_with_pdks(self) -> None:
        m = ResourceManifest(
            resources_dir="/tmp/resources",
            tools_dir="/tmp/tools",
            installed={
                "pdk:ics55": PdkInventoryEntry(
                    type="pdk",
                    id="ics55",
                    name="IC-S55",
                    canonical_path="/tmp/ics55",
                    imported_at="2026-05-11T00:00:00Z",
                    active=True,
                )
            },
        )
        pdk = m.installed["pdk:ics55"]
        assert isinstance(pdk, PdkInventoryEntry)
        assert pdk.active is True
        assert pdk.managed is False
