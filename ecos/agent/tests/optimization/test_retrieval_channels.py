from __future__ import annotations

import json
from pathlib import Path

import pytest
from ecos_agent.knowledge.bundle import KnowledgeAnswer
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.observations import build_stage_observation
from ecos_agent.optimization.knowledge.retrieval import (
    KnowledgeChannel,
    OptimizationKnowledgeRetriever,
    build_optimization_retrieval_request,
)
from tests.optimization.observation_support import (
    _budget,
    frozen_workspace,
)


class _RecordingRetriever:
    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    def reply_for_stages(
        self, query: str, candidate_stages: tuple[str, ...]
    ) -> KnowledgeAnswer:
        self.calls.append((query, candidate_stages))
        matches = [
            {
                "entity_id": f"{self.prefix}.{index}",
                "chunk_sha256": f"{index:x}" * 64,
            }
            for index in range(1, 5)
        ]
        return KnowledgeAnswer(
            text=f"{self.prefix} evidence",
            entity_ids=tuple(item["entity_id"] for item in matches),
            contract={
                "retrieval": {"query_sha256": "f" * 64, "corpus_sha256": "e" * 64},
                "matches": matches,
            },
        )


def test_optimization_retrieval_uses_fixed_query_inputs_and_independent_channels(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=OptimizationOutcomeKind.DEGRADED,
    )
    tool = _RecordingRetriever("parameter.dreamplace")
    general = _RecordingRetriever("strategy.congestion")
    retriever = OptimizationKnowledgeRetriever(
        tool_retriever=tool, general_retriever=general
    )

    result = retriever.retrieve(request)

    assert tuple(stage.value for stage in request.action_stages) == (
        "Floorplan",
        "place",
        "CTS",
    )
    assert request.allowed_knobs == tuple(OptimizationKnob)
    assert request.observed_metric_ids == tuple(sorted(observation.metrics))
    assert "0.88" not in json.dumps(request.model_dump(mode="json"))
    assert len(result.knowledge_refs) == 6
    assert {channel.channel for channel in result.channels if channel.enabled} == {
        KnowledgeChannel.TOOL,
        KnowledgeChannel.GENERAL,
    }
    assert all(
        len(channel.knowledge_refs) == 3
        for channel in result.channels
        if channel.enabled
    )
    assert tool.calls[0][1] == ("floorplan", "place", "cts")
    assert general.calls[0][1] == ("floorplan", "place")
    assert "0.88" not in tool.calls[0][0]
    assert "5243" not in general.calls[0][0]

    no_knowledge = retriever.retrieve(request, enabled_channels=())
    assert no_knowledge.request_sha256 == result.request_sha256
    assert no_knowledge.knowledge_refs == ()
    assert all(not channel.enabled for channel in no_knowledge.channels)
    assert len(tool.calls) == 1
    assert len(general.calls) == 1

    with pytest.raises(ValueError, match="channels"):
        retriever.retrieve(request, enabled_channels=("source",))  # type: ignore[arg-type]


def test_optimization_retrieval_deduplicates_channel_evidence(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=None,
    )
    tool = _RecordingRetriever("parameter.dreamplace")
    general = _RecordingRetriever("parameter.dreamplace")

    result = OptimizationKnowledgeRetriever(
        tool_retriever=tool, general_retriever=general
    ).retrieve(request)

    assert len(result.knowledge_refs) == 3
    assert result.channels[1].knowledge_refs == ()


def test_default_optimization_retrieval_keeps_tool_and_general_knowledge_separate(
    frozen_workspace: Path,
) -> None:
    observation = build_stage_observation(frozen_workspace, "place", budget=_budget())
    request = build_optimization_retrieval_request(
        task_id="task-1",
        observation=observation,
        previous_intervention_outcome=None,
    )

    result = OptimizationKnowledgeRetriever().retrieve(request)

    tool, general = result.channels
    assert len(tool.knowledge_refs) <= 3
    assert len(general.knowledge_refs) <= 3
    assert all(not ref.entity_id.startswith("strategy.") for ref in tool.knowledge_refs)
    assert all(
        ref.entity_id.startswith(("strategy.congestion.", "strategy.wirelength."))
        for ref in general.knowledge_refs
    )
