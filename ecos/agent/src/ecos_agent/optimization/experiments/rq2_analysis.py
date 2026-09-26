"""RQ2 aggregate analysis: noise floor, policy posterior, policy shift.

Reads the versioned offline observation rows (``ecos.rq2_planner_observation.v1``)
and per-cell posteriors, and produces the preregistered G3/G4/G7 analysis
artifacts.  Provider errors, schema failures, and timeouts stay in every
denominator; cells are never treated as independent online episodes.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Mapping, Sequence

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.knowledge_metrics import (
    RQ2_POSTERIOR_PRIOR_ALPHA,
    material_shift_probability,
    posterior_cell_metrics,
    posterior_mean_distribution,
    posterior_seed,
    total_variation,
    wilson_score_interval,
)
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    MATERIAL_PROBABILITY_CUTOFF,
    MATERIAL_SHIFT_TAU,
    RQ2_PRIMARY_COMPARISONS,
    RQ2_TREATMENTS,
)

ERROR_STATUSES = frozenset({"provider_error", "timeout", "invalid"})
DUAL = "state-conditioned-dual-layer-zero-shot"


def _read_rows(paths: Sequence[Path]) -> list[dict]:
    rows: list[dict] = []
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _count(rows: Sequence[Mapping], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        value = str(row.get(key))
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def _within_treatment_disagreement(
    rows: Sequence[Mapping[str, object]], level: str = "L1"
) -> dict[str, object]:
    by_context: dict[str, set[str]] = {}
    for row in rows:
        if row.get("schema_status") != "valid":
            continue
        signature = str(row["levels"][level])
        by_context.setdefault(str(row["context_fingerprint"]), set()).add(signature)
    contexts = len(by_context)
    divergent = sum(len(signatures) > 1 for signatures in by_context.values())
    interval = wilson_score_interval(divergent, contexts)
    return {
        "contexts_with_valid_observations": contexts,
        "divergent_contexts": divergent,
        **interval,
    }


def noise_floor_calibration(
    rows: Sequence[Mapping[str, object]],
    *,
    strata: Sequence[str] = (),
) -> dict[str, object]:
    """Provider-noise calibration over within-treatment disagreement."""
    valid = [row for row in rows if row.get("schema_status") == "valid"]
    attempted = list(rows)
    strata = list(strata) or sorted(
        {str(row.get("state_stratum")) for row in rows}
    )
    by_stratum: dict[str, object] = {}
    statuses: list[str] = []
    for stratum in strata:
        stratum_rows = [
            row for row in rows if row.get("state_stratum") == stratum
        ]
        stratum_valid = [
            row for row in stratum_rows if row.get("schema_status") == "valid"
        ]
        disagreement = _within_treatment_disagreement(stratum_rows)
        rate = float(disagreement.get("rate") or 0.0)
        if disagreement["contexts_with_valid_observations"] == 0:
            status = "not_estimable"
        elif rate >= 0.5:
            status = "high"
        elif rate >= 0.2:
            status = "material"
        else:
            status = "low"
        statuses.append(status)
        by_stratum[stratum] = {
            "schema_status_counts": _count(stratum_rows, "schema_status"),
            "within_treatment_disagreement": disagreement,
            "noise_floor_status": status,
        }
    worst = "not_estimable" if "not_estimable" in statuses else (
        "high" if "high" in statuses else "material" if "material" in statuses else "low"
    )
    overall = _within_treatment_disagreement(valid)
    return {
        "schema_version": "ecos.rq2_noise_floor_calibration.v1",
        "attempted_rows": len(attempted),
        "valid_rows": len(valid),
        "provider_error_rows": sum(
            1 for row in rows if row.get("schema_status") == "provider_error"
        ),
        "timeout_rows": sum(
            1 for row in rows if row.get("schema_status") == "timeout"
        ),
        "schema_invalid_rows": sum(
            1 for row in rows if row.get("schema_status") == "invalid"
        ),
        "overall_within_treatment_disagreement": overall,
        "strata": by_stratum,
        "noise_floor_status_overall": worst,
    }


def policy_posterior(
    rows: Sequence[Mapping[str, object]],
    *,
    draws: int = 4000,
    alpha: float = RQ2_POSTERIOR_PRIOR_ALPHA,
) -> dict[str, object]:
    """Per-cell L0-L3 posterior summaries over the pooled valid rows."""
    groups: dict[tuple[str, str, str, str, str], list[Mapping]] = {}
    for row in rows:
        key = (
            str(row.get("design")),
            str(row.get("checkpoint")),
            str(row.get("state_stratum")),
            str(row.get("context_fingerprint")),
            str(row.get("treatment")),
        )
        groups.setdefault(key, []).append(row)
    cells = []
    for key, cell_rows in sorted(groups.items()):
        design, checkpoint, stratum, fingerprint, treatment = key
        levels = {}
        for level in ("L0", "L1", "L2", "L3"):
            counts: dict[str, int] = {}
            for row in cell_rows:
                signature = str(row["levels"][level])
                counts[signature] = counts.get(signature, 0) + 1
            levels[level] = posterior_cell_metrics(
                counts,
                alpha=alpha,
                draws=draws,
                seed=posterior_seed(str(row["context_fingerprint"]), treatment, level),
            )
        cells.append(
            {
                "schema_version": "ecos.rq2_policy_posterior_cell.v1",
                "design": design,
                "checkpoint": checkpoint,
                "state_stratum": stratum,
                "context_fingerprint": fingerprint,
                "treatment": treatment,
                "observations": len(cell_rows),
                "schema_status_counts": _count(cell_rows, "schema_status"),
                "levels": levels,
            }
        )
    return {
        "schema_version": "ecos.rq2_policy_posterior.v1",
        "cells": cells,
        "observations": len(rows),
    }


def _cell_counts_by_treatment(
    rows: Sequence[Mapping[str, object]], level: str
) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for row in rows:
        signature = str(row["levels"][level])
        treatment = str(row.get("treatment"))
        bucket = counts.setdefault(treatment, {})
        bucket[signature] = bucket.get(signature, 0) + 1
    return counts


def _shift_for_context(
    rows: Sequence[Mapping[str, object]],
    *,
    tau: float,
    draws: int,
    alpha: float,
    level: str,
) -> dict[str, object]:
    counts = _cell_counts_by_treatment(rows, level)
    fingerprint = str(rows[0]["context_fingerprint"])
    comparisons = {}
    for base, comparator in RQ2_PRIMARY_COMPARISONS:
        if base not in counts or comparator not in counts:
            continue
        result = material_shift_probability(
            counts[base],
            counts[comparator],
            tau=tau,
            alpha=alpha,
            draws=draws,
            seed=posterior_seed(fingerprint, base, comparator, level),
        )
        pooled_base = posterior_mean_distribution(counts[base], alpha=alpha)
        pooled_comp = posterior_mean_distribution(counts[comparator], alpha=alpha)
        comparisons[f"{base}||{comparator}"] = {
            **result,
            "delta_local_tv": total_variation(pooled_base, pooled_comp),
            "top_action_base": (
                max(pooled_base, key=lambda k: pooled_base[k]) if pooled_base else None
            ),
            "top_action_comparator": (
                max(pooled_comp, key=lambda k: pooled_comp[k]) if pooled_comp else None
            ),
        }
    return {
        "context_fingerprint": fingerprint,
        "observations": len(rows),
        "level": level,
        "comparisons": comparisons,
    }


def policy_shift(
    rows: Sequence[Mapping[str, object]],
    *,
    tau: float = MATERIAL_SHIFT_TAU,
    cutoff: float = MATERIAL_PROBABILITY_CUTOFF,
    draws: int = 4000,
    alpha: float = RQ2_POSTERIOR_PRIOR_ALPHA,
) -> dict[str, object]:
    """Matched-context policy shift: Delta_local, Delta_marginal, rho_tau."""
    by_context: dict[str, list[Mapping]] = {}
    for row in rows:
        by_context.setdefault(str(row["context_fingerprint"]), []).append(row)
    contexts = []
    for fingerprint, cell_rows in sorted(by_context.items()):
        # primary level L2 (knob + direction); L1 recorded for the family view
        contexts.append(
            _shift_for_context(
                cell_rows, tau=tau, draws=draws, alpha=alpha, level="L2"
            )
        )
        contexts.append(
            _shift_for_context(
                cell_rows, tau=tau, draws=draws, alpha=alpha, level="L1"
            )
        )
    summary = {}
    for level in ("L1", "L2"):
        level_contexts = [
            context for context in contexts if context["level"] == level
        ]
        for base, comparator in RQ2_PRIMARY_COMPARISONS:
            pair_key = f"{base}||{comparator}"
            deltas = [
                context["comparisons"][pair_key]["delta_local_tv"]
                for context in level_contexts
                if pair_key in context["comparisons"]
                and context["comparisons"][pair_key].get("delta_local_tv")
                is not None
            ]
            probabilities = [
                context["comparisons"][pair_key]["probability"]
                for context in level_contexts
                if pair_key in context["comparisons"]
                and context["comparisons"][pair_key].get("probability") is not None
            ]
            resolved = [
                probability
                for probability in probabilities
                if float(probability) >= cutoff
                or float(probability) <= 1.0 - cutoff
            ]
            summary[f"{level}|{pair_key}"] = {
                "delta_local_mean": (
                    sum(deltas) / len(deltas) if deltas else None
                ),
                "delta_local_contexts": len(deltas),
                "material_probability_mean": (
                    sum(float(p) for p in probabilities) / len(probabilities)
                    if probabilities
                    else None
                ),
                "rho_tau": (
                    sum(
                        1
                        for p in probabilities
                        if float(p) >= cutoff
                    )
                    / len(probabilities)
                    if probabilities
                    else None
                ),
                "resolved_contexts": len(resolved),
            }
    # Delta_marginal: bank-level pooled posterior TV with context weights
    # fixed to bank registration (each eligible context weighs equally)
    pooled: dict[str, dict[str, dict[str, int]]] = {}
    for level in ("L1", "L2"):
        totals: dict[str, dict[str, int]] = {}
        for fingerprint, cell_rows in by_context.items():
            counts = _cell_counts_by_treatment(cell_rows, level)
            for treatment, bucket in counts.items():
                target = totals.setdefault(treatment, {})
                for signature, count in bucket.items():
                    target[signature] = target.get(signature, 0) + count
        pooled[level] = totals
    marginal = {}
    for level in ("L1", "L2"):
        for base, comparator in RQ2_PRIMARY_COMPARISONS:
            if base not in pooled[level] or comparator not in pooled[level]:
                continue
            marginal[f"{level}|{base}||{comparator}"] = {
                "delta_marginal_tv": total_variation(
                    posterior_mean_distribution(pooled[level][base], alpha=alpha),
                    posterior_mean_distribution(pooled[level][comparator], alpha=alpha),
                ),
                "pooled_observations": {
                    base: sum(pooled[level][base].values()),
                    comparator: sum(pooled[level][comparator].values()),
                },
            }

    # design heterogeneity on the primary pair (Dual vs NoKnow) at L2
    pair_key = f"{RQ2_PRIMARY_COMPARISONS[0][0]}||{RQ2_PRIMARY_COMPARISONS[0][1]}"
    designs = sorted({str(row.get("design")) for row in rows})
    heterogeneity = {}
    for design in designs:
        design_rows = [row for row in rows if row.get("design") == design]
        design_contexts = [
            context
            for context in contexts
            if context["level"] == "L2"
            and str(
                next(
                    row["design"]
                    for row in by_context[context["context_fingerprint"]]
                )
            )
            == design
        ]
        deltas = [
            context["comparisons"][pair_key]["delta_local_tv"]
            for context in design_contexts
            if pair_key in context["comparisons"]
            and context["comparisons"][pair_key].get("delta_local_tv") is not None
        ]
        heterogeneity[design] = {
            "delta_local_mean": sum(deltas) / len(deltas) if deltas else None,
            "contexts": len(deltas),
        }
    return {
        "schema_version": "ecos.rq2_policy_shift.v1",
        "tau": tau,
        "probability_cutoff": cutoff,
        "contexts": contexts,
        "summary": summary,
        "delta_marginal": marginal,
        "design_heterogeneity": heterogeneity,
    }


def provenance_support(
    rows: Sequence[Mapping[str, object]],
    *,
    bank: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Support/provenance denominators over the offline observation rows."""
    by_treatment: dict[str, dict[str, object]] = {}
    for treatment in RQ2_TREATMENTS:
        treatment_rows = [
            row for row in rows if row.get("treatment") == treatment
        ]
        valid = [row for row in treatment_rows if row.get("schema_status") == "valid"]
        proposed = [
            row
            for row in valid
            if str(row["levels"]["L0"]) == "propose"
        ]
        claim_bound = [row for row in proposed if row["levels"]["evidence_status"] == "claim_bound"]
        strata: dict[str, dict[str, int]] = {}
        for stratum in sorted({str(row.get("state_stratum")) for row in treatment_rows}):
            stratum_rows = [
                row for row in treatment_rows if row.get("state_stratum") == stratum
            ]
            strata[stratum] = {
                "rows": len(stratum_rows),
                "valid": sum(
                    1 for row in stratum_rows if row.get("schema_status") == "valid"
                ),
                "proposed": sum(
                    1
                    for row in stratum_rows
                    if row.get("schema_status") == "valid"
                    and str(row["levels"]["L0"]) == "propose"
                ),
                "claim_bound": sum(
                    1
                    for row in stratum_rows
                    if row.get("schema_status") == "valid"
                    and row["levels"]["evidence_status"] == "claim_bound"
                ),
            }
        by_treatment[treatment] = {
            "rows": len(treatment_rows),
            "valid": len(valid),
            "schema_status_counts": _count(treatment_rows, "schema_status"),
            "proposals": len(proposed),
            "claim_bound_proposals": len(claim_bound),
            "claim_bound_proposal_ratio": (
                len(claim_bound) / len(proposed) if proposed else None
            ),
            "support_exposed": "n/a"
            if treatment == "llm-no-knowledge"
            else _count(proposed, "support_exposed"),
            "strata": strata,
        }
    payload = {
        "schema_version": "ecos.rq2_provenance_support.v1",
        "treatments": by_treatment,
    }
    if bank is not None:
        payload["bank"] = {
            "context_count": len(bank.get("contexts", ())),
            "eligibility": _count(bank.get("contexts", ()), "eligibility"),
            "excluded": bank.get("excluded", ()),
        }
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    offline = sub.add_parser("offline-report")
    offline.add_argument("--observations-root", type=Path, required=True)
    offline.add_argument("--bank", type=Path)
    offline.add_argument("--output", type=Path, required=True)
    offline.add_argument("--draws", type=int, default=4000)
    args = parser.parse_args(argv)
    if args.command == "offline-report":
        root = args.observations_root
        rows = _read_rows(sorted(root.glob("*/*/observations*.jsonl")))
        bank = (
            json.loads(args.bank.read_text(encoding="utf-8"))
            if args.bank is not None
            else None
        )
        payload = {
            "schema_version": "ecos.rq2_offline_analysis.v1",
            "observations": len(rows),
            "noise_floor_calibration": noise_floor_calibration(rows),
            "provenance_support": provenance_support(rows, bank=bank),
            "policy_posterior": policy_posterior(rows, draws=args.draws),
            "policy_shift": policy_shift(rows, draws=args.draws),
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n",
            encoding="utf-8",
        )
        print(
            json.dumps(
                {
                    "observations": len(rows),
                    "noise_floor_status": payload["noise_floor_calibration"][
                        "noise_floor_status_overall"
                    ],
                    "shift_pairs": sorted(payload["policy_shift"]["summary"]),
                },
                indent=2,
            )
        )
        return 0
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
