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
