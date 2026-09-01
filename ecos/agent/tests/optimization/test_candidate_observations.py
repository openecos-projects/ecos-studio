from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.controller import CandidateExecutionEvidence
from ecos_agent.optimization.observations import (
    OptimizationObservationError,
    build_candidate_terminal_observation,
)



from tests.optimization.observation_support import (
    _harden_manifest_artifacts,
    _write_json,
    frozen_workspace,
)

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
            "artifacts": _harden_manifest_artifacts(candidate_root),
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
    candidate_flow.write_text(
        candidate_flow.read_text(encoding="utf-8") + "\n", encoding="utf-8"
    )
    candidate_2_root = frozen_workspace / ".agent/candidates/candidate-2"
    shutil.copytree(candidate_root, candidate_2_root)
    manifest_2_ref = (
        ".agent/candidates/candidate-2/analysis/candidate_workspace.v1.json"
    )
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
            "artifacts": _harden_manifest_artifacts(candidate_2_root),
        },
    )
    evidence_2 = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-2",
        candidate_manifest_ref=manifest_2_ref,
        candidate_manifest_sha256=file_sha256(manifest_2_path),
    )

    assert build_candidate_terminal_observation(
        frozen_workspace, evidence_2
    ).observation_id == ("terminal-Harden")


def test_candidate_terminal_observation_requires_harden_artifact_manifest_entries(
    frozen_workspace: Path, tmp_path: Path
) -> None:
    source_copy = tmp_path / "candidate-source"
    shutil.copytree(frozen_workspace, source_copy)
    candidate_root = frozen_workspace / ".agent/candidates/candidate-1"
    shutil.copytree(source_copy, candidate_root)
    manifest_ref = ".agent/candidates/candidate-1/analysis/candidate_workspace.v1.json"
    manifest_path = frozen_workspace / manifest_ref
    _write_json(
        manifest_path,
        {
            "schema": "ecc.workspace.candidate_workspace.v1",
            "schema_version": 1,
            "candidate_id": "candidate-1",
            "candidate_root_ref": ".agent/candidates/candidate-1",
            "parent_candidate_root_ref": None,
            "parent_flow_sha256": file_sha256(frozen_workspace / "home/flow.json"),
            "candidate_flow_sha256": file_sha256(candidate_root / "home/flow.json"),
            "artifacts": {},
        },
    )
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-1",
        candidate_manifest_ref=manifest_ref,
        candidate_manifest_sha256=file_sha256(manifest_path),
    )

    with pytest.raises(OptimizationObservationError, match="Harden artifact"):
        build_candidate_terminal_observation(frozen_workspace, evidence)


def test_candidate_terminal_observation_rejects_tampered_candidate_flow_hash(
    frozen_workspace: Path, tmp_path: Path
) -> None:
    source_copy = tmp_path / "candidate-source"
    shutil.copytree(frozen_workspace, source_copy)
    candidate_root = frozen_workspace / ".agent/candidates/candidate-1"
    shutil.copytree(source_copy, candidate_root)
    manifest_ref = ".agent/candidates/candidate-1/analysis/candidate_workspace.v1.json"
    manifest_path = frozen_workspace / manifest_ref
    _write_json(
        manifest_path,
        {
            "schema": "ecc.workspace.candidate_workspace.v1",
            "schema_version": 1,
            "candidate_id": "candidate-1",
            "candidate_root_ref": ".agent/candidates/candidate-1",
            "parent_candidate_root_ref": None,
            "parent_flow_sha256": file_sha256(frozen_workspace / "home/flow.json"),
            "candidate_flow_sha256": "sha256:" + "0" * 64,
        },
    )
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-1",
        candidate_manifest_ref=manifest_ref,
        candidate_manifest_sha256=file_sha256(manifest_path),
    )

    with pytest.raises(OptimizationObservationError, match="candidate flow"):
        build_candidate_terminal_observation(frozen_workspace, evidence)


def test_candidate_terminal_observation_rejects_tampered_artifact_hash(
    frozen_workspace: Path, tmp_path: Path
) -> None:
    source_copy = tmp_path / "candidate-source"
    shutil.copytree(frozen_workspace, source_copy)
    candidate_root = frozen_workspace / ".agent/candidates/candidate-1"
    shutil.copytree(source_copy, candidate_root)
    manifest_ref = ".agent/candidates/candidate-1/analysis/candidate_workspace.v1.json"
    manifest_path = frozen_workspace / manifest_ref
    runtime_report = candidate_root / "analysis/parameter_runtime_report.v1.json"
    runtime_report.parent.mkdir(parents=True, exist_ok=True)
    runtime_report.write_text("{}\n", encoding="utf-8")
    _write_json(
        manifest_path,
        {
            "schema": "ecc.workspace.candidate_workspace.v1",
            "schema_version": 1,
            "candidate_id": "candidate-1",
            "candidate_root_ref": ".agent/candidates/candidate-1",
            "parent_candidate_root_ref": None,
            "parent_flow_sha256": file_sha256(frozen_workspace / "home/flow.json"),
            "candidate_flow_sha256": file_sha256(candidate_root / "home/flow.json"),
            "artifacts": {
                **_harden_manifest_artifacts(candidate_root),
                "parameter_runtime_report": {
                    "ref": "analysis/parameter_runtime_report.v1.json",
                    "sha256": "sha256:" + "0" * 64,
                }
            },
        },
    )
    evidence = CandidateExecutionEvidence(
        candidate_root_ref=".agent/candidates/candidate-1",
        candidate_manifest_ref=manifest_ref,
        candidate_manifest_sha256=file_sha256(manifest_path),
    )

    with pytest.raises(OptimizationObservationError, match="artifact hash"):
        build_candidate_terminal_observation(frozen_workspace, evidence)
