"""Read-only JSON-RPC transport for the Codex app-server."""

from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping


class CodexProviderError(RuntimeError):
    def __init__(self, message: str, failure_class: str = "tool_error") -> None:
        super().__init__(message)
        self.failure_class = failure_class


class _RpcDiagnostics:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        self._lock = threading.Lock()

    def record(self, event: str, **details: object) -> None:
        payload = {
            "schema_version": "flow-agent.codex_rpc_diagnostics.v1",
            "event": event,
            **details,
        }
        with self._lock, self._path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, sort_keys=True) + "\n")


class _JsonLineRpcProcessClient:
    def __init__(
        self,
        command: str,
        args: list[str],
        cwd: Path,
        env: Mapping[str, str],
        timeout_seconds: int,
        diagnostics_path: Path | None = None,
    ) -> None:
        self.command = command
        self.args = args
        self.cwd = cwd
        self.env = dict(env)
        self.timeout_seconds = timeout_seconds
        self._next_id = 1
        self._pending: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._notifications: queue.Queue[dict[str, Any]] = queue.Queue()
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._reader: threading.Thread | None = None
        self._stderr_reader: threading.Thread | None = None
        self._diagnostics = (
            _RpcDiagnostics(diagnostics_path) if diagnostics_path is not None else None
        )

    def start(self) -> None:
        if self._process is not None:
            return
        try:
            self._process = subprocess.Popen(
                [self.command, *self.args],
                cwd=str(self.cwd),
                env=self.env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except OSError as exc:
            raise CodexProviderError(
                "Failed to start Codex app-server", failure_class="tool_error"
            ) from exc
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()
        self._stderr_reader = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_reader.start()

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        for pending in tuple(self._pending.values()):
            pending.put({"error": {"message": "Codex request interrupted"}})
        self._pending.clear()
        try:
            if process.stdin:
                process.stdin.close()
        except OSError:
            pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        self._process = None

    def interrupt_turn(self, turn_id: str) -> None:
        self._notifications.put(
            {
                "method": "error",
                "params": {"error": {"code": "interrupted"}, "turnId": turn_id},
            }
        )
        self.close()

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        process = self._process
        if process is None or process.stdin is None:
            raise CodexProviderError(
                "Codex app-server is not running", failure_class="tool_error"
            )
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
            self._pending[request_id] = response_queue
            payload = json.dumps(
                {"method": method, "id": request_id, "params": params}, sort_keys=True
            ) + "\n"
            try:
                self._record("rpc_request_started", method=method)
                process.stdin.write(payload)
                process.stdin.flush()
            except OSError as exc:
                self._pending.pop(request_id, None)
                raise CodexProviderError(
                    "Failed to write Codex app-server request", failure_class="tool_error"
                ) from exc
        try:
            response = response_queue.get(timeout=self.timeout_seconds)
        except queue.Empty as exc:
            self._pending.pop(request_id, None)
            self._record("rpc_request_timeout", method=method)
            raise CodexProviderError(
                f"Timed out waiting for Codex {method} response", failure_class="timeout"
            ) from exc
        if "error" in response:
            self._record("rpc_response_error", method=method)
            raise CodexProviderError(
                f"Codex app-server {method} error: {response['error']}",
                failure_class="tool_error",
            )
        result = response.get("result")
        self._record("rpc_response_received", method=method)
        return result if isinstance(result, dict) else {"result": result}

    def wait_for_turn_text(
        self, turn_id: str, progress_callback: Callable[[str], None] | None = None
    ) -> str:
        text, _ = self.wait_for_turn_details(turn_id, progress_callback=progress_callback)
        return text

    def wait_for_turn_details(
        self,
        turn_id: str,
        *,
        thread_id: str | None = None,
        progress_callback: Callable[[str], None] | None = None,
        activity_callback: Callable[[str], None] | None = None,
    ) -> tuple[str, dict[str, int] | None]:
        self._record("turn_wait_started")
        idle_deadline = time.monotonic() + self.timeout_seconds
        deltas: list[str] = []
        completed_items: list[str] = []
        completed_turn: dict[str, Any] | None = None
        token_usage: dict[str, int] | None = None
        while time.monotonic() < idle_deadline:
            remaining = max(0.01, idle_deadline - time.monotonic())
            try:
                notification = self._notifications.get(timeout=min(10, remaining))
            except queue.Empty as exc:
                if time.monotonic() < idle_deadline:
                    continue
                self._record("turn_wait_timeout")
                raise CodexProviderError(
                    f"Timed out waiting for Codex turn {turn_id} completion",
                    failure_class="timeout",
                ) from exc
            method = notification.get("method")
            params = (
                notification.get("params")
                if isinstance(notification.get("params"), dict)
                else {}
            )
            matches_turn = self._notification_matches_turn(params, turn_id)
            self._record(
                "notification_received",
                method=method if isinstance(method, str) else None,
                matches_turn=matches_turn,
            )
            if method == "thread/tokenUsage/updated" and self._notification_matches_thread(
                params, thread_id
            ):
                token_usage = self._token_usage(params)
            if not matches_turn:
                continue
            idle_deadline = time.monotonic() + self.timeout_seconds
            activity = self._readonly_activity(method, params)
            if activity:
                self._report_progress(activity_callback, activity)
            if method == "item/reasoning/summaryTextDelta":
                reasoning_delta = self._agent_delta_text(params)
                if reasoning_delta:
                    self._report_progress(activity_callback, reasoning_delta)
            if method == "error":
                will_retry = params.get("willRetry") is True
                self._record(
                    "turn_error_received",
                    error_code=self._error_code(params),
                    will_retry=will_retry,
                )
                if will_retry:
                    self._report_progress(
                        activity_callback, "Retrying…"
                    )
                    continue
                error_message = self._error_message(params)
                raise CodexProviderError(
                    f"Codex app-server turn error: {error_message}"
                    if error_message
                    else "Codex app-server reported a turn error",
                    failure_class="tool_error",
                )
            if method == "item/agentMessage/delta":
                delta = self._agent_delta_text(params)
                if delta:
                    deltas.append(delta)
                    self._report_progress(progress_callback, delta)
            elif method in {"item/agentMessage/completed", "item/completed"}:
                item_text = self._completed_item_text(params)
                if item_text:
                    completed_items.append(item_text)
            if method == "turn/completed":
                turn = params.get("turn")
                completed_turn = turn if isinstance(turn, dict) else params
                token_usage = self._completed_turn_usage(completed_turn) or token_usage
                text = (
                    "".join(deltas).strip()
                    or "".join(completed_items).strip()
                    or self._completed_turn_text(completed_turn).strip()
                )
                if not text:
                    raise CodexProviderError(
                        "Codex turn completed without assistant text",
                        failure_class="parse_error",
                    )
                return text, token_usage
        raise CodexProviderError(
            f"Timed out waiting for Codex turn {turn_id} completion",
            failure_class="timeout",
        )

    @staticmethod
    def _report_progress(callback: Callable[[str], None] | None, event: str) -> None:
        if callback is not None:
            callback(event)

    def _record(self, event: str, **details: object) -> None:
        if self._diagnostics is not None:
            self._diagnostics.record(event, **details)

    def _read_stdout(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in message and ("result" in message or "error" in message):
                pending = self._pending.pop(int(message["id"]), None)
                if pending is not None:
                    pending.put(message)
                continue
            if "id" in message and "method" in message:
                self._respond_to_server_request(message)
                continue
            if "method" in message:
                self._notifications.put(message)

    def _drain_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        for _line in process.stderr:
            pass

    def _respond_to_server_request(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        result: dict[str, Any] = (
            {"decision": "decline"}
            if method
            in {"item/commandExecution/requestApproval", "item/fileChange/requestApproval"}
            else {}
        )
        process = self._process
        if process is None or process.stdin is None:
            return
        try:
            process.stdin.write(json.dumps({"id": message["id"], "result": result}, sort_keys=True) + "\n")
            process.stdin.flush()
        except OSError:
            return

    @staticmethod
    def _notification_matches_turn(params: Mapping[str, Any], turn_id: str) -> bool:
        turn = params.get("turn")
        if isinstance(turn, Mapping) and turn.get("id") == turn_id:
            return True
        return (
            params.get("turnId") == turn_id
            or params.get("turn_id") == turn_id
            or params.get("id") == turn_id
        )

    @staticmethod
    def _notification_matches_thread(params: Mapping[str, Any], thread_id: str | None) -> bool:
        if thread_id is None:
            return False
        thread = params.get("thread")
        return (
            params.get("threadId") == thread_id
            or params.get("thread_id") == thread_id
            or (isinstance(thread, Mapping) and thread.get("id") == thread_id)
        )

    @staticmethod
    def _token_usage(params: Mapping[str, Any]) -> dict[str, int] | None:
        usage = params.get("tokenUsage")
        if not isinstance(usage, Mapping):
            return None
        last = usage.get("last")
        return _normalized_token_usage(last)

    @staticmethod
    def _completed_turn_usage(turn: Mapping[str, Any]) -> dict[str, int] | None:
        return _normalized_token_usage(turn.get("usage"))

    @staticmethod
    def _agent_delta_text(params: Mapping[str, Any]) -> str:
        for key in ("delta", "text", "content"):
            value = params.get(key)
            if isinstance(value, str):
                return value
            if isinstance(value, Mapping):
                nested = value.get("text") or value.get("content") or value.get("delta")
                if isinstance(nested, str):
                    return nested
        return ""

    @staticmethod
    def _completed_turn_text(turn: Mapping[str, Any]) -> str:
        for key in ("output", "messages", "items"):
            value = turn.get(key)
            if isinstance(value, list):
                text = _first_text(value)
                if text:
                    return text
        return ""

    @staticmethod
    def _completed_item_text(params: Mapping[str, Any]) -> str:
        return _first_text(params.get("item"))

    @staticmethod
    def _readonly_activity(method: object, params: Mapping[str, Any]) -> str | None:
        """Turn Codex item events into user-visible progress.

        Every externally observable action must surface here. A silent web
        search is the same transparency failure as a silent file read: the user
        cannot audit what they never saw.
        """
        if method not in {"item/started", "item/completed"}:
            return None
        item = params.get("item")
        if not isinstance(item, Mapping):
            return None
        item_type = str(item.get("type", "")).replace("_", "").casefold()
        if item_type == "websearch":
            if method == "item/started":
                query = str(item.get("query", "")).strip()
                return f"Searching the web for “{query}”…" if query else "Searching the web…"
            return "Finished web search."
        if item_type != "commandexecution":
            return None
        command = str(item.get("command", "")).casefold()
        if method == "item/started":
            if any(token in command for token in ("rg", "find", "fd ", "ls ")):
                return "Searching workspace…"
            return "Reading workspace files…"
        return "Finished workspace inspection."

    @staticmethod
    def _error_code(params: Mapping[str, Any]) -> str | None:
        error = params.get("error")
        code = error.get("code") if isinstance(error, Mapping) else None
        return code if isinstance(code, str) else None

    @staticmethod
    def _error_message(params: Mapping[str, Any]) -> str | None:
        error = params.get("error")
        message = error.get("message") if isinstance(error, Mapping) else None
        if not isinstance(message, str):
            return None
        normalized = " ".join(message.split())
        return normalized[:512] or None


def _normalized_token_usage(usage: object) -> dict[str, int] | None:
    if not isinstance(usage, Mapping):
        return None
    fields = {
        "total_tokens": "totalTokens",
        "input_tokens": "inputTokens",
        "cached_input_tokens": "cachedInputTokens",
        "cache_write_input_tokens": "cacheWriteInputTokens",
        "output_tokens": "outputTokens",
        "reasoning_output_tokens": "reasoningOutputTokens",
    }
    result = {key: usage.get(source) for key, source in fields.items()}
    if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in result.values()):
        return None
    return {key: int(value) for key, value in result.items()}


def _read_nested_string(
    value: Mapping[str, Any], paths: tuple[tuple[str, ...], ...]
) -> str | None:
    for path in paths:
        current: Any = value
        for key in path:
            if not isinstance(current, Mapping):
                current = None
                break
            current = current.get(key)
        if isinstance(current, str) and current:
            return current
    return None


def _first_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        for key in ("text", "content", "delta", "message"):
            text = _first_text(value.get(key))
            if text:
                return text
        return ""
    if isinstance(value, list):
        return "".join(part for item in value if (part := _first_text(item)))
    return ""
