"""Hash-bound contracts for parameter effectiveness evidence.

The module is intentionally independent from ECC implementation details.  ECC
produces these payloads; the Agent only validates and consumes them.
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

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

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    HistoryReference,
    KnowledgeReference,
    ObservationReference,
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationTaskMemoryReference,
    ProposalContextRef,
    StrategyDirection,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
Scalar = StrictBool | StrictInt | StrictFloat


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class ToolRef(_Model):
    name: str
    revision: str
    source_sha256: str | None = None

    @field_validator("name", "revision")
    @classmethod
    def text(cls, value: str) -> str:
        if not value.strip() or len(value) > 256:
            raise ValueError("tool reference is invalid")
        return value.strip()

    @field_validator("source_sha256")
    @classmethod
    def hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("tool source hash is invalid")
        return value


class SurfaceRef(_Model):
    file: str
    json_path: tuple[str | int, ...]
    type: Literal["bool", "int", "float", "string"]
    unit: str

    @field_validator("file")
    @classmethod
    def safe_file(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in value.split("/"):
            raise ValueError("surface file must be relative")
        return value


class RequestedDomain(_Model):
    values: tuple[Scalar, ...] = Field(min_length=1)

    @field_validator("values")
    @classmethod
    def finite(cls, values: tuple[Scalar, ...]) -> tuple[Scalar, ...]:
        if len(set(values)) != len(values):
            raise ValueError("requested domain values must be unique")
        if any(isinstance(v, float) and not math.isfinite(v) for v in values):
            raise ValueError("requested domain contains a non-finite value")
        return values


class CardSourceSpan(_Model):
    span_id: str | None = None
    role: Literal[
        "runtime_report_producer",
        "native_normalization",
        "native_consumer",
        "native_predicate",
        "native_adaptive_update",
    ] = "runtime_report_producer"
    file: str
    start: StrictInt
    end: StrictInt
    sha256: str

    @field_validator("span_id")
    @classmethod
    def valid_span_id(cls, value: str | None) -> str | None:
        if value is not None and not _ID.fullmatch(value):
            raise ValueError("source span id is invalid")
        return value

    @field_validator("file")
    @classmethod
    def safe_file(cls, value: str) -> str:
        if not value or value.startswith("/") or ".." in value.split("/"):
            raise ValueError("source span file must be relative")
        return value

    @field_validator("sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("source span hash is invalid")
        return value

    @model_validator(mode="after")
    def valid_range(self) -> "CardSourceSpan":
        if self.start < 1 or self.end < self.start:
            raise ValueError("source span range is invalid")
        return self


class CardActivationCondition(_Model):
    kind: str
    predicate: str | None = None
    source_span_ids: tuple[str, ...] = ()


class CardConsumer(_Model):
    consumer_id: str
    event: Literal["entered", "evaluated", "geometry_constructed"]
    role: str | None = None
    source_span_ids: tuple[str, ...] = ()


class CardMetricRelevance(_Model):
    metric_id: str
    relation: Literal[
        "objective_input",
        "stopping_predicate",
        "geometry_input",
        "activation_gate",
        "runtime_observation",
    ]
    source_span_ids: tuple[str, ...] = Field(min_length=1)


class CardInteraction(_Model):
    knob_id: OptimizationKnob
    relation: Literal[
        "shared_objective",
        "conditional_activation",
        "runtime_reinitialization",
    ]
    source_span_ids: tuple[str, ...] = Field(min_length=1)


class CardInvalidationRule(_Model):
    kind: Literal[
        "global_place_disabled",
        "no_consumer_observation",
        "zero_effective_value",
        "no_routability_round",
    ]
    result: Literal["unknown", "not_activated"]
    source_span_ids: tuple[str, ...] = Field(min_length=1)


class CardRuntimeSemantics(_Model):
    mechanism: str
    source_span_ids: tuple[str, ...] = Field(min_length=1)
    metric_relevance: tuple[CardMetricRelevance, ...] = ()
    interactions: tuple[CardInteraction, ...] = ()
    invalidation_rules: tuple[CardInvalidationRule, ...] = ()


class ParameterSemanticsCard(_Model):
    schema_version: Literal["ecos.parameter_semantics_card.v1"] = (
        "ecos.parameter_semantics_card.v1"
    )
    knob_id: OptimizationKnob
    tool: ToolRef
    stage: str
    surface: SurfaceRef
    requested_domain: RequestedDomain
    write_mapping: dict[str, Any]
    resolution_rules: tuple[dict[str, Any], ...] = ()
    activation_conditions: tuple[CardActivationCondition, ...] = ()
    consumers: tuple[CardConsumer, ...] = ()
    runtime_probe_ids: tuple[str, ...] = ()
    source_spans: tuple[CardSourceSpan, ...] = ()
    runtime_semantics: CardRuntimeSemantics | None = None
    review: dict[str, Any]

    @field_validator("stage")
    @classmethod
    def valid_stage(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("card stage is required")
        return value

    @field_validator("runtime_probe_ids")
    @classmethod
    def valid_probe_ids(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(values)) != len(values) or any(not _ID.fullmatch(v) for v in values):
            raise ValueError("runtime probe ids are invalid")
        return values

    @model_validator(mode="after")
    def source_references_exist(self) -> "ParameterSemanticsCard":
        span_ids = [
            span.span_id for span in self.source_spans if span.span_id is not None
        ]
        if len(span_ids) != len(set(span_ids)):
            raise ValueError("parameter card source span ids must be unique")
        references = {
            source_id
            for item in (*self.activation_conditions, *self.consumers)
            for source_id in item.source_span_ids
        }
        if self.runtime_semantics is not None:
            references.update(self.runtime_semantics.source_span_ids)
            for item in (
                *self.runtime_semantics.metric_relevance,
                *self.runtime_semantics.interactions,
                *self.runtime_semantics.invalidation_rules,
            ):
                references.update(item.source_span_ids)
        if references - set(span_ids):
            raise ValueError("parameter card source reference is invalid")
        return self


class CardManifest(_Model):
    schema_version: Literal["ecos.parameter_semantics_manifest.v1"] = (
        "ecos.parameter_semantics_manifest.v1"
    )
    lattice_version: str
    cards: tuple[dict[str, str], ...] = Field(min_length=8, max_length=8)
    manifest_sha256: str

    @field_validator("cards")
    @classmethod
    def unique_cards(
        cls, value: tuple[dict[str, str], ...]
    ) -> tuple[dict[str, str], ...]:
        ids = [item.get("knob_id") for item in value]
        if len(set(ids)) != len(ids) or any(
            not isinstance(item.get("path"), str) for item in value
        ):
            raise ValueError("manifest cards must be unique and path-bound")
        return value

    @field_validator("lattice_version")
    @classmethod
    def valid_lattice(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("lattice version is invalid")
        return value

    @field_validator("manifest_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("manifest hash is invalid")
        return value

    @model_validator(mode="after")
    def verify_hash(self) -> "CardManifest":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"manifest_sha256"})
        )
        if expected != self.manifest_sha256:
            raise ValueError("manifest hash does not match")
        return self


class MaterializationRef(_Model):
    receipt_ref: str
    receipt_sha256: str
    registry_sha256: str
    patch_sha256: str
    candidate_ref: str
    parent_ref: str | None = None
    workspace_ref: str
    target_step: str | None = None
    config_ref: str | None = None
    config_before_sha256: str
    config_after_sha256: str
    before_snapshot_ref: str | None = None
    before_snapshot_sha256: str | None = None
    after_snapshot_ref: str | None = None
    after_snapshot_sha256: str | None = None
    written_value: Scalar = Field(
        description="The value actually written to the tool input, after unit mapping."
    )
    unit: str
    parent_manifest_ref: str | None = None
    parent_manifest_sha256: str | None = None
    parent_state_sha256: str | None = None

    @field_validator(
        "receipt_sha256",
        "registry_sha256",
        "patch_sha256",
        "config_before_sha256",
        "config_after_sha256",
    )
    @classmethod
    def hashes(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("materialization hash is invalid")
        return value

    @field_validator(
        "before_snapshot_sha256",
        "after_snapshot_sha256",
        "parent_manifest_sha256",
        "parent_state_sha256",
    )
    @classmethod
    def optional_hashes(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("materialization hash is invalid")
        return value

    @field_validator(
        "receipt_ref",
        "candidate_ref",
        "workspace_ref",
        "parent_ref",
        "config_ref",
        "before_snapshot_ref",
        "after_snapshot_ref",
        "parent_manifest_ref",
    )
    @classmethod
    def refs(cls, value: str | None) -> str | None:
        if value is not None and (
            not value or value.startswith("/") or ".." in value.split("/")
        ):
            raise ValueError("materialization reference must be relative")
        return value

    @field_validator("target_step")
    @classmethod
    def target(cls, value: str | None) -> str | None:
        if value is not None and not value:
            raise ValueError("materialization target step is invalid")
        return value

    @model_validator(mode="after")
    def complete_binding(self) -> "MaterializationRef":
        binding = (
            self.target_step,
            self.config_ref,
            self.before_snapshot_ref,
            self.before_snapshot_sha256,
            self.after_snapshot_ref,
            self.after_snapshot_sha256,
        )
        if any(value is not None for value in binding) and any(
            value is None for value in binding
        ):
            raise ValueError("materialization config binding is incomplete")
        parent_manifest = (self.parent_manifest_ref, self.parent_manifest_sha256)
        if self.parent_ref is None and any(
            value is not None for value in parent_manifest
        ):
            raise ValueError("materialization parent binding is unexpected")
        if self.parent_ref is not None and (
            any(value is None for value in parent_manifest)
            or self.parent_state_sha256 is None
        ):
            raise ValueError("materialization parent binding is incomplete")
        return self


class RuntimeTransition(_Model):
    sequence: StrictInt = Field(ge=0)
    from_state: str = Field(alias="from")
    to: Literal[
        "accepted",
        "materialized",
        "normalized",
        "clamped",
        "overridden",
        "applied",
        "adjusted",
        "superseded",
        "restored",
        "unknown",
    ]
    value: Scalar | None = None
    reason: str
    rule_id: str | None = None
    iteration: StrictInt | None = Field(default=None, ge=0)
    evidence_ref: str | None = None
    evidence_sha256: str | None = None

    @field_validator("from_state", "reason")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip() or len(value) > 256:
            raise ValueError("transition text is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def evidence_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("transition evidence hash is invalid")
        return value


class ConsumerEvidence(_Model):
    consumer_id: str
    outcome: Literal["entered", "evaluated", "geometry_constructed", "updated"]
    evidence_ref: str
    evidence_sha256: str

    @field_validator("consumer_id", "evidence_ref")
    @classmethod
    def valid_text(cls, value: str) -> str:
        if not value.strip() or len(value) > 256:
            raise ValueError("consumer evidence field is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("consumer evidence hash is invalid")
        return value


class ActivationEvidence(_Model):
    status: Literal["used", "not_activated", "unknown"] = Field(
        description=(
            "Whether an allowlisted runtime branch, operator, or consumer used the parameter."
        )
    )
    consumers: tuple[ConsumerEvidence, ...] = ()

    @model_validator(mode="after")
    def require_consumer(self) -> "ActivationEvidence":
        if self.status == "used" and not self.consumers:
            raise ValueError("used activation requires consumer evidence")
        return self


class EffectiveValue(_Model):
    value: Scalar | None
    unit: str


class ParameterApplicationReceipt(_Model):
    """Tool-observed parameter evidence; this alone does not prove QoR improvement."""

    schema_version: Literal["tool.parameter_application_receipt.v1"] = (
        "tool.parameter_application_receipt.v1"
    )
    receipt_id: str
    tool: ToolRef
    context: dict[str, Any]
    requested: dict[str, Any] = Field(
        description=(
            "The proposal intent before materialization; it does not prove what the tool used."
        )
    )
    materialization: MaterializationRef
    effective_initial: EffectiveValue = Field(
        description=(
            "The value the tool accepted after admission, normalization, clamping, or override."
        )
    )
    transitions: tuple[RuntimeTransition, ...] = ()
    application_status: Literal[
        "rejected", "unsupported", "ignored", "applied", "unknown"
    ]
    activation: ActivationEvidence
    consumer_observation: dict[str, Any] | None = None
    effective_final: EffectiveValue = Field(
        description="The value remaining after all recorded runtime adjustments."
    )
    evidence_sha256: str

    @field_validator("receipt_id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("receipt id is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def valid_evidence_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("receipt evidence hash is invalid")
        return value

    @model_validator(mode="after")
    def verify_receipt(self) -> "ParameterApplicationReceipt":
        knob = self.requested.get("knob_id")
        if knob not in {item.value for item in OptimizationKnob}:
            raise ValueError("receipt requested knob is invalid")
        try:
            from ecos_agent.optimization.contracts import RequestedKnobValue

            RequestedKnobValue(knob_id=knob, value=self.requested.get("value"))
        except (TypeError, ValueError):
            raise ValueError("receipt requested value is outside the frozen lattice")
        if not isinstance(self.requested.get("unit"), str) or not self.requested.get(
            "unit"
        ):
            raise ValueError("receipt requested unit is invalid")
        if (
            self.materialization.written_value != self.requested.get("value")
            and knob != OptimizationKnob.CELL_PADDING_X.value
        ):
            raise ValueError("materialization written value does not match request")
        sequences = [item.sequence for item in self.transitions]
        if sequences != list(range(len(sequences))):
            raise ValueError("runtime transition sequence is not contiguous")
        hash_payloads = (
            self.model_dump(mode="json", exclude={"evidence_sha256"}),
            self.model_dump(
                mode="json",
                by_alias=True,
                exclude_unset=True,
                exclude={"evidence_sha256"},
            ),
        )
        if self.consumer_observation is None:
            for payload in hash_payloads:
                payload.pop("consumer_observation", None)
        if self.evidence_sha256 not in {
            canonical_sha256(payload) for payload in hash_payloads
        }:
            raise ValueError("receipt evidence hash does not match content")
        return self


class ExpectedEffectV2(_Model):
    metric_id: ObjectiveMetric
    direction: Literal["increase", "decrease", "unchanged", "unknown"]


class NumericProposalActionV2(_Model):
    claim_id: str | None = None
    claim_sha256: str | None = None
    binding_id: str | None = None
    binding_sha256: str | None = None
    knob_id: OptimizationKnob
    direction: StrategyDirection
    requested_value: Scalar
    effective_domain_sha256: str
    threshold_refs: tuple[str, ...] = ()
    expected_effects: tuple[ExpectedEffectV2, ...] = Field(min_length=1, max_length=3)

    @field_validator("claim_id", "binding_id")
    @classmethod
    def knowledge_id(cls, value: str | None) -> str | None:
        if value is not None and not _ID.fullmatch(value):
            raise ValueError("proposal knowledge identifier is invalid")
        return value

    @field_validator(
        "claim_sha256", "binding_sha256", "effective_domain_sha256"
    )
    @classmethod
    def knowledge_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("proposal knowledge or domain hash is invalid")
        return value

    @model_validator(mode="after")
    def direction_matches_knob(self) -> "NumericProposalActionV2":
        knowledge_binding = (
            self.claim_id,
            self.claim_sha256,
            self.binding_id,
            self.binding_sha256,
        )
        if any(value is not None for value in knowledge_binding) and any(
            value is None for value in knowledge_binding
        ):
            raise ValueError("proposal knowledge binding is incomplete")
        if self.knob_id == OptimizationKnob.ROUTABILITY_OPT:
            if self.direction not in {
                StrategyDirection.ENABLE,
                StrategyDirection.DISABLE,
            }:
                raise ValueError("boolean knob requires enable or disable")
            if type(self.requested_value) is not bool:
                raise ValueError("boolean knob requires a boolean value")
        elif self.direction not in {
            StrategyDirection.INCREASE,
            StrategyDirection.DECREASE,
        }:
            raise ValueError("numeric knob requires increase or decrease")
        return self


class OptimizationProposalV2(_Model):
    schema_version: Literal["ecos.optimization_proposal.v2"] = (
        "ecos.optimization_proposal.v2"
    )
    context_ref: ProposalContextRef
    decision: Literal["continue", "propose", "stop", "escalate"]
    reason_code: str
    rationale_summary: str
    observation_refs: tuple[ObservationReference, ...] = Field(
        min_length=1, max_length=13
    )
    history_refs: tuple[HistoryReference, ...] = ()
    knowledge_refs: tuple[KnowledgeReference, ...] = ()
    task_memory_refs: tuple[OptimizationTaskMemoryReference, ...] = ()
    action: NumericProposalActionV2 | None = None

    @model_validator(mode="after")
    def action_consistency(self) -> "OptimizationProposalV2":
        if self.decision == "propose" and self.action is None:
            raise ValueError("v2 propose requires an action")
        if self.decision != "propose" and self.action is not None:
            raise ValueError("non-propose v2 decisions cannot contain an action")
        return self
