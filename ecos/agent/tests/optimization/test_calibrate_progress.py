"""Noise calibration reports continuous progress for the GUI chat."""

import queue

from ecos_agent.optimization.calibrate_workspace import calibrate
from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
from tests.optimization.experiments.equal_budget_support import _terminal_observation


def test_calibrate_emits_per_replay_progress(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    observation = _terminal_observation()
    messages: list[str] = []

    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._environment_fingerprint",
        lambda workspace: {"parser_sha256": "p1"},
    )

    def fake_run_replay(
        workspace, replay_root, index, timeout_seconds, fingerprint, progress=None
    ):
        assert progress is not None
        assert fingerprint == {"parser_sha256": "p1"}
        progress("flow rerun started")
        return observation

    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._run_replay", fake_run_replay
    )
    summary = calibrate(
        workspace, replays=2, timeout_seconds=60.0, progress=messages.append
    )

    assert summary["replay_count"] == 2
    assert "preparing replay 1/2" in messages[0]
    assert "noise calibration replay 1/2: flow rerun started" in messages
    assert "replay 2/2 finished" in messages[-1]


def test_wait_for_terminal_reports_poll_status() -> None:
    client = EccContentLengthRpcClient.__new__(EccContentLengthRpcClient)
    client._response_timeout_seconds = 5.0
    statuses = iter(
        [
            {"state": "running"},
            {"state": "succeeded"},
        ]
    )
    client._request = lambda method, params, timeout_seconds: next(statuses)
    client._events = queue.Queue()

    seen: list[dict[str, object]] = []
    terminal = client.wait_for_terminal("op-1", 10.0, poll_callback=seen.append)

    assert terminal is not None and terminal["state"] == "succeeded"
    assert seen == [{"state": "running"}, {"state": "succeeded"}]


def test_calibrate_never_reports_a_terminal_wait_as_running(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "source.txt").write_text("source", encoding="utf-8")
    observation = _terminal_observation()
    messages: list[str] = []

    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._environment_fingerprint",
        lambda _workspace: {"parser_sha256": "p1"},
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._terminal_observation",
        lambda _workspace: observation,
    )
    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._store_replay_cache",
        lambda *_args: None,
    )

    def host_call(method, _params):
        if method == "workspace.open":
            return {"workspaceHandle": "handle-1", "workspaceRevision": 1}
        if method == "workspace.run":
            return {"operationId": "operation-1", "state": "running"}
        assert method == "operation.wait"
        return {"operationId": "operation-1", "state": "succeeded"}

    monkeypatch.setattr(
        "ecos_agent.optimization.calibrate_workspace._host_call", host_call
    )

    calibrate(workspace, replays=2, timeout_seconds=60.0, progress=messages.append)

    assert not any(
        "flow running" in message and "ECC state: succeeded" in message
        for message in messages
    )
