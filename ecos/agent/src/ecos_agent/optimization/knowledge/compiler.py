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


def build_state_evidence_request(
    *,
    task_id: str,
    retrieval_request_sha256: str,
    observation: StageObservation,
    current_values: Mapping[str, bool | int | float],
    primary_metric: ObjectiveMetric | None = None,
    preserve_metrics: tuple[ObjectiveMetric, ...] = (),
    incumbent: TerminalObservation | None = None,
    reference_metrics: Mapping[str, float] | None = None,
    reference_sha256: str | None = None,
    historical_metrics: tuple[Mapping[str, float], ...] = (),
    history_sha256: tuple[str, ...] = (),
    extra_features: tuple[StateEvidenceFeature, ...] = (),
) -> OptimizationStateEvidenceRequest:
    observation_ref = ObservationReference(
        observation_id=observation.observation_id,
        sha256=canonical_sha256(observation.model_dump(mode="json")),
    )
    features = {
        metric_id: StateEvidenceFeature(
            feature_id=metric_id,
            value=value,
            evidence_sha256=observation_ref.sha256,
        )
        for metric_id, value in observation.metrics.items()
    }
    for knob_id, value in current_values.items():
        features[knob_id] = StateEvidenceFeature(
            feature_id=knob_id,
            value=value,
            evidence_sha256=observation_ref.sha256,
        )
    for feature in observation.state_evidence:
        features[feature.feature_id] = StateEvidenceFeature(
            feature_id=feature.feature_id,
            value=feature.value,
            evidence_ref=feature.evidence_ref,
            evidence_sha256=feature.evidence_sha256,
        )
    if any(key.startswith("place.") for key in current_values):
        features["current_place_knob_values"] = StateEvidenceFeature(
            feature_id="current_place_knob_values",
            value=True,
            evidence_sha256=observation_ref.sha256,
        )
    if reference_metrics is not None and (
        reference_sha256 is None or not _SHA256.fullmatch(reference_sha256)
    ):
        raise ValueError("reference metrics require a valid evidence hash")
    _add_delta_features(
        features,
        observation,
        (
            {metric.value: value for metric, value in incumbent.metrics.items()}
            if incumbent is not None
            else reference_metrics
        ),
        (
            canonical_sha256(incumbent.model_dump(mode="json"))
            if incumbent is not None
            else reference_sha256
        ),
        observation_ref.sha256,
    )
    _add_trend_features(features, observation, historical_metrics, observation_ref.sha256)
    for feature in extra_features:
        if feature.feature_id in features:
            raise ValueError("extra state evidence duplicates a derived feature")
        features[feature.feature_id] = feature
    return OptimizationStateEvidenceRequest(
        task_id=task_id,
        retrieval_request_sha256=retrieval_request_sha256,
        observation_ref=observation_ref,
        current_stage=observation.stage,
        primary_metric=primary_metric,
        preserve_metrics=preserve_metrics,
        history_sha256=history_sha256,
        features=tuple(features[key] for key in sorted(features)),
    )


