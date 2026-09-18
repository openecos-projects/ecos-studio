"""Projection and prompt-budget contracts for planner-facing history payloads."""

from __future__ import annotations

import json
from dataclasses import replace

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    CANDIDATE_EXECUTION_LIMIT,
    ExpectedEffectDirection,
    GateResult,
    HistoryReference,
    ObjectiveMetric,
    ObservationReference,
    OptimizationKnob,
    OptimizationOutcomeKind,
    ProposalAction,
    ProposalContextRef,
    RequestedKnobValue,
    ROUTABILITY_OBJECTIVE_ORDER,
    StrategyDirection,
    TIMING_GUARDRAIL_ORDER,
)
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.memory import (
    OptimizationTaskMemoryScope,
    OptimizationTaskMemorySnapshot,
    OptimizationTaskMemorySummary,
)
from ecos_agent.optimization.observation_contracts import (
    SignoffGates,
    TerminalObservation,
)
from ecos_agent.optimization.parameters.contracts import (
    NumericProposalActionV2,
    OptimizationProposalV2,
    ParameterApplicationReceipt,
)
from ecos_agent.optimization.planning import (
    OptimizationHistory,
    applied_divergence_summary,
    OptimizationPlanningContext,
    clamped_density_equivalent_error,
    optimization_history_payload,
    planning_context_payload,
    projected_terminal_observation,
)

HASH = "sha256:" + "a" * 64
# The observed per-corner scale of a real terminal observation: 24 unscoped
# entries plus 15 STA metric ids across 13 corners.
_FULL_CORNERS = tuple(f"corner-{index:02d}" for index in range(13))
_CORNERED_STA_IDS = (
    "sta_setup_violation_count", "sta_hold_violation_count",
    "sta_setup_wns", "sta_setup_tns", "sta_hold_wns", "sta_hold_tns",
    "sta_frequency", "sta_internal_power", "sta_leakage_power",
    "sta_dynamic_power", "sta_switching_power", "sta_typical_dynamic_power",
    "sta_typical_leakage_power", "sta_worst_dynamic_power",
    "sta_worst_leakage_power",
)
_UNSCOPED_IDS = (
    "drc_count", "lvs_count", "rcx_expected_corner_count", "rcx_spef_file_count",
    "rcx_missing_corner_count", "rcx_spef_parse_failure_count",
    "sta_corner_count", "sta_expected_corner_count", "sta_missing_corner_count",
    "sta_setup_violation_count", "sta_hold_violation_count",
    "harden_artifact_missing_count", "gui_overall_qor_score",
) + _CORNERED_STA_IDS[:0] + tuple(f"unscoped_report_{index}" for index in range(11))


def _metric(
    metric_id: str,
    value: float,
    *,
    corner: str | None = None,
    direction: EvaluationMetricDirection = EvaluationMetricDirection.LOWER_IS_BETTER,
    unit: str = "uW",
    category: EvaluationMetricCategory = EvaluationMetricCategory.CORNER_ROBUSTNESS,
    role: EvaluationMetricRole = EvaluationMetricRole.REPORT,
) -> TerminalEvaluationMetric:
    return TerminalEvaluationMetric(
        metric_id=metric_id,
        value=value,
        unit=unit,
        category=category,
        role=role,
        direction=direction,
        source_refs=("analysis/terminal.json",),
        corner=corner,
    )


def _terminal_observation(
    observation_id: str = "terminal-Harden",
    *,
    full_scale: bool = False,
    guardrail_value: float = -0.05,
) -> TerminalObservation:
    corners = _FULL_CORNERS if full_scale else ("corner-ff", "corner-ss", "corner-tt")
    evaluation = tuple(
        _metric(
            metric_id,
            1.0 if metric_id.endswith("_count") else 2.5,
            direction=EvaluationMetricDirection.EXACT,
            unit="count" if metric_id.endswith("_count") else "uW",
            category=EvaluationMetricCategory.ELIGIBILITY,
            role=EvaluationMetricRole.GATE,
        )
        for metric_id in _UNSCOPED_IDS
    )
    if full_scale:
        evaluation += tuple(
            _metric(metric_id, 0.5 + 0.01 * corner_index, corner=corner)
            for metric_id in _CORNERED_STA_IDS
            for corner_index, corner in enumerate(corners)
        )
    else:
        evaluation += (
            _metric("sta_setup_wns", -0.01, corner="corner-ss",
                    direction=EvaluationMetricDirection.HIGHER_IS_BETTER,
                    unit="ns"),
            _metric("sta_setup_wns", -0.05, corner="corner-tt",
                    direction=EvaluationMetricDirection.HIGHER_IS_BETTER,
                    unit="ns"),
            _metric("sta_setup_wns", -0.02, corner="corner-ff",
                    direction=EvaluationMetricDirection.HIGHER_IS_BETTER,
                    unit="ns"),
            _metric("sta_leakage_power", 0.03, corner="corner-ss"),
            _metric("sta_leakage_power", 0.01, corner="corner-tt"),
            _metric("sta_leakage_power", 0.02, corner="corner-ff"),
        )
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id=observation_id,
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={metric: 100.0 for metric in ROUTABILITY_OBJECTIVE_ORDER},
        timing_guardrail={
            metric: guardrail_value for metric in TIMING_GUARDRAIL_ORDER
        },
        evaluation_metrics=evaluation,
        evaluation_metrics_complete=True,
        sta_corner_ids=corners,
        sta_corner_set_sha256=canonical_sha256({"corners": list(corners)}),
    )


