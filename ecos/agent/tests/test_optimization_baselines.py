from __future__ import annotations

import json
import shutil
from pathlib import Path

import ecos_agent.optimization_baseline_runner as baseline_runner
import pytest
from ecos_agent.optimization_baseline_runner import (
    BaselineCandidateExecution,
    BaselineCandidateFailure,
    evaluate_online_method,
)
from ecos_agent.optimization_baselines import (
    ONLINE_BASELINE_METHODS,
    BaselineMethod,
    rule_guided_policy_manifest,
    select_baseline_candidate,
)
from ecos_agent.optimization_contracts import (
    GateResult,
    ObjectiveMetric,
    RequestedKnobValue,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_gate0 import load_gate0_config
from ecos_agent.optimization_ledger import OptimizationOutcomeKind

HASH = "sha256:" + "a" * 64


def _terminal(violations: float, overflow: float, wirelength: float) -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-Harden",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: violations,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
        },
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
    )


def _values() -> dict[str, bool | int | float]:
    return {
        "place.target_density": 0.2,
        "place.cell_padding_x": 2,
        "place.routability_opt": True,
    }


def test_pilot_uses_two_designs_and_only_non_llm_online_baselines() -> None:
    root = Path(__file__).parents[1]
    config = load_gate0_config(root / "experiments/pilot/pilot.v1.json")

    assert {design.design_id for design in config.designs} == {"gcd", "i2c"}
    assert tuple(method.value for method in ONLINE_BASELINE_METHODS) == (
        "controlled_coordinate",
        "random_action",
        "rule_guided_direction",
    )
    assert {
        item.design_id: item.baseline_replay_count for item in config.designs
    } == {"gcd": 1, "i2c": 3}


def test_baseline_profile_uses_first_replay_as_reference() -> None:
    defaults = (
        _terminal(0, 0, 100),
        _terminal(0, 0, 104),
        _terminal(0, 0, 102),
    )

    profile = baseline_runner._baseline_noise_profile(defaults)

    assert profile["reference"]["route_wirelength"] == 100
    assert profile["epsilon"]["route_wirelength"] == 4


def test_single_replay_profile_disables_noise_band() -> None:
    profile = baseline_runner._baseline_noise_profile((_terminal(0, 0, 100),))

    assert profile["reference"]["route_wirelength"] == 100
    assert profile["epsilon"]["route_wirelength"] == 0


def test_controlled_coordinate_reuses_fixed_direction_order_without_duplicates() -> None:
    values = _values()
    attempted: list[RequestedKnobValue] = []
    selections = []
    coordinate_index = 0

    for turn_index in range(6):
        selection = select_baseline_candidate(
            BaselineMethod.CONTROLLED_COORDINATE,
            design_id="gcd",
            turn_index=turn_index,
            coordinate_index=coordinate_index,
            random_seed=17,
            current_values=values,
            attempted=attempted,
            incumbent=_terminal(0, 1, 100),
        )
        assert selection is not None
        selections.append(selection)
        coordinate_index = selection.next_coordinate_index
        attempted.append(selection.requested)
        values[selection.requested.knob_id.value] = selection.requested.value

    assert [item.action.knob_id.value for item in selections[:5]] == [
        "place.target_density",
        "place.target_density",
        "place.cell_padding_x",
        "place.cell_padding_x",
        "place.routability_opt",
    ]
    assert len({(item.requested.knob_id, item.requested.value) for item in selections}) == 6


def test_random_action_is_seeded_legal_and_replayable() -> None:
    def sequence() -> list[tuple[str, object]]:
        values = _values()
        attempted: list[RequestedKnobValue] = []
        result = []
        for turn_index in range(6):
            selection = select_baseline_candidate(
                BaselineMethod.RANDOM_ACTION,
                design_id="i2c",
                turn_index=turn_index,
                coordinate_index=0,
                random_seed=20260824,
                current_values=values,
                attempted=attempted,
                incumbent=_terminal(0, 2, 100),
            )
            assert selection is not None
            attempted.append(selection.requested)
            values[selection.requested.knob_id.value] = selection.requested.value
            result.append((selection.requested.knob_id.value, selection.requested.value))
        return result

    assert sequence() == sequence()
    assert len(set(sequence())) == 6


