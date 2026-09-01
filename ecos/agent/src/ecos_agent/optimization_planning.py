"""Shared typed contracts for bounded optimization planning."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol

from ecos_agent.effective_domain import EffectiveDomainSnapshot
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    HistoryReference,
    KnowledgeReference,
    LegalAction,
    ObservationReference,
    OptimizationObjectiveContract,
    ProposalAction,
    ProposalContextRef,
    RequestedKnobValue,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization_knowledge_cases import (
    EmpiricalCaseAudit,
    TerminalEmpiricalCase,
)
from ecos_agent.optimization_knowledge_compiler import SupportedActionView
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_memory import OptimizationTaskMemorySnapshot
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt


@dataclass(frozen=True)
class OptimizationPlanningContext:
    """The entire, intentionally small input surface exposed to the planner."""

    context_ref: ProposalContextRef
    observation_ref: ObservationReference
    incumbent: TerminalObservation | None
    history: tuple["OptimizationHistory", ...]
    knowledge_refs: tuple[KnowledgeReference, ...]
    knowledge_chunks: tuple[str, ...]
    observation: StageObservation | None = None
    budget: BudgetSnapshot | None = None
    current_values: Mapping[str, bool | int | float] | None = None
    legal_actions: tuple[LegalAction, ...] = ()
    objective: OptimizationObjectiveContract | None = None
    task_memory: OptimizationTaskMemorySnapshot | None = None
    excluded_surface_values: tuple[RequestedKnobValue, ...] = ()
    effective_domains: tuple[EffectiveDomainSnapshot, ...] = ()
    supported_action_view: SupportedActionView | None = None
    empirical_cases: tuple[TerminalEmpiricalCase, ...] = ()
    empirical_case_audit: EmpiricalCaseAudit | None = None


@dataclass(frozen=True)
class OptimizationHistory:
    """A bounded, typed prior intervention exposed to the next planner turn."""

    reference: HistoryReference
    outcome: OptimizationOutcomeKind
    action: ProposalAction
    requested: RequestedKnobValue
    terminal_observation: TerminalObservation | None = None
    parameter_application_receipt: ParameterApplicationReceipt | None = None


def optimization_history_payload(item: OptimizationHistory) -> dict[str, object]:
    payload = {
        "reference": item.reference.model_dump(mode="json"),
        "outcome": item.outcome.value,
        "action": item.action.model_dump(mode="json"),
        "requested": item.requested.model_dump(mode="json"),
        "terminal_observation": (
            item.terminal_observation.model_dump(mode="json")
            if item.terminal_observation is not None
            else None
        ),
    }
    if item.parameter_application_receipt is not None:
        payload["parameter_application_receipt"] = (
            item.parameter_application_receipt.model_dump(mode="json")
        )
    return payload


def planning_context_payload(context: OptimizationPlanningContext) -> dict[str, object]:
    """Return the canonical JSON payload exposed to a planner implementation."""
    payload: dict[str, object] = {
        "context_ref": context.context_ref.model_dump(mode="json"),
        "observation_ref": context.observation_ref.model_dump(mode="json"),
        "incumbent": (
            context.incumbent.model_dump(mode="json")
            if context.incumbent is not None
            else None
        ),
        "history": [optimization_history_payload(item) for item in context.history],
        "knowledge_refs": [
            item.model_dump(mode="json") for item in context.knowledge_refs
        ],
        "knowledge_chunks": list(context.knowledge_chunks),
        "supported_action_view": (
            {
                **context.supported_action_view.model_dump(mode="json"),
                "view_sha256": context.supported_action_view.view_sha256,
            }
            if context.supported_action_view is not None
            else None
        ),
        "objective": (
            context.objective.model_dump(mode="json")
            if context.objective is not None
            else None
        ),
    }
    if context.observation is not None:
        payload["observation"] = context.observation.model_dump(mode="json")
    if context.budget is not None:
        payload["budget"] = context.budget.model_dump(mode="json")
    if context.current_values is not None:
        payload["current_values"] = dict(sorted(context.current_values.items()))
    payload["legal_actions"] = [
        item.model_dump(mode="json") for item in context.legal_actions
    ]
    payload["excluded_surface_values"] = [
        item.model_dump(mode="json") for item in context.excluded_surface_values
    ]
    if context.effective_domains:
        payload["effective_domains"] = [
            item.model_dump(mode="json") for item in context.effective_domains
        ]
    if context.task_memory is not None:
        payload["task_memory"] = context.task_memory.model_dump(mode="json")
    payload["empirical_cases"] = [
        item.model_dump(mode="json") for item in context.empirical_cases
    ]
    payload["empirical_case_audit"] = (
        context.empirical_case_audit.model_dump(mode="json")
        if context.empirical_case_audit is not None
        else None
    )
    return payload


class OptimizationProposalPlanner(Protocol):
    def propose(self, context: OptimizationPlanningContext) -> object: ...
