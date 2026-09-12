"""Small, auditable mediation records for knowledge pilot artifacts."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

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

# Reason tags used when a live episode artifact chain can actually supply the
# links; only genuinely missing pieces are reported.
_PROPOSAL_LINK_REASONS = ("context_fingerprint", "proposal_observation", "requested_value")

EPISODE_AUDIT_SCHEMA_VERSION = "ecos.knowledge_mediation_audit.v1"


def audit_episode_mediation(
    *,
    design_id: str,
    planning_entries: Sequence[object],
    proposal_rows: Sequence[dict[str, object]],
    decision_rows: Sequence[object],
    starts: Sequence[object],
    outcomes: "Mapping[str, object]",
    reference_observation: object,
    objective_metric: str,
    epsilon: float | None = None,
    treatment: str = "closed_loop_episode",
) -> list[dict[str, object]]:
    """Join one live episode's artifact chain into per-planning-call mediation rows.

    Unlike :func:`audit_planning_calls` (offline artifacts, links always
    missing), every link here is filled from the episode's own persisted
    records: proposal observations (context fingerprint, claim four-tuple,
    requested value), decision audit (approval), intervention starts
    (proposal hash), and terminal outcomes (receipt, terminal observation,
    incumbent decision).  Only genuinely missing pieces are reported in
    ``missing_evidence_reason``; an unbound (claim-free) proposal is legal and
    is reported through ``claim_bound=false`` instead of an error.
    """
    observations = {
        str(row.get("planning_entry_sha256")): row for row in proposal_rows
    }
    decisions_by_entry: dict[str, object] = {}
    for decision in decision_rows:
        decisions_by_entry[str(_attr(decision, "planning_entry_sha256"))] = decision
    starts_by_proposal: dict[str, object] = {}
    for start in starts:
        starts_by_proposal.setdefault(
            str(_attr(start, "proposal_sha256")), start
        )
    reference_value = _metric_value(reference_observation, objective_metric)
    audited: list[dict[str, object]] = []
    for index, entry in enumerate(planning_entries, 1):
        entry_sha = str(_attr(entry, "entry_sha256"))
        row = observations.get(entry_sha)
        decision = decisions_by_entry.get(entry_sha)
        missing: list[str] = []
        if row is None:
            missing.append("proposal_observation")
        fingerprint = row.get("context_fingerprint") if row else None
        if not fingerprint:
            missing.append("context_fingerprint")
        knob = row.get("requested_knob_id") if row else None
        requested_value = row.get("requested_value") if row else None
        if row is not None and knob is None and requested_value is None:
            decision_requested = _attr(decision, "requested")
            knob = getattr(decision_requested, "knob_id", None) if decision_requested else None
            knob = getattr(knob, "value", knob) if knob is not None else None
            requested_value = (
                getattr(decision_requested, "value", None)
                if decision_requested
                else None
            )
            if knob is None and requested_value is None:
                missing.append("requested_value")
        claim_id = row.get("claim_id") if row else None
        binding_id = row.get("binding_id") if row else None
        claim_bound = bool(claim_id and binding_id)
        start = (
            starts_by_proposal.get(str(row.get("proposal_sha256")))
            if row is not None
            else None
        )
        intervention_id = _attr(start, "intervention_id") if start else None
        outcome = outcomes.get(str(intervention_id)) if intervention_id else None
        receipt = _attr(outcome, "parameter_application_receipt") if outcome else None
        receipt_status = getattr(receipt, "status", None) if receipt else None
        actual_value = getattr(receipt, "actual_value", None) if receipt else None
        terminal_observation = (
            _attr(outcome, "terminal_observation") if outcome else None
        )
        terminal_value = _metric_value(terminal_observation, objective_metric)
        terminal_delta = (
            terminal_value - reference_value
            if terminal_value is not None and reference_value is not None
            else None
        )
        promotion_decision = _attr(outcome, "incumbent_decision") if outcome else None
        promotion_decision = (
            getattr(promotion_decision, "value", promotion_decision)
            if promotion_decision is not None
            else None
        )
        if receipt_status is None:
            missing.append("receipt_link")
        if terminal_observation is None:
            missing.append("terminal_observation_link")
        if promotion_decision is None:
            missing.append("promotion_decision")
        action = row.get("action") if row else None
        direction = action.get("direction") if isinstance(action, dict) else None
        matched_claims = [
            str(ref.get("entity_id"))
            for ref in ((row.get("knowledge_refs") if row else None) or [])
            if isinstance(ref, dict) and ref.get("entity_id")
        ]
        all_links_present = not missing
        audited.append(
            {
                "schema_version": AUDIT_CALL_SCHEMA_VERSION,
                "planning_call": index,
                "planning_entry_sha256": entry_sha,
                "design_id": design_id,
                "treatment": treatment,
                "intervention_id": intervention_id,
                "context_fingerprint": fingerprint,
                "matched_claim_ids": matched_claims,
                "support_status": (
                    "matched" if matched_claims and row is not None else "unknown"
                ),
                "claim_id": claim_id,
                "binding_id": binding_id,
                "claim_bound": claim_bound,
                "knob": knob,
                "direction": direction,
                "requested_value": requested_value,
                "actual_value": actual_value,
                "receipt_status": receipt_status,
                "terminal_delta": terminal_delta,
                "terminal_delta_vs_epsilon": (
                    classify_terminal_delta(terminal_delta, epsilon)
                    if epsilon is not None
                    else ("unobserved" if terminal_delta is None else "no_epsilon")
                ),
                "promotion_decision": promotion_decision,
                "counts_toward_knowledge_attribution": (
                    claim_bound and all_links_present
                ),
                "missing_evidence_reason": ",".join(missing) if missing else None,
            }
        )
    return audited


def _attr(value: object, name: str) -> object:
    return getattr(value, name, None)


def _metric_value(observation: object, metric_id: str) -> float | None:
    """Read one objective metric value from a terminal observation."""
    if observation is None:
        return None
    metrics = getattr(observation, "objective_metrics", None)
    if not isinstance(metrics, Mapping):
        return None
    for key, value in metrics.items():
        if getattr(key, "value", key) == metric_id:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def summarize_episode_mediation(
    calls: Sequence[dict[str, object]],
) -> dict[str, object]:
    """Aggregate episode mediation calls into the audit summary view."""
    missing_counts = missing_evidence_reason_counts(calls)
    return {
        "schema_version": "ecos.knowledge_mediation_audit_summary.v1",
        "planning_calls": len(calls),
        "claim_bound_proposals_observed": any(
            call.get("claim_bound") for call in calls
        ),
        "claim_bound_proposal_rows": sum(
            bool(call.get("claim_bound")) for call in calls
        ),
        "attributable_rows": sum(
            bool(call.get("counts_toward_knowledge_attribution")) for call in calls
        ),
        "activated_rows": sum(
            call.get("receipt_status") == "effective" for call in calls
        ),
        "terminal_response_rows": sum(
            call.get("terminal_delta") is not None for call in calls
        ),
        "missing_evidence_reason_counts": missing_counts,
    }


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
        reason = call.get("missing_evidence_reason")
        if not reason:
            continue
        key = str(reason)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))
