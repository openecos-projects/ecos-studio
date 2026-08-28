from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import (
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
from ecos_agent.optimization_controller import (
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
)
from ecos_agent.optimization_ecc_adapter import (
    EccCandidateRerunAdapter,
    EccContentLengthRpcClient,
    OptimizationEccAdapterError,
    _step_render_ack,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.parameter_semantics import load_parameter_cards

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


@dataclass
class _FakeEccRpc:
    candidate_response: dict[str, object]
    terminal_response: dict[str, object] | None = None

    def __post_init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        self.calls.append((method, params))
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
    )


def _running_operation() -> dict[str, object]:
    return {
        "operationId": "operation-1",
        "workspaceId": "workspace-1",
        "state": "queued",
    }


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
        },
        "requested": {"knob_id": "place.target_density", "value": 0.65, "unit": "ratio"},
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
            "consumers": [{
                "consumer_id": "dreamplace.density_objective",
                "outcome": "entered",
                "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                "evidence_sha256": HASH,
            }],
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
    before_path = analysis / "candidate_config_snapshots.v1/candidate-0c4c4b249d945101-intervention-1/dreamplace.before.json"
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
        "configs": [{
            "config_key": "dreamplace",
            "ref": "config/dreamplace_ecc.json",
            "before_sha256": file_sha256(before_path),
            "after_sha256": file_sha256(config_path),
        }],
        "snapshots": [{
            "config_key": "dreamplace",
            "before_ref": before_path.relative_to(candidate).as_posix(),
            "before_sha256": file_sha256(before_path),
            "after_ref": after_path.relative_to(candidate).as_posix(),
            "after_sha256": file_sha256(after_path),
        }],
    }
    materialization["receipt_sha256"] = canonical_sha256(materialization)
    materialization_path = analysis / "candidate_materialization.v1.json"
    materialization_path.write_text(json.dumps(materialization), encoding="utf-8")
    native = _native_receipt_payload(candidate_ref, materialization, parent_ref=parent_ref)
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
        native["materialization"].update({
            "parent_manifest_ref": parent_manifest.relative_to(root).as_posix(),
            "parent_manifest_sha256": file_sha256(parent_manifest),
            "parent_state_sha256": HASH,
        })
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
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
    }
    return native, evidence, {
        "manifest": manifest,
        "materialization": materialization_path,
        "config": config_path,
        "before_snapshot": before_path,
        "after_snapshot": after_path,
    }


def test_adapter_starts_only_fixed_full_flow_candidate_rerun() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.start(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )

    assert receipt.execution_id == "operation-1"
    assert receipt.started is True
    assert receipt.outcome is None
    assert rpc.calls == [
        (
            "candidate.rerun",
            {
                "workspaceId": "workspace-1",
                "targetStep": "place",
                "endStep": "Harden",
                "candidateId": "candidate-0c4c4b249d945101-intervention-1",
                "patch": [{"knob_id": "place.target_density", "value": 0.65}],
                "executionScope": "full_flow",
                "idempotencyKey": "episode-1.intervention-1",
                "contextSha256": HASH,
            },
        )
    ]


@pytest.mark.parametrize(
    "knob_id,value,direction,target_step",
    [
        ("floorplan.core_util", 0.6, StrategyDirection.INCREASE, "Floorplan"),
        ("floorplan.aspect_ratio", 1.33, StrategyDirection.INCREASE, "Floorplan"),
        ("synth.max_fanout", 24, StrategyDirection.DECREASE, "fixFanout"),
        ("place.target_overflow", 0.08, StrategyDirection.DECREASE, "place"),
        ("place.density_weight", 0.001, StrategyDirection.INCREASE, "place"),
    ],
)
def test_adapter_routes_each_knob_from_its_own_stage(
    knob_id: str,
    value: int | float,
    direction: StrategyDirection,
    target_step: str,
) -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(_request(knob_id, value, direction))

    assert rpc.calls[0][1]["targetStep"] == target_step
    assert rpc.calls[0][1]["endStep"] == "Harden"
    assert rpc.calls[0][1]["patch"] == [{"knob_id": knob_id, "value": value}]


