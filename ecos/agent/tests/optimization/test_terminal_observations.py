from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from ecos_agent.optimization.contracts import TimingMetric
from ecos_agent.optimization.observations import (
    OptimizationObservationError,
    build_terminal_observation,
)



from tests.optimization.observation_support import (
    _checklist,
    _write_json,
    frozen_workspace,
)

def test_terminal_observation_uses_fixed_signoff_sources_and_reads_lvs_rcx(
    frozen_workspace: Path,
) -> None:
    observation = build_terminal_observation(frozen_workspace)

    assert observation.observation_id == "terminal-Harden"
    assert observation.metrics == {
        "route_dr_total_violation_count": 0.0,
        "route_la_total_overflow": 1.0,
        "route_wirelength": 5243.741,
    }
    assert observation.timing_guardrail == {
        TimingMetric.STA_SETUP_WNS: 0.2,
        TimingMetric.STA_SETUP_TNS: 0.0,
        TimingMetric.STA_HOLD_WNS: 0.1,
        TimingMetric.STA_HOLD_TNS: 0.0,
    }
    assert observation.signoff_gates.drc_clean.value == "pass"
    assert observation.signoff_gates.sta_setup_closed.value == "pass"
    assert observation.signoff_gates.sta_hold_closed.value == "pass"
    assert observation.signoff_gates.lvs_clean.value == "pass"
    assert observation.signoff_gates.rcx_corner_coverage.value == "pass"
    assert observation.signoff_gates.rcx_spef_parse_health.value == "pass"
    assert observation.signoff_gates.mpc_minimum_area.value == "not_applicable"
    assert observation.signoff_gates.mpc_maximum_area.value == "not_applicable"
    assert observation.harden_artifacts_complete is True
    assert observation.eligible_for_incumbent is True
    assert observation.schema_version == "ecos.terminal_observation.v3"
    by_id = {
        (item.category.value, item.metric_id, item.corner): item
        for item in observation.evaluation_metrics
    }
    assert by_id[("eligibility", "drc_count", None)].value == 0
    assert by_id[("eligibility", "lvs_count", None)].value == 0
    assert by_id[("eligibility", "sta_corner_count", None)].value == 3
    assert by_id[("ppa", "sta_standard_cell_area", None)].value == 1140
    assert by_id[("ppa", "sta_typical_dynamic_power", "TYP_25/TYPICAL")].value == 66.8
    assert by_id[("ppa", "sta_typical_leakage_power", "TYP_25/TYPICAL")].value == 0.267
    assert by_id[("ppa", "sta_worst_dynamic_power", "MAX_125/Cworst")].value == 105.2
    assert by_id[("ppa", "sta_worst_leakage_power", "ML_125/RCworst")].value == 89.1
    assert by_id[("routing_diagnostic", "route_via_count", None)].value == 1705
    assert (
        by_id[("routing_diagnostic", "route_dr_total_patch_count", None)].value == 126
    )
    assert by_id[("cost", "flow_tool_runtime", None)].value == 58.5
    assert by_id[("cost", "flow_peak_memory", None)].value == 500
    assert by_id[("cost", "flow_stage_count", None)].value == 11
    assert by_id[("cost", "flow_nonzero_peak_memory_stage_count", None)].value == 8
    assert by_id[("corner_robustness", "sta_setup_wns", "TYP_25/TYPICAL")].value == 8.5
    assert (
        by_id[("corner_robustness", "sta_dynamic_power", "TYP_25/TYPICAL")].value
        == 66.8
    )
    assert observation.sta_corner_ids == (
        "MAX_125/Cworst",
        "ML_125/RCworst",
        "TYP_25/TYPICAL",
    )
    assert observation.sta_corner_set_sha256.startswith("sha256:")
    assert observation.evaluation_metrics_complete is True


