import json
from pathlib import Path
from types import SimpleNamespace

import pytest


HASH = "sha256:" + "a" * 64



from tests.optimization.experiments.equal_budget_support import (
    _load_experiment_execution,
    _load_experiment_runner,
    _terminal_observation,
)

def test_phase8_treatment_explicitly_sets_runtime_contract(
    tmp_path, monkeypatch
) -> None:
    module = _load_experiment_runner()
    captured = {}

    class FakeProvider:
        def __init__(self, **_kwargs) -> None:
            pass

        def select_model(self, _model) -> None:
            pass

        def close(self) -> None:
            pass

    fake_runner = SimpleNamespace(
        budget=SimpleNamespace(
            consumed_candidates=2,
            consumed_planning_calls=2,
            elapsed_wall_time_seconds=3.0,
        ),
        state=module.OptimizationEpisodeState.PLANNING,
        close=lambda: None,
    )

    def create_runner(context, _provider):
        captured.update(context)
        return fake_runner

    monkeypatch.setattr(module, "create_optimization_runner", create_runner)
    monkeypatch.setattr(
        module,
        "export_episode_traces",
        lambda **_kwargs: ((), 2, "receipt-aware"),
    )
    monkeypatch.setattr(module, "_episode_evidence", lambda *_args: {})
    design = module.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )

    result = module._run_treatment(
        design,
        tmp_path / "workspace",
        _terminal_observation(),
        1.0,
        tmp_path / "output",
        run_id="run",
        model="model",
        seed=1,
        treatment=module.KNOWLEDGE_TREATMENTS[0],
        provider_factory=FakeProvider,
    )

    assert captured["baseline_eligibility_exempt"] is True
    assert captured["receipt_aware_planning"] is True
    assert captured["agent_mode"] == "llm_no_knowledge"
    assert captured["knowledge_case_shots"] == 0
    assert result["terminal_artifacts_complete"] is False
    assert result["replay_chain_complete"] is False


def test_phase8_case_pool_metadata_requires_a_frozen_directory(
    tmp_path: Path,
) -> None:
    module = _load_experiment_runner()

    with pytest.raises(ValueError, match="case pool"):
        module._case_pool_metadata(tmp_path / "missing")
    pool = tmp_path / "pool"
    pool.mkdir()
    link = tmp_path / "pool-link"
    link.symlink_to(pool, target_is_directory=True)
    with pytest.raises(ValueError, match="case pool"):
        module._case_pool_metadata(link)

    audit_target = tmp_path / "audit.jsonl"
    audit_target.write_text("", encoding="utf-8")
    (pool / "optimization-knowledge-cases.v1.jsonl").symlink_to(audit_target)
    with pytest.raises(ValueError, match="symlink"):
        module._case_pool_metadata(pool)
    (pool / "optimization-knowledge-cases.v1.jsonl").unlink()

    assert module._case_pool_metadata(pool) == {
        "case_count": 0,
        "event_count": 0,
        "chain_head_sha256": None,
        "audit_file_sha256": None,
    }
    assert list(pool.iterdir()) == []


def test_phase8_snapshots_case_pool_into_the_run_artifact(tmp_path: Path) -> None:
    module = _load_experiment_runner()
    source = tmp_path / "source-pool"
    source.mkdir()

    snapshot, metadata = module._snapshot_case_pool(
        source, tmp_path / "run/knowledge-case-pool"
    )

    assert snapshot == (tmp_path / "run/knowledge-case-pool").resolve()
    assert metadata["artifact_ref"] == "knowledge-case-pool"
    assert metadata["event_count"] == 0
    assert list(source.iterdir()) == []


def test_phase8_rejects_reusing_a_run_id(tmp_path: Path) -> None:
    module = _load_experiment_runner()
    output = tmp_path / "output"
    (output / "runs/run").mkdir(parents=True)

    with pytest.raises(ValueError, match="run id already exists"):
        module.run_experiment(
            object(),
            tmp_path / "manifest.json",
            output,
            tmp_path / "workspaces",
            run_id="run",
            model="model",
            seed=1,
            tool_revision="tool",
            max_workers=1,
            terminal_timeout_seconds=1.0,
            provider_factory=lambda **_kwargs: None,
        )


