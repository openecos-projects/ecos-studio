from pathlib import Path

import pytest

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    SignoffGates,
    TerminalObservation,
    TimingMetric,
)
from ecos_agent.optimization.experiments.equal_budget import (
    CandidateTrace,
    EqualBudgetConfig,
    _candidate_resources,
    build_candidate_trace,
    evaluate_equal_budget,
)
from ecos_agent.optimization.experiments import knowledge_treatment_runner
from ecos_agent.optimization.experiments import knowledge_treatment_execution
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
)
from ecos_agent.optimization.parameters.contracts import (
    ActivationEvidence,
    EffectiveValue,
    MaterializationRef,
    ParameterApplicationReceipt,
    ToolRef,
)

HASH = "sha256:" + "a" * 64


def test_candidate_resources_fail_closed_without_flow_evidence(tmp_path: Path) -> None:
    candidate = tmp_path / ".agent/candidates/candidate-1"
    candidate.mkdir(parents=True)

    with pytest.raises(ValueError, match="candidate resource evidence"):
        _candidate_resources(
            tmp_path,
            ".agent/candidates/candidate-1",
            "place",
        )


def _load_experiment_runner():
    return knowledge_treatment_runner


def _load_experiment_execution():
    return knowledge_treatment_execution


def test_equal_budget_counts_receipts_and_aliases() -> None:
    traces = [
        CandidateTrace(
            design_id="gcd",
            candidate_id="c1",
            started=True,
            planning_mode="receipt-aware",
            terminal_success=True,
            terminal_utility=10.0,
            activation_status="used",
            application_signature="a1",
            response_signature="r1",
            alias=True,
            alias_valid=True,
            proposal_outcome="repair",
            runtime_seconds=2.0,
            peak_memory_mb=4.0,
        ),
        CandidateTrace(
            design_id="gcd",
            candidate_id="c2",
            started=True,
            planning_mode="receipt-aware",
            terminal_success=False,
            activation_status="not_activated",
            application_signature="a2",
            response_signature="r2",
            receipt_status="missing",
            proposal_outcome="reject",
            runtime_seconds=3.0,
            peak_memory_mb=8.0,
        ),
        CandidateTrace(
            design_id="gcd",
            candidate_id="c3",
            started=False,
            planning_mode="receipt-aware",
            terminal_success=False,
            alias=True,
            alias_valid=False,
        ),
    ]
    summary = evaluate_equal_budget(
        traces,
        mode="receipt-aware",
        config=EqualBudgetConfig(reference_runtime_seconds=2.0),
        planning_calls=3,
    )
    assert summary.started_candidates == 2
    assert summary.terminal_successes == 1
    assert summary.aliases_saved == 1
    assert summary.wrong_prunes == 1
    assert summary.alias_unassessed == 0
    assert summary.not_activated == 1
    assert summary.overridden_rate == 0.0
    assert summary.ignored_rate == 0.0
    assert summary.not_activated_rate == 0.5
    assert summary.receipt_missing == 1
    assert summary.wall_time_limit_seconds == 44.0
    assert summary.peak_memory_mb == 8.0


def test_requested_only_does_not_claim_alias_savings() -> None:
    trace = CandidateTrace(
        design_id="gcd",
        candidate_id="c1",
        started=False,
        terminal_success=False,
        planning_mode="requested-only",
        alias=True,
    )
    summary = evaluate_equal_budget([trace], mode="requested-only")
    assert summary.aliases_saved == 0
    assert summary.wrong_prunes == 0


def test_receipt_aware_does_not_claim_unverified_aliases() -> None:
    trace = CandidateTrace(
        design_id="gcd",
        candidate_id="c1",
        started=False,
        terminal_success=False,
        planning_mode="receipt-aware",
        alias=True,
    )

    summary = evaluate_equal_budget([trace], mode="receipt-aware")

    assert summary.aliases_saved == 0
    assert summary.wrong_prunes == 0
    assert summary.alias_unassessed == 1


