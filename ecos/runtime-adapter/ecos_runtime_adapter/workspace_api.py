import hashlib
import inspect
import json
import os
import shutil
import tempfile
import threading
from collections.abc import Callable
from copy import copy, deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any, TypeVar

from chipcompiler.engine.workspace_flow import (
    build_flow_for_workspace,
)
from chipcompiler.engine.workspace_flow import (
    init_db_engine_for_workspace_step as _init_db_engine_for_workspace_step,
)
from chipcompiler.engine.workspace_flow import (
    success_state as _success_state,
)
from chipcompiler.engine.workspace_flow import (
    workspace_step_from_flow as _workspace_step_from_flow,
)
from chipcompiler.utility.path import path_is_within, stringify_paths

from ecos_runtime_adapter.errors import RuntimeApiError
from ecos_runtime_adapter.operations import (
    RuntimeOperationConflict,
    RuntimeOperationIdempotencyConflict,
    RuntimeOperationManager,
)
from ecos_runtime_adapter.requests import (
    DbEnsureRequest,
    DbReleaseRequest,
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
    WorkspaceExportSignoffRequest,
    WorkspaceIdRequest,
    WorkspaceInfoRequest,
    WorkspaceMutationRequest,
    WorkspaceRecoverInterruptedRequest,
    WorkspaceSyncConfigRequest,
)
from ecos_runtime_adapter.sessions import (
    LayoutEditSession,
    WorkspaceSession,
    WorkspaceSessionRegistry,
)
from ecos_runtime_adapter.workspace_spec_api import WorkspaceSpecRuntimeMixin

_T = TypeVar("_T")


