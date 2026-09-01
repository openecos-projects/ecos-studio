import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from ecos_runtime_adapter.requests import (
    FloorplanEditInspectRequest,
    FloorplanEditRunAutoRequest,
    FloorplanEditValidateRequest,
    LayoutEditApplyRequest,
    LayoutEditBeginRequest,
    LayoutEditDiscardRequest,
    LayoutEditSaveRequest,
)
from ecos_runtime_adapter.sessions import WorkspaceSessionRegistry
from ecos_runtime_adapter.workspace_api import RuntimeApiError, WorkspaceRuntimeApi


class FakeLayoutModule:
    def __init__(self):
        self.initialize_calls = 0
        self.reset_calls = 0
        self.place_calls = []
        self.sync_calls = []
        self.export_calls = []
        self.session_snapshot_calls = []
        self.editor_calls = []
        self.validation_result = {"ok": True, "diagnostics": []}
        self.export_intent = {"ok": True}

    def initialize_geometry_session(self):
        self.initialize_calls += 1
        return True

    def reset_geometry_session(self):
        self.reset_calls += 1
        return True

    def place_instance(self, **kwargs):
        self.place_calls.append(kwargs)
        return True

    def sync_instance_geometry(self, inst_name):
        self.sync_calls.append(inst_name)
        return {
            "ok": True,
            "snapshotRequired": False,
            "updatedShapeCount": 1,
            "insertedShapeCount": 0,
            "deletedShapeCount": 0,
            "missingShapeCount": 0,
            "events": [{"shapeId": 11, "op": "update"}],
        }

    def def_save(self, def_path):
        self.export_calls.append("def")
        Path(def_path).write_text("new def", encoding="utf-8")

    def save_data(self, path):
        self.export_calls.append("db")
        db_path = Path(path)
        db_path.mkdir(parents=True)
        (db_path / "metadata.idb").write_text("new db", encoding="utf-8")
        return True

    def gds_save(self, output_path):
        self.export_calls.append("gds")
        Path(output_path).write_text("new gds", encoding="utf-8")

    def geometry_snapshot_save(self, output_dir):
        self.export_calls.append("geometry")
        geometry_dir = Path(output_dir)
        geometry_dir.mkdir(parents=True)
        (geometry_dir / "geometry.manifest").write_text("new geometry", encoding="utf-8")
        return True

    def geometry_session_snapshot_save(self, output_dir):
        self.session_snapshot_calls.append(Path(output_dir))
        geometry_dir = Path(output_dir)
        geometry_dir.mkdir(parents=True)
        (geometry_dir / "geometry.manifest").write_text("session geometry", encoding="utf-8")
        return True

    def floorplan_editor_apply(self, request):
        self.editor_calls.append(request)
        return {
            "accepted": True,
            "changed": True,
            "affectedRefs": [{"kind": "blockage", "id": "blockage-1"}],
            "geometryDelta": {
                "ok": True,
                "snapshotRequired": True,
                "updatedShapeCount": 0,
                "insertedShapeCount": 1,
                "deletedShapeCount": 0,
                "missingShapeCount": 0,
                "events": [{"shapeId": 31, "op": "insert"}],
            },
            "modelPatch": {
                "floorplanPlan": {"placement_blockages": [{"id": "blockage-1"}]},
                "pdnPlan": {"manual_segments": [{"id": "segment-1"}]},
                "configPatch": {"editor": {"enabled": True}},
                "parametersPatch": {"Floorplan": {"edited": True}},
            },
            "diagnostics": [{"severity": "warning", "message": "preview"}],
        }

    def floorplan_editor_validate(self, scope):
        assert scope
        return self.validation_result

    def floorplan_editor_export_intent(self):
        return self.export_intent

    def floorplan_editor_inspect(self):
        return {"ownerCount": 3}

    def verilog_save(self, output_verilog):
        self.export_calls.append("verilog")
        Path(output_verilog).write_text("module gcd; endmodule\n", encoding="utf-8")


class FakeEngineDb:
    def __init__(self, module):
        self.ecc_module = module
        self.initialized = False
        self.created_for = []
        self.close_calls = 0

    @property
    def engine(self):
        return self.ecc_module

    def has_init(self):
        return self.initialized

    def create_db_engine(self, step):
        self.created_for.append(step)
        self.initialized = True
        return True

    def close(self):
        self.close_calls += 1
        self.initialized = False


