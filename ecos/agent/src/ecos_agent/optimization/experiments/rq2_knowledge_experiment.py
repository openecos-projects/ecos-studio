"""Formal RQ2 knowledge experiment: protocol, projection, adaptive behavior bank.

RQ2 asks two questions the old pilot could not answer: (a) under matched
frozen planning contexts, does state-conditioned knowledge shift the planner's
action distribution beyond quantified provider variability (behavior), and
(b) how often knowledge-bound proposals reach verified native application
(activation -- answered online, separately).

This module freezes the experiment contract (six designs, four zero-shot
treatments, adaptive repeats, preregistered posterior thresholds), projects
each treatment from one shared frozen context, and runs the adaptive
offline bank.  It never executes ECC candidates and never edits old batches.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.frozen_contexts import CONTEXT_STRATA
from ecos_agent.optimization.experiments.knowledge_metrics import (
    RQ2_POSTERIOR_PRIOR_ALPHA,
    material_shift_probability,
    posterior_cell_metrics,
    posterior_mean_distribution,
    posterior_seed,
    total_variation,
)
from ecos_agent.optimization.experiments.knowledge_pilot import (
    apply_treatment,
    apply_same_gate_no_semantic_guidance,
    rebuild_planning_context,
)
from ecos_agent.optimization.experiments.knowledge_protocol import (
    RQ2_DESIGNS,
    validate_rq2_design_ids,
)
from ecos_agent.optimization.experiments.knowledge_treatments import (
    ZERO_SHOT_GATE_TREATMENTS,
)

RQ2_EXPERIMENT_SCHEMA = "ecos.rq2_knowledge_experiment.v1"
RQ2_BANK_SCHEMA = "ecos.rq2_context_bank.v1"
FROZEN_CONTEXT_V2 = "ecos.frozen_context.v2"
OBSERVATION_SCHEMA = "ecos.rq2_planner_observation.v1"
POSTERIOR_SCHEMA = "ecos.rq2_cell_posterior.v1"
ADAPTIVE_SAMPLE_SCHEMA = "ecos.rq2_adaptive_policy_sample.v1"

# Plan names use ``missing_observation`` / ``missing_evidence`` /
# ``unsupported_action``; the frozen v1 bank schema already committed to
# ``missing_required_evidence`` / ``no_supported_action``.  The canonical
# schema names win and the aliases are registered in every manifest so the
# denominators stay auditable.
STRATUM_ALIASES = {
    "missing_observation": "missing_required_evidence",
    "missing_evidence": "missing_required_evidence",
    "unsupported_action": "no_supported_action",
}

RQ2_TREATMENTS = tuple(
    config.treatment.value for config in ZERO_SHOT_GATE_TREATMENTS
)
SAME_GATE_NO_SEMANTIC_GUIDANCE = "same-gate-no-semantic-guidance"
SHAM_TREATMENTS = (
    "state-conditioned-dual-layer-zero-shot",
    SAME_GATE_NO_SEMANTIC_GUIDANCE,
)
RQ2_TREATMENT_MODES = {
    config.treatment.value: config.agent_mode for config in ZERO_SHOT_GATE_TREATMENTS
}
# The unconditioned arm's mechanistic role is to propose where the state gate
# abstains, which inverts the negative-strata correctness contract, so its
# correctness is mechanism-only rather than gate-scored.
MECHANISM_ONLY_TREATMENTS = frozenset({"unconditioned-support-zero-shot"})
RQ2_PRIMARY_COMPARISONS = (
    ("state-conditioned-dual-layer-zero-shot", "llm-no-knowledge"),
    ("state-conditioned-dual-layer-zero-shot", "current-metric-id-raw-rag"),
    ("state-conditioned-dual-layer-zero-shot", "unconditioned-support-zero-shot"),
)

ADAPTIVE_LEVELS = (3, 5, 7)
CONCENTRATION_THRESHOLD = 0.5
MATERIAL_PROBABILITY_CUTOFF = 0.95
MATERIAL_SHIFT_TAU = 0.20
POSTERIOR_DRAWS = 4000


def canonical_stratum(name: str) -> str:
    return STRATUM_ALIASES.get(name, name)


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def build_rq2_manifest(
    *,
    model: str,
    reasoning_effort: str,
    seed: int,
    objective: str,
    geometry_mode: str,
    knowledge_bundle_sha256: str,
    state_rule_manifest_sha256: str,
    toolchain: Mapping[str, object],
    prompt_skeleton_sha256: str,
    checkpoints_per_design_target: int = 4,
    strata_per_checkpoint_target: int = 5,
    design_ids: Sequence[str] = RQ2_DESIGNS,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "schema_version": RQ2_EXPERIMENT_SCHEMA,
        "design_ids": list(validate_rq2_design_ids(design_ids)),
        "model": model,
        "reasoning_effort": reasoning_effort,
        "seed": seed,
        "objective": objective,
        "geometry_mode": geometry_mode,
        "candidate_limit": 20,
        "planning_call_limit": 60,
        "min_offline_repeats": min(ADAPTIVE_LEVELS),
        "max_offline_repeats": max(ADAPTIVE_LEVELS),
        "adaptive_levels": list(ADAPTIVE_LEVELS),
        "material_shift_threshold": MATERIAL_SHIFT_TAU,
        "material_probability_cutoff": MATERIAL_PROBABILITY_CUTOFF,
        "concentration_threshold": CONCENTRATION_THRESHOLD,
        "posterior_prior_alpha": RQ2_POSTERIOR_PRIOR_ALPHA,
        "posterior_mc_draws": POSTERIOR_DRAWS,
        "posterior_mc_seed_rule": "sha256(context_fingerprint, treatments) -- analysis-side only; provider sampling stays unseeded",
        "treatments": list(RQ2_TREATMENTS),
        "treatment_agent_modes": dict(RQ2_TREATMENT_MODES),
        "mechanism_only_treatments": sorted(MECHANISM_ONLY_TREATMENTS),
        "primary_comparisons": [
            list(pair) for pair in RQ2_PRIMARY_COMPARISONS
        ],
        "action_levels": ["L0", "L1", "L2", "L3"],
        "action_level_projection": {
            "L0": "decision outcome (propose/continue/stop/invalid or error class)",
            "L1": "action family (knob stage prefix) for proposals, else L0 outcome",
            "L2": "knob + direction for proposals, else L0 outcome",
            "L3": "knob + direction + value bucket (effective-domain tercile), else L0 outcome",
        },
        "context_bank_contract": {
            "checkpoints_per_design_target": checkpoints_per_design_target,
            "strata_per_checkpoint_target": strata_per_checkpoint_target,
        },
        "stratum_aliases": dict(STRATUM_ALIASES),
        "canonical_strata": list(CONTEXT_STRATA),
        "knowledge_bundle_sha256": knowledge_bundle_sha256,
        "state_rule_manifest_sha256": state_rule_manifest_sha256,
        "toolchain": dict(toolchain),
        "prompt_skeleton_sha256": prompt_skeleton_sha256,
        "provider_sampling_seed": "unavailable_or_recorded",
        "teacher_forced_logprob_supported": False,
        "old_batches_read_only": True,
    }
    payload["manifest_hash"] = canonical_sha256(payload)
    return payload


def validate_rq2_manifest(manifest: Mapping[str, object]) -> None:
    if manifest.get("schema_version") != RQ2_EXPERIMENT_SCHEMA:
        raise ValueError("unsupported RQ2 knowledge experiment manifest")
    expected = dict(manifest)
    actual = expected.pop("manifest_hash", None)
    if actual != canonical_sha256(expected):
        raise ValueError("RQ2 knowledge experiment manifest hash mismatch")
    if tuple(manifest.get("treatments", ())) != RQ2_TREATMENTS:
        raise ValueError("RQ2 manifest treatments must be the four zero-shot arms")
    validate_rq2_design_ids(manifest.get("design_ids", ()))


# ---------------------------------------------------------------------------
# Frozen context v2
# ---------------------------------------------------------------------------

_V2_REQUIRED_HASHES = (
    "objective_contract_sha256",
    "legal_actions_sha256",
    "trajectory_snapshot_sha256",
    "knowledge_bundle_sha256",
    "state_rule_manifest_sha256",
    "toolchain_sha256",
    "prompt_skeleton_sha256",
)


def build_rq2_frozen_context(payload: Mapping[str, object]) -> dict[str, object]:
    value = {"schema_version": FROZEN_CONTEXT_V2, **dict(payload)}
    value.pop("context_fingerprint", None)
    value["context_fingerprint"] = canonical_sha256(value)
    return value


def validate_rq2_frozen_context(context: Mapping[str, object]) -> None:
    if context.get("schema_version") != FROZEN_CONTEXT_V2:
        raise ValueError("unsupported RQ2 frozen context")
    expected = dict(context)
    actual = expected.pop("context_fingerprint", None)
    if actual != canonical_sha256(expected):
        raise ValueError("RQ2 frozen context hash mismatch")
    for key in (
        "context_id",
        "design",
        "checkpoint",
        "state_stratum",
        "expected_behavior",
        "planning_context",
        "source_artifacts",
        "eligibility",
        *_V2_REQUIRED_HASHES,
    ):
        if not context.get(key):
            raise ValueError(f"RQ2 frozen context missing {key}")
    if context["state_stratum"] not in CONTEXT_STRATA:
        raise ValueError("RQ2 frozen context stratum is unknown")
    if context["eligibility"] not in {"eligible", "excluded"}:
        raise ValueError("RQ2 frozen context eligibility is unknown")
    if context["eligibility"] == "excluded" and not context.get("exclusion_reason"):
        raise ValueError("excluded RQ2 frozen context needs a typed reason")


def validate_rq2_context_bank(bank: Mapping[str, object]) -> None:
    if bank.get("schema_version") != RQ2_BANK_SCHEMA:
        raise ValueError("unsupported RQ2 context bank")
    design = bank.get("design")
    if design not in RQ2_DESIGNS:
        raise ValueError("RQ2 context bank design is outside the frozen cohort")
    contexts = bank.get("contexts") or []
    fingerprints: set[str] = set()
    for context in contexts:
        validate_rq2_frozen_context(context)
        if context["design"] != design:
            raise ValueError("RQ2 context bank mixes designs")
        fingerprint = str(context["context_fingerprint"])
        if fingerprint in fingerprints:
            raise ValueError("RQ2 context bank repeats a context fingerprint")
        fingerprints.add(fingerprint)


def upgrade_bank_contexts(
    v1_contexts: Sequence[Mapping[str, object]],
    *,
    design: str,
    checkpoint: str,
    source_artifacts: Sequence[str],
    toolchain_sha256: str,
    prompt_skeleton_sha256: str,
    state_rule_manifest_sha256: str,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Lift captured v1 stratum contexts into the RQ2 v2 contract.

    Hashes come from the capture itself; the trajectory snapshot hash covers
    the frozen history/feedback/stage-observation projection so treatment
    comparisons stay attributable to the knowledge layer alone.
    """
    contexts: list[dict[str, object]] = []
    excluded: list[dict[str, object]] = []
    present = {canonical_stratum(str(item.get("stratum"))) for item in v1_contexts}
    for stratum in CONTEXT_STRATA:
        if stratum not in present:
            excluded.append(
                {
                    "design": design,
                    "checkpoint": checkpoint,
                    "state_stratum": stratum,
                    "reason": f"stratum not derivable from the captured checkpoint (no {stratum} evidence compiled)",
                }
            )
    for item in v1_contexts:
        stratum = canonical_stratum(str(item["stratum"]))
        planning_context = item["planning_context"]
        trajectory_snapshot = {
            "parameter_trajectories": planning_context.get("parameter_trajectories", []),
            "planning_feedback": planning_context.get("planning_feedback", []),
            "stage_observations": planning_context.get("stage_observations", {}),
            "current_values": planning_context.get("current_values"),
        }
        contexts.append(
            build_rq2_frozen_context(
                {
                    "context_id": f"{design}-{checkpoint}-{stratum}",
                    "design": design,
                    "checkpoint": checkpoint,
                    "state_stratum": stratum,
                    "stage": item.get("stage"),
                    "expected_behavior": item["expected_behavior"],
                    "label_evidence": item.get("label_evidence"),
                    "objective_contract_sha256": item["objective_contract_sha256"],
                    "legal_actions_sha256": item["legal_domain_sha256"],
                    "trajectory_snapshot_sha256": canonical_sha256(trajectory_snapshot),
                    "knowledge_bundle_sha256": item["knowledge_bundle_sha256"],
                    "state_rule_manifest_sha256": state_rule_manifest_sha256,
                    "toolchain_sha256": toolchain_sha256,
                    "prompt_skeleton_sha256": prompt_skeleton_sha256,
                    "observation_sha256": item.get("observation_sha256"),
                    "source_episode_id": item.get("source_episode_id"),
                    "source_artifacts": list(source_artifacts),
                    "planning_context": planning_context,
                    "eligibility": "eligible",
                    "exclusion_reason": None,
                }
            )
        )
    return contexts, excluded


