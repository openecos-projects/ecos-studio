from __future__ import annotations

from types import SimpleNamespace

from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    EpisodeBudget,
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
    def __init__(self, entity_id: str, stages: tuple[str, ...]) -> None:
        self.entity_id = entity_id
        self.stages = stages
        self.queries: list[str] = []

    def reply_for_stages(self, query: str, stages: tuple[str, ...]) -> object:
        assert stages == self.stages
        self.queries.append(query)
        return SimpleNamespace(
            text=f"answer for {self.entity_id}",
            contract={
                "retrieval": {"query_sha256": "b" * 64, "corpus_sha256": "c" * 64},
                "matches": [{"entity_id": self.entity_id, "chunk_sha256": "d" * 64}],
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
        "tool.place.objective.v1", ("floorplan", "fixfanout", "place")
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
