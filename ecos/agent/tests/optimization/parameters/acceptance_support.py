from __future__ import annotations

import json
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationKnob,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.parameters.contracts import ParameterSemanticsCard
from ecos_agent.optimization.parameters.semantics import card_hash
from tests.paths import AGENT_ROOT


HASH = "sha256:" + "a" * 64
CARD_PATH = AGENT_ROOT / "knowledge/optimization/place.target_density.json"


def card_for(knob: OptimizationKnob) -> ParameterSemanticsCard:
    path = AGENT_ROOT / f"knowledge/optimization/{knob.value}.json"
    return ParameterSemanticsCard.model_validate_json(path.read_bytes())


def card() -> ParameterSemanticsCard:
    return ParameterSemanticsCard.model_validate_json(CARD_PATH.read_bytes())


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def receipt_hash_payload(receipt: dict) -> dict:
    payload = {key: value for key, value in receipt.items() if key != "evidence_sha256"}
    if payload.get("consumer_observation") is None:
        payload.pop("consumer_observation", None)
    return payload


def write_candidate(
    workspace: Path,
    *,
    knob: OptimizationKnob = OptimizationKnob.TARGET_DENSITY,
    requested_value: float = 0.65,
    written_value: int | float | None = None,
    effective_value: int | float = 0.65,
    requested_unit: str = "ratio",
    written_unit: str = "ratio",
    config_key: str = "dreamplace",
    config_field: str = "target_density",
    consumer_id: str = "dreamplace.density_objective",
    observation_payload: dict | None = None,
    transitions: list[dict] | None = None,
) -> dict[str, Path]:
    candidate_id = "candidate-acceptance-test"
    candidate_ref = f".agent/candidates/{candidate_id}"
    candidate_root = workspace / candidate_ref
    analysis = candidate_root / "analysis"
    materialization_path = analysis / "candidate_materialization.v1.json"
    receipt_path = analysis / "parameter_application_receipt.v1.json"
    runtime_path = analysis / "parameter_runtime_report.v1.json"
    manifest_path = analysis / "candidate_workspace.v1.json"
    replay_path = analysis / "candidate_execution_receipt.v1.json"
    config_path = candidate_root / "config/dreamplace_ecc.json"
    before_snapshot_path = analysis / "snapshots/dreamplace_ecc.before.json"
    after_snapshot_path = analysis / "snapshots/dreamplace_ecc.after.json"
    written = requested_value if written_value is None else written_value
    write_json(before_snapshot_path, {config_field: 0})
    write_json(after_snapshot_path, {config_field: written})
    write_json(config_path, {config_field: written})
    patch = [{"knob_id": knob.value, "value": written}]
    patch_sha256 = canonical_sha256(patch)
    before_sha256 = file_sha256(before_snapshot_path)
    after_sha256 = file_sha256(after_snapshot_path)
    materialization = {
        "schema": "ecc.workspace.candidate_materialization.v1",
        "schema_version": 1,
        "candidate_id": candidate_id,
        "target_step": "place",
        "target": {"step": "place"},
        "registry_sha256": HASH,
        "patch": patch,
        "patch_sha256": patch_sha256,
        "configs": [
            {
                "ref": "config/dreamplace_ecc.json",
                "config_key": config_key,
                "before_sha256": before_sha256,
                "after_sha256": after_sha256,
            }
        ],
        "snapshots": [
            {
                "config_key": config_key,
                "before_ref": "analysis/snapshots/dreamplace_ecc.before.json",
                "before_sha256": before_sha256,
                "after_ref": "analysis/snapshots/dreamplace_ecc.after.json",
                "after_sha256": after_sha256,
            }
        ],
    }
    materialization["receipt_sha256"] = canonical_sha256(materialization)
    write_json(materialization_path, materialization)
    parameter_card = card_for(knob)
    observation = observation_payload or {
        "evidence_complete": True,
        "effective_target_density": effective_value,
        "density_tensor_value": effective_value,
        "density_operator_call_count": 1,
    }
    evidence = {
        "consumer_id": consumer_id,
        "outcome": "entered",
        "evidence_ref": "analysis/parameter_runtime_report.v1.json",
        "evidence_sha256": canonical_sha256(
            {
                "consumer_id": consumer_id,
                "outcome": "entered",
                "consumer_observation": observation,
            }
        ),
    }
    runtime = {
        "tool": parameter_card.tool.model_dump(mode="json"),
        "application_status": "applied",
        "activation": {"status": "used", "consumers": [evidence]},
        "effective_initial": {"value": effective_value, "unit": written_unit},
        "effective_final": {"value": effective_value, "unit": written_unit},
        "transitions": transitions or [],
        "consumer_observation": observation,
    }
    write_json(runtime_path, runtime)
    receipt = {
        "schema_version": "tool.parameter_application_receipt.v1",
        "receipt_id": "parameter-receipt-acceptance-test",
        "tool": parameter_card.tool.model_dump(mode="json"),
        "context": {
            "run_id": candidate_id,
            "stage": "place",
            "lattice_version": "ecos.optimization_lattice.v1",
            "site_width_dbu": 2000,
            "ecc_revision": "ecc-test-revision",
            "parameter_card_sha256": card_hash(parameter_card),
            "context_sha256": HASH,
        },
        "requested": {
            "knob_id": knob.value,
            "value": requested_value,
            "unit": requested_unit,
        },
        "materialization": {
            "receipt_ref": "analysis/candidate_materialization.v1.json",
            "receipt_sha256": materialization["receipt_sha256"],
            "registry_sha256": HASH,
            "patch_sha256": patch_sha256,
            "candidate_ref": candidate_ref,
            "parent_ref": None,
            "workspace_ref": candidate_ref,
            "target_step": "place",
            "config_ref": "config/dreamplace_ecc.json",
            "config_before_sha256": before_sha256,
            "config_after_sha256": after_sha256,
            "before_snapshot_ref": "analysis/snapshots/dreamplace_ecc.before.json",
            "before_snapshot_sha256": before_sha256,
            "after_snapshot_ref": "analysis/snapshots/dreamplace_ecc.after.json",
            "after_snapshot_sha256": after_sha256,
            "written_value": written,
            "unit": written_unit,
            "parent_manifest_ref": None,
            "parent_manifest_sha256": None,
            "parent_state_sha256": HASH,
        },
        "effective_initial": runtime["effective_initial"],
        "transitions": runtime["transitions"],
        "application_status": runtime["application_status"],
        "activation": runtime["activation"],
        "consumer_observation": runtime["consumer_observation"],
        "effective_final": runtime["effective_final"],
    }
    receipt["evidence_sha256"] = canonical_sha256(receipt_hash_payload(receipt))
    write_json(receipt_path, receipt)
    manifest = {
        "schema": "ecc.workspace.candidate_workspace.v1",
        "schema_version": 1,
        "candidate_id": candidate_id,
        "candidate_root_ref": candidate_ref,
        "parent_candidate_root_ref": None,
        "parent_flow_sha256": HASH,
        "parent_state_sha256": HASH,
        "parent_manifest_ref": None,
        "parent_manifest_sha256": None,
        "target_step": "place",
        "end_step": "Harden",
        "execution_scope": "full_flow",
        "terminal_state": "succeeded",
        "candidate_flow_sha256": "sha256:" + "c" * 64,
        "candidate_state_sha256": "sha256:" + "d" * 64,
        "artifacts": {
            "candidate_materialization": {
                "ref": "analysis/candidate_materialization.v1.json",
                "sha256": file_sha256(materialization_path),
            },
            "parameter_application_receipt": {
                "ref": "analysis/parameter_application_receipt.v1.json",
                "sha256": file_sha256(receipt_path),
            },
            "parameter_runtime_report": {
                "ref": "analysis/parameter_runtime_report.v1.json",
                "sha256": file_sha256(runtime_path),
            },
        },
    }
    write_json(manifest_path, manifest)
    replay = {
        "schema": "ecc.candidate_execution_receipt.v1",
        "candidate_id": candidate_id,
        "candidate_root_ref": candidate_ref,
        "parent_candidate_root_ref": None,
        "parent_flow_sha256": HASH,
        "parent_state_sha256": HASH,
        "target_step": "place",
        "end_step": "Harden",
        "execution_scope": "full_flow",
        "candidate_manifest_sha256": file_sha256(manifest_path),
    }
    write_json(replay_path, replay)
    return {
        "manifest": manifest_path,
        "receipt": receipt_path,
        "runtime": runtime_path,
        "replay": replay_path,
    }


def terminal(*, eligible: bool = True) -> TerminalObservation:
    positive = {
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "sta_corner_count",
        "sta_expected_corner_count",
    }
    metric_ids = (
        "drc_count",
        "lvs_count",
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "rcx_missing_corner_count",
        "rcx_spef_parse_failure_count",
        "sta_corner_count",
        "sta_expected_corner_count",
        "sta_missing_corner_count",
        "sta_setup_violation_count",
        "sta_hold_violation_count",
        "harden_artifact_missing_count",
    )
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id="terminal-acceptance-test",
        evidence_manifest_sha256=HASH,
        evidence_valid=eligible,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 100,
        },
        timing_guardrail={metric: 0 for metric in TimingMetric},
        evaluation_metrics=tuple(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=1 if metric_id in positive else 0,
                unit="count",
                category=EvaluationMetricCategory.ELIGIBILITY,
                role=EvaluationMetricRole.GATE,
                direction=EvaluationMetricDirection.EXACT,
                source_refs=("analysis/terminal.json",),
            )
            for metric_id in metric_ids
        ),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )
