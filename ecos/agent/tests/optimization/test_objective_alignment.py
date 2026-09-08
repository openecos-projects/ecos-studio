from __future__ import annotations

from types import SimpleNamespace

import pytest

from tests.optimization.controller.support import _geometry, _native_receipt

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationOutcomeKind,
    OptimizationObjectiveProposal,
    RequestedKnobValue,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.objective_alignment import (
    ActiveOptimizationObjective,
    ObjectiveAlignmentError,
    build_active_objective,
    build_objective_alignment,
    validate_objective_alignment,
)
from ecos_agent.optimization.rules import (
    IncumbentDecision,
    IncumbentComparison,
    compare_incumbent,
    compare_recovery_incumbent,
    freeze_optimization_objective,
    freeze_routability_objective,
    terminal_candidate_is_promotable,
)

HASH = "sha256:" + "a" * 64
RECOVERY_IDS = (
    "drc_count",
    "sta_setup_violation_count",
    "sta_hold_violation_count",
)


def _objective():
    return freeze_optimization_objective(
        "reduce routed wirelength",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            rationale_summary="Reduce routed wirelength.",
        ),
    )


def _terminal(
    *,
    drc: int = 0,
    setup: int = 0,
    hold: int = 0,
    wirelength: float = 100,
    lvs: int = 0,
    drc_gate: GateResult | None = None,
) -> TerminalObservation:
    values = {
        "drc_count": drc,
        "lvs_count": lvs,
        "rcx_expected_corner_count": 1,
        "rcx_spef_file_count": 1,
        "rcx_missing_corner_count": 0,
        "rcx_spef_parse_failure_count": 0,
        "sta_corner_count": 1,
        "sta_expected_corner_count": 1,
        "sta_missing_corner_count": 0,
        "sta_setup_violation_count": setup,
        "sta_hold_violation_count": hold,
        "harden_artifact_missing_count": 0,
    }
    gates = SignoffGates(
        drc_clean=drc_gate or (GateResult.PASS if drc == 0 else GateResult.FAIL),
        lvs_clean=GateResult.PASS if lvs == 0 else GateResult.FAIL,
        rcx_corner_coverage=GateResult.PASS,
        rcx_spef_parse_health=GateResult.PASS,
        sta_setup_closed=GateResult.PASS if setup == 0 else GateResult.FAIL,
        sta_hold_closed=GateResult.PASS if hold == 0 else GateResult.FAIL,
        mpc_minimum_area=GateResult.NOT_APPLICABLE,
        mpc_maximum_area=GateResult.NOT_APPLICABLE,
    )
    return TerminalObservation(
        geometry=_geometry(),
        schema_version="ecos.terminal_observation.v3",
        observation_id="terminal-Harden",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=gates,
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: float(drc),
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 0,
            ObjectiveMetric.ROUTE_WIRELENGTH: wirelength,
        },
        timing_guardrail={metric: 0 for metric in TimingMetric},
        evaluation_metrics=tuple(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=value,
                unit="count",
                category=EvaluationMetricCategory.ELIGIBILITY,
                role=EvaluationMetricRole.GATE,
                direction=EvaluationMetricDirection.EXACT,
                source_refs=("analysis/terminal.json",),
            )
            for metric_id, value in values.items()
        ),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )


