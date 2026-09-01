from __future__ import annotations

import json

import pytest

from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    LegalAction,
    StageEvidenceFeature,
    StageObservation,
)
from ecos_agent.optimization.knowledge.compiler import (
    BoundKnowledgeAction,
    GeneralDomainClaim,
    KnowledgeApplicability,
    KnowledgeSupportCatalog,
    StateEvidenceFeature,
    StatePredicate,
    VersionBoundToolBinding,
    _validate_parameter_card_bindings,
    build_state_evidence_request,
    compile_supported_action_view,
)

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64


def _domain() -> EffectiveDomainSnapshot:
    payload = {
        "schema_version": "ecos.effective_domain.v1",
        "knob_id": "place.target_density",
        "context_sha256": HASH,
        "current_coordinate": {"surface_value": 0.85, "effective_anchor": None},
        "surface_values": (0.65, 0.75, 0.85, 0.95),
        "excluded_aliases": (),
        "allowed_requested_values": (0.65, 0.75, 0.95),
        "thresholds": (),
        "observed_application_signatures": (),
        "observed_response_signatures": (),
    }
    return EffectiveDomainSnapshot(
        **payload, snapshot_sha256=canonical_sha256(payload)
    )


def _observation() -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"route_la_total_overflow": 12.0},
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0)),
    )


def _catalog(*, binding_claim_sha256: str = HASH) -> KnowledgeSupportCatalog:
    claim = GeneralDomainClaim(
        claim_ref=KnowledgeReference(
            entity_id="strategy.congestion.local_density_spreading.v1",
            chunk_sha256=CHUNK_HASH,
        ),
        claim_sha256=HASH,
        stages=("place",),
        state_predicates=(
            StatePredicate(
                feature_id="route_la_total_overflow",
                op="positive",
                rule_ref="rules.numeric.positive.v1",
            ),
            StatePredicate(
                feature_id="local_cell_density_hotspot",
                op="present",
                rule_ref="rules.evidence.present.v1",
            ),
        ),
        anti_predicates=(
            StatePredicate(
                feature_id="long_net_pressure_dominant",
                op="true",
                rule_ref="rules.boolean.true.v1",
            ),
        ),
        expected_effects=("route_la_total_overflow:decrease",),
        guardrails=("route_wirelength",),
    )
    binding = VersionBoundToolBinding(
        binding_id="ecos.place.target_density.decrease.v1",
        binding_sha256="sha256:" + "c" * 64,
        claim_id=claim.claim_ref.entity_id,
        claim_sha256=binding_claim_sha256,
        toolchain_ref="sha256:" + "d" * 64,
        actions=(
            BoundKnowledgeAction(
                knob_id="place.target_density",
                direction="decrease",
            ),
        ),
    )
    return KnowledgeSupportCatalog(
        catalog_sha256="sha256:" + "e" * 64,
        claims=(claim,),
        bindings=(binding,),
    )


def _compile(*features: StateEvidenceFeature, catalog=None):
    catalog = catalog or _catalog()
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
        extra_features=features,
    )
    return compile_supported_action_view(
        state=state,
        catalog=catalog,
        candidate_refs=tuple(claim.claim_ref for claim in catalog.claims),
        retrieval_ranked_refs=tuple(claim.claim_ref for claim in catalog.claims[:3]),
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(_domain(),),
    )


def _multi_claim_catalog(*, count: int, matched_from: int = 0) -> KnowledgeSupportCatalog:
    base = _catalog()
    claims = []
    bindings = []
    for index in range(count):
        suffix = str(index + 1)
        reference = KnowledgeReference(
            entity_id=f"strategy.congestion.candidate_{suffix}.v1",
            chunk_sha256=suffix * 64,
        )
        claim_hash = f"sha256:{suffix * 64}"
        feature_id = (
            "route_la_total_overflow" if index >= matched_from else f"missing_{suffix}"
        )
        claim = base.claims[0].model_copy(
            update={
                "claim_ref": reference,
                "claim_sha256": claim_hash,
                "state_predicates": (
                    StatePredicate(
                        feature_id=feature_id,
                        op="positive",
                        rule_ref="rules.numeric.positive.v1",
                    ),
                ),
                "anti_predicates": (),
            }
        )
        binding = base.bindings[0].model_copy(
            update={
                "binding_id": f"binding.candidate_{suffix}.v1",
                "binding_sha256": claim_hash,
                "claim_id": reference.entity_id,
                "claim_sha256": claim_hash,
            }
        )
        claims.append(claim)
        bindings.append(binding)
    return KnowledgeSupportCatalog(
        catalog_sha256="sha256:" + "e" * 64,
        claims=tuple(claims),
        bindings=tuple(bindings),
    )


