import json
import threading
from pathlib import Path

import pytest

import ecos_agent.provider_support as provider_support
from ecos_agent.codex_provider import CodexAppServerProposalProvider, CodexProviderError, _resolve_codex_bin
from ecos_agent.contracts import GuiWorkspaceSetupProposal, StageRoutingProposal
from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.messages import EMPTY_CHOICE_VALUE
from ecos_agent.provider import EcosAgentProvider, PROVIDER_ID
from ecos_agent.source_retriever import SourceCodeRetriever
from ecos_agent.workspace_rerun import GuiWorkspaceRerunResolver, GuiWorkspaceRerunSource
from ecos_agent.workspace_setup import (
    WorkspaceInputs,
    display_path,
    recommended_workspace_name,
    workspace_search_roots,
    workspace_setup_contract,
)


def _proposal(**overrides: object) -> GuiWorkspaceSetupProposal:
    payload: dict[str, object] = {
        "schema_version": "flow-agent.gui_workspace_setup_proposal.v1",
        "workspace_name": None,
        "description": None,
        "design_name": None,
        "top_module": None,
        "clock_name": None,
        "frequency_mhz": None,
        "max_fanout": None,
        "flow_start": None,
        "flow_end": None,
        "die_area_mode": None,
        "utilitization": None,
        "margin": None,
        "die_width": None,
        "die_height": None,
        "target_density": None,
        "target_overflow": None,
        "project_root": None,
        "rtl_path": None,
        "filelist_path": None,
        "sdc_path": None,
        "pdk_root": None,
        "summary": "No correction.",
    }
    payload.update(overrides)
    return GuiWorkspaceSetupProposal.model_validate(payload)


def _chat_response(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": "flow-agent.gui_chat_response.v1",
        "operation": None,
        "answer": "I can help with ECOS design-flow questions.",
    }
    payload.update(overrides)
    return payload


def _send(provider: EcosAgentProvider, session_id: str, message: str) -> None:
    provider.send_message({"sessionId": session_id, "message": message})


def _last_event(events: list[dict[str, object]], event_type: str) -> dict[str, object]:
    return next(event for event in reversed(events) if event["type"] == event_type)


def _write_workspace_inputs(root: Path) -> tuple[Path, Path, Path, Path]:
    rtl = root / "gcd.v"
    filelist = root / "gcd.f"
    sdc = root / "gcd.sdc"
    pdk = root / "pdk"
    rtl.write_text("module gcd(input clk); endmodule\n", encoding="utf-8")
    filelist.write_text("gcd.v\n", encoding="utf-8")
    sdc.write_text("create_clock -period 10 [get_ports clk]\n", encoding="utf-8")
    pdk.mkdir()
    return rtl, filelist, sdc, pdk


def test_codex_bin_expands_the_user_home_directory(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "bin" / "codex"
    codex.parent.mkdir()
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    monkeypatch.setenv("HOME", str(tmp_path))

    assert _resolve_codex_bin("~/bin/codex", {"PATH": ""}) == str(codex)


def test_source_manifest_uses_the_user_codex_environment() -> None:
    manifest_path = Path(__file__).parents[1] / "agent-provider.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["command"] == "uv"
    assert "ECOS_AGENT_CODEX_BIN" not in manifest.get("environment", {})


def test_workspace_setup_contract_carries_project_mpc_snapshot(tmp_path: Path) -> None:
    rtl, filelist, sdc, pdk = _write_workspace_inputs(tmp_path)
    mpc_root = tmp_path / "mpc-frame"
    mpc_root.mkdir()
    mpc = {
        "resource_id": "mpc:mpc-frame",
        "display_name": "MPC Frame",
        "installed_version": "0.1.0",
        "path": str(mpc_root),
        "spec_path": str(mpc_root / "spec" / "spec.json.in"),
        "design": {"index": 0, "design_name": "frame"},
        "core_template": {"minimum_area": 100},
    }
    (tmp_path / "project.json").write_text(json.dumps({"mpc": mpc}), encoding="utf-8")

    contract = workspace_setup_contract(
        _proposal(
            workspace_name="ws_0001",
            design_name="gcd",
            top_module="gcd",
            clock_name="clk",
            flow_start="Synthesis",
            flow_end="Harden",
        ),
        WorkspaceInputs(
            project_root=str(tmp_path),
            rtl_path=str(rtl),
            filelist_path=str(filelist),
            sdc_path=str(sdc),
            pdk_root=str(pdk),
        ),
        "en",
        "setup-mpc",
    )

    assert contract["mpc"] == mpc
    assert contract["parameters"]["MPC"] == mpc

    skipped = workspace_setup_contract(
        _proposal(
            workspace_name="ws_0001",
            design_name="gcd",
            top_module="gcd",
            clock_name="clk",
            flow_start="Synthesis",
            flow_end="Harden",
        ),
        WorkspaceInputs(
            project_root=str(tmp_path),
            rtl_path=str(rtl),
            filelist_path=str(filelist),
            sdc_path=str(sdc),
            pdk_root=str(pdk),
        ),
        "en",
        "setup-no-mpc",
        mpc_enabled=False,
    )
    assert "mpc" not in skipped
    assert "MPC" not in skipped["parameters"]


def test_new_ephemeral_thread_discards_prior_case_context(tmp_path: Path) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    provider._thread_id = "prior-thread"
    provider._interrupted = True

    provider.new_ephemeral_thread()

    assert provider._thread_id is None
    assert provider._interrupted is False
    provider._active_turn_id = "active-turn"
    with pytest.raises(CodexProviderError, match="turn is active"):
        provider.new_ephemeral_thread()


def test_timeout_closes_the_app_server_before_the_next_proposal(tmp_path: Path) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)

    class FakeClient:
        def __init__(self) -> None:
            self.closed = 0

        def request(self, method: str, params: dict[str, object]) -> dict[str, object]:
            assert method == "turn/start"
            assert params["summary"] == "detailed"
            return {"turn": {"id": "turn-1"}}

        def wait_for_turn_details(
            self, _turn_id: str, *, thread_id: str, activity_callback: object
        ) -> tuple[str, None]:
            assert thread_id == "thread-1"
            raise CodexProviderError("timeout", failure_class="timeout")

        def close(self) -> None:
            self.closed += 1

    client = FakeClient()
    provider._client = client
    provider._thread_id = "thread-1"

    with pytest.raises(CodexProviderError, match="timeout"):
        provider._run_turn("prompt", {})

    assert client.closed == 1
    assert provider._client is None
    assert provider._thread_id is None


