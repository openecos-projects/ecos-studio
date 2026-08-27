"""Display-safe activity snapshots from Codex app-server notifications."""

from __future__ import annotations

import copy
import json
import re
import time
from typing import Any, Callable, Mapping

_OUTPUT_LIMIT = 32 * 1024
_ARGUMENT_LIMIT = 8 * 1024
_SENSITIVE_VALUE_RE = re.compile(
    r"\b(api[ _-]?key|authorization|password|secret|token)\b(\s*[:=]\s*)"
    r"(?:\"[^\"]*\"|'[^']*'|\S+)",
    re.IGNORECASE,
)


def _redact_text(value: str) -> str:
    return _SENSITIVE_VALUE_RE.sub(r"\1\2[REDACTED]", value)


def _bounded_text(value: object, limit: int) -> tuple[str, bool]:
    if not isinstance(value, str):
        return "", False
    encoded = _redact_text(value).encode("utf-8")
    if len(encoded) <= limit:
        return encoded.decode("utf-8"), False
    return encoded[-limit:].decode("utf-8", errors="ignore"), True


def _redact_value(value: object) -> object:
    if isinstance(value, Mapping):
        result: dict[str, object] = {}
        for key, item in value.items():
            name = str(key)
            if name.casefold() in {"env", "environment", "environmentvariables"}:
                continue
            if re.search(
                r"api[ _-]?key|authorization|password|secret|token", name, re.I
            ):
                result[name] = "[REDACTED]"
            else:
                result[name] = _redact_value(item)
        return result
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, str):
        return _redact_text(value)
    return value


def _serialized_detail(value: object) -> tuple[str, bool]:
    if value is None:
        return "", False
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return _bounded_text(value, _ARGUMENT_LIMIT)
    serialized = json.dumps(_redact_value(value), ensure_ascii=False, indent=2)
    return _bounded_text(serialized, _ARGUMENT_LIMIT)


def _item_id(params: Mapping[str, Any], item: Mapping[str, Any], fallback: str) -> str:
    for value in (
        params.get("itemId"),
        params.get("item_id"),
        item.get("id"),
        item.get("itemId"),
    ):
        if isinstance(value, str) and value:
            return value[:128]
    return fallback


def _status(value: object, *, completed: bool = False) -> str:
    normalized = str(value or "").replace("_", "").casefold()
    if normalized in {"failed", "error"}:
        return "failed"
    if normalized in {"declined", "rejected"}:
        return "declined"
    if normalized in {"interrupted", "cancelled", "canceled"}:
        return "interrupted"
    if completed or normalized in {"completed", "success", "succeeded"}:
        return "completed"
    return "running"


def _duration(item: Mapping[str, Any]) -> int | None:
    for key in ("durationMs", "duration_ms"):
        value = item.get(key)
        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and value >= 0
        ):
            return round(value)
    return None


def _item_type(item: Mapping[str, Any]) -> str:
    return (
        str(item.get("type", ""))
        .replace("_", "")
        .replace("-", "")
        .casefold()
    )


def _delta_text(params: Mapping[str, Any]) -> str:
    for key in ("delta", "text", "content"):
        value = params.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, Mapping):
            nested = value.get("text") or value.get("content") or value.get("delta")
            if isinstance(nested, str):
                return nested
    return ""


def _web_actions(item: Mapping[str, Any]) -> list[dict[str, str]]:
    raw = item.get("actions")
    values = raw if isinstance(raw, list) else [item.get("action")]
    actions: list[dict[str, str]] = []
    for value in values[:32]:
        if not isinstance(value, Mapping):
            continue
        kind = (
            str(value.get("type", value.get("kind", "")))
            .replace("_", "")
            .casefold()
        )
        normalized = {
            "search": "search",
            "query": "search",
            "openpage": "open_page",
            "openurl": "open_page",
            "open": "open_page",
            "findinpage": "find_in_page",
            "find": "find_in_page",
        }.get(kind)
        if normalized is None:
            continue
        action = {"kind": normalized}
        for source, target, limit in (
            ("query", "query", 1024),
            ("pattern", "query", 1024),
            ("url", "url", 4096),
            ("title", "title", 512),
        ):
            text, _ = _bounded_text(value.get(source), limit)
            if text and target not in action:
                action[target] = text
        actions.append(action)
    return actions