class WorkspaceRuntimeApi(WorkspaceSpecRuntimeMixin):
    def __init__(
        self,
        sessions: WorkspaceSessionRegistry | None = None,
        *,
        persistent_db_enabled: bool = False,
        event_publisher: Callable[[dict[str, Any]], None] | None = None,
    ):
        self.persistent_db_enabled = persistent_db_enabled
        self.sessions = sessions or WorkspaceSessionRegistry(db_releaser=_close_db_handle)
        self._next_layout_edit_id = 1
        self._layout_edit_sessions: dict[str, LayoutEditSession] = {}
        # ecc_tools_bin currently owns one process-global GeometryEditSession.
        # Keep its native DB and derived GeometryStore exclusive until that
        # session is reset, so a second workspace cannot replace the store
        # underneath an active editor.
        self._layout_edit_lock = threading.RLock()
        self.operations = RuntimeOperationManager(event_publisher)

    def set_event_publisher(self, publisher: Callable[[dict[str, Any]], None] | None) -> None:
        self.operations.set_publisher(publisher)

    def recover_interrupted(self, request: WorkspaceRecoverInterruptedRequest) -> dict:
        from ecos_runtime_adapter.recovery import recover_interrupted_operation

        return self._with_session_mutation_lock(
            request.workspace_id,
            lambda session: recover_interrupted_operation(
                session.workspace,
                self.operations,
                request.operation_id,
            ),
        )

    def workspace_home(self, request: WorkspaceIdRequest) -> dict:
        session = self._get_session(request.workspace_id)
        path = Path(session.workspace.home.path).resolve()
        if not path.exists():
            raise RuntimeApiError("command_failed", f"get home failed : {path}")
        return {"path": str(path)}

    def workspace_info(self, request: WorkspaceInfoRequest) -> dict:
        session = self._get_session(request.workspace_id)
        workspace_step = _workspace_step_from_flow(session.workspace, request.step)
        if workspace_step is None:
            raise RuntimeApiError("command_failed", f"step not found: {request.step}")

        import chipcompiler.tools as tools_api

        info = tools_api.get_step_info(
            workspace=session.workspace,
            step=workspace_step,
            id=request.info_id,
        )
        return {
            "step": request.step,
            "id": request.info_id,
            "info": stringify_paths(info or {}),
        }

    def refresh_config(self, request: WorkspaceIdRequest) -> dict:
        def refresh(session: WorkspaceSession) -> dict:
            self._release_session_db(session)
            self._refresh_workspace_config(session.workspace)
            return {"directory": str(session.directory), "refreshed": True}

        return self._with_session_mutation_lock(request.workspace_id, refresh)

    def sync_config(self, request: WorkspaceSyncConfigRequest) -> dict:
        def sync(session: WorkspaceSession) -> dict:
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            config_path = Path(request.config_path).resolve()
            config_dir = session.directory / "config"
            if not path_is_within(config_path, config_dir):
                raise RuntimeApiError(
                    "invalid_request",
                    f"config path outside workspace config directory : {config_path}",
                )

            import chipcompiler.data as data_api

            parameters_changed = data_api.sync_workspace_config_to_parameters(
                session.workspace,
                config_path,
            )
            refreshed = False
            if parameters_changed:
                self._release_session_db(session)
                self._refresh_workspace_config(session.workspace)
                self._commit_workspace_snapshot(session, "workspace.sync_config")
                refreshed = True
            return {
                "directory": str(session.directory),
                "configPath": str(config_path),
                "parametersChanged": bool(parameters_changed),
                "refreshed": refreshed,
                "workspaceRevision": session.workspace_revision,
            }

        return self._with_session_mutation_lock(request.workspace_id, sync)

    def reset_flow(self, request: WorkspaceMutationRequest) -> dict:
        def reset(session: WorkspaceSession) -> dict:
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            self._release_session_db(session)
            engine_flow = build_flow_for_workspace(session.workspace)
            self._prepare_workspace_for_rerun(session.workspace, engine_flow)
            revision = self._commit_workspace_snapshot(session, "workspace.reset")
            return {
                "directory": str(session.directory),
                "workspaceRevision": revision,
            }

        return self._with_session_mutation_lock(request.workspace_id, reset)

    def export_signoff(self, request: WorkspaceExportSignoffRequest) -> dict:
        def export(session: WorkspaceSession) -> dict:
            from chipcompiler.engine.signoff_export import (
                SignoffExportError,
                export_signoff_package_archive,
                inspect_signoff_package,
            )

            assessment = inspect_signoff_package(session.workspace)
            if assessment.get("status") == "blocked":
                raise RuntimeApiError(
                    "signoff_blocked",
                    "current ECC Signoff Assessment blocks export",
                    {"assessment": assessment},
                )
            try:
                output_path = export_signoff_package_archive(
                    session.workspace,
                    request.output_path,
                    request.additional_files,
                )
            except SignoffExportError as exc:
                raise RuntimeApiError("command_failed", str(exc)) from exc
            return {"outputPath": output_path}

        return self._with_session_mutation_lock(
            request.workspace_id,
            export,
            reject_active_operation=True,
        )

    def close_workspace(self, request: WorkspaceIdRequest) -> dict:
        def close(session: WorkspaceSession) -> dict:
            self._discard_layout_edit_session(session)
            self.sessions.close_session(session.workspace_id)
            return {"ok": True}

        return self._with_session_mutation_lock(request.workspace_id, close)

    def flow_run(self, request: FlowRunRequest) -> dict:
        return self._flow_run(request)

    def _flow_run(
        self,
        request: FlowRunRequest,
        *,
        observer=None,
        preserve_user_inputs: bool = False,
    ) -> dict:
        def run(session: WorkspaceSession) -> dict:
            self._ensure_execution_ready(session)
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            should_capture = self._should_capture_session_db(session)
            previous_db = session.db_handle if should_capture else None
            if request.rerun and should_capture:
                self._release_session_db(session)
                previous_db = None

            engine_flow = self._build_flow_for_session(
                session,
                attach_session_db=should_capture and not request.rerun,
            )
            if request.rerun:
                affected_steps = list(getattr(engine_flow, "workspace_steps", []))
                self._prepare_workspace_for_rerun(
                    session.workspace,
                    engine_flow,
                    preserve_user_inputs=preserve_user_inputs,
                )
                reset_revision = self._commit_workspace_snapshot(
                    session,
                    "flow.rerun_prepared",
                )
                self._notify_rerun_prepared(
                    observer,
                    affected_steps,
                    scope="flow",
                    workspace_revision=reset_revision,
                )
            try:
                from chipcompiler.engine import ExecutionPlan, execute

                execution = execute(
                    engine_flow,
                    ExecutionPlan(intent="rerun" if request.rerun else "run"),
                    event_sink=observer,
                )
            finally:
                if should_capture:
                    self._capture_flow_db(
                        session,
                        engine_flow,
                        previous_handle=previous_db,
                    )
                else:
                    self._close_transient_flow_db(engine_flow)
            if not execution.succeeded:
                raise RuntimeApiError(
                    "command_failed",
                    f"run flow failed : {session.directory}",
                    {"rerun": request.rerun},
                )
            return {"rerun": request.rerun}

        return self._with_session_mutation_lock(request.workspace_id, run)

    def flow_run_step(self, request: FlowRunStepRequest) -> dict:
        return self._flow_run_step(request)

    def _flow_run_step(
        self,
        request: FlowRunStepRequest,
        *,
        observer=None,
        reset_dependents: bool = False,
    ) -> dict:
        def run_step(session: WorkspaceSession) -> dict:
            self._ensure_execution_ready(session)
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            should_capture = self._should_capture_session_db(session)
            previous_db = session.db_handle if should_capture else None
            if request.rerun and should_capture:
                self._release_session_db(session)
                previous_db = None

            engine_flow = self._build_flow_for_session(
                session,
                attach_session_db=should_capture and not request.rerun,
            )
            if request.rerun:
                if session.layout_edit_session is not None:
                    raise RuntimeApiError(
                        "layout_edit_active",
                        "close the rendered layout before rerunning this step",
                    )
                self._refresh_workspace_config(session.workspace)

            workspace_step = engine_flow.get_workspace_step(request.step)
            if workspace_step is None:
                raise RuntimeApiError("command_failed", f"step not found: {request.step}")
            if request.rerun:
                affected_steps = self._rerun_affected_steps(
                    engine_flow,
                    workspace_step,
                    reset_dependents=reset_dependents,
                )
                self._prepare_steps_for_rerun(
                    session.workspace,
                    engine_flow,
                    affected_steps,
                )
                reset_revision = self._commit_workspace_snapshot(
                    session,
                    "flow.rerun_prepared",
                )
                self._notify_rerun_prepared(
                    observer,
                    affected_steps,
                    scope="step",
                    target_step=workspace_step.name,
                    workspace_revision=reset_revision,
                )

            try:
                step_already_succeeded = not request.rerun and engine_flow.check_state(
                    name=workspace_step.name,
                    tool=workspace_step.tool,
                    state=_success_state(),
                )
                if not step_already_succeeded:
                    _init_db_engine_for_workspace_step(engine_flow, workspace_step)
                from chipcompiler.engine import ExecutionPlan, execute

                execution = execute(
                    engine_flow,
                    ExecutionPlan(
                        intent="rerun" if request.rerun else "run",
                        step_id=workspace_step.name,
                    ),
                    event_sink=observer,
                )
            finally:
                if should_capture:
                    self._capture_flow_db(
                        session,
                        engine_flow,
                        previous_handle=previous_db,
                    )
                else:
                    self._close_transient_flow_db(engine_flow)

            state_value = execution.state
            result = {"step": request.step, "state": state_value}
            if state_value != "Success":
                raise RuntimeApiError(
                    "command_failed",
                    f"run step {request.step} failed with state {state_value}",
                    result,
                )
            return result

        return self._with_session_mutation_lock(request.workspace_id, run_step)

    def start_flow_operation(self, request: OperationStartFlowRequest) -> dict:
        self._require_gui_operation_origin(request.origin)
        session = self._get_session(request.workspace_id)
        try:
            with session.mutation_lock:

                def validate_start() -> None:
                    self._ensure_execution_ready(session)
                    self._validate_workspace_revision(
                        session,
                        request.expected_workspace_revision,
                    )

                return self.operations.start(
                    workspace_id=request.workspace_id,
                    kind="flow",
                    origin=request.origin,
                    rerun=request.rerun,
                    step="",
                    idempotency_key=request.idempotency_key,
                    workspace_revision=request.expected_workspace_revision,
                    ledger_path=session.directory / "home" / "runtime-commands.json",
                    precondition=validate_start,
                    snapshot_committer=lambda step, state, error: self._commit_step_snapshot(
                        session,
                        step,
                        state,
                        error,
                    ),
                    runner=lambda observer: self._flow_run(
                        FlowRunRequest(
                            workspace_id=request.workspace_id,
                            expected_workspace_revision=request.expected_workspace_revision,
                            rerun=request.rerun,
                        ),
                        observer=observer,
                        preserve_user_inputs=request.rerun,
                    ),
                )
        except RuntimeOperationIdempotencyConflict as exc:
            raise RuntimeApiError("idempotency_conflict", str(exc)) from exc
        except RuntimeOperationConflict as exc:
            raise RuntimeApiError("operation_conflict", str(exc)) from exc

    def start_step_operation(self, request: OperationStartStepRequest) -> dict:
        self._require_gui_operation_origin(request.origin)
        session = self._get_session(request.workspace_id)
        try:
            with session.mutation_lock:

                def validate_start() -> None:
                    self._ensure_execution_ready(session)
                    self._validate_workspace_revision(
                        session,
                        request.expected_workspace_revision,
                    )

                return self.operations.start(
                    workspace_id=request.workspace_id,
                    kind="step",
                    origin=request.origin,
                    rerun=request.rerun,
                    step=request.step,
                    idempotency_key=request.idempotency_key,
                    workspace_revision=request.expected_workspace_revision,
                    command_input={"resetDependents": request.reset_dependents},
                    ledger_path=session.directory / "home" / "runtime-commands.json",
                    precondition=validate_start,
                    snapshot_committer=lambda step, state, error: self._commit_step_snapshot(
                        session,
                        step,
                        state,
                        error,
                    ),
                    runner=lambda observer: self._flow_run_step(
                        FlowRunStepRequest(
                            workspace_id=request.workspace_id,
                            step=request.step,
                            expected_workspace_revision=request.expected_workspace_revision,
                            rerun=request.rerun,
                        ),
                        observer=observer,
                        reset_dependents=request.reset_dependents,
                    ),
                )
        except RuntimeOperationIdempotencyConflict as exc:
            raise RuntimeApiError("idempotency_conflict", str(exc)) from exc
        except RuntimeOperationConflict as exc:
            raise RuntimeApiError("operation_conflict", str(exc)) from exc

    def operation_status(self, request: OperationIdRequest) -> dict:
        try:
            return self.operations.operation_status(request.operation_id)
        except KeyError as exc:
            raise RuntimeApiError(
                "invalid_request",
                f"operation not found: {request.operation_id}",
            ) from exc

    def cancel_operation(self, request: OperationIdRequest) -> dict:
        try:
            return self.operations.request_cancel(request.operation_id)
        except KeyError as exc:
            raise RuntimeApiError(
                "invalid_request",
                f"operation not found: {request.operation_id}",
            ) from exc

    def workspace_snapshot(self, request: WorkspaceIdRequest) -> dict:
        session = self._get_session(request.workspace_id)
        flow_data = getattr(getattr(session.workspace, "flow", None), "data", {})
        raw_steps = flow_data.get("steps", []) if isinstance(flow_data, dict) else []
        steps = [
            {
                "name": str(step.get("name", "")),
                "tool": str(step.get("tool", "")),
                "state": str(step.get("state", "Unstart")),
                "runtime": str(step.get("runtime", "")),
                "peakMemory": step.get("peak memory (mb)", 0),
            }
            for step in raw_steps
            if isinstance(step, dict)
        ]
        from chipcompiler.data.parameter import (
            parameters_have_chip_identity,
            reload_parameter,
        )

        parameters = getattr(session.workspace, "parameters", None)
        parameters_data = getattr(parameters, "data", {}) or {}
        if not parameters_have_chip_identity(parameters_data):
            parameter_path = getattr(parameters, "path", None)
            if parameter_path:
                session.workspace.parameters = reload_parameter(parameter_path, parameters)
                parameters_data = session.workspace.parameters.data or {}

        home_data = deepcopy(getattr(session.workspace.home, "data", {}) or {})
        if not str(home_data.get("parameters", "")).strip():
            parameter_path = getattr(session.workspace.parameters, "path", None)
            if parameter_path is None:
                parameter_path = Path(session.directory) / "home" / "parameters.json"
            home_data["parameters"] = str(parameter_path)

        return {
            **self.operations.workspace_snapshot(request.workspace_id),
            "engineeringSnapshot": self._read_engineering_snapshot(session),
            "directory": str(session.directory),
            "flow": {"steps": steps},
            "home": stringify_paths(home_data),
            "parameters": stringify_paths(deepcopy(parameters_data)),
        }

    def engineering_snapshot(self, request: WorkspaceIdRequest) -> dict:
        return self._with_session_mutation_lock(
            request.workspace_id,
            lambda session: self._read_engineering_snapshot(session),
            reject_active_operation=True,
        )

    def db_ensure(self, request: DbEnsureRequest) -> dict:
        self._require_persistent_db()

        def ensure(session: WorkspaceSession) -> dict:
            db_handle = session.db_handle
            if _db_handle_is_initialized(db_handle):
                return _db_ensure_result(
                    workspace_id=session.workspace_id,
                    step=request.step,
                    active=True,
                    reused=True,
                )

            engine_flow = build_flow_for_workspace(session.workspace)
            if db_handle is not None:
                engine_flow.engine_db = db_handle

            if request.step:
                workspace_step = engine_flow.get_workspace_step(request.step)
                if workspace_step is None:
                    raise RuntimeApiError(
                        "command_failed",
                        f"step not found: {request.step}",
                    )
                initialized = _init_db_engine_for_workspace_step(engine_flow, workspace_step)
            else:
                initialized = engine_flow.init_db_engine()

            flow_db = getattr(engine_flow, "engine_db", None)
            active = bool(initialized and _db_handle_is_initialized(flow_db))
            session.db_handle = flow_db if active else None
            return _db_ensure_result(
                workspace_id=session.workspace_id,
                step=request.step,
                active=active,
                reused=False,
            )

        return self._with_session_mutation_lock(request.workspace_id, ensure)

    def db_release(self, request: DbReleaseRequest) -> dict:
        self._require_persistent_db()

        def release(session: WorkspaceSession) -> dict:
            released = self._release_session_db(session)
            return {"workspaceId": session.workspace_id, "released": released}

        return self._with_session_mutation_lock(request.workspace_id, release)

    def layout_edit_begin(self, request: LayoutEditBeginRequest) -> dict:
        self._require_persistent_db()

        def begin(session: WorkspaceSession) -> dict:
            with self._layout_edit_lock:
                active_session = session.layout_edit_session
                if active_session is not None:
                    if active_session.step_name != request.step:
                        raise RuntimeApiError(
                            "layout_edit_active",
                            "layout edit session already active for step: "
                            f"{active_session.step_name}",
                            {"editSessionId": active_session.edit_session_id},
                        )
                    if (
                        request.expected_source_fingerprint
                        and request.expected_source_fingerprint != active_session.source_fingerprint
                    ):
                        raise RuntimeApiError(
                            "source_changed",
                            "layout edit source fingerprint does not match",
                            {
                                "expectedSourceFingerprint": request.expected_source_fingerprint,
                                "actualSourceFingerprint": active_session.source_fingerprint,
                            },
                        )
                    return _layout_edit_begin_result(active_session, reused=True)

                active_session = next(iter(self._layout_edit_sessions.values()), None)
                if active_session is not None:
                    raise RuntimeApiError(
                        "layout_edit_active",
                        "layout edit session already active for another workspace",
                        {
                            "editSessionId": active_session.edit_session_id,
                            "workspaceId": active_session.workspace_id,
                        },
                    )

                engine_flow = build_flow_for_workspace(session.workspace)
                workspace_step = engine_flow.get_workspace_step(request.step)
                if workspace_step is None:
                    raise RuntimeApiError("command_failed", f"step not found: {request.step}")

                source_kind, source_paths = _layout_edit_source(workspace_step)
                source_fingerprint = _artifact_fingerprint(source_paths)
                if (
                    request.expected_source_fingerprint
                    and request.expected_source_fingerprint != source_fingerprint
                ):
                    raise RuntimeApiError(
                        "source_changed",
                        "layout edit source fingerprint does not match",
                        {
                            "expectedSourceFingerprint": request.expected_source_fingerprint,
                            "actualSourceFingerprint": source_fingerprint,
                        },
                    )

                edit_step = _layout_edit_workspace_step(
                    workspace_step,
                    source_kind=source_kind,
                    source_paths=source_paths,
                )
                initialized = _init_db_engine_for_workspace_step(engine_flow, edit_step)
                db_handle = getattr(engine_flow, "engine_db", None)
                if not initialized or not _db_handle_is_initialized(db_handle):
                    _close_db_handle(db_handle)
                    raise RuntimeApiError(
                        "command_failed",
                        f"failed to initialize layout edit DB for step: {request.step}",
                    )

                module = _db_engine_module(db_handle)
                initialize_geometry = getattr(module, "initialize_geometry_session", None)
                if not callable(initialize_geometry) or not initialize_geometry():
                    _close_db_handle(db_handle)
                    raise RuntimeApiError(
                        "command_failed",
                        f"failed to initialize layout geometry for step: {request.step}",
                    )

                edit_session_id = self._new_layout_edit_id()
                geometry_output_dir = (
                    Path(tempfile.mkdtemp(prefix=f"ecc-{edit_session_id}-geometry-")) / "geometry-0"
                )
                try:
                    _write_layout_edit_geometry_snapshot(module, geometry_output_dir)
                except Exception:
                    _close_db_handle(db_handle)
                    shutil.rmtree(geometry_output_dir.parent, ignore_errors=True)
                    raise

                edit_session = LayoutEditSession(
                    edit_session_id=edit_session_id,
                    workspace_id=session.workspace_id,
                    step_name=request.step,
                    workspace_step=workspace_step,
                    db_handle=db_handle,
                    source_kind=source_kind,
                    source_paths=source_paths,
                    source_fingerprint=source_fingerprint,
                    geometry_output_dir=geometry_output_dir,
                )
                session.layout_edit_session = edit_session
                self._layout_edit_sessions[edit_session.edit_session_id] = edit_session
                return _layout_edit_begin_result(edit_session, reused=False)

        return self._with_session_mutation_lock(request.workspace_id, begin)

    def layout_edit_apply(self, request: LayoutEditApplyRequest) -> dict:
        def apply(session: WorkspaceSession, edit_session: LayoutEditSession) -> dict:
            return _apply_layout_edit_operation(
                edit_session,
                command_id=request.command_id,
                base_revision=request.base_revision,
                operation=request.operation,
            )

        return self._with_layout_edit_session_mutation_lock(request.edit_session_id, apply)

    def floorplan_edit_inspect(self, request: FloorplanEditInspectRequest) -> dict:
        def inspect(_session: WorkspaceSession, edit_session: LayoutEditSession) -> dict:
            module = _db_engine_module(edit_session.db_handle)
            module_state = _floorplan_editor_inspect(module)
            return {
                "editSessionId": edit_session.edit_session_id,
                "revision": edit_session.revision,
                "geometryRevision": edit_session.geometry_revision,
                "geometryManifestPath": str(edit_session.geometry_output_dir / "geometry.manifest"),
                "dirty": edit_session.dirty,
                "floorplanPlan": deepcopy(edit_session.floorplan_plan),
                "pdnPlan": deepcopy(edit_session.pdn_plan),
                "diagnostics": deepcopy(edit_session.validation_diagnostics),
                "state": module_state,
            }

        return self._with_layout_edit_session_mutation_lock(request.edit_session_id, inspect)

    def floorplan_edit_run_auto(self, request: FloorplanEditRunAutoRequest) -> dict:
        def run_auto(_session: WorkspaceSession, edit_session: LayoutEditSession) -> dict:
            if not isinstance(request.request, dict):
                raise RuntimeApiError("invalid_request", "request must be an object")
            return _apply_layout_edit_operation(
                edit_session,
                command_id=request.command_id,
                base_revision=request.base_revision,
                operation={"kind": "run_auto", "request": request.request},
            )

        return self._with_layout_edit_session_mutation_lock(request.edit_session_id, run_auto)

    def floorplan_edit_validate(self, request: FloorplanEditValidateRequest) -> dict:
        def validate(_session: WorkspaceSession, edit_session: LayoutEditSession) -> dict:
            scope = request.scope.strip() if isinstance(request.scope, str) else ""
            if not scope:
                raise RuntimeApiError("invalid_request", "scope must be a non-empty string")
            module = _db_engine_module(edit_session.db_handle)
            result = _floorplan_editor_validate(module, scope)
            edit_session.validation_diagnostics = _floorplan_diagnostics(result)
            return {
                "editSessionId": edit_session.edit_session_id,
                "revision": edit_session.revision,
                "scope": scope,
                "valid": _floorplan_validation_ok(result),
                "diagnostics": deepcopy(edit_session.validation_diagnostics),
            }

        return self._with_layout_edit_session_mutation_lock(request.edit_session_id, validate)

    def layout_edit_save(self, request: LayoutEditSaveRequest) -> dict:
        def save(session: WorkspaceSession, edit_session: LayoutEditSession) -> dict:
            self._validate_workspace_revision(
                session,
                request.expected_workspace_revision,
            )
            _validate_layout_edit_revision(request.expected_revision, "expected_revision")
            if request.expected_revision != edit_session.revision:
                raise RuntimeApiError(
                    "version_conflict",
                    "layout edit revision does not match",
                    {
                        "expectedRevision": request.expected_revision,
                        "actualRevision": edit_session.revision,
                    },
                )
            if not edit_session.dirty:
                return {
                    **_layout_edit_save_result(edit_session, saved=False),
                    "workspaceRevision": session.workspace_revision,
                }

            current_fingerprint = _artifact_fingerprint(edit_session.source_paths)
            if current_fingerprint != edit_session.source_fingerprint:
                raise RuntimeApiError(
                    "source_changed",
                    "layout edit source changed after the session began",
                    {
                        "expectedSourceFingerprint": edit_session.source_fingerprint,
                        "actualSourceFingerprint": current_fingerprint,
                    },
                )

            module = _db_engine_module(edit_session.db_handle)
            if edit_session.used_floorplan_editor:
                validation = _floorplan_editor_validate(module, "all")
                edit_session.validation_diagnostics = _floorplan_diagnostics(validation)
                if not _floorplan_validation_ok(validation):
                    raise RuntimeApiError(
                        "floorplan_validation_failed",
                        "floorplan edit validation failed",
                        {"diagnostics": deepcopy(edit_session.validation_diagnostics)},
                    )
                _merge_floorplan_export_intent(
                    edit_session, _floorplan_editor_export_intent(module)
                )

            artifacts = _publish_layout_edit_artifacts(edit_session, session.workspace)
            output_db = _path_or_none(
                _workspace_step_output_value(edit_session.workspace_step, "db")
            )
            if output_db is None:
                raise RuntimeApiError("command_failed", "layout edit output DB is missing")
            edit_session.source_kind = "db"
            edit_session.source_paths = (output_db,)
            edit_session.source_fingerprint = _artifact_fingerprint(edit_session.source_paths)
            edit_session.dirty = False
            revision = self._commit_workspace_snapshot(session, "layout.saved")
            return {
                **_layout_edit_save_result(edit_session, saved=True, artifacts=artifacts),
                "workspaceRevision": revision,
            }

        return self._with_layout_edit_session_mutation_lock(request.edit_session_id, save)

    def layout_edit_discard(self, request: LayoutEditDiscardRequest) -> dict:
        def discard(session: WorkspaceSession, edit_session: LayoutEditSession) -> dict:
            dirty = edit_session.dirty
            self._discard_layout_edit_session(session)
            return {
                "editSessionId": request.edit_session_id,
                "discarded": True,
                "dirty": dirty,
            }

        return self._with_layout_edit_session_mutation_lock(request.edit_session_id, discard)

    def _require_persistent_db(self) -> None:
        if not self.persistent_db_enabled:
            raise RuntimeApiError("command_failed", "persistent_db_disabled")

    @staticmethod
    def _require_gui_operation_origin(origin: str) -> None:
        if origin != "gui":
            raise RuntimeApiError("invalid_request", "operation origin must be gui")

    def _new_layout_edit_id(self) -> str:
        edit_session_id = f"layout-edit-{self._next_layout_edit_id}"
        self._next_layout_edit_id += 1
        return edit_session_id

    def _with_layout_edit_session_mutation_lock(
        self,
        edit_session_id: str,
        operation: Callable[[WorkspaceSession, LayoutEditSession], _T],
    ) -> _T:
        edit_session = self._layout_edit_sessions.get(edit_session_id)
        if edit_session is None:
            raise RuntimeApiError(
                "layout_edit_session_not_found",
                f"layout edit session not found: {edit_session_id}",
            )

        def run(session: WorkspaceSession) -> _T:
            if session.layout_edit_session is not edit_session:
                self._layout_edit_sessions.pop(edit_session_id, None)
                raise RuntimeApiError(
                    "layout_edit_session_not_found",
                    f"layout edit session not found: {edit_session_id}",
                )
            return operation(session, edit_session)

        return self._with_session_mutation_lock(edit_session.workspace_id, run)

    def _discard_layout_edit_session(self, session: WorkspaceSession) -> bool:
        with self._layout_edit_lock:
            edit_session = session.layout_edit_session
            if edit_session is None:
                return False
            self._layout_edit_sessions.pop(edit_session.edit_session_id, None)
            return self.sessions.release_layout_edit_session(session)

    def _release_session_db(self, session: WorkspaceSession) -> bool:
        return self.sessions.release_session_db(session)

    def _should_capture_session_db(self, session: WorkspaceSession) -> bool:
        return self.persistent_db_enabled and _db_handle_is_initialized(session.db_handle)

    def _build_flow_for_session(
        self,
        session: WorkspaceSession,
        *,
        attach_session_db: bool,
    ):
        engine_flow = build_flow_for_workspace(session.workspace)
        if attach_session_db:
            engine_flow.engine_db = session.db_handle
        return engine_flow

    def _capture_flow_db(
        self,
        session: WorkspaceSession,
        engine_flow,
        *,
        previous_handle,
    ) -> None:
        flow_db = getattr(engine_flow, "engine_db", None)
        if _db_handle_is_initialized(flow_db):
            session.db_handle = flow_db
            if previous_handle is not None and previous_handle is not flow_db:
                _close_db_handle(previous_handle)
            return

        session.db_handle = None
        if previous_handle is not None:
            _close_db_handle(previous_handle)

    def _close_transient_flow_db(self, engine_flow) -> None:
        _close_db_handle(getattr(engine_flow, "engine_db", None))

    def _with_session_mutation_lock(
        self,
        workspace_id: str,
        operation: Callable[[WorkspaceSession], _T],
        *,
        reject_active_operation: bool = False,
    ) -> _T:
        session = self._get_session(workspace_id)
        if reject_active_operation:
            self._ensure_no_active_operation(session)
        with session.mutation_lock:
            if reject_active_operation:
                self._ensure_no_active_operation(session)
            return operation(session)

    def _ensure_no_active_operation(self, session: WorkspaceSession) -> None:
        if self.operations.has_active_workspace(session.workspace_id):
            raise RuntimeApiError(
                "operation_conflict",
                "Workspace has an active Operation",
            )

    def _refresh_workspace_config(self, workspace) -> None:
        import chipcompiler.data as data_api

        data_api.refresh_workspace_config(workspace)

    def _prepare_workspace_for_rerun(
        self,
        workspace,
        engine_flow,
        *,
        preserve_user_inputs: bool = False,
    ) -> None:
        import chipcompiler.data as data_api

        data_api.prepare_workspace_for_rerun(
            workspace,
            engine_flow,
            preserve_user_inputs=preserve_user_inputs,
        )

    @staticmethod
    def _rerun_affected_steps(engine_flow, workspace_step, *, reset_dependents: bool):
        if not reset_dependents:
            return [workspace_step]
        workspace_steps = list(getattr(engine_flow, "workspace_steps", []))
        try:
            start_index = workspace_steps.index(workspace_step)
        except ValueError:
            return [workspace_step]
        return workspace_steps[start_index:]

    @staticmethod
    def _notify_rerun_prepared(
        observer,
        workspace_steps,
        *,
        scope: str,
        workspace_revision: int,
        target_step: str = "",
    ) -> None:
        callback = getattr(observer, "on_rerun_prepared", None)
        if callback is None:
            return
        callback(
            affected_steps=[str(getattr(step, "name", "")) for step in workspace_steps],
            scope=scope,
            target_step=target_step,
            workspace_revision=workspace_revision,
        )

    @staticmethod
    def _prepare_step_for_rerun(workspace, engine_flow, workspace_step) -> None:
        WorkspaceRuntimeApi._prepare_steps_for_rerun(
            workspace,
            engine_flow,
            [workspace_step],
        )

    @staticmethod
    def _prepare_steps_for_rerun(workspace, engine_flow, workspace_steps) -> None:
        workspace_root = Path(workspace.directory).resolve()
        unique_steps = []
        known_step_keys = set()
        for workspace_step in workspace_steps:
            key = (
                str(getattr(workspace_step, "name", "")),
                str(getattr(workspace_step, "tool", "")),
            )
            if key in known_step_keys:
                continue
            known_step_keys.add(key)
            unique_steps.append(workspace_step)

        artifact_directories = []
        known_directories = set()
        for workspace_step in unique_steps:
            for directory in WorkspaceRuntimeApi._step_artifact_dirs(workspace_step):
                resolved = WorkspaceRuntimeApi._validate_step_artifact_dir(
                    workspace_root,
                    directory,
                    workspace_step.name,
                )
                if resolved in known_directories:
                    continue
                known_directories.add(resolved)
                artifact_directories.append((workspace_step.name, directory))

        for step_name, directory in artifact_directories:
            WorkspaceRuntimeApi._clear_step_artifact_dir(
                workspace_root,
                directory,
                step_name,
            )

        updated_record = False
        for workspace_step in unique_steps:
            record = engine_flow.get_step(workspace_step.name, workspace_step.tool)
            if record is None:
                continue
            record.update(
                {
                    "state": "Unstart",
                    "runtime": "",
                    "peak memory (mb)": 0,
                    "info": {},
                }
            )
            updated_record = True
        if updated_record and not engine_flow.save():
            raise RuntimeApiError(
                "command_failed",
                "failed to persist rerun Step reset",
            )

        for workspace_step in unique_steps:
            WorkspaceRuntimeApi._reset_step_subflow(workspace_step)
            WorkspaceRuntimeApi._reset_step_checklist(workspace_step)

    @staticmethod
    def _reset_step_subflow(workspace_step) -> None:
        from chipcompiler.utility import json_read, json_write

        subflow = getattr(workspace_step, "subflow", None)
        path = getattr(subflow, "path", None)
        if not path:
            return
        subflow_path = Path(path)
        data = json_read(subflow_path)
        steps = data.get("steps", []) if isinstance(data, dict) else []
        if not isinstance(steps, list):
            return
        for step in steps:
            if not isinstance(step, dict):
                continue
            step.update(
                {
                    "state": "Unstart",
                    "runtime": "",
                    "peak memory (mb)": 0,
                    "info": {},
                }
            )
        json_write(subflow_path, {"path": str(subflow_path), "steps": steps})
        subflow.steps = steps

    @staticmethod
    def _reset_step_checklist(workspace_step) -> None:
        from chipcompiler.data import Checklist

        checklist = getattr(workspace_step, "checklist", None)
        path = getattr(checklist, "path", None)
        if not path:
            return
        checklist_path = Path(path)
        Checklist(checklist_path).replace([])
        checklist.checklist = []

    @staticmethod
    def _step_artifact_dirs(step) -> tuple[Path, ...]:
        directories: list[Path] = []
        for field in ("output", "data", "feature", "analysis", "report", "log"):
            value = getattr(step, field, {})
            directory = value.get("dir") if isinstance(value, dict) else getattr(value, "dir", None)
            if directory:
                directories.append(Path(directory))
        return tuple(dict.fromkeys(directories))

    @staticmethod
    def _clear_step_artifact_dir(
        workspace_root: Path,
        directory: Path,
        step_name: str,
    ) -> None:
        WorkspaceRuntimeApi._validate_step_artifact_dir(workspace_root, directory, step_name)
        if directory.exists():
            if not directory.is_dir():
                raise RuntimeApiError(
                    "command_failed",
                    f"step artifact is not a directory: {step_name}",
                )
            shutil.rmtree(directory)
        directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _validate_step_artifact_dir(
        workspace_root: Path,
        directory: Path,
        step_name: str,
    ) -> Path:
        resolved = directory.resolve()
        if (
            resolved == workspace_root
            or not path_is_within(resolved, workspace_root)
            or directory.is_symlink()
        ):
            raise RuntimeApiError(
                "command_failed",
                f"step artifact escapes workspace: {step_name}",
            )
        if directory.exists() and not directory.is_dir():
            raise RuntimeApiError(
                "command_failed",
                f"step artifact is not a directory: {step_name}",
            )
        return resolved


