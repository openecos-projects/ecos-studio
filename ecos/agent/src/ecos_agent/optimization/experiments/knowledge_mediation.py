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
    promotion_decision: str | None = None,
    missing_evidence_reason: str | None = None,
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
        "promotion_decision": promotion_decision,
        "missing_evidence_reason": missing_evidence_reason,
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


def summarize_planning_audit(rows: Sequence[dict[str, object]], proposal_rows: Sequence[dict[str, object]] = ()) -> dict[str, object]:
    """Summarize provider audit without treating the prompt as a proposal."""
    knowledge_payloads = 0
    for row in rows:
        envelope = row.get("evidence", {}).get("envelope", {}) if isinstance(row.get("evidence"), dict) else {}
        prompt = envelope.get("prompt", "") if isinstance(envelope, dict) else ""
        if "supported_action_view" in prompt or "knowledge" in prompt.lower():
            knowledge_payloads += 1
    by_entry = {str(row.get("planning_entry_sha256")): row for row in proposal_rows}
    claim_bound = sum(bool(row.get("claim_id") and row.get("binding_id")) for row in proposal_rows)
    return {
        "schema_version": "ecos.knowledge_planning_audit_summary.v1",
        "planning_calls": len(rows),
        "knowledge_payload_calls": knowledge_payloads,
        "proposal_observation_rows": len(proposal_rows),
        "claim_bound_proposals_observed": claim_bound > 0,
        "claim_bound_proposal_rows": claim_bound,
        "claim_bound_observation_reason": ("structured proposal observations linked by planning_entry_sha256" if by_entry else "no structured proposal observation artifact provided"),
    }


AUDIT_CALL_SCHEMA_VERSION = "ecos.knowledge_planning_call_audit.v1"

# Links a historical planning artifact cannot supply on its own: they only
# exist once a receipt/terminal chain is joined per candidate execution.
_EXECUTION_LINK_REASONS = ("receipt_link", "terminal_observation_link", "promotion_decision")


def audit_planning_calls(
    rows: Sequence[dict[str, object]],
    proposal_rows: Sequence[dict[str, object]] = (),
) -> list[dict[str, object]]:
    """One read-only record per historical planning call; missing links explicit.

    The provider audit proves the planning input, not a proposal: fields only
    a linked proposal observation can supply stay unknown when absent, and the
    execution chain is always reported missing for offline artifacts instead
    of being inferred from prompt or trajectory data.
    """
    observations = {
        str(row.get("planning_entry_sha256")): row for row in proposal_rows
    }
    audited: list[dict[str, object]] = []
    for index, row in enumerate(rows, 1):
        entry = row.get("planning_entry_sha256")
        observation = observations.get(str(entry))
        action = observation.get("action") if observation else None
        action = action if isinstance(action, dict) else {}
        knowledge_refs = (
            observation.get("knowledge_refs") if observation else None
        ) or []
        claim_bound = bool(
            observation
            and observation.get("claim_id")
            and observation.get("binding_id")
        )
        missing: list[str] = ["context_fingerprint"]
        if observation is None:
            missing.append("proposal_observation")
        elif not claim_bound:
            missing.append("claim_binding")
        missing.extend(_EXECUTION_LINK_REASONS)
        audited.append(
            {
                "schema_version": AUDIT_CALL_SCHEMA_VERSION,
                "planning_call": index,
                "planning_entry_sha256": entry,
                "context_fingerprint": None,
                "matched_claim_ids": [
                    str(ref.get("entity_id"))
                    for ref in knowledge_refs
                    if isinstance(ref, dict) and ref.get("entity_id")
                ],
                "support_status": "unknown",
                "claim_bound": claim_bound,
                "knob": action.get("knob_id"),
                "direction": action.get("direction"),
                "requested_value": action.get("requested_value"),
                "actual_value": None,
                "receipt_status": "unknown",
                "terminal_delta": None,
                "promotion_decision": None,
                "counts_toward_knowledge_attribution": claim_bound and not missing,
                "missing_evidence_reason": ",".join(missing),
            }
        )
    return audited


def missing_evidence_reason_counts(
    calls: Sequence[dict[str, object]],
) -> dict[str, int]:
    """Breakdown of why planning calls do or do not count toward attribution."""
    counts: dict[str, int] = {}
    for call in calls:
        reason = str(call.get("missing_evidence_reason", ""))
        counts[reason] = counts.get(reason, 0) + 1
    return dict(sorted(counts.items()))
