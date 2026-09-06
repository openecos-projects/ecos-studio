from __future__ import annotations

import json
from pathlib import Path

from ecos_agent.optimization.contracts import GateResult
from ecos_agent.optimization.experiments.parameter_gap_artifacts import (
    build_report,
    flow_peak_memory_mb,
)
from tests.optimization.experiments.equal_budget_support import (
    _terminal_observation as _complete_terminal,
)


def test_gap_report_profiles_complete_baselines_without_signoff() -> None:
    complete = _complete_terminal()
    terminal = complete.model_copy(
        update={
            "signoff_gates": complete.signoff_gates.model_copy(
                update={"drc_clean": GateResult.FAIL}
            ),
            "evaluation_metrics": tuple(
                item.model_copy(update={"value": 2.0})
                if item.metric_id == "drc_count"
                else item
                for item in complete.evaluation_metrics
            ),
        }
    )

    report = build_report(
        "run-1",
        "2026-09-06T00:00:00Z",
        {},
        (terminal, terminal, terminal),
        {},
        (),
        (),
    )

    assert report["baseline_noise"]["reference"]["route_wirelength"] == 4.0
    assert report["baseline_noise"]["epsilon"]["route_wirelength"] == 0.0


def test_probe_memory_uses_candidate_terminal_metric(tmp_path: Path) -> None:
    payload = _complete_terminal().model_dump(mode="json")
    payload["evaluation_metrics"].append(
        {
            "metric_id": "flow_peak_memory",
            "value": 42.5,
            "unit": "MB",
            "category": "cost",
            "role": "report",
            "direction": "lower_is_better",
            "source_refs": ["home/flow.json"],
        }
    )
    (tmp_path / "terminal-observation.v1.json").write_text(
        json.dumps(payload), encoding="utf-8"
    )

    assert flow_peak_memory_mb(tmp_path) == 42.5