def compile_supported_action_view(
    *,
    state: OptimizationStateEvidenceRequest,
    catalog: KnowledgeSupportCatalog,
    candidate_refs: tuple[KnowledgeReference, ...],
    retrieval_ranked_refs: tuple[KnowledgeReference, ...],
    legal_actions: tuple[LegalAction, ...],
    effective_domains: tuple[EffectiveDomainSnapshot, ...],
) -> SupportedActionView:
    candidate_keys = _reference_keys(candidate_refs)
    ranked_keys = _reference_keys(retrieval_ranked_refs)
    if len(candidate_keys) != len(candidate_refs) or not ranked_keys <= candidate_keys:
        raise ValueError("knowledge candidate references are invalid")
    claims = {
        (claim.claim_ref.entity_id, claim.claim_ref.chunk_sha256): claim
        for claim in catalog.claims
    }
    if not candidate_keys <= set(claims):
        raise ValueError("knowledge candidate is absent from the support catalog")
    legal = {(item.knob_id.value, item.direction) for item in legal_actions}
    bindings: dict[str, list[VersionBoundToolBinding]] = {}
    for item in catalog.bindings:
        bindings.setdefault(item.claim_id, []).append(item)
    domains = {item.knob_id.value: item for item in effective_domains}
    features = {item.feature_id: item.value for item in state.features}
    matches: list[KnowledgeMatch] = []
    candidate_actions: list[SupportedKnowledgeAction] = []
    for reference in candidate_refs:
        claim = claims[(reference.entity_id, reference.chunk_sha256)]
        evaluated = _evaluate_bindings(
            claim, bindings.get(claim.claim_ref.entity_id, []), state, features, legal
        )
        binding, applicability, reasons = max(
            evaluated,
            key=lambda item: _APPLICABILITY_RANK[item[1]],
        )
        matches.append(
            KnowledgeMatch(
                claim_ref=claim.claim_ref,
                claim_sha256=claim.claim_sha256,
                applicability=applicability,
                reason_codes=reasons,
            )
        )
        for binding, applicability, reasons in evaluated:
            if binding is None or applicability not in {
                KnowledgeApplicability.PASS,
                KnowledgeApplicability.WEAK,
            }:
                continue
            for action in binding.actions:
                _append_supported_action(
                    candidate_actions,
                    action,
                    binding,
                    claim,
                    applicability,
                    reasons,
                    legal,
                    domains,
                )
    match_rank = {
        (match.claim_ref.entity_id, match.claim_ref.chunk_sha256): _APPLICABILITY_RANK[
            match.applicability
        ]
        for match in matches
    }
    retrieval_rank = {
        (ref.entity_id, ref.chunk_sha256): index
        for index, ref in enumerate(retrieval_ranked_refs)
    }
    actionable_refs = {
        (action.claim_ref.entity_id, action.claim_ref.chunk_sha256): action.claim_ref
        for action in candidate_actions
    }
    ordered_keys = sorted(
        actionable_refs,
        key=lambda key: (
            -match_rank[key],
            retrieval_rank.get(key, len(retrieval_rank)),
            key,
        ),
    )
    exposed_keys = ordered_keys[:_PLANNER_CLAIM_LIMIT]
    exposed = set(exposed_keys)
    actions = tuple(
        sorted(
            (action for action in candidate_actions if _reference_key(action.claim_ref) in exposed),
            key=lambda action: (
                exposed_keys.index(_reference_key(action.claim_ref)),
                action.binding_id,
                action.knob_id.value,
                action.direction.value,
            ),
        )
    )
    return SupportedActionView(
        state=state,
        catalog_sha256=catalog.catalog_sha256,
        candidate_count=len(candidate_refs),
        candidate_refs=candidate_refs,
        retrieval_ranked_refs=retrieval_ranked_refs,
        exposed_claim_refs=tuple(actionable_refs[key] for key in exposed_keys),
        truncated_claim_refs=tuple(
            actionable_refs[key] for key in ordered_keys[_PLANNER_CLAIM_LIMIT:]
        ),
        matches=tuple(matches),
        actions=actions,
    )


def _reference_key(reference: KnowledgeReference) -> tuple[str, str]:
    return reference.entity_id, reference.chunk_sha256


def _reference_keys(references: tuple[KnowledgeReference, ...]) -> set[tuple[str, str]]:
    return {_reference_key(reference) for reference in references}


def _evaluate_bindings(
    claim: GeneralDomainClaim,
    bindings: list[VersionBoundToolBinding],
    state: OptimizationStateEvidenceRequest,
    features: Mapping[str, StateValue],
    legal: set[tuple[str, StrategyDirection]],
) -> tuple[BindingEvaluation, ...]:
    return tuple(
        (binding, *_match_claim(claim, binding, state, features, legal))
        for binding in bindings
    ) or ((None, *_match_claim(claim, None, state, features, legal)),)


