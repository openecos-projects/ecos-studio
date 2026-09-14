"""Starting an optimization without a calibrated noise epsilon auto-calibrates."""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest

from ecos_agent.gui.provider import EcosAgentProvider
from tests.optimization.test_gui_episode_provider import (
    _BlockingRunner,
    _FakeCodexProvider,
    _FailingRunner,
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


def _make_provider(
    events: list[dict[str, object]], runner_calls: list[object]
) -> EcosAgentProvider:
    return EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: runner_calls.append(1)
        or _FailingRunner(),
    )


def test_gui_start_auto_calibrates_missing_noise_epsilon(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    epsilon_path = workspace / ".agent" / "optimization" / "noise-epsilon.v1.json"
    events: list[dict[str, object]] = []
    calibration_calls: list[Path] = []
    runner_calls: list[object] = []

    def fake_calibrate(workspace_path: Path, **_kwargs: object) -> dict[str, object]:
        calibration_calls.append(workspace_path)
        epsilon_path.parent.mkdir(parents=True, exist_ok=True)
        epsilon_path.write_text(
            '{"schema_version": "ecos.noise_epsilon.v1", "epsilon": {}}',
            encoding="utf-8",
        )
        return {"artifact": str(epsilon_path), "replay_count": 3, "epsilon": {}}

    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.calibrate", fake_calibrate
    )
    provider = _make_provider(events, runner_calls)
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")

    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    session = provider.sessions[session_id]
    assert calibration_calls == [workspace]
    assert len(runner_calls) == 1
    assert any(
        event["type"] == "message" and "noise epsilon" in str(event["text"]).lower()
        for event in events
    )
    assert any(
        event["type"] == "error" and "test stop" in str(event["text"]) for event in events
    )


def test_gui_stop_during_noise_calibration_cancels_without_episode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    runner_calls: list[object] = []

    def fake_calibrate(
        workspace_path: Path,
        *,
        should_stop: Callable[[], bool] | None = None,
        **_kwargs: object,
    ) -> dict[str, object]:
        assert should_stop is not None
        deadline = time.monotonic() + 2
        while not should_stop() and time.monotonic() < deadline:
            time.sleep(0.01)
        raise RuntimeError("noise calibration cancelled")

    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.calibrate", fake_calibrate
    )
    provider = _make_provider(events, runner_calls)
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")
    session = provider.sessions[session_id]
    assert session.optimization_phase == "calibrating"

    provider.send_message({"sessionId": session_id, "message": "stop"})
    deadline = time.monotonic() + 2
    while session.optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    assert session.optimization_phase == "idle"
    assert session.phase == "operation"
    assert runner_calls == []
    assert any(
        event["type"] == "message" and "Cancelled" in str(event["text"])
        for event in events
    )


def test_gui_optimization_turns_stream_progress_to_the_chat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization._TURN_HEARTBEAT_SECONDS", 0.05
    )
    events: list[dict[str, object]] = []
    lifecycle: list[str] = []
    runner = _BlockingRunner(lifecycle)
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: runner,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")
    assert runner.started.wait(timeout=2)

    deadline = time.monotonic() + 1
    while time.monotonic() < deadline and not any(
        event["type"] == "tool" and "in progress" in str(event.get("text", ""))
        for event in events
    ):
        time.sleep(0.01)
    runner.release.set()

    assert any(
        event["type"] == "tool"
        and "requesting a proposal (planning)" in str(event.get("text", ""))
        for event in events
    )
    assert any(
        event["type"] == "tool" and "in progress" in str(event.get("text", ""))
        for event in events
    )


def test_gui_optimization_streams_turn_events_to_the_chat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    lifecycle: list[str] = []
    runner = _BlockingRunner(lifecycle)
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: runner,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")
    assert runner.started.wait(timeout=2)
    # The fake run_turn bypasses real emission points; simulate one proposal
    # event through the listener the GUI provider installed.
    assert runner.event_listener is not None
    runner.event_listener(
        "proposal",
        {
            "proposal_decision": "propose",
            "proposal_reason": "observation",
            "rationale_summary": "Increase padding to reduce DRC.",
            "action": {"knob_id": "place.cell_padding_x", "direction": "increase"},
            "requested": {"knob_id": "place.cell_padding_x", "value": 3},
            "rejection_reason": None,
        },
    )
    runner.event_listener(
        "ecc_step",
        {
            "operation_id": "intervention-1",
            "event_type": "step.started",
            "step": "place",
            "tool": "dreamplace",
            "step_state": "Ongoing",
        },
    )
    runner.release.set()
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and (
        time.monotonic() < deadline
    ):
        time.sleep(0.01)

    turn_events = [
        event
        for event in events
        if event["type"] == "optimization"
        and isinstance(event.get("optimization"), dict)
        and event["optimization"].get("schema_version")
        == "ecos.optimization_turn_event.v1"
    ]
    assert turn_events, "expected streamed turn events"
    proposal_payload = turn_events[0]["optimization"]
    assert proposal_payload["kind"] == "proposal"
    assert proposal_payload["episode_id"]
    assert "proposal" in str(turn_events[0]["text"]).casefold()
    assert any(
        event["optimization"].get("schema_version") == "ecos.optimization_progress.v2"
        for event in events
        if event["type"] == "optimization"
    )
    assert any(
        event["type"] == "activity"
        and isinstance(event.get("activity"), dict)
        and event["activity"].get("kind") == "tool_call"
        and event["activity"].get("tool") == "candidate-rerun"
        and event["activity"].get("progress") == "place · dreamplace"
        for event in events
    )