def test_terminal_observation_maps_blocked_ecc_checklist_to_failed_gate(
    frozen_workspace: Path,
) -> None:
    path = frozen_workspace / "lvs_ecc/checklist.json"
    payload = _checklist(("quality.lvs.clean", "failed"))
    payload["status"] = "blocked"
    _write_json(path, payload)

    observation = build_terminal_observation(frozen_workspace)

    assert observation.signoff_gates.lvs_clean.value == "fail"
    assert observation.eligible_for_incumbent is False


def test_terminal_observation_fails_closed_without_numeric_eligibility(
    frozen_workspace: Path,
) -> None:
    path = frozen_workspace / "lvs_ecc/analysis/qor_metrics.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["metrics"] = [
        item for item in payload["metrics"] if item["id"] != "lvs_count"
    ]
    _write_json(path, payload)

    with pytest.raises(
        OptimizationObservationError, match="evaluation metric is unavailable"
    ):
        build_terminal_observation(frozen_workspace)


def test_terminal_observation_rejects_nonzero_numeric_eligibility(
    frozen_workspace: Path,
) -> None:
    path = frozen_workspace / "drc_ecc/analysis/qor_metrics.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    next(item for item in payload["metrics"] if item["id"] == "drc_count")["value"] = 1
    _write_json(path, payload)

    observation = build_terminal_observation(frozen_workspace)

    assert observation.signoff_gates.drc_clean.value == "pass"
    assert observation.eligible_for_incumbent is False


def test_terminal_observation_marks_missing_power_as_ineligible(
    frozen_workspace: Path,
) -> None:
    power_path = frozen_workspace / "sta_ecc/feature/MAX_125/Cworst/power_summary.json"
    power_path.unlink()

    observation = build_terminal_observation(frozen_workspace)

    assert observation.evaluation_metrics_complete is False
    assert observation.eligible_for_incumbent is False
    assert not any(
        metric.metric_id in {"sta_worst_dynamic_power", "sta_worst_leakage_power"}
        for metric in observation.evaluation_metrics
    )


def test_terminal_observation_marks_missing_cost_as_ineligible(
    frozen_workspace: Path,
) -> None:
    (frozen_workspace / "CTS_ecc/analysis/qor_metrics.json").unlink()

    observation = build_terminal_observation(frozen_workspace)

    assert observation.evaluation_metrics_complete is False
    assert observation.eligible_for_incumbent is False
    by_id = {
        metric.metric_id: metric.value for metric in observation.evaluation_metrics
    }
    assert by_id["flow_stage_count"] == 11
    assert by_id["flow_cost_covered_stage_count"] == 10
    assert "flow_tool_runtime" not in by_id


def test_terminal_manifest_binds_corner_power_evidence(frozen_workspace: Path) -> None:
    before = build_terminal_observation(frozen_workspace)
    power_path = frozen_workspace / "sta_ecc/feature/TYP_25/TYPICAL/power_summary.json"
    power = json.loads(power_path.read_text(encoding="utf-8"))
    power["dynamic_uw"] = 67.0
    _write_json(power_path, power)

    after = build_terminal_observation(frozen_workspace)

    assert after.evidence_manifest_sha256 != before.evidence_manifest_sha256


@pytest.mark.parametrize("case", ["missing", "extra", "mismatched"])
def test_terminal_observation_rejects_sta_corner_identity_mismatch(
    frozen_workspace: Path, case: str
) -> None:
    if case == "missing":
        (frozen_workspace / "sta_ecc/feature/MAX_125/Cworst/qor_summary.json").unlink()
    elif case == "extra":
        source = frozen_workspace / "sta_ecc/feature/MAX_125/Cworst"
        shutil.copytree(source, frozen_workspace / "sta_ecc/feature/EXTRA/RCextra")
    else:
        path = frozen_workspace / "sta_ecc/feature/sta.step.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["sta"]["signoff_metrics"]["corners"][0]["sta_corner"] = "OTHER/Cworst"
        _write_json(path, payload)

    with pytest.raises(OptimizationObservationError, match="configured corners"):
        build_terminal_observation(frozen_workspace)