def _history_item(
    intervention_id: str,
    observation: TerminalObservation,
) -> OptimizationHistory:
    return OptimizationHistory(
        reference=HistoryReference(
            intervention_id=intervention_id, outcome_sha256=HASH
        ),
        outcome=OptimizationOutcomeKind.DEGRADED,
        action=ProposalAction(
            knob_id="place.target_density",
            direction=StrategyDirection.INCREASE,
            expected_effects=(
                {
                    "metric_id": ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
                    "direction": ExpectedEffectDirection.DECREASE,
                },
            ),
        ),
        requested=RequestedKnobValue(knob_id="place.target_density", value=0.8),
        terminal_observation=observation,
        decisive_metric="route_la_total_overflow",
        incumbent_decision="incumbent_retained",
    )


def _context(
    *,
    incumbent: TerminalObservation | None,
    trajectories: tuple[OptimizationHistory, ...],
) -> OptimizationPlanningContext:
    return OptimizationPlanningContext(
        context_ref=ProposalContextRef(
            episode_id="episode-projection",
            checkpoint_id="checkpoint-1",
            input_sha256=HASH,
        ),
        observation_ref=ObservationReference(observation_id="stage-1", sha256=HASH),
        incumbent=incumbent,
        history=trajectories[-6:],
        knowledge_refs=(),
        knowledge_chunks=(),
        parameter_trajectories=trajectories,
    )


def test_projection_keeps_decisive_metrics_gates_and_worst_corners():
    observation = _terminal_observation()
    incumbent = _terminal_observation(
        "terminal-incumbent", guardrail_value=-0.04
    )

    projection = projected_terminal_observation(observation, incumbent=incumbent)

    assert projection["schema_version"] == "ecos.terminal_observation.projection.v1"
    assert projection["unscoped_evaluation_metrics"] == {
        metric_id: (1.0 if metric_id.endswith("_count") else 2.5)
        for metric_id in _UNSCOPED_IDS
    }
    assert projection["worst_corner_metrics"]["sta_setup_wns"] == {
        "corner": "corner-tt", "value": -0.05,
    }
    assert projection["worst_corner_metrics"]["sta_leakage_power"] == {
        "corner": "corner-ss", "value": 0.03,
    }
    assert projection["metrics"] == {
        metric.value: 100.0 for metric in ROUTABILITY_OBJECTIVE_ORDER
    }
    assert projection["timing_guardrail"] == {
        metric.value: -0.05 for metric in TIMING_GUARDRAIL_ORDER
    }
    assert projection["delta_vs_incumbent"]["timing_guardrail"] == {
        metric.value: -0.01 for metric in TIMING_GUARDRAIL_ORDER
    }
    assert projection["delta_vs_incumbent"]["metrics"] == {
        metric.value: 0.0 for metric in ROUTABILITY_OBJECTIVE_ORDER
    }
    assert projection["sta_corner_count"] == 3
    assert projection["sta_corner_set_sha256"] == observation.sta_corner_set_sha256
    assert projection["evidence_manifest_sha256"] == observation.evidence_manifest_sha256
    assert projection["signoff_gates"]["drc_clean"] == "pass"
    assert "source_refs" not in json.dumps(projection)
    # Without a baseline there is nothing to delta against.
    assert "delta_vs_incumbent" not in projected_terminal_observation(observation)


def test_history_payload_renders_projection_and_keeps_outcome_binding():
    item = _history_item(
        "intervention-1", _terminal_observation(full_scale=True)
    )
    incumbent = _terminal_observation("terminal-incumbent")

    payload = optimization_history_payload(item, incumbent=incumbent)

    assert payload["reference"]["outcome_sha256"] == HASH
    assert payload["terminal_observation"]["schema_version"] == (
        "ecos.terminal_observation.projection.v1"
    )
    assert payload["terminal_observation"]["sta_corner_count"] == 13
    # 171 evaluation metrics collapse to 24 unscoped values plus 15 worst
    # corners; per-corner entries never reach the planner payload.
    assert len(payload["terminal_observation"]["worst_corner_metrics"]) == 15
    assert "evaluation_metrics" not in payload["terminal_observation"]


