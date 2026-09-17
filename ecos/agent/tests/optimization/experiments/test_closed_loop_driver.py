import json
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import ObjectiveMetric, OptimizationKnob
from ecos_agent.optimization.experiments.closed_loop_driver import (
    _DEFAULT_GEOMETRY_MODE,
    _DEFAULT_GOAL_TEXT,
    _episode_objective,
    build_metric_comparison,
    write_episode_reports,
    write_noise_epsilon,
)
from ecos_agent.optimization.experiments.equal_budget import CandidateTrace
from ecos_agent.optimization.experiments.knowledge_treatment_runner import _objective
from ecos_agent.optimization.knob_policy import allowed_knobs
from ecos_agent.optimization.metrics.contracts import TerminalEvaluationMetric
from tests.optimization.experiments.equal_budget_support import (
    _terminal_observation,
)


def test_default_episode_objective_matches_treatment_freeze() -> None:
    assert _episode_objective(_DEFAULT_GOAL_TEXT, "fixed") == _objective()


def test_default_geometry_mode_opens_the_floorplan_domain() -> None:
    """The default driver run must allow adjusting floorplan knobs; the
    treatment runner parity above holds only for an explicit fixed mode."""
    assert _DEFAULT_GEOMETRY_MODE == "variable"
    contract = _episode_objective(_DEFAULT_GOAL_TEXT, _DEFAULT_GEOMETRY_MODE)
    assert {
        OptimizationKnob.FLOORPLAN_CORE_UTIL,
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
    } <= set(allowed_knobs(contract))


def test_variable_geometry_goal_opens_floorplan_domain_only() -> None:
    goal = "reduce routed wirelength and you can adjust floorplan knobs"
    contract = _episode_objective(goal, "variable")
    assert contract.source_goal_sha256 == canonical_sha256(goal)
    assert contract.primary_metric == ObjectiveMetric.ROUTE_WIRELENGTH
    assert contract.preserve_metrics == (
        ObjectiveMetric.DRC_COUNT,
        ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
    )
    assert contract.parameter_policy is not None
    assert contract.parameter_policy.geometry_mode == "variable"
    baseline = _episode_objective(_DEFAULT_GOAL_TEXT, "fixed")
    assert baseline.parameter_policy is not None
    assert baseline.parameter_policy.geometry_mode == "fixed"


def _write_replay(calibration_dir: Path, index: int, peak_memory_mb: float) -> None:
    observation = _terminal_observation()
    telemetry = TerminalEvaluationMetric(
        metric_id="flow_peak_memory",
        value=peak_memory_mb,
        unit="MB",
        category="cost",
        role="report",
        direction="lower_is_better",
        source_refs=("home/flow.json",),
    )
    replay = calibration_dir / f"default-replay-{index}"
    replay.mkdir(parents=True)
    (replay / "terminal-observation.v1.json").write_text(
        observation.model_copy(
            update={"evaluation_metrics": (*observation.evaluation_metrics, telemetry)}
        ).model_dump_json(),
        encoding="utf-8",
    )


def test_write_noise_epsilon_excludes_telemetry_drift_from_drifting_keys(
    tmp_path: Path,
) -> None:
    calibration = tmp_path / "calibration"
    _write_replay(calibration, 1, 1061.66)
    _write_replay(calibration, 2, 1059.191)
    _write_replay(calibration, 3, 1079.934)

    summary = write_noise_epsilon(calibration)

    payload = json.loads(
        (calibration / "noise-epsilon.v1.json").read_text(encoding="utf-8")
    )
    assert payload["schema_version"] == "ecos.noise_epsilon.v1"
    assert payload["comparison_key"] == "(metric_id, corner)"
    assert "flow_peak_memory" in payload["telemetry_excluded_metric_ids"]
    assert all(not key.startswith("flow_") for key in payload["epsilon"])
    assert payload["nonzero_epsilon_keys"] == []
    assert summary["drifting_metric_keys"] == []
    assert summary["replay_count"] == 3