class FakeFlow:
    def __init__(self, workspace, step, module):
        self.workspace = workspace
        self.workspace_step = step
        self.engine_db = FakeEngineDb(module)

    def get_workspace_step(self, name):
        return self.workspace_step if name == self.workspace_step.name else None


def _make_layout_workspace(tmp_path, *, with_db=False, with_editor_workspace=False):
    workspace_dir = tmp_path / "workspace"
    output_dir = workspace_dir / "Floorplan_ecc" / "output"
    output_dir.mkdir(parents=True)
    output_def = output_dir / "gcd_Floorplan.def.gz"
    output_def.write_text("old def", encoding="utf-8")
    output_db = output_dir / "gcd_Floorplan_db"
    if with_db:
        output_db.mkdir()
        (output_db / "metadata.idb").write_text("old db", encoding="utf-8")
    step = SimpleNamespace(
        name="Floorplan",
        input={"def": None, "verilog": None, "db": None},
        output={
            "def": output_def,
            "db": output_db,
            "gds": output_dir / "gcd_Floorplan.gds",
            "geometry": output_dir / "geometry",
            "geometry_manifest": output_dir / "geometry" / "geometry.manifest",
            "verilog": output_dir / "gcd_Floorplan.v",
        },
    )
    workspace = SimpleNamespace(directory=workspace_dir)
    if with_editor_workspace:
        config_path = workspace_dir / "config" / "floorplan_ecc.json"
        config_path.parent.mkdir()
        config_path.write_text('{"legacy": true}\n', encoding="utf-8")
        parameters_path = workspace_dir / "parameters.json"
        parameters_path.write_text('{"Floorplan": {"edited": false}}\n', encoding="utf-8")
        flow_path = workspace_dir / "flow.json"
        flow_data = {
            "steps": [
                {"name": "Floorplan", "state": "Success", "runtime": "1s"},
                {"name": "place", "state": "Success", "runtime": "2s"},
                {"name": "route", "state": "Success", "runtime": "3s"},
            ]
        }
        flow_path.write_text(json.dumps(flow_data), encoding="utf-8")
        workspace.config = {"Floorplan": config_path}
        workspace.parameters = SimpleNamespace(
            path=parameters_path,
            data={"Floorplan": {"edited": False}},
        )
        workspace.flow = SimpleNamespace(path=flow_path, data=flow_data)
    return workspace, step


def _open_api(monkeypatch, tmp_path, *, with_db=False, with_editor_workspace=False):
    from chipcompiler.engine.snapshot import create_engineering_snapshot

    workspace, step = _make_layout_workspace(
        tmp_path,
        with_db=with_db,
        with_editor_workspace=with_editor_workspace,
    )
    module = FakeLayoutModule()
    flow_calls = []

    def build_flow(_workspace):
        flow = FakeFlow(_workspace, step, module)
        flow_calls.append(flow)
        return flow

    monkeypatch.setattr("ecos_runtime_adapter.workspace_api.build_flow_for_workspace", build_flow)
    registry = WorkspaceSessionRegistry()
    snapshot = create_engineering_snapshot(workspace)
    session = registry.open_session(
        workspace.directory,
        workspace=workspace,
        workspace_id=snapshot["workspaceId"],
        workspace_revision=snapshot["workspaceRevision"],
    )
    api = WorkspaceRuntimeApi(sessions=registry, persistent_db_enabled=True)
    return api, session, step, module, flow_calls


def _begin(api, workspace_id, **kwargs):
    return api.layout_edit_begin(
        LayoutEditBeginRequest(workspace_id=workspace_id, step="Floorplan", **kwargs)
    )


def _apply(api, edit_session_id, *, revision=0, command_id="move-1"):
    return api.layout_edit_apply(
        LayoutEditApplyRequest(
            edit_session_id=edit_session_id,
            command_id=command_id,
            base_revision=revision,
            operation={
                "kind": "place_instance",
                "instName": "u_sram_0",
                "llx": 1200,
                "lly": 3400,
                "orient": "N",
                "cellmaster": "",
                "source": "",
                "placementStatus": "preserve",
                "createIfMissing": False,
            },
        )
    )


