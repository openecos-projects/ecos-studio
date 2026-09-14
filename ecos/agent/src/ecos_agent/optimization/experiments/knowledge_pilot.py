"""Offline knowledge pilot: frozen contexts, treatments, proposal mediation.

The pilot reuses the native planning surface (`propose_v2`) against hash-bound
frozen contexts, so a proposal difference is attributable to the treatment's
knowledge payload alone. No candidate is executed here.
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    KnowledgeReference,
    LegalAction,
    ObservationReference,
    OptimizationObjectiveContract,
    OptimizationOutcomeKind,
    ProposalAction,
    ProposalContextRef,
    RequestedKnobValue,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization.reflection import PlanningFeedbackEntry
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.experiments.frozen_contexts import (
    build_frozen_context,
    validate_context_bank,
)
from ecos_agent.optimization.experiments.knowledge_mediation import (
    audit_planning_calls,
    missing_evidence_reason_counts,
    read_jsonl,
    summarize_planning_audit,
)
from ecos_agent.optimization.experiments.knowledge_metrics import (
    build_feedback_ledger,
    offline_gate,
    summarize_mediation,
    summarize_offline_rows,
)
from ecos_agent.optimization.experiments.knowledge_protocol import (
    validate_design_ids,
    validate_protocol_manifest,
)
from ecos_agent.optimization.experiments.knowledge_treatments import (
    ZERO_SHOT_GATE_TREATMENTS,
)
from ecos_agent.optimization.experiments.closed_loop_driver import load_design
from ecos_agent.optimization.knowledge.compiler import (
    KnowledgeSupportCatalog,
    OptimizationStateEvidenceRequest,
    StateEvidenceFeature,
    SupportedActionView,
    compile_supported_action_view,
    load_state_rule_manifest,
)
from ecos_agent.optimization.objective_alignment import (
    ActiveOptimizationObjective,
    OptimizationObjectiveAlignment,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.planning import (
    OptimizationHistory,
    OptimizationPlanningContext,
    v2_domains,
)

ROW_SCHEMA_VERSION = "ecos.knowledge_offline_row.v1"
_CAPTURE_HASH = "sha256:" + "0" * 64


class _ContextCaptureProvider:
    """Records the native planning context without calling a model.

    The proposal is always ``continue``: the capture turn consumes one
    planning call, executes nothing, and yields the exact typed context the
    native controller would hand the planner.
    """

    def __init__(self) -> None:
        self.captured: list[OptimizationPlanningContext] = []

    def select_model(self, model: str) -> None:
        return None

    def close(self) -> None:
        return None

    def propose_v2(self, context, domains):
        self.captured.append(context)
        return {
            "schema_version": "ecos.optimization_proposal.v3",
            "context_ref": context.context_ref.model_dump(mode="json"),
            "decision": "continue",
            "reason_code": "bank_capture",
            "rationale_summary": "frozen context bank capture turn",
            "observation_refs": [context.observation_ref.model_dump(mode="json")],
        }


def freeze_planning_context(context: OptimizationPlanningContext) -> dict[str, object]:
    """Serialize the typed planning context for a frozen bank record."""
    data: dict[str, object] = {
        "context_ref": context.context_ref.model_dump(mode="json"),
        "observation_ref": context.observation_ref.model_dump(mode="json"),
        "observation": (
            context.observation.model_dump(mode="json")
            if context.observation is not None
            else None
        ),
        "incumbent": (
            context.incumbent.model_dump(mode="json")
            if context.incumbent is not None
            else None
        ),
        "knowledge_refs": [
            item.model_dump(mode="json") for item in context.knowledge_refs
        ],
        "knowledge_chunks": list(context.knowledge_chunks),
        "budget": (
            context.budget.model_dump(mode="json") if context.budget is not None else None
        ),
        "current_values": (
            dict(sorted(context.current_values.items()))
            if context.current_values is not None
            else None
        ),
        "legal_actions": [
            item.model_dump(mode="json") for item in context.legal_actions
        ],
        "objective": (
            context.objective.model_dump(mode="json")
            if context.objective is not None
            else None
        ),
        "objective_alignment": (
            context.objective_alignment.model_dump(mode="json")
            if context.objective_alignment is not None
            else None
        ),
        "active_objective": (
            context.active_objective.model_dump(mode="json")
            if context.active_objective is not None
            else None
        ),
        "effective_domains": [
            item.model_dump(mode="json") for item in context.effective_domains
        ],
        "supported_action_view": (
            context.supported_action_view.model_dump(mode="json")
            if context.supported_action_view is not None
            else None
        ),
        "parameter_knowledge": [
            item.model_dump(mode="json") for item in context.parameter_knowledge
        ],
        "parameter_trajectories": [
            _freeze_history(item) for item in context.parameter_trajectories
        ],
        "planning_feedback": [
            entry.model_dump(mode="json") for entry in context.planning_feedback
        ],
        "active_strategy": context.active_strategy,
        "stage_observations": {
            stage: observation.model_dump(mode="json")
            for stage, observation in sorted(
                (context.stage_observations or {}).items()
            )
        },
        "parent_config_sha256": context.parent_config_sha256,
        "parameter_policy": (
            dict(sorted(context.parameter_policy.items()))
            if context.parameter_policy is not None
            else None
        ),
    }
    return {key: value for key, value in data.items() if value is not None}


def rebuild_planning_context(data: Mapping[str, object]) -> OptimizationPlanningContext:
    """Rebuild the typed planning context; fail closed on missing anchors."""
    missing = [
        key
        for key in ("context_ref", "observation_ref", "legal_actions", "effective_domains")
        if not data.get(key)
    ]
    if missing:
        raise ValueError(f"frozen planning context missing {sorted(missing)}")
    trajectories = tuple(
        _rebuild_history(item) for item in data.get("parameter_trajectories", ())
    )
    stage_observations = {
        stage: StageObservation.model_validate(item)
        for stage, item in (data.get("stage_observations") or {}).items()
    }
    return OptimizationPlanningContext(
        context_ref=ProposalContextRef.model_validate(data["context_ref"]),
        observation_ref=ObservationReference.model_validate(data["observation_ref"]),
        observation=_optional(StageObservation, data, "observation"),
        incumbent=_optional(TerminalObservation, data, "incumbent"),
        history=trajectories,
        knowledge_refs=tuple(
            KnowledgeReference.model_validate(item)
            for item in data.get("knowledge_refs", ())
        ),
        knowledge_chunks=tuple(data.get("knowledge_chunks", ())),
        budget=_optional(BudgetSnapshot, data, "budget"),
        current_values=data.get("current_values"),
        legal_actions=tuple(
            LegalAction.model_validate(item) for item in data["legal_actions"]
        ),
        objective=_optional(OptimizationObjectiveContract, data, "objective"),
        objective_alignment=_optional(
            OptimizationObjectiveAlignment, data, "objective_alignment"
        ),
        active_objective=_optional(ActiveOptimizationObjective, data, "active_objective"),
        effective_domains=tuple(
            EffectiveDomainSnapshot.model_validate(item)
            for item in data["effective_domains"]
        ),
        supported_action_view=_optional(SupportedActionView, data, "supported_action_view"),
        parameter_knowledge=tuple(
            ParameterSemanticsCard.model_validate(item)
            for item in data.get("parameter_knowledge", ())
        ),
        parameter_trajectories=trajectories,
        planning_feedback=tuple(
            PlanningFeedbackEntry.model_validate(item)
            for item in data.get("planning_feedback", ())
        ),
        active_strategy=data.get("active_strategy"),
        stage_observations=stage_observations or None,
        parent_config_sha256=data.get("parent_config_sha256"),
        parameter_policy=data.get("parameter_policy"),
    )


def apply_treatment(
    context: OptimizationPlanningContext, *, agent_mode: str
) -> OptimizationPlanningContext:
    """Derive the treatment's planner input from the frozen dual-layer context."""
    if agent_mode == "llm_no_knowledge":
        return replace(
            context,
            knowledge_refs=(),
            knowledge_chunks=(),
            supported_action_view=None,
        )
    if agent_mode == "raw_rag":
        return replace(context, supported_action_view=None)
    if agent_mode == "full_agent":
        return context
    raise ValueError(f"offline pilot treatment agent mode is invalid: {agent_mode}")


