"""Hash-bound activation orchestration over the existing candidate runner."""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.knowledge_mediation import (
    classify_terminal_delta,
)
from ecos_agent.optimization.experiments.knowledge_protocol import (
    validate_protocol_manifest,
)

ACTIVATION_ROW_SCHEMA_VERSION = "ecos.knowledge_activation_mediation.v1"
_PROPOSAL_KEYS = (
    "knob",
    "direction",
    "requested_value",
    "claim_id",
    "claim_sha256",
    "binding_id",
    "binding_sha256",
)
# Links only the native execution chain can supply; any missing link keeps
# the row out of utility analysis instead of being inferred.
_RESULT_LINKS = (
    "actual_value",
    "receipt_status",
    "terminal_observation_hash",
    "terminal_delta",
    "promotion_decision",
)


def validate_activation_input(
    row: Mapping[str, Any],
    protocol: Mapping[str, Any],
    *,
    design_id: str,
    parent_checkpoint: str,
    offline_gate: Mapping[str, Any] | None = None,
) -> None:
    validate_protocol_manifest(protocol)
    if offline_gate is not None and offline_gate.get("offline_gate_pass") is not True:
        raise ValueError("activation requires a passing offline gate")
    if row.get("design_id") != design_id or row.get("stratum") != "knowledge_opportunity":
        raise ValueError("activation requires a matching knowledge-opportunity row")
    if row.get("decision") != "propose" or not row.get("claim_bound"):
        raise ValueError("activation requires a claim-bound proposal")
    if not parent_checkpoint:
        raise ValueError("activation requires a parent checkpoint")
    expected = row.get("context_fingerprint")
    if not isinstance(expected, str) or not expected.startswith("sha256:"):
        raise ValueError("activation context fingerprint is missing")


def _proposal_hash(row: Mapping[str, Any]) -> str:
    """Hash the proposal content alone, not the offline row around it."""
    return canonical_sha256({key: row.get(key) for key in _PROPOSAL_KEYS})


def run_activation(
    *,
    row: Mapping[str, Any],
    protocol: Mapping[str, Any],
    design_id: str,
    parent_checkpoint: str,
    candidate_runner: Callable[..., Mapping[str, Any]],
    epsilon: float,
    offline_gate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    validate_activation_input(
        row,
        protocol,
        design_id=design_id,
        parent_checkpoint=parent_checkpoint,
        offline_gate=offline_gate,
    )
    mediation: dict[str, Any] = {
        "schema_version": ACTIVATION_ROW_SCHEMA_VERSION,
        "protocol_hash": protocol["protocol_hash"],
        "design_id": design_id,
        "context_fingerprint": row["context_fingerprint"],
        "parent_checkpoint": parent_checkpoint,
        "proposal_hash": _proposal_hash(row),
        "support_status": row.get("support_status", "unknown"),
        "claim_bound": True,
        "knob": row.get("knob"),
        "direction": row.get("direction"),
        "requested_value": row.get("requested_value"),
        "actual_value": None,
        "receipt_status": "unknown",
        "terminal_observation_hash": None,
        "terminal_delta": None,
        "epsilon_comparison": "unobserved",
        "promotion_decision": None,
        "failure_or_timeout_reason": None,
    }
    try:
        result = dict(
            candidate_runner(design_id=design_id, parent_checkpoint=parent_checkpoint, row=dict(row))
        )
    except Exception as exc:  # failed activations stay in the denominator
        mediation.update(
            row_status="incomplete",
            missing_evidence=list(_RESULT_LINKS),
            failure_or_timeout_reason=f"{type(exc).__name__}: {exc}"[:400],
        )
        return mediation
    for key in _RESULT_LINKS:
        if result.get(key) is not None:
            mediation[key] = result[key]
    delta = mediation["terminal_delta"]
    if isinstance(delta, (int, float)) and not isinstance(delta, bool):
        mediation["epsilon_comparison"] = classify_terminal_delta(float(delta), epsilon)
    missing = [
        key
        for key in _RESULT_LINKS
        if mediation.get(key) is None or mediation.get(key) == "unknown"
    ]
    mediation["row_status"] = "incomplete" if missing else "complete"
    mediation["missing_evidence"] = missing
    return {**result, **mediation}
