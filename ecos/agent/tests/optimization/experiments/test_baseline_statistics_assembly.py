import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.optimization.contracts import ObjectiveMetric
from ecos_agent.optimization.experiments.baseline_statistics_assembly import (
    assemble_baseline_design_statistics,
)
from ecos_agent.optimization.experiments.baselines import BaselineMethod
from ecos_agent.optimization.experiments.equal_budget import CandidateTrace
from tests.optimization.experiments.equal_budget_support import _terminal_observation

_EPSILON = {
    "route_dr_total_violation_count": 0.0,
    "route_la_total_overflow": 0.0,
    "route_wirelength": 0.5,
    "sta_setup_wns": 0.0,
    "sta_setup_tns": 0.0,
    "sta_hold_wns": 0.0,
    "sta_hold_tns": 0.0,
    "die_area": 1.0,
}
ONLINE_METHODS = [
    method for method in BaselineMethod if method is not BaselineMethod.DEFAULT
]


def _episode_id(method: BaselineMethod) -> str:
    return f"closeloop-20260916T010000-{method.value}"


def _write_calibration(run_root: Path, design_id: str) -> None:
    calibration = run_root / "reports" / design_id / "calibration"
    replay = calibration / "default-replay-1"
    replay.mkdir(parents=True)
    (replay / "terminal-observation.v1.json").write_text(
        _terminal_observation().model_dump_json(), encoding="utf-8"
    )
    (calibration / "noise-epsilon.v1.json").write_text(
        json.dumps({"schema_version": "ecos.noise_epsilon.v1", "epsilon": _EPSILON}),
        encoding="utf-8",
    )


def _write_episode(
    run_root: Path,
    design_id: str,
    method: BaselineMethod,
    *,
    feasible: bool,
) -> None:
    episode_id = _episode_id(method)
    traces = [
        CandidateTrace(
            design_id=design_id,
            candidate_id=f"{episode_id}.c1",
            started=True,
            terminal_success=feasible,
            terminal_utility=-3.0 if feasible else None,
            feasible=feasible,
            parameter_status="effective" if feasible else "unknown",
        ).__dict__
    ]
    episode_dir = run_root / "reports" / design_id / episode_id
    episode_dir.mkdir(parents=True)
    (episode_dir / "episode-summary.v1.json").write_text(
        json.dumps(
            {
                "schema_version": "ecos.overnight_episode_summary.v1",
                "design_id": design_id,
                "episode_id": episode_id,
                "planning_evidence": "receipt-aware",
                "planner_policy": f"baseline:{method.value}",
                "traces": traces,
            }
        ),
        encoding="utf-8",
    )


def _outcome_loader():
    def _load(episode_root: Path):
        # strictly better than the default anchor on wirelength (epsilon 0.5)
        best = _terminal_observation().model_copy(
            update={"metrics": {**_terminal_observation().metrics}}
        )
        best.metrics[ObjectiveMetric.ROUTE_WIRELENGTH] = 3.0
        return [SimpleNamespace(intervention_id="c1", terminal_observation=best)]

    return _load


def _seed_run(run_root: Path, design_id: str = "gcd", feasible: bool = True) -> None:
    _write_calibration(run_root, design_id)
    for method in ONLINE_METHODS:
        _write_episode(run_root, design_id, method, feasible=feasible)


def test_assembly_feeds_design_block_statistics(tmp_path: Path) -> None:
    _seed_run(tmp_path)

    report = assemble_baseline_design_statistics(
        tmp_path, ["gcd"], outcome_loader=_outcome_loader()
    )

    assert report["schema_version"] == "ecos.baseline_design_statistics_assembly.v1"
    assert report["episode_selection"] == {
        "gcd": {method.value: _episode_id(method) for method in ONLINE_METHODS}
    }
    statistics = report["statistics"]
    coordinate = statistics["methods"]["controlled_coordinate"]
    # one feasible candidate padded to the frozen 20-candidate budget
    assert coordinate["auc_success_at_20_by_design"]["gcd"] == pytest.approx(1.0)
    assert coordinate["by_design"]["gcd"]["auc_success_at_20"] == pytest.approx(1.0)
    assert coordinate["lex_success_at_20_by_design"]["gcd"] is True
    # best observation strictly beats the default anchor -> "better"
    assert coordinate["by_design"]["gcd"]["comparison_vs_default"] == "better"
    assert statistics["paired_auc_permutation_tests"]


def test_assembly_rejects_episode_without_feasible_candidate(tmp_path: Path) -> None:
    _seed_run(tmp_path, feasible=False)

    def empty_loader(episode_root: Path):
        return []

    with pytest.raises(ValueError, match="terminal-eligible candidate"):
        assemble_baseline_design_statistics(
            tmp_path, ["gcd"], outcome_loader=empty_loader
        )


def test_assembly_rejects_missing_method_episode(tmp_path: Path) -> None:
    _seed_run(tmp_path)
    shutil.rmtree(tmp_path / "reports" / "gcd" / _episode_id(ONLINE_METHODS[0]))

    with pytest.raises(ValueError, match=f"baseline:{ONLINE_METHODS[0].value}"):
        assemble_baseline_design_statistics(
            tmp_path, ["gcd"], outcome_loader=_outcome_loader()
        )


def test_assembly_rejects_incomplete_noise_epsilon(tmp_path: Path) -> None:
    _seed_run(tmp_path)
    calibration = tmp_path / "reports" / "gcd" / "calibration"
    payload = json.loads((calibration / "noise-epsilon.v1.json").read_text("utf-8"))
    del payload["epsilon"]["route_wirelength"]
    (calibration / "noise-epsilon.v1.json").write_text(json.dumps(payload), "utf-8")

    with pytest.raises(ValueError, match="route_wirelength"):
        assemble_baseline_design_statistics(
            tmp_path, ["gcd"], outcome_loader=_outcome_loader()
        )
