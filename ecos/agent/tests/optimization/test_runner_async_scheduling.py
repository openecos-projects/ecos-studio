"""Async runner scheduling contracts from docs/speed_up.md (§8: A1-A6)."""

from __future__ import annotations

from pathlib import Path

from tests.optimization import runner_support as support
from tests.optimization.runner_support import (
    _Clock,
    _CURRENT_VALUES,
    _FakePlanner,
    _budget,
    _evidence,
    _execution_context,
    _observation,
    _proposal,
    _retrieval,
    _terminal_observation,
)

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveProposal,
    OptimizationOutcomeKind,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationAgentMode,
    OptimizationEpisodeController,
    OptimizationPlanningContext,
)
from ecos_agent.optimization.ledger import OptimizationLedger
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.runner import OptimizationEpisodeRunner
from ecos_agent.optimization.rules import (
    IncumbentDecision,
    freeze_optimization_objective,
    freeze_routability_objective,
)


class _ScriptedPlanner(_FakePlanner):
    """Planner scripts: (knob_id, direction, explicit value or None)."""

    def __init__(self, *scripts, contexts=None):
        self.scripts = list(scripts)
        self.contexts = contexts if contexts is not None else []

    def propose_v2(self, context: OptimizationPlanningContext, domains: object):
        self.contexts.append(context)
        knob_id, direction, value = self.scripts.pop(0)
        return _proposal(context, knob_id, direction, requested_value=value)


class _ConcurrentExecutor:
    """Executor that allows two candidates to run and finish in a set order."""

    def __init__(self, receipts: dict[str, CandidateExecutionReceipt]):
        self.receipts = receipts
        self.requests: list[object] = []
        self.cancels: list[str] = []

    def start(self, request: object) -> CandidateExecutionReceipt:
        self.requests.append(request)
        return CandidateExecutionReceipt(
            execution_id=f"execution-{len(self.requests)}", started=True
        )

    def wait_for_terminal(self, execution_id: str, **_kwargs):
        return self.receipts[execution_id]

    def wait_for_any(self, execution_ids: tuple[str, ...]):
        for execution_id in execution_ids:
            receipt = self.receipts.get(execution_id)
            if receipt is not None and receipt.outcome is not None:
                self.receipts.pop(execution_id)
                return receipt
        raise AssertionError("no terminal available for the pending candidates")

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt:
        self.cancels.append(intervention_id)
        return CandidateExecutionReceipt(
            execution_id=intervention_id, started=True,
            outcome=OptimizationOutcomeKind.TIMED_OUT_CANCELLED,
        )


def _controller(tmp_path: Path, planner, executor, *, max_in_flight=2,
                incumbent=None, objective=None, alignment=None):
    return OptimizationEpisodeController(
        episode_id="episode-1",
        checkpoint_id="checkpoint-1",
        mode=OptimizationAgentMode.FULL_AGENT,
        budget=_budget(),
        planner=planner,
        executor=executor,
        ledger=OptimizationLedger(tmp_path / "episode"),
        clock=_Clock(),
        execution_context=_execution_context(),
        incumbent=incumbent,
        objective=objective,
        objective_alignment=alignment,
        max_in_flight_candidates=max_in_flight,
    )


def _terminal_receipt(execution_id, knob, value, *, outcome=None):
    return CandidateExecutionReceipt(
        execution_id=execution_id,
        started=True,
        outcome=outcome or OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        evidence=_evidence(execution_id),
        parameter_application_receipt=support._native_receipt(knob, value),
    )


def _baseline_incumbent() -> TerminalObservation:
    return support._incumbent()


def _better_terminal(execution_id: str, *, dr=2.0, overflow=3.0, wirelength=4.0):
    return _terminal_observation(
        _observation(_budget()),
        CandidateExecutionReceipt(execution_id=execution_id, started=True),
    ).model_copy(
        update={
            "metrics": {
                ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: dr,
                ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
                ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
            },
        }
    )


