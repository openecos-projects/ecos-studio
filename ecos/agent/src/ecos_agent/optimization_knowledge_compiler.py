"""Deterministic state matching and claim-to-action compilation."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
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
from ecos_agent.knowledge_bundle import KnowledgeBundle
from ecos_agent.optimization_contracts import (
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    ObservationReference,
    OptimizationKnob,
    StageObservation,
    StrategyDirection,
    TerminalObservation,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
StateValue = StrictBool | StrictInt | StrictFloat | str


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class KnowledgeApplicability(StrEnum):
    PASS = "pass"
    WEAK = "weak"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"


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


class StateEvidenceFeature(_Model):
    feature_id: str
    value: StateValue
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

    @field_validator("expected_effects", "guardrails")
    @classmethod
    def validate_labels(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(value)) != len(value) or any(not item or len(item) > 128 for item in value):
            raise ValueError("claim labels are invalid")
        return value


class BoundKnowledgeAction(_Model):
    knob_id: str
    direction: StrategyDirection

    @field_validator("knob_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("bound knob identifier is invalid")
        return value


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
    activation_predicate_id: str | None = None

    @field_validator("binding_id", "claim_id", "activation_predicate_id")
    @classmethod
    def validate_id(cls, value: str | None) -> str | None:
        if value is not None and not _ID.fullmatch(value):
            raise ValueError("binding identifier is invalid")
        return value

    @field_validator("consumer_ids")
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
    expected_effects: tuple[str, ...]
    guardrails: tuple[str, ...]
    anti_conditions: tuple[str, ...]


class SupportedActionView(_Model):
    schema_version: Literal["ecos.supported_action_view.v1"] = (
        "ecos.supported_action_view.v1"
    )
    state: OptimizationStateEvidenceRequest
    catalog_sha256: str
    matches: tuple[KnowledgeMatch, ...]
    actions: tuple[SupportedKnowledgeAction, ...]

    @property
    def view_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


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
    retrieved_refs: tuple[KnowledgeReference, ...],
    legal_actions: tuple[LegalAction, ...],
) -> SupportedActionView:
    retrieved = {(item.entity_id, item.chunk_sha256) for item in retrieved_refs}
    legal = {(item.knob_id.value, item.direction) for item in legal_actions}
    bindings = {item.claim_id: item for item in catalog.bindings}
    features = {item.feature_id: item.value for item in state.features}
    matches: list[KnowledgeMatch] = []
    actions: list[SupportedKnowledgeAction] = []
    for claim in catalog.claims:
        if (claim.claim_ref.entity_id, claim.claim_ref.chunk_sha256) not in retrieved:
            continue
        binding = bindings.get(claim.claim_ref.entity_id)
        applicability, reasons = _match_claim(claim, binding, state, features, legal)
        matches.append(
            KnowledgeMatch(
                claim_ref=claim.claim_ref,
                claim_sha256=claim.claim_sha256,
                applicability=applicability,
                reason_codes=reasons,
            )
        )
        if binding is None or applicability not in {
            KnowledgeApplicability.PASS,
            KnowledgeApplicability.WEAK,
        }:
            continue
        for action in binding.actions:
            if (action.knob_id, action.direction) not in legal:
                continue
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
                    expected_effects=claim.expected_effects,
                    guardrails=claim.guardrails,
                    anti_conditions=tuple(item.feature_id for item in claim.anti_predicates),
                )
            )
    return SupportedActionView(
        state=state,
        catalog_sha256=catalog.catalog_sha256,
        matches=tuple(matches),
        actions=tuple(actions),
    )


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
    return KnowledgeSupportCatalog(
        catalog_sha256=canonical_sha256(raw_support),
        claims=claims,
        bindings=bindings,
    )


def _evaluate(predicate: StatePredicate, features: Mapping[str, StateValue]) -> bool | None:
    if predicate.feature_id not in features:
        return None
    value = features[predicate.feature_id]
    if predicate.op == "present":
        return True
    if predicate.op == "true":
        return value is True
    if predicate.op == "false":
        return value is False
    if predicate.op in {"positive", "zero", "negative"}:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        return {
            "positive": value > 0,
            "zero": value == 0,
            "negative": value < 0,
        }[predicate.op]
    return value == predicate.op


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
