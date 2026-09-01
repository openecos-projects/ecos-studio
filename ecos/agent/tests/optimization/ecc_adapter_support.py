from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import (
    ExpectedEffectDirection,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationKnob,
    OptimizationProposal,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
)
from ecos_agent.optimization.ecc.adapter import (
    EccCandidateRerunAdapter,
    EccContentLengthRpcClient,
    OptimizationEccAdapterError,
    _step_render_ack,
)
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.parameters.semantics import load_parameter_cards

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


@dataclass
class _FakeEccRpc:
    candidate_response: dict[str, object]
    terminal_response: dict[str, object] | None = None
    ecc_version: str = "ecc-test-revision"

    def __post_init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        self.calls.append((method, params))
        if method == "rpc.hello":
            return {"eccVersion": self.ecc_version}
        if method == "candidate.rerun":
            return self.candidate_response
        if method == "operation.cancel":
            return {
                "accepted": True,
                "operationId": params["operationId"],
                "state": "running",
            }
        raise AssertionError(f"unexpected RPC method: {method}")

    def wait_for_terminal(
        self,
        operation_id: str,
        timeout_seconds: float,
    ) -> dict[str, object] | None:
        assert operation_id == "operation-1"
        assert timeout_seconds == 60.0
        return self.terminal_response


def _proposal(knob_id: str, direction: StrategyDirection) -> OptimizationProposal:
    return OptimizationProposal.model_validate(
        {
            "context_ref": {
                "episode_id": "episode-1",
                "checkpoint_id": "checkpoint-1",
                "input_sha256": HASH,
            },
            "decision": OptimizationDecision.PROPOSE,
            "reason_code": ProposalReason.OBSERVATION,
            "rationale_summary": "Use one legal placement change.",
            "observation_refs": [
                ObservationReference(
                    observation_id="observation-1", sha256=HASH
                ).model_dump()
            ],
            "knowledge_refs": [
                KnowledgeReference(
                    entity_id="strategy.congestion.padding.v1", chunk_sha256=CHUNK_HASH
                ).model_dump()
            ],
            "action": {
                "knob_id": knob_id,
                "direction": direction,
                "expected_effects": [
                    {
                        "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                        "direction": ExpectedEffectDirection.DECREASE,
                    }
                ],
            },
        }
    )


def _request(
    knob_id: str, value: bool | int | float, direction: StrategyDirection
) -> CandidateExecutionRequest:
    return CandidateExecutionRequest(
        intervention_id="intervention-1",
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        proposal=_proposal(knob_id, direction),
        requested=RequestedKnobValue(knob_id=knob_id, value=value),
        context_sha256=HASH,
        seed=17,
        ecc_revision="ecc-test-revision",
    )


def _running_operation() -> dict[str, object]:
    return {
        "operationId": "operation-1",
        "workspaceId": "workspace-1",
        "state": "queued",
    }


def _candidate_call(rpc: _FakeEccRpc) -> tuple[str, dict[str, object]]:
    return next(call for call in rpc.calls if call[0] == "candidate.rerun")


def _application_receipt_payload(
    *, requested: object = 0.65, written: object = 0.65
) -> dict[str, object]:
    value = {"knobId": "place.target_density", "value": written}
    return {
        "receiptId": "receipt-1",
        "requested": {"knobId": "place.target_density", "value": requested},
        "written": value,
        "effectiveInitial": value,
        "runtimeAdjustments": [],
        "effectiveFinal": value,
        "evidenceSha256": HASH,
    }


def _native_receipt_payload(
    candidate_ref: str,
    materialization: dict[str, object],
    *,
    parent_ref: str | None = None,
) -> dict[str, object]:
    config = materialization["configs"][0]
    snapshot = materialization["snapshots"][0]
    card = load_parameter_cards()[OptimizationKnob.TARGET_DENSITY]
    payload = {
        "schema_version": "tool.parameter_application_receipt.v1",
        "receipt_id": "parameter-receipt-native-1",
        "tool": {
            "name": card.tool.name,
            "revision": card.tool.revision,
            "source_sha256": card.tool.source_sha256,
        },
        "context": {
            "run_id": Path(candidate_ref).name,
            "stage": "place",
            "lattice_version": "ecos.optimization_lattice.v1",
            "context_sha256": HASH,
            "seed": 17,
            "ecc_revision": "ecc-test-revision",
        },
        "requested": {
            "knob_id": "place.target_density",
            "value": 0.65,
            "unit": "ratio",
        },
        "materialization": {
            "receipt_ref": "analysis/candidate_materialization.v1.json",
            "receipt_sha256": materialization["receipt_sha256"],
            "registry_sha256": HASH,
            "patch_sha256": materialization["patch_sha256"],
            "candidate_ref": candidate_ref,
            "parent_ref": parent_ref,
            "workspace_ref": candidate_ref,
            "target_step": "place",
            "config_ref": config["ref"],
            "config_before_sha256": config["before_sha256"],
            "config_after_sha256": config["after_sha256"],
            "before_snapshot_ref": snapshot["before_ref"],
            "before_snapshot_sha256": snapshot["before_sha256"],
            "after_snapshot_ref": snapshot["after_ref"],
            "after_snapshot_sha256": snapshot["after_sha256"],
            "written_value": 0.65,
            "unit": "ratio",
            "parent_manifest_ref": None,
            "parent_manifest_sha256": None,
            "parent_state_sha256": HASH,
        },
        "effective_initial": {"value": 0.65, "unit": "ratio"},
        "transitions": [],
        "application_status": "applied",
        "activation": {
            "status": "used",
            "consumers": [
                {
                    "consumer_id": "dreamplace.density_objective",
                    "outcome": "entered",
                    "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                    "evidence_sha256": canonical_sha256(
                        {
                            "consumer_id": "dreamplace.density_objective",
                            "outcome": "entered",
                            "consumer_observation": {
                                "requested_target_density": 0.65,
                                "effective_target_density": 0.65,
                                "density_tensor_value": 0.65,
                                "placement_iteration_count": 4,
                                "evidence_complete": True,
                            },
                        }
                    ),
                }
            ],
        },
        "consumer_observation": {
            "requested_target_density": 0.65,
            "effective_target_density": 0.65,
            "density_tensor_value": 0.65,
            "placement_iteration_count": 4,
            "evidence_complete": True,
        },
        "effective_final": {"value": 0.65, "unit": "ratio"},
    }
    payload["evidence_sha256"] = canonical_sha256(payload)
    return payload


