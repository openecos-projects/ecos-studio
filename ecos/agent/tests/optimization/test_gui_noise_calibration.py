"""Starting an optimization without a calibrated noise epsilon auto-calibrates."""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest

from ecos_agent.gui.provider import EcosAgentProvider
from tests.optimization.test_gui_episode_provider import (
    _FakeCodexProvider,
    _FailingRunner,
    _baseline,
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