def test_start_fails_closed_when_codex_cli_is_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("ECOS_AGENT_CODEX_BIN", raising=False)
    monkeypatch.setenv("PATH", "")
    provider = EcosAgentProvider(emit=lambda _event: None)

    try:
        provider.start()
    except CodexProviderError as exc:
        assert exc.failure_class == "missing_input"
    else:
        raise AssertionError("Agent start must reject an unavailable Codex CLI")


def test_workspace_search_roots_do_not_include_project_siblings(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()

    assert workspace_search_roots(str(project_root)) == (str(project_root),)


def test_codex_rerun_parameter_prompt_requires_boolean_and_multi_knob_interpretation(
    tmp_path: Path, monkeypatch
) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    prompts: list[str] = []

    def capture_proposal(
        _context: dict[str, object], system: str, _schema: dict[str, object], _model: object
    ) -> dict[str, object]:
        prompts.append(system)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [],
            "summary": "No change.",
        }

    monkeypatch.setattr(provider, "_proposal", capture_proposal)
    provider.propose_gui_workspace_rerun_patch(
        {
            "allowed_knobs": ["place.routability_opt", "place.target_overflow"],
            "boolean_knobs": ["place.routability_opt"],
        }
    )

    assert "every requested applicable parameter change" in prompts[0]
    assert "unqualified knob name" in prompts[0]
    assert "numeric 0 as false and 1 as true" in prompts[0]


def test_run_flow_only_emits_a_frozen_workspace_contract(tmp_path: Path) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, pdk = _write_workspace_inputs(tmp_path)
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []

    def parse_workspace_setup(context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        parser_contexts.append(context)
        callback = context["_progress_callback"]
        assert callable(callback)
        callback("Codex is analyzing the bounded numeric request.")
        return _proposal(target_overflow=0.1)

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=parse_workspace_setup,
        workspace_path_recommender=lambda _context: _proposal(),
    )

    session_id = provider.start_session({})["sessionId"]
    for message in (
        "1",
        "2",
        str(project_root),
        "ws_0001",
        "gcd",
        "4",
        str(rtl),
        str(filelist),
            str(sdc),
            str(pdk),
            "2",
            "",
        "",
        "",
        "",
        "",
        "",
        "target overflow is 0.1",
    ):
        _send(provider, session_id, message)

    setup = next(event["workspaceSetup"] for event in events if event["type"] == "workspace_setup")
    assert PROVIDER_ID == "ecos_agent"
    assert "execute" not in provider.__dict__
    assert setup["schema_version"] == "flow-agent.workspace_setup_contract.v2"
    assert setup["directory"] == str(project_root / "ws_0001")
    assert setup["parameters"]["design"] == "gcd"
    assert setup["project_context"]["project_root"] == str(project_root)
    assert setup["parameters"]["target_overflow"] == 0.1
    assert parser_contexts[0]["numeric_field"] == "target_overflow"
    assert parser_contexts[0]["numeric_bounds"] == {"lower": 0, "upper": 1}
    assert all(event["type"] != "error" for event in events)
    assert any(event["type"] == "tool" for event in events)
    choice = _last_event(events, "choice")["choice"]
    assert choice["variant"] == "buttons"
    assert choice["allowFreeText"] is True
    assert [option["value"] for option in choice["options"]] == ["1", "2"]
    assert _last_event(events, "status")["status"] == "awaiting_choice"

    _send(provider, session_id, "1")

    workspace_create = _last_event(events, "workspace_create")
    assert workspace_create["providerId"] == "ecos_agent"


def test_numeric_semantic_fallback_fails_closed_when_codex_times_out(tmp_path: Path) -> None:
    events: list[dict[str, object]] = []

    def mock_codex_timeout(_context: dict[str, object]) -> None:
        raise CodexProviderError("mock timeout", failure_class="timeout")

    provider = EcosAgentProvider(emit=events.append, workspace_setup_parser=mock_codex_timeout)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_overflow"
    session.workspace_inputs.project_root = str(tmp_path)

    _send(provider, session_id, "target overflow is 0.1")

    assert session.phase == "workspace_overflow"
    assert any(
        event["type"] == "message" and "Unable to interpret" in str(event["text"])
        for event in events
    )
    assert not any(event["type"] == "workspace_setup" for event in events)


