from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import pytest

from ecos_agent.optimization.contracts import GateResult, OptimizationEpisodeState
from ecos_agent.optimization.runner import OptimizationEpisodeRunner
from ecos_agent.gui.provider import EcosAgentProvider
from tests.optimization.controller.support import _eligible_terminal


def _baseline(*, drc: int = 0, setup: int = 0, hold: int = 0):
    terminal = _eligible_terminal("terminal-Harden")
    counts = {
        "drc_count": drc,
        "sta_setup_violation_count": setup,
        "sta_hold_violation_count": hold,
    }
    evaluation = tuple(
        item.model_copy(update={"value": counts.get(item.metric_id, item.value)})
        for item in terminal.evaluation_metrics
    )
    gates = terminal.signoff_gates.model_copy(
        update={
            "drc_clean": GateResult.PASS if drc == 0 else GateResult.FAIL,
            "sta_setup_closed": GateResult.PASS if setup == 0 else GateResult.FAIL,
            "sta_hold_closed": GateResult.PASS if hold == 0 else GateResult.FAIL,
        }
    )
    return terminal.model_copy(
        update={"evaluation_metrics": evaluation, "signoff_gates": gates}
    )


@pytest.fixture(autouse=True)
def _terminal_baseline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.build_terminal_observation",
        lambda _workspace: _baseline(),
    )


def _send(provider: EcosAgentProvider, session_id: str, message: str) -> None:
    session = provider.sessions[session_id]
    pending = session.pending_interaction
    if pending is None:
        provider.send_message({"sessionId": session_id, "message": message})
        return
    for option_id, value in pending["values"].items():
        if value == message:
            provider.answer_interaction(
                {
                    "sessionId": session_id,
                    "requestId": pending["request"]["requestId"],
                    "kind": pending["request"]["kind"],
                    "optionId": option_id,
                    **(
                        {"episodeId": f"episode-{uuid.uuid4().hex}"}
                        if session.phase == "optimization_authorization" and message == "1"
                        else {}
                    ),
                }
            )
            return
    raise AssertionError(f"No pending interaction option matches {message!r}")


def _make_optimization_workspace(tmp_path: Path) -> Path:
    workspace = tmp_path / "workspace"
    optimization_dir = workspace / ".agent" / "optimization"
    optimization_dir.mkdir(parents=True)
    (optimization_dir / "noise-epsilon.v1.json").write_text(
        '{"schema_version": "ecos.noise_epsilon.v1", "epsilon": {}}',
        encoding="utf-8",
    )
    return workspace


class _FakeCodexProvider:
    def __init__(self) -> None:
        self.interrupted = 0
        self.closed = 0
        self.objective_requests: list[str] = []
        self.inherited_from: object = None

    def interrupt(self) -> None:
        self.interrupted += 1

    def close(self) -> None:
        self.closed += 1

    def inherit_model_settings(self, source: object) -> None:
        self.inherited_from = source

    def propose_optimization_objective(self, goal: str) -> dict[str, object]:
        self.objective_requests.append(goal)
        return {
            "schema_version": "ecos.optimization_objective_proposal.v1",
            "primary_metric": "route_wirelength",
            "preserve_metrics": ["route_dr_total_violation_count"],
            "rationale_summary": "Reduce routed wirelength while preserving DRC.",
        }


class _FakeChatProvider:
    _model = "glm-5.3-flash"
    _reasoning_effort = "low"

    def clear_interrupted(self) -> None:
        pass


class _FailingRunner(OptimizationEpisodeRunner):
    ecc_revision = "ecc-test"

    def __init__(self) -> None:
        self.event_listener = None
        self._controller = SimpleNamespace(
            state=OptimizationEpisodeState.PLANNING,
            episode_id="episode-test",
            pending_execution_ids=(),
        )

    @property
    def budget(self):
        return SimpleNamespace(
            remaining_planning_calls=7,
            remaining_wall_time_seconds=600.0,
        )

    def run_turn(self, *, paused: bool = False):
        raise RuntimeError("test stop")

    def finish_stop(self) -> None:
        self._controller.state = OptimizationEpisodeState.STOPPED


