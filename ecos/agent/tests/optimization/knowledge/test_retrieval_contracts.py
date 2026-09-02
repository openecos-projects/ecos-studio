from __future__ import annotations

from types import SimpleNamespace

from tests.optimization.support import support_catalog

from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
    KnowledgeReference,
    ObjectiveMetric,
    StageObservation,
)
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.knowledge.retrieval import (
    KnowledgeChannel,
    OptimizationKnowledgeRetriever,
    build_optimization_retrieval_request,
)

HASH = "sha256:" + "a" * 64


class _FakeRetriever:
    def __init__(self, entity_id: str | tuple[str, ...], stages: tuple[str, ...]) -> None:
        self.entity_ids = (entity_id,) if isinstance(entity_id, str) else entity_id
        self.stages = stages
        self.queries: list[str] = []

    def reply_for_stages(self, query: str, stages: tuple[str, ...]) -> object:
        assert stages == self.stages
        self.queries.append(query)
        return SimpleNamespace(
            text="\n\n".join(f"answer for {entity_id}" for entity_id in self.entity_ids),
            contract={
                "retrieval": {"query_sha256": "b" * 64, "corpus_sha256": "c" * 64},
                "matches": [
                    {"entity_id": entity_id, "chunk_sha256": str(index) * 64}
                    for index, entity_id in enumerate(self.entity_ids, start=1)
                ],
            },
        )


def _observation() -> StageObservation:
    return StageObservation(
        observation_id="observation-place",
        stage="place",
        evidence_manifest_sha256=HASH,
        metrics={"place_lutrudy_utilization_max": 0.88},
        budget=BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(11.0)),
    )


def test_retrieval_request_carries_frozen_objective_metrics() -> None:
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=_observation(),
        previous_intervention_outcome=OptimizationOutcomeKind.DEGRADED,
        primary_metric=ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
        preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
    )

    assert request.primary_metric == ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW
    assert request.preserve_metrics == (ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,)
    assert request.request_sha256.startswith("sha256:")


def test_fixed_objective_query_reaches_tool_and_general_channels() -> None:
    tool = _FakeRetriever(
        "tool.place.objective.v1", ("floorplan", "place", "cts")
    )
    general = _FakeRetriever("general.objective.v1", ("floorplan", "place"))
    retriever = OptimizationKnowledgeRetriever(tool_retriever=tool, general_retriever=general)
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=_observation(),
        previous_intervention_outcome=None,
        primary_metric=ObjectiveMetric.ROUTE_LA_TOTAL_OVERFLOW,
        preserve_metrics=(ObjectiveMetric.ROUTE_DR_TOTAL_VIOLATION_COUNT,),
    )

    result = retriever.retrieve(request)

    assert {item.channel for item in result.channels} == {KnowledgeChannel.TOOL, KnowledgeChannel.GENERAL}
    assert all("primary metric route_la_total_overflow" in query for query in (*tool.queries, *general.queries))
    assert all("preserve metrics route_dr_total_violation_count" in query for query in (*tool.queries, *general.queries))
    assert [ref.entity_id for ref in result.knowledge_refs] == [
        "tool.place.objective.v1",
        "general.objective.v1",
    ]


def test_full_agent_candidates_scan_catalog_while_raw_retrieval_stays_top_three() -> None:
    tool = _FakeRetriever(
        tuple(f"tool.place.{index}.v1" for index in range(1, 5)),
        ("floorplan", "place", "cts"),
    )
    general = _FakeRetriever(
        tuple(f"general.place.{index}.v1" for index in range(1, 5)),
        ("floorplan", "place"),
    )
    base = support_catalog(
        KnowledgeReference(entity_id="claim.place.v1", chunk_sha256="a" * 64)
    )
    floorplan_claim = base.claims[0].model_copy(
        update={
            "claim_ref": KnowledgeReference(
                entity_id="claim.floorplan.v1", chunk_sha256="b" * 64
            ),
            "claim_sha256": "sha256:" + "b" * 64,
            "stages": ("floorplan",),
        }
    )
    catalog = base.model_copy(update={"claims": (*base.claims, floorplan_claim)})
    retriever = OptimizationKnowledgeRetriever(
        tool_retriever=tool,
        general_retriever=general,
        support_catalog=catalog,
    )

    result = retriever.retrieve(
        build_optimization_retrieval_request(
            task_id="task-1",
            observation=_observation(),
            previous_intervention_outcome=None,
        )
    )

    assert [len(channel.knowledge_refs) for channel in result.channels] == [3, 3]
    assert result.candidate_refs == (base.claims[0].claim_ref,)
    assert result.contract["schema_version"] == "ecos.optimization_knowledge_retrieval.v2"
    assert result.contract["candidate_count"] == 1


def test_disabled_general_channel_has_no_structured_candidates() -> None:
    retriever = OptimizationKnowledgeRetriever(
        tool_retriever=_FakeRetriever(
            "tool.place.v1", ("floorplan", "place", "cts")
        ),
        general_retriever=_FakeRetriever("general.place.v1", ("floorplan", "place")),
        support_catalog=support_catalog(
            KnowledgeReference(entity_id="claim.place.v1", chunk_sha256="a" * 64)
        ),
    )

    result = retriever.retrieve(
        build_optimization_retrieval_request(
            task_id="task-1",
            observation=_observation(),
            previous_intervention_outcome=None,
        ),
        enabled_channels=(KnowledgeChannel.TOOL,),
    )

    assert result.candidate_refs == ()
    assert result.contract["candidate_count"] == 0