def test_rerun_uses_the_open_gui_workspace_as_the_default_source(tmp_path: Path) -> None:
    workspace = tmp_path / "source-workspace"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "2")

    assert provider.sessions[session_id].phase == "rerun_source_run"
    assert provider.sessions[session_id].design_id == "gcd"
    source_choice = _last_event(events, "choice")["choice"]
    assert source_choice["title"] == "Source workspace"
    assert source_choice["variant"] == "list"
    assert source_choice["allowFreeText"] is True
    assert [
        (option["label"], option["value"]) for option in source_choice["options"]
    ] == [(str(workspace), "1")]
    assert any(
        event["type"] == "tool" and "Preparing stage rerun" in str(event.get("text", ""))
        for event in events
    )

    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "rerun_stage"
    stage_choice = _last_event(events, "choice")["choice"]
    assert stage_choice["title"] == "Start stage"
    assert [
        (option["label"], option["value"]) for option in stage_choice["options"]
    ] == [("place", "1")]


def test_rerun_skips_empty_parameter_table_for_fixfanout(tmp_path: Path) -> None:
    workspace = tmp_path / "source-workspace"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "fixFanout", "tool": "ecc", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "fixFanout_ecc" / "output"
    output.mkdir(parents=True)
    (output / "gcd_fixFanout.def.gz").write_bytes(b"def")
    (workspace / "home" / "parameters.json").write_text(
        '{"Design": "gcd"}', encoding="utf-8"
    )
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    for message in ("2", "1", "1"):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    assert session.phase == "rerun_scope"
    assert session.rerun_stage == "fixFanout"
    assert session.rerun_parameter_patch == []
    assert any(
        event["type"] == "message"
        and "no tunable rerun parameters" in str(event["text"]).lower()
        for event in events
    )
    assert not any(
        event["type"] == "message" and "| Parameter | Current value |" in str(event["text"])
        for event in events
    )


def test_home_mode_starts_with_primary_cta_not_operation_list() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=lambda _context: _chat_response(answer="Please describe your ECOS question."),
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]

    assert provider.sessions[session_id].phase == "home_ready"
    choice = _last_event(events, "choice")["choice"]
    assert choice["title"] == "Get started"
    assert choice["variant"] == "buttons"
    assert choice["allowFreeText"] is True
    assert [option["value"] for option in choice["options"]] == ["1"]
    assert "Start creating a Workspace" in choice["options"][0]["label"]
    welcome = next(event["text"] for event in events if event["type"] == "message")
    assert "Start below" in str(welcome)
    assert "Choose an operation below" not in str(welcome)

    choice_count = len([event for event in events if event["type"] == "choice"])
    _send(provider, session_id, "2")
    assert provider.sessions[session_id].phase == "home_ready"
    assert _last_event(events, "message")["text"] == "Please describe your ECOS question."
    assert len([event for event in events if event["type"] == "choice"]) == choice_count


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
    choice_count = len([event for event in events if event["type"] == "choice"])
    _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "home_ready"
    assert contexts[0]["natural_language_request"] == message
    assert contexts[0]["response_language"] == language
    assert _last_event(events, "message")["text"] == f"Codex answered {message}."
    assert _last_event(events, "message")["contract"]["schema_version"] == "flow-agent.gui_chat_response.v1"
    assert len([event for event in events if event["type"] == "choice"]) == choice_count
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
    choice_count = len([event for event in events if event["type"] == "choice"])

    _send(provider, session_id, "hello")

    assert session.phase == "workspace_design"
    assert _last_event(events, "message")["text"] == "I can help while waiting for workspace_design."
    assert len([event for event in events if event["type"] == "choice"]) == choice_count

    _send(provider, session_id, "gcd")

    assert session.phase == "workspace_flow_end"


