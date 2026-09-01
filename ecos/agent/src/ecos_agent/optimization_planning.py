"""Shared typed contracts for bounded optimization planning."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol

from ecos_agent.effective_domain import (
    EffectiveDomainError,
    EffectiveDomainSnapshot,
    validate_optimization_proposal_v2,
)
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    HistoryReference,
    KnowledgeReference,
    LegalAction,
    ObservationReference,
    OptimizationObjectiveContract,
    OptimizationOutcomeKind,
    OptimizationDecision,
    OptimizationProposal,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization_knowledge_cases import (
    EmpiricalCaseAudit,
    TerminalEmpiricalCase,
)
from ecos_agent.optimization_knowledge_compiler import SupportedActionView
from ecos_agent.optimization_memory import OptimizationTaskMemorySnapshot
from ecos_agent.parameter_evidence_contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
)


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


@dataclass(frozen=True)
class OptimizationPlannerTurn:
    proposal: OptimizationProposal
    requested: RequestedKnobValue | None = None
    provider_payload_sha256: str | None = None
    proposal_v2: OptimizationProposalV2 | None = None


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


def v2_domains(
    context: OptimizationPlanningContext,
) -> tuple[EffectiveDomainSnapshot, ...]:
    legal_knobs = {action.knob_id for action in context.legal_actions}
    return tuple(
        domain
        for domain in context.effective_domains
        if domain.knob_id in legal_knobs and domain.allowed_requested_values
    )


def v2_provider_payload_sha256(context: OptimizationPlanningContext) -> str:
    domains = v2_domains(context)
    if not domains:
        raise EffectiveDomainError("v2 planning domain is unavailable")
    payload = planning_context_payload(context)
    if len(domains) == 1:
        payload["effective_domain"] = domains[0].model_dump(mode="json")
    else:
        payload["effective_domains"] = [
            item.model_dump(mode="json") for item in domains
        ]
    return canonical_sha256(payload)


def validate_v2_proposal(
    proposal: OptimizationProposalV2,
    context: OptimizationPlanningContext,
    *,
    attempted: tuple[RequestedKnobValue, ...],
    require_knowledge_support: bool,
) -> OptimizationProposalV2:
    domains = v2_domains(context)
    if not domains:
        raise EffectiveDomainError("v2 planning domain is unavailable")
    if proposal.action is None:
        return proposal
    domain = next(
        (item for item in domains if item.knob_id == proposal.action.knob_id), None
    )
    if domain is None:
        raise EffectiveDomainError("v2 proposal knob is not legal")
    validated = validate_optimization_proposal_v2(
        proposal,
        domain,
        context_ref=context.context_ref.model_dump(mode="json"),
        attempted=attempted,
        supported_action=(
            _supported_v2_action(context, proposal)
            if require_knowledge_support
            else None
        ),
    )
    if validated.action is not None and not any(
        item.knob_id == validated.action.knob_id
        and item.direction == validated.action.direction
        for item in context.legal_actions
    ):
        raise EffectiveDomainError("v2 proposal action is not legal")
    return validated


def v2_to_v1(proposal: OptimizationProposalV2) -> OptimizationProposal:
    payload = proposal.model_dump(mode="json")
    payload["schema_version"] = "ecos.optimization_proposal.v1"
    try:
        payload["reason_code"] = ProposalReason(proposal.reason_code).value
    except ValueError as exc:
        raise EffectiveDomainError("v2 proposal reason code is invalid") from exc
    if proposal.action is not None:
        payload["action"] = {
            "knob_id": proposal.action.knob_id.value,
            "direction": proposal.action.direction.value,
            "expected_effects": [
                item.model_dump(mode="json")
                for item in proposal.action.expected_effects
            ],
        }
    return OptimizationProposal.model_validate(payload)


def validate_planner_proposal(
    proposal: OptimizationProposal,
    context: OptimizationPlanningContext,
    *,
    require_knowledge: bool,
    forbid_knowledge: bool,
) -> str | None:
    if proposal.context_ref != context.context_ref:
        return "context_reference"
    if tuple(proposal.observation_refs) != (context.observation_ref,):
        return "observation_reference"
    available_history = {
        (item.reference.intervention_id, item.reference.outcome_sha256)
        for item in context.history
    }
    if any(
        (item.intervention_id, item.outcome_sha256) not in available_history
        for item in proposal.history_refs
    ):
        return "history_reference"
    proposed_knowledge = _knowledge_keys(proposal.knowledge_refs)
    if forbid_knowledge and proposed_knowledge:
        return "no_knowledge_reference"
    if not proposed_knowledge.issubset(_knowledge_keys(context.knowledge_refs)):
        return "knowledge_reference"
    proposed_memory = {item.summary_sha256 for item in proposal.task_memory_refs}
    available_memory = (
        {item.reference.summary_sha256 for item in context.task_memory.summaries}
        if context.task_memory is not None
        else set()
    )
    if not proposed_memory.issubset(available_memory):
        return "task_memory_reference"
    if proposal.decision != OptimizationDecision.PROPOSE:
        return None
    if require_knowledge and not proposed_knowledge:
        return "knowledge_reference"
    if proposal.action is None:
        return "proposal_action"
    if require_knowledge and not any(
        item.knob_id == proposal.action.knob_id
        and item.direction == proposal.action.direction
        and (item.claim_ref.entity_id, item.claim_ref.chunk_sha256)
        in proposed_knowledge
        for item in (
            context.supported_action_view.actions
            if context.supported_action_view is not None
            else ()
        )
    ):
        return "knowledge_action_support"
    return None


def _supported_v2_action(
    context: OptimizationPlanningContext, proposal: OptimizationProposalV2
) -> Mapping[str, object]:
    action = proposal.action
    if action is None or context.supported_action_view is None:
        raise EffectiveDomainError("v2 proposal has no compiled knowledge support")
    matches = tuple(
        item
        for item in context.supported_action_view.actions
        if item.claim_ref.entity_id == action.claim_id
        and item.claim_sha256 == action.claim_sha256
        and item.binding_id == action.binding_id
        and item.binding_sha256 == action.binding_sha256
        and item.knob_id == action.knob_id
        and item.direction == action.direction
        and item.effective_domain_sha256 == action.effective_domain_sha256
    )
    if len(matches) != 1:
        raise EffectiveDomainError(
            "v2 proposal does not uniquely match compiled knowledge support"
        )
    return matches[0].model_dump(mode="json")


def _knowledge_keys(
    references: tuple[KnowledgeReference, ...],
) -> set[tuple[str, str]]:
    return {(reference.entity_id, reference.chunk_sha256) for reference in references}
