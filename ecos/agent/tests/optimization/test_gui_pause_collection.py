"""Pause must stop new dispatch but keep collecting in-flight terminals."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.optimization.contracts import OptimizationEpisodeState
from tests.optimization.test_gui_episode_provider import (
    _CompletedRunner,
    _FakeCodexProvider,
    _baseline,
    _make_optimization_workspace,
    _send,
)


@pytest.fixture(autouse=True)
def _terminal_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.build_terminal_observation",
        lambda _workspace: _baseline(),
    )


class _PauseCollectRunner(_CompletedRunner):
    """Pause holds dispatch; the in-flight terminal is still collected."""

    def __init__(self) -> None:
        super().__init__()
        self.turns = 0
        self.paused_flags: list[bool] = []
        self.turn1_ready = threading.Event()
        self.release_turn1 = threading.Event()

    def run_turn(self, *, paused: bool = False):
        self.paused_flags.append(paused)
        self.turns += 1
        if self.turns == 1:
            turn = SimpleNamespace(
                planning=SimpleNamespace(
                    state=OptimizationEpisodeState.EXECUTING,
                    proposal=None,
                    requested=None,
                    rejection_reason=None,
                ),
                execution=SimpleNamespace(state=OptimizationEpisodeState.EXECUTING),
                incumbent_comparison=None,
            )
            # Hold turn 1 until the test has paused, so turn 2 is dispatched
            # with paused=True instead of racing the episode to completion.
            self.turn1_ready.set()
            assert self.release_turn1.wait(timeout=2)
            self._controller.state = OptimizationEpisodeState.EXECUTING
            self._controller.pending_execution_ids = ("execution-1",)
            return turn
        if paused:
            self._controller.pending_execution_ids = ()
            self._controller.state = OptimizationEpisodeState.PLANNING
            return SimpleNamespace(
                planning=SimpleNamespace(
                    state=OptimizationEpisodeState.PLANNING,
                    proposal=None,
                    requested=None,
                    rejection_reason=None,
                ),
                execution=None,
                incumbent_comparison=None,
            )
        return super().run_turn()


def test_gui_pause_still_collects_in_flight_terminals(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    runner = _PauseCollectRunner()
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: runner,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")
    # Turn 1 holds until the pause command has been accepted, so turn 2 is
    # dispatched under pause and can never race the episode finishing.
    assert runner.turn1_ready.wait(timeout=2)

    provider.send_message({"sessionId": session_id, "message": "pause"})
    runner.release_turn1.set()
    deadline = time.monotonic() + 2
    while runner.turns < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    session = provider.sessions[session_id]
    assert session.optimization_phase == "paused"
    assert runner.paused_flags == [False, True]
    # The in-flight candidate's terminal was merged during the pause instead
    # of waiting for resume; no new dispatch happened while paused.
    assert runner._controller.pending_execution_ids == ()

    provider.send_message({"sessionId": session_id, "message": "resume"})
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)
    assert runner.paused_flags == [False, True, False]
    assert session.optimization_phase == "completed"
