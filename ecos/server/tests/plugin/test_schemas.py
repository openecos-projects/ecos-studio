from ecos_server.plugin.schemas import (
    InstallProgress,
    PlatformAsset,
    RegistryTool,
    RegistryToolVersion,
    ToolInfo,
    ToolRegistry,
    ToolStatus,
)


def test_tool_status_values() -> None:
    assert ToolStatus.available.value == "available"
    assert ToolStatus.installing.value == "installing"
    assert ToolStatus.installed.value == "installed"
    assert ToolStatus.update_available.value == "update_available"
    assert ToolStatus.uninstalling.value == "uninstalling"
    assert ToolStatus.error.value == "error"


def test_tool_info_defaults() -> None:
    info = ToolInfo(
        name="yosys",
        display_name="Yosys",
        description="RTL synthesis",
        category="synthesis",
    )
    assert info.status == ToolStatus.available
    assert info.installed_version is None
    assert info.available_versions == []
    assert info.install_path is None


def test_install_progress_model() -> None:
    progress = InstallProgress(
        tool="yosys",
        phase="downloading",
        progress=0.5,
        message="50% complete",
    )
    assert progress.tool == "yosys"
    assert progress.progress == 0.5


def test_platform_asset_model() -> None:
    asset = PlatformAsset(
        url="https://example.com/yosys.tar.gz",
        sha256="abc123",
        size=52428800,
    )
    assert asset.strip_prefix is None


def test_registry_tool_model() -> None:
    tool = RegistryTool(
        name="yosys",
        display_name="Yosys",
        description="RTL synthesis",
        category="synthesis",
        homepage="https://github.com/YosysHQ/yosys",
        versions=[
            RegistryToolVersion(
                version="0.61",
                platforms={
                    "linux-x86_64": PlatformAsset(
                        url="https://example.com/yosys.tar.gz",
                        sha256="abc123",
                        size=52428800,
                    )
                },
            )
        ],
    )
    assert tool.versions[0].requires == []


def test_tool_registry_model() -> None:
    registry = ToolRegistry(schema_version=1, tools=[])
    assert registry.tools == []
