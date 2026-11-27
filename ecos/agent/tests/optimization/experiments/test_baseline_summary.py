import csv
import sys

from ecos_agent.optimization.experiments import baseline_summary
from tests.optimization.experiments.equal_budget_support import _terminal_observation


def test_baseline_report_preserves_archived_power_metrics_and_units(tmp_path, monkeypatch):
    observation = _terminal_observation()
    replacements = {
        "power_analysis_dynamic_uw": ("sta_typical_dynamic_power", 2.5e-6, "W"),
        "power_analysis_leakage_uw": ("sta_typical_leakage_power", 0.4, "uW"),
    }
    archived_metrics = []
    for metric in observation.evaluation_metrics:
        if metric.metric_id in replacements:
            key, value, unit = replacements[metric.metric_id]
            metric = metric.model_copy(update={"metric_id": key, "value": value, "unit": unit})
        archived_metrics.append(metric)
    archived = observation.model_copy(update={"evaluation_metrics": tuple(archived_metrics)})
    replay = tmp_path / "workspaces/gcd/.agent/optimization/noise-calibration/default-replay-1"
    replay.mkdir(parents=True)
    (replay / "terminal-observation.v1.json").write_text(archived.model_dump_json())
    monkeypatch.setattr(baseline_summary, "build_terminal_observation", lambda _: observation)
    monkeypatch.setattr(sys, "argv", [
        "build_baseline_summary.py", "--run-root", str(tmp_path),
        "--designs", "gcd", "--replays", "1",
    ])

    assert baseline_summary.main() == 0

    with (tmp_path / "baseline-summary.csv").open(newline="") as csv_file:
        canonical, historical = csv.DictReader(csv_file)
    assert canonical["power_analysis_dynamic_uw"] == "2.5"
    assert historical["power_analysis_dynamic_uw"] == ""
    assert historical["sta_typical_dynamic_power"] == "2.5e-06"
    assert historical["sta_typical_dynamic_power_unit"] == "W"
    assert historical["sta_typical_leakage_power"] == "0.4"
    assert historical["sta_typical_leakage_power_unit"] == "uW"
    report = (tmp_path / "baseline-summary.md").read_text()
    assert "sta_typical_dynamic_power" in report
    assert "| 2.5e-06 W | 0.4 uW |" in report
