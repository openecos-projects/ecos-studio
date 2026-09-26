from pathlib import Path

import pytest

from ecos_agent.codex.rpc import CodexProviderError, _JsonLineRpcProcessClient
from ecos_agent.codex.telemetry import TurnTelemetry
from ecos_agent.hashing import canonical_sha256


def _client(tmp_path: Path) -> _JsonLineRpcProcessClient:
    return _JsonLineRpcProcessClient(
        command="codex", args=[], cwd=tmp_path, env={}, timeout_seconds=1
    )


def _complete(client: _JsonLineRpcProcessClient) -> None:
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {"method": "turn/completed", "params": {"turn": {"id": "turn-1"}}}
    )


def test_turn_telemetry_deduplicates_tool_items_without_raw_event_payloads() -> None:
    telemetry = TurnTelemetry("thread-1", "turn-1")
    for method in ("item/started", "item/started", "item/completed"):
        telemetry.observe(
            method,
            {
                "turnId": "turn-1",
                "item": {
                    "command": "cat secret.txt",
                    "id": "command-1",
                    "status": "completed" if method == "item/completed" else "running",
                    "type": "command_execution",
                },
            },
        )
    telemetry.observe(
        "item/started",
        {"turnId": "turn-1", "item": {"id": "search-1", "type": "web_search"}},
    )

    snapshot = telemetry.snapshot()
    assert snapshot["tool_calls"] == 2
    assert snapshot["tool_counts_complete"] is True
    assert snapshot["events"][0]["item_ref"] == canonical_sha256(
        ["thread-1", "turn-1", "command-1"]
    )
    assert len(snapshot["events"]) <= 6
    assert "command-1" not in str(snapshot["events"])
    assert "secret.txt" not in str(snapshot["events"])


def test_turn_telemetry_marks_counts_incomplete_for_missing_or_capped_ids() -> None:
    telemetry = TurnTelemetry("thread-1", "turn-1")
    telemetry.observe(
        "item/started", {"turnId": "turn-1", "item": {"type": "command_execution"}}
    )
    for index in range(1025):
        telemetry.observe(
            "item/started",
            {
                "turnId": "turn-1",
                "item": {"id": f"tool-{index}", "type": "mcpToolCall"},
            },
        )

    snapshot = telemetry.snapshot()
    assert snapshot["tool_calls"] == 1024
    assert snapshot["tool_counts_complete"] is False


def test_turn_telemetry_keeps_recent_events_and_terminal_item_status() -> None:
    telemetry = TurnTelemetry("thread-1", "turn-1")
    for index in range(8):
        telemetry.observe(
            "item/started",
            {
                "turnId": "turn-1",
                "item": {"id": f"tool-{index}", "type": "mcpToolCall"},
            },
        )
    telemetry.observe(
        "item/completed",
        {
            "turnId": "turn-1",
            "item": {"id": "tool-7", "status": "completed", "type": "mcpToolCall"},
        },
    )
    telemetry.observe(
        "item/mcpToolCall/progress",
        {"turnId": "turn-1", "itemId": "tool-7", "message": "late progress"},
    )
    telemetry.observe(
        "item/completed",
        {
            "turnId": "turn-1",
            "item": {"id": "tool-7", "status": "completed", "type": "mcpToolCall"},
        },
    )

    events = telemetry.snapshot()["events"]
    assert len(events) == 6
    assert events[-1]["status"] == "completed"
    assert all(event["item_ref"] != canonical_sha256(["thread-1", "turn-1", "tool-0"]) for event in events)


def test_rpc_keeps_partial_thread_usage_and_rejects_other_turn_usage(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client._notifications.put(
        {
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": "thread-1",
                "turnId": "other-turn",
                "tokenUsage": {"last": {"inputTokens": 99}},
            },
        }
    )
    client._notifications.put(
        {
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": "thread-1",
                "tokenUsage": {"last": {"inputTokens": 3, "outputTokens": 4}},
            },
        }
    )
    _complete(client)

    text, usage = client.wait_for_turn_details("turn-1", thread_id="thread-1")

    assert text == "{}"
    assert usage == {"input_tokens": 3, "output_tokens": 4}
    assert client.turn_telemetry is not None
    assert client.turn_telemetry.usage == usage
    assert client.turn_telemetry.usage_source == "thread_latest"


def test_rpc_completed_usage_overrides_thread_latest_usage(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client._notifications.put(
        {
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": "thread-1",
                "tokenUsage": {"last": {"inputTokens": 3}},
            },
        }
    )
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {
            "method": "turn/completed",
            "params": {
                "turn": {
                    "id": "turn-1",
                    "usage": {"totalTokens": 10, "cachedInputTokens": 2},
                }
            },
        }
    )

    _text, usage = client.wait_for_turn_details("turn-1", thread_id="thread-1")

    assert usage == {"total_tokens": 10, "cached_input_tokens": 2}
    assert client.turn_telemetry is not None
    assert client.turn_telemetry.usage_source == "completed_turn"


def test_rpc_failure_keeps_retry_count_and_failed_status(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client._notifications.put(
        {
            "method": "error",
            "params": {"turnId": "turn-1", "willRetry": True, "error": {"message": "retry"}},
        }
    )
    client._notifications.put(
        {
            "method": "error",
            "params": {"turnId": "turn-1", "willRetry": False, "error": {"message": "boom"}},
        }
    )

    with pytest.raises(CodexProviderError, match="boom"):
        client.wait_for_turn_text("turn-1")

    assert client.turn_telemetry is not None
    snapshot = client.turn_telemetry.snapshot()
    assert snapshot["server_retries"] == 1
    assert snapshot["status"] == "failed"


@pytest.mark.parametrize(
    ("status", "failure_class"),
    [("interrupted", "interrupted"), ("failed", "tool_error")],
)
def test_rpc_failed_completed_turn_raises_even_with_text_and_keeps_usage(
    tmp_path: Path, status: str, failure_class: str
) -> None:
    client = _client(tmp_path)
    client._notifications.put(
        {"method": "item/agentMessage/delta", "params": {"turnId": "turn-1", "delta": "{}"}}
    )
    client._notifications.put(
        {
            "method": "turn/completed",
            "params": {
                "turn": {
                    "id": "turn-1",
                    "status": status,
                    "usage": {"inputTokens": 7},
                }
            },
        }
    )

    with pytest.raises(CodexProviderError) as error:
        client.wait_for_turn_text("turn-1")

    assert error.value.failure_class == failure_class
    assert client.turn_telemetry is not None
    assert client.turn_telemetry.status == status
    assert client.turn_telemetry.usage == {"input_tokens": 7}
    assert client.turn_telemetry.usage_source == "completed_turn"


def test_rpc_interrupted_completed_turn_without_text_is_not_overwritten_to_failed(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    client._notifications.put(
        {
            "method": "turn/completed",
            "params": {"turn": {"id": "turn-1", "status": "interrupted"}},
        }
    )

    with pytest.raises(CodexProviderError) as error:
        client.wait_for_turn_text("turn-1")

    assert error.value.failure_class == "interrupted"
    assert client.turn_telemetry is not None
    assert client.turn_telemetry.status == "interrupted"
