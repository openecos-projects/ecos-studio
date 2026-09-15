"""Stage and terminal observation contracts."""

from __future__ import annotations

import math
import statistics
from typing import Literal, Sequence

from pydantic import Field, field_validator, model_validator

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.geometry import GeometrySnapshot
from ecos_agent.optimization.metrics.contracts import (
    EvaluationMetricCategory,
    EvaluationMetricDirection,
    EvaluationMetricRole,
    TerminalEvaluationMetric,
    is_telemetry_metric,
    safe_relative_ref,
)
from ecos_agent.optimization.contracts import (
    AREA_OBJECTIVE_ORDER,
    POWER_OBJECTIVE_ORDER,
    TIMING_OBJECTIVE_ORDER,
    _ContractModel,
    _ID,
    _METRIC_ID,
    _SHA256,
    BudgetSnapshot,
    GateResult,
    KnobScalar,
    ObjectiveMetric,
    RequestedKnobValue,
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    TimingMetric,
)

#: Required signoff gates whose FAIL state is a physical closure failure.
_PHYSICAL_GATE_NAMES = (
    "drc_clean",
    "lvs_clean",
    "rcx_corner_coverage",
    "rcx_spef_parse_health",
    "sta_setup_closed",
    "sta_hold_closed",
    "mpc_minimum_area",
    "mpc_maximum_area",
)


