"""Read-only retrieval of audited knowledge for non-placement flow stages."""

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

    @property
    def bundle_spec(self) -> KnowledgeBundleSpec:
        return KnowledgeBundleSpec(self.slug, "ecos-step-manifest.v1", "ecos-step-catalog.v1")


STEP_KNOWLEDGE_SPECS = (
    StepKnowledgeSpec("synthesis", "Synthesis"),
    StepKnowledgeSpec("floorplan", "Floorplan"),
    StepKnowledgeSpec("fixfanout", "fixFanout"),
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
        root = Path(bundled_root) / f"{spec.slug}-knowledge" if bundled_root else Path(__file__).with_name(f"{spec.slug}_knowledge")
        return cls.from_directory(root, spec)

    @classmethod
    def from_directory(cls, root: Path, spec: StepKnowledgeSpec) -> "StepKnowledge":
        return cls._from_directory(root, spec.bundle_spec)


def load_default_step_knowledge() -> tuple[StepKnowledge, ...]:
    return tuple(StepKnowledge.from_default(spec) for spec in STEP_KNOWLEDGE_SPECS)


__all__ = [
    "STEP_KNOWLEDGE_SPECS",
    "StepKnowledge",
    "StepKnowledgeError",
    "StepKnowledgeSpec",
    "load_default_step_knowledge",
]