def test_layout_edit_begin_loads_output_def_when_output_db_is_absent(monkeypatch, tmp_path):
    api, session, step, module, flow_calls = _open_api(monkeypatch, tmp_path)

    result = _begin(api, session.workspace_id)

    assert result["source"] == "def"
    assert result["dirty"] is False
    assert Path(result["geometryManifestPath"]).is_file()
    assert module.initialize_calls == 1
    loaded_step = flow_calls[0].engine_db.created_for[0]
    assert loaded_step is not step
    assert loaded_step.input["db"] is None
    assert loaded_step.input["def"] == step.output["def"]


def test_layout_edit_begin_prefers_selected_step_output_db(monkeypatch, tmp_path):
    api, session, step, _module, flow_calls = _open_api(monkeypatch, tmp_path, with_db=True)

    result = _begin(api, session.workspace_id)

    assert result["source"] == "db"
    loaded_step = flow_calls[0].engine_db.created_for[0]
    assert loaded_step.input["db"] == step.output["db"]


def test_layout_edit_begin_rejects_another_workspace_until_active_session_is_discarded(
    monkeypatch,
    tmp_path,
):
    api, first_session, _step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    second_workspace = SimpleNamespace(directory=tmp_path / "second-workspace")
    second_session = api.sessions.open_session(
        second_workspace.directory,
        workspace=second_workspace,
    )

    first = _begin(api, first_session.workspace_id)

    with pytest.raises(RuntimeApiError) as exc_info:
        _begin(api, second_session.workspace_id)

    assert exc_info.value.code == "layout_edit_active"
    assert exc_info.value.data == {
        "editSessionId": first["editSessionId"],
        "workspaceId": first_session.workspace_id,
    }
    assert module.initialize_calls == 1

    api.layout_edit_discard(LayoutEditDiscardRequest(first["editSessionId"]))
    second = _begin(api, second_session.workspace_id)

    assert second["workspaceId"] == second_session.workspace_id
    assert module.initialize_calls == 2


def test_layout_edit_apply_calls_place_instance_without_persisting_artifacts(monkeypatch, tmp_path):
    api, session, step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)
    original_def = step.output["def"].read_text(encoding="utf-8")

    result = _apply(api, begin["editSessionId"])

    assert result["revision"] == 1
    assert result["dirty"] is True
    assert result["geometryDelta"]["events"] == [{"shapeId": 11, "op": "update"}]
    assert module.place_calls == [
        {
            "inst_name": "u_sram_0",
            "llx": 1200,
            "lly": 3400,
            "orient": "N",
            "cellmaster": "",
            "source": "",
            "placement_status": "preserve",
            "create_if_missing": False,
        }
    ]
    assert module.sync_calls == ["u_sram_0"]
    assert module.export_calls == []
    assert len(module.session_snapshot_calls) == 2
    assert Path(result["geometryManifestPath"]).is_file()
    assert step.output["def"].read_text(encoding="utf-8") == original_def
    assert not step.output["db"].exists()
    assert not step.output["gds"].exists()
    assert not step.output["geometry"].exists()


def test_layout_edit_save_publishes_staged_outputs_only_after_explicit_save(monkeypatch, tmp_path):
    api, session, step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)
    apply = _apply(api, begin["editSessionId"])

    saved = api.layout_edit_save(
        LayoutEditSaveRequest(
            edit_session_id=begin["editSessionId"],
            expected_revision=apply["revision"],
            expected_workspace_revision=session.workspace_revision,
        )
    )

    assert saved["saved"] is True
    assert saved["dirty"] is False
    assert saved["artifacts"] == {
        "defPath": str(step.output["def"]),
        "dbPath": str(step.output["db"]),
        "gdsPath": str(step.output["gds"]),
        "geometryManifestPath": str(step.output["geometry_manifest"]),
    }
    assert module.export_calls == ["def", "db", "gds", "geometry"]
    assert step.output["def"].read_text(encoding="utf-8") == "new def"
    assert (step.output["db"] / "metadata.idb").read_text(encoding="utf-8") == "new db"
    assert step.output["gds"].read_text(encoding="utf-8") == "new gds"
    geometry_manifest = step.output["geometry"] / "geometry.manifest"
    assert geometry_manifest.read_text(encoding="utf-8") == "new geometry"
    assert not list(step.output["def"].parent.glob(".layout-edit-*"))