# ---------------------------------------------------------------------------
# Treatment projection
# ---------------------------------------------------------------------------


def rq2_treatment_projection(
    context: Mapping[str, object], *, treatment: str
) -> dict[str, object]:
    """Project one shared frozen context onto a treatment's planner input.

    Only the knowledge treatment projection moves: objective, legal actions,
    trajectory snapshot, toolchain, and budgets stay frozen.  The returned
    diff is hash-bound so G1 acceptance can replay the exact projection.
    """
    if treatment not in (*RQ2_TREATMENT_MODES, SAME_GATE_NO_SEMANTIC_GUIDANCE):
        raise ValueError(f"unknown RQ2 treatment: {treatment}")
    base = rebuild_planning_context(context["planning_context"])
    projected = (
        apply_same_gate_no_semantic_guidance(base)
        if treatment == SAME_GATE_NO_SEMANTIC_GUIDANCE
        else apply_treatment(base, agent_mode=RQ2_TREATMENT_MODES[treatment])
    )
    base_view = base.supported_action_view
    diff = {
        "treatment": treatment,
        "agent_mode": (
            "same_gate_no_semantic_guidance"
            if treatment == SAME_GATE_NO_SEMANTIC_GUIDANCE
            else RQ2_TREATMENT_MODES[treatment]
        ),
        "state_gated": treatment != "unconditioned-support-zero-shot",
        "knowledge_refs_count": len(projected.knowledge_refs),
        "knowledge_chunks_count": len(projected.knowledge_chunks),
        "supported_action_view_sha256": (
            projected.supported_action_view.view_sha256
            if projected.supported_action_view is not None
            else None
        ),
        "supported_action_count": (
            len(projected.supported_action_view.actions)
            if projected.supported_action_view is not None
            else 0
        ),
        "catalog_sha256": (
            projected.supported_action_view.catalog_sha256
            if projected.supported_action_view is not None
            else None
        ),
        "base_supported_action_view_sha256": (
            base_view.view_sha256 if base_view is not None else None
        ),
        "correctness_role": (
            "mechanism_only_sham"
            if treatment == SAME_GATE_NO_SEMANTIC_GUIDANCE
            else
            "mechanism_only"
            if treatment in MECHANISM_ONLY_TREATMENTS
            else "gate_scored"
        ),
    }
    return {
        "planning_context": projected,
        "treatment_diff": diff,
        "context_treatment_sha256": canonical_sha256(
            {
                "context_fingerprint": context["context_fingerprint"],
                "treatment_diff": diff,
            }
        ),
    }


