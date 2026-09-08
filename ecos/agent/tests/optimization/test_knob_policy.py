from types import SimpleNamespace

from ecos_agent.optimization.contracts import LegalAction, ObjectiveMetric, OptimizationKnob
from ecos_agent.optimization.knob_policy import (
    SearchLayerSignal,
    allowed_knobs,
    history_layer_signal,
    select_search_actions,
)
from ecos_agent.optimization.rules import IncumbentDecision


def objective(metric=ObjectiveMetric.ROUTE_WIRELENGTH, *, geometry="fixed", advanced=False):
    return SimpleNamespace(primary_metric=metric, parameter_policy=SimpleNamespace(
        geometry_mode=geometry, advanced_parameters_enabled=advanced,
    ))


def actions():
    return tuple(LegalAction(knob_id=knob, direction=direction)
                 for knob in OptimizationKnob
                 for direction in (("enable",) if knob.value == "place.routability_opt"
                                   else ("increase", "decrease")))


def test_fixed_shape_excludes_floorplan_and_advanced():
    knobs = allowed_knobs(objective())
    assert not any(knob.value.startswith("floorplan.") for knob in knobs)
    assert OptimizationKnob.DENSITY_WEIGHT not in knobs
    layer, selected = select_search_actions(objective(), actions())
    # The layer is advisory: every task-permitted action stays selectable.
    assert layer == "physical"
    assert {item.knob_id for item in selected} == {
        OptimizationKnob.TARGET_DENSITY, OptimizationKnob.CELL_PADDING_X,
        OptimizationKnob.ROUTABILITY_OPT,
    }


def test_area_first_recommends_floorplan_area_with_increase_only_direction():
    layer, selected = select_search_actions(
        objective(ObjectiveMetric.DIE_AREA, geometry="variable"), actions(),
    )
    assert layer == "floorplan_area"
    assert [
        (item.knob_id.value, item.direction.value)
        for item in selected
        if item.knob_id == OptimizationKnob.FLOORPLAN_CORE_UTIL
    ] == [("floorplan.core_util", "increase")]
    # Other layers stay legal; only the recommendation leads with area.
    assert any(item.knob_id == OptimizationKnob.CELL_PADDING_X for item in selected)


def test_empty_area_direction_falls_through_without_empty_planning_turn():
    layer, selected = select_search_actions(
        objective(ObjectiveMetric.CORE_AREA, geometry="variable"),
        tuple(a for a in actions() if a.knob_id != OptimizationKnob.FLOORPLAN_CORE_UTIL),
    )
    assert layer == "physical" and selected


def test_feedback_retains_progressing_layer_and_advances_failed_layer():
    goal = objective(ObjectiveMetric.DIE_AREA, geometry="variable")
    history = ((OptimizationKnob.FLOORPLAN_CORE_UTIL, SearchLayerSignal.RETAIN),)
    assert select_search_actions(goal, actions(), history=history)[0] == "floorplan_area"
    history = ((OptimizationKnob.FLOORPLAN_CORE_UTIL, SearchLayerSignal.ADVANCE),)
    assert select_search_actions(goal, actions(), history=history)[0] == "physical"


def test_parity_objective_gain_does_not_retain_the_layer():
    # Wirelength-only improvement during recovery promotes the incumbent but is
    # not progress on the active recovery stage, so the search advances.
    goal = objective()
    history = ((OptimizationKnob.TARGET_DENSITY, SearchLayerSignal.ADVANCE),)
    assert (
        select_search_actions(
            goal, actions(), history=history, convergence_evidence=True
        )[0]
        == "convergence"
    )


def test_stage_change_resets_the_layer_basis():
    goal = objective(ObjectiveMetric.DIE_AREA, geometry="variable")
    history = ((OptimizationKnob.FLOORPLAN_ASPECT_RATIO, SearchLayerSignal.RESET),)
    layer, selected = select_search_actions(goal, actions(), history=history)
    assert layer == "floorplan_area"
    # All layers stay selectable; the reset only moves the recommendation
    # back to the area-first head of the advisory order.
    assert any(item.knob_id == OptimizationKnob.FLOORPLAN_ASPECT_RATIO for item in selected)


