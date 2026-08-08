from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ecos_agent.knowledge_retriever import GlobalKnowledgeRetriever
from ecos_agent.step_knowledge import STEP_KNOWLEDGE_SPECS, StepKnowledge


AGENT_ROOT = Path(__file__).parents[1]
KNOWLEDGE_ROOT = AGENT_ROOT / "knowledge"


def _retriever(*, include_aliases: bool = True) -> GlobalKnowledgeRetriever:
    bundles = tuple(
        StepKnowledge.from_directory(KNOWLEDGE_ROOT / spec.slug, spec)
        for spec in STEP_KNOWLEDGE_SPECS
    )
    return GlobalKnowledgeRetriever(bundles, include_aliases=include_aliases)


def test_global_retriever_indexes_every_stage_and_records_replayable_trace() -> None:
    retriever = _retriever()

    answer = retriever.reply("How does the CTS stage execute?")

    assert answer is not None
    assert "algorithm.cts.execution" in answer.entity_ids
    assert answer.contract["schema_version"] == "ecos-knowledge-answer.v2"
    assert answer.contract["read_only"] is True
    assert answer.contract["retrieval"] == {
        "backend": "sqlite_fts5_bm25",
        "tokenizer_version": "ecos-knowledge-tokenizer.v1",
        "corpus_sha256": answer.contract["retrieval"]["corpus_sha256"],
        "top_k": 3,
        "score_order": "ascending",
        "field_weights": answer.contract["retrieval"]["field_weights"],
        "query_sha256": answer.contract["retrieval"]["query_sha256"],
    }
    assert answer.contract["matches"][0]["entity_id"] == answer.entity_ids[0]
    assert answer.contract["matches"][0]["chunk_sha256"]
    assert answer.contract["matches"][0]["source_ids"]


def test_global_retriever_does_not_return_the_first_stage_hit() -> None:
    answer = _retriever().reply("How are clock-tree buffers and insertion latency reported?")

    assert answer is not None
    assert answer.entity_ids[0].startswith(("algorithm.cts.", "metric.cts_"))


def test_global_retriever_can_return_multiple_stages() -> None:
    answer = _retriever().reply("How are RCX extraction corners consumed by STA timing analysis?")

    assert answer is not None
    assert {match["stage"] for match in answer.contract["matches"]} >= {"rcx", "sta"}


def test_global_retriever_returns_no_knowledge_for_irrelevant_or_fts_syntax_input() -> None:
    retriever = _retriever()

    assert retriever.reply("What is the best sourdough starter hydration?") is None
    assert retriever.reply('" OR * NEAR( )') is None


def test_global_retriever_supports_protocol_worker_threads() -> None:
    retriever = _retriever()

    with ThreadPoolExecutor(max_workers=1) as executor:
        answer = executor.submit(retriever.reply, "How does the CTS stage execute?").result()

    assert answer is not None
    assert "algorithm.cts.execution" in answer.entity_ids


def test_aliases_are_a_weighted_field_not_a_bypass() -> None:
    answer = _retriever(include_aliases=False).reply("How does the CTS stage execute?")

    assert answer is not None
    assert "algorithm.cts.execution" in answer.entity_ids
