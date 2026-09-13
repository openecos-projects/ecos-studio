"""Cross-revision replay guarantees for the optimization audit chains.

Entry hashes are computed over the key set actually stored in each record
(exclude_unset), so a record written by an older revision — before newer
optional fields existed — must still verify under the current models. The
tests below lock that behavior per chain: dropping a stored key and
re-hashing the remaining content (an older revision's record shape), or
injecting an explicit null (an intermediate revision's shape), must never
break verification, and a future optional model field must not change
existing records' verdicts.
"""

import json
from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    PlanningProviderEnvelope,
    PlanningProviderEvidence,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationPlanningAudit,
)
from ecos_agent.optimization.ledger_provider_audit import (
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationPlanningProviderEvidenceEntry,
)
from tests.optimization.test_outcome_ledger import HASH, _start, _terminal


def _canonical_line(record: dict, hashed: dict) -> bytes:
    record = {**record, "entry_sha256": canonical_sha256(hashed)}
    return json.dumps(record, sort_keys=True, separators=(",", ":")).encode()


def _provider_record(raw_line: bytes) -> dict:
    return json.loads(raw_line)


def _provider_hashed(record: dict) -> dict:
    return {
        "schema_version": record["schema_version"],
        "sequence": record["sequence"],
        "previous_entry_sha256": record["previous_entry_sha256"],
        "payload": {
            "schema_version": record["schema_version"],
            "planning_entry_sha256": record["planning_entry_sha256"],
            "evidence": record["evidence"],
        },
    }


def _provider_evidence() -> PlanningProviderEvidence:
    envelope_payload = {
        "schema_version": "ecos.optimization_planning_provider_envelope.v1",
        "provider_id": "codex_app_server",
        "requested_model": "test-model",
        "prompt": "bounded test prompt",
        "output_schema": {"type": "object"},
        "planner_payload_sha256": HASH,
    }
    return PlanningProviderEvidence(
        provider_id="codex_app_server",
        thread_id="thread-1",
        turn_id="turn-1",
        response_sha256=HASH,
        envelope=PlanningProviderEnvelope(
            **envelope_payload,
            envelope_sha256=canonical_sha256(envelope_payload),
        ),
    )


def test_provider_audit_verifies_all_record_generations(tmp_path: Path) -> None:
    """Gen1 lacks response_excerpt, gen2 stores null, gen3 stores an excerpt."""
    audit = OptimizationPlanningProviderEvidenceAudit(tmp_path / "episode")
    audit.append(planning_entry_sha256=HASH, evidence=_provider_evidence())
    gen2 = audit.audit_path.read_bytes().splitlines()[0]
    assert b'"response_excerpt":null' in gen2  # gen2: a53d92cf shape

    # Gen1: the field did not exist yet — drop it and re-hash the remainder.
    gen1_record = json.loads(gen2)
    gen1_record["evidence"].pop("response_excerpt")
    gen1 = _canonical_line(gen1_record, _provider_hashed(gen1_record))

    gen3_record = json.loads(gen2)
    gen3_record["evidence"]["response_excerpt"] = "raw model output"
    gen3 = _canonical_line(gen3_record, _provider_hashed(gen3_record))

    for line in (gen1, gen2, gen3):
        audit.audit_path.write_bytes(line + b"\n")
        assert len(audit.verify().entries) == 1

    # Tampering is still detected: mutating a stored value breaks the chain.
    audit.audit_path.write_bytes(
        gen3.replace(b"raw model output", b"tampered output") + b"\n"
    )
    with pytest.raises(Exception, match="invalid hash or schema"):
        audit.verify()


def test_provider_audit_tolerates_future_optional_fields(tmp_path: Path) -> None:
    class FutureEvidenceEntry(OptimizationPlanningProviderEvidenceEntry):
        future_note: str | None = None

    audit = OptimizationPlanningProviderEvidenceAudit(tmp_path / "episode")
    audit.append(planning_entry_sha256=HASH, evidence=_provider_evidence())
    raw_line = audit.audit_path.read_bytes().splitlines()[0]

    entry = FutureEvidenceEntry.model_validate_json(raw_line)
    assert entry.future_note is None
    assert OptimizationPlanningProviderEvidenceEntry.model_validate_json(raw_line)