def derive_bank_contexts(
    *,
    captured: OptimizationPlanningContext,
    catalog: KnowledgeSupportCatalog,
    candidate_refs: tuple,
    design_id: str,
    episode_id: str,
) -> list[dict[str, object]]:
    """Derive the frozen strata variants from one native captured context.

    Every variant keeps the captured observation, legal actions, effective
    domains, and objective frozen; only the knowledge layer mutates, so an
    offline proposal difference is attributable to knowledge support alone.
    """
    view = captured.supported_action_view
    if view is None:
        raise ValueError("bank capture requires a dual-layer supported action view")
    state = view.state
    legal = captured.legal_actions
    domains = captured.effective_domains
    claims = {
        (claim.claim_ref.entity_id, claim.claim_ref.chunk_sha256): claim
        for claim in catalog.claims
    }
    candidate_claims = [
        claims[(reference.entity_id, reference.chunk_sha256)]
        for reference in candidate_refs
        if (reference.entity_id, reference.chunk_sha256) in claims
    ]

    def _recompile(extra_features=(), *, bindings=None, candidates=None, drop=()):
        merged_state = _state_with_features(state, extra_features, drop)
        used_catalog = (
            KnowledgeSupportCatalog(
                catalog_sha256=catalog.catalog_sha256,
                claims=catalog.claims,
                bindings=bindings,
            )
            if bindings is not None
            else catalog
        )
        used_candidates = candidate_refs if candidates is None else candidates
        used_keys = {(item.entity_id, item.chunk_sha256) for item in used_candidates}
        return compile_supported_action_view(
            state=merged_state,
            catalog=used_catalog,
            candidate_refs=used_candidates,
            retrieval_ranked_refs=tuple(
                ref
                for ref in view.retrieval_ranked_refs
                if (ref.entity_id, ref.chunk_sha256) in used_keys
            ),
            legal_actions=legal,
            effective_domains=domains,
        )

    def _label(stratum, expected, variant_view, evidence):
        variant_context = replace(captured, supported_action_view=variant_view)
        return build_frozen_context(
            {
                "design_id": design_id,
                "source_episode_id": episode_id,
                "stage": state.current_stage.value,
                "observation_sha256": captured.observation_ref.sha256,
                "objective_contract_sha256": (
                    captured.objective.contract_sha256
                    if captured.objective is not None
                    else captured.context_ref.input_sha256
                ),
                "knowledge_bundle_sha256": catalog.catalog_sha256,
                "legal_domain_sha256": canonical_sha256(
                    {
                        "legal_actions": [
                            item.model_dump(mode="json") for item in legal
                        ],
                        "effective_domains": [
                            item.model_dump(mode="json") for item in domains
                        ],
                    }
                ),
                "stratum": stratum,
                "expected_behavior": expected,
                "label_evidence": evidence,
                "planning_context": freeze_planning_context(variant_context),
            }
        )

    contexts = []
    knowledge_view = _recompile()
    has_actions = bool(knowledge_view.actions)
    contexts.append(
        _label(
            "knowledge_opportunity",
            "action" if has_actions else "abstain",
            knowledge_view,
            (
                f"actions={len(knowledge_view.actions)}"
                f" applicability={knowledge_view.actions[0].applicability.value}"
                if has_actions
                else "no supported action compiled"
            ),
        )
    )

    stale_bindings = tuple(
        binding.model_copy(update={"claim_sha256": _CAPTURE_HASH})
        for binding in catalog.bindings
    )
    stale_view = _recompile(bindings=stale_bindings)
    stale_evidence = _match_evidence(stale_view, "stale_binding")
    if stale_evidence:
        contexts.append(
            _label("stale_binding", "block_reject", stale_view, stale_evidence)
        )

    anti_pairs = [
        (reference, claims[(reference.entity_id, reference.chunk_sha256)])
        for reference in candidate_refs
        if (reference.entity_id, reference.chunk_sha256) in claims
        and claims[(reference.entity_id, reference.chunk_sha256)].anti_predicates
    ]
    if anti_pairs:
        anti_features = [
            StateEvidenceFeature(
                feature_id=predicate.feature_id,
                value=_anti_hit_value(predicate.op),
                evidence_sha256=_CAPTURE_HASH,
            )
            for _, claim in anti_pairs
            for predicate in claim.anti_predicates
        ]
        # The stratum means "every visible knowledge claim is anti-blocked",
        # so the candidates narrow to the anti-carrying claims; claims with
        # no anti predicate cannot represent this situation.
        anti_refs = tuple(reference for reference, _ in anti_pairs)
        anti_view = _recompile(
            extra_features=anti_features, candidates=anti_refs
        )
        anti_evidence = _match_evidence(anti_view, "anti_condition")
        if anti_evidence and not anti_view.actions:
            contexts.append(
                _label("anti_condition", "block_reject", anti_view, anti_evidence)
            )

    required_ids = {
        predicate.feature_id
        for claim in candidate_claims
        for predicate in claim.state_predicates
        if predicate.required
    }
    if required_ids:
        missing_view = _recompile(drop=required_ids)
        missing_evidence = _match_evidence(missing_view, "missing_observation")
        if missing_evidence:
            contexts.append(
                _label(
                    "missing_required_evidence",
                    "unknown",
                    missing_view,
                    missing_evidence,
                )
            )

    empty_view = _recompile(candidates=())
    contexts.append(
        _label("no_supported_action", "abstain", empty_view, "no candidate claims")
    )
    return contexts


