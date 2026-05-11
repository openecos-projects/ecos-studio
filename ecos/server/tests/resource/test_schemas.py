import pytest
from pydantic import ValidationError

from ecos_server.resource.schemas import (
    ResourceAction,
    ResourceInfo,
    ResourceJob,
    ResourceList,
    ResourceStatus,
    ResourceType,
)


class TestResourceType:
    def test_valid_types(self) -> None:
        assert ResourceType.tool == "tool"
        assert ResourceType.pdk == "pdk"

    def test_type_is_enum(self) -> None:
        assert isinstance(ResourceType.tool, str)
        assert ResourceType("tool") == ResourceType.tool


class TestResourceStatus:
    def test_valid_statuses(self) -> None:
        assert ResourceStatus.available == "available"
        assert ResourceStatus.installing == "installing"
        assert ResourceStatus.installed == "installed"
        assert ResourceStatus.update_available == "update_available"
        assert ResourceStatus.error == "error"
        assert ResourceStatus.missing == "missing"
        assert ResourceStatus.invalid == "invalid"

    def test_active_is_not_a_status(self) -> None:
        """active must remain a separate boolean, not a ResourceStatus value."""
        status_values = [s.value for s in ResourceStatus]
        assert "active" not in status_values


class TestResourceAction:
    def test_valid_actions(self) -> None:
        assert ResourceAction.install == "install"
        assert ResourceAction.uninstall == "uninstall"
        assert ResourceAction.validate == "validate"
        assert ResourceAction.activate == "activate"
        assert ResourceAction.remove_reference == "remove_reference"


class TestResourceJob:
    def test_install_job(self) -> None:
        job = ResourceJob(
            resource_id="tool:yosys",
            action=ResourceAction.install,
            phase="downloading",
            progress=0.5,
            message="Downloading yosys...",
        )
        assert job.resource_id == "tool:yosys"
        assert job.action == ResourceAction.install
        assert job.phase == "downloading"
        assert job.progress == 0.5
        assert job.message == "Downloading yosys..."

    def test_validate_job(self) -> None:
        job = ResourceJob(
            resource_id="pdk:ics55",
            action=ResourceAction.validate,
            phase="scanning",
            progress=0.3,
            message="Scanning PDK files...",
        )
        assert job.resource_id == "pdk:ics55"
        assert job.action == ResourceAction.validate

    def test_activate_job(self) -> None:
        job = ResourceJob(
            resource_id="pdk:ics55",
            action=ResourceAction.activate,
            phase="activating",
            progress=0.8,
            message="Setting active PDK...",
        )
        assert job.action == ResourceAction.activate

    def test_remove_reference_job(self) -> None:
        job = ResourceJob(
            resource_id="pdk:ics55",
            action=ResourceAction.remove_reference,
            phase="removing",
            progress=0.5,
            message="Removing reference...",
        )
        assert job.action == ResourceAction.remove_reference

    def test_defaults(self) -> None:
        job = ResourceJob(
            resource_id="tool:test",
            action=ResourceAction.install,
            phase="init",
        )
        assert job.progress == 0.0
        assert job.message == ""

    def test_rejects_unknown_action(self) -> None:
        with pytest.raises(ValidationError):
            ResourceJob(resource_id="t:1", action="unknown_action", phase="init")

    def test_serializes_to_json(self) -> None:
        job = ResourceJob(
            resource_id="pdk:ics55",
            action=ResourceAction.validate,
            phase="done",
            progress=1.0,
        )
        data = job.model_dump()
        assert data["resource_id"] == "pdk:ics55"
        assert data["action"] == "validate"
        assert data["phase"] == "done"
        assert data["progress"] == 1.0


class TestResourceInfoTool:
    """Positive tests: ResourceInfo accepts tool rows per AC-1."""

    def test_available_tool(self) -> None:
        info = ResourceInfo(
            id="tool:yosys",
            type=ResourceType.tool,
            display_name="Yosys",
            description="RTL synthesis",
            category="synthesis",
            status=ResourceStatus.available,
            available_versions=["0.61", "0.60"],
            actions=[ResourceAction.install],
        )
        assert info.id == "tool:yosys"
        assert info.type == ResourceType.tool
        assert info.status == ResourceStatus.available
        assert info.active is False
        assert info.installed_version is None
        assert info.available_versions == ["0.61", "0.60"]
        assert ResourceAction.install in info.actions

    def test_installed_tool(self) -> None:
        info = ResourceInfo(
            id="tool:yosys",
            type=ResourceType.tool,
            display_name="Yosys",
            description="RTL synthesis",
            category="synthesis",
            status=ResourceStatus.installed,
            installed_version="0.61",
            available_versions=["0.61", "0.60"],
            install_path="/home/user/.ecos/tools/yosys/0.61",
            actions=[ResourceAction.uninstall],
        )
        assert info.status == ResourceStatus.installed
        assert info.installed_version == "0.61"
        assert info.install_path == "/home/user/.ecos/tools/yosys/0.61"
        assert ResourceAction.uninstall in info.actions

    def test_tool_with_update(self) -> None:
        info = ResourceInfo(
            id="tool:yosys",
            type=ResourceType.tool,
            display_name="Yosys",
            description="RTL synthesis",
            category="synthesis",
            status=ResourceStatus.update_available,
            installed_version="0.60",
            available_versions=["0.61", "0.60"],
            install_path="/home/user/.ecos/tools/yosys/0.60",
            actions=[ResourceAction.install, ResourceAction.uninstall],
        )
        assert info.status == ResourceStatus.update_available
        assert info.installed_version == "0.60"

    def test_installing_tool(self) -> None:
        info = ResourceInfo(
            id="tool:yosys",
            type=ResourceType.tool,
            display_name="Yosys",
            description="",
            category="",
            status=ResourceStatus.installing,
            available_versions=["0.61"],
        )
        assert info.status == ResourceStatus.installing