def _layout_edit_begin_result(edit_session: LayoutEditSession, *, reused: bool) -> dict:
    return {
        "editSessionId": edit_session.edit_session_id,
        "workspaceId": edit_session.workspace_id,
        "step": edit_session.step_name,
        "source": edit_session.source_kind,
        "sourceFingerprint": edit_session.source_fingerprint,
        "geometryManifestPath": str(edit_session.geometry_output_dir / "geometry.manifest"),
        "revision": edit_session.revision,
        "geometryRevision": edit_session.geometry_revision,
        "dirty": edit_session.dirty,
        "reused": reused,
    }


def _layout_edit_save_result(
    edit_session: LayoutEditSession,
    *,
    saved: bool,
    artifacts: dict[str, str] | None = None,
) -> dict:
    if artifacts is None:
        artifacts = _layout_edit_published_artifacts(edit_session.workspace_step)
    return {
        "editSessionId": edit_session.edit_session_id,
        "revision": edit_session.revision,
        "geometryRevision": edit_session.geometry_revision,
        "dirty": edit_session.dirty,
        "saved": saved,
        "sourceFingerprint": edit_session.source_fingerprint,
        "artifacts": artifacts,
    }


def _layout_edit_published_artifacts(workspace_step) -> dict:
    geometry_dir = _path_or_none(_workspace_step_output_value(workspace_step, "geometry"))
    geometry_manifest = _path_or_none(
        _workspace_step_output_value(workspace_step, "geometry_manifest")
    )
    if geometry_manifest is None and geometry_dir is not None:
        geometry_manifest = geometry_dir / "geometry.manifest"
    return {
        "defPath": _path_text(_workspace_step_output_value(workspace_step, "def")),
        "dbPath": _path_text(_workspace_step_output_value(workspace_step, "db")),
        "gdsPath": _path_text(_workspace_step_output_value(workspace_step, "gds")),
        "geometryManifestPath": str(geometry_manifest) if geometry_manifest else "",
    }


