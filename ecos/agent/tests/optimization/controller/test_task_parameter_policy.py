import pytest

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.optimization.contracts import (
    GateResult, ObjectiveMetric, OptimizationObjectiveProposal, RequestedKnobValue,
)
from ecos_agent.optimization.controller import OptimizationEpisodeController, OptimizationEpisodeControllerError
from ecos_agent.optimization.geometry import GeometrySnapshot
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.objective_alignment import build_objective_alignment
from ecos_agent.optimization.parameters.effective_domain import build_context_fingerprint
from ecos_agent.optimization.rules import freeze_optimization_objective
from .support import (
    HASH, CURRENT_VALUES, _Clock, _FakeCodex, _FakeEcc, _controller,
    _eligible_terminal, _execution_context, _observation, _proposal, _retrieval, _started,
)


def geometry():
    return GeometrySnapshot(dbu_per_micron=1000, die_bbox=(0, 0, 1000, 1000),
                            core_bbox=(100, 100, 900, 900),
                            evidence_refs=("filler_ecc/output/geometry/geometry.manifest",),
                            evidence_sha256=HASH)


def objective(goal="保持面积不变，降低线长", metric=ObjectiveMetric.ROUTE_WIRELENGTH):
    return freeze_optimization_objective(goal, OptimizationObjectiveProposal(
        primary_metric=metric, rationale_summary="Task constraint test.",
    ))


def controller(tmp_path, *, goal=None, planner=None, executor=None):
    return _controller(tmp_path, planner or _FakeCodex(_proposal), executor or _FakeEcc(_started()),
                       objective=goal or objective(),
                       incumbent=_eligible_terminal().model_copy(update={"geometry": geometry()}))


def test_fixed_task_exposes_every_permitted_layer_with_advisory_priority(tmp_path):
    instance = controller(tmp_path)
    result = instance.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert result.requested.knob_id == "place.cell_padding_x"
    context = instance.planner.contexts[0]
    # Every task-permitted knob stays selectable; the rotation only advises.
    assert {d.knob_id for d in context.effective_domains} == {
        "place.target_density", "place.target_overflow",
        "place.cell_padding_x", "place.routability_opt",
    }
    assert {a.knob_id for a in context.legal_actions} == {
        "place.target_density", "place.cell_padding_x", "place.routability_opt",
    }
    assert context.parameter_policy["active_layer"] == "physical"
    assert context.parameter_policy["layer_priority_is_advisory"] is True
    assert instance.planning_stage(_observation(), CURRENT_VALUES) == "place"


def test_area_task_recommends_floorplan_and_keeps_increase_only_policy(tmp_path):
    instance = controller(tmp_path, goal=objective("降低面积", ObjectiveMetric.DIE_AREA),
                          planner=_FakeCodex(lambda ctx: _proposal(ctx, knob_id="floorplan.core_util", requested_value=0.7)))
    assert instance.planning_stage(_observation(), CURRENT_VALUES) == "Floorplan"
    observation = _observation().model_copy(update={"stage": ECCStepName.FLOORPLAN})
    result = instance.plan(observation, _retrieval(), CURRENT_VALUES)
    assert result.requested.knob_id == "floorplan.core_util"
    legal = instance.planner.contexts[0].legal_actions
    assert {
        a.direction.value for a in legal if a.knob_id == "floorplan.core_util"
    } == {"increase"}


@pytest.mark.parametrize("knob,value", [
    ("floorplan.core_util", 0.7), ("floorplan.aspect_ratio", 1.2),
    ("place.density_weight", 0.001),
])
def test_forged_request_never_reaches_executor(tmp_path, knob, value):
    instance = controller(tmp_path)
    instance.plan(_observation(), _retrieval(), CURRENT_VALUES)
    instance._requested = RequestedKnobValue(knob_id=knob, value=value)
    with pytest.raises(OptimizationEpisodeControllerError, match="forbidden"):
        instance.execute()
    assert instance.executor.start_calls == []


def test_changed_exact_value_never_reaches_executor(tmp_path):
    instance = controller(tmp_path)
    instance.plan(_observation(), _retrieval(), CURRENT_VALUES)
    instance._requested = RequestedKnobValue(knob_id="place.cell_padding_x", value=4)
    with pytest.raises(OptimizationEpisodeControllerError, match="execution request"):
        instance.execute()
    assert instance.executor.start_calls == []


def test_recovery_retains_initial_geometry_and_policy(tmp_path):
    instance = controller(tmp_path)
    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal), executor=_FakeEcc(), ledger=instance.ledger,
        clock=_Clock(), execution_context=_execution_context(),
    )
    assert recovered.baseline_geometry == geometry()
    assert recovered.objective.parameter_policy.geometry_mode == "fixed"
    changed = _eligible_terminal().model_copy(update={"geometry": geometry().model_copy(update={"die_bbox": (0, 0, 2000, 1000)})})
    with pytest.raises(OptimizationEpisodeControllerError, match="geometry"):
        recovered.promote_incumbent(changed)
    assert recovered.incumbent == instance.incumbent


