import threading
from pathlib import Path

import pytest

from ecos_agent.workspace.contracts import GuiWorkspaceSetupProposal
from ecos_agent.gui.messages import home_ready_prompt
from ecos_agent.gui.provider import EcosAgentProvider

from .provider_support import (
    last_event as _last_event,
    proposal as _proposal,
    send_session_input as _send,
)


def test_operation_choice_uses_interaction_request_and_dedicated_answer() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session({"mode": "home"})["sessionId"]
    interaction_event = next(event for event in events if event["type"] == "interaction")
    request = interaction_event["interaction"]

    assert request["schema_version"] == "flow-agent.interaction_request.v1"
    assert request["purpose"] == "execution"
    assert request["kind"] == "choice"
    assert request["description"] == home_ready_prompt("en")
    assert events.index(interaction_event) > max(
        index for index, event in enumerate(events) if event["type"] == "message"
    )
    option = request["interaction"]["options"][0]
    assert "value" not in option

    result = provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": request["requestId"],
            "kind": "choice",
            "optionId": option["id"],
        }
    )

    assert result == {
        "accepted": True,
        "canUndo": True,
        "requestId": request["requestId"],
        "sessionId": session_id,
    }
    assert provider.sessions[session_id].phase == "workspace_project_mode"
    project_request = provider.sessions[session_id].pending_interaction["request"]
    assert project_request["description"] == (
        "Choose whether to use an existing Project or create a new Project."
    )
    assert not any(
        event["type"] == "message"
        and event.get("text") == project_request["description"]
        for event in events
    )


def test_interaction_choice_accepts_a_typed_answer() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    request = provider.sessions[session_id].pending_interaction["request"]

    provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": request["requestId"],
            "kind": "choice",
            "text": "1",
        }
    )

    assert provider.sessions[session_id].phase == "workspace_project_mode"
    assert provider.sessions[session_id].pending_interaction is not None


def test_interaction_undo_restores_the_previous_choice_in_the_same_session() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    session = provider.sessions[session_id]
    original = session.pending_interaction["request"]

    _send(provider, session_id, "1")
    current = session.pending_interaction["request"]
    assert session.phase == "workspace_project_mode"

    result = provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": current["requestId"],
            "kind": current["kind"],
            "undo": True,
        }
    )

    assert result == {
        "accepted": True,
        "requestId": current["requestId"],
        "sessionId": session_id,
        "undoneRequestId": original["requestId"],
    }
    assert session.phase == "home_ready"
    assert session.pending_interaction["request"]["requestId"] == original["requestId"]
    assert session.pending_interaction["request"].get("canUndo") is not True


def test_interaction_undo_can_walk_back_multiple_choices_in_the_same_session() -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session(
        {
            "mode": "home",
            "knownProjects": [{"name": "demo", "path": "/projects/demo"}],
        }
    )["sessionId"]
    session = provider.sessions[session_id]
    first = session.pending_interaction["request"]

    _send(provider, session_id, "1")
    second = session.pending_interaction["request"]
    _send(provider, session_id, "1")
    third = session.pending_interaction["request"]

    provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": third["requestId"],
            "kind": third["kind"],
            "undo": True,
        }
    )
    assert session.pending_interaction["request"]["requestId"] == second["requestId"]
    assert session.pending_interaction["request"]["canUndo"] is True

    provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": second["requestId"],
            "kind": second["kind"],
            "undo": True,
        }
    )
    assert session.pending_interaction["request"]["requestId"] == first["requestId"]
    assert session.pending_interaction["request"].get("canUndo") is not True


def test_interaction_undo_history_clears_at_an_execution_boundary() -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    session = provider.sessions[session_id]
    session.interaction_undo.append(provider._capture_interaction_state(session))

    provider._run_turn(
        session,
        "confirm",
        lambda current, _message: setattr(
            current, "phase", "workspace_creation_pending"
        ),
    )

    assert session.interaction_undo == []


def test_free_text_answer_does_not_create_undo_history() -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    session = provider.sessions[session_id]
    request = session.pending_interaction["request"]

    result = provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": request["requestId"],
            "kind": request["kind"],
            "text": "1",
        }
    )

    assert result.get("canUndo") is not True
    assert session.interaction_undo == []
    assert session.pending_interaction["request"].get("canUndo") is not True


