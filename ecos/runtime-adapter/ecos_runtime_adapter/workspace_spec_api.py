import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ecos_runtime_adapter.errors import RuntimeApiError
from ecos_runtime_adapter.requests import (
    ProjectManifestDiscoverRequest,
    ProjectManifestLoadRequest,
    ProjectManifestMutationRequest,
    WorkspaceConfigurationUpdateRequest,
    WorkspaceCreateRequest,
    WorkspaceOpenRequest,
    WorkspaceSpecCreateRequest,
    WorkspaceSpecOpenRequest,
    WorkspaceSpecValidateRequest,
    WorkspaceStepConfigurationUpdateRequest,
    WorkspaceUpdateRequest,
)
from ecos_runtime_adapter.sessions import (
    WorkspaceSession,
    WorkspaceSessionNotFound,
)


class WorkspaceSpecRuntimeMixin:
    def describe_workspace_spec(self, _request) -> dict:
        from chipcompiler.engine import describe_workspace_spec

        return describe_workspace_spec()

    def validate_workspace_spec(self, request: WorkspaceSpecValidateRequest) -> dict:
        from chipcompiler.engine import validate_workspace_spec

        return validate_workspace_spec(
            request.workspace_spec, request.workspace_bindings
        )

    def workspace_binding_requirement(self, request: WorkspaceSpecOpenRequest) -> dict:
        from chipcompiler.engine import describe_workspace_binding_requirement

        try:
            return describe_workspace_binding_requirement(request.directory)
        except (OSError, ValueError) as exc:
            raise RuntimeApiError("workspace_descriptor_invalid", str(exc)) from exc

    def discover_project(self, request: ProjectManifestDiscoverRequest) -> dict | None:
        from chipcompiler.project import discover_project_manifest

        try:
            discovered = discover_project_manifest(request.directory)
        except (OSError, ValueError) as exc:
            raise RuntimeApiError("project_manifest_invalid", str(exc)) from exc
        if discovered is None:
            return None
        project_root, manifest = discovered
        return {
            "projectRoot": str(project_root),
            "projectId": manifest["project_id"],
        }

    def load_project_manifest(self, request: ProjectManifestLoadRequest) -> dict:
        from chipcompiler.project import load_project_manifest

        try:
            return load_project_manifest(request.project_root)
        except (OSError, ValueError) as exc:
            raise RuntimeApiError("project_manifest_invalid", str(exc)) from exc

    def mutate_project_manifest(self, request: ProjectManifestMutationRequest) -> dict:
        from chipcompiler.project import (
            create_project_manifest,
            mutate_project_manifest,
        )

        mutation = request.mutation
        kind = mutation.get("type")
        if kind == "create":
            try:
                return create_project_manifest(
                    request.project_root,
                    str(mutation.get("name") or "project"),
                    str(mutation.get("designName") or ""),
                    mpc=(
                        mutation.get("mpc")
                        if isinstance(mutation.get("mpc"), dict)
                        else None
                    ),
                )
            except (OSError, ValueError) as exc:
                raise RuntimeApiError("project_manifest_invalid", str(exc)) from exc
        now = str(mutation.get("now") or datetime.now(UTC).isoformat())
        source = (
            mutation.get("input")
            if isinstance(mutation.get("input"), dict)
            else mutation
        )
        translated = {
            "type": str(kind).replace("-", "_"),
            **{
                target: source[key]
                for key, target in (
                    ("workspaceId", "workspace_id"),
                    ("workspacePath", "workspace_path"),
                    ("sourceWorkspaceId", "source_workspace_id"),
                    ("lifecycle", "lifecycle"),
                    ("name", "name"),
                    ("reason", "reason"),
                )
                if key in source
            },
            "updated_at": now,
        }
        if translated["type"] == "register_workspace":
            workspace_path = str(translated.get("workspace_path") or "")
            workspace_id = str(
                translated.get("workspace_id") or Path(workspace_path).name
            )
            translated.update(
                {
                    "workspace_id": workspace_id,
                    "name": str(translated.get("name") or workspace_id),
                    "created_at": now,
                }
            )
        try:
            return mutate_project_manifest(request.project_root, translated)
        except (OSError, ValueError) as exc:
            raise RuntimeApiError("project_manifest_invalid", str(exc)) from exc

    def create_workspace(
        self,
        request: WorkspaceCreateRequest | WorkspaceSpecCreateRequest,
    ) -> dict:
        if isinstance(request, WorkspaceSpecCreateRequest):
            return self._create_workspace_from_spec(request)
        if not request.directory:
            raise RuntimeApiError(
                "invalid_request", "missing required field: directory"
            )

        temp_filelist_dir = None
        input_filelist = request.filelist
        if not input_filelist:
            rtl_paths = _normalize_rtl_list(request.rtl_list or [])
            if rtl_paths:
                temp_filelist_dir = tempfile.TemporaryDirectory(
                    prefix="ecc-workspace-filelist-"
                )
                input_filelist = _write_filelist(temp_filelist_dir.name, rtl_paths)

        import chipcompiler.data as data_api

        pdk_json, pdk_json_temp_path = _materialize_inline_pdk_json(request.pdk_json)
        try:
            workspace = data_api.create_workspace(
                directory=request.directory,
                pdk=request.pdk,
                parameters=request.parameters or {},
                origin_def=request.origin_def,
                origin_verilog=request.origin_verilog,
                input_filelist=input_filelist,
                pdk_root=request.pdk_root,
                pdk_json=pdk_json,
                sdc=request.sdc,
                flow_config=request.flow_config,
            )
        finally:
            if pdk_json_temp_path is not None:
                pdk_json_temp_path.unlink(missing_ok=True)
            if temp_filelist_dir is not None:
                temp_filelist_dir.cleanup()
        if workspace is None:
            raise RuntimeApiError(
                "command_failed",
                f"create workspace failed : {os.path.abspath(request.directory)}",
            )

        if getattr(workspace, "parameters", None) is not None:
            from chipcompiler.data.workspace_descriptor import load_workspace_descriptor

            load_workspace_descriptor(workspace.directory)
            workspace = data_api.load_workspace(workspace.directory) or workspace

        from chipcompiler.engine.workspace_flow import build_flow_for_workspace

        build_flow_for_workspace(workspace)
        snapshot = self._create_engineering_snapshot(workspace)
        session = self.sessions.create_session(
            workspace.directory,
            workspace=workspace,
            workspace_id=snapshot["workspaceId"],
            workspace_revision=snapshot["workspaceRevision"],
        )
        return _workspace_session_result(session)

    def _create_workspace_from_spec(self, request: WorkspaceSpecCreateRequest) -> dict:
        from chipcompiler.engine import (
            WorkspaceLifecycleError,
            create_workspace_from_spec,
        )

        try:
            if request.project_root:
                from chipcompiler.project import create_project_workspace

                workspace = create_project_workspace(
                    request.project_root,
                    request.target_directory,
                    request.workspace_spec,
                    request.workspace_bindings,
                    command_id=request.command_id,
                    expected_project_id=request.project_id or None,
                )
            else:
                workspace = create_workspace_from_spec(
                    request.target_directory,
                    request.workspace_spec,
                    request.workspace_bindings,
                    request.command_id,
                )
        except WorkspaceLifecycleError as exc:
            raise RuntimeApiError(exc.code, str(exc), exc.details) from exc
        except (OSError, ValueError) as exc:
            raise RuntimeApiError("project_manifest_invalid", str(exc)) from exc
        snapshot = self._read_engineering_snapshot(workspace)
        session = self.sessions.create_session(
            workspace.directory,
            workspace=workspace,
            workspace_id=snapshot["workspaceId"],
            workspace_revision=snapshot["workspaceRevision"],
            execution_readiness={"ready": True},
            workspace_bindings=request.workspace_bindings,
        )
        return _workspace_session_result(session)

    def open_workspace(
        self,
        request: WorkspaceOpenRequest | WorkspaceSpecOpenRequest,
    ) -> dict:
        workspace = self._load_workspace(request.directory)
        snapshot = self._ensure_engineering_snapshot(workspace)
        bindings = (
            request.workspace_bindings
            if isinstance(request, WorkspaceSpecOpenRequest)
            else None
        )
        if isinstance(request, WorkspaceSpecOpenRequest):
            from chipcompiler.engine import assess_execution_readiness

            readiness = assess_execution_readiness(workspace.directory, bindings)
            if readiness.get("ready") is True:
                from chipcompiler.engine import apply_workspace_bindings

                apply_workspace_bindings(workspace, bindings)
        else:
            readiness = {"ready": True}

        from chipcompiler.engine.workspace_flow import build_flow_for_workspace

        build_flow_for_workspace(workspace, create_step_workspaces=False)
        session = self.sessions.open_session(
            workspace.directory,
            workspace=workspace,
            workspace_id=snapshot["workspaceId"],
            workspace_revision=snapshot["workspaceRevision"],
            execution_readiness=readiness,
            workspace_bindings=bindings,
        )
        session.execution_readiness = readiness
        session.workspace_bindings = bindings
        self.operations.load_workspace_ledger(
            session.workspace_id,
            session.directory / "home" / "runtime-commands.json",
        )
        return _workspace_session_result(session)

    def update_workspace(self, request: WorkspaceUpdateRequest) -> dict:
        from chipcompiler.engine import (
            WorkspaceLifecycleError,
            update_workspace_from_spec,
        )

        session = self._get_session(request.workspace_id)
        with session.mutation_lock:
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            if self.operations.has_active_workspace(session.workspace_id):
                raise RuntimeApiError(
                    "operation_conflict",
                    "Workspace has an active Operation",
                )
            self._release_session_db(session)
            try:
                workspace = update_workspace_from_spec(
                    session.directory,
                    request.expected_workspace_revision,
                    request.workspace_spec,
                    request.workspace_bindings,
                    request.command_id,
                )
            except WorkspaceLifecycleError as exc:
                raise RuntimeApiError(exc.code, str(exc), exc.details) from exc
            snapshot = self._read_engineering_snapshot(workspace)
            session.workspace = workspace
            session.workspace_revision = snapshot["workspaceRevision"]
            session.workspace_bindings = request.workspace_bindings
            session.execution_readiness = {"ready": True}
            return _workspace_session_result(session)

    def update_workspace_configuration(
        self, request: WorkspaceConfigurationUpdateRequest
    ) -> dict:
        from chipcompiler.engine import (
            WorkspaceLifecycleError,
            update_workspace_configuration,
        )

        session = self._get_session(request.workspace_id)
        with session.mutation_lock:
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            if self.operations.has_active_workspace(session.workspace_id):
                raise RuntimeApiError(
                    "operation_conflict",
                    "Workspace has an active Operation",
                )
            self._release_session_db(session)
            try:
                workspace = update_workspace_configuration(
                    session.directory,
                    request.expected_workspace_revision,
                    request.configuration,
                    request.workspace_bindings,
                    request.command_id,
                )
            except WorkspaceLifecycleError as exc:
                raise RuntimeApiError(exc.code, str(exc), exc.details) from exc
            snapshot = self._read_engineering_snapshot(workspace)
            session.workspace = workspace
            session.workspace_revision = snapshot["workspaceRevision"]
            session.workspace_bindings = request.workspace_bindings
            session.execution_readiness = {"ready": True}
            return _workspace_session_result(session)

    def update_workspace_step_configuration(
        self, request: WorkspaceStepConfigurationUpdateRequest
    ) -> dict:
        from chipcompiler.engine import (
            WorkspaceLifecycleError,
            update_workspace_step_configuration,
        )

        session = self._get_session(request.workspace_id)
        with session.mutation_lock:
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            if self.operations.has_active_workspace(session.workspace_id):
                raise RuntimeApiError(
                    "operation_conflict",
                    "Workspace has an active Operation",
                )
            self._release_session_db(session)
            try:
                workspace = update_workspace_step_configuration(
                    session.directory,
                    request.expected_workspace_revision,
                    request.step_id,
                    request.options,
                    request.command_id,
                )
            except WorkspaceLifecycleError as exc:
                raise RuntimeApiError(exc.code, str(exc), exc.details) from exc
            snapshot = self._read_engineering_snapshot(workspace)
            session.workspace = workspace
            session.workspace_revision = snapshot["workspaceRevision"]
            return _workspace_session_result(session)

    def _load_workspace(self, directory: str):
        if not directory:
            raise RuntimeApiError(
                "invalid_request", "missing required field: directory"
            )
        if not os.path.isdir(directory):
            raise RuntimeApiError(
                "invalid_request",
                f"invalid workspace directory: {directory}",
            )

        import chipcompiler.data as data_api

        workspace = data_api.load_workspace(directory=directory)
        if workspace is None:
            raise RuntimeApiError(
                "command_failed",
                f"load workspace failed : {directory}",
            )
        return workspace

    def _get_session(self, workspace_id: str) -> WorkspaceSession:
        try:
            return self.sessions.get_session(workspace_id)
        except WorkspaceSessionNotFound as exc:
            raise RuntimeApiError(
                "workspace_session_not_found",
                f"workspace session not found: {workspace_id}",
            ) from exc

    @staticmethod
    def _validate_workspace_revision(
        session: WorkspaceSession,
        expected_workspace_revision: int,
    ) -> None:
        if expected_workspace_revision == session.workspace_revision:
            return
        raise RuntimeApiError(
            "revision_conflict",
            "Workspace Revision does not match",
            {
                "expectedRevision": expected_workspace_revision,
                "actualRevision": session.workspace_revision,
            },
        )

    @staticmethod
    def _ensure_execution_ready(session: WorkspaceSession) -> None:
        readiness = session.execution_readiness
        if readiness.get("ready") is True:
            return
        code = str(readiness.get("code") or "pdk_binding_missing")
        raise RuntimeApiError(code, "Workspace is not ready for execution", readiness)

    @staticmethod
    def _ensure_engineering_snapshot(workspace) -> dict:
        from chipcompiler.engine.snapshot import (
            EngineeringSnapshotError,
            ensure_engineering_snapshot,
        )

        try:
            return ensure_engineering_snapshot(workspace)
        except EngineeringSnapshotError as exc:
            raise RuntimeApiError("workspace_migration_required", str(exc)) from exc

    @staticmethod
    def _create_engineering_snapshot(workspace) -> dict:
        from chipcompiler.engine.snapshot import (
            EngineeringSnapshotError,
            create_engineering_snapshot,
        )

        try:
            return create_engineering_snapshot(workspace)
        except EngineeringSnapshotError as exc:
            raise RuntimeApiError(
                "engineering_snapshot_commit_failed", str(exc)
            ) from exc

    @staticmethod
    def _read_engineering_snapshot(owner) -> dict:
        from chipcompiler.engine.snapshot import (
            EngineeringSnapshotError,
            read_engineering_snapshot,
        )

        try:
            return read_engineering_snapshot(getattr(owner, "workspace", owner))
        except EngineeringSnapshotError as exc:
            raise RuntimeApiError("engineering_snapshot_unavailable", str(exc)) from exc

    @staticmethod
    def _commit_step_snapshot(
        session: WorkspaceSession,
        workspace_step,
        state,
        error: str | None,
    ) -> int:
        state_value = str(getattr(state, "value", state)).lower()
        try:
            return WorkspaceSpecRuntimeMixin._commit_workspace_snapshot(
                session,
                f"flow_step.{state_value}",
            )
        except RuntimeApiError as exc:
            raise RuntimeApiError(
                "engineering_snapshot_commit_failed",
                str(exc),
                {
                    "step": str(getattr(workspace_step, "name", "")),
                    "error": error or "",
                },
            ) from exc

    @staticmethod
    def _commit_workspace_snapshot(session: WorkspaceSession, cause: str) -> int:
        from chipcompiler.engine.snapshot import (
            EngineeringSnapshotError,
            commit_engineering_snapshot,
        )

        try:
            snapshot = commit_engineering_snapshot(
                session.workspace,
                workspace_id=session.workspace_id,
                cause=cause,
            )
        except EngineeringSnapshotError as exc:
            raise RuntimeApiError(
                "engineering_snapshot_commit_failed", str(exc)
            ) from exc
        session.workspace_revision = snapshot["workspaceRevision"]
        return session.workspace_revision


