from __future__ import annotations

from pathlib import Path

import pytest

from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    ExpectedEffectDirection,
    GateResult,
    KnowledgeReference,
    ObjectiveMetric,
    OptimizationDecision,
    OptimizationEpisodeState,
    ProposalReason,
    SignoffGates,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationPlanningContext,
)
from ecos_agent.optimization_ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningAuditIntegrityError,
)
from ecos_agent.optimization_retrieval import (
    KnowledgeChannel,
    KnowledgeChannelResult,
    OptimizationRetrievalRequest,
    OptimizationRetrievalResult,
)
from ecos_agent.optimization_rules import (
    IncumbentDecision,
    freeze_routability_objective,
)
from ecos_agent.optimization_runner import OptimizationEpisodeRunner

_HASH = "sha256:" + "a" * 64
_CHUNK_HASH = "b" * 64
_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
}
_TIMING_GUARDRAIL = {metric: 0.0 for metric in TimingMetric}


def _objective():
    return freeze_routability_objective(_incumbent())


class _Clock:
    def __call__(self) -> float:
        return 0.0


class _FakePlanner:
    def __init__(self) -> None:
        self.contexts: list[OptimizationPlanningContext] = []

    def propose(self, context: OptimizationPlanningContext) -> object:
        self.contexts.append(context)
        if not context.history:
            return _proposal(context, "place.cell_padding_x", StrategyDirection.INCREASE)
        assert len(context.history) == 1
        assert context.history[0].outcome == OptimizationOutcomeKind.DEGRADED
        return _proposal(
            context,
            "place.target_density",
            StrategyDirection.DECREASE,
            history_refs=[context.history[0].reference.model_dump()],
        )


class _FakeExecutor:
    def __init__(self) -> None:
        self.start_receipts = iter(
            (
                CandidateExecutionReceipt(execution_id="execution-1", started=True),
                CandidateExecutionReceipt(execution_id="execution-2", started=True),
            )
        )
        self.terminal_receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.DEGRADED,
                    evidence=_evidence("execution-1"),
                ),
                CandidateExecutionReceipt(
                    execution_id="execution-2",
                    started=True,
                    outcome=OptimizationOutcomeKind.IMPROVED,
                    evidence=_evidence("execution-2"),
                ),
            )
        )

    def start(self, request: object) -> CandidateExecutionReceipt:
        return next(self.start_receipts)

    def wait_for_terminal(self, execution_id: str) -> CandidateExecutionReceipt:
        receipt = next(self.terminal_receipts)
        assert receipt.execution_id == execution_id
        return receipt

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        raise AssertionError("the fake runner never cancels a terminal receipt")


class _MissingTerminalExecutor(_FakeExecutor):
    def __init__(self) -> None:
        super().__init__()
        self.start_receipts = iter(
            (CandidateExecutionReceipt(execution_id="execution-1", started=True),)
        )
        self.terminal_receipts = iter(
            (CandidateExecutionReceipt(execution_id="execution-1", started=True),)
        )


class _RaisingTerminalExecutor(_FakeExecutor):
    def wait_for_terminal(self, _execution_id: str) -> CandidateExecutionReceipt:
        raise RuntimeError("terminal wait failed")


class _SuccessfulExecutor(_FakeExecutor):
    def __init__(self) -> None:
        self.start_receipts = iter(
            (CandidateExecutionReceipt(execution_id="execution-1", started=True),)
        )
        self.terminal_receipts = iter(
            (
                CandidateExecutionReceipt(
                    execution_id="execution-1",
                    started=True,
                    outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
                    evidence=_evidence("execution-1"),
                ),
            )
        )


def _evidence(execution_id: str) -> CandidateExecutionEvidence:
    return CandidateExecutionEvidence(
        candidate_root_ref=f".agent/candidates/{execution_id}",
        candidate_manifest_ref=(
            f".agent/candidates/{execution_id}/analysis/candidate_workspace.v1.json"
        ),
        candidate_manifest_sha256=_HASH,
    )


def _budget() -> BudgetSnapshot:
    return BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0))


