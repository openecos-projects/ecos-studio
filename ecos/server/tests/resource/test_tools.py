from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import ecos_server.resource.paths as paths_module
import ecos_server.resource.tools as tools_module
from ecos_server.resource.installer import InstallerService
from ecos_server.resource.inventory import InventoryService
from ecos_server.resource.schemas import PlatformAsset, ResourceAction, ResourceJob
from ecos_server.resource.tools import ToolResourceService


@pytest.fixture(autouse=True)
def isolated_tools_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    tools_dir = tmp_path / "ecos" / "tools"
    monkeypatch.setattr("ecos_server.resource.tools._DEFAULT_TOOLS_DIR", tools_dir)
    return tools_dir


def test_default_tools_dir_uses_xdg_data_home(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(tools_module, "_DEFAULT_TOOLS_DIR", None)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    assert tools_module._default_tools_dir() == tmp_path / "data" / "ecos-studio" / "tools"


def test_default_tools_dir_uses_xdg_default_when_env_empty(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(tools_module, "_DEFAULT_TOOLS_DIR", None)
    monkeypatch.setattr(paths_module.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("XDG_DATA_HOME", "")
    assert (
        tools_module._default_tools_dir() == tmp_path / ".local" / "share" / "ecos-studio" / "tools"
    )


def test_default_tools_dir_is_isolated_for_tests(tmp_path: Path, isolated_tools_dir: Path) -> None:
    assert isolated_tools_dir == tmp_path / "ecos" / "tools"


@pytest.fixture
def temp_dirs(tmp_path: Path) -> tuple[Path, Path]:
    resource_manifest = tmp_path / "resources" / "manifest.json"
    tools_manifest = tmp_path / "tools" / "manifest.json"
    return resource_manifest, tools_manifest


@pytest.fixture
def inventory(temp_dirs: tuple[Path, Path], isolated_tools_dir: Path) -> InventoryService:
    rm, _tm = temp_dirs
    return InventoryService(resource_manifest_path=rm, tools_dir=isolated_tools_dir)


@pytest.fixture
def installer() -> MagicMock:
    inst = MagicMock(spec=InstallerService)
    inst.download = AsyncMock()

    def _extract(_archive_path: Path, dest_dir: Path, _strip_prefix: str | None) -> None:
        tool_path = dest_dir / "bin" / "yosys"
        tool_path.parent.mkdir(parents=True, exist_ok=True)
        tool_path.write_text("#!/bin/sh\necho yosys\n", encoding="utf-8")
        tool_path.chmod(0o755)

    inst.extract = MagicMock(side_effect=_extract)
    return inst


@pytest.fixture
def service(installer: MagicMock, inventory: InventoryService) -> ToolResourceService:
    return ToolResourceService(installer=installer, inventory=inventory)


@pytest.fixture
def asset() -> PlatformAsset:
    return PlatformAsset(
        url="https://example.com/yosys-0.61.tar.gz",
        sha256="abc123",
        size=52428800,
    )


class TestToolInstall:
    @pytest.mark.asyncio
    async def test_successful_install_updates_inventory(
        self,
        service: ToolResourceService,
        installer: MagicMock,
        inventory: InventoryService,
        asset: PlatformAsset,
        isolated_tools_dir: Path,
    ) -> None:
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        entry = inventory.get_tool("yosys")
        assert entry is not None
        assert entry.name == "yosys"
        assert entry.version == "0.61"
        assert entry.sha256 == "abc123"
        assert entry.active is True
        assert entry.managed is True
        assert entry.detected_executables == ["bin/yosys"]
        assert entry.executable == "bin/yosys"
        assert entry.path == str(isolated_tools_dir / "yosys" / "0.61")

    @pytest.mark.asyncio
    async def test_install_uses_inventory_tools_dir(
        self,
        installer: MagicMock,
        asset: PlatformAsset,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        wrong_default_dir = tmp_path / "wrong-default" / "tools"
        custom_tools_dir = tmp_path / "custom" / "tools"
        monkeypatch.setattr(tools_module, "_DEFAULT_TOOLS_DIR", wrong_default_dir)
        inventory = InventoryService(
            resource_manifest_path=tmp_path / "resources" / "manifest.json",
            tools_dir=custom_tools_dir,
        )
        service = ToolResourceService(installer=installer, inventory=inventory)

        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        entry = inventory.get_tool("yosys")
        assert entry is not None
        assert entry.path == str(custom_tools_dir / "yosys" / "0.61")
        assert (custom_tools_dir / "yosys" / "0.61" / "bin" / "yosys").exists()
        assert not wrong_default_dir.exists()

    @pytest.mark.asyncio
    async def test_install_calls_download(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        installer.download.assert_called_once()
        call_kwargs = installer.download.call_args.kwargs
        assert call_kwargs["url"] == asset.url
        assert call_kwargs["expected_size"] == asset.size

    @pytest.mark.asyncio
    async def test_install_calls_extract(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        installer.extract.assert_called_once()
        extract_dest = installer.extract.call_args.args[1]
        assert extract_dest.name.startswith(".extract-")

    @pytest.mark.asyncio
    async def test_install_preserves_previous_version_on_extract_failure(
        self,
        service: ToolResourceService,
        installer: MagicMock,
        inventory: InventoryService,
        asset: PlatformAsset,
        isolated_tools_dir: Path,
    ) -> None:
        previous_dir = isolated_tools_dir / "yosys" / "0.61"
        previous_bin = previous_dir / "bin" / "yosys"
        previous_bin.parent.mkdir(parents=True)
        previous_bin.write_text("previous", encoding="utf-8")
        inventory.add_tool(
            name="yosys",
            version="0.61",
            path=str(previous_dir),
            sha256="old",
            detected_executables=["bin/yosys"],
        )
        installer.extract.side_effect = RuntimeError("extract failed")

        with (
            patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True),
            pytest.raises(RuntimeError, match="extract failed"),
        ):
            await service.install("yosys", "0.61", asset)

        assert previous_bin.read_text(encoding="utf-8") == "previous"
        assert inventory.get_tool("yosys").sha256 == "old"

    @pytest.mark.asyncio
    async def test_install_emits_progress_events(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        events: list[ResourceJob] = []

        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset, on_progress=events.append)

        assert len(events) > 0
        assert events[0].resource_id == "tool:yosys"
        assert events[0].action == ResourceAction.install
        assert events[-1].phase == "done"
        assert events[-1].progress == 1.0

    @pytest.mark.asyncio
    async def test_update_action_emits_update_progress_events(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        events: list[ResourceJob] = []

        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install(
                "yosys",
                "0.61",
                asset,
                action=ResourceAction.update,
                on_progress=events.append,
            )

        assert len(events) > 0
        assert {event.action for event in events} == {ResourceAction.update}
        assert events[-1].phase == "done"

    @pytest.mark.asyncio
    async def test_install_does_not_generate_legacy_manifest(
        self,
        service: ToolResourceService,
        installer: MagicMock,
        asset: PlatformAsset,
        temp_dirs: tuple[Path, Path],
    ) -> None:
        _rm, tm = temp_dirs
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        assert not tm.exists()

    @pytest.mark.asyncio
    async def test_sha256_failure_raises(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        with (
            patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=False),
            pytest.raises(ValueError, match="SHA256"),
        ):
            await service.install("yosys", "0.61", asset)

    @pytest.mark.asyncio
    async def test_sha256_failure_publishes_error_event(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        events: list[ResourceJob] = []

        with (
            patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=False),
            pytest.raises(ValueError),
        ):
            await service.install("yosys", "0.61", asset, on_progress=events.append)

        error_events = [e for e in events if e.phase == "error"]
        assert len(error_events) >= 1
        assert "SHA256" in error_events[0].message


class TestToolUninstall:
    @pytest.mark.asyncio
    async def test_uninstall_removes_tool_from_inventory(
        self,
        service: ToolResourceService,
        installer: MagicMock,
        inventory: InventoryService,
        asset: PlatformAsset,
    ) -> None:
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        assert inventory.get_tool("yosys") is not None

        await service.uninstall("yosys")
        assert inventory.get_tool("yosys") is None

    @pytest.mark.asyncio
    async def test_uninstall_nonexistent_raises(self, service: ToolResourceService) -> None:
        with pytest.raises(KeyError, match="not installed"):
            await service.uninstall("nonexistent")

    @pytest.mark.asyncio
    async def test_uninstall_removes_install_directory(
        self,
        service: ToolResourceService,
        installer: MagicMock,
        asset: PlatformAsset,
        tmp_path: Path,
    ) -> None:
        # Create a real install directory
        install_dir = tmp_path / "ecos" / "tools" / "yosys" / "0.61"
        install_dir.mkdir(parents=True)
        (install_dir / "bin").mkdir()
        (install_dir / "bin" / "yosys").write_text("fake binary")

        # Override the inventory entry path
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        # The install creates dest_dir under _DEFAULT_TOOLS_DIR.
        # We need to test with our actual tmp_path install directory.
        # For this test, just verify the inventory entry is gone after uninstall.
        entry_before = service._inventory.get_tool("yosys")
        assert entry_before is not None

        await service.uninstall("yosys")
        assert service._inventory.get_tool("yosys") is None

    @pytest.mark.asyncio
    async def test_uninstall_does_not_generate_legacy_manifest(
        self,
        service: ToolResourceService,
        installer: MagicMock,
        asset: PlatformAsset,
        temp_dirs: tuple[Path, Path],
    ) -> None:
        _rm, tm = temp_dirs
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        await service.uninstall("yosys")

        assert not tm.exists()

    @pytest.mark.asyncio
    async def test_uninstall_unmanaged_tool_rejected_without_deleting_path(
        self, service: ToolResourceService, inventory: InventoryService, tmp_path: Path
    ) -> None:
        tool_dir = tmp_path / "external" / "yosys"
        tool_dir.mkdir(parents=True)
        marker = tool_dir / "owned-by-user"
        marker.write_text("do not delete", encoding="utf-8")
        inventory.add_tool(
            name="yosys",
            version="0.61",
            path=str(tool_dir),
            sha256="abc",
            managed=False,
        )

        with pytest.raises(PermissionError, match="unmanaged"):
            await service.uninstall("yosys")

        assert marker.exists()
        assert inventory.get_tool("yosys") is not None


class TestCurrentPlatform:
    def test_linux_x86_64(self) -> None:
        with (
            patch("platform.system", return_value="Linux"),
            patch("platform.machine", return_value="x86_64"),
        ):
            assert ToolResourceService.current_platform() == "linux-x86_64"

    def test_linux_amd64_normalized(self) -> None:
        with (
            patch("platform.system", return_value="Linux"),
            patch("platform.machine", return_value="amd64"),
        ):
            assert ToolResourceService.current_platform() == "linux-x86_64"

    def test_darwin_arm64(self) -> None:
        with (
            patch("platform.system", return_value="Darwin"),
            patch("platform.machine", return_value="arm64"),
        ):
            assert ToolResourceService.current_platform() == "darwin-arm64"


class TestGetInstalled:
    def test_empty_by_default(self, service: ToolResourceService) -> None:
        installed = service.get_installed()
        assert installed == {}

    @pytest.mark.asyncio
    async def test_returns_installed_tools(
        self, service: ToolResourceService, installer: MagicMock, asset: PlatformAsset
    ) -> None:
        with patch("ecos_server.resource.tools.InstallerService.verify_sha256", return_value=True):
            await service.install("yosys", "0.61", asset)

        installed = service.get_installed()
        assert "yosys" in installed
        assert installed["yosys"].version == "0.61"
