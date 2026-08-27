import importlib.util
import json
from pathlib import Path

import pytest

from ecos_agent.optimization_equal_budget import (
    CandidateTrace,
    EqualBudgetConfig,
    evaluate_equal_budget,
)


def _load_harness():
    path = Path(__file__).parents[1] / "scripts" / "run_equal_budget_harness.py"
    spec = importlib.util.spec_from_file_location("run_equal_budget_harness", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_equal_budget_counts_receipts_and_aliases() -> None:
    traces = [
        CandidateTrace(
            design_id="gcd",
            candidate_id="c1",
            started=True,
            terminal_success=True,
            terminal_utility=10.0,
            activation_status="used",
            application_signature="a1",
            response_signature="r1",
            alias=True,
            alias_valid=True,
            proposal_outcome="repair",
            runtime_seconds=2.0,
            peak_memory_mb=4.0,
        ),
        CandidateTrace(
            design_id="gcd",
            candidate_id="c2",
            started=True,
            terminal_success=False,
            activation_status="not_activated",
            application_signature="a2",
            response_signature="r2",
            receipt_status="missing",
            proposal_outcome="reject",
            runtime_seconds=3.0,
            peak_memory_mb=8.0,
        ),
        CandidateTrace(
            design_id="gcd",
            candidate_id="c3",
            started=False,
            terminal_success=False,
            alias=True,
            alias_valid=False,
        ),
    ]
    summary = evaluate_equal_budget(
        traces,
        mode="receipt-aware",
        config=EqualBudgetConfig(reference_runtime_seconds=2.0),
        planning_calls=3,
    )
    assert summary.started_candidates == 2
    assert summary.terminal_successes == 1
    assert summary.aliases_saved == 1
    assert summary.wrong_prunes == 1
    assert summary.not_activated == 1
    assert summary.overridden_rate == 0.0
    assert summary.ignored_rate == 0.0
    assert summary.not_activated_rate == 0.5
    assert summary.receipt_missing == 1
    assert summary.wall_time_limit_seconds == 44.0
    assert summary.peak_memory_mb == 8.0


def test_requested_only_does_not_claim_alias_savings() -> None:
    trace = CandidateTrace(
        design_id="gcd", candidate_id="c1", started=False, terminal_success=False, alias=True
    )
    summary = evaluate_equal_budget([trace], mode="requested-only")
    assert summary.aliases_saved == 0
    assert summary.wrong_prunes == 0


def test_equal_budget_reports_terminal_metrics_and_regret() -> None:
    summary = evaluate_equal_budget(
        [
            CandidateTrace(
                design_id="gcd",
                candidate_id="c1",
                started=True,
                terminal_success=True,
                terminal_utility=8.0,
                reference_utility=10.0,
                ppa=1.2,
                drc=0.0,
                timing=-0.1,
                congestion=0.3,
            )
        ],
        mode="receipt-aware",
    )
    assert summary.simple_regret == 2.0
    assert summary.ppa == (1.2,)
    assert summary.drc == (0.0,)
    assert summary.timing == (-0.1,)
    assert summary.congestion == (0.3,)


def test_harness_keeps_preexecution_only_trace_not_run(tmp_path) -> None:
    harness = _load_harness()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": [f"d{i}" for i in range(10)]}))
    traces = tmp_path / "traces.jsonl"
    traces.write_text(
        json.dumps({"design_id": "d0", "candidate_id": "c1", "started": False, "terminal_success": False})
        + "\n"
    )

    result = harness.run(manifest, tmp_path / "out", traces, planning_calls=1)

    assert result["status"] == "not_run"


def test_harness_requires_reproducibility_metadata_for_started_trace(tmp_path) -> None:
    harness = _load_harness()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"design_ids": [f"d{i}" for i in range(10)]}))
    traces = tmp_path / "traces.jsonl"
    traces.write_text(
        json.dumps({"design_id": "d0", "candidate_id": "c1", "started": True, "terminal_success": False})
        + "\n"
    )

    with pytest.raises(ValueError, match="reproducibility metadata"):
        harness.run(manifest, tmp_path / "out", traces, planning_calls=1)
