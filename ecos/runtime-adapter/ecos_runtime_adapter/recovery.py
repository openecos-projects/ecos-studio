from copy import deepcopy
from pathlib import Path
from typing import Any

from chipcompiler.data import StateEnum, Workspace
from chipcompiler.utility import json_write

from ecos_runtime_adapter.operations import RuntimeOperationManager


def recover_interrupted_operation(
    workspace: Workspace,
    operations: RuntimeOperationManager,
    operation_id: str = "",
) -> dict[str, list[dict[str, str]]]:
    flow_data = deepcopy(workspace.flow.data)
    recovered = []
    for step in flow_data.get("steps", []):
        marker = step.get("info", {}).get("runtime_operation")
        if (
            step.get("state") != "Ongoing"
            or not isinstance(marker, dict)
            or marker.get("schema") != 1
            or not isinstance(marker.get("operation_id"), str)
            or not marker["operation_id"]
            or not isinstance(marker.get("runtime_instance_id"), str)
            or not marker["runtime_instance_id"]
            or not isinstance(marker.get("started_at"), (int, float))
            or (operation_id and marker.get("operation_id") != operation_id)
            or operations.is_active(str(marker["operation_id"]))
        ):
            continue
        log_file = _step_log_file(workspace.directory, step)
        step["state"] = StateEnum.Imcomplete.value
        step["info"].pop("runtime_operation", None)
        recovered.append(
            {
                "step": str(step.get("name", "")),
                "tool": str(step.get("tool", "")),
                "operationId": str(marker["operation_id"]),
                "logFile": log_file,
            }
        )
    if recovered:
        if not json_write(workspace.flow.path, flow_data):
            raise OSError(f"failed to save recovered flow state: {workspace.flow.path}")
        workspace.flow.data = flow_data
    return {"recovered": recovered}


def _step_log_file(directory: str | Path, step: dict[str, Any]) -> str:
    name = str(step.get("name", ""))
    tool = str(step.get("tool", ""))
    return str(Path(directory) / f"{name}_{tool}" / "log" / f"{name}.log")
