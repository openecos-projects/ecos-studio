from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from ecos_agent.hashing import file_sha256
from ecos_agent.knowledge_bundle import KnowledgeAnswer
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    OptimizationKnob,
    TimingMetric,
)
from ecos_agent.optimization_controller import CandidateExecutionEvidence
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_observations import (
    OptimizationObservationError,
    build_candidate_terminal_observation,
    build_stage_observation,
    build_terminal_observation,
)
from ecos_agent.optimization_retrieval import (
    KnowledgeChannel,
    OptimizationKnowledgeRetriever,
    build_optimization_retrieval_request,
)


def _budget() -> BudgetSnapshot:
    return BudgetSnapshot(
        budget=EpisodeBudget.from_reference_rerun(11.0),
        consumed_candidates=1,
        consumed_planning_calls=2,
    )


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def _metrics(*items: tuple[str, float]) -> dict[str, object]:
    return {
        "status": "success",
        "metrics": [{"id": metric_id, "value": value} for metric_id, value in items],
    }


def _checklist(*items: tuple[str, str]) -> dict[str, object]:
    return {
        "status": "ready",
        "checklist": [{"id": item_id, "state": state} for item_id, state in items],
    }


@pytest.fixture
def frozen_workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    _write_json(
        root / "home/flow.json",
        {
            "steps": [
                {"name": "place", "state": "Success"},
                {"name": "CTS", "state": "Success"},
                {"name": "legalization", "state": "Success"},
                {"name": "route", "state": "Success"},
                {"name": "drc", "state": "Success"},
                {"name": "lvs", "state": "Success"},
                {"name": "filler", "state": "Success"},
                {"name": "RCX", "state": "Success"},
                {"name": "sta", "state": "Success"},
                {"name": "Harden", "state": "Success"},
            ]
        },
    )
    _write_json(
        root / "home/parameters.json",
        {"Design": "tiny", "Target density": 0.2, "Cell padding x": 300, "Routability opt flag": 1},
    )
    _write_json(
        root / "place_dreamplace/analysis/qor_metrics.json",
        _metrics(
            ("place_lutrudy_utilization_max", 0.88),
            ("place_total_wirelength", 123.0),
            ("runtime_seconds", 1.0),
            ("peak_memory_mb", 100.0),
        ),
    )
    _write_json(
        root / "CTS_ecc/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 2.0), ("peak_memory_mb", 200.0)),
    )
    _write_json(
        root / "legalization_dreamplace/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 3.0), ("peak_memory_mb", 0.0)),
    )
    _write_json(
        root / "route_ecc/analysis/qor_metrics.json",
        _metrics(
            ("route_dr_total_violation_count", 0),
            ("route_dr_total_wirelength", 9999),
            ("route_la_total_overflow", 1),
            ("route_wirelength", 5243.741),
            ("route_via_count", 1705),
            ("route_dr_total_patch_count", 126),
            ("runtime_seconds", 4.0),
            ("peak_memory_mb", 300.0),
        ),
    )
    _write_json(
        root / "drc_ecc/analysis/qor_metrics.json",
        _metrics(("drc_count", 0), ("runtime_seconds", 5.0), ("peak_memory_mb", 100.0)),
    )
    _write_json(
        root / "lvs_ecc/analysis/qor_metrics.json",
        _metrics(("lvs_count", 0), ("runtime_seconds", 6.0), ("peak_memory_mb", 150.0)),
    )
    _write_json(
        root / "filler_ecc/analysis/qor_metrics.json",
        _metrics(("runtime_seconds", 7.0), ("peak_memory_mb", 0.0)),
    )
    _write_json(
        root / "RCX_ecc/analysis/qor_metrics.json",
        _metrics(
            ("rcx_expected_corner_count", 3),
            ("rcx_spef_file_count", 3),
            ("rcx_missing_corner_count", 0),
            ("rcx_spef_parse_failure_count", 0),
            ("runtime_seconds", 8.0),
            ("peak_memory_mb", 400.0),
        ),
    )
    _write_json(
        root / "sta_ecc/analysis/qor_metrics.json",
        _metrics(
            ("sta_setup_violation_count", 0),
            ("sta_hold_violation_count", 0),
            ("sta_setup_wns", 0.2),
            ("sta_setup_tns", 0.0),
            ("sta_hold_wns", 0.1),
            ("sta_hold_tns", 0.0),
            ("sta_corner_count", 3),
            ("sta_expected_corner_count", 3),
            ("sta_missing_corner_count", 0),
            ("runtime_seconds", 9.0),
            ("peak_memory_mb", 500.0),
        ),
    )
    _write_json(
        root / "Harden_ecc/analysis/qor_metrics.json",
        _metrics(
            ("harden_artifact_missing_count", 0),
            ("runtime_seconds", 10.0),
            ("peak_memory_mb", 250.0),
        ),
    )
    corners = {
        "MAX_125/Cworst": (6.8, 0.2, 313, 105.2, 80.0),
        "ML_125/RCworst": (8.9, 0.1, 964, 103.3, 89.1),
        "TYP_25/TYPICAL": (8.5, 0.14, 672, 66.8, 0.267),
    }
    for corner, (setup_wns, hold_wns, frequency_mhz, dynamic_uw, leakage_uw) in corners.items():
        feature_root = root / "sta_ecc/feature" / corner
        _write_json(
            feature_root / "qor_summary.json",
            {
                "summary": {
                    "setup": {
                        "wns": setup_wns,
                        "tns": 0.0,
                        "nvp": 0,
                        "frequency_mhz": frequency_mhz,
                    },
                    "hold": {"wns": hold_wns, "tns": 0.0, "nvp": 0},
                },
                "design_statistics": {"cella": 1140.0},
            },
        )
        _write_json(
            feature_root / "power_summary.json",
            {
                "schema_version": 1,
                "internal_uw": dynamic_uw - 10.0,
                "switching_uw": 10.0,
                "dynamic_uw": dynamic_uw,
                "leakage_uw": leakage_uw,
            },
        )
    configured_corners = sorted(corners)
    _write_json(
        root / "sta_ecc/feature/sta.step.json",
        {
            "sta": {
                "expected_corner_count": len(configured_corners),
                "loaded_corners": configured_corners,
                "signoff_metrics": {
                    "corners": [
                        {"sta_corner": corner} for corner in configured_corners
                    ]
                },
            }
        },
    )
    _write_json(root / "drc_ecc/checklist.json", _checklist(("quality.drc.clean", "pass")))
    _write_json(root / "lvs_ecc/checklist.json", _checklist(("quality.lvs.clean", "pass")))
    _write_json(root / "filler_ecc/checklist.json", _checklist(("quality.filler.complete", "pass")))
    _write_json(
        root / "RCX_ecc/checklist.json",
        _checklist(
            ("quality.rcx.corner_coverage", "pass"),
            ("quality.rcx.spef_parse_health", "pass"),
        ),
    )
    _write_json(
        root / "sta_ecc/checklist.json",
        _checklist(
            ("quality.sta.setup_closed", "pass"),
            ("quality.sta.hold_closed", "pass"),
        ),
    )
    _write_json(
        root / "Harden_ecc/checklist.json",
        _checklist(
            ("quality.mpc.minimum_area", "pass"),
            ("quality.mpc.maximum_area", "pass"),
        ),
    )
    for suffix in ("gds", "lef", "lib"):
        output = root / f"Harden_ecc/output/tiny_Harden.{suffix}"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(suffix, encoding="utf-8")
    return root


