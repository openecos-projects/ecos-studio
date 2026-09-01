import json
from pathlib import Path

import pytest

import ecos_agent.gui.support as provider_support
from ecos_agent.codex.provider import CodexAppServerProposalProvider, CodexProviderError
from ecos_agent.knowledge.contracts import StageRoutingProposal
from ecos_agent.gui.provider import EcosAgentProvider

from .provider_support import (
    chat_response as _chat_response,
    last_event as _last_event,
    send_session_input as _send,
)


@pytest.mark.parametrize(
    ("message", "language"),
    [
        ("hello", "en"),
        ("你好", "zh"),
    ],
)
def test_home_greeting_uses_direct_codex_chat_without_advancing(
    message: str, language: str
) -> None:
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []

    def answer_chat(context: dict[str, object]) -> dict[str, object]:
        contexts.append(context)
        return _chat_response(answer=f"Codex answered {context['natural_language_request']}.")

    def route_stages(_context: dict[str, object]) -> dict[str, object]:
        raise AssertionError("a pure greeting must not call stage routing")

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=answer_chat,
        stage_routing_parser=route_stages,
    )
    provider._started = True
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    choice_count = len([event for event in events if event["type"] == "interaction"])
    _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "home_ready"
    assert contexts[0]["natural_language_request"] == message
    assert contexts[0]["response_language"] == language
    assert _last_event(events, "message")["text"] == f"Codex answered {message}."
    assert _last_event(events, "message")["contract"]["schema_version"] == "flow-agent.gui_chat_response.v1"
    assert len([event for event in events if event["type"] == "interaction"]) == choice_count
    assert not any(event["type"] == "error" for event in events)


def test_chat_response_uses_the_current_question_language() -> None:
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []

    def answer_chat(context: dict[str, object]) -> dict[str, object]:
        contexts.append(context)
        return _chat_response(answer="Answer")

    provider = EcosAgentProvider(emit=events.append, chat_response_parser=answer_chat)
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    _send(provider, session_id, "What is placement?")
    _send(provider, session_id, "什么是 placement？")

    assert [context["response_language"] for context in contexts] == ["en", "zh"]


