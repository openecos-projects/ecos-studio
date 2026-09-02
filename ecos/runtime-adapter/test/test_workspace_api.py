import json
import queue
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from chipcompiler.data import StateEnum
from ecos_runtime_adapter.requests import (
    DbEnsureRequest,
    DbReleaseRequest,
    FlowRunRequest,
    FlowRunStepRequest,
    OperationIdRequest,
    OperationStartFlowRequest,
    WorkspaceCreateRequest,
    WorkspaceIdRequest,
    WorkspaceInfoRequest,
    WorkspaceMutationRequest,
    WorkspaceOpenRequest,
    WorkspaceRecoverInterruptedRequest,
    WorkspaceSyncConfigRequest,
)
from ecos_runtime_adapter.sessions import WorkspaceSessionRegistry
from ecos_runtime_adapter.workspace_api import RuntimeApiError, WorkspaceRuntimeApi


class DummyEngineDB:
    def __init__(self, flow):
        self.flow = flow
        self.initialized = False
        self.close_calls = 0

    def has_init(self):
        return self.initialized

    def create_db_engine(self, step):
        self.flow.init_db_engine_calls += 1
        self.flow.init_db_engine_steps.append(None if step is None else step.name)
        self.flow.init_db_engine_inputs.append(
            (
                None if step is None else getattr(step, "input_def", ""),
                None if step is None else getattr(step, "input_verilog", ""),
            )
        )
        self.flow.call_order.append(("init_db_engine",))
        self.initialized = self.flow.next_init_success
        return self.initialized

    def close(self):
        if not self.initialized:
            return
        self.close_calls += 1
        self.initialized = False


class DummyFlow:
    instances = []
    next_run_states = []
    next_init_success = True
    successful_steps = set()
    workspace_step_specs = None

    def __init__(self, workspace):
        self.workspace = workspace
        self.added_steps = []
        self.created = False
        self.prepared_for_rerun = False
        self.run_steps_calls = []
        self.run_calls = []
        self.flow_init_db_engine_calls = 0
        self.init_db_engine_calls = 0
        self.init_db_engine_steps = []
        self.init_db_engine_inputs = []
        self.call_order = []
        specs = self.workspace_step_specs or (
            {"name": "Synthesis", "tool": "yosys"},
            {"name": "Floorplan", "tool": "ecc"},
        )
        self.workspace_steps = [SimpleNamespace(**spec) for spec in specs]
        self.completed_steps = set()
        self.engine_db = DummyEngineDB(self)
        DummyFlow.instances.append(self)

    def has_init(self):
        return False

    def add_step(self, step, tool, state):
        self.added_steps.append((step, tool, state))
        self.workspace.flow.data.setdefault("steps", []).append(
            {"name": step, "tool": tool, "state": state}
        )

    def create_step_workspaces(self):
        self.created = True

    def run_steps(self, *, rerun=False):
        self.run_steps_calls.append(rerun)
        success = True
        for workspace_step in self.workspace_steps:
            self.init_db_engine()
            state = self.run_step(workspace_step, rerun=rerun)
            if state != StateEnum.Success:
                success = False
                break
        return success

    def init_db_engine(self):
        self.flow_init_db_engine_calls += 1
        self.call_order.append(("flow_init_db_engine",))
        if self.engine_db is None:
            self.engine_db = DummyEngineDB(self)
        workspace_step = self.workspace_steps[0]
        for candidate in self.workspace_steps:
            if candidate.name not in self.completed_steps:
                workspace_step = candidate
                break
        return self.engine_db.create_db_engine(workspace_step)

    def run_step(self, workspace_step, *, rerun=False):
        name = workspace_step if isinstance(workspace_step, str) else workspace_step.name
        self.run_calls.append((name, rerun))
        self.call_order.append(("run_step", name, rerun))
        state = DummyFlow.next_run_states.pop(0) if DummyFlow.next_run_states else StateEnum.Success
        if state == StateEnum.Success:
            self.completed_steps.add(name)
            workspace_step_object = self.get_workspace_step(name)
            if getattr(workspace_step_object, "tool", "") == "sizer":
                if self.engine_db is not None:
                    self.engine_db.close()
                self.engine_db = None
        return state

    def get_workspace_step(self, name):
        for step in self.workspace_steps:
            if step.name == name:
                return step
        return None

    def get_step(self, name, tool):
        for step in self.workspace.flow.data.get("steps", []):
            if step.get("name") == name and step.get("tool") == tool:
                return step
        return None

    def save(self):
        return True

    def check_state(self, name, tool, state):
        return getattr(state, "value", state) == StateEnum.Success.value and name in (
            self.successful_steps
        )


def _workspace(directory: Path):
    design = SimpleNamespace(
        name="gcd",
        top_module="gcd",
        origin_def="",
        origin_verilog=directory / "origin" / "gcd.v",
        input_filelist="",
    )
    return SimpleNamespace(
        directory=directory.resolve(),
        design=design,
        flow=SimpleNamespace(path=directory / "home" / "flow.json", data={"steps": []}),
        home=SimpleNamespace(path=directory / "home" / "home.json"),
    )


def _install_runtime_mocks(monkeypatch, tmp_path, *, create_workspace_files=True):
    capture = {
        "create_kwargs": None,
        "input_filelist_lines": [],
        "loaded": [],
        "workspace_entries_when_create_called": [],
    }
    DummyFlow.instances = []
    DummyFlow.next_run_states = []
    DummyFlow.next_init_success = True
    DummyFlow.successful_steps = set()
    DummyFlow.workspace_step_specs = None

    def fake_create_workspace(**kwargs):
        capture["create_kwargs"] = kwargs
        input_filelist = kwargs.get("input_filelist")
        if input_filelist and Path(input_filelist).exists():
            capture["input_filelist_lines"] = (
                Path(input_filelist).read_text(encoding="utf-8").splitlines()
            )
        workspace_dir = Path(kwargs["directory"])
        if workspace_dir.is_dir():
            capture["workspace_entries_when_create_called"] = sorted(
                path.name for path in workspace_dir.iterdir()
            )
        return _workspace(Path(kwargs["directory"]))

    def fake_load_workspace(directory):
        capture["loaded"].append(directory)
        return _workspace(Path(directory))

    monkeypatch.setattr("chipcompiler.data.create_workspace", fake_create_workspace)
    monkeypatch.setattr("chipcompiler.data.load_workspace", fake_load_workspace)
    monkeypatch.setattr("chipcompiler.data.refresh_workspace_config", lambda workspace: None)
    monkeypatch.setattr(
        "chipcompiler.data.prepare_workspace_for_rerun", lambda ws, flow, **_kwargs: None
    )
    monkeypatch.setattr("chipcompiler.engine.EngineFlow", DummyFlow)
    monkeypatch.setattr(
        "chipcompiler.rtl2gds.build_rtl2gds_flow",
        lambda: [("Synthesis", "yosys", "Unstart")],
    )

    ws = tmp_path / "workspace"
    if create_workspace_files:
        (ws / "home").mkdir(parents=True)
        (ws / "home" / "parameters.json").write_text("{}")
        (ws / "home" / "flow.json").write_text(json.dumps({"steps": []}))
        (ws / "home" / "home.json").write_text("{}")
    return capture, ws


