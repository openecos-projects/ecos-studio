"""Bounded per-turn telemetry from Codex app-server notifications."""

from __future__ import annotations

from typing import Any, Mapping

from ecos_agent.hashing import canonical_sha256

_MAX_ITEMS = 1024
_MAX_EVENTS = 6
_TERMINAL_STATUSES = {"completed", "failed", "declined", "interrupted"}

_TOOL_TYPES = {
    "commandexecution": "command_execution",
    "websearch": "web_search",
    "mcptoolcall": "tool_call",
    "dynamictoolcall": "tool_call",
    "toolcall": "tool_call",
}


class TurnTelemetry:
    def __init__(self, thread_id: str | None, turn_id: str) -> None:
        self.thread_id = thread_id
        self.turn_id = turn_id
        self.usage: dict[str, int] | None = None
        self.usage_source: str | None = None
        self.status = "running"
        self.server_retries = 0
        self._items: dict[str, str] = {}
        self._item_status: dict[str, str] = {}
        self._tool_counts_complete = True
        self._events: list[dict[str, str]] = []

    def observe(self, method: object, params: Mapping[str, Any]) -> None:
        if not isinstance(method, str):
            return
        if method == "error":
            if params.get("willRetry") is True:
                self.server_retries += 1
                self._append_event("server_retry", "running", None)
            else:
                self.status = "failed"
                self._append_event("server_error", "failed", None)
            return
        if method == "turn/completed":
            turn = params.get("turn")
            record = turn if isinstance(turn, Mapping) else params
            self.status = _status(record.get("status"), completed=True)
            return

        kind = _recognized_tool_kind(method, params)
        if kind is None:
            return
        item_ref = self._item_ref(_raw_item_id(params))
        if item_ref is None:
            self._tool_counts_complete = False
            self._append_event(kind, _status(_item(params).get("status")), None)
            return
        if item_ref not in self._items:
            if len(self._items) >= _MAX_ITEMS:
                self._tool_counts_complete = False
                return
            self._items[item_ref] = kind
        status = _status(_item(params).get("status"), completed=method == "item/completed")
        previous = self._item_status.get(item_ref)
        if previous in _TERMINAL_STATUSES and status == "running":
            status = previous
        else:
            self._item_status[item_ref] = status
        self._append_event(kind, status, item_ref)

    def snapshot(self) -> dict[str, Any]:
        return {
            "thread_id": self.thread_id,
            "turn_id": self.turn_id,
            "tool_calls": len(self._items),
            "tool_counts_complete": self._tool_counts_complete,
            "server_retries": self.server_retries,
            "events": list(self._events),
            "usage": dict(self.usage) if self.usage is not None else None,
            "usage_source": self.usage_source,
            "usage_attribution": "current_turn" if self.usage_source == "completed_turn"
            else "thread_latest_unattributed" if self.usage is not None else "unknown",
            "status": self.status,
        }

    def _append_event(
        self, kind: str, status: str, item_ref: str | None
    ) -> None:
        event = {"type": kind, "status": status}
        if item_ref is not None:
            event["item_ref"] = item_ref
        if self._events[-1:] == [event]:
            return
        if len(self._events) >= _MAX_EVENTS:
            self._events.pop(0)
        self._events.append(event)

    def _item_ref(self, item_id: str | None) -> str | None:
        if item_id is None:
            return None
        return canonical_sha256([self.thread_id, self.turn_id, item_id])


def _recognized_tool_kind(method: str, params: Mapping[str, Any]) -> str | None:
    if method == "item/commandExecution/outputDelta":
        return "command_execution"
    if method == "item/mcpToolCall/progress":
        return "tool_call"
    if method not in {"item/started", "item/completed"}:
        return None
    item_type = _normalized_item_type(_item(params).get("type"))
    return _TOOL_TYPES.get(item_type)


def _raw_item_id(params: Mapping[str, Any]) -> str | None:
    item = _item(params)
    for value in (
        params.get("itemId"),
        params.get("item_id"),
        item.get("id"),
        item.get("itemId"),
    ):
        if isinstance(value, str) and value:
            return value
    return None


def _item(params: Mapping[str, Any]) -> Mapping[str, Any]:
    item = params.get("item")
    return item if isinstance(item, Mapping) else {}


def _normalized_item_type(value: object) -> str:
    return str(value or "").replace("_", "").replace("-", "").casefold()


def _status(value: object, *, completed: bool = False) -> str:
    normalized = str(value or "").replace("_", "").casefold()
    if normalized in {"failed", "error"}:
        return "failed"
    if normalized in {"interrupted", "cancelled", "canceled"}:
        return "interrupted"
    if normalized in {"declined", "rejected"}:
        return "declined"
    if completed or normalized in {"completed", "success", "succeeded"}:
        return "completed"
    return "running"
