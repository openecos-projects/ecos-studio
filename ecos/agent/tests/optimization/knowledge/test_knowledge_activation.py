import pytest

from ecos_agent.optimization.experiments.knowledge_activation import (
    run_activation,
    validate_activation_input,
)
from ecos_agent.optimization.experiments.knowledge_protocol import build_protocol_manifest

PASSING_GATE = {"offline_gate_pass": True}
FAILED_GATE = {"offline_gate_pass": False}


def _protocol():
    return build_protocol_manifest(
        design_ids=["gcd"], treatments=["state-conditioned-dual-layer-zero-shot"],
        knowledge_bundle_sha256="sha256:" + "1" * 64,
        state_rule_manifest_sha256="sha256:" + "2" * 64,
        objective_contract_sha256="sha256:" + "3" * 64,
        toolchain={"ecc_executable_sha256": "sha256:" + "4" * 64},
        model={"name": "test", "planner_seed": 0}, budget={"candidate_limit": 1},
        noise_rule={"schema_version": "test"},
    )


def _row():
    return {
        "design_id": "gcd",
        "stratum": "knowledge_opportunity",
        "decision": "propose",
        "claim_bound": True,
        "claim_id": "claim-1",
        "claim_sha256": "sha256:" + "a" * 64,
        "binding_id": "binding-1",
        "binding_sha256": "sha256:" + "b" * 64,
        "knob": "place.target_density",
        "direction": "decrease",
        "requested_value": 0.4,
        "support_status": "pass",
        "context_fingerprint": "sha256:" + "c" * 64,
    }


def test_activation_accepts_claim_bound_opportunity():
    validate_activation_input(_row(), _protocol(), design_id="gcd", parent_checkpoint="cp", offline_gate=PASSING_GATE)


@pytest.mark.parametrize("row", [
    {"design_id":"gcd", "stratum":"stale_binding", "decision":"propose", "claim_bound":True, "context_fingerprint":"sha256:"+"a"*64},
    {"design_id":"gcd", "stratum":"knowledge_opportunity", "decision":"continue", "claim_bound":False, "context_fingerprint":"sha256:"+"a"*64},
])
def test_activation_rejects_unexecutable_rows(row):
    with pytest.raises(ValueError):
        validate_activation_input(row, _protocol(), design_id="gcd", parent_checkpoint="cp", offline_gate=PASSING_GATE)


def test_activation_requires_passing_offline_gate():
    with pytest.raises(ValueError):
        validate_activation_input(_row(), _protocol(), design_id="gcd", parent_checkpoint="cp", offline_gate=FAILED_GATE)
    with pytest.raises(ValueError):
        run_activation(
            row=_row(), protocol=_protocol(), design_id="gcd",
            parent_checkpoint="cp", candidate_runner=lambda **kwargs: {}, epsilon=0.5,
            offline_gate=FAILED_GATE,
        )


def _full_runner(**kwargs):
    return {
        "actual_value": kwargs["row"]["requested_value"],
        "receipt_status": "effective",
        "terminal_observation_hash": "sha256:" + "d" * 64,
        "terminal_delta": -2.0,
        "promotion_decision": "promote",
    }


def test_activation_mediation_row_is_complete_and_epsilon_compared():
    row = run_activation(
        row=_row(), protocol=_protocol(), design_id="gcd",
        parent_checkpoint="cp", candidate_runner=_full_runner, epsilon=0.5,
        offline_gate=PASSING_GATE,
    )
    assert row["row_status"] == "complete"
    assert row["missing_evidence"] == []
    for key in (
        "protocol_hash", "design_id", "context_fingerprint", "parent_checkpoint",
        "proposal_hash", "support_status", "claim_bound", "requested_value",
        "actual_value", "receipt_status", "terminal_observation_hash",
        "terminal_delta", "epsilon_comparison", "promotion_decision",
        "failure_or_timeout_reason",
    ):
        assert key in row
    assert row["epsilon_comparison"] == "outside"
    assert row["claim_bound"] is True
    assert row["support_status"] == "pass"


def test_proposal_hash_binds_proposal_content_not_the_row():
    other_context = {**_row(), "context_fingerprint": "sha256:" + "e" * 64}
    rows = [
        run_activation(
            row=row, protocol=_protocol(), design_id="gcd",
            parent_checkpoint="cp", candidate_runner=_full_runner, epsilon=0.5,
            offline_gate=PASSING_GATE,
        )
        for row in (_row(), other_context)
    ]
    assert rows[0]["proposal_hash"] == rows[1]["proposal_hash"]
    changed_request = {**_row(), "requested_value": 0.35}
    changed = run_activation(
        row=changed_request, protocol=_protocol(), design_id="gcd",
        parent_checkpoint="cp", candidate_runner=_full_runner, epsilon=0.5,
        offline_gate=PASSING_GATE,
    )
    assert changed["proposal_hash"] != rows[0]["proposal_hash"]


def test_failed_runner_stays_in_denominator_with_reason():
    def _boom(**kwargs):
        raise TimeoutError("candidate timed out")

    row = run_activation(
        row=_row(), protocol=_protocol(), design_id="gcd",
        parent_checkpoint="cp", candidate_runner=_boom, epsilon=0.5,
        offline_gate=PASSING_GATE,
    )
    assert row["row_status"] == "incomplete"
    assert "TimeoutError" in row["failure_or_timeout_reason"]
    assert row["epsilon_comparison"] == "unobserved"
    assert row["promotion_decision"] is None


def test_missing_execution_link_blocks_utility_analysis():
    row = run_activation(
        row=_row(), protocol=_protocol(), design_id="gcd",
        parent_checkpoint="cp",
        candidate_runner=lambda **kwargs: {"receipt_status": "effective"},
        epsilon=0.5, offline_gate=PASSING_GATE,
    )
    assert row["row_status"] == "incomplete"
    assert set(row["missing_evidence"]) == {
        "actual_value", "terminal_observation_hash", "terminal_delta", "promotion_decision",
    }
