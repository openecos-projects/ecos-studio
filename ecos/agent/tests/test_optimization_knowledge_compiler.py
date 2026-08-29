from __future__ import annotations

from ecos_agent.effective_domain import EffectiveDomainSnapshot
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    LegalAction,
    StageObservation,
)
from ecos_agent.optimization_knowledge_compiler import (
    BoundKnowledgeAction,
    GeneralDomainClaim,
    KnowledgeApplicability,
    KnowledgeSupportCatalog,
    StateEvidenceFeature,
    StatePredicate,
    VersionBoundToolBinding,
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
                rule_ref="rules.congestion.positive_overflow.v1",
            ),
            StatePredicate(
                feature_id="local_cell_density_hotspot",
                op="present",
                rule_ref="rules.congestion.local_hotspot.v1",
            ),
        ),
        anti_predicates=(
            StatePredicate(
                feature_id="long_net_pressure_dominant",
                op="true",
                rule_ref="rules.congestion.long_net_pressure.v1",
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
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
        extra_features=features,
    )
    return compile_supported_action_view(
        state=state,
        catalog=catalog or _catalog(),
        retrieved_refs=(_catalog().claims[0].claim_ref,),
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(_domain(),),
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
        retrieved_refs=(_catalog().claims[0].claim_ref,),
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
