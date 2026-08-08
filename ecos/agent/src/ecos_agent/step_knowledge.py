"""Read-only retrieval of audited knowledge for ECOS flow stages."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from ecos_agent.knowledge_bundle import KnowledgeBundle, KnowledgeBundleError, KnowledgeBundleSpec


StepKnowledgeError = KnowledgeBundleError


@dataclass(frozen=True)
class StepKnowledgeSpec:
    slug: str
    step_name: str
    manifest_schema: str = "ecos-step-manifest.v1"
    catalog_schema: str = "ecos-step-catalog.v2"

    @property
    def bundle_spec(self) -> KnowledgeBundleSpec:
        return KnowledgeBundleSpec(self.slug, self.manifest_schema, self.catalog_schema)


STEP_KNOWLEDGE_SPECS = (
    StepKnowledgeSpec("synthesis", "Synthesis"),
    StepKnowledgeSpec("floorplan", "Floorplan"),
    StepKnowledgeSpec("fixfanout", "fixFanout"),
    StepKnowledgeSpec("place", "place", "ecos-place-manifest.v1", "ecos-place-catalog.v3"),
    StepKnowledgeSpec("cts", "CTS"),
    StepKnowledgeSpec("legalization", "legalization"),
    StepKnowledgeSpec("route", "route"),
    StepKnowledgeSpec("drc", "drc"),
    StepKnowledgeSpec("filler", "filler"),
    StepKnowledgeSpec("rcx", "RCX"),
    StepKnowledgeSpec("sta", "sta"),
    StepKnowledgeSpec("harden", "Harden"),
)


class StepKnowledge(KnowledgeBundle):
    @classmethod
    def from_default(cls, spec: StepKnowledgeSpec) -> "StepKnowledge":
        bundled_root = getattr(sys, "_MEIPASS", None)
        root = Path(bundled_root) / "knowledge" if bundled_root else _default_knowledge_root()
        return cls.from_directory(root / spec.slug, spec)

    @classmethod
    def from_directory(cls, root: Path, spec: StepKnowledgeSpec) -> "StepKnowledge":
        return cls._from_directory(root, spec.bundle_spec)


def load_default_step_knowledge() -> tuple[StepKnowledge, ...]:
    return tuple(StepKnowledge.from_default(spec) for spec in STEP_KNOWLEDGE_SPECS)


def _default_knowledge_root() -> Path:
    source_root = Path(__file__).parents[2] / "knowledge"
    if source_root.is_dir():
        return source_root
    return Path(__file__).with_name("knowledge")


__all__ = [
    "STEP_KNOWLEDGE_SPECS",
    "StepKnowledge",
    "StepKnowledgeError",
    "StepKnowledgeSpec",
    "load_default_step_knowledge",
]
