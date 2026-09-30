import json
import re
from pathlib import Path

import pytest

from ecos_agent.codex.provider import CodexProviderError
from ecos_agent.gui.provider import EcosAgentProvider
from ecos_agent.knowledge.source import SourceCodeRetriever

from .provider_support import (
    chat_response as _chat_response,
    last_event as _last_event,
    send_session_input as _send,
    workspace_with_timing_opt_and_place as _workspace_with_timing_opt_and_place,
)


def test_knowledge_question_reports_local_observable_work_in_one_turn(
    tmp_path: Path,
) -> None:
    repository = tmp_path / "ecos-studio"
    source = repository / "ecc" / "cts.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        "class ClockTreeSynthesis:\n    pass  # CTS implementation\n",
        encoding="utf-8",
    )
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=lambda _context: _chat_response(
            answer="CTS builds the clock distribution network.",
            evidence_ids=["source-1"],
        ),
        source_retrieval_parser=lambda _context: {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [{"root_id": "ecc", "query": "ClockTreeSynthesis"}],
            "rationale": "Check the CTS implementation.",
        },
        source_retriever=SourceCodeRetriever(repository),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    _send(provider, session_id, "什么是 CTS")

    activities = [event["activity"] for event in events if event["type"] == "activity"]
    first_seen = list(dict.fromkeys(activity["itemId"] for activity in activities))
    assert first_seen == [
        "local-stage-identification",
        "local-knowledge-search",
        "local-source-search",
        "local-answer-validation",
    ]
    assert all(
        re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", item_id)
        for item_id in first_seen
    )
    assert len({activity["turnId"] for activity in activities}) == 1
    terminal = {activity["itemId"]: activity for activity in activities}
    assert all(item["status"] == "completed" for item in terminal.values())
    assert json.loads(terminal["local-stage-identification"]["result"])[
        "candidate_stages"
    ] == ["cts"]
    knowledge = json.loads(terminal["local-knowledge-search"]["result"])
    assert knowledge["match_count"] == 3
    assert "parameter.cts.cap_steps" in knowledge["entity_ids"]
    source_result = json.loads(terminal["local-source-search"]["result"])
    assert source_result == {
        "evidence_count": 1,
        "paths": ["ecc/cts.py"],
        "result_limit_reached": False,
    }
    validation = json.loads(terminal["local-answer-validation"]["result"])
    assert validation == {
        "evidence_reference_count": 1,
        "route": "answer",
        "schema": "flow-agent.gui_chat_response.v1",
    }


@pytest.mark.parametrize(
    "natural_language_request",
    (
        "lower target density",
        "Update place.target_density to 0.25 and save only. Do not run or rerun the flow.",
    ),
)
def test_operation_keyword_routes_parameter_nl_without_codex(
    tmp_path: Path, natural_language_request: str
) -> None:
    workspace = _workspace_with_timing_opt_and_place(tmp_path)
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []
    operation_contexts: list[dict[str, object]] = []

    def parse_parameter(context: dict[str, object]) -> dict[str, object]:
        parser_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [{"knob_id": "place.target_density", "value": 0.4}],
            "summary": "Lower target density.",
        }

    def parse_operation(context: dict[str, object]) -> dict[str, object]:
        operation_contexts.append(context)
        raise AssertionError("keyword-matched operation must not call Codex")

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=parse_parameter,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, natural_language_request)

    assert operation_contexts == []
    assert provider.sessions[session_id].phase == "workspace_parameter_confirmation"
    assert parser_contexts[0]["natural_language_request"] == natural_language_request
    assert _last_event(events, "contract")["contract"]["presentation"] == (
        "workspace_parameter_update"
    )


def test_operation_question_uses_place_knowledge_without_parameter_update(tmp_path: Path) -> None:
    workspace = _workspace_with_timing_opt_and_place(tmp_path)
    events: list[dict[str, object]] = []
    chat_contexts: list[dict[str, object]] = []

    def unexpected_parameter_update(_context: dict[str, object]) -> dict[str, object]:
        raise AssertionError("a question must not enter the parameter-update parser")

    def answer_with_retrieved_knowledge(context: dict[str, object]) -> dict[str, object]:
        chat_contexts.append(context)
        return _chat_response(answer="The stop-overflow threshold ends global placement.")

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=unexpected_parameter_update,
        chat_response_parser=answer_with_retrieved_knowledge,
        stage_routing_parser=lambda _context: {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": ["place"],
            "rationale": "The question concerns placer behavior.",
        },
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "what is the DreamPlace stop overflow threshold?")

    answer = _last_event(events, "message")
    assert provider.sessions[session_id].phase == "operation"
    assert chat_contexts[0]["allowed_operations"] == []
    retrieved = chat_contexts[0]["retrieved_knowledge"]
    assert "parameter.dreamplace.stop_overflow" in retrieved["entity_ids"]
    assert "acceptable global-placement overflow threshold" in str(retrieved["text"])
    assert answer["contract"]["knowledge"]["entity_ids"] == retrieved["entity_ids"]