def _append_supported_action(
    actions: list[SupportedKnowledgeAction],
    action: BoundKnowledgeAction,
    binding: VersionBoundToolBinding,
    claim: GeneralDomainClaim,
    applicability: KnowledgeApplicability,
    reasons: tuple[str, ...],
    legal: set[tuple[str, StrategyDirection]],
    domains: Mapping[str, EffectiveDomainSnapshot],
) -> None:
    if (action.knob_id, action.direction) not in legal:
        return
    domain = domains.get(action.knob_id)
    allowed_values = _directional_values(domain, action.direction)
    if domain is None or not allowed_values:
        return
    actions.append(
        SupportedKnowledgeAction(
            claim_ref=claim.claim_ref,
            claim_sha256=claim.claim_sha256,
            applicability=applicability,
            reason_codes=reasons,
            binding_id=binding.binding_id,
            binding_sha256=binding.binding_sha256,
            toolchain_ref=binding.toolchain_ref,
            knob_id=OptimizationKnob(action.knob_id),
            direction=action.direction,
            parameter_card_ref=action.parameter_card_ref,
            parameter_card_sha256=action.parameter_card_sha256,
            consumer_ids=action.consumer_ids,
            activation_predicate_ids=action.activation_predicate_ids,
            effective_domain_sha256=domain.snapshot_sha256,
            allowed_requested_values=allowed_values,
            expected_effects=claim.expected_effects,
            guardrails=claim.guardrails,
            anti_conditions=tuple(item.feature_id for item in claim.anti_predicates),
        )
    )


def _directional_values(
    domain: EffectiveDomainSnapshot | None,
    direction: StrategyDirection,
) -> tuple[bool | int | float, ...]:
    if domain is None or domain.current_coordinate is None:
        return ()
    values = domain.allowed_requested_values
    if direction == StrategyDirection.ENABLE:
        return tuple(value for value in values if value is True)
    if direction == StrategyDirection.DISABLE:
        return tuple(value for value in values if value is False)
    anchor = domain.current_coordinate.get("effective_anchor")
    if anchor is None:
        anchor = domain.current_coordinate.get("surface_value")
    if type(anchor) not in {int, float}:
        return ()
    if direction == StrategyDirection.INCREASE:
        return tuple(value for value in values if type(value) in {int, float} and value > anchor)
    return tuple(value for value in values if type(value) in {int, float} and value < anchor)


def _match_claim(
    claim: GeneralDomainClaim,
    binding: VersionBoundToolBinding | None,
    state: OptimizationStateEvidenceRequest,
    features: Mapping[str, StateValue],
    legal: set[tuple[str, StrategyDirection]],
) -> tuple[KnowledgeApplicability, tuple[str, ...]]:
    if state.current_stage.value.casefold() not in {
        stage.casefold() for stage in claim.stages
    }:
        return KnowledgeApplicability.BLOCKED, ("incompatible_stage",)
    if binding is None:
        return KnowledgeApplicability.BLOCKED, ("unsupported_action",)
    if binding.claim_sha256 != claim.claim_sha256:
        return KnowledgeApplicability.BLOCKED, ("stale_binding",)
    anti = [_evaluate(item, features) for item in claim.anti_predicates]
    if any(value is True for value in anti):
        return KnowledgeApplicability.BLOCKED, ("anti_condition",)
    state_matches = [_evaluate(item, features) for item in claim.state_predicates]
    if any(value is False for value in state_matches):
        return KnowledgeApplicability.BLOCKED, ("state_condition",)
    required = [
        value
        for predicate, value in zip((*claim.state_predicates, *claim.anti_predicates), (*state_matches, *anti))
        if predicate.required
    ]
    if any(value is None for value in required):
        return KnowledgeApplicability.UNKNOWN, ("missing_observation",)
    supported = any((item.knob_id, item.direction) in legal for item in binding.actions)
    if not supported:
        return KnowledgeApplicability.BLOCKED, ("unsupported_action",)
    weak = any(value is None for value in (*state_matches, *anti))
    return (
        KnowledgeApplicability.WEAK if weak else KnowledgeApplicability.PASS,
        ("optional_observation_missing",) if weak else (),
    )