def _workspace_session_result(session: WorkspaceSession) -> dict:
    return {
        "workspaceId": session.workspace_id,
        "workspaceRevision": session.workspace_revision,
        "directory": str(session.directory),
        **(
            {"executionReadiness": session.execution_readiness}
            if session.workspace_bindings is not None
            or session.execution_readiness.get("ready") is not True
            else {}
        ),
    }


def _normalize_rtl_list(rtl_list: list[str]) -> list[str]:
    result: list[str] = []
    seen = set()
    for item in rtl_list:
        path = str(item).strip()
        if not path or path in seen:
            continue
        seen.add(path)
        result.append(path)
    return result


def _write_filelist(directory: str, rtl_paths: list[str]) -> str:
    os.makedirs(directory, exist_ok=True)
    filelist_path = os.path.join(directory, "filelist")
    with open(filelist_path, "w", encoding="utf-8") as filelist:
        for path in rtl_paths:
            filelist.write(
                f'"{path}"\n' if any(ch.isspace() for ch in path) else f"{path}\n"
            )
    return filelist_path


def _materialize_inline_pdk_json(pdk_json: Any) -> tuple[Any, Path | None]:
    if not isinstance(pdk_json, dict):
        return pdk_json, None
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        prefix="ecc-pdk-",
        suffix=".json",
        delete=False,
    ) as pdk_file:
        json.dump(pdk_json, pdk_file)
        return pdk_file.name, Path(pdk_file.name)
