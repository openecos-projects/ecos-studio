"""Wrong-objective knowledge must be rejected by the support compiler."""

from __future__ import annotations

from ecos_agent.knowledge.step import load_default_general_knowledge
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    StageObservation,
)
from ecos_agent.optimization.experiments.knowledge_robustness import (
    build_wrong_objective_gate,
)
from ecos_agent.optimization.knowledge.compiler import (
    build_state_evidence_request,
    knowledge_support_catalog_from_bundles,
)

HASH = "sha256:" + "a" * 64


def _wirelength_state() -> dict[str, object]:
    observation = StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"route_la_total_overflow": 0.0},
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0)),
    )
    return build_state_evidence_request(
        task_id="robustness-task",
        retrieval_request_sha256=HASH,
        observation=observation,
        current_values={"place.target_density": 0.45},
        primary_metric=ObjectiveMetric.ROUTE_WIRELENGTH,
        toolchain_sha256=None,
    ).model_dump(mode="json")


def test_wrong_objective_candidates_are_blocked_and_never_exposed() -> None:
    """Negative control: optimizing wirelength, injecting the congestion
    corpus.  Raw retrieval would inject every chunk as prose; the compiled
    support view must expose no claim and no action."""
    from ecos_agent.optimization.knowledge.compiler import (
        OptimizationStateEvidenceRequest,
    )

    congestion_bundle = load_default_general_knowledge("congestion")
    catalog = knowledge_support_catalog_from_bundles((congestion_bundle,))
    candidate_refs = tuple(
        KnowledgeReference(
            entity_id=entity.entity_id, chunk_sha256=entity.chunk_sha256
        )
        for entity in congestion_bundle.entities
        if any(
            claim.claim_ref.entity_id == entity.entity_id for claim in catalog.claims
        )
    )
    assert candidate_refs, "congestion corpus carries no claims"
    state = OptimizationStateEvidenceRequest.model_validate(_wirelength_state())

    report = build_wrong_objective_gate(
        state=state,
        catalog=catalog,
        candidate_refs=candidate_refs,
        legal_actions=(
            LegalAction(knob_id="place.target_density", direction="decrease"),
        ),
        effective_domains=(),
    )

    assert report["schema_version"] == "ecos.knowledge_robustness_gate.v1"
    assert report["primary_metric"] == "route_wirelength"
    assert report["injected_candidate_count"] == len(candidate_refs)
    # The raw-rag contrast: exactly these chunks reach the planner as prose.
    assert report["raw_rag_contrast"]["would_inject_entity_ids"] == sorted(
        reference.entity_id for reference in candidate_refs
    )
    assert report["assessed"] is True
    assert report["exposed_claim_count"] == 0
    assert report["exposed_action_count"] == 0
    # Corpus reality: claims carry no objectives, so the objective gate is
    # inert and some candidates survive gating on legality alone.  The gate
    # report must surface that residual risk instead of hiding it.
    assert report["blocked_reason_counts"].get("unsupported_action", 0) > 0
    assert report["unblocked_candidate_count"] > 0
