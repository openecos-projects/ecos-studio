"""Read-only retrieval of audited knowledge for ECOS flow stages."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from ecos_agent.knowledge_bundle import (
    KnowledgeBundle,
    KnowledgeBundleError,
    KnowledgeBundleSpec,
)

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
        return cls.from_directory(tool_bundle_path(root, spec.slug), spec)

    @classmethod
    def from_directory(cls, root: Path, spec: StepKnowledgeSpec) -> "StepKnowledge":
        return cls._from_directory(root, spec.bundle_spec)


GENERAL_KNOWLEDGE_SPEC = KnowledgeBundleSpec(
    "general", "ecos-general-manifest.v1", "ecos-general-catalog.v2"
)
GENERAL_KNOWLEDGE_METRICS = ("congestion", "wirelength")


def load_default_step_knowledge() -> tuple[StepKnowledge, ...]:
    return tuple(StepKnowledge.from_default(spec) for spec in STEP_KNOWLEDGE_SPECS)


def load_default_general_knowledge(metric: str = "congestion") -> KnowledgeBundle:
    bundled_root = getattr(sys, "_MEIPASS", None)
    root = Path(bundled_root) / "knowledge" if bundled_root else _default_knowledge_root()
    return KnowledgeBundle._from_directory(
        general_bundle_path(root, metric), GENERAL_KNOWLEDGE_SPEC
    )


def load_default_general_knowledge_bundles() -> tuple[KnowledgeBundle, ...]:
    return tuple(load_default_general_knowledge(metric) for metric in GENERAL_KNOWLEDGE_METRICS)


def tool_bundle_path(root: Path, slug: str) -> Path:
    return root / "tool" / slug


def general_bundle_path(root: Path, metric: str = "congestion") -> Path:
    if metric not in GENERAL_KNOWLEDGE_METRICS:
        raise StepKnowledgeError(f"unsupported general knowledge metric: {metric}")
    return root / "general" / metric


def _default_knowledge_root() -> Path:
    source_root = Path(__file__).parents[2] / "knowledge"
    if source_root.is_dir():
        return source_root
    return Path(__file__).with_name("knowledge")


__all__ = [
    "GENERAL_KNOWLEDGE_SPEC",
    "GENERAL_KNOWLEDGE_METRICS",
    "STEP_KNOWLEDGE_SPECS",
    "StepKnowledge",
    "StepKnowledgeError",
    "StepKnowledgeSpec",
    "general_bundle_path",
    "load_default_general_knowledge",
    "load_default_general_knowledge_bundles",
    "load_default_step_knowledge",
    "tool_bundle_path",
]
