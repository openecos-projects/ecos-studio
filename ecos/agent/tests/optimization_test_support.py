from ecos_agent.optimization_contracts import KnowledgeReference
from ecos_agent.optimization_knowledge_compiler import (
    BoundKnowledgeAction,
    GeneralDomainClaim,
    KnowledgeSupportCatalog,
    StatePredicate,
    VersionBoundToolBinding,
)

HASH = "sha256:" + "a" * 64


def support_catalog(
    reference: KnowledgeReference,
    *,
    feature_id: str = "place_lutrudy_utilization_max",
) -> KnowledgeSupportCatalog:
    claim = GeneralDomainClaim(
        claim_ref=reference,
        claim_sha256=HASH,
        stages=("place",),
        state_predicates=(
            StatePredicate(
                feature_id=feature_id,
                op="present",
                rule_ref="rules.test.present.v1",
            ),
        ),
    )
    return KnowledgeSupportCatalog(
        catalog_sha256="sha256:" + "e" * 64,
        claims=(claim,),
        bindings=(
            VersionBoundToolBinding(
                binding_id="binding.test.v1",
                binding_sha256="sha256:" + "c" * 64,
                claim_id=reference.entity_id,
                claim_sha256=claim.claim_sha256,
                toolchain_ref="sha256:" + "d" * 64,
                actions=(
                    BoundKnowledgeAction(
                        knob_id="place.cell_padding_x", direction="increase"
                    ),
                    BoundKnowledgeAction(
                        knob_id="place.target_density", direction="increase"
                    ),
                    BoundKnowledgeAction(
                        knob_id="place.target_density", direction="decrease"
                    ),
                    BoundKnowledgeAction(
                        knob_id="floorplan.core_util", direction="decrease"
                    ),
                    BoundKnowledgeAction(
                        knob_id="floorplan.aspect_ratio", direction="decrease"
                    ),
                    BoundKnowledgeAction(
                        knob_id="place.routability_opt", direction="disable"
                    ),
                ),
            ),
        ),
    )