def test_adapter_reruns_from_the_incumbent_candidate_workspace() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(
        replace(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE),
            parent_candidate_root_ref=".agent/candidates/candidate-1",
        )
    )

    assert rpc.calls[0][1]["parentCandidateRootRef"] == ".agent/candidates/candidate-1"


def test_adapter_sends_padding_in_surface_sites_for_l1_materialization() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(_request("place.cell_padding_x", 2, StrategyDirection.INCREASE))

    assert rpc.calls[0][1]["patch"] == [
        {"knob_id": "place.cell_padding_x", "value": 2}
    ]


def test_adapter_rejects_mismatched_request_or_foreign_operation() -> None:
    rpc = _FakeEccRpc({**_running_operation(), "workspaceId": "other-workspace"})
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(OptimizationEccAdapterError, match="workspace"):
        adapter.start(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE)
        )

    mismatch = _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    mismatch = CandidateExecutionRequest(
        intervention_id=mismatch.intervention_id,
        episode_id=mismatch.episode_id,
        checkpoint_id=mismatch.checkpoint_id,
        proposal=mismatch.proposal,
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=2),
        context_sha256=HASH,
    )
    with pytest.raises(OptimizationEccAdapterError, match="knob"):
        EccCandidateRerunAdapter(
            _FakeEccRpc(_running_operation()),
            workspace_id="workspace-1",
            site_width_dbu=200,
        ).start(mismatch)

    with pytest.raises(OptimizationEccAdapterError, match="request id"):
        EccCandidateRerunAdapter(
            _FakeEccRpc(_running_operation()),
            workspace_id="workspace-1",
            site_width_dbu=200,
        ).start(
            replace(
                _request("place.target_density", 0.65, StrategyDirection.INCREASE),
                episode_id="..",
            )
        )

    with pytest.raises(OptimizationEccAdapterError, match="context hash"):
        EccCandidateRerunAdapter(
            _FakeEccRpc(_running_operation()),
            workspace_id="workspace-1",
            site_width_dbu=200,
        ).start(
            replace(
                _request("place.target_density", 0.65, StrategyDirection.INCREASE),
                context_sha256="sha256:invalid",
            )
        )


def test_adapter_rejects_application_receipt_from_foreign_context(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path)
    native["context"]["context_sha256"] = "sha256:" + "b" * 64
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    with pytest.raises(OptimizationEccAdapterError, match="context does not match"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_waits_for_terminal_cancel_receipt() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "cancelled",
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.cancel("operation-1")

    assert receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED
    assert rpc.calls == [("operation.cancel", {"operationId": "operation-1"})]


def test_adapter_waits_for_successful_terminal_without_claiming_qor_outcome() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt == CandidateExecutionReceipt(
        execution_id="operation-1",
        started=True,
        outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
    )


def test_adapter_retains_valid_candidate_manifest_evidence() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {
                "candidateRootRef": ".agent/candidates/candidate-0c4c4b249d945101-intervention-1",
                "candidateManifestRef": (
                    ".agent/candidates/candidate-0c4c4b249d945101-intervention-1/analysis/candidate_workspace.v1.json"
                ),
                "candidateManifestSha256": HASH,
            },
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.evidence is not None
    assert receipt.evidence.candidate_manifest_sha256 == HASH
    assert receipt.outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED


def test_adapter_binds_and_returns_effective_value_receipt() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {"knobApplicationReceipt": _application_receipt_payload()},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))
    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.parameter_application_receipt is None


def test_adapter_binds_native_receipt_to_candidate_materialization(
    tmp_path: Path,
) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path)
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.parameter_application_receipt is not None