def _runner(controller, executor, **kwargs):
    return OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_waiter_any=executor.wait_for_any,
        terminal_observation_supplier=(
            kwargs.pop("terminal_observation_supplier", None)
            or (lambda _o, receipt: _better_terminal(receipt.execution_id))
        ),
        objective=freeze_routability_objective(_baseline_incumbent()),
        site_width_dbu=200,
        **kwargs,
    )


def test_a1_first_terminal_feeds_the_next_plan_without_waiting(tmp_path):
    """A1: A finishes first, is absorbed, and C is planned while B still runs."""
    planner = _ScriptedPlanner(
        ("place.cell_padding_x", StrategyDirection.INCREASE, 3),
        ("place.target_density", StrategyDirection.INCREASE, 0.25),
        ("place.target_density", StrategyDirection.DECREASE, 0.15),
    )
    executor = _ConcurrentExecutor(
        {
            "execution-1": _terminal_receipt(
                "execution-1", "place.cell_padding_x", 3,
                outcome=OptimizationOutcomeKind.DEGRADED,
            ),
            "execution-2": _terminal_receipt(
                "execution-2", "place.target_density", 0.25,
            ),
            "execution-3": _terminal_receipt(
                "execution-3", "place.target_density", 0.15,
                outcome=OptimizationOutcomeKind.DEGRADED,
            ),
        }
    )
    controller = _controller(tmp_path, planner, executor)
    runner = _runner(controller, executor)

    first = runner.run_turn()

    assert controller.pending_execution_ids == ("execution-2",)
    assert controller.state.value == "executing"
    assert first.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    # A's degraded terminal is already part of the completed trajectory.
    assert [item.requested.value for item in planner.contexts[1].history] == []
    second = runner.run_turn()
    # C was planned knowing A's outcome and B's in-flight request.
    assert any(
        item.execution_id == "execution-2"
        for item in planner.contexts[2].in_flight
    )
    assert [item.outcome for item in planner.contexts[2].history] == [
        OptimizationOutcomeKind.DEGRADED
    ]
    assert second.incumbent_comparison is not None
    assert controller.pending_execution_ids == ("execution-3",)
    runner.close()


def test_a2_late_terminal_keeps_its_parent_and_compares_to_new_incumbent(tmp_path):
    """A2: B returns from the older parent snapshot against the new incumbent."""
    planner = _ScriptedPlanner(
        ("place.target_density", StrategyDirection.INCREASE, 0.25),
        ("place.cell_padding_x", StrategyDirection.INCREASE, 3),
    )
    executor = _ConcurrentExecutor(
        {
            # A promotes first; B is worse than the promoted incumbent.
            "execution-1": _terminal_receipt(
                "execution-1", "place.target_density", 0.25
            ),
            "execution-2": _terminal_receipt(
                "execution-2", "place.cell_padding_x", 3,
                outcome=OptimizationOutcomeKind.DEGRADED,
            ),
        }
    )
    controller = _controller(tmp_path, planner, executor)
    runner = _runner(controller, executor)

    runner.run_turn()  # starts A and B, absorbs and promotes A
    assert controller.incumbent.observation_id == "terminal-execution-1"
    runner.request_stop()
    runner.run_turn()  # absorbs the late B

    outcomes = controller.ledger.replay().terminal_outcomes
    assert len(outcomes) == 2
    b_start, b_terminal = _start_and_terminal(controller, "execution-2")
    parent_before = canonical_sha256(dict(sorted(_CURRENT_VALUES.items())))
    assert b_start.parent_config_sha256 == parent_before
    assert b_terminal.incumbent_decision == "candidate_ineligible"
    # The merge-time comparison saw the promoted incumbent, not B's parent.
    assert controller.incumbent.observation_id == "terminal-execution-1"
    runner.close()