def test_compiler_matches_current_metric_and_spatial_evidence() -> None:
    view = _compile(
        StateEvidenceFeature(
            feature_id="local_cell_density_hotspot",
            value=True,
            evidence_sha256="sha256:" + "f" * 64,
        ),
        StateEvidenceFeature(
            feature_id="long_net_pressure_dominant",
            value=False,
            evidence_sha256="sha256:" + "1" * 64,
        ),
    )

    assert view.state.schema_version == "ecos.optimization_state_evidence_request.v1"
    assert view.schema_version == "ecos.supported_action_view.v2"
    assert view.actions[0].applicability == KnowledgeApplicability.PASS
    assert view.actions[0].knob_id == "place.target_density"
    assert view.actions[0].direction == "decrease"
    assert view.actions[0].effective_domain_sha256 == _domain().snapshot_sha256
    assert view.actions[0].allowed_requested_values == (0.65, 0.75)
    assert view.actions[0].claim_sha256 == HASH
    assert view.view_sha256.startswith("sha256:")


def test_compiler_fails_closed_on_missing_and_anti_condition_evidence() -> None:
    missing = _compile()
    blocked = _compile(
        StateEvidenceFeature(
            feature_id="local_cell_density_hotspot",
            value=True,
            evidence_sha256="sha256:" + "f" * 64,
        ),
        StateEvidenceFeature(
            feature_id="long_net_pressure_dominant",
            value=True,
            evidence_sha256="sha256:" + "1" * 64,
        ),
    )

    assert missing.actions == ()
    assert missing.matches[0].applicability == KnowledgeApplicability.UNKNOWN
    assert "missing_observation" in missing.matches[0].reason_codes
    assert blocked.actions == ()
    assert blocked.matches[0].applicability == KnowledgeApplicability.BLOCKED
    assert "anti_condition" in blocked.matches[0].reason_codes


def test_compiler_rejects_stale_binding_and_unsupported_legal_action() -> None:
    stale = _compile(
        StateEvidenceFeature(
            feature_id="local_cell_density_hotspot",
            value=True,
            evidence_sha256="sha256:" + "f" * 64,
        ),
        StateEvidenceFeature(
            feature_id="long_net_pressure_dominant",
            value=False,
            evidence_sha256="sha256:" + "1" * 64,
        ),
        catalog=_catalog(binding_claim_sha256="sha256:" + "9" * 64),
    )
    state = stale.state
    unsupported = compile_supported_action_view(
        state=state,
        catalog=_catalog(),
        candidate_refs=(_catalog().claims[0].claim_ref,),
        retrieval_ranked_refs=(_catalog().claims[0].claim_ref,),
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="increase"),
        ),
        effective_domains=(_domain(),),
    )

    assert stale.actions == ()
    assert stale.matches[0].applicability == KnowledgeApplicability.BLOCKED
    assert "stale_binding" in stale.matches[0].reason_codes
    assert unsupported.actions == ()
    assert "unsupported_action" in unsupported.matches[0].reason_codes


def test_compiler_state_matches_claim_beyond_raw_top_three() -> None:
    catalog = _multi_claim_catalog(count=4, matched_from=3)
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
    )

    view = compile_supported_action_view(
        state=state,
        catalog=catalog,
        candidate_refs=tuple(claim.claim_ref for claim in catalog.claims),
        retrieval_ranked_refs=tuple(claim.claim_ref for claim in catalog.claims[:3]),
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(_domain(),),
    )

    assert view.candidate_count == 4
    assert len(view.matches) == 4
    assert view.exposed_claim_refs == (catalog.claims[3].claim_ref,)
    assert view.actions[0].claim_ref == catalog.claims[3].claim_ref
    assert view.truncated_claim_refs == ()


def test_compiler_exposes_only_three_state_matched_claims_with_audit() -> None:
    catalog = _multi_claim_catalog(count=5)
    ranked = tuple(claim.claim_ref for claim in reversed(catalog.claims[2:5]))
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
    )

    view = compile_supported_action_view(
        state=state,
        catalog=catalog,
        candidate_refs=tuple(claim.claim_ref for claim in catalog.claims),
        retrieval_ranked_refs=ranked,
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(_domain(),),
    )

    assert len(view.matches) == 5
    assert view.exposed_claim_refs == ranked
    assert len({action.claim_ref.entity_id for action in view.actions}) == 3
    assert view.truncated_claim_refs == tuple(
        claim.claim_ref for claim in catalog.claims[:2]
    )
    planner_payload = view.planner_payload()
    planner_json = json.dumps(planner_payload, sort_keys=True)
    assert all(ref.entity_id in planner_json for ref in view.exposed_claim_refs)
    assert all(ref.entity_id not in planner_json for ref in view.truncated_claim_refs)
    assert planner_payload["candidate_count"] == 5
    assert planner_payload["audit_sha256"] == view.view_sha256
    assert "candidate_refs" not in planner_payload
    assert "truncated_claim_refs" not in planner_payload


