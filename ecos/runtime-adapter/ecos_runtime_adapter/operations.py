from __future__ import annotations

import hashlib
import json
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from ecos_runtime_adapter.flow_observer import RuntimeFlowObserver
from ecos_runtime_adapter.operation_diagnostics import tool_error_payload

_LOG_POLL_INTERVAL_SECONDS = 0.25
_MAX_LOG_CHUNK_BYTES = 16 * 1024
_MAX_FINAL_LOG_BYTES = 64 * 1024
_TERMINAL_OPERATION_STATES = frozenset({"succeeded", "failed", "cancelled", "interrupted"})


@dataclass
class _StepLogTail:
    """A bounded worker-side reader for one active step log."""

    operation_id: str
    path: Path
    step: str
    tool: str
    cursor: int
    stopped: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


class RuntimeOperationConflict(RuntimeError):
    """A workspace already owns a non-terminal runtime operation."""


class RuntimeOperationCancelled(RuntimeError):
    """Cancellation was accepted at a safe step boundary."""


class RuntimeOperationIdempotencyConflict(RuntimeError):
    """A command ID was reused with different immutable input."""


@dataclass
class RuntimeOperation:
    operation_id: str
    run_session_id: str
    runtime_instance_id: str
    workspace_id: str
    kind: str
    origin: str
    rerun: bool
    step: str = ""
    idempotency_key: str = ""
    state: str = "queued"
    current_step: str = ""
    current_tool: str = ""
    error: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    sequence: int = 0
    workspace_revision: int = 0
    cancel_requested: bool = False
    interruptibility: str = "deferred"


