"""Wrong-objective knowledge robustness gate for the knowledge treatments.

The negative-control artifact for the robustness claim: knowledge retrieved
for the *wrong* optimization objective is compiled through the state-conditioned
support pipeline and must be rejected, while the raw-retrieval arm would have
injected exactly these chunks as prose.  The gate records both sides of that
contrast in one auditable report.
"""

from __future__ import annotations

from collections import Counter

from ecos_agent.optimization.contracts import LegalAction
from ecos_agent.optimization.knowledge.compiler import (
    KnowledgeApplicability,
    KnowledgeSupportCatalog,
    OptimizationStateEvidenceRequest,
    compile_supported_action_view,
)
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainSnapshot,
)
from ecos_agent.optimization.knowledge.compiler import KnowledgeReference

GATE_SCHEMA_VERSION = "ecos.knowledge_robustness_gate.v1"


def build_wrong_objective_gate(
    *,
    state: OptimizationStateEvidenceRequest,
    catalog: KnowledgeSupportCatalog,
    candidate_refs: tuple[KnowledgeReference, ...],
    legal_actions: tuple[LegalAction, ...],
    effective_domains: tuple[EffectiveDomainSnapshot, ...],
) -> dict[str, object]:
    """Compile mismatched-objective candidates and audit what reaches the planner.

    The report records, for one frozen state request and one deliberately
    mismatched candidate bundle: what raw retrieval would have injected as
    prose (``raw_rag_contrast``), how the compiler classified every candidate
    (``blocked_reason_counts``), and that no claim or action was exposed.
    Corpus claims carry their serving objective (see the generator's
    ``_METRIC_OBJECTIVES``), so the objective gate rejects the mismatch
    outright; ``unblocked_candidate_count`` stays zero and any nonzero value
    means a corpus claim is missing its objective metadata.
    """
    view = compile_supported_action_view(
        state=state,
        catalog=catalog,
        candidate_refs=candidate_refs,
        retrieval_ranked_refs=candidate_refs,
        legal_actions=legal_actions,
        effective_domains=effective_domains,
    )
    blocked = Counter(
        reason
        for match in view.matches
        for reason in match.reason_codes
        if match.applicability is KnowledgeApplicability.BLOCKED
    )
    exposed_claims = view.exposed_claim_refs
    # Candidates that passed every gate but exposed no action only because
    # the current legal surface has no matching (knob, direction).  This is
    # the residual-risk metric: a broader task surface would have exposed
    # them, so a nonzero value means the mismatch was survived by legality,
    # not rejected by conditioning.
    unblocked = sum(
        match.applicability is not KnowledgeApplicability.BLOCKED
        for match in view.matches
    )
    return {
        "schema_version": GATE_SCHEMA_VERSION,
        "task_id": state.task_id,
        "primary_metric": (
            state.primary_metric.value if state.primary_metric is not None else None
        ),
        "injected_candidate_count": len(candidate_refs),
        "raw_rag_contrast": {
            "would_inject_entity_ids": sorted(
                {reference.entity_id for reference in candidate_refs}
            ),
            "would_inject_chunk_sha256": sorted(
                {reference.chunk_sha256 for reference in candidate_refs}
            ),
        },
        "blocked_reason_counts": dict(sorted(blocked.items())),
        "unblocked_candidate_count": unblocked,
        "exposed_claim_count": len(exposed_claims),
        "exposed_action_count": len(view.actions),
        "catalog_sha256": catalog.catalog_sha256,
        "state_request_sha256": state.request_sha256,
        "audit_sha256": view.view_sha256,
        "assessed": bool(candidate_refs) and not exposed_claims and not view.actions,
    }
