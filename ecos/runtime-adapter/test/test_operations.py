import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from chipcompiler.data import StateEnum
from ecos_runtime_adapter.operations import (
    RuntimeOperationIdempotencyConflict,
    RuntimeOperationManager,
)


def test_successful_steps_complete_without_renderer_ack():
    events = []
    manager = RuntimeOperationManager(events.append)
    synthesis = SimpleNamespace(name="Synthesis", tool="yosys", log=SimpleNamespace(file=""))
    floorplan = SimpleNamespace(name="Floorplan", tool="ecc", log=SimpleNamespace(file=""))

    def runner(observer):
        observer.on_step_started(synthesis)
        observer.on_step_completed(synthesis, StateEnum.Success)
        observer.on_step_started(floorplan)
        observer.on_step_completed(floorplan, StateEnum.Success)
        return {"rerun": False}

    started = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=runner,
    )

    status = _wait_for_terminal(manager, started["operationId"])
    assert status["state"] == "succeeded"
    completed = [event for event in events if event["type"] == "step.completed"]
    assert [event["payload"]["workspaceRevision"] for event in completed] == [1, 2]
    assert events[-1]["type"] == "operation.completed"


def test_subflow_stage_is_emitted_for_the_active_workspace_step():
    events = []
    released = threading.Event()
    manager = RuntimeOperationManager(events.append)
    step = SimpleNamespace(name="Floorplan", tool="ecc", log=SimpleNamespace(file=""))

    def runner(observer):
        observer.on_step_started(step)
        observer.on_subflow_stage(
            step,
            {
                "name": "init floorplan",
                "state": "Ongoing",
                "runtime": "0:0:1",
                "peak memory (mb)": 12.5,
            },
        )
        assert released.wait(timeout=1)
        return {"rerun": False}

    started = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=True,
        step="Floorplan",
        idempotency_key="subflow-stage",
        runner=runner,
    )

    event = _wait_for_event(events, "subflow.stage")
    assert event["operationId"] == started["operationId"]
    assert event["payload"] == {
        "peakMemory": 12.5,
        "runtime": "0:0:1",
        "state": "Ongoing",
        "step": "Floorplan",
        "subflowStep": "init floorplan",
        "tool": "ecc",
    }
    released.set()
    assert _wait_for_terminal(manager, started["operationId"])["state"] == "succeeded"


def test_start_requests_are_idempotent():
    events = []
    release = threading.Event()
    manager = RuntimeOperationManager(events.append)

    def runner(_observer):
        assert release.wait(timeout=1)
        return {"rerun": False}

    first = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=runner,
    )
    duplicate = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=runner,
    )

    assert duplicate["operationId"] == first["operationId"]
    assert duplicate["deduplicated"] is True
    release.set()
    assert _wait_for_terminal(manager, first["operationId"])["state"] == "succeeded"


def test_reusing_a_command_id_with_different_parameters_conflicts():
    release = threading.Event()
    manager = RuntimeOperationManager()
    first = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=lambda _observer: release.wait(timeout=1) or {},
    )

    try:
        with pytest.raises(RuntimeOperationIdempotencyConflict):
            manager.start(
                workspace_id="workspace-1",
                kind="flow",
                origin="gui",
                rerun=True,
                step="",
                idempotency_key="request-1",
                runner=lambda _observer: {},
            )
    finally:
        release.set()
        _wait_for_terminal(manager, first["operationId"])


def test_command_fingerprint_includes_command_specific_input():
    release = threading.Event()
    manager = RuntimeOperationManager()
    first = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=True,
        step="Place",
        idempotency_key="request-1",
        command_input={"resetDependents": False},
        runner=lambda _observer: release.wait(timeout=1) or {},
    )

    try:
        with pytest.raises(RuntimeOperationIdempotencyConflict):
            manager.start(
                workspace_id="workspace-1",
                kind="step",
                origin="gui",
                rerun=True,
                step="Place",
                idempotency_key="request-1",
                command_input={"resetDependents": True},
                runner=lambda _observer: {},
            )
    finally:
        release.set()
        _wait_for_terminal(manager, first["operationId"])


def test_operation_ledger_survives_restart_and_marks_unknown_active_work_interrupted(
    tmp_path,
):
    ledger = Path(tmp_path) / "runtime-commands.json"
    release = threading.Event()
    first = RuntimeOperationManager()
    started = first.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=lambda _observer: release.wait(timeout=1) or {},
        ledger_path=ledger,
    )
    _wait_for_state(first, started["operationId"], "running")

    restarted = RuntimeOperationManager()
    recovered = restarted.load_workspace_ledger("workspace-1", ledger)

    assert recovered == [started["operationId"]]
    assert restarted.operation_status(started["operationId"])["state"] == "interrupted"
    duplicate = restarted.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=lambda _observer: {},
        ledger_path=ledger,
    )
    assert duplicate["operationId"] == started["operationId"]
    assert duplicate["deduplicated"] is True
    release.set()


