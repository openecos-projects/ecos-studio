"""Metrics that keep support, behavior, activation, and utility separate."""

from __future__ import annotations

from collections import Counter
from typing import Iterable, Mapping, Sequence

_PROMOTING_DECISIONS = frozenset(
    {"initialized", "candidate_better", "recovery_progress", "parity_objective_improved"}
)


def expected_effect_realization(
    proposal_rows: Sequence[Mapping[str, object]],
    mediation_calls: Sequence[Mapping[str, object]],
    *,
    objective_metric: str,
) -> dict[str, object]:
    """Run-level expected-effect realization over promoted proposals.

    Join scope: mediation calls carry ``planning_entry_sha256`` and the one
    audited terminal delta; proposal observations declare ``expected_effects``.
    A promoted candidate whose declared effect on the audited metric was not
    realized (terminal tie or opposite direction) counts as CONTRADICTED --
    promotion is not hypothesis support.
    """
    effects_by_entry = {
        str(row.get("planning_entry_sha256")): row.get("expected_effects") or []
        for row in proposal_rows
    }
    denominator = 0
    realized = 0
    contradicted = 0
    unobserved = 0
    for call in mediation_calls:
        if call.get("promotion_decision") not in _PROMOTING_DECISIONS:
            continue
        effects = effects_by_entry.get(str(call.get("planning_entry_sha256")), [])
        matching = [
            effect
            for effect in effects
            if isinstance(effect, Mapping)
            and effect.get("metric_id") == objective_metric
            and effect.get("direction") in {"increase", "decrease"}
        ]
        if not matching:
            continue
        denominator += 1
        delta = call.get("terminal_delta")
        verdict = str(call.get("terminal_delta_vs_epsilon"))
        if verdict in {"unobserved", "no_epsilon"} or not isinstance(
            delta, (int, float)
        ):
            unobserved += 1
            continue
        moved_down = float(delta) < 0
        expected_down = any(
            effect.get("direction") == "decrease" for effect in matching
        )
        expected_up = any(
            effect.get("direction") == "increase" for effect in matching
        )
        if (verdict == "outside" and moved_down and expected_down) or (
            verdict == "outside" and not moved_down and expected_up
        ):
            realized += 1
        else:
            contradicted += 1
    return {
        "schema_version": "ecos.knowledge_expected_effect_rates.v1",
        "objective_metric": objective_metric,
        "promoted_with_declared_effects": denominator,
        "realized": realized,
        "contradicted": contradicted,
        "unobserved": unobserved,
        "contradicted_rate": contradicted / denominator if denominator else None,
    }


def abstention_rate(rows: Sequence[Mapping[str, object]]) -> dict[str, object]:
    """Run-level correct-abstention ratio over non-action expected behavior."""
    controls = [
        row for row in rows if row.get("expected_behavior") not in {None, "action"}
    ]
    scored = [row for row in controls if isinstance(row.get("correct"), bool)]
    correct = sum(bool(row.get("correct")) for row in scored)
    return {
        "schema_version": "ecos.knowledge_abstention_rate.v1",
        "non_action_rows": len(controls),
        "scored_rows": len(scored),
        "correct_abstentions": correct,
        "correct_abstention_ratio": correct / len(scored) if scored else None,
    }


def truncation_loss(rows: Sequence[Mapping[str, object]]) -> dict[str, object]:
    """Aggregate post-match truncation of compiled supported-action views."""
    scoped = [
        row for row in rows if isinstance(row.get("truncated_claim_refs"), list)
    ]
    truncated_rows = sum(
        bool(row.get("truncated_claim_refs")) for row in scoped
    )
    truncated_refs = sum(
        len(row.get("truncated_claim_refs")) for row in scoped
    )
    return {
        "schema_version": "ecos.knowledge_truncation_loss.v1",
        "views_with_truncation_field": len(scoped),
        "rows_with_truncation": truncated_rows,
        "truncated_claim_ref_count": truncated_refs,
        "truncation_row_ratio": (
            truncated_rows / len(scoped) if scoped else None
        ),
    }


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


def _within_context_disagreement(proposed: Sequence[Mapping[str, object]]) -> int:
    repeats: dict[str, set[object]] = {}
    for row in proposed:
        repeats.setdefault(str(row.get("context_fingerprint")), set()).add(
            exact_action(row)
        )
    return sum(
        len({action for action in actions if action is not None}) > 1
        for actions in repeats.values()
    )


def summarize_offline_rows(rows: Sequence[Mapping[str, object]]) -> dict[str, object]:
    """Per-treatment offline behavior metrics; failures stay in the denominator.

    Divergence and disagreement are additionally split into claim-bound and
    unbound subsets: unbound probes are legal-domain exploration unrelated to
    knowledge, so knowledge-effect interpretation reads the claim-bound split
    (unbound stays reported as background, never deleted from the denominator).
    """
    by_treatment: dict[str, list[Mapping[str, object]]] = {}
    for row in rows:
        by_treatment.setdefault(str(row.get("treatment")), []).append(row)
    treatments = {}
    for treatment, values in sorted(by_treatment.items()):
        decisions = Counter(str(row.get("decision")) for row in values)
        proposed = [row for row in values if row.get("decision") == "propose"]
        bound = [row for row in proposed if row.get("claim_bound")]
        unbound = [row for row in proposed if not row.get("claim_bound")]
        claim_bound = len(bound)
        covered = sum(
            str(row.get("support_status")) in SUPPORT_COVERED_STATUSES
            for row in proposed
        )
        unsupported = sum(
            str(row.get("support_status")) == "blocked" for row in proposed
        )
        scored = [row for row in values if isinstance(row.get("correct"), bool)]
        treatments[treatment] = {
            "rows": len(values),
            "decision_counts": dict(sorted(decisions.items())),
            "proposals": len(proposed),
            "claim_bound_proposals": claim_bound,
            "claim_bound_ratio": claim_bound / len(proposed) if proposed else 0.0,
            "support_coverage_ratio": covered / len(proposed) if proposed else 0.0,
            "unsupported_rate": unsupported / len(proposed) if proposed else 0.0,
            "exact_action_divergence": action_divergence(proposed),
            "within_treatment_disagreement": _within_context_disagreement(proposed),
            "claim_bound_exact_action_divergence": action_divergence(bound),
            "unbound_exact_action_divergence": action_divergence(unbound),
            "claim_bound_within_treatment_disagreement": _within_context_disagreement(
                bound
            ),
            "unbound_within_treatment_disagreement": _within_context_disagreement(
                unbound
            ),
            "label_correct_rows": sum(bool(row.get("correct")) for row in scored),
            "label_scored_rows": len(scored),
        }
    return {
        "schema_version": "ecos.knowledge_offline_summary.v2",
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
