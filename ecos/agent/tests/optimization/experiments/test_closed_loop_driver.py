import json
from pathlib import Path

import pytest

from ecos_agent.optimization.experiments.closed_loop_driver import (
    write_noise_epsilon,
)
from ecos_agent.optimization.metrics.contracts import TerminalEvaluationMetric
from tests.optimization.experiments.equal_budget_support import (
    _terminal_observation,
)


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
