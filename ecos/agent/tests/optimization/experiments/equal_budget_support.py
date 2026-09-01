import json
from pathlib import Path
from types import SimpleNamespace

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


def _load_experiment_runner():
    return knowledge_treatment_runner


def _load_experiment_execution():
    return knowledge_treatment_execution

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