def test_rule_guided_direction_uses_audited_card_mappings() -> None:
    congested = select_baseline_candidate(
        BaselineMethod.RULE_GUIDED_DIRECTION,
        design_id="i2c",
        turn_index=0,
        coordinate_index=0,
        random_seed=0,
        current_values={**_values(), "place.routability_opt": False},
        attempted=(),
        incumbent=_terminal(0, 2, 100),
    )
    clean = select_baseline_candidate(
        BaselineMethod.RULE_GUIDED_DIRECTION,
        design_id="gcd",
        turn_index=0,
        coordinate_index=0,
        random_seed=0,
        current_values=_values(),
        attempted=(),
        incumbent=_terminal(0, 0, 100),
    )

    assert congested is not None
    assert congested.requested == RequestedKnobValue(
        knob_id="place.routability_opt", value=True
    )
    assert congested.knowledge_ref is not None
    assert congested.knowledge_ref.entity_id == (
        "strategy.congestion.enable_congestion_guided_area_adjust.v1"
    )
    assert clean is not None
    assert clean.requested == RequestedKnobValue(
        knob_id="place.routability_opt", value=False
    )
    assert clean.knowledge_ref is not None
    assert clean.knowledge_ref.entity_id == (
        "strategy.wirelength.reduce_excessive_place_spreading.v1"
    )


def test_rule_guided_policy_manifest_freezes_order_and_knowledge_hashes() -> None:
    manifest = rule_guided_policy_manifest()

    assert [rule["priority"] for rule in manifest["congested_rules"]] == [1, 2, 3]
    assert [rule["priority"] for rule in manifest["clean_rules"]] == [1, 2, 3]
    for rule in (*manifest["congested_rules"], *manifest["clean_rules"]):
        assert len(rule["knowledge_ref"]["chunk_sha256"]) == 64


def test_online_method_counts_failures_and_promotes_only_improvements() -> None:
    baseline = _terminal(10, 5, 100)
    parent_refs: list[str | None] = []

    def execute(index, selection, parent_candidate_root_ref, incumbent):
        parent_refs.append(parent_candidate_root_ref)
        assert incumbent.metrics[ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT] == (
            9 if parent_candidate_root_ref is not None else 10
        )
        if index == 1:
            return BaselineCandidateFailure(
                execution_id="execution-1",
                outcome=OptimizationOutcomeKind.EXECUTION_FAILED,
            )
        observation = _terminal(9 if index == 2 else 10, 5, 100 + index)
        return BaselineCandidateExecution(
            observation=observation,
            candidate_root_ref=f".agent/candidates/candidate-{index}",
        )

    summary = evaluate_online_method(
        BaselineMethod.CONTROLLED_COORDINATE,
        design_id="gcd",
        baseline=baseline,
        current_values=_values(),
        epsilon={
            **{metric.value: 0.0 for metric in ObjectiveMetric},
            **{metric.value: 0.0 for metric in TimingMetric},
        },
        random_seed=17,
        execute=execute,
    )

    assert summary["candidate_count"] == 6
    assert summary["failed_candidate_count"] == 1
    assert summary["first_improvement_candidate_index"] == 2
    assert summary["success_at_k"] == {
        "1": False,
        "2": True,
        "3": True,
        "4": True,
        "5": True,
        "6": True,
    }
    assert parent_refs[:3] == [None, None, ".agent/candidates/candidate-2"]


def test_online_method_does_not_charge_pre_execution_errors() -> None:
    def execute(*_args):
        raise RuntimeError("request validation failed before execution")

    with pytest.raises(RuntimeError, match="before execution"):
        evaluate_online_method(
            BaselineMethod.CONTROLLED_COORDINATE,
            design_id="gcd",
            baseline=_terminal(10, 5, 100),
            current_values=_values(),
            epsilon={
                **{metric.value: 0.0 for metric in ObjectiveMetric},
                **{metric.value: 0.0 for metric in TimingMetric},
            },
            random_seed=17,
            execute=execute,
        )


