import json
import sys
import threading

from ecos_agent.gui.protocol import EcosAgentProtocolServer


def test_gui_module_entrypoint_supports_version(monkeypatch, capsys) -> None:
    from ecos_agent.gui import __main__ as gui_main

    monkeypatch.setattr(sys, "argv", ["ecos-agent", "--version"])

    assert gui_main.entrypoint() == 0
    assert capsys.readouterr().out == "ecos-agent\n"


class _BlockingProvider:
    def __init__(self) -> None:
        self.interrupted = threading.Event()
        self.started = threading.Event()

    def send_message(self, _request):
        self.started.set()
        assert self.interrupted.wait(timeout=2)
        return {"messageId": "message-1", "sessionId": "session-1"}

    def interrupt(self, _request):
        self.interrupted.set()

    def __getattr__(self, _name):
        return lambda _request: {}


def test_protocol_processes_interrupt_while_send_message_is_running() -> None:
    server = EcosAgentProtocolServer()
    provider = _BlockingProvider()
    responses: list[dict[str, object]] = []
    server.provider = provider
    server._write = responses.append

    server._handle_line(
        json.dumps(
            {
                "id": "send-1",
                "method": "sendMessage",
                "params": {"message": "analyze", "sessionId": "session-1"},
            }
        )
    )
    assert provider.started.wait(timeout=2)

    server._handle_line(
        json.dumps(
            {
                "id": "interrupt-1",
                "method": "interrupt",
                "params": {"sessionId": "session-1"},
            }
        )
    )
    for thread in server._threads:
        thread.join(timeout=2)

    assert all(not thread.is_alive() for thread in server._threads)
    assert {response["id"] for response in responses} == {"send-1", "interrupt-1"}
    assert next(response for response in responses if response["id"] == "send-1")[
        "result"
    ] == {"messageId": "message-1", "sessionId": "session-1"}
