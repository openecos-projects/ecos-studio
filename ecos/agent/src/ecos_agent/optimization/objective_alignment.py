"""Deterministic binding between a user objective and baseline feasibility."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    GateResult,
    ObjectiveMetric,
    OptimizationObjectiveContract,
    TerminalObservation,
)
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
)

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
RECOVERY_ORDER = (
    ObjectiveMetric.DRC_COUNT,
    ObjectiveMetric.STA_SETUP_VIOLATION_COUNT,
    ObjectiveMetric.STA_HOLD_VIOLATION_COUNT,
)
_RECOVERY_GATES = {
    ObjectiveMetric.DRC_COUNT: "drc_clean",
    ObjectiveMetric.STA_SETUP_VIOLATION_COUNT: "sta_setup_closed",
    ObjectiveMetric.STA_HOLD_VIOLATION_COUNT: "sta_hold_closed",
}
_ELIGIBILITY_IDS = (
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


class ObjectiveAlignmentError(ValueError):
    """A baseline cannot safely authorize objective recovery."""


class OptimizationObjectiveAlignment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.optimization_objective_alignment.v1"] = (
        "ecos.optimization_objective_alignment.v1"
    )
    objective_contract_sha256: str
    baseline_terminal_observation_sha256: str
    drc_count: StrictInt = Field(ge=0)
    sta_setup_violation_count: StrictInt = Field(ge=0)
    sta_hold_violation_count: StrictInt = Field(ge=0)
    recovery_order: tuple[ObjectiveMetric, ...]
    alignment_contract_sha256: str

    @field_validator(
        "objective_contract_sha256",
        "baseline_terminal_observation_sha256",
        "alignment_contract_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("objective alignment hash is invalid")
        return value

    @field_validator("recovery_order")
    @classmethod
    def validate_recovery_order(
        cls, value: tuple[ObjectiveMetric, ...]
    ) -> tuple[ObjectiveMetric, ...]:
        if value != RECOVERY_ORDER:
            raise ValueError("objective recovery order is invalid")
        return value

    @model_validator(mode="after")
    def validate_contract_hash(self) -> "OptimizationObjectiveAlignment":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"alignment_contract_sha256"})
        )
        if self.alignment_contract_sha256 != expected:
            raise ValueError("objective alignment hash does not match its content")
        return self


class ActiveOptimizationObjective(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.active_optimization_objective.v1"] = (
        "ecos.active_optimization_objective.v1"
    )
    alignment_contract_sha256: str
    original_primary_metric: ObjectiveMetric
    active_primary_metric: ObjectiveMetric
    active_preserve_metrics: tuple[ObjectiveMetric, ...] = Field(max_length=2)
    drc_count: StrictInt = Field(ge=0)
    sta_setup_violation_count: StrictInt = Field(ge=0)
    sta_hold_violation_count: StrictInt = Field(ge=0)
    recovery_stage: Literal["drc", "setup", "hold", "original"]

    @field_validator("alignment_contract_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("active objective alignment hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_recovery_state(self) -> "ActiveOptimizationObjective":
        counts = {
            ObjectiveMetric.DRC_COUNT: self.drc_count,
            ObjectiveMetric.STA_SETUP_VIOLATION_COUNT: (
                self.sta_setup_violation_count
            ),
            ObjectiveMetric.STA_HOLD_VIOLATION_COUNT: self.sta_hold_violation_count,
        }
        active = next((metric for metric in RECOVERY_ORDER if counts[metric]), None)
        expected_stage = (
            "original"
            if active is None
            else {
                ObjectiveMetric.DRC_COUNT: "drc",
                ObjectiveMetric.STA_SETUP_VIOLATION_COUNT: "setup",
                ObjectiveMetric.STA_HOLD_VIOLATION_COUNT: "hold",
            }[active]
        )
        expected_primary = active or self.original_primary_metric
        if (
            self.recovery_stage != expected_stage
            or self.active_primary_metric != expected_primary
        ):
            raise ValueError("active objective does not match violation counts")
        if active is not None and self.active_preserve_metrics != tuple(
            metric for metric in RECOVERY_ORDER if metric != active
        ):
            raise ValueError("active objective recovery guardrails are invalid")
        return self


def build_objective_alignment(
    objective: OptimizationObjectiveContract,
    baseline: TerminalObservation,
) -> OptimizationObjectiveAlignment:
    counts = recovery_violation_counts(baseline)
    payload = {
        "schema_version": "ecos.optimization_objective_alignment.v1",
        "objective_contract_sha256": objective.contract_sha256,
        "baseline_terminal_observation_sha256": canonical_sha256(
            baseline.model_dump(mode="json")
        ),
        **{metric.value: counts[metric] for metric in RECOVERY_ORDER},
        "recovery_order": [metric.value for metric in RECOVERY_ORDER],
    }
    return OptimizationObjectiveAlignment(
        **payload,
        alignment_contract_sha256=canonical_sha256(payload),
    )


def validate_objective_alignment(
    alignment: OptimizationObjectiveAlignment,
    objective: OptimizationObjectiveContract,
    baseline: TerminalObservation,
) -> OptimizationObjectiveAlignment:
    expected = build_objective_alignment(objective, baseline)
    if alignment != expected:
        raise ObjectiveAlignmentError(
            "objective alignment does not match the current baseline"
        )
    return alignment


def build_active_objective(
    alignment: OptimizationObjectiveAlignment,
    objective: OptimizationObjectiveContract,
    incumbent: TerminalObservation,
) -> ActiveOptimizationObjective:
    if alignment.objective_contract_sha256 != objective.contract_sha256:
        raise ObjectiveAlignmentError("objective alignment does not match the objective")
    counts = recovery_violation_counts(incumbent)
    active = next((metric for metric in RECOVERY_ORDER if counts[metric]), None)
    if active is None:
        primary = objective.primary_metric
        preserve = objective.preserve_metrics
        stage = "original"
    else:
        primary = active
        preserve = tuple(metric for metric in RECOVERY_ORDER if metric != active)
        stage = {
            ObjectiveMetric.DRC_COUNT: "drc",
            ObjectiveMetric.STA_SETUP_VIOLATION_COUNT: "setup",
            ObjectiveMetric.STA_HOLD_VIOLATION_COUNT: "hold",
        }[active]
    return ActiveOptimizationObjective(
        alignment_contract_sha256=alignment.alignment_contract_sha256,
        original_primary_metric=objective.primary_metric,
        active_primary_metric=primary,
        active_preserve_metrics=preserve,
        **{metric.value: counts[metric] for metric in RECOVERY_ORDER},
        recovery_stage=stage,
    )


def recovery_violation_counts(
    observation: TerminalObservation,
) -> dict[ObjectiveMetric, int]:
    values = _validated_eligibility_values(observation)
    _validate_non_recoverable_evidence(observation, values)
    counts = {metric: values[metric.value] for metric in RECOVERY_ORDER}
    for metric, gate_name in _RECOVERY_GATES.items():
        expected = GateResult.PASS if counts[metric] == 0 else GateResult.FAIL
        if getattr(observation.signoff_gates, gate_name) != expected:
            raise ObjectiveAlignmentError(
                f"baseline {metric.value} contradicts its signoff gate"
            )
    return counts


def _validated_eligibility_values(
    observation: TerminalObservation,
) -> dict[str, int]:
    if (
        observation.schema_version != "ecos.terminal_observation.v3"
        or not observation.evidence_valid
        or not observation.harden_artifacts_complete
        or observation.evaluation_metrics_complete is not True
    ):
        raise ObjectiveAlignmentError("baseline terminal evidence is incomplete")
    records = {
        item.metric_id: item
        for item in observation.evaluation_metrics
        if item.category == EvaluationMetricCategory.ELIGIBILITY
        and item.role == EvaluationMetricRole.GATE
        and item.direction == EvaluationMetricDirection.EXACT
        and item.corner is None
        and item.unit == "count"
    }
    if set(records) != set(_ELIGIBILITY_IDS):
        raise ObjectiveAlignmentError("baseline eligibility metrics are incomplete")
    values = {metric_id: records[metric_id].value for metric_id in _ELIGIBILITY_IDS}
    if any(value < 0 or not float(value).is_integer() for value in values.values()):
        raise ObjectiveAlignmentError("baseline eligibility count is invalid")
    return {metric_id: int(value) for metric_id, value in values.items()}


def _validate_non_recoverable_evidence(
    observation: TerminalObservation, values: dict[str, int]
) -> None:
    if any(
        values[metric_id]
        for metric_id in (
            "lvs_count",
            "rcx_missing_corner_count",
            "rcx_spef_parse_failure_count",
            "sta_missing_corner_count",
            "harden_artifact_missing_count",
        )
    ) or (
        values["rcx_expected_corner_count"] <= 0
        or values["rcx_spef_file_count"] != values["rcx_expected_corner_count"]
        or values["sta_expected_corner_count"] <= 0
        or values["sta_corner_count"] != values["sta_expected_corner_count"]
    ):
        raise ObjectiveAlignmentError("baseline has a non-recoverable eligibility failure")
    gates = observation.signoff_gates
    if any(
        getattr(gates, name) != GateResult.PASS
        for name in ("lvs_clean", "rcx_corner_coverage", "rcx_spef_parse_health")
    ) or any(
        getattr(gates, name) not in {GateResult.PASS, GateResult.NOT_APPLICABLE}
        for name in ("mpc_minimum_area", "mpc_maximum_area")
    ):
        raise ObjectiveAlignmentError("baseline has a non-recoverable signoff failure")