def _assert_call_waits_for_session_lock(api, workspace_id, call, entered):
    session = api.sessions.get_session(workspace_id)
    result_queue = queue.Queue()

    def run_call():
        try:
            result_queue.put(("result", call()))
        except BaseException as exc:  # pragma: no cover - re-raised in test thread
            result_queue.put(("error", exc))

    with session.mutation_lock:
        worker = threading.Thread(target=run_call)
        worker.start()
        assert not entered.wait(0.1)
        assert worker.is_alive()

    worker.join(timeout=2)
    assert not worker.is_alive()
    kind, payload = result_queue.get_nowait()
    if kind == "error":
        raise payload
    assert entered.is_set()
    return payload


def test_create_workspace_returns_plain_runtime_result_and_session(monkeypatch, tmp_path):
    capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()

    result = api.create_workspace(
        WorkspaceCreateRequest(
            directory=str(ws),
            pdk="ics55",
            pdk_root="/pdk",
            pdk_json={"name": "ics55"},
            parameters={"Design": "gcd"},
            rtl_list=["a.v"],
            sdc="/constraints/top.sdc",
        )
    )

    assert set(result) == {"workspaceId", "workspaceRevision", "directory"}
    assert result["directory"] == str(ws.resolve())
    assert result["workspaceId"].startswith("workspace-")
    assert result["workspaceRevision"] == 1
    assert isinstance(capture["create_kwargs"]["pdk_json"], str)
    assert capture["create_kwargs"]["sdc"] == "/constraints/top.sdc"
    assert DummyFlow.instances[0].created
    assert api.sessions.get_session(result["workspaceId"]).directory == ws.resolve()


def test_create_workspace_forwards_dynamic_flow_config(monkeypatch, tmp_path):
    capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    flow_config = {
        "start_step": "Synthesis",
        "end_step": "Harden",
        "steps": ["Synthesis", "RCX", "sta", "Harden"],
    }

    WorkspaceRuntimeApi().create_workspace(
        WorkspaceCreateRequest(directory=str(ws), flow_config=flow_config)
    )

    assert capture["create_kwargs"]["flow_config"] == flow_config


def test_create_workspace_writes_rtl_list_filelist_outside_workspace(
    monkeypatch,
    tmp_path,
):
    capture, ws = _install_runtime_mocks(
        monkeypatch,
        tmp_path,
        create_workspace_files=False,
    )
    project = tmp_path / "project"
    project.mkdir()
    rtl_paths = [str(project / "a.v"), str(project / "b.v")]
    api = WorkspaceRuntimeApi()

    api.create_workspace(
        WorkspaceCreateRequest(
            directory=str(ws),
            pdk="ics55",
            parameters={"Design": "gcd"},
            rtl_list=rtl_paths,
        )
    )

    input_filelist = Path(capture["create_kwargs"]["input_filelist"])
    assert input_filelist.name == "filelist"
    assert not input_filelist.is_relative_to(ws)
    assert capture["input_filelist_lines"] == rtl_paths
    assert capture["workspace_entries_when_create_called"] == []
    assert not (ws / "filelist").exists()


def test_create_workspace_materializes_inline_pdk_json_before_data_api(monkeypatch, tmp_path):
    pdk_json = {"name": "ics55", "lef": ["tech.lef"]}
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    seen = {}

    def create_workspace(**kwargs):
        pdk_json_path = Path(kwargs["pdk_json"])
        seen["pdk_json"] = json.loads(pdk_json_path.read_text(encoding="utf-8"))
        return _workspace(Path(kwargs["directory"]))

    monkeypatch.setattr("chipcompiler.data.create_workspace", create_workspace)
    api = WorkspaceRuntimeApi()

    api.create_workspace(
        WorkspaceCreateRequest(
            directory=str(ws),
            pdk="ics55",
            pdk_json=pdk_json,
        )
    )

    assert seen["pdk_json"] == pdk_json


def test_create_workspace_with_inline_pdk_json_uses_real_data_api(monkeypatch, tmp_path):
    pdk_root = tmp_path / "pdk"
    tech = pdk_root / "tech.lef"
    lef = pdk_root / "stdcell.lef"
    liberty = pdk_root / "stdcell.lib"
    for path in (tech, lef, liberty):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("VERSION 5.8 ;\n")

    workspace_dir = tmp_path / "workspace"
    monkeypatch.setattr(
        "chipcompiler.engine.workspace_flow.build_flow_for_workspace",
        lambda _workspace: SimpleNamespace(),
    )

    api = WorkspaceRuntimeApi()
    result = api.create_workspace(
        WorkspaceCreateRequest(
            directory=str(workspace_dir),
            pdk="ics55",
            pdk_json={
                "name": "ics55",
                "root": str(pdk_root),
                "tech": str(tech),
                "lefs": [str(lef)],
                "libs": [str(liberty)],
            },
            parameters={
                "Design": "gcd",
                "Top module": "gcd",
                "Clock": "clk",
            },
        )
    )

    assert result["directory"] == str(workspace_dir.resolve())
    pdk_config_path = workspace_dir / "home" / "pdk.json"
    assert pdk_config_path.is_file()
    parameters = json.loads((workspace_dir / "home" / "parameters.json").read_text())
    assert parameters["PDK Config"] == str(pdk_config_path.resolve())
    fixfanout = json.loads((workspace_dir / "config" / "fixfanout_ecc.json").read_text())
    session = api.sessions.get_session(result["workspaceId"])
    assert session.workspace.pdk.tech == tech
    assert session.workspace.pdk.lefs == [lef]
    assert session.workspace.pdk.libs == [liberty]
    assert session.workspace.pdk.buffers
    assert fixfanout["insert_buffer"] == session.workspace.pdk.buffers[0]
    assert session.directory == workspace_dir.resolve()


def test_open_workspace_loads_without_creating_step_workspaces(monkeypatch, tmp_path):
    capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()

    result = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))

    assert result == {
        "workspaceId": result["workspaceId"],
        "workspaceRevision": 1,
        "directory": str(ws.resolve()),
    }
    assert capture["loaded"] == [str(ws)]
    assert not DummyFlow.instances[0].created


