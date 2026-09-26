import json

import pytest

from ecos_agent.codex.rpc import CodexProviderError
from ecos_agent.runtime_status import RequestTelemetry, LocalActivityTelemetry
from tests.optimization.test_codex_proposal_provider import _provider


def test_request_windows_reset_and_keep_failure_provenance():
    telemetry = RequestTelemetry()
    telemetry.begin("a")
    telemetry.finish({"thread_id": "a", "turn_id": "t", "tool_calls": 2}, "timeout")
    first = telemetry.snapshot("a")
    assert first["requests_started"] == 1
    assert first["tool_calls_observed"] == 2
    assert first["tool_counts_complete"] is False
    assert first["last_turn"]["failure_class"] == "timeout"
    assert telemetry.snapshot("b")["requests_started"] == 0
    assert telemetry.snapshot("b")["last_turn"] is None
    assert telemetry.snapshot("b")["previous_thread_failure"]["thread_id"] == "a"
    assert telemetry.snapshot("a")["requests_started"] == 0


def test_local_activity_counts_are_not_tool_call_counts():
    telemetry = LocalActivityTelemetry()
    telemetry.observe("turn-1", "a", "running")
    telemetry.observe("turn-1", "a", "completed")
    assert telemetry.snapshot()["observed_activities"] == 1
    telemetry.observe("turn-2", "a", "failed")
    assert telemetry.snapshot()["observed_activities"] == 2
    assert telemetry.snapshot()["events"][-1]["status"] == "failed"
    telemetry.observe("turn-2", "b", "running")
    telemetry.finish("turn-2", "interrupted")
    assert telemetry.snapshot()["events"][-1]["status"] == "interrupted"


@pytest.mark.parametrize("failure", [None, "timeout", "interrupted"])
def test_provider_retains_usage_on_success_and_failure(tmp_path, failure):
    provider = _provider(tmp_path)

    class FakeTurn:
        def snapshot(self):
            return {"thread_id": "thread-1", "turn_id": "turn-1", "usage": {"input_tokens": 12}, "usage_source": "thread_latest", "tool_calls": 1}

    class Client:
        turn_telemetry = FakeTurn()

        def request(self, method, params):
            if method == "thread/start":
                return {"thread": {"id": "thread-1"}}
            return {"turn": {"id": "turn-1"}}

        def wait_for_turn_details(self, *args, **kwargs):
            if failure:
                raise CodexProviderError("private error text", failure_class=failure)
            return "{}", {"input_tokens": 12}

        def record_turn_completion(self, **kwargs):
            pass

        def close(self):
            pass

    provider._client = Client()
    if failure:
        with pytest.raises(CodexProviderError):
            provider._run_turn("prompt", {})
    else:
        provider._run_turn("prompt", {})
    snapshot = provider._runtime_status.snapshot("thread-1")
    assert snapshot["requests_started"] == 1
    assert snapshot["last_turn"]["usage"] == {"input_tokens": 12}
    assert snapshot["last_turn"]["failure_class"] == failure
    assert "private error text" not in json.dumps(snapshot)


def test_next_request_sees_prior_telemetry_and_new_thread_clears_it(tmp_path, monkeypatch):
    provider = _provider(tmp_path)
    provider._runtime_status.begin("thread-1")
    provider._runtime_status.finish({"thread_id": "thread-1", "turn_id": "t1", "usage": None}, "timeout")
    monkeypatch.setattr(provider, "_ensure_client", lambda: object())
    monkeypatch.setattr(provider, "_ensure_thread", lambda client: "thread-1")
    captured = []
    monkeypatch.setattr(provider, "_run_turn", lambda prompt, *args, **kwargs: captured.append(prompt) or "{}")
    provider._request_json(system="Chat", user={}, output_schema={})
    evidence = json.loads(captured[-1].split("USER AND EVIDENCE CONTEXT JSON\n")[1])
    assert evidence["agent_status"]["runtime"]["requests_started"] == 1
    assert evidence["agent_status"]["runtime"]["last_turn"]["failure_class"] == "timeout"
    provider.new_ephemeral_thread()
    assert provider._runtime_status.snapshot("thread-1")["last_turn"] is None