def _layout_edit_source(workspace_step) -> tuple[str, tuple[Path, ...]]:
    output_db = _path_or_none(_workspace_step_output_value(workspace_step, "db"))
    if output_db is not None and output_db.is_dir():
        return "db", (output_db,)

    output_def = _existing_layout_def_path(_workspace_step_output_value(workspace_step, "def"))
    if output_def is not None:
        return "def", (output_def,)

    raise RuntimeApiError(
        "command_failed",
        f"layout edit source missing for step: {getattr(workspace_step, 'name', '')}",
    )


def _layout_edit_workspace_step(
    workspace_step,
    *,
    source_kind: str,
    source_paths: tuple[Path, ...],
):
    edit_input = copy(getattr(workspace_step, "input", {}))
    output_def = _existing_layout_def_path(_workspace_step_output_value(workspace_step, "def"))
    if isinstance(edit_input, dict):
        edit_input["db"] = source_paths[0] if source_kind == "db" else None
        edit_input["def"] = output_def
        edit_step = copy(workspace_step)
        edit_step.input = edit_input
        return edit_step

    edit_input.db = source_paths[0] if source_kind == "db" else None
    edit_input.def_ = output_def
    return replace(workspace_step, input=edit_input)


_FLOORPLAN_EDITOR_OPERATION_KINDS = frozenset(
    {
        "set_floorplan_outline",
        "replace_tracks",
        "upsert_io_pin_port",
        "upsert_blockage",
        "delete_blockage",
        "upsert_instance_halo",
        "delete_instance_halo",
        "pdn.plan.patch",
        "pdn.manual_segment.upsert",
        "pdn.manual_segment.delete",
        "pdn.manual_via.upsert",
        "pdn.manual_via.delete",
        "run_auto",
    }
)