@pytest.mark.parametrize(
    ("message", "entity_id_fragment"),
    [
        ("what is RUDY", "rudy"),
        ("what is place target density", "parameter.dreamplace.target_density"),
    ],
)
def test_known_concepts_still_use_source_search_planning_by_default(
    tmp_path: Path, monkeypatch, message: str, entity_id_fragment: str
) -> None:
    repository = tmp_path / "ecos-studio"
    (repository / "ecc").mkdir(parents=True)
    events: list[dict[str, object]] = []
    source_contexts: list[dict[str, object]] = []
    chat_contexts: list[dict[str, object]] = []

    def source_search(context: dict[str, object]) -> dict[str, object]:
        source_contexts.append(context)
        return {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [],
            "rationale": "No source lookup is needed.",
        }

    def chat_response(context: dict[str, object]) -> dict[str, object]:
        chat_contexts.append(context)
        return _chat_response(answer="Codex-organized knowledge answer.")

    monkeypatch.setattr("ecos_agent.gui.provider._propose_gui_chat_response", chat_response)

    provider = EcosAgentProvider(
        emit=events.append,
        source_retrieval_parser=source_search,
        source_retriever=SourceCodeRetriever(repository),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    _send(provider, session_id, message)

    assert len(source_contexts) == 1
    assert any(
        entity_id_fragment in entity_id
        for entity_id in chat_contexts[0]["retrieved_knowledge"]["entity_ids"]
    )
    assert chat_contexts[0]["retrieved_code"]["evidence"] == []
    assert _last_event(events, "message")["text"] == "Codex-organized knowledge answer."


def test_chat_combines_knowledge_and_bounded_source_evidence(tmp_path: Path) -> None:
    repository = tmp_path / "ecos-studio"
    source = repository / "ecc" / "route.py"
    source.parent.mkdir(parents=True)
    source.write_text("def stop_overflow_reached():\n    return overflow <= target\n", encoding="utf-8")
    events: list[dict[str, object]] = []
    source_contexts: list[dict[str, object]] = []
    chat_contexts: list[dict[str, object]] = []

    def source_search(context: dict[str, object]) -> dict[str, object]:
        source_contexts.append(context)
        return {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [{"root_id": "ecc", "query": "stop_overflow_reached"}],
            "rationale": "Need the implementation.",
        }

    def answer(context: dict[str, object]) -> dict[str, object]:
        chat_contexts.append(context)
        return _chat_response(
            answer="The threshold is checked in stop_overflow_reached.", evidence_ids=["source-1"]
        )

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=answer,
        source_retrieval_parser=source_search,
        source_retriever=SourceCodeRetriever(repository),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    _send(provider, session_id, "How is the placement overflow threshold implemented?")

    assert "retrieved_knowledge" in chat_contexts[0]
    retrieved_code = chat_contexts[0]["retrieved_code"]
    assert source_contexts[0]["available_source_roots"] == ["ecc"]
    assert source_contexts[0]["source_workspace_roots"] == [str(repository / "ecc")]
    assert retrieved_code["evidence"][0]["path"] == "ecc/route.py"
    assert "stop_overflow_reached" in retrieved_code["evidence"][0]["text"]
    assert _last_event(events, "message")["contract"]["source_evidence_ids"] == ["source-1"]


def test_chat_rejects_unavailable_source_evidence_id(tmp_path: Path) -> None:
    repository = tmp_path / "ecos-studio"
    source = repository / "ecc" / "route.py"
    source.parent.mkdir(parents=True)
    source.write_text("needle = True\n", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=lambda _context: _chat_response(answer="Unsupported claim.", evidence_ids=["source-2"]),
        source_retrieval_parser=lambda _context: {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [{"root_id": "ecc", "query": "needle"}],
            "rationale": "Need source evidence.",
        },
        source_retriever=SourceCodeRetriever(repository),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    _send(provider, session_id, "How is this implemented?")

    assert _last_event(events, "error")["text"] == "The answer cited unavailable source evidence."


def test_operation_question_falls_back_to_audited_knowledge_when_codex_fails(tmp_path: Path) -> None:
    workspace = _workspace_with_timing_opt_and_place(tmp_path)
    repository = tmp_path / "ecos-studio"
    source = repository / "ecc" / "route.py"
    source.parent.mkdir(parents=True)
    source.write_text("stop_overflow = 0.1\n", encoding="utf-8")
    events: list[dict[str, object]] = []

    def unavailable_codex(_context: dict[str, object]) -> dict[str, object]:
        raise CodexProviderError("Codex timed out", failure_class="timeout")

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=unavailable_codex,
        source_retrieval_parser=lambda _context: {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [{"root_id": "ecc", "query": "stop_overflow"}],
            "rationale": "Need source evidence.",
        },
        source_retriever=SourceCodeRetriever(repository),
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "what is the DreamPlace stop overflow threshold?")

    answer = _last_event(events, "message")
    assert "acceptable global-placement overflow threshold" in str(answer["text"])
    assert answer["contract"]["schema_version"] == "ecos-knowledge-answer.v2"
    assert answer["contract"]["source_evidence_ids"] == []
    assert answer["contract"]["source_retrieval"]["evidence"][0]["path"] == "ecc/route.py"
    assert not any(event["type"] == "error" for event in events)


def test_operation_question_codex_fallback_disallows_operations(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []

    def answer_chat(context: dict[str, object]) -> dict[str, object]:
        contexts.append(context)
        return _chat_response(answer="This workspace has no published answer for that question.")

    provider = EcosAgentProvider(emit=events.append, chat_response_parser=answer_chat)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "what is the placement policy for this design?")

    assert contexts[0]["allowed_operations"] == []
    assert provider.sessions[session_id].phase == "operation"
    assert _last_event(events, "message")["contract"]["read_only"] is True


def test_operation_codex_fallback_maps_nl_to_rerun(tmp_path: Path) -> None:
    workspace = _workspace_with_timing_opt_and_place(tmp_path)
    events: list[dict[str, object]] = []
    operation_contexts: list[dict[str, object]] = []

    def parse_operation(context: dict[str, object]) -> dict[str, object]:
        operation_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_chat_response.v1",
            "operation": "1",
            "answer": None,
        }

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace", "projectRoot": str(tmp_path)}
    )["sessionId"]
    _send(provider, session_id, "please perform the isolated stage again")

    assert provider.sessions[session_id].phase in {
        "rerun_source_run",
        "rerun_workspace",
        "rerun_stage",
    }
    assert operation_contexts[0]["natural_language_request"] == (
        "please perform the isolated stage again"
    )
    assert [item["id"] for item in operation_contexts[0]["allowed_operations"]] == [
        "1",
        "2",
        "3",
        "4",
    ]


