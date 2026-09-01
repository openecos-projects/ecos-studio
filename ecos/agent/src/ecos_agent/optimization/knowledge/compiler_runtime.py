"""Deterministic knowledge matching and claim-to-action compilation."""

from __future__ import annotations

import math
from collections.abc import Mapping

from ecos_agent.ecc_contracts import ECCStepName
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
from ecos_agent.optimization.knowledge.compiler import (
    _APPLICABILITY_RANK,
    _PLANNER_CLAIM_LIMIT,
    _RULE_REGISTRY,
    _SHA256,
    BoundKnowledgeAction,
    GeneralDomainClaim,
    KnowledgeApplicability,
    KnowledgeMatch,
    KnowledgeSupportCatalog,
    OptimizationStateEvidenceRequest,
    StateEvidenceFeature,
    StatePredicate,
    StateValue,
    SupportedActionView,
    SupportedKnowledgeAction,
    VersionBoundToolBinding,
)
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.parameters.semantics import card_hash, load_parameter_cards


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
        expected_ref = f"knowledge/optimization/{action.knob_id}.json"
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