def _start_and_terminal(controller, execution_id):
    from ecos_agent.optimization.ledger import (
        OptimizationInterventionStart,
        OptimizationTerminalOutcome,
    )

    starts = {
        entry.payload.intervention_id: entry.payload
        for entry in controller.ledger.replay().entries
        if isinstance(entry.payload, OptimizationInterventionStart)
    }
    binding = next(
        record for record in controller._execution_bindings
        if record.execution_id == execution_id
    )
    terminal = next(
        outcome for outcome in controller.ledger.replay().terminal_outcomes
        if outcome.intervention_id == binding.intervention_id
    )
    return starts[binding.intervention_id], terminal


def test_a3_promotion_switches_to_the_winners_full_configuration(tmp_path):
    """A3: sequential promotions adopt each winner's complete configuration."""
    planner = _ScriptedPlanner(
        ("place.target_density", StrategyDirection.INCREASE, 0.25),
        ("place.cell_padding_x", StrategyDirection.INCREASE, 4),
    )
    executor = _ConcurrentExecutor(
        {
            "execution-1": _terminal_receipt(
                "execution-1", "place.target_density", 0.25
            ),
            "execution-2": _terminal_receipt(
                "execution-2", "place.cell_padding_x", 4
            ),
        }
    )
    controller = _controller(tmp_path, planner, executor)
    full_configs = {
        None: dict(_CURRENT_VALUES),
        ".agent/candidates/execution-1": {
            **_CURRENT_VALUES, "place.target_density": 0.25,
        },
        ".agent/candidates/execution-2": {
            # B executed from the ORIGINAL density; promotion must adopt B's
            # complete configuration, never splice A's density into it.
            **_CURRENT_VALUES, "place.cell_padding_x": 4,
        },
    }
    def terminal_for(_observation, receipt):
        if receipt.execution_id == "execution-1":
            return _better_terminal(receipt.execution_id)
        return _better_terminal(receipt.execution_id, dr=1.0, overflow=2.0, wirelength=3.5)

    runner = _runner(
        controller, executor,
        terminal_observation_supplier=terminal_for,
        current_values_supplier=lambda ref: full_configs[ref],
    )

    runner.run_turn()
    assert runner.current_values["place.target_density"] == 0.25
    assert runner.current_values["place.cell_padding_x"] == 2
    runner.request_stop()
    runner.run_turn()

    assert runner.current_values == {
        **_CURRENT_VALUES, "place.cell_padding_x": 4,
    }
    assert runner.current_values["place.target_density"] == 0.2
    assert controller.incumbent_candidate_root_ref == (
        ".agent/candidates/execution-2"
    )
    runner.close()


def test_a5_simultaneous_terminals_merge_once_in_recorded_order(tmp_path):
    """A5: two near-simultaneous terminals each merge exactly once."""
    planner = _ScriptedPlanner(
        ("place.cell_padding_x", StrategyDirection.INCREASE, 3),
        ("place.target_density", StrategyDirection.INCREASE, 0.25),
    )
    executor = _ConcurrentExecutor(
        {
            "execution-1": _terminal_receipt(
                "execution-1", "place.cell_padding_x", 3
            ),
            "execution-2": _terminal_receipt(
                "execution-2", "place.target_density", 0.25,
                outcome=OptimizationOutcomeKind.DEGRADED,
            ),
        }
    )
    controller = _controller(
        tmp_path, planner, executor, incumbent=_baseline_incumbent()
    )
    runner = _runner(controller, executor)

    first = runner.run_turn()
    assert controller.pending_execution_ids == ("execution-2",)
    assert first.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_BETTER
    runner.request_stop()
    second = runner.run_turn()

    assert controller.pending_execution_ids == ()
    assert controller.state.value == "planning"
    assert controller.budget.consumed_candidates == 2
    assert len(controller.ledger.replay().terminal_outcomes) == 2
    # The second merge judged B against the incumbent the first merge produced.
    assert second.incumbent_comparison.decision == IncumbentDecision.CANDIDATE_INELIGIBLE
    runner.close()


