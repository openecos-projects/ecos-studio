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

    def fake_run_replay(
        workspace, replay_root, index, timeout_seconds, progress=None
    ):
        assert progress is not None
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
