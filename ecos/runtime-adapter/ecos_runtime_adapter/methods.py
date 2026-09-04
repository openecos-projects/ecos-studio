from dataclasses import dataclass
from typing import Any, Final, Generic, TypeVar

from ecos_runtime_adapter.requests import (
    DbEnsureRequest,
    DbReleaseRequest,
    EmptyRequest,
    FloorplanEditInspectRequest,
    FloorplanEditRunAutoRequest,
    FloorplanEditValidateRequest,
    FlowRunRequest,
    FlowRunStepRequest,
    LayoutEditApplyRequest,
    LayoutEditBeginRequest,
    LayoutEditDiscardRequest,
    LayoutEditSaveRequest,
    OperationIdRequest,
    OperationStartFlowRequest,
    OperationStartStepRequest,
    ProjectManifestDiscoverRequest,
    ProjectManifestLoadRequest,
    ProjectManifestMutationRequest,
    WorkspaceCloseRequest,
    WorkspaceConfigurationUpdateRequest,
    WorkspaceExportSignoffRequest,
    WorkspaceIdRequest,
    WorkspaceInfoRequest,
    WorkspaceMutationRequest,
    WorkspaceRecoverInterruptedRequest,
    WorkspaceSpecCreateRequest,
    WorkspaceSpecOpenRequest,
    WorkspaceSpecValidateRequest,
    WorkspaceSyncConfigRequest,
    WorkspaceUpdateRequest,
)

RequestT = TypeVar("RequestT")


@dataclass(frozen=True)
class RuntimeMethodSpec(Generic[RequestT]):
    method_name: str
    request_model: type[RequestT]
    handler_name: str


RUNTIME_METHODS: Final[tuple[RuntimeMethodSpec[Any], ...]] = (
    RuntimeMethodSpec(
        method_name="workspace_spec.describe",
        request_model=EmptyRequest,
        handler_name="describe_workspace_spec",
    ),
    RuntimeMethodSpec(
        method_name="workspace_spec.validate",
        request_model=WorkspaceSpecValidateRequest,
        handler_name="validate_workspace_spec",
    ),
    RuntimeMethodSpec(
        method_name="project.discover",
        request_model=ProjectManifestDiscoverRequest,
        handler_name="discover_project",
    ),
    RuntimeMethodSpec(
        method_name="project.manifest.load",
        request_model=ProjectManifestLoadRequest,
        handler_name="load_project_manifest",
    ),
    RuntimeMethodSpec(
        method_name="project.manifest.mutate",
        request_model=ProjectManifestMutationRequest,
        handler_name="mutate_project_manifest",
    ),
    RuntimeMethodSpec(
        method_name="workspace.create",
        request_model=WorkspaceSpecCreateRequest,
        handler_name="create_workspace",
    ),
    RuntimeMethodSpec(
        method_name="workspace.open",
        request_model=WorkspaceSpecOpenRequest,
        handler_name="open_workspace",
    ),
    RuntimeMethodSpec(
        method_name="workspace.binding_requirement",
        request_model=WorkspaceSpecOpenRequest,
        handler_name="workspace_binding_requirement",
    ),
    RuntimeMethodSpec(
        method_name="workspace.update",
        request_model=WorkspaceUpdateRequest,
        handler_name="update_workspace",
    ),
    RuntimeMethodSpec(
        method_name="workspace.configuration.update",
        request_model=WorkspaceConfigurationUpdateRequest,
        handler_name="update_workspace_configuration",
    ),
    RuntimeMethodSpec(
        method_name="workspace.close",
        request_model=WorkspaceCloseRequest,
        handler_name="close_workspace",
    ),
    RuntimeMethodSpec(
        method_name="workspace.home",
        request_model=WorkspaceIdRequest,
        handler_name="workspace_home",
    ),
    RuntimeMethodSpec(
        method_name="workspace.info",
        request_model=WorkspaceInfoRequest,
        handler_name="workspace_info",
    ),
    RuntimeMethodSpec(
        method_name="workspace.refresh_config",
        request_model=WorkspaceIdRequest,
        handler_name="refresh_config",
    ),
    RuntimeMethodSpec(
        method_name="workspace.sync_config",
        request_model=WorkspaceSyncConfigRequest,
        handler_name="sync_config",
    ),
    RuntimeMethodSpec(
        method_name="workspace.reset_flow",
        request_model=WorkspaceMutationRequest,
        handler_name="reset_flow",
    ),
    RuntimeMethodSpec(
        method_name="workspace.export_signoff",
        request_model=WorkspaceExportSignoffRequest,
        handler_name="export_signoff",
    ),
    RuntimeMethodSpec(
        method_name="flow.run",
        request_model=FlowRunRequest,
        handler_name="flow_run",
    ),
    RuntimeMethodSpec(
        method_name="flow.run_step",
        request_model=FlowRunStepRequest,
        handler_name="flow_run_step",
    ),
    RuntimeMethodSpec(
        method_name="operation.start_flow",
        request_model=OperationStartFlowRequest,
        handler_name="start_flow_operation",
    ),
    RuntimeMethodSpec(
        method_name="operation.start_step",
        request_model=OperationStartStepRequest,
        handler_name="start_step_operation",
    ),
    RuntimeMethodSpec(
        method_name="operation.status",
        request_model=OperationIdRequest,
        handler_name="operation_status",
    ),
    RuntimeMethodSpec(
        method_name="operation.cancel",
        request_model=OperationIdRequest,
        handler_name="cancel_operation",
    ),
    RuntimeMethodSpec(
        method_name="workspace.snapshot",
        request_model=WorkspaceIdRequest,
        handler_name="workspace_snapshot",
    ),
    RuntimeMethodSpec(
        method_name="workspace.engineering_snapshot",
        request_model=WorkspaceIdRequest,
        handler_name="engineering_snapshot",
    ),
    RuntimeMethodSpec(
        method_name="workspace.recover_interrupted",
        request_model=WorkspaceRecoverInterruptedRequest,
        handler_name="recover_interrupted",
    ),
)


