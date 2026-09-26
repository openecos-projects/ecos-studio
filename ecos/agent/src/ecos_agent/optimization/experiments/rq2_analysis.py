"""RQ2 aggregate analysis: noise floor, policy posterior, policy shift.

Reads the versioned offline observation rows (``ecos.rq2_planner_observation.v1``)
and per-cell posteriors, and produces the preregistered G3/G4/G7 analysis
artifacts.  Provider errors, schema failures, and timeouts stay in every
denominator; cells are never treated as independent online episodes.
"""

from __future__ import annotations

import argparse
import json
import random
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
    by_cell: dict[tuple[str, str], set[str]] = {}
    for row in rows:
        if row.get("schema_status") != "valid":
            continue
        signature = str(row["levels"][level])
        key = (str(row["context_fingerprint"]), str(row["treatment"]))
        by_cell.setdefault(key, set()).add(signature)
    cells = len(by_cell)
    divergent = sum(len(signatures) > 1 for signatures in by_cell.values())
    interval = wilson_score_interval(divergent, cells)
    return {
        "cells": cells,
        "divergent_cells": divergent,
        # Compatibility aliases for older readers of the v1 artifact.
        "contexts_with_valid_observations": cells,
        "divergent_contexts": divergent,
        **interval,
    }


def noise_floor_calibration(
    rows: Sequence[Mapping[str, object]],
    *,
    strata: Sequence[str] = (),
) -> dict[str, object]:
    """Provider-noise calibration over repeated calls within each treatment."""
    attempted = list(rows)
    strata = list(strata) or sorted(
        {str(row.get("state_stratum")) for row in attempted}
    )
    by_stratum: dict[str, object] = {}
    statuses: list[str] = []
    for stratum in strata:
        stratum_rows = [
            row for row in attempted if row.get("state_stratum") == stratum
        ]
        disagreement = _within_treatment_disagreement(stratum_rows)
        rate = float(disagreement.get("rate") or 0.0)
        if disagreement["cells"] == 0:
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
    worst = "not_estimable" if not statuses or "not_estimable" in statuses else (
        "high" if "high" in statuses else "material" if "material" in statuses else "low"
    )
    treatments = sorted({str(row.get("treatment")) for row in attempted})
    by_treatment = {
        treatment: _within_treatment_disagreement(
            [row for row in attempted if str(row.get("treatment")) == treatment]
        )
        for treatment in treatments
    }
    valid = [row for row in attempted if row.get("schema_status") == "valid"]
    disagreement_by_level = {
        level: {
            "overall": _within_treatment_disagreement(attempted, level),
            "by_treatment": {
                treatment: _within_treatment_disagreement(
                    [
                        row
                        for row in attempted
                        if str(row.get("treatment")) == treatment
                    ],
                    level,
                )
                for treatment in treatments
            },
            "by_stratum": {
                stratum: _within_treatment_disagreement(
                    [
                        row
                        for row in attempted
                        if str(row.get("state_stratum")) == stratum
                    ],
                    level,
                )
                for stratum in strata
            },
        }
        for level in ("L1", "L2")
    }
    return {
        "schema_version": "ecos.rq2_noise_floor_calibration.v2",
        "attempted_rows": len(attempted),
        "valid_rows": len(valid),
        "provider_error_rows": sum(
            1 for row in attempted if row.get("schema_status") == "provider_error"
        ),
        "timeout_rows": sum(
            1 for row in attempted if row.get("schema_status") == "timeout"
        ),
        "schema_invalid_rows": sum(
            1 for row in attempted if row.get("schema_status") == "invalid"
        ),
        "overall_within_treatment_disagreement": _within_treatment_disagreement(
            attempted
        ),
        "by_treatment": by_treatment,
        "disagreement_by_level": disagreement_by_level,
        "strata": by_stratum,
        "noise_floor_status_overall": worst,
    }


_NON_PROPOSAL_OUTCOMES = (
    "continue",
    "stop",
    "provider_error",
    "schema_error",
    "timeout",
    "invalid",
)


