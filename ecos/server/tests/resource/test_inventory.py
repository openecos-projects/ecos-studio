import json
from pathlib import Path

import pytest

from ecos_server.resource.inventory import (
    InventoryService,
    PdkInventoryEntry,
    ResourceManifest,
    ToolInventoryEntry,
)


@pytest.fixture
def temp_dirs(tmp_path: Path) -> tuple[Path, Path]:
    """Create temp resource and tools manifest paths."""
    resource_manifest = tmp_path / "resources" / "manifest.json"
    tools_manifest = tmp_path / "tools" / "manifest.json"
    return resource_manifest, tools_manifest


@pytest.fixture
def inventory(temp_dirs: tuple[Path, Path]) -> InventoryService:
    resource_manifest, tools_manifest = temp_dirs
    return InventoryService(
        resource_manifest_path=resource_manifest,
        tools_manifest_path=tools_manifest,
    )


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
        )
        tools = inventory.get_installed_tools()
        assert "yosys" in tools
        assert tools["yosys"].version == "0.61"
        assert tools["yosys"].path == "/tmp/tools/yosys/0.61"
        assert tools["yosys"].sha256 == "abc123"
        assert tools["yosys"].installed_at.endswith("Z")

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
        resource_manifest, tools_manifest = temp_dirs
        svc1 = InventoryService(resource_manifest_path=resource_manifest, tools_manifest_path=tools_manifest)
        svc1.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")

        svc2 = InventoryService(resource_manifest_path=resource_manifest, tools_manifest_path=tools_manifest)
        assert svc2.get_tool("yosys") is not None
        assert svc2.get_tool("yosys").version == "0.61"


class TestLegacyToolManifest:
    """Positive: tool entries generate compatibility tools/manifest.json."""

    def test_generates_legacy_manifest(self, inventory: InventoryService, temp_dirs: tuple[Path, Path]) -> None:
        _resource_manifest, tools_manifest = temp_dirs
        inventory.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
        inventory.add_tool(name="openroad", version="2.0", path="/tmp/or", sha256="def")

        assert tools_manifest.exists()
        legacy = json.loads(tools_manifest.read_text())
        assert legacy["schema_version"] == 1
        assert "yosys" in legacy["installed"]
        assert "openroad" in legacy["installed"]
        assert legacy["installed"]["yosys"]["version"] == "0.61"

    def test_legacy_manifest_updated_on_remove(self, inventory: InventoryService, temp_dirs: tuple[Path, Path]) -> None:
        _resource_manifest, tools_manifest = temp_dirs
        inventory.add_tool(name="yosys", version="0.61", path="/tmp/y", sha256="abc")
        inventory.remove_tool("yosys")

        legacy = json.loads(tools_manifest.read_text())
        assert "yosys" not in legacy["installed"]

    def test_legacy_manifest_created_with_parent_dirs(
        self, tmp_path: Path
    ) -> None:
        """Tools manifest dirs are created if they don't exist."""
        rm = tmp_path / "res" / "manifest.json"
        tm = tmp_path / "deep" / "nested" / "tools" / "manifest.json"
        svc = InventoryService(resource_manifest_path=rm, tools_manifest_path=tm)
        svc.add_tool(name="test", version="1.0", path="/tmp/t", sha256="abc")
        assert tm.exists()


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

    def test_remove_pdk_does_not_delete_source(self, inventory: InventoryService, tmp_path: Path) -> None:
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
        tm = tmp_path / "tools.json"
        svc = InventoryService(resource_manifest_path=rm, tools_manifest_path=tm)

        # Service works without any pre-existing files
        svc.add_tool(name="test", version="1.0", path="/tmp/t", sha256="abc")
        assert svc.get_tool("test") is not None

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
        m = ResourceManifest()
        assert m.schema_version == 1
        assert m.tools == {}
        assert m.pdks == {}

    def test_manifest_with_tools(self) -> None:
        m = ResourceManifest(
            tools={
                "yosys": ToolInventoryEntry(
                    name="yosys",
                    version="0.61",
                    path="/tmp/y",
                    installed_at="2026-05-11T00:00:00Z",
                    sha256="abc",
                )
            }
        )
        assert "yosys" in m.tools

    def test_manifest_with_pdks(self) -> None:
        m = ResourceManifest(
            pdks={
                "ics55": PdkInventoryEntry(
                    id="ics55",
                    name="IC-S55",
                    canonical_path="/tmp/ics55",
                    imported_at="2026-05-11T00:00:00Z",
                    active=True,
                )
            }
        )
        assert m.pdks["ics55"].active is True
        assert m.pdks["ics55"].managed is False
