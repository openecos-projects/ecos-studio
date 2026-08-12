import pytest

from ecos_agent.codex_provider import CodexAppServerProposalProvider
from ecos_agent.codex_rpc import CodexProviderError, _JsonLineRpcProcessClient


def _provider(tmp_path, **env_overrides) -> CodexAppServerProposalProvider:
    codex_bin = tmp_path / "codex"
    codex_bin.write_text("#!/bin/sh\n", encoding="utf-8")
    codex_bin.chmod(0o755)
    return CodexAppServerProposalProvider(
        codex_bin=str(codex_bin),
        cwd=tmp_path,
        env={"PATH": "/usr/bin", **env_overrides},
    )


def test_web_search_is_off_unless_the_deployment_opts_in(tmp_path) -> None:
    assert _provider(tmp_path).web_search_enabled is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "on"])
def test_web_search_opt_in_values(tmp_path, value: str) -> None:
    provider = _provider(tmp_path, ECOS_AGENT_CODEX_WEB_SEARCH=value)
    assert provider.web_search_enabled is True


@pytest.mark.parametrize("value", ["0", "false", "no", "", "  "])
def test_web_search_stays_off_for_other_values(tmp_path, value: str) -> None:
    provider = _provider(tmp_path, ECOS_AGENT_CODEX_WEB_SEARCH=value)
    assert provider.web_search_enabled is False


@pytest.mark.parametrize(
    ("enabled", "expected"),
    [(True, "tools.web_search=true"), (False, "tools.web_search=false")],
)
def test_app_server_is_launched_with_an_explicit_web_search_setting(
    tmp_path, monkeypatch, enabled: bool, expected: str
) -> None:
    captured: dict[str, object] = {}

    def fake_init(self, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(_JsonLineRpcProcessClient, "__init__", fake_init)
    monkeypatch.setattr(_JsonLineRpcProcessClient, "start", lambda self: None)
    monkeypatch.setattr(_JsonLineRpcProcessClient, "request", lambda self, *a, **k: {})

    provider = _provider(tmp_path)
    provider.web_search_enabled = enabled
    provider._ensure_client()

    assert expected in captured["args"]


def test_rpc_diagnostics_are_opt_in(tmp_path) -> None:
    assert _provider(tmp_path).diagnostics_path is None
    transcript = tmp_path / "audit" / "codex.jsonl"
    provider = _provider(tmp_path, ECOS_AGENT_CODEX_DIAGNOSTICS_PATH=str(transcript))
    assert provider.diagnostics_path == transcript


def test_approval_policy_stays_never_because_no_handler_exists(tmp_path) -> None:
    # A policy that can raise an approval request would hang every turn: this
    # client answers no approval requests.
    source = (
        __import__("pathlib")
        .Path(__file__)
        .parent.parent.joinpath("src/ecos_agent/codex_provider.py")
        .read_text(encoding="utf-8")
    )
    assert '"approvalPolicy": "granular"' not in source
    assert source.count('"approvalPolicy": "never"') == 2


def test_web_search_activity_is_reported_to_the_user() -> None:
    started = _JsonLineRpcProcessClient._readonly_activity(
        "item/started", {"item": {"type": "web_search", "query": "dreamplace target density"}}
    )
    assert started == "Searching the web for “dreamplace target density”…"
    assert (
        _JsonLineRpcProcessClient._readonly_activity(
            "item/started", {"item": {"type": "webSearch"}}
        )
        == "Searching the web…"
    )
    assert (
        _JsonLineRpcProcessClient._readonly_activity(
            "item/completed", {"item": {"type": "web_search"}}
        )
        == "Finished web search."
    )


def test_command_activity_reporting_is_unchanged() -> None:
    assert (
        _JsonLineRpcProcessClient._readonly_activity(
            "item/started", {"item": {"type": "command_execution", "command": "rg foo"}}
        )
        == "Searching workspace…"
    )
    assert (
        _JsonLineRpcProcessClient._readonly_activity(
            "item/started", {"item": {"type": "reasoning"}}
        )
        is None
    )


def test_reasoning_summary_deltas_stream_as_user_visible_progress(tmp_path) -> None:
    client = _JsonLineRpcProcessClient(
        command="codex",
        args=[],
        cwd=tmp_path,
        env={},
        timeout_seconds=1,
    )
    progress: list[str] = []
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
        client.wait_for_turn_details("turn-1", activity_callback=progress.append)[0]
        == "{}"
    )
    assert progress == ["Inspecting the flow."]


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
