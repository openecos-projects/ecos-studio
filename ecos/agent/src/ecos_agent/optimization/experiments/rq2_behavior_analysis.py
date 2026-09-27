"""RQ2 behavior stratification over immutable offline observation rows."""

from __future__ import annotations

from collections import Counter
from typing import Mapping, Sequence

from ecos_agent.optimization.experiments.rq2_analysis import policy_shift
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    RQ2_PRIMARY_COMPARISONS,
    RQ2_TREATMENTS,
)

DUAL = "state-conditioned-dual-layer-zero-shot"
OPPORTUNITY_STRATUM = "knowledge_opportunity"
NEGATIVE_STRATA = (
    "stale_binding",
    "anti_condition",
    "missing_required_evidence",
    "no_supported_action",
)


def _equal_context_mass_changes(
    rows: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    by_context_treatment: dict[tuple[str, str], list[Mapping[str, object]]] = {}
    for row in rows:
        by_context_treatment.setdefault(
            (str(row["context_fingerprint"]), str(row["treatment"])), []
        ).append(row)
    result: dict[str, object] = {}
    for base, comparator in RQ2_PRIMARY_COMPARISONS:
        pair = f"{base}||{comparator}"
        levels: dict[str, object] = {}
        contexts = sorted(
            fingerprint
            for fingerprint, treatment in by_context_treatment
            if treatment == base
            and (fingerprint, comparator) in by_context_treatment
        )
        for level in ("L0", "L1", "L2"):
            base_mass: Counter[str] = Counter()
            comparator_mass: Counter[str] = Counter()
            for fingerprint in contexts:
                for treatment, target in (
                    (base, base_mass),
                    (comparator, comparator_mass),
                ):
                    signatures = [
                        str(row["levels"][level])
                        for row in by_context_treatment[(fingerprint, treatment)]
                    ]
                    counts = Counter(signatures)
                    total = len(signatures)
                    for signature, count in counts.items():
                        target[signature] += count / total
            divisor = len(contexts) or 1
            vocabulary = sorted(set(base_mass) | set(comparator_mass))
            changes = [
                {
                    "signature": signature,
                    "base_mass": base_mass[signature] / divisor,
                    "comparator_mass": comparator_mass[signature] / divisor,
                    "delta_base_minus_comparator": (
                        base_mass[signature] - comparator_mass[signature]
                    )
                    / divisor,
                }
                for signature in vocabulary
            ]
            changes.sort(
                key=lambda item: (
                    -abs(float(item["delta_base_minus_comparator"])),
                    str(item["signature"]),
                )
            )
            levels[level] = {
                "matched_contexts": len(contexts),
                "context_weighting": "equal",
                "changes": changes,
            }
        result[pair] = levels
    return result


def _fixed_depth_rows(
    rows: Sequence[Mapping[str, object]], depth: int
) -> tuple[list[Mapping[str, object]], set[str]]:
    counts = Counter(
        (str(row["context_fingerprint"]), str(row["treatment"])) for row in rows
    )
    fingerprints = {fingerprint for fingerprint, _ in counts}
    eligible = {
        fingerprint
        for fingerprint in fingerprints
        if all(counts[(fingerprint, treatment)] >= depth for treatment in RQ2_TREATMENTS)
    }
    return [
        row
        for row in rows
        if str(row["context_fingerprint"]) in eligible
        and int(row.get("repeat") or 0) <= depth
    ], eligible


def _gate_conformance(
    rows: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    by_stratum: dict[str, object] = {}
    for stratum in NEGATIVE_STRATA:
        stratum_rows = [row for row in rows if row.get("state_stratum") == stratum]
        by_treatment = {}
        for treatment in RQ2_TREATMENTS:
            treatment_rows = [
                row for row in stratum_rows if row.get("treatment") == treatment
            ]
            by_treatment[treatment] = {
                "rows": len(treatment_rows),
                "valid": sum(
                    row.get("schema_status") == "valid" for row in treatment_rows
                ),
                "no_action": sum(
                    row.get("schema_status") == "valid"
                    and str(row["levels"]["L0"]) == "continue"
                    for row in treatment_rows
                ),
            }
        dual_rows = [row for row in stratum_rows if row.get("treatment") == DUAL]
        grouped: dict[str, list[Mapping[str, object]]] = {}
        for row in dual_rows:
            grouped.setdefault(str(row["context_fingerprint"]), []).append(row)

        def conforms(row: Mapping[str, object]) -> bool:
            return (
                row.get("schema_status") == "valid"
                and str(row["levels"]["L0"]) == "continue"
                and str(row["levels"].get("evidence_status")) == "abstain"
            )

        by_stratum[stratum] = {
            "expected_behavior": "deterministic gate abstention/no-action",
            "dual": {
                "rows": len(dual_rows),
                "conformant_rows": sum(conforms(row) for row in dual_rows),
                "contexts": len(grouped),
                "conformant_contexts": sum(
                    bool(group) and all(conforms(row) for row in group)
                    for group in grouped.values()
                ),
                "near_zero_wall_rows": sum(
                    conforms(row) and float(row.get("wall_seconds") or 1.0) < 0.01
                    for row in dual_rows
                ),
            },
            "by_treatment": by_treatment,
        }
    return {
        "construct": "controller/provider-wrapper gate conformance, not LLM behavior",
        "contexts": len(
            {
                str(row["context_fingerprint"])
                for row in rows
                if row.get("state_stratum") in NEGATIVE_STRATA
            }
        ),
        "by_stratum": by_stratum,
    }


def stratified_behavior_analysis(
    rows: Sequence[Mapping[str, object]],
    *,
    contexts: Sequence[Mapping[str, object]],
    draws: int = 4000,
    permutations: int = 2000,
    bootstrap_draws: int = 2000,
    seed: int = 0,
) -> dict[str, object]:
    """Separate provider-generated opportunity behavior from deterministic gates."""
    opportunity_rows = [
        row for row in rows if row.get("state_stratum") == OPPORTUNITY_STRATUM
    ]
    opportunity_contexts = [
        context
        for context in contexts
        if context.get("state_stratum") == OPPORTUNITY_STRATUM
    ]
    opportunity_shift = policy_shift(
        opportunity_rows,
        contexts=opportunity_contexts,
        draws=draws,
        permutations=permutations,
        bootstrap_draws=bootstrap_draws,
        seed=seed,
    )
    fixed_depth = {}
    for depth in (3, 5):
        selected, eligible = _fixed_depth_rows(opportunity_rows, depth)
        selected_contexts = [
            context
            for context in opportunity_contexts
            if str(context["context_fingerprint"]) in eligible
        ]
        fixed_depth[f"first_{depth}"] = {
            "depth": depth,
            "contexts": len(eligible),
            "cells": len(eligible) * len(RQ2_TREATMENTS),
            "observations": len(selected),
            "policy_shift": policy_shift(
                selected,
                contexts=selected_contexts,
                draws=draws,
                permutations=permutations,
                bootstrap_draws=bootstrap_draws,
                seed=seed,
            ),
        }
    by_checkpoint = {}
    for checkpoint in sorted({str(row.get("checkpoint")) for row in opportunity_rows}):
        checkpoint_rows = [
            row for row in opportunity_rows if str(row.get("checkpoint")) == checkpoint
        ]
        checkpoint_contexts = [
            context
            for context in opportunity_contexts
            if str(context.get("checkpoint")) == checkpoint
        ]
        shift = policy_shift(
            checkpoint_rows,
            contexts=checkpoint_contexts,
            draws=draws,
            permutations=permutations,
            bootstrap_draws=bootstrap_draws,
            seed=seed,
        )
        by_checkpoint[checkpoint] = {
            "contexts": len(checkpoint_contexts),
            "summary": shift["primary_all_outcomes"]["summary"],
        }
    by_stratum = {}
    for stratum in sorted({str(row.get("state_stratum")) for row in rows}):
        stratum_rows = [row for row in rows if row.get("state_stratum") == stratum]
        stratum_contexts = [
            context for context in contexts if context.get("state_stratum") == stratum
        ]
        shift = policy_shift(
            stratum_rows,
            contexts=stratum_contexts,
            draws=draws,
            permutations=permutations,
            bootstrap_draws=bootstrap_draws,
            seed=seed,
        )
        by_stratum[stratum] = {
            "construct": (
                "provider_generated_behavior"
                if stratum == OPPORTUNITY_STRATUM
                else "system_output_gate_diagnostic"
            ),
            "contexts": len(stratum_contexts),
            "summary": shift["primary_all_outcomes"]["summary"],
        }
    return {
        "schema_version": "ecos.rq2_stratified_behavior.v1",
        "provider_generated_behavior": {
            "stratum": OPPORTUNITY_STRATUM,
            "contexts": len(opportunity_contexts),
            "cells": len(
                {
                    (str(row["context_fingerprint"]), str(row["treatment"]))
                    for row in opportunity_rows
                }
            ),
            "observations": len(opportunity_rows),
            "policy_shift": opportunity_shift,
            "action_mass_changes": _equal_context_mass_changes(opportunity_rows),
            "by_checkpoint": by_checkpoint,
            "by_design": opportunity_shift["primary_all_outcomes"][
                "design_heterogeneity"
            ],
        },
        "state_gate_conformance": _gate_conformance(rows),
        "fixed_depth_sensitivity": fixed_depth,
        "system_output_diagnostic_by_stratum": by_stratum,
        "analysis_amendment": {
            "primary_estimand": {
                "original": "posterior TV / rho_tau",
                "corrected": "equal-weight matched-context empirical TV",
                "reason": "sparse-vocabulary null calibration",
            },
            "noise_grouping": {
                "original": "context",
                "corrected": "context+treatment",
                "reason": "avoid treatment mixing",
            },
            "vocabulary": {
                "original": "observed arm-specific",
                "corrected": "fixed legal-action alphabet",
                "reason": "comparable support",
            },
            "behavior_construct": {
                "original": "pooled 120-context LLM behavior",
                "corrected": "24 opportunity-context provider behavior + 96 negative-context gate conformance",
                "reason": "Dual bypasses the provider on negative strata",
            },
        },
    }