def test_state_evidence_derives_reference_delta_and_history_trend() -> None:
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
        reference_metrics={"route_la_total_overflow": 10.0},
        reference_sha256="sha256:" + "2" * 64,
        historical_metrics=({"route_la_total_overflow": 8.0},),
    )
    features = {item.feature_id: item.value for item in state.features}

    assert features["delta.route_la_total_overflow"] == 2.0
    assert features["trend.route_la_total_overflow"] == "increasing"


def test_state_predicate_rejects_unknown_or_mismatched_frozen_rule() -> None:
    with pytest.raises(ValueError, match="rule"):
        StatePredicate(
            feature_id="overflow_map",
            op="present",
            rule_ref="rules.unregistered.v1",
        )
    with pytest.raises(ValueError, match="rule"):
        StatePredicate(
            feature_id="overflow_map",
            op="positive",
            rule_ref="rules.evidence.present.v1",
        )


def test_claim_requires_predicates_for_all_required_evidence() -> None:
    with pytest.raises(ValueError, match="required evidence"):
        GeneralDomainClaim(
            claim_ref=KnowledgeReference(entity_id="claim.test", chunk_sha256=CHUNK_HASH),
            claim_sha256=HASH,
            stages=("place",),
            state_predicates=(
                StatePredicate(
                    feature_id="overflow_map",
                    op="present",
                    rule_ref="rules.evidence.present.v1",
                ),
            ),
            required_evidence=("overflow_map", "cell_density_map"),
        )


def test_parameter_card_binding_rejects_tampered_hash() -> None:
    action = BoundKnowledgeAction(
        knob_id="place.target_density",
        direction="decrease",
        parameter_card_ref=(
            "knowledge/optimization/parameter-effectiveness/cards/"
            "place.target_density.json"
        ),
        parameter_card_sha256=HASH,
        consumer_ids=("dreamplace.density_objective",),
        activation_predicate_ids=("dreamplace.density_objective",),
    )
    binding = VersionBoundToolBinding(
        binding_id="binding.test.v1",
        binding_sha256=HASH,
        claim_id="claim.test.v1",
        claim_sha256=HASH,
        toolchain_ref=HASH,
        actions=(action,),
        consumer_ids=action.consumer_ids,
        activation_predicate_ids=action.activation_predicate_ids,
    )

    with pytest.raises(ValueError, match="parameter card"):
        _validate_parameter_card_bindings(binding)


def test_state_evidence_reference_must_be_safe_and_relative() -> None:
    feature = StateEvidenceFeature(
        feature_id="overflow_map",
        value=True,
        evidence_ref="artifacts/overflow-map.json",
        evidence_sha256=HASH,
    )
    assert feature.evidence_ref == "artifacts/overflow-map.json"
    with pytest.raises(ValueError, match="reference"):
        StateEvidenceFeature(
            feature_id="overflow_map",
            value=True,
            evidence_ref="../overflow-map.json",
            evidence_sha256=HASH,
        )


def test_state_evidence_request_preserves_observation_feature_reference() -> None:
    observation = _observation().model_copy(
        update={
            "state_evidence": (
                StageEvidenceFeature(
                    feature_id="local_cell_density_hotspot",
                    value=True,
                    evidence_ref="place/analysis/qor_hotspots.json#/hotspots/0",
                    evidence_sha256="sha256:" + "7" * 64,
                ),
            )
        }
    )
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=observation,
        current_values={"place.target_density": 0.85},
    )
    feature = next(
        item for item in state.features if item.feature_id == "local_cell_density_hotspot"
    )
    assert feature.evidence_ref == "place/analysis/qor_hotspots.json#/hotspots/0"
    assert feature.evidence_sha256 == "sha256:" + "7" * 64


def test_compiler_keeps_multiple_bindings_for_one_claim() -> None:
    base = _catalog()
    second = base.bindings[0].model_copy(
        update={
            "binding_id": "ecos.place.target_density.decrease.alternate.v1",
            "binding_sha256": "sha256:" + "8" * 64,
        }
    )
    catalog = base.model_copy(update={"bindings": (*base.bindings, second)})
    view = _compile(
        StateEvidenceFeature(
            feature_id="local_cell_density_hotspot",
            value=True,
            evidence_sha256="sha256:" + "f" * 64,
        ),
        StateEvidenceFeature(
            feature_id="long_net_pressure_dominant",
            value=False,
            evidence_sha256="sha256:" + "1" * 64,
        ),
        catalog=catalog,
    )

    assert {action.binding_id for action in view.actions} == {
        base.bindings[0].binding_id,
        second.binding_id,
    }
