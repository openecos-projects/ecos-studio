import json
from pathlib import Path

import pytest

from ecos_agent.codex.provider import CodexAppServerProposalProvider, CodexProviderError, _resolve_codex_bin
from ecos_agent.workspace.contracts import GuiWorkspaceSetupProposal
from ecos_agent.gui.provider import EcosAgentProvider, PROVIDER_ID
from tests.paths import AGENT_ROOT

from .provider_support import (
    chat_response as _chat_response,
    last_event as _last_event,
    proposal as _proposal,
    send_session_input as _send,
    write_workspace_inputs as _write_workspace_inputs,
)


def test_codex_bin_expands_the_user_home_directory(tmp_path: Path, monkeypatch) -> None:
    codex = tmp_path / "bin" / "codex"
    codex.parent.mkdir()
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    monkeypatch.setenv("HOME", str(tmp_path))

    assert _resolve_codex_bin("~/bin/codex", {"PATH": ""}) == str(codex)


def test_source_manifest_uses_the_user_codex_environment() -> None:
    manifest_path = AGENT_ROOT / "agent-provider.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["command"] == "uv"
    assert "ECOS_AGENT_CODEX_BIN" not in manifest.get("environment", {})


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


def test_codex_chat_controls_use_allowlisted_thread_rpc(tmp_path: Path) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)

    class FakeClient:
        def __init__(self) -> None:
            self.requests: list[tuple[str, dict[str, object]]] = []

        def request(self, method: str, params: dict[str, object]) -> dict[str, object]:
            self.requests.append((method, params))
            if method == "model/list":
                return {
                    "data": [
                        {
                            "id": "gpt-test",
                            "model": "gpt-test",
                            "displayName": "GPT Test",
                            "defaultReasoningEffort": "medium",
                            "supportedReasoningEfforts": [
                                {"reasoningEffort": "low"},
                                {"reasoningEffort": "medium"},
                                {"reasoningEffort": "high"},
                            ],
                            "isDefault": True,
                        }
                    ]
                }
            if method == "thread/goal/set":
                return {
                    "goal": {
                        "objective": params.get("objective", "Ship it"),
                        "status": params.get("status", "active"),
                    }
                }
            if method == "thread/goal/get":
                return {"goal": {"objective": "Ship it", "status": "active"}}
            return {}

        def interrupt_turn(self, thread_id: str, turn_id: str) -> None:
            self.requests.append(
                ("turn/interrupt", {"threadId": thread_id, "turnId": turn_id})
            )

    client = FakeClient()
    provider._client = client
    provider._thread_id = "thread-1"

    provider.set_model_settings(model="gpt-test", reasoning_effort="high")
    assert provider.get_model_settings() == {
        "model": "gpt-test",
        "displayName": "GPT Test",
        "reasoningEffort": "high",
        "models": [
            {
                "model": "gpt-test",
                "displayName": "GPT Test",
                "defaultReasoningEffort": "medium",
                "supportedReasoningEfforts": ["low", "medium", "high"],
            }
        ],
    }
    provider.set_goal(objective="Ship it")
    assert provider.get_goal() == {"objective": "Ship it", "status": "active"}
    provider.compact()
    provider.rename_thread("ECOS task")
    provider._active_turn_id = "turn-1"
    provider.interrupt()
    provider.clear_interrupted()

    assert [method for method, _params in client.requests] == [
        "model/list",
        "model/list",
        "model/list",
        "thread/goal/set",
        "thread/goal/get",
        "thread/compact/start",
        "thread/name/set",
        "turn/interrupt",
    ]
    assert all(
        params.get("threadId") == "thread-1"
        for method, params in client.requests
        if method != "model/list"
    )
    assert provider.thread_id == "thread-1"
    assert provider._interrupted is False


def test_codex_turn_uses_selected_model_and_reasoning_effort(
    tmp_path: Path, monkeypatch
) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)

    class FakeClient:
        def __init__(self) -> None:
            self.turn: dict[str, object] | None = None

        def request(self, method: str, params: dict[str, object]) -> dict[str, object]:
            if method == "model/list":
                return {
                    "data": [
                        {
                            "id": "gpt-test",
                            "model": "gpt-test",
                            "defaultReasoningEffort": "medium",
                            "supportedReasoningEfforts": ["low", "high"],
                            "isDefault": True,
                        }
                    ]
                }
            if method == "turn/start":
                self.turn = params
                return {"turn": {"id": "turn-1"}}
            return {}

    client = FakeClient()
    provider._client = client
    provider._thread_id = "thread-1"
    provider.set_model_settings(model="gpt-test", reasoning_effort="high")
    monkeypatch.setattr(provider, "_wait_for_turn", lambda *_args, **_kwargs: "{}")

    provider._run_turn("prompt", {"type": "object"})

    assert client.turn is not None
    assert client.turn["model"] == "gpt-test"
    assert client.turn["effort"] == "high"


