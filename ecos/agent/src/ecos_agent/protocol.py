"""Line-delimited JSON protocol adapter for the ECOS Agent provider."""

from __future__ import annotations

import json
import sys
from typing import Any

from ecos_agent.provider import EcosAgentProvider


class EcosAgentProtocolServer:
    def __init__(self) -> None:
        self.provider = EcosAgentProvider(emit=self._emit)

    def serve(self) -> int:
        for raw_line in sys.stdin:
            self._handle_line(raw_line)
        return 0

    def _handle_line(self, raw_line: str) -> None:
        request, request_id = _protocol_request(raw_line)
        if request is None:
            self._write({"id": request_id, "error": {"message": "Invalid provider request."}})
            return
        try:
            result = self._dispatch(request)
        except Exception as exc:
            self._write({"id": request_id, "error": {"message": str(exc)}})
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
        return handler(params or {})

    def _emit(self, event: dict[str, Any]) -> None:
        self._write({"type": "event", "event": event})

    @staticmethod
    def _write(payload: dict[str, Any]) -> None:
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