def test_layout_edit_discard_drops_in_memory_db_without_publishing(monkeypatch, tmp_path):
    api, session, step, module, flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)
    _apply(api, begin["editSessionId"])
    geometry_root = Path(begin["geometryManifestPath"]).parent.parent

    result = api.layout_edit_discard(LayoutEditDiscardRequest(begin["editSessionId"]))

    assert result == {
        "editSessionId": begin["editSessionId"],
        "discarded": True,
        "dirty": True,
    }
    assert flow_calls[0].engine_db.close_calls == 1
    assert module.reset_calls == 1
    assert not geometry_root.exists()
    assert step.output["def"].read_text(encoding="utf-8") == "old def"
    assert module.export_calls == []
    with pytest.raises(RuntimeApiError, match="layout edit session not found"):
        _apply(api, begin["editSessionId"])


def test_layout_edit_save_rejects_external_source_change(monkeypatch, tmp_path):
    api, session, step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)
    apply = _apply(api, begin["editSessionId"])
    step.output["def"].write_text("external change", encoding="utf-8")

    with pytest.raises(RuntimeApiError) as exc_info:
        api.layout_edit_save(
            LayoutEditSaveRequest(
                edit_session_id=begin["editSessionId"],
                expected_revision=apply["revision"],
                expected_workspace_revision=session.workspace_revision,
            )
        )

    assert exc_info.value.code == "source_changed"
    assert module.export_calls == []
    assert step.output["def"].read_text(encoding="utf-8") == "external change"


def test_layout_edit_save_rolls_back_when_publish_fails(monkeypatch, tmp_path):
    api, session, step, _module, _flow_calls = _open_api(monkeypatch, tmp_path, with_db=True)
    step.output["gds"].write_text("old gds", encoding="utf-8")
    step.output["geometry"].mkdir()
    (step.output["geometry"] / "geometry.manifest").write_text(
        "old geometry",
        encoding="utf-8",
    )
    begin = _begin(api, session.workspace_id)
    apply = _apply(api, begin["editSessionId"])
    real_replace = __import__("os").replace

    def fail_gds_publish(source, destination):
        if Path(source).name == step.output["gds"].name and Path(destination) == step.output["gds"]:
            raise OSError("simulated publish failure")
        real_replace(source, destination)

    monkeypatch.setattr("ecos_runtime_adapter.workspace_api.os.replace", fail_gds_publish)

    with pytest.raises(RuntimeApiError, match="simulated publish failure"):
        api.layout_edit_save(
            LayoutEditSaveRequest(
                edit_session_id=begin["editSessionId"],
                expected_revision=apply["revision"],
                expected_workspace_revision=session.workspace_revision,
            )
        )

    assert step.output["def"].read_text(encoding="utf-8") == "old def"
    assert (step.output["db"] / "metadata.idb").read_text(encoding="utf-8") == "old db"
    assert step.output["gds"].read_text(encoding="utf-8") == "old gds"
    geometry_manifest = step.output["geometry"] / "geometry.manifest"
    assert geometry_manifest.read_text(encoding="utf-8") == "old geometry"


def test_layout_edit_apply_rejects_stale_revision_before_mutation(monkeypatch, tmp_path):
    api, session, _step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)
    _apply(api, begin["editSessionId"])

    with pytest.raises(RuntimeApiError) as exc_info:
        _apply(api, begin["editSessionId"], revision=0, command_id="move-2")

    assert exc_info.value.code == "version_conflict"
    assert len(module.place_calls) == 1


def test_layout_edit_apply_replays_completed_command_before_revision_validation(
    monkeypatch,
    tmp_path,
):
    api, session, _step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)
    first = _apply(api, begin["editSessionId"])

    replay = _apply(api, begin["editSessionId"], revision=0)

    assert replay == first
    assert len(module.place_calls) == 1


def test_layout_edit_apply_allows_preserve_orientation_for_existing_instance(
    monkeypatch,
    tmp_path,
):
    api, session, _step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)

    result = api.layout_edit_apply(
        LayoutEditApplyRequest(
            edit_session_id=begin["editSessionId"],
            command_id="move-with-preserved-orient",
            base_revision=0,
            operation={
                "kind": "place_instance",
                "instName": "u_sram_0",
                "llx": 1200,
                "lly": 3400,
                "orient": "",
                "placementStatus": "preserve",
                "createIfMissing": False,
            },
        )
    )

    assert result["revision"] == 1
    assert module.place_calls[0]["orient"] == ""