def _apply_layout_edit_operation(
    edit_session: LayoutEditSession,
    *,
    command_id: object,
    base_revision: object,
    operation: object,
) -> dict:
    if not isinstance(command_id, str) or not command_id.strip():
        raise RuntimeApiError("invalid_request", "missing required field: command_id")

    previous_result = edit_session.command_results.get(command_id)
    if previous_result is not None:
        return previous_result

    _validate_layout_edit_revision(base_revision, "base_revision")
    if base_revision != edit_session.revision:
        raise RuntimeApiError(
            "version_conflict",
            "layout edit revision does not match",
            {
                "expectedRevision": base_revision,
                "actualRevision": edit_session.revision,
            },
        )
    if not isinstance(operation, dict):
        raise RuntimeApiError("invalid_request", "operation must be an object")

    kind = operation.get("kind")
    if kind == "place_instance":
        result = _apply_layout_edit_place_instance(edit_session, command_id, operation)
    else:
        result = _apply_floorplan_editor_operation(edit_session, command_id, operation)
    edit_session.command_results[command_id] = result
    return result


def _apply_layout_edit_place_instance(
    edit_session: LayoutEditSession,
    command_id: str,
    operation: dict[str, Any],
) -> dict:
    placement = _layout_edit_place_instance_operation(operation)
    module = _db_engine_module(edit_session.db_handle)
    place_instance = getattr(module, "place_instance", None)
    if not callable(place_instance):
        raise RuntimeApiError("command_failed", "place_instance is unavailable")

    accepted = place_instance(
        inst_name=placement["inst_name"],
        llx=placement["llx"],
        lly=placement["lly"],
        orient=placement["orient"],
        cellmaster=placement["cellmaster"],
        source=placement["source"],
        placement_status=placement["placement_status"],
        create_if_missing=placement["create_if_missing"],
    )
    if not accepted:
        raise RuntimeApiError(
            "placement_rejected",
            "place_instance rejected the requested placement",
            {"instanceName": placement["inst_name"]},
        )

    geometry_delta = _sync_layout_edit_instance_geometry(module, placement["inst_name"])
    geometry_manifest_path = _advance_layout_edit_geometry_snapshot(edit_session, module)
    edit_session.revision += 1
    edit_session.geometry_revision += 1
    edit_session.dirty = True
    if placement["create_if_missing"]:
        edit_session.requires_verilog = True
    return {
        "editSessionId": edit_session.edit_session_id,
        "commandId": command_id,
        "revision": edit_session.revision,
        "geometryRevision": edit_session.geometry_revision,
        "geometryManifestPath": str(geometry_manifest_path),
        "dirty": True,
        "operation": {
            "kind": "place_instance",
            "instanceName": placement["inst_name"],
            "origin": {"x": placement["llx"], "y": placement["lly"]},
            "orient": placement["orient"],
        },
        "geometryDelta": geometry_delta,
    }