class TestResourceInfoPdk:
    """Positive tests: ResourceInfo accepts PDK rows per AC-1."""

    def test_installed_pdk(self) -> None:
        info = ResourceInfo(
            id="pdk:ics55",
            type=ResourceType.pdk,
            display_name="IC-S55",
            description="IC-S55 PDK",
            category="pdk",
            status=ResourceStatus.installed,
            active=True,
            health="ok",
            canonical_path="/home/user/pdks/ics55",
            actions=[ResourceAction.validate, ResourceAction.remove_reference],
        )
        assert info.id == "pdk:ics55"
        assert info.type == ResourceType.pdk
        assert info.status == ResourceStatus.installed
        assert info.active is True
        assert info.health == "ok"
        assert info.canonical_path == "/home/user/pdks/ics55"
        assert ResourceAction.validate in info.actions
        assert ResourceAction.remove_reference in info.actions

    def test_missing_pdk(self) -> None:
        info = ResourceInfo(
            id="pdk:ics55",
            type=ResourceType.pdk,
            display_name="IC-S55",
            status=ResourceStatus.missing,
            health="missing",
            canonical_path="/home/user/pdks/ics55",
            actions=[ResourceAction.remove_reference],
        )
        assert info.status == ResourceStatus.missing
        assert info.active is False

    def test_invalid_pdk(self) -> None:
        info = ResourceInfo(
            id="pdk:ics55",
            type=ResourceType.pdk,
            display_name="IC-S55",
            status=ResourceStatus.invalid,
            health="invalid",
            canonical_path="/home/user/pdks/ics55",
            actions=[ResourceAction.validate, ResourceAction.remove_reference],
        )
        assert info.status == ResourceStatus.invalid

    def test_pdk_never_advertises_uninstall(self) -> None:
        """Local PDKs are not managed payloads, so uninstall must not appear."""
        info = ResourceInfo(
            id="pdk:ics55",
            type=ResourceType.pdk,
            display_name="IC-S55",
            status=ResourceStatus.installed,
            active=True,
            canonical_path="/home/user/pdks/ics55",
            actions=[ResourceAction.validate, ResourceAction.remove_reference],
        )
        assert ResourceAction.uninstall not in info.actions

    def test_pdk_with_metadata(self) -> None:
        info = ResourceInfo(
            id="pdk:ics55",
            type=ResourceType.pdk,
            display_name="IC-S55",
            status=ResourceStatus.installed,
            metadata={"detected_files": ["libs.ref", "tech.lef"], "imported_at": "2026-05-11T10:00:00Z"},
        )
        assert info.metadata["detected_files"] == ["libs.ref", "tech.lef"]


class TestResourceInfoValidation:
    """Negative tests: Pydantic rejects invalid inputs per AC-1."""

    def test_rejects_unknown_type(self) -> None:
        with pytest.raises(ValidationError):
            ResourceInfo(
                id="res:1",
                type="unknown_type",  # not tool or pdk
                display_name="Test",
            )

    def test_rejects_unknown_status(self) -> None:
        with pytest.raises(ValidationError):
            ResourceInfo(
                id="tool:test",
                type=ResourceType.tool,
                display_name="Test",
                status="unknown_status",  # not a valid ResourceStatus
            )

    def test_rejects_active_as_status_string(self) -> None:
        with pytest.raises(ValidationError):
            ResourceInfo(
                id="pdk:test",
                type=ResourceType.pdk,
                display_name="Test",
                status="active",  # active is a bool, not a status
            )

    def test_active_is_bool_not_status(self) -> None:
        """active must remain a separate boolean field, not a ResourceStatus."""
        info = ResourceInfo(
            id="pdk:test",
            type=ResourceType.pdk,
            display_name="Test",
            status=ResourceStatus.installed,
            active=True,
        )
        assert info.active is True
        assert info.status != "active"
        data = info.model_dump()
        assert isinstance(data["active"], bool)

    def test_rejects_invalid_action_in_list(self) -> None:
        with pytest.raises(ValidationError):
            ResourceInfo(
                id="tool:test",
                type=ResourceType.tool,
                display_name="Test",
                actions=["invalid_action"],
            )


class TestResourceList:
    def test_empty_list(self) -> None:
        rl = ResourceList(resources=[])
        assert rl.resources == []
        assert rl.diagnostics == []

    def test_with_diagnostics(self) -> None:
        rl = ResourceList(
            resources=[],
            diagnostics=["Registry unavailable, showing cached data"],
        )
        assert len(rl.diagnostics) == 1

    def test_with_resources(self) -> None:
        tool = ResourceInfo(
            id="tool:yosys",
            type=ResourceType.tool,
            display_name="Yosys",
            status=ResourceStatus.available,
            available_versions=["0.61"],
        )
        pdk = ResourceInfo(
            id="pdk:ics55",
            type=ResourceType.pdk,
            display_name="IC-S55",
            status=ResourceStatus.installed,
            active=True,
            canonical_path="/home/user/pdks/ics55",
        )
        rl = ResourceList(resources=[tool, pdk])
        assert len(rl.resources) == 2
        assert rl.resources[0].type == ResourceType.tool
        assert rl.resources[1].type == ResourceType.pdk