def test_adapter_binds_candidate_parent_manifest(tmp_path: Path) -> None:
    parent_ref = ".agent/candidates/incumbent-1"
    native, evidence, _ = _write_candidate_evidence(tmp_path, parent_ref=parent_ref)
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(
        replace(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE),
            parent_candidate_root_ref=parent_ref,
        )
    )

    assert adapter.wait_for_terminal("operation-1").parameter_application_receipt


def test_adapter_retains_l1_l2_evidence_on_failed_terminal(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path, terminal_state="failed")
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "failed",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.outcome == OptimizationOutcomeKind.EXECUTION_FAILED
    assert receipt.evidence is not None
    assert receipt.parameter_application_receipt is not None


def test_adapter_retains_l1_l2_evidence_on_cancelled_terminal(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path, terminal_state="succeeded")
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "cancelled",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED
    assert receipt.evidence is not None
    assert receipt.parameter_application_receipt is not None


def test_adapter_rejects_parent_flow_hash_drift(tmp_path: Path) -> None:
    parent_ref = ".agent/candidates/incumbent-1"
    native, evidence, paths = _write_candidate_evidence(tmp_path, parent_ref=parent_ref)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["parent_flow_sha256"] = "sha256:" + "b" * 64
    paths["manifest"].write_text(json.dumps(manifest), encoding="utf-8")
    evidence["candidateManifestSha256"] = file_sha256(paths["manifest"])
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(
        replace(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE),
            parent_candidate_root_ref=parent_ref,
        )
    )

    with pytest.raises(OptimizationEccAdapterError, match="parent manifest"):
        adapter.wait_for_terminal("operation-1")


@pytest.mark.parametrize(
    ("artifact", "key"),
    [
        ("manifest", "artifacts"),
        ("materialization", "configs"),
        ("materialization", "snapshots"),
        ("materialization", "registry_sha256"),
        ("receipt", "config_ref"),
        ("receipt", "before_snapshot_ref"),
        ("receipt", "target_step"),
    ],
)
def test_adapter_fails_closed_when_l1_binding_field_is_missing(
    tmp_path: Path, artifact: str, key: str
) -> None:
    native, evidence, paths = _write_candidate_evidence(tmp_path)
    if artifact == "receipt":
        del native["materialization"][key]
        native["evidence_sha256"] = canonical_sha256(
            {item: value for item, value in native.items() if item != "evidence_sha256"}
        )
    else:
        path = paths[artifact]
        payload = json.loads(path.read_text(encoding="utf-8"))
        del payload[key]
        path.write_text(json.dumps(payload), encoding="utf-8")
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    with pytest.raises(OptimizationEccAdapterError):
        adapter.wait_for_terminal("operation-1")


@pytest.mark.parametrize("artifact", ["config", "before_snapshot", "after_snapshot"])
def test_adapter_rejects_tampered_l1_files(tmp_path: Path, artifact: str) -> None:
    native, evidence, paths = _write_candidate_evidence(tmp_path)
    paths[artifact].write_text("{}", encoding="utf-8")
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    with pytest.raises(OptimizationEccAdapterError):
        adapter.wait_for_terminal("operation-1")


def test_adapter_rejects_foreign_candidate_even_when_receipts_agree(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path)
    evidence["candidateRootRef"] = ".agent/candidates/foreign"
    native["materialization"]["candidate_ref"] = evidence["candidateRootRef"]
    native["materialization"]["workspace_ref"] = evidence["candidateRootRef"]
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {**evidence, "parameterApplicationReceipt": native},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200, workspace_root=tmp_path
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    with pytest.raises(OptimizationEccAdapterError, match="candidate reference"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_does_not_build_a_missing_success_receipt_from_candidate_artifacts(
    tmp_path: Path,
) -> None:
    terminal = {
        "operationId": "operation-1",
        "workspaceId": "workspace-1",
        "state": "succeeded",
        "result": {
            "candidateRootRef": ".agent/candidates/candidate-1",
            "candidateManifestRef": (
                ".agent/candidates/candidate-1/analysis/candidate_workspace.v1.json"
            ),
            "candidateManifestSha256": HASH,
        },
    }
    rpc = _FakeEccRpc(_running_operation(), terminal_response=terminal)
    adapter = EccCandidateRerunAdapter(
        rpc,
        workspace_id="workspace-1",
        site_width_dbu=200,
        workspace_root=tmp_path,
    )

    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))
    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.parameter_application_receipt is None