def test_write_noise_epsilon_requires_replays_and_aligned_structure(
    tmp_path: Path,
) -> None:
    with pytest.raises(SystemExit, match="at least two replays"):
        write_noise_epsilon(tmp_path)

    calibration = tmp_path / "calibration"
    _write_replay(calibration, 1, 1061.66)
    _write_replay(calibration, 2, 1059.191)
    missing_row = _terminal_observation()
    (calibration / "default-replay-2" / "terminal-observation.v1.json").write_text(
        missing_row.model_copy(
            update={"evaluation_metrics": missing_row.evaluation_metrics[:-1]}
        ).model_dump_json(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="structurally aligned"):
        write_noise_epsilon(calibration)


def test_metric_comparison_reports_reference_best_and_noise() -> None:
    reference = _terminal_observation()
    best = CandidateTrace(
        design_id="design",
        candidate_id="episode.c2",
        started=True,
        terminal_success=True,
        terminal_utility=-3.5,
        area=11.0,
        dynamic_power=2.4,
        leakage_power=0.41,
        frequency=105.0,
        drc=0.0,
        timing=0.1,
        congestion=3.0,
        wirelength=3.5,
        die_area=1200.0,
        hold_wns=0.0,
    )
    worse = CandidateTrace(
        design_id="design",
        candidate_id="episode.c1",
        started=True,
        terminal_success=True,
        terminal_utility=-4.5,
        wirelength=4.5,
    )
    rejected = CandidateTrace(
        design_id="design",
        candidate_id="episode.c3",
        started=True,
        terminal_success=False,
    )
    epsilon = {
        "route_wirelength": 0.1,
        "sta_frequency": 0.0,
        "sta_typical_leakage_power": 0.05,
        "qor_summary_balanced": 1.0,
    }

    comparison = build_metric_comparison(reference, (worse, best, rejected), epsilon)

    assert comparison["best_candidate_id"] == "episode.c2"
    rows = comparison["metrics"]
    assert rows["route_wirelength"] == {
        "reference": 4.0,
        "best": 3.5,
        "delta": -0.5,
        "epsilon": 0.1,
        "beyond_noise": True,
    }
    assert rows["sta_frequency"]["beyond_noise"] is True
    assert rows["sta_typical_leakage_power"]["beyond_noise"] is False
    assert rows["route_la_total_overflow"]["epsilon"] is None
    assert rows["route_la_total_overflow"]["beyond_noise"] is None
    assert rows["gui_overall_qor_score"]["best"] is None
    assert rows["gui_overall_qor_score"]["beyond_noise"] is None
    assert rows["qor_summary_balanced"]["epsilon"] == 1.0
    assert rows["qor_summary_balanced"]["best"] is None
    assert rows["qor_summary_balanced"]["beyond_noise"] is None


def test_metric_comparison_without_started_candidates_keeps_reference() -> None:
    comparison = build_metric_comparison(_terminal_observation(), (), {})

    assert comparison["best_candidate_id"] is None
    assert comparison["metrics"]["route_wirelength"] == {
        "reference": 4.0,
        "best": None,
        "delta": None,
        "epsilon": None,
        "beyond_noise": None,
    }


def test_episode_reports_are_isolated_per_episode_id(tmp_path: Path) -> None:
    """同 design 两个 episode 的摘要必须共存，后写者不得覆写先写者（glm4→glm8→glm9 三度覆盖的回归）。"""
    root = tmp_path / "reports" / "gcd"

    def _summary(episode_id: str) -> dict[str, object]:
        return {
            "schema_version": "ecos.overnight_episode_summary.v1",
            "design_id": "gcd",
            "episode_id": episode_id,
        }

    first = write_episode_reports(
        root, _summary("closeloop-20260916T010000-gcd"), None
    )
    second = write_episode_reports(
        root, _summary("closeloop-20260916T020000-gcd"), {"calls": []}
    )

    assert first == root / "closeloop-20260916T010000-gcd"
    assert second == root / "closeloop-20260916T020000-gcd"
    assert json.loads(
        (first / "episode-summary.v1.json").read_text(encoding="utf-8")
    )["episode_id"] == "closeloop-20260916T010000-gcd"
    assert json.loads(
        (second / "episode-summary.v1.json").read_text(encoding="utf-8")
    )["episode_id"] == "closeloop-20260916T020000-gcd"
    assert (second / "knowledge-mediation-audit.v1.json").is_file()
    assert not (first / "knowledge-mediation-audit.v1.json").exists()