def test_planning_audit_verifies_record_missing_optional_keys(tmp_path: Path) -> None:
    audit = OptimizationPlanningAudit(tmp_path / "episode")
    context_ref = {
        "episode_id": "episode-1",
        "checkpoint_id": "checkpoint-1",
        "input_sha256": HASH,
    }
    record = {
        "schema_version": "ecos.optimization_planning_audit.v1",
        "sequence": 1,
        "previous_entry_sha256": None,
        "context_ref": context_ref,
        "context_input_sha256": HASH,
        "history_refs": [],
        "history_outcomes": [],
        "history_count": 0,
        "budget_snapshot_sha256": HASH,
        "planner_payload_sha256": HASH,
    }
    # Gen1: incumbent_sha256 / task memory fields did not exist yet, so the
    # stored record and its hash both lack them. The hash payload keeps
    # schema_version (only sequence/chain keys are excluded).
    def _hashed(rec: dict) -> dict:
        return {
            "schema_version": rec["schema_version"],
            "sequence": rec["sequence"],
            "previous_entry_sha256": rec["previous_entry_sha256"],
            "payload": {
                k: v
                for k, v in rec.items()
                if k not in {"sequence", "previous_entry_sha256"}
            },
        }

    gen1 = _canonical_line(dict(record), _hashed(record))
    # Gen2: incumbent_sha256 exists and stores an explicit null.
    gen2_record = {**record, "incumbent_sha256": None}
    gen2 = _canonical_line(gen2_record, _hashed(gen2_record))

    for line in (gen1, gen2):
        audit.audit_path.write_bytes(line + b"\n")
        assert len(audit.verify().entries) == 1


def test_ledger_entry_verifies_older_record_shapes(tmp_path: Path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")
    ledger.append_start(_start("intervention-1"))
    raw_line = ledger.ledger_path.read_bytes().splitlines()[0]
    record = json.loads(raw_line)

    # Gen1: candidate refs did not exist yet — drop them, re-hash the rest.
    gen1_payload = {
        k: v for k, v in record["payload"].items()
        if k not in {"candidate_root_ref", "candidate_manifest_ref"}
    }
    gen1 = _canonical_line(
        {**record, "payload": gen1_payload},
        {
            "schema_version": record["schema_version"],
            "sequence": record["sequence"],
            "previous_entry_sha256": record["previous_entry_sha256"],
            "payload": gen1_payload,
        },
    )
    ledger.ledger_path.write_bytes(gen1 + b"\n")
    assert len(ledger.verify().entries) == 1


def test_decision_audit_verifies_record_missing_optional_keys(tmp_path: Path) -> None:
    audit = OptimizationDecisionAudit(tmp_path / "episode")
    record = {
        "schema_version": "ecos.optimization_decision_audit.v1",
        "sequence": 1,
        "previous_entry_sha256": None,
        "planning_entry_sha256": HASH,
        "proposal": None,
        "validation_result": "accepted",
        "rejection_reason": None,
        "requested": None,
        "state": "created",
    }
    # Gen1: rejection_reason / requested did not exist yet.
    gen1_record = {
        k: v for k, v in record.items() if k not in {"rejection_reason", "requested"}
    }
    gen1 = _canonical_line(dict(gen1_record), gen1_record)
    gen2 = _canonical_line(dict(record), record)

    for line in (gen1, gen2):
        audit.audit_path.write_bytes(line + b"\n")
        assert len(audit.verify().entries) == 1


def test_ledger_chains_still_append_and_replay(tmp_path: Path) -> None:
    ledger = OptimizationLedger(tmp_path / "episode")
    ledger.append_start(_start("intervention-1"))
    ledger.append_terminal(_terminal("intervention-1"))
    replay = ledger.verify()
    assert len(replay.entries) == 2
