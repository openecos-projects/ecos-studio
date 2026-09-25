"""Adaptive offline runner for the formal RQ2 knowledge experiment.

Executes the frozen-context behavior bank with the 3->5->7 adaptive repeat
schedule; provider errors, schema failures, and timeouts stay in the
denominator.  Protocol, projection, and posterior math live in
``rq2_knowledge_experiment`` / ``knowledge_metrics``.
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from typing import Any, Callable, Mapping, Sequence

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.knowledge_metrics import (
    RQ2_POSTERIOR_PRIOR_ALPHA,
    posterior_cell_metrics,
    posterior_seed,
)
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    MECHANISM_ONLY_TREATMENTS,
    OBSERVATION_SCHEMA,
    POSTERIOR_SCHEMA,
    ADAPTIVE_SAMPLE_SCHEMA,
    RQ2_TREATMENTS,
    AdaptiveConfig,
    action_signature_levels,
    adaptive_stopping_decision,
    _level_counts,
    rq2_treatment_projection,
)
from ecos_agent.optimization.parameters.contracts import OptimizationProposalV2


# ---------------------------------------------------------------------------
# Offline adaptive bank runner
# ---------------------------------------------------------------------------


def _provider_metadata(provider: Any) -> dict[str, object]:
    metadata: dict[str, object] = {
        "temperature": "unavailable",
        "top_p": "unavailable",
        "seed": "unavailable",
        "batch_or_slot": "unavailable",
    }
    try:
        settings = provider.get_model_settings()
        metadata.update(
            {
                "model": settings.get("model"),
                "reasoning_effort": settings.get("reasoningEffort"),
            }
        )
    except Exception:  # noqa: BLE001 - registration is best-effort
        metadata.update({"model": None, "reasoning_effort": None})
    return metadata


def _one_observation(
    provider: Any,
    *,
    context: Mapping[str, object],
    projected: Any,
    treatment: str,
    repeat: int,
    config: AdaptiveConfig,
    worker: str,
    metadata: Mapping[str, object],
) -> dict[str, object]:
    started = time.monotonic()
    row: dict[str, object] = {
        "schema_version": OBSERVATION_SCHEMA,
        "design": context["design"],
        "checkpoint": context["checkpoint"],
        "state_stratum": context["state_stratum"],
        "expected_behavior": context["expected_behavior"],
        "context_fingerprint": context["context_fingerprint"],
        "context_treatment_sha256": context.get("context_treatment_sha256"),
        "treatment": treatment,
        "repeat": repeat,
        "worker": worker,
        "provider_metadata": dict(metadata),
        "schema_status": "valid",
        "invalid_reason": None,
        "claim_ids": [],
        "binding_ids": [],
    }
    try:
        from ecos_agent.optimization.planning import v2_domains

        raw = provider.propose_v2(projected, v2_domains(projected))
        row["request_id"] = raw.get("id") or f"local-{uuid.uuid4()}"
        row["raw_response_sha256"] = canonical_sha256(raw)
        proposal = OptimizationProposalV2.model_validate(raw)
    except ValidationError as exc:
        row.update(
            schema_status="invalid",
            invalid_reason=f"schema_error: {str(exc)[:400]}",
            levels=action_signature_levels(
                decision="schema_error", action=None, effective_domains=()
            ),
            request_id=f"local-{uuid.uuid4()}",
            wall_seconds=time.monotonic() - started,
        )
        return row
    except Exception as exc:  # transport failures stay in the denominator
        text = str(exc).lower()
        status = "timeout" if "timeout" in text or "timed out" in text else "provider_error"
        row.update(
            schema_status=status,
            invalid_reason=f"{status}: {str(exc)[:400]}",
            levels=action_signature_levels(
                decision=status, action=None, effective_domains=()
            ),
            request_id=f"local-{uuid.uuid4()}",
            wall_seconds=time.monotonic() - started,
        )
        return row
    action = proposal.action
    row["levels"] = action_signature_levels(
        decision=proposal.decision,
        action=action,
        effective_domains=projected.effective_domains,
    )
    row["action_signature"] = {
        "outcome": row["levels"]["L0"],
        "action_family": row["levels"]["L1"],
        "knob": action.knob_id.value if action else None,
        "direction": action.direction.value if action else None,
        "value_bucket": row["levels"]["L3"].rsplit(":", 1)[-1] if action else None,
        "evidence_status": row["levels"]["evidence_status"],
    }
    if action is not None:
        row["claim_ids"] = [action.claim_id] if action.claim_id else []
        row["binding_ids"] = [action.binding_id] if action.binding_id else []
        row["requested_value"] = action.requested_value
        row["expected_effects"] = [
            effect.model_dump(mode="json") for effect in action.expected_effects
        ]
    row["decision"] = proposal.decision
    row["rationale_summary"] = proposal.rationale_summary
    row["wall_seconds"] = time.monotonic() - started
    return row


def _cell_posterior(
    rows: Sequence[Mapping[str, object]],
    *,
    treatment: str,
    context_fingerprint: str,
    stopping_reason: str,
    repeats_used: int,
    config: AdaptiveConfig,
) -> dict[str, object]:
    treatment_rows = [
        row for row in rows if row.get("treatment") == treatment
    ]
    levels: dict[str, object] = {}
    for level in ("L0", "L1", "L2", "L3"):
        counts: dict[str, int] = {}
        for row in treatment_rows:
            signature = str(row["levels"][level])
            counts[signature] = counts.get(signature, 0) + 1
        levels[level] = posterior_cell_metrics(
            counts,
            alpha=config.prior_alpha,
            draws=config.draws,
            seed=posterior_seed(context_fingerprint, treatment, level),
        )
    status_counts: dict[str, int] = {}
    for row in treatment_rows:
        status = str(row.get("schema_status"))
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "schema_version": POSTERIOR_SCHEMA,
        "context_fingerprint": context_fingerprint,
        "treatment": treatment,
        "correctness_role": (
            "mechanism_only"
            if treatment in MECHANISM_ONLY_TREATMENTS
            else "gate_scored"
        ),
        "adaptive_repeats_used": repeats_used,
        "stopping_reason": stopping_reason,
        "observation_counts": status_counts,
        "levels": levels,
        "counts_L1": levels["L1"]["posterior_action_mass"],
    }


def run_rq2_adaptive_group(
    provider: Any,
    context: Mapping[str, object],
    *,
    treatments: Sequence[str] = RQ2_TREATMENTS,
    config: AdaptiveConfig,
    worker: str = "0/1",
) -> dict[str, object]:
    """Run one context group through the adaptive 3->5->7 schedule."""
    projections = {
        treatment: rq2_treatment_projection(context, treatment=treatment)
        for treatment in treatments
    }
    context = {
        **context,
        "context_treatment_sha256": {
            treatment: projections[treatment]["context_treatment_sha256"]
            for treatment in treatments
        },
    }
    metadata = _provider_metadata(provider)
    rows: list[dict[str, object]] = []
    samples: list[dict[str, object]] = []
    final_reasons: dict[str, str] = {t: "not_run" for t in treatments}
    repeats_used = 0
    for level in config.levels:
        needed = level - repeats_used
        for treatment in treatments:
            for repeat in range(repeats_used + 1, level + 1):
                rows.append(
                    _one_observation(
                        provider,
                        context=context,
                        projected=projections[treatment]["planning_context"],
                        treatment=treatment,
                        repeat=repeat,
                        config=config,
                        worker=worker,
                        metadata=metadata,
                    )
                )
        repeats_used = level
        counts = {treatment: _level_counts(rows, treatment) for treatment in treatments}
        decision = adaptive_stopping_decision(
            counts,
            config=config,
            context_fingerprint=str(context["context_fingerprint"]),
            level=level,
        )
        samples.append(
            {
                "schema_version": ADAPTIVE_SAMPLE_SCHEMA,
                "context_fingerprint": context["context_fingerprint"],
                "design": context["design"],
                "checkpoint": context["checkpoint"],
                "state_stratum": context["state_stratum"],
                "level": level,
                "decision": decision,
            }
        )
        final_reasons = decision["stopping_reasons"]
        if decision["stop"]:
            break
    posteriors = [
        _cell_posterior(
            rows,
            treatment=treatment,
            context_fingerprint=str(context["context_fingerprint"]),
            stopping_reason=final_reasons.get(treatment, "uncertain"),
            repeats_used=repeats_used,
            config=config,
        )
        for treatment in treatments
    ]
    return {
        "context_fingerprint": context["context_fingerprint"],
        "rows": rows,
        "samples": samples,
        "posteriors": posteriors,
        "treatment_diffs": {
            treatment: projections[treatment]["treatment_diff"]
            for treatment in treatments
        },
        "repeats_used": repeats_used,
    }


def run_rq2_adaptive_bank(
    contexts: Sequence[Mapping[str, object]],
    *,
    provider_factory: Callable[[], Any],
    treatments: Sequence[str] = RQ2_TREATMENTS,
    config: AdaptiveConfig,
    worker: str = "0/1",
    on_group: Callable[[Mapping[str, object]], None] | None = None,
) -> dict[str, object]:
    """Run every eligible context group; failures stay in the denominator."""
    provider = provider_factory()
    provider.select_model(config.model)
    if hasattr(provider, "set_model_settings"):
        provider.set_model_settings(reasoning_effort=config.reasoning_effort)
    metadata = _provider_metadata(provider)
    if metadata.get("model") != config.model:
        provider.close()
        raise ValueError(
            f"provider model drift: {metadata.get('model')} != {config.model}"
        )
    groups = []
    try:
        for context in contexts:
            if context.get("eligibility") != "eligible":
                continue
            group = run_rq2_adaptive_group(
                provider,
                context,
                treatments=treatments,
                config=config,
                worker=worker,
            )
            groups.append(group)
            if on_group is not None:
                on_group(group)
    finally:
        provider.close()
    return {
        "schema_version": "ecos.rq2_adaptive_bank_run.v1",
        "worker": worker,
        "model_metadata": metadata,
        "groups": len(groups),
        "contexts": len(contexts),
    }


def main(argv: list[str] | None = None, provider_factory: Callable[[], Any] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--model", default="glm-5.3-flash")
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--min-repeats", type=int, default=3)
    parser.add_argument("--max-repeats", type=int, default=7)
    args = parser.parse_args(argv)
    bank = json.loads(args.bank.read_text(encoding="utf-8"))
    if provider_factory is None:
        parser.error("adaptive bank requires a configured provider factory")
    levels = tuple(
        level
        for level in ADAPTIVE_LEVELS
        if args.min_repeats <= level <= args.max_repeats
    )
    config = AdaptiveConfig(
        model=args.model,
        reasoning_effort=args.reasoning_effort,
        levels=levels or ADAPTIVE_LEVELS,
    )
    summary = run_rq2_adaptive_bank(
        bank["contexts"],
        provider_factory=provider_factory,
        config=config,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