def _context_index(
    contexts: Sequence[Mapping[str, object]],
) -> dict[str, Mapping[str, object]]:
    return {str(context["context_fingerprint"]): context for context in contexts}


def _fixed_action_alphabet(
    context: Mapping[str, object], level: str
) -> tuple[str, ...]:
    planning = dict(context.get("planning_context") or {})
    actions = list(planning.get("legal_actions") or [])
    domains = {
        str(domain.get("knob_id")): domain
        for domain in planning.get("effective_domains") or []
    }
    if level == "L0":
        return tuple(sorted({"propose", *_NON_PROPOSAL_OUTCOMES}))
    if level == "L1":
        proposals = {
            f"propose:{str(action.get('knob_id')).split('.', 1)[0]}"
            for action in actions
        }
    elif level == "L2":
        proposals = {
            f"propose:{action.get('knob_id')}:{action.get('direction')}"
            for action in actions
        }
    elif level == "L3":
        proposals = set()
        for action in actions:
            knob = str(action.get("knob_id"))
            direction = str(action.get("direction"))
            domain = domains.get(knob)
            if domain is None:
                raise ValueError(f"missing effective domain for legal action {knob}")
            value_type = str(dict(domain.get("value_bounds") or {}).get("type"))
            if value_type in {"number", "integer"}:
                buckets = ("low", "mid", "high")
            elif value_type == "boolean":
                if direction not in {"enable", "disable"}:
                    raise ValueError(
                        f"boolean legal action has unsupported direction {knob}:{direction}"
                    )
                buckets = ("True" if direction == "enable" else "False",)
            else:
                raise ValueError(
                    f"unsupported effective-domain type for {knob}: {value_type}"
                )
            proposals.update(
                f"propose:{knob}:{direction}:{bucket}" for bucket in buckets
            )
    else:
        raise ValueError(f"unsupported action level: {level}")
    return tuple(sorted(proposals | set(_NON_PROPOSAL_OUTCOMES)))


def _counts_with_alphabet(
    rows: Sequence[Mapping[str, object]],
    level: str,
    alphabet: Sequence[str] | None,
) -> dict[str, int]:
    if alphabet is None:
        counts: dict[str, int] = {}
    else:
        counts = {signature: 0 for signature in alphabet}
    for row in rows:
        signature = str(row["levels"][level])
        if alphabet is not None and signature not in counts:
            raise ValueError(
                f"observed {level} signature outside frozen legal-action alphabet: "
                f"{signature} ({row.get('context_fingerprint')})"
            )
        counts[signature] = counts.get(signature, 0) + 1
    return counts


def policy_posterior(
    rows: Sequence[Mapping[str, object]],
    *,
    contexts: Sequence[Mapping[str, object]] | None = None,
    draws: int = 4000,
    alpha: float = RQ2_POSTERIOR_PRIOR_ALPHA,
) -> dict[str, object]:
    """Per-cell L0-L3 posteriors over a context-fixed action vocabulary."""
    context_by_fingerprint = _context_index(contexts or ())
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
        context = context_by_fingerprint.get(fingerprint)
        if contexts is not None and context is None:
            raise ValueError(f"context is absent from frozen bank: {fingerprint}")
        levels = {}
        for level in ("L0", "L1", "L2", "L3"):
            alphabet = _fixed_action_alphabet(context, level) if context else None
            metrics = posterior_cell_metrics(
                _counts_with_alphabet(cell_rows, level, alphabet),
                alpha=alpha,
                draws=draws,
                seed=posterior_seed(fingerprint, treatment, level),
            )
            metrics["vocabulary_source"] = (
                "fixed_legal_action_alphabet" if context else "observed_actions"
            )
            levels[level] = metrics
        cells.append(
            {
                "schema_version": "ecos.rq2_policy_posterior_cell.v2",
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
        "schema_version": "ecos.rq2_policy_posterior.v2",
        "vocabulary_source": (
            "fixed_legal_action_alphabet" if contexts is not None else "observed_actions"
        ),
        "cells": cells,
        "observations": len(rows),
    }


def _cell_counts_by_treatment(
    rows: Sequence[Mapping[str, object]],
    level: str,
    *,
    alphabet: Sequence[str] | None = None,
) -> dict[str, dict[str, int]]:
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("treatment")), []).append(row)
    return {
        treatment: _counts_with_alphabet(group, level, alphabet)
        for treatment, group in grouped.items()
    }