def test_stage_observation_reads_only_the_fixed_stage_artifacts(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(
        frozen_workspace,
        "place",
        budget=_budget(),
    )

    assert observation.observation_id == "stage-place"
    assert observation.metrics == {
        "place_lutrudy_utilization_max": 0.88,
        "place_total_wirelength": 123.0,
        "runtime_seconds": 1.0,
        "peak_memory_mb": 100.0,
    }
    assert observation.requested_knobs == ()
    assert observation.budget.remaining_candidates == 19

    repeated = build_stage_observation(frozen_workspace, "place", budget=_budget())
    assert repeated.evidence_manifest_sha256 == observation.evidence_manifest_sha256


def test_stage_observation_rejects_incomplete_and_unsafe_workspace_evidence(
    frozen_workspace: Path,
    tmp_path: Path,
) -> None:
    flow_path = frozen_workspace / "home/flow.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    flow["steps"][0]["state"] = "Running"
    _write_json(flow_path, flow)

    with pytest.raises(OptimizationObservationError, match="not successful"):
        build_stage_observation(frozen_workspace, "place", budget=_budget())

    flow["steps"][0]["state"] = "Success"
    _write_json(flow_path, flow)
    external = tmp_path / "external.json"
    _write_json(external, _metrics(("place_lutrudy_utilization_max", 0.88)))
    metrics_path = frozen_workspace / "place_dreamplace/analysis/qor_metrics.json"
    metrics_path.unlink()
    metrics_path.symlink_to(external)

    with pytest.raises(OptimizationObservationError, match="unsafe"):
        build_stage_observation(frozen_workspace, "place", budget=_budget())


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
    assert by_id[("routing_diagnostic", "route_dr_total_patch_count", None)].value == 126
    assert by_id[("cost", "flow_tool_runtime", None)].value == 55
    assert by_id[("cost", "flow_peak_memory", None)].value == 500
    assert by_id[("cost", "flow_stage_count", None)].value == 10
    assert by_id[("cost", "flow_nonzero_peak_memory_stage_count", None)].value == 8
    assert by_id[("corner_robustness", "sta_setup_wns", "TYP_25/TYPICAL")].value == 8.5
    assert by_id[("corner_robustness", "sta_dynamic_power", "TYP_25/TYPICAL")].value == 66.8
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
    payload["metrics"] = [item for item in payload["metrics"] if item["id"] != "lvs_count"]
    _write_json(path, payload)

    with pytest.raises(OptimizationObservationError, match="evaluation metric is unavailable"):
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


def test_terminal_observation_marks_missing_power_as_report_incomplete(
    frozen_workspace: Path,
) -> None:
    power_path = frozen_workspace / "sta_ecc/feature/MAX_125/Cworst/power_summary.json"
    power_path.unlink()

    observation = build_terminal_observation(frozen_workspace)

    assert observation.eligible_for_incumbent is True
    assert observation.evaluation_metrics_complete is False
    assert not any(
        metric.metric_id in {"sta_worst_dynamic_power", "sta_worst_leakage_power"}
        for metric in observation.evaluation_metrics
    )


def test_terminal_observation_marks_missing_cost_as_report_incomplete(
    frozen_workspace: Path,
) -> None:
    (frozen_workspace / "CTS_ecc/analysis/qor_metrics.json").unlink()

    observation = build_terminal_observation(frozen_workspace)

    assert observation.eligible_for_incumbent is True
    assert observation.evaluation_metrics_complete is False
    by_id = {metric.metric_id: metric.value for metric in observation.evaluation_metrics}
    assert by_id["flow_stage_count"] == 10
    assert by_id["flow_cost_covered_stage_count"] == 9
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
    payload["metrics"] = [item for item in payload["metrics"] if item["id"] != metric_id]
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


def test_candidate_terminal_observation_verifies_child_manifest_and_parent_flow(
    frozen_workspace: Path, tmp_path: Path
) -> None:
    source_copy = tmp_path / "candidate-source"
    shutil.copytree(frozen_workspace, source_copy)
    candidate_root = frozen_workspace / ".agent/candidates/candidate-1"
    shutil.copytree(source_copy, candidate_root)
    manifest_ref = ".agent/candidates/candidate-1/analysis/candidate_workspace.v1.json"
    manifest_path = frozen_workspace / manifest_ref
    parent_flow_hash = file_sha256(frozen_workspace / "home/flow.json")
    _write_json(
        manifest_path,
        {
            "schema": "ecc.workspace.candidate_workspace.v1",
            "schema_version": 1,
            "candidate_id": "candidate-1",
            "candidate_root_ref": ".agent/candidates/candidate-1",
            "parent_flow_sha256": parent_flow_hash,
            "candidate_flow_sha256": file_sha256(candidate_root / "home/flow.json"),
        },
    )
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-1",
        candidate_manifest_ref=manifest_ref,
        candidate_manifest_sha256=file_sha256(manifest_path),
    )

    observation = build_candidate_terminal_observation(frozen_workspace, evidence)

    assert observation.observation_id == "terminal-Harden"
    assert observation.metrics["route_la_total_overflow"] == 1.0

    candidate_flow = candidate_root / "home/flow.json"
    candidate_flow.write_text(candidate_flow.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    candidate_2_root = frozen_workspace / ".agent/candidates/candidate-2"
    shutil.copytree(candidate_root, candidate_2_root)
    manifest_2_ref = ".agent/candidates/candidate-2/analysis/candidate_workspace.v1.json"
    manifest_2_path = frozen_workspace / manifest_2_ref
    _write_json(
        manifest_2_path,
        {
            "schema": "ecc.workspace.candidate_workspace.v1",
            "schema_version": 1,
            "candidate_id": "candidate-2",
            "candidate_root_ref": ".agent/candidates/candidate-2",
            "parent_candidate_root_ref": ".agent/candidates/candidate-1",
            "parent_flow_sha256": file_sha256(candidate_flow),
            "candidate_flow_sha256": file_sha256(candidate_2_root / "home/flow.json"),
        },
    )
    evidence_2 = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-2",
        candidate_manifest_ref=manifest_2_ref,
        candidate_manifest_sha256=file_sha256(manifest_2_path),
    )

    assert build_candidate_terminal_observation(frozen_workspace, evidence_2).observation_id == (
        "terminal-Harden"
    )