def test_wizard_greeting_answers_without_losing_the_pending_input(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=lambda context: _chat_response(
            answer=f"I can help while waiting for {context['phase']}."
        ),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_design"
    session.workspace_inputs.project_root = str(tmp_path)
    choice_count = len([event for event in events if event["type"] == "interaction"])

    _send(provider, session_id, "hello")

    assert session.phase == "workspace_design"
    assert _last_event(events, "message")["text"] == "I can help while waiting for workspace_design."
    assert len([event for event in events if event["type"] == "interaction"]) == choice_count

    _send(provider, session_id, "gcd")

    assert session.phase == "workspace_flow_end"


def test_gui_chat_response_prompt_is_read_only_and_structured(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    captured: dict[str, object] = {}

    def capture_turn(
        prompt: str, schema: dict[str, object], *, tool_policy: str
    ) -> str:
        captured.update(prompt=prompt, schema=schema, tool_policy=tool_policy)
        return json.dumps(_chat_response(answer="Hello.", evidence_ids=["source-1"]))

    monkeypatch.setattr(provider, "_run_turn", capture_turn)
    response = provider.respond_to_gui_chat(
        {
            "allowed_operations": [],
            "response_language": "en",
            "retrieved_knowledge": {
                "schema_version": "ecos-knowledge-answer.v2",
                "read_only": True,
                "entity_ids": ["parameter.dreamplace.stop_overflow"],
                "source_ids": ["dreamplace.config"],
            "text": "Audited target-overflow knowledge.",
            },
            "retrieved_code": {
                "schema_version": "ecos-source-code-evidence.v1",
                "read_only": True,
                "evidence": [
                    {
                        "evidence_id": "source-1",
                        "path": "ecc/chipcompiler/route.py",
                        "line_start": 10,
                        "line_end": 12,
                        "file_sha256": "a" * 64,
                        "snippet_sha256": "b" * 64,
                        "root_id": "ecc",
                        "text": "def route(): ...",
                    }
                ],
            },
        }
    )

    assert response["answer"] == "Hello."
    assert response["evidence_ids"] == ["source-1"]
    assert "Respond in the language specified by response_language" in str(captured["prompt"])
    assert "unless the request explicitly requires a different output language" in str(captured["prompt"])
    assert "Use retrieved_knowledge and retrieved_code only as read-only factual context" in str(captured["prompt"])
    assert "State the conclusion first" in str(captured["prompt"])
    assert "execution, closure, or QoR evidence" in str(captured["prompt"])
    assert "Audited target-overflow knowledge." in str(captured["prompt"])
    assert "def route(): ..." in str(captured["prompt"])
    assert captured["schema"]["properties"]["evidence_ids"]["maxItems"] == 12
    assert "currently allowed operation" in captured["schema"]["properties"]["operation"][
        "description"
    ]
    assert captured["tool_policy"] == "none"
    assert captured["schema"]["required"] == [
        "schema_version",
        "operation",
        "answer",
        "clarification",
        "evidence_ids",
    ]


def test_chat_uses_the_bound_workspace_and_source_planning_uses_whitelisted_roots(
    tmp_path: Path, monkeypatch
) -> None:
    captured: list[Path] = []
    source_root = tmp_path / "ecc"
    source_root.mkdir()

    class FakeCodexProvider:
        def interrupt(self) -> None:
            pass

        def close(self) -> None:
            pass

        def respond_to_gui_chat(self, _context: dict[str, object]) -> dict[str, object]:
            return _chat_response(answer="Read-only answer.")

        def propose_source_search(self, _context: dict[str, object]) -> dict[str, object]:
            return {
                "schema_version": "flow-agent.source_search_proposal.v1",
                "queries": [],
                "rationale": "No source lookup is required.",
            }

    def create_provider(**kwargs: object) -> FakeCodexProvider:
        root = kwargs["cwd"]
        assert isinstance(root, Path) and root.is_dir()
        captured.append(root)
        assert kwargs["runtime_workspace_roots"] == (root,)
        return FakeCodexProvider()

    monkeypatch.setattr(provider_support, "create_required_codex_provider", create_provider)
    chat = provider_support._propose_gui_chat_response(
        {"workspace": str(tmp_path), "allowed_operations": [], "response_language": "en"}
    )
    search = provider_support._propose_source_retrieval(
        {
            "natural_language_request": "How does it work?",
            "available_source_roots": ["ecc"],
            "source_workspace_roots": [str(source_root)],
        }
    )

    assert chat.answer == "Read-only answer."
    assert search.queries == ()
    assert len(captured) == 2
    assert captured[0] == tmp_path
    assert captured[1] == source_root


def test_source_search_prompt_is_bounded_and_structured(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    captured: dict[str, object] = {}

    def capture_turn(
        prompt: str, schema: dict[str, object], *, tool_policy: str
    ) -> str:
        captured.update(prompt=prompt, schema=schema, tool_policy=tool_policy)
        return json.dumps(
            {
                "schema_version": "flow-agent.source_search_proposal.v1",
                "queries": [{"root_id": "ecc", "query": "stop_overflow"}],
                "rationale": "Need the implementation site.",
            }
        )

    monkeypatch.setattr(provider, "_run_turn", capture_turn)
    response = provider.propose_source_search(
        {
            "natural_language_request": "How is stop_overflow consumed?",
            "available_source_roots": ["ecc", "ecos"],
        }
    )

    assert response["queries"] == [{"root_id": "ecc", "query": "stop_overflow"}]
    assert "Return zero to five literal source-search queries" in str(captured["prompt"])
    assert captured["schema"]["required"] == ["schema_version", "queries", "rationale"]
    assert captured["schema"]["properties"]["queries"]["maxItems"] == 5
    assert captured["tool_policy"] == "none"
    assert captured["schema"]["properties"]["queries"]["items"]["properties"]["root_id"]["enum"] == [
        "ecc",
        "ecos",
    ]


def test_stage_routing_prompt_is_read_only_and_bounded(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    captured: dict[str, object] = {}

    def capture_turn(
        prompt: str, schema: dict[str, object], *, tool_policy: str
    ) -> str:
        captured.update(prompt=prompt, schema=schema, tool_policy=tool_policy)
        return json.dumps(
            {
                "schema_version": "flow-agent.stage_routing_slots.v1",
                "scope": "in_scope",
                "primary_stage": "place",
                "secondary_stage": None,
                "tertiary_stage": None,
                "rationale": "The question concerns placement.",
            }
        )

    monkeypatch.setattr(provider, "_run_turn", capture_turn)
    response = provider.propose_stage_routing(
        {
            "natural_language_request": "What objective guides cell locations?",
            "stage_catalog": [
                {"stage": "place", "summary": "Place movable cells.", "chunk_sha256": "a" * 64},
                {"stage": "route", "summary": "Route signal nets.", "chunk_sha256": "b" * 64},
            ],
        }
    )

    assert response["candidate_stages"] == ["place"]
    assert "Return stage candidates only" in str(captured["prompt"])
    assert captured["schema"]["required"] == [
        "schema_version",
        "scope",
        "primary_stage",
        "secondary_stage",
        "tertiary_stage",
        "rationale",
    ]
    assert "candidate_stages" not in captured["schema"]["properties"]
    assert captured["schema"]["properties"]["scope"]["enum"] == [
        "in_scope",
        "out_of_scope",
        "ambiguous",
    ]
    assert captured["schema"]["properties"]["primary_stage"]["enum"] == ["place", "route", None]
    assert captured["tool_policy"] == "none"


def test_stage_routing_contract_rejects_too_many_or_duplicate_candidates() -> None:
    base = {
        "schema_version": "flow-agent.stage_routing_proposal.v1",
        "scope": "in_scope",
        "rationale": "bounded local routing",
    }

    with pytest.raises(ValueError, match="too many"):
        StageRoutingProposal.model_validate(
            {**base, "candidate_stages": ["place", "route", "cts", "sta"]}
        )
    with pytest.raises(ValueError, match="candidates are invalid"):
        StageRoutingProposal.model_validate({**base, "candidate_stages": ["place", "place"]})
    with pytest.raises(ValueError, match="cannot select stages"):
        StageRoutingProposal.model_validate(
            {**base, "scope": "out_of_scope", "candidate_stages": ["place"]}
        )
    with pytest.raises(ValueError, match="scope"):
        StageRoutingProposal.model_validate(
            {
                "schema_version": "flow-agent.stage_routing_proposal.v1",
                "candidate_stages": [],
                "rationale": "missing scope",
            }
        )


def test_out_of_scope_chat_is_refused_before_retrieval_and_preserves_phase(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    classified_requests: list[str] = []

    def classify_scope(context: dict[str, object]) -> dict[str, object]:
        classified_requests.append(str(context["natural_language_request"]))
        return {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "out_of_scope",
            "candidate_stages": [],
            "rationale": "The question is unrelated to IC, EDA, or ECOS Studio.",
        }

    def unexpected_call(_context: dict[str, object]) -> dict[str, object]:
        raise AssertionError("out-of-scope chat must stop before retrieval and answer generation")

    provider = EcosAgentProvider(
        emit=events.append,
        stage_routing_parser=classify_scope,
        source_retrieval_parser=unexpected_call,
        chat_response_parser=unexpected_call,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]
    original_operations = set(provider.sessions[session_id].pending_interaction["values"].values())

    _send(provider, session_id, "What does CTS stand for in New York transit?")
    _send(provider, session_id, "帝国大厦多高？")

    message = _last_event(events, "message")
    assert classified_requests == [
        "What does CTS stand for in New York transit?",
        "帝国大厦多高？",
    ]
    assert provider.sessions[session_id].phase == "operation"
    assert set(provider.sessions[session_id].pending_interaction["values"].values()) == (
        original_operations
    )
    assert message["contract"] == {
        "schema_version": "flow-agent.gui_chat_response.v1",
        "intent": "scope_refusal",
        "scope": "out_of_scope",
        "operation": None,
        "evidence_ids": [],
        "read_only": True,
        "backend": "local_policy",
    }
    assert "IC/EDA" in str(message["text"])
    activity_ids = {
        event["activity"]["itemId"] for event in events if event["type"] == "activity"
    }
    assert "local-knowledge-search" not in activity_ids
    assert "local-source-search" not in activity_ids
    assert not any(event["type"] == "error" for event in events)


def test_in_scope_ecos_engineering_chat_continues_without_stage_match(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    answer_contexts: list[dict[str, object]] = []

    def classify_scope(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": [],
            "rationale": "The Python failure is tied to the ECOS workspace.",
        }

    def answer(context: dict[str, object]) -> dict[str, object]:
        answer_contexts.append(context)
        return _chat_response(answer="Check the ECOS workspace Python environment.")

    provider = EcosAgentProvider(
        emit=events.append,
        stage_routing_parser=classify_scope,
        source_retrieval_parser=lambda _context: {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [],
            "rationale": "No source lookup is required.",
        },
        chat_response_parser=answer,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "How should I diagnose this ECOS Studio Python import failure?")

    assert answer_contexts
    assert _last_event(events, "message")["text"] == "Check the ECOS workspace Python environment."
    assert not any(event["type"] == "error" for event in events)


def test_unclassified_chat_fails_closed_before_retrieval(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []

    def unavailable_scope(_context: dict[str, object]) -> dict[str, object]:
        raise CodexProviderError("scope classification timed out", failure_class="timeout")

    def unexpected_call(_context: dict[str, object]) -> dict[str, object]:
        raise AssertionError("unclassified chat must stop before retrieval and answer generation")

    provider = EcosAgentProvider(
        emit=events.append,
        stage_routing_parser=unavailable_scope,
        source_retrieval_parser=unexpected_call,
        chat_response_parser=unexpected_call,
    )
    session_id = provider.start_session({"directory": str(workspace), "mode": "workspace"})[
        "sessionId"
    ]

    _send(provider, session_id, "Could you help with this?")

    message = _last_event(events, "message")
    assert message["contract"]["intent"] == "scope_clarification"
    assert message["contract"]["scope"] == "ambiguous"
    assert "relates to" in str(message["text"])
    assert not any(event["type"] == "error" for event in events)


def test_unknown_stage_routing_proposal_falls_back_without_excluding_bm25() -> None:
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []

    def invalid_stage(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": ["not_a_published_stage"],
            "rationale": "untrusted stage",
        }

    def answer(context: dict[str, object]) -> dict[str, object]:
        contexts.append(context)
        return _chat_response(answer="Clock-tree evidence is available.")

    provider = EcosAgentProvider(
        emit=events.append,
        stage_routing_parser=invalid_stage,
        chat_response_parser=answer,
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    _send(provider, session_id, "How are clock tree buffers and insertion latency reported?")

    retrieved = contexts[0]["retrieved_knowledge"]
    fusion = retrieved["retrieval"]["fusion"]
    assert fusion["routing"] == {"status": "rejected", "reason": "unknown_stage"}
    assert fusion["baseline_entity_ids"]
    assert retrieved["entity_ids"][: len(fusion["baseline_entity_ids"])] == fusion["baseline_entity_ids"]


def test_started_provider_enables_default_stage_routing(monkeypatch) -> None:
    events: list[dict[str, object]] = []
    stage_contexts: list[dict[str, object]] = []
    monkeypatch.setattr("ecos_agent.gui.provider.validate_required_codex_cli", lambda: "codex")
    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=lambda _context: _chat_response(answer="Clock-tree evidence is available."),
        source_retrieval_parser=lambda _context: {
            "schema_version": "flow-agent.source_search_proposal.v1",
            "queries": [],
            "rationale": "No source lookup is needed for this stage-routing test.",
        },
    )

    def stage_router(context: dict[str, object]) -> dict[str, object]:
        stage_contexts.append(context)
        return {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
            "scope": "in_scope",
            "candidate_stages": ["cts"],
            "rationale": "Clock-tree terms map to CTS.",
        }

    provider.stage_routing_parser = stage_router
    provider.start()
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _send(provider, session_id, "How are clock tree buffers and insertion latency reported?")

    assert stage_contexts[0]["schema_version"] == "flow-agent.stage_routing_request.v1"
    assert stage_contexts[0]["stage_catalog"]