def action_signature_levels(
    *,
    decision: str,
    action: Any,
    effective_domains: Sequence[Any],
) -> dict[str, object]:
    """Project one proposal onto the preregistered L0-L3 action levels."""
    error_status = decision in {"provider_error", "schema_error", "timeout"}
    outcome = (
        decision
        if decision in {"propose", "continue", "stop", "escalate"}
        else ("invalid" if decision == "schema_error" else decision)
    )
    if action is None or error_status:
        return {
            "L0": outcome,
            "L1": outcome,
            "L2": outcome,
            "L3": outcome,
            "evidence_status": "blocked" if error_status else "abstain",
        }
    knob = action.knob_id.value
    direction = action.direction.value
    family = knob.split(".", 1)[0]
    claim_bound = bool(
        action.claim_id
        and action.claim_sha256
        and action.binding_id
        and action.binding_sha256
    )
    return {
        "L0": outcome,
        "L1": f"propose:{family}",
        "L2": f"propose:{knob}:{direction}",
        "L3": f"propose:{knob}:{direction}:{_value_bucket(action, effective_domains)}",
        "evidence_status": "claim_bound" if claim_bound else "unbound",
    }


def _value_bucket(action: Any, effective_domains: Sequence[Any]) -> str:
    domain = next(
        (item for item in effective_domains if item.knob_id == action.knob_id),
        None,
    )
    value = action.requested_value
    if domain is None or not isinstance(value, (int, float)) or isinstance(value, bool):
        return str(value)
    bounds = domain.value_bounds
    low = getattr(bounds, "minimum", None)
    high = getattr(bounds, "maximum", None)
    if not isinstance(low, (int, float)) or not isinstance(high, (int, float)):
        return str(value)
    span = high - low
    if span <= 0:
        return str(value)
    position = (float(value) - float(low)) / float(span)
    if position <= 1.0 / 3.0:
        return "low"
    if position <= 2.0 / 3.0:
        return "mid"
    return "high"