class _CompletedRunner(_FailingRunner):
    def run_turn(self, *, paused: bool = False):
        self._controller.state = OptimizationEpisodeState.STOPPED
        return SimpleNamespace(
            planning=SimpleNamespace(
                state=OptimizationEpisodeState.STOPPED,
                proposal=SimpleNamespace(
                    decision=SimpleNamespace(value="stop"),
                    reason_code=SimpleNamespace(value="observation"),
                    rationale_summary="Budget exhausted; stop cleanly.",
                    action=None,
                ),
                requested=None,
                rejection_reason=None,
            ),
            execution=None,
            incumbent_comparison=None,
        )

    @property
    def incumbent_candidate_root_ref(self) -> str:
        return ".agent/candidates/candidate-winner"


class _BlockingRunner(_CompletedRunner):
    def __init__(self, lifecycle: list[str]) -> None:
        super().__init__()
        self.lifecycle = lifecycle
        self.started = threading.Event()
        self.release = threading.Event()

    def run_turn(self, *, paused: bool = False):
        self.started.set()
        assert self.release.wait(timeout=2)
        self.lifecycle.append("terminal-ledger")
        return super().run_turn()

    def request_stop(self) -> None:
        self.lifecycle.append("request-stop")
        self.release.set()

    def close(self) -> None:
        self.lifecycle.append("runner-close")


class _BrokenClosureRunner(_BlockingRunner):
    def run_turn(self, *, paused: bool = False):
        self.started.set()
        assert self.release.wait(timeout=2)
        self._controller.state = OptimizationEpisodeState.EXECUTING
        raise RuntimeError("terminal closure failed")


class _InFlightRunner(_CompletedRunner):
    """One candidate still runs after the first turn; the second finishes."""

    def __init__(self) -> None:
        super().__init__()
        self.turns = 0

    def run_turn(self, *, paused: bool = False):
        self.turns += 1
        if self.turns == 1:
            self._controller.state = OptimizationEpisodeState.EXECUTING
            self._controller.pending_execution_ids = ("execution-2",)
            return SimpleNamespace(
                planning=SimpleNamespace(
                    state=OptimizationEpisodeState.EXECUTING,
                    proposal=None,
                    requested=None,
                    rejection_reason=None,
                ),
                execution=SimpleNamespace(
                    state=OptimizationEpisodeState.EXECUTING,
                    rejection_reason=None,
                ),
                incumbent_comparison=None,
            )
        self._controller.state = OptimizationEpisodeState.STOPPED
        self._controller.pending_execution_ids = ()
        return SimpleNamespace(
            planning=SimpleNamespace(
                state=OptimizationEpisodeState.STOPPED,
                proposal=None,
                requested=None,
                rejection_reason=None,
            ),
            execution=None,
            incumbent_comparison=None,
        )


class _QuarantinedRunner(_BlockingRunner):
    def run_turn(self, *, paused: bool = False):
        turn = super().run_turn()
        self._controller.state = OptimizationEpisodeState.QUARANTINED
        return turn