def _command_label(item: Mapping[str, Any], command: str) -> str:
    actions = item.get("commandActions", item.get("command_actions"))
    if isinstance(actions, list) and actions and isinstance(actions[0], Mapping):
        action = actions[0]
        kind = (
            str(action.get("type", action.get("kind", "")))
            .replace("_", "")
            .casefold()
        )
        target = action.get("path", action.get("query", action.get("name")))
        target_text, _ = _bounded_text(target, 256)
        if kind == "read":
            return f"Read {target_text}" if target_text else "Read workspace files"
        if kind in {"listfiles", "list"}:
            return f"List {target_text}" if target_text else "List workspace files"
        if kind == "search":
            return f"Search for {target_text}" if target_text else "Search workspace"
    folded = command.casefold()
    if any(token in folded for token in ("rg ", "grep ", "find ", "fd ", "ls ")):
        return "Search workspace"
    return "Run command"


def _bounded_result(value: object) -> tuple[str, bool]:
    if value is None:
        return "", False
    if isinstance(value, str):
        return _bounded_text(value, _OUTPUT_LIMIT)
    serialized = json.dumps(_redact_value(value), ensure_ascii=False, indent=2)
    return _bounded_text(serialized, _OUTPUT_LIMIT)


class CodexActivityProjector:
    def __init__(
        self,
        turn_id: str,
        callback: Callable[[dict[str, Any]], None] | None,
    ) -> None:
        self.turn_id = turn_id
        self.callback = callback
        self.turn_started_at = round(time.time() * 1000)
        self._items: dict[str, dict[str, Any]] = {}
        self._item_started: dict[str, float] = {}

    def handle(self, method: object, params: Mapping[str, Any]) -> None:
        if self.callback is None or not isinstance(method, str):
            return
        if method == "item/reasoning/summaryTextDelta":
            self._reasoning_delta(params)
            return
        if method == "item/reasoning/summaryPartAdded":
            self._reasoning_part(params)
            return
        if method == "item/commandExecution/outputDelta":
            self._command_output(params)
            return
        if method == "item/mcpToolCall/progress":
            self._tool_progress(params)
            return
        if method == "turn/completed":
            turn = params.get("turn")
            record = turn if isinstance(turn, Mapping) else params
            self.finish(_status(record.get("status"), completed=True))
            return
        if method not in {"item/started", "item/completed"}:
            return
        item = params.get("item")
        if not isinstance(item, Mapping):
            return
        item_type = _item_type(item)
        completed = method == "item/completed"
        if item_type == "reasoning":
            self._reasoning_item(params, item, completed)
        elif item_type == "websearch":
            self._web_item(params, item, completed)
        elif item_type == "commandexecution":
            self._command_item(params, item, completed)
        elif item_type in {"mcptoolcall", "dynamictoolcall", "toolcall"}:
            self._tool_item(params, item, completed)

    def finish(self, status: str) -> None:
        for item_id, item in self._items.items():
            if item["status"] != "running":
                continue
            item["status"] = status
            item["durationMs"] = round(
                (time.monotonic() - self._item_started[item_id]) * 1000
            )
            self._emit(item)

    def _base(self, item_id: str, kind: str) -> dict[str, Any]:
        existing = self._items.get(item_id)
        if existing is not None:
            return existing
        item = {
            "schema_version": "flow-agent.activity.v1",
            "itemId": item_id,
            "turnId": self.turn_id,
            "turnStartedAt": self.turn_started_at,
            "startedAt": round(time.time() * 1000),
            "kind": kind,
            "status": "running",
        }
        self._items[item_id] = item
        self._item_started[item_id] = time.monotonic()
        return item

    def _complete(
        self, activity: dict[str, Any], item: Mapping[str, Any], completed: bool
    ) -> None:
        activity["status"] = _status(item.get("status"), completed=completed)
        duration = _duration(item)
        if duration is None and completed:
            duration = round(
                (time.monotonic() - self._item_started[activity["itemId"]]) * 1000
            )
        if duration is not None:
            activity["durationMs"] = duration

    def _emit(self, activity: dict[str, Any]) -> None:
        if self.callback is not None:
            self.callback(copy.deepcopy(activity))

    def _reasoning_delta(self, params: Mapping[str, Any]) -> None:
        delta = _delta_text(params)
        if not delta:
            return
        index = params.get("summaryIndex")
        summary_index = index if isinstance(index, int) and index >= 0 else 0
        activity = self._base(
            _item_id(params, {}, f"reasoning-{summary_index}"), "reasoning_summary"
        )
        parts = list(activity.get("summary", []))
        while len(parts) <= summary_index:
            parts.append("")
        parts[summary_index] = _bounded_text(
            parts[summary_index] + delta, _ARGUMENT_LIMIT
        )[0]
        activity["summary"] = parts
        self._emit(activity)

    def _reasoning_part(self, params: Mapping[str, Any]) -> None:
        index = params.get("summaryIndex")
        summary_index = index if isinstance(index, int) and index >= 0 else 0
        activity = self._base(
            _item_id(params, {}, f"reasoning-{summary_index}"), "reasoning_summary"
        )
        parts = list(activity.get("summary", []))
        while len(parts) <= summary_index:
            parts.append("")
        activity["summary"] = parts

    def _reasoning_item(
        self, params: Mapping[str, Any], item: Mapping[str, Any], completed: bool
    ) -> None:
        activity = self._base(
            _item_id(params, item, "reasoning-0"), "reasoning_summary"
        )
        summary = item.get("summary")
        if isinstance(summary, list):
            parts = [
                _bounded_text(part, _ARGUMENT_LIMIT)[0]
                for part in summary
                if isinstance(part, str) and part
            ]
            if parts:
                activity["summary"] = parts
        self._complete(activity, item, completed)
        if activity.get("summary"):
            self._emit(activity)

    def _web_item(
        self, params: Mapping[str, Any], item: Mapping[str, Any], completed: bool
    ) -> None:
        activity = self._base(_item_id(params, item, "web-search"), "web_search")
        query, _ = _bounded_text(item.get("query"), 1024)
        if query:
            activity["query"] = query
        actions = _web_actions(item)
        if actions:
            activity["actions"] = actions
        else:
            activity.setdefault("actions", [])
        self._complete(activity, item, completed)
        self._emit(activity)

    def _command_item(
        self, params: Mapping[str, Any], item: Mapping[str, Any], completed: bool
    ) -> None:
        activity = self._base(
            _item_id(params, item, "command"), "command_execution"
        )
        command, _ = _bounded_text(item.get("command"), _ARGUMENT_LIMIT)
        if command:
            activity["command"] = command
        activity.setdefault("command", "")
        cwd, _ = _bounded_text(item.get("cwd"), 4096)
        if cwd:
            activity["cwd"] = cwd
        activity["label"] = _command_label(item, activity["command"])
        output, truncated = _bounded_text(
            item.get("aggregatedOutput", item.get("output")), _OUTPUT_LIMIT
        )
        if output:
            activity["output"] = output
        if truncated or item.get("truncated") is True:
            activity["truncated"] = True
        exit_code = item.get("exitCode", item.get("exit_code"))
        if isinstance(exit_code, int) and not isinstance(exit_code, bool):
            activity["exitCode"] = exit_code
        self._complete(activity, item, completed)
        self._emit(activity)

    def _command_output(self, params: Mapping[str, Any]) -> None:
        activity = self._base(_item_id(params, {}, "command"), "command_execution")
        output, truncated = _bounded_text(
            str(activity.get("output", "")) + _delta_text(params), _OUTPUT_LIMIT
        )
        activity.setdefault("command", "")
        activity.setdefault("label", "Run command")
        activity["output"] = output
        if truncated:
            activity["truncated"] = True
        self._emit(activity)

    def _tool_item(
        self, params: Mapping[str, Any], item: Mapping[str, Any], completed: bool
    ) -> None:
        activity = self._base(_item_id(params, item, "tool"), "tool_call")
        tool = item.get("tool", item.get("name"))
        if tool:
            activity["tool"] = str(tool)[:256]
        else:
            activity.setdefault("tool", "Tool")
        server = item.get("server")
        if isinstance(server, str) and server:
            activity["server"] = server[:256]
        arguments, arguments_truncated = _serialized_detail(item.get("arguments"))
        if arguments:
            activity["arguments"] = arguments
        result, result_truncated = _bounded_result(item.get("result"))
        if result:
            activity["result"] = result
        error = item.get("error")
        if isinstance(error, Mapping):
            error = error.get("message")
        error_text, _ = _bounded_text(error, 4096)
        if error_text:
            activity["error"] = error_text
        if arguments_truncated or result_truncated or item.get("truncated") is True:
            activity["truncated"] = True
        self._complete(activity, item, completed)
        self._emit(activity)

    def _tool_progress(self, params: Mapping[str, Any]) -> None:
        activity = self._base(_item_id(params, {}, "tool"), "tool_call")
        activity.setdefault("tool", "Tool")
        progress_text, _ = _bounded_text(
            params.get("message", params.get("progress")), 4096
        )
        if progress_text:
            activity["progress"] = progress_text
        self._emit(activity)
