"""Line-delimited JSON protocol adapter for the ECOS Agent provider."""

from __future__ import annotations

import json
import sys
import threading
import uuid
from typing import Any

from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.optimization.host_transport import (
    ProtocolHostTransport,
    _PendingHostCall,
    bind_host_transport,
)
from ecos_agent.optimization.runtime import create_optimization_runner


class EcosAgentProtocolServer:
    def __init__(self) -> None:
        self._threads: list[threading.Thread] = []
        self._write_lock = threading.Lock()
        self._pending_host: dict[str, _PendingHostCall] = {}
        self.provider = EcosAgentProvider(
            emit=self._emit,
            optimization_runner_factory=create_optimization_runner,
        )
        bind_host_transport(ProtocolHostTransport(self.call_host))

    def serve(self) -> int:
        for raw_line in sys.stdin:
            self._handle_line(raw_line)
        for thread in self._threads:
            thread.join()
        return 0

    def call_host(
        self, method: str, params: dict[str, object], *, timeout_seconds: float = 600.0
    ) -> dict[str, object]:
        request_id = uuid.uuid4().hex
        pending = _PendingHostCall()
        self._pending_host[request_id] = pending
        try:
            self._write({"id": request_id, "method": method, "params": params})
            payload = pending.wait(timeout_seconds)
        except TimeoutError as exc:
            raise TimeoutError(f"host Product Command {method} timed out") from exc
        finally:
            self._pending_host.pop(request_id, None)
        if "error" in payload:
            error = payload["error"]
            if isinstance(error, dict):
                message = error.get("message")
            else:
                message = error
            raise RuntimeError(str(message or f"host Product Command {method} failed"))
        result = payload.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"host Product Command {method} result is invalid")
        return result

    def _handle_line(self, raw_line: str) -> None:
        payload, request_id = _protocol_record(raw_line)
        if payload is None:
            self._write({"id": request_id, "error": {"message": "Invalid provider request."}})
            return
        if request_id is not None and not payload.get("method"):
            pending = self._pending_host.get(request_id)
            if pending is not None:
                pending.complete(payload)
                return
            if "result" in payload or "error" in payload:
                return
            self._write({"id": request_id, "error": {"message": "Unknown host response."}})
            return
        if payload.get("method") in {"sendMessage", "answerInteraction"}:
            self._threads = [thread for thread in self._threads if thread.is_alive()]
            thread = threading.Thread(
                target=self._handle_request, args=(payload, request_id), daemon=True
            )
            self._threads.append(thread)
            thread.start()
            return
        self._handle_request(payload, request_id)

    def _handle_request(self, request: dict[str, Any], request_id: str | None) -> None:
        try:
            result = self._dispatch(request)
        except Exception as exc:
            error: dict[str, str] = {"message": str(exc)}
            if request.get("method") == "answerInteraction":
                error["code"] = _interaction_error_code(str(exc))
            self._write({"id": request_id, "error": error})
            return
        self._write({"id": request_id, "result": result})

    def _dispatch(self, request: dict[str, Any]) -> Any:
        params = request.get("params")
        if params is not None and not isinstance(params, dict):
            raise ValueError("Provider request params must be an object.")
        handlers = {
            "start": self.provider.start,
            "startSession": self.provider.start_session,
            "sendMessage": self.provider.send_message,
            "getModelSettings": self.provider.get_model_settings,
            "setModelSettings": self.provider.set_model_settings,
            "answerInteraction": self.provider.answer_interaction,
            "interrupt": self.provider.interrupt,
            "getStatus": self.provider.get_status,
            "setMode": self.provider.set_mode,
            "listSessions": self.provider.list_sessions,
            "resumeSession": self.provider.resume_session,
            "resumeOptimizationEpisode": self.provider.resume_optimization_episode,
            "stopOptimizationEpisode": self.provider.stop_optimization_episode,
            "prepareOptimizationShutdown": self.provider.prepare_optimization_shutdown,
            "cancelOptimizationShutdown": self.provider.cancel_optimization_shutdown,
            "stop": self.provider.stop,
        }
        handler = handlers.get(request["method"])
        if handler is None:
            raise ValueError(f"Unsupported provider method: {request['method']}")
        if request["method"] == "answerInteraction":
            return handler(params or {}, defer=True)
        return handler(params or {})

    def _emit(self, event: dict[str, Any]) -> None:
        self._write({"type": "event", "event": event})

    def _write(self, payload: dict[str, Any]) -> None:
        with self._write_lock:
            sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def main() -> int:
    return EcosAgentProtocolServer().serve()


def _protocol_record(raw_line: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        payload = json.loads(raw_line)
    except json.JSONDecodeError:
        return None, None
    if not isinstance(payload, dict):
        return None, None
    request_id = payload.get("id")
    if not isinstance(request_id, str) or not request_id:
        return None, request_id if isinstance(request_id, str) else None
    method = payload.get("method")
    if method is None:
        return payload, request_id
    if not isinstance(method, str) or not method:
        return None, request_id
    return payload, request_id


def _interaction_error_code(message: str) -> str:
    text = message.casefold()
    if "already answered" in text:
        return "interaction_already_answered"
    if "superseded" in text:
        return "interaction_superseded"
    if "expired" in text:
        return "interaction_expired"
    if "option" in text:
        return "interaction_option_invalid"
    if "form" in text or "field" in text:
        return "interaction_form_invalid"
    if "kind" in text:
        return "interaction_kind_mismatch"
    return "interaction_not_pending"