def _apply_floorplan_editor_operation(
    edit_session: LayoutEditSession,
    command_id: str,
    operation: dict[str, Any],
) -> dict:
    kind = operation.get("kind")
    if not isinstance(kind, str) or kind not in _FLOORPLAN_EDITOR_OPERATION_KINDS:
        raise RuntimeApiError("invalid_request", "unsupported layout edit operation")

    module = _db_engine_module(edit_session.db_handle)
    editor_result = _floorplan_editor_apply(module, operation)
    if not _floorplan_editor_accepted(editor_result):
        diagnostics = _floorplan_diagnostics(editor_result)
        raise RuntimeApiError(
            "floorplan_rejected",
            "floorplan editor rejected the requested operation",
            {"operationKind": kind, "diagnostics": diagnostics},
        )

    model_patch = _floorplan_model_patch(editor_result)
    _merge_floorplan_model_patch(edit_session, model_patch)
    diagnostics = _floorplan_diagnostics(editor_result)
    edit_session.validation_diagnostics = diagnostics
    changed = bool(editor_result.get("changed", True))
    geometry_delta = _floorplan_geometry_delta(editor_result)
    geometry_manifest_path = edit_session.geometry_output_dir / "geometry.manifest"
    if changed:
        geometry_manifest_path = _advance_layout_edit_geometry_snapshot(edit_session, module)
        edit_session.revision += 1
        edit_session.geometry_revision += 1
        edit_session.dirty = True
    edit_session.used_floorplan_editor = True
    if _floorplan_bool(editor_result, "instancesChanged", "instances_changed") or _floorplan_bool(
        model_patch,
        "instancesChanged",
        "instances_changed",
    ):
        edit_session.requires_verilog = True

    return {
        "editSessionId": edit_session.edit_session_id,
        "commandId": command_id,
        "revision": edit_session.revision,
        "geometryRevision": edit_session.geometry_revision,
        "geometryManifestPath": str(geometry_manifest_path),
        "dirty": edit_session.dirty,
        "operation": {"kind": kind},
        "affectedRefs": _floorplan_affected_refs(editor_result),
        "geometryDelta": geometry_delta,
        "modelPatch": model_patch,
        "diagnostics": diagnostics,
        "changed": changed,
    }


def _advance_layout_edit_geometry_snapshot(edit_session: LayoutEditSession, module) -> Path:
    next_geometry_output_dir = (
        edit_session.geometry_output_dir.parent / f"geometry-{edit_session.geometry_revision + 1}"
    )
    geometry_manifest_path = _write_layout_edit_geometry_snapshot(module, next_geometry_output_dir)
    previous_geometry_output_dir = edit_session.geometry_output_dir
    edit_session.geometry_output_dir = next_geometry_output_dir
    shutil.rmtree(previous_geometry_output_dir, ignore_errors=True)
    return geometry_manifest_path


def _floorplan_editor_apply(module, operation: dict[str, Any]) -> dict[str, Any]:
    apply = getattr(module, "floorplan_editor_apply", None)
    if not callable(apply):
        apply = getattr(module, "floorplan_edit_apply", None)
    if not callable(apply):
        raise RuntimeApiError("command_failed", "floorplan editor is unavailable")
    payload = deepcopy(operation)
    result = _call_floorplan_editor_apply(apply, payload)
    if not isinstance(result, dict):
        raise RuntimeApiError("command_failed", "floorplan editor returned an invalid result")
    return result


def _call_floorplan_editor_apply(apply, payload: dict[str, Any]):
    try:
        signature = inspect.signature(apply)
    except (TypeError, ValueError):
        return apply(request=payload)

    parameters = signature.parameters.values()
    accepts_keyword_request = "request" in signature.parameters or any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters
    )
    if accepts_keyword_request:
        return apply(request=payload)
    return apply(payload)


def _floorplan_editor_inspect(module) -> dict[str, Any]:
    inspect = getattr(module, "floorplan_editor_inspect", None)
    if not callable(inspect):
        inspect = getattr(module, "floorplan_edit_inspect", None)
    if not callable(inspect):
        return {}
    result = inspect()
    return deepcopy(result) if isinstance(result, dict) else {}


def _floorplan_editor_validate(module, scope: str) -> dict[str, Any]:
    validate = getattr(module, "floorplan_editor_validate", None)
    if not callable(validate):
        validate = getattr(module, "floorplan_validate", None)
    if not callable(validate):
        return {"ok": True, "diagnostics": []}
    try:
        result = validate(scope=scope)
    except TypeError:
        result = validate(scope)
    if not isinstance(result, dict):
        raise RuntimeApiError("command_failed", "floorplan validation returned an invalid result")
    return result


def _floorplan_editor_export_intent(module) -> dict[str, Any]:
    export_intent = getattr(module, "floorplan_editor_export_intent", None)
    if not callable(export_intent):
        export_intent = getattr(module, "floorplan_export_intent", None)
    if not callable(export_intent):
        raise RuntimeApiError("command_failed", "floorplan editor export is unavailable")
    result = export_intent()
    if not isinstance(result, dict):
        raise RuntimeApiError(
            "command_failed", "floorplan editor export returned an invalid result"
        )
    if not _floorplan_editor_accepted(result):
        raise RuntimeApiError(
            "command_failed",
            "floorplan editor failed to export edit intent",
            {"diagnostics": _floorplan_diagnostics(result)},
        )
    return result


def _floorplan_editor_accepted(result: dict[str, Any]) -> bool:
    return bool(result.get("accepted", result.get("ok", False)))


def _floorplan_validation_ok(result: dict[str, Any]) -> bool:
    return bool(result.get("ok", result.get("accepted", False)))


def _floorplan_diagnostics(result: dict[str, Any]) -> list[dict[str, Any]]:
    raw = result.get("diagnostics", [])
    if not isinstance(raw, list):
        return []
    diagnostics = []
    for item in raw:
        if isinstance(item, dict):
            diagnostics.append(deepcopy(item))
        elif isinstance(item, str):
            diagnostics.append({"message": item})
    return diagnostics


def _floorplan_affected_refs(result: dict[str, Any]) -> list[Any]:
    refs = result.get("affectedRefs", result.get("affected_refs", []))
    return deepcopy(refs) if isinstance(refs, list) else []


def _floorplan_geometry_delta(result: dict[str, Any]) -> dict[str, Any]:
    delta = result.get("geometryDelta", result.get("geometry_delta", {}))
    if not isinstance(delta, dict):
        delta = {}
    return {
        "ok": bool(delta.get("ok", True)),
        "snapshotRequired": bool(
            delta.get(
                "snapshotRequired",
                delta.get(
                    "snapshot_required",
                    result.get("snapshotRequired", result.get("snapshot_required", False)),
                ),
            )
        ),
        "updatedShapeCount": _geometry_delta_count(delta, "updatedShapeCount"),
        "insertedShapeCount": _geometry_delta_count(delta, "insertedShapeCount"),
        "deletedShapeCount": _geometry_delta_count(delta, "deletedShapeCount"),
        "missingShapeCount": _geometry_delta_count(delta, "missingShapeCount"),
        "events": deepcopy(delta.get("events", []))
        if isinstance(delta.get("events", []), list)
        else [],
    }


def _floorplan_model_patch(result: dict[str, Any]) -> dict[str, Any]:
    patch = result.get("modelPatch", result.get("model_patch", {}))
    if patch is None:
        return {}
    if not isinstance(patch, dict):
        raise RuntimeApiError("command_failed", "floorplan editor returned an invalid model patch")
    return deepcopy(patch)


def _floorplan_bool(data: dict[str, Any], *keys: str) -> bool:
    return any(bool(data.get(key, False)) for key in keys)


def _merge_floorplan_model_patch(
    edit_session: LayoutEditSession, model_patch: dict[str, Any]
) -> None:
    floorplan_plan = _floorplan_patch_mapping(model_patch, "floorplanPlan", "floorplan_plan")
    pdn_plan = _floorplan_patch_mapping(model_patch, "pdnPlan", "pdn_plan")
    config_patch = _floorplan_patch_mapping(model_patch, "configPatch", "config_patch")
    parameters_patch = _floorplan_patch_mapping(
        model_patch,
        "parametersPatch",
        "parameters_patch",
    )
    _deep_merge(edit_session.floorplan_plan, floorplan_plan)
    _deep_merge(edit_session.pdn_plan, pdn_plan)
    _deep_merge(edit_session.config_patch, config_patch)
    _deep_merge(edit_session.parameters_patch, parameters_patch)


def _merge_floorplan_export_intent(edit_session: LayoutEditSession, intent: dict[str, Any]) -> None:
    nested_intent = intent.get("intent")
    if isinstance(nested_intent, dict):
        intent = nested_intent
    _merge_floorplan_model_patch(edit_session, intent)
    if _floorplan_bool(intent, "requiresVerilog", "requires_verilog"):
        edit_session.requires_verilog = True


