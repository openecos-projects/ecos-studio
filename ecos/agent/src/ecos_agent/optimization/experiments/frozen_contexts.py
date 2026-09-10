"""Hash-bound frozen contexts used by the offline knowledge pilot."""
from __future__ import annotations

from typing import Mapping, Sequence

from ecos_agent.hashing import canonical_sha256


def build_frozen_context(payload: Mapping[str, object]) -> dict[str, object]:
    value = {"schema_version": "ecos.frozen_context.v1", **dict(payload)}
    value["context_fingerprint"] = canonical_sha256(value)
    return value


def validate_frozen_context(context: Mapping[str, object]) -> None:
    if context.get("schema_version") != "ecos.frozen_context.v1":
        raise ValueError("unsupported frozen context")
    expected = dict(context)
    actual = expected.pop("context_fingerprint", None)
    if actual != canonical_sha256(expected):
        raise ValueError("frozen context hash mismatch")
    for key in ("design_id", "objective_contract_sha256", "legal_domain_sha256"):
        if not context.get(key):
            raise ValueError(f"frozen context missing {key}")


def validate_context_bank(contexts: Sequence[Mapping[str, object]], *, design_id: str) -> None:
    if not contexts:
        raise ValueError("frozen context bank is empty")
    for context in contexts:
        validate_frozen_context(context)
        if context.get("design_id") != design_id:
            raise ValueError("context bank mixes design ids")
