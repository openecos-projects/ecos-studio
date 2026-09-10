import json
from pathlib import Path

import pytest

from ecos_agent.optimization.experiments.knowledge_mediation import (
    build_mediation_row,
    classify_terminal_delta,
    summarize_planning_audit,
)
from ecos_agent.optimization.experiments.knowledge_protocol import (
    build_protocol_manifest,
    context_fingerprint,
    validate_protocol_manifest,
    validate_design_ids,
)


def test_protocol_is_limited_to_gcd_and_vm80() -> None:
    assert validate_design_ids(["gcd"]) == ("gcd",)
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
    )
    assert row["claim_bound"] is True
    assert row["terminal_delta_vs_epsilon"] == "outside"
    assert classify_terminal_delta(0.2, 0.5) == "tie"


def test_mediation_row_marks_unbound_claims() -> None:
    row = build_mediation_row(
        design_id="vm80",
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
    )
    assert row["claim_bound"] is False
    assert row["terminal_delta_vs_epsilon"] == "unobserved"


def test_planning_audit_does_not_claim_proposal_binding() -> None:
    result = summarize_planning_audit([{"evidence": {"envelope": {"prompt": "knowledge"}}}])
    assert result["planning_calls"] == 1
    assert result["knowledge_payload_calls"] == 1
    assert result["claim_bound_proposals_observed"] is False