def test_adapter_rejects_an_application_receipt_with_wrong_request_or_written_value() -> None:
    for payload in (
        _application_receipt_payload(requested=0.7),
        _application_receipt_payload(written=0.7),
    ):
        rpc = _FakeEccRpc(
            _running_operation(),
            terminal_response={
                "operationId": "operation-1",
                "workspaceId": "workspace-1",
                "state": "succeeded",
                "result": {"knobApplicationReceipt": payload},
            },
        )
        adapter = EccCandidateRerunAdapter(
            rpc, workspace_id="workspace-1", site_width_dbu=200
        )
        adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))
        receipt = adapter.wait_for_terminal("operation-1")
        assert receipt.parameter_application_receipt is None


def test_adapter_rejects_a_malformed_application_receipt() -> None:
    payload = _application_receipt_payload()
    del payload["effectiveFinal"]
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {"knobApplicationReceipt": payload},
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    receipt = adapter.wait_for_terminal("operation-1")
    assert receipt.parameter_application_receipt is None


def test_adapter_rejects_terminal_execution_contract_drift() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {
                "targetStep": "Floorplan",
                "endStep": "Harden",
                "executionScope": "full_flow",
            },
        },
    )
    adapter = EccCandidateRerunAdapter(rpc, workspace_id="workspace-1", site_width_dbu=200)
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    with pytest.raises(OptimizationEccAdapterError, match="execution contract"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_rejects_absolute_candidate_evidence_reference() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": "succeeded",
            "result": {
                "candidateRootRef": "/tmp/candidate",
                "candidateManifestRef": "/tmp/candidate/manifest.json",
                "candidateManifestSha256": HASH,
            },
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(OptimizationEccAdapterError, match="evidence"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_rejects_foreign_terminal_operation() -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "other-workspace",
            "state": "failed",
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    with pytest.raises(OptimizationEccAdapterError, match="workspace"):
        adapter.wait_for_terminal("operation-1")


@pytest.mark.parametrize(
    ("state", "outcome"),
    [
        ("failed", OptimizationOutcomeKind.EXECUTION_FAILED),
        ("cancelled", OptimizationOutcomeKind.TIMED_OUT_CANCELLED),
    ],
)
def test_adapter_classifies_terminal_execution_outcomes(
    state: str, outcome: OptimizationOutcomeKind
) -> None:
    rpc = _FakeEccRpc(
        _running_operation(),
        terminal_response={
            "operationId": "operation-1",
            "workspaceId": "workspace-1",
            "state": state,
        },
    )
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.wait_for_terminal("operation-1")

    assert receipt.outcome == outcome


def test_adapter_leaves_missing_cancel_receipt_indeterminate_to_controller() -> None:
    rpc = _FakeEccRpc(_running_operation())
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.cancel("operation-1")

    assert receipt.started is True
    assert receipt.outcome is None


def test_adapter_classifies_an_immediate_execution_failure() -> None:
    rpc = _FakeEccRpc({**_running_operation(), "state": "failed"})
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )

    receipt = adapter.start(
        _request("place.target_density", 0.65, StrategyDirection.INCREASE)
    )

    assert receipt.outcome == OptimizationOutcomeKind.EXECUTION_FAILED


def test_step_completed_event_has_one_fixed_render_ack() -> None:
    assert _step_render_ack(
        {
            "type": "step.completed",
            "eventId": "event-1",
            "operationId": "operation-1",
            "payload": {
                "state": "Success",
                "stepCommitId": "operation-1:step:1",
                "workspaceRevision": 1,
            },
        }
    ) == {
        "operationId": "operation-1",
        "eventId": "event-1",
        "stepCommitId": "operation-1:step:1",
        "workspaceRevision": 1,
    }
    assert (
        _step_render_ack(
            {
                "type": "step.completed",
                "eventId": "event-1",
                "operationId": "operation-1",
                "payload": {"state": "Failed"},
            }
        )
        is None
    )


def test_stdio_client_requires_an_absolute_executable_path(tmp_path) -> None:
    executable = tmp_path / "ecc"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)

    with pytest.raises(OptimizationEccAdapterError, match="absolute"):
        EccContentLengthRpcClient(Path("ecc"))

    client = EccContentLengthRpcClient(executable)

    assert client.command == (str(executable), "rpc", "serve", "--stdio", "--agent")