def knowledge_support_catalog_from_bundles(
    bundles: tuple[KnowledgeBundle, ...],
) -> KnowledgeSupportCatalog:
    raw_support = [
        entity.support
        for bundle in bundles
        for entity in bundle.entities
        if entity.support is not None
    ]
    claims = tuple(
        GeneralDomainClaim.model_validate(item["claim"])
        for item in raw_support
    )
    bindings = tuple(
        VersionBoundToolBinding.model_validate(item["binding"])
        for item in raw_support
        if item.get("binding") is not None
    )
    for binding in bindings:
        _validate_parameter_card_bindings(binding)
    return KnowledgeSupportCatalog(
        catalog_sha256=canonical_sha256(raw_support),
        claims=claims,
        bindings=bindings,
    )


def _validate_parameter_card_bindings(binding: VersionBoundToolBinding) -> None:
    cards = load_parameter_cards()
    for action in binding.actions:
        try:
            knob = OptimizationKnob(action.knob_id)
            card = cards[knob]
        except (KeyError, ValueError) as exc:
            raise ValueError("binding parameter card is unavailable") from exc
        expected_ref = (
            "knowledge/optimization/parameter-effectiveness/cards/"
            f"{action.knob_id}.json"
        )
        if (
            action.parameter_card_ref != expected_ref
            or action.parameter_card_sha256 != card_hash(card)
            or action.consumer_ids != tuple(item.consumer_id for item in card.consumers)
            or action.activation_predicate_ids != card.runtime_probe_ids
        ):
            raise ValueError("binding parameter card evidence does not match")


def _evaluate(predicate: StatePredicate, features: Mapping[str, StateValue]) -> bool | None:
    if predicate.feature_id not in features:
        return None
    value = features[predicate.feature_id]
    op = _RULE_REGISTRY.get(predicate.rule_ref)
    if op is None or op != predicate.op:
        return False
    if op == "present":
        return True
    if op == "true":
        return value is True
    if op == "false":
        return value is False
    if op in {"positive", "zero", "negative"}:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        return {
            "positive": value > 0,
            "zero": value == 0,
            "negative": value < 0,
        }[op]
    return value == op


def _add_delta_features(
    features: dict[str, StateEvidenceFeature],
    observation: StageObservation,
    reference_metrics: Mapping[str, float] | None,
    reference_sha256: str | None,
    observation_sha256: str,
) -> None:
    if reference_metrics is None or reference_sha256 is None:
        return
    evidence_sha256 = canonical_sha256(
        [observation_sha256, reference_sha256]
    )
    for metric_id, baseline in reference_metrics.items():
        if metric_id in observation.metrics:
            feature_id = f"delta.{metric_id}"
            features[feature_id] = StateEvidenceFeature(
                feature_id=feature_id,
                value=observation.metrics[metric_id] - baseline,
                evidence_sha256=evidence_sha256,
            )


def _add_trend_features(
    features: dict[str, StateEvidenceFeature],
    observation: StageObservation,
    history: tuple[Mapping[str, float], ...],
    observation_sha256: str,
) -> None:
    if not history:
        return
    previous = history[-1]
    evidence_sha256 = canonical_sha256([observation_sha256, dict(sorted(previous.items()))])
    for metric_id, current in observation.metrics.items():
        if metric_id not in previous:
            continue
        delta = current - previous[metric_id]
        feature_id = f"trend.{metric_id}"
        features[feature_id] = StateEvidenceFeature(
            feature_id=feature_id,
            value="increasing" if delta > 0 else "decreasing" if delta < 0 else "stable",
            evidence_sha256=evidence_sha256,
        )