class StageEvidenceFeature(_ContractModel):
    feature_id: str
    value: KnobScalar
    evidence_sha256: str
    evidence_ref: str

    @field_validator("feature_id")
    @classmethod
    def validate_feature_id(cls, value: str) -> str:
        if not _METRIC_ID.fullmatch(value):
            raise ValueError("stage evidence feature id is invalid")
        return value

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: KnobScalar) -> KnobScalar:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("stage evidence feature value is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_evidence_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("stage evidence hash is invalid")
        return value

    @field_validator("evidence_ref")
    @classmethod
    def validate_evidence_ref(cls, value: str) -> str:
        path, separator, fragment = value.partition("#")
        if (
            not safe_relative_ref(path)
            or (separator and not fragment.startswith("/hotspots/"))
        ):
            raise ValueError("stage evidence reference is invalid")
        return value


class StageObservation(_ContractModel):
    schema_version: Literal["ecos.stage_observation.v1"] = "ecos.stage_observation.v1"
    observation_id: str
    stage: ECCStepName
    evidence_manifest_sha256: str
    metrics: dict[str, float]
    state_evidence: tuple[StageEvidenceFeature, ...] = Field(default=(), max_length=64)
    requested_knobs: tuple[RequestedKnobValue, ...] = Field(default=(), max_length=3)
    budget: BudgetSnapshot

    @field_validator("observation_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("observation id is invalid")
        return value

    @field_validator("evidence_manifest_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("observation manifest hash is invalid")
        return value

    @field_validator("metrics")
    @classmethod
    def validate_metrics(cls, value: dict[str, float]) -> dict[str, float]:
        if any(
            not _METRIC_ID.fullmatch(key) or not math.isfinite(number)
            for key, number in value.items()
        ):
            raise ValueError("observation metrics are invalid")
        return value

    @field_validator("requested_knobs")
    @classmethod
    def validate_knobs(
        cls, value: tuple[RequestedKnobValue, ...]
    ) -> tuple[RequestedKnobValue, ...]:
        if len({item.knob_id for item in value}) != len(value):
            raise ValueError("observation knobs must be unique")
        return value


class SignoffGates(_ContractModel):
    drc_clean: GateResult
    lvs_clean: GateResult
    rcx_corner_coverage: GateResult
    rcx_spef_parse_health: GateResult
    sta_setup_closed: GateResult
    sta_hold_closed: GateResult
    mpc_minimum_area: GateResult
    mpc_maximum_area: GateResult

    @model_validator(mode="after")
    def validate_required_gate_states(self) -> "SignoffGates":
        required = (
            self.drc_clean,
            self.lvs_clean,
            self.rcx_corner_coverage,
            self.rcx_spef_parse_health,
            self.sta_setup_closed,
            self.sta_hold_closed,
        )
        if any(value == GateResult.NOT_APPLICABLE for value in required):
            raise ValueError("required signoff gates cannot be not_applicable")
        return self

    @classmethod
    def all(cls, result: GateResult) -> "SignoffGates":
        return cls(**{name: result for name in cls.model_fields})

    @property
    def passed(self) -> bool:
        return all(
            value in {GateResult.PASS, GateResult.NOT_APPLICABLE}
            for value in self.model_dump().values()
        )
class TerminalObservation(_ContractModel):
    schema_version: Literal[
        "ecos.terminal_observation.v2", "ecos.terminal_observation.v3"
    ] = "ecos.terminal_observation.v2"
    observation_id: str
    geometry: GeometrySnapshot | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    evidence_manifest_sha256: str
    evidence_valid: bool
    harden_artifacts_complete: bool
    signoff_gates: SignoffGates
    metrics: dict[ObjectiveMetric, float]
    timing_guardrail: dict[TimingMetric, float]
    evaluation_metrics: tuple[TerminalEvaluationMetric, ...] = Field(
        default=(), exclude_if=lambda value: not value
    )
    evaluation_metrics_complete: bool | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    sta_corner_ids: tuple[str, ...] = Field(
        default=(), exclude_if=lambda value: not value
    )
    sta_corner_set_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    consistency_violations: tuple[str, ...] = Field(
        default=(),
        exclude_if=lambda value: not value,
        description="C1-C3 same-workspace contradictions (ECC-QoR draft 3, 10.4)",
    )

    @field_validator("observation_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("terminal observation id is invalid")
        return value

    @field_validator("evidence_manifest_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("terminal manifest hash is invalid")
        return value

    @field_validator("metrics")
    @classmethod
    def validate_metrics(
        cls, value: dict[ObjectiveMetric, float]
    ) -> dict[ObjectiveMetric, float]:
        if set(value) != set(ROUTABILITY_OBJECTIVE_ORDER):
            raise ValueError(
                "terminal metrics must contain the frozen objective metrics"
            )
        if any(not math.isfinite(number) or number < 0 for number in value.values()):
            raise ValueError("terminal metrics must be finite and non-negative")
        return value

    @field_validator("timing_guardrail")
    @classmethod
    def validate_timing_guardrail(
        cls, value: dict[TimingMetric, float]
    ) -> dict[TimingMetric, float]:
        if set(value) != set(TIMING_GUARDRAIL_ORDER):
            raise ValueError(
                "terminal timing guardrail must contain the frozen timing metrics"
            )
        if any(not math.isfinite(number) for number in value.values()):
            raise ValueError("terminal timing guardrail metrics must be finite")
        return value

    @field_validator("evaluation_metrics")
    @classmethod
    def validate_evaluation_metrics(
        cls, value: tuple[TerminalEvaluationMetric, ...]
    ) -> tuple[TerminalEvaluationMetric, ...]:
        keys = [(item.metric_id, item.corner) for item in value]
        if len(set(keys)) != len(keys):
            raise ValueError("terminal evaluation metrics must be unique")
        return value

    @field_validator("sta_corner_ids")
    @classmethod
    def validate_sta_corner_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if value != tuple(sorted(set(value))) or any(
            not safe_relative_ref(item) for item in value
        ):
            raise ValueError("terminal STA corner ids are invalid")
        return value

    @field_validator("sta_corner_set_sha256")
    @classmethod
    def validate_optional_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("terminal STA corner set hash is invalid")
        return value

    @field_validator("consistency_violations")
    @classmethod
    def validate_consistency_violations(
        cls, value: tuple[str, ...]
    ) -> tuple[str, ...]:
        if any(
            not item or len(item) > 64 or not item.isascii() or not item.islower()
            for item in value
        ):
            raise ValueError("terminal consistency violation ids are invalid")
        return value

    @model_validator(mode="after")
    def validate_extended_metrics(self) -> "TerminalObservation":
        if self.schema_version == "ecos.terminal_observation.v2":
            if (
                self.evaluation_metrics
                or self.evaluation_metrics_complete is not None
                or self.sta_corner_ids
                or self.sta_corner_set_sha256 is not None
                or self.consistency_violations
            ):
                raise ValueError("terminal observation v3 fields require the v3 schema")
            return self
        if self.evaluation_metrics_complete is None:
            raise ValueError("terminal evaluation metric coverage is unavailable")
        expected = canonical_sha256({"corners": self.sta_corner_ids})
        if self.sta_corner_set_sha256 != expected:
            raise ValueError("terminal STA corner set hash does not match")
        return self

    @property
    def objective_metrics(self) -> dict[ObjectiveMetric, float]:
        values = dict(self.metrics)
        values.update(
            {
                metric_id: self.timing_guardrail[TimingMetric(metric_id.value)]
                for metric_id in TIMING_OBJECTIVE_ORDER
            }
        )
        specifications = (
            *(
                (metric, "um^2", EvaluationMetricCategory.PPA, True)
                for metric in AREA_OBJECTIVE_ORDER
            ),
            *(
                (metric, "uW", EvaluationMetricCategory.PPA, False)
                for metric in POWER_OBJECTIVE_ORDER
            ),
            (
                ObjectiveMetric.GUI_OVERALL_QOR_SCORE,
                "score",
                EvaluationMetricCategory.QOR,
                True,
            ),
        )
        for metric_id, unit, category, unscoped in specifications:
            direction = (
                EvaluationMetricDirection.HIGHER_IS_BETTER
                if metric_id == ObjectiveMetric.GUI_OVERALL_QOR_SCORE
                else EvaluationMetricDirection.LOWER_IS_BETTER
            )
            matches = [
                item
                for item in self.evaluation_metrics
                if item.metric_id == metric_id.value
                and (item.corner is None or not unscoped)
                and item.unit == unit
                and item.category == category
                and item.role == EvaluationMetricRole.REPORT
                and item.direction == direction
            ]
            if len(matches) == 1:
                values[metric_id] = matches[0].value
        # Achieved STA frequency is corner-scoped evidence; the typical (or
        # unscoped) corner is the comparison point, higher is better.
        frequency = next(
            (
                item
                for item in self.evaluation_metrics
                if item.metric_id == ObjectiveMetric.STA_FREQUENCY.value
                and item.corner in (None, "TYP_25/TYPICAL")
                and item.unit == "MHz"
                and item.direction == EvaluationMetricDirection.HIGHER_IS_BETTER
            ),
            None,
        )
        if frequency is not None:
            values[ObjectiveMetric.STA_FREQUENCY] = frequency.value
        for metric_id in (
            ObjectiveMetric.DRC_COUNT,
            ObjectiveMetric.STA_SETUP_VIOLATION_COUNT,
            ObjectiveMetric.STA_HOLD_VIOLATION_COUNT,
        ):
            matches = [
                item
                for item in self.evaluation_metrics
                if item.metric_id == metric_id.value
                and item.corner is None
                and item.unit == "count"
                and item.category == EvaluationMetricCategory.ELIGIBILITY
                and item.role == EvaluationMetricRole.GATE
                and item.direction == EvaluationMetricDirection.EXACT
            ]
            if len(matches) == 1:
                values[metric_id] = matches[0].value
        return values

    @property
    def eligible_for_incumbent(self) -> bool:
        return (
            self.evidence_valid
            and self.harden_artifacts_complete
            and self.signoff_gates.passed
            and not self.consistency_violations
            and (
                self.schema_version == "ecos.terminal_observation.v2"
                or self.evaluation_metrics_complete is True
            )
            and self._numeric_eligibility_passed
        )

    @property
    def physical_signoff_failure(self) -> bool:
        """A real closure defect, as opposed to missing evidence.

        ECC-QoR draft 3 (section 10.2): a failed gate, a non-zero hard
        violation count, or a negative signed slack is a physical failure;
        these must never be reinterpreted as an evidence problem.
        """
        gates = self.signoff_gates
        if any(
            getattr(gates, name) == GateResult.FAIL
            for name in _PHYSICAL_GATE_NAMES
        ):
            return True
        values = self.objective_metrics
        hard_counts = (
            ObjectiveMetric.DRC_COUNT,
            ObjectiveMetric.STA_SETUP_VIOLATION_COUNT,
            ObjectiveMetric.STA_HOLD_VIOLATION_COUNT,
        )
        if any(values.get(metric, 0) > 0 for metric in hard_counts):
            return True
        # The guardrail carries signed worst slack: a negative value is a
        # timing violation even when the checklist gate is unavailable.
        return any(slack < 0 for slack in self.timing_guardrail.values())

    @property
    def evidence_incomplete(self) -> bool:
        """Ineligibility caused by missing or contradictory evidence.

        ECC-QoR draft 3 (section 10.3): unavailable gates, incomplete
        evaluation coverage, artifact loss, or C1-C3 contradictions are
        evidence gaps; they are never scored as physical failures.
        """
        if self.eligible_for_incumbent:
            return False
        return not self.physical_signoff_failure

    @property
    def _numeric_eligibility_passed(self) -> bool:
        if self.schema_version == "ecos.terminal_observation.v2":
            return True
        values = {
            item.metric_id: item.value
            for item in self.evaluation_metrics
            if item.category == EvaluationMetricCategory.ELIGIBILITY
        }
        zero_metrics = (
            "drc_count",
            "lvs_count",
            "rcx_missing_corner_count",
            "rcx_spef_parse_failure_count",
            "sta_missing_corner_count",
            "sta_setup_violation_count",
            "sta_hold_violation_count",
            "harden_artifact_missing_count",
        )
        return (
            all(values.get(metric_id) == 0 for metric_id in zero_metrics)
            and values.get("rcx_expected_corner_count", 0) > 0
            and values.get("rcx_spef_file_count")
            == values.get("rcx_expected_corner_count")
            and values.get("sta_expected_corner_count", 0) > 0
            and values.get("sta_corner_count")
            == values.get("sta_expected_corner_count")
        )


class MetricReference(_ContractModel):
    metric_id: ObjectiveMetric
    reference_value: float

    @field_validator("reference_value")
    @classmethod
    def validate_value(cls, value: float) -> float:
        if not math.isfinite(value) or value < 0:
            raise ValueError("reference value must be finite and non-negative")
        return value


class RoutabilityObjectiveContract(_ContractModel):
    schema_version: Literal["ecos.routability_objective.v3"] = (
        "ecos.routability_objective.v3"
    )
    references: tuple[MetricReference, ...]
    timing_guardrail: "TimingGuardrailContract"

    @field_validator("references")
    @classmethod
    def validate_references(
        cls, value: tuple[MetricReference, ...]
    ) -> tuple[MetricReference, ...]:
        if tuple(item.metric_id for item in value) != ROUTABILITY_OBJECTIVE_ORDER:
            raise ValueError("references must use the frozen objective order")
        return value

    def reference_value(self, metric_id: ObjectiveMetric) -> float:
        return next(
            item.reference_value
            for item in self.references
            if item.metric_id == metric_id
        )

    @property
    def contract_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class TimingReference(_ContractModel):
    metric_id: TimingMetric
    reference_value: float

    @field_validator("reference_value")
    @classmethod
    def validate_value(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("timing reference value must be finite")
        return value


class TimingGuardrailContract(_ContractModel):
    schema_version: Literal["ecos.timing_guardrail.v2"] = "ecos.timing_guardrail.v2"
    references: tuple[TimingReference, ...]

    @field_validator("references")
    @classmethod
    def validate_references(
        cls, value: tuple[TimingReference, ...]
    ) -> tuple[TimingReference, ...]:
        if tuple(item.metric_id for item in value) != TIMING_GUARDRAIL_ORDER:
            raise ValueError("timing references must use the frozen timing order")
        return value

    def reference_value(self, metric_id: TimingMetric) -> float:
        return next(
            item.reference_value
            for item in self.references
            if item.metric_id == metric_id
        )


def _metric_profile_key(metric: TerminalEvaluationMetric) -> str:
    if metric.corner is None:
        return metric.metric_id
    return f"{metric.metric_id}@{metric.corner}"


def deterministic_noise_profile(
    observations: Sequence[TerminalObservation],
) -> dict[str, dict[str, float]]:
    """Cross-replay noise over the candidate comparison key space.

    Keys cover every non-telemetry evaluation metric (corner rows keep their
    own ``metric_id@corner`` key so cross-corner PVT spread, e.g. leakage
    across -40 C / 125 C, is never reported as replay noise), the
    routability objective trio, and the timing guardrail — the full set a
    candidate-vs-reference delta can be judged against. Telemetry metrics
    (wall-clock / RSS sampling) are excluded: they vary across replays of an
    identical flow by construction.
    """
    if len(observations) < 2:
        raise ValueError("noise profile requires at least two observations")
    rows = []
    for item in observations:
        row = {
            _metric_profile_key(metric): metric.value
            for metric in item.evaluation_metrics
            if not is_telemetry_metric(metric)
        }
        row.update(
            {
                metric.value: float(item.metrics[metric])
                for metric in ROUTABILITY_OBJECTIVE_ORDER
            }
        )
        row.update(
            {
                metric.value: float(item.timing_guardrail[metric])
                for metric in TIMING_GUARDRAIL_ORDER
            }
        )
        rows.append(row)
    keys = tuple(rows[0])
    if any(tuple(row) != keys for row in rows[1:]):
        raise ValueError("replay metrics are not structurally aligned")
    return {
        "reference": {
            key: float(statistics.median(row[key] for row in rows)) for key in keys
        },
        "epsilon": {
            key: max(row[key] for row in rows) - min(row[key] for row in rows)
            for key in keys
        },
    }