PERSISTENT_DB_METHODS: Final[tuple[RuntimeMethodSpec[Any], ...]] = (
    RuntimeMethodSpec(
        method_name="db.ensure",
        request_model=DbEnsureRequest,
        handler_name="db_ensure",
    ),
    RuntimeMethodSpec(
        method_name="db.release",
        request_model=DbReleaseRequest,
        handler_name="db_release",
    ),
    RuntimeMethodSpec(
        method_name="layout.edit.begin",
        request_model=LayoutEditBeginRequest,
        handler_name="layout_edit_begin",
    ),
    RuntimeMethodSpec(
        method_name="layout.edit.apply",
        request_model=LayoutEditApplyRequest,
        handler_name="layout_edit_apply",
    ),
    RuntimeMethodSpec(
        method_name="layout.edit.save",
        request_model=LayoutEditSaveRequest,
        handler_name="layout_edit_save",
    ),
    RuntimeMethodSpec(
        method_name="layout.edit.discard",
        request_model=LayoutEditDiscardRequest,
        handler_name="layout_edit_discard",
    ),
    RuntimeMethodSpec(
        method_name="floorplan.edit.inspect",
        request_model=FloorplanEditInspectRequest,
        handler_name="floorplan_edit_inspect",
    ),
    RuntimeMethodSpec(
        method_name="floorplan.edit.run_auto",
        request_model=FloorplanEditRunAutoRequest,
        handler_name="floorplan_edit_run_auto",
    ),
    RuntimeMethodSpec(
        method_name="floorplan.edit.validate",
        request_model=FloorplanEditValidateRequest,
        handler_name="floorplan_edit_validate",
    ),
)


def runtime_methods(
    *, persistent_db_enabled: bool = False
) -> tuple[RuntimeMethodSpec[Any], ...]:
    if persistent_db_enabled:
        return (*RUNTIME_METHODS, *PERSISTENT_DB_METHODS)
    return RUNTIME_METHODS


def runtime_method_names(*, persistent_db_enabled: bool = False) -> tuple[str, ...]:
    return tuple(
        spec.method_name
        for spec in runtime_methods(persistent_db_enabled=persistent_db_enabled)
    )


def persistent_db_method_names() -> tuple[str, ...]:
    return tuple(spec.method_name for spec in PERSISTENT_DB_METHODS)


def runtime_method_by_name(
    method_name: str,
    *,
    persistent_db_enabled: bool = False,
) -> RuntimeMethodSpec[Any] | None:
    for spec in runtime_methods(persistent_db_enabled=persistent_db_enabled):
        if spec.method_name == method_name:
            return spec
    return None
