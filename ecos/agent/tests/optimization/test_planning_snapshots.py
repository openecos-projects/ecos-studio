"""Offline pre-planner capture; no provider or native executor is used."""

import json
from dataclasses import replace

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.planning_snapshots import (
    configure_planning_snapshots,
    planning_snapshot_id,
)
from tests.optimization.runner_support import _CURRENT_VALUES, _observation, _retrieval
from tests.optimization.test_runner_async_scheduling import (
    _ConcurrentExecutor, _ScriptedPlanner, _controller, _runner, _terminal_receipt,
)
from ecos_agent.optimization.contracts import OptimizationOutcomeKind, StrategyDirection


def _setup(tmp_path, *, receipt_aware=True):
    planner = _ScriptedPlanner(
        ("place.cell_padding_x", StrategyDirection.INCREASE, 3),
        ("place.target_density", StrategyDirection.INCREASE, 0.25),
    )
    executor = _ConcurrentExecutor({
        "execution-1": _terminal_receipt("execution-1", "place.cell_padding_x", 3),
        "execution-2": _terminal_receipt("execution-2", "place.target_density", 0.25),
    })
    controller = _controller(tmp_path / "visible", planner, executor, max_in_flight=1)
    controller.receipt_aware_planning = receipt_aware
    return controller, planner, executor


def _enable(tmp_path, controller):
    return configure_planning_snapshots(
        controller,
        root=tmp_path / "private",
        source_identity={"attempt_id": "cell-1-a1", "source_model": "mock",
                         "package": "FG" if controller.receipt_aware_planning else "RO",
                         "repeat": 1, "q": 1},
        planner_readable_roots=(tmp_path / "visible",),
    )


def _plan(controller):
    observation = _observation(controller.budget)
    return controller.plan(observation, _retrieval(observation, None), _CURRENT_VALUES)


def test_capture_is_durable_before_planner_and_default_is_unchanged(tmp_path):
    controller, planner, _ = _setup(tmp_path)
    store = _enable(tmp_path, controller)
    original = planner.propose_v2

    def propose(context, domains):
        path = store.path_for(context.context_ref)
        payload = json.loads(path.read_text())
        assert payload["phase"] == "pre_planner"
        assert payload["planning_id"] == planning_snapshot_id(
            context.context_ref, payload["source_identity"]
        )
        assert payload["context_ref"] == context.context_ref.model_dump(mode="json")
        assert payload["started_candidates"] == 0
        assert payload["planning_call"] == 1
        assert payload["internal_context"]["legal_actions"]
        assert payload["internal_context"]["effective_domains"]
        assert payload["internal_context"]["budget"] == context.budget.model_dump(mode="json")
        assert payload["context_sha256"] == canonical_sha256(payload["internal_context"])
        digest = payload.pop("snapshot_sha256")
        assert digest == canonical_sha256(payload)
        assert path.stat().st_mode & 0o222 == 0
        assert "private" not in repr(context)
        assert digest not in repr(context)
        return original(context, domains)

    planner.propose_v2 = propose
    result = _plan(controller)
    other, _, _ = _setup(tmp_path / "default")
    assert _plan(other) == result
    assert not (tmp_path / "default" / "private").exists()


def test_duplicate_capture_never_overwrites_or_calls_planner(tmp_path):
    controller, planner, _ = _setup(tmp_path)
    store = _enable(tmp_path, controller)
    _plan(controller)
    context = planner.contexts[0]
    path = store.path_for(context.context_ref)
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="snapshot capture failed") as error:
        controller._invoke_planner(context)
    assert isinstance(error.value.__cause__, FileExistsError)
    assert path.read_bytes() == before
    assert len(planner.contexts) == 1


@pytest.mark.parametrize("relative", ["visible", "visible/artifacts/snapshots"])
def test_rejects_planner_readable_snapshot_root(tmp_path, relative):
    controller, _, _ = _setup(tmp_path)
    with pytest.raises(ValueError, match="planner-readable"):
        configure_planning_snapshots(
            controller, root=tmp_path / relative, source_identity={"attempt_id": "x"},
            planner_readable_roots=(tmp_path / "visible",),
        )


def test_ro_internal_history_is_full_without_changing_planner_context(tmp_path):
    controller, planner, executor = _setup(tmp_path, receipt_aware=False)
    store = _enable(tmp_path, controller)
    runner = _runner(controller, executor)
    try:
        runner.run_turn()
        assert controller._history()[0].parameter_application_receipt is not None
        full_history = controller._history() * 8
        original = controller._history
        controller._history = lambda *, include_receipts=True: (
            full_history if include_receipts else tuple(
                replace(item, parameter_application_receipt=None, applied_divergence=None)
                for item in full_history
            )
        )
        _plan(controller)
        context = planner.contexts[-1]
        payload = json.loads(store.path_for(context.context_ref).read_text())
        assert len(payload["internal_context"]["history"]) == 8
        assert len(payload["internal_context"]["parameter_trajectories"]) == 8
        assert all(item["parameter_application_receipt"] for item in payload["internal_context"]["history"])
        assert len(context.history) == 6
        assert all(item.parameter_application_receipt is None for item in context.parameter_trajectories)
        assert context.task_memory is None
        assert payload["completed"][0]["parameter_application_receipt"]
        assert payload["pending"] == []
        assert payload["started_candidates"] == 1
        controller._history = original
    finally:
        runner.close()