@pytest.mark.parametrize(
    ("counts", "active", "preserve", "stage"),
    (
        ((0, 0, 0), ObjectiveMetric.ROUTE_WIRELENGTH, (), "original"),
        ((4, 0, 0), ObjectiveMetric.DRC_COUNT, (ObjectiveMetric.STA_SETUP_VIOLATION_COUNT, ObjectiveMetric.STA_HOLD_VIOLATION_COUNT), "drc"),
        ((0, 3, 0), ObjectiveMetric.STA_SETUP_VIOLATION_COUNT, (ObjectiveMetric.DRC_COUNT, ObjectiveMetric.STA_HOLD_VIOLATION_COUNT), "setup"),
        ((0, 0, 2), ObjectiveMetric.STA_HOLD_VIOLATION_COUNT, (ObjectiveMetric.DRC_COUNT, ObjectiveMetric.STA_SETUP_VIOLATION_COUNT), "hold"),
        ((4, 3, 2), ObjectiveMetric.DRC_COUNT, (ObjectiveMetric.STA_SETUP_VIOLATION_COUNT, ObjectiveMetric.STA_HOLD_VIOLATION_COUNT), "drc"),
    ),
)
def test_alignment_uses_fixed_recovery_order(
    counts: tuple[int, int, int],
    active: ObjectiveMetric,
    preserve: tuple[ObjectiveMetric, ...],
    stage: str,
) -> None:
    objective = _objective()
    baseline = _terminal(drc=counts[0], setup=counts[1], hold=counts[2])

    alignment = build_objective_alignment(objective, baseline)
    state = build_active_objective(alignment, objective, baseline)

    assert state.active_primary_metric == active
    assert state.active_preserve_metrics == preserve
    assert state.recovery_stage == stage
    assert validate_objective_alignment(alignment, objective, baseline) == alignment


def test_alignment_rejects_nonrecoverable_or_contradictory_baseline() -> None:
    with pytest.raises(ObjectiveAlignmentError, match="non-recoverable"):
        build_objective_alignment(_objective(), _terminal(lvs=1))
    with pytest.raises(ObjectiveAlignmentError, match="contradicts"):
        build_objective_alignment(
            _objective(), _terminal(drc=2, drc_gate=GateResult.PASS)
        )
    terminal = _terminal()
    fractional = terminal.model_copy(
        update={
            "evaluation_metrics": tuple(
                item.model_copy(update={"value": 1.5})
                if item.metric_id == "drc_count"
                else item
                for item in terminal.evaluation_metrics
            )
        }
    )
    with pytest.raises(ObjectiveAlignmentError, match="count is invalid"):
        build_objective_alignment(_objective(), fractional)
    with pytest.raises(ObjectiveAlignmentError, match="incomplete"):
        build_objective_alignment(
            _objective(), terminal.model_copy(update={"evidence_valid": False})
        )
    with pytest.raises(ObjectiveAlignmentError, match="incomplete"):
        build_objective_alignment(
            _objective(), terminal.model_copy(update={"harden_artifacts_complete": False})
        )
    with pytest.raises(ObjectiveAlignmentError, match="incomplete"):
        build_objective_alignment(
            _objective(),
            terminal.model_copy(update={"evaluation_metrics": terminal.evaluation_metrics[:-1]}),
        )
    with pytest.raises(ObjectiveAlignmentError, match="non-recoverable"):
        build_objective_alignment(
            _objective(),
            terminal.model_copy(
                update={
                    "signoff_gates": terminal.signoff_gates.model_copy(
                        update={"mpc_minimum_area": GateResult.UNAVAILABLE}
                    )
                }
            ),
        )


def test_alignment_rejects_baseline_hash_drift() -> None:
    objective = _objective()
    alignment = build_objective_alignment(objective, _terminal(drc=3))

    with pytest.raises(ObjectiveAlignmentError, match="does not match"):
        validate_objective_alignment(alignment, objective, _terminal(drc=2))

    payload = alignment.model_dump(mode="json")
    payload["drc_count"] = 2
    with pytest.raises(ValueError, match="hash does not match"):
        type(alignment).model_validate(payload)


def test_active_objective_rejects_inconsistent_recovery_state() -> None:
    alignment = build_objective_alignment(_objective(), _terminal(drc=2))
    payload = build_active_objective(
        alignment, _objective(), _terminal(drc=2)
    ).model_dump(mode="json")
    payload["recovery_stage"] = "setup"

    with pytest.raises(ValueError, match="does not match violation counts"):
        ActiveOptimizationObjective.model_validate(payload)


