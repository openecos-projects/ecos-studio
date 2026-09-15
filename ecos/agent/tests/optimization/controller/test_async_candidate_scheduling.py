"""Async dual-candidate scheduling contracts from docs/speed_up.md (§8)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from .support import (
    CURRENT_VALUES,
    _Clock,
    _FakeCodex,
    _FakeEcc,
    _controller,
    _eligible_terminal,
    _execution_context,
    _native_receipt,
    _objective,
    _observation,
    _proposal,
    _retrieval,
    _started,
)

from ecos_agent.hashing import canonical_sha256
from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.optimization.contracts import (
    ObjectiveMetric,
    OptimizationEpisodeState,
    OptimizationObjectiveProposal,
    RequestedKnobValue,
    StrategyDirection,
)
from ecos_agent.optimization.controller import (
    CandidateExecutionReceipt,
    OptimizationEpisodeController,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.controller_models import AttemptedProbe
from ecos_agent.optimization.execution import CandidateExecutionBusy
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.rules import freeze_optimization_objective

_WIRELENGTH_GOAL = "Minimize route wirelength while preserving DRC and congestion."


def _area_objective():
    return freeze_optimization_objective(
        "降低芯片面积",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.DIE_AREA,
            rationale_summary="Area may change the floorplan.",
        ),
    )


def _started_pair() -> _FakeEcc:
    return _FakeEcc(_started("execution-1"), _started("execution-2"))


def _promoting_receipt(
    execution_id: str, requested: RequestedKnobValue
) -> CandidateExecutionReceipt:
    return CandidateExecutionReceipt(
        execution_id=execution_id,
        started=True,
        outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        parameter_application_receipt=_native_receipt(requested),
    )


def test_p1_cross_layer_choice_is_legal_while_hard_permissions_hold(tmp_path):
    """P1: the LLM may leave the recommended layer; task permissions do not move."""
    # Recommended layer is physical; proposing the strategy-layer knob is accepted.
    controller = _controller(
        tmp_path,
        _FakeCodex(
            lambda ctx: _proposal(
                ctx, knob_id="place.routability_opt", direction=StrategyDirection.DISABLE
            )
        ),
        _started_pair(),
        objective=_objective(),
        incumbent=_eligible_terminal(),
    )
    result = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert result.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert result.requested == RequestedKnobValue(
        knob_id="place.routability_opt", value=False
    )
    context = controller.planner.contexts[0]
    assert context.parameter_policy["active_layer"] == "physical"
    assert context.parameter_policy["layer_priority_is_advisory"] is True
    # Hard permissions: geometry stays excluded regardless of advice.
    assert {a.knob_id.value for a in context.legal_actions} == {
        "place.target_density", "place.target_overflow", "place.cell_padding_x",
        "place.routability_opt", "place.density_weight",
    }


def test_p2_cross_stage_actions_need_their_own_stage_evidence(tmp_path):
    """P2: floorplan actions dispatch only with floorplan-stage evidence."""
    floorplan_observation = _observation().model_copy(
        update={
            "stage": ECCStepName.POST_FLOORPLAN,
            "observation_id": "observation-floorplan",
        }
    )

    def floorplan_proposal(_ctx):
        return _proposal(
            _ctx,
            knob_id="floorplan.core_util",
            direction=StrategyDirection.INCREASE,
            requested_value=0.7,
        )

    without_evidence = _controller(
        tmp_path / "without",
        _FakeCodex(floorplan_proposal, floorplan_proposal),
        _FakeEcc(),
        objective=_area_objective(),
        incumbent=_eligible_terminal(),
    )
    without_evidence.plan(_observation(), _retrieval(), CURRENT_VALUES)
    context = without_evidence.planner.contexts[0]
    assert all(
        a.knob_id.value.startswith("place.") for a in context.legal_actions
    ), "floorplan actions must not dispatch without floorplan evidence"
    assert without_evidence.state != OptimizationEpisodeState.AWAITING_EXECUTION

    with_evidence = _controller(
        tmp_path / "with",
        _FakeCodex(floorplan_proposal),
        _started_pair(),
        objective=_area_objective(),
        incumbent=_eligible_terminal(),
    )
    result = with_evidence.plan(
        _observation(), _retrieval(), CURRENT_VALUES,
        stage_observations={"Floorplan": floorplan_observation},
    )
    assert result.state == OptimizationEpisodeState.AWAITING_EXECUTION
    context = with_evidence.planner.contexts[-1]
    assert any(
        a.knob_id.value == "floorplan.core_util" for a in context.legal_actions
    )
    assert [
        entry["stage"]
        for entry in controller_stage_entries(context)
    ] == ["place", "Floorplan"]


def controller_stage_entries(context):
    from ecos_agent.optimization.planning import planning_context_payload

    return planning_context_payload(context).get("stage_evidence", [])


def _dispatch_two(controller):
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    assert controller.pending_execution_ids == ("execution-1", "execution-2")


def test_p3_in_flight_requests_reach_planning_and_block_duplicates(tmp_path):
    """P3: planning sees in-flight experiments; identical dispatch is blocked."""
    planner = _FakeCodex(
        lambda ctx: _proposal(ctx, knob_id="place.cell_padding_x"),
        lambda ctx: _proposal(ctx, knob_id="place.target_density"),
        lambda ctx: _proposal(
            ctx, knob_id="place.cell_padding_x", requested_value=3
        ),
        lambda ctx: _proposal(
            ctx, knob_id="place.cell_padding_x", requested_value=3
        ),
    )
    controller = _controller(
        tmp_path, planner, _started_pair(), incumbent=_eligible_terminal(),
        max_in_flight=2,
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    context = controller.planner.contexts[-1]
    assert [item.execution_id for item in context.in_flight] == ["execution-1"]
    assert context.in_flight[0].requested == RequestedKnobValue(
        knob_id="place.cell_padding_x", value=3
    )
    controller.execute()
    assert controller.pending_execution_ids == ("execution-1", "execution-2")

    # The third plan is refused while both slots are busy.
    refused = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert refused.rejection_reason == "no_free_candidate_slot"
    assert refused.state == OptimizationEpisodeState.EXECUTING
    assert controller.budget.consumed_planning_calls == 2

    # Once a slot frees, re-proposing the in-flight request from the same
    # parent configuration is rejected by the effective domain and never
    # dispatched.
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-2",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
        )
    )
    duplicate = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert duplicate.state != OptimizationEpisodeState.AWAITING_EXECUTION
    assert len(controller.executor.start_calls) == 2
    padding = next(
        item
        for item in controller.planner.contexts[-1].effective_domains
        if item.knob_id.value == "place.cell_padding_x"
    )
    assert 3 in padding.attempted_values
    assert not padding.accepts(3)


def test_p4_dedup_is_scoped_to_the_parent_configuration(tmp_path):
    """P4: same value under a new parent is a justified retest, not a repeat."""
    def _padding(ctx):
        return _proposal(ctx, knob_id="place.cell_padding_x", requested_value=3)

    def _density(ctx):
        return _proposal(ctx, knob_id="place.target_density")

    controller = _controller(
        tmp_path,
        _FakeCodex(_padding, _density, _padding),
        _FakeEcc(_started("execution-1"), _started("execution-2")),
        incumbent=_eligible_terminal(),
        max_in_flight=2,
    )
    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1",
            started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
        )
    )

    # Same parent configuration: the attempted padding value stays excluded
    # even while a different knob stays dispatchable.
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    padding = next(
        item
        for item in controller.planner.contexts[-1].effective_domains
        if item.knob_id.value == "place.cell_padding_x"
    )
    assert 3 in padding.attempted_values
    assert not padding.accepts(3)
    controller.execute()
    # Promote the density candidate: the parent configuration materially
    # changes through the promoted full configuration.
    promoted = controller.complete_terminal(
        _promoting_receipt("execution-2", RequestedKnobValue(
            knob_id="place.target_density", value=0.25,
        )),
        _eligible_terminal("terminal-promoted"),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )
    assert promoted.state == OptimizationEpisodeState.PLANNING
    assert controller.incumbent.observation_id == "terminal-promoted"

    # A materially different parent configuration re-opens the same value;
    # changing only the ledger or budget never bypasses the scope.
    changed_values = {**CURRENT_VALUES, "place.target_density": 0.25}
    reopened = controller.plan(_observation(), _retrieval(), changed_values)
    assert reopened.state == OptimizationEpisodeState.AWAITING_EXECUTION
    domain = next(
        item
        for item in controller.planner.contexts[-1].effective_domains
        if item.knob_id.value == "place.cell_padding_x"
    )
    assert 3 not in domain.attempted_values
    assert domain.accepts(3)
    # The prior probe remains recorded against its original parent snapshot.
    assert [probe.parent_config_sha256 for probe in controller._attempted_probes] == [
        canonical_sha256(dict(sorted(CURRENT_VALUES.items()))),
        canonical_sha256(dict(sorted(CURRENT_VALUES.items()))),
    ]


def test_p5_equal_actual_values_do_not_merge_distinct_requests(tmp_path):
    """P5: equivalence keys use the requested coordinate, not the native value."""
    controller = _controller(
        tmp_path, _FakeCodex(_proposal, _proposal),
        _FakeEcc(_started("execution-1")),
    )
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert planned.requested.value == 3
    # The native receipt normalizes 3 to the same actual 3; a different
    # requested coordinate stays a distinct experiment.
    controller.execute()
    controller.complete_terminal(
        _promoting_receipt("execution-1", planned.requested),
        _eligible_terminal("terminal-a"),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    padding = next(
        item
        for item in controller.planner.contexts[-1].effective_domains
        if item.knob_id.value == "place.cell_padding_x"
    )
    assert padding.attempted_values == (3,)
    assert padding.accepts(4)


def test_a4_stale_proposal_is_discarded_not_rebound(tmp_path):
    """A4: a proposal planned against an older incumbent never re-binds."""
    planner = _FakeCodex(
        lambda ctx: _proposal(ctx, knob_id="place.cell_padding_x"),
        lambda ctx: _proposal(ctx, knob_id="place.target_density"),
    )
    controller = _controller(
        tmp_path, planner, _started_pair(), incumbent=_eligible_terminal(),
        max_in_flight=2,
    )
    first = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    second = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert second.state == OptimizationEpisodeState.AWAITING_EXECUTION

    # Candidate A promotes while B's proposal waits unstarted.
    controller.complete_terminal(
        _promoting_receipt("execution-1", first.requested),
        _eligible_terminal("terminal-a"),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )

    stale = controller.execute()
    assert stale.state == OptimizationEpisodeState.PLANNING
    assert stale.rejection_reason == "stale_proposal_parent_changed"
    assert controller.executor.start_calls[-1].intervention_id == "intervention-1"
    assert controller.pending_execution_ids == ()


def test_e3_duplicate_terminal_delivery_merges_exactly_once(tmp_path):
    """E3: a replayed terminal is a no-op; budget and ledger stay unchanged."""
    controller = _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started("execution-1")),
        incumbent=_eligible_terminal(),
    )
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    receipt = _promoting_receipt("execution-1", planned.requested)
    controller.complete_terminal(
        receipt,
        _eligible_terminal("terminal-a"),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )
    terminal_count = len(controller.ledger.replay().terminal_outcomes)
    consumed = controller.budget.consumed_candidates

    replayed = controller.complete_terminal(receipt)

    assert replayed.state == controller.state
    assert len(controller.ledger.replay().terminal_outcomes) == terminal_count
    assert controller.budget.consumed_candidates == consumed


def test_b1_slots_reserve_atomically_and_budget_never_overdraws(tmp_path):
    """B1: two slots, two dispatches, a third plan never starts an experiment."""
    planner = _FakeCodex(
        lambda ctx: _proposal(ctx, knob_id="place.cell_padding_x"),
        lambda ctx: _proposal(ctx, knob_id="place.target_density"),
        lambda ctx: _proposal(ctx, knob_id="place.routability_opt",
                              direction=StrategyDirection.DISABLE),
    )
    controller = _controller(
        tmp_path, planner, _started_pair(), incumbent=_eligible_terminal(),
        max_in_flight=2,
    )
    _dispatch_two(controller)
    assert controller.budget.consumed_candidates == 2

    third = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert third.rejection_reason == "no_free_candidate_slot"
    assert controller.budget.consumed_candidates == 2
    # The refusal consumed no planning budget and left no approved proposal.
    assert controller.budget.consumed_planning_calls == 2
    assert controller._requested is None
    assert controller.executor.start_calls.__len__() == 2


def test_b3_exhausted_budget_still_collects_in_flight_terminals(tmp_path):
    """B3: budget exhaustion blocks dispatch, never terminal collection."""
    planner = _FakeCodex(
        lambda ctx: _proposal(ctx, knob_id="place.cell_padding_x"),
        lambda ctx: _proposal(ctx, knob_id="place.target_density"),
    )
    from .support import _budget

    controller = _controller(
        tmp_path, planner, _started_pair(),
        budget=_budget(candidates=18, planning=0), incumbent=_eligible_terminal(),
        max_in_flight=2,
    )
    _dispatch_two(controller)
    assert controller.budget.remaining_candidates == 0

    blocked = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert blocked.rejection_reason == "budget_exhausted"
    assert blocked.state == OptimizationEpisodeState.EXECUTING

    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-1", started=True,
            outcome=OptimizationOutcomeKind.DEGRADED,
        )
    )
    assert controller.state == OptimizationEpisodeState.EXECUTING
    controller.complete_terminal(
        CandidateExecutionReceipt(
            execution_id="execution-2", started=True,
            outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        )
    )
    # The last collected terminal moves the episode to a terminal state.
    assert controller.state == OptimizationEpisodeState.STOPPED
    assert len(controller.ledger.replay().terminal_outcomes) == 2


def test_busy_backend_keeps_the_proposal_without_charging_budget(tmp_path):
    """A busy ECC backend defers the start; nothing is re-dispatched or charged."""
    class _BusySecondStart(_FakeEcc):
        def __init__(self):
            super().__init__(_started("execution-1"))
            self.starts = 0

        def start(self, request: object) -> CandidateExecutionReceipt:
            self.starts += 1
            if self.starts > 1:
                raise CandidateExecutionBusy(
                    "ECC workspace already has an active candidate operation"
                )
            return super().start(request)

    planner = _FakeCodex(
        lambda ctx: _proposal(ctx, knob_id="place.cell_padding_x"),
        lambda ctx: _proposal(ctx, knob_id="place.target_density"),
    )
    ecc = _BusySecondStart()
    controller = _controller(
        tmp_path, planner, ecc, incumbent=_eligible_terminal(), max_in_flight=2,
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)

    busy = controller.execute()

    assert busy.state == OptimizationEpisodeState.AWAITING_EXECUTION
    assert busy.rejection_reason == "execution_backend_busy"
    assert controller.budget.consumed_candidates == 1
    assert len(controller.ledger.replay().entries) == 1
    # The approved proposal survives for a later start.
    assert controller._requested == RequestedKnobValue(
        knob_id="place.target_density", value=0.25
    )


def test_r1_reattached_execution_can_still_merge_its_late_terminal(tmp_path):
    """R1: after restart the late terminal merges once, without re-execution."""
    controller = _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started("execution-1")),
        incumbent=_eligible_terminal(),
    )
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    assert recovered.state == OptimizationEpisodeState.EXECUTING
    assert recovered.executor.start_calls == []
    assert recovered.pending_execution_ids == ("execution-1",)

    completed = recovered.complete_terminal(
        _promoting_receipt("execution-1", planned.requested),
        _eligible_terminal("terminal-late"),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )
    assert completed.state == OptimizationEpisodeState.PLANNING
    assert recovered.budget.consumed_candidates == 1
    assert recovered.incumbent.observation_id == "terminal-late"


def test_r2_ledger_ahead_of_snapshot_reconciles_from_persisted_events(tmp_path):
    """R2: a crash between ledger append and state write recovers consistently."""
    controller = _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started("execution-1")),
        incumbent=_eligible_terminal(),
    )
    planned = controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    controller.execute()
    snapshot_before_merge = controller.state_path.read_text(encoding="utf-8")

    # Simulate the crash window: the terminal is ledgered but the state file
    # write never happened.
    controller.complete_terminal(
        _promoting_receipt("execution-1", planned.requested),
        _eligible_terminal("terminal-recovered"),
        outcome=OptimizationOutcomeKind.IMPROVED,
        incumbent_decision="candidate_better",
    )
    controller.state_path.write_text(snapshot_before_merge, encoding="utf-8")

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal),
        executor=_FakeEcc(),
        ledger=controller.ledger,
        clock=_Clock(),
        execution_context=_execution_context(),
    )
    assert recovered.state == OptimizationEpisodeState.PLANNING
    assert recovered.pending_execution_ids == ()
    assert recovered.incumbent.observation_id == "terminal-recovered"
    assert recovered.budget.consumed_candidates == 1
    assert len(recovered.ledger.replay().terminal_outcomes) == 1
    # The reconciliation is idempotent: replaying the same delivery no-ops.
    replayed = recovered.complete_terminal(
        _promoting_receipt("execution-1", planned.requested)
    )
    assert len(recovered.ledger.replay().terminal_outcomes) == 1
    assert replayed.state == recovered.state
    state = json.loads(recovered.state_path.read_text(encoding="utf-8"))
    assert state["state"] == "planning"


def test_r2_diverged_ledger_prefix_is_rejected(tmp_path):
    controller = _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started("execution-1")),
    )
    controller.plan(_observation(), _retrieval(), CURRENT_VALUES)
    snapshot = json.loads(controller.state_path.read_text(encoding="utf-8"))
    snapshot["ledger_event_count"] = snapshot["ledger_event_count"] + 5
    controller.state_path.write_text(json.dumps(snapshot), encoding="utf-8")
    with pytest.raises(OptimizationEpisodeControllerError, match="state hash"):
        OptimizationEpisodeController.recover(
            planner=_FakeCodex(_proposal),
            executor=_FakeEcc(),
            ledger=controller.ledger,
            clock=_Clock(),
            execution_context=_execution_context(),
        )


def test_attempted_probe_scope_ignores_budget_and_ledger_identity():
    """Only the parent configuration scopes a probe; nothing else re-opens it."""
    probe = AttemptedProbe(
        parent_config_sha256="sha256:" + "a" * 64,
        requested=RequestedKnobValue(knob_id="place.cell_padding_x", value=3),
    )
    other = AttemptedProbe(
        parent_config_sha256=probe.parent_config_sha256,
        requested=probe.requested,
    )
    assert probe == other
