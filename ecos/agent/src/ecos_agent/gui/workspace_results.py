"""Workspace result parsing helpers for GUI orchestration."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping

from ecos_agent.workspace.setup import workspace_search_roots

_WORKSPACE_CREATE_RESULT_PREFIX = "workspace_create_result:"
_WORKSPACE_CONTINUE_RESULT_PREFIX = "workspace_continue_result:"
_WORKSPACE_SIGNOFF_INSPECTION_PREFIX = "workspace_signoff_inspection:"
_WORKSPACE_SIGNOFF_RESULT_PREFIX = "workspace_signoff_result:"


def _source_workspace_roots(context: Mapping[str, Any]) -> tuple[Path, ...]:
    raw_roots = context.get("source_workspace_roots")
    if not isinstance(raw_roots, list) or not raw_roots:
        raise CodexProviderError("source search roots are missing", failure_class="missing_input")
    roots = tuple(
        dict.fromkeys(Path(root).expanduser().resolve() for root in raw_roots if isinstance(root, str))
    )
    if len(roots) != len(raw_roots) or any(not root.is_dir() for root in roots):
        raise CodexProviderError("source search roots are invalid", failure_class="missing_input")
    return roots


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _workspace_creation_result(message: str) -> tuple[str, str, str, str | None, str | None] | None:
    if not message.startswith(_WORKSPACE_CREATE_RESULT_PREFIX):
        return None
    try:
        payload = json.loads(message.removeprefix(_WORKSPACE_CREATE_RESULT_PREFIX))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or not {"setup_id", "status", "error"}.issubset(payload):
        return None
    if set(payload) - {"setup_id", "status", "error", "end_step", "workspace"}:
        return None
    setup_id = payload.get("setup_id")
    status = payload.get("status")
    error = payload.get("error")
    if (
        not isinstance(setup_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", setup_id)
        or status not in {"succeeded", "failed"}
        or not isinstance(error, str)
    ):
        return None
    normalized_error = re.sub(r"[\x00-\x1f\x7f]+", " ", error).strip()[:512]
    if status == "failed" and not normalized_error:
        return None
    end_step = payload.get("end_step")
    workspace = payload.get("workspace")
    if end_step is not None and (
        not isinstance(end_step, str) or len(end_step) > 64 or not end_step.strip()
    ):
        return None
    if workspace is not None and (
        not isinstance(workspace, str)
        or len(workspace) > 4096
        or not workspace.startswith('/')
        or '\x00' in workspace
    ):
        return None
    return setup_id, status, normalized_error, end_step.strip() if end_step else None, workspace


def _workspace_continue_result(message: str) -> tuple[str, str, str, str | None] | None:
    if not message.startswith(_WORKSPACE_CONTINUE_RESULT_PREFIX):
        return None
    try:
        payload = json.loads(message.removeprefix(_WORKSPACE_CONTINUE_RESULT_PREFIX))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or not {"continue_id", "status", "error"}.issubset(payload):
        return None
    if set(payload) - {"continue_id", "status", "error", "end_step"}:
        return None
    continue_id, status, error = payload.get("continue_id"), payload.get("status"), payload.get("error")
    if (
        not isinstance(continue_id, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", continue_id)
        or status not in {"succeeded", "failed"}
        or not isinstance(error, str)
    ):
        return None
    normalized_error = re.sub(r"[\x00-\x1f\x7f]+", " ", error).strip()[:512]
    if status == "failed" and not normalized_error:
        return None
    end_step = payload.get("end_step")
    if end_step is not None and (
        not isinstance(end_step, str) or len(end_step) > 64 or not end_step.strip()
    ):
        return None
    return continue_id, status, normalized_error, end_step.strip() if end_step else None


def _workspace_signoff_inspection_result(
    message: str,
) -> tuple[str, str, str] | None:
    return _workspace_signoff_result_payload(
        message, _WORKSPACE_SIGNOFF_INSPECTION_PREFIX, "signoff_id", {"blocked", "ready", "attention"}
    )


def _workspace_signoff_result(message: str) -> tuple[str, str, str] | None:
    return _workspace_signoff_result_payload(
        message, _WORKSPACE_SIGNOFF_RESULT_PREFIX, "signoff_id", {"succeeded", "failed", "cancelled", "blocked"}
    )


def _workspace_signoff_result_payload(
    message: str, prefix: str, identifier: str, statuses: set[str]
) -> tuple[str, str, str] | None:
    if not message.startswith(prefix):
        return None
    try:
        payload = json.loads(message.removeprefix(prefix))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or set(payload) != {identifier, "status", "error"}:
        return None
    value, status, error = payload.get(identifier), payload.get("status"), payload.get("error")
    if (
        not isinstance(value, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)
        or status not in statuses
        or not isinstance(error, str)
    ):
        return None
    normalized_error = re.sub(r"[\x00-\x1f\x7f]+", " ", error).strip()[:512]
    if status in {"failed", "blocked"} and not normalized_error:
        return None
    return value, status, normalized_error


def _required_message(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Agent message must be a string.")
    if len(value) > 4096:
        raise ValueError("Agent message exceeds 4096 characters.")
    return value.strip()