def _recovery_terminal(*, drc=6, wirelength=100.0, overflow=0):
    terminal = _eligible_terminal().model_copy(update={"geometry": geometry()})
    return terminal.model_copy(update={
        "evaluation_metrics": tuple(
            item.model_copy(update={"value": drc})
            if item.metric_id == "drc_count" else item
            for item in terminal.evaluation_metrics
        ),
        "signoff_gates": terminal.signoff_gates.model_copy(
            update={"drc_clean": GateResult.PASS if drc == 0 else GateResult.FAIL}
        ),
        "metrics": {
            **terminal.metrics,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: overflow,
        },
    })


def _preserved_objective():
    return freeze_optimization_objective(
        "降低线长并保持布线溢出",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,),
            rationale_summary="Promotion keeps the frozen overflow envelope.",
        ),
    )


def _recovery_controller(tmp_path, baseline, *, goal):
    return _controller(
        tmp_path, _FakeCodex(_proposal), _FakeEcc(_started()),
        objective=goal, incumbent=baseline,
        objective_alignment=build_objective_alignment(goal, baseline),
    )


def test_promote_incumbent_accepts_parity_objective_gain_in_recovery(tmp_path):
    baseline = _recovery_terminal(drc=6, wirelength=100.0)
    instance = _recovery_controller(tmp_path, baseline, goal=_preserved_objective())
    parity = _recovery_terminal(drc=6, wirelength=95.0)

    instance.promote_incumbent(parity)

    assert instance.incumbent == parity


def test_promote_incumbent_enforces_frozen_protection_envelope(tmp_path):
    baseline = _recovery_terminal(drc=6, wirelength=100.0, overflow=10000)
    instance = _recovery_controller(tmp_path, baseline, goal=_preserved_objective())
    drift = _recovery_terminal(drc=5, wirelength=100.0, overflow=10090)
    instance.promote_incumbent(drift)

    # Sub-tolerance against the adjacent incumbent, yet 1.7% below the frozen
    # baseline: the promote entry must reject it exactly like classification.
    creeping = _recovery_terminal(drc=4, wirelength=100.0, overflow=10170)
    with pytest.raises(OptimizationEpisodeControllerError, match="not eligible"):
        instance.promote_incumbent(creeping)
    assert instance.incumbent == drift


def test_recovered_controller_keeps_frozen_protection_envelope(tmp_path):
    baseline = _recovery_terminal(drc=6, wirelength=100.0, overflow=10000)
    instance = _recovery_controller(tmp_path, baseline, goal=_preserved_objective())
    drift = _recovery_terminal(drc=5, wirelength=100.0, overflow=10090)
    instance.promote_incumbent(drift)

    recovered = OptimizationEpisodeController.recover(
        planner=_FakeCodex(_proposal), executor=_FakeEcc(), ledger=instance.ledger,
        clock=_Clock(), execution_context=_execution_context(),
    )
    assert recovered.incumbent == drift
    creeping = _recovery_terminal(drc=4, wirelength=100.0, overflow=10170)
    with pytest.raises(OptimizationEpisodeControllerError, match="not eligible"):
        recovered.promote_incumbent(creeping)
    assert recovered.incumbent == drift


def test_constraint_rejection_overrides_claimed_improvement_in_ledger(tmp_path):
    from ecos_agent.optimization.execution import CandidateExecutionReceipt
    from .support import _native_receipt
    instance = controller(tmp_path)
    planned = instance.plan(_observation(), _retrieval(), CURRENT_VALUES)
    instance.execute()
    changed = _eligible_terminal().model_copy(update={"geometry": None})
    instance.complete_terminal(CandidateExecutionReceipt(
        execution_id="execution-1", started=True,
        outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        parameter_application_receipt=_native_receipt(planned.requested),
    ), changed, outcome=OptimizationOutcomeKind.IMPROVED, incumbent_decision="candidate_better")
    outcome = instance.ledger.replay().terminal_outcomes[-1]
    assert outcome.outcome == OptimizationOutcomeKind.CANDIDATE_INELIGIBLE
    assert "geometry" in outcome.constraint_violation
    assert instance.incumbent.geometry == geometry()


def test_policy_context_changes_effective_domain_binding(tmp_path):
    instance = controller(tmp_path)
    context = instance._effective_domain_context(_observation(), CURRENT_VALUES, RequestedKnobValue(knob_id="place.target_density", value=0.5).knob_id, "test", "ratio", HASH)
    context["tool_source_sha256"] = HASH
    first = build_context_fingerprint(context)
    context["parameter_policy_sha256"] = "sha256:" + "b" * 64
    assert build_context_fingerprint(context) != first