def test_equal_budget_reports_terminal_metrics_and_regret() -> None:
    summary = evaluate_equal_budget(
        [
            CandidateTrace(
                design_id="gcd",
                candidate_id="c1",
                started=True,
                planning_mode="receipt-aware",
                terminal_success=True,
                terminal_utility=8.0,
                reference_utility=10.0,
                ppa=1.2,
                area=12.0,
                dynamic_power=2.5,
                leakage_power=0.4,
                frequency=100.0,
                drc=0.0,
                timing=-0.1,
                congestion=0.3,
            )
        ],
        mode="receipt-aware",
    )
    assert summary.simple_regret == 2.0
    assert summary.ppa == (1.2,)
    assert summary.area == (12.0,)
    assert summary.dynamic_power == (2.5,)
    assert summary.leakage_power == (0.4,)
    assert summary.frequency == (100.0,)
    assert summary.drc == (0.0,)
    assert summary.timing == (-0.1,)
    assert summary.congestion == (0.3,)


def test_equal_budget_computes_simple_regret_per_design() -> None:
    traces = [
        CandidateTrace(
            design_id="d0",
            candidate_id="c0",
            started=True,
            terminal_success=True,
            planning_mode="requested-only",
            terminal_utility=8.0,
            reference_utility=10.0,
        ),
        CandidateTrace(
            design_id="d1",
            candidate_id="c1",
            started=True,
            terminal_success=True,
            planning_mode="requested-only",
            terminal_utility=90.0,
            reference_utility=100.0,
        ),
    ]

    summary = evaluate_equal_budget(traces, mode="requested-only")

    assert summary.simple_regret_by_design == {"d0": 2.0, "d1": 10.0}
    assert summary.simple_regret == 6.0


def test_build_candidate_trace_uses_native_receipt_and_terminal_metrics() -> None:
    receipt_payload = {
        "receipt_id": "receipt-1",
        "tool": ToolRef(name="DREAMPlace", revision="bound"),
        "context": {"stage": "place"},
        "requested": {
            "knob_id": "place.target_density",
            "value": 0.2,
            "unit": "ratio",
        },
        "materialization": MaterializationRef(
            receipt_ref="analysis/candidate_materialization.v1.json",
            receipt_sha256=HASH,
            registry_sha256=HASH,
            patch_sha256=HASH,
            candidate_ref="candidate-1",
            workspace_ref="candidate-1",
            config_before_sha256=HASH,
            config_after_sha256=HASH,
            written_value=0.2,
            unit="ratio",
        ),
        "effective_initial": EffectiveValue(value=0.8, unit="ratio"),
        "transitions": (),
        "application_status": "applied",
        "activation": ActivationEvidence(
            status="used",
            consumers=(
                {
                    "consumer_id": "dreamplace.density_objective",
                    "outcome": "entered",
                    "evidence_ref": "analysis/parameter_runtime_report.v1.json",
                    "evidence_sha256": HASH,
                },
            ),
        ),
        "effective_final": EffectiveValue(value=0.8, unit="ratio"),
    }
    receipt = ParameterApplicationReceipt.model_construct(
        **receipt_payload,
        evidence_sha256=HASH,
    )
    terminal = _terminal_observation()
    reference = terminal.model_copy(
        update={
            "observation_id": "reference",
            "metrics": {
                **terminal.metrics,
                ObjectiveMetric.ROUTE_WIRELENGTH: 5.0,
            },
        }
    )

    trace = build_candidate_trace(
        design_id="gcd",
        candidate_id="episode-1.intervention-1",
        planning_mode="receipt-aware",
        outcome=OptimizationOutcomeKind.IMPROVED,
        receipt=receipt,
        terminal_observation=terminal,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        runtime_seconds=12.0,
        peak_memory_mb=64.0,
    )

    assert trace.terminal_success is True
    assert trace.terminal_utility == -4.0
    assert trace.reference_utility == -5.0
    assert trace.area == 12.0
    assert trace.dynamic_power == 2.5
    assert trace.leakage_power == 0.4
    assert trace.frequency == 100.0
    assert trace.drc == 0.0
    assert trace.timing == 0.0
    assert trace.congestion == 3.0
    assert trace.activation_status == "used"
    assert trace.application_signature is not None
    assert trace.response_signature is not None
    assert trace.receipt_status == "ok"


def test_candidate_ineligible_is_not_a_terminal_success() -> None:
    terminal = _terminal_observation()

    trace = build_candidate_trace(
        design_id="gcd",
        candidate_id="episode-1.intervention-1",
        planning_mode="receipt-aware",
        outcome=OptimizationOutcomeKind.CANDIDATE_INELIGIBLE,
        receipt=None,
        terminal_observation=terminal,
        reference_observation=terminal,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        runtime_seconds=12.0,
        peak_memory_mb=64.0,
    )

    assert trace.terminal_success is False
    assert trace.terminal_utility is None


