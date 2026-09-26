"""Hash-bound frozen contexts used by the offline knowledge pilot."""
from __future__ import annotations

from typing import Mapping, Sequence

from ecos_agent.hashing import canonical_sha256

CONTEXT_SCHEMA_VERSION = "ecos.frozen_context.v1"

# Frozen strata label why a context exists; expected_behavior is the
# reviewable acceptance label the offline gate scores against.
CONTEXT_STRATA = (
    "knowledge_opportunity",
    "stale_binding",
    "missing_required_evidence",
    "anti_condition",
    "no_supported_action",
)
EXPECTED_BEHAVIORS = ("action", "abstain", "block_reject", "unknown")


def build_frozen_context(payload: Mapping[str, object]) -> dict[str, object]:
    value = {"schema_version": CONTEXT_SCHEMA_VERSION, **dict(payload)}
    value["context_fingerprint"] = canonical_sha256(value)
    return value


def validate_frozen_context(context: Mapping[str, object]) -> None:
    if context.get("schema_version") != CONTEXT_SCHEMA_VERSION:
        raise ValueError("unsupported frozen context")
    expected = dict(context)
    actual = expected.pop("context_fingerprint", None)
    if actual != canonical_sha256(expected):
        raise ValueError("frozen context hash mismatch")
    for key in (
        "design_id",
        "objective_contract_sha256",
        "legal_domain_sha256",
        "stratum",
        "expected_behavior",
        "planning_context",
    ):
        if not context.get(key):
            raise ValueError(f"frozen context missing {key}")
    if context["stratum"] not in CONTEXT_STRATA:
        raise ValueError("frozen context stratum is unknown")
    if context["expected_behavior"] not in EXPECTED_BEHAVIORS:
        raise ValueError("frozen context expected behavior is unknown")
    if not isinstance(context["planning_context"], Mapping):
        raise ValueError("frozen context planning context must be an object")


def validate_context_bank(contexts: Sequence[Mapping[str, object]], *, design_id: str) -> None:
    if not contexts:
        raise ValueError("frozen context bank is empty")
    fingerprints = set()
    for context in contexts:
        validate_frozen_context(context)
        if context.get("design_id") != design_id:
            raise ValueError("context bank mixes design ids")
        fingerprint = context["context_fingerprint"]
        if fingerprint in fingerprints:
            raise ValueError("context bank repeats a context fingerprint")
        fingerprints.add(fingerprint)