def test_planning_payload_renders_one_trajectory_list_only():
    context = _context(
        incumbent=_terminal_observation("terminal-incumbent"),
        trajectories=(
            _history_item("intervention-1", _terminal_observation()),
        ),
    )

    payload = planning_context_payload(context)

    assert "history" not in payload
    assert payload["incumbent"]["schema_version"] == (
        "ecos.terminal_observation.projection.v1"
    )
    assert "delta_vs_incumbent" not in payload["incumbent"]
    trajectory = payload["parameter_trajectories"][0]
    assert trajectory["terminal_observation"]["delta_vs_incumbent"][
        "timing_guardrail"
    ] == {metric.value: 0.0 for metric in TIMING_GUARDRAIL_ORDER}


def _qphys_observation(score: float, *, with_qphys: bool = True):
    observation = _terminal_observation()
    if not with_qphys:
        return observation
    return observation.model_copy(
        update={
            "evaluation_metrics": observation.evaluation_metrics
            + (
                _metric(
                    "qor_timing_quality",
                    70.0,
                    category=EvaluationMetricCategory.QOR,
                    direction=EvaluationMetricDirection.HIGHER_IS_BETTER,
                    unit="score",
                ),
                _metric(
                    "qor_summary_balanced",
                    score,
                    category=EvaluationMetricCategory.QOR,
                    direction=EvaluationMetricDirection.HIGHER_IS_BETTER,
                    unit="score",
                ),
            )
        }
    )


def test_projection_labels_qphys_scores_as_a_dedicated_section():
    observation = _qphys_observation(72.0)
    incumbent = _qphys_observation(70.5)
    legacy = _terminal_observation()

    projection = projected_terminal_observation(observation, incumbent=incumbent)

    assert projection["qphys_dimension_scores"] == {
        "qor_timing_quality": 70.0,
        "qor_summary_balanced": 72.0,
    }
    # GUI dimension scores keep their own section; the two families never mix.
    assert "gui_qor_dimension_routability_physical" not in projection[
        "qphys_dimension_scores"
    ]
    deltas = projection["delta_vs_incumbent"]["unscoped_evaluation_metrics"]
    assert deltas["qor_summary_balanced"] == 1.5
    assert deltas["qor_timing_quality"] == 0.0
    assert deltas["drc_count"] == 0.0
    # Keys missing on one side are structural changes, not deltas.
    assert not any(
        metric_id.startswith("qor_")
        for metric_id in projected_terminal_observation(
            observation, incumbent=legacy
        )["delta_vs_incumbent"]["unscoped_evaluation_metrics"]
    )
    # The dedicated section is labeling, not removal: the raw keys stay
    # available in the unscoped section.
    assert (
        projection["unscoped_evaluation_metrics"]["qor_summary_balanced"] == 72.0
    )


def test_planning_payload_stays_within_budget_for_a_full_episode():
    incumbent = _terminal_observation("terminal-incumbent", full_scale=True)
    trajectories = tuple(
        _history_item(
            f"intervention-{index}",
            _terminal_observation(f"terminal-{index}", full_scale=True),
        )
        for index in range(CANDIDATE_EXECUTION_LIMIT)
    )

    payload = planning_context_payload(
        _context(incumbent=incumbent, trajectories=trajectories)
    )
    size = len(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    )
    smaller = planning_context_payload(
        _context(incumbent=incumbent, trajectories=trajectories[:-1])
    )
    smaller_size = len(
        json.dumps(smaller, separators=(",", ":"), ensure_ascii=False).encode()
    )

    # The full 20-candidate budget must stay well inside a 256KB prompt, each
    # recorded outcome must add a bounded projected entry, not a full 44KB
    # terminal observation, and the out-of-window tail must collapse to
    # one-line summaries instead of growing the payload linearly.
    assert payload["parameter_trajectories_omitted"] == (
        CANDIDATE_EXECUTION_LIMIT - 8
    )
    assert size < 256 * 1024
    assert size - smaller_size < 8192


def test_planning_payload_windows_out_of_range_trajectories():
    trajectories = tuple(
        _history_item(
            f"intervention-{index}", _terminal_observation(f"terminal-{index}")
        )
        for index in range(10)
    )

    payload = planning_context_payload(
        _context(incumbent=None, trajectories=trajectories)
    )

    listed = payload["parameter_trajectories"]
    assert payload["parameter_trajectories_omitted"] == 2
    assert [item["intervention_id"] for item in listed[:2]] == [
        "intervention-0",
        "intervention-1",
    ]
    assert all(item["summary_only"] for item in listed[:2])
    assert listed[0]["outcome"] == OptimizationOutcomeKind.DEGRADED.value
    assert listed[0]["requested_value"] == 0.8
    assert all("summary_only" not in item for item in listed[2:])
    # The in-window tail keeps the full projection and evidence binding.
    assert listed[-1]["terminal_observation"]["schema_version"] == (
        "ecos.terminal_observation.projection.v1"
    )