def test_open_workspace_persists_identity_across_restart_and_directory_move(
    monkeypatch,
    tmp_path,
):
    _capture, workspace_dir = _install_runtime_mocks(monkeypatch, tmp_path)
    first = WorkspaceRuntimeApi().open_workspace(WorkspaceOpenRequest(directory=str(workspace_dir)))

    moved_dir = tmp_path / "moved-workspace"
    workspace_dir.rename(moved_dir)
    other_dir = tmp_path / "other-workspace"
    (other_dir / "home").mkdir(parents=True)
    for name, contents in {
        "parameters.json": "{}",
        "flow.json": '{"steps": []}',
        "home.json": "{}",
    }.items():
        (other_dir / "home" / name).write_text(contents, encoding="utf-8")

    restarted = WorkspaceRuntimeApi()
    restarted.open_workspace(WorkspaceOpenRequest(directory=str(other_dir)))
    reopened = restarted.open_workspace(WorkspaceOpenRequest(directory=str(moved_dir)))

    assert first["workspaceRevision"] == reopened["workspaceRevision"] == 1
    assert reopened["workspaceId"] == first["workspaceId"]
    persisted = json.loads(
        (moved_dir / "home" / "engineering-snapshot.json").read_text(encoding="utf-8")
    )
    assert persisted["workspaceId"] == first["workspaceId"]
    assert persisted["workspaceRevision"] == 1


def test_engineering_snapshot_recovers_committed_step_without_runtime_events(
    monkeypatch,
    tmp_path,
):
    _capture, workspace_dir = _install_runtime_mocks(monkeypatch, tmp_path)
    published_events = []
    api = WorkspaceRuntimeApi(event_publisher=published_events.append)
    opened = api.open_workspace(WorkspaceOpenRequest(directory=str(workspace_dir)))
    workspace_id = opened["workspaceId"]
    session = api.sessions.get_session(workspace_id)
    step = SimpleNamespace(name="Synthesis", tool="yosys", log=SimpleNamespace(file=""))

    def execute(_request, *, observer=None, preserve_user_inputs=False):
        assert preserve_user_inputs is False
        session.workspace.flow.data = {
            "steps": [{"name": "Synthesis", "tool": "yosys", "state": "Success"}],
        }
        observer.on_step_completed(step, StateEnum.Success)
        return {"rerun": False}

    monkeypatch.setattr(api, "_flow_run", execute)
    started = api.start_flow_operation(
        OperationStartFlowRequest(
            workspace_id=workspace_id,
            idempotency_key="run-1",
        )
    )
    for _ in range(100):
        status = api.operation_status(OperationIdRequest(operation_id=started["operationId"]))
        if status["state"] == "succeeded":
            break
        threading.Event().wait(0.01)

    published_events.clear()
    snapshot = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))
    assert snapshot["workspaceRevision"] == 2
    assert snapshot["flow"]["steps"] == [{"name": "Synthesis", "tool": "yosys", "state": "Success"}]
    assert status["workspaceRevision"] == 2

    duplicate = api.start_flow_operation(
        OperationStartFlowRequest(
            workspace_id=workspace_id,
            expected_workspace_revision=1,
            idempotency_key="run-1",
        )
    )
    assert duplicate["operationId"] == started["operationId"]
    assert duplicate["deduplicated"] is True

    reopened_api = WorkspaceRuntimeApi()
    reopened = reopened_api.open_workspace(WorkspaceOpenRequest(directory=str(workspace_dir)))
    assert reopened["workspaceRevision"] == 2
    assert (
        reopened_api.engineering_snapshot(WorkspaceIdRequest(workspace_id=reopened["workspaceId"]))
        == snapshot
    )


def test_stale_revision_rejects_run_before_creating_operation(monkeypatch, tmp_path):
    _capture, workspace_dir = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    opened = api.open_workspace(WorkspaceOpenRequest(directory=str(workspace_dir)))

    with pytest.raises(RuntimeApiError) as exc_info:
        api.start_flow_operation(
            OperationStartFlowRequest(
                workspace_id=opened["workspaceId"],
                expected_workspace_revision=0,
                idempotency_key="stale-run",
            )
        )

    assert exc_info.value.code == "revision_conflict"
    assert exc_info.value.data == {"expectedRevision": 0, "actualRevision": 1}
    assert api.operations.workspace_snapshot(opened["workspaceId"])["operations"] == []


def test_recover_interrupted_is_marker_scoped_and_idempotent(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    session = api.sessions.get_session(workspace_id)
    session.workspace.flow.data = {
        "steps": [
            {
                "name": "place",
                "tool": "dreamplace",
                "state": "Ongoing",
                "info": {
                    "runtime_operation": {
                        "schema": 1,
                        "operation_id": "operation-1",
                        "runtime_instance_id": "runtime-old",
                        "started_at": 1.0,
                    }
                },
            },
            {"name": "route", "tool": "ecc", "state": "Ongoing", "info": {}},
            {
                "name": "Floorplan",
                "tool": "ecc",
                "state": "Success",
                "info": {
                    "runtime_operation": {
                        "schema": 1,
                        "operation_id": "operation-2",
                    }
                },
            },
            {
                "name": "CTS",
                "tool": "ecc",
                "state": "Ongoing",
                "info": {
                    "runtime_operation": {
                        "schema": 1,
                        "operation_id": "operation-partial",
                    }
                },
            },
            {
                "name": "STA",
                "tool": "ecc",
                "state": "Ongoing",
                "info": {
                    "runtime_operation": {
                        "schema": 1,
                        "operation_id": "operation-active",
                        "runtime_instance_id": "runtime-current",
                        "started_at": 2.0,
                    }
                },
            },
            {
                "name": "DRC",
                "tool": "ecc",
                "state": "Ongoing",
                "info": {
                    "runtime_operation": {
                        "schema": 1,
                        "operation_id": "operation-previous",
                        "runtime_instance_id": "runtime-old",
                        "started_at": 3.0,
                    }
                },
            },
        ]
    }
    mismatch = api.recover_interrupted(
        WorkspaceRecoverInterruptedRequest(workspace_id, "operation-other")
    )
    assert mismatch == {"recovered": []}

    result = api.recover_interrupted(
        WorkspaceRecoverInterruptedRequest(workspace_id, "operation-1")
    )
    assert result == {
        "recovered": [
            {
                "step": "place",
                "tool": "dreamplace",
                "operationId": "operation-1",
                "logFile": str(ws / "place_dreamplace" / "log" / "place.log"),
            }
        ]
    }
    assert session.workspace.flow.data["steps"][0]["state"] == StateEnum.Imcomplete.value
    assert session.workspace.flow.data["steps"][0]["info"] == {}
    assert session.workspace.flow.data["steps"][1]["state"] == "Ongoing"
    assert session.workspace.flow.data["steps"][2]["state"] == "Success"
    monkeypatch.setattr(
        api.operations,
        "is_active",
        lambda operation_id: operation_id == "operation-active",
    )
    previous = api.recover_interrupted(WorkspaceRecoverInterruptedRequest(workspace_id))
    assert previous == {
        "recovered": [
            {
                "step": "DRC",
                "tool": "ecc",
                "operationId": "operation-previous",
                "logFile": str(ws / "DRC_ecc" / "log" / "DRC.log"),
            }
        ]
    }
    assert session.workspace.flow.data["steps"][3]["state"] == "Ongoing"
    assert session.workspace.flow.data["steps"][4]["state"] == "Ongoing"
    assert session.workspace.flow.data["steps"][5]["state"] == StateEnum.Imcomplete.value
    assert api.recover_interrupted(
        WorkspaceRecoverInterruptedRequest(workspace_id, "operation-1")
    ) == {"recovered": []}


def test_create_workspace_replaces_existing_same_directory_session(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()

    opened = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))
    opened_session = api.sessions.get_session(opened["workspaceId"])
    opened_session.db_handle = object()
    created = api.create_workspace(WorkspaceCreateRequest(directory=str(ws)))

    assert created["workspaceId"] != opened["workspaceId"]
    assert opened_session.db_handle is None
    with pytest.raises(RuntimeApiError, match="workspace session not found"):
        api.workspace_home(WorkspaceIdRequest(workspace_id=opened["workspaceId"]))
    created_session = api.sessions.get_session(created["workspaceId"])
    assert created_session.workspace is not opened_session.workspace


