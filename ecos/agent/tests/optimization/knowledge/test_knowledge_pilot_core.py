import json
from pathlib import Path

import pytest

from ecos_agent.optimization.experiments.knowledge_mediation import (
    audit_planning_calls,
    build_mediation_row,
    classify_terminal_delta,
    missing_evidence_reason_counts,
    summarize_planning_audit,
)
from ecos_agent.optimization.experiments.knowledge_protocol import (
    build_protocol_manifest,
    context_fingerprint,
    validate_protocol_manifest,
    validate_design_ids,
)
from ecos_agent.optimization.experiments.knowledge_metrics import build_feedback_ledger


def test_protocol_is_limited_to_the_pilot_cohort() -> None:
    assert validate_design_ids(["gcd"]) == ("gcd",)
    assert validate_design_ids(["vm80", "gcd"]) == ("gcd", "vm80")
    with pytest.raises(ValueError):
        validate_design_ids(["gcd", "cia"])


def test_protocol_hash_binds_manifest() -> None:
    manifest = build_protocol_manifest(
        design_ids=["gcd"],
        treatments=["llm-no-knowledge"],
        knowledge_bundle_sha256="sha256:k",
        state_rule_manifest_sha256="sha256:s",
        objective_contract_sha256="sha256:o",
        toolchain={"ecos": "e"},
        model={"name": "m"},
        budget={"candidate_limit": 20},
        noise_rule={"schema_version": "n"},
    )
    assert manifest["schema_version"] == "ecos.knowledge_pilot_protocol.v1"
    assert manifest["protocol_hash"].startswith("sha256:")
    validate_protocol_manifest(manifest)
    assert context_fingerprint({"b": 2, "a": 1}) == context_fingerprint({"a": 1, "b": 2})


def test_mediation_row_requires_claim_binding_and_compares_epsilon() -> None:
    row = build_mediation_row(
        design_id="gcd",
        treatment="state-conditioned-dual-layer-zero-shot",
        context_fingerprint="sha256:c",
        planning_call=1,
        matched_claim_ids=["claim-1"],
        support_status="pass",
        claim_id="claim-1",
        binding_id="binding-1",
        knob="place.target_density",
        direction="decrease",
        requested_value=0.4,
        actual_value=0.4,
        receipt_status="effective",
        terminal_delta=-2.0,
        epsilon=0.5,
        promotion_decision="promote",
    )
    assert row["claim_bound"] is True
    assert row["terminal_delta_vs_epsilon"] == "outside"
    assert row["promotion_decision"] == "promote"
    assert row["missing_evidence_reason"] is None
    assert classify_terminal_delta(0.2, 0.5) == "tie"


def test_mediation_row_marks_unbound_claims() -> None:
    row = build_mediation_row(
        design_id="gcd",
        treatment="llm-no-knowledge",
        context_fingerprint="sha256:c",
        planning_call=1,
        matched_claim_ids=[],
        support_status="unknown",
        claim_id=None,
        binding_id=None,
        knob="place.target_density",
        direction="increase",
        requested_value=0.5,
        actual_value=None,
        receipt_status="unknown",
        terminal_delta=None,
        epsilon=0.1,
        missing_evidence_reason="receipt_link,terminal_observation_link",
    )
    assert row["claim_bound"] is False
    assert row["terminal_delta_vs_epsilon"] == "unobserved"
    assert row["missing_evidence_reason"] == "receipt_link,terminal_observation_link"


def test_planning_audit_does_not_claim_proposal_binding() -> None:
    result = summarize_planning_audit([{"evidence": {"envelope": {"prompt": "knowledge"}}}])
    assert result["planning_calls"] == 1
    assert result["knowledge_payload_calls"] == 1
    assert result["claim_bound_proposals_observed"] is False


def test_planning_call_audit_reports_missing_evidence_explicitly() -> None:
    audit_rows = [
        {"planning_entry_sha256": "sha256:" + "1" * 64},
        {"planning_entry_sha256": "sha256:" + "2" * 64},
    ]
    proposal_rows = [
        {
            "planning_entry_sha256": "sha256:" + "1" * 64,
            "claim_id": "claim-1",
            "binding_id": "binding-1",
            "action": {
                "knob_id": "place.target_density",
                "direction": "decrease",
                "requested_value": 0.4,
            },
            "knowledge_refs": [{"entity_id": "entity-9", "chunk_sha256": "sha256:x"}],
        }
    ]
    calls = audit_planning_calls(audit_rows, proposal_rows)
    linked, unlinked = calls
    assert linked["planning_call"] == 1
    assert linked["claim_bound"] is True
    assert linked["knob"] == "place.target_density"
    assert linked["requested_value"] == 0.4
    assert linked["matched_claim_ids"] == ["entity-9"]
    assert linked["actual_value"] is None
    assert linked["receipt_status"] == "unknown"
    assert linked["terminal_delta"] is None
    assert linked["promotion_decision"] is None
    assert linked["counts_toward_knowledge_attribution"] is False
    assert "receipt_link" in linked["missing_evidence_reason"]
    assert "proposal_observation" in unlinked["missing_evidence_reason"]
    assert unlinked["claim_bound"] is False
    assert unlinked["counts_toward_knowledge_attribution"] is False
    counts = missing_evidence_reason_counts(calls)
    assert counts[unlinked["missing_evidence_reason"]] == 1


def test_planning_call_audit_without_observations_marks_every_call() -> None:
    calls = audit_planning_calls([{"planning_entry_sha256": "sha256:" + "1" * 64}])
    assert calls[0]["missing_evidence_reason"] == (
        "context_fingerprint,proposal_observation,receipt_link,"
        "terminal_observation_link,promotion_decision"
    )


def test_feedback_ledger_is_conservative_without_terminal_effect() -> None:
    result = build_feedback_ledger([{"claim_id": "c", "receipt_status": "effective", "terminal_delta_vs_epsilon": "tie"}])
    assert result[0]["confidence"] == "unknown"
    assert result[0]["decision"] == "unknown"


def test_feedback_ledger_decides_keep_weak_and_contradicted() -> None:
    kept = build_feedback_ledger([
        {
            "claim_id": "keep", "receipt_status": "effective",
            "requested_value": 0.4, "actual_value": 0.4,
            "promotion_decision": "promote",
            "terminal_delta_vs_epsilon": "outside", "terminal_delta": -2.0,
        }
    ])[0]
    assert kept["decision"] == "keep"
    assert kept["contradiction_status"] == "unknown"
    weak = build_feedback_ledger([
        {
            "claim_id": "weak", "receipt_status": "effective",
            "requested_value": 0.4, "actual_value": 0.45,
            "terminal_delta_vs_epsilon": "outside", "terminal_delta": -2.0,
        }
    ])[0]
    assert weak["decision"] == "weak"
    contradicted = build_feedback_ledger([
        {
            "claim_id": "contra", "receipt_status": "effective",
            "requested_value": 0.4, "actual_value": 0.4,
            "promotion_decision": "promote",
            "terminal_delta_vs_epsilon": "outside", "terminal_delta": 3.0,
        }
    ])[0]
    assert contradicted["decision"] == "contradicted"
    assert contradicted["contradiction_status"] == "contradicted"
    unrealized = build_feedback_ledger([
        {
            "claim_id": "unreal", "receipt_status": "effective",
            "requested_value": 0.4, "actual_value": 0.4,
            "promotion_decision": "promote",
            "terminal_delta_vs_epsilon": "tie", "terminal_delta": 0.1,
        }
    ])[0]
    assert unrealized["contradiction_status"] == "unrealized"
    assert unrealized["decision"] == "unknown"