def test_floorplan_editor_apply_inspect_validate_and_save_publish_editor_artifacts(
    monkeypatch,
    tmp_path,
):
    api, session, step, module, _flow_calls = _open_api(
        monkeypatch,
        tmp_path,
        with_editor_workspace=True,
    )
    begin = _begin(api, session.workspace_id)

    applied = api.layout_edit_apply(
        LayoutEditApplyRequest(
            edit_session_id=begin["editSessionId"],
            command_id="blockage-1",
            base_revision=0,
            operation={"kind": "upsert_blockage", "id": "blockage-1"},
        )
    )

    assert applied["revision"] == 1
    assert applied["affectedRefs"] == [{"kind": "blockage", "id": "blockage-1"}]
    assert applied["modelPatch"]["floorplanPlan"]["placement_blockages"] == [{"id": "blockage-1"}]
    assert module.editor_calls == [{"kind": "upsert_blockage", "id": "blockage-1"}]
    config_path = session.workspace.config["Floorplan"]
    assert config_path.read_text(encoding="utf-8") == '{"legacy": true}\n'

    inspected = api.floorplan_edit_inspect(
        FloorplanEditInspectRequest(edit_session_id=begin["editSessionId"])
    )
    assert inspected["state"] == {"ownerCount": 3}
    assert inspected["floorplanPlan"]["placement_blockages"] == [{"id": "blockage-1"}]

    validated = api.floorplan_edit_validate(
        FloorplanEditValidateRequest(edit_session_id=begin["editSessionId"], scope="pdn")
    )
    assert validated["valid"] is True

    module.export_intent = {
        "ok": True,
        "floorplanPlan": {"outline": {"die": [0, 0, 100, 100]}},
        "pdnPlan": {"manual_vias": [{"id": "via-1"}]},
        "parametersPatch": {"PDN": {"edited": True}},
        "requiresVerilog": True,
    }
    saved = api.layout_edit_save(
        LayoutEditSaveRequest(
            edit_session_id=begin["editSessionId"],
            expected_revision=applied["revision"],
            expected_workspace_revision=session.workspace_revision,
        )
    )

    assert saved["saved"] is True
    assert saved["artifacts"]["configPath"] == str(config_path)
    assert saved["artifacts"]["parametersPath"] == str(session.workspace.parameters.path)
    assert saved["artifacts"]["verilogPath"] == str(step.output["verilog"])
    assert saved["artifacts"]["flowPath"] == str(session.workspace.flow.path)
    assert module.export_calls == ["def", "db", "gds", "geometry", "verilog"]
    saved_config = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved_config["FloorplanPlan"]["outline"] == {"die": [0, 0, 100, 100]}
    assert saved_config["PdnPlan"]["manual_vias"] == [{"id": "via-1"}]
    assert saved_config["editor"] == {"enabled": True}
    saved_parameters = json.loads(session.workspace.parameters.path.read_text(encoding="utf-8"))
    assert saved_parameters["Floorplan"]["edited"] is True
    assert saved_parameters["PDN"] == {"edited": True}
    assert step.output["verilog"].is_file()
    stale_steps = session.workspace.flow.data["steps"][1:]
    assert [item["state"] for item in stale_steps] == ["Unstart", "Unstart"]
    assert [item["runtime"] for item in stale_steps] == ["", ""]


def test_floorplan_editor_run_auto_is_idempotent_and_save_rejects_invalid_result(
    monkeypatch,
    tmp_path,
):
    api, session, _step, module, _flow_calls = _open_api(monkeypatch, tmp_path)
    begin = _begin(api, session.workspace_id)

    first = api.floorplan_edit_run_auto(
        FloorplanEditRunAutoRequest(
            edit_session_id=begin["editSessionId"],
            command_id="auto-1",
            base_revision=0,
            request={"mode": "macro"},
        )
    )
    replay = api.floorplan_edit_run_auto(
        FloorplanEditRunAutoRequest(
            edit_session_id=begin["editSessionId"],
            command_id="auto-1",
            base_revision=0,
            request={"mode": "macro"},
        )
    )

    assert replay == first
    assert module.editor_calls == [{"kind": "run_auto", "request": {"mode": "macro"}}]
    module.validation_result = {
        "ok": False,
        "diagnostics": [{"severity": "error", "message": "bad outline"}],
    }
    with pytest.raises(RuntimeApiError) as exc_info:
        api.layout_edit_save(
            LayoutEditSaveRequest(
                edit_session_id=begin["editSessionId"],
                expected_revision=first["revision"],
                expected_workspace_revision=session.workspace_revision,
            )
        )

    assert exc_info.value.code == "floorplan_validation_failed"
    assert module.export_calls == []