def test_layer_signal_uses_stage_identity_and_metric_change():
    # Current-stage progress retains the layer.
    assert history_layer_signal(
        incumbent_decision=IncumbentDecision.RECOVERY_PROGRESS,
        recovery_transition=None,
        active_stage="drc",
        active_primary="drc_count",
        decisive_metric="drc_count",
    ) is SearchLayerSignal.RETAIN
    # Lower-priority violation progress is promotion, not stage progress.
    assert history_layer_signal(
        incumbent_decision=IncumbentDecision.RECOVERY_PROGRESS,
        recovery_transition=None,
        active_stage="drc",
        active_primary="drc_count",
        decisive_metric="sta_hold_violation_count",
    ) is SearchLayerSignal.ADVANCE
    # Parity objective improvement promotes without resetting no-progress state.
    assert history_layer_signal(
        incumbent_decision=IncumbentDecision.PARITY_OBJECTIVE_IMPROVED,
        recovery_transition=None,
        active_stage="drc",
        active_primary="drc_count",
        decisive_metric="route_wirelength",
    ) is SearchLayerSignal.ADVANCE
    # Equivalent or degraded results advance per the existing order.
    assert history_layer_signal(
        incumbent_decision=IncumbentDecision.EQUIVALENT,
        recovery_transition=None,
        active_stage="drc",
        active_primary="drc_count",
        decisive_metric=None,
    ) is SearchLayerSignal.ADVANCE
    assert history_layer_signal(
        incumbent_decision=None,
        recovery_transition=None,
        active_stage="drc",
        active_primary="drc_count",
        decisive_metric=None,
    ) is SearchLayerSignal.ADVANCE
    # A recovery stage change clears the old stage layer basis.
    assert history_layer_signal(
        incumbent_decision=IncumbentDecision.RECOVERY_PROGRESS,
        recovery_transition="drc_to_setup",
        active_stage="drc",
        active_primary="drc_count",
        decisive_metric="drc_count",
    ) is SearchLayerSignal.RESET
    # Original-stage objective improvement may retain the layer.
    assert history_layer_signal(
        incumbent_decision=IncumbentDecision.CANDIDATE_BETTER,
        recovery_transition=None,
        active_stage="original",
        active_primary="route_wirelength",
        decisive_metric="route_wirelength",
    ) is SearchLayerSignal.RETAIN


def test_recovery_does_not_unlock_geometry_or_advanced():
    goal = objective(ObjectiveMetric.DIE_AREA, geometry="fixed")
    layer, selected = select_search_actions(goal, actions(), recovering=True)
    assert layer == "physical"
    assert all(a.knob_id in allowed_knobs(goal) for a in selected)


def test_advanced_requires_opt_in_and_old_contract_is_not_authority():
    assert OptimizationKnob.DENSITY_WEIGHT in allowed_knobs(objective(advanced=True))
    assert allowed_knobs(SimpleNamespace(parameter_policy=None)) == ()
    assert select_search_actions(SimpleNamespace(parameter_policy=None), actions()) == ("unavailable", ())


def test_convergence_requires_density_overflow_evidence():
    from ecos_agent.optimization.knob_policy import policy_payload
    history = ((OptimizationKnob.TARGET_DENSITY, "degraded"),)
    assert select_search_actions(objective(), actions(), history=history)[0] == "strategy"
    assert select_search_actions(
        objective(), actions(), history=history, convergence_evidence=True,
    )[0] == "convergence"
    target = next(item for item in policy_payload(objective(), "strategy")["knobs"]
                  if item["knob_id"] == "place.target_overflow")
    assert target["enabled"] is False
    assert target["disabled_reason"] == "placement_convergence_evidence_unavailable"


def test_routing_overflow_and_threshold_alone_do_not_unlock_convergence():
    from ecos_agent.optimization.controller_context import ControllerContextMixin
    from ecos_agent.optimization.contracts import StageEvidenceFeature
    from tests.optimization.controller.support import HASH, _observation

    for feature_id, value, ref in (
        ("overflow_map", True, "place_dreamplace/feature/egr_congestion_map/place_egr_union_overflow.csv"),
        ("stop_overflow", 0.1, "analysis/parameter_runtime_report.v2.json"),
        ("place_final_density_overflow", 0.1, "route_ecc/analysis/qor_hotspots.json#/hotspots/0"),
        ("place_final_density_overflow", -1, "analysis/parameter_runtime_report.v2.json"),
    ):
        observation = _observation().model_copy(update={"state_evidence": (StageEvidenceFeature(
            feature_id=feature_id, value=value, evidence_ref=ref, evidence_sha256=HASH,
        ),)})
        assert not ControllerContextMixin._has_convergence_evidence(observation)
