import io
import json
import os
import select
import subprocess
import sys
from pathlib import Path

from chipcompiler.data import create_workspace
from ecos_runtime_adapter.server import RuntimeServer
from ecos_runtime_adapter.stdio_server import run_stdio_server
from ecos_runtime_adapter.transport import ContentLengthDecoder, encode_content_length_frame


def _request(method: str, request_id, params: dict | None = None) -> bytes:
    payload = {"jsonrpc": "2.0", "method": method, "id": request_id}
    if params is not None:
        payload["params"] = params
    return encode_content_length_frame(json.dumps(payload, separators=(",", ":")))


def _notification(method: str, params: dict | None = None) -> bytes:
    payload = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        payload["params"] = params
    return encode_content_length_frame(json.dumps(payload, separators=(",", ":")))


def _decode_output(output: bytes) -> list[dict]:
    decoder = ContentLengthDecoder()
    return [json.loads(message) for message in decoder.feed(output)]


def _read_subprocess_response(process: subprocess.Popen) -> dict:
    assert process.stdout is not None
    assert select.select([process.stdout], [], [], 5)[0]
    length_line = process.stdout.readline()
    assert length_line.startswith(b"Content-Length: ")
    blank_line = process.stdout.readline()
    assert blank_line == b"\r\n"
    length = int(length_line.removeprefix(b"Content-Length: ").strip())
    payload = process.stdout.read(length)
    return json.loads(payload)


def _write_subprocess_request(process: subprocess.Popen, method: str, request_id, params=None):
    assert process.stdin is not None
    process.stdin.write(_request(method, request_id, params))
    process.stdin.flush()


def _stdio_command(*, persistent_db: bool = False) -> list[str]:
    enabled = "True" if persistent_db else "False"
    return [
        sys.executable,
        "-c",
        (
            "from ecos_runtime_adapter.stdio_server import main; "
            f"raise SystemExit(main(persistent_db_enabled={enabled}))"
        ),
    ]


def _create_real_workspace(tmp_path: Path, minimal_ics55_pdk_factory) -> Path:
    pdk_root = minimal_ics55_pdk_factory(tmp_path / "ics55")
    rtl_path = tmp_path / "gcd.v"
    rtl_path.write_text("module gcd(input clk, output y); assign y = clk; endmodule\n")
    workspace_dir = tmp_path / "workspace"
    create_workspace(
        directory=workspace_dir,
        origin_def="",
        origin_verilog=rtl_path,
        pdk="ics55",
        pdk_root=pdk_root,
        parameters={
            "PDK": "ics55",
            "Design": "gcd",
            "Top module": "gcd",
            "Clock": "clk",
            "Frequency max [MHz]": 100,
        },
    )
    return workspace_dir


def test_stdio_server_writes_only_content_length_framed_responses():
    stdin = io.BytesIO(
        _request("rpc.hello", 1, {"version": 1})
        + _request("rpc.ping", 2)
        + _request("rpc.shutdown", 3)
    )
    stdout = io.BytesIO()

    rc = run_stdio_server(stdin, stdout, server=RuntimeServer())

    raw = stdout.getvalue()
    assert rc == 0
    assert raw.startswith(b"Content-Length: ")
    assert raw.count(b"Content-Length: ") == 3
    responses = _decode_output(raw)
    assert [response["id"] for response in responses] == [1, 2, 3]
    assert responses[0]["result"]["version"] == 1
    assert responses[1]["result"] == {"ok": True}
    assert responses[2]["result"] == {"ok": True}


def test_stdio_server_does_not_write_response_for_notification():
    stdin = io.BytesIO(_notification("rpc.ping"))
    stdout = io.BytesIO()

    rc = run_stdio_server(stdin, stdout, server=RuntimeServer())

    assert rc == 0
    assert stdout.getvalue() == b""