def _anti_hit_value(op: str):
    """The feature value that triggers an anti predicate of this op."""
    hits = {
        "present": True,
        "true": True,
        "false": False,
        "positive": 1.0,
        "zero": 0.0,
        "negative": -1.0,
    }
    if op in hits:
        return hits[op]
    if op in {"increasing", "decreasing", "stable"}:
        return op
    raise ValueError(f"anti predicate op cannot be triggered: {op}")


def _match_evidence(view, reason: str) -> str:
    for match in view.matches:
        if reason in match.reason_codes:
            return (
                f"applicability={match.applicability.value}"
                f" reasons={','.join(match.reason_codes)}"
            )
    return ""


def _state_with_features(state, extra_features=(), drop_feature_ids=frozenset()):
    merged: dict[str, StateEvidenceFeature] = {
        item.feature_id: item for item in state.features
    }
    for feature in extra_features:
        merged.setdefault(feature.feature_id, feature)
    for feature_id in drop_feature_ids:
        merged.pop(feature_id, None)
    data = state.model_dump(mode="json")
    data["features"] = [merged[key].model_dump(mode="json") for key in sorted(merged)]
    return OptimizationStateEvidenceRequest.model_validate(data)


def build_context_bank(
    *,
    workspace: Path,
    design_id: str,
    episode_id: str,
) -> list[dict[str, object]]:
    """Capture one native planning turn and freeze its strata contexts."""
    from ecos_agent.optimization.experiments.knowledge_treatment_runner import (
        _objective,
    )
    from ecos_agent.optimization.knowledge.retrieval import (
        OptimizationKnowledgeRetriever,
        build_optimization_retrieval_request,
    )
    from ecos_agent.optimization.objective_alignment import build_objective_alignment
    from ecos_agent.optimization.observations import build_terminal_observation
    from ecos_agent.optimization.runtime import create_optimization_runner

    objective = _objective()
    terminal = build_terminal_observation(workspace)
    alignment = build_objective_alignment(objective, terminal)
    capture = _ContextCaptureProvider()
    runner = create_optimization_runner(
        {
            "workspace": str(workspace),
            "episode_id": episode_id,
            "objective": objective.model_dump(mode="json"),
            "objective_alignment": alignment.model_dump(mode="json"),
            "seed": 0,
            "receipt_aware_planning": True,
            "agent_mode": "full_agent",
            "knowledge_case_shots": 0,
        },
        capture,
    )
    try:
        runner.run_turn()
    finally:
        runner.close()
    if not capture.captured:
        raise ValueError("bank capture produced no planning context")
    captured = capture.captured[-1]
    retriever = OptimizationKnowledgeRetriever()
    request = build_optimization_retrieval_request(
        task_id=episode_id,
        observation=captured.observation,
        previous_intervention_outcome=None,
        primary_metric=objective.primary_metric,
        preserve_metrics=objective.preserve_metrics,
    )
    retrieval = retriever.retrieve(request)
    return derive_bank_contexts(
        captured=captured,
        catalog=retrieval.support_catalog,
        candidate_refs=retrieval.candidate_refs,
        design_id=design_id,
        episode_id=episode_id,
    )


