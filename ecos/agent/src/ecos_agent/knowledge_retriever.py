"""Deterministic global retrieval over trusted ECOS knowledge bundles."""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import sys
import threading
from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

from ecos_agent.knowledge_bundle import KnowledgeAnswer, KnowledgeBundle, KnowledgeEntity


TOKENIZER_VERSION = "ecos-knowledge-tokenizer.v1"
BACKEND = "sqlite_fts5_bm25"
TOP_K = 3
MAX_QUERY_TOKENS = 32
STAGE_ROUTED_MIN_TOKEN_OVERLAP = 2
FIELD_WEIGHTS = (10.0, 20.0, 10.0, 1.0)
_FIELD_NAMES = ("stage", "identifier", "reserved", "content")
_STOP_TOKENS = frozenset({"a", "an", "and", "are", "by", "does", "for", "how", "in", "is", "of", "on", "or", "the", "to", "what", "with", "了", "何", "如", "是", "的", "算", "计", "指", "标", "如何", "计算", "指标"})
_TOKEN_PATTERN = re.compile(r"[a-z0-9]+(?:[_-][a-z0-9]+)*|[\u4e00-\u9fff]+", re.IGNORECASE)
_ACRONYM_PATTERN = re.compile(r"(?<![A-Z0-9_])[A-Z][A-Z0-9_]{1,}(?![A-Z0-9_])")
_NAMED_TOKEN_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_])(?:[A-Z]{2,}[A-Za-z0-9_]*|[A-Za-z]*[a-z][A-Z][A-Za-z0-9_]*)(?![A-Za-z0-9_])"
)


class KnowledgeRetrievalError(RuntimeError):
    """Raised when the local FTS5 retrieval backend is unavailable."""


@dataclass(frozen=True)
class RetrievalConfig:
    """Frozen, evaluator-selectable parameters for deterministic retrieval."""

    top_k: int = TOP_K
    field_weights: tuple[float, float, float, float] = FIELD_WEIGHTS
    max_query_tokens: int = MAX_QUERY_TOKENS
    max_raw_bm25: float | None = None
    min_score_margin: float = 0.0
    min_token_overlap: int = 3
    max_document_frequency: int = 0
    allow_metadata_match: bool = False

    def __post_init__(self) -> None:
        if type(self.top_k) is not int or self.top_k not in {3, 5, 8}:
            raise ValueError("knowledge retrieval top_k must be one of 3, 5, or 8")
        if not isinstance(self.field_weights, tuple) or len(self.field_weights) != len(_FIELD_NAMES) or any(
            not isinstance(weight, (int, float))
            or isinstance(weight, bool)
            or not math.isfinite(weight)
            or weight < 0
            for weight in self.field_weights
        ):
            raise ValueError("knowledge retrieval field weights must be four non-negative finite values")
        if any(
            type(value) is not int
            for value in (self.max_query_tokens, self.min_token_overlap, self.max_document_frequency)
        ) or self.max_query_tokens <= 0 or self.min_token_overlap <= 0 or self.max_document_frequency < 0:
            raise ValueError("knowledge retrieval token limits must be valid")
        if self.max_raw_bm25 is not None and (
            not isinstance(self.max_raw_bm25, (int, float))
            or isinstance(self.max_raw_bm25, bool)
            or not math.isfinite(self.max_raw_bm25)
        ):
            raise ValueError("knowledge retrieval max_raw_bm25 must be finite or None")
        if (
            not isinstance(self.min_score_margin, (int, float))
            or isinstance(self.min_score_margin, bool)
            or not math.isfinite(self.min_score_margin)
            or self.min_score_margin < 0
        ):
            raise ValueError("knowledge retrieval min_score_margin must be non-negative and finite")
        if type(self.allow_metadata_match) is not bool:
            raise ValueError("knowledge retrieval allow_metadata_match must be a boolean")

    def contract(self) -> dict[str, object]:
        return {
            "top_k": self.top_k,
            "field_weights": dict(zip(_FIELD_NAMES, self.field_weights)),
            "max_query_tokens": self.max_query_tokens,
            "max_raw_bm25": self.max_raw_bm25,
            "min_score_margin": self.min_score_margin,
            "min_token_overlap": self.min_token_overlap,
            "max_document_frequency": self.max_document_frequency,
            "allow_metadata_match": self.allow_metadata_match,
        }


