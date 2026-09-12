"""Episode-level knowledge mediation audit: live chain join coverage."""

from __future__ import annotations

import json
from types import SimpleNamespace

from ecos_agent.optimization.contracts import (
    ExpectedEffect,
    ExpectedEffectDirection,
    KnowledgeReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationKnob,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller_context import ControllerContextMixin
from ecos_agent.optimization.experiments.knowledge_mediation import (
    audit_episode_mediation,
    summarize_episode_mediation,
)
from ecos_agent.optimization.parameters.contracts import (
    ExpectedEffectV2,
    NumericProposalActionV2,
    OptimizationProposalV2,
)
from ecos_agent.hashing import canonical_sha256

_SHA = lambda n: f"sha256:{n:064x}"


def _proposal() -> OptimizationProposal:
    return OptimizationProposal(
        context_ref=ProposalContextRef(
            episode_id="ep-1", checkpoint_id="ck-1", input_sha256=_SHA(0x1)
        ),
        decision=OptimizationDecision.PROPOSE,
        reason_code=ProposalReason.OBSERVATION,
        rationale_summary="probe a lower density",
        observation_refs=(
            ObservationReference(observation_id="obs-1", sha256=_SHA(0x2)),
        ),
        knowledge_refs=(
            KnowledgeReference(entity_id="claim-gcd-1", chunk_sha256=_SHA(0x3)[7:]),
        ),
        action=ProposalAction(
            knob_id=OptimizationKnob.TARGET_DENSITY,
            direction=StrategyDirection.DECREASE,
            expected_effects=(
                ExpectedEffect(
                    metric_id=ObjectiveMetric.ROUTE_WIRELENGTH,
                    direction=ExpectedEffectDirection.DECREASE,
                ),
            ),
        ),
    )


def _proposal_v2() -> OptimizationProposalV2:
    return OptimizationProposalV2(
        context_ref=ProposalContextRef(
            episode_id="ep-1", checkpoint_id="ck-1", input_sha256=_SHA(0x1)
        ),
        decision="propose",
        reason_code="observation",
        rationale_summary="probe a lower density",
        observation_refs=(
            ObservationReference(observation_id="obs-1", sha256=_SHA(0x2)),
        ),
        action=NumericProposalActionV2(
            claim_id="claim-gcd-1",
            claim_sha256=_SHA(0x3),
            binding_id="binding-gcd-1",
            binding_sha256=_SHA(0x4),
            knob_id=OptimizationKnob.TARGET_DENSITY,
            direction=StrategyDirection.DECREASE,
            requested_value=0.55,
            effective_domain_sha256=_SHA(0x5),
            expected_effects=(
                ExpectedEffectV2(
                    metric_id=ObjectiveMetric.ROUTE_WIRELENGTH,
                    direction="decrease",
                ),
            ),
        ),
    )


def _observation(value: float) -> SimpleNamespace:
    return SimpleNamespace(
        objective_metrics={ObjectiveMetric.ROUTE_WIRELENGTH: value}
    )


def _write_observation(tmp_path, planning_entry, turn) -> dict:
    class _FakeLedger:
        root = tmp_path

    class _FakeSelf:
        ledger = _FakeLedger()

    ControllerContextMixin._append_proposal_observation(
        _FakeSelf(), planning_entry, turn
    )
    rows = [
        json.loads(line)
        for line in (
            tmp_path / "optimization-proposal-observations.v1.jsonl"
        )
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert len(rows) == 1
    return rows[0]


def test_proposal_observation_persists_claim_tuple_and_fingerprint(
    tmp_path,
) -> None:
    from ecos_agent.optimization.planning import OptimizationPlannerTurn

    planning_entry = SimpleNamespace(
        entry_sha256=_SHA(0xA),
        effective_domains=(SimpleNamespace(context_sha256=_SHA(0xB)),),
    )
    turn = OptimizationPlannerTurn(
        _proposal(),
        RequestedKnobValue(knob_id=OptimizationKnob.TARGET_DENSITY, value=0.55),
        _SHA(0xC),
        _proposal_v2(),
    )
    row = _write_observation(tmp_path, planning_entry, turn)
    assert row["planning_entry_sha256"] == _SHA(0xA)
    assert row["claim_id"] == "claim-gcd-1"
    assert row["binding_id"] == "binding-gcd-1"
    assert row["claim_sha256"] == _SHA(0x3)
    assert row["binding_sha256"] == _SHA(0x4)
    assert row["requested_knob_id"] == "place.target_density"
    assert row["requested_value"] == 0.55
    assert row["context_fingerprint"] == _SHA(0xB)
    assert row["expected_effects"] == [
        {"metric_id": "route_wirelength", "direction": "decrease"}
    ]


def test_episode_mediation_join_fills_every_link() -> None:
    planning_entry = SimpleNamespace(entry_sha256=_SHA(0xA))
    proposal_sha = _SHA(0xD)
    proposal_row = {
        "planning_entry_sha256": _SHA(0xA),
        "proposal_sha256": proposal_sha,
        "decision": "propose",
        "claim_id": "claim-gcd-1",
        "binding_id": "binding-gcd-1",
        "requested_knob_id": "place.target_density",
        "requested_value": 0.55,
        "context_fingerprint": _SHA(0xB),
        "action": {"direction": "decrease"},
        "knowledge_refs": [{"entity_id": "claim-gcd-1"}],
    }
    start = SimpleNamespace(
        proposal_sha256=proposal_sha, intervention_id="intervention-01"
    )
    outcome = SimpleNamespace(
        intervention_id="intervention-01",
        parameter_application_receipt=SimpleNamespace(
            status="effective", actual_value=0.6678
        ),
        terminal_observation=_observation(900.0),
        incumbent_decision=SimpleNamespace(value="candidate_better"),
    )
    calls = audit_episode_mediation(
        design_id="gcd",
        planning_entries=[planning_entry],
        proposal_rows=[proposal_row],
        decision_rows=[],
        starts=[start],
        outcomes={"intervention-01": outcome},
        reference_observation=_observation(1000.0),
        objective_metric="route_wirelength",
        epsilon=5.0,
    )
    assert len(calls) == 1
    call = calls[0]
    assert call["claim_bound"] is True
    assert call["receipt_status"] == "effective"
    assert call["actual_value"] == 0.6678
    assert call["terminal_delta"] == -100.0
    assert call["terminal_delta_vs_epsilon"] == "outside"
    assert call["promotion_decision"] == "candidate_better"
    assert call["counts_toward_knowledge_attribution"] is True
    assert call["missing_evidence_reason"] is None
    summary = summarize_episode_mediation(calls)
    assert summary["attributable_rows"] == 1
    assert summary["activated_rows"] == 1
    assert summary["terminal_response_rows"] == 1
    assert summary["missing_evidence_reason_counts"] == {}


def test_episode_mediation_reports_only_genuinely_missing_links() -> None:
    planning_entry = SimpleNamespace(entry_sha256=_SHA(0xE))
    # Unbound proposal (no claim refs): legal, reported via claim_bound=false.
    unbound_row = {
        "planning_entry_sha256": _SHA(0xE),
        "proposal_sha256": _SHA(0xF),
        "decision": "propose",
        "claim_id": None,
        "binding_id": None,
        "requested_knob_id": "place.target_density",
        "requested_value": 0.6,
        "context_fingerprint": _SHA(0xB),
        "action": {"direction": "decrease"},
        "knowledge_refs": [],
    }
    calls = audit_episode_mediation(
        design_id="gcd",
        planning_entries=[planning_entry],
        proposal_rows=[unbound_row],
        decision_rows=[],
        starts=[],
        outcomes={},
        reference_observation=_observation(1000.0),
        objective_metric="route_wirelength",
        epsilon=None,
    )
    call = calls[0]
    assert call["claim_bound"] is False
    assert call["counts_toward_knowledge_attribution"] is False
    assert set(
        (call["missing_evidence_reason"] or "").split(",")
    ) == {"receipt_link", "terminal_observation_link", "promotion_decision"}
    assert call["terminal_delta_vs_epsilon"] == "unobserved"

    # A planning call with no observation row keeps the explicit gap tag.
    missing_calls = audit_episode_mediation(
        design_id="gcd",
        planning_entries=[SimpleNamespace(entry_sha256=_SHA(0x11))],
        proposal_rows=[],
        decision_rows=[],
        starts=[],
        outcomes={},
        reference_observation=_observation(1000.0),
        objective_metric="route_wirelength",
    )
    assert missing_calls[0]["missing_evidence_reason"] == (
        "proposal_observation,context_fingerprint,"
        "receipt_link,terminal_observation_link,promotion_decision"
    )
    summary = summarize_episode_mediation(missing_calls)
    assert summary["attributable_rows"] == 0
    assert summary["missing_evidence_reason_counts"] == {
        "proposal_observation,context_fingerprint,"
        "receipt_link,terminal_observation_link,promotion_decision": 1
    }
    # canonical hash of the proposal payload stays stable for the join.
    assert canonical_sha256({"probe": True}).startswith("sha256:")
