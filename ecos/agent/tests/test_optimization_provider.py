from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

from ecos_agent.optimization_contracts import OptimizationEpisodeState
from ecos_agent.optimization_runner import OptimizationEpisodeRunner
from ecos_agent.provider import EcosAgentProvider


class _FakeCodexProvider:
    def __init__(self) -> None:
        self.interrupted = 0
        self.closed = 0

    def interrupt(self) -> None:
        self.interrupted += 1

    def close(self) -> None:
        self.closed += 1


class _FailingRunner(OptimizationEpisodeRunner):
    def __init__(self) -> None:
        self._controller = SimpleNamespace(
            state=OptimizationEpisodeState.PLANNING,
            episode_id="episode-test",
        )

    def run_turn(self):
        raise RuntimeError("test stop")


def test_gui_optimization_authorization_holds_and_closes_codex_provider(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    fake_provider = _FakeCodexProvider()
    factory_calls: list[dict[str, object]] = []

    def provider_factory(**kwargs: object) -> _FakeCodexProvider:
        factory_calls.append(kwargs)
        return fake_provider

    def runner_factory(context: dict[str, object], planner: object) -> _FailingRunner:
        factory_calls.append({"context": context, "planner": planner})
        return _FailingRunner()

    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=provider_factory,
        optimization_runner_factory=runner_factory,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "4"})
    assert provider.sessions[session_id].phase == "optimization_authorization"
    provider.send_message({"sessionId": session_id, "message": "1"})

    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    session = provider.sessions[session_id]
    assert session.optimization_phase == "error"
    assert fake_provider.closed == 1
    assert factory_calls[0]["cwd"] == workspace
    assert factory_calls[0]["diagnostics_path"] == (
        workspace
        / ".agent"
        / "optimization"
        / session.optimization_episode_id
        / "codex-rpc-diagnostics.v1.jsonl"
    )
    assert factory_calls[1]["context"]["episode_id"] == session.optimization_episode_id
    assert any(event["type"] == "optimization" for event in events) is False
    assert any(event["type"] == "error" and "test stop" in str(event["text"]) for event in events)


def test_gui_optimization_fails_closed_without_runner_factory(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    provider.send_message({"sessionId": session_id, "message": "4"})
    provider.send_message({"sessionId": session_id, "message": "1"})

    session = provider.sessions[session_id]
    assert session.optimization_phase == "unavailable"
    assert session.phase == "operation"
    assert any(event["type"] == "error" and "not configured" in str(event["text"]) for event in events)