def test_workspace_binding_rejects_a_swapped_design(monkeypatch, tmp_path: Path) -> None:
    root = Path(__file__).parents[1]
    config_path = root / "experiments/pilot/pilot.v1.json"
    config = load_gate0_config(config_path)
    design = next(item for item in config.designs if item.design_id == "gcd")
    workspace = tmp_path / "workspace"
    (workspace / "origin/rtl").mkdir(parents=True)
    (workspace / "home").mkdir()
    shutil.copyfile(
        config_path.parent / design.rtl.path,
        workspace / "origin/rtl" / Path(design.rtl.path).name,
    )
    shutil.copyfile(config_path.parent / design.filelist.path, workspace / "origin/filelist.f")
    shutil.copyfile(
        config_path.parent / design.sdc.path,
        workspace / "origin" / Path(design.sdc.path).name,
    )
    (workspace / "home/flow.json").write_text("{}\n", encoding="utf-8")
    (workspace / "home/parameters.json").write_text(
        json.dumps({
            "Design": "gcd",
            "Top module": "gcd",
            "Clock": "clk",
            "Frequency max [MHz]": 50,
            "Max fanout": 32,
            "Target density": 0.2,
            "Target overflow": 0.1,
            "Cell padding x": 400,
            "Routability opt flag": 1,
            "Core": {"Utilitization": 0.4},
            "PDK Root": "/pdk",
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        baseline_runner, "build_terminal_observation", lambda _path: _terminal(0, 0, 100)
    )
    readiness = {"pdk": {"site_width_dbu": 200, "root": "/pdk"}}

    binding = baseline_runner._workspace_binding(config, design, workspace, readiness)

    assert binding["design_id"] == "gcd"
    assert binding["terminal_evidence_manifest_sha256"] == HASH
    swapped = next(item for item in config.designs if item.design_id == "i2c")
    with pytest.raises(baseline_runner.BaselineRunnerError, match="workspace evidence"):
        baseline_runner._workspace_binding(config, swapped, workspace, readiness)


def test_cli_reports_interruption_without_a_traceback(monkeypatch, tmp_path: Path) -> None:
    def interrupt(*args, **kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(baseline_runner, "run_baseline_pilot", interrupt)

    result = baseline_runner.main([
        "--run-id",
        "baseline-test",
        "--results-root",
        str(tmp_path),
        "--workspace",
        "gcd=/tmp/gcd",
        "--workspace",
        "i2c=/tmp/i2c",
    ])

    assert result == 130


def test_pilot_runner_writes_a_two_design_non_llm_manifest(monkeypatch, tmp_path: Path) -> None:
    root = Path(__file__).parents[1]
    monkeypatch.setattr(
        baseline_runner,
        "readiness_report",
        lambda _path: {"ready": True, "config_sha256": HASH},
    )
    monkeypatch.setattr(
        baseline_runner,
        "_run_design",
        lambda _config, design_id, *_args: {"design_id": design_id, "methods": {}},
    )
    monkeypatch.setattr(
        baseline_runner,
        "_workspace_binding",
        lambda _config, design, workspace, _site_width: {
            "design_id": design.design_id,
            "workspace": str(workspace),
            "flow_sha256": HASH,
        },
    )

    summary = baseline_runner.run_baseline_pilot(
        root / "experiments/pilot/pilot.v1.json",
        tmp_path,
        run_id="baseline-test",
        workspaces={"gcd": tmp_path / "gcd", "i2c": tmp_path / "i2c"},
        random_seed=17,
    )

    manifest = json.loads(
        (tmp_path / "baseline-test/run-manifest.v1.json").read_text(encoding="utf-8")
    )
    assert manifest["designs"] == ["gcd", "i2c"]
    assert manifest["baseline_replay_counts"] == {"gcd": 1, "i2c": 3}
    assert manifest["methods"] == [
        "default_ecos",
        "controlled_coordinate",
        "random_action",
        "rule_guided_direction",
    ]
    assert "oracle" not in json.dumps(manifest).lower()
    assert manifest["workspace_bindings"]["gcd"]["design_id"] == "gcd"
    assert manifest["policies"]["rule_guided_direction"]["schema_version"] == (
        "ecos.optimization_rule_guided_policy.v1"
    )
    assert set(summary["designs"]) == {"gcd", "i2c"}


def test_pilot_runner_marks_an_interrupted_run(monkeypatch, tmp_path: Path) -> None:
    root = Path(__file__).parents[1]
    monkeypatch.setattr(
        baseline_runner,
        "readiness_report",
        lambda _path: {"ready": True, "config_sha256": HASH},
    )
    monkeypatch.setattr(
        baseline_runner,
        "_workspace_binding",
        lambda _config, design, workspace, _readiness: {
            "design_id": design.design_id,
            "workspace": str(workspace),
        },
    )

    def interrupt(*args, **kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(baseline_runner, "_run_design", interrupt)

    with pytest.raises(KeyboardInterrupt):
        baseline_runner.run_baseline_pilot(
            root / "experiments/pilot/pilot.v1.json",
            tmp_path,
            run_id="baseline-interrupted",
            workspaces={"gcd": tmp_path / "gcd", "i2c": tmp_path / "i2c"},
        )

    marker = json.loads(
        (tmp_path / "baseline-interrupted/interrupted.v1.json").read_text(
            encoding="utf-8"
        )
    )
    assert marker["schema_version"] == "ecos.optimization_baseline_interruption.v1"
