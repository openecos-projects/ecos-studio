"""Serialization for frozen optimization planning contexts."""

from __future__ import annotations

from typing import Mapping

from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    KnowledgeReference,
    LegalAction,
    ObservationReference,
    OptimizationObjectiveContract,
    OptimizationOutcomeKind,
    ProposalContextRef,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization.knowledge.compiler import SupportedActionView
from ecos_agent.optimization.objective_alignment import (
    ActiveOptimizationObjective,
    OptimizationObjectiveAlignment,
)
from ecos_agent.optimization.parameters.contracts import (
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization.planning import OptimizationHistory, OptimizationPlanningContext
from ecos_agent.optimization.reflection import PlanningFeedbackEntry


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
        "legal_actions": [item.model_dump(mode="json") for item in context.legal_actions],
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
            for stage, observation in sorted((context.stage_observations or {}).items())
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