def test_event_identity_is_unique_across_sidecar_operation_managers():
    first_events = []
    second_events = []
    first = RuntimeOperationManager(first_events.append)
    second = RuntimeOperationManager(second_events.append)

    first.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="first",
        runner=lambda _observer: {"rerun": False},
    )
    second.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=True,
        step="",
        idempotency_key="second",
        runner=lambda _observer: {"rerun": True},
    )

    first_queued = _wait_for_event(first_events, "operation.queued")
    second_queued = _wait_for_event(second_events, "operation.queued")
    assert first_queued["sequence"] == second_queued["sequence"] == 1
    assert first_queued["eventId"] != second_queued["eventId"]
    assert first_queued["runtimeInstanceId"] != second_queued["runtimeInstanceId"]
    assert first_queued["operationId"] != second_queued["operationId"]
    assert first_queued["runSessionId"] != second_queued["runSessionId"]


def test_rerun_prepared_event_carries_the_affected_steps_once():
    events = []
    manager = RuntimeOperationManager(events.append)
    step = SimpleNamespace(name="Floorplan", tool="ecc", log=SimpleNamespace(file=""))

    def runner(observer):
        observer.on_rerun_prepared(
            scope="step",
            target_step="Floorplan",
            affected_steps=["Floorplan", "route"],
            workspace_revision=4,
        )
        observer.on_step_completed(step, StateEnum.Success)
        return {"rerun": True}

    first = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=True,
        step="Floorplan",
        idempotency_key="rerun-prepared",
        runner=runner,
        workspace_revision=3,
    )
    duplicate = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=True,
        step="Floorplan",
        idempotency_key="rerun-prepared",
        runner=runner,
        workspace_revision=3,
    )

    assert duplicate["operationId"] == first["operationId"]
    prepared = _wait_for_event(events, "operation.rerun_prepared")
    assert prepared["payload"] == {
        "affectedSteps": ["Floorplan", "route"],
        "scope": "step",
        "targetStep": "Floorplan",
        "workspaceRevision": 4,
    }
    assert prepared["workspaceRevision"] == 4
    completed = _wait_for_event(events, "step.completed")
    assert events.index(prepared) < events.index(completed)
    assert completed["payload"]["workspaceRevision"] == 5
    assert manager.operation_status(first["operationId"])["workspaceRevision"] == 5
    assert len([event for event in events if event["type"] == "operation.rerun_prepared"]) == 1


def test_active_operation_reports_a_shutdown_barrier_and_safe_boundary():
    release = threading.Event()
    manager = RuntimeOperationManager()
    started = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-1",
        runner=lambda _observer: (release.wait(timeout=1), {"rerun": False})[1],
    )

    barrier = manager.shutdown_barrier()
    status = manager.operation_status(started["operationId"])

    assert barrier is not None
    assert barrier["operationId"] == started["operationId"]
    assert barrier["interruptibility"] == "deferred"
    assert status["shutdownBarrier"] is True
    assert status["safeToStop"] is False
    release.set()


def test_step_log_events_stream_only_new_log_bytes_and_keep_final_tail(tmp_path):
    events = []
    step_started = threading.Event()
    complete_step = threading.Event()
    manager = RuntimeOperationManager(events.append)
    log_file = tmp_path / "Synthesis.log"
    log_file.write_text("previous run\n", encoding="utf-8")
    step = SimpleNamespace(
        name="Synthesis",
        tool="yosys",
        log=SimpleNamespace(file=str(log_file)),
    )

    def runner(observer):
        observer.on_step_started(step)
        step_started.set()
        assert complete_step.wait(timeout=2)
        observer.on_step_completed(step, StateEnum.Success)
        return {"rerun": False}

    started = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="request-log-stream",
        runner=runner,
    )
    assert step_started.wait(timeout=1)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write("live line one\nlive line two\n")

    step_log = _wait_for_event(events, "step.log")
    assert step_log["payload"]["chunk"] == "live line one\nlive line two\n"
    assert step_log["payload"]["cursor"] == log_file.stat().st_size

    complete_step.set()
    step_complete = _wait_for_event(events, "step.completed")
    assert step_complete["payload"]["finalLog"] == ("previous run\nlive line one\nlive line two\n")
    assert _wait_for_terminal(manager, started["operationId"])["state"] == "succeeded"