def test_interaction_answers_are_one_time_and_resume_reuses_the_pending_request() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    request = provider.sessions[session_id].pending_interaction["request"]

    with pytest.raises(ValueError, match="interaction answer"):
        provider.send_message({"sessionId": session_id, "message": "1"})

    resumed = provider.resume_session({"sessionId": session_id})
    assert resumed["pendingInteraction"] == request

    option_id = request["interaction"]["options"][0]["id"]
    provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": request["requestId"],
            "kind": "choice",
            "optionId": option_id,
        }
    )
    with pytest.raises(ValueError, match="already answered"):
        provider.answer_interaction(
            {
                "sessionId": session_id,
                "requestId": request["requestId"],
                "kind": "choice",
                "optionId": option_id,
            }
        )


def test_clarification_interaction_resumes_read_only_model_continuation() -> None:
    events: list[dict[str, object]] = []
    contexts: list[str] = []
    responses = iter(
        (
            {
                "schema_version": "flow-agent.gui_chat_response.v1",
                "operation": None,
                "answer": None,
                "clarification": {
                    "title": "Choose context",
                    "description": "Which context should I explain?",
                    "options": [{"id": "place", "label": "Placement"}],
                },
            },
            {
                "schema_version": "flow-agent.gui_chat_response.v1",
                "operation": None,
                "answer": "Placement is a physical-design stage.",
            },
        )
    )

    def parse_chat(context: dict[str, object]) -> dict[str, object]:
        contexts.append(str(context["natural_language_request"]))
        return next(responses)

    provider = EcosAgentProvider(emit=events.append, chat_response_parser=parse_chat)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    provider.sessions[session_id].pending_interaction = None
    provider.send_message({"sessionId": session_id, "message": "Explain placement."})

    clarification_event = next(
        event for event in reversed(events) if event["type"] == "interaction"
    )
    interaction = clarification_event["interaction"]
    assert interaction["purpose"] == "clarification"
    assert events.index(clarification_event) > max(
        index for index, event in enumerate(events) if event["type"] == "message"
    ) - 1
    provider.answer_interaction(
        {
            "sessionId": session_id,
            "requestId": interaction["requestId"],
            "kind": "choice",
            "optionId": interaction["interaction"]["options"][0]["id"],
        }
    )

    assert contexts[1].endswith("User clarification answer: Placement")
    assert provider.sessions[session_id].phase == "home_ready"
    assert not any(event["type"] == "workspace_create" for event in events)


def test_operation_and_cancellation_choices_preserve_the_controlled_paths() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]

    home_ready = _last_event(events, "interaction")["interaction"]
    assert home_ready["title"] == "Get started"
    assert home_ready["kind"] == "choice"
    assert len(home_ready["options"]) == 3

    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-1"
    provider._emit_phase_choice(session)
    _send(provider, session_id, "2")

    assert session.phase == "home_ready"
    assert not any(event["type"] == "workspace_create" for event in events)
    assert "Cancelled" in str(_last_event(events, "message")["text"])

    session.mode = "workspace"
    session.phase = "confirmation"
    provider._emit_phase_choice(session)
    _send(provider, session_id, "2")

    assert session.phase == "operation"
    assert not any(event["type"] == "workspace_rerun" for event in events)


