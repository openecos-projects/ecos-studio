from __future__ import annotations

import json
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

import ecos_agent.optimization.experiments.baseline_runner as baseline_runner
from ecos_agent.optimization.experiments.baseline_runner import (
    BaselineCandidateExecution,
    BaselineCandidateFailure,
    evaluate_online_method,
)
from ecos_agent.optimization.experiments.baselines import (
    BaselineMethod,
    rule_guided_policy_manifest,
    select_baseline_candidate,
)
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    RequestedKnobValue,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.experiments.statistics import baseline_design_statistics

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
        "place.target_overflow": 0.1,
        "place.cell_padding_x": 2,
        "place.routability_opt": True,
        "place.density_weight": 0.00085,
        "floorplan.core_util": 0.6,
        "floorplan.aspect_ratio": 1.0,
        "synth.max_fanout": 32,
    }


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

    for turn_index in range(20):
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
        "floorplan.core_util",
        "floorplan.core_util",
        "floorplan.aspect_ratio",
        "floorplan.aspect_ratio",
        "synth.max_fanout",
    ]
    assert len({(item.requested.knob_id, item.requested.value) for item in selections}) == 20


def test_random_action_is_seeded_legal_and_replayable() -> None:
    def sequence() -> list[tuple[str, object]]:
        values = _values()
        attempted: list[RequestedKnobValue] = []
        result = []
        for turn_index in range(20):
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
    assert len(set(sequence())) == 20


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
        knob_id="place.cell_padding_x", value=3
    )
    assert congested.knowledge_ref is not None
    assert congested.knowledge_ref.entity_id == (
        "strategy.congestion.padding_spreads_hotspot_cells.v1"
    )
    assert clean is not None
    assert clean.requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=1
    )
    assert clean.knowledge_ref is not None
    assert clean.knowledge_ref.entity_id == (
        "strategy.wirelength.reduce_excessive_place_spreading.v1"
    )


def test_rule_guided_direction_fills_the_candidate_budget() -> None:
    values = _values()
    attempted: list[RequestedKnobValue] = []
    coordinate_index = 0

    for turn_index in range(20):
        selection = select_baseline_candidate(
            BaselineMethod.RULE_GUIDED_DIRECTION,
            design_id="gcd",
            turn_index=turn_index,
            coordinate_index=coordinate_index,
            random_seed=0,
            current_values=values,
            attempted=attempted,
            incumbent=_terminal(0, 0, 100),
        )
        assert selection is not None
        attempted.append(selection.requested)
        coordinate_index = selection.next_coordinate_index
        values[selection.requested.knob_id.value] = selection.requested.value

    assert len(set(attempted)) == 20


def test_rule_guided_policy_manifest_freezes_order_and_knowledge_hashes() -> None:
    manifest = rule_guided_policy_manifest()

    assert manifest["exhaustion_policy"] == "controlled_coordinate_order"
    assert [rule["priority"] for rule in manifest["congested_rules"]] == [1, 2]
    assert [rule["priority"] for rule in manifest["clean_rules"]] == [1, 2]
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

    assert summary["candidate_count"] == 20
    assert summary["failed_candidate_count"] == 1
    assert summary["first_improvement_candidate_index"] == 2
    assert summary["lex_success_at_20"] is True
    assert summary["success_at_k"] == {
        str(index): index >= 2 for index in range(1, 21)
    }
    assert summary["auc_success_at_20"] == pytest.approx(19 / 20)
    assert summary["best_so_far_at_k"]["1"] == {
        "route_dr_total_violation_count": 10.0,
        "route_la_total_overflow": 5.0,
        "route_wirelength": 100.0,
    }
    assert summary["best_so_far_at_k"]["2"] == {
        "route_dr_total_violation_count": 9.0,
        "route_la_total_overflow": 5.0,
        "route_wirelength": 102.0,
    }
    assert summary["best_so_far_at_k"]["3"] == summary["best_so_far_at_k"]["2"]
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


def test_online_method_uses_native_application_receipt(
    monkeypatch, tmp_path: Path
) -> None:
    native_receipt = object()
    converted = []

    monkeypatch.setattr(baseline_runner, "_CANDIDATE_LIMIT", 1)
    monkeypatch.setattr(baseline_runner, "_current_values", lambda *_args: _values())
    monkeypatch.setattr(
        baseline_runner,
        "run_pilot_candidate",
        lambda *_args, **_kwargs: SimpleNamespace(
            observation=_terminal(9, 5, 100),
            receipt=SimpleNamespace(
                evidence=SimpleNamespace(candidate_root_ref="candidate-1"),
                parameter_application_receipt=native_receipt,
            ),
        ),
    )

    def convert(receipt, *, site_width_dbu):
        converted.append((receipt, site_width_dbu))
        return 0.25

    monkeypatch.setattr(
        baseline_runner,
        "coordinate_value_from_native_receipt",
        convert,
        raising=False,
    )

    summary = baseline_runner._run_online_method(
        BaselineMethod.CONTROLLED_COORDINATE,
        SimpleNamespace(),
        "workspace-1",
        tmp_path,
        tmp_path / "output",
        SimpleNamespace(terminal_timeout_seconds=1),
        {"pdk": {"site_width_dbu": 200}, "config_sha256": HASH},
        "run-1",
        "gcd",
        _terminal(10, 5, 100),
        {
            **{metric.value: 0.0 for metric in ObjectiveMetric},
            **{metric.value: 0.0 for metric in TimingMetric},
        },
        17,
    )

    assert summary["candidate_count"] == 1
    assert converted == [(native_receipt, 200)]


