from __future__ import annotations

from pathlib import Path

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    ExpectedEffect,
    ExpectedEffectDirection,
    HistoryReference,
    LegalAction,
    ObjectiveMetric,
    OptimizationEpisodeState,
    OptimizationKnob,
    OptimizationOutcomeKind,
    ProposalAction,
    ProposalContextRef,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization.ledger import OptimizationPlanningAudit
from ecos_agent.optimization.planning import OptimizationHistory
from ecos_agent.optimization.reflection import (
    FeedbackSource,
    PredictionVerdict,
    build_planning_feedback,
    outcome_attribution_entry,
    rejection_feedback_entry,
)

from .controller.support import HASH, _eligible_terminal

_OVERFLOW_DECREASE = ExpectedEffect(
    metric_id=ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
    direction=ExpectedEffectDirection.DECREASE,
)


def _action() -> ProposalAction:
    return ProposalAction(
        knob_id=OptimizationKnob.CELL_PADDING_X,
        direction=StrategyDirection.INCREASE,
        expected_effects=(_OVERFLOW_DECREASE,),
    )


def _history(
    *,
    outcome: OptimizationOutcomeKind = OptimizationOutcomeKind.IMPROVED,
    incumbent_decision: str | None = "incumbent_retained",
    overflow_value: float = 0.0,
) -> OptimizationHistory:
    terminal = _eligible_terminal().model_copy(
        update={
            "metrics": {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow_value,
                ObjectiveMetric.ROUTE_WIRELENGTH: 100,
            }
        }
    )
    return OptimizationHistory(
        reference=HistoryReference(
            intervention_id="intervention-1",
            outcome_sha256=canonical_sha256({"probe": 1}),
        ),
        outcome=outcome,
        action=_action(),
        requested=RequestedKnobValue(
            knob_id=OptimizationKnob.CELL_PADDING_X, value=3
        ),
        terminal_observation=terminal,
        incumbent_decision=incumbent_decision,
        decisive_metric="route_la_total_overflow",
    )


def test_rejection_entry_maps_known_codes_to_recovery_hints() -> None:
    entry = rejection_feedback_entry("observation_reference")

    assert entry.source == FeedbackSource.REJECTION
    assert entry.reason_code == "observation_reference"
    assert entry.recovery_hints


def test_rejection_entry_lists_legal_actions_for_proposal_action() -> None:
    entry = rejection_feedback_entry(
        "proposal_action",
        legal_actions=(
            LegalAction(
                knob_id=OptimizationKnob.CELL_PADDING_X,
                direction=StrategyDirection.INCREASE,
            ),
        ),
    )

    assert "place.cell_padding_x/increase" in entry.recovery_hints[-1]


def test_rejection_entry_keeps_free_text_domain_reasons() -> None:
    entry = rejection_feedback_entry(
        "requested place.target_density=0.35 is below the observed floor"
    )

    assert entry.reason_code == "parameter_domain"
    assert "floor" in entry.summary


def test_outcome_attribution_confirms_a_correct_prediction() -> None:
    incumbent = _eligible_terminal().model_copy(
        update={
            "metrics": {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 10.0,
                ObjectiveMetric.ROUTE_WIRELENGTH: 100,
            }
        }
    )

    entry = outcome_attribution_entry(_history(), incumbent=incumbent)

    assert entry is not None
    assert entry.source == FeedbackSource.OUTCOME_ATTRIBUTION
    assert entry.intervention_id == "intervention-1"
    assert entry.expected_effect_verdicts[0].verdict == PredictionVerdict.CONFIRMED
    assert entry.expected_effect_verdicts[0].observed_delta == -10.0
    assert "1 confirmed, 0 refuted" in entry.summary


def test_outcome_attribution_refutes_a_wrong_prediction() -> None:
    incumbent = _eligible_terminal().model_copy(
        update={
            "metrics": {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 0,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 4.0,
                ObjectiveMetric.ROUTE_WIRELENGTH: 100,
            }
        }
    )
    # Candidate overflow 8.0 against a baseline of 4.0 got worse.
    history = _history(overflow_value=8.0)

    entry = outcome_attribution_entry(history, incumbent=incumbent)

    assert entry is not None
    assert entry.expected_effect_verdicts[0].verdict == PredictionVerdict.REFUTED


def test_outcome_attribution_marks_promoted_baselines_unknown() -> None:
    entry = outcome_attribution_entry(
        _history(incumbent_decision="candidate_better"),
        incumbent=_eligible_terminal(),
    )

    assert entry is not None
    assert all(
        verdict.verdict == PredictionVerdict.UNKNOWN
        for verdict in entry.expected_effect_verdicts
    )
    assert "promoted" in entry.summary


def test_build_planning_feedback_reuses_persisted_attribution(
    tmp_path: Path,
) -> None:
    root = tmp_path / "episode"
    from tests.optimization.controller.support import _budget

    planning_audit = OptimizationPlanningAudit(root)
    planning_entry = planning_audit.append(
        context_ref=ProposalContextRef(
            episode_id="episode-1",
            checkpoint_id="checkpoint-1",
            input_sha256=HASH,
        ),
        history_refs=(),
        history_outcomes=(),
        budget_snapshot=_budget(),
        incumbent=None,
        planner_payload_sha256=HASH,
    )
    audit = OptimizationDecisionAudit(root)
    persisted = rejection_feedback_entry("proposal_action")
    audit.append(
        planning_entry_sha256=planning_entry.entry_sha256,
        proposal=None,
        validation_result="rejected",
        rejection_reason="proposal_action",
        attribution=persisted,
        requested=None,
        state=OptimizationEpisodeState.PLANNING,
    )

    entries = build_planning_feedback(
        prior_decisions=audit.replay().entries,
        history=(),
        legal_actions=(),
    )

    assert entries[0] == persisted
