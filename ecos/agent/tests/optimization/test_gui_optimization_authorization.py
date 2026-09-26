from __future__ import annotations

import threading
from pathlib import Path

import pytest

from ecos_agent.codex.provider import CodexProviderError
from ecos_agent.gui.provider import EcosAgentProvider
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


def test_gui_optimization_decline_expires_authorization_without_an_episode(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: _CompletedRunner(),
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce routed wirelength")
    session = provider.sessions[session_id]
    pending = session.pending_interaction
    assert pending is not None
    request_id = pending["request"]["requestId"]
    assert session.optimization_episode_id is None
    assert not any(event["type"] == "optimization" for event in events)
    _send(provider, session_id, "2")
    assert session.phase == "operation"
    assert session.optimization_phase == "idle"
    assert session.optimization_episode_id is None
    assert session.interaction_history[request_id] == "cancelled"
    assert not any(event["type"] == "optimization" for event in events)


def test_gui_interrupt_expires_pending_authorization_and_allows_retry(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    provider = EcosAgentProvider(
        emit=lambda _event: None,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: _CompletedRunner(),
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]
    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce routed wirelength")
    request_id = provider.sessions[session_id].pending_interaction["request"]["requestId"]
    provider.interrupt({"sessionId": session_id})
    session = provider.sessions[session_id]
    assert session.phase == "operation"
    assert session.interaction_history[request_id] == "cancelled"
    _send(provider, session_id, "3")
    assert session.phase == "optimization_objective"

def test_gui_optimization_objective_interrupt_allows_retry(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    started = threading.Event()
    released = threading.Event()
    interrupted_provider = _FakeCodexProvider()
    retry_provider = _FakeCodexProvider()

    def interrupt() -> None:
        interrupted_provider.interrupted += 1
        released.set()

    def block(_goal: str) -> dict[str, object]:
        started.set()
        assert released.wait(timeout=2)
        raise CodexProviderError("Codex turn interrupted", failure_class="interrupted")

    interrupted_provider.interrupt = interrupt
    interrupted_provider.propose_optimization_objective = block
    providers = iter((interrupted_provider, retry_provider))
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: next(providers),
        optimization_runner_factory=lambda _context, _planner: _CompletedRunner(),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    errors: list[Exception] = []

    def send_objective() -> None:
        try:
            _send(provider, session_id, "reduce routed wirelength")
        except Exception as exc:  # pragma: no cover - retained for thread diagnostics
            errors.append(exc)

    turn = threading.Thread(target=send_objective)
    turn.start()
    assert started.wait(timeout=2)
    provider.interrupt({"sessionId": session_id})
    turn.join(timeout=2)

    session = provider.sessions[session_id]
    assert not turn.is_alive()
    assert errors == []
    assert session.phase == "optimization_objective"
    assert session.optimization_phase == "awaiting_objective"
    assert interrupted_provider.closed == 1
    assert not any(event["type"] == "error" for event in events)

    _send(provider, session_id, "reduce routed wirelength")

    assert retry_provider.objective_requests == ["reduce routed wirelength"]
    assert session.phase == "optimization_authorization"


def test_gui_pre_dispatch_start_failure_finishes_the_episode(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []

    def fail_start(_context: dict[str, object], _planner: object) -> object:
        raise RuntimeError("ECC adapter unavailable")

    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=fail_start,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]
    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce routed wirelength")
    _send(provider, session_id, "1")

    session = provider.sessions[session_id]
    assert session.optimization_phase == "error"
    assert any(
        event.get("optimization", {}).get("state") == "failed"
        for event in events
    )
