from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

from ecos_agent.optimization.ecc.adapter import (
    EccContentLengthRpcClient,
    OptimizationEccAdapterError,
    _step_render_ack,
    _terminal_event,
)

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64



from tests.optimization.ecc_adapter_support import (
    CHUNK_HASH,
    HASH,
)

def test_step_completed_event_has_one_fixed_render_ack() -> None:
    assert _step_render_ack(
        {
            "type": "step.completed",
            "eventId": "event-1",
            "operationId": "operation-1",
            "payload": {
                "state": "Success",
                "stepCommitId": "operation-1:step:1",
                "workspaceRevision": 1,
            },
        }
    ) == {
        "operationId": "operation-1",
        "eventId": "event-1",
        "stepCommitId": "operation-1:step:1",
        "workspaceRevision": 1,
    }
    assert (
        _step_render_ack(
            {
                "type": "step.completed",
                "eventId": "event-1",
                "operationId": "operation-1",
                "payload": {"state": "Failed"},
            }
        )
        is None
    )


def test_stdio_client_queues_only_terminal_events_and_keeps_step_ack(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)
    sent = []
    monkeypatch.setattr(client, "_send", sent.append)
    step = {
        "type": "step.completed",
        "eventId": "event-1",
        "operationId": "operation-1",
        "payload": {
            "state": "Success",
            "stepCommitId": "operation-1:step:1",
            "workspaceRevision": 1,
        },
    }
    terminal = {
        "type": "operation.completed",
        "operationId": "operation-1",
        "payload": {"state": "succeeded"},
    }

    client._handle_message(
        json.dumps({"method": "runtime.event", "params": step}).encode()
    )
    client._handle_message(
        json.dumps({"method": "runtime.event", "params": step}).encode()
    )
    client._handle_message(
        json.dumps(
            {
                "method": "runtime.event",
                "params": {
                    "type": "step.log",
                    "operationId": "operation-1",
                    "payload": {"lines": ["noise"]},
                },
            }
        ).encode()
    )
    client._handle_message(
        json.dumps({"method": "runtime.event", "params": terminal}).encode()
    )

    assert sent == [
        {
            "jsonrpc": "2.0",
            "method": "operation.ack_step_rendered",
            "params": {
                "operationId": "operation-1",
                "eventId": "event-1",
                "stepCommitId": "operation-1:step:1",
                "workspaceRevision": 1,
            },
        }
    ]
    assert client._events.get_nowait() == terminal
    assert client._events.empty()


def test_stdio_client_deduplicates_step_ack_per_operation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)
    sent = []
    monkeypatch.setattr(client, "_send", sent.append)

    def event(operation_id: str) -> dict[str, object]:
        return {
            "type": "step.completed",
            "eventId": "event-1",
            "operationId": operation_id,
            "payload": {
                "state": "Success",
                "stepCommitId": f"{operation_id}:step:1",
                "workspaceRevision": 1,
            },
        }

    client._handle_message(
        json.dumps({"method": "runtime.event", "params": event("operation-1")}).encode()
    )
    client._handle_message(
        json.dumps({"method": "runtime.event", "params": event("operation-2")}).encode()
    )

    assert [item["params"]["operationId"] for item in sent] == [
        "operation-1",
        "operation-2",
    ]


def test_terminal_event_preserves_failure_error() -> None:
    terminal = _terminal_event(
        {
            "type": "operation.failed",
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "payload": {
                "error": {"code": "command_failed", "message": "Sizer failed"},
                "result": {"candidateId": "candidate-1"},
            },
        },
        "operation-1",
    )

    assert terminal == {
        "operationId": "operation-1",
        "workspaceId": "workspace-1",
        "state": "failed",
        "error": {"code": "command_failed", "message": "Sizer failed"},
        "result": {"candidateId": "candidate-1"},
    }


def test_stdio_client_requires_an_absolute_executable_path(tmp_path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)

    with pytest.raises(OptimizationEccAdapterError, match="absolute"):
        EccContentLengthRpcClient(Path("ecc"))

    client = EccContentLengthRpcClient(executable)

    assert client.command == (str(executable),)