def test_parallel_rpc_failure_is_recorded_and_propagated(
    monkeypatch, tmp_path: Path
) -> None:
    clients = []

    class Client:
        def __init__(self, *_args, **_kwargs):
            self.closed = False
            clients.append(self)

        def open_workspace(self, _workspace):
            raise RuntimeError("private runtime detail")

        def close(self):
            self.closed = True

    monkeypatch.setattr(baseline_runner, "EccContentLengthRpcClient", Client)
    failure_path = tmp_path / "failure.v1.json"

    with pytest.raises(RuntimeError, match="private runtime detail"):
        baseline_runner._run_rpc_task(
            tmp_path,
            {"ecc": {"executable": "/fake/ecc"}},
            threading.BoundedSemaphore(1),
            failure_path,
            "default-replay-2",
            lambda *_args: None,
        )

    assert json.loads(failure_path.read_text(encoding="utf-8")) == {
        "error_type": "RuntimeError",
        "message": "parallel baseline task failed",
        "task_id": "default-replay-2",
    }
    assert clients[0].closed


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


def test_cli_forwards_max_workers(monkeypatch, tmp_path: Path) -> None:
    received = {}

    def run(*_args, **kwargs):
        received.update(kwargs)
        return {"designs": {}}

    monkeypatch.setattr(baseline_runner, "run_baseline_pilot", run)

    result = baseline_runner.main([
        "--run-id",
        "baseline-test",
        "--results-root",
        str(tmp_path),
        "--max-workers",
        "2",
        "--workspace",
        "gcd=/tmp/gcd",
        "--workspace",
        "i2c=/tmp/i2c",
    ])

    assert result == 0
    assert received["max_workers"] == 2


def test_online_method_reports_auc_and_best_so_far_effect_size() -> None:
    baseline = _terminal(10, 5, 100)

    def execute(index, _selection, _parent_candidate_root_ref, _incumbent):
        if index == 1:
            return BaselineCandidateFailure(
                "execution-1", OptimizationOutcomeKind.EXECUTION_FAILED
            )
        return BaselineCandidateExecution(
            observation=_terminal(9 if index == 2 else 10, 5, 100 + index),
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

    assert summary["auc_success_at_20"] == pytest.approx(19 / 20)
    assert summary["best_so_far_tuple"] == [9.0, 5.0, 102.0]
    assert summary["best_so_far_delta"] == {
        "route_dr_total_violation_count": -1.0,
        "route_la_total_overflow": 0.0,
        "route_wirelength": 2.0,
    }
    assert summary["candidates"][0]["best_so_far_tuple"] == [10.0, 5.0, 100.0]
    assert summary["candidates"][1]["decisive_metric"] == "route_dr_total_violation_count"
    assert summary["candidates"][1]["best_so_far_tuple"] == [9.0, 5.0, 102.0]


def test_design_block_statistics_reports_win_tie_loss_and_holm() -> None:
    baseline = _terminal(10, 5, 100).model_dump(mode="json")
    better = _terminal(9, 5, 100).model_dump(mode="json")
    epsilon = {
        **{metric.value: 0.0 for metric in ObjectiveMetric},
        **{metric.value: 0.0 for metric in TimingMetric},
    }

    def method(auc, success, observation):
        return {
            "auc_success_at_20": auc,
            "lex_success_at_20": success,
            "best_terminal_observation": observation,
        }

    summary = baseline_design_statistics(
        {
            "gcd": {
                "noise_profile": {"epsilon": epsilon},
                "methods": {
                    "default_ecos": {"terminal_observation": baseline},
                    "controlled_coordinate": method(0.5, True, better),
                    "random_action": method(0.0, False, baseline),
                    "rule_guided_direction": method(0.0, False, baseline),
                },
            },
            "i2c": {
                "noise_profile": {"epsilon": epsilon},
                "methods": {
                    "default_ecos": {"terminal_observation": baseline},
                    "controlled_coordinate": method(0.0, False, baseline),
                    "random_action": method(1.0, True, better),
                    "rule_guided_direction": method(0.0, False, baseline),
                },
            },
        }
    )

    controlled = summary["methods"]["controlled_coordinate"]
    assert controlled["design_count"] == 2
    assert controlled["median_auc_success_at_20"] == pytest.approx(0.25)
    assert controlled["lex_success_at_20_count"] == 1
    assert controlled["win_tie_loss_vs_default"] == {"win": 1, "tie": 1, "loss": 0}
    comparisons = summary["paired_auc_permutation_tests"]
    comparison = comparisons["controlled_coordinate__vs__random_action"]
    assert comparison["n_designs"] == 2
    assert comparison["holm_adjusted_p_value"] >= comparison["p_value"]
