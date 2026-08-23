"""Pure contracts for bounded, auditable flow-optimization episodes."""

from __future__ import annotations

import math
import re
from enum import StrEnum
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    field_validator,
    model_validator,
)

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.hashing import canonical_sha256


_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_METRIC_ID = re.compile(r"^[a-z][a-z0-9_]*$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_CHUNK_SHA256 = re.compile(r"^[0-9a-f]{64}$")
KnobScalar = StrictBool | StrictInt | StrictFloat


class OptimizationKnob(StrEnum):
    TARGET_DENSITY = "place.target_density"
    CELL_PADDING_X = "place.cell_padding_x"
    ROUTABILITY_OPT = "place.routability_opt"


class ObjectiveMetric(StrEnum):
    ROUTE_DR_TOTAL_VIOLATION_COUNT = "route_dr_total_violation_count"
    ROUTE_LA_TOTAL_OVERFLOW = "route_la_total_overflow"
    ROUTE_WIRELENGTH = "route_wirelength"


class TimingMetric(StrEnum):
    STA_SETUP_WNS = "sta_setup_wns"
    STA_SETUP_TNS = "sta_setup_tns"
    STA_HOLD_WNS = "sta_hold_wns"
    STA_HOLD_TNS = "sta_hold_tns"


ROUTABILITY_OBJECTIVE_ORDER = (
    ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,
    ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
    ObjectiveMetric.ROUTE_WIRELENGTH,
)

TIMING_GUARDRAIL_ORDER = tuple(TimingMetric)
SelectionMetric = ObjectiveMetric | TimingMetric


class OptimizationDecision(StrEnum):
    CONTINUE = "continue"
    PROPOSE = "propose"
    STOP = "stop"
    ESCALATE = "escalate"


class ProposalReason(StrEnum):
    OBSERVATION = "observation"
    NEGATIVE_HISTORY = "negative_history"
    BUDGET_EXHAUSTED = "budget_exhausted"
    NO_LEGAL_CANDIDATE = "no_legal_candidate"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    HUMAN_REVIEW_REQUIRED = "human_review_required"


class StrategyDirection(StrEnum):
    INCREASE = "increase"
    DECREASE = "decrease"
    ENABLE = "enable"
    DISABLE = "disable"


class ExpectedEffectDirection(StrEnum):
    INCREASE = "increase"
    DECREASE = "decrease"
    UNCHANGED = "unchanged"
    UNKNOWN = "unknown"


class GateResult(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    UNAVAILABLE = "unavailable"
    NOT_APPLICABLE = "not_applicable"


class OptimizationEpisodeState(StrEnum):
    CREATED = "created"
    PLANNING = "planning"
    AWAITING_EXECUTION = "awaiting_execution"
    EXECUTING = "executing"
    TERMINAL = "terminal"
    STOPPED = "stopped"
    ESCALATED = "escalated"
    QUARANTINED = "quarantined"


class _ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LegalAction(_ContractModel):
    knob_id: OptimizationKnob
    direction: StrategyDirection

    @model_validator(mode="after")
    def validate_direction(self) -> "LegalAction":
        numeric = {OptimizationKnob.TARGET_DENSITY, OptimizationKnob.CELL_PADDING_X}
        if self.knob_id in numeric and self.direction not in {
            StrategyDirection.INCREASE,
            StrategyDirection.DECREASE,
        }:
            raise ValueError("numeric legal actions require increase or decrease")
        if self.knob_id == OptimizationKnob.ROUTABILITY_OPT and self.direction not in {
            StrategyDirection.ENABLE,
            StrategyDirection.DISABLE,
        }:
            raise ValueError("boolean legal actions require enable or disable")
        return self


class PlanningProviderEvidence(_ContractModel):
    """Opaque proof that a Codex planner turn produced one response."""

    schema_version: Literal["ecos.optimization_planning_provider_evidence.v1"] = (
        "ecos.optimization_planning_provider_evidence.v1"
    )
    provider_id: Literal["codex_app_server"]
    thread_id: str
    turn_id: str
    response_sha256: str
    diagnostics_sha256: str | None = None

    @field_validator("thread_id", "turn_id")
    @classmethod
    def validate_turn_identifier(cls, value: str) -> str:
        if not value or len(value) > 512:
            raise ValueError("planning provider turn identifier is invalid")
        return value

    @field_validator("response_sha256", "diagnostics_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("planning provider evidence hash is invalid")
        return value


class ProposalContextRef(_ContractModel):
    episode_id: str
    checkpoint_id: str
    input_sha256: str

    @field_validator("episode_id", "checkpoint_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("proposal context id is invalid")
        return value

    @field_validator("input_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("proposal context hash is invalid")
        return value


class ObservationReference(_ContractModel):
    observation_id: str
    sha256: str

    @field_validator("observation_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("observation reference id is invalid")
        return value

    @field_validator("sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("observation reference hash is invalid")
        return value


class HistoryReference(_ContractModel):
    intervention_id: str
    outcome_sha256: str

    @field_validator("intervention_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("history reference id is invalid")
        return value

    @field_validator("outcome_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("history reference hash is invalid")
        return value


class KnowledgeReference(_ContractModel):
    entity_id: str
    chunk_sha256: str

    @field_validator("entity_id")
    @classmethod
    def validate_entity_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("knowledge entity id is invalid")
        return value

    @field_validator("chunk_sha256")
    @classmethod
    def validate_chunk_hash(cls, value: str) -> str:
        if not _CHUNK_SHA256.fullmatch(value):
            raise ValueError("knowledge chunk hash is invalid")
        return value


class ExpectedEffect(_ContractModel):
    metric_id: ObjectiveMetric
    direction: ExpectedEffectDirection


class ProposalAction(_ContractModel):
    knob_id: OptimizationKnob
    direction: StrategyDirection
    expected_effects: tuple[ExpectedEffect, ...] = Field(min_length=1, max_length=3)

    @field_validator("expected_effects")
    @classmethod
    def validate_effects(cls, value: tuple[ExpectedEffect, ...]) -> tuple[ExpectedEffect, ...]:
        if len({effect.metric_id for effect in value}) != len(value):
            raise ValueError("expected effects must be unique")
        return value

    @model_validator(mode="after")
    def validate_direction(self) -> "ProposalAction":
        numeric_knobs = {OptimizationKnob.TARGET_DENSITY, OptimizationKnob.CELL_PADDING_X}
        numeric_directions = {StrategyDirection.INCREASE, StrategyDirection.DECREASE}
        boolean_directions = {StrategyDirection.ENABLE, StrategyDirection.DISABLE}
        if self.knob_id in numeric_knobs and self.direction not in numeric_directions:
            raise ValueError("numeric knobs require increase or decrease")
        if (
            self.knob_id == OptimizationKnob.ROUTABILITY_OPT
            and self.direction not in boolean_directions
        ):
            raise ValueError("boolean knobs require enable or disable")
        return self


class OptimizationProposal(_ContractModel):
    schema_version: Literal["ecos.optimization_proposal.v1"] = "ecos.optimization_proposal.v1"
    context_ref: ProposalContextRef
    decision: OptimizationDecision
    reason_code: ProposalReason
    rationale_summary: str
    observation_refs: tuple[ObservationReference, ...] = Field(min_length=1, max_length=13)
    history_refs: tuple[HistoryReference, ...] = Field(default=(), max_length=6)
    knowledge_refs: tuple[KnowledgeReference, ...] = Field(default=(), max_length=6)
    action: ProposalAction | None = None

    @field_validator("rationale_summary")
    @classmethod
    def validate_rationale(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("proposal rationale is invalid")
        return value

    @field_validator("observation_refs", "history_refs", "knowledge_refs")
    @classmethod
    def validate_unique_references(cls, value: tuple[object, ...]) -> tuple[object, ...]:
        identifiers = [next(iter(item.model_dump().values())) for item in value]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("proposal references must be unique")
        return value

    @model_validator(mode="after")
    def validate_decision(self) -> "OptimizationProposal":
        if self.decision == OptimizationDecision.PROPOSE and self.action is None:
            raise ValueError("propose requires an action")
        if self.decision != OptimizationDecision.PROPOSE and self.action is not None:
            raise ValueError("non-propose decisions cannot contain an action")
        return self


class RequestedKnobValue(_ContractModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    knob_id: OptimizationKnob
    value: KnobScalar

    @model_validator(mode="after")
    def validate_lattice_value(self) -> "RequestedKnobValue":
        if self.knob_id == OptimizationKnob.TARGET_DENSITY:
            valid = type(self.value) in {int, float} and not isinstance(self.value, bool)
            if not valid or not _is_density_lattice_value(float(self.value)):
                raise ValueError("target density is outside the frozen lattice")
        elif self.knob_id == OptimizationKnob.CELL_PADDING_X:
            if type(self.value) is not int or not 0 <= self.value <= 3:
                raise ValueError("cell padding must be a logical site count from 0 to 3")
        elif type(self.value) is not bool:
            raise ValueError("routability optimization must be a boolean")
        return self


class AppliedKnobValue(_ContractModel):
    knob_id: OptimizationKnob
    value: KnobScalar

    @model_validator(mode="after")
    def validate_effective_value(self) -> "AppliedKnobValue":
        if self.knob_id == OptimizationKnob.TARGET_DENSITY:
            valid = type(self.value) in {int, float} and not isinstance(self.value, bool)
            if not valid or not 0 < float(self.value) <= 1 or not math.isfinite(float(self.value)):
                raise ValueError("effective target density is invalid")
        elif self.knob_id == OptimizationKnob.CELL_PADDING_X:
            if type(self.value) is not int or self.value < 0:
                raise ValueError("effective cell padding must be a non-negative DBU value")
        elif type(self.value) is not bool:
            raise ValueError("effective routability optimization must be a boolean")
        return self


class RuntimeAdjustment(_ContractModel):
    effective_value: AppliedKnobValue
    reason: str
    evidence_sha256: str

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 128 or "\n" in value:
            raise ValueError("runtime adjustment reason is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("runtime adjustment hash is invalid")
        return value


class KnobApplicationReceipt(_ContractModel):
    receipt_id: str
    requested: RequestedKnobValue
    written: AppliedKnobValue
    effective_initial: AppliedKnobValue
    runtime_adjustments: tuple[RuntimeAdjustment, ...] = Field(default=(), max_length=16)
    effective_final: AppliedKnobValue
    evidence_sha256: str

    @field_validator("receipt_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("receipt id is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("receipt evidence hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_receipt_chain(self) -> "KnobApplicationReceipt":
        values = (self.requested, self.written, self.effective_initial, self.effective_final)
        if any(value.knob_id != self.requested.knob_id for value in values):
            raise ValueError("receipt knob ids must match")
        if any(
            item.effective_value.knob_id != self.requested.knob_id
            for item in self.runtime_adjustments
        ):
            raise ValueError("runtime adjustment knob ids must match")
        last_value = (
            self.runtime_adjustments[-1].effective_value
            if self.runtime_adjustments
            else self.effective_initial
        )
        if last_value != self.effective_final:
            raise ValueError("receipt final value must match the last effective value")
        return self


class EpisodeBudget(_ContractModel):
    schema_version: Literal["ecos.optimization_budget.v2"] = "ecos.optimization_budget.v2"
    candidate_execution_limit: Literal[6] = 6
    planning_call_limit: Literal[18] = 18
    minimum_candidate_executions: Literal[2] = 2
    max_planning_only_turns: Literal[2] = 2
    default_place_to_harden_seconds: tuple[float, float, float]
    wall_time_limit_seconds: float

    @field_validator("default_place_to_harden_seconds")
    @classmethod
    def validate_default_times(
        cls, value: tuple[float, float, float]
    ) -> tuple[float, float, float]:
        if any(not math.isfinite(item) or item <= 0 for item in value):
            raise ValueError("default rerun times must be finite and positive")
        return value

    @model_validator(mode="after")
    def validate_wall_time_limit(self) -> "EpisodeBudget":
        median = sorted(self.default_place_to_harden_seconds)[1]
        if not math.isclose(self.wall_time_limit_seconds, 8 * median, rel_tol=0, abs_tol=1e-9):
            raise ValueError("wall time limit must equal 8 times the default rerun median")
        return self

    @classmethod
    def from_default_reruns(cls, durations: tuple[float, float, float]) -> "EpisodeBudget":
        median = sorted(durations)[1]
        return cls(default_place_to_harden_seconds=durations, wall_time_limit_seconds=8 * median)


class BudgetSnapshot(_ContractModel):
    budget: EpisodeBudget
    consumed_candidates: int = Field(default=0, ge=0)
    consumed_planning_calls: int = Field(default=0, ge=0)
    elapsed_wall_time_seconds: float = Field(default=0, ge=0)

    @field_validator("elapsed_wall_time_seconds")
    @classmethod
    def validate_elapsed_time(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("elapsed wall time must be finite")
        return value

    @model_validator(mode="after")
    def validate_consumption(self) -> "BudgetSnapshot":
        if self.consumed_candidates > self.budget.candidate_execution_limit:
            raise ValueError("candidate budget is exceeded")
        if self.consumed_planning_calls > self.budget.planning_call_limit:
            raise ValueError("planning budget is exceeded")
        return self

    @property
    def remaining_candidates(self) -> int:
        return self.budget.candidate_execution_limit - self.consumed_candidates

    @property
    def remaining_planning_calls(self) -> int:
        return self.budget.planning_call_limit - self.consumed_planning_calls

    @property
    def remaining_wall_time_seconds(self) -> float:
        return max(0.0, self.budget.wall_time_limit_seconds - self.elapsed_wall_time_seconds)

    @property
    def exhausted(self) -> bool:
        return (
            self.remaining_candidates == 0
            or self.remaining_planning_calls == 0
            or self.elapsed_wall_time_seconds >= self.budget.wall_time_limit_seconds
        )


class StageObservation(_ContractModel):
    schema_version: Literal["ecos.stage_observation.v1"] = "ecos.stage_observation.v1"
    observation_id: str
    stage: ECCStepName
    evidence_manifest_sha256: str
    metrics: dict[str, float]
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
    schema_version: Literal["ecos.terminal_observation.v2"] = "ecos.terminal_observation.v2"
    observation_id: str
    evidence_manifest_sha256: str
    evidence_valid: bool
    harden_artifacts_complete: bool
    signoff_gates: SignoffGates
    metrics: dict[ObjectiveMetric, float]
    timing_guardrail: dict[TimingMetric, float]

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
    def validate_metrics(cls, value: dict[ObjectiveMetric, float]) -> dict[ObjectiveMetric, float]:
        if set(value) != set(ROUTABILITY_OBJECTIVE_ORDER):
            raise ValueError("terminal metrics must contain the frozen objective metrics")
        if any(not math.isfinite(number) or number < 0 for number in value.values()):
            raise ValueError("terminal metrics must be finite and non-negative")
        return value

    @field_validator("timing_guardrail")
    @classmethod
    def validate_timing_guardrail(
        cls, value: dict[TimingMetric, float]
    ) -> dict[TimingMetric, float]:
        if set(value) != set(TIMING_GUARDRAIL_ORDER):
            raise ValueError("terminal timing guardrail must contain the frozen timing metrics")
        if any(not math.isfinite(number) for number in value.values()):
            raise ValueError("terminal timing guardrail metrics must be finite")
        return value

    @property
    def eligible_for_incumbent(self) -> bool:
        return self.evidence_valid and self.harden_artifacts_complete and self.signoff_gates.passed


class BaselineReplay(_ContractModel):
    replay_id: str
    candidate_root_ref: str
    candidate_manifest_ref: str
    candidate_manifest_sha256: str
    runtime_seconds: float = Field(gt=0)
    terminal_observation: TerminalObservation

    @field_validator("replay_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("baseline replay id is invalid")
        return value

    @field_validator("candidate_root_ref", "candidate_manifest_ref")
    @classmethod
    def validate_reference(cls, value: str) -> str:
        if not value or "\\" in value or value.startswith("/") or "." in value.split("/"):
            raise ValueError("baseline replay reference is invalid")
        if ".." in value.split("/"):
            raise ValueError("baseline replay reference is invalid")
        return value

    @field_validator("candidate_manifest_sha256")
    @classmethod
    def validate_manifest_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("baseline replay manifest hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_terminal_evidence(self) -> "BaselineReplay":
        if not self.terminal_observation.eligible_for_incumbent:
            raise ValueError("baseline replay terminal evidence is ineligible")
        return self


class BaselineReplayEvidence(_ContractModel):
    schema_version: Literal["ecos.optimization_baseline_replays.v2"] = (
        "ecos.optimization_baseline_replays.v2"
    )
    parent_manifest_sha256: str
    replays: tuple[BaselineReplay, BaselineReplay, BaselineReplay]
    artifact_sha256: str

    @model_validator(mode="after")
    def validate_evidence(self) -> "BaselineReplayEvidence":
        if not _SHA256.fullmatch(self.parent_manifest_sha256):
            raise ValueError("baseline replay parent manifest hash is invalid")
        if len({replay.replay_id for replay in self.replays}) != 3:
            raise ValueError("baseline replay ids must be unique")
        if not _SHA256.fullmatch(self.artifact_sha256):
            raise ValueError("baseline replay artifact hash is invalid")
        expected = canonical_sha256(self.model_dump(mode="json", exclude={"artifact_sha256"}))
        if self.artifact_sha256 != expected:
            raise ValueError("baseline replay artifact hash does not match its content")
        return self


class MetricNoiseBand(_ContractModel):
    metric_id: ObjectiveMetric
    default_replay_values: tuple[float, float, float]
    tolerance: float

    @field_validator("default_replay_values")
    @classmethod
    def validate_values(cls, value: tuple[float, float, float]) -> tuple[float, float, float]:
        if any(not math.isfinite(item) or item < 0 for item in value):
            raise ValueError("noise replay values must be finite and non-negative")
        return value

    @model_validator(mode="after")
    def validate_tolerance(self) -> "MetricNoiseBand":
        expected = max(self.default_replay_values) - min(self.default_replay_values)
        if not math.isclose(self.tolerance, expected, rel_tol=0, abs_tol=1e-12):
            raise ValueError("noise tolerance must equal the three-replay range")
        return self


class RoutabilityObjectiveContract(_ContractModel):
    schema_version: Literal["ecos.routability_objective.v2"] = "ecos.routability_objective.v2"
    noise_bands: tuple[MetricNoiseBand, ...]
    timing_guardrail: "TimingGuardrailContract"

    @field_validator("noise_bands")
    @classmethod
    def validate_noise_bands(
        cls, value: tuple[MetricNoiseBand, ...]
    ) -> tuple[MetricNoiseBand, ...]:
        if tuple(item.metric_id for item in value) != ROUTABILITY_OBJECTIVE_ORDER:
            raise ValueError("noise bands must use the frozen objective order")
        return value

    def noise_band(self, metric_id: ObjectiveMetric) -> float:
        return next(item.tolerance for item in self.noise_bands if item.metric_id == metric_id)

    @property
    def contract_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class TimingNoiseBand(_ContractModel):
    metric_id: TimingMetric
    default_replay_values: tuple[float, float, float]
    tolerance: float

    @field_validator("default_replay_values")
    @classmethod
    def validate_values(cls, value: tuple[float, float, float]) -> tuple[float, float, float]:
        if any(not math.isfinite(item) for item in value):
            raise ValueError("timing noise replay values must be finite")
        return value

    @model_validator(mode="after")
    def validate_tolerance(self) -> "TimingNoiseBand":
        expected = max(self.default_replay_values) - min(self.default_replay_values)
        if not math.isclose(self.tolerance, expected, rel_tol=0, abs_tol=1e-12):
            raise ValueError("timing noise tolerance must equal the three-replay range")
        return self


class TimingGuardrailContract(_ContractModel):
    schema_version: Literal["ecos.timing_guardrail.v1"] = "ecos.timing_guardrail.v1"
    noise_bands: tuple[TimingNoiseBand, ...]

    @field_validator("noise_bands")
    @classmethod
    def validate_noise_bands(
        cls, value: tuple[TimingNoiseBand, ...]
    ) -> tuple[TimingNoiseBand, ...]:
        if tuple(item.metric_id for item in value) != TIMING_GUARDRAIL_ORDER:
            raise ValueError("timing noise bands must use the frozen timing order")
        return value

    def noise_band(self, metric_id: TimingMetric) -> float:
        return next(item.tolerance for item in self.noise_bands if item.metric_id == metric_id)


def _is_density_lattice_value(value: float) -> bool:
    lattice_index = (value - 0.1) / 0.05
    return 0.1 <= value <= 0.95 and math.isclose(lattice_index, round(lattice_index), abs_tol=1e-9)
