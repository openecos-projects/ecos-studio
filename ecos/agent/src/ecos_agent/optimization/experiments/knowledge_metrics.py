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
    """Aggregate observed outcomes by claim without inventing missing evidence.

    ``terminal_delta`` is signed on the minimized primary metric, so a
    positive promoted delta is a harmful effect, not a realized one.
    """
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for row in rows:
        claim = row.get("claim_id")
        if claim is not None:
            grouped.setdefault(str(claim), []).append(row)
    ledger = []
    for claim_id, values in sorted(grouped.items()):
        receipts = Counter(str(row.get("receipt_status", "unknown")) for row in values)
        terminal = Counter(str(row.get("terminal_delta_vs_epsilon", "unobserved")) for row in values)
        promotions = Counter(
            str(row.get("promotion_decision")) for row in values
        )
        promoted = [row for row in values if row.get("promotion_decision") == "promote"]
        requested_actual_consistent = _requested_actual_consistent(values)
        contradiction = _contradiction_status(promoted)
        ledger.append({
            "claim_id": claim_id,
            "observations": len(values),
            "receipt_status_counts": dict(sorted(receipts.items())),
            "terminal_delta_counts": dict(sorted(terminal.items())),
            "promotion_decision_counts": dict(sorted(promotions.items())),
            "requested_actual_consistent": requested_actual_consistent,
            "contradiction_status": contradiction,
            "confidence": "high" if terminal.get("outside", 0) and not terminal.get("tie", 0) else "unknown",
            "decision": _ledger_decision(
                requested_actual_consistent, contradiction, terminal
            ),
        })
    return ledger


def _requested_actual_consistent(values: list[Mapping[str, object]]) -> bool | None:
    comparable = [
        row
        for row in values
        if row.get("requested_value") is not None and row.get("actual_value") is not None
    ]
    if not comparable:
        return None
    return all(
        row.get("requested_value") == row.get("actual_value") for row in comparable
    )


def _contradiction_status(promoted: list[Mapping[str, object]]) -> str:
    observed = [
        row for row in promoted if row.get("terminal_delta_vs_epsilon") != "unobserved"
    ]
    if not promoted or not observed:
        return "unknown"
    if all(row.get("terminal_delta_vs_epsilon") == "tie" for row in observed):
        return "unrealized"
    if any(
        row.get("terminal_delta_vs_epsilon") == "outside"
        and isinstance(row.get("terminal_delta"), (int, float))
        and not isinstance(row.get("terminal_delta"), bool)
        and float(row["terminal_delta"]) > 0
        for row in observed
    ):
        return "contradicted"
    return "unknown"


def _ledger_decision(
    consistent: bool | None,
    contradiction: str,
    terminal: Counter[str],
) -> str:
    if contradiction == "contradicted":
        return "contradicted"
    if consistent is False:
        return "weak"
    if consistent and terminal.get("outside", 0) and not terminal.get("tie", 0):
        return "keep"
    return "unknown"


def exact_action(row: Mapping[str, object]) -> tuple[object, object, object] | None:
    if row.get("knob") is None or row.get("direction") is None:
        return None
    return row["knob"], row["direction"], row.get("requested_value")


def action_divergence(rows: Iterable[Mapping[str, object]]) -> dict[str, object]:
    actions = [exact_action(row) for row in rows]
    observed = [action for action in actions if action is not None]
    return {"observed": len(observed), "unique_actions": len(set(observed)), "divergent": len(set(observed)) > 1}


SUPPORT_COVERED_STATUSES = frozenset({"pass", "weak"})


def summarize_offline_rows(rows: Sequence[Mapping[str, object]]) -> dict[str, object]:
    """Per-treatment offline behavior metrics; failures stay in the denominator."""
    by_treatment: dict[str, list[Mapping[str, object]]] = {}
    for row in rows:
        by_treatment.setdefault(str(row.get("treatment")), []).append(row)
    treatments = {}
    for treatment, values in sorted(by_treatment.items()):
        decisions = Counter(str(row.get("decision")) for row in values)
        proposed = [row for row in values if row.get("decision") == "propose"]
        claim_bound = sum(bool(row.get("claim_bound")) for row in proposed)
        covered = sum(
            str(row.get("support_status")) in SUPPORT_COVERED_STATUSES
            for row in proposed
        )
        unsupported = sum(
            str(row.get("support_status")) == "blocked" for row in proposed
        )
        scored = [row for row in values if isinstance(row.get("correct"), bool)]
        repeats: dict[str, set[object]] = {}
        for row in proposed:
            repeats.setdefault(str(row.get("context_fingerprint")), set()).add(
                exact_action(row)
            )
        disagreement = sum(
            len({action for action in actions if action is not None}) > 1
            for actions in repeats.values()
        )
        treatments[treatment] = {
            "rows": len(values),
            "decision_counts": dict(sorted(decisions.items())),
            "proposals": len(proposed),
            "claim_bound_proposals": claim_bound,
            "claim_bound_ratio": claim_bound / len(proposed) if proposed else 0.0,
            "support_coverage_ratio": covered / len(proposed) if proposed else 0.0,
            "unsupported_rate": unsupported / len(proposed) if proposed else 0.0,
            "exact_action_divergence": action_divergence(proposed),
            "within_treatment_disagreement": disagreement,
            "label_correct_rows": sum(bool(row.get("correct")) for row in scored),
            "label_scored_rows": len(scored),
        }
    return {
        "schema_version": "ecos.knowledge_offline_summary.v1",
        "rows": len(rows),
        "treatments": treatments,
    }


def offline_gate(
    summary: Mapping[str, object],
    rows: Sequence[Mapping[str, object]],
    contexts: Sequence[Mapping[str, object]],
    *,
    design_id: str = "gcd",
) -> dict[str, object]:
    """Pilot gate: replayable bank, clean negative controls, real divergence."""
    dual_layer = summary["treatments"].get(
        "state-conditioned-dual-layer-zero-shot", {}
    )
    controls = [
        row
        for row in rows
        if row.get("treatment") == "state-conditioned-dual-layer-zero-shot"
        and row.get("expected_behavior") != "action"
    ]
    controls_rejected = bool(controls) and all(
        bool(row.get("correct")) for row in controls
    )
    opportunity_contexts = sum(
        context.get("stratum") == "knowledge_opportunity"
        and context.get("design_id") == design_id
        for context in contexts
    )
    disagreement = int(dual_layer.get("within_treatment_disagreement", 0))
    divergence = int(
        dual_layer.get("exact_action_divergence", {}).get("unique_actions", 0)
    )
    errors = sum(
        count
        for key, count in dual_layer.get("decision_counts", {}).items()
        if str(key).endswith("_error")
    )
    return {
        "schema_version": "ecos.knowledge_offline_gate.v1",
        "context_bank_replayable": bool(contexts),
        "negative_controls_present": bool(controls),
        "negative_controls_rejected": controls_rejected,
        "dual_layer_divergence_exceeds_disagreement": divergence > disagreement,
        "divergence_without_repair": errors == 0,
        "knowledge_opportunity_contexts": opportunity_contexts,
        "offline_gate_pass": bool(
            contexts
            and controls_rejected
            and divergence > disagreement
            and errors == 0
            and opportunity_contexts >= 1
        ),
    }
