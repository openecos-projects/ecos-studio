from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from ecos_agent.hashing import (
    canonical_sha256,
    file_sha256,
)
from ecos_agent.optimization.contracts import StrategyDirection
from ecos_agent.optimization.controller import CandidateExecutionReceipt
from ecos_agent.optimization.ecc.adapter import (
    EccCandidateRerunAdapter,
    OptimizationEccAdapterError,
)
from ecos_agent.optimization.ecc.evidence import (
    _same_numeric_value,
    _validate_l1_files,
    _validate_l1_payload,
)
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt

from tests.optimization.ecc_adapter_support import (
    HASH,
    _FakeEccRpc,
    _application_receipt_payload,
    _request,
    _running_operation,
    _write_candidate_evidence,
)

def test_adapter_rejects_application_receipt_from_foreign_context(
    tmp_path: Path,
) -> None:
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


def test_adapter_rejects_application_receipt_from_foreign_parameter_card(
    tmp_path: Path,
) -> None:
    native, evidence, paths = _write_candidate_evidence(tmp_path)
    native["context"]["parameter_card_sha256"] = "sha256:" + "b" * 64
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    receipt_path = paths["manifest"].with_name("parameter_application_receipt.v1.json")
    receipt_path.write_text(json.dumps(native), encoding="utf-8")
    evidence["parameterApplicationReceiptSha256"] = file_sha256(receipt_path)
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

    with pytest.raises(OptimizationEccAdapterError, match="parameter card"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_rejects_application_receipt_from_foreign_seed(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path)
    native["context"]["seed"] = 18
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

    with pytest.raises(OptimizationEccAdapterError, match="seed"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_rejects_application_receipt_without_ref_hash(tmp_path: Path) -> None:
    native, evidence, _ = _write_candidate_evidence(tmp_path)
    del evidence["parameterApplicationReceiptSha256"]
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

    with pytest.raises(OptimizationEccAdapterError, match="receipt reference"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_requires_workspace_root_to_verify_receipt_file(tmp_path: Path) -> None:
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
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )
    adapter.start(_request("place.target_density", 0.65, StrategyDirection.INCREASE))

    with pytest.raises(OptimizationEccAdapterError, match="workspace"):
        adapter.wait_for_terminal("operation-1")


def test_adapter_accepts_receipt_file_with_transition_alias(tmp_path: Path) -> None:
    native, evidence, paths = _write_candidate_evidence(tmp_path)
    native["transitions"] = [
        {
            "sequence": 0,
            "from": "materialized",
            "to": "applied",
            "value": 0.65,
            "reason": "alias regression coverage",
            "evidence_ref": "analysis/parameter_runtime_report.v1.json",
            "evidence_sha256": HASH,
        }
    ]
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    receipt_path = paths["manifest"].with_name("parameter_application_receipt.v1.json")
    receipt_path.write_text(json.dumps(native), encoding="utf-8")
    evidence["parameterApplicationReceiptSha256"] = file_sha256(receipt_path)
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
    assert (
        receipt.parameter_application_receipt.transitions[0].from_state
        == "materialized"
    )


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


def test_l1_evidence_reads_canonical_workspace_parameters_toml(tmp_path: Path) -> None:
    native, _evidence, _paths = _write_candidate_evidence(tmp_path)
    candidate = tmp_path / native["materialization"]["candidate_ref"]
    config = candidate / "home/params.toml"
    before = candidate / "analysis/params.before.toml"
    after = candidate / "analysis/params.after.toml"
    for path, value in ((before, 0.4), (config, 0.65), (after, 0.65)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"[params.core]\nutilitization = {value}\n", encoding="utf-8"
        )
    materialization = native["materialization"]
    materialization.update(
        {
            "config_ref": "home/params.toml",
            "config_before_sha256": file_sha256(before),
            "config_after_sha256": file_sha256(config),
            "before_snapshot_ref": before.relative_to(candidate).as_posix(),
            "before_snapshot_sha256": file_sha256(before),
            "after_snapshot_ref": after.relative_to(candidate).as_posix(),
            "after_snapshot_sha256": file_sha256(after),
            "written_value": 0.65,
        }
    )
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    receipt = ParameterApplicationReceipt.model_validate(native)
    payload = {
        "configs": [
            {
                "config_key": "parameters",
                "ref": "home/params.toml",
                "before_sha256": file_sha256(before),
                "after_sha256": file_sha256(config),
            }
        ],
        "snapshots": [
            {
                "config_key": "parameters",
                "before_ref": before.relative_to(candidate).as_posix(),
                "before_sha256": file_sha256(before),
                "after_ref": after.relative_to(candidate).as_posix(),
                "after_sha256": file_sha256(after),
            }
        ],
    }

    _validate_l1_files(candidate, payload, receipt, ("core", "utilitization"))


@pytest.mark.parametrize("requested", (0, 1))
def test_l1_payload_accepts_native_float_for_integer_request(
    tmp_path: Path, requested: int
) -> None:
    native, _evidence, paths = _write_candidate_evidence(tmp_path)
    materialization_path = paths["materialization"]
    materialization = json.loads(materialization_path.read_text(encoding="utf-8"))
    materialization["patch"][0]["knob_id"] = "place.target_overflow"
    materialization["patch"][0]["value"] = float(requested)
    materialization["patch_sha256"] = canonical_sha256(materialization["patch"])
    materialization["receipt_sha256"] = canonical_sha256(
        {key: value for key, value in materialization.items() if key != "receipt_sha256"}
    )
    materialization_path.write_text(json.dumps(materialization), encoding="utf-8")
    native["materialization"]["patch_sha256"] = materialization["patch_sha256"]
    native["materialization"]["receipt_sha256"] = materialization["receipt_sha256"]
    native["materialization"]["written_value"] = float(requested)
    native["requested"]["knob_id"] = "place.target_overflow"
    native["requested"]["value"] = float(requested)
    native["effective_initial"]["value"] = float(requested)
    native["effective_final"]["value"] = float(requested)
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    receipt = ParameterApplicationReceipt.model_validate(native)
    candidate = tmp_path / native["materialization"]["candidate_ref"]

    _validate_l1_payload(
        materialization,
        receipt,
        candidate.name,
        "place.target_overflow",
        requested,
        "place",
        "config/dreamplace_ecc.json",
    )


def test_numeric_receipt_comparison_does_not_alias_booleans_and_integers() -> None:
    assert _same_numeric_value(1, 1.0)
    assert not _same_numeric_value(True, 1)


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
    native, evidence, _ = _write_candidate_evidence(
        tmp_path, terminal_state="succeeded"
    )
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


def test_adapter_rejects_foreign_candidate_even_when_receipts_agree(
    tmp_path: Path,
) -> None:
    native, evidence, paths = _write_candidate_evidence(tmp_path)
    evidence["candidateRootRef"] = ".agent/candidates/foreign"
    native["materialization"]["candidate_ref"] = evidence["candidateRootRef"]
    native["materialization"]["workspace_ref"] = evidence["candidateRootRef"]
    native["evidence_sha256"] = canonical_sha256(
        {key: value for key, value in native.items() if key != "evidence_sha256"}
    )
    receipt_path = paths["manifest"].with_name("parameter_application_receipt.v1.json")
    receipt_path.write_text(json.dumps(native), encoding="utf-8")
    evidence["parameterApplicationReceiptSha256"] = file_sha256(receipt_path)
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


def test_adapter_rejects_an_application_receipt_with_wrong_request_or_written_value() -> (
    None
):
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
        adapter.start(
            _request("place.target_density", 0.65, StrategyDirection.INCREASE)
        )
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
    adapter = EccCandidateRerunAdapter(
        rpc, workspace_id="workspace-1", site_width_dbu=200
    )
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
