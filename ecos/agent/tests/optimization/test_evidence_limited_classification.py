"""EVIDENCE_LIMITED adjudication: missing evidence is never a physical loss."""

from __future__ import annotations

from pathlib import Path

from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    StageObservation,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.controller_models import OptimizationAgentMode
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
)
from ecos_agent.optimization.observations import OptimizationObservationError
from ecos_agent.optimization.rules import (
    IncumbentDecision,
    classify_terminal_candidate,
    freeze_optimization_objective,
    freeze_routability_objective,
)
from ecos_agent.optimization.runner import OptimizationEpisodeRunner

from ecos_agent.optimization.contracts import OptimizationEpisodeState
from tests.optimization.runner_support import (
    _Clock,
    _FakePlanner,
    _SuccessfulExecutor,
    _budget,
    _execution_context,
    _incumbent,
    _native_receipt,
    _objective,
    _observation,
    _retrieval,
    _terminal_observation,
)

_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
}


def _v3_candidate() -> TerminalObservation:
    receipt = CandidateExecutionReceipt(execution_id="execution-9", started=True)
    return _terminal_observation(_observation(_budget()), receipt)


def _classification(
    candidate: TerminalObservation,
    *,
    incumbent: TerminalObservation | None = None,
    semantic_objective=None,
):
    return classify_terminal_candidate(
        execution_outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        candidate=candidate,
        incumbent=incumbent,
        objective=freeze_routability_objective(incumbent or candidate),
        semantic_objective=semantic_objective,
        requested=None,
        parameter_receipt=None,
        baseline_geometry=candidate.geometry,
    )


def test_unavailable_gate_is_evidence_limited_not_ineligible(
    tmp_path: Path,
) -> None:
    candidate = _v3_candidate().model_copy(
        update={
            "signoff_gates": _v3_candidate().signoff_gates.model_copy(
                update={"lvs_clean": GateResult.UNAVAILABLE}
            )
        }
    )
    classification = _classification(candidate, incumbent=_incumbent())
    assert classification.comparison.decision == IncumbentDecision.EVIDENCE_LIMITED
    assert classification.outcome == OptimizationOutcomeKind.EVIDENCE_INVALID
    assert not classification.promote


def test_failed_gate_stays_a_physical_ineligibility(tmp_path: Path) -> None:
    candidate = _v3_candidate().model_copy(
        update={
            "signoff_gates": _v3_candidate().signoff_gates.model_copy(
                update={"lvs_clean": GateResult.FAIL}
            )
        }
    )
    classification = _classification(candidate, incumbent=_incumbent())
    assert classification.comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    assert classification.outcome == OptimizationOutcomeKind.CANDIDATE_INELIGIBLE


def test_consistency_contradiction_is_evidence_limited() -> None:
    candidate = _v3_candidate().model_copy(
        update={"consistency_violations": ("c1_route_wirelength_below_hpwl",)}
    )
    classification = _classification(candidate, incumbent=_incumbent())
    assert classification.comparison.decision == IncumbentDecision.EVIDENCE_LIMITED
    assert classification.outcome == OptimizationOutcomeKind.EVIDENCE_INVALID


def test_missing_primary_metric_is_evidence_limited() -> None:
    from ecos_agent.optimization.metrics.contracts import (
        EvaluationMetricCategory,
        EvaluationMetricDirection,
        EvaluationMetricRole,
        TerminalEvaluationMetric,
    )

    power_record = TerminalEvaluationMetric(
        metric_id="sta_typical_dynamic_power",
        value=105.2,
        unit="uW",
        category=EvaluationMetricCategory.PPA,
        role=EvaluationMetricRole.REPORT,
        direction=EvaluationMetricDirection.LOWER_IS_BETTER,
        source_refs=("sta_ecc/feature/TYP_25/TYPICAL/power_summary.json",),
    )
    incumbent = _v3_candidate().model_copy(
        update={"evaluation_metrics": (*_v3_candidate().evaluation_metrics, power_record)}
    )
    semantic = freeze_optimization_objective(
        "reduce dynamic power",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.STA_TYPICAL_DYNAMIC_POWER,
            rationale_summary="Reduce signoff dynamic power.",
        ),
    )
    # The candidate carries no power evaluation record, so the primary
    # metric is absent: missing evidence, not a physical failure.
    candidate = _v3_candidate()
    classification = _classification(
        candidate, incumbent=incumbent, semantic_objective=semantic
    )
    assert classification.comparison.decision == IncumbentDecision.EVIDENCE_LIMITED
    assert classification.comparison.decisive_metric == (
        ObjectiveMetric.STA_TYPICAL_DYNAMIC_POWER
    )


def test_corrupt_candidate_artifacts_keep_the_episode_running(
    tmp_path: Path,
) -> None:
    planner = _FakePlanner()
    executor = _SuccessfulExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=_incumbent(),
    )

    def corrupt_observation(
        observation: StageObservation, receipt: CandidateExecutionReceipt
    ) -> TerminalObservation:
        raise OptimizationObservationError("workspace evidence JSON is invalid")

    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=corrupt_observation,
        objective=_objective(),
    )

    turn = runner.run_turn()

    outcomes = controller.ledger.replay().terminal_outcomes
    assert outcomes[0].outcome == OptimizationOutcomeKind.EVIDENCE_INVALID
    assert outcomes[0].incumbent_decision == IncumbentDecision.EVIDENCE_LIMITED.value
    assert turn.incumbent_comparison is not None
    assert (
        turn.incumbent_comparison.decision == IncumbentDecision.EVIDENCE_LIMITED
    )
    # The candidate is absorbed without quarantining the episode: the loop
    # keeps planning instead of halting on one corrupt artifact set.
    assert controller.state in {
        OptimizationEpisodeState.PLANNING,
        OptimizationEpisodeState.EXECUTING,
        OptimizationEpisodeState.AWAITING_EXECUTION,
    }
    # The incumbent survives the evidence gap untouched.
    assert controller.incumbent is not None
    assert controller.incumbent.observation_id == "terminal-baseline"
    runner.close()


def test_ledger_accepts_evidence_limited_under_evidence_invalid(
    tmp_path: Path,
) -> None:
    # The outcome-decision consistency map must admit the new decision under
    # the existing EVIDENCE_INVALID outcome kind.
    from ecos_agent.optimization.ledger import OptimizationTerminalOutcome

    OptimizationTerminalOutcome.model_validate(
        {
            "intervention_id": "intervention-1",
            "outcome": OptimizationOutcomeKind.EVIDENCE_INVALID.value,
            "candidate_manifest_sha256": "sha256:" + "a" * 64,
            "incumbent_decision": IncumbentDecision.EVIDENCE_LIMITED.value,
            "outcome_details_sha256": "sha256:" + "c" * 64,
            "target_step": "place",
            "end_step": "Harden",
            "execution_scope": "full_flow",
        }
    )