def test_recovery_comparison_promotes_only_strict_protected_progress() -> None:
    incumbent = _terminal(drc=100, setup=2, hold=1, wirelength=100)
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    better = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=20, setup=2, hold=1, wirelength=120),
        alignment=alignment,
    )
    protected_regression = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=20, setup=3, hold=1, wirelength=80),
        alignment=alignment,
    )
    qor_only = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=100, setup=2, hold=1, wirelength=80),
        alignment=alignment,
        semantic_objective=objective,
        objective=freeze_routability_objective(incumbent, objective_alignment=alignment),
    )

    assert better.decision == IncumbentDecision.RECOVERY_PROGRESS
    assert better.decisive_metric == ObjectiveMetric.DRC_COUNT
    assert protected_regression.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert protected_regression.decisive_metric == ObjectiveMetric.STA_SETUP_VIOLATION_COUNT
    assert qor_only.decision == IncumbentDecision.PARITY_OBJECTIVE_IMPROVED
    assert qor_only.decisive_metric == ObjectiveMetric.ROUTE_WIRELENGTH


def test_recovery_accepts_same_violation_level_objective_improvement() -> None:
    """The historical candidate-3 shape: DRC 6->6, wirelength 5507.894->5486.556."""
    incumbent = _terminal(drc=6, setup=0, hold=0, wirelength=5507.894).model_copy(
        update={"timing_guardrail": {
            metric: (0.106 if metric == TimingMetric.STA_HOLD_WNS else 0.0)
            for metric in TimingMetric
        }}
    )
    candidate = _terminal(drc=6, setup=0, hold=0, wirelength=5486.556).model_copy(
        update={"timing_guardrail": {
            metric: (0.102 if metric == TimingMetric.STA_HOLD_WNS else 0.0)
            for metric in TimingMetric
        }}
    )
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=candidate,
        alignment=alignment,
        semantic_objective=objective,
        objective=freeze_routability_objective(incumbent, objective_alignment=alignment),
    )

    assert comparison.decision == IncumbentDecision.PARITY_OBJECTIVE_IMPROVED
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_WIRELENGTH
    assert build_active_objective(alignment, objective, candidate).recovery_stage == "drc"


def test_recovery_promotes_violation_drop_while_recording_objective_loss() -> None:
    incumbent = _terminal(drc=6, setup=0, hold=0, wirelength=5400)
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=4, setup=0, hold=0, wirelength=5600),
        alignment=alignment,
        semantic_objective=objective,
    )

    assert comparison.decision == IncumbentDecision.RECOVERY_PROGRESS
    assert comparison.decisive_metric == ObjectiveMetric.DRC_COUNT


@pytest.mark.parametrize(
    ("incumbent_setup", "incumbent_hold", "setup", "hold", "decisive"),
    (
        (0, 3, 0, 1, ObjectiveMetric.STA_HOLD_VIOLATION_COUNT),
        (3, 0, 1, 0, ObjectiveMetric.STA_SETUP_VIOLATION_COUNT),
    ),
)
def test_recovery_vector_improvement_on_lower_priority_metric_is_not_stage_progress(
    incumbent_setup: int,
    incumbent_hold: int,
    setup: int,
    hold: int,
    decisive: ObjectiveMetric,
) -> None:
    incumbent = _terminal(
        drc=6, setup=incumbent_setup, hold=incumbent_hold, wirelength=100
    )
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=6, setup=setup, hold=hold, wirelength=100),
        alignment=alignment,
        semantic_objective=objective,
    )

    assert comparison.decision == IncumbentDecision.RECOVERY_PROGRESS
    assert comparison.decisive_metric == decisive
    # The active DRC stage is unchanged by lower-priority vector progress.
    assert build_active_objective(
        alignment, objective, _terminal(drc=6, setup=setup, hold=hold)
    ).recovery_stage == "drc"


def test_recovery_rejects_wirelength_that_cannot_offset_drc_regression() -> None:
    incumbent = _terminal(drc=4, setup=0, hold=0, wirelength=5507.894)
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=8, setup=0, hold=0, wirelength=5000),
        alignment=alignment,
        semantic_objective=objective,
    )

    assert comparison.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert comparison.decisive_metric == ObjectiveMetric.DRC_COUNT


@pytest.mark.parametrize(
    ("wirelength", "decision", "decisive"),
    (
        (100.0, IncumbentDecision.EQUIVALENT, None),
        (120.0, IncumbentDecision.INCUMBENT_RETAINED, ObjectiveMetric.ROUTE_WIRELENGTH),
    ),
)
def test_recovery_parity_without_objective_gain_keeps_incumbent(
    wirelength: float, decision: IncumbentDecision, decisive: object
) -> None:
    incumbent = _terminal(drc=6, setup=0, hold=0, wirelength=100)
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=6, setup=0, hold=0, wirelength=wirelength),
        alignment=alignment,
        semantic_objective=objective,
    )

    assert comparison.decision == decision
    assert comparison.decisive_metric == decisive