def _proposal(
    context: OptimizationPlanningContext,
    knob_id: str,
    direction: StrategyDirection,
    *,
    history_refs: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "context_ref": context.context_ref.model_dump(),
        "decision": OptimizationDecision.PROPOSE,
        "reason_code": ProposalReason.OBSERVATION,
        "rationale_summary": "Use the next bounded congestion strategy.",
        "observation_refs": [context.observation_ref.model_dump()],
        "history_refs": history_refs or [],
        "knowledge_refs": [reference.model_dump() for reference in context.knowledge_refs],
        "action": {
            "knob_id": knob_id,
            "direction": direction,
            "expected_effects": [
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                }
            ],
        },
    }


def _observation(budget: BudgetSnapshot) -> StageObservation:
    return StageObservation(
        observation_id=f"observation-{budget.consumed_candidates + 1}",
        stage="place",
        evidence_manifest_sha256=_HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        budget=budget,
    )


def _retrieval(
    observation: StageObservation,
    previous_outcome: OptimizationOutcomeKind | None,
) -> OptimizationRetrievalResult:
    reference = KnowledgeReference(entity_id="strategy.congestion.padding.v1", chunk_sha256=_CHUNK_HASH)
    request = OptimizationRetrievalRequest(
        task_id="task-1",
        current_stage=observation.stage,
        observed_metric_ids=tuple(sorted(observation.metrics)),
        previous_intervention_outcome=previous_outcome,
    )
    channel = KnowledgeChannelResult(
        channel=KnowledgeChannel.GENERAL,
        enabled=True,
        query="fixed query",
        query_sha256="c" * 64,
        corpus_sha256="d" * 64,
        answer_text="Audited congestion strategy.",
        knowledge_refs=(reference,),
    )
    return OptimizationRetrievalResult(request, (channel,), (reference,))


def _terminal_observation(
    observation: StageObservation, receipt: CandidateExecutionReceipt
) -> TerminalObservation:
    assert observation.stage == "place"
    return TerminalObservation(
        observation_id=f"terminal-{receipt.execution_id}",
        evidence_manifest_sha256="sha256:" + receipt.execution_id[-1] * 64,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 2.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 3.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 4.0,
        },
        timing_guardrail=_TIMING_GUARDRAIL,
    )


def _incumbent() -> TerminalObservation:
    return TerminalObservation(
        observation_id="terminal-baseline",
        evidence_manifest_sha256=_HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 5.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 5.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 5.0,
        },
        timing_guardrail=_TIMING_GUARDRAIL,
    )


def test_fake_runner_completes_two_replanning_turns_with_bounded_history(tmp_path: Path) -> None:
    planner = _FakePlanner()
    executor = _FakeExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        incumbent=_incumbent(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )

    first = runner.run_turn()
    second = runner.run_turn()

    assert first.execution is not None
    assert second.execution is not None
    assert controller.state == OptimizationEpisodeState.PLANNING
    assert controller.budget.consumed_candidates == 2
    assert controller.budget.consumed_planning_calls == 2
    assert first.retrieval.request.previous_intervention_outcome is None
    assert second.retrieval.request.previous_intervention_outcome == OptimizationOutcomeKind.DEGRADED
    assert planner.contexts[0].history == ()
    assert planner.contexts[1].history[0].requested.value == 3
    assert planner.contexts[1].history[0].terminal_observation is not None
    assert planner.contexts[1].history[0].terminal_observation.metrics[
        ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    ] == 3.0
    assert first.incumbent_comparison is not None
    assert first.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    assert second.incumbent_comparison is not None
    assert second.incumbent_comparison.decision == IncumbentDecision.NOISE_TIE
    assert controller.incumbent is not None
    assert controller.incumbent.observation_id == "terminal-execution-1"
    assert controller.incumbent_candidate_root_ref == ".agent/candidates/execution-1"
    assert planner.contexts[0].context_ref.input_sha256 != planner.contexts[1].context_ref.input_sha256
    assert [outcome.outcome for outcome in controller.ledger.replay().terminal_outcomes] == [
        OptimizationOutcomeKind.DEGRADED,
        OptimizationOutcomeKind.IMPROVED,
    ]
    assert all(
        outcome.terminal_observation_sha256 is not None
        for outcome in controller.ledger.replay().terminal_outcomes
    )
    assert all(
        outcome.candidate_manifest_sha256 == _HASH
        for outcome in controller.ledger.replay().terminal_outcomes
    )
    assert controller.ledger.replay().terminal_outcomes[0].incumbent_decision == (
        IncumbentDecision.CANDIDATE_BETTER.value
    )
    assert controller.ledger.replay().terminal_outcomes[0].decisive_metric == (
        ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT
    )
    planning_audit = OptimizationPlanningAudit(tmp_path / "episode").replay()
    assert [entry.history_count for entry in planning_audit.entries] == [0, 1]
    assert planning_audit.entries[1].history_refs[0].intervention_id == "intervention-1"
    assert all(
        entry.planner_payload_sha256.startswith("sha256:")
        for entry in planning_audit.entries
    )
    audit_path = tmp_path / "episode" / "optimization-planning-audit.v1.jsonl"
    audit_path.write_text(
        audit_path.read_text(encoding="utf-8").replace('"history_count":1', '"history_count":0'),
        encoding="utf-8",
    )
    with pytest.raises(OptimizationPlanningAuditIntegrityError, match="invalid hash"):
        OptimizationPlanningAudit(tmp_path / "episode").verify()
    runner.close()
    assert (controller.ledger.root / "optimization-ledger-manifest.v1.json").is_file()