def _write_candidate_evidence(
    root: Path,
    *,
    parent_ref: str | None = None,
    terminal_state: str = "succeeded",
) -> tuple[dict[str, object], dict[str, object], dict[str, Path]]:
    candidate_ref = ".agent/candidates/candidate-0c4c4b249d945101-intervention-1"
    candidate = root / candidate_ref
    analysis = candidate / "analysis"
    config_path = candidate / "config/dreamplace_ecc.json"
    before_path = (
        analysis
        / "candidate_config_snapshots.v1/candidate-0c4c4b249d945101-intervention-1/dreamplace.before.json"
    )
    after_path = before_path.with_name("dreamplace.after.json")
    for path, payload in (
        (config_path, {"target_density": 0.65}),
        (before_path, {"target_density": 0.6}),
        (after_path, {"target_density": 0.65}),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
    patch = [{"knob_id": "place.target_density", "value": 0.65}]
    materialization = {
        "schema": "ecc.workspace.candidate_materialization.v1",
        "schema_version": 1,
        "candidate_id": candidate.name,
        "target_step": "place",
        "target": {"step": "place"},
        "registry_sha256": HASH,
        "patch": patch,
        "patch_sha256": canonical_sha256(patch),
        "configs": [
            {
                "config_key": "dreamplace",
                "ref": "config/dreamplace_ecc.json",
                "before_sha256": file_sha256(before_path),
                "after_sha256": file_sha256(config_path),
            }
        ],
        "snapshots": [
            {
                "config_key": "dreamplace",
                "before_ref": before_path.relative_to(candidate).as_posix(),
                "before_sha256": file_sha256(before_path),
                "after_ref": after_path.relative_to(candidate).as_posix(),
                "after_sha256": file_sha256(after_path),
            }
        ],
    }
    materialization["receipt_sha256"] = canonical_sha256(materialization)
    materialization_path = analysis / "candidate_materialization.v1.json"
    materialization_path.write_text(json.dumps(materialization), encoding="utf-8")
    native = _native_receipt_payload(
        candidate_ref, materialization, parent_ref=parent_ref
    )
    if parent_ref is not None:
        parent = root / parent_ref
        parent_manifest = parent / "analysis/candidate_workspace.v1.json"
        parent_manifest.parent.mkdir(parents=True, exist_ok=True)
        parent_payload = {
            "schema": "ecc.workspace.candidate_workspace.v1",
            "schema_version": 1,
            "candidate_id": parent.name,
            "candidate_root_ref": parent_ref,
            "parent_candidate_root_ref": None,
            "candidate_flow_sha256": HASH,
            "candidate_state_sha256": HASH,
            "target_step": "place",
            "end_step": "Harden",
            "execution_scope": "full_flow",
            "terminal_state": "succeeded",
        }
        parent_manifest.write_text(json.dumps(parent_payload), encoding="utf-8")
        native["materialization"].update(
            {
                "parent_manifest_ref": parent_manifest.relative_to(root).as_posix(),
                "parent_manifest_sha256": file_sha256(parent_manifest),
                "parent_state_sha256": HASH,
            }
        )
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    receipt_path = analysis / "parameter_application_receipt.v1.json"
    receipt_path.write_text(json.dumps(native), encoding="utf-8")
    manifest = analysis / "candidate_workspace.v1.json"
    manifest_payload = {
        "schema": "ecc.workspace.candidate_workspace.v1",
        "schema_version": 1,
        "candidate_id": candidate.name,
        "candidate_root_ref": candidate_ref,
        "parent_candidate_root_ref": parent_ref,
        "parent_manifest_ref": native["materialization"]["parent_manifest_ref"],
        "parent_manifest_sha256": native["materialization"]["parent_manifest_sha256"],
        "parent_flow_sha256": HASH,
        "parent_state_sha256": HASH,
        "candidate_flow_sha256": HASH,
        "candidate_state_sha256": HASH,
        "terminal_state": terminal_state,
        "target_step": "place",
        "end_step": "Harden",
        "execution_scope": "full_flow",
        "artifacts": {
            "candidate_materialization": {
                "ref": "analysis/candidate_materialization.v1.json",
                "sha256": file_sha256(materialization_path),
            }
        },
    }
    manifest.write_text(json.dumps(manifest_payload), encoding="utf-8")
    evidence = {
        "candidateRootRef": candidate_ref,
        "candidateManifestRef": manifest.relative_to(root).as_posix(),
        "candidateManifestSha256": file_sha256(manifest),
        "targetStep": "place",
        "endStep": "Harden",
        "executionScope": "full_flow",
        "parameterApplicationReceiptRef": receipt_path.relative_to(root).as_posix(),
        "parameterApplicationReceiptSha256": file_sha256(receipt_path),
    }
    return (
        native,
        evidence,
        {
            "manifest": manifest,
            "materialization": materialization_path,
            "config": config_path,
            "before_snapshot": before_path,
            "after_snapshot": after_path,
        },
    )