def test_operation_codex_fallback_fails_closed(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []

    def parse_operation(_context: dict[str, object]) -> dict[str, object]:
        raise CodexProviderError("Codex timed out", failure_class="timeout")

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "do something clever with timing")

    assert provider.sessions[session_id].phase == "operation"
    assert any(
        event["type"] == "error" and "Unable to answer the request" in str(event["text"])
        for event in events
    )
    assert len([event for event in events if event["type"] == "interaction"]) == 1


def test_operation_codex_fallback_answers_unmatched_nl_without_error(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []

    def parse_operation(_context: dict[str, object]) -> dict[str, object]:
        return _chat_response(answer="Hello. What would you like to know about this workspace?")

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "hello there")

    assert provider.sessions[session_id].phase == "operation"
    assert any(
        event["type"] == "message" and "What would you like to know" in str(event["text"])
        for event in events
    )
    assert not any(event["type"] == "error" for event in events)
    assert len([event for event in events if event["type"] == "interaction"]) == 1


def test_bare_operation_number_skips_codex(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    operation_contexts: list[dict[str, object]] = []

    def parse_operation(context: dict[str, object]) -> dict[str, object]:
        operation_contexts.append(context)
        raise AssertionError("bare numbered choice must stay deterministic")

    provider = EcosAgentProvider(
        emit=lambda _event: None,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "2")

    assert operation_contexts == []
    assert provider.sessions[session_id].phase == "workspace_continue_confirmation"
