import json

import pytest

from ecos_agent.hashing import canonical_sha256

HASH = "sha256:" + "a" * 64



from tests.optimization.experiments.equal_budget_support import (
    _load_experiment_execution,
    _terminal_observation,
)

def test_phase8_runner_loads_hash_bound_ten_design_manifest(tmp_path) -> None:
    runner = _load_experiment_execution()
    benchmark = tmp_path / "benchmarks"
    pdk = tmp_path / "pdk"
    tech = pdk / "prtech/techLEF/N551P6M_ecos.lef"
    tech.parent.mkdir(parents=True)
    tech.write_text("VERSION 5.8 ;\n", encoding="utf-8")
    designs = []
    design_ids = [f"d{i}" for i in range(10)]
    for design_id in design_ids:
        root = benchmark / design_id
        (root / "rtl").mkdir(parents=True)
        rtl = root / "rtl/top.v"
        filelist = root / "filelist.f"
        sdc = root / f"{design_id}.sdc"
        rtl.write_text("module top; endmodule\n", encoding="utf-8")
        filelist.write_text("rtl/top.v\n", encoding="utf-8")
        sdc.write_text("create_clock -period 10 clk\n", encoding="utf-8")
        designs.append(
            {
                "design_id": design_id,
                "top_module": "top",
                "clock_name": "clk",
                "filelist": f"{design_id}/filelist.f",
                "filelist_sha256": runner.file_sha256(filelist),
                "rtl_bundle_sha256": canonical_sha256(
                    {"rtl/top.v": runner.file_sha256(rtl)}
                ),
                "sdc": f"{design_id}/{design_id}.sdc",
                "sdc_sha256": runner.file_sha256(sdc),
            }
        )
    payload = {
        "schema_version": "ecos.frozen_design_manifest.v2",
        "design_ids": design_ids,
        "designs": designs,
        "baseline": {
            "frequency_mhz": 50,
            "max_fanout": 32,
            "core_utilization": 0.4,
            "core_aspect_ratio": 1.0,
            "target_density": 0.2,
            "target_overflow": 0.1,
            "cell_padding_sites": 2,
            "routability_opt": True,
            "density_weight": 0.00085,
        },
        "pdk": {
            "name": "ics55",
            "tech_lef": "prtech/techLEF/N551P6M_ecos.lef",
            "tech_lef_sha256": runner.file_sha256(tech),
        },
    }
    payload["manifest_sha256"] = canonical_sha256(payload)
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")

    loaded = runner.load_experiment_manifest(manifest, benchmark, pdk)

    assert tuple(item.design_id for item in loaded.designs) == tuple(design_ids)
    assert loaded.manifest_sha256 == payload["manifest_sha256"]


def test_phase8_runner_rejects_unsupported_filelist_entry(tmp_path) -> None:
    runner = _load_experiment_execution()
    filelist = tmp_path / "filelist.f"
    filelist.write_text("-f nested.f\n", encoding="utf-8")

    with pytest.raises(ValueError, match="unsupported entry"):
        runner._filelist_refs(filelist)