def test_gui_chat_response_prompt_is_read_only_and_structured(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    captured: dict[str, object] = {}

    def capture_turn(prompt: str, schema: dict[str, object]) -> str:
        captured.update(prompt=prompt, schema=schema)
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
    assert "Audited target-overflow knowledge." in str(captured["prompt"])
    assert "def route(): ..." in str(captured["prompt"])
    assert captured["schema"]["properties"]["evidence_ids"]["maxItems"] == 12
    assert captured["schema"]["required"] == [
        "schema_version",
        "operation",
        "answer",
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

    def capture_turn(prompt: str, schema: dict[str, object]) -> str:
        captured.update(prompt=prompt, schema=schema)
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

    def capture_turn(prompt: str, schema: dict[str, object]) -> str:
        captured.update(prompt=prompt, schema=schema)
        return json.dumps(
            {
                "schema_version": "flow-agent.stage_routing_slots.v1",
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
        "primary_stage",
        "secondary_stage",
        "tertiary_stage",
        "rationale",
    ]
    assert "candidate_stages" not in captured["schema"]["properties"]
    assert captured["schema"]["properties"]["primary_stage"]["enum"] == ["place", "route", None]


def test_stage_routing_contract_rejects_too_many_or_duplicate_candidates() -> None:
    base = {
        "schema_version": "flow-agent.stage_routing_proposal.v1",
        "rationale": "bounded local routing",
    }

    with pytest.raises(ValueError, match="too many"):
        StageRoutingProposal.model_validate(
            {**base, "candidate_stages": ["place", "route", "cts", "sta"]}
        )
    with pytest.raises(ValueError, match="candidates are invalid"):
        StageRoutingProposal.model_validate({**base, "candidate_stages": ["place", "place"]})


def test_unknown_stage_routing_proposal_falls_back_without_excluding_bm25() -> None:
    events: list[dict[str, object]] = []
    contexts: list[dict[str, object]] = []

    def invalid_stage(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.stage_routing_proposal.v1",
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
    monkeypatch.setattr("ecos_agent.provider.validate_required_codex_cli", lambda: "codex")
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
            "candidate_stages": ["cts"],
            "rationale": "Clock-tree terms map to CTS.",
        }

    provider.stage_routing_parser = stage_router
    provider.start()
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _send(provider, session_id, "How are clock tree buffers and insertion latency reported?")

    assert stage_contexts[0]["schema_version"] == "flow-agent.stage_routing_request.v1"
    assert stage_contexts[0]["stage_catalog"]


def test_home_nl_bootstrap_skips_fields_that_are_already_clear(tmp_path: Path) -> None:
    project_root = tmp_path / "gcd_project"
    project_root.mkdir()
    (project_root / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []

    def parse_operation(context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.gui_chat_response.v1",
            "operation": "1",
            "answer": None,
        }

    provider = EcosAgentProvider(
        emit=events.append,
        chat_response_parser=parse_operation,
    )
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    _send(
        provider,
        session_id,
        f"使用已有 Project {project_root} 创建 workspace，命名 ws_0009，设计名 gcd",
    )

    session = provider.sessions[session_id]
    assert session.phase == "workspace_flow_end"
    assert session.workspace_inputs.project_root == str(project_root.resolve())
    assert session.workspace_setup.workspace_name == "ws_0009"
    assert session.workspace_setup.design_name == "gcd"


def test_workspace_mode_rerun_uses_bound_directory_without_design_prompt(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "2")
    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "rerun_stage"
    assert not any(event["type"] == "workspace_rerun" for event in events)


def test_rerun_freezes_evidence_before_requesting_gui_execution(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    config = workspace / "config"
    config.mkdir()
    (config / "dreamplace.json").write_text(
        '{"target_density": 0.2, "routability_opt_flag": true, "stop_overflow": 0.0}',
        encoding="utf-8",
    )
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []

    def parse_rerun_parameter(context: dict[str, object]) -> dict[str, object]:
        parser_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [
                {"knob_id": "place.routability_opt", "value": 0},
                {"knob_id": "place.target_overflow", "value": 0.1},
            ],
            "summary": "Disable routability optimization and set target overflow.",
        }

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=parse_rerun_parameter,
    )

    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    for message in (
        "2",
        "1",
        "1",
        "set place.routability_opt to 0,set target_overflow to 0.1",
    ):
        _send(provider, session_id, message)

    parameter_message = next(
        event
        for event in reversed(events)
        if event["type"] == "message" and "Parameters available for this stage" in str(event["text"])
    )
    assert "| place.routability_opt | false |" in str(parameter_message["text"])
    assert "| place.target_overflow | 0.1 |" in str(parameter_message["text"])
    scope_choice = _last_event(events, "choice")["choice"]
    assert scope_choice["title"] == "Choose the execution scope"
    assert [option["value"] for option in scope_choice["options"]] == ["1", "2"]

    _send(provider, session_id, "2")

    contract = _last_event(events, "contract")
    assert "Confirm and start" in str(contract["text"])
    confirmation = _last_event(events, "choice")["choice"]
    assert confirmation["variant"] == "buttons"
    assert confirmation["allowFreeText"] is False
    assert [option["value"] for option in confirmation["options"]] == ["1", "2"]
    assert not any(
        event["type"] == "message" and "Confirm and start" in str(event.get("text"))
        for event in events
    )

    _send(provider, session_id, "1")

    rerun = _last_event(events, "workspace_rerun")["workspaceRerun"]
    assert rerun["schema_version"] == "flow-agent.workspace_rerun_contract.v1"
    assert rerun["execution_scope"] == "full_flow"
    assert rerun["end_step"] == "Harden"
    assert parser_contexts[0]["natural_language_request"] == (
        "set place.routability_opt to 0,set target_overflow to 0.1"
    )
    assert parser_contexts[0]["boolean_knobs"] == ["place.routability_opt"]
    assert rerun["parameter_patch"] == [
        {"knob_id": "place.routability_opt", "value": False},
        {"knob_id": "place.target_overflow", "value": 0.1},
    ]
    assert rerun["writes"] == [
        {
            "file": "home/parameters.json",
            "json_path": ["Routability opt flag"],
            "knob_id": "place.routability_opt",
            "surface": "parameters",
            "value": 0,
        },
        {
            "file": "home/parameters.json",
            "json_path": ["Target overflow"],
            "knob_id": "place.target_overflow",
            "surface": "parameters",
            "value": 0.1,
        },
    ]

    _send(
        provider,
        session_id,
        "workspace_rerun_result:" + json.dumps({"rerun_id": "gcd_rerun_place", "status": "succeeded", "error": ""}),
    )

    assert provider.sessions[session_id].phase == "operation"
    operation_choice = _last_event(events, "choice")["choice"]
    assert operation_choice["title"] == "Choose an operation"
    assert _last_event(events, "status")["status"] == "awaiting_choice"


def test_rerun_workspace_invalid_path_reemits_current_workspace_choice(tmp_path: Path) -> None:
    workspace = tmp_path / "source-workspace"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "rerun_workspace"
    session.design_id = "gcd"

    _send(provider, session_id, str(tmp_path / "missing-workspace"))

    assert session.phase == "rerun_workspace"
    choice = _last_event(events, "choice")["choice"]
    assert choice["title"] == "Choose the source workspace"
    assert choice["variant"] == "buttons"
    assert choice["allowFreeText"] is True
    assert [(option["label"], option["value"]) for option in choice["options"]] == [
        ("Use current GUI workspace", str(workspace))
    ]
    assert _last_event(events, "status")["status"] == "awaiting_choice"
    assert any(
        event["type"] == "message"
        and "Use the current GUI workspace below" in str(event["text"])
        for event in events
    )


def test_workspace_contract_validation_failure_reemits_top_choice(tmp_path: Path) -> None:
    rtl, _filelist, _sdc, pdk = _write_workspace_inputs(tmp_path)
    rtl.write_text("module other(input clk); endmodule\n", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.workspace_inputs.project_root = str(tmp_path)
    session.workspace_inputs.project_name = tmp_path.name
    session.workspace_inputs.rtl_path = str(rtl)
    session.workspace_inputs.pdk_root = str(pdk)
    session.workspace_setup = _proposal(
        workspace_name="ws_0001",
        design_name="gcd",
        top_module="gcd",
        clock_name="clk",
        frequency_mhz=100,
        max_fanout=32,
        utilitization=0.7,
        target_density=0.5,
        target_overflow=0.1,
        rtl_path=str(rtl),
        pdk_root=str(pdk),
        project_root=str(tmp_path),
    )
    session.phase = "workspace_overflow"

    _send(provider, session_id, "0.1")

    assert session.phase == "workspace_top"
    choice = _last_event(events, "choice")["choice"]
    assert choice["title"] == "Top Module Name"
    assert [option["value"] for option in choice["options"]] == ["gcd"]
    assert _last_event(events, "status")["status"] == "awaiting_choice"


def test_workspace_parameter_request_uses_describe_change_prompt(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "1")

    assert provider.sessions[session_id].phase == "workspace_parameter_request"
    assert any(
        event["type"] == "message"
        and "Describe the parameter change to save in the current workspace" in str(event["text"])
        for event in events
    )
    assert not any(
        event["type"] == "message"
        and "no tunable rerun parameters" in str(event["text"]).lower()
        for event in events
    )


def test_workspace_continue_uses_compact_confirm_without_command_table(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]

    _send(provider, session_id, "3")

    assert provider.sessions[session_id].phase == "workspace_continue_confirmation"
    contract = _last_event(events, "contract")
    assert contract["contract"]["presentation"] == "workspace_continue"
    assert contract["contract"]["fields"] == []
    assert "runAllFlow" not in str(contract["text"])
    assert str(workspace) in str(contract["text"])
    assert "Continue the unfinished flow in the current workspace" in str(contract["text"])


def _workspace_with_fixfanout_and_place(tmp_path: Path) -> Path:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        json.dumps(
            {
                "steps": [
                    {"name": "fixFanout", "tool": "ecc", "state": "Success"},
                    {"name": "place", "tool": "dreamplace", "state": "Success"},
                ]
            }
        ),
        encoding="utf-8",
    )
    for step, tool, suffix in (
        ("fixFanout", "ecc", ".def.gz"),
        ("place", "dreamplace", ".def.gz"),
    ):
        output = workspace / f"{step}_{tool}" / "output"
        output.mkdir(parents=True)
        (output / f"gcd_{step}{suffix}").write_bytes(b"def")
    config = workspace / "config"
    config.mkdir()
    (config / "dreamplace.json").write_text(
        '{"target_density": 0.55, "routability_opt_flag": true, "stop_overflow": 0.1}',
        encoding="utf-8",
    )
    (workspace / "home" / "parameters.json").write_text(
        '{"Design": "gcd", "Target density": 0.55}',
        encoding="utf-8",
    )
    return workspace


def test_workspace_parameter_update_lists_concrete_knob_values(tmp_path: Path) -> None:
    workspace = _workspace_with_fixfanout_and_place(tmp_path)
    events: list[dict[str, object]] = []
    parser_contexts: list[dict[str, object]] = []

    def parse_parameter(context: dict[str, object]) -> dict[str, object]:
        parser_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [{"knob_id": "place.target_density", "value": 0.4}],
            "summary": "Lower target density.",
        }

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=parse_parameter,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "1")
    _send(provider, session_id, "lower target density")

    assert provider.sessions[session_id].phase == "workspace_parameter_confirmation"
    assert "place.target_density" in parser_contexts[0]["allowed_knobs"]
    contract = _last_event(events, "contract")["contract"]
    assert contract["presentation"] == "workspace_parameter_update"
    assert contract["fields"] == [
        {"label": "Workspace", "value": str(workspace)},
        {"label": "place.target_density", "value": "0.55 → 0.4"},
    ]


def test_workspace_parameter_update_rejects_empty_patch(tmp_path: Path) -> None:
    workspace = _workspace_with_fixfanout_and_place(tmp_path)
    events: list[dict[str, object]] = []

    def empty_patch(_context: dict[str, object]) -> dict[str, object]:
        return {
            "schema_version": "flow-agent.gui_workspace_rerun_parameter_proposal.v1",
            "parameter_patch": [],
            "summary": "No changes.",
        }

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=empty_patch,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    _send(provider, session_id, "1")
    _send(provider, session_id, "lower target density")

    assert provider.sessions[session_id].phase == "workspace_parameter_request"
    assert any(
        event["type"] == "error" and "no parameter changes were proposed" in str(event["text"])
        for event in events
    )
    assert not any(event["type"] == "contract" for event in events)


def test_invalid_choice_and_creation_failed_copy_point_to_cards() -> None:
    from ecos_agent.messages import invalid_choice, workspace_creation_failed

    assert "listed numbers" not in invalid_choice("en").lower()
    assert "enter 1" not in workspace_creation_failed("en", "disk full").lower()
    assert "confirm again" in workspace_creation_failed("en", "disk full").lower()


def test_rerun_allocates_a_numbered_target_when_the_default_exists(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    workspace.mkdir()
    (tmp_path / "gcd_rerun_place").mkdir()
    source = GuiWorkspaceRerunSource(
        workspace_path=workspace,
        design_id="gcd",
        flow_json_sha256="0" * 64,
        end_step=ECCStepName.PLACEMENT,
        allowed_stages=("place",),
        stage_artifact_ref={"place": "place_dreamplace/output/gcd_place.def.gz"},
        stage_artifact_sha256={"place": "1" * 64},
    )

    contract = GuiWorkspaceRerunResolver(tmp_path).freeze(source, "place", [], "single_step")

    assert contract.target_workspace == str(tmp_path / "gcd_rerun_place_0001")
    assert contract.rerun_id == "gcd_rerun_place_0001"


def test_rerun_fails_closed_when_mock_codex_times_out(tmp_path: Path) -> None:
    workspace = tmp_path / "gcd"
    flow = workspace / "home" / "flow.json"
    flow.parent.mkdir(parents=True)
    flow.write_text(
        '{"steps": [{"name": "place", "tool": "dreamplace", "state": "Success"}]}',
        encoding="utf-8",
    )
    output = workspace / "place_dreamplace" / "output"
    output.mkdir(parents=True)
    (output / "gcd_place.def.gz").write_bytes(b"def")
    config = workspace / "config"
    config.mkdir()
    (config / "dreamplace.json").write_text('{"target_density": 0.2}', encoding="utf-8")
    events: list[dict[str, object]] = []

    def mock_codex_timeout(_context: dict[str, object]) -> None:
        raise CodexProviderError("mock timeout", failure_class="timeout")

    provider = EcosAgentProvider(
        emit=events.append,
        rerun_parameter_parser=mock_codex_timeout,
    )
    session_id = provider.start_session(
        {"directory": str(workspace), "mode": "workspace"}
    )["sessionId"]
    for message in ("2", "1", "1", "reduce density"):
        _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "rerun_parameter"
    assert "mock timeout" in _last_event(events, "error")["text"]
    assert not any(event["type"] in {"contract", "workspace_rerun"} for event in events)


def test_optional_path_steps_emit_skip_and_recommendation_choices(tmp_path: Path) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=lambda _context: _proposal(
            filelist_path=str(filelist),
            sdc_path=str(sdc),
        ),
    )
    session_id = provider.start_session({})["sessionId"]
    for message in ("1", "2", str(project_root), "ws_0001", "gcd", "4", str(rtl)):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    session.path_recommendations["pdk"] = str(pdk)
    assert session.phase == "workspace_filelist"
    filelist_choice = _last_event(events, "choice")["choice"]
    assert filelist_choice["allowFreeText"] is True
    assert filelist_choice["variant"] == "buttons"
    assert [option["label"] for option in filelist_choice["options"]] == [
        "Use recommended path",
        "Skip",
    ]
    assert filelist_choice["options"][0]["value"] == display_path(str(filelist))
    assert filelist_choice["options"][1]["value"] == EMPTY_CHOICE_VALUE
    assert _last_event(events, "status")["status"] == "awaiting_choice"

    _send(provider, session_id, EMPTY_CHOICE_VALUE)

    assert session.phase == "workspace_sdc"
    assert session.workspace_inputs.filelist_path == ""
    sdc_choice = _last_event(events, "choice")["choice"]
    assert sdc_choice["options"][0]["value"] == display_path(str(sdc))
    assert sdc_choice["options"][1]["value"] == EMPTY_CHOICE_VALUE

    _send(provider, session_id, str(sdc))
    assert session.phase == "workspace_pdk"
    pdk_choice = _last_event(events, "choice")["choice"]
    assert [option["label"] for option in pdk_choice["options"]] == ["Use recommended path"]
    assert pdk_choice["options"][0]["value"] == display_path(str(pdk))

    _send(provider, session_id, pdk_choice["options"][0]["value"])
    assert session.phase == "workspace_mpc"
    mpc_choice = _last_event(events, "choice")["choice"]
    assert [option["label"] for option in mpc_choice["options"]] == [
        "Use a SoC-MPC template",
        "Do not use a SoC-MPC template",
    ]
    _send(provider, session_id, "2")
    assert session.phase == "workspace_top"
    top_choice = _last_event(events, "choice")["choice"]
    assert top_choice["options"][0]["label"].startswith("Use default:")
    assert top_choice["allowFreeText"] is True


def test_workspace_confirmation_accepts_deterministic_frequency_and_workspace_name(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    rtl, _filelist, _sdc, pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []

    def reject_codex(_context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        raise AssertionError("simple Spec corrections must stay deterministic")

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=reject_codex,
    )
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-fields"
    session.workspace_inputs.project_root = str(project_root)
    session.workspace_inputs.project_name = "gcd"
    session.workspace_inputs.rtl_path = str(rtl)
    session.workspace_inputs.pdk_root = str(pdk)
    session.workspace_setup = _proposal(
        workspace_name="ws_0001",
        design_name="gcd",
        top_module="gcd",
        clock_name="clk",
        frequency_mhz=50,
        max_fanout=32,
        utilitization=0.7,
        target_density=0.5,
        target_overflow=0.1,
        rtl_path=str(rtl),
        pdk_root=str(pdk),
        project_root=str(project_root),
    )

    _send(provider, session_id, "把频率改成 200")
    assert session.workspace_setup.frequency_mhz == 200

    _send(provider, session_id, "Workspace Name 改为 ws_0040")
    assert session.workspace_setup.workspace_name == "ws_0040"
    assert not any(event["type"] == "error" for event in events)


def test_workspace_confirmation_accepts_explicit_external_pdk_path(tmp_path: Path) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    rtl, _filelist, _sdc, old_pdk = _write_workspace_inputs(project_root)
    external_pdk = tmp_path / "icsprout55-pdk"
    external_pdk.mkdir()
    events: list[dict[str, object]] = []

    def reject_codex(_context: dict[str, object]) -> GuiWorkspaceSetupProposal:
        raise AssertionError("explicit PDK path correction must stay deterministic")

    provider = EcosAgentProvider(
        emit=events.append,
        workspace_setup_parser=reject_codex,
    )
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]
    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-pdk"
    session.workspace_inputs.project_root = str(project_root)
    session.workspace_inputs.project_name = "gcd"
    session.workspace_inputs.rtl_path = str(rtl)
    session.workspace_inputs.pdk_root = str(old_pdk)
    session.workspace_setup = _proposal(
        workspace_name="ws_0036",
        design_name="gcd",
        top_module="gcd",
        clock_name="clk",
        frequency_mhz=100,
        max_fanout=32,
        utilitization=0.7,
        target_density=0.5,
        target_overflow=0.1,
        rtl_path=str(rtl),
        pdk_root=str(old_pdk),
        project_root=str(project_root),
    )

    _send(
        provider,
        session_id,
        f"修改 pdk 路径 为: {external_pdk}",
    )

    assert session.phase == "workspace_confirmation"
    assert session.workspace_inputs.pdk_root == str(external_pdk.resolve())
    assert not any(event["type"] == "error" for event in events)
    assert any(
        event["type"] == "workspace_setup"
        and event.get("workspaceSetup", {}).get("pdk_root") == str(external_pdk.resolve())
        for event in events
    ) or session.workspace_contract is not None


def test_operation_and_cancellation_choices_preserve_the_controlled_paths() -> None:
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({})["sessionId"]
    session = provider.sessions[session_id]

    home_ready = _last_event(events, "choice")["choice"]
    assert home_ready["title"] == "Get started"
    assert home_ready["variant"] == "buttons"
    assert home_ready["allowFreeText"] is True
    assert [option["value"] for option in home_ready["options"]] == ["1"]

    session.phase = "workspace_confirmation"
    session.workspace_setup_id = "setup-1"
    _send(provider, session_id, "2")

    assert session.phase == "home_ready"
    assert not any(event["type"] == "workspace_create" for event in events)
    assert "Cancelled" in str(_last_event(events, "message")["text"])

    session.mode = "workspace"
    session.phase = "confirmation"
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


def test_start_session_binds_project_root_and_welcome_shows_both_contexts(
    tmp_path: Path,
) -> None:
    project = tmp_path / "gcd"
    workspace = project / "ws_0001"
    workspace.mkdir(parents=True)
    (project / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)

    session_id = provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "projectRoot": str(project),
        }
    )["sessionId"]
    session = provider.sessions[session_id]
    assert session.project_root == str(project)
    welcome = next(event["text"] for event in events if event["type"] == "message")
    assert f"Project: {project}" in str(welcome)
    assert f"Workspace: {workspace}" in str(welcome)
    operation = _last_event(events, "choice")["choice"]
    assert [option["value"] for option in operation["options"]] == ["1", "2", "3", "4"]


