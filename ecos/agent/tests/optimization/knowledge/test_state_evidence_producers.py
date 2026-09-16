"""P0.2 acceptance: producers + toolchain verification decide entry states.

Place-staged corpus claims gate on the incumbent's terminal metrics, absence
markers, and verified binding provenance; synthetic entry states must turn
previously-unknown claims into decided verdicts with correct reason codes.
"""

from tests.optimization.experiments.equal_budget_support import _terminal_observation

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    LegalAction,
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
    build_state_evidence_request,
    compile_supported_action_view,
    expected_toolchain_ref,
)
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainSnapshot,
)

HASH = "sha256:" + "a" * 64
CHUNK_HASH = "b" * 64
BINDING_SHA = "sha256:" + "c" * 64


def _observation() -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"route_la_total_overflow": 12.0},
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0)),
    )


def _domain() -> EffectiveDomainSnapshot:
    payload = {
        "schema_version": "ecos.effective_domain.v4",
        "knob_id": "place.target_density",
        "context_sha256": HASH,
        "current_coordinate": {"surface_value": 0.85},
        "value_bounds": {
            "type": "number",
            "minimum": 0.05,
            "maximum": 0.95,
            "exclusive_minimum": False,
            "exclusive_maximum": False,
        },
        "attempted_values": (),
    }
    return EffectiveDomainSnapshot(
        **payload, snapshot_sha256=canonical_sha256(payload)
    )


def _compile(*features: StateEvidenceFeature, catalog, **state_kwargs):
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=_observation(),
        current_values={"place.target_density": 0.85},
        toolchain_sha256=HASH,
        extra_features=features,
        **state_kwargs,
    )
    return compile_supported_action_view(
        state=state,
        catalog=catalog,
        candidate_refs=tuple(claim.claim_ref for claim in catalog.claims),
        retrieval_ranked_refs=tuple(claim.claim_ref for claim in catalog.claims),
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(_domain(),),
    )


def _claim(
    entity_id: str, predicates, anti
) -> GeneralDomainClaim:
    return GeneralDomainClaim(
        claim_ref=KnowledgeReference(entity_id=entity_id, chunk_sha256=CHUNK_HASH),
        claim_sha256=HASH,
        stages=("place",),
        state_predicates=predicates,
        anti_predicates=anti,
    )


def _binding(claim: GeneralDomainClaim) -> VersionBoundToolBinding:
    return VersionBoundToolBinding(
        binding_id=f"binding.{claim.claim_ref.entity_id}.v1",
        binding_sha256=BINDING_SHA,
        claim_id=claim.claim_ref.entity_id,
        claim_sha256=claim.claim_sha256,
        toolchain_ref=expected_toolchain_ref(BINDING_SHA),
        actions=(
            BoundKnowledgeAction(
                knob_id="place.target_density", direction="decrease"
            ),
        ),
    )


def _catalog(claims) -> KnowledgeSupportCatalog:
    return KnowledgeSupportCatalog(
        catalog_sha256="sha256:" + "e" * 64,
        claims=claims,
        bindings=tuple(_binding(claim) for claim in claims),
    )


def test_place_entry_state_decides_previously_unknown_claims() -> None:
    claims = (
        # terminal metric predicate, decidable via the incumbent's flow state
        _claim(
            "claim.decide.a",
            (StatePredicate(
                feature_id="drc_count",
                op="zero",
                rule_ref="rules.numeric.zero.v1",
            ),),
            (),
        ),
        # requires evidence that never exists in this runtime -> blocked
        _claim(
            "claim.decide.b",
            (StatePredicate(
                feature_id="drc_count",
                op="zero",
                rule_ref="rules.numeric.zero.v1",
            ),),
            (StatePredicate(
                feature_id="parent_terminal_reference_unavailable",
                op="true",
                rule_ref="rules.boolean.true.v1",
            ),),
        ),
        # timing evidence is available through the incumbent -> not blocked
        _claim(
            "claim.decide.c",
            (StatePredicate(
                feature_id="sta_setup_wns",
                op="present",
                rule_ref="rules.evidence.present.v1",
            ),),
            (StatePredicate(
                feature_id="timing_metrics_unavailable",
                op="true",
                rule_ref="rules.boolean.true.v1",
            ),),
        ),
    )
    view = _compile(catalog=_catalog(claims), incumbent=_terminal_observation())

    by_claim = {match.claim_ref.entity_id: match for match in view.matches}
    decided = by_claim["claim.decide.a"]
    assert decided.applicability == KnowledgeApplicability.PASS
    assert decided.reason_codes == ()
    blocked = by_claim["claim.decide.b"]
    assert blocked.applicability == KnowledgeApplicability.BLOCKED
    assert blocked.reason_codes == ("anti_condition",)
    timing = by_claim["claim.decide.c"]
    assert timing.applicability == KnowledgeApplicability.PASS
    assert timing.reason_codes == ()
