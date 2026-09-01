import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class WorkspaceSession:
    workspace_id: str
    workspace_revision: int
    directory: Path
    workspace: Any
    execution_readiness: dict[str, Any] = field(default_factory=lambda: {"ready": True})
    workspace_bindings: dict[str, Any] | None = None
    db_handle: Any = None
    layout_edit_session: "LayoutEditSession | None" = None
    mutation_lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class LayoutEditSession:
    edit_session_id: str
    workspace_id: str
    step_name: str
    workspace_step: Any
    db_handle: Any
    source_kind: str
    source_paths: tuple[Path, ...]
    source_fingerprint: str
    geometry_output_dir: Path
    revision: int = 0
    geometry_revision: int = 0
    dirty: bool = False
    command_results: dict[str, dict[str, Any]] = field(default_factory=dict)
    floorplan_plan: dict[str, Any] = field(default_factory=dict)
    pdn_plan: dict[str, Any] = field(default_factory=dict)
    config_patch: dict[str, Any] = field(default_factory=dict)
    parameters_patch: dict[str, Any] = field(default_factory=dict)
    requires_verilog: bool = False
    used_floorplan_editor: bool = False
    validation_diagnostics: list[dict[str, Any]] = field(default_factory=list)


class WorkspaceSessionNotFound(KeyError):
    pass


def _close_db_handle(db_handle: Any) -> None:
    close = getattr(db_handle, "close", None)
    if callable(close):
        close()


class WorkspaceSessionRegistry:
    def __init__(self, db_releaser: Callable[[Any], None] | None = _close_db_handle):
        self._next_id = 1
        self._sessions: dict[str, WorkspaceSession] = {}
        self._sessions_by_directory: dict[Path, str] = {}
        self._db_releaser = db_releaser
        self._lock = threading.Lock()

    def create_session(
        self,
        directory: str | Path,
        *,
        workspace: Any,
        workspace_id: str | None = None,
        workspace_revision: int = 0,
        execution_readiness: dict[str, Any] | None = None,
        workspace_bindings: dict[str, Any] | None = None,
    ) -> WorkspaceSession:
        resolved_directory = Path(directory).resolve()
        with self._lock:
            existing_id = self._sessions_by_directory.get(resolved_directory)
            if existing_id is not None:
                self._remove_session(existing_id)
            return self._create_session(
                resolved_directory,
                workspace=workspace,
                workspace_id=workspace_id,
                workspace_revision=workspace_revision,
                execution_readiness=execution_readiness,
                workspace_bindings=workspace_bindings,
            )

    def open_session(
        self,
        directory: str | Path,
        *,
        workspace: Any,
        workspace_id: str | None = None,
        workspace_revision: int = 0,
        execution_readiness: dict[str, Any] | None = None,
        workspace_bindings: dict[str, Any] | None = None,
    ) -> WorkspaceSession:
        resolved_directory = Path(directory).resolve()
        with self._lock:
            existing_id = self._sessions_by_directory.get(resolved_directory)
            if existing_id is not None:
                return self._sessions[existing_id]

            return self._create_session(
                resolved_directory,
                workspace=workspace,
                workspace_id=workspace_id,
                workspace_revision=workspace_revision,
                execution_readiness=execution_readiness,
                workspace_bindings=workspace_bindings,
            )

    def get_session(self, workspace_id: str) -> WorkspaceSession:
        try:
            return self._sessions[workspace_id]
        except KeyError as exc:
            raise WorkspaceSessionNotFound(workspace_id) from exc

    def close_session(self, workspace_id: str) -> None:
        with self._lock:
            self._remove_session(workspace_id)

    def close_all(self) -> None:
        with self._lock:
            for session in self._sessions.values():
                self._release_session_db(session)
                self._release_layout_edit_session(session)
            self._sessions.clear()
            self._sessions_by_directory.clear()

    def release_session_db(self, session: WorkspaceSession) -> bool:
        return self._release_session_db(session)

    def _create_session(
        self,
        directory: Path,
        *,
        workspace: Any,
        workspace_id: str | None,
        workspace_revision: int,
        execution_readiness: dict[str, Any] | None,
        workspace_bindings: dict[str, Any] | None,
    ) -> WorkspaceSession:
        if workspace_id is None:
            workspace_id = f"workspace-{self._next_id}"
            self._next_id += 1
        session = WorkspaceSession(
            workspace_id=workspace_id,
            workspace_revision=workspace_revision,
            directory=directory,
            workspace=workspace,
            execution_readiness=execution_readiness or {"ready": True},
            workspace_bindings=workspace_bindings,
        )
        self._sessions[workspace_id] = session
        self._sessions_by_directory[directory] = workspace_id
        return session

    def _remove_session(self, workspace_id: str) -> None:
        session = self._sessions.pop(workspace_id, None)
        if session is None:
            raise WorkspaceSessionNotFound(workspace_id)
        self._release_session_db(session)
        self._release_layout_edit_session(session)
        self._sessions_by_directory.pop(session.directory, None)

    def _release_session_db(self, session: WorkspaceSession) -> bool:
        db_handle = session.db_handle
        if db_handle is None:
            return False

        session.db_handle = None
        if self._db_releaser is not None:
            self._db_releaser(db_handle)
        return True

    def release_layout_edit_session(self, session: WorkspaceSession) -> bool:
        return self._release_layout_edit_session(session)

    def _release_layout_edit_session(self, session: WorkspaceSession) -> bool:
        layout_edit_session = session.layout_edit_session
        if layout_edit_session is None:
            return False

        session.layout_edit_session = None
        _reset_layout_edit_geometry_session(layout_edit_session.db_handle)
        if self._db_releaser is not None:
            self._db_releaser(layout_edit_session.db_handle)
        shutil.rmtree(layout_edit_session.geometry_output_dir.parent, ignore_errors=True)
        return True


def _reset_layout_edit_geometry_session(db_handle: Any) -> None:
    module = getattr(db_handle, "engine", None)
    if module is None:
        module = getattr(db_handle, "ecc_module", None)
    reset_geometry_session = getattr(module, "reset_geometry_session", None)
    if callable(reset_geometry_session):
        reset_geometry_session()
