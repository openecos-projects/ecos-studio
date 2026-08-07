"""Read-only retrieval of the packaged ECOS placement knowledge bundle."""

from __future__ import annotations

import sys
from pathlib import Path

from ecos_agent.knowledge_bundle import KnowledgeAnswer, KnowledgeBundle, KnowledgeBundleError, KnowledgeBundleSpec


PlaceKnowledgeError = KnowledgeBundleError
_PLACE_SPEC = KnowledgeBundleSpec("place", "ecos-place-manifest.v1", "ecos-place-catalog.v2")


class PlaceKnowledge(KnowledgeBundle):
    @classmethod
    def from_default(cls) -> "PlaceKnowledge":
        bundled_root = getattr(sys, "_MEIPASS", None)
        root = Path(bundled_root) / "place-knowledge" if bundled_root else Path(__file__).with_name("place_knowledge")
        return cls.from_directory(root)

    @classmethod
    def from_directory(cls, root: Path) -> "PlaceKnowledge":
        return cls._from_directory(root, _PLACE_SPEC)


__all__ = ["KnowledgeAnswer", "PlaceKnowledge", "PlaceKnowledgeError"]