def _recovery_terminal(execution_id, *, drc=0, setup=0, hold=0, wirelength=4.0):
    terminal = _terminal_observation(
        _observation(_budget()),
        CandidateExecutionReceipt(execution_id=execution_id, started=True),
    )
    counts = {
        "drc_count": drc,
        "sta_setup_violation_count": setup,
        "sta_hold_violation_count": hold,
    }
    return terminal.model_copy(
        update={
            "evaluation_metrics": tuple(
                item.model_copy(update={"value": counts.get(item.metric_id, item.value)})
                for item in terminal.evaluation_metrics
            ),
            "signoff_gates": terminal.signoff_gates.model_copy(
                update={
                    "drc_clean": GateResult.PASS if drc == 0 else GateResult.FAIL,
                    "sta_setup_closed": (
                        GateResult.PASS if setup == 0 else GateResult.FAIL
                    ),
                    "sta_hold_closed": (
                        GateResult.PASS if hold == 0 else GateResult.FAIL
                    ),
                }
            ),
            "metrics": {
                **terminal.metrics,
                ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
            },
        }
    )


def test_a6_recovery_stage_change_rejudges_the_late_candidate(tmp_path):
    """A6: a stage transition between dispatch and merge re-binds judgment."""
    baseline = _recovery_terminal("execution-0", drc=6, setup=2, hold=1, wirelength=5.0)
    objective = freeze_optimization_objective(
        "reduce routed wirelength",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            rationale_summary="Reduce routed wirelength.",
        ),
    )
    alignment = build_objective_alignment(objective, baseline)
    planner = _ScriptedPlanner(
        ("place.cell_padding_x", StrategyDirection.INCREASE, 3),
        ("place.target_density", StrategyDirection.INCREASE, 0.25),
    )
    executor = _ConcurrentExecutor(
        {
            # A clears DRC: the recovery stage advances while B runs.
            "execution-1": _terminal_receipt(
                "execution-1", "place.cell_padding_x", 3
            ),
            # B returns with setup violations opened under the old stage.
            "execution-2": _terminal_receipt(
                "execution-2", "place.target_density", 0.25
            ),
        }
    )
    controller = _controller(
        tmp_path, planner, executor, incumbent=baseline,
        objective=objective, alignment=alignment,
    )

    def terminal_for(_observation, receipt):
        if receipt.execution_id == "execution-1":
            return _recovery_terminal(
                receipt.execution_id, drc=0, setup=2, hold=1, wirelength=4.5
            )
        return _recovery_terminal(
            receipt.execution_id, drc=0, setup=3, hold=1, wirelength=4.4
        )

    runner = OptimizationEpisodeRunner(
        controller=controller,
        observation_supplier=_observation,
        retrieval_supplier=_retrieval,
        current_values=_CURRENT_VALUES,
        terminal_waiter=executor.wait_for_terminal,
        terminal_waiter_any=executor.wait_for_any,
        terminal_observation_supplier=terminal_for,
        objective=freeze_routability_objective(
            baseline, objective_alignment=alignment
        ),
        site_width_dbu=200,
    )

    runner.run_turn()
    outcomes = controller.ledger.replay().terminal_outcomes
    assert outcomes[0].recovery_transition == "drc_to_setup"
    assert controller.recovery_incomplete is True

    runner.request_stop()
    runner.run_turn()
    outcomes = controller.ledger.replay().terminal_outcomes
    b_start, b_terminal = _start_and_terminal(controller, "execution-2")
    # B was dispatched under the drc stage; its start keeps that context.
    assert b_start.active_objective.recovery_stage == "drc"
    # The late merge applies the current setup-stage rules: not promoted.
    assert b_terminal.incumbent_decision not in {
        decision.value for decision in (
            IncumbentDecision.RECOVERY_PROGRESS,
            IncumbentDecision.CANDIDATE_BETTER,
            IncumbentDecision.PARITY_OBJECTIVE_IMPROVED,
        )
    }
    assert controller.incumbent.observation_id == "terminal-execution-1"
    assert controller.objective == objective
    assert controller.objective_alignment == alignment
    runner.close()