def test_step_error_survives_generic_runner_error_and_releases_workspace(tmp_path):
    events = []
    manager = RuntimeOperationManager(events.append)
    log_file = tmp_path / "place.log"
    log_file.write_text("traceback\n", encoding="utf-8")
    step = SimpleNamespace(
        name="place",
        tool="dreamplace",
        log=SimpleNamespace(file=log_file),
    )

    def runner(observer):
        observer.on_step_started(step)
        observer.on_step_diagnostic(
            step,
            {
                "code": "tool_failed",
                "exitCode": 9,
                "message": "movable utilization is 100.0%",
            },
        )
        observer.on_step_completed(step, StateEnum.Imcomplete, "movable utilization is 100.0%")
        raise RuntimeError("run step place failed with state Imcomplete")

    started = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=False,
        step="place",
        idempotency_key="failed-place",
        runner=runner,
    )

    status = _wait_for_terminal(manager, started["operationId"])
    assert status["error"] == {
        "code": "tool_failed",
        "exitCode": 9,
        "message": "movable utilization is 100.0%",
        "step": "place",
        "tool": "dreamplace",
        "logFile": str(log_file),
    }
    assert _wait_for_event(events, "operation.failed")["payload"]["error"] == status["error"]
    second = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=True,
        step="place",
        idempotency_key="retry-place",
        runner=lambda _observer: {"state": "Success"},
    )
    assert _wait_for_terminal(manager, second["operationId"])["state"] == "succeeded"


def test_cancel_does_not_replace_a_specific_tool_error(tmp_path):
    manager = RuntimeOperationManager()
    log_file = tmp_path / "place.log"
    step = SimpleNamespace(
        name="place",
        tool="dreamplace",
        log=SimpleNamespace(file=log_file),
    )
    step_failed = threading.Event()
    release_runner = threading.Event()

    def runner(observer):
        observer.on_step_started(step)
        observer.on_step_completed(step, StateEnum.Imcomplete, "utilization is larger than 0.99")
        step_failed.set()
        assert release_runner.wait(timeout=2)
        raise RuntimeError("run step place failed with state Incomplete")

    started = manager.start(
        workspace_id="workspace-1",
        kind="step",
        origin="gui",
        rerun=False,
        step="place",
        idempotency_key="cancelled-failed-place",
        runner=runner,
    )
    assert step_failed.wait(timeout=1)
    assert manager.request_cancel(started["operationId"])["accepted"] is True
    release_runner.set()

    status = _wait_for_terminal(manager, started["operationId"])
    assert status["state"] == "failed"
    assert status["error"] == {
        "code": "tool_failed",
        "message": "utilization is larger than 0.99",
        "step": "place",
        "tool": "dreamplace",
        "logFile": str(log_file),
    }


def test_cancel_stops_at_the_next_step_boundary():
    manager = RuntimeOperationManager()
    first_step_finished = threading.Event()
    continue_runner = threading.Event()
    executed = []

    def runner(observer):
        observer.raise_if_cancelled()
        executed.append("synthesis")
        first_step_finished.set()
        assert continue_runner.wait(timeout=2)
        observer.raise_if_cancelled()
        executed.append("floorplan")
        return {"state": "Success"}

    started = manager.start(
        workspace_id="workspace-1",
        kind="flow",
        origin="gui",
        rerun=False,
        step="",
        idempotency_key="cancel-at-boundary",
        runner=runner,
    )
    assert first_step_finished.wait(timeout=1)
    assert manager.request_cancel(started["operationId"])["accepted"] is True
    continue_runner.set()

    status = _wait_for_terminal(manager, started["operationId"])
    assert status["state"] == "cancelled"
    assert executed == ["synthesis"]


def _wait_for_event(events: list[dict], event_type: str) -> dict:
    for _ in range(200):
        for event in events:
            if event["type"] == event_type:
                return event
        threading.Event().wait(0.01)
    raise AssertionError(f"event not received: {event_type}")


def _wait_for_terminal(manager: RuntimeOperationManager, operation_id: str) -> dict:
    for _ in range(100):
        status = manager.operation_status(operation_id)
        if status["state"] in {"succeeded", "failed", "cancelled"}:
            return status
        threading.Event().wait(0.01)
    return manager.operation_status(operation_id)


def _wait_for_state(manager: RuntimeOperationManager, operation_id: str, expected: str) -> dict:
    for _ in range(100):
        status = manager.operation_status(operation_id)
        if status["state"] == expected:
            return status
        threading.Event().wait(0.01)
    return manager.operation_status(operation_id)