def test_planning_payload_windows_task_memory_summaries():
    scope = OptimizationTaskMemoryScope.model_construct(
        workspace_manifest_sha256=HASH,
        design_id="gcd",
        checkpoint_id="place",
        episode_id="episode-1",
        objective_contract_sha256=HASH,
        scope_sha256=HASH,
    )
    snapshot = OptimizationTaskMemorySnapshot.model_construct(
        schema_version="ecos.optimization_task_memory_snapshot.v2",
        scope=scope,
        source_event_count=10,
        source_evidence_sha256=HASH,
        summaries=tuple(
            OptimizationTaskMemorySummary.model_construct() for _ in range(10)
        ),
        snapshot_sha256=HASH,
    )
    context = replace(
        _context(incumbent=None, trajectories=()), task_memory=snapshot
    )

    payload = planning_context_payload(context)

    memory = payload["task_memory"]
    assert memory["summaries_omitted"] == 4
    assert len(memory["summaries"]) == 6


def _receipt_with_floor(floor: float):
    return ParameterApplicationReceipt.model_construct(
        observation={"utilization_floor": floor}
    )


def _floor_context(current_values, *, floor, padding):
    item = replace(
        _history_item("intervention-1", _terminal_observation()),
        parameter_application_receipt=_receipt_with_floor(floor),
        planning_values={"place.cell_padding_x": padding},
    )
    return replace(
        _context(incumbent=None, trajectories=(item,)),
        current_values=current_values,
    )


def _clamped_density_error(current_values, requested_value, *, floor, padding):
    context = _floor_context(current_values, floor=floor, padding=padding)
    proposal = OptimizationProposalV2.model_construct(
        action=NumericProposalActionV2.model_construct(
            knob_id=OptimizationKnob.TARGET_DENSITY,
            requested_value=requested_value,
        )
    )
    return clamped_density_equivalent_error(proposal, context)


def test_clamp_guard_rejects_request_below_floor_matching_parent_state():
    error = _clamped_density_error(
        {"place.target_density": 0.45, "place.cell_padding_x": 400},
        0.35,
        floor=0.5196,
        padding=400,
    )

    assert error is not None
    assert "predetermined" in error
    assert "0.5196" in error


def test_clamp_guard_allows_value_above_floor():
    assert _clamped_density_error(
        {"place.target_density": 0.45, "place.cell_padding_x": 400},
        0.55,
        floor=0.5196,
        padding=400,
    ) is None


def test_clamp_guard_allows_real_density_drop_below_floor():
    # Parent already runs above the floor: clamping a low request to the
    # floor is a real density decrease, not a predetermined no-op.
    assert _clamped_density_error(
        {"place.target_density": 0.65, "place.cell_padding_x": 0},
        0.30,
        floor=0.372,
        padding=0,
    ) is None


def test_clamp_guard_ignores_floor_from_a_different_padding_context():
    assert _clamped_density_error(
        {"place.target_density": 0.45, "place.cell_padding_x": 400},
        0.35,
        floor=0.5196,
        padding=0,
    ) is None


def test_planning_payload_declares_measurement_stability():
    payload = planning_context_payload(
        _context(incumbent=None, trajectories=())
    )

    stability = payload["measurement_stability"]
    assert "pinned" in stability["protocol"]
    assert "reversal" in stability["planning_guidance"]


def test_applied_divergence_summary_marks_only_meaningful_gaps() -> None:
    adjusted = applied_divergence_summary(
        knob="place.target_density", requested=0.3, actual=0.4509
    )
    assert adjusted == {
        "knob": "place.target_density",
        "requested": 0.3,
        "actual": 0.4509,
        "adjusted": True,
    }
    # grid snap within the protection tolerance is not a divergence
    assert (
        applied_divergence_summary(
            knob="floorplan.aspect_ratio", requested=0.67, actual=0.6722
        )
        is None
    )
    # exact application stays unannotated
    assert (
        applied_divergence_summary(
            knob="place.target_density", requested=0.55, actual=0.55
        )
        is None
    )


def test_applied_divergence_summary_skips_non_numeric_knobs() -> None:
    assert (
        applied_divergence_summary(
            knob="place.routability_opt", requested=False, actual=False
        )
        is None
    )
    assert (
        applied_divergence_summary(
            knob="place.target_density", requested=0.3, actual=None
        )
        is None
    )