def test_open_workspace_reuses_existing_same_directory_session(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()

    first = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))
    first_session = api.sessions.get_session(first["workspaceId"])
    second = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))

    assert second["workspaceId"] == first["workspaceId"]
    assert api.sessions.get_session(second["workspaceId"]).workspace is first_session.workspace


def test_workspace_home_and_info_use_session_id(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "chipcompiler.tools.get_step_info",
        lambda workspace, step, id: {"path": Path(workspace.directory) / "layout.png"},
    )
    api = WorkspaceRuntimeApi()
    opened = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))
    workspace_id = opened["workspaceId"]

    home = api.workspace_home(WorkspaceIdRequest(workspace_id=workspace_id))
    info = api.workspace_info(
        WorkspaceInfoRequest(workspace_id=workspace_id, step="Synthesis", info_id="layout")
    )

    assert home == {"path": str(ws.resolve() / "home" / "home.json")}
    assert info == {
        "step": "Synthesis",
        "id": "layout",
        "info": {"path": str(ws.resolve() / "layout.png")},
    }


def test_refresh_sync_and_reset_flow_use_session(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    refreshed = []
    synced = []
    prepared = []

    monkeypatch.setattr(
        "chipcompiler.data.refresh_workspace_config",
        lambda workspace: refreshed.append(workspace.directory),
    )
    monkeypatch.setattr(
        "chipcompiler.data.sync_workspace_config_to_parameters",
        lambda workspace, path: synced.append((workspace.directory, path)) or True,
    )
    monkeypatch.setattr(
        "chipcompiler.data.prepare_workspace_for_rerun",
        lambda workspace, flow, **_kwargs: prepared.append((workspace.directory, flow)),
    )
    config_dir = ws / "config"
    config_dir.mkdir()
    config_path = config_dir / "route.json"
    config_path.write_text("{}")
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    refresh = api.refresh_config(WorkspaceIdRequest(workspace_id=workspace_id))
    sync = api.sync_config(
        WorkspaceSyncConfigRequest(
            workspace_id=workspace_id,
            config_path=str(config_path),
            expected_workspace_revision=1,
        )
    )
    reset = api.reset_flow(
        WorkspaceMutationRequest(
            workspace_id=workspace_id,
            expected_workspace_revision=2,
        )
    )

    assert refresh == {"directory": str(ws.resolve()), "refreshed": True}
    assert sync == {
        "directory": str(ws.resolve()),
        "configPath": str(config_path.resolve()),
        "parametersChanged": True,
        "refreshed": True,
        "workspaceRevision": 2,
    }
    assert reset == {"directory": str(ws.resolve()), "workspaceRevision": 3}
    assert refreshed == [ws.resolve(), ws.resolve()]
    assert synced == [(ws.resolve(), config_path.resolve())]
    assert prepared == [(ws.resolve(), DummyFlow.instances[-1])]


def test_refresh_config_releases_active_session_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    result = api.refresh_config(WorkspaceIdRequest(workspace_id=workspace_id))

    assert result == {"directory": str(ws.resolve()), "refreshed": True}
    assert db_handle.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_sync_config_releases_active_session_db_only_when_parameters_change(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    config_dir = ws / "config"
    config_dir.mkdir()
    config_path = config_dir / "route.json"
    config_path.write_text("{}")
    changed = [False, True]

    monkeypatch.setattr(
        "chipcompiler.data.sync_workspace_config_to_parameters",
        lambda _workspace, _path: changed.pop(0),
    )
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    unchanged = api.sync_config(
        WorkspaceSyncConfigRequest(
            workspace_id=workspace_id,
            config_path=str(config_path),
            expected_workspace_revision=1,
        )
    )
    assert unchanged["parametersChanged"] is False
    assert unchanged["refreshed"] is False
    assert db_handle.close_calls == 0

    changed_result = api.sync_config(
        WorkspaceSyncConfigRequest(
            workspace_id=workspace_id,
            config_path=str(config_path),
            expected_workspace_revision=1,
        )
    )

    assert changed_result["parametersChanged"] is True
    assert changed_result["refreshed"] is True
    assert changed_result["workspaceRevision"] == 2
    assert db_handle.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None

    with pytest.raises(RuntimeApiError, match="Workspace Revision does not match"):
        api.sync_config(
            WorkspaceSyncConfigRequest(
                workspace_id=workspace_id,
                config_path=str(config_path),
                expected_workspace_revision=1,
            )
        )


def test_reset_flow_releases_active_session_db_before_prepare(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    prepared = []

    def prepare(workspace, flow, **_kwargs):
        prepared.append((workspace.directory, flow))
        assert api.sessions.get_session(workspace_id).db_handle is None

    monkeypatch.setattr("chipcompiler.data.prepare_workspace_for_rerun", prepare)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    result = api.reset_flow(
        WorkspaceMutationRequest(
            workspace_id=workspace_id,
            expected_workspace_revision=1,
        )
    )

    assert result == {"directory": str(ws.resolve()), "workspaceRevision": 2}
    assert db_handle.close_calls == 1
    assert prepared == [(ws.resolve(), DummyFlow.instances[-1])]


def test_refresh_config_waits_for_session_mutation_lock(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    entered = threading.Event()

    def refresh_config(_workspace):
        entered.set()

    monkeypatch.setattr("chipcompiler.data.refresh_workspace_config", refresh_config)

    _assert_call_waits_for_session_lock(
        api=api,
        workspace_id=workspace_id,
        call=lambda: api.refresh_config(WorkspaceIdRequest(workspace_id=workspace_id)),
        entered=entered,
    )


def test_sync_config_waits_for_session_mutation_lock(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    config_dir = ws / "config"
    config_dir.mkdir()
    config_path = config_dir / "route.json"
    config_path.write_text("{}")
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    entered = threading.Event()

    def sync_config(_workspace, _path):
        entered.set()
        return False

    monkeypatch.setattr("chipcompiler.data.sync_workspace_config_to_parameters", sync_config)

    _assert_call_waits_for_session_lock(
        api=api,
        workspace_id=workspace_id,
        call=lambda: api.sync_config(
            WorkspaceSyncConfigRequest(
                workspace_id=workspace_id,
                config_path=str(config_path),
                expected_workspace_revision=1,
            )
        ),
        entered=entered,
    )


def test_reset_flow_waits_for_session_mutation_lock(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    entered = threading.Event()

    def build_flow(_workspace):
        entered.set()
        return SimpleNamespace()

    monkeypatch.setattr("ecos_runtime_adapter.workspace_api.build_flow_for_workspace", build_flow)
    monkeypatch.setattr(
        "chipcompiler.data.prepare_workspace_for_rerun", lambda _ws, _flow, **_kwargs: None
    )

    _assert_call_waits_for_session_lock(
        api=api,
        workspace_id=workspace_id,
        call=lambda: api.reset_flow(
            WorkspaceMutationRequest(
                workspace_id=workspace_id,
                expected_workspace_revision=1,
            )
        ),
        entered=entered,
    )


def test_unknown_session_returns_structured_runtime_error():
    api = WorkspaceRuntimeApi()

    with pytest.raises(RuntimeApiError) as exc_info:
        api.workspace_home(WorkspaceIdRequest(workspace_id="missing"))

    assert exc_info.value.code == "workspace_session_not_found"


def test_db_ensure_rejects_disabled_runtime_api(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    with pytest.raises(RuntimeApiError) as exc_info:
        api.db_ensure(DbEnsureRequest(workspace_id=workspace_id))

    assert exc_info.value.code == "command_failed"
    assert exc_info.value.message == "persistent_db_disabled"


def test_db_ensure_initializes_requested_step_and_stores_session_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))

    flow = DummyFlow.instances[-1]
    session = api.sessions.get_session(workspace_id)
    assert result == {
        "workspaceId": workspace_id,
        "enabled": True,
        "active": True,
        "reused": False,
        "step": "Floorplan",
    }
    assert flow.init_db_engine_steps == ["Floorplan"]
    assert session.db_handle is flow.engine_db
    assert session.db_handle.has_init()


def test_db_ensure_without_step_uses_flow_selection_rule(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.db_ensure(DbEnsureRequest(workspace_id=workspace_id))

    flow = DummyFlow.instances[-1]
    assert result == {
        "workspaceId": workspace_id,
        "enabled": True,
        "active": True,
        "reused": False,
        "step": "",
    }
    assert flow.flow_init_db_engine_calls == 1
    assert flow.init_db_engine_steps == ["Synthesis"]
    assert api.sessions.get_session(workspace_id).db_handle is flow.engine_db


def test_db_ensure_reuses_initialized_session_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    first = api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    second = api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))

    assert first["reused"] is False
    assert second == {
        "workspaceId": workspace_id,
        "enabled": True,
        "active": True,
        "reused": True,
        "step": "Floorplan",
    }
    assert api.sessions.get_session(workspace_id).db_handle is db_handle


def test_db_ensure_unknown_step_returns_runtime_error(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    with pytest.raises(RuntimeApiError) as exc_info:
        api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Missing"))

    assert exc_info.value.code == "command_failed"
    assert exc_info.value.message == "step not found: Missing"
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_db_ensure_does_not_store_uninitialized_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    DummyFlow.next_init_success = False
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))

    assert result == {
        "workspaceId": workspace_id,
        "enabled": True,
        "active": False,
        "reused": False,
        "step": "Floorplan",
    }
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_db_release_closes_and_clears_active_session_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    result = api.db_release(DbReleaseRequest(workspace_id=workspace_id))

    assert result == {"workspaceId": workspace_id, "released": True}
    assert db_handle.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_db_release_is_idempotent_when_no_db_is_active(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.db_release(DbReleaseRequest(workspace_id=workspace_id))

    assert result == {"workspaceId": workspace_id, "released": False}


def test_db_release_closes_db_with_injected_session_registry(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(
        sessions=WorkspaceSessionRegistry(),
        persistent_db_enabled=True,
    )
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    result = api.db_release(DbReleaseRequest(workspace_id=workspace_id))

    assert result == {"workspaceId": workspace_id, "released": True}
    assert db_handle.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_runtime_modules_do_not_import_typer_or_click():
    for path in Path("chipcompiler/runtime").glob("*.py"):
        source = path.read_text()
        assert "import typer" not in source
        assert "import click" not in source


def test_flow_run_uses_run_steps_and_prepare_on_rerun(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    prepared = []
    monkeypatch.setattr(
        "chipcompiler.data.prepare_workspace_for_rerun",
        lambda workspace, flow, **kwargs: prepared.append((workspace.directory, flow, kwargs)),
    )
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=True))

    flow = DummyFlow.instances[-1]
    assert result == {"rerun": True}
    assert prepared == [(ws.resolve(), flow, {"preserve_user_inputs": False})]
    assert flow.run_steps_calls == [True]
    snapshot = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))
    assert snapshot["workspaceRevision"] == 2
    assert snapshot["cause"] == "flow.rerun_prepared"


def test_failed_rerun_keeps_the_reset_revision_as_committed_truth(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)

    def prepare(workspace, _flow, **_kwargs):
        workspace.flow.data = {
            "steps": [{"name": "Synthesis", "tool": "yosys", "state": "Unstart"}]
        }

    monkeypatch.setattr("chipcompiler.data.prepare_workspace_for_rerun", prepare)
    DummyFlow.next_run_states = [StateEnum.Imcomplete]
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    with pytest.raises(RuntimeApiError):
        api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=True))

    snapshot = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))
    assert snapshot["workspaceRevision"] == 2
    assert snapshot["cause"] == "flow.rerun_prepared"
    assert snapshot["flow"]["steps"][0]["state"] == "Unstart"