@pytest.mark.parametrize(
    ("decision", "runs_few_shot"),
    [("pass", True), ("fail", False), ("not_assessed", False)],
)
def test_phase8_blocks_few_shot_until_zero_shot_gate_passes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    decision: str,
    runs_few_shot: bool,
) -> None:
    module = _load_experiment_runner()
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text("{}\n", encoding="utf-8")
    design = module.DesignSpec(
        "design", "top", "clk", tmp_path / "filelist.f", (), tmp_path / "design.sdc"
    )
    manifest = SimpleNamespace(manifest_sha256=HASH, designs=(design,))
    calls = []

    monkeypatch.setattr(
        module, "_ensure_workspace", lambda *_args: _terminal_observation()
    )
    monkeypatch.setattr(
        module,
        "_calibrate",
        lambda *_args: (_terminal_observation(), 1.0),
    )
    monkeypatch.setattr(
        module,
        "_snapshot_case_pool",
        lambda source, _destination: (source.resolve(), {"case_count": 1}),
    )

    def run_treatment(*_args, treatment, **_kwargs):
        if treatment == module.FEW_SHOT_TREATMENT:
            assert (tmp_path / "output/runs/run/zero-shot-gate.v1.json").is_file()
        calls.append(treatment.treatment)
        return {
            "traces": (),
            "planning_calls": 0,
            "elapsed_wall_time_seconds": 0.0,
            "terminal_artifacts_complete": True,
            "replay_chain_complete": True,
            "selected_case_count": 0,
            "case_selection_event_count": 0,
            "nonempty_case_selection_event_count": 0,
            "episode_evidence": {},
        }

    monkeypatch.setattr(module, "_run_treatment", run_treatment)
    monkeypatch.setattr(
        module,
        "build_zero_shot_gate_report",
        lambda *_args, **_kwargs: {
            "schema_version": "ecos.optimization_zero_shot_gate.v1",
            "decision": decision,
            "few_shot_authorized": decision == "pass",
        },
    )
    monkeypatch.setattr(
        module,
        "build_knowledge_treatment_report",
        lambda *_args, **_kwargs: {
            "schema_version": "ecos.optimization_knowledge_treatment_report.v2",
            "evaluation_status": "completed",
            "research_claim": "supported",
        },
    )

    result = module.run_experiment(
        manifest,
        manifest_path,
        tmp_path / "output",
        tmp_path / "workspaces",
        run_id="run",
        model="model",
        seed=1,
        tool_revision="tool",
        max_workers=1,
        terminal_timeout_seconds=1.0,
        provider_factory=lambda **_kwargs: None,
        knowledge_case_pool_root=tmp_path / "pool",
    )

    expected = [item.treatment for item in module.ZERO_SHOT_GATE_TREATMENTS]
    if runs_few_shot:
        expected.append(module.FEW_SHOT_TREATMENT.treatment)
    assert calls == expected
    assert (tmp_path / "output/runs/run/zero-shot-gate.v1.json").is_file()
    if runs_few_shot:
        assert result["schema_version"].endswith("treatment_report.v2")
        assert (tmp_path / "output/knowledge-treatment-report.v2.json").is_file()
    else:
        assert result["decision"] == decision
        assert not (tmp_path / "output/knowledge-treatment-report.v2.json").exists()


def test_phase8_runner_rejects_workspace_input_drift(tmp_path) -> None:
    runner = _load_experiment_execution()
    workspace = tmp_path / "workspace"
    source = tmp_path / "source"
    pdk = tmp_path / "pdk"
    for root in (
        workspace / "origin/rtl",
        workspace / "home",
        workspace / "config",
        source / "rtl",
    ):
        root.mkdir(parents=True)
    tech = pdk / "prtech/techLEF/N551P6M_ecos.lef"
    tech.parent.mkdir(parents=True)
    tech.write_text(
        "UNITS\n  DATABASE MICRONS 1 ;\nEND UNITS\n"
        "SITE core7\n  SIZE 1 BY 1 ;\nEND core7\n",
        encoding="utf-8",
    )
    (workspace / "origin/rtl/top.v").write_text(
        "module top; endmodule\n", encoding="utf-8"
    )
    (workspace / "origin/filelist.f").write_text("rtl/top.v\n", encoding="utf-8")
    (workspace / "origin/design.sdc").write_text("create_clock clk\n", encoding="utf-8")
    (source / "rtl/top.v").write_text("module top; endmodule\n", encoding="utf-8")
    (source / "filelist.f").write_text("rtl/top.v\n", encoding="utf-8")
    (source / "design.sdc").write_text("create_clock clk\n", encoding="utf-8")
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
    (workspace / "home/parameters.json").write_text(
        json.dumps(
            {
                "Design": "design",
                "Top module": "top",
                "Clock": "clk",
                "PDK Root": str(pdk),
                "Frequency max [MHz]": 50,
            }
        ),
        encoding="utf-8",
    )
    (workspace / "config/dreamplace_ecc.json").write_text(
        json.dumps(
            {
                "target_density": 0.2,
                "stop_overflow": 0.1,
                "cell_padding_x": 2,
                "routability_opt_flag": 1,
                "density_weight": 0.00085,
            }
        ),
        encoding="utf-8",
    )
    (workspace / "config/cts_ecc.json").write_text(
        json.dumps({"max_fanout": 32}), encoding="utf-8"
    )
    (workspace / "config/floorplan_ecc.json").write_text(
        json.dumps(
            {
                "die_builder": {
                    "die_util": {"utilization": 0.4, "aspect_ratio": 1.0}
                }
            }
        ),
        encoding="utf-8",
    )
    design = runner.DesignSpec(
        "design",
        "top",
        "clk",
        source / "filelist.f",
        (source / "rtl/top.v",),
        source / "design.sdc",
    )
    manifest = runner.ExperimentManifest(HASH, (design,), baseline, "ics55", pdk)

    runner._verify_workspace_binding(manifest, design, workspace)
    (workspace / "origin/rtl/top.v").write_text("module drift; endmodule\n")

    with pytest.raises(ValueError, match="workspace RTL bundle does not match"):
        runner._verify_workspace_binding(manifest, design, workspace)
