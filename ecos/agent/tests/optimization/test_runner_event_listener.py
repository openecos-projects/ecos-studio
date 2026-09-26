from __future__ import annotations

from pathlib import Path

from ecos_agent.optimization.controller import (
    OptimizationAgentMode,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.ledger import OptimizationLedger
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.rules import IncumbentDecision
from ecos_agent.optimization.runner import OptimizationEpisodeRunner

from tests.optimization.runner_support import (
    _CURRENT_VALUES,
    _Clock,
    _FakeExecutor,
    _FakePlanner,
    _RaisingTerminalExecutor,
    _budget,
    _execution_context,
    _incumbent,
    _objective,
    _observation,
    _retrieval,
    _terminal_observation,
)


def _runner(tmp_path: Path, planner, executor) -> OptimizationEpisodeRunner:
    controller = OptimizationEpisodeController(
        episode_id="episode-events",
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
    return OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_observation_supplier=_terminal_observation,
        objective=_objective(),
    )


def test_runner_streams_proposal_dispatch_and_terminal_events(tmp_path: Path) -> None:
    executor = _FakeExecutor()
    runner = _runner(tmp_path, _FakePlanner(), executor)
    events: list[tuple[str, dict]] = []
    runner.event_listener = lambda kind, detail: events.append((kind, detail))

    runner.run_turn()
    runner.run_turn()

    assert [kind for kind, _ in events] == [
        "proposal",
        "dispatched",
        "terminal",
        "proposal",
        "dispatched",
        "terminal",
    ]
    kind, first_proposal = events[0]
    assert kind == "proposal"
    assert first_proposal["proposal_decision"] == "propose"
    assert first_proposal["proposal_reason"] == "observation"
    assert (
        first_proposal["rationale_summary"]
        == "Use the next bounded congestion strategy."
    )
    assert first_proposal["action"]["knob_id"] == "place.cell_padding_x"
    assert first_proposal["requested"]["value"] == 3
    _, dispatched = events[1]
    assert dispatched["in_flight"] == 1
    assert dispatched["requested"]["knob_id"] == "place.cell_padding_x"
    _, terminal = events[2]
    assert terminal["outcome"] == OptimizationOutcomeKind.DEGRADED.value
    assert terminal["incumbent_decision"] == (
        IncumbentDecision.CANDIDATE_INELIGIBLE.value
    )
    runner.close()


def test_runner_listener_errors_do_not_break_the_episode(tmp_path: Path) -> None:
    executor = _FakeExecutor()
    runner = _runner(tmp_path, _FakePlanner(), executor)

    def broken_listener(_kind: str, _detail: dict) -> None:
        raise RuntimeError("listener exploded")

    runner.event_listener = broken_listener

    turn = runner.run_turn()

    assert turn.incumbent_comparison is not None
    assert turn.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    runner.close()


def test_runner_emits_indeterminate_terminal_event(tmp_path: Path) -> None:
    runner = _runner(tmp_path, _FakePlanner(), _RaisingTerminalExecutor())
    events: list[tuple[str, dict]] = []
    runner.event_listener = lambda kind, detail: events.append((kind, detail))

    runner.run_turn()

    assert [kind for kind, _ in events][-1] == "terminal"
    assert events[-1][1]["outcome"] == OptimizationOutcomeKind.INDETERMINATE.value
    assert events[-1][1]["incumbent_decision"] is None
    runner.close()