def test_successful_execution_is_classified_by_qor_comparison(tmp_path: Path) -> None:
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
        incumbent=_incumbent(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )

    runner.run_turn()

    outcome = controller.ledger.replay().terminal_outcomes[0]
    assert outcome.outcome == OptimizationOutcomeKind.IMPROVED
    assert outcome.incumbent_decision == IncumbentDecision.CANDIDATE_BETTER.value


def test_timing_regression_is_audited_as_degraded(tmp_path: Path) -> None:
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
        incumbent=_incumbent(),
    )

    def timing_regressed_observation(observation, receipt):
        terminal = _terminal_observation(observation, receipt)
        timing = dict(terminal.timing_guardrail)
        timing[TimingMetric.STA_SETUP_WNS] = -0.1
        return terminal.model_copy(update={"timing_guardrail": timing})

    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=timing_regressed_observation,
        objective=_objective(),
    )

    runner.run_turn()

    outcome = controller.ledger.replay().terminal_outcomes[0]
    assert outcome.outcome == OptimizationOutcomeKind.DEGRADED
    assert outcome.decisive_metric == TimingMetric.STA_SETUP_WNS


def test_ineligible_candidate_is_classified_without_an_incumbent(tmp_path: Path) -> None:
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
    )

    def ineligible_observation(
        observation: StageObservation, receipt: CandidateExecutionReceipt
    ) -> TerminalObservation:
        terminal = _terminal_observation(observation, receipt)
        return terminal.model_copy(
            update={
                "signoff_gates": terminal.signoff_gates.model_copy(
                    update={"mpc_minimum_area": GateResult.UNAVAILABLE}
                )
            }
        )

    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=ineligible_observation,
        objective=_objective(),
    )

    turn = runner.run_turn()

    assert turn.incumbent_comparison is not None
    assert turn.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    assert controller.incumbent is None
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.CANDIDATE_INELIGIBLE
    )
    runner.close()


def test_fake_runner_quarantines_missing_terminal_receipt(tmp_path: Path) -> None:
    planner = _FakePlanner()
    executor = _MissingTerminalExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
    )

    turn = runner.run_turn()

    assert turn.execution is not None
    assert turn.execution.state == OptimizationEpisodeState.QUARANTINED
    assert turn.terminal_observation is None
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.INDETERMINATE
    )


def test_fake_runner_quarantines_terminal_waiter_exception(tmp_path: Path) -> None:
    planner = _FakePlanner()
    executor = _RaisingTerminalExecutor()
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
    )

    turn = runner.run_turn()

    assert turn.execution is not None
    assert turn.execution.state == OptimizationEpisodeState.QUARANTINED
    assert controller.ledger.replay().terminal_outcomes[0].outcome == (
        OptimizationOutcomeKind.INDETERMINATE
    )
