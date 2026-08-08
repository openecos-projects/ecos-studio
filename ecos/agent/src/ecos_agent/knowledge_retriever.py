"""Deterministic global retrieval over trusted ECOS knowledge bundles."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

from ecos_agent.knowledge_bundle import KnowledgeAnswer, KnowledgeBundle, KnowledgeEntity


TOKENIZER_VERSION = "ecos-knowledge-tokenizer.v1"
BACKEND = "sqlite_fts5_bm25"
TOP_K = 3
MAX_QUERY_TOKENS = 32
FIELD_WEIGHTS = (10.0, 20.0, 10.0, 1.0)
_FTS5_FIELD_WEIGHTS = (0.0, *FIELD_WEIGHTS)
_STOP_TOKENS = frozenset({"a", "an", "and", "are", "by", "does", "for", "how", "in", "is", "of", "on", "or", "the", "to", "what", "with", "了", "何", "如", "是", "的", "算", "计", "指", "标", "如何", "计算", "指标"})
_TOKEN_PATTERN = re.compile(r"[a-z0-9]+(?:[_-][a-z0-9]+)*|[\u4e00-\u9fff]+", re.IGNORECASE)


class KnowledgeRetrievalError(RuntimeError):
    """Raised when the local FTS5 retrieval backend is unavailable."""


@dataclass(frozen=True)
class _Record:
    key: str
    entity: KnowledgeEntity
    stage: str
    text: str
    tokens: frozenset[str]
    metadata_tokens: frozenset[str]


class GlobalKnowledgeRetriever:
    """Search every verified entity in one in-memory SQLite FTS5 corpus."""

    def __init__(
        self, bundles: Iterable[KnowledgeBundle], *, include_aliases: bool = True, top_k: int = TOP_K
    ) -> None:
        if top_k not in {3, 5, 8}:
            raise ValueError("knowledge retrieval top_k must be one of 3, 5, or 8")
        self._records = _records_from_bundles(tuple(bundles), include_aliases=include_aliases)
        self._corpus_sha256 = _corpus_sha256(self._records)
        self._top_k = top_k
        self._document_frequency = Counter(token for record in self._records for token in record.tokens)
        self._connection = _create_index(self._records)
        self._search_lock = threading.Lock()

    def reply(self, question: str) -> KnowledgeAnswer | None:
        query_tokens = tokenize(question, limit=MAX_QUERY_TOKENS)
        if not query_tokens:
            return None
        matches = self._search(query_tokens)
        if not matches:
            return None
        return _answer(question, matches, self._corpus_sha256, self._top_k)

    def _search(self, query_tokens: tuple[str, ...]) -> tuple[tuple[_Record, float], ...]:
        expression = " OR ".join(f'"{token}"' for token in query_tokens)
        # ponytail: global lock; use per-thread read connections if retrieval throughput matters.
        with self._search_lock:
            rows = self._connection.execute(
                "SELECT entity_id, bm25(knowledge, ?, ?, ?, ?, ?) AS raw_bm25 "
                "FROM knowledge WHERE knowledge MATCH ? ORDER BY raw_bm25 ASC, entity_id ASC LIMIT ?",
                (*_FTS5_FIELD_WEIGHTS, expression, self._top_k * 4),
            ).fetchall()
        records = {record.key: record for record in self._records}
        return tuple(
            (record, float(row[1]))
            for row in rows
            if _is_confident_match(record := records[row[0]], query_tokens, self._document_frequency)
        )[: self._top_k]


def tokenize(text: str, *, limit: int | None = None) -> tuple[str, ...]:
    tokens: list[str] = []
    for match in _TOKEN_PATTERN.finditer(text.casefold()):
        value = match.group()
        tokens.extend(_tokens_for_match(value))
    filtered = tuple(dict.fromkeys(token for token in tokens if token not in _STOP_TOKENS))
    return filtered if limit is None else filtered[:limit]


def _tokens_for_match(value: str) -> tuple[str, ...]:
    if any("\u4e00" <= character <= "\u9fff" for character in value):
        return tuple(value) + tuple(value[index : index + 2] for index in range(len(value) - 1))
    parts = tuple(part for part in re.split(r"[_-]", value) if part)
    tokens = (value, *parts) if len(parts) > 1 else (value,)
    return tuple(dict.fromkeys(token for token in tokens for token in (token, _stem(token))))


def _stem(token: str) -> str:
    if len(token) > 5 and token.endswith("ion"):
        return token[:-3]
    if len(token) > 4 and token.endswith("e"):
        return token[:-1]
    if len(token) > 5 and token.endswith("ing"):
        return token[:-3]
    return token


def _records_from_bundles(
    bundles: tuple[KnowledgeBundle, ...], *, include_aliases: bool
) -> tuple[_Record, ...]:
    records: list[_Record] = []
    seen_keys: set[str] = set()
    for bundle in bundles:
        for entity in bundle.entities:
            key = f"{bundle.spec.slug}:{entity.entity_id}"
            if key in seen_keys:
                raise KnowledgeRetrievalError(f"duplicate knowledge entity: {key}")
            seen_keys.add(key)
            metadata_fields = (
                bundle.spec.slug,
                entity.entity_id,
            )
            fields = (
                *metadata_fields,
                " ".join(entity.aliases) if include_aliases else "",
                bundle.chunk_text(entity.entity_id),
            )
            records.append(
                _Record(
                    key,
                    entity,
                    bundle.spec.slug,
                    bundle.chunk_text(entity.entity_id),
                    frozenset(token for field in fields for token in tokenize(field)),
                    frozenset(token for field in metadata_fields for token in tokenize(field)),
                )
            )
    return tuple(records)


def _create_index(records: tuple[_Record, ...]) -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    try:
        connection.execute("CREATE VIRTUAL TABLE knowledge USING fts5(entity_id UNINDEXED, stage, identifier, aliases, content)")
    except sqlite3.OperationalError as exc:
        connection.close()
        raise KnowledgeRetrievalError("SQLite FTS5 is unavailable") from exc
    connection.executemany(
        "INSERT INTO knowledge(entity_id, stage, identifier, aliases, content) VALUES (?, ?, ?, ?, ?)",
        (_index_row(record) for record in records),
    )
    return connection


def _index_row(record: _Record) -> tuple[str, str, str, str, str]:
    entity = record.entity
    return (
        record.key,
        " ".join(tokenize(record.stage)),
        " ".join(tokenize(entity.entity_id)),
        " ".join(token for alias in entity.aliases for token in tokenize(alias)),
        " ".join(tokenize(record.text)),
    )


def _is_confident_match(
    record: _Record, query_tokens: tuple[str, ...], document_frequency: Counter[str]
) -> bool:
    shared = record.tokens.intersection(query_tokens)
    return (
        len(shared) >= 2
        or bool(record.metadata_tokens.intersection(query_tokens))
        or any(document_frequency[token] <= 2 for token in shared)
    )


def _corpus_sha256(records: tuple[_Record, ...]) -> str:
    payload = [
        {
            "chunk_sha256": record.entity.chunk_sha256,
            "entity_id": record.entity.entity_id,
            "stage": record.stage,
        }
        for record in records
    ]
    return _sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _answer(
    question: str, matches: tuple[tuple[_Record, float], ...], corpus_sha256: str, top_k: int
) -> KnowledgeAnswer:
    entity_ids = tuple(record.entity.entity_id for record, _score in matches)
    source_ids = tuple(dict.fromkeys(source for record, _score in matches for source in record.entity.source_ids))
    contract_matches = [
        {
            "rank": rank,
            "entity_id": record.entity.entity_id,
            "stage": record.stage,
            "raw_bm25": raw_bm25,
            "chunk_sha256": record.entity.chunk_sha256,
            "source_ids": list(record.entity.source_ids),
        }
        for rank, (record, raw_bm25) in enumerate(matches, start=1)
    ]
    return KnowledgeAnswer(
        text="\n\n".join(record.text for record, _score in matches),
        entity_ids=entity_ids,
        contract={
            "schema_version": "ecos-knowledge-answer.v2",
            "intent": "explain",
            "read_only": True,
            "source_ids": list(source_ids),
            "retrieval": {
                "backend": BACKEND,
                "tokenizer_version": TOKENIZER_VERSION,
                "corpus_sha256": corpus_sha256,
                "top_k": top_k,
                "score_order": "ascending",
                "field_weights": dict(zip(("stage", "identifier", "aliases", "content"), FIELD_WEIGHTS)),
                "query_sha256": _sha256(question.encode("utf-8")),
            },
            "matches": contract_matches,
        },
    )


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