def _floorplan_patch_mapping(data: dict[str, Any], *keys: str) -> dict[str, Any]:
    present = [key for key in keys if key in data]
    if len(present) > 1:
        raise RuntimeApiError("command_failed", f"duplicate floorplan model patch field: {keys[0]}")
    if not present:
        return {}
    value = data[present[0]]
    if not isinstance(value, dict):
        raise RuntimeApiError(
            "command_failed", f"floorplan model patch field must be an object: {keys[0]}"
        )
    return deepcopy(value)


def _deep_merge(target: dict[str, Any], patch: dict[str, Any]) -> None:
    for key, value in patch.items():
        current = target.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            _deep_merge(current, value)
        else:
            target[key] = deepcopy(value)


def _layout_edit_place_instance_operation(operation: object) -> dict[str, Any]:
    if not isinstance(operation, dict):
        raise RuntimeApiError("invalid_request", "operation must be an object")
    if operation.get("kind") != "place_instance":
        raise RuntimeApiError("invalid_request", "unsupported layout edit operation")

    inst_name = _layout_edit_text(operation, "inst_name", "instName")
    cellmaster = _layout_edit_optional_text(operation, "cellmaster", "cellMaster")
    source = _layout_edit_optional_text(operation, "source")
    placement_status = (
        _layout_edit_optional_text(
            operation,
            "placement_status",
            "placementStatus",
        )
        or "preserve"
    )
    create_if_missing = _layout_edit_optional_bool(
        operation,
        "create_if_missing",
        "createIfMissing",
        default=False,
    )
    orient = _layout_edit_optional_text(operation, "orient")
    if not orient and (placement_status != "preserve" or create_if_missing):
        raise RuntimeApiError("invalid_request", "missing required operation field: orient")
    return {
        "inst_name": inst_name,
        "llx": _layout_edit_integer(operation, "llx"),
        "lly": _layout_edit_integer(operation, "lly"),
        "orient": orient,
        "cellmaster": cellmaster,
        "source": source,
        "placement_status": placement_status,
        "create_if_missing": create_if_missing,
    }


def _layout_edit_text(operation: dict, *keys: str) -> str:
    value = _layout_edit_value(operation, *keys)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeApiError("invalid_request", f"missing required operation field: {keys[0]}")
    return value


def _layout_edit_optional_text(operation: dict, *keys: str) -> str:
    value = _layout_edit_value(operation, *keys, default="")
    if not isinstance(value, str):
        raise RuntimeApiError("invalid_request", f"operation field must be a string: {keys[0]}")
    return value


def _layout_edit_integer(operation: dict, *keys: str) -> int:
    value = _layout_edit_value(operation, *keys)
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuntimeApiError("invalid_request", f"operation field must be an integer: {keys[0]}")
    return value


def _layout_edit_optional_bool(
    operation: dict,
    *keys: str,
    default: bool,
) -> bool:
    value = _layout_edit_value(operation, *keys, default=default)
    if not isinstance(value, bool):
        raise RuntimeApiError("invalid_request", f"operation field must be a boolean: {keys[0]}")
    return value


def _layout_edit_value(operation: dict, *keys: str, default: object = None):
    present = [key for key in keys if key in operation]
    if len(present) > 1:
        raise RuntimeApiError("invalid_request", f"duplicate operation field: {keys[0]}")
    return operation[present[0]] if present else default


def _validate_layout_edit_revision(value: object, field_name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise RuntimeApiError("invalid_request", f"{field_name} must be a non-negative integer")


def _sync_layout_edit_instance_geometry(module, inst_name: str) -> dict:
    sync_instance = getattr(module, "sync_instance_geometry", None)
    if not callable(sync_instance):
        return {
            "ok": False,
            "snapshotRequired": True,
            "updatedShapeCount": 0,
            "insertedShapeCount": 0,
            "deletedShapeCount": 0,
            "missingShapeCount": 0,
            "events": [],
        }

    result = sync_instance(inst_name)
    if not isinstance(result, dict):
        return {
            "ok": False,
            "snapshotRequired": True,
            "updatedShapeCount": 0,
            "insertedShapeCount": 0,
            "deletedShapeCount": 0,
            "missingShapeCount": 0,
            "events": [],
        }
    return {
        "ok": bool(result.get("ok", False)),
        "snapshotRequired": bool(result.get("snapshotRequired", False)),
        "updatedShapeCount": _geometry_delta_count(result, "updatedShapeCount"),
        "insertedShapeCount": _geometry_delta_count(result, "insertedShapeCount"),
        "deletedShapeCount": _geometry_delta_count(result, "deletedShapeCount"),
        "missingShapeCount": _geometry_delta_count(result, "missingShapeCount"),
        "events": result.get("events", []) if isinstance(result.get("events", []), list) else [],
    }


def _write_layout_edit_geometry_snapshot(module, output_dir: Path) -> Path:
    save_snapshot = getattr(module, "geometry_session_snapshot_save", None)
    if not callable(save_snapshot):
        save_snapshot = getattr(module, "geometry_snapshot_save", None)
    if not callable(save_snapshot) or not save_snapshot(output_dir=str(output_dir)):
        raise RuntimeApiError("command_failed", "failed to write layout edit geometry snapshot")
    manifest = output_dir / "geometry.manifest"
    if not manifest.is_file():
        raise RuntimeApiError("command_failed", "layout edit geometry manifest is missing")
    return manifest


def _geometry_delta_count(delta: dict, key: str) -> int:
    value = delta.get(key, 0)
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _publish_layout_edit_artifacts(edit_session: LayoutEditSession, workspace) -> dict[str, str]:
    targets = _layout_edit_publish_targets(edit_session.workspace_step)
    staged_workspace_data = _layout_edit_workspace_staging(edit_session, workspace)
    targets.update(staged_workspace_data["targets"])
    stage_parent = _layout_edit_stage_parent(targets.values())
    stage_root = Path(
        tempfile.mkdtemp(prefix=f".layout-edit-{edit_session.edit_session_id}-", dir=stage_parent)
    )
    staged = {key: stage_root / key / target.name for key, target in targets.items()}
    try:
        module = _db_engine_module(edit_session.db_handle)
        for staged_path in staged.values():
            staged_path.parent.mkdir(parents=True, exist_ok=True)
        module.def_save(def_path=str(staged["def"]))
        module.save_data(path=str(staged["db"]))
        module.gds_save(output_path=str(staged["gds"]))
        if not module.geometry_snapshot_save(output_dir=str(staged["geometry"])):
            raise RuntimeApiError("command_failed", "failed to export layout geometry snapshot")
        _stage_layout_edit_workspace_json(staged, staged_workspace_data)
        _stage_layout_edit_verilog(module, staged, edit_session)
        _validate_layout_edit_staging(staged, targets)
        _validate_layout_edit_workspace_staging(staged, staged_workspace_data)
        _publish_staged_layout_edit_artifacts(stage_root, staged, targets)
    except RuntimeApiError:
        raise
    except Exception as exc:
        raise RuntimeApiError("command_failed", f"failed to publish layout edit: {exc}") from exc
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)

    _apply_layout_edit_workspace_staging(workspace, staged_workspace_data)
    artifacts = _layout_edit_published_artifacts(edit_session.workspace_step)
    artifacts.update(staged_workspace_data["artifacts"])
    return artifacts


def _layout_edit_workspace_staging(
    edit_session: LayoutEditSession,
    workspace,
) -> dict[str, Any]:
    targets: dict[str, Path] = {}
    json_data: dict[str, dict[str, Any]] = {}
    artifacts: dict[str, str] = {}
    result: dict[str, Any] = {
        "targets": targets,
        "json": json_data,
        "artifacts": artifacts,
        "parametersData": None,
        "flowData": None,
    }

    if edit_session.used_floorplan_editor:
        config_target = _floorplan_config_target(workspace)
        config_data = _read_layout_edit_json(config_target)
        _deep_merge(config_data, edit_session.config_patch)
        config_data["FloorplanPlan"] = deepcopy(edit_session.floorplan_plan)
        config_data["PdnPlan"] = deepcopy(edit_session.pdn_plan)
        targets["config"] = config_target
        json_data["config"] = config_data
        artifacts["configPath"] = str(config_target)

    if edit_session.parameters_patch:
        parameter_target = _workspace_path(workspace, "parameters", "path")
        if parameter_target is None:
            raise RuntimeApiError("command_failed", "workspace parameters path is missing")
        parameter_data = deepcopy(getattr(getattr(workspace, "parameters", None), "data", {}) or {})
        if not isinstance(parameter_data, dict):
            raise RuntimeApiError("command_failed", "workspace parameters are invalid")
        _deep_merge(parameter_data, edit_session.parameters_patch)
        targets["parameters"] = parameter_target
        json_data["parameters"] = parameter_data
        artifacts["parametersPath"] = str(parameter_target)
        result["parametersData"] = parameter_data

    if edit_session.requires_verilog:
        verilog_target = _path_or_none(
            _workspace_step_output_value(edit_session.workspace_step, "verilog")
        )
        if verilog_target is None:
            raise RuntimeApiError("command_failed", "layout edit output Verilog is missing")
        targets["verilog"] = verilog_target
        artifacts["verilogPath"] = str(verilog_target)

    flow_target = _workspace_path(workspace, "flow", "path")
    flow_data = deepcopy(getattr(getattr(workspace, "flow", None), "data", {}) or {})
    if (
        flow_target is not None
        and isinstance(flow_data, dict)
        and _mark_placement_and_later_stale(flow_data, edit_session.step_name)
    ):
        targets["flow"] = flow_target
        json_data["flow"] = flow_data
        artifacts["flowPath"] = str(flow_target)
        result["flowData"] = flow_data

    return result


