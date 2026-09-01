import pytest

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.codex.rpc import CodexProviderError, _JsonLineRpcProcessClient


def _provider(tmp_path, **env_overrides) -> CodexAppServerProposalProvider:
    codex_bin = tmp_path / "codex"
    codex_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    codex_bin.chmod(0o755)
    return CodexAppServerProposalProvider(
        codex_bin=str(codex_bin),
        cwd=tmp_path,
        env={"PATH": "/usr/bin", **env_overrides},
    )


def test_app_server_always_disables_web_search(tmp_path, monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_init(self, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(_JsonLineRpcProcessClient, "__init__", fake_init)
    monkeypatch.setattr(_JsonLineRpcProcessClient, "start", lambda self: None)
    monkeypatch.setattr(_JsonLineRpcProcessClient, "request", lambda self, *a, **k: {})

    provider = _provider(tmp_path, ECOS_AGENT_CODEX_WEB_SEARCH="1")
    provider._ensure_client()

    assert "tools.web_search=false" in captured["args"]


def test_rpc_diagnostics_are_opt_in(tmp_path) -> None:
    assert _provider(tmp_path).diagnostics_path is None
    transcript = tmp_path / "audit" / "codex.jsonl"
    provider = _provider(tmp_path, ECOS_AGENT_CODEX_DIAGNOSTICS_PATH=str(transcript))
    assert provider.diagnostics_path == transcript


def test_approval_policy_stays_never_because_no_handler_exists(tmp_path, monkeypatch) -> None:
    # A policy that can raise an approval request would hang every turn: this
    # client answers no approval requests.
    requests: list[tuple[str, dict[str, object]]] = []

    class FakeClient:
        def request(self, method: str, params: dict[str, object]) -> dict[str, object]:
            requests.append((method, params))
            if method == "thread/start":
                return {"thread": {"id": "thread-1"}}
            return {"turn": {"id": "turn-1"}}

    provider = _provider(tmp_path)
    provider._client = FakeClient()
    monkeypatch.setattr(provider, "_wait_for_turn", lambda *_args, **_kwargs: "{}")

    provider._run_turn("prompt", {})

    assert [params["approvalPolicy"] for _, params in requests] == ["never", "never"]


def test_web_search_activity_preserves_performed_actions(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex", args=[], cwd=tmp_path, env={}, timeout_seconds=1
    )
    activities: list[dict[str, object]] = []
    client._notifications.put(
        {
            "method": "item/started",
            "params": {
                "turnId": "turn-1",
                "item": {
                    "id": "search-1",
                    "type": "web_search",
                    "query": "dreamplace target density",
                },
            },
        }
    )
    client._notifications.put(
        {
            "method": "item/completed",
            "params": {
                "turnId": "turn-1",
                "item": {
                    "actions": [
                        {
                            "type": "openPage",
                            "title": "DreamPlace documentation",
                            "url": "https://example.com/dreamplace",
                        }
                    ],
                    "durationMs": 1200,
                    "id": "search-1",
                    "query": "dreamplace target density",
                    "status": "completed",
                    "type": "webSearch",
                },
            },
        }
    )
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {"method": "turn/completed", "params": {"turn": {"id": "turn-1"}}}
    )

    assert client.wait_for_turn_details("turn-1", activity_callback=activities.append)[0] == "{}"
    assert activities[-1] == {
        "actions": [
            {
                "kind": "open_page",
                "title": "DreamPlace documentation",
                "url": "https://example.com/dreamplace",
            }
        ],
        "durationMs": 1200,
        "itemId": "search-1",
        "kind": "web_search",
        "query": "dreamplace target density",
        "schema_version": "flow-agent.activity.v1",
        "startedAt": activities[-1]["startedAt"],
        "status": "completed",
        "turnId": "turn-1",
        "turnStartedAt": activities[-1]["turnStartedAt"],
    }


def test_command_activity_redacts_and_bounds_live_output(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex", args=[], cwd=tmp_path, env={}, timeout_seconds=1
    )
    activities: list[dict[str, object]] = []
    client._notifications.put(
        {
            "method": "item/started",
            "params": {
                "turnId": "turn-1",
                "item": {
                    "command": "rg foo token=private",
                    "cwd": "/workspace",
                    "id": "command-1",
                    "type": "command_execution",
                },
            },
        }
    )
    client._notifications.put(
        {
            "method": "item/commandExecution/outputDelta",
            "params": {
                "delta": "x" * (40 * 1024) + "\nauthorization: secret-value",
                "itemId": "command-1",
                "turnId": "turn-1",
            },
        }
    )
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {"method": "turn/completed", "params": {"turn": {"id": "turn-1"}}}
    )

    client.wait_for_turn_details("turn-1", activity_callback=activities.append)
    command = activities[-1]
    assert command["kind"] == "command_execution"
    assert command["status"] == "completed"
    assert command["command"] == "rg foo token=[REDACTED]"
    assert command["label"] == "Search workspace"
    assert command["truncated"] is True
    assert len(str(command["output"]).encode("utf-8")) <= 32 * 1024
    assert "secret-value" not in str(command["output"])


