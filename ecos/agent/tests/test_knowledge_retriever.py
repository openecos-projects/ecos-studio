from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from ecos_agent.knowledge_bundle import KnowledgeBundle, KnowledgeBundleSpec, KnowledgeEntity
from ecos_agent.knowledge_retriever import GlobalKnowledgeRetriever, RetrievalConfig
from ecos_agent.step_knowledge import STEP_KNOWLEDGE_SPECS, StepKnowledge


AGENT_ROOT = Path(__file__).parents[1]
KNOWLEDGE_ROOT = AGENT_ROOT / "knowledge"


def _retriever() -> GlobalKnowledgeRetriever:
    return GlobalKnowledgeRetriever(_bundles())


def _bundles() -> tuple[StepKnowledge, ...]:
    return tuple(
        StepKnowledge.from_directory(KNOWLEDGE_ROOT / spec.slug, spec)
        for spec in STEP_KNOWLEDGE_SPECS
    )


def _bundle(*entities: tuple[str, tuple[str, ...], str]) -> KnowledgeBundle:
    spec = KnowledgeBundleSpec("test", "test-manifest.v1", "test-catalog.v1")
    records = tuple(
        KnowledgeEntity(entity_id, "knowledge.md", entity_id, "0" * 64, ("test.source",))
        for entity_id, aliases, _text in entities
    )
    return KnowledgeBundle(spec, records, {entity_id: text for entity_id, _aliases, text in entities})


def test_global_retriever_indexes_every_stage_and_records_replayable_trace() -> None:
    retriever = _retriever()

    answer = retriever.reply("How does the CTS stage execute?")

    assert answer is not None
    assert any(entity_id.startswith("algorithm.cts.") for entity_id in answer.entity_ids)
    assert answer.contract["schema_version"] == "ecos-knowledge-answer.v2"
    assert answer.contract["read_only"] is True
    assert answer.contract["entity_ids"] == list(answer.entity_ids)
    assert answer.contract["retrieval"] == {
        "backend": "sqlite_fts5_bm25",
        "tokenizer_version": "ecos-knowledge-tokenizer.v1",
        "corpus_sha256": answer.contract["retrieval"]["corpus_sha256"],
        "top_k": 3,
        "score_order": "ascending",
        "field_weights": answer.contract["retrieval"]["field_weights"],
        "config": {
            "top_k": 3,
            "field_weights": answer.contract["retrieval"]["field_weights"],
            "max_query_tokens": 32,
            "max_raw_bm25": None,
            "min_score_margin": 0.0,
            "min_token_overlap": 3,
            "max_document_frequency": 0,
            "allow_metadata_match": False,
        },
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
    answer = _retriever().reply("How do extracted wire resistance and required-time slack analysis connect at signoff? Explain the boundary for scenario 9.")

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
    assert any(entity_id.startswith("algorithm.cts.") for entity_id in answer.entity_ids)


def test_production_retriever_uses_only_audited_catalog_fields() -> None:
    answer = _retriever().reply(
        "How does clock domain synthesis build clock topology and buffers?"
    )

    assert answer is not None
    assert any(entity_id.startswith("algorithm.cts.") for entity_id in answer.entity_ids)


def test_aliases_are_absent_from_fts_and_confidence_corpus() -> None:
    bundle = _bundle(("answer", ("secret vocabulary",), "audited content without the alias"))

    retriever = GlobalKnowledgeRetriever(
        (bundle,),
        config=RetrievalConfig(max_raw_bm25=0.0, min_token_overlap=1),
    )

    assert retriever.reply("secret vocabulary") is None
    assert [row[1] for row in retriever._connection.execute("PRAGMA table_info(knowledge)")] == ["entity_id", "stage", "identifier", "reserved", "content"]
    assert "secret" not in retriever._records[0].tokens


def test_retrieval_config_is_frozen_and_recorded_for_replay() -> None:
    config = RetrievalConfig(
        top_k=5,
        field_weights=(2.0, 3.0, 4.0, 5.0),
        max_raw_bm25=0.0,
        min_score_margin=0.0,
        min_token_overlap=1,
    )
    with pytest.raises(FrozenInstanceError):
        config.top_k = 3  # type: ignore[misc]
    with pytest.raises(ValueError, match="field weights"):
        RetrievalConfig(field_weights=[2.0, 3.0, 4.0, 5.0])  # type: ignore[arg-type]

    answer = GlobalKnowledgeRetriever(
        _bundles(),
        config=config,
    ).reply("How does the CTS stage execute?")

    assert answer is not None
    assert answer.contract["retrieval"]["config"] == {
        "field_weights": {"stage": 2.0, "identifier": 3.0, "reserved": 4.0, "content": 5.0},
        "max_query_tokens": 32,
        "max_raw_bm25": 0.0,
        "min_score_margin": 0.0,
        "min_token_overlap": 1,
            "max_document_frequency": 0,
            "allow_metadata_match": False,
        "top_k": 5,
    }


def test_low_confidence_bm25_threshold_and_margin_return_no_answer() -> None:
    threshold_bundle = _bundle(("answer", (), "alpha beta gamma"))
    threshold_retriever = GlobalKnowledgeRetriever(
        (threshold_bundle,),
        config=RetrievalConfig(max_raw_bm25=-1_000.0, min_token_overlap=1),
    )
    margin_bundle = _bundle(
        ("first", (), "alpha beta gamma"),
        ("second", (), "alpha beta gamma"),
    )
    margin_retriever = GlobalKnowledgeRetriever(
        (margin_bundle,),
        config=RetrievalConfig(max_raw_bm25=0.0, min_score_margin=0.01, min_token_overlap=1),
    )

    assert threshold_retriever.reply("alpha beta") is None
    assert margin_retriever.reply("alpha beta") is None


def test_uppercase_eda_acronyms_are_confident_without_weakening_word_overlap() -> None:
    bundle = _bundle(("metric", (), "The RUDY metric measures routing demand."))

    answer = GlobalKnowledgeRetriever((bundle,)).reply("RUDY指标是如何计算的？")

    assert answer is not None
    assert answer.entity_ids == ("metric",)


def test_unknown_named_tools_do_not_inject_shared_eda_chunks() -> None:
    bundle = _bundle(("power", (), "The power grid reports routing demand."))

    assert GlobalKnowledgeRetriever((bundle,)).reply("Explain OpenSTA power grid wizard.") is None