def _empirical_distribution(counts: Mapping[str, int]) -> dict[str, float]:
    total = sum(counts.values())
    if total == 0:
        return {}
    return {key: value / total for key, value in counts.items()}


def _percentile_interval(values: Sequence[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    ordered = sorted(values)
    lo = ordered[int(0.025 * (len(ordered) - 1))]
    hi = ordered[int(0.975 * (len(ordered) - 1))]
    return float(lo), float(hi)


def _permutation_test(
    samples: Sequence[Mapping[str, object]], *, draws: int, seed: int
) -> dict[str, object]:
    observed = sum(float(sample["tv"]) for sample in samples) / len(samples)
    rng = random.Random(seed)
    null_values = []
    for _ in range(draws):
        context_distances = []
        for sample in samples:
            base = list(sample["base_actions"])
            comparator = list(sample["comparator_actions"])
            pooled = base + comparator
            rng.shuffle(pooled)
            split = len(base)
            perm_base = Counter(pooled[:split])
            perm_comparator = Counter(pooled[split:])
            context_distances.append(
                total_variation(
                    _empirical_distribution(perm_base),
                    _empirical_distribution(perm_comparator),
                )
            )
        null_values.append(sum(context_distances) / len(context_distances))
    lo, hi = _percentile_interval(null_values)
    return {
        "draws": draws,
        "seed": seed,
        "null_mean": sum(null_values) / len(null_values) if null_values else None,
        "null_lo95": lo,
        "null_hi95": hi,
        "p_value": (
            (1 + sum(value >= observed for value in null_values)) / (draws + 1)
            if null_values
            else None
        ),
    }


def _design_sensitivity(
    samples: Sequence[Mapping[str, object]], *, draws: int, seed: int
) -> tuple[dict[str, float], dict[str, object], dict[str, float]]:
    by_design: dict[str, list[float]] = {}
    for sample in samples:
        by_design.setdefault(str(sample["design"]), []).append(float(sample["tv"]))
    means = {
        design: sum(values) / len(values) for design, values in sorted(by_design.items())
    }
    designs = list(means)
    if not designs:
        return {}, {"designs": 0, "draws": draws, "seed": seed}, {}
    rng = random.Random(seed)
    boot = [
        sum(means[rng.choice(designs)] for _ in designs) / len(designs)
        for _ in range(draws)
    ]
    lo, hi = _percentile_interval(boot)
    leave_one_out = {
        omitted: sum(means[design] for design in designs if design != omitted)
        / (len(designs) - 1)
        for omitted in designs
        if len(designs) > 1
    }
    return means, {
        "designs": len(designs),
        "draws": draws,
        "seed": seed,
        "lo95": lo,
        "hi95": hi,
    }, leave_one_out


def _holm_adjust(summary: dict[str, dict[str, object]], level: str) -> None:
    keys = [
        f"{level}|{base}||{comparator}"
        for base, comparator in RQ2_PRIMARY_COMPARISONS
        if f"{level}|{base}||{comparator}" in summary
    ]
    ranked = sorted(
        keys,
        key=lambda key: float(summary[key]["permutation"]["p_value"]),
    )
    running = 0.0
    for rank, key in enumerate(ranked):
        raw = float(summary[key]["permutation"]["p_value"])
        running = max(running, min(1.0, (len(ranked) - rank) * raw))
        summary[key]["permutation"]["p_holm"] = running
        summary[key]["permutation"]["holm_family"] = (
            f"{level}:three_primary_comparisons"
        )


def _analyze_policy_shift(
    rows: Sequence[Mapping[str, object]],
    *,
    context_by_fingerprint: Mapping[str, Mapping[str, object]],
    valid_only: bool,
    tau: float,
    cutoff: float,
    draws: int,
    alpha: float,
    permutations: int,
    bootstrap_draws: int,
    seed: int,
) -> dict[str, object]:
    selected = [row for row in rows if not valid_only or row.get("schema_status") == "valid"]
    by_context: dict[str, list[Mapping[str, object]]] = {}
    for row in selected:
        fingerprint = str(row["context_fingerprint"])
        if context_by_fingerprint and fingerprint not in context_by_fingerprint:
            raise ValueError(f"context is absent from frozen bank: {fingerprint}")
        by_context.setdefault(fingerprint, []).append(row)

    context_results = []
    pair_samples: dict[tuple[str, str], list[dict[str, object]]] = {}
    for fingerprint, cell_rows in sorted(by_context.items()):
        context = context_by_fingerprint.get(fingerprint)
        design = str(context.get("design")) if context else str(cell_rows[0].get("design"))
        for level in ("L1", "L2"):
            alphabet = _fixed_action_alphabet(context, level) if context else None
            counts = _cell_counts_by_treatment(cell_rows, level, alphabet=alphabet)
            comparisons = {}
            for base, comparator in RQ2_PRIMARY_COMPARISONS:
                if base not in counts or comparator not in counts:
                    continue
                if not sum(counts[base].values()) or not sum(counts[comparator].values()):
                    continue
                base_dist = _empirical_distribution(counts[base])
                comparator_dist = _empirical_distribution(counts[comparator])
                tv = total_variation(base_dist, comparator_dist)
                diagnostic = material_shift_probability(
                    counts[base],
                    counts[comparator],
                    tau=tau,
                    alpha=alpha,
                    draws=draws,
                    seed=posterior_seed(fingerprint, base, comparator, level),
                )
                pair_key = f"{base}||{comparator}"
                comparisons[pair_key] = {
                    **diagnostic,
                    "matched_context_tv": tv,
                    "delta_local_tv": tv,
                    "top_action_base": max(base_dist, key=base_dist.get),
                    "top_action_comparator": max(
                        comparator_dist, key=comparator_dist.get
                    ),
                }
                pair_samples.setdefault((level, pair_key), []).append(
                    {
                        "context_fingerprint": fingerprint,
                        "design": design,
                        "tv": tv,
                        "base_distribution": base_dist,
                        "comparator_distribution": comparator_dist,
                        "base_actions": [
                            str(row["levels"][level])
                            for row in cell_rows
                            if str(row.get("treatment")) == base
                        ],
                        "comparator_actions": [
                            str(row["levels"][level])
                            for row in cell_rows
                            if str(row.get("treatment")) == comparator
                        ],
                    }
                )
            context_results.append(
                {
                    "context_fingerprint": fingerprint,
                    "design": design,
                    "observations": len(cell_rows),
                    "level": level,
                    "comparisons": comparisons,
                }
            )

    summary: dict[str, dict[str, object]] = {}
    marginal = {}
    for (level, pair_key), samples in sorted(pair_samples.items()):
        values = [float(sample["tv"]) for sample in samples]
        probabilities = [
            float(
                next(
                    result["comparisons"][pair_key]["probability"]
                    for result in context_results
                    if result["level"] == level
                    and result["context_fingerprint"] == sample["context_fingerprint"]
                )
            )
            for sample in samples
        ]
        permutation_seed = posterior_seed(
            str(seed), "treatment-label-permutation", str(valid_only), level, pair_key
        )
        bootstrap_seed = posterior_seed(
            str(seed), "design-block-bootstrap", str(valid_only), level, pair_key
        )
        design_means, design_block, leave_one_out = _design_sensitivity(
            samples, draws=bootstrap_draws, seed=bootstrap_seed
        )
        key = f"{level}|{pair_key}"
        summary[key] = {
            "matched_context_tv_mean": sum(values) / len(values),
            "matched_contexts": len(values),
            "delta_local_mean": sum(values) / len(values),
            "delta_local_contexts": len(values),
            "permutation": _permutation_test(
                samples, draws=permutations, seed=permutation_seed
            ),
            "design_level_means": design_means,
            "design_block": design_block,
            "leave_one_design_out": leave_one_out,
            "material_probability_mean": sum(probabilities) / len(probabilities),
            "rho_tau": sum(probability >= cutoff for probability in probabilities)
            / len(probabilities),
            "resolved_contexts": sum(
                probability >= cutoff or probability <= 1.0 - cutoff
                for probability in probabilities
            ),
        }
        base_distributions = [sample["base_distribution"] for sample in samples]
        comparator_distributions = [
            sample["comparator_distribution"] for sample in samples
        ]
        vocabulary = sorted(
            set().union(
                *(distribution.keys() for distribution in base_distributions),
                *(distribution.keys() for distribution in comparator_distributions),
            )
        )
        base_marginal = {
            action: sum(float(dist.get(action, 0.0)) for dist in base_distributions)
            / len(base_distributions)
            for action in vocabulary
        }
        comparator_marginal = {
            action: sum(
                float(dist.get(action, 0.0)) for dist in comparator_distributions
            )
            / len(comparator_distributions)
            for action in vocabulary
        }
        marginal[key] = {
            "delta_marginal_tv": total_variation(
                base_marginal, comparator_marginal
            ),
            "context_weighting": "equal",
            "matched_contexts": len(samples),
        }
    for level in ("L1", "L2"):
        _holm_adjust(summary, level)

    primary_pair = (
        f"L2|{RQ2_PRIMARY_COMPARISONS[0][0]}||{RQ2_PRIMARY_COMPARISONS[0][1]}"
    )
    primary_designs = summary.get(primary_pair, {}).get("design_level_means", {})
    return {
        "valid_only": valid_only,
        "observations": len(selected),
        "contexts": context_results,
        "summary": summary,
        "delta_marginal": marginal,
        "design_heterogeneity": {
            design: {"matched_context_tv_mean": value}
            for design, value in dict(primary_designs).items()
        },
    }


def policy_shift(
    rows: Sequence[Mapping[str, object]],
    *,
    contexts: Sequence[Mapping[str, object]] | None = None,
    tau: float = MATERIAL_SHIFT_TAU,
    cutoff: float = MATERIAL_PROBABILITY_CUTOFF,
    draws: int = 4000,
    alpha: float = RQ2_POSTERIOR_PRIOR_ALPHA,
    permutations: int = 2000,
    bootstrap_draws: int = 2000,
    seed: int = 0,
) -> dict[str, object]:
    """Matched-context empirical TV with treatment-label null calibration."""
    context_by_fingerprint = _context_index(contexts or ())
    primary = _analyze_policy_shift(
        rows,
        context_by_fingerprint=context_by_fingerprint,
        valid_only=False,
        tau=tau,
        cutoff=cutoff,
        draws=draws,
        alpha=alpha,
        permutations=permutations,
        bootstrap_draws=bootstrap_draws,
        seed=seed,
    )
    valid_only = _analyze_policy_shift(
        rows,
        context_by_fingerprint=context_by_fingerprint,
        valid_only=True,
        tau=tau,
        cutoff=cutoff,
        draws=draws,
        alpha=alpha,
        permutations=permutations,
        bootstrap_draws=bootstrap_draws,
        seed=seed,
    )
    return {
        "schema_version": "ecos.rq2_policy_shift.v2",
        "estimand": "equal-weight matched-context empirical total variation",
        "vocabulary_source": (
            "fixed_legal_action_alphabet" if contexts is not None else "observed_actions"
        ),
        "permutation_contract": (
            "shuffle treatment labels within context while preserving arm sizes"
        ),
        "permutation_draws": permutations,
        "bootstrap_draws": bootstrap_draws,
        "seed": seed,
        "tau": tau,
        "probability_cutoff": cutoff,
        "material_probability_role": "descriptive_only_uncalibrated",
        "primary_all_outcomes": primary,
        "valid_only_sensitivity": valid_only,
        # Compatibility aliases point to the primary all-outcomes analysis.
        "contexts": primary["contexts"],
        "summary": primary["summary"],
        "delta_marginal": primary["delta_marginal"],
        "design_heterogeneity": primary["design_heterogeneity"],
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
