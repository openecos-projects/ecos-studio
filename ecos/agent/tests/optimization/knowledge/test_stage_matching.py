from __future__ import annotations

import pytest

from ecos_agent.ecc_contracts import ECCStepName
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
    StatePredicate,
    VersionBoundToolBinding,
    build_state_evidence_request,
    compile_supported_action_view,
    expected_toolchain_ref,
)
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot

HASH = "sha256:" + "a" * 64
TOOLCHAIN = "sha256:" + "d" * 64


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
        "knob_id": "floorplan.core_util",
        "context_sha256": HASH,
        "current_coordinate": {"surface_value": 0.3},
        "value_bounds": {
            "type": "number",
            "minimum": 0.2,
            "maximum": 0.95,
            "exclusive_minimum": False,
            "exclusive_maximum": False,
        },
        "attempted_values": (),
    }
    return EffectiveDomainSnapshot(**payload, snapshot_sha256=canonical_sha256(payload))


def _catalog() -> KnowledgeSupportCatalog:
    claim_ref = KnowledgeReference(
        entity_id="strategy.wirelength.trial_tighter_core_area.v1",
        chunk_sha256="f" * 64,
    )
    claim_sha256 = "sha256:" + "f" * 64
    claim = GeneralDomainClaim(
        claim_ref=claim_ref,
        claim_sha256=claim_sha256,
        objectives=(),
        stages=("floorplan",),
        state_predicates=(StatePredicate(
            feature_id="route_la_total_overflow",
            op="positive",
            rule_ref="rules.numeric.positive.v1",
        ),),
        anti_predicates=(),
        expected_effects=("route_wirelength:decrease",),
        guardrails=(),
        required_evidence=(),
    )
    binding_sha256 = "sha256:" + "c" * 64
    binding = VersionBoundToolBinding(
        binding_id="binding.reduce_core_area_wirelength_trial.v1",
        binding_sha256=binding_sha256,
        claim_id=claim_ref.entity_id,
        claim_sha256=claim_sha256,
        toolchain_ref=expected_toolchain_ref(binding_sha256),
        actions=(BoundKnowledgeAction(
            knob_id="floorplan.core_util",
            direction="increase",
        ),),
    )
    return KnowledgeSupportCatalog(
        catalog_sha256="sha256:" + "e" * 64,
        claims=(claim,),
        bindings=(binding,),
    )


def _compile_floorplan_claim(
    stage: ECCStepName,
    *,
    evidence_stages: tuple[str, ...] = (),
):
    observation = _observation().model_copy(update={"stage": stage})
    catalog = _catalog()
    state = build_state_evidence_request(
        task_id="task-1",
        retrieval_request_sha256=HASH,
        observation=observation,
        current_values={"floorplan.core_util": 0.3},
        toolchain_sha256=TOOLCHAIN,
        evidence_stages=evidence_stages,
    )
    return compile_supported_action_view(
        state=state,
        catalog=catalog,
        candidate_refs=tuple(claim.claim_ref for claim in catalog.claims),
        retrieval_ranked_refs=tuple(claim.claim_ref for claim in catalog.claims),
        legal_actions=(LegalAction(
            knob_id="floorplan.core_util",
            direction="increase",
        ),),
        effective_domains=(_domain(),),
    )


@pytest.mark.parametrize(
    "stage",
    (
        ECCStepName.PRE_FLOORPLAN,
        ECCStepName.MACRO_PLACEMENT,
        ECCStepName.POST_FLOORPLAN,
    ),
)
def test_floorplan_claim_matches_all_floorplan_runtime_substeps(stage: ECCStepName) -> None:
    view = _compile_floorplan_claim(stage)
    assert view.matches[0].applicability == KnowledgeApplicability.PASS
    assert [(item.knob_id.value, item.direction.value) for item in view.actions] == [
        ("floorplan.core_util", "increase")
    ]


def test_floorplan_claim_matches_post_floorplan_evidence_at_place_checkpoint() -> None:
    view = _compile_floorplan_claim(
        ECCStepName.PLACEMENT,
        evidence_stages=(ECCStepName.POST_FLOORPLAN.value,),
    )
    assert view.matches[0].applicability == KnowledgeApplicability.PASS


def test_floorplan_claim_does_not_match_unrelated_place_stage() -> None:
    view = _compile_floorplan_claim(ECCStepName.PLACEMENT)
    assert view.matches[0].applicability == KnowledgeApplicability.BLOCKED
    assert view.matches[0].reason_codes == ("incompatible_stage",)
    assert view.actions == ()