class RuntimeOperationManager:
    """Owns asynchronous GUI operations and their exactly-once event stream."""

    def __init__(self, publisher: Callable[[dict[str, Any]], None] | None = None):
        self._publisher = publisher
        self._lock = threading.RLock()
        self._operations: dict[str, RuntimeOperation] = {}
        self._active_by_workspace: dict[str, str] = {}
        self._idempotency: dict[tuple[str, str], tuple[str, str]] = {}
        self._step_log_tails: dict[str, _StepLogTail] = {}
        self._runtime_instance_id = uuid4().hex
        self._workspace_sequences: dict[str, int] = {}
        self._ledger_paths: dict[str, Path] = {}
        self._loaded_ledgers: set[Path] = set()

    def set_publisher(self, publisher: Callable[[dict[str, Any]], None] | None) -> None:
        with self._lock:
            self._publisher = publisher

    def start(
        self,
        *,
        workspace_id: str,
        kind: str,
        origin: str,
        rerun: bool,
        step: str,
        idempotency_key: str,
        runner: Callable[[RuntimeFlowObserver], dict[str, Any]],
        workspace_revision: int = 0,
        command_input: dict[str, Any] | None = None,
        snapshot_committer: Callable[[Any, Any, str | None], int] | None = None,
        ledger_path: str | Path | None = None,
        precondition: Callable[[], None] | None = None,
    ) -> dict[str, Any]:
        fingerprint = _command_fingerprint(
            kind=kind,
            origin=origin,
            rerun=rerun,
            step=step,
            workspace_revision=workspace_revision,
            command_input=command_input,
        )
        with self._lock:
            if ledger_path is not None:
                self._load_workspace_ledger_locked(workspace_id, Path(ledger_path))
            if idempotency_key:
                known = self._idempotency.get((workspace_id, idempotency_key))
                if known is not None:
                    known_id, known_fingerprint = known
                    if known_fingerprint != fingerprint:
                        raise RuntimeOperationIdempotencyConflict(
                            f"command id reused with different input: {idempotency_key}"
                        )
                    return {
                        **self._operation_payload(self._operations[known_id]),
                        "deduplicated": True,
                    }

            if precondition is not None:
                precondition()
            active_id = self._active_by_workspace.get(workspace_id)
            if active_id is not None:
                active = self._operations[active_id]
                raise RuntimeOperationConflict(
                    f"workspace already has an active operation: {active.operation_id}"
                )

            operation = RuntimeOperation(
                operation_id=f"operation-{uuid4().hex}",
                run_session_id=uuid4().hex,
                runtime_instance_id=self._runtime_instance_id,
                workspace_id=workspace_id,
                kind=kind,
                origin=origin,
                rerun=rerun,
                step=step,
                idempotency_key=idempotency_key,
                workspace_revision=workspace_revision,
            )
            self._operations[operation.operation_id] = operation
            self._active_by_workspace[workspace_id] = operation.operation_id
            if idempotency_key:
                self._idempotency[(workspace_id, idempotency_key)] = (
                    operation.operation_id,
                    fingerprint,
                )
            self._persist_workspace_ledger_locked(workspace_id)
            queued_event = self._new_event_locked(operation, "operation.queued", {})

        self._publish(queued_event)
        thread = threading.Thread(
            target=self._run,
            args=(operation.operation_id, runner, snapshot_committer),
            name=f"ecc-runtime-{operation.operation_id}",
            daemon=True,
        )
        thread.start()
        return self.operation_status(operation.operation_id)

    def operation_status(self, operation_id: str) -> dict[str, Any]:
        with self._lock:
            operation = self._operations.get(operation_id)
            if operation is None:
                raise KeyError(operation_id)
            return self._operation_payload(operation)

    def load_workspace_ledger(self, workspace_id: str, ledger_path: str | Path) -> list[str]:
        with self._lock:
            return self._load_workspace_ledger_locked(workspace_id, Path(ledger_path))

    def is_active(self, operation_id: str) -> bool:
        with self._lock:
            operation = self._operations.get(operation_id)
            return operation is not None and operation.state not in _TERMINAL_OPERATION_STATES

    def has_active_workspace(self, workspace_id: str) -> bool:
        with self._lock:
            return workspace_id in self._active_by_workspace

    def workspace_snapshot(self, workspace_id: str) -> dict[str, Any]:
        with self._lock:
            operations = [
                self._operation_payload(operation)
                for operation in self._operations.values()
                if operation.workspace_id == workspace_id
            ]
            return {
                "workspaceId": workspace_id,
                "runtimeInstanceId": self._runtime_instance_id,
                "lastEventId": (
                    f"{self._runtime_instance_id}:{workspace_id}:"
                    f"{self._workspace_sequences.get(workspace_id, 0)}"
                ),
                "operations": operations,
            }

    def request_cancel(self, operation_id: str) -> dict[str, Any]:
        with self._lock:
            operation = self._operations.get(operation_id)
            if operation is None:
                raise KeyError(operation_id)
            if operation.state in _TERMINAL_OPERATION_STATES:
                return {"accepted": False, "operationId": operation_id, "state": operation.state}
            operation.cancel_requested = True
            operation.updated_at = time.time()
            self._persist_workspace_ledger_locked(operation.workspace_id)
            event = self._new_event_locked(operation, "operation.cancel_requested", {})
        self._publish(event)
        return {"accepted": True, "operationId": operation_id, "state": operation.state}

    def raise_if_cancel_requested(self, operation_id: str) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            if operation.cancel_requested:
                raise RuntimeOperationCancelled("operation cancelled at a step boundary")

    def shutdown_barrier(self) -> dict[str, Any] | None:
        with self._lock:
            for operation_id in self._active_by_workspace.values():
                operation = self._operations[operation_id]
                return {
                    "operationId": operation.operation_id,
                    "workspaceId": operation.workspace_id,
                    "state": operation.state,
                    "step": operation.current_step,
                    "interruptibility": operation.interruptibility,
                    "safeToStop": operation.interruptibility == "safe",
                    "cancelRequested": operation.cancel_requested,
                }
        return None

    def _run(
        self,
        operation_id: str,
        runner: Callable[[RuntimeFlowObserver], dict[str, Any]],
        snapshot_committer: Callable[[Any, Any, str | None], int] | None,
    ) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            operation.state = "running"
            operation.updated_at = time.time()
            self._persist_workspace_ledger_locked(operation.workspace_id)
            started_event = self._new_event_locked(operation, "operation.started", {})
        observer = RuntimeFlowObserver(self, operation_id, snapshot_committer)
        try:
            self._publish(started_event)
            try:
                result = runner(observer)
                with self._lock:
                    operation = self._operations[operation_id]
                    if operation.cancel_requested:
                        raise RuntimeOperationCancelled("operation cancelled at a step boundary")
                    operation.state = "succeeded"
                    operation.result = result
                    operation.updated_at = time.time()
                    event = self._new_event_locked(
                        operation,
                        "operation.completed",
                        {"result": result},
                    )
                    self._persist_workspace_ledger_locked(operation.workspace_id)
            except RuntimeOperationCancelled as exc:
                with self._lock:
                    operation = self._operations[operation_id]
                    if operation.error is not None:
                        operation.state = "failed"
                        event_type = "operation.failed"
                    else:
                        operation.state = "cancelled"
                        operation.error = {
                            "message": str(exc),
                            "code": "cancelled",
                        }
                        event_type = "operation.cancelled"
                    operation.updated_at = time.time()
                    event = self._new_event_locked(
                        operation,
                        event_type,
                        {"error": operation.error},
                    )
                    self._persist_workspace_ledger_locked(operation.workspace_id)
            except Exception as exc:
                with self._lock:
                    operation = self._operations[operation_id]
                    if operation.cancel_requested and operation.error is None:
                        operation.state = "cancelled"
                        operation.error = {"message": str(exc), "code": "cancelled"}
                        event_type = "operation.cancelled"
                    else:
                        operation.state = "failed"
                        operation.error = operation.error or {
                            "message": str(getattr(exc, "message", exc)),
                            "code": str(getattr(exc, "code", "command_failed")),
                        }
                        event_type = "operation.failed"
                    operation.updated_at = time.time()
                    payload = {"error": operation.error}
                    if operation.error:
                        payload.update(
                            {
                                key: operation.error[key]
                                for key in ("step", "tool", "logFile")
                                if key in operation.error
                            }
                        )
                    event = self._new_event_locked(operation, event_type, payload)
                    self._persist_workspace_ledger_locked(operation.workspace_id)
            self._publish(event)
        finally:
            try:
                self._stop_step_log_tail(operation_id)
            finally:
                with self._lock:
                    self._active_by_workspace.pop(
                        self._operations[operation_id].workspace_id,
                        None,
                    )

    def step_started(self, operation_id: str, workspace_step: Any) -> None:
        self._stop_step_log_tail(operation_id)
        with self._lock:
            operation = self._operations[operation_id]
            operation.current_step = str(getattr(workspace_step, "name", ""))
            operation.current_tool = str(getattr(workspace_step, "tool", ""))
            operation.updated_at = time.time()
            self._persist_workspace_ledger_locked(operation.workspace_id)
            event = self._new_event_locked(
                operation,
                "step.started",
                {
                    "step": operation.current_step,
                    "tool": operation.current_tool,
                    "state": "Ongoing",
                },
            )
            log_tail = _step_log_tail_for(
                operation_id,
                getattr(workspace_step, "log", None),
                operation.current_step,
                operation.current_tool,
            )
            if log_tail is not None:
                self._step_log_tails[operation_id] = log_tail
        self._publish(event)
        if log_tail is not None:
            thread = threading.Thread(
                target=self._tail_step_log,
                args=(log_tail,),
                name=f"ecc-runtime-log-{operation_id}",
                daemon=True,
            )
            log_tail.thread = thread
            thread.start()

    def rerun_prepared(
        self,
        operation_id: str,
        *,
        affected_steps: list[str],
        scope: str,
        workspace_revision: int,
        target_step: str = "",
    ) -> None:
        """Publish the idempotent GUI reset boundary before a rerun starts."""
        with self._lock:
            operation = self._operations[operation_id]
            operation.workspace_revision = workspace_revision
            operation.updated_at = time.time()
            event = self._new_event_locked(
                operation,
                "operation.rerun_prepared",
                {
                    "affectedSteps": affected_steps,
                    "scope": scope,
                    "targetStep": target_step,
                    "workspaceRevision": workspace_revision,
                },
            )
            self._persist_workspace_ledger_locked(operation.workspace_id)
        self._publish(event)

    def step_completed(
        self,
        operation_id: str,
        workspace_step: Any,
        state: Any,
        error: str | None = None,
        workspace_revision: int | None = None,
    ) -> None:
        self._stop_step_log_tail(operation_id)
        state_value = str(getattr(state, "value", state))
        final_log = _read_final_log(getattr(workspace_step, "log", None))
        with self._lock:
            operation = self._operations[operation_id]
            operation.current_step = str(getattr(workspace_step, "name", ""))
            operation.current_tool = str(getattr(workspace_step, "tool", ""))
            operation.updated_at = time.time()
            payload: dict[str, Any] = {
                "finalLog": final_log,
                "step": operation.current_step,
                "tool": operation.current_tool,
                "state": state_value,
            }
            if error:
                operation.error = operation.error or tool_error_payload(workspace_step, error)
                payload["error"] = operation.error
                payload["logFile"] = operation.error["logFile"]
            event = self._new_event_locked(operation, "step.completed", payload)
            if workspace_revision is None:
                operation.workspace_revision += 1
            else:
                operation.workspace_revision = workspace_revision
            step_commit_id = f"{operation.operation_id}:step:{operation.workspace_revision}"
            payload["stepCommitId"] = step_commit_id
            payload["workspaceRevision"] = operation.workspace_revision
            self._persist_workspace_ledger_locked(operation.workspace_id)
        self._publish(event)

    def step_diagnostic(
        self,
        operation_id: str,
        workspace_step: Any,
        diagnostic: dict[str, Any],
    ) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            operation.error = tool_error_payload(
                workspace_step,
                str(diagnostic.get("message", "tool failed")),
                diagnostic,
            )

    def subflow_stage(
        self,
        operation_id: str,
        workspace_step: Any,
        subflow_step: dict[str, Any],
    ) -> None:
        """Publish a saved inner-flow state without waiting for a render ACK."""
        with self._lock:
            operation = self._operations[operation_id]
            step = str(getattr(workspace_step, "name", ""))
            tool = str(getattr(workspace_step, "tool", ""))
            event = self._new_event_locked(
                operation,
                "subflow.stage",
                {
                    "peakMemory": subflow_step.get("peak memory (mb)", 0),
                    "runtime": str(subflow_step.get("runtime", "")),
                    "state": str(subflow_step.get("state", "Unstart")),
                    "step": step,
                    "subflowStep": str(subflow_step.get("name", "")),
                    "tool": tool,
                },
            )
        self._publish(event)

    def step_skipped(self, operation_id: str, workspace_step: Any) -> None:
        self._stop_step_log_tail(operation_id)
        with self._lock:
            operation = self._operations[operation_id]
            operation.current_step = str(getattr(workspace_step, "name", ""))
            operation.current_tool = str(getattr(workspace_step, "tool", ""))
            operation.updated_at = time.time()
            event = self._new_event_locked(
                operation,
                "step.completed",
                {
                    "step": operation.current_step,
                    "tool": operation.current_tool,
                    "state": "Skipped",
                },
            )
        self._publish(event)

    def _tail_step_log(self, log_tail: _StepLogTail) -> None:
        while not log_tail.stopped.is_set():
            self._publish_step_log_delta(log_tail)
            log_tail.stopped.wait(_LOG_POLL_INTERVAL_SECONDS)

    def _publish_step_log_delta(self, log_tail: _StepLogTail) -> None:
        try:
            size = log_tail.path.stat().st_size
            if size < log_tail.cursor:
                # A rerun may truncate or replace a log file. The renderer treats
                # this as a new bounded stream for the same step attempt.
                log_tail.cursor = 0
            if size <= log_tail.cursor:
                return
            with log_tail.path.open("rb") as log_file:
                log_file.seek(log_tail.cursor)
                chunk = log_file.read(_MAX_LOG_CHUNK_BYTES)
        except OSError:
            return

        if not chunk:
            return
        log_tail.cursor += len(chunk)
        text = chunk.decode("utf-8", errors="replace")
        with self._lock:
            if self._step_log_tails.get(log_tail.operation_id) is not log_tail:
                return
            operation = self._operations.get(log_tail.operation_id)
            if operation is None:
                return
            event = self._new_event_locked(
                operation,
                "step.log",
                {
                    "chunk": text,
                    "cursor": log_tail.cursor,
                    "step": log_tail.step,
                    "tool": log_tail.tool,
                },
            )
        self._publish(event)

    def _stop_step_log_tail(self, operation_id: str) -> None:
        with self._lock:
            log_tail = self._step_log_tails.pop(operation_id, None)
        if log_tail is None:
            return
        log_tail.stopped.set()
        if log_tail.thread is not None and log_tail.thread is not threading.current_thread():
            log_tail.thread.join(timeout=_LOG_POLL_INTERVAL_SECONDS + 0.25)

    def _new_event_locked(
        self,
        operation: RuntimeOperation,
        event_type: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        sequence = self._workspace_sequences.get(operation.workspace_id, 0) + 1
        self._workspace_sequences[operation.workspace_id] = sequence
        operation.sequence = sequence
        return {
            "eventId": f"{self._runtime_instance_id}:{operation.operation_id}:{sequence}",
            "runtimeInstanceId": self._runtime_instance_id,
            "runSessionId": operation.run_session_id,
            "sequence": sequence,
            "type": event_type,
            "workspaceId": operation.workspace_id,
            "workspaceRevision": operation.workspace_revision,
            "operationId": operation.operation_id,
            "origin": operation.origin,
            "kind": operation.kind,
            "rerun": operation.rerun,
            "timestamp": time.time(),
            "payload": payload,
        }

    @staticmethod
    def _operation_payload(operation: RuntimeOperation) -> dict[str, Any]:
        return {
            "operationId": operation.operation_id,
            "runSessionId": operation.run_session_id,
            "runtimeInstanceId": operation.runtime_instance_id,
            "workspaceId": operation.workspace_id,
            "kind": operation.kind,
            "origin": operation.origin,
            "rerun": operation.rerun,
            "step": operation.step,
            "state": operation.state,
            "currentStep": operation.current_step,
            "currentTool": operation.current_tool,
            "error": operation.error,
            "result": operation.result,
            "workspaceRevision": operation.workspace_revision,
            "cancelRequested": operation.cancel_requested,
            "interruptibility": operation.interruptibility,
            "safeToStop": operation.interruptibility == "safe",
            "shutdownBarrier": operation.state not in _TERMINAL_OPERATION_STATES,
            "createdAt": operation.created_at,
            "updatedAt": operation.updated_at,
        }

    def _publish(self, event: dict[str, Any]) -> None:
        publisher = self._publisher
        if publisher is not None:
            publisher(event)

    def _load_workspace_ledger_locked(self, workspace_id: str, ledger_path: Path) -> list[str]:
        ledger_path = ledger_path.resolve()
        self._ledger_paths[workspace_id] = ledger_path
        if ledger_path in self._loaded_ledgers:
            return []
        self._loaded_ledgers.add(ledger_path)
        try:
            payload = json.loads(ledger_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, json.JSONDecodeError) as exc:
            raise OSError(f"invalid Runtime Operation ledger: {ledger_path}") from exc
        if payload.get("schemaVersion") != 1 or not isinstance(payload.get("commands"), dict):
            raise OSError(f"invalid Runtime Operation ledger: {ledger_path}")
        recovered = []
        events = []
        for command_id, record in payload["commands"].items():
            if not isinstance(record, dict) or not isinstance(record.get("operation"), dict):
                continue
            operation = _operation_from_record(record["operation"])
            if operation.workspace_id != workspace_id:
                continue
            self._operations[operation.operation_id] = operation
            self._idempotency[(workspace_id, command_id)] = (
                operation.operation_id,
                str(record.get("fingerprint", "")),
            )
            if operation.state not in _TERMINAL_OPERATION_STATES:
                operation.state = "interrupted"
                operation.error = {
                    "code": "interrupted",
                    "message": "Runtime Adapter exited before confirming a terminal outcome.",
                }
                operation.updated_at = time.time()
                recovered.append(operation.operation_id)
                events.append(
                    self._new_event_locked(
                        operation,
                        "operation.interrupted",
                        {"error": operation.error, "state": "interrupted"},
                    )
                )
        if recovered:
            self._persist_workspace_ledger_locked(workspace_id)
        for event in events:
            self._publish(event)
        return recovered

    def _persist_workspace_ledger_locked(self, workspace_id: str) -> None:
        path = self._ledger_paths.get(workspace_id)
        if path is None:
            return
        from chipcompiler.utility import json_write

        commands = {}
        for (candidate_workspace_id, command_id), (
            operation_id,
            fingerprint,
        ) in self._idempotency.items():
            if candidate_workspace_id != workspace_id:
                continue
            operation = self._operations.get(operation_id)
            if operation is None:
                continue
            commands[command_id] = {
                "fingerprint": fingerprint,
                "operation": asdict(operation),
            }
        path.parent.mkdir(parents=True, exist_ok=True)
        if not json_write(path, {"schemaVersion": 1, "commands": commands}):
            raise OSError(f"failed to persist Runtime Operation ledger: {path}")


def _read_final_log(log: Any) -> str:
    path = getattr(log, "file", None)
    if not path:
        return ""
    try:
        with Path(path).open("rb") as log_file:
            log_file.seek(0, 2)
            size = log_file.tell()
            log_file.seek(max(0, size - _MAX_FINAL_LOG_BYTES))
            return log_file.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _step_log_tail_for(
    operation_id: str,
    log: Any,
    step: str,
    tool: str,
) -> _StepLogTail | None:
    path = getattr(log, "file", None)
    if not path:
        return None
    log_path = Path(path)
    try:
        cursor = log_path.stat().st_size
    except OSError:
        cursor = 0
    return _StepLogTail(
        operation_id=operation_id,
        path=log_path,
        step=step,
        tool=tool,
        cursor=cursor,
    )


def _command_fingerprint(
    *,
    kind: str,
    origin: str,
    rerun: bool,
    step: str,
    workspace_revision: int,
    command_input: dict[str, Any] | None = None,
) -> str:
    encoded = json.dumps(
        {
            "kind": kind,
            "origin": origin,
            "rerun": rerun,
            "step": step,
            "workspaceRevision": workspace_revision,
            "commandInput": command_input or {},
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _operation_from_record(record: dict[str, Any]) -> RuntimeOperation:
    required = {
        "operation_id",
        "run_session_id",
        "runtime_instance_id",
        "workspace_id",
        "kind",
        "origin",
        "rerun",
    }
    if not required <= record.keys():
        raise OSError("invalid Runtime Operation record")
    fields = RuntimeOperation.__dataclass_fields__
    return RuntimeOperation(**{key: value for key, value in record.items() if key in fields})
