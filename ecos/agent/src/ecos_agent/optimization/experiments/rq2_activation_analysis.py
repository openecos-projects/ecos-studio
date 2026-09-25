"""RQ2 activation-chain analysis over online episode cells.

Joins per-episode evidence (mediation audit rows carry the full
proposal -> receipt -> terminal -> promotion chain under stable ids) and
aggregates the preregistered activation metrics per treatment and design.
Episode cells are the independent units; candidates and planning calls stay
trajectory records, never iid samples.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Mapping, Sequence

from ecos_agent.optimization.experiments.knowledge_metrics import (
    wilson_score_interval,
)

PROMOTING_DECISIONS = frozenset(
    {"initialized", "candidate_better", "recovery_progress", "parity_objective_improved"}
)


def _read_rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def episode_activation_record(
    *,
    episode_root: Path,
    design: str,
    episode_id: str,
    treatment: str,
) -> dict[str, object]:
    """Build one episode's activation record from its persisted audit chain.

    ``episode_root`` is the driver's episode directory holding
    ``knowledge-mediation-audit.v1.json`` (or the audit payload may be passed
    preloaded from an episode summary).
    """
    audit_path = episode_root / "knowledge-mediation-audit.v1.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    calls = audit.get("calls") or []
    proposals = [
        call for call in calls if call.get("knob") and call.get("direction")
    ]
    claim_bound = [call for call in proposals if call.get("claim_bound")]
    executed = [call for call in calls if call.get("intervention_id")]
    receipts = [call for call in calls if call.get("application_status")]
    verified_applied = [
        call
        for call in receipts
        if call.get("application_status") == "applied"
        and call.get("consumed_value") is not None
    ]
    terminal_verdicts = {"outside", "tie"}
    terminal_joined = [
        call
        for call in calls
        if call.get("terminal_delta_vs_epsilon") in terminal_verdicts
    ]
    promotion_joined = [
        call
        for call in calls
        if call.get("promotion_decision")
        and call.get("promotion_decision") != "none"
    ]
    complete_chain = [
        call
        for call in calls
        if call.get("intervention_id")
        and call.get("application_status")
        and call.get("terminal_delta_vs_epsilon") in terminal_verdicts
        and call.get("promotion_decision")
    ]
    expected_effects = audit.get("decision_level_endpoints", {}).get(
        "expected_effect_realization", {}
    )
    missing_reasons = audit.get("missing_evidence_reason_counts", {})
    state_match = audit.get("state_match", {})
    return {
        "schema_version": "ecos.rq2_episode_activation.v1",
        "design": design,
        "episode_id": episode_id,
        "treatment": treatment,
        "planning_rows": len(calls),
        "proposals": len(proposals),
        "claim_bound_proposals": len(claim_bound),
        "executed": len(executed),
        "receipts": len(receipts),
        "verified_applied": len(verified_applied),
        "terminal_joined": len(terminal_joined),
        "promotion_joined": len(promotion_joined),
        "complete_attribution_chain": len(complete_chain),
        "application_status_counts": dict(
            sorted(Counter(str(call.get("application_status")) for call in calls).items())
        ),
        "promotion_decision_counts": dict(
            sorted(Counter(str(call.get("promotion_decision")) for call in calls).items())
        ),
        "missing_evidence_reason_counts": missing_reasons,
        "state_match": state_match,
        "expected_effect_realization": expected_effects,
        "budget": None,
    }


def aggregate_activation(
    records: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    """Aggregate episode records into treatment and design-treatment rows."""
    treatments: dict[str, list[Mapping]] = {}
    for record in records:
        treatments.setdefault(str(record["treatment"]), []).append(record)
    by_treatment = {}
    for treatment, group in sorted(treatments.items()):
        def _total(key: str) -> int:
            return sum(int(item[key]) for item in group)

        episodes = len(group)
        verified = _total("verified_applied")
        executed = _total("executed")
        receipts = _total("receipts")
        proposals = _total("proposals")
        planning_rows = _total("planning_rows")
        complete = _total("complete_attribution_chain")
        by_treatment[treatment] = {
            "episodes": episodes,
            "designs": sorted({str(item["design"]) for item in group}),
            "planning_rows": planning_rows,
            "proposals": proposals,
            "claim_bound_proposals": _total("claim_bound_proposals"),
            "claim_bound_ratio": (
                wilson_score_interval(_total("claim_bound_proposals"), proposals)
                if proposals
                else wilson_score_interval(0, 0)
            ),
            "selected_to_executed": {
                **wilson_score_interval(executed, proposals),
                "numerator": executed,
                "denominator": proposals,
            },
            "executed_to_verified_applied": {
                **wilson_score_interval(verified, executed),
                "numerator": verified,
                "denominator": executed,
            },
            "verified_applied_n_over_N": {
                "n": verified,
                "N": planning_rows,
            },
            "proposal_receipt_join_rate": (
                wilson_score_interval(receipts, proposals) if proposals else wilson_score_interval(0, 0)
            ),
            "complete_attribution_join_rate": (
                wilson_score_interval(complete, planning_rows)
                if planning_rows
                else wilson_score_interval(0, 0)
            ),
            "application_status_counts": _merge_counts(group, "application_status_counts"),
            "missing_join_reason_counts": _merge_counts(
                group, "missing_evidence_reason_counts"
            ),
            "expected_effect_realization": {
                "realized": sum(
                    int(item["expected_effect_realization"].get("realized") or 0)
                    for item in group
                ),
                "contradicted": sum(
                    int(item["expected_effect_realization"].get("contradicted") or 0)
                    for item in group
                ),
                "unobserved": sum(
                    int(item["expected_effect_realization"].get("unobserved") or 0)
                    for item in group
                ),
                "promoted_with_declared_effects": sum(
                    int(
                        item["expected_effect_realization"].get(
                            "promoted_with_declared_effects"
                        )
                        or 0
                    )
                    for item in group
                ),
            },
        }
    design_treatment: dict[str, dict[str, object]] = {}
    for record in records:
        key = f"{record['design']}|{record['treatment']}"
        design_treatment[key] = {
            "design": record["design"],
            "treatment": record["treatment"],
            "episode_id": record["episode_id"],
            "planning_rows": record["planning_rows"],
            "proposals": record["proposals"],
            "claim_bound_proposals": record["claim_bound_proposals"],
            "executed": record["executed"],
            "verified_applied": record["verified_applied"],
            "complete_attribution_chain": record["complete_attribution_chain"],
            "application_status_counts": record["application_status_counts"],
            "expected_effect_realization": record["expected_effect_realization"],
        }
    return {
        "schema_version": "ecos.rq2_activation_chain.v1",
        "by_treatment": by_treatment,
        "by_design_treatment": design_treatment,
    }


def _merge_counts(records: Sequence[Mapping[str, object]], key: str) -> dict[str, int]:
    merged: dict[str, int] = {}
    for record in records:
        for name, count in dict(record.get(key) or {}).items():
            merged[str(name)] = merged.get(str(name), int(count)) + int(count)
    return dict(sorted(merged.items()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--episode-record",
        action="append",
        required=True,
        help="design:episode_id:treatment:path-to-episode-root (repeatable)",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    records = []
    for spec in args.episode_record:
        design, episode_id, treatment, path = spec.split(":", 3)
        records.append(
            episode_activation_record(
                episode_root=Path(path),
                design=design,
                episode_id=episode_id,
                treatment=treatment,
            )
        )
    payload = aggregate_activation(records)
    payload["episodes"] = records
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "episodes": len(records),
                "treatments": sorted(payload["by_treatment"]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
