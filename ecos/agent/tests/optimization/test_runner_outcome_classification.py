from __future__ import annotations

from pathlib import Path


from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationEpisodeState,
    OptimizationObjectiveProposal,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.ledger import (
    OptimizationLedger,
    OptimizationOutcomeKind,
)
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.rules import (
    IncumbentDecision,
    freeze_optimization_objective,
    freeze_routability_objective,
)
from ecos_agent.optimization.runner import OptimizationEpisodeRunner

_HASH = "sha256:" + "a" * 64
_CHUNK_HASH = "b" * 64
_CURRENT_VALUES = {
    "place.target_density": 0.2,
    "place.target_overflow": 0.1,
    "place.cell_padding_x": 2,
    "place.routability_opt": True,
    "place.density_weight": 0.00085,
    "floorplan.core_util": 0.6,
    "floorplan.aspect_ratio": 1.0,
}
_TIMING_GUARDRAIL = {metric: 0.0 for metric in TimingMetric}



from tests.optimization.runner_support import (
    _Clock,
    _evidence,
    _FakeExecutor,
    _FakePlanner,
    _MissingTerminalExecutor,
    _RaisingTerminalExecutor,
    _SuccessfulExecutor,
    _budget,
    _execution_context,
    _incumbent,
    _native_receipt,
    _objective,
    _observation,
    _proposal,
    _retrieval,
    _terminal_observation,
)


def _recovery_terminal(
    execution_id: str, *, drc: int, setup: int, hold: int
) -> TerminalObservation:
    terminal = _terminal_observation(
        _observation(_budget()),
        CandidateExecutionReceipt(execution_id=execution_id, started=True),
    )
    counts = {
        "drc_count": drc,
        "sta_setup_violation_count": setup,
        "sta_hold_violation_count": hold,
    }
    return terminal.model_copy(
        update={
            "evaluation_metrics": tuple(
                item.model_copy(update={"value": counts.get(item.metric_id, item.value)})
                for item in terminal.evaluation_metrics
            ),
            "signoff_gates": terminal.signoff_gates.model_copy(
                update={
                    "drc_clean": GateResult.PASS if drc == 0 else GateResult.FAIL,
                    "sta_setup_closed": (
                        GateResult.PASS if setup == 0 else GateResult.FAIL
                    ),
                    "sta_hold_closed": (
                        GateResult.PASS if hold == 0 else GateResult.FAIL
                    ),
                }
            ),
        }
    )


class _RecoveryPlanner(_FakePlanner):
    def propose(self, context):
        self.contexts.append(context)
        return _proposal(
            context,
            "place.target_density",
            StrategyDirection.DECREASE,
            history_refs=[item.reference.model_dump() for item in context.history],
        )

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
        execution_context=_execution_context(),
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
        execution_context=_execution_context(),
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


def test_ineligible_candidate_is_classified_without_an_incumbent(
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


def test_incomplete_terminal_metrics_are_not_compared_or_promoted(
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
    )

    def incomplete_observation(
        observation: StageObservation, receipt: CandidateExecutionReceipt
    ) -> TerminalObservation:
        return _terminal_observation(observation, receipt).model_copy(
            update={"evaluation_metrics_complete": False}
        )

    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=incomplete_observation,
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


def test_runner_promotes_progressive_recovery_and_switches_to_original_objective(
    tmp_path: Path,
) -> None:
    planner = _RecoveryPlanner()
    executor = _FakeExecutor()
    executor.start_receipts = iter(
        CandidateExecutionReceipt(execution_id=f"execution-{index}", started=True)
        for index in range(1, 5)
    )
    requested_values = (0.15, 0.75, 0.7, 0.65)
    effective_values = (0.8, 0.75, 0.7, 0.65)
    executor.terminal_receipts = iter(
        CandidateExecutionReceipt(
            execution_id=f"execution-{index}",
            started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
            evidence=_evidence(f"execution-{index}"),
            parameter_application_receipt=_native_receipt(
                "place.target_density",
                requested,
                effective_value=effective,
            ),
        )
        for index, (requested, effective) in enumerate(
            zip(requested_values, effective_values, strict=True),
            start=1,
        )
    )
    baseline = _recovery_terminal("execution-0", drc=4, setup=2, hold=1)
    objective = freeze_optimization_objective(
        "reduce routed wirelength",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            rationale_summary="Reduce routed wirelength.",
        ),
    )
    alignment = build_objective_alignment(objective, baseline)
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
        incumbent=baseline,
        objective=objective,
        objective_alignment=alignment,
    )
    candidates = iter(((2, 2, 1), (0, 2, 1), (0, 0, 1), (0, 0, 0)))

    def terminal_observation(_observation, receipt):
        drc, setup, hold = next(candidates)
        return _recovery_terminal(
            receipt.execution_id, drc=drc, setup=setup, hold=hold
        )

    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=terminal_observation,
        objective=freeze_routability_objective(
            baseline, objective_alignment=alignment
        ),
        site_width_dbu=200,
    )

    turns = tuple(runner.run_turn() for _ in range(4))

    assert [turn.active_objective_after.recovery_stage for turn in turns] == [
        "drc",
        "setup",
        "hold",
        "original",
    ]
    assert all(
        turn.incumbent_comparison is not None
        and turn.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_BETTER
        for turn in turns
    )
    assert executor.requests[1].parent_candidate_root_ref == (
        ".agent/candidates/execution-1"
    )
    assert planner.contexts[1].current_values["place.target_density"] == 0.8
    assert controller.incumbent == turns[-1].terminal_observation
    assert runner.recovery_incomplete is False
    outcomes = controller.ledger.replay().terminal_outcomes
    assert outcomes[1].recovery_transition == "drc_to_setup"
    assert outcomes[-1].recovery_transition == "hold_to_original"
    runner.close()


def test_budget_exhaustion_stops_incomplete_recovery(tmp_path: Path) -> None:
    baseline = _recovery_terminal("execution-0", drc=1, setup=0, hold=0)
    objective = freeze_optimization_objective(
        "reduce routed wirelength",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            rationale_summary="Reduce routed wirelength.",
        ),
    )
    alignment = build_objective_alignment(objective, baseline)
    budget = _budget().model_copy(update={"consumed_candidates": 20})
    controller = OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=budget,
        planner=object(),
        executor=object(),
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=baseline,
        objective=objective,
        objective_alignment=alignment,
    )

    result = controller.plan(
        _observation(budget),
        _retrieval(_observation(budget), None),
        _CURRENT_VALUES,
    )

    assert result.state == OptimizationEpisodeState.STOPPED
    assert result.rejection_reason == "recovery_incomplete"


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
        execution_context=_execution_context(),
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
        execution_context=_execution_context(),
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
