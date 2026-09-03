"""Content-Length JSON-RPC transport for ECC."""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import subprocess
import threading
import time
from collections.abc import Mapping
from pathlib import Path

from ecos_agent.optimization.ecc.evidence import OptimizationEccAdapterError

_SAFE_RPC_ERROR_DETAIL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .:_-]{0,255}$")
_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
_ALLOWED_METHODS = frozenset(
    {
        "workspace.open",
        "rpc.hello",
        "candidate.resume",
        "candidate.rerun",
        "operation.cancel",
        "operation.status",
        "operation.ack_step_rendered",
    }
)
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})


class EccContentLengthRpcClient:
    """Launch the ECC binary with a fixed stdio command and RPC allowlist."""

    def __init__(
        self, executable: Path, *, response_timeout_seconds: float = 10.0
    ) -> None:
        if not executable.is_absolute():
            raise OptimizationEccAdapterError("ECC executable path must be absolute")
        if (
            type(response_timeout_seconds) not in {int, float}
            or response_timeout_seconds <= 0
        ):
            raise OptimizationEccAdapterError("RPC response timeout is invalid")
        try:
            resolved = executable.resolve(strict=True)
        except OSError as exc:
            raise OptimizationEccAdapterError("ECC executable is unavailable") from exc
        if not resolved.is_file() or not os.access(resolved, os.X_OK):
            raise OptimizationEccAdapterError("ECC executable is not executable")
        self.command = (str(resolved), "rpc", "serve", "--stdio", "--agent")
        self._response_timeout_seconds = float(response_timeout_seconds)
        self._process: subprocess.Popen[bytes] | None = None
        self._pending: dict[int, queue.Queue[dict[str, object]]] = {}
        self._events: queue.Queue[dict[str, object]] = queue.Queue()
        self._next_id = 1
        self._lock = threading.Lock()
        self._reader_error: OptimizationEccAdapterError | None = None

    def start(self) -> None:
        if self._process is not None:
            return
        try:
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
        except OSError as exc:
            raise OptimizationEccAdapterError("failed to start ECC RPC") from exc
        threading.Thread(
            target=self._read_stdout, name="ecc-rpc-reader", daemon=True
        ).start()

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        if process.stdin is not None:
            process.stdin.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        self._process = None

    def open_workspace(self, directory: Path) -> str:
        """Open the parent workspace and return the runtime session id."""
        if not directory.is_absolute() or not directory.is_dir():
            raise OptimizationEccAdapterError("workspace directory is unavailable")
        result = self._request(
            "workspace.open",
            {"directory": str(directory.resolve())},
            timeout_seconds=self._response_timeout_seconds,
        )
        workspace_id = result.get("workspaceId")
        if not isinstance(workspace_id, str) or not _ID.fullmatch(workspace_id):
            raise OptimizationEccAdapterError("workspace session id is invalid")
        if result.get("directory") != str(directory.resolve()):
            raise OptimizationEccAdapterError(
                "workspace session directory does not match"
            )
        return workspace_id

    def ecc_revision(self) -> str:
        result = self.call("rpc.hello", {"version": 1})
        revision = result.get("eccVersion")
        if not _valid_revision(revision):
            raise OptimizationEccAdapterError("ECC revision is invalid")
        return revision.strip()

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        if method not in _ALLOWED_METHODS - {"operation.ack_step_rendered"}:
            raise OptimizationEccAdapterError("ECC RPC method is not allowed")
        return self._request(
            method, params, timeout_seconds=self._response_timeout_seconds
        )

    def wait_for_terminal(
        self, operation_id: str, timeout_seconds: float
    ) -> dict[str, object] | None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            try:
                status = self._request(
                    "operation.status",
                    {"operationId": operation_id},
                    timeout_seconds=min(self._response_timeout_seconds, remaining),
                )
            except OptimizationEccAdapterError as exc:
                # ECC may serialize status behind a long-running candidate;
                # runtime events remain the authoritative terminal signal.
                if "response timed out" not in str(exc):
                    raise
            else:
                if status.get("state") in _TERMINAL_STATES:
                    return status
            try:
                event = self._events.get(
                    timeout=min(1.0, max(0.0, deadline - time.monotonic()))
                )
            except queue.Empty:
                continue
            terminal = _terminal_event(event, operation_id)
            if terminal is not None:
                return terminal
        return None

    def _request(
        self, method: str, params: dict[str, object], *, timeout_seconds: float
    ) -> dict[str, object]:
        self.start()
        with self._lock:
            if self._reader_error is not None:
                raise self._reader_error
            request_id = self._next_id
            self._next_id += 1
            response: queue.Queue[dict[str, object]] = queue.Queue(maxsize=1)
            self._pending[request_id] = response
            self._send(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
            )
        try:
            payload = response.get(timeout=timeout_seconds)
        except queue.Empty as exc:
            self._pending.pop(request_id, None)
            raise OptimizationEccAdapterError("ECC RPC response timed out") from exc
        if "error" in payload:
            detail = _safe_rpc_error_detail(payload["error"])
            suffix = f": {detail}" if detail else ""
            raise OptimizationEccAdapterError(f"ECC RPC {method} rejected{suffix}")
        result = payload.get("result")
        if not isinstance(result, dict):
            raise OptimizationEccAdapterError("ECC RPC result is invalid")
        return result

    def _read_stdout(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        decoder = _ContentLengthDecoder()
        try:
            while chunk := process.stdout.read(8192):
                for raw in decoder.feed(chunk):
                    self._handle_message(raw)
        except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
            self._reader_error = OptimizationEccAdapterError(
                "ECC RPC stream is invalid"
            )
        finally:
            failure = self._reader_error or OptimizationEccAdapterError(
                "ECC RPC stream closed"
            )
            for pending in tuple(self._pending.values()):
                pending.put({"error": str(failure)})

    def _handle_message(self, raw: bytes) -> None:
        message = json.loads(raw.decode("utf-8"))
        if not isinstance(message, dict):
            raise ValueError("RPC message is invalid")
        response_id = message.get("id")
        if isinstance(response_id, int) and not isinstance(response_id, bool):
            pending = self._pending.pop(response_id, None)
            if pending is not None:
                pending.put(message)
            return
        if message.get("method") != "runtime.event":
            return
        event = message.get("params")
        if not isinstance(event, dict):
            raise ValueError("runtime event is invalid")
        ack = _step_render_ack(event)
        if ack is not None:
            self._send(
                {
                    "jsonrpc": "2.0",
                    "method": "operation.ack_step_rendered",
                    "params": ack,
                }
            )
        self._events.put(event)

    def _send(self, payload: dict[str, object]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise OptimizationEccAdapterError("ECC RPC is not running")
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
        if len(body) > _MAX_PAYLOAD_BYTES:
            raise OptimizationEccAdapterError("ECC RPC payload is too large")
        try:
            process.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
            process.stdin.flush()
        except OSError as exc:
            raise OptimizationEccAdapterError(
                "failed to write ECC RPC request"
            ) from exc


class _ContentLengthDecoder:
    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        self._buffer.extend(data)
        messages: list[bytes] = []
        while b"\r\n\r\n" in self._buffer:
            header, _, tail = bytes(self._buffer).partition(b"\r\n\r\n")
            length = self._content_length(header)
            if len(tail) < length:
                return messages
            messages.append(tail[:length])
            self._buffer[:] = tail[length:]
        return messages

    @staticmethod
    def _content_length(header: bytes) -> int:
        values = [
            line.split(b":", 1)[1].strip()
            for line in header.split(b"\r\n")
            if line.lower().startswith(b"content-length:")
        ]
        if len(values) != 1 or not values[0].isdigit():
            raise ValueError("Content-Length is invalid")
        length = int(values[0])
        if length > _MAX_PAYLOAD_BYTES:
            raise ValueError("Content-Length is too large")
        return length


def _valid_revision(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value.strip() != "unknown"


def _step_render_ack(event: Mapping[str, object]) -> dict[str, object] | None:
    payload = event.get("payload")
    if event.get("type") != "step.completed" or not isinstance(payload, Mapping):
        return None
    if payload.get("state") != "Success":
        return None
    operation_id = event.get("operationId")
    event_id = event.get("eventId")
    commit_id = payload.get("stepCommitId")
    revision = payload.get("workspaceRevision")
    if (
        not isinstance(operation_id, str)
        or not isinstance(event_id, str)
        or not isinstance(commit_id, str)
        or type(revision) is not int
        or revision < 0
    ):
        raise OptimizationEccAdapterError("step completion event is invalid")
    return {
        "operationId": operation_id,
        "eventId": event_id,
        "stepCommitId": commit_id,
        "workspaceRevision": revision,
    }


def _terminal_event(
    event: Mapping[str, object], operation_id: str
) -> dict[str, object] | None:
    if event.get("operationId") != operation_id:
        return None
    states = {
        "operation.completed": "succeeded",
        "operation.failed": "failed",
        "operation.cancelled": "cancelled",
    }
    state = states.get(event.get("type"))
    if state is None:
        return None
    terminal: dict[str, object] = {
        "operationId": operation_id,
        "workspaceId": event.get("workspaceId"),
        "state": state,
    }
    payload = event.get("payload")
    if isinstance(payload, Mapping) and isinstance(payload.get("result"), Mapping):
        terminal["result"] = dict(payload["result"])
    return terminal


def _safe_rpc_error_detail(error: object) -> str:
    if not isinstance(error, Mapping):
        return ""
    data = error.get("data")
    detail = data.get("message") if isinstance(data, Mapping) else None
    if not isinstance(detail, str) or not _SAFE_RPC_ERROR_DETAIL.fullmatch(detail):
        return ""
    return detail


def _candidate_id(episode_id: str, intervention_id: str) -> str:
    digest = hashlib.sha256(episode_id.encode("utf-8")).hexdigest()[:16]
    return f"candidate-{digest}-{intervention_id}"