def test_stdio_server_stops_after_shutdown_notification_in_buffer():
    stdin = io.BytesIO(_notification("rpc.shutdown") + _request("rpc.ping", 1))
    stdout = io.BytesIO()

    rc = run_stdio_server(stdin, stdout, server=RuntimeServer())

    assert rc == 0
    assert stdout.getvalue() == b""


def test_stdio_server_redirects_print_noise_away_from_protocol_stdout(capfd):
    server = RuntimeServer()
    server.dispatcher.add_method("test.noisyPrint", lambda: print("tool output") or {"ok": True})
    stdin = io.BytesIO(_request("test.noisyPrint", 1))
    stdout = io.BytesIO()

    rc = run_stdio_server(stdin, stdout, server=server)

    captured = capfd.readouterr()
    assert rc == 0
    assert captured.out == ""
    assert "tool output" in captured.err
    assert _decode_output(stdout.getvalue())[0]["result"] == {"ok": True}


def test_stdio_server_redirects_fd_stdout_noise_away_from_protocol_stdout(capfd):
    server = RuntimeServer()

    def noisy_fd():
        os.write(1, b"tool output\n")
        return {"ok": True}

    server.dispatcher.add_method("test.noisyFd", noisy_fd)
    stdin = io.BytesIO(_request("test.noisyFd", 1))
    stdout = io.BytesIO()

    rc = run_stdio_server(stdin, stdout, server=server)

    captured = capfd.readouterr()
    assert rc == 0
    assert captured.out == ""
    assert "tool output" in captured.err
    assert _decode_output(stdout.getvalue())[0]["result"] == {"ok": True}


def test_rpc_stdio_subprocess_smoke():
    stdin = (
        _request("rpc.hello", 1, {"version": 1})
        + _request("rpc.ping", 2)
        + _request(
            "rpc.shutdown",
            3,
        )
    )

    completed = subprocess.run(
        _stdio_command(),
        input=stdin,
        cwd=os.getcwd(),
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0
    responses = _decode_output(completed.stdout)
    assert [response["id"] for response in responses] == [1, 2, 3]
    assert responses[1]["result"] == {"ok": True}


def test_rpc_stdio_subprocess_persistent_db_smoke():
    stdin = _request("rpc.hello", 1, {"version": 1}) + _request("rpc.shutdown", 2)

    completed = subprocess.run(
        _stdio_command(persistent_db=True),
        input=stdin,
        cwd=os.getcwd(),
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0
    responses = _decode_output(completed.stdout)
    assert [response["id"] for response in responses] == [1, 2]
    assert "db.ensure" in responses[0]["result"]["capabilities"]
    assert "db.release" in responses[0]["result"]["capabilities"]


def test_rpc_stdio_subprocess_workspace_open_home_smoke(tmp_path, minimal_ics55_pdk_factory):
    ws = _create_real_workspace(tmp_path, minimal_ics55_pdk_factory)
    process = subprocess.Popen(
        _stdio_command(),
        cwd=os.getcwd(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        _write_subprocess_request(process, "workspace.open", 1, {"directory": str(ws)})
        open_response = _read_subprocess_response(process)
        workspace_id = open_response["result"]["workspaceId"]

        _write_subprocess_request(
            process,
            "workspace.home",
            2,
            {"workspaceId": workspace_id},
        )
        home_response = _read_subprocess_response(process)

        _write_subprocess_request(process, "rpc.shutdown", 3)
        shutdown_response = _read_subprocess_response(process)
        stderr = process.communicate(timeout=5)[1]
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()

    assert process.returncode == 0, stderr.decode("utf-8", errors="replace")
    assert open_response["result"] == {
        "workspaceId": workspace_id,
        "workspaceRevision": 1,
        "directory": str(ws.resolve()),
        "executionReadiness": {"ready": False, "code": "pdk_binding_missing"},
    }
    assert home_response == {
        "jsonrpc": "2.0",
        "result": {"path": str(ws.resolve() / "home" / "home.json")},
        "id": 2,
    }
    assert shutdown_response == {"jsonrpc": "2.0", "result": {"ok": True}, "id": 3}
