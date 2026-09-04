from __future__ import annotations

from types import SimpleNamespace

import pytest

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
    compare_recovery_incumbent,
    freeze_optimization_objective,
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
    )

    assert better.decision == IncumbentDecision.CANDIDATE_BETTER
    assert better.decisive_metric == ObjectiveMetric.DRC_COUNT
    assert protected_regression.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert protected_regression.decisive_metric == ObjectiveMetric.STA_SETUP_VIOLATION_COUNT
    assert qor_only.decision == IncumbentDecision.INCUMBENT_RETAINED
    assert qor_only.decisive_metric == ObjectiveMetric.DRC_COUNT


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