def test_capture_failure_aborts_before_planner_and_never_becomes_feedback(tmp_path, monkeypatch):
    from ecos_agent.optimization import planning_snapshots

    controller, planner, _ = _setup(tmp_path)
    _enable(tmp_path, controller)

    def fail(*args):
        raise ValueError("private-snapshot-path-must-not-reach-feedback")

    monkeypatch.setattr(planning_snapshots, "_write_new", fail)
    with pytest.raises(RuntimeError, match="snapshot capture failed"):
        _plan(controller)
    assert planner.contexts == []
    assert controller._decision_audit.replay().entries == ()
    assert list((tmp_path / "private").iterdir()) == []


def test_started_thresholds_select_first_capture_even_when_planner_rejects(tmp_path):
    controller, planner, _ = _setup(tmp_path)
    store = _enable(tmp_path, controller)
    seen = []
    controller._budget = controller.budget.model_copy(update={
        "budget": controller.budget.budget.model_copy(update={"max_planning_only_turns": 10}),
    })

    def invalid_proposal(context, domains):
        seen.append(context)
        assert store.path_for(context.context_ref).exists()
        return {}  # A schema rejection must not remove/replace its pre-call capture.

    planner.propose_v2 = invalid_proposal
    for started in (4, 5, 5, 14, 15, 15):
        controller._budget = controller.budget.model_copy(update={"consumed_candidates": started})
        _plan(controller)
    records = [json.loads(store.path_for(item.context_ref).read_text()) for item in seen]
    assert len(records) == 12
    assert [item["started_candidates"] for item in records] == [4, 4, 5, 5, 5, 5, 14, 14, 15, 15, 15, 15]
    assert len({item["planning_id"] for item in records}) == 12
    for threshold, expected_call in ((5, 3), (15, 9)):
        eligible = [item for item in records if item["started_candidates"] >= threshold]
        assert min(eligible, key=lambda item: item["planning_call"])["planning_call"] == expected_call
    # Final counters cannot create a missing next-planning slot.
    controller._budget = controller.budget.model_copy(update={"consumed_candidates": 20})
    assert not any(item["started_candidates"] >= 20 for item in records)
    assert len(list(store.root.glob("*.json"))) == 12
    assert all(item["completed"] == [] for item in records)


def test_pending_is_preserved_not_cleared_to_fake_q1(tmp_path):
    controller, planner, _ = _setup(tmp_path)
    controller.max_in_flight_candidates = 2
    store = _enable(tmp_path, controller)
    _plan(controller)
    controller.execute()
    _plan(controller)
    payload = json.loads(store.path_for(planner.contexts[-1].context_ref).read_text())
    assert payload["started_candidates"] == 1
    assert payload["max_in_flight_candidates"] == 2
    assert len(payload["pending"]) == len(payload["internal_context"]["in_flight"]) == 1
    assert payload["completed"] == []


def test_symlink_to_readable_root_is_rejected(tmp_path):
    controller, _, _ = _setup(tmp_path)
    alias = tmp_path / "alias"
    alias.symlink_to(tmp_path / "visible", target_is_directory=True)
    with pytest.raises(ValueError, match="planner-readable"):
        configure_planning_snapshots(
            controller, root=alias / "snapshots", source_identity={"attempt_id": "x"},
            planner_readable_roots=(tmp_path / "visible",),
        )


def test_source_identity_is_frozen_and_capture_bytes_do_not_follow_mutations(tmp_path):
    controller, planner, _ = _setup(tmp_path)
    source = {"attempt_id": "first", "manifest": {"sha256": "frozen"}}
    store = configure_planning_snapshots(
        controller, root=tmp_path / "private", source_identity=source,
        planner_readable_roots=(tmp_path / "visible",),
    )
    source["manifest"]["sha256"] = "changed"
    _plan(controller)
    context = planner.contexts[0]
    path = store.path_for(context.context_ref)
    saved = path.read_bytes()
    context.current_values["place.cell_padding_x"] = 999
    assert path.read_bytes() == saved
    assert json.loads(saved)["source_identity"]["manifest"]["sha256"] == "frozen"
    assert planning_snapshot_id(context.context_ref, source) != path.stem
