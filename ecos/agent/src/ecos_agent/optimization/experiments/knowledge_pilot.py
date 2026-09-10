"""Offline knowledge pilot: frozen contexts, treatments, proposal mediation.

The pilot reuses the native planning surface (`propose_v2`) against hash-bound
frozen contexts, so a proposal difference is attributable to the treatment's
knowledge payload alone. No candidate is executed here.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from pydantic import ValidationError

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
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.experiments.frozen_contexts import validate_context_bank
from ecos_agent.optimization.experiments.knowledge_mediation import read_jsonl, summarize_planning_audit
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
from ecos_agent.optimization.knowledge.compiler import (
    SupportedActionView,
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
        "planning_feedback": list(context.planning_feedback),
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
        planning_feedback=tuple(data.get("planning_feedback", ())),
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
    rows: list[dict[str, object]] = []
    planning_calls = 0
    try:
        for context in sorted(contexts, key=lambda item: str(item["context_fingerprint"])):
            rebuilt = rebuild_planning_context(context["planning_context"])
            for config in ZERO_SHOT_GATE_TREATMENTS:
                variant = apply_treatment(rebuilt, agent_mode=config.agent_mode)
                for repeat in range(1, repeats + 1):
                    rows.append(
                        _run_cell(
                            provider=provider,
                            design_id=design_id,
                            context=context,
                            variant=variant,
                            treatment=config.treatment.value,
                            repeat=repeat,
                            planning_call=planning_calls,
                            planning_call_limit=planning_call_limit,
                        )
                    )
                    planning_calls += 1
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
    offline = sub.add_parser("offline")
    offline.add_argument("--design", required=True)
    offline.add_argument("--contexts", type=Path, required=True)
    offline.add_argument("--model")
    offline.add_argument("--repeats", type=int, default=1)
    offline.add_argument("--planning-call-limit", type=int, default=60)
    offline.add_argument("--protocol", type=Path)
    offline.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    designs = validate_design_ids(
        [args.design] if isinstance(args.design, str) else args.design
    )
    if args.command == "preflight":
        manifest = load_state_rule_manifest()
        payload = {
            "schema_version": "ecos.knowledge_pilot_preflight.v1",
            "design_ids": list(designs),
            "cohort_role": "pilot_only",
            "state_rule_manifest_sha256": manifest.manifest_sha256,
            "trend_noise_tolerance": manifest.trend_noise_tolerance,
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
            payload = summarize_planning_audit(rows)
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