DEFAULT_RETRIEVAL_CONFIG = RetrievalConfig()
_CONFIG_SCHEMA = "ecos-frozen-knowledge-retrieval-config.v1"
_CONFIG_NAME = "retrieval-config.v1.json"


def load_production_retrieval_config() -> RetrievalConfig:
    root = Path(getattr(sys, "_MEIPASS", "")) / "knowledge" if getattr(sys, "_MEIPASS", None) else _knowledge_root()
    try:
        raw = json.loads((root / _CONFIG_NAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise KnowledgeRetrievalError("production retrieval config is unavailable") from exc
    if not isinstance(raw, dict) or raw.get("schema_version") != _CONFIG_SCHEMA:
        raise KnowledgeRetrievalError("production retrieval config is invalid")
    values = {name: raw.get(name, getattr(DEFAULT_RETRIEVAL_CONFIG, name)) for name in RetrievalConfig.__dataclass_fields__}
    if set(raw) != {"schema_version", *RetrievalConfig.__dataclass_fields__}:
        raise KnowledgeRetrievalError("production retrieval config has invalid fields")
    if isinstance(values["field_weights"], list):
        values["field_weights"] = tuple(values["field_weights"])
    try:
        return RetrievalConfig(**values)
    except (TypeError, ValueError) as exc:
        raise KnowledgeRetrievalError("production retrieval config is invalid") from exc


def _knowledge_root() -> Path:
    source_root = Path(__file__).parents[2] / "knowledge"
    return source_root if source_root.is_dir() else Path(__file__).with_name("knowledge")


@dataclass(frozen=True)
class _Record:
    key: str
    entity: KnowledgeEntity
    stage: str
    text: str
    acronym_tokens: frozenset[str]
    identifier_tokens: frozenset[str]
    identifier_phrase_tokens: tuple[str, ...]
    tokens: frozenset[str]
    metadata_tokens: frozenset[str]


@dataclass(frozen=True)
class _StageScope:
    candidate_stages: tuple[str, ...] = ()
    matched_entity_ids: tuple[str, ...] = ()
    matched_keys: frozenset[str] = frozenset()
    reason: str = "insufficient_or_ambiguous_identifier_evidence"

    def contract(self) -> dict[str, object]:
        mode = "single_stage" if len(self.candidate_stages) == 1 else "candidate_union"
        return {
            "mode": mode if self.candidate_stages else "global",
            "reason": self.reason,
            "candidate_stages": list(self.candidate_stages),
            "matched_entity_ids": list(self.matched_entity_ids),
        }


class GlobalKnowledgeRetriever:
    """Search every verified entity in one in-memory SQLite FTS5 corpus."""

    def __init__(
        self,
        bundles: Iterable[KnowledgeBundle],
        *,
        top_k: int | None = None,
        config: RetrievalConfig | None = None,
    ) -> None:
        if top_k is not None and config is not None:
            raise ValueError("knowledge retrieval accepts either top_k or config")
        self._config = replace(DEFAULT_RETRIEVAL_CONFIG, top_k=top_k) if top_k is not None else config or DEFAULT_RETRIEVAL_CONFIG
        self._records = _records_from_bundles(tuple(bundles))
        self._corpus_sha256 = _corpus_sha256(self._records)
        self._document_frequency = Counter(
            token for record in self._records for token in _normalized_tokens(record.tokens)
        )
        self._corpus_tokens = frozenset(token for record in self._records for token in record.tokens)
        self._connection = _create_index(self._records)
        self._search_lock = threading.Lock()

    def reply(self, question: str) -> KnowledgeAnswer | None:
        return self._reply(question, self.stage_scope(question))

    @property
    def stage_ids(self) -> tuple[str, ...]:
        return tuple(sorted({record.stage for record in self._records}))

    @property
    def corpus_sha256(self) -> str:
        return self._corpus_sha256

    @property
    def stage_catalog(self) -> tuple[dict[str, str], ...]:
        catalog: list[dict[str, str]] = []
        for stage in self.stage_ids:
            record = next(
                (
                    item
                    for item in self._records
                    if item.stage == stage
                    and item.entity.entity_id == f"algorithm.{stage}.execution"
                ),
                next(item for item in self._records if item.stage == stage),
            )
            catalog.append(
                {
                    "stage": stage,
                    "summary": " ".join(record.text.split())[:1024],
                    "chunk_sha256": record.entity.chunk_sha256,
                }
            )
        return tuple(catalog)

    def stage_scope(self, question: str) -> _StageScope:
        return _infer_stage_scope(question, _acronym_tokens(question), self._records)

    def reply_global(self, question: str) -> KnowledgeAnswer | None:
        return self._reply(question, _StageScope())

    def reply_for_stages(
        self, question: str, candidate_stages: Iterable[str]
    ) -> KnowledgeAnswer | None:
        stages = self._validated_stages(candidate_stages)
        if not stages:
            return None
        return self._reply(
            question,
            _StageScope(candidate_stages=stages, reason="external_stage_routing_hint"),
        )

    def reply_hybrid(
        self,
        question: str,
        *,
        candidate_stages: Iterable[str] = (),
        deterministic_scope: _StageScope | None = None,
        routing: dict[str, object] | None = None,
    ) -> KnowledgeAnswer | None:
        baseline_scope = _StageScope()
        baseline = self._matches(question, baseline_scope) or ()
        deterministic = deterministic_scope or self.stage_scope(question)
        proposed = self._validated_stages(candidate_stages)
        stages = tuple(dict.fromkeys((*deterministic.candidate_stages, *proposed)))
        scoped = _StageScope(
            candidate_stages=stages,
            matched_entity_ids=deterministic.matched_entity_ids,
            matched_keys=deterministic.matched_keys,
            reason=(
                "deterministic_and_codex_stage_hints"
                if deterministic.candidate_stages and proposed
                else deterministic.reason
                if deterministic.candidate_stages
                else "codex_stage_routing_hint"
                if proposed
                else "no_stage_hint"
            ),
        )
        supplemental = self._matches(question, scoped) if stages else ()
        if not baseline and not supplemental:
            return None
        fused = _fuse_matches(baseline, supplemental, self._config.top_k * 2)
        return _answer(
            question,
            fused,
            self._corpus_sha256,
            self._config,
            scoped,
            fusion={
                "strategy": "baseline_then_scoped_unique",
                "baseline_entity_ids": [record.entity.entity_id for record, _score in baseline],
                "deterministic_stage_scope": deterministic.contract(),
                "supplemental_stage_scope": scoped.contract(),
                "supplemental_entity_ids": [record.entity.entity_id for record, _score in supplemental],
                "routing": routing or {"status": "not_requested"},
                "stage_routing_min_token_overlap": STAGE_ROUTED_MIN_TOKEN_OVERLAP,
                "max_items": self._config.top_k * 2,
            },
        )

    def _reply(self, question: str, scope: _StageScope) -> KnowledgeAnswer | None:
        matches = self._matches(question, scope)
        if not matches:
            return None
        return _answer(question, matches, self._corpus_sha256, self._config, scope)

    def _matches(
        self, question: str, scope: _StageScope
    ) -> tuple[tuple[_Record, float], ...] | None:
        query_tokens = tokenize(question, limit=self._config.max_query_tokens)
        if not query_tokens or _has_unknown_named_token(question, self._corpus_tokens):
            return None
        query_acronyms = _acronym_tokens(question)
        matches = self._search(query_tokens, query_acronyms, _phrase_tokens(question), scope)
        return matches or None

    def _validated_stages(self, candidate_stages: Iterable[str]) -> tuple[str, ...]:
        stages = tuple(candidate_stages)
        if len(set(stages)) != len(stages) or any(
            not isinstance(stage, str) or stage not in self.stage_ids for stage in stages
        ):
            raise ValueError("stage routing candidates are not in the knowledge catalog")
        return stages

    def _search(
        self,
        query_tokens: tuple[str, ...],
        query_acronyms: frozenset[str],
        query_phrase: tuple[str, ...],
        scope: _StageScope,
    ) -> tuple[tuple[_Record, float], ...]:
        expression = " OR ".join(f'"{token}"' for token in query_tokens)
        scope_predicate = _scope_predicate(scope.candidate_stages)
        scope_patterns = tuple(f"{stage}:*" for stage in scope.candidate_stages)
        # ponytail: global lock; use per-thread read connections if retrieval throughput matters.
        with self._search_lock:
            rows = self._connection.execute(
                "SELECT entity_id, bm25(knowledge, ?, ?, ?, ?, ?) AS raw_bm25 "
                f"FROM knowledge WHERE {scope_predicate}knowledge MATCH ? "
                "ORDER BY raw_bm25 ASC, entity_id ASC LIMIT ?",
                (
                    0.0,
                    *self._config.field_weights,
                    *scope_patterns,
                    expression,
                    self._config.top_k * 4,
                ),
            ).fetchall()
            phrase_keys = set()
            if len(query_phrase) >= 3:
                phrase_expression = '"' + " ".join(query_phrase) + '"'
                phrase_keys = {
                    row[0]
                    for row in self._connection.execute(
                        f"SELECT entity_id FROM knowledge WHERE {scope_predicate}knowledge MATCH ?",
                        (*scope_patterns, phrase_expression),
                    ).fetchall()
                }
        records = {record.key: record for record in self._records}
        matches = [
            (record, float(row[1]))
            for row in rows
            if _is_confident_match(
                record := records[row[0]],
                query_tokens,
                query_acronyms,
                self._document_frequency,
                self._config,
                scope,
            )
        ]
        if self._config.max_raw_bm25 is not None and matches and matches[0][1] > self._config.max_raw_bm25:
            return ()
        if len(matches) > 1 and matches[1][1] - matches[0][1] < self._config.min_score_margin:
            return ()
        matches.sort(key=lambda item: (item[0].key not in phrase_keys, item[1], item[0].key))
        return tuple(matches[: self._config.top_k])


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


def _acronym_tokens(text: str) -> frozenset[str]:
    return frozenset(match.group().casefold() for match in _ACRONYM_PATTERN.finditer(text))


def _phrase_tokens(text: str) -> tuple[str, ...]:
    values = tuple(match.group().casefold() for match in _TOKEN_PATTERN.finditer(text))
    if any(any("\u4e00" <= character <= "\u9fff" for character in value) for value in values):
        return ()
    return tuple(token for value in values for token in _tokens_for_match(value))


def _has_unknown_named_token(text: str, corpus_tokens: frozenset[str]) -> bool:
    for match in _NAMED_TOKEN_PATTERN.finditer(text):
        if match.start() == 0:
            continue
        if any(token not in corpus_tokens for token in tokenize(match.group())):
            return True
    return False


def _stem(token: str) -> str:
    if len(token) > 5 and token.endswith("ion"):
        return token[:-3]
    if len(token) > 4 and token.endswith("e"):
        return token[:-1]
    if len(token) > 5 and token.endswith("ing"):
        return token[:-3]
    return token


def _records_from_bundles(bundles: tuple[KnowledgeBundle, ...]) -> tuple[_Record, ...]:
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
                bundle.chunk_text(entity.entity_id),
            )
            records.append(
                _Record(
                    key,
                    entity,
                    bundle.spec.slug,
                    bundle.chunk_text(entity.entity_id),
                    frozenset(token for field in fields for token in _acronym_tokens(field)),
                    frozenset(tokenize(entity.entity_id)),
                    _identifier_phrase_tokens(entity.entity_id),
                    frozenset(token for field in fields for token in tokenize(field)),
                    frozenset(token for field in metadata_fields for token in tokenize(field)),
                )
            )
    return tuple(records)


def _infer_stage_scope(
    question: str, query_acronyms: frozenset[str], records: tuple[_Record, ...]
) -> _StageScope:
    query_terms = tuple(
        term for term in _identifier_phrase_tokens(question) if term not in _STOP_TOKENS
    )
    matched = tuple(
        record
        for record in records
        if _has_identifier_evidence(record, query_terms, query_acronyms)
    )
    candidate_stages = tuple(sorted({record.stage for record in matched}))
    if not candidate_stages or len(candidate_stages) == len(
        {record.stage for record in records}
    ):
        return _StageScope()
    return _StageScope(
        candidate_stages,
        tuple(sorted({record.entity.entity_id for record in matched})),
        frozenset(record.key for record in matched),
        "canonical_identifier_phrase_or_acronym",
    )


def _has_identifier_evidence(
    record: _Record, query_terms: tuple[str, ...], query_acronyms: frozenset[str]
) -> bool:
    return (
        _identifier_phrase_covers_query(record.identifier_phrase_tokens, query_terms)
        or bool(record.identifier_tokens.intersection(query_acronyms))
    )


def _identifier_phrase_tokens(text: str) -> tuple[str, ...]:
    return tuple(
        match.group().casefold()
        for match in re.finditer(r"[a-z0-9]+", text, re.IGNORECASE)
    )


def _bigrams(tokens: tuple[str, ...]) -> frozenset[tuple[str, str]]:
    return frozenset(zip(tokens, tokens[1:]))


def _identifier_phrase_covers_query(
    identifier_terms: tuple[str, ...], query_terms: tuple[str, ...]
) -> bool:
    matched_terms = {
        term
        for pair in _bigrams(identifier_terms).intersection(_bigrams(query_terms))
        for term in pair
    }
    return bool(matched_terms) and 2 * len(matched_terms) >= len(query_terms)


def _scope_predicate(stages: tuple[str, ...]) -> str:
    if not stages:
        return ""
    return "(" + " OR ".join("entity_id GLOB ?" for _ in stages) + ") AND "


def _create_index(records: tuple[_Record, ...]) -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    try:
        connection.execute("CREATE VIRTUAL TABLE knowledge USING fts5(entity_id UNINDEXED, stage, identifier, reserved, content)")
    except sqlite3.OperationalError as exc:
        connection.close()
        raise KnowledgeRetrievalError("SQLite FTS5 is unavailable") from exc
    connection.executemany(
        "INSERT INTO knowledge(entity_id, stage, identifier, reserved, content) VALUES (?, ?, ?, ?, ?)",
        (_index_row(record) for record in records),
    )
    return connection


def _index_row(record: _Record) -> tuple[str, str, str, str, str]:
    entity = record.entity
    return (
        record.key,
        " ".join(tokenize(record.stage)),
        " ".join(tokenize(entity.entity_id)),
        "",
        " ".join(tokenize(record.text)),
    )


def _is_confident_match(
    record: _Record,
    query_tokens: tuple[str, ...],
    query_acronyms: frozenset[str],
    document_frequency: Counter[str],
    config: RetrievalConfig,
    scope: _StageScope,
) -> bool:
    shared = _normalized_tokens(record.tokens).intersection(_normalized_tokens(query_tokens))
    return (
        len(shared) >= config.min_token_overlap
        or record.key in scope.matched_keys
        or _stage_routed_overlap(scope, shared)
        or bool(record.acronym_tokens.intersection(query_acronyms))
        or config.allow_metadata_match
        and bool(_normalized_tokens(record.metadata_tokens).intersection(_normalized_tokens(query_tokens)))
        or config.max_document_frequency > 0
        and any(document_frequency[token] <= config.max_document_frequency for token in shared)
    )


def _stage_routed_overlap(scope: _StageScope, shared: frozenset[str]) -> bool:
    return (
        scope.reason
        in {
            "external_stage_routing_hint",
            "codex_stage_routing_hint",
            "deterministic_and_codex_stage_hints",
        }
        and len(shared) >= STAGE_ROUTED_MIN_TOKEN_OVERLAP
    )


def _normalized_tokens(tokens: Iterable[str]) -> frozenset[str]:
    return frozenset(_stem(token) for token in tokens)


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
    question: str,
    matches: tuple[tuple[_Record, float], ...],
    corpus_sha256: str,
    config: RetrievalConfig,
    scope: _StageScope,
    fusion: dict[str, object] | None = None,
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
            "entity_ids": list(entity_ids),
            "source_ids": list(source_ids),
            "retrieval": {
                "backend": BACKEND,
                "tokenizer_version": TOKENIZER_VERSION,
                "corpus_sha256": corpus_sha256,
                "top_k": config.top_k,
                "score_order": "ascending",
                "field_weights": dict(zip(_FIELD_NAMES, config.field_weights)),
                "config": config.contract(),
                "stage_scope": scope.contract(),
                "query_sha256": _sha256(question.encode("utf-8")),
                **({"fusion": fusion} if fusion is not None else {}),
            },
            "matches": contract_matches,
        },
    )


def _fuse_matches(
    baseline: tuple[tuple[_Record, float], ...],
    supplemental: tuple[tuple[_Record, float], ...] | None,
    limit: int,
) -> tuple[tuple[_Record, float], ...]:
    fused = list(baseline)
    seen = {record.key for record, _score in baseline}
    for match in supplemental or ():
        if match[0].key not in seen:
            fused.append(match)
            seen.add(match[0].key)
    return tuple(fused[:limit])


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