def test_gui_optimization_reuses_one_codex_provider_for_objective_and_episode(
    tmp_path: Path,
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
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

    _send(provider, session_id, "3")
    assert provider.sessions[session_id].phase == "optimization_objective"
    _send(provider, session_id, "reduce wirelength")
    assert provider.sessions[session_id].phase == "optimization_authorization"
    _send(provider, session_id, "1")

    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    session = provider.sessions[session_id]
    assert session.optimization_phase == "error"
    # One provider is created at objective parse and reused for the episode;
    # it is closed once, when the episode thread finishes.
    assert fake_provider.closed == 1
    assert len(factory_calls) == 2
    assert factory_calls[0]["cwd"] == workspace
    diagnostics = factory_calls[0]["diagnostics_path"]
    assert diagnostics.parent.parent == workspace / ".agent" / "optimization"
    assert diagnostics.parent.name.startswith("turn-")
    assert diagnostics.name == "codex-rpc-diagnostics.v1.jsonl"
    assert factory_calls[1]["context"]["episode_id"] == session.optimization_episode_id
    assert factory_calls[1]["context"]["workspace"] == str(workspace)
    assert isinstance(factory_calls[1]["context"]["workspace"], str)
    assert factory_calls[1]["context"]["objective"]["primary_metric"] == "route_wirelength"
    assert any(
        event["type"] == "error" and "test stop" in str(event["text"])
        for event in events
    )


def test_gui_stop_requests_terminal_closure_before_runner_close(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    lifecycle: list[str] = []
    runner = _BlockingRunner(lifecycle)
    provider = EcosAgentProvider(
        emit=lambda _event: None,
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

    provider.send_message({"sessionId": session_id, "message": "stop"})
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    assert lifecycle == ["request-stop", "terminal-ledger", "runner-close"]
    assert provider.sessions[session_id].optimization_phase == "stopped"


def test_gui_reports_in_flight_and_waits_for_remaining_candidates(
    tmp_path: Path,
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    runner = _InFlightRunner()
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

    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    # U1: one candidate ending never reads as all-complete; the episode keeps
    # running while another candidate is still in flight.
    assert runner.turns == 2
    progress = [
        event["optimization"]
        for event in events
        if isinstance(event.get("optimization"), dict)
        and event["optimization"].get("turn") == 1
    ][-1]
    assert progress["in_flight"] == 1
    assert progress["state"] == "executing"
    assert provider.sessions[session_id].optimization_phase == "stopped"


def test_gui_stop_does_not_hide_a_terminal_closure_failure(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    lifecycle: list[str] = []
    runner = _BrokenClosureRunner(lifecycle)
    provider = EcosAgentProvider(
        emit=lambda _event: None,
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

    provider.send_message({"sessionId": session_id, "message": "stop"})
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    assert lifecycle == ["request-stop", "runner-close"]
    assert provider.sessions[session_id].optimization_phase == "error"


def test_gui_stop_preserves_indeterminate_quarantine_phase(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    lifecycle: list[str] = []
    runner = _QuarantinedRunner(lifecycle)
    provider = EcosAgentProvider(
        emit=lambda _event: None,
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

    provider.send_message({"sessionId": session_id, "message": "stop"})
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    assert lifecycle == ["request-stop", "terminal-ledger", "runner-close"]
    assert provider.sessions[session_id].optimization_phase == "quarantined"


def test_gui_optimization_fails_closed_without_runner_factory(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")

    session = provider.sessions[session_id]
    assert session.optimization_phase == "error"
    assert session.phase == "operation"
    assert any(event["type"] == "error" and "not configured" in str(event["text"]) for event in events)
    assert any(event.get("optimization", {}).get("state") == "failed" for event in events)


def test_gui_runner_start_failure_returns_to_operation(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    fake_provider = _FakeCodexProvider()

    def fail(_context: dict[str, object], _planner: object) -> _CompletedRunner:
        raise RuntimeError("runner startup failed")

    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: fake_provider,
        optimization_runner_factory=fail,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")

    session = provider.sessions[session_id]
    assert session.phase == "operation"
    assert session.optimization_phase == "error"
    assert fake_provider.closed == 1
    assert any(
        event["type"] == "error" and "runner startup failed" in str(event["text"])
        for event in events
    )
    assert any(event.get("optimization", {}).get("state") == "failed" for event in events)


def test_gui_optimization_reports_decision_and_winner_evidence(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: _CompletedRunner(),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")
    _send(provider, session_id, "1")
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    progress = next(
        event["optimization"]
        for event in events
        if event["type"] == "optimization"
        and event["optimization"].get("proposal_decision") is not None
    )
    assert progress["proposal_decision"] == "stop"
    assert progress["proposal_reason"] == "observation"
    assert progress["rejection_reason"] is None
    assert progress["incumbent_candidate_root_ref"] == ".agent/candidates/candidate-winner"
    assert progress["objective_sha256"].startswith("sha256:")
    assert progress["primary_metric"] == "route_wirelength"
    assert any(
        event["type"] == "optimization" and "route_wirelength" in str(event["text"])
        for event in events
    )


def test_gui_optimization_collects_and_confirms_normalized_objective(
    tmp_path: Path,
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    fake_provider = _FakeCodexProvider()
    runner_contexts: list[dict[str, object]] = []

    def propose_objective(goal: str) -> dict[str, object]:
        assert goal == "reduce routed wirelength without breaking DRC"
        return {
            "schema_version": "ecos.optimization_objective_proposal.v1",
            "primary_metric": "route_wirelength",
            "preserve_metrics": ["route_dr_total_violation_count"],
            "rationale_summary": "User asked to reduce routed wirelength and preserve DRC.",
        }

    fake_provider.propose_optimization_objective = propose_objective

    def runner_factory(context: dict[str, object], planner: object) -> _CompletedRunner:
        runner_contexts.append(context)
        return _CompletedRunner()

    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: fake_provider,
        optimization_runner_factory=runner_factory,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]
    chat = _FakeChatProvider()
    provider.sessions[session_id].codex_provider = chat

    _send(provider, session_id, "3")
    assert provider.sessions[session_id].phase == "optimization_objective"

    _send(
        provider,
        session_id,
        "reduce routed wirelength without breaking DRC",
    )
    session = provider.sessions[session_id]
    assert session.phase == "optimization_authorization"
    assert session.optimization_objective["primary_metric"] == "route_wirelength"
    assert "drc_clean" in session.optimization_objective["required_signoff_gates"]
    assert any(
        event["type"] == "message"
        and "route_wirelength" in str(event["text"])
        and "drc_clean" in str(event["text"])
        for event in events
    )
    # The objective provider is held for the episode, not closed after parse.
    assert fake_provider.closed == 0
    # The GUI-selected chat model/effort must reach optimization turns.
    assert fake_provider.inherited_from is chat
    assert session.pending_interaction is not None
    assert session.pending_interaction["request"]["kind"] == "confirm"
    assert session.pending_interaction["request"]["interaction"]["kind"] == "confirm"

    _send(provider, session_id, "1")
    deadline = time.monotonic() + 2
    while provider.sessions[session_id].optimization_thread is not None and time.monotonic() < deadline:
        time.sleep(0.01)

    assert fake_provider.closed == 1
    assert runner_contexts[0]["objective"] == session.optimization_objective
    assert runner_contexts[0]["objective_alignment"] == (
        session.optimization_objective_alignment
    )
    progress = next(
        event["optimization"]
        for event in events
        if event["type"] == "optimization"
        and event["optimization"].get("primary_metric") is not None
    )
    assert progress["objective_sha256"] == session.optimization_objective_sha256
    assert progress["primary_metric"] == "route_wirelength"


@pytest.mark.parametrize(
    "preserve_metrics",
    [
        ["drc_count", "sta_setup_wns"],
        ["sta_setup_wns", "sta_hold_wns"],
    ],
)
def test_gui_drc_and_timing_goal_requires_drc_recovery_confirmation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    preserve_metrics: list[str],
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    goal = "reduce routed wirelength while preserving DRC and timing"
    baseline = _baseline(drc=9)
    assert baseline.metrics["route_dr_total_violation_count"] == 0
    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.build_terminal_observation",
        lambda _workspace: baseline,
    )
    fake_provider = _FakeCodexProvider()

    def propose_objective(request: str) -> dict[str, object]:
        assert request == goal
        return {
            "schema_version": "ecos.optimization_objective_proposal.v1",
            "primary_metric": "route_wirelength",
            "preserve_metrics": preserve_metrics,
            "rationale_summary": goal,
        }

    fake_provider.propose_optimization_objective = propose_objective
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: fake_provider,
        optimization_runner_factory=lambda context, _planner: (
            contexts.append(context) or _CompletedRunner()
        ),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    _send(provider, session_id, goal)

    session = provider.sessions[session_id]
    assert session.phase == "optimization_authorization"
    authorization = next(
        event["interaction"]["optimizationAuthorization"]
        for event in events
        if event.get("interaction", {}).get("optimizationAuthorization", {}).get("schema_version")
        == "ecos.optimization_authorization.v2"
    )
    assert authorization["original_primary_metric"] == "route_wirelength"
    assert authorization["active_primary_metric"] == "drc_count"
    assert authorization["recovery_stage"] == "drc"
    assert authorization["violation_counts"] == {
        "drc_count": 9,
        "sta_setup_violation_count": 0,
        "sta_hold_violation_count": 0,
    }
    assert any(
        event["type"] == "message"
        and "route_wirelength" in str(event["text"])
        and "drc_count=9" in str(event["text"])
        for event in events
    )
    assert not any(event["type"] == "error" for event in events)
    assert session.pending_interaction is not None
    assert session.optimization_thread is None
    assert contexts == []


def test_gui_authorizes_recovery_then_original_objective_with_one_confirmation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []
    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.build_terminal_observation",
        lambda _workspace: _baseline(drc=4, setup=2),
    )
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda context, _planner: (
            contexts.append(context) or _CompletedRunner()
        ),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")

    authorization = next(
        event["interaction"]["optimizationAuthorization"]
        for event in events
        if event.get("interaction", {}).get("optimizationAuthorization", {}).get("schema_version")
        == "ecos.optimization_authorization.v2"
    )
    assert authorization["original_primary_metric"] == "route_wirelength"
    assert authorization["active_primary_metric"] == "drc_count"
    assert authorization["recovery_stage"] == "drc"
    assert authorization["violation_counts"] == {
        "drc_count": 4,
        "sta_setup_violation_count": 2,
        "sta_hold_violation_count": 0,
    }

    _send(provider, session_id, "1")
    deadline = time.monotonic() + 2
    while (
        provider.sessions[session_id].optimization_thread is not None
        and time.monotonic() < deadline
    ):
        time.sleep(0.01)

    assert len(contexts) == 1
    assert contexts[0]["objective_alignment"]["alignment_contract_sha256"] == (
        authorization["alignment_sha256"]
    )


@pytest.mark.parametrize("missing_evidence", ["evaluation_metrics", "geometry"])
def test_gui_blocks_authorization_when_baseline_evidence_is_incomplete(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, missing_evidence: str,
) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    monkeypatch.setattr(
        "ecos_agent.gui.provider_optimization.build_terminal_observation",
        lambda _workspace: _baseline().model_copy(
            update=({"geometry": None} if missing_evidence == "geometry"
                    else {"evaluation_metrics_complete": False})
        ),
    )
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: _FakeCodexProvider(),
        optimization_runner_factory=lambda _context, _planner: _CompletedRunner(),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")
    _send(provider, session_id, "reduce wirelength")

    assert provider.sessions[session_id].optimization_phase == "unavailable"
    assert not any(
        event.get("interaction", {}).get("optimizationAuthorization", {}).get("schema_version")
        == "ecos.optimization_authorization.v2"
        for event in events
    )
    assert any(
        event["type"] == "error"
        and "Unable to align optimization objective with baseline" in str(event["text"])
        for event in events
    )


def test_gui_optimization_objective_parse_failure_returns_to_operation(tmp_path: Path) -> None:
    workspace = _make_optimization_workspace(tmp_path)
    events: list[dict[str, object]] = []
    fake_provider = _FakeCodexProvider()

    def fail(_goal: str) -> dict[str, object]:
        raise RuntimeError("bad objective")

    fake_provider.propose_optimization_objective = fail
    provider = EcosAgentProvider(
        emit=events.append,
        optimization_provider_factory=lambda **_kwargs: fake_provider,
        optimization_runner_factory=lambda _context, _planner: _CompletedRunner(),
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "3")
    _send(provider, session_id, "optimize something")

    assert provider.sessions[session_id].phase == "operation"
    assert fake_provider.closed == 1
    assert any(event["type"] == "error" and "Unable to parse optimization objective" in str(event["text"]) for event in events)
