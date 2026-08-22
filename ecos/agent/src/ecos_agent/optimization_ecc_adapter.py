"""Fixed ECC JSON-RPC execution boundary for optimization candidates."""

from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Mapping, Protocol

from ecos_agent.optimization_contracts import OptimizationKnob
from ecos_agent.optimization_controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SAFE_RPC_ERROR_DETAIL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .:_-]{0,255}$")
_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
_ALLOWED_METHODS = frozenset(
    {
        "candidate.rerun",
        "operation.cancel",
        "operation.status",
        "operation.ack_step_rendered",
    }
)
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})


class OptimizationEccAdapterError(RuntimeError):
    """The fixed ECC execution contract was not satisfied."""


class EccRpcTransport(Protocol):
    def call(self, method: str, params: dict[str, object]) -> dict[str, object]: ...

    def wait_for_terminal(
        self, operation_id: str, timeout_seconds: float
    ) -> dict[str, object] | None: ...


class EccCandidateRerunAdapter:
    """Materialize one approved knob value into the only permitted ECC RPC."""

    def __init__(
        self,
        rpc: EccRpcTransport,
        *,
        workspace_id: str,
        site_width_dbu: int,
    ) -> None:
        if not _ID.fullmatch(workspace_id):
            raise OptimizationEccAdapterError("workspace id is invalid")
        if type(site_width_dbu) is not int or site_width_dbu <= 0:
            raise OptimizationEccAdapterError("site width is invalid")
        self._rpc = rpc
        self._workspace_id = workspace_id
        self._site_width_dbu = site_width_dbu

    def start(self, request: CandidateExecutionRequest) -> CandidateExecutionReceipt:
        if not _ID.fullmatch(request.episode_id) or not _ID.fullmatch(
            request.intervention_id
        ):
            raise OptimizationEccAdapterError("candidate request id is invalid")
        patch = self._materialize_patch(request)
        response = self._rpc.call(
            "candidate.rerun",
            {
                "workspaceId": self._workspace_id,
                "targetStep": "place",
                "endStep": "Harden",
                "candidateId": request.intervention_id,
                "patch": [patch],
                "executionScope": "full_flow",
                "idempotencyKey": f"{request.episode_id}.{request.intervention_id}",
            },
        )
        operation_id, state = self._validate_operation(response)
        evidence = self._evidence(response)
        if state == "failed":
            return CandidateExecutionReceipt(
                execution_id=operation_id,
                started=True,
                outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
                evidence=evidence,
            )
        if state == "cancelled":
            return CandidateExecutionReceipt(
                execution_id=operation_id,
                started=True,
                outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
                evidence=evidence,
            )
        return CandidateExecutionReceipt(execution_id=operation_id, started=True)

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        if not _ID.fullmatch(intervention_id):
            raise OptimizationEccAdapterError("operation id is invalid")
        response = self._rpc.call("operation.cancel", {"operationId": intervention_id})
        returned_id = response.get("operationId")
        if returned_id is not None and returned_id != intervention_id:
            raise OptimizationEccAdapterError("cancel operation id does not match")
        terminal = self._rpc.wait_for_terminal(intervention_id, timeout_seconds=60.0)
        if terminal is None:
            return CandidateExecutionReceipt(execution_id=intervention_id, started=True)
        terminal_id, state = self._validate_operation(terminal, require_workspace=False)
        if terminal_id != intervention_id:
            raise OptimizationEccAdapterError("terminal operation id does not match")
        outcome = (
            OptimizationOutcomeKind.TIMED_OUT_CANCELLED
            if state in {"cancelled", "failed"}
            else None
        )
        return CandidateExecutionReceipt(
            execution_id=intervention_id, started=True, outcome=outcome
        )

    def wait_for_terminal(
        self,
        execution_id: str,
        *,
        timeout_seconds: float = 60.0,
    ) -> CandidateExecutionReceipt:
        if not _ID.fullmatch(execution_id):
            raise OptimizationEccAdapterError("operation id is invalid")
        if type(timeout_seconds) not in {int, float} or timeout_seconds <= 0:
            raise OptimizationEccAdapterError("terminal wait timeout is invalid")
        terminal = self._rpc.wait_for_terminal(execution_id, float(timeout_seconds))
        if terminal is None:
            return CandidateExecutionReceipt(execution_id=execution_id, started=True)
        terminal_id, state = self._validate_operation(terminal)
        if terminal_id != execution_id:
            raise OptimizationEccAdapterError("terminal operation id does not match")
        if state not in _TERMINAL_STATES:
            raise OptimizationEccAdapterError("terminal operation state is invalid")
        outcome = {
            "failed": OptimizationOutcomeKind.EXECUTION_FAILED,
            "cancelled": OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
        }.get(state)
        return CandidateExecutionReceipt(
            execution_id=execution_id,
            started=True,
            outcome=outcome,
            evidence=self._evidence(terminal),
        )

    @staticmethod
    def _evidence(response: Mapping[str, object]) -> CandidateExecutionEvidence | None:
        result = response.get("result")
        if result is None:
            return None
        if not isinstance(result, Mapping):
            raise OptimizationEccAdapterError("candidate terminal result is invalid")
        values = {
            "candidate_root_ref": result.get("candidateRootRef"),
            "candidate_manifest_ref": result.get("candidateManifestRef"),
            "candidate_manifest_sha256": result.get("candidateManifestSha256"),
        }
        if all(value is None for value in values.values()):
            return None
        if not all(isinstance(value, str) for value in values.values()):
            raise OptimizationEccAdapterError("candidate terminal evidence is incomplete")
        try:
            return CandidateExecutionEvidence(**values)
        except ValueError as exc:
            raise OptimizationEccAdapterError("candidate terminal evidence is invalid") from exc

    def _materialize_patch(
        self, request: CandidateExecutionRequest
    ) -> dict[str, object]:
        action = request.proposal.action
        if action is None or request.requested.knob_id != action.knob_id:
            raise OptimizationEccAdapterError("requested knob does not match proposal")
        value = request.requested.value
        if request.requested.knob_id == OptimizationKnob.CELL_PADDING_X:
            if type(value) is not int:
                raise OptimizationEccAdapterError("cell padding value is invalid")
            value *= self._site_width_dbu
        elif request.requested.knob_id == OptimizationKnob.TARGET_DENSITY:
            if type(value) not in {int, float} or isinstance(value, bool):
                raise OptimizationEccAdapterError("target density value is invalid")
            value = float(value)
        elif type(value) is not bool:
            raise OptimizationEccAdapterError("routability value is invalid")
        return {"knob_id": request.requested.knob_id.value, "value": value}

    def _validate_operation(
        self,
        response: Mapping[str, object],
        *,
        require_workspace: bool = True,
    ) -> tuple[str, str]:
        operation_id = response.get("operationId")
        state = response.get("state")
        if not isinstance(operation_id, str) or not _ID.fullmatch(operation_id):
            raise OptimizationEccAdapterError("operation id is invalid")
        if not isinstance(state, str) or state not in {
            "queued",
            "running",
            *_TERMINAL_STATES,
        }:
            raise OptimizationEccAdapterError("operation state is invalid")
        if require_workspace and response.get("workspaceId") != self._workspace_id:
            raise OptimizationEccAdapterError("operation workspace does not match")
        return operation_id, state


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
            status = self._request(
                "operation.status",
                {"operationId": operation_id},
                timeout_seconds=min(self._response_timeout_seconds, remaining),
            )
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
    return None if state is None else {"operationId": operation_id, "state": state}


def _safe_rpc_error_detail(error: object) -> str:
    if not isinstance(error, Mapping):
        return ""
    data = error.get("data")
    detail = data.get("message") if isinstance(data, Mapping) else None
    if not isinstance(detail, str) or not _SAFE_RPC_ERROR_DETAIL.fullmatch(detail):
        return ""
    return detail
