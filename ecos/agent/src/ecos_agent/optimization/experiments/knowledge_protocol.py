"""Immutable protocol helpers for the two-design knowledge pilot."""

from __future__ import annotations

from typing import Mapping, Sequence

from ecos_agent.hashing import canonical_sha256

PILOT_DESIGNS = ("gcd",)


def context_fingerprint(payload: Mapping[str, object]) -> str:
    """Hash the frozen context without allowing caller ordering to drift."""
    return canonical_sha256({"schema_version": "ecos.frozen_context.v1", **dict(payload)})


def validate_design_ids(design_ids: Sequence[str]) -> tuple[str, ...]:
    values = tuple(sorted(set(design_ids)))
    if not values or any(item not in PILOT_DESIGNS for item in values):
        raise ValueError("knowledge pilot only supports gcd")
    return values


def build_protocol_manifest(
    *,
    design_ids: Sequence[str],
    treatments: Sequence[str],
    knowledge_bundle_sha256: str,
    state_rule_manifest_sha256: str,
    objective_contract_sha256: str,
    toolchain: Mapping[str, object],
    model: Mapping[str, object],
    budget: Mapping[str, object],
    noise_rule: Mapping[str, object],
) -> dict[str, object]:
    payload = {
        "schema_version": "ecos.knowledge_pilot_protocol.v1",
        "design_ids": list(validate_design_ids(design_ids)),
        "treatments": list(treatments),
        "knowledge_bundle_sha256": knowledge_bundle_sha256,
        "state_rule_manifest_sha256": state_rule_manifest_sha256,
        "objective_contract_sha256": objective_contract_sha256,
        "toolchain": dict(toolchain),
        "model": dict(model),
        "budget": dict(budget),
        "noise_rule": dict(noise_rule),
        "cohort_role": "pilot_only",
    }
    payload["protocol_hash"] = canonical_sha256(payload)
    return payload


def validate_protocol_manifest(manifest: Mapping[str, object]) -> None:
    if manifest.get("schema_version") != "ecos.knowledge_pilot_protocol.v1":
        raise ValueError("unsupported knowledge pilot protocol")
    expected = dict(manifest)
    actual = expected.pop("protocol_hash", None)
    if actual != canonical_sha256(expected):
        raise ValueError("knowledge pilot protocol hash mismatch")
    validate_design_ids(manifest.get("design_ids", ()))