def test_candidate_trace_uses_area_objective_utility() -> None:
    terminal = _terminal_observation()
    reference = terminal.model_copy(
        update={
            "observation_id": "reference",
            "evaluation_metrics": tuple(
                item.model_copy(update={"value": 15.0})
                if item.metric_id == "sta_standard_cell_area"
                else item
                for item in terminal.evaluation_metrics
            ),
        }
    )

    trace = build_candidate_trace(
        design_id="gcd",
        candidate_id="episode-1.intervention-1",
        planning_mode="receipt-aware",
        outcome=OptimizationOutcomeKind.IMPROVED,
        receipt=None,
        terminal_observation=terminal,
        reference_observation=reference,
        objective_metric=ObjectiveMetric.STA_STANDARD_CELL_AREA,
        runtime_seconds=12.0,
        peak_memory_mb=64.0,
    )

    assert trace.terminal_utility == -12.0
    assert trace.reference_utility == -15.0


def test_infeasible_is_not_a_terminal_success() -> None:
    terminal = _terminal_observation()

    trace = build_candidate_trace(
        design_id="gcd",
        candidate_id="episode-1.intervention-1",
        planning_mode="receipt-aware",
        outcome=OptimizationOutcomeKind.INFEASIBLE,
        receipt=None,
        terminal_observation=terminal,
        reference_observation=terminal,
        objective_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        runtime_seconds=12.0,
        peak_memory_mb=64.0,
    )

    assert trace.terminal_success is False
    assert trace.terminal_utility is None


def _terminal_observation() -> TerminalObservation:
    eligibility_ids = (
        "drc_count",
        "lvs_count",
        "rcx_expected_corner_count",
        "rcx_spef_file_count",
        "rcx_missing_corner_count",
        "rcx_spef_parse_failure_count",
        "sta_corner_count",
        "sta_expected_corner_count",
        "sta_missing_corner_count",
        "sta_setup_violation_count",
        "sta_hold_violation_count",
        "harden_artifact_missing_count",
    )
    evaluation = [
        TerminalEvaluationMetric(
            metric_id=metric_id,
            value=(
                1.0
                if metric_id
                in {
                    "rcx_expected_corner_count",
                    "rcx_spef_file_count",
                    "sta_corner_count",
                    "sta_expected_corner_count",
                }
                else 0.0
            ),
            unit="count",
            category=EvaluationMetricCategory.ELIGIBILITY,
            role=EvaluationMetricRole.GATE,
            direction=EvaluationMetricDirection.EXACT,
            source_refs=("analysis/terminal.json",),
        )
        for metric_id in eligibility_ids
    ]
    for metric_id, value, unit in (
        ("sta_standard_cell_area", 12.0, "um^2"),
        ("sta_typical_dynamic_power", 2.5, "uW"),
        ("sta_typical_leakage_power", 0.4, "uW"),
        ("sta_frequency", 100.0, "MHz"),
    ):
        evaluation.append(
            TerminalEvaluationMetric(
                metric_id=metric_id,
                value=value,
                unit=unit,
                category=EvaluationMetricCategory.PPA,
                role=EvaluationMetricRole.REPORT,
                direction=EvaluationMetricDirection.LOWER_IS_BETTER,
                source_refs=("analysis/terminal.json",),
            )
        )
    return TerminalObservation(
        schema_version="ecos.terminal_observation.v3",
        observation_id="candidate",
        evidence_manifest_sha256=HASH,
        evidence_valid=True,
        harden_artifacts_complete=True,
        signoff_gates=SignoffGates.all(GateResult.PASS),
        metrics={
            ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT: 2.0,
            ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW: 3.0,
            ObjectiveMetric.ROUTE_WIRELENGTH: 4.0,
        },
        timing_guardrail={metric: 0.0 for metric in TimingMetric},
        evaluation_metrics=tuple(evaluation),
        evaluation_metrics_complete=True,
        sta_corner_ids=("typical",),
        sta_corner_set_sha256=canonical_sha256({"corners": ["typical"]}),
    )
