from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.hashing import canonical_sha256
from tests.optimization.test_gui_episode_provider import (
    _BlockingRunner,
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


def _wait_for_episode(provider: EcosAgentProvider, session_id: str) -> None:
    deadline = time.monotonic() + 2
    while (
        provider.sessions[session_id].optimization_thread is not None
        and time.monotonic() < deadline
    ):
        time.sleep(0.01)


def test_gui_safe_shutdown_drains_without_stopping_the_episode(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    lifecycle: list[str] = []
    events: list[dict[str, object]] = []
    runner = _BlockingRunner(lifecycle)
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
    assert runner.started.wait(timeout=2)

    provider.prepare_optimization_shutdown({"sessionId": session_id})
    runner.release.set()
    _wait_for_episode(provider, session_id)

    assert lifecycle == ["terminal-ledger", "runner-close"]
    assert provider.sessions[session_id].optimization_phase == "interrupted"
    assert any(
        event.get("optimization", {}).get("state") == "interrupted"
        for event in events
    )


def test_gui_pause_and_resume_update_running_session_control_state(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    lifecycle: list[str] = []
    runner = _BlockingRunner(lifecycle)
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
    assert runner.started.wait(timeout=2)

    provider.start_session(
        {"directory": str(workspace), "mode": "workspace", "sessionId": session_id}
    )
    assert provider.sessions[session_id].phase == "optimization_running"

    provider.send_message({"sessionId": session_id, "message": "pause"})
    session = provider.sessions[session_id]
    assert session.optimization_phase == "paused"
    assert session.optimization_pause.is_set()
    assert next(event for event in reversed(events) if event["type"] == "status")[
        "status"
    ] == "awaiting_choice"

    provider.send_message({"sessionId": session_id, "message": "resume"})
    assert session.optimization_phase == "running"
    assert not session.optimization_pause.is_set()
    assert next(event for event in reversed(events) if event["type"] == "status")[
        "status"
    ] == "running"

    provider.send_message({"sessionId": session_id, "message": "stop"})
    _wait_for_episode(provider, session_id)
    assert lifecycle == ["request-stop", "terminal-ledger", "runner-close"]


def test_gui_resumes_an_episode_in_a_fresh_provider_process(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    first_runner = _BlockingRunner([])
    first_provider = EcosAgentProvider(
        emit=lambda _event: None,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: first_runner,
    )
    session_id = first_provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "sessionId": "session-resume",
            "workspaceId": "workspace-handle-1",
            "workspaceRevision": 7,
        }
    )["sessionId"]
    _send(first_provider, session_id, "3")
    _send(first_provider, session_id, "reduce wirelength")
    _send(first_provider, session_id, "1")
    episode_id = first_provider.sessions[session_id].optimization_episode_id
    assert episode_id is not None
    assert first_runner.started.wait(timeout=2)
    assert (
        workspace
        / ".agent"
        / "optimization"
        / episode_id
        / "provider-resume-context.v1.json"
    ).is_file()
    persisted_context = json.loads(
        (
            workspace
            / ".agent"
            / "optimization"
            / episode_id
            / "provider-resume-context.v1.json"
        ).read_text(encoding="utf-8")
    )
    assert persisted_context["parameter_policy_sha256"] == canonical_sha256(
        persisted_context["objective"]["parameter_policy"]
    )
    assert persisted_context["ecc_revision"] == "ecc-test"

    first_runner.release.set()
    _wait_for_episode(first_provider, session_id)

    resumed_contexts: list[dict[str, object]] = []
    resumed_provider = EcosAgentProvider(
        emit=lambda _event: None,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda context, _planner: (
            resumed_contexts.append(context) or _CompletedRunner()
        ),
    )
    resumed_provider.resume_optimization_episode(
        {
            "directory": str(workspace),
            "episodeId": episode_id,
            "sessionId": session_id,
            "workspaceId": "workspace-handle-2",
            "workspaceRevision": 7,
        }
    )

    _wait_for_episode(resumed_provider, session_id)
    assert len(resumed_contexts) == 1
    assert resumed_contexts[0]["episode_id"] == episode_id
    assert resumed_contexts[0]["expected_workspace_revision"] == 7
    assert resumed_contexts[0]["workspace"] == str(workspace)
    assert resumed_contexts[0]["workspace_handle"] == "workspace-handle-2"
    assert resumed_contexts[0]["expected_ecc_revision"] == "ecc-test"


def test_gui_stops_a_recoverable_episode_in_a_fresh_provider_process(
    tmp_path: Path,
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    first_runner = _BlockingRunner([])
    first_provider = EcosAgentProvider(
        emit=lambda _event: None,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: first_runner,
    )
    session_id = first_provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "sessionId": "session-stop",
            "workspaceId": "workspace-handle-1",
            "workspaceRevision": 7,
        }
    )["sessionId"]
    _send(first_provider, session_id, "3")
    _send(first_provider, session_id, "reduce wirelength")
    _send(first_provider, session_id, "1")
    episode_id = first_provider.sessions[session_id].optimization_episode_id
    assert episode_id is not None
    assert first_runner.started.wait(timeout=2)
    first_provider.prepare_optimization_shutdown({"sessionId": session_id})
    first_runner.release.set()
    _wait_for_episode(first_provider, session_id)

    # A calibration-only interrupted episode has no controller ledger to close.
    # The provider context remains the durable authority for the explicit Stop.
    (workspace / ".agent" / "optimization" / "noise-epsilon.v1.json").unlink()
    events: list[dict[str, object]] = []
    stopped_provider = EcosAgentProvider(emit=events.append)
    stopped_provider.stop_optimization_episode(
        {
            "directory": str(workspace),
            "episodeId": episode_id,
            "sessionId": session_id,
            "workspaceId": "workspace-handle-2",
            "workspaceRevision": 7,
        }
    )

    context = json.loads(
        (
            workspace
            / ".agent"
            / "optimization"
            / episode_id
            / "provider-resume-context.v1.json"
        ).read_text(encoding="utf-8")
    )
    assert context["terminal_state"] == "stopped"
    assert stopped_provider.sessions[session_id].optimization_phase == "stopped"
    assert any(
        event.get("optimization", {}).get("state") == "stopped" for event in events
    )
