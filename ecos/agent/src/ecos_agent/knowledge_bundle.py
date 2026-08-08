"""Read-only loading for hash-locked ECOS knowledge bundles."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class KnowledgeBundleError(ValueError):
    """Raised when a bundled knowledge snapshot cannot be trusted."""


@dataclass(frozen=True)
class KnowledgeAnswer:
    text: str
    entity_ids: tuple[str, ...]
    contract: dict[str, Any]


@dataclass(frozen=True)
class KnowledgeBundleSpec:
    slug: str
    manifest_schema: str
    catalog_schema: str

    @property
    def answer_schema(self) -> str:
        return f"ecos-{self.slug}-answer.v1"


@dataclass(frozen=True)
class KnowledgeEntity:
    entity_id: str
    aliases: tuple[str, ...]
    document: str
    anchor: str
    chunk_sha256: str
    source_ids: tuple[str, ...]


class KnowledgeBundle:
    """Load and render only hash-locked, source-audited Markdown chunks."""

    def __init__(
        self,
        spec: KnowledgeBundleSpec,
        entities: tuple[KnowledgeEntity, ...],
        chunks: dict[str, str],
    ) -> None:
        self.spec = spec
        self._entities = entities
        self._chunks = chunks

    @property
    def entities(self) -> tuple[KnowledgeEntity, ...]:
        return self._entities

    @property
    def entity_ids(self) -> tuple[str, ...]:
        return tuple(entity.entity_id for entity in self._entities)

    @classmethod
    def _from_directory(cls, root: Path, spec: KnowledgeBundleSpec) -> "KnowledgeBundle":
        manifest = _read_json(root / "manifest.json")
        catalog = _read_json(root / "catalog.json")
        sources = _read_json(root / "sources.json")
        _validate_manifest(root, spec, manifest, catalog, sources)
        entities, chunks = _load_entities(root, catalog, sources)
        return cls(spec, entities, chunks)

    def chunk_text(self, entity_id: str) -> str:
        return self._chunks[entity_id]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise KnowledgeBundleError(f"invalid knowledge bundle file: {path.name}") from exc
    if not isinstance(payload, dict):
        raise KnowledgeBundleError(f"knowledge bundle file must be an object: {path.name}")
    return payload


def _validate_manifest(
    root: Path,
    spec: KnowledgeBundleSpec,
    manifest: dict[str, Any],
    catalog: dict[str, Any],
    sources: dict[str, Any],
) -> None:
    if manifest.get("schema_version") != spec.manifest_schema:
        raise KnowledgeBundleError("unsupported knowledge bundle manifest")
    if catalog.get("schema_version") != spec.catalog_schema:
        raise KnowledgeBundleError("unsupported knowledge bundle catalog")
    if catalog.get("publication", {}).get("status") != "source-audited":
        raise KnowledgeBundleError("knowledge bundle is not source-audited")
    expected = manifest.get("files")
    if not isinstance(expected, dict):
        raise KnowledgeBundleError("knowledge bundle manifest has no file hashes")
    for relative_path, expected_hash in expected.items():
        path = root / str(relative_path)
        if not path.is_file() or _sha256(path.read_bytes()) != expected_hash:
            raise KnowledgeBundleError(f"knowledge bundle hash mismatch: {relative_path}")
    if not isinstance(sources.get("sources"), list):
        raise KnowledgeBundleError("knowledge bundle has invalid source inventory")


def _load_entities(
    root: Path, catalog: dict[str, Any], sources: dict[str, Any]
) -> tuple[tuple[KnowledgeEntity, ...], dict[str, str]]:
    source_ids = {item.get("id") for item in sources["sources"] if isinstance(item, dict)}
    raw_entities = catalog.get("entities")
    if not isinstance(raw_entities, list):
        raise KnowledgeBundleError("knowledge bundle has no entity catalog")
    entities: list[KnowledgeEntity] = []
    chunks: dict[str, str] = {}
    for raw_entity in raw_entities:
        entity, chunk = _load_entity(root, raw_entity, source_ids)
        if entity.entity_id in chunks:
            raise KnowledgeBundleError(f"duplicate knowledge entity: {entity.entity_id}")
        entities.append(entity)
        chunks[entity.entity_id] = chunk
    return tuple(entities), chunks


def _load_entity(
    root: Path, raw: object, known_source_ids: set[object]
) -> tuple[KnowledgeEntity, str]:
    if not isinstance(raw, dict) or raw.get("review_status") != "source-audited":
        raise KnowledgeBundleError("knowledge bundle has an unreviewed entity")
    entity_id, document, anchor = (str(raw.get(key, "")) for key in ("id", "document", "anchor"))
    aliases = raw.get("aliases")
    evidence = raw.get("evidence")
    if not entity_id or not document or anchor != entity_id or not isinstance(aliases, list) or not isinstance(evidence, list):
        raise KnowledgeBundleError("knowledge bundle entity is malformed")
    source_ids = tuple(str(item.get("source_id", "")) for item in evidence if isinstance(item, dict))
    if not source_ids or any(source_id not in known_source_ids for source_id in source_ids):
        raise KnowledgeBundleError(f"knowledge bundle entity has invalid evidence: {entity_id}")
    chunk = _markdown_chunk(root / "knowledge" / document, anchor)
    if _sha256(chunk.encode("utf-8")) != str(raw.get("chunk_sha256", "")):
        raise KnowledgeBundleError(f"knowledge bundle chunk hash mismatch: {entity_id}")
    return KnowledgeEntity(
        entity_id,
        tuple(str(alias) for alias in aliases),
        document,
        anchor,
        str(raw["chunk_sha256"]),
        source_ids,
    ), chunk


def _markdown_chunk(path: Path, anchor: str) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise KnowledgeBundleError(f"knowledge document is unavailable: {path.name}") from exc
    matches = list(re.finditer(r'<a id="([^"]+)"></a>', text))
    for index, match in enumerate(matches):
        if match.group(1) == anchor:
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            return text[match.start():end].strip()
    raise KnowledgeBundleError(f"knowledge anchor is unavailable: {anchor}")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