def test_standalone_workspace_hides_create_sibling_option(tmp_path: Path) -> None:
    workspace = tmp_path / "orphan_ws"
    workspace.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    provider.start_session({"directory": str(workspace), "mode": "workspace"})
    operation = _last_event(events, "choice")["choice"]
    assert [option["value"] for option in operation["options"]] == ["1", "2", "3"]


def test_existing_project_branch_requires_project_json_and_uses_workspace_name(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    (project_root / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=lambda _context: _proposal(),
    )
    session_id = provider.start_session(
        {
            "mode": "home",
            "knownProjects": [{"name": "projects", "path": str(project_root)}],
        }
    )["sessionId"]

    _send(provider, session_id, "1")
    assert provider.sessions[session_id].phase == "workspace_project_mode"
    mode_choice = _last_event(events, "choice")["choice"]
    assert mode_choice["title"] == "Choose a Project"
    assert [option["value"] for option in mode_choice["options"]] == ["1", "2"]

    _send(provider, session_id, "1")
    assert provider.sessions[session_id].phase == "workspace_project_root"
    known = _last_event(events, "choice")["choice"]
    assert known["options"][0]["value"] == str(project_root)

    _send(provider, session_id, str(project_root))
    assert provider.sessions[session_id].phase == "workspace_name"
    _send(provider, session_id, "ws_0003")
    assert provider.sessions[session_id].phase == "workspace_design"
    _send(provider, session_id, "gcd")
    assert provider.sessions[session_id].phase == "workspace_flow_end"
    assert provider.sessions[session_id].workspace_setup.workspace_name == "ws_0003"
    assert provider.sessions[session_id].workspace_setup.design_name == "gcd"
    flow_end_choice = _last_event(events, "choice")["choice"]
    assert flow_end_choice["title"] == "Choose the end step"
    assert flow_end_choice["variant"] == "list"
    assert flow_end_choice["options"][0] == {
        "id": flow_end_choice["options"][0]["id"],
        "label": "Run all steps",
        "value": "0",
    }
    assert [option["label"] for option in flow_end_choice["options"][1:4]] == [
        "Synthesis",
        "Floorplan",
        "fixFanout",
    ]
    assert flow_end_choice["options"][-1]["label"] == "Harden"

    _send(provider, session_id, "4")
    assert provider.sessions[session_id].phase == "workspace_rtl"
    assert provider.sessions[session_id].workspace_setup.flow_end == "place"


def test_rtl_recommendation_emits_a_path_choice_without_embedding_the_path(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "projects"
    project_root.mkdir()
    rtl, filelist, sdc, _pdk = _write_workspace_inputs(project_root)
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(
        emit=events.append,
        workspace_path_recommender=lambda _context: _proposal(
            rtl_path=str(rtl),
            filelist_path=str(filelist),
            sdc_path=str(sdc),
        ),
    )
    session_id = provider.start_session({})["sessionId"]
    for message in ("1", "2", str(project_root), "ws_0001", "gcd", "0"):
        _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "workspace_rtl"
    rtl_choice = _last_event(events, "choice")["choice"]
    assert rtl_choice["title"] == "RTL path"
    assert rtl_choice["allowFreeText"] is True
    assert [option["label"] for option in rtl_choice["options"]] == ["Use recommended path"]
    assert rtl_choice["options"][0]["value"] == display_path(str(rtl))
    rtl_prompt_text = next(
        event["text"]
        for event in reversed(events)
        if event["type"] == "message" and "RTL file path" in str(event.get("text", ""))
    )
    assert "Recommended local path:" not in str(rtl_prompt_text)
    assert str(rtl) not in str(rtl_prompt_text)


def test_workspace_name_offers_auto_suggestion_and_accepts_custom_input(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    (project_root / "ws_0001").mkdir()
    (project_root / "project.json").write_text(
        json.dumps(
            {
                "workspaces": [
                    {
                        "workspace_id": "ws_0002",
                        "workspace_path": str(project_root / "ws_0002"),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    assert recommended_workspace_name(str(project_root)) == "ws_0003"

    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    for message in ("1", "2", str(project_root)):
        _send(provider, session_id, message)

    session = provider.sessions[session_id]
    assert session.phase == "workspace_name"
    prompt = str(_last_event(events, "message")["text"])
    assert "Suggested:" not in prompt
    assert "ws_0003" not in prompt
    assert "Use the suggestion below" in prompt
    choice = _last_event(events, "choice")["choice"]
    assert choice["options"][0]["value"] == "ws_0003"
    assert choice["options"][0]["label"] == "Use default: ws_0003"
    assert choice["allowFreeText"] is True
    assert _last_event(events, "status")["status"] == "awaiting_choice"

    _send(provider, session_id, "my_custom_ws")
    assert session.phase == "workspace_design"
    assert session.workspace_setup.workspace_name == "my_custom_ws"


def test_workspace_name_default_choice_accepts_auto_suggestion(tmp_path: Path) -> None:
    project_root = tmp_path / "gcd"
    project_root.mkdir()
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home"})["sessionId"]
    for message in ("1", "2", str(project_root)):
        _send(provider, session_id, message)

    choice = _last_event(events, "choice")["choice"]
    _send(provider, session_id, choice["options"][0]["value"])
    session = provider.sessions[session_id]
    assert session.workspace_setup.workspace_name == "ws_0001"
    assert session.phase == "workspace_design"


def test_workspace_mode_option_four_prefills_project_root(tmp_path: Path) -> None:
    project = tmp_path / "gcd"
    workspace = project / "ws_0001"
    workspace.mkdir(parents=True)
    (project / "project.json").write_text("{}", encoding="utf-8")
    events: list[dict[str, object]] = []
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session(
        {
            "directory": str(workspace),
            "mode": "workspace",
            "projectRoot": str(project),
        }
    )["sessionId"]

    _send(provider, session_id, "4")
    session = provider.sessions[session_id]
    assert session.phase == "workspace_name"
    assert session.workspace_inputs.project_root == str(project)


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


def test_operation_keyword_routes_parameter_nl_without_codex(tmp_path: Path) -> None:
    workspace = _workspace_with_fixfanout_and_place(tmp_path)
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
    _send(provider, session_id, "lower target density")

    assert operation_contexts == []
    assert provider.sessions[session_id].phase == "workspace_parameter_confirmation"
    assert parser_contexts[0]["natural_language_request"] == "lower target density"
    assert _last_event(events, "contract")["contract"]["presentation"] == (
        "workspace_parameter_update"
    )


def test_operation_question_uses_place_knowledge_without_parameter_update(tmp_path: Path) -> None:
    workspace = _workspace_with_fixfanout_and_place(tmp_path)
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

    monkeypatch.setattr("ecos_agent.provider._propose_gui_chat_response", chat_response)

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
    workspace = _workspace_with_fixfanout_and_place(tmp_path)
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
    workspace = _workspace_with_fixfanout_and_place(tmp_path)
    events: list[dict[str, object]] = []
    operation_contexts: list[dict[str, object]] = []

    def parse_operation(context: dict[str, object]) -> dict[str, object]:
        operation_contexts.append(context)
        return {
            "schema_version": "flow-agent.gui_chat_response.v1",
            "operation": "2",
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
    assert len([event for event in events if event["type"] == "choice"]) == 1


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
    assert len([event for event in events if event["type"] == "choice"]) == 1


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
    _send(provider, session_id, "3")

    assert operation_contexts == []
    assert provider.sessions[session_id].phase == "workspace_continue_confirmation"
