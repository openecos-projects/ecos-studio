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
from ecos_agent.optimization_metric_contracts import (
    EvaluationMetricCategory,
    TerminalEvaluationMetric,
    safe_relative_ref,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_METRIC_ID = re.compile(r"^[a-z][a-z0-9_]*$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_CHUNK_SHA256 = re.compile(r"^[0-9a-f]{64}$")
KnobScalar = StrictBool | StrictInt | StrictFloat


class OptimizationKnob(StrEnum):
    TARGET_DENSITY = "place.target_density"
    TARGET_OVERFLOW = "place.target_overflow"
    CELL_PADDING_X = "place.cell_padding_x"
    ROUTABILITY_OPT = "place.routability_opt"
    DENSITY_WEIGHT = "place.density_weight"
    FLOORPLAN_CORE_UTIL = "floorplan.core_util"
    FLOORPLAN_ASPECT_RATIO = "floorplan.aspect_ratio"
    SYNTH_MAX_FANOUT = "synth.max_fanout"


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

REQUIRED_SIGNOFF_GATES = (
    "drc_clean",
    "lvs_clean",
    "rcx_corner_coverage",
    "rcx_spef_parse_health",
    "sta_setup_closed",
    "sta_hold_closed",
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


class OptimizationObjectiveProposal(_ContractModel):
    schema_version: Literal["ecos.optimization_objective_proposal.v1"] = (
        "ecos.optimization_objective_proposal.v1"
    )
    primary_metric: ObjectiveMetric
    preserve_metrics: tuple[ObjectiveMetric, ...] = Field(default=(), max_length=2)
    rationale_summary: str

    @field_validator("preserve_metrics")
    @classmethod
    def validate_preserve_metrics(
        cls, value: tuple[ObjectiveMetric, ...]
    ) -> tuple[ObjectiveMetric, ...]:
        if len(set(value)) != len(value):
            raise ValueError("preserve metrics must be unique")
        return value

    @field_validator("rationale_summary")
    @classmethod
    def validate_rationale(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("objective rationale is invalid")
        return value

    @model_validator(mode="after")
    def validate_metric_roles(self) -> "OptimizationObjectiveProposal":
        if self.primary_metric in self.preserve_metrics:
            raise ValueError("primary metric cannot also be preserved")
        return self


class OptimizationObjectiveContract(_ContractModel):
    schema_version: Literal["ecos.optimization_objective.v1"] = (
        "ecos.optimization_objective.v1"
    )
    source_goal_sha256: str
    primary_metric: ObjectiveMetric
    preserve_metrics: tuple[ObjectiveMetric, ...] = Field(default=(), max_length=2)
    required_signoff_gates: tuple[str, ...]
    rationale_summary: str
    contract_sha256: str

    @field_validator("source_goal_sha256", "contract_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("objective contract hash is invalid")
        return value

    @field_validator("required_signoff_gates")
    @classmethod
    def validate_required_gates(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if value != REQUIRED_SIGNOFF_GATES:
            raise ValueError("objective contract must preserve required signoff gates")
        return value

    @field_validator("rationale_summary")
    @classmethod
    def validate_rationale(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("objective rationale is invalid")
        return value

    @model_validator(mode="after")
    def validate_contract(self) -> "OptimizationObjectiveContract":
        if self.primary_metric in self.preserve_metrics:
            raise ValueError("primary metric cannot also be preserved")
        if len(set(self.preserve_metrics)) != len(self.preserve_metrics):
            raise ValueError("preserve metrics must be unique")
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"contract_sha256"})
        )
        if self.contract_sha256 != expected:
            raise ValueError("objective contract hash does not match its content")
        return self


class LegalAction(_ContractModel):
    knob_id: OptimizationKnob
    direction: StrategyDirection

    @model_validator(mode="after")
    def validate_direction(self) -> "LegalAction":
        if self.knob_id != OptimizationKnob.ROUTABILITY_OPT and self.direction not in {
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


class PlanningProviderEnvelope(_ContractModel):
    """Exact model-visible request, excluding hidden reasoning and response text."""

    schema_version: Literal["ecos.optimization_planning_provider_envelope.v1"] = (
        "ecos.optimization_planning_provider_envelope.v1"
    )
    provider_id: Literal["codex_app_server"]
    requested_model: str | None = None
    prompt: str
    output_schema: dict[str, object]
    planner_payload_sha256: str
    envelope_sha256: str

    @field_validator("requested_model")
    @classmethod
    def validate_model(cls, value: str | None) -> str | None:
        if value is not None and (not value or len(value) > 512):
            raise ValueError("planning provider model is invalid")
        return value

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, value: str) -> str:
        if not value or len(value.encode("utf-8")) > 1024 * 1024:
            raise ValueError("planning provider prompt is invalid")
        return value

    @field_validator("planner_payload_sha256", "envelope_sha256")
    @classmethod
    def validate_envelope_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("planning provider envelope hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_envelope(self) -> "PlanningProviderEnvelope":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"envelope_sha256"})
        )
        if self.envelope_sha256 != expected:
            raise ValueError("planning provider envelope hash does not match")
        return self


class PlanningProviderEvidence(_ContractModel):
    """Hash-bound proof that one exact planner request produced a response."""

    schema_version: Literal["ecos.optimization_planning_provider_evidence.v2"] = (
        "ecos.optimization_planning_provider_evidence.v2"
    )
    provider_id: Literal["codex_app_server"]
    thread_id: str
    turn_id: str
    response_sha256: str
    diagnostics_sha256: str | None = None
    envelope: PlanningProviderEnvelope

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


class OptimizationTaskMemoryReference(_ContractModel):
    summary_sha256: str

    @field_validator("summary_sha256")
    @classmethod
    def validate_summary_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("task memory summary hash is invalid")
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
    def validate_effects(
        cls, value: tuple[ExpectedEffect, ...]
    ) -> tuple[ExpectedEffect, ...]:
        if len({effect.metric_id for effect in value}) != len(value):
            raise ValueError("expected effects must be unique")
        return value

    @model_validator(mode="after")
    def validate_direction(self) -> "ProposalAction":
        numeric_directions = {StrategyDirection.INCREASE, StrategyDirection.DECREASE}
        boolean_directions = {StrategyDirection.ENABLE, StrategyDirection.DISABLE}
        if (
            self.knob_id != OptimizationKnob.ROUTABILITY_OPT
            and self.direction not in numeric_directions
        ):
            raise ValueError("numeric knobs require increase or decrease")
        if (
            self.knob_id == OptimizationKnob.ROUTABILITY_OPT
            and self.direction not in boolean_directions
        ):
            raise ValueError("boolean knobs require enable or disable")
        return self


class OptimizationProposal(_ContractModel):
    schema_version: Literal["ecos.optimization_proposal.v1"] = (
        "ecos.optimization_proposal.v1"
    )
    context_ref: ProposalContextRef
    decision: OptimizationDecision
    reason_code: ProposalReason
    rationale_summary: str
    observation_refs: tuple[ObservationReference, ...] = Field(
        min_length=1, max_length=13
    )
    history_refs: tuple[HistoryReference, ...] = Field(default=(), max_length=6)
    knowledge_refs: tuple[KnowledgeReference, ...] = Field(default=(), max_length=6)
    task_memory_refs: tuple[OptimizationTaskMemoryReference, ...] = Field(
        default=(), max_length=6, exclude_if=lambda value: not value
    )
    action: ProposalAction | None = None

    @field_validator("rationale_summary")
    @classmethod
    def validate_rationale(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 512:
            raise ValueError("proposal rationale is invalid")
        return value

    @field_validator(
        "observation_refs", "history_refs", "knowledge_refs", "task_memory_refs"
    )
    @classmethod
    def validate_unique_references(
        cls, value: tuple[object, ...]
    ) -> tuple[object, ...]:
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
        if self.knob_id == OptimizationKnob.ROUTABILITY_OPT:
            if type(self.value) is not bool:
                raise ValueError("routability optimization must be a boolean")
        elif self.knob_id in {
            OptimizationKnob.CELL_PADDING_X,
            OptimizationKnob.SYNTH_MAX_FANOUT,
        }:
            lattice = (
                (0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16)
                if self.knob_id == OptimizationKnob.CELL_PADDING_X
                else (
                    8,
                    12,
                    16,
                    18,
                    20,
                    22,
                    24,
                    26,
                    28,
                    30,
                    32,
                    36,
                    40,
                    48,
                    56,
                    64,
                )
            )
            label = (
                "cell padding"
                if self.knob_id == OptimizationKnob.CELL_PADDING_X
                else "max fanout"
            )
            if type(self.value) is not int or self.value not in lattice:
                raise ValueError(f"{label} is outside the frozen lattice")
        else:
            valid = type(self.value) in {int, float} and not isinstance(
                self.value, bool
            )
            if not valid or not _is_requested_lattice_value(
                self.knob_id, float(self.value)
            ):
                raise ValueError(f"{self.knob_id.value} is outside the frozen lattice")
        return self


class AppliedKnobValue(_ContractModel):
    knob_id: OptimizationKnob
    value: KnobScalar

    @model_validator(mode="after")
    def validate_effective_value(self) -> "AppliedKnobValue":
        if self.knob_id == OptimizationKnob.ROUTABILITY_OPT:
            if type(self.value) is not bool:
                raise ValueError("effective routability optimization must be a boolean")
            return self
        if self.knob_id in {
            OptimizationKnob.CELL_PADDING_X,
            OptimizationKnob.SYNTH_MAX_FANOUT,
        }:
            minimum = 0 if self.knob_id == OptimizationKnob.CELL_PADDING_X else 1
            if type(self.value) is not int or self.value < 0:
                raise ValueError("effective integer knob value is invalid")
            if self.value < minimum:
                raise ValueError("effective integer knob value is invalid")
            return self
        valid = type(self.value) in {int, float} and not isinstance(self.value, bool)
        if not valid or not math.isfinite(float(self.value)):
            raise ValueError("effective numeric knob value is invalid")
        value = float(self.value)
        if (
            self.knob_id
            in {
                OptimizationKnob.TARGET_DENSITY,
                OptimizationKnob.FLOORPLAN_CORE_UTIL,
            }
            and not 0 < value <= 1
        ):
            raise ValueError("effective bounded ratio is invalid")
        if self.knob_id == OptimizationKnob.TARGET_OVERFLOW and not 0 <= value <= 1:
            raise ValueError("effective target overflow is invalid")
        if (
            self.knob_id
            in {
                OptimizationKnob.DENSITY_WEIGHT,
                OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
            }
            and value <= 0
        ):
            raise ValueError("effective positive knob value is invalid")
        return self


CANDIDATE_EXECUTION_LIMIT = 20
WALL_TIME_LIMIT_MULTIPLIER = 22


class EpisodeBudget(_ContractModel):
    schema_version: Literal["ecos.optimization_budget.v5"] = (
        "ecos.optimization_budget.v5"
    )
    candidate_execution_limit: Literal[20] = CANDIDATE_EXECUTION_LIMIT
    planning_call_limit: Literal[60] = 60
    minimum_candidate_executions: Literal[20] = CANDIDATE_EXECUTION_LIMIT
    max_planning_only_turns: Literal[2] = 2
    reference_place_to_harden_seconds: float
    wall_time_limit_seconds: float

    @field_validator("reference_place_to_harden_seconds")
    @classmethod
    def validate_reference_time(cls, value: float) -> float:
        if not math.isfinite(value) or value <= 0:
            raise ValueError("reference rerun time must be finite and positive")
        return value

    @model_validator(mode="after")
    def validate_wall_time_limit(self) -> "EpisodeBudget":
        if not math.isclose(
            self.wall_time_limit_seconds,
            WALL_TIME_LIMIT_MULTIPLIER * self.reference_place_to_harden_seconds,
            rel_tol=0,
            abs_tol=1e-9,
        ):
            raise ValueError("wall time limit must equal 22 times the reference rerun")
        return self

    @classmethod
    def from_reference_rerun(cls, duration: float) -> "EpisodeBudget":
        return cls(
            reference_place_to_harden_seconds=duration,
            wall_time_limit_seconds=WALL_TIME_LIMIT_MULTIPLIER * duration,
        )


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
        return max(
            0.0, self.budget.wall_time_limit_seconds - self.elapsed_wall_time_seconds
        )

    @property
    def exhausted(self) -> bool:
        return (
            self.remaining_candidates == 0
            or self.remaining_planning_calls == 0
            or self.elapsed_wall_time_seconds >= self.budget.wall_time_limit_seconds
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
            not separator
            or not fragment.startswith("/hotspots/")
            or not safe_relative_ref(path)
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

    @model_validator(mode="after")
    def validate_extended_metrics(self) -> "TerminalObservation":
        if self.schema_version == "ecos.terminal_observation.v2":
            if (
                self.evaluation_metrics
                or self.evaluation_metrics_complete is not None
                or self.sta_corner_ids
                or self.sta_corner_set_sha256 is not None
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
    def eligible_for_incumbent(self) -> bool:
        return (
            self.evidence_valid
            and self.harden_artifacts_complete
            and self.signoff_gates.passed
            and (
                self.schema_version == "ecos.terminal_observation.v2"
                or self.evaluation_metrics_complete is True
            )
            and self._numeric_eligibility_passed
        )

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


_REQUESTED_LATTICES = {
    OptimizationKnob.TARGET_DENSITY: tuple(round(0.1 + 0.05 * i, 2) for i in range(14))
    + (0.8, 0.825, 0.85, 0.875, 0.9, 0.925, 0.95),
    OptimizationKnob.TARGET_OVERFLOW: (
        0.0,
        0.02,
        0.04,
        0.06,
        0.07,
        0.08,
        0.085,
        0.09,
        0.095,
        0.1,
        0.105,
        0.11,
        0.115,
        0.12,
        0.13,
        0.14,
        0.16,
        0.2,
        0.3,
        0.4,
        0.5,
        0.75,
        1.0,
    ),
    OptimizationKnob.DENSITY_WEIGHT: (
        0.00001,
        0.000025,
        0.00005,
        0.0001,
        0.00025,
        0.0005,
        0.00065,
        0.00075,
        0.00085,
        0.001,
        0.00125,
        0.0015,
        0.002,
        0.0025,
        0.0035,
        0.005,
        0.0075,
        0.01,
    ),
    OptimizationKnob.FLOORPLAN_CORE_UTIL: tuple(
        round(0.2 + 0.05 * i, 2) for i in range(16)
    ),
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: (
        0.2,
        0.25,
        0.33,
        0.5,
        0.67,
        0.75,
        1.0,
        1.33,
        1.5,
        2.0,
        3.0,
        4.0,
        5.0,
    ),
}


def _is_requested_lattice_value(knob_id: OptimizationKnob, value: float) -> bool:
    return any(
        math.isclose(value, item, abs_tol=1e-12)
        for item in _REQUESTED_LATTICES[knob_id]
    )
