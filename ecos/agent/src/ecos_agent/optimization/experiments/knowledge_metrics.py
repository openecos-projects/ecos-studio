"""Metrics that keep support, behavior, activation, and utility separate."""

from __future__ import annotations

from collections import Counter
from typing import Iterable, Mapping


def summarize_mediation(rows: Iterable[Mapping[str, object]]) -> dict[str, object]:
    values = list(rows)
    statuses = Counter(str(row.get("support_status", "unknown")) for row in values)
    receipts = Counter(str(row.get("receipt_status", "unknown")) for row in values)
    terminal = Counter(str(row.get("terminal_delta_vs_epsilon", "unobserved")) for row in values)
    claim_bound = sum(bool(row.get("claim_bound")) for row in values)
    return {
        "schema_version": "ecos.knowledge_mediation_summary.v1",
        "rows": len(values),
        "support_status_counts": dict(sorted(statuses.items())),
        "receipt_status_counts": dict(sorted(receipts.items())),
        "terminal_delta_counts": dict(sorted(terminal.items())),
        "claim_bound_rows": claim_bound,
        "claim_bound_ratio": claim_bound / len(values) if values else 0.0,
    }


def build_feedback_ledger(rows: Iterable[Mapping[str, object]]) -> list[dict[str, object]]:
    """Aggregate observed outcomes by claim without inventing missing evidence."""
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for row in rows:
        claim = row.get("claim_id")
        if claim is not None:
            grouped.setdefault(str(claim), []).append(row)
    ledger = []
    for claim_id, values in sorted(grouped.items()):
        receipts = Counter(str(row.get("receipt_status", "unknown")) for row in values)
        terminal = Counter(str(row.get("terminal_delta_vs_epsilon", "unobserved")) for row in values)
        ledger.append({
            "claim_id": claim_id,
            "observations": len(values),
            "receipt_status_counts": dict(sorted(receipts.items())),
            "terminal_delta_counts": dict(sorted(terminal.items())),
            "confidence": "high" if terminal.get("outside", 0) and not terminal.get("tie", 0) else "unknown",
        })
    return ledger


def exact_action(row: Mapping[str, object]) -> tuple[object, object, object] | None:
    if row.get("knob") is None or row.get("direction") is None:
        return None
    return row["knob"], row["direction"], row.get("requested_value")


def action_divergence(rows: Iterable[Mapping[str, object]]) -> dict[str, object]:
    actions = [exact_action(row) for row in rows]
    observed = [action for action in actions if action is not None]
    return {"observed": len(observed), "unique_actions": len(set(observed)), "divergent": len(set(observed)) > 1}
