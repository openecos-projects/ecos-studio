"""Deterministic state matching and claim-to-action compilation."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType
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
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.hashing import canonical_sha256
from ecos_agent.knowledge.bundle import KnowledgeBundle
from ecos_agent.optimization.contracts import (
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    ObservationReference,
    OptimizationKnob,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
StateValue = StrictBool | StrictInt | StrictFloat | str
_RULE_REGISTRY = MappingProxyType(
    {
        "rules.evidence.present.v1": "present",
        "rules.anti_condition.absent.v1": "true",
        "rules.boolean.true.v1": "true",
        "rules.boolean.false.v1": "false",
        "rules.numeric.positive.v1": "positive",
        "rules.numeric.zero.v1": "zero",
        "rules.numeric.negative.v1": "negative",
        "rules.trend.increasing.v1": "increasing",
        "rules.trend.decreasing.v1": "decreasing",
        "rules.trend.stable.v1": "stable",
    }
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class KnowledgeApplicability(StrEnum):
    PASS = "pass"
    WEAK = "weak"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"


_APPLICABILITY_RANK = MappingProxyType(
    {
        KnowledgeApplicability.BLOCKED: 0,
        KnowledgeApplicability.UNKNOWN: 1,
        KnowledgeApplicability.WEAK: 2,
        KnowledgeApplicability.PASS: 3,
    }
)
_PLANNER_CLAIM_LIMIT = 3


class StatePredicate(_Model):
    feature_id: str
    op: Literal[
        "present",
        "true",
        "false",
        "positive",
        "zero",
        "negative",
        "increasing",
        "decreasing",
        "stable",
    ]
    rule_ref: str
    required: bool = True

    @field_validator("feature_id", "rule_ref")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("state predicate identifier is invalid")
        return value

    @model_validator(mode="after")
    def validate_frozen_rule(self) -> StatePredicate:
        if _RULE_REGISTRY.get(self.rule_ref) != self.op:
            raise ValueError("state predicate rule is unknown or mismatched")
        return self


class StateEvidenceFeature(_Model):
    feature_id: str
    value: StateValue
    evidence_ref: str | None = None
    evidence_sha256: str

    @field_validator("feature_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("state feature identifier is invalid")
        return value

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: StateValue) -> StateValue:
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("state feature value must be finite")
        if isinstance(value, str) and value not in {"increasing", "decreasing", "stable"}:
            raise ValueError("state feature trend is invalid")
        return value

    @field_validator("evidence_ref")
    @classmethod
    def validate_ref(cls, value: str | None) -> str | None:
        if value is not None and (
            not value or value.startswith("/") or ".." in value.split("/")
        ):
            raise ValueError("state feature evidence reference is invalid")
        return value

    @field_validator("evidence_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("state feature evidence hash is invalid")
        return value


class GeneralDomainClaim(_Model):
    schema_version: Literal["ecos.general_domain_claim.v1"] = "ecos.general_domain_claim.v1"
    claim_ref: KnowledgeReference
    claim_sha256: str
    stages: tuple[str, ...] = Field(min_length=1)
    state_predicates: tuple[StatePredicate, ...] = Field(min_length=1)
    anti_predicates: tuple[StatePredicate, ...] = ()
    required_evidence: tuple[str, ...] = ()
    action_intents: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    expected_effects: tuple[str, ...] = ()
    guardrails: tuple[str, ...] = ()

    @field_validator("claim_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("claim hash is invalid")
        return value

    @field_validator("stages")
    @classmethod
    def validate_stages(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value) or any(not _ID.fullmatch(item) for item in value):
            raise ValueError("claim stages are invalid")
        return value

    @field_validator(
        "required_evidence", "action_intents", "evidence_refs", "expected_effects", "guardrails"
    )
    @classmethod
    def validate_labels(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value) or any(not item or len(item) > 128 for item in value):
            raise ValueError("claim labels are invalid")
        return value

    @field_validator("evidence_refs")
    @classmethod
    def validate_evidence_refs(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(
            not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,127}@sha256:[0-9a-f]{64}", item)
            for item in value
        ):
            raise ValueError("claim evidence references are invalid")
        return value

    @model_validator(mode="after")
    def validate_required_evidence(self) -> GeneralDomainClaim:
        predicates = {item.feature_id for item in self.state_predicates if item.required}
        if not set(self.required_evidence) <= predicates:
            raise ValueError("claim required evidence lacks a required predicate")
        return self


class BoundKnowledgeAction(_Model):
    knob_id: str
    direction: StrategyDirection
    parameter_card_ref: str | None = None
    parameter_card_sha256: str | None = None
    consumer_ids: tuple[str, ...] = ()
    activation_predicate_ids: tuple[str, ...] = ()

    @field_validator("knob_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("bound knob identifier is invalid")
        return value

    @field_validator("consumer_ids", "activation_predicate_ids")
    @classmethod
    def validate_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value) or any(not _ID.fullmatch(item) for item in value):
            raise ValueError("bound action identifiers are invalid")
        return value

    @field_validator("parameter_card_ref")
    @classmethod
    def validate_card_ref(cls, value: str | None) -> str | None:
        if value is not None and (
            not value or value.startswith("/") or ".." in value.split("/")
        ):
            raise ValueError("parameter card reference is invalid")
        return value

    @field_validator("parameter_card_sha256")
    @classmethod
    def validate_card_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("parameter card hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_card_binding(self) -> BoundKnowledgeAction:
        if (self.parameter_card_ref is None) != (self.parameter_card_sha256 is None):
            raise ValueError("parameter card binding is incomplete")
        return self


class VersionBoundToolBinding(_Model):
    schema_version: Literal["ecos.version_bound_tool_binding.v1"] = (
        "ecos.version_bound_tool_binding.v1"
    )
    binding_id: str
    binding_sha256: str
    claim_id: str
    claim_sha256: str
    toolchain_ref: str
    actions: tuple[BoundKnowledgeAction, ...] = Field(min_length=1)
    consumer_ids: tuple[str, ...] = ()
    activation_predicate_ids: tuple[str, ...] = ()

    @field_validator("binding_id", "claim_id")
    @classmethod
    def validate_id(cls, value: str | None) -> str | None:
        if value is not None and not _ID.fullmatch(value):
            raise ValueError("binding identifier is invalid")
        return value

    @field_validator("consumer_ids", "activation_predicate_ids")
    @classmethod
    def validate_consumers(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value) or any(not _ID.fullmatch(item) for item in value):
            raise ValueError("binding consumers are invalid")
        return value

    @field_validator("binding_sha256", "claim_sha256", "toolchain_ref")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("binding hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_action_evidence(self) -> VersionBoundToolBinding:
        action_consumers = {
            consumer_id for action in self.actions for consumer_id in action.consumer_ids
        }
        action_predicates = {
            predicate_id
            for action in self.actions
            for predicate_id in action.activation_predicate_ids
        }
        if action_consumers and action_consumers != set(self.consumer_ids):
            raise ValueError("binding consumers do not match parameter cards")
        if action_predicates and action_predicates != set(self.activation_predicate_ids):
            raise ValueError("binding activation predicates do not match parameter cards")
        return self


class KnowledgeSupportCatalog(_Model):
    schema_version: Literal["ecos.knowledge_support_catalog.v1"] = (
        "ecos.knowledge_support_catalog.v1"
    )
    catalog_sha256: str
    claims: tuple[GeneralDomainClaim, ...]
    bindings: tuple[VersionBoundToolBinding, ...]

    @field_validator("catalog_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("support catalog hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_unique_ids(self) -> KnowledgeSupportCatalog:
        claim_ids = [item.claim_ref.entity_id for item in self.claims]
        binding_ids = [(item.binding_id, item.claim_id) for item in self.bindings]
        if len(set(claim_ids)) != len(claim_ids) or len(set(binding_ids)) != len(binding_ids):
            raise ValueError("support catalog identifiers must be unique")
        return self


class OptimizationStateEvidenceRequest(_Model):
    schema_version: Literal["ecos.optimization_state_evidence_request.v1"] = (
        "ecos.optimization_state_evidence_request.v1"
    )
    task_id: str
    retrieval_request_sha256: str
    observation_ref: ObservationReference
    current_stage: ECCStepName
    primary_metric: ObjectiveMetric | None = None
    preserve_metrics: tuple[ObjectiveMetric, ...] = ()
    history_sha256: tuple[str, ...] = ()
    features: tuple[StateEvidenceFeature, ...]

    @field_validator("task_id")
    @classmethod
    def validate_task_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("state evidence task id is invalid")
        return value

    @field_validator("retrieval_request_sha256", "history_sha256")
    @classmethod
    def validate_hashes(cls, value: str | tuple[str, ...]):
        values = (value,) if isinstance(value, str) else value
        if any(not _SHA256.fullmatch(item) for item in values):
            raise ValueError("state evidence hash is invalid")
        return value

    @field_validator("features")
    @classmethod
    def validate_features(
        cls, value: tuple[StateEvidenceFeature, ...]
    ) -> tuple[StateEvidenceFeature, ...]:
        ids = [item.feature_id for item in value]
        if ids != sorted(ids) or len(set(ids)) != len(ids):
            raise ValueError("state evidence features must be sorted and unique")
        return value

    @property
    def request_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class KnowledgeMatch(_Model):
    claim_ref: KnowledgeReference
    claim_sha256: str
    applicability: KnowledgeApplicability
    reason_codes: tuple[str, ...]


class SupportedKnowledgeAction(KnowledgeMatch):
    binding_id: str
    binding_sha256: str
    toolchain_ref: str
    knob_id: OptimizationKnob
    direction: StrategyDirection
    parameter_card_ref: str | None = None
    parameter_card_sha256: str | None = None
    consumer_ids: tuple[str, ...] = ()
    activation_predicate_ids: tuple[str, ...] = ()
    effective_domain_sha256: str
    allowed_requested_values: tuple[StrictBool | StrictInt | StrictFloat, ...]
    expected_effects: tuple[str, ...]
    guardrails: tuple[str, ...]
    anti_conditions: tuple[str, ...]

    @field_validator("effective_domain_sha256")
    @classmethod
    def validate_domain_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("effective domain hash is invalid")
        return value


class SupportedActionView(_Model):
    schema_version: Literal["ecos.supported_action_view.v2"] = (
        "ecos.supported_action_view.v2"
    )
    state: OptimizationStateEvidenceRequest
    catalog_sha256: str
    candidate_count: int = Field(ge=0)
    candidate_refs: tuple[KnowledgeReference, ...]
    retrieval_ranked_refs: tuple[KnowledgeReference, ...]
    exposed_claim_refs: tuple[KnowledgeReference, ...]
    truncated_claim_refs: tuple[KnowledgeReference, ...]
    selection_policy: Literal["applicability_bm25_entity.v1"] = (
        "applicability_bm25_entity.v1"
    )
    matches: tuple[KnowledgeMatch, ...]
    actions: tuple[SupportedKnowledgeAction, ...]

    @model_validator(mode="after")
    def validate_selection_audit(self) -> SupportedActionView:
        candidates = _reference_keys(self.candidate_refs)
        ranked = _reference_keys(self.retrieval_ranked_refs)
        exposed = _reference_keys(self.exposed_claim_refs)
        truncated = _reference_keys(self.truncated_claim_refs)
        matched = _reference_keys(tuple(item.claim_ref for item in self.matches))
        action_refs = _reference_keys(tuple(item.claim_ref for item in self.actions))
        if self.candidate_count != len(self.candidate_refs) or len(candidates) != len(
            self.candidate_refs
        ):
            raise ValueError("supported action candidate audit is invalid")
        if (
            len(self.matches) != self.candidate_count
            or matched != candidates
            or len(ranked) != len(self.retrieval_ranked_refs)
            or not ranked <= candidates
        ):
            raise ValueError("supported action candidate matches are invalid")
        if (
            len(exposed) != len(self.exposed_claim_refs)
            or len(exposed) > _PLANNER_CLAIM_LIMIT
            or len(truncated) != len(self.truncated_claim_refs)
        ):
            raise ValueError("supported action exposure is invalid")
        if not ((exposed | truncated) <= candidates) or exposed & truncated:
            raise ValueError("supported action truncation audit is invalid")
        if action_refs != exposed:
            raise ValueError("supported actions include an unexposed claim")
        return self

    @property
    def view_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))

    def planner_payload(self) -> dict[str, object]:
        exposed = _reference_keys(self.exposed_claim_refs)
        return {
            "schema_version": "ecos.supported_action_view.planner.v1",
            "state": self.state.model_dump(mode="json"),
            "catalog_sha256": self.catalog_sha256,
            "candidate_count": self.candidate_count,
            "exposed_count": len(self.exposed_claim_refs),
            "exposed_claim_refs": [
                item.model_dump(mode="json") for item in self.exposed_claim_refs
            ],
            "selection_policy": self.selection_policy,
            "matches": [
                item.model_dump(mode="json")
                for item in self.matches
                if _reference_key(item.claim_ref) in exposed
            ],
            "actions": [item.model_dump(mode="json") for item in self.actions],
            "audit_sha256": self.view_sha256,
        }


BindingEvaluation = tuple[
    VersionBoundToolBinding | None, KnowledgeApplicability, tuple[str, ...]
]



from ecos_agent.optimization.knowledge.compiler_runtime import (  # noqa: E402
    _add_delta_features,
    _add_trend_features,
    _append_supported_action,
    _directional_values,
    _evaluate,
    _evaluate_bindings,
    _match_claim,
    _reference_key,
    _reference_keys,
    _validate_parameter_card_bindings,
    build_state_evidence_request,
    compile_supported_action_view,
    knowledge_support_catalog_from_bundles,
)