def test_session_chat_and_slash_commands_share_one_codex_provider(
    tmp_path: Path, monkeypatch
) -> None:
    events: list[dict[str, object]] = []

    class FakeCodexProvider:
        thread_id = "thread-1"
        model = None

        def __init__(self) -> None:
            self.calls: list[object] = []

        def respond_to_gui_chat(self, context: dict[str, object]) -> dict[str, object]:
            self.calls.append(("chat", context["natural_language_request"]))
            return _chat_response(answer="Persistent answer.")

        def list_models(self) -> list[dict[str, object]]:
            self.calls.append("models")
            return [
                {
                    "id": "gpt-test",
                    "model": "gpt-test",
                    "displayName": "GPT Test",
                    "description": "Test model",
                    "defaultReasoningEffort": "medium",
                }
            ]

        def select_model(self, model: str) -> dict[str, object]:
            self.calls.append(("model", model))
            self.model = model
            return {"model": model, "displayName": "GPT Test"}

        def set_goal(
            self, *, objective: str | None = None, status: str | None = None
        ) -> dict[str, object]:
            self.calls.append(("set_goal", objective, status))
            return {"objective": objective or "Ship it", "status": status or "active"}

        def get_goal(self) -> dict[str, object]:
            self.calls.append("get_goal")
            return {"objective": "Ship it", "status": "active"}

        def compact(self) -> None:
            self.calls.append("compact")

        def review_uncommitted_changes(self) -> str:
            self.calls.append("review")
            return "Review finding."

        def interrupt(self) -> None:
            pass

        def clear_interrupted(self) -> None:
            pass

        def close(self) -> None:
            self.calls.append("close")

    fake = FakeCodexProvider()
    monkeypatch.setattr(
        "ecos_agent.gui.provider.create_required_codex_provider", lambda **_kwargs: fake
    )
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home", "directory": str(tmp_path)})[
        "sessionId"
    ]
    provider.sessions[session_id].pending_interaction = None

    provider.send_message({"sessionId": session_id, "message": "hello"})
    provider.send_message({"sessionId": session_id, "message": "/model"})
    interaction = _last_event(events, "interaction")["interaction"]
    assert interaction["kind"] == "choice"
    assert interaction["options"][0]["label"] == "GPT Test"
    _send(provider, session_id, "/model gpt-test")
    assert _last_event(events, "message")["text"] == "Model set to GPT Test."
    provider.send_message({"sessionId": session_id, "message": "/goal Ship it"})
    provider.send_message({"sessionId": session_id, "message": "/goal"})
    provider.send_message({"sessionId": session_id, "message": "/compact"})
    provider.send_message({"sessionId": session_id, "message": "/review"})

    assert fake.calls == [
        ("chat", "hello"),
        "models",
        ("model", "gpt-test"),
        ("set_goal", "Ship it", None),
        "get_goal",
        "compact",
        "review",
    ]
    assert provider.sessions[session_id].codex_provider is fake
    assert _last_event(events, "message")["text"] == "Review finding."


def test_session_model_settings_use_dedicated_provider_methods(
    tmp_path: Path, monkeypatch
) -> None:
    class FakeCodexProvider:
        def get_model_settings(self) -> dict[str, object]:
            return {
                "model": "gpt-test",
                "displayName": "GPT Test",
                "reasoningEffort": "medium",
                "models": [],
            }

        def set_model_settings(self, **settings: object) -> dict[str, object]:
            return {**self.get_model_settings(), **settings}

        def clear_interrupted(self) -> None:
            pass

        def close(self) -> None:
            pass

    fake = FakeCodexProvider()
    monkeypatch.setattr(
        "ecos_agent.gui.provider.create_required_codex_provider", lambda **_kwargs: fake
    )
    provider = EcosAgentProvider(emit=lambda _event: None)
    session_id = provider.start_session(
        {"mode": "home", "directory": str(tmp_path)}
    )["sessionId"]

    assert provider.get_model_settings({"sessionId": session_id})["model"] == "gpt-test"
    updated = provider.set_model_settings(
        {"sessionId": session_id, "reasoningEffort": "high"}
    )
    assert updated["reasoning_effort"] == "high"

    provider.sessions[session_id].running = True
    with pytest.raises(ValueError, match="cannot change"):
        provider.set_model_settings({"sessionId": session_id, "model": "gpt-test"})


