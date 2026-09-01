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


def test_stdio_client_requires_an_absolute_executable_path(tmp_path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)

    with pytest.raises(OptimizationEccAdapterError, match="absolute"):
        EccContentLengthRpcClient(Path("ecc"))

    client = EccContentLengthRpcClient(executable)

    assert client.command == (str(executable), "rpc", "serve", "--stdio", "--agent")


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
Path({str(acknowledgement)!r}).write_text(json.dumps(read_frame()), encoding="utf-8")
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