class _RecordingRetriever:
    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    def reply_for_stages(
        self, query: str, candidate_stages: tuple[str, ...]
    ) -> KnowledgeAnswer:
        self.calls.append((query, candidate_stages))
        matches = [
            {
                "entity_id": f"{self.prefix}.{index}",
                "chunk_sha256": f"{index:x}" * 64,
            }
            for index in range(1, 5)
        ]
        return KnowledgeAnswer(
            text=f"{self.prefix} evidence",
            entity_ids=tuple(item["entity_id"] for item in matches),
            contract={
                "retrieval": {"query_sha256": "f" * 64, "corpus_sha256": "e" * 64},
                "matches": matches,
            },
        )


def test_optimization_retrieval_uses_fixed_query_inputs_and_independent_channels(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=OptimizationOutcomeKind.DEGRADED,
    )
    tool = _RecordingRetriever("parameter.dreamplace")
    general = _RecordingRetriever("strategy.congestion")
    retriever = OptimizationKnowledgeRetriever(tool_retriever=tool, general_retriever=general)

    result = retriever.retrieve(request)

    assert tuple(stage.value for stage in request.action_stages) == (
        "Floorplan",
        "fixFanout",
        "place",
    )
    assert request.allowed_knobs == tuple(OptimizationKnob)
    assert request.observed_metric_ids == tuple(sorted(observation.metrics))
    assert "0.88" not in json.dumps(request.model_dump(mode="json"))
    assert len(result.knowledge_refs) == 6
    assert {channel.channel for channel in result.channels if channel.enabled} == {
        KnowledgeChannel.TOOL,
        KnowledgeChannel.GENERAL,
    }
    assert all(len(channel.knowledge_refs) == 3 for channel in result.channels if channel.enabled)
    assert tool.calls[0][1] == ("floorplan", "fixfanout", "place")
    assert general.calls[0][1] == ("floorplan", "place")
    assert "0.88" not in tool.calls[0][0]
    assert "5243" not in general.calls[0][0]

    no_knowledge = retriever.retrieve(request, enabled_channels=())
    assert no_knowledge.request_sha256 == result.request_sha256
    assert no_knowledge.knowledge_refs == ()
    assert all(not channel.enabled for channel in no_knowledge.channels)
    assert len(tool.calls) == 1
    assert len(general.calls) == 1

    with pytest.raises(ValueError, match="channels"):
        retriever.retrieve(request, enabled_channels=("source",))  # type: ignore[arg-type]


def test_optimization_retrieval_deduplicates_channel_evidence(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=None,
    )
    tool = _RecordingRetriever("parameter.dreamplace")
    general = _RecordingRetriever("parameter.dreamplace")

    result = OptimizationKnowledgeRetriever(
        tool_retriever=tool, general_retriever=general
    ).retrieve(request)

    assert len(result.knowledge_refs) == 3
    assert result.channels[1].knowledge_refs == ()


def test_default_optimization_retrieval_keeps_tool_and_general_knowledge_separate(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=None,
    )

    result = OptimizationKnowledgeRetriever().retrieve(request)

    tool, general = result.channels
    assert len(tool.knowledge_refs) <= 3
    assert len(general.knowledge_refs) <= 3
    assert all(not ref.entity_id.startswith("strategy.") for ref in tool.knowledge_refs)
    assert all(
        ref.entity_id.startswith(("strategy.congestion.", "strategy.wirelength."))
        for ref in general.knowledge_refs
    )
