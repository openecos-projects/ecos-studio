from typing import Any


def tool_error_payload(
    workspace_step: Any,
    message: str,
    diagnostic: dict[str, Any] | None = None,
) -> dict[str, Any]:
    log_file = str(getattr(getattr(workspace_step, "log", None), "file", "") or "")
    return {
        "code": "tool_failed",
        "message": message,
        "step": str(getattr(workspace_step, "name", "")),
        "tool": str(getattr(workspace_step, "tool", "")),
        "logFile": log_file,
        **(diagnostic or {}),
    }
