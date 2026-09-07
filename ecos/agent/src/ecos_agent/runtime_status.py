"""Bounded local observations, separate from authoritative execution budgets."""

from __future__ import annotations

import copy
from collections import deque
from typing import Any

from ecos_agent.hashing import canonical_sha256


class RequestTelemetry:
    def __init__(self) -> None:
        self.thread_id: str | None = None
        self.requests_started = 0
        self.requests_failed = 0
        self.tool_calls_observed = 0
        self.tool_counts_complete = True
        self.server_retries = 0
        self.last_turn: dict[str, Any] | None = None

    def snapshot(self, thread_id: str) -> dict[str, Any]:
        if self.thread_id != thread_id:
            self.thread_id = thread_id
            self.requests_started = 0
            self.requests_failed = 0
            self.tool_calls_observed = 0
            self.tool_counts_complete = True
            self.server_retries = 0
        return {
            "scope": "current_thread_local_observation_window",
            "thread_id": thread_id,
            "as_of": "before_current_request",
            "historical_totals_available": False,
            "requests_started": self.requests_started,
            "requests_failed": self.requests_failed,
            "tool_calls_observed": self.tool_calls_observed,
            "tool_counts_complete": self.tool_counts_complete,
            "server_retries": self.server_retries,
            "last_turn": copy.deepcopy(self.last_turn)
            if self.last_turn and self.last_turn.get("thread_id") == thread_id else None,
            "previous_thread_failure": {
                key: self.last_turn.get(key)
                for key in ("thread_id", "turn_id", "failure_class")
            } if self.last_turn and self.last_turn.get("thread_id") != thread_id
            and self.last_turn.get("failure_class") else None,
        }

    def begin(self, thread_id: str) -> None:
        self.snapshot(thread_id)
        self.requests_started += 1

    def finish(self, observed: dict[str, Any], failure: str | None) -> None:
        self.requests_failed += int(failure is not None)
        self.tool_calls_observed += observed.get("tool_calls") or 0
        self.tool_counts_complete &= observed.get("tool_counts_complete") is True
        self.server_retries += observed.get("server_retries") or 0
        self.last_turn = copy.deepcopy(observed)
        self.last_turn["failure_class"] = failure
        self.last_turn["response_validation"] = "unknown"

    def validation(self, valid: bool) -> None:
        if self.last_turn is not None:
            self.last_turn["response_validation"] = "valid" if valid else "invalid"


class LocalActivityTelemetry:
    def __init__(self) -> None:
        self.turn_id: str | None = None
        self._items: dict[str, str] = {}
        self._events: deque[dict[str, Any]] = deque(maxlen=6)
        self.count = 0
        self.complete = True

    def observe(self, turn_id: str | None, item_id: str, status: str) -> None:
        if self.turn_id != turn_id:
            self.turn_id = turn_id
            self._items.clear()
        if not turn_id:
            self.complete = False
            return
        if item_id not in self._items:
            if len(self._items) >= 1024:
                self.complete = False
                return
            self.count += 1
        if status not in {"running", "completed", "failed", "interrupted", "declined"}:
            status = "unknown"
        if self._items.get(item_id) != status:
            self._events.append({
                "item_ref": canonical_sha256([turn_id, item_id]),
                "status": status,
            })
        self._items[item_id] = status

    def snapshot(self) -> dict[str, Any]:
        return {
            "scope": "session_local_activities_not_ecc_executions",
            "observed_activities": self.count,
            "counts_complete": self.complete,
            "events": copy.deepcopy(list(self._events)),
        }

    def finish(self, turn_id: str, status: str) -> None:
        if self.turn_id == turn_id:
            for item_id, current in tuple(self._items.items()):
                if current == "running":
                    self.observe(turn_id, item_id, status)
