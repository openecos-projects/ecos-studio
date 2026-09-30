"""q=1 ordering evidence with the real controller/runner and offline fakes."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from ecos_agent.optimization import controller_execution
from ecos_agent.optimization.contracts import OptimizationOutcomeKind
from ecos_agent.optimization.controller import OptimizationEpisodeControllerError
from tests.optimization.test_planning_snapshots import _enable, _setup
from tests.optimization.test_runner_async_scheduling import _runner, _terminal_receipt


@pytest.mark.parametrize("outcome", [
    OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
    OptimizationOutcomeKind.DEGRADED,
    OptimizationOutcomeKind.EXECUTION_FAILED,
])
def test_q1_next_capture_waits_for_receipt_ledger_promotion_checkpoint(
    tmp_path, monkeypatch, outcome,
):
    controller, planner, executor = _setup(tmp_path)
    executor.receipts["execution-1"] = _terminal_receipt(
        "execution-1", "place.cell_padding_x", 3, outcome=outcome,
    )
    store = _enable(tmp_path, controller)
    timeline = []
    blocked, release = Event(), Event()
    runner = _runner(controller, executor)
    terminal = runner._terminal_waiter_any
    validate = controller_execution.terminal_candidate_is_promotable
    append = controller.ledger.append_terminal
    promote = controller._set_incumbent
    persist = controller._persist
    absorb = runner._absorb_promotion
    propose = planner.propose_v2

    def wait_terminal(ids):
        receipt = terminal(ids)
        if receipt.execution_id == "execution-1":
            timeline.append("terminal")
        return receipt

    def checked_receipt(**kwargs):
        result = validate(**kwargs)
        if len(planner.contexts) == 1:
            assert kwargs["parameter_receipt"] is not None
            timeline.append("receipt_checked")
        return result

    def committed_ledger(value):
        result = append(value)
        if len(planner.contexts) == 1:
            timeline.append("ledger_committed")
        return result

    def hold_merge():
        blocked.set()
        assert release.wait(10), "test did not release fake feedback barrier"

    def committed_promotion(*args):
        if len(planner.contexts) == 1:
            hold_merge()
        result = promote(*args)
        if len(planner.contexts) == 1:
            timeline.append("promotion_committed")
        return result

    def committed_checkpoint():
        completing_first = (
            len(planner.contexts) == 1 and "ledger_committed" in timeline
            and "checkpoint_committed" not in timeline
        )
        if completing_first and outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED:
            hold_merge()
        result = persist()
        if completing_first:
            state = json.loads(controller.state_path.read_text())
            assert state["pending_executions"] == []
            assert state["ledger_chain_head_sha256"] == controller.ledger.replay().chain_head_sha256
            timeline.append("checkpoint_committed")
        return result

    def committed_runner_values(*args):
        result = absorb(*args)
        if len(planner.contexts) == 1:
            timeline.append("runner_feedback_committed")
        return result

    def next_plan(context, domains):
        if len(planner.contexts) == 1:
            assert "runner_feedback_committed" in timeline
            snapshot = json.loads(store.path_for(context.context_ref).read_text())
            assert snapshot["started_candidates"] == 1
            assert snapshot["pending"] == []
            assert len(snapshot["completed"]) == 1
            assert snapshot["checkpoint"]["pending_executions"] == []
            assert snapshot["checkpoint"]["ledger_chain_head_sha256"] == snapshot["ledger_chain_head_sha256"]
            assert context.history[0].parameter_application_receipt is not None
            assert context.history[0].terminal_observation is not None or outcome == OptimizationOutcomeKind.EXECUTION_FAILED
            if outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED:
                assert context.incumbent.observation_id == "terminal-execution-1"
                assert snapshot["checkpoint"]["incumbent"]["observation_id"] == context.incumbent.observation_id
            timeline.append("next_snapshot_and_planner")
        return propose(context, domains)

    monkeypatch.setattr(runner, "_terminal_waiter_any", wait_terminal)
    monkeypatch.setattr(controller_execution, "terminal_candidate_is_promotable", checked_receipt)
    monkeypatch.setattr(controller.ledger, "append_terminal", committed_ledger)
    monkeypatch.setattr(controller, "_set_incumbent", committed_promotion)
    monkeypatch.setattr(controller, "_persist", committed_checkpoint)
    monkeypatch.setattr(runner, "_absorb_promotion", committed_runner_values)
    monkeypatch.setattr(planner, "propose_v2", next_plan)

    def two_turns():
        runner.run_turn()
        runner.run_turn()

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(two_turns)
            try:
                assert blocked.wait(10), "feedback merge did not reach the fake barrier"
                assert len(planner.contexts) == 1
                assert len(list(store.root.glob("*.json"))) == 1
                assert "next_snapshot_and_planner" not in timeline
            finally:
                release.set()
            future.result(timeout=10)
        expected = ["terminal", "receipt_checked", "ledger_committed"]
        if outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED:
            expected.append("promotion_committed")
        expected += ["checkpoint_committed", "runner_feedback_committed", "next_snapshot_and_planner"]
        assert timeline == expected
    finally:
        runner.close()


def test_q1_invalid_receipt_cannot_reach_next_planning(tmp_path):
    controller, planner, executor = _setup(tmp_path)
    store = _enable(tmp_path, controller)
    executor.receipts["execution-1"] = _terminal_receipt(
        "execution-1", "place.target_density", 0.25,  # Wrong requested knob.
    )
    runner = _runner(controller, executor)
    try:
        with pytest.raises(OptimizationEpisodeControllerError, match="receipt does not match"):
            runner.run_turn()
        assert len(planner.contexts) == 1
        assert len(list(store.root.glob("*.json"))) == 1
        assert controller.pending_execution_ids == ("execution-1",)
        assert controller.ledger.replay().terminal_outcomes == ()
    finally:
        runner.close()
