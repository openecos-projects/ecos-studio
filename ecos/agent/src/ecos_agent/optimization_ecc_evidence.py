"""Validate ECC candidate artifacts returned across the optimization RPC boundary."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import OptimizationKnob, RequestedKnobValue
from ecos_agent.optimization_execution import (
    CANDIDATE_END_STEP,
    CANDIDATE_EXECUTION_SCOPE,
    CandidateExecutionEvidence,
)
from ecos_agent.parameter_evidence_contracts import MaterializationRef, ParameterApplicationReceipt

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})


class OptimizationEccAdapterError(RuntimeError):
    """The fixed ECC execution contract was not satisfied."""


def validate_candidate_artifacts(
    *,
    workspace_root: Path | None,
    site_width_dbu: int,
    receipt: ParameterApplicationReceipt,
    requested: RequestedKnobValue,
    evidence: CandidateExecutionEvidence | None,
    candidate_ref: str,
    parent_ref: str | None,
    terminal_state: str,
    target_step: str,
    config_ref: str,
    config_json_path: tuple[str | int, ...],
) -> None:
    if workspace_root is None:
        raise OptimizationEccAdapterError("application receipt workspace is unavailable")
    if evidence is None:
        raise OptimizationEccAdapterError("application receipt has no candidate evidence")
    materialization = receipt.materialization
    if (
        materialization.candidate_ref != candidate_ref
        or evidence.candidate_root_ref != candidate_ref
    ):
        raise OptimizationEccAdapterError("application receipt candidate reference does not match")
    if materialization.workspace_ref != candidate_ref:
        raise OptimizationEccAdapterError("application receipt workspace reference does not match")
    if materialization.parent_ref != parent_ref:
        raise OptimizationEccAdapterError("application receipt parent reference does not match")
    if materialization.target_step != target_step:
        raise OptimizationEccAdapterError("application receipt target step does not match")
    try:
        candidate = _safe_path(workspace_root, candidate_ref, directory=True)
        manifest_path = _safe_path(workspace_root, evidence.candidate_manifest_ref)
        manifest_path.relative_to(candidate)
        manifest = _read_json_object(manifest_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationEccAdapterError(
            "application receipt materialization is unavailable"
        ) from exc
    if file_sha256(manifest_path) != evidence.candidate_manifest_sha256:
        raise OptimizationEccAdapterError(
            "application receipt candidate manifest hash does not match"
        )
    _validate_candidate_manifest(
        manifest,
        evidence,
        candidate.name,
        candidate_ref,
        parent_ref,
        target_step,
        terminal_state,
    )
    if receipt.context.get("run_id") != candidate.name:
        raise OptimizationEccAdapterError("application receipt context does not match candidate")
    written_value: object = requested.value
    if requested.knob_id == OptimizationKnob.CELL_PADDING_X:
        written_value = requested.value * site_width_dbu
    _validate_l1_artifact(
        candidate,
        manifest,
        receipt,
        requested.knob_id.value,
        written_value,
        target_step,
        config_ref,
        config_json_path,
    )
    _validate_parent_binding(workspace_root, manifest, materialization, parent_ref)


def _validate_candidate_manifest(
    manifest: Mapping[str, object],
    evidence: CandidateExecutionEvidence,
    candidate_id: str,
    candidate_ref: str,
    parent_ref: str | None,
    target_step: str,
    terminal_state: str,
) -> None:
    expected = {
        "schema": "ecc.workspace.candidate_workspace.v1",
        "schema_version": 1,
        "candidate_id": candidate_id,
        "candidate_root_ref": candidate_ref,
        "parent_candidate_root_ref": parent_ref,
        "target_step": target_step,
        "end_step": CANDIDATE_END_STEP,
        "execution_scope": CANDIDATE_EXECUTION_SCOPE,
    }
    allowed_terminal_states = (
        _TERMINAL_STATES if terminal_state == "cancelled" else {terminal_state}
    )
    if any(manifest.get(key) != value for key, value in expected.items()) or manifest.get(
        "terminal_state"
    ) not in allowed_terminal_states:
        raise OptimizationEccAdapterError("application receipt candidate manifest is invalid")
    if evidence.candidate_manifest_ref != f"{candidate_ref}/analysis/candidate_workspace.v1.json":
        raise OptimizationEccAdapterError(
            "application receipt candidate manifest reference is invalid"
        )
    if (evidence.target_step, evidence.end_step, evidence.execution_scope) != (
        target_step,
        CANDIDATE_END_STEP,
        CANDIDATE_EXECUTION_SCOPE,
    ):
        raise OptimizationEccAdapterError("application receipt candidate evidence is incomplete")
    hashes = (
        manifest.get("parent_flow_sha256"),
        manifest.get("parent_state_sha256"),
        manifest.get("candidate_flow_sha256"),
        manifest.get("candidate_state_sha256"),
    )
    if any(not isinstance(value, str) or not _SHA256.fullmatch(value) for value in hashes):
        raise OptimizationEccAdapterError("application receipt candidate manifest is incomplete")


def _validate_l1_artifact(
    candidate: Path,
    manifest: Mapping[str, object],
    receipt: ParameterApplicationReceipt,
    knob_id: str,
    written_value: object,
    target_step: str,
    expected_config_ref: str,
    config_json_path: tuple[str | int, ...],
) -> None:
    materialization = receipt.materialization
    if materialization.receipt_ref != "analysis/candidate_materialization.v1.json":
        raise OptimizationEccAdapterError(
            "application receipt materialization reference is invalid"
        )
    try:
        path = _safe_path(candidate, materialization.receipt_ref)
        payload = _read_json_object(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationEccAdapterError(
            "application receipt materialization is unavailable"
        ) from exc
    artifacts = manifest.get("artifacts")
    artifact = (
        artifacts.get("candidate_materialization")
        if isinstance(artifacts, Mapping)
        else None
    )
    if not isinstance(artifact, Mapping) or artifact != {
        "ref": materialization.receipt_ref,
        "sha256": file_sha256(path),
    }:
        raise OptimizationEccAdapterError(
            "application receipt materialization manifest is invalid"
        )
    _validate_l1_payload(
        payload,
        receipt,
        candidate.name,
        knob_id,
        written_value,
        target_step,
        expected_config_ref,
    )
    _validate_l1_files(candidate, payload, receipt, config_json_path)


def _validate_l1_payload(
    payload: Mapping[str, object],
    receipt: ParameterApplicationReceipt,
    candidate_id: str,
    knob_id: str,
    written_value: object,
    target_step: str,
    expected_config_ref: str,
) -> None:
    materialization = receipt.materialization
    digest_payload = {key: value for key, value in payload.items() if key != "receipt_sha256"}
    patch = [{"knob_id": knob_id, "value": written_value}]
    if (
        payload.get("schema") != "ecc.workspace.candidate_materialization.v1"
        or payload.get("schema_version") != 1
        or payload.get("candidate_id") != candidate_id
        or payload.get("target_step") != target_step
        or payload.get("target") != {"step": target_step}
        or payload.get("patch") != patch
        or payload.get("patch_sha256") != canonical_sha256(patch)
        or payload.get("patch_sha256") != materialization.patch_sha256
        or payload.get("registry_sha256") != materialization.registry_sha256
        or payload.get("receipt_sha256") != materialization.receipt_sha256
        or canonical_sha256(digest_payload) != materialization.receipt_sha256
        or materialization.written_value != written_value
        or materialization.config_ref != expected_config_ref
    ):
        raise OptimizationEccAdapterError("application receipt materialization is invalid")


def _validate_l1_files(
    candidate: Path,
    payload: Mapping[str, object],
    receipt: ParameterApplicationReceipt,
    config_json_path: tuple[str | int, ...],
) -> None:
    configs, snapshots = payload.get("configs"), payload.get("snapshots")
    if not isinstance(configs, list) or len(configs) != 1:
        raise OptimizationEccAdapterError("application receipt materialization config is invalid")
    if not isinstance(snapshots, list) or len(snapshots) != 1:
        raise OptimizationEccAdapterError("application receipt materialization snapshot is invalid")
    config, snapshot = configs[0], snapshots[0]
    if not isinstance(config, Mapping) or not isinstance(snapshot, Mapping):
        raise OptimizationEccAdapterError("application receipt materialization files are invalid")
    materialization = receipt.materialization
    expected_config = {
        "ref": materialization.config_ref,
        "before_sha256": materialization.config_before_sha256,
        "after_sha256": materialization.config_after_sha256,
    }
    expected_snapshot = {
        "before_ref": materialization.before_snapshot_ref,
        "before_sha256": materialization.before_snapshot_sha256,
        "after_ref": materialization.after_snapshot_ref,
        "after_sha256": materialization.after_snapshot_sha256,
    }
    if (
        any(config.get(key) != value for key, value in expected_config.items())
        or any(snapshot.get(key) != value for key, value in expected_snapshot.items())
        or config.get("config_key") != snapshot.get("config_key")
    ):
        raise OptimizationEccAdapterError("application receipt materialization files do not match")
    if expected_config["before_sha256"] == expected_config["after_sha256"] or (
        expected_snapshot["before_sha256"] != expected_config["before_sha256"]
        or expected_snapshot["after_sha256"] != expected_config["after_sha256"]
    ):
        raise OptimizationEccAdapterError("application receipt materialization hashes are invalid")
    try:
        config_path = _safe_path(candidate, str(expected_config["ref"]))
        before_path = _safe_path(candidate, str(expected_snapshot["before_ref"]))
        after_path = _safe_path(candidate, str(expected_snapshot["after_ref"]))
        config_payload = _read_json_object(config_path)
        written_value = _nested_json_value(config_payload, config_json_path)
    except (OSError, ValueError, KeyError, IndexError, json.JSONDecodeError) as exc:
        raise OptimizationEccAdapterError(
            "application receipt materialization file is unavailable"
        ) from exc
    if (
        file_sha256(config_path) != expected_config["after_sha256"]
        or file_sha256(before_path) != expected_snapshot["before_sha256"]
        or file_sha256(after_path) != expected_snapshot["after_sha256"]
        or written_value != materialization.written_value
    ):
        raise OptimizationEccAdapterError(
            "application receipt materialization file hash does not match"
        )


def _validate_parent_binding(
    workspace_root: Path,
    manifest: Mapping[str, object],
    materialization: MaterializationRef,
    parent_ref: str | None,
) -> None:
    manifest_parent = (
        manifest.get("parent_manifest_ref"),
        manifest.get("parent_manifest_sha256"),
        manifest.get("parent_state_sha256"),
    )
    receipt_parent = (
        materialization.parent_manifest_ref,
        materialization.parent_manifest_sha256,
        materialization.parent_state_sha256,
    )
    if manifest_parent != receipt_parent or materialization.parent_state_sha256 is None:
        raise OptimizationEccAdapterError("application receipt parent binding is invalid")
    if parent_ref is None:
        return
    if materialization.parent_manifest_ref is None:
        raise OptimizationEccAdapterError("application receipt parent manifest is unavailable")
    if materialization.parent_manifest_ref != (
        f"{parent_ref}/analysis/candidate_workspace.v1.json"
    ):
        raise OptimizationEccAdapterError(
            "application receipt parent manifest reference is invalid"
        )
    try:
        parent = _safe_path(workspace_root, parent_ref, directory=True)
        path = _safe_path(workspace_root, materialization.parent_manifest_ref)
        path.relative_to(parent)
        payload = _read_json_object(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise OptimizationEccAdapterError(
            "application receipt parent manifest is unavailable"
        ) from exc
    expected = {
        "schema": "ecc.workspace.candidate_workspace.v1",
        "schema_version": 1,
        "candidate_id": parent.name,
        "candidate_root_ref": parent_ref,
        "candidate_flow_sha256": manifest.get("parent_flow_sha256"),
        "candidate_state_sha256": materialization.parent_state_sha256,
        "end_step": CANDIDATE_END_STEP,
        "execution_scope": CANDIDATE_EXECUTION_SCOPE,
        "terminal_state": "succeeded",
    }
    if (
        any(payload.get(key) != value for key, value in expected.items())
        or file_sha256(path) != materialization.parent_manifest_sha256
        or manifest.get("parent_state_sha256") != materialization.parent_state_sha256
    ):
        raise OptimizationEccAdapterError("application receipt parent manifest is invalid")


def _safe_path(root: Path, reference: str, *, directory: bool = False) -> Path:
    path = root / reference
    if path.is_symlink():
        raise ValueError("artifact path is a symbolic link")
    resolved = path.resolve(strict=True)
    resolved.relative_to(root)
    if directory and not resolved.is_dir():
        raise ValueError("artifact directory is unavailable")
    if not directory and not resolved.is_file():
        raise ValueError("artifact file is unavailable")
    return resolved


def _read_json_object(path: Path) -> Mapping[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError("artifact must be a JSON object")
    return payload


def _nested_json_value(payload: Mapping[str, object], path: tuple[str | int, ...]) -> object:
    value: object = payload
    for key in path:
        if (
            isinstance(key, str)
            and isinstance(value, Mapping)
            or isinstance(key, int)
            and isinstance(value, list)
        ):
            value = value[key]
        else:
            raise ValueError("config value path is invalid")
    return value
