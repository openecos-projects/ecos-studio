import pytest

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.optimization.contracts import (
    ObjectiveMetric, OptimizationObjectiveProposal, RequestedKnobValue,
)
from ecos_agent.optimization.controller import OptimizationEpisodeController, OptimizationEpisodeControllerError
from ecos_agent.optimization.geometry import GeometrySnapshot
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
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


def test_fixed_task_planning_only_exposes_primary_placement_layer(tmp_path):
    instance = controller(tmp_path)
    result = instance.plan(_observation(), _retrieval(), CURRENT_VALUES)
    assert result.requested.knob_id == "place.cell_padding_x"
    context = instance.planner.contexts[0]
    assert {d.knob_id for d in context.effective_domains} == {"place.target_density", "place.cell_padding_x"}
    assert context.parameter_policy["active_layer"] == "physical"
    assert instance.planning_stage(_observation(), CURRENT_VALUES) == "place"


def test_area_task_selects_floorplan_and_increase_only(tmp_path):
    instance = controller(tmp_path, goal=objective("降低面积", ObjectiveMetric.DIE_AREA),
                          planner=_FakeCodex(lambda ctx: _proposal(ctx, knob_id="floorplan.core_util", requested_value=0.7)))
    assert instance.planning_stage(_observation(), CURRENT_VALUES) == "Floorplan"
    observation = _observation().model_copy(update={"stage": ECCStepName.FLOORPLAN})
    result = instance.plan(observation, _retrieval(), CURRENT_VALUES)
    assert result.requested.knob_id == "floorplan.core_util"
    assert {a.direction.value for a in instance.planner.contexts[0].legal_actions} == {"increase"}


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
    with pytest.raises(OptimizationEpisodeControllerError, match="approved planning decision"):
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