def test_slash_commands_fail_closed_without_shell_fallback(tmp_path: Path, monkeypatch) -> None:
    events: list[dict[str, object]] = []

    class FakeCodexProvider:
        thread_id = "thread-1"
        model = None

        def interrupt(self) -> None:
            pass

        def close(self) -> None:
            pass

    monkeypatch.setattr(
        "ecos_agent.gui.provider.create_required_codex_provider",
        lambda **_kwargs: FakeCodexProvider(),
    )
    provider = EcosAgentProvider(emit=events.append)
    session_id = provider.start_session({"mode": "home", "directory": str(tmp_path)})[
        "sessionId"
    ]
    provider.sessions[session_id].pending_interaction = None

    provider.send_message({"sessionId": session_id, "message": "/shell rm -rf /"})
    provider.send_message({"sessionId": session_id, "message": "/unknown"})

    errors = [event["text"] for event in events if event["type"] == "error"]
    assert errors == [
        "Unsupported slash command: /shell. Shell execution is not exposed in Agent Chat.",
        "Unsupported slash command: /unknown. Type /help for supported commands.",
    ]


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


@pytest.mark.parametrize("kind", ["command_execution", "tool_call", "web_search"])
def test_no_tool_lane_rejects_observed_tool_activity(
    tmp_path: Path, kind: str
) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)

    class FakeClient:
        def __init__(self) -> None:
            self.closed = False

        def request(self, _method: str, _params: dict[str, object]) -> dict[str, object]:
            return {"turn": {"id": "turn-1"}}

        def wait_for_turn_details(
            self, _turn_id: str, *, thread_id: str, activity_callback: object
        ) -> tuple[str, None]:
            assert thread_id == "thread-1"
            assert callable(activity_callback)
            activity_callback(
                {
                    "schema_version": "flow-agent.activity.v1",
                    "kind": kind,
                    "status": "completed",
                }
            )
            return "{}", None

        def close(self) -> None:
            self.closed = True

    client = FakeClient()
    provider._client = client
    provider._thread_id = "thread-1"

    with pytest.raises(CodexProviderError, match="tool policy") as error:
        provider._run_turn("prompt", {}, tool_policy="none")

    assert error.value.failure_class == "policy_violation"
    assert client.closed is True
    assert provider._client is None


def test_workspace_discovery_uses_read_only_tool_policy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    codex = tmp_path / "codex"
    codex.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    codex.chmod(0o755)
    provider = CodexAppServerProposalProvider(codex_bin=str(codex), cwd=tmp_path)
    captured: dict[str, object] = {}

    def capture_turn(
        _prompt: str, _schema: dict[str, object], *, tool_policy: str
    ) -> str:
        captured["tool_policy"] = tool_policy
        return json.dumps(_proposal().model_dump(mode="json"))

    monkeypatch.setattr(provider, "_run_turn", capture_turn)

    provider.propose_gui_workspace_path_discovery(
        {"filesystem_roots": [str(tmp_path)]}
    )

    assert captured["tool_policy"] == "read_only_workspace"


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
            "1",
            "",
        "",
        "",
        "",
        "",
        "",
        "target overflow is 0.1",
    ):
        if message == "target overflow is 0.1":
            provider.sessions[session_id].pending_interaction = None
        _send(provider, session_id, message)

    setup = next(event["workspaceSetup"] for event in events if event["type"] == "workspace_setup")
    assert PROVIDER_ID == "ecos_agent"
    assert "execute" not in provider.__dict__
    assert setup["schema_version"] == "flow-agent.workspace_setup_contract.v2"
    assert setup["directory"] == str(project_root / "ws_0001")
    assert setup["parameters"]["design"] == "gcd"
    assert setup["project_context"]["project_root"] == str(project_root)
    assert setup["parameters"]["target_overflow"] == 0.1
    assert setup["mpc_enabled"] is True
    assert parser_contexts[0]["numeric_field"] == "target_overflow"
    assert parser_contexts[0]["numeric_bounds"] == {"lower": 0, "upper": 1}
    assert all(event["type"] != "error" for event in events)
    assert any(event["type"] == "tool" for event in events)
    choice = _last_event(events, "interaction")["interaction"]
    assert choice["kind"] == "confirm"
    assert choice["confirm"]["label"] == "Confirm and start"
    assert choice["cancel"]["label"] == "Cancel"
    assert _last_event(events, "status")["status"] == "awaiting_interaction"

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
    (config / "dreamplace_ecc.json").write_text('{"target_density": 0.2}', encoding="utf-8")
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
    for message in ("1", "1", "1", "reduce density"):
        _send(provider, session_id, message)

    assert provider.sessions[session_id].phase == "rerun_parameter"
    assert "mock timeout" in _last_event(events, "error")["text"]
    assert not any(event["type"] in {"contract", "workspace_rerun"} for event in events)
