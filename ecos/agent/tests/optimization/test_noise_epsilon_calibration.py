"""Workspace noise-epsilon loading and the calibration artifact writer."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.optimization.calibrate_workspace import write_noise_epsilon_artifact
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationObjectiveContract,
)
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.runtime import (
    OptimizationRuntimeError,
    _load_trend_noise_epsilon,
    create_optimization_runner,
)
from tests.optimization.test_runtime_artifacts import _semantic_objective, _terminal


def _write_artifact(workspace: Path, epsilon: dict[str, float]) -> None:
    artifact_dir = workspace / ".agent" / "optimization"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "noise-epsilon.v1.json").write_text(
        json.dumps(
            {
                "schema_version": "ecos.noise_epsilon.v1",
                "comparison_key": "(metric_id, corner)",
                "replay_count": 3,
                "reference": {key: 1.0 for key in epsilon},
                "epsilon": epsilon,
            }
        ),
        encoding="utf-8",
    )


def test_load_trend_noise_epsilon_reads_workspace_artifact(tmp_path: Path) -> None:
    corner_key = "sta_worst_leakage_power@N551P6M_tt_025"
    _write_artifact(tmp_path, {"route_wirelength": 1.5, corner_key: 0.2})

    assert _load_trend_noise_epsilon(tmp_path) == {
        "route_wirelength": 1.5,
        corner_key: 0.2,
    }


def test_load_trend_noise_epsilon_missing_artifact_points_at_calibration(
    tmp_path: Path,
) -> None:
    with pytest.raises(OptimizationRuntimeError, match="calibrate_workspace"):
        _load_trend_noise_epsilon(tmp_path)


@pytest.mark.parametrize(
    "payload",
    ["not json", {"schema_version": "ecos.other.v1", "epsilon": {}}],
)
def test_load_trend_noise_epsilon_rejects_corrupt_artifacts(
    tmp_path: Path, payload
) -> None:
    artifact_dir = tmp_path / ".agent" / "optimization"
    artifact_dir.mkdir(parents=True)
    text = payload if isinstance(payload, str) else json.dumps(payload)
    (artifact_dir / "noise-epsilon.v1.json").write_text(text, encoding="utf-8")

    with pytest.raises(OptimizationRuntimeError, match="noise epsilon artifact is invalid"):
        _load_trend_noise_epsilon(tmp_path)


def test_load_trend_noise_epsilon_rejects_non_finite_entries(tmp_path: Path) -> None:
    _write_artifact(tmp_path, {"route_wirelength": -1.0})

    with pytest.raises(OptimizationRuntimeError, match="noise epsilon artifact is invalid"):
        _load_trend_noise_epsilon(tmp_path)


def _full_agent_runner_context(tmp_path: Path) -> dict[str, object]:
    objective = OptimizationObjectiveContract.model_validate(_semantic_objective())
    return {
        "workspace": str(tmp_path),
        "episode_id": "episode-noise-gate",
        "objective": objective.model_dump(mode="json"),
        "objective_alignment": build_objective_alignment(objective, _terminal()).model_dump(
            mode="json"
        ),
    }


def test_full_agent_runner_requires_workspace_noise_epsilon(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime.build_terminal_observation",
        lambda _path: _terminal(),
    )

    with pytest.raises(OptimizationRuntimeError, match="calibrate_workspace"):
        create_optimization_runner(
            _full_agent_runner_context(tmp_path), planner=object()
        )


def test_full_agent_runner_loads_epsilon_and_passes_the_gate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "ecos_agent.optimization.runtime.build_terminal_observation",
        lambda _path: _terminal(),
    )
    _write_artifact(tmp_path, {"route_wirelength": 1.0})

    # The noise gate passes; the run fails later on the missing ECC/PDK
    # workspace fixtures instead of the missing calibration.
    with pytest.raises(Exception) as excinfo:
        create_optimization_runner(
            _full_agent_runner_context(tmp_path), planner=object()
        )
    assert "calibrate_workspace" not in str(excinfo.value)
    assert "noise epsilon" not in str(excinfo.value)


def test_write_noise_epsilon_artifact_profiles_replay_noise(tmp_path: Path) -> None:
    baseline = _terminal()
    drifted_metrics = dict(baseline.metrics)
    drifted_metrics[ObjectiveMetric.ROUTE_WIRELENGTH] = (
        drifted_metrics[ObjectiveMetric.ROUTE_WIRELENGTH] + 4.0
    )
    drifted = baseline.model_copy(update={"metrics": drifted_metrics})

    artifact = tmp_path / "noise-epsilon.v1.json"
    payload = write_noise_epsilon_artifact((baseline, drifted), artifact)

    assert payload["schema_version"] == "ecos.noise_epsilon.v1"
    assert payload["replay_count"] == 2
    assert payload["epsilon"][ObjectiveMetric.ROUTE_WIRELENGTH.value] == 4.0
    assert json.loads(artifact.read_text(encoding="utf-8")) == payload
