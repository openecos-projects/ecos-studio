"""Small, auditable mediation records for knowledge pilot artifacts."""

from __future__ import annotations

from typing import Any, Sequence

import json
from pathlib import Path


def classify_terminal_delta(delta: float | None, epsilon: float) -> str:
    if delta is None:
        return "unobserved"
    if epsilon < 0:
        raise ValueError("epsilon must be non-negative")
    return "outside" if abs(delta) > epsilon else "tie"


def build_mediation_row(
    *,
    design_id: str,
    treatment: str,
    context_fingerprint: str,
    planning_call: int,
    matched_claim_ids: Sequence[str],
    support_status: str,
    claim_id: str | None,
    binding_id: str | None,
    knob: str | None,
    direction: str | None,
    requested_value: Any,
    actual_value: Any,
    receipt_status: str | None,
    terminal_delta: float | None,
    epsilon: float,
    **refs: str | None,
) -> dict[str, object]:
    claim_bound = claim_id is not None and binding_id is not None
    return {
        "schema_version": "ecos.knowledge_mediation_row.v1",
        "design_id": design_id,
        "treatment": treatment,
        "context_fingerprint": context_fingerprint,
        "planning_call": planning_call,
        "matched_claim_ids": list(matched_claim_ids),
        "support_status": support_status,
        "claim_bound": claim_bound,
        "claim_id": claim_id,
        "binding_id": binding_id,
        "knob": knob,
        "direction": direction,
        "requested_value": requested_value,
        "actual_value": actual_value,
        "receipt_status": receipt_status,
        "terminal_delta": terminal_delta,
        "terminal_delta_vs_epsilon": classify_terminal_delta(terminal_delta, epsilon),
        **refs,
    }


def read_jsonl(path: Path) -> list[dict[str, object]]:
    """Read an append-only JSONL artifact and reject malformed records."""
    rows: list[dict[str, object]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"JSONL record {line_number} is not an object")
        rows.append(value)
    return rows


def summarize_planning_audit(rows: Sequence[dict[str, object]]) -> dict[str, object]:
    """Summarize provider audit without treating the prompt as a proposal."""
    knowledge_payloads = 0
    for row in rows:
        envelope = row.get("evidence", {}).get("envelope", {}) if isinstance(row.get("evidence"), dict) else {}
        prompt = envelope.get("prompt", "") if isinstance(envelope, dict) else ""
        if "supported_action_view" in prompt or "knowledge" in prompt.lower():
            knowledge_payloads += 1
    return {
        "schema_version": "ecos.knowledge_planning_audit_summary.v1",
        "planning_calls": len(rows),
        "knowledge_payload_calls": knowledge_payloads,
        "claim_bound_proposals_observed": False,
        "claim_bound_observation_reason": "provider audit stores envelope/prompt, not parsed proposal output",
    }
