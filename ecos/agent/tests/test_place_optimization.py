import json
from pathlib import Path

import pytest

from ecos_agent.place_optimization import OptimizationRunSpec, append_evaluation, generate_candidates


def _spec() -> OptimizationRunSpec:
    return OptimizationRunSpec(
        run_id="scan_001",
        source_workspace="/tmp/gcd",
        baseline_id="baseline",
        objective="place_hpwl",
        knob_id="place.target_density",
        lower=0.4,
        upper=0.8,
        direction="decrease",
        seed=3000,
        budget=5,
        requires_gui_review=True,
    )


def test_generates_four_deterministic_candidates_without_the_baseline() -> None:
    candidates = generate_candidates(_spec())

    assert [candidate.candidate_id for candidate in candidates] == ["candidate_1", "candidate_2", "candidate_3", "candidate_4"]
    assert [candidate.value for candidate in candidates] == [0.7, 0.6, 0.5, 0.4]


def test_rejects_an_empty_target_density_interval() -> None:
    with pytest.raises(ValueError, match="interval"):
        OptimizationRunSpec(
            run_id="scan_001",
            source_workspace="/tmp/gcd",
            baseline_id="baseline",
            objective="place_hpwl",
            knob_id="place.target_density",
            lower=0.8,
            upper=0.4,
            direction="decrease",
            seed=3000,
            budget=5,
            requires_gui_review=True,
        )


def test_appends_a_non_secret_evaluation_record(tmp_path: Path) -> None:
    append_evaluation(
        tmp_path / "memory.jsonl",
        run_id="scan_001",
        candidate_id="candidate_1",
        status="succeeded",
        value=0.7,
        metrics={"place_hpwl": 12.5},
        artifact_refs=["place_dreamplace/analysis/qor_metrics.json"],
    )

    record = json.loads((tmp_path / "memory.jsonl").read_text(encoding="utf-8"))
    assert record["status"] == "succeeded"
    assert record["metrics"] == {"place_hpwl": 12.5}
