import json

from ecos_server.ecc.schemas import ECCResponse
from ecos_server import run_ecc_cli


class FakeService:
    def __init__(self):
        self.requests = []

    def dispatch(self, request):
        self.requests.append(request)
        if request.cmd == "load_workspace":
            return ECCResponse(
                cmd="load_workspace",
                response="success",
                data={
                    "directory": request.data["directory"],
                    "workspace_id": request.data["directory"],
                },
                message=["loaded"],
            )
        if request.cmd == "run_step":
            return ECCResponse(
                cmd="run_step",
                response="success",
                data={"step": request.data["step"], "state": "Success"},
                message=["ran"],
            )
        if request.cmd == "create_workspace":
            return ECCResponse(
                cmd="create_workspace",
                response="success",
                data={
                    "directory": request.data["directory"],
                    "workspace_id": request.data["directory"],
                },
                message=["created"],
            )
        raise AssertionError(f"unexpected command: {request.cmd}")


def read_jsonl(capsys):
    stdout = capsys.readouterr().out.strip()
    assert stdout
    return [json.loads(line) for line in stdout.splitlines()]


def test_workspace_run_step_loads_workspace_and_emits_json_result(capsys):
    service = FakeService()

    exit_code = run_ecc_cli.run(
        [
            "workspace",
            "run-step",
            "--directory",
            "/work/demo",
            "--step",
            "route",
            "--json",
            "--rerun",
        ],
        service_factory=lambda: service,
    )

    assert exit_code == 0
    assert [(request.cmd, request.data) for request in service.requests] == [
        ("load_workspace", {"directory": "/work/demo"}),
        ("run_step", {"step": "route", "rerun": True}),
    ]
    records = read_jsonl(capsys)
    assert records[-1] == {
        "type": "result",
        "cmd": "run_step",
        "response": "success",
        "data": {"step": "route", "state": "Success"},
        "message": ["ran"],
    }


def test_workspace_create_reads_input_json_and_emits_result(tmp_path, capsys):
    input_json = tmp_path / "workspace.json"
    input_json.write_text(
        json.dumps({"directory": "/work/new", "pdk": "ics55", "parameters": {"Design": "demo"}}),
        encoding="utf-8",
    )
    service = FakeService()

    exit_code = run_ecc_cli.run(
        ["workspace", "create", "--input-json", str(input_json), "--json"],
        service_factory=lambda: service,
    )

    assert exit_code == 0
    assert [(request.cmd, request.data) for request in service.requests] == [
        (
            "create_workspace",
            {"directory": "/work/new", "pdk": "ics55", "parameters": {"Design": "demo"}},
        ),
    ]
    assert read_jsonl(capsys)[-1]["cmd"] == "create_workspace"


def test_version_flag_prints_runtime_version(capsys):
    exit_code = run_ecc_cli.run(["--version"], version_provider=lambda: "0.1.0a2")

    assert exit_code == 0
    assert capsys.readouterr().out == "ecc 0.1.0a2\n"
