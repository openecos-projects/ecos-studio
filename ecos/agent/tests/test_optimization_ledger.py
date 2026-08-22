import json

import pytest

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_ledger import (
    OptimizationArtifactManifestError,
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerIntegrityError,
    OptimizationLedgerRecoveryRequired,
    OptimizationLedgerStateError,
    OptimizationOutcomeKind,
    OptimizationTerminalOutcome,
    build_optimization_artifact_manifest,
    load_optimization_artifact_manifest,
    verify_optimization_artifact_manifest,
    write_optimization_artifact_manifest,
)


HASH = "sha256:" + "a" * 64


def _start(intervention_id: str = "intervention-1") -> OptimizationInterventionStart:
    return OptimizationInterventionStart(
        intervention_id=intervention_id,
        parent_checkpoint_id="checkpoint-parent",
        candidate_checkpoint_id="checkpoint-candidate",
        parameter_before_sha256=HASH,
        parameter_after_sha256=HASH,
        proposal_sha256=HASH,
        execution_contract_sha256=HASH,
        parent_manifest_sha256=HASH,
        environment_sha256=HASH,
    )


def _terminal(
    intervention_id: str = "intervention-1",
    outcome: OptimizationOutcomeKind = OptimizationOutcomeKind.DEGRADED,
) -> OptimizationTerminalOutcome:
    return OptimizationTerminalOutcome(
        intervention_id=intervention_id,
        outcome=outcome,
        candidate_manifest_sha256=HASH,
        receipt_sha256=HASH,
        terminal_observation_sha256=HASH,
        outcome_details_sha256=HASH,
    )


def test_ledger_retains_a_degraded_outcome_and_replays_it_deterministically(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")

    ledger.append_start(_start())
    ledger.append_terminal(_terminal())
    first_replay = ledger.verify()
    second_replay = OptimizationLedger(tmp_path / "episode").verify()

    assert first_replay == second_replay
    assert first_replay.pending_intervention_ids == ()
    assert first_replay.terminal_outcomes == (_terminal(),)
    assert first_replay.chain_head_sha256.startswith("sha256:")
    assert ledger.ledger_path.read_bytes().endswith(b"\n")

    manifest = ledger.write_manifest()
    assert manifest.ledger_sha256 == file_sha256(ledger.ledger_path)
    assert manifest.chain_head_sha256 == first_replay.chain_head_sha256


def test_ledger_rejects_tampering_and_never_appends_to_an_invalid_chain(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")
    ledger.append_start(_start())
    ledger.append_terminal(_terminal())

    contents = ledger.ledger_path.read_text(encoding="utf-8")
    ledger.ledger_path.write_text(contents.replace("degraded", "improved"), encoding="utf-8")

    with pytest.raises(OptimizationLedgerIntegrityError, match="hash"):
        ledger.verify()
    with pytest.raises(OptimizationLedgerIntegrityError, match="hash"):
        ledger.append_start(_start("intervention-2"))


def test_ledger_recovers_only_a_torn_final_record_and_marks_it_pending(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")
    start = _start()
    ledger.append_start(start)
    with ledger.ledger_path.open("ab") as stream:
        stream.write(b'{"sequence":2')

    with pytest.raises(OptimizationLedgerRecoveryRequired, match="recover"):
        ledger.verify()

    replay = ledger.recover()

    assert replay.pending_intervention_ids == (start.intervention_id,)
    assert ledger.ledger_path.read_bytes().endswith(b"\n")
    with pytest.raises(OptimizationLedgerStateError, match="already exists"):
        ledger.append_start(start)


def test_ledger_recovery_keeps_a_complete_final_record_without_its_newline(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")
    start = _start()
    ledger.append_start(start)
    ledger.ledger_path.write_bytes(ledger.ledger_path.read_bytes().rstrip(b"\n"))

    replay = ledger.recover()

    assert len(replay.entries) == 1
    assert replay.pending_intervention_ids == (start.intervention_id,)
    assert ledger.ledger_path.read_bytes().endswith(b"\n")


def test_ledger_requires_one_start_and_one_terminal_record_per_intervention(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")

    with pytest.raises(OptimizationLedgerStateError, match="not pending"):
        ledger.append_terminal(_terminal())

    ledger.append_start(_start())
    ledger.append_terminal(_terminal())
    with pytest.raises(OptimizationLedgerStateError, match="not pending"):
        ledger.append_terminal(_terminal())


def test_intervention_start_requires_distinct_parent_and_candidate_checkpoints() -> None:
    payload = _start().model_dump()
    payload["candidate_checkpoint_id"] = payload["parent_checkpoint_id"]

    with pytest.raises(ValueError, match="different"):
        OptimizationInterventionStart.model_validate(payload)


def test_empty_ledger_manifest_binds_the_real_empty_ledger_file(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")

    manifest = ledger.write_manifest()

    assert ledger.ledger_path.is_file()
    assert manifest.event_count == 0
    assert manifest.ledger_sha256 == file_sha256(ledger.ledger_path)
    ledger.verify_manifest(manifest)

    ledger.append_start(_start())
    with pytest.raises(OptimizationLedgerIntegrityError, match="manifest"):
        ledger.verify_manifest(manifest)


def test_artifact_manifest_uses_full_sha256_for_a_large_file_and_detects_changes(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    artifact = workspace / "large.log"
    with artifact.open("wb") as stream:
        stream.seek(50 * 1024 * 1024)
        stream.write(b"x")

    manifest = build_optimization_artifact_manifest(workspace, ("large.log",))

    assert manifest.entries[0].size_bytes == 50 * 1024 * 1024 + 1
    assert manifest.entries[0].sha256 == file_sha256(artifact)
    verify_optimization_artifact_manifest(workspace, manifest)

    artifact.write_bytes(b"changed")
    with pytest.raises(OptimizationArtifactManifestError, match="hash"):
        verify_optimization_artifact_manifest(workspace, manifest)


def test_artifact_manifest_is_portable_and_rejects_escape_or_symlink_inputs(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    artifact = workspace / "result.json"
    artifact.write_text('{"metric": 1}', encoding="utf-8")
    manifest_path = tmp_path / "evidence-manifest.v1.json"

    manifest = build_optimization_artifact_manifest(workspace, ("result.json",))
    write_optimization_artifact_manifest(manifest, manifest_path)
    loaded = load_optimization_artifact_manifest(manifest_path)

    assert loaded == manifest
    assert loaded.entries[0].relative_path == "result.json"
    with pytest.raises(OptimizationArtifactManifestError, match="relative"):
        build_optimization_artifact_manifest(workspace, ("../outside",))

    link = workspace / "link.json"
    link.symlink_to(artifact)
    with pytest.raises(OptimizationArtifactManifestError, match="symlink"):
        build_optimization_artifact_manifest(workspace, ("link.json",))


def test_replay_rejects_a_valid_json_record_with_a_broken_sequence(tmp_path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")
    ledger.append_start(_start())
    record = json.loads(ledger.ledger_path.read_text(encoding="utf-8"))
    record["sequence"] = 2
    record["entry_sha256"] = canonical_sha256(
        {
            "schema_version": record["schema_version"],
            "sequence": record["sequence"],
            "previous_entry_sha256": record["previous_entry_sha256"],
            "payload": record["payload"],
        }
    )
    ledger.ledger_path.write_text(json.dumps(record) + "\n", encoding="utf-8")

    with pytest.raises(OptimizationLedgerIntegrityError, match="sequence"):
        ledger.verify()
