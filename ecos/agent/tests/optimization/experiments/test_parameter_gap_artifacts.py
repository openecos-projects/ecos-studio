from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import GateResult, OptimizationKnob
from ecos_agent.optimization.experiments.gate0 import Gate0Error, noise_profile
from ecos_agent.optimization.experiments.parameter_gap import ProbeResult, summarize_knob
from ecos_agent.optimization.experiments.parameter_gap_artifacts import (
    build_report,
    flow_peak_memory_mb,
    write_outputs,
)
from ecos_agent.optimization.experiments.parameter_gap_resume_artifacts import (
    _read_probe_result,
    _resume_manifest,
    _validate_resume_source,
    _verify_resume_preservation,
)
from ecos_agent.optimization.experiments.parameter_gap_setup import (
    ParameterGapError,
    ParameterGapResumeConfig,
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
    assert report["baseline_noise_status"] == "measured"


def test_single_baseline_report_does_not_claim_zero_noise(tmp_path: Path) -> None:
    terminal = _complete_terminal()
    report = build_report("run", "now", {}, (terminal,), {}, (), ())
    write_outputs(tmp_path, report, ())
    exported = json.loads((tmp_path / "gcd-status-report.v2.json").read_text())
    assert exported["baseline_noise"] is None
    assert exported["baseline_noise_status"] == "not_assessed"
    assert exported["baseline_observations"] == [terminal.model_dump(mode="json")]
    assert "not_assessed" in (tmp_path / "gcd-status-summary.md").read_text()
    with pytest.raises(Gate0Error, match="cannot define a noise profile"):
        noise_profile((terminal,))
    with pytest.raises(Gate0Error, match="cannot define a noise profile"):
        build_report("run", "now", {}, (), {}, (), ())


@pytest.mark.parametrize("replays", [1, 3])
def test_resume_preserves_actual_baselines(tmp_path: Path, replays: int) -> None:
    terminal = _complete_terminal()
    digest = "sha256:" + "a" * 64
    report = build_report(
        "run", "now", {"config_sha256": digest}, (terminal,) * replays, {}, (), ()
    )
    write_outputs(tmp_path, report, ())
    (tmp_path / "baseline-1/workspace").mkdir(parents=True)
    expected = {}
    for index in range(1, replays + 1):
        path = tmp_path / f"baseline-{index}/flow-terminal-result.v1.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text('{"state": "succeeded"}\n')
        expected[path.parent.name] = file_sha256(path)
    resume = ParameterGapResumeConfig.model_construct(
        source_run_id="run",
        resume_id="resume",
        reason="bounded_parallel_resume",
        source_config_sha256=digest,
    )
    _validate_resume_source(report, resume, tmp_path)
    with pytest.raises(ParameterGapError, match="binding is invalid"):
        _validate_resume_source({**report, "baseline_observations": []}, resume, tmp_path)
    manifest = _resume_manifest(resume, {}, tmp_path, report, "now", None)
    assert manifest["baseline_artifact_sha256"] == expected
    assert _verify_resume_preservation(tmp_path, manifest)["baseline_artifacts_unchanged"]
    path.write_text('{"state": "failed"}\n')
    with pytest.raises(ParameterGapError, match="modified a preserved artifact"):
        _verify_resume_preservation(tmp_path, manifest)


def test_status_artifacts_export_and_resume_without_gap_fields(tmp_path: Path) -> None:
    result = ProbeResult("candidate-001", False, True, 1.0, "ok", False, "effective")
    summary = summarize_knob(OptimizationKnob.ROUTABILITY_OPT, (result,))
    terminal = _complete_terminal()
    report = build_report("run", "now", {}, (terminal, terminal), {}, (result,), (summary,))
    write_outputs(tmp_path, report, (result,))
    exported = json.loads((tmp_path / "gcd-status-report.v2.json").read_text())
    assert exported["status_counts"] == {"effective": 1, "inactive": 0, "unknown": 0}
    assert "verdict" not in exported
    assert "actual_value" in (tmp_path / "gcd-probes.v2.csv").read_text()
    probe_path = tmp_path / "probe-result.v2.json"
    probe_path.write_text(json.dumps({**result.to_dict(), "flow_peak_memory_mb": 42.0}))
    assert _read_probe_result(probe_path) == result


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