def test_stdio_client_acknowledges_successful_step_events(tmp_path: Path) -> None:
    acknowledgement = tmp_path / "ack.json"
    executable = tmp_path / "fake-ecc"
    executable.write_text(
        f"""#!{sys.executable}
import json
from pathlib import Path
import sys

def read_frame():
    header = b''
    while not header.endswith(b'\\r\\n\\r\\n'):
        header += sys.stdin.buffer.read(1)
    length = int(header.split(b':', 1)[1].split(b'\\r\\n', 1)[0])
    return json.loads(sys.stdin.buffer.read(length))

def write_frame(payload):
    body = json.dumps(payload).encode()
    sys.stdout.buffer.write(b'Content-Length: %d\\r\\n\\r\\n' % len(body) + body)
    sys.stdout.buffer.flush()

request = read_frame()
write_frame({{"jsonrpc": "2.0", "method": "runtime.event", "params": {{
    "type": "step.completed", "eventId": "event-1", "operationId": "operation-1",
    "payload": {{"state": "Success", "stepCommitId": "operation-1:step:1", "workspaceRevision": 1}},
}}}})
write_frame({{"jsonrpc": "2.0", "id": request["id"], "result": {{"operationId": "operation-1", "state": "running"}}}})
Path({str(acknowledgement)!r}).write_text(json.dumps(read_frame()), encoding="utf-8")
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)

    assert (
        client.call("operation.status", {"operationId": "operation-1"})["state"]
        == "running"
    )
    for _ in range(20):
        if acknowledgement.exists():
            break
        time.sleep(0.01)
    client.close()

    assert json.loads(acknowledgement.read_text(encoding="utf-8")) == {
        "jsonrpc": "2.0",
        "method": "operation.ack_step_rendered",
        "params": {
            "operationId": "operation-1",
            "eventId": "event-1",
            "stepCommitId": "operation-1:step:1",
            "workspaceRevision": 1,
        },
    }


def test_stdio_client_reports_safe_ecc_rejection_details(tmp_path: Path) -> None:
    executable = tmp_path / "fake-ecc"
    executable.write_text(
        f"""#!{sys.executable}
import json
import sys

header = b''
while not header.endswith(b'\\r\\n\\r\\n'):
    header += sys.stdin.buffer.read(1)
length = int(header.split(b':', 1)[1].split(b'\\r\\n', 1)[0])
request = json.loads(sys.stdin.buffer.read(length))
payload = json.dumps({{
    "jsonrpc": "2.0",
    "id": request["id"],
    "error": {{
        "code": -32602,
        "message": "invalid_request",
        "data": {{"message": "operation not found: operation-1"}},
    }},
}}).encode()
sys.stdout.buffer.write(b"Content-Length: %d\\r\\n\\r\\n" % len(payload) + payload)
sys.stdout.buffer.flush()
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    client = EccContentLengthRpcClient(executable)

    with pytest.raises(OptimizationEccAdapterError, match="operation not found"):
        client.call("operation.status", {"operationId": "operation-1"})

    client.close()