def run_offline_pilot(
    *,
    design_id: str,
    contexts: Sequence[Mapping[str, object]],
    provider_factory: Callable[[], Any],
    model: str | None = None,
    repeats: int = 1,
    planning_call_limit: int = 60,
    protocol: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Run every zero-shot treatment over the bank and mediate the proposals."""
    validate_context_bank(contexts, design_id=design_id)
    if protocol is not None:
        validate_protocol_manifest(protocol)
    if repeats < 1:
        raise ValueError("offline pilot repeats must be at least one")
    provider = provider_factory()
    if model is not None:
        provider.select_model(model)
    ordered = sorted(contexts, key=lambda item: str(item["context_fingerprint"]))
    cells = [
        (context, config.treatment.value, repeat, variant)
        for context in ordered
        for config in ZERO_SHOT_GATE_TREATMENTS
        for repeat in range(1, repeats + 1)
        for variant in [apply_treatment(
            rebuild_planning_context(context["planning_context"]),
            agent_mode=config.agent_mode,
        )]
    ]
    rows: list[dict[str, object]] = []
    planning_calls = 0
    consecutive_failures = 0
    try:
        for context, treatment, repeat, variant in cells:
            if planning_calls >= planning_call_limit or consecutive_failures >= 3:
                # A tripped budget or a wedged provider (each failed cell
                # burns a full RPC timeout) leaves the remaining cells in the
                # denominator as not_started instead of dropping them.
                rows.append(
                    {
                        "schema_version": ROW_SCHEMA_VERSION,
                        "design_id": design_id,
                        "context_fingerprint": context["context_fingerprint"],
                        "stratum": context["stratum"],
                        "expected_behavior": context["expected_behavior"],
                        "treatment": treatment,
                        "repeat": repeat,
                        "planning_call": planning_calls,
                        "decision": "not_started",
                        "observed_behavior": "not_started",
                        "claim_bound": False,
                        "support_status": "no_action",
                        "correct": None,
                    }
                )
                continue
            row = _run_cell(
                provider=provider,
                design_id=design_id,
                context=context,
                variant=variant,
                treatment=treatment,
                repeat=repeat,
                planning_call=planning_calls,
                planning_call_limit=planning_call_limit,
            )
            rows.append(row)
            planning_calls += 1
            if row["decision"] in {"provider_error", "schema_error"}:
                consecutive_failures += 1
            else:
                consecutive_failures = 0
    finally:
        provider.close()
    return _offline_payload(
        design_id=design_id,
        contexts=contexts,
        rows=rows,
        protocol_hash=(protocol or {}).get("protocol_hash"),
    )


def _run_cell(
    *,
    provider: Any,
    design_id: str,
    context: Mapping[str, object],
    variant: OptimizationPlanningContext,
    treatment: str,
    repeat: int,
    planning_call: int,
    planning_call_limit: int,
) -> dict[str, object]:
    row: dict[str, object] = {
        "schema_version": ROW_SCHEMA_VERSION,
        "design_id": design_id,
        "context_fingerprint": context["context_fingerprint"],
        "stratum": context["stratum"],
        "expected_behavior": context["expected_behavior"],
        "treatment": treatment,
        "repeat": repeat,
        "planning_call": planning_call,
    }
    if planning_call >= planning_call_limit:
        row.update(
            decision="not_started",
            observed_behavior="not_started",
            claim_bound=False,
            support_status="no_action",
            correct=None,
        )
        return row
    try:
        raw = provider.propose_v2(variant, v2_domains(variant))
        proposal = OptimizationProposalV2.model_validate(raw)
    except ValidationError as exc:
        row.update(
            decision="schema_error",
            observed_behavior="error",
            rejection_reason=str(exc)[:400],
            claim_bound=False,
            support_status="no_action",
            correct=None,
        )
        return row
    except Exception as exc:  # provider transport failures stay in the denominator
        row.update(
            decision="provider_error",
            observed_behavior="error",
            rejection_reason=str(exc)[:400],
            claim_bound=False,
            support_status="no_action",
            correct=None,
        )
        return row
    action = proposal.action
    claim_bound = bool(
        action
        and action.claim_id
        and action.claim_sha256
        and action.binding_id
        and action.binding_sha256
    )
    row.update(
        decision=proposal.decision,
        observed_behavior="propose" if proposal.decision == "propose" else "abstain",
        knob=action.knob_id.value if action else None,
        direction=action.direction.value if action else None,
        requested_value=action.requested_value if action else None,
        claim_id=action.claim_id if action else None,
        claim_sha256=action.claim_sha256 if action else None,
        binding_id=action.binding_id if action else None,
        binding_sha256=action.binding_sha256 if action else None,
        claim_bound=claim_bound,
        support_status=_support_status(variant.supported_action_view, action),
        correct=_label_correct(
            str(context["expected_behavior"]), proposal.decision, claim_bound
        ),
        rationale_summary=proposal.rationale_summary,
    )
    return row


def _support_status(view: SupportedActionView | None, action: object) -> str:
    if action is None:
        return "no_action"
    if view is None:
        return "no_view"
    for item in view.actions:
        if item.knob_id == action.knob_id and item.direction == action.direction:
            return item.applicability.value
    return "blocked"


def _label_correct(expected: str, decision: str, claim_bound: bool) -> bool:
    proposed = decision == "propose"
    if expected == "action":
        return proposed
    if expected == "abstain":
        return not proposed
    if expected == "block_reject":
        return not proposed and not claim_bound
    if expected == "unknown":
        return not proposed or not claim_bound
    raise ValueError(f"unknown expected behavior label: {expected}")


def _offline_payload(
    *,
    design_id: str,
    contexts: Sequence[Mapping[str, object]],
    rows: list[dict[str, object]],
    protocol_hash: str | None = None,
) -> dict[str, object]:
    summary = summarize_offline_rows(rows)
    payload = {
        "schema_version": "ecos.knowledge_offline_pilot.v1",
        "design_ids": [design_id],
        "contexts": len(contexts),
        "summary": summary,
        "gate": offline_gate(summary, rows, contexts, design_id=design_id),
        "rows": rows,
    }
    if protocol_hash is not None:
        payload["protocol_hash"] = protocol_hash
    return payload


def _optional(model_cls: type, data: Mapping[str, object], key: str):
    value = data.get(key)
    return model_cls.model_validate(value) if value is not None else None


def _freeze_history(item: OptimizationHistory) -> dict[str, object]:
    return {
        "reference": item.reference.model_dump(mode="json"),
        "outcome": item.outcome.value,
        "action": item.action.model_dump(mode="json"),
        "requested": item.requested.model_dump(mode="json"),
        "terminal_observation": (
            item.terminal_observation.model_dump(mode="json")
            if item.terminal_observation is not None
            else None
        ),
        "parameter_application_receipt": (
            item.parameter_application_receipt.model_dump(mode="json")
            if item.parameter_application_receipt is not None
            else None
        ),
        "rationale_summary": item.rationale_summary,
        "planning_values": (
            dict(item.planning_values) if item.planning_values is not None else None
        ),
        "incumbent_decision": item.incumbent_decision,
        "decisive_metric": item.decisive_metric,
        "recovery_transition": item.recovery_transition,
        "layer_signal": item.layer_signal,
    }


def _rebuild_history(item: Mapping[str, object]) -> OptimizationHistory:
    return OptimizationHistory(
        reference=_required(item, "reference"),
        outcome=OptimizationOutcomeKind(str(item["outcome"])),
        action=_required(item, "action"),
        requested=_required(item, "requested"),
        terminal_observation=_optional(TerminalObservation, item, "terminal_observation"),
        parameter_application_receipt=_optional(
            ParameterApplicationReceipt, item, "parameter_application_receipt"
        ),
        rationale_summary=item.get("rationale_summary"),
        planning_values=item.get("planning_values"),
        incumbent_decision=item.get("incumbent_decision"),
        decisive_metric=item.get("decisive_metric"),
        recovery_transition=item.get("recovery_transition"),
        layer_signal=item.get("layer_signal"),
    )


def _required(item: Mapping[str, object], key: str):
    value = item.get(key)
    if value is None:
        raise ValueError(f"frozen history record missing {key}")
    return value


def main(argv: list[str] | None = None, provider_factory: Callable[[], Any] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("preflight", "audit"):
        item = sub.add_parser(command)
        item.add_argument("--design", nargs="+", required=True)
        item.add_argument("--mediation", type=Path)
        item.add_argument("--output", type=Path)
        if command == "preflight":
            item.add_argument("--effective-manifest", type=Path)
            item.add_argument("--run-manifest", type=Path)
    offline = sub.add_parser("offline")
    offline.add_argument("--design", required=True)
    offline.add_argument("--contexts", type=Path, required=True)
    offline.add_argument("--model")
    offline.add_argument("--repeats", type=int, default=1)
    offline.add_argument("--planning-call-limit", type=int, default=60)
    offline.add_argument("--protocol", type=Path)
    offline.add_argument("--output", type=Path)
    bank = sub.add_parser("bank")
    bank.add_argument("--design", required=True)
    bank.add_argument("--workspace", type=Path, required=True)
    bank.add_argument("--episode-id", default=None)
    bank.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    designs = validate_design_ids(
        [args.design] if isinstance(args.design, str) else args.design
    )
    if args.command == "preflight":
        manifest = load_state_rule_manifest()
        designs_root = Path(__file__).resolve().parents[4] / "experiments" / "designs"
        design_checks = {}
        for design_id in designs:
            design = load_design(designs_root, design_id)
            design_checks[design_id] = {
                "top_module": design.top_module,
                "clock_name": design.clock_name,
                "filelist": str(design.filelist),
                "sdc": str(design.sdc),
                "rtl_count": len(design.rtl_list),
            }
        payload = {
            "schema_version": "ecos.knowledge_pilot_preflight.v1",
            "design_ids": list(designs),
            "cohort_role": "pilot_only",
            "state_rule_manifest_sha256": manifest.manifest_sha256,
            "trend_noise_tolerance": manifest.trend_noise_tolerance,
            "design_checks": design_checks,
        }
        if args.effective_manifest:
            effective = json.loads(args.effective_manifest.read_text(encoding="utf-8"))
            pdk_root = effective.get("pdk_root")
            payload["environment_checks"] = {"effective_manifest": str(args.effective_manifest), "pdk_root": pdk_root, "pdk_root_exists": bool(pdk_root and Path(pdk_root).is_dir())}
        if args.run_manifest:
            run = json.loads(args.run_manifest.read_text(encoding="utf-8"))
            payload.setdefault("environment_checks", {})["run_manifest"] = {k: run.get(k) for k in ("ecc_revision", "pdk_revision", "seed")}
    elif args.command == "bank":
        designs = validate_design_ids([args.design])
        episode_id = args.episode_id or (
            f"bank-capture-{__import__('time').strftime('%Y%m%dT%H%M%S', time.gmtime())}-{args.design}"
        )
        contexts = build_context_bank(
            workspace=args.workspace.resolve(),
            design_id=designs[0],
            episode_id=episode_id,
        )
        payload = {
            "schema_version": "ecos.knowledge_context_bank.v1",
            "episode_id": episode_id,
            "state_rule_manifest_sha256": load_state_rule_manifest().manifest_sha256,
            "contexts": contexts,
        }
    elif args.command == "offline":
        if provider_factory is None:
            parser.error("offline requires a configured proposal provider factory")
        contexts = json.loads(args.contexts.read_text(encoding="utf-8"))
        if not isinstance(contexts, list):
            parser.error("contexts must be a JSON array")
        protocol = (
            json.loads(args.protocol.read_text(encoding="utf-8"))
            if args.protocol is not None
            else None
        )
        payload = run_offline_pilot(
            design_id=designs[0],
            contexts=contexts,
            provider_factory=provider_factory,
            model=args.model,
            repeats=args.repeats,
            planning_call_limit=args.planning_call_limit,
            protocol=protocol,
        )
    else:
        if args.mediation is None:
            parser.error("audit requires --mediation JSONL")
        rows = read_jsonl(args.mediation)
        if "planning-provider-audit" in args.mediation.name:
            proposal_path = args.mediation.with_name("optimization-proposal-observations.v1.jsonl")
            proposal_rows = read_jsonl(proposal_path) if proposal_path.exists() else []
            calls = audit_planning_calls(rows, proposal_rows)
            payload = {
                **summarize_planning_audit(rows, proposal_rows),
                "calls": calls,
                "missing_evidence_reason_counts": missing_evidence_reason_counts(calls),
            }
        else:
            selected = [row for row in rows if row.get("design_id") in designs]
            payload = {**summarize_mediation(selected), "feedback_ledger": build_feedback_ledger(selected)}
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
