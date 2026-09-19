from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.gui.session import ProviderSession
from ecos_agent.optimization.contracts import OptimizationEpisodeState
from ecos_agent.optimization.controller import OptimizationControlResult


@pytest.mark.parametrize(
    ("state", "phase", "status"),
    [
        (OptimizationEpisodeState.ESCALATED, "error", "error"),
        (OptimizationEpisodeState.QUARANTINED, "quarantined", "error"),
        (OptimizationEpisodeState.STOPPED, "stopped", "interrupted"),
        (OptimizationEpisodeState.TERMINAL, "completed", "idle"),
    ],
)
@pytest.mark.parametrize("already_terminal", [False, True])
def test_optimization_terminal_state_is_reported_before_next_operation(
    tmp_path: Path, state: OptimizationEpisodeState, phase: str, status: str,
    already_terminal: bool,
) -> None:
    events = []
    closed = []
    provider = EcosAgentProvider(emit=events.append)
    session = ProviderSession(
        session_id="session-1", mode="workspace", phase="optimization_running",
        optimization_phase="running", optimization_episode_id="episode-1",
        rerun_workspace_path=str(tmp_path), workspace_handle="handle-1", workspace_revision=3,
        optimization_objective={"original": "route_wirelength"},
        optimization_primary_metric="route_wirelength",
        optimization_active_objective={
            "active_primary_metric": "sta_hold_violation_count", "recovery_stage": "hold",
            "drc_count": 0, "sta_setup_violation_count": 0, "sta_hold_violation_count": 442,
        },
    )
    provider.sessions[session.session_id] = session
    runner = SimpleNamespace(
        state=state if already_terminal else OptimizationEpisodeState.CREATED,
        episode_id="episode-1", pending_execution_ids=(), incumbent_candidate_root_ref=None,
        recovery_incomplete=True, close=lambda: closed.append("runner"),
    )

    def run_turn(*, paused: bool):
        assert not paused
        runner.state = state
        return SimpleNamespace(
            planning=OptimizationControlResult(state, rejection_reason="proposal_repair_failed"),
            execution=None, incumbent_comparison=None,
        )

    runner.run_turn = run_turn
    session.optimization_runner = runner
    session.optimization_provider = SimpleNamespace(close=lambda: closed.append("provider"))
    if already_terminal:
        session.optimization_pause.set()
    provider._run_optimization_episode(session)

    assert session.optimization_phase == phase
    assert session.phase == "operation"
    assert closed == ["runner", "provider"]
    assert (session.rerun_workspace_path, session.workspace_handle, session.workspace_revision) == (
        str(tmp_path), "handle-1", 3,
    )
    assert session.optimization_objective == {"original": "route_wirelength"}
    statuses = [event["status"] for event in events if event["type"] == "status"]
    assert statuses[-1] == status
    terminal = [event for event in events if event["type"] == "optimization"][-1]["optimization"]
    assert terminal["state"] == (state.value if status == "error" else phase)
    assert terminal["violation_counts"]["sta_hold_violation_count"] == 442
    assert terminal["original_objective"] == session.optimization_objective
    assert terminal["original_primary_metric"] == "route_wirelength"
    errors = [event for event in events if event["type"] == "error"]
    assert bool(errors) == (status == "error")
    if status == "error":
        assert "Optimization stopped" in errors[-1]["text"]
        assert events.index(errors[-1]) < next(
            index for index, event in enumerate(events) if event["type"] == "interaction"
        )
        if not already_terminal:
            assert "proposal_repair_failed" in errors[-1]["text"]
    assert not any(event["type"] == "workspace_rerun" for event in events)


def test_optimization_exception_updates_card_and_chat_error(tmp_path: Path) -> None:
    events = []
    provider = EcosAgentProvider(emit=events.append)
    session = ProviderSession(session_id="session-1", mode="workspace", phase="optimization_running")
    provider.sessions[session.session_id] = session

    def fail_turn(*, paused: bool):
        raise ValueError("provider request timed out")

    session.optimization_runner = SimpleNamespace(
        state=OptimizationEpisodeState.CREATED, episode_id="episode-1",
        pending_execution_ids=(), close=lambda: None, run_turn=fail_turn,
        recovery_incomplete=False,
    )
    provider._run_optimization_episode(session)

    assert session.optimization_phase == "error"
    error = next(event for event in events if event["type"] == "error")
    assert "provider request timed out" in error["text"]
    terminal = next(event for event in events if event["type"] == "optimization")["optimization"]
    assert terminal["state"] == "error"
    assert "provider request timed out" in terminal["rejection_reason"]


def test_optimization_cleanup_failure_still_reports_error_and_releases_session() -> None:
    events = []
    closed = []
    provider = EcosAgentProvider(emit=events.append)
    session = ProviderSession(session_id="session-1", mode="workspace", language="zh")
    provider.sessions[session.session_id] = session

    def fail_close():
        raise OSError("audit manifest write failed")

    session.optimization_runner = SimpleNamespace(
        state=OptimizationEpisodeState.TERMINAL, episode_id="episode-1",
        pending_execution_ids=(), close=fail_close, recovery_incomplete=False,
    )
    session.optimization_provider = SimpleNamespace(close=lambda: closed.append("provider"))
    provider._run_optimization_episode(session)

    assert session.optimization_phase == "error"
    assert session.optimization_runner is None
    assert session.optimization_provider is None
    assert closed == ["provider"]
    error = next(event for event in events if event["type"] == "error")
    assert "优化已停止" in error["text"]
    assert "audit manifest write failed" in error["text"]
