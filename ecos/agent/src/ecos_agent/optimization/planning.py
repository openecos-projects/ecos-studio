"""Shared typed contracts for bounded optimization planning."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol

from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainError,
    EffectiveDomainSnapshot,
    validate_optimization_proposal_v2,
)
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
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
from ecos_agent.optimization.knowledge.cases import (
    EmpiricalCaseAudit,
    TerminalEmpiricalCase,
)
from ecos_agent.optimization.knowledge.compiler import SupportedActionView
from ecos_agent.optimization.metrics.contracts import EvaluationMetricDirection
from ecos_agent.optimization.memory import OptimizationTaskMemorySnapshot
from ecos_agent.optimization.objective_alignment import (
    ActiveOptimizationObjective,
    OptimizationObjectiveAlignment,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)


@dataclass(frozen=True)
class InFlightExperiment:
    """A dispatched but unresolved candidate exposed to the next planner turn.

    In-flight requests are hypotheses under test, never observations: the
    planner must not count them as results and must not re-dispatch the same
    request from the same parent configuration.
    """

    intervention_id: str
    execution_id: str
    requested: RequestedKnobValue
    direction: str
    rationale_summary: str | None = None
    parent_config_sha256: str | None = None


def in_flight_payload(item: InFlightExperiment) -> dict[str, object]:
    payload: dict[str, object] = {
        "intervention_id": item.intervention_id,
        "execution_id": item.execution_id,
        "requested": item.requested.model_dump(mode="json"),
        "direction": item.direction,
    }
    if item.rationale_summary is not None:
        payload["rationale_summary"] = item.rationale_summary
    if item.parent_config_sha256 is not None:
        payload["parent_config_sha256"] = item.parent_config_sha256
    return payload


def stage_evidence_payload(
    primary_stage: str,
    primary_ref: ObservationReference,
    stage_observations: Mapping[str, StageObservation],
) -> list[dict[str, object]]:
    """Per-stage observation references binding cross-stage legal actions."""
    entries: list[dict[str, object]] = [
        {"stage": primary_stage, "observation_ref": primary_ref.model_dump(mode="json")}
    ]
    entries.extend(
        {
            "stage": stage,
            "observation_ref": {
                "observation_id": observation.observation_id,
                "sha256": canonical_sha256(observation.model_dump(mode="json")),
            },
        }
        for stage, observation in sorted(stage_observations.items())
        if stage != primary_stage
    )
    return entries


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
    effective_domains: tuple[EffectiveDomainSnapshot, ...] = ()
    supported_action_view: SupportedActionView | None = None
    empirical_cases: tuple[TerminalEmpiricalCase, ...] = ()
    empirical_case_audit: EmpiricalCaseAudit | None = None
    objective_alignment: OptimizationObjectiveAlignment | None = None
    active_objective: ActiveOptimizationObjective | None = None
    parameter_knowledge: tuple[ParameterSemanticsCard, ...] = ()
    parameter_trajectories: tuple["OptimizationHistory", ...] = ()
    planning_feedback: tuple[str, ...] = ()
    parameter_policy: Mapping[str, object] | None = None
    in_flight: tuple[InFlightExperiment, ...] = ()
    stage_observations: Mapping[str, StageObservation] | None = None
    parent_config_sha256: str | None = None


@dataclass(frozen=True)
class OptimizationHistory:
    """A bounded, typed prior intervention exposed to the next planner turn."""

    reference: HistoryReference
    outcome: OptimizationOutcomeKind
    action: ProposalAction
    requested: RequestedKnobValue
    terminal_observation: TerminalObservation | None = None
    parameter_application_receipt: ParameterApplicationReceipt | None = None
    rationale_summary: str | None = None
    planning_values: Mapping[str, bool | int | float] | None = None
    incumbent_decision: str | None = None
    decisive_metric: str | None = None
    recovery_transition: str | None = None
    layer_signal: str | None = None


@dataclass(frozen=True)
class OptimizationPlannerTurn:
    proposal: OptimizationProposal
    requested: RequestedKnobValue | None = None
    provider_payload_sha256: str | None = None
    proposal_v2: OptimizationProposalV2 | None = None


def _worse_corner_value(
    value: float, reference: float, direction: EvaluationMetricDirection
) -> bool:
    if direction == EvaluationMetricDirection.HIGHER_IS_BETTER:
        return value < reference
    # Lower-is-better metrics degrade upward; non-directional cornered
    # metrics are counts where a higher value is the conservative worst.
    return value > reference


def projected_terminal_observation(
    observation: TerminalObservation,
    *,
    incumbent: TerminalObservation | None = None,
) -> dict[str, object]:
    """Project a terminal observation to its decisive planner-facing summary.

    The full observation stays ledger-bound through the history reference
    (outcome_sha256) and the evidence manifest; the planner receives frozen
    objective metrics, timing guardrails, signoff gates, eligibility counts,
    the worst corner per STA metric, and deltas versus the incumbent instead
    of every per-corner evaluation metric.
    """
    worst: dict[str, tuple[str, float]] = {}
    for metric in observation.evaluation_metrics:
        if metric.corner is None:
            continue
        current = worst.get(metric.metric_id)
        if current is None or _worse_corner_value(
            metric.value, current[1], metric.direction
        ):
            worst[metric.metric_id] = (metric.corner, metric.value)
    payload: dict[str, object] = {
        "schema_version": "ecos.terminal_observation.projection.v1",
        "observation_id": observation.observation_id,
        "evidence_valid": observation.evidence_valid,
        "harden_artifacts_complete": observation.harden_artifacts_complete,
        "evaluation_metrics_complete": observation.evaluation_metrics_complete,
        "signoff_gates": observation.signoff_gates.model_dump(mode="json"),
        "metrics": {
            metric.value: value for metric, value in observation.metrics.items()
        },
        "timing_guardrail": {
            metric.value: value
            for metric, value in observation.timing_guardrail.items()
        },
        "unscoped_evaluation_metrics": {
            metric.metric_id: metric.value
            for metric in observation.evaluation_metrics
            if metric.corner is None
        },
        "worst_corner_metrics": {
            metric_id: {"corner": corner, "value": value}
            for metric_id, (corner, value) in sorted(worst.items())
        },
        "sta_corner_count": len(observation.sta_corner_ids),
        "sta_corner_set_sha256": observation.sta_corner_set_sha256,
        "evidence_manifest_sha256": observation.evidence_manifest_sha256,
    }
    if observation.geometry is not None:
        payload["geometry"] = observation.geometry.model_dump(mode="json")
    if incumbent is not None:
        # Deltas are planner-facing summaries; rounding to 12 decimals keeps
        # them free of float subtraction noise without hiding real changes.
        payload["delta_vs_incumbent"] = {
            "metrics": {
                metric.value: round(
                    observation.metrics[metric] - incumbent.metrics[metric], 12
                )
                for metric in observation.metrics
            },
            "timing_guardrail": {
                metric.value: round(
                    observation.timing_guardrail[metric]
                    - incumbent.timing_guardrail[metric],
                    12,
                )
                for metric in observation.timing_guardrail
            },
        }
    return payload


def projected_parameter_receipt(
    receipt: ParameterApplicationReceipt,
) -> dict[str, object]:
    """Planner-facing receipt summary; evidence_sha256 binds the full receipt."""
    return {
        "schema_version": receipt.schema_version,
        "receipt_id": receipt.receipt_id,
        "tool": {"name": receipt.tool.name, "revision": receipt.tool.revision},
        "context_sha256": receipt.context.get("context_sha256"),
        "requested": receipt.requested,
        "written_value": receipt.materialization.written_value,
        "written_unit": receipt.materialization.unit,
        "actual_value": receipt.actual_value,
        "status": receipt.status,
        "reason": receipt.reason,
        "observation": receipt.observation,
        "evidence_sha256": receipt.evidence_sha256,
    }


def optimization_history_payload(
    item: OptimizationHistory,
    *,
    incumbent: TerminalObservation | None = None,
) -> dict[str, object]:
    payload = {
        "reference": item.reference.model_dump(mode="json"),
        "outcome": item.outcome.value,
        "action": item.action.model_dump(mode="json"),
        "requested": item.requested.model_dump(mode="json"),
        "terminal_observation": (
            projected_terminal_observation(
                item.terminal_observation, incumbent=incumbent
            )
            if item.terminal_observation is not None
            else None
        ),
    }
    if item.parameter_application_receipt is not None:
        payload["parameter_application_receipt"] = projected_parameter_receipt(
            item.parameter_application_receipt
        )
    if item.rationale_summary is not None:
        payload["rationale_summary"] = item.rationale_summary
    if item.planning_values is not None:
        payload["planning_values"] = dict(item.planning_values)
    if item.incumbent_decision is not None:
        payload["incumbent_decision"] = item.incumbent_decision
    if item.decisive_metric is not None:
        payload["decisive_metric"] = item.decisive_metric
    if item.recovery_transition is not None:
        payload["recovery_transition"] = item.recovery_transition
    if item.layer_signal is not None:
        payload["layer_signal"] = item.layer_signal
    return payload


def planning_context_payload(context: OptimizationPlanningContext) -> dict[str, object]:
    """Return the canonical JSON payload exposed to a planner implementation."""
    payload: dict[str, object] = {
        "context_ref": context.context_ref.model_dump(mode="json"),
        "observation_ref": context.observation_ref.model_dump(mode="json"),
        "incumbent": (
            projected_terminal_observation(context.incumbent)
            if context.incumbent is not None
            else None
        ),
        "knowledge_refs": [
            item.model_dump(mode="json") for item in context.knowledge_refs
        ],
        "knowledge_chunks": list(context.knowledge_chunks),
        "supported_action_view": (
            context.supported_action_view.planner_payload()
            if context.supported_action_view is not None
            else None
        ),
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
    payload["parameter_knowledge"] = [
        card.model_dump(mode="json") for card in context.parameter_knowledge
    ]
    payload["parameter_trajectories"] = [
        optimization_history_payload(item, incumbent=context.incumbent)
        for item in context.parameter_trajectories
    ]
    payload["planning_feedback"] = list(context.planning_feedback)
    if context.in_flight:
        payload["in_flight"] = [in_flight_payload(item) for item in context.in_flight]
    if context.stage_observations is not None and context.observation is not None:
        payload["stage_evidence"] = stage_evidence_payload(
            context.observation.stage.value,
            context.observation_ref,
            context.stage_observations,
        )
    if context.parent_config_sha256 is not None:
        payload["parent_config_sha256"] = context.parent_config_sha256
    if context.parameter_policy is not None:
        payload["parameter_policy"] = dict(context.parameter_policy)
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
    def propose_v2(
        self,
        context: OptimizationPlanningContext,
        domains: tuple[EffectiveDomainSnapshot, ...],
    ) -> object: ...


def v2_domains(
    context: OptimizationPlanningContext,
) -> tuple[EffectiveDomainSnapshot, ...]:
    legal_knobs = {action.knob_id for action in context.legal_actions}
    return tuple(
        domain
        for domain in context.effective_domains
        if domain.knob_id in legal_knobs
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
            if proposal.action.claim_id is not None
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
    """Project the validated probe into the execution ledger's action summary."""
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
    forbid_knowledge: bool,
) -> str | None:
    if proposal.context_ref != context.context_ref:
        return "context_reference"
    if tuple(proposal.observation_refs) != (context.observation_ref,):
        return "observation_reference"
    available_history = {
        (item.reference.intervention_id, item.reference.outcome_sha256)
        for item in (*context.history, *context.parameter_trajectories)
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
    if proposal.action is None:
        return "proposal_action"
    if not any(
        action.knob_id == proposal.action.knob_id
        and action.direction == proposal.action.direction
        for action in context.legal_actions
    ):
        return "proposal_action"
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
