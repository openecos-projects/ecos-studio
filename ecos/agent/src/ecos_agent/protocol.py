"""Line-delimited JSON protocol adapter for the ECOS Agent provider."""

from __future__ import annotations

import json
import sys
import threading
from typing import Any

from ecos_agent.provider import EcosAgentProvider
from ecos_agent.optimization_runtime import create_optimization_runner


class EcosAgentProtocolServer:
    def __init__(self) -> None:
        self._threads: list[threading.Thread] = []
        self._write_lock = threading.Lock()
        self.provider = EcosAgentProvider(
            emit=self._emit,
            optimization_runner_factory=create_optimization_runner,
        )

    def serve(self) -> int:
        for raw_line in sys.stdin:
            self._handle_line(raw_line)
        for thread in self._threads:
            thread.join()
        return 0

    def _handle_line(self, raw_line: str) -> None:
        request, request_id = _protocol_request(raw_line)
        if request is None:
            self._write({"id": request_id, "error": {"message": "Invalid provider request."}})
            return
        if request.get("method") in {"sendMessage", "answerInteraction"}:
            self._threads = [thread for thread in self._threads if thread.is_alive()]
            thread = threading.Thread(
                target=self._handle_request, args=(request, request_id), daemon=True
            )
            self._threads.append(thread)
            thread.start()
            return
        self._handle_request(request, request_id)

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


def _protocol_request(raw_line: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        payload = json.loads(raw_line)
    except json.JSONDecodeError:
        return None, None
    if not isinstance(payload, dict):
        return None, None
    request_id, method = payload.get("id"), payload.get("method")
    if not isinstance(request_id, str) or not request_id or not isinstance(method, str) or not method:
        return None, request_id if isinstance(request_id, str) else None
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