def test_running_turn_can_be_interrupted_and_the_session_accepts_another_message(
    tmp_path: Path,
) -> None:
    events: list[dict[str, object]] = []
    started = threading.Event()
    release = threading.Event()
    errors: list[Exception] = []

    def blocking_parser(context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        register_interrupt = context["_register_interrupt"]
        assert callable(register_interrupt)
        register_interrupt(release.set)
        started.set()
        assert release.wait(timeout=2)
        return _proposal(target_overflow=0.1)

    provider = EcosAgentProvider(emit=events.append, workspace_setup_parser=blocking_parser)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_overflow"
    session.workspace_inputs.project_root = str(tmp_path)

    def send_blocking_message() -> None:
        try:
            _send(provider, session_id, "set target overflow to 0.1")
        except Exception as exc:  # pragma: no cover - retained for thread diagnostics
            errors.append(exc)

    turn = threading.Thread(target=send_blocking_message)
    turn.start()
    assert started.wait(timeout=2)

    provider.interrupt({"sessionId": session_id})
    turn.join(timeout=2)

    assert not turn.is_alive()
    assert errors == []
    assert session.running is False
    assert _last_event(events, "status")["status"] == "interrupted"
    assert not any(event["type"] == "workspace_setup" for event in events)

    _send(provider, session_id, "0.1")

    assert sum(
        event["type"] == "status" and event.get("status") == "running"
        for event in events
    ) == 2


def test_same_session_reserves_a_turn_before_entering_the_handler() -> None:
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.pending_interaction = None
    session.phase = "workspace_frequency"

    original_run_turn = provider._run_turn
    first_entered = threading.Event()
    release_first = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def delayed_run_turn(*args, **kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
            call_number = calls
        if call_number == 1:
            first_entered.set()
            assert release_first.wait(timeout=2)
        return original_run_turn(*args, **kwargs)

    provider._run_turn = delayed_run_turn
    first_errors: list[Exception] = []

    def send_first() -> None:
        try:
            provider.send_message({"sessionId": session_id, "message": "100"})
        except Exception as exc:  # pragma: no cover - retained for thread diagnostics
            first_errors.append(exc)

    first = threading.Thread(target=send_first)
    first.start()
    assert first_entered.wait(timeout=2)

    with pytest.raises(ValueError, match="already running"):
        provider.send_message({"sessionId": session_id, "message": "100"})

    release_first.set()
    first.join(timeout=2)
    assert not first.is_alive()
    assert first_errors == []
    assert calls == 1


def test_tool_streaming_reuses_one_message_id_for_all_turn_deltas(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []

    def streaming_parser(context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        progress = context["_progress_callback"]
        assert callable(progress)
        progress("Inspecting bounded inputs.")
        progress("Validating the structured proposal.")
        return _proposal(target_overflow=0.1)

    provider = EcosAgentProvider(emit=events.append, workspace_setup_parser=streaming_parser)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_overflow"
    session.workspace_inputs.project_root = str(tmp_path)

    _send(provider, session_id, "set target overflow to 0.1")

    tool_events = [event for event in events if event["type"] == "tool"]
    assert [event["delta"] for event in tool_events] == [
        "Inspecting bounded inputs.\n",
        "Validating the structured proposal.\n",
    ]
    assert len({event["messageId"] for event in tool_events}) == 1


def test_structured_codex_activity_uses_the_activity_event() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]

    provider._progress(
        session,
        {
            "itemId": "reasoning-1",
            "kind": "reasoning_summary",
            "schema_version": "flow-agent.activity.v1",
            "startedAt": 1000,
            "status": "running",
            "summary": ["Inspecting the flow."],
            "turnId": "turn-1",
            "turnStartedAt": 900,
        },
    )

    assert events[-1]["type"] == "activity"
    assert events[-1]["activity"] == {
        "itemId": "reasoning-1",
        "kind": "reasoning_summary",
        "schema_version": "flow-agent.activity.v1",
        "startedAt": 1000,
        "status": "running",
        "summary": ["Inspecting the flow."],
        "turnId": "turn-1",
        "turnStartedAt": 900,
    }


def test_structured_codex_activity_groups_provider_subturns_into_one_agent_turn() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.active_turn_id = "agent-turn"
    session.active_turn_started_at = 800

    for turn_id in ("routing-turn", "answer-turn"):
        provider._progress(
            session,
            {
                "itemId": "reasoning-1",
                "kind": "reasoning_summary",
                "schema_version": "flow-agent.activity.v1",
                "startedAt": 1000,
                "status": "completed",
                "summary": [turn_id],
                "turnId": turn_id,
                "turnStartedAt": 900,
            },
        )

    activities = [event["activity"] for event in events if event["type"] == "activity"]
    assert [activity["turnId"] for activity in activities] == [
        "agent-turn",
        "agent-turn",
    ]
    assert [activity["itemId"] for activity in activities] == [
        "routing-turn-reasoning-1",
        "answer-turn-reasoning-1",
    ]
    assert [activity["turnStartedAt"] for activity in activities] == [800, 800]
