import json
import threading

from ecos_agent.gui.protocol import EcosAgentProtocolServer
from ecos_agent.optimization.host_transport import ProtocolHostTransport


class _HostStdio:
    def __init__(self) -> None:
        self.written: list[dict[str, object]] = []
        self._pending: dict[str, dict[str, object]] = {}
        self._condition = threading.Condition()

    def write(self, payload: dict[str, object]) -> None:
        self.written.append(payload)
        request_id = payload.get("id")
        if not isinstance(request_id, str) or "method" not in payload:
            return
        with self._condition:
            self._pending[request_id] = payload
            self._condition.notify_all()

    def wait_for_host_request(self, method: str, timeout: float = 2.0) -> dict[str, object]:
        deadline = threading.Event()
        with self._condition:
            remaining = timeout
            while remaining > 0:
                for request_id, payload in self._pending.items():
                    if payload.get("method") == method:
                        return payload
                started = threading.get_ident()
                self._condition.wait(remaining)
                remaining -= 0.05 if started else remaining
                if deadline.is_set():
                    break
                remaining = max(0.0, remaining - 0.0)
        raise AssertionError(f"host request {method} was not issued")


def test_protocol_server_answers_host_product_command_roundtrip() -> None:
    server = EcosAgentProtocolServer()
    stdio = _HostStdio()
    server._write = stdio.write
    transport = ProtocolHostTransport(server.call_host)

    result: dict[str, object] = {}
    error: list[BaseException] = []

    def run() -> None:
        try:
            result.update(
                transport.call(
                    "candidate.capabilities",
                    {"workspaceHandle": "handle-1"},
                )
            )
        except BaseException as exc:  # pragma: no cover - surfaced below
            error.append(exc)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    request = None
    for _ in range(40):
        request = next(
            (
                payload
                for payload in stdio.written
                if payload.get("method") == "candidate.capabilities"
            ),
            None,
        )
        if request is not None:
            break
        thread.join(timeout=0.05)
    assert request is not None
    assert request["params"] == {"workspaceHandle": "handle-1"}

    server._handle_line(
        json.dumps(
            {
                "id": request["id"],
                "result": {
                    "schema": "ecc.candidate_capabilities.v1",
                    "schemaVersion": 1,
                    "targets": [],
                },
            }
        )
    )
    thread.join(timeout=2)
    assert not error
    assert result == {
        "schema": "ecc.candidate_capabilities.v1",
        "schemaVersion": 1,
        "targets": [],
    }