# ---------------------------------------------------------------------------
# Adaptive controller
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AdaptiveConfig:
    model: str = "glm-5.3-flash"
    reasoning_effort: str = "medium"
    tau: float = MATERIAL_SHIFT_TAU
    cutoff: float = MATERIAL_PROBABILITY_CUTOFF
    concentration_threshold: float = CONCENTRATION_THRESHOLD
    levels: tuple[int, ...] = ADAPTIVE_LEVELS
    draws: int = POSTERIOR_DRAWS
    prior_alpha: float = RQ2_POSTERIOR_PRIOR_ALPHA


def _level_counts(rows: Sequence[Mapping[str, object]], treatment: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if row.get("treatment") == treatment:
            signature = row["levels"]["L1"]
            counts[str(signature)] = counts.get(str(signature), 0) + 1
    return counts


def adaptive_stopping_decision(
    counts_by_treatment: Mapping[str, Mapping[str, int]],
    *,
    config: AdaptiveConfig,
    context_fingerprint: str,
    level: int,
) -> dict[str, object]:
    """Decide whether a context group stops at this repeat level.

    The group stops when every treatment's L1 posterior is concentrated and
    every Dual-comparator pair's material-shift probability is resolved;
    otherwise it extends.  No majority vote ever replaces the posterior.
    """
    dual = "state-conditioned-dual-layer-zero-shot"
    concentrated: dict[str, bool] = {}
    lower_bounds: dict[str, float | None] = {}
    for treatment, counts in counts_by_treatment.items():
        seed = posterior_seed(context_fingerprint, treatment, "L1")
        summary = posterior_cell_metrics(
            counts,
            alpha=config.prior_alpha,
            draws=config.draws,
            seed=seed,
        )
        lower_bounds[treatment] = summary["top_action_lower_bound"]
        concentrated[treatment] = bool(
            summary["top_action_lower_bound"] is not None
            and float(summary["top_action_lower_bound"]) >= config.concentration_threshold
        )
    pairs: dict[str, object] = {}
    pairs_resolved = True
    for base, comparator in RQ2_PRIMARY_COMPARISONS:
        if base not in counts_by_treatment or comparator not in counts_by_treatment:
            continue
        result = material_shift_probability(
            counts_by_treatment[base],
            counts_by_treatment[comparator],
            tau=config.tau,
            alpha=config.prior_alpha,
            draws=config.draws,
            seed=posterior_seed(context_fingerprint, base, comparator),
        )
        pairs[f"{base}||{comparator}"] = result
        probability = result["probability"]
        if probability is None or not (
            float(probability) >= config.cutoff or float(probability) <= 1.0 - config.cutoff
        ):
            pairs_resolved = False
    errors = {
        treatment: sum(
            count
            for signature, count in counts.items()
            if _is_error_signature(signature)
        )
        for treatment, counts in counts_by_treatment.items()
    }
    provider_failure = any(
        errors[treatment] * 2 >= sum(counts_by_treatment[treatment].values())
        for treatment in counts_by_treatment
    )
    stop = all(concentrated.values()) and pairs_resolved
    reasons: dict[str, str] = {}
    for treatment in counts_by_treatment:
        if provider_failure and errors.get(treatment):
            reasons[treatment] = "provider_failure"
        elif concentrated[treatment]:
            reasons[treatment] = "concentrated"
        elif pairs_resolved:
            reasons[treatment] = "material_shift_resolved"
        elif level >= max(config.levels):
            reasons[treatment] = "uncertain"
        else:
            reasons[treatment] = "extend"
    return {
        "level": level,
        "stop": stop,
        "concentrated": concentrated,
        "top_action_lower_bounds": lower_bounds,
        "material_shift_pairs": pairs,
        "provider_error_counts": errors,
        "stopping_reasons": reasons,
    }


def _is_error_signature(signature: str) -> bool:
    return signature in {"provider_error", "schema_error", "timeout", "invalid"}