def test_stdio_client_exposes_ecc_revision(monkeypatch, tmp_path: Path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)
    monkeypatch.setattr(
        client,
        "call",
        lambda method, params: {"eccVersion": "ecc-test-revision"},
    )

    assert client.ecc_revision() == "ecc-test-revision"


def test_stdio_client_opens_workspace(monkeypatch, tmp_path: Path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)
    monkeypatch.setattr(
        client,
        "_request",
        lambda method, params, *, timeout_seconds: {
            "workspaceId": "workspace-1",
            "directory": str(tmp_path.resolve()),
        },
    )

    assert client.open_workspace(tmp_path) == "workspace-1"


def test_stdio_client_allows_candidate_resume(monkeypatch, tmp_path: Path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)
    calls = []
    monkeypatch.setattr(
        client,
        "_request",
        lambda method, params, *, timeout_seconds: calls.append(
            (method, params, timeout_seconds)
        )
        or {"state": "queued"},
    )

    assert client.call("candidate.resume", {"candidateId": "candidate-1"}) == {
        "state": "queued"
    }
    assert calls == [
        (
            "candidate.resume",
            {"candidateId": "candidate-1"},
            10.0,
        )
    ]


def test_stdio_client_acknowledges_successful_step_events(tmp_path: Path) -> None:
    acknowledgement = tmp_path / "ack.json"
    executable = tmp_path / "fake-ecc"
    executable.write_text(
        f"""#!{sys.executable}
import json
from pathlib import Path
import sys

def read_frame():
    header = b''
    while not header.endswith(b'\\r\\n\\r\\n'):
        header += sys.stdin.buffer.read(1)
    length = int(header.split(b':', 1)[1].split(b'\\r\\n', 1)[0])
    return json.loads(sys.stdin.buffer.read(length))

def write_frame(payload):
    body = json.dumps(payload).encode()
    sys.stdout.buffer.write(b'Content-Length: %d\\r\\n\\r\\n' % len(body) + body)
    sys.stdout.buffer.flush()

request = read_frame()
write_frame({{"jsonrpc": "2.0", "method": "runtime.event", "params": {{
    "type": "step.completed", "eventId": "event-1", "operationId": "operation-1",
    "payload": {{"state": "Success", "stepCommitId": "operation-1:step:1", "workspaceRevision": 1}},
}}}})
write_frame({{"jsonrpc": "2.0", "id": request["id"], "result": {{"operationId": "operation-1", "state": "running"}}}})
ack_path = Path({str(acknowledgement)!r})
pending_path = ack_path.with_suffix(".tmp")
pending_path.write_text(json.dumps(read_frame()), encoding="utf-8")
pending_path.replace(ack_path)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)

    assert (
        client.call("operation.status", {"operationId": "operation-1"})["state"]
        == "running"
    )
    for _ in range(20):
        if acknowledgement.exists():
            break
        time.sleep(0.01)
    client.close()

    assert json.loads(acknowledgement.read_text(encoding="utf-8")) == {
        "jsonrpc": "2.0",
        "method": "operation.ack_step_rendered",
        "params": {
            "operationId": "operation-1",
            "eventId": "event-1",
            "stepCommitId": "operation-1:step:1",
            "workspaceRevision": 1,
        },
    }


def test_stdio_client_reports_safe_ecc_rejection_details(tmp_path: Path) -> None:
    executable = tmp_path / "fake-ecc"
    executable.write_text(
        f"""#!{sys.executable}
import json
import sys

header = b''
while not header.endswith(b'\\r\\n\\r\\n'):
    header += sys.stdin.buffer.read(1)
length = int(header.split(b':', 1)[1].split(b'\\r\\n', 1)[0])
request = json.loads(sys.stdin.buffer.read(length))
payload = json.dumps({{
    "jsonrpc": "2.0",
    "id": request["id"],
    "error": {{
        "code": -32602,
        "message": "invalid_request",
        "data": {{"message": "operation not found: operation-1"}},
    }},
}}).encode()
sys.stdout.buffer.write(b"Content-Length: %d\\r\\n\\r\\n" % len(payload) + payload)
sys.stdout.buffer.flush()
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)

    with pytest.raises(OptimizationEccAdapterError, match="operation not found"):
        client.call("operation.status", {"operationId": "operation-1"})

    client.close()