@pytest.mark.parametrize(
    ("wirelength", "improved"),
    (
        (99.6, True),  # 0.4% gain: below the 1% protection tolerance, still promoted
        (99.9999999, False),  # representation-scale noise only
    ),
)
def test_recovery_primary_objective_uses_strict_not_protection_tolerance(
    wirelength: float, improved: bool
) -> None:
    incumbent = _terminal(drc=6, setup=0, hold=0, wirelength=100)
    objective = _objective()
    alignment = build_objective_alignment(objective, incumbent)

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=6, setup=0, hold=0, wirelength=wirelength),
        alignment=alignment,
        semantic_objective=objective,
    )

    assert comparison.decision == (
        IncumbentDecision.PARITY_OBJECTIVE_IMPROVED
        if improved
        else IncumbentDecision.EQUIVALENT
    )


def test_recovery_primary_metric_direction_and_violation_overlap() -> None:
    incumbent = _terminal(drc=3, setup=0, hold=0, wirelength=100).model_copy(
        update={"timing_guardrail": {
            metric: (0.5 if metric == TimingMetric.STA_SETUP_WNS else 0.0)
            for metric in TimingMetric
        }}
    )
    maximized = freeze_optimization_objective(
        "improve setup worst negative slack",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.STA_SETUP_WNS,
            rationale_summary="Improve setup slack.",
        ),
    )
    alignment = build_objective_alignment(maximized, incumbent)

    improved = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=3, setup=0, hold=0, wirelength=100).model_copy(
            update={"timing_guardrail": {
                metric: (0.6 if metric == TimingMetric.STA_SETUP_WNS else 0.0)
                for metric in TimingMetric
            }}
        ),
        alignment=alignment,
        semantic_objective=maximized,
    )
    regressed = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=3, setup=0, hold=0, wirelength=100).model_copy(
            update={"timing_guardrail": {
                metric: (0.4 if metric == TimingMetric.STA_SETUP_WNS else 0.0)
                for metric in TimingMetric
            }}
        ),
        alignment=alignment,
        semantic_objective=maximized,
    )
    drc_primary = freeze_optimization_objective(
        "reduce final drc count",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.DRC_COUNT,
            rationale_summary="Clear design rule violations.",
        ),
    )
    drc_alignment = build_objective_alignment(drc_primary, incumbent)
    overlapped = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=_terminal(drc=3, setup=0, hold=0, wirelength=80).model_copy(
            update={"timing_guardrail": incumbent.timing_guardrail}
        ),
        alignment=drc_alignment,
        semantic_objective=drc_primary,
    )

    assert improved.decision == IncumbentDecision.PARITY_OBJECTIVE_IMPROVED
    assert improved.decisive_metric == ObjectiveMetric.STA_SETUP_WNS
    assert regressed.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert regressed.decisive_metric == ObjectiveMetric.STA_SETUP_WNS
    assert overlapped.decision == IncumbentDecision.EQUIVALENT


def test_recovery_preserves_user_constraints_even_when_drc_improves() -> None:
    overflow_objective = freeze_optimization_objective(
        "reduce routed wirelength while preserving route overflow",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,),
            rationale_summary="Wirelength is primary; overflow stays bounded.",
        ),
    )
    incumbent = _terminal(drc=6, setup=0, hold=0, wirelength=100)
    incumbent.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] = 10
    alignment = build_objective_alignment(overflow_objective, incumbent)
    candidate = _terminal(drc=2, setup=0, hold=0, wirelength=95)
    candidate.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] = 30

    comparison = compare_recovery_incumbent(
        incumbent=incumbent,
        candidate=candidate,
        alignment=alignment,
        semantic_objective=overflow_objective,
        objective=freeze_routability_objective(
            incumbent, objective_alignment=alignment
        ),
    )

    assert comparison.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert comparison.decisive_metric == ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW


def test_recovery_tolerance_cannot_accumulate_past_frozen_protection() -> None:
    overflow_objective = freeze_optimization_objective(
        "reduce routed wirelength while preserving route overflow",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,),
            rationale_summary="Wirelength is primary; overflow stays bounded.",
        ),
    )
    baseline = _terminal(drc=6, setup=0, hold=0, wirelength=100)
    baseline.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] = 10000
    alignment = build_objective_alignment(overflow_objective, baseline)
    frozen = freeze_routability_objective(baseline, objective_alignment=alignment)

    # A tolerated single-step drift stays acceptable while it remains within
    # one tolerance of the frozen baseline ...
    drift = _terminal(drc=5, setup=0, hold=0, wirelength=99)
    drift.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] = 10090
    accepted = compare_recovery_incumbent(
        incumbent=baseline,
        candidate=drift,
        alignment=alignment,
        semantic_objective=overflow_objective,
        objective=frozen,
    )
    assert accepted.decision == IncumbentDecision.RECOVERY_PROGRESS

    # ... but a chain of such drifts must not cross the frozen protection floor.
    accumulated = _terminal(drc=4, setup=0, hold=0, wirelength=99)
    accumulated.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] = 10200
    rejected = compare_recovery_incumbent(
        incumbent=drift,
        candidate=accumulated,
        alignment=alignment,
        semantic_objective=overflow_objective,
        objective=frozen,
    )
    assert rejected.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert rejected.decisive_metric == ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW

    # Sub-tolerance steps must not accumulate either: 10090 -> 10170 is within
    # the adjacent tolerance yet 1.7% below the frozen baseline.
    creeping = _terminal(drc=3, setup=0, hold=0, wirelength=99)
    creeping.metrics[ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW] = 10170
    chained = compare_recovery_incumbent(
        incumbent=drift,
        candidate=creeping,
        alignment=alignment,
        semantic_objective=overflow_objective,
        objective=frozen,
    )
    assert chained.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert chained.decisive_metric == ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW


def test_alignment_freezes_the_acceptance_rule_and_refuses_old_episodes() -> None:
    objective = _objective()
    alignment = build_objective_alignment(objective, _terminal(drc=2))
    payload = alignment.model_dump(mode="json")

    assert payload["acceptance_rule"] == "ecos.incumbent_acceptance.v2"
    assert payload["protection_relative_tolerance"] == 0.01
    assert payload["protection_absolute_tolerance"] == 0.01
    assert payload["primary_metric_relative_tolerance"] == 1e-9

    # An episode persisted by the previous comparator lacks the frozen
    # acceptance fields and must stay read-only history.
    frozen_keys = {
        "acceptance_rule",
        "protection_relative_tolerance",
        "protection_absolute_tolerance",
        "primary_metric_relative_tolerance",
        "alignment_contract_sha256",
    }
    legacy = {
        key: value for key, value in payload.items() if key not in frozen_keys
    }
    legacy["alignment_contract_sha256"] = canonical_sha256(legacy)
    with pytest.raises(ValueError, match="hash does not match"):
        type(alignment).model_validate(legacy)

    # Tolerances are pinned to the code constants; drifted values are refused
    # even when the payload hash is recomputed.
    drifted = dict(payload)
    drifted["protection_relative_tolerance"] = 0.05
    drifted["alignment_contract_sha256"] = canonical_sha256(
        {
            key: value
            for key, value in drifted.items()
            if key != "alignment_contract_sha256"
        }
    )
    with pytest.raises(ValueError, match="tolerances do not match"):
        type(alignment).model_validate(drifted)


def test_alignment_does_not_exempt_ineligible_candidate_after_recovery() -> None:
    alignment = build_objective_alignment(_objective(), _terminal())

    assert not terminal_candidate_is_promotable(
        execution_outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        candidate=_terminal(drc=1),
        comparison=IncumbentComparison(
            IncumbentDecision.CANDIDATE_BETTER, ObjectiveMetric.DRC_COUNT
        ),
        requested=RequestedKnobValue(
            knob_id=OptimizationKnob.TARGET_DENSITY, value=0.65
        ),
        parameter_receipt=SimpleNamespace(
            application_status="applied",
            activation=SimpleNamespace(status="used"),
        ),
        objective_alignment=alignment,
        recovery_active=False,
    )


