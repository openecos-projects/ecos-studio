"""Persisted resume and Safe Shutdown controls for GUI optimization episodes."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Mapping

from ecos_agent.gui.provider_common import _Session, _objective_sha256
from ecos_agent.hashing import canonical_sha256
from ecos_agent.gui.support import _optional_text
from ecos_agent.optimization.runtime import epsilon_artifact_path

_RESUME_CONTEXT_SCHEMA = "ecos.optimization_provider_resume.v1"
_RESUME_CONTEXT_FILE = "provider-resume-context.v1.json"
_MAX_RESUME_CONTEXT_BYTES = 1024 * 1024
_SAFE_EPISODE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def optimization_resume_context_path(workspace: Path, episode_id: str) -> Path:
    if not _SAFE_EPISODE_ID.fullmatch(episode_id):
        raise ValueError("Optimization Episode identity is invalid.")
    root = workspace.resolve()
    path = root / ".agent" / "optimization" / episode_id / _RESUME_CONTEXT_FILE
    if not path.parent.resolve().is_relative_to(root):
        raise ValueError("Optimization Episode path is outside the Parent Workspace.")
    return path


def write_optimization_resume_context(session: _Session) -> None:
    workspace_text = session.rerun_workspace_path
    episode_id = session.optimization_episode_id
    if (
        not workspace_text
        or not episode_id
        or session.optimization_objective is None
        or session.optimization_objective_alignment is None
    ):
        raise ValueError("Optimization Episode recovery context is incomplete.")
    workspace = Path(workspace_text).resolve()
    path = optimization_resume_context_path(workspace, episode_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    value = {
        "schema_version": _RESUME_CONTEXT_SCHEMA,
        "session_id": session.session_id,
        "episode_id": episode_id,
        "workspace": str(workspace),
        "workspace_revision": session.workspace_revision,
        "objective": session.optimization_objective,
        "objective_sha256": session.optimization_objective_sha256,
        "parameter_policy_sha256": session.optimization_parameter_policy_sha256,
        "ecc_revision": session.optimization_ecc_revision,
        "objective_alignment": session.optimization_objective_alignment,
        "primary_metric": session.optimization_primary_metric,
        "active_objective": session.optimization_active_objective,
    }
    encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > _MAX_RESUME_CONTEXT_BYTES:
        raise ValueError("Optimization Episode recovery context is too large.")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encoded)
    os.replace(temporary, path)


def _read_optimization_resume_context(workspace: Path, episode_id: str) -> dict[str, Any]:
    path = optimization_resume_context_path(workspace, episode_id)
    if path.stat().st_size > _MAX_RESUME_CONTEXT_BYTES:
        raise ValueError("Optimization Episode recovery context is too large.")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != _RESUME_CONTEXT_SCHEMA:
        raise ValueError("Optimization Episode recovery context is invalid.")
    return value


def _mark_optimization_resume_stopped(
    workspace: Path, episode_id: str, context: dict[str, Any]
) -> None:
    path = optimization_resume_context_path(workspace, episode_id)
    context["terminal_state"] = "stopped"
    encoded = (json.dumps(context, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > _MAX_RESUME_CONTEXT_BYTES:
        raise ValueError("Optimization Episode recovery context is too large.")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encoded)
    os.replace(temporary, path)


class ProviderOptimizationRecoveryMixin:
    def prepare_optimization_shutdown(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        if not self._optimization_thread_active(session):
            return {"sessionId": session.session_id}
        session.optimization_shutdown_was_paused = session.optimization_pause.is_set()
        session.optimization_shutdown.set()
        session.optimization_pause.set()
        self._emit_optimization_status(session, "paused")
        return {"sessionId": session.session_id}

    def cancel_optimization_shutdown(self, request: Mapping[str, Any]) -> dict[str, str]:
        session = self._session(request)
        session.optimization_shutdown.clear()
        if self._optimization_thread_active(session):
            if session.optimization_shutdown_was_paused:
                session.optimization_pause.set()
                session.optimization_phase = "paused"
                self._emit_status(session, "awaiting_choice")
                self._emit_optimization_status(session, "paused")
            else:
                session.optimization_pause.clear()
                session.optimization_phase = "running"
                self._emit_status(session, "running")
                self._emit_optimization_status(session, "running")
        return {"sessionId": session.session_id}

    def resume_optimization_episode(self, request: Mapping[str, Any]) -> dict[str, str]:
        session_id = _optional_text(request.get("sessionId"))
        episode_id = _optional_text(request.get("episodeId"))
        directory = _optional_text(request.get("directory"))
        workspace_handle = _optional_text(request.get("workspaceId"))
        workspace_revision = request.get("workspaceRevision")
        if not session_id or not episode_id or not directory or not workspace_handle:
            raise ValueError("Optimization Episode recovery request is incomplete.")
        if type(workspace_revision) is not int or workspace_revision < 1:
            raise ValueError("Optimization Episode Parent Revision is invalid.")

        existing = self.sessions.get(session_id)
        if existing is not None and self._optimization_thread_active(existing):
            if existing.optimization_episode_id != episode_id:
                raise ValueError("Agent Session owns a different Optimization Episode.")
            existing.optimization_pause.clear()
            existing.optimization_phase = "running"
            self._emit_status(existing, "running")
            self._emit_optimization_status(existing, "running")
            return {"episodeId": episode_id, "sessionId": session_id}

        workspace = Path(directory).resolve()
        if not workspace.is_dir():
            raise ValueError("Optimization Episode Parent Workspace is unavailable.")
        context = _read_optimization_resume_context(workspace, episode_id)
        if (
            context.get("session_id") != session_id
            or context.get("episode_id") != episode_id
            or context.get("workspace") != str(workspace)
            or context.get("workspace_revision") != workspace_revision
        ):
            raise ValueError("Optimization Episode recovery context does not match the Parent.")
        objective = context.get("objective")
        alignment = context.get("objective_alignment")
        if not isinstance(objective, dict) or not isinstance(alignment, dict):
            raise ValueError("Optimization Episode objective context is invalid.")
        objective_sha256 = context.get("objective_sha256")
        if objective_sha256 != _objective_sha256(objective):
            raise ValueError("Optimization Episode objective hash is invalid.")
        parameter_policy = objective.get("parameter_policy")
        if (
            not isinstance(parameter_policy, dict)
            or context.get("parameter_policy_sha256")
            != canonical_sha256(parameter_policy)
        ):
            raise ValueError("Optimization Episode parameter policy hash is invalid.")
        ecc_revision = _optional_text(context.get("ecc_revision"))
        if not ecc_revision:
            raise ValueError("Optimization Episode ECC revision is missing.")

        session = self.sessions.setdefault(session_id, _Session(session_id=session_id))
        session.mode = "workspace"
        session.rerun_workspace_path = str(workspace)
        session.workspace_handle = workspace_handle
        session.workspace_revision = workspace_revision
        session.optimization_episode_id = episode_id
        session.optimization_objective = objective
        session.optimization_objective_sha256 = objective_sha256
        session.optimization_parameter_policy_sha256 = context["parameter_policy_sha256"]
        session.optimization_ecc_revision = ecc_revision
        session.optimization_objective_alignment = alignment
        session.optimization_primary_metric = _optional_text(context.get("primary_metric"))
        active = context.get("active_objective")
        session.optimization_active_objective = active if isinstance(active, dict) else None
        if not epsilon_artifact_path(workspace).is_file():
            self._calibrate_then_start_optimization(session, workspace)
        else:
            self._launch_optimization_episode(session, workspace)
        return {"episodeId": episode_id, "sessionId": session_id}

    def stop_optimization_episode(self, request: Mapping[str, Any]) -> dict[str, str]:
        session_id = _optional_text(request.get("sessionId"))
        episode_id = _optional_text(request.get("episodeId"))
        directory = _optional_text(request.get("directory"))
        workspace_handle = _optional_text(request.get("workspaceId"))
        workspace_revision = request.get("workspaceRevision")
        if not session_id or not episode_id or not directory or not workspace_handle:
            raise ValueError("Optimization Episode recovery request is incomplete.")
        if type(workspace_revision) is not int or workspace_revision < 1:
            raise ValueError("Optimization Episode Parent Revision is invalid.")

        existing = self.sessions.get(session_id)
        if existing is not None and self._optimization_thread_active(existing):
            if existing.optimization_episode_id != episode_id:
                raise ValueError("Agent Session owns a different Optimization Episode.")
            self._request_optimization_stop(existing)
            existing.optimization_phase = "stopping"
            self._emit_optimization_status(existing, "stopping")
            return {"episodeId": episode_id, "sessionId": session_id}

        workspace = Path(directory).resolve()
        if not workspace.is_dir():
            raise ValueError("Optimization Episode Parent Workspace is unavailable.")
        context = _read_optimization_resume_context(workspace, episode_id)
        if (
            context.get("session_id") != session_id
            or context.get("episode_id") != episode_id
            or context.get("workspace") != str(workspace)
            or context.get("workspace_revision") != workspace_revision
        ):
            raise ValueError("Optimization Episode recovery context does not match the Parent.")

        session = self.sessions.setdefault(session_id, _Session(session_id=session_id))
        session.mode = "workspace"
        session.rerun_workspace_path = str(workspace)
        session.workspace_handle = workspace_handle
        session.workspace_revision = workspace_revision
        session.optimization_episode_id = episode_id
        objective = context.get("objective")
        alignment = context.get("objective_alignment")
        if not isinstance(objective, dict) or not isinstance(alignment, dict):
            raise ValueError("Optimization Episode objective context is invalid.")
        session.optimization_objective = objective
        session.optimization_objective_sha256 = _optional_text(
            context.get("objective_sha256")
        )
        parameter_policy = objective.get("parameter_policy")
        if (
            not isinstance(parameter_policy, dict)
            or context.get("parameter_policy_sha256")
            != canonical_sha256(parameter_policy)
        ):
            raise ValueError("Optimization Episode parameter policy hash is invalid.")
        session.optimization_parameter_policy_sha256 = context.get(
            "parameter_policy_sha256"
        )
        session.optimization_ecc_revision = _optional_text(context.get("ecc_revision"))
        if not session.optimization_ecc_revision:
            raise ValueError("Optimization Episode ECC revision is missing.")
        session.optimization_objective_alignment = alignment
        session.optimization_primary_metric = _optional_text(context.get("primary_metric"))
        active = context.get("active_objective")
        session.optimization_active_objective = active if isinstance(active, dict) else None
        if not epsilon_artifact_path(workspace).is_file():
            session.optimization_phase = "stopped"
            session.phase = "operation"
            _mark_optimization_resume_stopped(workspace, episode_id, context)
            self._emit_optimization_status(session, "stopped")
            self._emit_status(session, "interrupted")
            self._emit_phase_choice(session)
        else:
            self._launch_optimization_episode(
                session, workspace, stop_before_dispatch=True
            )
        return {"episodeId": episode_id, "sessionId": session_id}