def test_generic_tool_activity_redacts_arguments_and_environment(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex", args=[], cwd=tmp_path, env={}, timeout_seconds=1
    )
    activities: list[dict[str, object]] = []
    client._notifications.put(
        {
            "method": "item/started",
            "params": {
                "turnId": "turn-1",
                "item": {
                    "arguments": {
                        "env": {"TOKEN": "hidden"},
                        "query": "placement",
                        "token": "private",
                    },
                    "id": "tool-1",
                    "server": "knowledge",
                    "tool": "search",
                    "type": "mcpToolCall",
                },
            },
        }
    )
    client._notifications.put(
        {
            "method": "item/mcpToolCall/progress",
            "params": {
                "itemId": "tool-1",
                "message": "Reading sources",
                "turnId": "turn-1",
            },
        }
    )
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {"method": "turn/completed", "params": {"turn": {"id": "turn-1"}}}
    )

    client.wait_for_turn_details("turn-1", activity_callback=activities.append)
    tool = activities[-1]
    assert tool["kind"] == "tool_call"
    assert tool["status"] == "completed"
    assert tool["progress"] == "Reading sources"
    assert '"token": "[REDACTED]"' in str(tool["arguments"])
    assert '"env"' not in str(tool["arguments"])


def test_reasoning_summary_deltas_stream_as_user_visible_progress(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex",
        args=[],
        cwd=tmp_path,
        env={},
        timeout_seconds=1,
    )
    activities: list[dict[str, object]] = []
    client._notifications.put(
        {
            "method": "item/reasoning/summaryTextDelta",
            "params": {"turnId": "turn-1", "delta": "Inspecting the flow."},
        }
    )
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {"method": "turn/completed", "params": {"turn": {"id": "turn-1"}}}
    )

    assert (
        client.wait_for_turn_details("turn-1", activity_callback=activities.append)[0]
        == "{}"
    )
    assert [activity["status"] for activity in activities] == ["running", "completed"]
    assert activities[-1]["kind"] == "reasoning_summary"
    assert activities[-1]["summary"] == ["Inspecting the flow."]


def test_retriable_turn_error_keeps_waiting_for_completion(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex",
        args=[],
        cwd=tmp_path,
        env={},
        timeout_seconds=1,
    )
    client._notifications.put(
        {
            "method": "error",
            "params": {
                "turnId": "turn-1",
                "willRetry": True,
                "error": {"message": "temporary upstream failure"},
            },
        }
    )
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {"method": "turn/completed", "params": {"turn": {"id": "turn-1"}}}
    )

    assert client.wait_for_turn_text("turn-1") == "{}"


def test_final_turn_error_includes_server_message(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex",
        args=[],
        cwd=tmp_path,
        env={},
        timeout_seconds=1,
    )
    client._notifications.put(
        {
            "method": "error",
            "params": {
                "turnId": "turn-1",
                "willRetry": False,
                "error": {"message": "authentication required"},
            },
        }
    )

    with pytest.raises(CodexProviderError, match="authentication required"):
        client.wait_for_turn_text("turn-1")