@pytest.mark.parametrize("counts", [dict(drc=2), dict(setup=2), dict(hold=2)])
@pytest.mark.parametrize("geometry_changed", [False, True])
def test_recovery_progress_still_requires_initial_geometry(counts, geometry_changed):
    from ecos_agent.optimization.rules import classify_terminal_candidate

    objective = _objective()
    baseline = _terminal(**counts)
    alignment = build_objective_alignment(objective, baseline)
    candidate = _terminal(**{key: 1 for key in counts})
    requested = RequestedKnobValue(knob_id=OptimizationKnob.TARGET_DENSITY, value=0.65)
    if geometry_changed:
        candidate = candidate.model_copy(update={"geometry": candidate.geometry.model_copy(
            update={"die_bbox": (0, 0, 1250, 800), "core_bbox": (100, 100, 1150, 700)},
        )})
    result = classify_terminal_candidate(
        execution_outcome=OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        candidate=candidate, incumbent=baseline,
        objective=freeze_routability_objective(baseline, objective_alignment=alignment),
        semantic_objective=objective, objective_alignment=alignment,
        baseline_geometry=baseline.geometry,
        requested=requested, parameter_receipt=_native_receipt(requested),
    )
    assert result.promote is not geometry_changed
    assert result.comparison.decision == (
        IncumbentDecision.CANDIDATE_INELIGIBLE if geometry_changed
        else IncumbentDecision.RECOVERY_PROGRESS
    )


@pytest.mark.parametrize("metric", tuple(TimingMetric))
@pytest.mark.parametrize("drop, accepted", [(0.005, True), (0.1, False)])
def test_recovery_keeps_timing_within_existing_tolerance(
    metric: TimingMetric, drop: float, accepted: bool,
) -> None:
    incumbent = _terminal(drc=9).model_copy(
        update={"timing_guardrail": {item: 1.0 for item in TimingMetric}}
    )
    candidate = _terminal(drc=0).model_copy(
        update={"timing_guardrail": {
            item: 1.0 - drop if item == metric else 1.0 for item in TimingMetric
        }}
    )
    alignment = build_objective_alignment(_objective(), incumbent)
    comparison = compare_recovery_incumbent(
        incumbent=incumbent, candidate=candidate, alignment=alignment
    )
    assert comparison.decision == (
        IncumbentDecision.RECOVERY_PROGRESS if accepted else IncumbentDecision.INCUMBENT_RETAINED
    )
    assert comparison.decisive_metric == (ObjectiveMetric.DRC_COUNT if accepted else metric)


def test_final_drc_recovery_returns_to_requested_wirelength() -> None:
    objective = freeze_optimization_objective(
        "reduce routed wirelength while preserving DRC and timing",
        OptimizationObjectiveProposal(
            primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
            preserve_metrics=(ObjectiveMetric.DRC_COUNT, ObjectiveMetric.STA_SETUP_WNS),
            rationale_summary="Reduce wirelength with DRC and timing protection.",
        ),
    )
    baseline = _terminal(drc=9)
    baseline.metrics[ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT] = 0
    alignment = build_objective_alignment(objective, baseline)
    assert build_active_objective(alignment, objective, baseline).active_primary_metric == ObjectiveMetric.DRC_COUNT
    recovered = build_active_objective(alignment, objective, _terminal())
    assert recovered.recovery_stage == "original"
    assert recovered.active_primary_metric == ObjectiveMetric.ROUTE_WIRELENGTH
    assert recovered.active_preserve_metrics == (ObjectiveMetric.DRC_COUNT,)
    for drc, expected in (
        (0, IncumbentDecision.CANDIDATE_BETTER),
        (1, IncumbentDecision.CANDIDATE_INELIGIBLE),
    ):
        comparison = compare_incumbent(
            incumbent=_terminal(),
            candidate=_terminal(drc=drc, wirelength=90),
            objective=freeze_routability_objective(_terminal()),
            semantic_objective=objective,
        )
        assert comparison.decision == expected