def test_cancelled_rerun_keeps_the_reset_revision_before_the_first_step(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    entered_execution = threading.Event()
    continue_execution = threading.Event()
    events = []

    def execute(_flow, _plan, *, event_sink):
        entered_execution.set()
        assert continue_execution.wait(timeout=2)
        event_sink.raise_if_cancelled()
        raise AssertionError("cancelled execution continued")

    monkeypatch.setattr("chipcompiler.engine.execute", execute)
    api = WorkspaceRuntimeApi(event_publisher=events.append)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    started = api.start_flow_operation(
        OperationStartFlowRequest(
            workspace_id=workspace_id,
            rerun=True,
            idempotency_key="cancelled-rerun",
        )
    )
    assert entered_execution.wait(timeout=1)

    api.cancel_operation(OperationIdRequest(operation_id=started["operationId"]))
    continue_execution.set()
    for _ in range(100):
        status = api.operation_status(OperationIdRequest(operation_id=started["operationId"]))
        if status["state"] == "cancelled":
            break
        threading.Event().wait(0.01)

    snapshot = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))
    assert status["state"] == "cancelled"
    assert snapshot["workspaceRevision"] == 2
    assert snapshot["cause"] == "flow.rerun_prepared"
    assert next(event for event in events if event["type"] == "operation.rerun_prepared")[
        "payload"
    ]["workspaceRevision"] == 2