def test_phase8_runner_uses_gui_origin_for_canonical_flow(tmp_path, monkeypatch) -> None:
    runner = _load_experiment_execution()
    tech = tmp_path / "pdk/prtech/techLEF/N551P6M_ecos.lef"
    tech.parent.mkdir(parents=True)
    tech.write_text(
        "UNITS\n  DATABASE MICRONS 1 ;\nEND UNITS\n"
        "SITE core7\n  SIZE 1 BY 1 ;\nEND core7\n",
        encoding="utf-8",
    )
    baseline = {
        "frequency_mhz": 50,
        "max_fanout": 32,
        "core_utilization": 0.4,
        "core_aspect_ratio": 1.0,
        "target_density": 0.2,
        "target_overflow": 0.1,
        "cell_padding_sites": 2,
        "routability_opt": True,
        "density_weight": 0.00085,
    }
    design = runner.DesignSpec(
        "design",
        "top",
        "clk",
        tmp_path / "filelist.f",
        (tmp_path / "rtl/top.v",),
        tmp_path / "design.sdc",
    )
    manifest = runner.ExperimentManifest(HASH, (design,), baseline, "ics55", tech.parents[2])
    calls = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def _request(self, method, params, *, timeout_seconds):
            calls.append((method, params, timeout_seconds))
            if method == "workspace.create":
                return {"workspaceId": "workspace"}
            return {"operationId": "flow", "state": "succeeded"}

        def close(self) -> None:
            pass

    monkeypatch.setattr(runner, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(runner, "_ecc_executable", lambda: tmp_path / "ecc")
    monkeypatch.setattr(runner, "_verify_workspace_binding", lambda *_args: None)
    monkeypatch.setattr(runner, "_verify_workspace_inputs", lambda *_args: None)
    monkeypatch.setattr(runner, "build_terminal_observation", lambda _workspace: _terminal_observation())

    runner._ensure_workspace(manifest, design, tmp_path / "workspace", 1.0)

    start = next(params for method, params, _ in calls if method == "operation.start_flow")
    assert start["origin"] == "gui"


def test_phase8_runner_resumes_created_unstarted_workspace(
    tmp_path, monkeypatch
) -> None:
    runner = _load_experiment_execution()
    workspace = tmp_path / "workspace"
    (workspace / "home").mkdir(parents=True)
    (workspace / "home/flow.json").write_text(
        json.dumps(
            {
                "steps": [
                    {"name": name, "state": "Unstart"}
                    for name in runner.GUI_WORKSPACE_FLOW_STEPS
                ]
            }
        ),
        encoding="utf-8",
    )
    calls = []
    started = False

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def open_workspace(self, directory):
            calls.append(("workspace.open", directory, None))
            return "workspace"

        def _request(self, method, params, *, timeout_seconds):
            nonlocal started
            calls.append((method, params, timeout_seconds))
            started = True
            return {"operationId": "flow", "state": "succeeded"}

        def close(self) -> None:
            pass

    manifest = object()
    design = runner.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )
    observation = _terminal_observation()
    monkeypatch.setattr(runner, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(runner, "_ecc_executable", lambda: tmp_path / "ecc")
    monkeypatch.setattr(runner, "_verify_workspace_binding", lambda *_args: None)
    monkeypatch.setattr(runner, "_verify_workspace_inputs", lambda *_args: None)
    monkeypatch.setattr(
        runner,
        "build_terminal_observation",
        lambda _workspace: observation
        if started
        else pytest.fail("flow was not resumed"),
    )

    assert runner._ensure_workspace(manifest, design, workspace, 1.0) == observation
    assert calls[0] == ("workspace.open", workspace, None)
    assert calls[1][0] == "operation.start_flow"
    assert calls[1][1]["rerun"] is False


def test_phase8_calibration_uses_three_default_flow_replays(tmp_path, monkeypatch) -> None:
    runner = _load_experiment_execution()
    workspace = tmp_path / "canonical"
    workspace.mkdir()
    (workspace / "marker.txt").write_text("canonical", encoding="utf-8")
    calls = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def open_workspace(self, directory):
            calls.append(("workspace.open", directory, None))
            return "workspace"

        def _request(self, method, params, *, timeout_seconds):
            calls.append((method, params, timeout_seconds))
            return {"operationId": "flow", "state": "succeeded"}

        def close(self) -> None:
            pass

    observation = _terminal_observation()
    design = runner.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )
    monkeypatch.setattr(runner, "EccContentLengthRpcClient", FakeClient)
    monkeypatch.setattr(runner, "_ecc_executable", lambda: tmp_path / "ecc")
    monkeypatch.setattr(runner, "_verify_workspace_binding", lambda *_args: None)
    monkeypatch.setattr(runner, "_verify_workspace_inputs", lambda *_args: None)
    monkeypatch.setattr(runner, "build_terminal_observation", lambda _workspace: observation)
    monkeypatch.setattr(runner, "_optimization_rerun_runtime_seconds", lambda _workspace: 12.0)

    reference, runtime = runner._calibrate(
        object(),
        design,
        workspace,
        observation,
        tmp_path / "calibration",
        1.0,
    )

    starts = [params for method, params, _ in calls if method == "operation.start_flow"]
    assert reference == observation
    assert runtime == 12.0
    assert len(starts) == 3
    assert all(item["rerun"] is True for item in starts)
    assert all(item["origin"] == "gui" for item in starts)