def _floorplan_config_target(workspace) -> Path:
    config = getattr(workspace, "config", {})
    if isinstance(config, dict):
        config_target = _path_or_none(config.get("Floorplan"))
        if config_target is not None:
            return config_target
    workspace_directory = _path_or_none(getattr(workspace, "directory", None))
    if workspace_directory is None:
        raise RuntimeApiError("command_failed", "workspace directory is missing")
    return workspace_directory / "config" / "floorplan_ecc.json"


def _workspace_path(workspace, owner_name: str, path_name: str) -> Path | None:
    owner = getattr(workspace, owner_name, None)
    return _path_or_none(getattr(owner, path_name, None))


def _read_layout_edit_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeApiError("command_failed", f"failed to read JSON artifact: {path}") from exc
    if not isinstance(data, dict):
        raise RuntimeApiError("command_failed", f"JSON artifact must contain an object: {path}")
    return data


def _stage_layout_edit_workspace_json(
    staged: dict[str, Path],
    workspace_staging: dict[str, Any],
) -> None:
    for key, data in workspace_staging["json"].items():
        staged_path = staged[key]
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        staged_path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _stage_layout_edit_verilog(
    module, staged: dict[str, Path], edit_session: LayoutEditSession
) -> None:
    if "verilog" not in staged:
        return
    save_verilog = getattr(module, "verilog_save", None)
    if not callable(save_verilog):
        raise RuntimeApiError("command_failed", "verilog_save is unavailable")
    staged["verilog"].parent.mkdir(parents=True, exist_ok=True)
    save_verilog(output_verilog=str(staged["verilog"]))


def _validate_layout_edit_workspace_staging(
    staged: dict[str, Path],
    workspace_staging: dict[str, Any],
) -> None:
    for key in workspace_staging["json"]:
        if not staged[key].is_file():
            raise RuntimeApiError("command_failed", f"layout edit staged {key} is missing")
        _read_layout_edit_json(staged[key])
    if "verilog" in staged and not staged["verilog"].is_file():
        raise RuntimeApiError("command_failed", "layout edit staged Verilog is missing")


def _apply_layout_edit_workspace_staging(workspace, workspace_staging: dict[str, Any]) -> None:
    parameters_data = workspace_staging["parametersData"]
    if parameters_data is not None:
        workspace.parameters.data = parameters_data
    flow_data = workspace_staging["flowData"]
    if flow_data is not None:
        workspace.flow.data = flow_data


def _mark_placement_and_later_stale(flow_data: dict[str, Any], step_name: str) -> bool:
    if step_name != "Floorplan":
        return False
    steps = flow_data.get("steps")
    if not isinstance(steps, list):
        return False
    placement_index = next(
        (
            index
            for index, step in enumerate(steps)
            if isinstance(step, dict) and step.get("name") == "place"
        ),
        None,
    )
    if placement_index is None:
        return False
    changed = False
    for step in steps[placement_index:]:
        if not isinstance(step, dict):
            continue
        desired = {
            "state": "Unstart",
            "runtime": "",
            "peak memory (mb)": 0,
        }
        for key, value in desired.items():
            if step.get(key) != value:
                step[key] = value
                changed = True
    return changed


def _layout_edit_publish_targets(workspace_step) -> dict[str, Path]:
    targets = {
        key: _path_or_none(_workspace_step_output_value(workspace_step, key))
        for key in ("def", "db", "gds", "geometry")
    }
    missing = [key for key, path in targets.items() if path is None]
    if missing:
        raise RuntimeApiError(
            "command_failed",
            f"layout edit output paths missing: {', '.join(missing)}",
        )
    return targets


def _layout_edit_stage_parent(paths) -> Path:
    parents = [str(path.parent) for path in paths]
    common_parent = Path(os.path.commonpath(parents))
    common_parent.mkdir(parents=True, exist_ok=True)
    return common_parent


def _validate_layout_edit_staging(staged: dict[str, Path], targets: dict[str, Path]) -> None:
    manifest = _geometry_manifest_path(staged["geometry"], targets["geometry"], targets)
    missing = []
    if not staged["def"].is_file():
        missing.append("def")
    if not staged["gds"].is_file():
        missing.append("gds")
    if not staged["db"].is_dir() or not any(staged["db"].iterdir()):
        missing.append("db")
    if not manifest.is_file():
        missing.append("geometry_manifest")
    if missing:
        raise RuntimeApiError(
            "command_failed",
            f"layout edit staging validation failed: {', '.join(missing)}",
        )


def _geometry_manifest_path(
    geometry_dir: Path,
    target_geometry_dir: Path,
    targets: dict[str, Path],
) -> Path:
    target_manifest = targets.get("geometry_manifest")
    if target_manifest is None:
        return geometry_dir / "geometry.manifest"
    try:
        return geometry_dir / target_manifest.relative_to(target_geometry_dir)
    except ValueError:
        return geometry_dir / "geometry.manifest"


def _publish_staged_layout_edit_artifacts(
    stage_root: Path,
    staged: dict[str, Path],
    targets: dict[str, Path],
) -> None:
    artifact_keys = tuple(targets)
    backup_dir = stage_root / "backup"
    backup_dir.mkdir()
    journal_path = stage_root / "publish.journal"
    journal_path.write_text(
        json.dumps({"state": "prepared", "artifacts": artifact_keys}),
        encoding="utf-8",
    )
    backups: list[str] = []
    published: list[str] = []
    try:
        for key in artifact_keys:
            target = targets[key]
            if target.exists() or target.is_symlink():
                os.replace(target, backup_dir / key)
                backups.append(key)
        journal_path.write_text(
            json.dumps({"state": "backed_up", "artifacts": backups}),
            encoding="utf-8",
        )
        for key in artifact_keys:
            target = targets[key]
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged[key], target)
            published.append(key)
        journal_path.write_text(
            json.dumps({"state": "published", "artifacts": published}),
            encoding="utf-8",
        )
    except Exception:
        for key in reversed(published):
            _remove_layout_edit_path(targets[key])
        for key in reversed(backups):
            os.replace(backup_dir / key, targets[key])
        raise


def _remove_layout_edit_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _db_engine_module(db_handle):
    module = getattr(db_handle, "engine", None)
    if module is None:
        module = getattr(db_handle, "ecc_module", None)
    if module is None:
        raise RuntimeApiError("command_failed", "layout edit DB module is unavailable")
    return module


def _path_or_none(value: object) -> Path | None:
    if value is None or value == "":
        return None
    return Path(value)


def _workspace_step_output_value(workspace_step, key: str):
    output = getattr(workspace_step, "output", {})
    if isinstance(output, dict):
        return output.get(key)
    return getattr(output, "def_" if key == "def" else key, None)


def _path_text(value: object) -> str:
    path = _path_or_none(value)
    return str(path) if path is not None else ""


def _existing_layout_def_path(value: object) -> Path | None:
    path = _path_or_none(value)
    if path is None:
        return None
    candidates = (path, Path(f"{path}.gz"))
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _artifact_fingerprint(paths: tuple[Path, ...]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        resolved_path = path.resolve()
        digest.update(str(resolved_path).encode("utf-8"))
        if resolved_path.is_dir():
            for item in sorted(resolved_path.rglob("*")):
                if not item.is_file():
                    continue
                stat = item.stat()
                digest.update(str(item.relative_to(resolved_path)).encode("utf-8"))
                digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode("ascii"))
        elif resolved_path.is_file():
            stat = resolved_path.stat()
            digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode("ascii"))
        else:
            digest.update(b"missing")
    return digest.hexdigest()


def _db_ensure_result(
    *,
    workspace_id: str,
    step: str,
    active: bool,
    reused: bool,
) -> dict:
    return {
        "workspaceId": workspace_id,
        "enabled": True,
        "active": active,
        "reused": reused,
        "step": step,
    }


def _db_handle_is_initialized(db_handle) -> bool:
    return db_handle is not None and db_handle.has_init()


def _close_db_handle(db_handle) -> None:
    close = getattr(db_handle, "close", None)
    if callable(close):
        close()