def test_rerun_snapshot_commit_failure_fails_the_operation(monkeypatch, tmp_path):
    from chipcompiler.engine.snapshot import EngineeringSnapshotError

    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    events = []
    api = WorkspaceRuntimeApi(event_publisher=events.append)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    def fail_commit(*_args, **_kwargs):
        raise EngineeringSnapshotError("snapshot disk full")

    monkeypatch.setattr(
        "chipcompiler.engine.snapshot.commit_engineering_snapshot",
        fail_commit,
    )
    started = api.start_flow_operation(
        OperationStartFlowRequest(
            workspace_id=workspace_id,
            rerun=True,
            idempotency_key="failed-rerun-commit",
        )
    )

    for _ in range(100):
        status = api.operation_status(OperationIdRequest(operation_id=started["operationId"]))
        if status["state"] == "failed":
            break
        threading.Event().wait(0.01)

    assert status["state"] == "failed"
    assert status["error"]["code"] == "engineering_snapshot_commit_failed"
    assert "snapshot disk full" in status["error"]["message"]
    assert not any(event["type"] == "operation.rerun_prepared" for event in events)


def test_non_rerun_failure_preserves_the_previous_snapshot(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    DummyFlow.next_run_states = [StateEnum.Imcomplete]
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    before = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))

    with pytest.raises(RuntimeApiError):
        api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=False))

    snapshot = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))
    assert snapshot == before


def test_gui_flow_operation_rerun_preserves_current_user_inputs(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    captured = {}

    def fake_flow_run(request, *, observer=None, preserve_user_inputs=False):
        captured.update(
            request=request,
            observer=observer,
            preserve_user_inputs=preserve_user_inputs,
        )
        return {"rerun": request.rerun}

    def fake_start(**kwargs):
        return kwargs["runner"](None)

    monkeypatch.setattr(api, "_flow_run", fake_flow_run)
    monkeypatch.setattr(api.operations, "start", fake_start)

    result = api.start_flow_operation(
        OperationStartFlowRequest(
            workspace_id=workspace_id,
            origin="gui",
            rerun=True,
            idempotency_key="gui-rerun",
        )
    )

    assert result == {"rerun": True}
    assert captured["request"].workspace_id == workspace_id
    assert captured["request"].rerun is True
    assert captured["observer"] is None
    assert captured["preserve_user_inputs"] is True


def test_flow_run_without_active_session_db_closes_transient_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=False))

    flow = DummyFlow.instances[-1]
    assert result == {"rerun": False}
    assert not flow.engine_db.has_init()
    assert flow.engine_db.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_flow_run_with_active_session_db_injects_and_captures_final_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    result = api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=False))

    flow = DummyFlow.instances[-1]
    assert result == {"rerun": False}
    assert flow.engine_db is db_handle
    assert api.sessions.get_session(workspace_id).db_handle is db_handle
    assert db_handle.close_calls == 0


def test_flow_run_rerun_releases_stale_db_and_captures_new_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    prepared = []

    def prepare(workspace, flow, **_kwargs):
        prepared.append((workspace.directory, flow))
        assert api.sessions.get_session(workspace_id).db_handle is None

    monkeypatch.setattr("chipcompiler.data.prepare_workspace_for_rerun", prepare)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    stale_db = api.sessions.get_session(workspace_id).db_handle

    result = api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=True))

    flow = DummyFlow.instances[-1]
    assert result == {"rerun": True}
    assert stale_db.close_calls == 1
    assert prepared == [(ws.resolve(), flow)]
    assert api.sessions.get_session(workspace_id).db_handle is flow.engine_db
    assert flow.engine_db is not stale_db
    assert flow.engine_db.has_init()


def test_flow_run_sizer_boundary_captures_post_sizer_db(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    sizer_def = str(ws / "Timing optimization_sizer" / "output" / "sizer.def")
    sizer_verilog = str(ws / "Timing optimization_sizer" / "output" / "sizer.v")
    DummyFlow.workspace_step_specs = (
        {"name": "Floorplan", "tool": "ecc", "input_def": "origin.def"},
        {
            "name": "Timing optimization",
            "tool": "sizer",
            "input_def": "floorplan.def",
            "input_verilog": "floorplan.v",
            "output": {"def": sizer_def, "verilog": sizer_verilog},
        },
        {
            "name": "Legalization",
            "tool": "ecc",
            "input_def": sizer_def,
            "input_verilog": sizer_verilog,
        },
    )
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    pre_sizer_db = api.sessions.get_session(workspace_id).db_handle

    result = api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=False))

    flow = DummyFlow.instances[-1]
    post_sizer_db = api.sessions.get_session(workspace_id).db_handle
    assert result == {"rerun": False}
    assert pre_sizer_db.close_calls == 1
    assert post_sizer_db is flow.engine_db
    assert post_sizer_db is not pre_sizer_db
    assert post_sizer_db.has_init()
    assert flow.init_db_engine_steps[-1] == "Legalization"
    assert flow.init_db_engine_inputs[-1] == (sizer_def, sizer_verilog)


def test_flow_run_sizer_boundary_failure_captures_post_sizer_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    sizer_def = str(ws / "Timing optimization_sizer" / "output" / "sizer.def")
    sizer_verilog = str(ws / "Timing optimization_sizer" / "output" / "sizer.v")
    DummyFlow.workspace_step_specs = (
        {"name": "Floorplan", "tool": "ecc", "input_def": "origin.def"},
        {
            "name": "Timing optimization",
            "tool": "sizer",
            "input_def": "floorplan.def",
            "input_verilog": "floorplan.v",
            "output": {"def": sizer_def, "verilog": sizer_verilog},
        },
        {
            "name": "Legalization",
            "tool": "ecc",
            "input_def": sizer_def,
            "input_verilog": sizer_verilog,
        },
    )
    DummyFlow.next_run_states = [
        StateEnum.Success,
        StateEnum.Success,
        StateEnum.Imcomplete,
    ]
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    pre_sizer_db = api.sessions.get_session(workspace_id).db_handle

    with pytest.raises(RuntimeApiError) as exc_info:
        api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=False))

    flow = DummyFlow.instances[-1]
    post_sizer_db = api.sessions.get_session(workspace_id).db_handle
    assert exc_info.value.code == "command_failed"
    assert pre_sizer_db.close_calls == 1
    assert post_sizer_db is flow.engine_db
    assert post_sizer_db is not pre_sizer_db
    assert post_sizer_db.has_init()
    assert flow.init_db_engine_steps[-1] == "Legalization"