@pytest.mark.parametrize(
    ("section", "metric_id"),
    [("setup", "nvp"), ("hold", "nvp"), ("setup", "frequency_mhz")],
)
def test_terminal_observation_rejects_negative_corner_counts_and_frequency(
    frozen_workspace: Path, section: str, metric_id: str
) -> None:
    path = frozen_workspace / "sta_ecc/feature/MAX_125/Cworst/qor_summary.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["summary"][section][metric_id] = -1
    _write_json(path, payload)

    with pytest.raises(OptimizationObservationError, match="terminal metric payload"):
        build_terminal_observation(frozen_workspace)


@pytest.mark.parametrize("metric_id", [metric.value for metric in TimingMetric])
def test_terminal_observation_requires_each_timing_guardrail_metric(
    frozen_workspace: Path, metric_id: str
) -> None:
    path = frozen_workspace / "sta_ecc/analysis/qor_metrics.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["metrics"] = [
        item for item in payload["metrics"] if item["id"] != metric_id
    ]
    _write_json(path, payload)

    with pytest.raises(OptimizationObservationError, match="timing guardrail metric"):
        build_terminal_observation(frozen_workspace)


@pytest.mark.parametrize("invalid_value", [float("nan"), float("inf")])
def test_terminal_observation_rejects_non_finite_timing_guardrail_metric(
    frozen_workspace: Path, invalid_value: float
) -> None:
    path = frozen_workspace / "sta_ecc/analysis/qor_metrics.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    next(item for item in payload["metrics"] if item["id"] == "sta_setup_wns")[
        "value"
    ] = invalid_value
    _write_json(path, payload)

    with pytest.raises(OptimizationObservationError, match="QoR metric is invalid"):
        build_terminal_observation(frozen_workspace)


def test_terminal_observation_rejects_duplicate_timing_guardrail_metric(
    frozen_workspace: Path,
) -> None:
    path = frozen_workspace / "sta_ecc/analysis/qor_metrics.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["metrics"].append({"id": "sta_setup_wns", "value": 0.2})
    _write_json(path, payload)

    with pytest.raises(OptimizationObservationError, match="QoR metric is invalid"):
        build_terminal_observation(frozen_workspace)


@pytest.mark.parametrize("stage", ["lvs", "filler", "RCX"])
def test_terminal_observation_rejects_missing_or_failed_required_flow_stage(
    frozen_workspace: Path, stage: str
) -> None:
    flow_path = frozen_workspace / "home/flow.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    flow["steps"] = [item for item in flow["steps"] if item["name"] != stage]
    _write_json(flow_path, flow)

    with pytest.raises(OptimizationObservationError, match="canonical stage"):
        build_terminal_observation(frozen_workspace)

    flow["steps"].append({"name": stage, "state": "Failed"})
    _write_json(flow_path, flow)
    with pytest.raises(OptimizationObservationError, match="not successful"):
        build_terminal_observation(frozen_workspace)


def test_terminal_observation_keeps_configured_mpc_fail_closed(
    frozen_workspace: Path,
) -> None:
    parameters_path = frozen_workspace / "home/parameters.json"
    parameters = json.loads(parameters_path.read_text(encoding="utf-8"))
    parameters["MPC"] = {"core_template": {"minimum_area": 1, "maximum_area": 2}}
    _write_json(parameters_path, parameters)
    checklist_path = frozen_workspace / "Harden_ecc/checklist.json"
    _write_json(checklist_path, _checklist(("quality.mpc.minimum_area", "pass")))

    observation = build_terminal_observation(frozen_workspace)

    assert observation.signoff_gates.mpc_minimum_area.value == "pass"
    assert observation.signoff_gates.mpc_maximum_area.value == "unavailable"
    assert observation.eligible_for_incumbent is False


def test_terminal_observation_keeps_evidence_but_marks_missing_harden_outputs_incomplete(
    frozen_workspace: Path,
) -> None:
    (frozen_workspace / "Harden_ecc/output/tiny_Harden.lib").unlink()

    observation = build_terminal_observation(frozen_workspace)

    assert observation.evidence_valid is True
    assert observation.harden_artifacts_complete is False
