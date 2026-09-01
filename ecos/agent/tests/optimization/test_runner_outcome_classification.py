from __future__ import annotations

from pathlib import Path


from ecos_agent.optimization.contracts import (
    GateResult,
    OptimizationEpisodeState,
    SignoffGates,
    StageObservation,
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
from ecos_agent.optimization.rules import (
    IncumbentDecision,
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
    "synth.max_fanout": 32,
}
_TIMING_GUARDRAIL = {metric: 0.0 for metric in TimingMetric}



from tests.optimization.runner_support import (
    _Clock,
    _FakePlanner,
    _MissingTerminalExecutor,
    _RaisingTerminalExecutor,
    _SuccessfulExecutor,
    _budget,
    _execution_context,
    _incumbent,
    _objective,
    _observation,
    _retrieval,
    _terminal_observation,
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


def test_eligible_candidate_initializes_from_exempt_ineligible_baseline(
    tmp_path: Path,
) -> None:
    planner = _FakePlanner()
    executor = _SuccessfulExecutor()
    baseline = _incumbent().model_copy(
        update={"signoff_gates": SignoffGates.all(GateResult.FAIL)}
    )
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
    )
    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=freeze_routability_objective(
            baseline, allow_ineligible_baseline=True
        ),
        baseline_eligibility_exempt=True,
    )

    turn = runner.run_turn()

    assert turn.incumbent_comparison is not None
    assert turn.incumbent_comparison.decision == IncumbentDecision.INITIALIZED
    assert controller.incumbent == turn.terminal_observation
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