def test_flow_run_sizer_boundary_exception_captures_post_sizer_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    DummyFlow.workspace_step_specs = (
        {"name": "Floorplan", "tool": "ecc"},
        {"name": "Timing optimization", "tool": "sizer"},
        {"name": "Legalization", "tool": "ecc"},
    )

    def run_steps_raises_after_post_sizer_db(self, *, rerun=False):
        del rerun
        self.engine_db.close()
        self.engine_db = DummyEngineDB(self)
        self.engine_db.create_db_engine(self.workspace_steps[-1])
        raise ValueError("post-sizer failure")

    monkeypatch.setattr(DummyFlow, "run_steps", run_steps_raises_after_post_sizer_db)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    pre_sizer_db = api.sessions.get_session(workspace_id).db_handle

    with pytest.raises(ValueError, match="post-sizer failure"):
        api.flow_run(FlowRunRequest(workspace_id=workspace_id, rerun=False))

    flow = DummyFlow.instances[-1]
    post_sizer_db = api.sessions.get_session(workspace_id).db_handle
    assert pre_sizer_db.close_calls == 1
    assert post_sizer_db is flow.engine_db
    assert post_sizer_db is not pre_sizer_db
    assert post_sizer_db.has_init()


def test_flow_run_step_initializes_db_before_direct_step(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.flow_run_step(
        FlowRunStepRequest(workspace_id=workspace_id, step="Synthesis", rerun=False)
    )

    flow = DummyFlow.instances[-1]
    assert result == {"step": "Synthesis", "state": "Success"}
    assert flow.init_db_engine_steps == ["Synthesis"]
    assert flow.call_order == [
        ("init_db_engine",),
        ("run_step", "Synthesis", False),
    ]
    assert flow.run_steps_calls == []
    assert not flow.engine_db.has_init()
    assert flow.engine_db.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_flow_run_step_with_active_session_db_injects_and_captures_final_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    db_handle = api.sessions.get_session(workspace_id).db_handle

    result = api.flow_run_step(
        FlowRunStepRequest(workspace_id=workspace_id, step="Floorplan", rerun=False)
    )

    flow = DummyFlow.instances[-1]
    assert result == {"step": "Floorplan", "state": "Success"}
    assert flow.engine_db is db_handle
    assert api.sessions.get_session(workspace_id).db_handle is db_handle
    assert db_handle.close_calls == 0


def test_flow_run_step_successful_sizer_releases_active_session_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    DummyFlow.workspace_step_specs = (
        {"name": "Floorplan", "tool": "ecc"},
        {"name": "Timing optimization", "tool": "sizer"},
    )
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    pre_sizer_db = api.sessions.get_session(workspace_id).db_handle

    result = api.flow_run_step(
        FlowRunStepRequest(
            workspace_id=workspace_id,
            step="Timing optimization",
            rerun=False,
        )
    )

    flow = DummyFlow.instances[-1]
    assert result == {"step": "Timing optimization", "state": "Success"}
    assert flow.engine_db is None
    assert pre_sizer_db.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_flow_run_step_sizer_exception_clears_closed_session_db(
    monkeypatch,
    tmp_path,
):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    DummyFlow.workspace_step_specs = (
        {"name": "Floorplan", "tool": "ecc"},
        {"name": "Timing optimization", "tool": "sizer"},
    )

    def run_step_raises_after_sizer_boundary(self, workspace_step, *, rerun=False):
        del workspace_step, rerun
        self.engine_db.close()
        self.engine_db = None
        raise ValueError("sizer failure")

    monkeypatch.setattr(DummyFlow, "run_step", run_step_raises_after_sizer_boundary)
    api = WorkspaceRuntimeApi(persistent_db_enabled=True)
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.db_ensure(DbEnsureRequest(workspace_id=workspace_id, step="Floorplan"))
    pre_sizer_db = api.sessions.get_session(workspace_id).db_handle

    with pytest.raises(ValueError, match="sizer failure"):
        api.flow_run_step(
            FlowRunStepRequest(
                workspace_id=workspace_id,
                step="Timing optimization",
                rerun=False,
            )
        )

    assert pre_sizer_db.close_calls == 1
    assert api.sessions.get_session(workspace_id).db_handle is None


def test_flow_run_step_rerun_refreshes_before_db_init(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    refreshed = []

    def refresh_config(workspace):
        refreshed.append(workspace.directory)
        DummyFlow.instances[-1].call_order.append(("refresh_config", workspace.directory))

    monkeypatch.setattr("chipcompiler.data.refresh_workspace_config", refresh_config)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.flow_run_step(
        FlowRunStepRequest(workspace_id=workspace_id, step="Floorplan", rerun=True)
    )

    flow = DummyFlow.instances[-1]
    assert result == {"step": "Floorplan", "state": "Success"}
    assert refreshed == [ws.resolve()]
    assert flow.call_order == [
        ("refresh_config", ws.resolve()),
        ("init_db_engine",),
        ("run_step", "Floorplan", True),
    ]


def test_flow_run_step_rerun_clears_step_artifacts_and_resets_step_state(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    step_dir = ws / "Floorplan_ecc"
    artifact_dirs = [
        step_dir / "output",
        step_dir / "data",
        step_dir / "feature",
        step_dir / "analysis",
        step_dir / "report",
        step_dir / "log",
    ]
    for directory in artifact_dirs:
        (directory / "nested").mkdir(parents=True)
        (directory / "nested" / "stale").write_text("stale")
    script_dir = step_dir / "script"
    script_dir.mkdir()
    (script_dir / "keep.tcl").write_text("keep")

    subflow_path = step_dir / "subflow.json"
    subflow_path.write_text(
        json.dumps(
            {
                "path": str(subflow_path),
                "steps": [
                    {
                        "name": "load data",
                        "state": "Success",
                        "runtime": "0:00:03",
                        "peak memory (mb)": 24,
                        "info": {"instances": 12},
                    }
                ],
            }
        )
    )
    checklist_path = step_dir / "checklist.json"
    checklist_path.write_text(
        json.dumps(
            {
                "path": str(checklist_path),
                "checklist": [{"item": "stale", "state": "Success"}],
            }
        )
    )
    DummyFlow.workspace_step_specs = (
        {
            "name": "Floorplan",
            "tool": "ecc",
            "output": {"dir": step_dir / "output"},
            "data": {"dir": step_dir / "data"},
            "feature": {"dir": step_dir / "feature"},
            "analysis": {"dir": step_dir / "analysis"},
            "report": {"dir": step_dir / "report"},
            "log": {"dir": step_dir / "log"},
            "subflow": SimpleNamespace(path=subflow_path, steps=[]),
            "checklist": SimpleNamespace(path=checklist_path, checklist=[]),
        },
    )
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    session = api.sessions.get_session(workspace_id)
    session.workspace.flow.data = {
        "steps": [
            {
                "name": "Floorplan",
                "tool": "ecc",
                "state": "Success",
                "runtime": "0:00:04",
                "peak memory (mb)": 30,
            }
        ]
    }

    result = api.flow_run_step(
        FlowRunStepRequest(workspace_id=workspace_id, step="Floorplan", rerun=True)
    )

    assert result == {"step": "Floorplan", "state": "Success"}
    assert all(list(directory.iterdir()) == [] for directory in artifact_dirs)
    assert (script_dir / "keep.tcl").read_text() == "keep"
    flow_record = next(
        record
        for record in session.workspace.flow.data["steps"]
        if record["name"] == "Floorplan" and record["tool"] == "ecc"
    )
    assert flow_record == {
        "name": "Floorplan",
        "tool": "ecc",
        "state": "Unstart",
        "runtime": "",
        "peak memory (mb)": 0,
        "info": {},
    }
    assert json.loads(subflow_path.read_text()) == {
        "path": str(subflow_path),
        "steps": [
            {
                "name": "load data",
                "state": "Unstart",
                "runtime": "",
                "peak memory (mb)": 0,
                "info": {},
            }
        ],
    }
    checklist = json.loads(checklist_path.read_text())
    assert checklist["schema_version"] == 3
    assert checklist["kind"] == "signoff_checklist"
    assert checklist["checker_revision"] == "signoff-v1"
    assert checklist["status"] == "ready"
    assert checklist["summary"] == {
        "passed": 0,
        "blocked": 0,
        "attention": 0,
        "unavailable": 0,
    }
    assert checklist["checklist"] == []
    snapshot = api.engineering_snapshot(WorkspaceIdRequest(workspace_id=workspace_id))
    assert snapshot["workspaceRevision"] == 2
    assert snapshot["cause"] == "flow.rerun_prepared"
    assert snapshot["flow"]["steps"][0]["state"] == "Unstart"
    assert all(
        fact["data"] is None
        for step in snapshot["analysis"]["steps"]
        for fact in (step["metrics"], step["summary"], step["hotspots"])
    )
    assert snapshot["metrics"] == []
    assert snapshot["qorAssessment"]["metrics"] == []
    assert all(artifact["availability"] == "missing" for artifact in snapshot["artifacts"])


def test_flow_run_step_gui_rerun_resets_target_and_downstream_subflows(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)

    def step_spec(name, tool):
        step_dir = ws / f"{name}_{tool}"
        artifact_dir = step_dir / "output"
        (artifact_dir / "nested").mkdir(parents=True)
        (artifact_dir / "nested" / "stale").write_text(name)
        subflow_path = step_dir / "subflow.json"
        subflow_path.write_text(
            json.dumps(
                {
                    "path": str(subflow_path),
                    "steps": [
                        {
                            "name": "load data",
                            "state": "Success",
                            "runtime": "0:00:01",
                            "peak memory (mb)": 10,
                            "info": {"stale": name},
                        },
                        {
                            "name": "run tool",
                            "state": "Success",
                            "runtime": "0:00:02",
                            "peak memory (mb)": 20,
                            "info": {"stale": name},
                        },
                    ],
                }
            )
        )
        checklist_path = step_dir / "checklist.json"
        checklist_path.write_text(json.dumps({"checklist": [{"item": name}]}))
        return {
            "name": name,
            "tool": tool,
            "output": {"dir": artifact_dir},
            "subflow": SimpleNamespace(path=subflow_path, steps=[]),
            "checklist": SimpleNamespace(path=checklist_path, checklist=[]),
        }

    synthesis = step_spec("Synthesis", "yosys")
    floorplan = step_spec("Floorplan", "ecc")
    route = step_spec("route", "ecc")
    DummyFlow.workspace_step_specs = (synthesis, floorplan, route)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    session = api.sessions.get_session(workspace_id)
    session.workspace.flow.data = {
        "steps": [
            {
                "name": spec["name"],
                "tool": spec["tool"],
                "state": "Success",
                "runtime": "0:00:04",
                "peak memory (mb)": 30,
                "info": {"stale": spec["name"]},
            }
            for spec in (synthesis, floorplan, route)
        ]
    }

    result = api._flow_run_step(
        FlowRunStepRequest(
            workspace_id=workspace_id,
            step="Floorplan",
            rerun=True,
        ),
        reset_dependents=True,
    )

    assert result == {"step": "Floorplan", "state": "Success"}
    assert (ws / "Synthesis_yosys" / "output" / "nested" / "stale").read_text() == "Synthesis"
    for spec in (floorplan, route):
        assert list(spec["output"]["dir"].iterdir()) == []
        checklist = json.loads(spec["checklist"].path.read_text())
        assert checklist["schema_version"] == 3
        assert checklist["kind"] == "signoff_checklist"
        assert checklist["checker_revision"] == "signoff-v1"
        assert checklist["status"] == "ready"
        assert checklist["summary"] == {
            "passed": 0,
            "blocked": 0,
            "attention": 0,
            "unavailable": 0,
        }
        assert checklist["checklist"] == []
        reset_subflow = json.loads(spec["subflow"].path.read_text())
        assert all(
            step["state"] == "Unstart"
            and step["runtime"] == ""
            and step["peak memory (mb)"] == 0
            and step["info"] == {}
            for step in reset_subflow["steps"]
        )

    records = {record["name"]: record for record in session.workspace.flow.data["steps"]}
    assert any(
        record["name"] == "Synthesis" and record["state"] == "Success"
        for record in session.workspace.flow.data["steps"]
    )
    for name in ("Floorplan", "route"):
        assert records[name] == {
            "name": name,
            "tool": "ecc",
            "state": "Unstart",
            "runtime": "",
            "peak memory (mb)": 0,
            "info": {},
        }


def test_flow_run_step_rerun_rejects_an_open_layout_edit(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]
    api.sessions.get_session(workspace_id).layout_edit_session = object()

    with pytest.raises(RuntimeApiError) as exc_info:
        api.flow_run_step(
            FlowRunStepRequest(workspace_id=workspace_id, step="Floorplan", rerun=True)
        )

    assert exc_info.value.code == "layout_edit_active"
    assert "close the rendered layout" in exc_info.value.message
    assert DummyFlow.instances[-1].run_calls == []


def test_flow_run_step_skips_successful_step_without_db_init(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    DummyFlow.successful_steps = {"Synthesis"}
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    result = api.flow_run_step(
        FlowRunStepRequest(workspace_id=workspace_id, step="Synthesis", rerun=False)
    )

    flow = DummyFlow.instances[-1]
    assert result == {"step": "Synthesis", "state": "Success"}
    assert flow.init_db_engine_calls == 0
    assert flow.call_order == [("run_step", "Synthesis", False)]


def test_flow_run_step_unknown_step_returns_runtime_error(monkeypatch, tmp_path):
    _capture, ws = _install_runtime_mocks(monkeypatch, tmp_path)
    api = WorkspaceRuntimeApi()
    workspace_id = api.open_workspace(WorkspaceOpenRequest(directory=str(ws)))["workspaceId"]

    with pytest.raises(RuntimeApiError) as exc_info:
        api.flow_run_step(
            FlowRunStepRequest(workspace_id=workspace_id, step="Missing", rerun=False)
        )

    assert exc_info.value.code == "command_failed"
    assert "step not found" in exc_info.value.message
