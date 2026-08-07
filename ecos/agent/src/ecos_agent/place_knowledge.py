"""Read-only retrieval of the packaged ECOS placement knowledge bundle."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class PlaceKnowledgeError(ValueError):
    """Raised when a bundled knowledge snapshot cannot be trusted."""


@dataclass(frozen=True)
class KnowledgeAnswer:
    text: str
    entity_ids: tuple[str, ...]
    contract: dict[str, Any]


@dataclass(frozen=True)
class _Entity:
    entity_id: str
    aliases: tuple[str, ...]
    document: str
    anchor: str
    chunk_sha256: str
    source_ids: tuple[str, ...]


class PlaceKnowledge:
    """Load and render only hash-locked, source-audited Markdown chunks."""

    def __init__(self, entities: tuple[_Entity, ...], chunks: dict[str, str]) -> None:
        self._entities = entities
        self._chunks = chunks

    @property
    def entities(self) -> tuple[_Entity, ...]:
        return self._entities

    @property
    def entity_ids(self) -> tuple[str, ...]:
        return tuple(entity.entity_id for entity in self._entities)

    @classmethod
    def from_default(cls) -> "PlaceKnowledge":
        bundled_root = getattr(sys, "_MEIPASS", None)
        root = Path(bundled_root) / "place-knowledge" if bundled_root else Path(__file__).with_name("place_knowledge")
        return cls.from_directory(root)

    @classmethod
    def from_directory(cls, root: Path) -> "PlaceKnowledge":
        manifest = _read_json(root / "manifest.json")
        catalog = _read_json(root / "catalog.json")
        sources = _read_json(root / "sources.json")
        _validate_manifest(root, manifest, catalog, sources)
        return cls(*_load_entities(root, catalog, sources))

    def reply(self, question: str) -> KnowledgeAnswer | None:
        matches = _rank_matches(question, self._entities)
        if not matches:
            return None
        entity_ids = tuple(entity.entity_id for entity in matches)
        source_ids = tuple(dict.fromkeys(source for entity in matches for source in entity.source_ids))
        return KnowledgeAnswer(
            text="\n\n".join(self._chunks[entity_id] for entity_id in entity_ids),
            entity_ids=entity_ids,
            contract={
                "schema_version": "ecos-place-answer.v1",
                "intent": "explain",
                "read_only": True,
                "entity_ids": list(entity_ids),
                "source_ids": list(source_ids),
            },
        )

    def chunk_text(self, entity_id: str) -> str:
        return self._chunks[entity_id]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PlaceKnowledgeError(f"invalid knowledge bundle file: {path.name}") from exc
    if not isinstance(payload, dict):
        raise PlaceKnowledgeError(f"knowledge bundle file must be an object: {path.name}")
    return payload


def _validate_manifest(root: Path, manifest: dict[str, Any], catalog: dict[str, Any], sources: dict[str, Any]) -> None:
    if manifest.get("schema_version") != "ecos-place-manifest.v1":
        raise PlaceKnowledgeError("unsupported knowledge bundle manifest")
    if catalog.get("schema_version") != "ecos-place-catalog.v2":
        raise PlaceKnowledgeError("unsupported knowledge bundle catalog")
    if catalog.get("publication", {}).get("status") != "source-audited":
        raise PlaceKnowledgeError("knowledge bundle is not source-audited")
    expected = manifest.get("files")
    if not isinstance(expected, dict):
        raise PlaceKnowledgeError("knowledge bundle manifest has no file hashes")
    for relative_path, expected_hash in expected.items():
        path = root / str(relative_path)
        if not path.is_file() or _sha256(path.read_bytes()) != expected_hash:
            raise PlaceKnowledgeError(f"knowledge bundle hash mismatch: {relative_path}")
    if not isinstance(sources.get("sources"), list):
        raise PlaceKnowledgeError("knowledge bundle has invalid source inventory")


def _load_entities(root: Path, catalog: dict[str, Any], sources: dict[str, Any]) -> tuple[tuple[_Entity, ...], dict[str, str]]:
    source_ids = {item.get("id") for item in sources["sources"] if isinstance(item, dict)}
    raw_entities = catalog.get("entities")
    if not isinstance(raw_entities, list):
        raise PlaceKnowledgeError("knowledge bundle has no entity catalog")
    entities: list[_Entity] = []
    chunks: dict[str, str] = {}
    for raw_entity in raw_entities:
        entity, chunk = _load_entity(root, raw_entity, source_ids)
        if entity.entity_id in chunks:
            raise PlaceKnowledgeError(f"duplicate knowledge entity: {entity.entity_id}")
        entities.append(entity)
        chunks[entity.entity_id] = chunk
    return tuple(entities), chunks


def _load_entity(root: Path, raw: object, known_source_ids: set[object]) -> tuple[_Entity, str]:
    if not isinstance(raw, dict) or raw.get("review_status") != "source-audited":
        raise PlaceKnowledgeError("knowledge bundle has an unreviewed entity")
    entity_id, document, anchor = (str(raw.get(key, "")) for key in ("id", "document", "anchor"))
    aliases = raw.get("aliases")
    evidence = raw.get("evidence")
    if not entity_id or not document or anchor != entity_id or not isinstance(aliases, list) or not isinstance(evidence, list):
        raise PlaceKnowledgeError("knowledge bundle entity is malformed")
    source_ids = tuple(str(item.get("source_id", "")) for item in evidence if isinstance(item, dict))
    if not source_ids or any(source_id not in known_source_ids for source_id in source_ids):
        raise PlaceKnowledgeError(f"knowledge bundle entity has invalid evidence: {entity_id}")
    chunk = _markdown_chunk(root / "knowledge" / document, anchor)
    chunk_hash = str(raw.get("chunk_sha256", ""))
    if _sha256(chunk.encode("utf-8")) != chunk_hash:
        raise PlaceKnowledgeError(f"knowledge bundle chunk hash mismatch: {entity_id}")
    return _Entity(entity_id, tuple(str(alias) for alias in aliases), document, anchor, chunk_hash, source_ids), chunk


def _markdown_chunk(path: Path, anchor: str) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PlaceKnowledgeError(f"knowledge document is unavailable: {path.name}") from exc
    pattern = re.compile(r'<a id="([^"]+)"></a>')
    matches = list(pattern.finditer(text))
    for index, match in enumerate(matches):
        if match.group(1) == anchor:
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            return text[match.start():end].strip()
    raise PlaceKnowledgeError(f"knowledge anchor is unavailable: {anchor}")


def _rank_matches(question: str, entities: tuple[_Entity, ...]) -> tuple[_Entity, ...]:
    normalized = _normalize(question)
    scored = [(entity, _match_score(normalized, entity)) for entity in entities]
    hits = [(entity, score) for entity, score in scored if score]
    hits.sort(key=lambda item: (-item[1], item[0].entity_id))
    return tuple(entity for entity, _score in hits[:3])


def _match_score(question: str, entity: _Entity) -> int:
    scores = [len(alias) for alias in map(_normalize, entity.aliases) if len(alias) > 1 and alias in question]
    return max(scores, default=0)


def _normalize(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", text.casefold())


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
