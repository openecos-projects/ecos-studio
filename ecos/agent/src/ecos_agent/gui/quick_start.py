"""Receipt-backed Quick Start completion and existing-workflow handoff."""

from __future__ import annotations

import json
from pathlib import Path

from ecos_agent.gui.message_prompts import _choice, _prompt
from ecos_agent.gui.provider_common import _project_root_for_workspace
from ecos_agent.gui.session import ProviderSession


QUICK_START_RESULT_PREFIX = "quick_start_result:"
QUICK_START_PHASES = {"quick_start_completed", "quick_start_recovery"}


def quick_start_options(session: ProviderSession) -> list[dict[str, str]]:
    choices = (
        (
            ("optimize_current", "对当前设计进行受控自动优化", "Optimize the current design with bounded automation"),
            ("manual_rerun", "自己配置参数并重跑", "Configure parameters and rerun stages"),
            ("create_flow", "运行自己的 RTL 到 GDS 流程", "Run your own RTL-to-GDS flow"),
        )
        if session.phase == "quick_start_completed"
        else (
            ("continue_flow", "继续未完成的流程", "Continue the unfinished flow"),
            ("manual_rerun", "选择阶段、配置参数并重跑", "Choose a stage, configure parameters, and rerun"),
        )
    )
    return [
        {"id": action, "label": _prompt(session.language, zh, en)}
        for action, zh, en in choices
    ]


def quick_start_prompt(session: ProviderSession) -> str:
    if session.phase == "quick_start_completed":
        return _prompt(session.language, "GCD 示例流程已完成，下一步做什么？", "The GCD example flow completed. What next?")
    return _prompt(session.language, "Quick Start 流程未完成，选择恢复方式。", "The Quick Start flow did not complete. Choose a recovery action.")


def quick_start_choice(session: ProviderSession, prompt_id: str) -> dict:
    return _choice(
        prompt_id, quick_start_prompt(session), (), variant="buttons", allow_free_text=True,
        labeled_values=tuple((option["label"], option["id"]) for option in quick_start_options(session)),
    )


def quick_start_operation(session: ProviderSession, message: str) -> str | None:
    text = message.strip().casefold()
    options = quick_start_options(session)
    for index, option in enumerate(options, 1):
        if text in {str(index), option["id"], option["label"].casefold()}:
            return option["id"]
    aliases = {
        "optimize_current": ("受控自动优化", "优化当前设计", "optimize current design"),
        "manual_rerun": ("自己配置参数", "手动重跑", "配置参数并重跑", "manual rerun"),
        "create_flow": ("运行自己的", "run my own", "run your own"),
        "continue_flow": ("继续流程", "继续未完成", "continue flow", "resume flow"),
    }
    matches = [option["id"] for option in options if any(term in text for term in aliases[option["id"]])]
    return matches[0] if len(matches) == 1 else None


class ProviderQuickStartMixin:
    def _handle_quick_start_result(self, session: ProviderSession, message: str) -> None:
        try:
            payload = json.loads(message.removeprefix(QUICK_START_RESULT_PREFIX))
            workspace_value = payload["workspace"]
            operation_id = payload["operation_id"]
            if not isinstance(workspace_value, str) or not Path(workspace_value).is_absolute():
                raise ValueError("an absolute workspace path is required")
            if not isinstance(operation_id, str) or not operation_id.strip():
                raise ValueError("an operation ID is required")
            workspace = Path(workspace_value).resolve(strict=True)
            record = json.loads((workspace / "quick_start_run.json").read_text(encoding="utf-8"))
            if record["schema_version"] != "ecos.quick_start.run.v1":
                raise ValueError("unsupported run receipt")
            recorded_workspace = record["workspace"]["path"]
            if not isinstance(recorded_workspace, str) or not Path(recorded_workspace).is_absolute():
                raise ValueError("receipt workspace must be absolute")
            if Path(recorded_workspace).resolve() != workspace:
                raise ValueError("receipt workspace does not match")
            if record["flow"]["operation_id"] != operation_id:
                raise ValueError("receipt operation does not match")
            if record["status"] not in {"flow_completed", "flow_failed"}:
                raise ValueError("a terminal run receipt is required")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ValueError(f"Invalid Quick Start result: {exc}") from exc
        result_key = (str(workspace), operation_id)
        if result_key in session.quick_start_results:
            return
        if session.phase != "home_ready":
            raise ValueError("Quick Start result cannot replace an active workflow.")
        session.quick_start_results.add(result_key)
        session.mode = "workspace"
        session.rerun_workspace_path = str(workspace)
        session.project_root = _project_root_for_workspace(str(workspace))
        session.phase = "quick_start_completed" if record["status"] == "flow_completed" else "quick_start_recovery"
        session.interaction_undo.clear()
        self._emit(session, "message", quick_start_prompt(session))
        if session.phase == "quick_start_recovery" and isinstance(record.get("error"), str):
            self._emit(session, "message", record["error"])
        self._emit_phase_choice(session)

    def _select_quick_start_next(self, session: ProviderSession, message: str, choice: str) -> None:
        if choice not in {option["id"] for option in quick_start_options(session)}:
            raise ValueError("This Quick Start action is unavailable.")
        if choice == "optimize_current":
            self._begin_optimization_objective(session)
        elif choice == "manual_rerun":
            self._begin_workspace_scoped_rerun(session)
        elif choice == "continue_flow":
            self._begin_workspace_continue(session)
        elif choice == "create_flow":
            session.mode = "home"
            session.rerun_workspace_path = None
            session.project_root = None
            self._begin_home_workspace_create(session, "")
