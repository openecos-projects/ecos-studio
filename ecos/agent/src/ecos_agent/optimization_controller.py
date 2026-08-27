"""No-side-effect controller for bounded optimization episodes.

This module deliberately accepts only typed fake-provider and fake-executor
interfaces.  Real ECC integration belongs to the later fixed-RPC milestone.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Callable, Literal, Mapping, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ecos_agent.codex_rpc import CodexProviderError
from ecos_agent.effective_domain import (
    EffectiveDomainError,
    EffectiveDomainSnapshot,
    compile_effective_domain,
    validate_optimization_proposal_v2,
)
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    ExpectedEffect,
    ExpectedEffectDirection,
    HistoryReference,
    KnobApplicationReceipt,
    KnowledgeReference,
    LegalAction,
    ObjectiveMetric,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationKnob,
    OptimizationObjectiveContract,
    OptimizationProposal,
    PlanningProviderEvidence,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    SelectionMetric,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization_decision_audit import (
    DecisionValidationResult,
    OptimizationDecisionAudit,
    OptimizationDecisionAuditReplay,
)
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerReplay,
    OptimizationOutcomeKind,
    OptimizationPlanningAudit,
    OptimizationPlanningAuditEntry,
    OptimizationPlanningAuditReplay,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationPlanningProviderEvidenceReplay,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization_memory import OptimizationTaskMemorySnapshot
from ecos_agent.optimization_retrieval import OptimizationRetrievalResult
from ecos_agent.optimization_rules import (
    ACTIVE_OPTIMIZATION_KNOBS,
    legal_actions,
    select_requested_value,
)
from ecos_agent.parameter_evidence_contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
)
from ecos_agent.parameter_semantics import (
    LATTICE_VERSION,
    card_hash,
    load_parameter_cards,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_STATE_FILE = "optimization-episode-state.v6.json"
_LEGACY_STATE_FILES = (
    "optimization-episode-state.v2.json",
    "optimization-episode-state.v3.json",
    "optimization-episode-state.v4.json",
    "optimization-episode-state.v5.json",
)
_TARGET_STEPS = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: "Floorplan",
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "Floorplan",
    OptimizationKnob.SYNTH_MAX_FANOUT: "fixFanout",
    OptimizationKnob.TARGET_DENSITY: "place",
    OptimizationKnob.TARGET_OVERFLOW: "place",
    OptimizationKnob.CELL_PADDING_X: "place",
    OptimizationKnob.ROUTABILITY_OPT: "place",
    OptimizationKnob.DENSITY_WEIGHT: "place",
}


class OptimizationEpisodeControllerError(ValueError):
    """An episode cannot safely make the requested state transition."""


class OptimizationAgentMode(StrEnum):
    FULL_AGENT = "full_agent"
    LLM_NO_KNOWLEDGE = "llm_no_knowledge"


@dataclass(frozen=True)
class CandidateExecutionEvidence:
    candidate_root_ref: str
    candidate_manifest_ref: str
    candidate_manifest_sha256: str
    target_step: str | None = None
    end_step: str | None = None
    execution_scope: str | None = None

    def __post_init__(self) -> None:
        for value in (self.candidate_root_ref, self.candidate_manifest_ref):
            if (
                not value
                or "\\" in value
                or value.startswith("/")
                or "." in value.split("/")
                or ".." in value.split("/")
            ):
                raise ValueError("candidate evidence reference is invalid")
        if not _SHA256.fullmatch(self.candidate_manifest_sha256):
            raise ValueError("candidate manifest hash is invalid")


@dataclass(frozen=True)
class CandidateExecutionReceipt:
    """The only execution status the M4 fake adapter may return."""

    execution_id: str
    started: bool
    outcome: OptimizationOutcomeKind | None = None
    evidence: CandidateExecutionEvidence | None = None
    application_receipt: KnobApplicationReceipt | None = None
    parameter_application_receipt: ParameterApplicationReceipt | None = None

    def __post_init__(self) -> None:
        if not _ID.fullmatch(self.execution_id):
            raise ValueError("execution receipt id is invalid")
        if not isinstance(self.started, bool):
            raise ValueError("execution receipt started flag is invalid")
        if self.outcome is not None and not isinstance(self.outcome, OptimizationOutcomeKind):
            raise ValueError("execution receipt outcome is invalid")
        if self.evidence is not None and not isinstance(self.evidence, CandidateExecutionEvidence):
            raise ValueError("execution receipt evidence is invalid")
        if self.application_receipt is not None and not isinstance(
            self.application_receipt, KnobApplicationReceipt
        ):
            raise ValueError("execution application receipt is invalid")
        if self.parameter_application_receipt is not None and not isinstance(
            self.parameter_application_receipt, ParameterApplicationReceipt
        ):
            raise ValueError("execution parameter receipt is invalid")


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
    known_ineffective_requests: tuple[RequestedKnobValue, ...] = ()
    effective_domains: tuple[EffectiveDomainSnapshot, ...] = ()


@dataclass(frozen=True)
class OptimizationHistory:
    """A bounded, typed prior intervention exposed to the next planner turn."""

    reference: HistoryReference
    outcome: OptimizationOutcomeKind
    action: ProposalAction
    requested: RequestedKnobValue
    terminal_observation: TerminalObservation | None = None
    application_receipt: KnobApplicationReceipt | None = None
    parameter_application_receipt: ParameterApplicationReceipt | None = None


def _history_payload(item: OptimizationHistory) -> dict[str, object]:
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
    if item.application_receipt is not None:
        payload["application_receipt"] = item.application_receipt.model_dump(mode="json")
    if item.parameter_application_receipt is not None:
        payload["parameter_application_receipt"] = item.parameter_application_receipt.model_dump(mode="json")
    return payload


def planning_context_payload(context: OptimizationPlanningContext) -> dict[str, object]:
    """Return the canonical JSON payload exposed to a planner implementation."""
    payload: dict[str, object] = {
        "context_ref": context.context_ref.model_dump(mode="json"),
        "observation_ref": context.observation_ref.model_dump(mode="json"),
        "incumbent": (
            context.incumbent.model_dump(mode="json") if context.incumbent is not None else None
        ),
        "history": [_history_payload(item) for item in context.history],
        "knowledge_refs": [item.model_dump(mode="json") for item in context.knowledge_refs],
        "knowledge_chunks": list(context.knowledge_chunks),
        "objective": (
            context.objective.model_dump(mode="json") if context.objective is not None else None
        ),
    }
    if context.observation is not None:
        payload["observation"] = context.observation.model_dump(mode="json")
    if context.budget is not None:
        payload["budget"] = context.budget.model_dump(mode="json")
    if context.current_values is not None:
        payload["current_values"] = dict(sorted(context.current_values.items()))
    payload["legal_actions"] = [item.model_dump(mode="json") for item in context.legal_actions]
    payload["known_ineffective_requests"] = [
        item.model_dump(mode="json") for item in context.known_ineffective_requests
    ]
    if context.effective_domains:
        payload["effective_domains"] = [
            item.model_dump(mode="json") for item in context.effective_domains
        ]
    if context.task_memory is not None:
        payload["task_memory"] = context.task_memory.model_dump(mode="json")
    return payload


@dataclass(frozen=True)
class CandidateExecutionRequest:
    """A typed execution request with no command or unrestricted path field."""

    intervention_id: str
    episode_id: str
    checkpoint_id: str
    proposal: OptimizationProposal
    requested: RequestedKnobValue
    parent_candidate_root_ref: str | None = None


@dataclass(frozen=True)
class OptimizationControlResult:
    state: OptimizationEpisodeState
    proposal: OptimizationProposal | None = None
    requested: RequestedKnobValue | None = None
    rejection_reason: str | None = None
    planner_source: Literal["llm", "local_fallback", "repair"] = "llm"


@dataclass(frozen=True)
class _PlannerTurn:
    proposal: OptimizationProposal
    requested: RequestedKnobValue | None = None
    provider_payload_sha256: str | None = None


class OptimizationProposalPlanner(Protocol):
    def propose(self, context: OptimizationPlanningContext) -> object: ...


class OptimizationExecutionAdapter(Protocol):
    def start(self, request: CandidateExecutionRequest) -> CandidateExecutionReceipt: ...

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt: ...


class _PersistedEpisodeState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos.optimization_episode_state.v6"] = (
        "ecos.optimization_episode_state.v6"
    )
    episode_id: str
    checkpoint_id: str
    mode: OptimizationAgentMode
    receipt_aware_planning: bool = Field(
        default=True, exclude_if=lambda value: value is True
    )
    state: OptimizationEpisodeState
    budget: BudgetSnapshot
    started_at: float
    incumbent: TerminalObservation | None = None
    objective: OptimizationObjectiveContract | None = None
    parent_manifest_sha256: str | None = None
    ledger_event_count: int = Field(ge=0)
    ledger_chain_head_sha256: str | None = None
    planning_audit_event_count: int = Field(default=0, ge=0)
    planning_audit_chain_head_sha256: str | None = None
    planning_provider_audit_event_count: int = Field(default=0, ge=0)
    planning_provider_audit_chain_head_sha256: str | None = None
    decision_audit_event_count: int = Field(default=0, ge=0)
    decision_audit_chain_head_sha256: str | None = None
    planning_only_turns: int = Field(default=0, ge=0)
    incumbent_candidate_root_ref: str | None = None
    incumbent_candidate_manifest_ref: str | None = None
    incumbent_candidate_manifest_sha256: str | None = None
    proposal: OptimizationProposal | None = None
    requested: RequestedKnobValue | None = None
    attempted_requests: tuple[RequestedKnobValue, ...] = ()
    pending_intervention_id: str | None = None
    pending_execution_id: str | None = None
    cancel_requested: bool = False
    task_memory_scope_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    state_sha256: str

    @model_validator(mode="after")
    def validate_state_hash(self) -> "_PersistedEpisodeState":
        if self.parent_manifest_sha256 is not None and not _SHA256.fullmatch(
            self.parent_manifest_sha256
        ):
            raise ValueError("parent manifest hash is invalid")
        if self.task_memory_scope_sha256 is not None and not _SHA256.fullmatch(
            self.task_memory_scope_sha256
        ):
            raise ValueError("task memory scope hash is invalid")
        if self.state_sha256 != canonical_sha256(self.model_dump(mode="json", exclude={"state_sha256"})):
            raise ValueError("state hash is invalid")
        return self


class OptimizationEpisodeController:
    """Validate one proposal at a time and record fake execution outcomes."""

    def __init__(
        self,
        *,
        episode_id: str,
        checkpoint_id: str,
        mode: OptimizationAgentMode,
        budget: BudgetSnapshot,
        planner: OptimizationProposalPlanner,
        executor: OptimizationExecutionAdapter,
        ledger: OptimizationLedger,
        clock: Callable[[], float],
        incumbent: TerminalObservation | None = None,
        parent_manifest_sha256: str | None = None,
        objective: OptimizationObjectiveContract | None = None,
        task_memory_scope_sha256: str | None = None,
        task_memory_supplier: Callable[[], OptimizationTaskMemorySnapshot] | None = None,
        execution_context: Mapping[str, object] | None = None,
        receipt_aware_planning: bool = True,
    ) -> None:
        if not _ID.fullmatch(episode_id) or not _ID.fullmatch(checkpoint_id):
            raise OptimizationEpisodeControllerError("episode identifiers are invalid")
        self.episode_id = episode_id
        self.checkpoint_id = checkpoint_id
        self.mode = OptimizationAgentMode(mode)
        if type(receipt_aware_planning) is not bool:
            raise OptimizationEpisodeControllerError(
                "receipt-aware planning flag is invalid"
            )
        self.receipt_aware_planning = receipt_aware_planning
        self.planner = planner
        self.executor = executor
        self.ledger = ledger
        self._planning_audit = OptimizationPlanningAudit(ledger.root)
        self._planning_provider_audit = OptimizationPlanningProviderEvidenceAudit(ledger.root)
        self._decision_audit = OptimizationDecisionAudit(ledger.root)
        self._clock = clock
        self._started_at = self._valid_clock()
        self._budget = budget
        self._incumbent = incumbent
        self._objective = objective
        self._incumbent_candidate_root_ref: str | None = None
        self._incumbent_candidate_manifest_ref: str | None = None
        self._incumbent_candidate_manifest_sha256: str | None = None
        if parent_manifest_sha256 is not None and not _SHA256.fullmatch(parent_manifest_sha256):
            raise OptimizationEpisodeControllerError("parent manifest hash is invalid")
        self._parent_manifest_sha256 = parent_manifest_sha256
        if task_memory_scope_sha256 is not None and not _SHA256.fullmatch(
            task_memory_scope_sha256
        ):
            raise OptimizationEpisodeControllerError("task memory scope hash is invalid")
        self._task_memory_scope_sha256 = task_memory_scope_sha256
        self._task_memory_supplier = task_memory_supplier
        self._execution_context = dict(execution_context or {})
        self._state = OptimizationEpisodeState.CREATED
        self._proposal: OptimizationProposal | None = None
        self._requested: RequestedKnobValue | None = None
        self._attempted_request_values: tuple[RequestedKnobValue, ...] = ()
        self._pending_intervention_id: str | None = None
        self._pending_execution_id: str | None = None
        self._cancel_requested = False
        self._planning_only_turns = 0
        self._persist()

    @property
    def state(self) -> OptimizationEpisodeState:
        return self._state

    @property
    def pending_execution_id(self) -> str | None:
        return self._pending_execution_id

    @property
    def incumbent(self) -> TerminalObservation | None:
        return self._incumbent

    @property
    def objective(self) -> OptimizationObjectiveContract | None:
        return self._objective

    @property
    def incumbent_candidate_root_ref(self) -> str | None:
        return self._incumbent_candidate_root_ref

    def promote_incumbent(
        self,
        candidate: TerminalObservation,
        evidence: CandidateExecutionEvidence | None = None,
    ) -> None:
        if not candidate.eligible_for_incumbent:
            raise OptimizationEpisodeControllerError(
                "candidate terminal observation is not eligible"
            )
        self._incumbent = candidate
        self._incumbent_candidate_root_ref = evidence.candidate_root_ref if evidence else None
        self._incumbent_candidate_manifest_ref = evidence.candidate_manifest_ref if evidence else None
        self._incumbent_candidate_manifest_sha256 = (
            evidence.candidate_manifest_sha256 if evidence else None
        )
        self._persist()

    @property
    def budget(self) -> BudgetSnapshot:
        self._refresh_budget()
        return self._budget

    @property
    def parent_manifest_sha256(self) -> str | None:
        return self._parent_manifest_sha256

    @property
    def task_memory_scope_sha256(self) -> str | None:
        return self._task_memory_scope_sha256

    @property
    def state_path(self) -> Path:
        return self.ledger.root / _STATE_FILE

    def plan(
        self,
        observation: StageObservation,
        retrieval: OptimizationRetrievalResult,
        current_values: Mapping[str, bool | int | float],
    ) -> OptimizationControlResult:
        self._refresh_budget()
        if self._state not in {OptimizationEpisodeState.CREATED, OptimizationEpisodeState.PLANNING}:
            raise OptimizationEpisodeControllerError("episode is not ready for planning")
        if self._budget.exhausted:
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._requested = None
            self._persist()
            return self._result("budget_exhausted")

        self._state = OptimizationEpisodeState.PLANNING
        self._budget = self._consume(planning_calls=1)
        context = self._planning_context(observation, retrieval, current_values)
        planning_entry = self._planning_audit.append(
            context_ref=context.context_ref,
            history_refs=tuple(item.reference for item in context.history),
            history_outcomes=tuple(item.outcome for item in context.history),
            budget_snapshot=self._budget,
            incumbent=self._incumbent,
            planner_payload_sha256=canonical_sha256(planning_context_payload(context)),
            task_memory_snapshot_sha256=(
                context.task_memory.snapshot_sha256
                if context.task_memory is not None
                else None
            ),
            task_memory_refs=(
                tuple(item.reference for item in context.task_memory.summaries)
                if context.task_memory is not None
                else ()
            ),
            effective_domains=context.effective_domains,
        )
        self._persist()
        planner_source: Literal["llm", "local_fallback", "repair"] = "llm"
        planner_turn: _PlannerTurn | None = None
        provider_payload_sha256 = None
        if self._v2_enabled():
            try:
                provider_payload_sha256 = self._v2_provider_payload_sha256(context)
            except EffectiveDomainError:
                return self._defer_or_fallback(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="v2_domain_unavailable",
                    immediate_fallback=True,
                )
        try:
            planner_turn = self._invoke_planner(context)
        except (CodexProviderError, TypeError, ValidationError, ValueError) as exc:
            if isinstance(exc, CodexProviderError) and exc.failure_class != "parse_error":
                raise
            self._record_planning_provider_evidence(
                planning_entry,
                expected_payload_sha256=provider_payload_sha256,
            )
            if not self._v2_enabled():
                return self._defer_or_fallback(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="proposal_schema",
                )
            try:
                planner_turn = self._invoke_planner(context)
            except (CodexProviderError, TypeError, ValidationError, ValueError) as repair_exc:
                if isinstance(repair_exc, CodexProviderError) and repair_exc.failure_class != "parse_error":
                    raise
                self._record_planning_provider_evidence(
                    planning_entry,
                    expected_payload_sha256=provider_payload_sha256,
                )
                return self._defer_or_fallback(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="v2_repair_failed",
                    immediate_fallback=True,
                )
            planner_source = "repair"
            self._record_planning_provider_evidence(
                planning_entry,
                expected_payload_sha256=planner_turn.provider_payload_sha256,
            )
        else:
            assert planner_turn is not None
            self._record_planning_provider_evidence(
                planning_entry,
                expected_payload_sha256=planner_turn.provider_payload_sha256,
            )

        assert planner_turn is not None
        proposal = planner_turn.proposal

        rejection_reason = self._validate_proposal(proposal, context)
        if rejection_reason is not None:
            return self._defer_or_fallback(
                planning_entry,
                context,
                proposal=proposal,
                reason=rejection_reason,
                planner_source=planner_source,
            )
        if proposal.decision != OptimizationDecision.PROPOSE:
            if proposal.decision == OptimizationDecision.ESCALATE:
                self._state = OptimizationEpisodeState.ESCALATED
                return self._finish_planning(
                    planning_entry, proposal, "accepted", None, planner_source=planner_source
                )
            if proposal.decision == OptimizationDecision.STOP and (
                self._budget.consumed_candidates
                >= self._budget.budget.minimum_candidate_executions
                or not context.legal_actions
            ):
                self._state = OptimizationEpisodeState.STOPPED
                return self._finish_planning(
                    planning_entry, proposal, "accepted", None, planner_source=planner_source
                )
            reason = (
                "minimum_candidates_not_met"
                if proposal.decision == OptimizationDecision.STOP
                else "planner_continue"
            )
            return self._defer_or_fallback(
                planning_entry,
                context,
                proposal=proposal,
                reason=reason,
                planner_source=planner_source,
            )
        assert proposal.action is not None
        requested = planner_turn.requested or select_requested_value(
            proposal.action,
            current_values=current_values,
            attempted=self._attempted_requests(),
            known_aliases=context.known_ineffective_requests,
        )
        if requested is None:
            return self._defer_or_fallback(
                planning_entry,
                context,
                proposal=proposal,
                reason="no_legal_candidate",
                planner_source=planner_source,
            )
        self._proposal = proposal
        self._requested = requested
        self._planning_only_turns = 0
        self._state = OptimizationEpisodeState.AWAITING_EXECUTION
        return self._finish_planning(
            planning_entry,
            proposal,
            "accepted",
            None,
            planner_source=planner_source,
        )

    def execute(self) -> OptimizationControlResult:
        self._refresh_budget()
        if (
            self._state != OptimizationEpisodeState.AWAITING_EXECUTION
            or self._proposal is None
            or self._requested is None
        ):
            raise OptimizationEpisodeControllerError("episode has no approved proposal to execute")
        if self._budget.exhausted:
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._requested = None
            self._persist()
            return self._result("budget_exhausted")

        intervention_id = self._next_intervention_id()
        request = CandidateExecutionRequest(
            intervention_id,
            self.episode_id,
            self.checkpoint_id,
            self._proposal,
            self._requested,
            self._incumbent_candidate_root_ref,
        )
        try:
            receipt = self._start_once_with_retry(request)
        except OptimizationEpisodeControllerError:
            self._budget = self._consume(candidates=1)
            self._pending_intervention_id = intervention_id
            self._pending_execution_id = "unknown-execution"
            self._attempted_request_values = (*self._attempted_request_values, request.requested)
            self.ledger.append_start(self._ledger_start(request))
            return self._quarantine_indeterminate()
        if receipt is None:
            self._state = OptimizationEpisodeState.PLANNING
            self._proposal = None
            self._persist()
            return self._result("execution_not_started")

        self._budget = self._consume(candidates=1)
        self._pending_intervention_id = intervention_id
        self._pending_execution_id = receipt.execution_id
        self._attempted_request_values = (*self._attempted_request_values, request.requested)
        self.ledger.append_start(self._ledger_start(request))
        if receipt.outcome is None:
            self._state = OptimizationEpisodeState.EXECUTING
            self._persist()
            return self._result()
        return self._complete(receipt.outcome, receipt)

    def timeout(self) -> OptimizationControlResult:
        if self._state != OptimizationEpisodeState.EXECUTING or self._pending_execution_id is None:
            raise OptimizationEpisodeControllerError("cancel already requested or no execution is pending")
        if self._cancel_requested:
            raise OptimizationEpisodeControllerError("cancel already requested")
        self._cancel_requested = True
        self._persist()
        try:
            receipt = self.executor.cancel(self._pending_execution_id)
        except Exception:
            return self._quarantine_indeterminate()
        if not isinstance(receipt, CandidateExecutionReceipt):
            return self._quarantine_indeterminate()
        if receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED:
            return self._complete(receipt.outcome, receipt)
        return self._quarantine_indeterminate()

    def stop_before_execution(self) -> OptimizationControlResult:
        if self._state != OptimizationEpisodeState.AWAITING_EXECUTION:
            raise OptimizationEpisodeControllerError(
                "episode has no unstarted execution to stop"
            )
        self._proposal = None
        self._requested = None
        self._state = OptimizationEpisodeState.STOPPED
        self._persist()
        return self._result("stop_requested_before_execution")

    def complete_terminal(
        self,
        receipt: CandidateExecutionReceipt,
        terminal_observation: TerminalObservation | None = None,
        *,
        outcome: OptimizationOutcomeKind | None = None,
        incumbent_decision: str | None = None,
        decisive_metric: SelectionMetric | None = None,
    ) -> OptimizationControlResult:
        """Record a terminal outcome produced from separately verified evidence."""
        if (
            self._state != OptimizationEpisodeState.EXECUTING
            or self._pending_execution_id is None
            or receipt.execution_id != self._pending_execution_id
            or not receipt.started
            or receipt.outcome is None
        ):
            raise OptimizationEpisodeControllerError("terminal receipt does not match pending execution")
        return self._complete(
            outcome or receipt.outcome,
            receipt,
            terminal_observation,
            incumbent_decision=incumbent_decision,
            decisive_metric=decisive_metric,
        )

    @classmethod
    def recover(
        cls,
        *,
        planner: OptimizationProposalPlanner,
        executor: OptimizationExecutionAdapter,
        ledger: OptimizationLedger,
        clock: Callable[[], float],
        task_memory_scope_sha256: str | None = None,
        task_memory_supplier: Callable[[], OptimizationTaskMemorySnapshot] | None = None,
        execution_context: Mapping[str, object] | None = None,
        receipt_aware_planning: bool = True,
    ) -> "OptimizationEpisodeController":
        path = ledger.root / _STATE_FILE
        if not path.is_file() and any(
            (ledger.root / name).is_file() for name in _LEGACY_STATE_FILES
        ):
            raise OptimizationEpisodeControllerError(
                "pre-policy episode cannot be recovered; start a new optimization episode"
            )
        try:
            snapshot = _PersistedEpisodeState.model_validate_json(path.read_bytes())
        except (OSError, ValidationError, ValueError) as exc:
            raise OptimizationEpisodeControllerError("episode state hash is invalid") from exc
        replay = ledger.recover()
        planning_audit = OptimizationPlanningAudit(ledger.root)
        audit_replay = planning_audit.verify()
        planning_provider_audit = OptimizationPlanningProviderEvidenceAudit(ledger.root)
        provider_audit_replay = planning_provider_audit.verify()
        decision_audit = OptimizationDecisionAudit(ledger.root)
        decision_audit_replay = decision_audit.verify()
        cls._verify_snapshot_trace(
            snapshot,
            replay,
            audit_replay,
            provider_audit_replay,
            decision_audit_replay,
        )
        if snapshot.task_memory_scope_sha256 != task_memory_scope_sha256:
            raise OptimizationEpisodeControllerError(
                "task memory scope does not match the recovered episode"
            )

        controller = cls.__new__(cls)
        controller.episode_id = snapshot.episode_id
        controller.checkpoint_id = snapshot.checkpoint_id
        controller.mode = snapshot.mode
        if snapshot.receipt_aware_planning != receipt_aware_planning:
            raise OptimizationEpisodeControllerError(
                "receipt-aware planning mode does not match the recovered episode"
            )
        controller.receipt_aware_planning = snapshot.receipt_aware_planning
        controller.planner = planner
        controller.executor = executor
        controller.ledger = ledger
        controller._clock = clock
        controller._started_at = snapshot.started_at
        controller._budget = snapshot.budget
        controller._incumbent = snapshot.incumbent
        controller._objective = snapshot.objective
        controller._parent_manifest_sha256 = snapshot.parent_manifest_sha256
        controller._task_memory_scope_sha256 = snapshot.task_memory_scope_sha256
        controller._task_memory_supplier = task_memory_supplier
        controller._execution_context = dict(execution_context or {})
        controller._planning_audit = planning_audit
        controller._planning_provider_audit = planning_provider_audit
        controller._decision_audit = decision_audit
        controller._state = snapshot.state
        controller._proposal = snapshot.proposal
        controller._requested = snapshot.requested
        controller._attempted_request_values = snapshot.attempted_requests
        controller._pending_intervention_id = snapshot.pending_intervention_id
        controller._pending_execution_id = snapshot.pending_execution_id
        controller._cancel_requested = snapshot.cancel_requested
        controller._planning_only_turns = snapshot.planning_only_turns
        controller._incumbent_candidate_root_ref = snapshot.incumbent_candidate_root_ref
        controller._incumbent_candidate_manifest_ref = snapshot.incumbent_candidate_manifest_ref
        controller._incumbent_candidate_manifest_sha256 = (
            snapshot.incumbent_candidate_manifest_sha256
        )

        if replay.pending_intervention_ids:
            controller._budget = controller._consume(candidates=0, minimum_candidates=len(replay.pending_intervention_ids))
            controller._state = OptimizationEpisodeState.QUARANTINED
            controller._proposal = None
            controller._persist()
        return controller

    def _planning_context(
        self,
        observation: StageObservation,
        retrieval: OptimizationRetrievalResult,
        current_values: Mapping[str, bool | int | float],
    ) -> OptimizationPlanningContext:
        history = self._history(include_receipts=self.receipt_aware_planning)
        attempted = self._attempted_requests()
        cards = load_parameter_cards()
        native_receipts = self._native_receipts() if self.receipt_aware_planning else ()
        effective_domains = tuple(
            compile_effective_domain(
                cards[knob_id],
                context=self._effective_domain_context(
                    observation,
                    current_values,
                    knob_id,
                    cards[knob_id].tool.revision,
                    cards[knob_id].surface.unit,
                    card_hash(cards[knob_id]),
                ),
                receipts=native_receipts,
                attempted=attempted,
                baseline_surface_value=current_values.get(knob_id.value),
            )
            for knob_id in ACTIVE_OPTIMIZATION_KNOBS
        )
        ineffective_requests = tuple(
            RequestedKnobValue(knob_id=domain.knob_id, value=value)
            for domain in effective_domains
            for value in domain.excluded_aliases
        )
        task_memory = (
            self._task_memory_supplier()
            if self.receipt_aware_planning and self._task_memory_supplier is not None
            else None
        )
        if task_memory is not None and (
            not isinstance(task_memory, OptimizationTaskMemorySnapshot)
            or task_memory.scope.scope_sha256 != self._task_memory_scope_sha256
            or task_memory.scope.episode_id != self.episode_id
            or task_memory.scope.checkpoint_id != self.checkpoint_id
            or (
                self._objective is not None
                and task_memory.scope.objective_contract_sha256
                != self._objective.contract_sha256
            )
        ):
            raise OptimizationEpisodeControllerError(
                "task memory snapshot does not match the episode"
            )
        available_actions = legal_actions(
            current_values=current_values,
            attempted=self._attempted_requests(),
            known_aliases=ineffective_requests,
        )
        observation_ref = ObservationReference(
            observation_id=observation.observation_id,
            sha256=canonical_sha256(observation.model_dump(mode="json")),
        )
        if self.mode == OptimizationAgentMode.LLM_NO_KNOWLEDGE:
            knowledge_refs: tuple[KnowledgeReference, ...] = ()
            knowledge_chunks: tuple[str, ...] = ()
        else:
            knowledge_refs = retrieval.knowledge_refs
            knowledge_chunks = tuple(
                channel.answer_text
                for channel in retrieval.channels
                if channel.answer_text is not None
            )
        context_ref = ProposalContextRef(
            episode_id=self.episode_id,
            checkpoint_id=self.checkpoint_id,
            input_sha256=canonical_sha256(
                {
                    "observation_ref": observation_ref.model_dump(mode="json"),
                    "incumbent": (
                        self._incumbent.model_dump(mode="json")
                        if self._incumbent is not None
                        else None
                    ),
                    "retrieval": retrieval.contract,
                    "objective": (
                        self._objective.model_dump(mode="json")
                        if self._objective is not None
                        else None
                    ),
                    "budget": self._budget.model_dump(mode="json"),
                    "current_values": dict(sorted(current_values.items())),
                    "legal_actions": [
                        item.model_dump(mode="json") for item in available_actions
                    ],
                    "ledger_head": self.ledger.replay().chain_head_sha256,
                    "history": [_history_payload(item) for item in history],
                    "known_ineffective_requests": [
                        item.model_dump(mode="json") for item in ineffective_requests
                    ],
                    "task_memory": (
                        task_memory.model_dump(mode="json")
                        if task_memory is not None
                        else None
                    ),
                    "effective_domains": [
                        item.model_dump(mode="json") for item in effective_domains
                    ],
                }
            ),
        )
        return OptimizationPlanningContext(
            context_ref,
            observation_ref,
            self._incumbent,
            history,
            knowledge_refs,
            knowledge_chunks,
            observation,
            self._budget,
            dict(current_values),
            available_actions,
            self._objective,
            task_memory,
            ineffective_requests,
            effective_domains,
        )

    def _effective_domain_context(
        self,
        observation: StageObservation,
        current_values: Mapping[str, bool | int | float],
        knob_id: OptimizationKnob,
        tool_revision: str,
        unit: str,
        parameter_card_sha256: str,
    ) -> dict[str, object]:
        """Build the stable, per-knob context used to bind domain evidence."""
        parent_lineage = (
            self._execution_context.get("parent_lineage_sha256")
            or self._parent_manifest_sha256
            or canonical_sha256(
                {"episode_id": self.episode_id, "checkpoint_id": self.checkpoint_id}
            )
        )
        incumbent_state = (
            self._incumbent.model_dump(mode="json") if self._incumbent is not None else None
        )
        context = {
            **self._execution_context,
            "design_sha256": self._execution_context.get(
                "design_sha256", observation.evidence_manifest_sha256
            ),
            "parent_lineage_sha256": parent_lineage,
            "incumbent_state_sha256": canonical_sha256(incumbent_state),
            "stage": _stage_name(knob_id),
            "backend": self._execution_context.get("backend", "ecc"),
            "tool_revision": tool_revision,
            "parameter_card_sha256": parameter_card_sha256,
            "lattice_version": LATTICE_VERSION,
            "unit": unit,
            "site_width_dbu": self._execution_context.get("site_width_dbu", 1),
            "seed": self._execution_context.get("seed", 0),
            "current_values": dict(sorted(current_values.items())),
            "terminal_execution_contract_sha256": canonical_sha256(
                {
                    "episode_id": self.episode_id,
                    "checkpoint_id": self.checkpoint_id,
                    "target_step": _stage_name(knob_id),
                    "end_step": "Harden",
                    "execution_scope": "full_flow",
                }
            ),
        }
        context["tool_revision"] = tool_revision
        context["parameter_card_sha256"] = parameter_card_sha256
        context["unit"] = unit
        return context

    def _native_receipts(self) -> tuple[ParameterApplicationReceipt, ...]:
        return tuple(
            outcome.parameter_application_receipt
            for outcome in self.ledger.replay().terminal_outcomes
            if outcome.parameter_application_receipt is not None
        )

    def _parse_proposal(self, payload: object) -> OptimizationProposal:
        if isinstance(payload, OptimizationProposal):
            return payload
        return OptimizationProposal.model_validate(payload)

    def _v2_enabled(self) -> bool:
        configured = getattr(self.planner, "optimization_proposal_v2_enabled", None)
        enabled = (
            configured
            if isinstance(configured, bool)
            else os.environ.get("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "0") == "1"
        )
        return enabled and callable(getattr(self.planner, "propose_v2", None))

    def _v2_domain(self, context: OptimizationPlanningContext) -> EffectiveDomainSnapshot:
        if not context.effective_domains or not context.legal_actions:
            raise EffectiveDomainError("v2 planning domain is unavailable")
        for action in context.legal_actions:
            for domain in context.effective_domains:
                if domain.knob_id == action.knob_id and domain.allowed_requested_values:
                    return domain
        raise EffectiveDomainError("v2 planning domain has no legal action")

    def _v2_provider_payload_sha256(self, context: OptimizationPlanningContext) -> str:
        domain = self._v2_domain(context)
        payload = planning_context_payload(context)
        payload["effective_domain"] = domain.model_dump(mode="json")
        return canonical_sha256(payload)

    def _invoke_planner(self, context: OptimizationPlanningContext) -> _PlannerTurn:
        if not self._v2_enabled():
            return _PlannerTurn(self._parse_proposal(self.planner.propose(context)))
        domain = self._v2_domain(context)
        raw = self.planner.propose_v2(context, domain)
        proposal = validate_optimization_proposal_v2(
            raw,
            domain,
            context_ref=context.context_ref.model_dump(mode="json"),
            attempted=self._attempted_requests(),
        )
        if proposal.action is not None and not any(
            item.knob_id == proposal.action.knob_id
            and item.direction == proposal.action.direction
            for item in context.legal_actions
        ):
            raise EffectiveDomainError("v2 proposal action is not legal")
        return _PlannerTurn(
            self._v2_to_v1(proposal),
            (
                RequestedKnobValue(
                    knob_id=proposal.action.knob_id,
                    value=proposal.action.requested_value,
                )
                if proposal.action is not None
                else None
            ),
            self._v2_provider_payload_sha256(context),
        )

    @staticmethod
    def _v2_to_v1(proposal: OptimizationProposalV2) -> OptimizationProposal:
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
                    item.model_dump(mode="json") for item in proposal.action.expected_effects
                ],
            }
        return OptimizationProposal.model_validate(payload)

    def _validate_proposal(
        self,
        proposal: OptimizationProposal,
        context: OptimizationPlanningContext,
    ) -> str | None:
        if proposal.context_ref != context.context_ref:
            return "context_reference"
        if tuple(proposal.observation_refs) != (context.observation_ref,):
            return "observation_reference"
        if not self._history_refs_are_current(proposal, context):
            return "history_reference"
        proposed_knowledge = _knowledge_keys(proposal.knowledge_refs)
        available_knowledge = _knowledge_keys(context.knowledge_refs)
        if self.mode == OptimizationAgentMode.LLM_NO_KNOWLEDGE and proposed_knowledge:
            return "no_knowledge_reference"
        if not proposed_knowledge.issubset(available_knowledge):
            return "knowledge_reference"
        proposed_memory = {
            item.summary_sha256 for item in proposal.task_memory_refs
        }
        available_memory = (
            {
                item.reference.summary_sha256
                for item in context.task_memory.summaries
            }
            if context.task_memory is not None
            else set()
        )
        if not proposed_memory.issubset(available_memory):
            return "task_memory_reference"
        if proposal.decision == OptimizationDecision.PROPOSE:
            if self.mode == OptimizationAgentMode.FULL_AGENT and not proposed_knowledge:
                return "knowledge_reference"
            if proposal.action is None:
                return "proposal_action"
        return None

    def _history_refs_are_current(
        self,
        proposal: OptimizationProposal,
        context: OptimizationPlanningContext,
    ) -> bool:
        available = {
            (item.reference.intervention_id, item.reference.outcome_sha256)
            for item in context.history
        }
        return all((item.intervention_id, item.outcome_sha256) in available for item in proposal.history_refs)

    def _history(
        self, *, include_receipts: bool = True
    ) -> tuple[OptimizationHistory, ...]:
        replay = self.ledger.replay()
        starts = {
            entry.payload.intervention_id: entry.payload
            for entry in replay.entries
            if isinstance(entry.payload, OptimizationInterventionStart)
        }
        history = []
        for outcome in replay.terminal_outcomes:
            start = starts[outcome.intervention_id]
            if start.proposal_action is None or start.requested is None:
                continue
            history.append(
                OptimizationHistory(
                    reference=HistoryReference(
                        intervention_id=outcome.intervention_id,
                        outcome_sha256=canonical_sha256(outcome.model_dump(mode="json")),
                    ),
                    outcome=outcome.outcome,
                    action=start.proposal_action,
                    requested=start.requested,
                    terminal_observation=outcome.terminal_observation,
                    application_receipt=(
                        outcome.application_receipt if include_receipts else None
                    ),
                    parameter_application_receipt=(
                        outcome.parameter_application_receipt
                        if include_receipts
                        else None
                    ),
                )
            )
        return tuple(history[-6:])

    def _start_once_with_retry(
        self,
        request: CandidateExecutionRequest,
    ) -> CandidateExecutionReceipt | None:
        for _ in range(2):
            try:
                receipt = self.executor.start(request)
            except Exception as exc:
                raise OptimizationEpisodeControllerError("fake execution adapter failed") from exc
            if not isinstance(receipt, CandidateExecutionReceipt):
                raise OptimizationEpisodeControllerError("fake execution receipt is invalid")
            if receipt.started:
                return receipt
        return None

    def _ledger_start(self, request: CandidateExecutionRequest) -> OptimizationInterventionStart:
        proposal_sha256 = canonical_sha256(request.proposal.model_dump(mode="json"))
        target_step = _TARGET_STEPS[request.requested.knob_id]
        execution_scope = "full_flow"
        end_step = "Harden"
        execution_contract_sha256 = canonical_sha256(
            {
                "intervention_id": request.intervention_id,
                "episode_id": request.episode_id,
                "checkpoint_id": request.checkpoint_id,
                "proposal_sha256": proposal_sha256,
                "objective_contract_sha256": (
                    self._objective.contract_sha256 if self._objective is not None else None
                ),
                "requested": request.requested.model_dump(mode="json"),
                "parent_candidate_root_ref": request.parent_candidate_root_ref,
                "target_step": target_step,
                "end_step": end_step,
                "execution_scope": execution_scope,
            }
        )
        return OptimizationInterventionStart(
            intervention_id=request.intervention_id,
            parent_checkpoint_id=self.checkpoint_id,
            candidate_checkpoint_id=f"candidate-{request.intervention_id}",
            parameter_before_sha256=canonical_sha256({"checkpoint_id": self.checkpoint_id}),
            parameter_after_sha256=canonical_sha256(
                {
                    "checkpoint_id": self.checkpoint_id,
                    "requested": request.requested.model_dump(mode="json"),
                }
            ),
            proposal_sha256=proposal_sha256,
            execution_contract_sha256=execution_contract_sha256,
            parent_manifest_sha256=canonical_sha256(
                {"checkpoint_id": self.checkpoint_id, "episode_id": self.episode_id}
            )
            if self._parent_manifest_sha256 is None
            else self._parent_manifest_sha256,
            environment_sha256=canonical_sha256(
                {
                    "mode": self.mode.value,
                    "receipt_aware_planning": self.receipt_aware_planning,
                }
            ),
            objective_contract_sha256=(
                self._objective.contract_sha256 if self._objective is not None else None
            ),
            proposal_action=request.proposal.action,
            requested=request.requested,
            target_step=target_step,
            end_step=end_step,
            execution_scope=execution_scope,
        )

    def _complete(
        self,
        outcome: OptimizationOutcomeKind,
        receipt: CandidateExecutionReceipt,
        terminal_observation: TerminalObservation | None = None,
        *,
        incumbent_decision: str | None = None,
        decisive_metric: SelectionMetric | None = None,
    ) -> OptimizationControlResult:
        if self._pending_intervention_id is None:
            raise OptimizationEpisodeControllerError("terminal receipt has no pending intervention")
        if receipt.application_receipt is not None and (
            self._requested is None
            or receipt.application_receipt.requested != self._requested
        ):
            raise OptimizationEpisodeControllerError(
                "terminal application receipt does not match requested value"
            )
        if receipt.parameter_application_receipt is not None:
            native_requested = receipt.parameter_application_receipt.requested
            if (
                self._requested is None
                or native_requested.get("knob_id") != self._requested.knob_id.value
                or native_requested.get("value") != self._requested.value
            ):
                raise OptimizationEpisodeControllerError(
                    "terminal parameter receipt does not match requested value"
                )
        if receipt.evidence is not None and self._requested is not None:
            expected_contract = (_TARGET_STEPS[self._requested.knob_id], "Harden", "full_flow")
            observed_contract = (
                receipt.evidence.target_step,
                receipt.evidence.end_step,
                receipt.evidence.execution_scope,
            )
            if any(value is not None for value in observed_contract) and observed_contract != expected_contract:
                raise OptimizationEpisodeControllerError(
                    "terminal candidate evidence execution contract does not match"
                )
        details = {
            "execution_id": receipt.execution_id,
            "started": receipt.started,
            "outcome": outcome.value,
        }
        if receipt.evidence is not None:
            details["candidate_root_ref"] = receipt.evidence.candidate_root_ref
            details["candidate_manifest_ref"] = receipt.evidence.candidate_manifest_ref
            details["candidate_manifest_sha256"] = receipt.evidence.candidate_manifest_sha256
            details["target_step"] = receipt.evidence.target_step
            details["end_step"] = receipt.evidence.end_step
            details["execution_scope"] = receipt.evidence.execution_scope
        if receipt.application_receipt is not None:
            details["knob_application_receipt"] = receipt.application_receipt.model_dump(
                mode="json"
            )
        if receipt.parameter_application_receipt is not None:
            details["parameter_application_receipt"] = receipt.parameter_application_receipt.model_dump(
                mode="json"
            )
        if terminal_observation is not None:
            details["terminal_observation_sha256"] = canonical_sha256(
                terminal_observation.model_dump(mode="json")
            )
        if incumbent_decision is not None:
            details["incumbent_decision"] = incumbent_decision
        if decisive_metric is not None:
            details["decisive_metric"] = decisive_metric.value
        self.ledger.append_terminal(
            OptimizationTerminalOutcome(
                intervention_id=self._pending_intervention_id,
                outcome=outcome,
                candidate_manifest_sha256=(
                    receipt.evidence.candidate_manifest_sha256
                    if receipt.evidence is not None
                    else canonical_sha256(details)
                ),
                candidate_root_ref=(
                    receipt.evidence.candidate_root_ref
                    if receipt.evidence is not None
                    else None
                ),
                candidate_manifest_ref=(
                    receipt.evidence.candidate_manifest_ref
                    if receipt.evidence is not None
                    else None
                ),
                receipt_sha256=(
                    receipt.parameter_application_receipt.evidence_sha256
                    if receipt.parameter_application_receipt is not None
                    else canonical_sha256(details)
                ),
                terminal_observation_sha256=(
                    canonical_sha256(terminal_observation.model_dump(mode="json"))
                    if terminal_observation is not None
                    else None
                ),
                terminal_observation=terminal_observation,
                application_receipt=receipt.application_receipt,
                parameter_application_receipt=receipt.parameter_application_receipt,
                parameter_card_sha256=(
                    card_hash(load_parameter_cards()[self._requested.knob_id])
                    if receipt.parameter_application_receipt is not None and self._requested is not None
                    else None
                ),
                materialization_receipt_sha256=(
                    receipt.parameter_application_receipt.materialization.receipt_sha256
                    if receipt.parameter_application_receipt is not None
                    else None
                ),
                parameter_application_receipt_id=(
                    receipt.parameter_application_receipt.receipt_id
                    if receipt.parameter_application_receipt is not None
                    else None
                ),
                incumbent_decision=incumbent_decision,
                decisive_metric=decisive_metric,
                outcome_details_sha256=canonical_sha256(details),
                target_step=_TARGET_STEPS[self._requested.knob_id] if self._requested else "place",
                end_step="Harden",
                execution_scope="full_flow",
            )
        )
        self._pending_intervention_id = None
        self._pending_execution_id = None
        self._cancel_requested = False
        self._proposal = None
        self._requested = None
        self._state = (
            OptimizationEpisodeState.QUARANTINED
            if outcome == OptimizationOutcomeKind.INDETERMINATE
            else OptimizationEpisodeState.PLANNING
        )
        self._persist()
        return self._result()

    def _quarantine_indeterminate(self) -> OptimizationControlResult:
        receipt = CandidateExecutionReceipt(
            execution_id=self._pending_execution_id or "unknown-execution",
            started=True,
            outcome=OptimizationOutcomeKind.INDETERMINATE,
        )
        return self._complete(OptimizationOutcomeKind.INDETERMINATE, receipt)

    def _next_intervention_id(self) -> str:
        return f"intervention-{len(self.ledger.replay().entries) + 1}"

    def _record_planning_provider_evidence(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        *,
        expected_payload_sha256: str | None = None,
    ) -> None:
        consume = getattr(self.planner, "consume_planning_evidence", None)
        if consume is None:
            return
        if not callable(consume):
            raise OptimizationEpisodeControllerError("planner evidence reader is invalid")
        evidence = consume()
        if evidence is None:
            return
        try:
            parsed = PlanningProviderEvidence.model_validate(evidence)
        except (TypeError, ValidationError, ValueError) as exc:
            raise OptimizationEpisodeControllerError("planner evidence is invalid") from exc
        expected_hash = expected_payload_sha256 or planning_entry.planner_payload_sha256
        if parsed.envelope.planner_payload_sha256 != expected_hash:
            raise OptimizationEpisodeControllerError(
                "planner evidence does not match the planning payload"
            )
        self._planning_provider_audit.append(
            planning_entry_sha256=planning_entry.entry_sha256,
            evidence=parsed,
        )
        self._persist()

    def _defer_or_fallback(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        context: OptimizationPlanningContext,
        *,
        proposal: OptimizationProposal | None,
        reason: str,
        planner_source: Literal["llm", "local_fallback", "repair"] = "llm",
        immediate_fallback: bool = False,
    ) -> OptimizationControlResult:
        self._planning_only_turns += 1
        self._proposal = None
        self._requested = None
        if not context.legal_actions:
            self._state = OptimizationEpisodeState.STOPPED
            return self._finish_planning(
                planning_entry, proposal, "rejected", "no_legal_candidate"
            )
        if (
            not immediate_fallback
            and self._planning_only_turns < self._budget.budget.max_planning_only_turns
        ):
            self._state = OptimizationEpisodeState.PLANNING
            return self._finish_planning(
                planning_entry,
                proposal,
                "rejected",
                reason,
                planner_source=planner_source,
            )

        action = context.legal_actions[0]
        fallback = self._fallback_proposal(context, action)
        assert fallback.action is not None
        requested = select_requested_value(
            fallback.action,
            current_values=context.current_values or {},
            attempted=self._attempted_requests(),
            known_aliases=context.known_ineffective_requests,
        )
        if requested is None:
            raise OptimizationEpisodeControllerError("local fallback has no legal value")
        self._proposal = fallback
        self._requested = requested
        self._planning_only_turns = 0
        self._state = OptimizationEpisodeState.AWAITING_EXECUTION
        return self._finish_planning(
            planning_entry,
            fallback,
            "fallback",
            reason if immediate_fallback else "controlled_coordinate_fallback",
            planner_source="local_fallback",
        )

    @staticmethod
    def _fallback_proposal(
        context: OptimizationPlanningContext,
        action: LegalAction,
    ) -> OptimizationProposal:
        return OptimizationProposal(
            context_ref=context.context_ref,
            decision=OptimizationDecision.PROPOSE,
            reason_code=ProposalReason.INSUFFICIENT_EVIDENCE,
            rationale_summary="Local controlled-coordinate fallback after bounded planning-only turns.",
            observation_refs=(context.observation_ref,),
            history_refs=tuple(item.reference for item in context.history),
            knowledge_refs=(),
            action=ProposalAction(
                knob_id=action.knob_id,
                direction=action.direction,
                expected_effects=(
                    ExpectedEffect(
                        metric_id=ObjectiveMetric.ROUTE_WIRELENGTH,
                        direction=ExpectedEffectDirection.UNKNOWN,
                    ),
                ),
            ),
        )

    def _finish_planning(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        proposal: OptimizationProposal | None,
        validation_result: DecisionValidationResult,
        rejection_reason: str | None,
        *,
        planner_source: Literal["llm", "local_fallback", "repair"] = "llm",
    ) -> OptimizationControlResult:
        self._decision_audit.append(
            planning_entry_sha256=planning_entry.entry_sha256,
            proposal=proposal,
            validation_result=validation_result,
            rejection_reason=rejection_reason,
            requested=self._requested,
            state=self._state,
            objective_contract_sha256=(
                self._objective.contract_sha256 if self._objective is not None else None
            ),
            planner_source=planner_source,
        )
        self._persist()
        return OptimizationControlResult(
            self._state,
            (
                self._proposal
                if self._proposal is not None
                else proposal
                if validation_result == "accepted"
                or rejection_reason
                in {
                    "minimum_candidates_not_met",
                    "planner_continue",
                    "no_legal_candidate",
                }
                else None
            ),
            self._requested,
            rejection_reason,
            planner_source,
        )

    def _result(self, rejection_reason: str | None = None) -> OptimizationControlResult:
        return OptimizationControlResult(
            self._state,
            self._proposal,
            self._requested,
            rejection_reason,
            "llm",
        )

    def _attempted_requests(self) -> tuple[RequestedKnobValue, ...]:
        return self._attempted_request_values

    def _refresh_budget(self) -> None:
        elapsed = max(self._budget.elapsed_wall_time_seconds, self._valid_clock() - self._started_at)
        if not math.isclose(elapsed, self._budget.elapsed_wall_time_seconds, abs_tol=1e-9):
            self._budget = self._budget.model_copy(update={"elapsed_wall_time_seconds": elapsed})

    def _consume(
        self,
        *,
        candidates: int = 0,
        planning_calls: int = 0,
        minimum_candidates: int = 0,
    ) -> BudgetSnapshot:
        return self._budget.model_copy(
            update={
                "consumed_candidates": max(
                    self._budget.consumed_candidates + candidates, minimum_candidates
                ),
                "consumed_planning_calls": self._budget.consumed_planning_calls + planning_calls,
            }
        )

    def _valid_clock(self) -> float:
        value = self._clock()
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise OptimizationEpisodeControllerError("controller clock is invalid")
        return float(value)

    def _persist(self) -> None:
        replay = self.ledger.replay()
        planning_audit = self._planning_audit.replay()
        planning_provider_audit = self._planning_provider_audit.replay()
        decision_audit = self._decision_audit.replay()
        value = {
            "schema_version": "ecos.optimization_episode_state.v6",
            "episode_id": self.episode_id,
            "checkpoint_id": self.checkpoint_id,
            "mode": self.mode.value,
            "state": self._state.value,
            "budget": self._budget.model_dump(mode="json"),
            "incumbent": self._incumbent.model_dump(mode="json") if self._incumbent else None,
            "objective": self._objective.model_dump(mode="json") if self._objective else None,
            "parent_manifest_sha256": self._parent_manifest_sha256,
            "started_at": self._started_at,
            "ledger_event_count": len(replay.entries),
            "ledger_chain_head_sha256": replay.chain_head_sha256,
            "planning_audit_event_count": len(planning_audit.entries),
            "planning_audit_chain_head_sha256": planning_audit.chain_head_sha256,
            "planning_provider_audit_event_count": len(planning_provider_audit.entries),
            "planning_provider_audit_chain_head_sha256": planning_provider_audit.chain_head_sha256,
            "decision_audit_event_count": len(decision_audit.entries),
            "decision_audit_chain_head_sha256": decision_audit.chain_head_sha256,
            "planning_only_turns": self._planning_only_turns,
            "incumbent_candidate_root_ref": self._incumbent_candidate_root_ref,
            "incumbent_candidate_manifest_ref": self._incumbent_candidate_manifest_ref,
            "incumbent_candidate_manifest_sha256": self._incumbent_candidate_manifest_sha256,
            "proposal": self._proposal.model_dump(mode="json") if self._proposal else None,
            "requested": self._requested.model_dump(mode="json") if self._requested else None,
            "attempted_requests": [
                request.model_dump(mode="json") for request in self._attempted_request_values
            ],
            "pending_intervention_id": self._pending_intervention_id,
            "pending_execution_id": self._pending_execution_id,
            "cancel_requested": self._cancel_requested,
        }
        if not self.receipt_aware_planning:
            value["receipt_aware_planning"] = False
        if self._task_memory_scope_sha256 is not None:
            value["task_memory_scope_sha256"] = self._task_memory_scope_sha256
        value["state_sha256"] = canonical_sha256(value)
        _PersistedEpisodeState.model_validate(value)
        _write_json_atomic(self.state_path, value)

    @staticmethod
    def _verify_snapshot_trace(
        snapshot: _PersistedEpisodeState,
        replay: OptimizationLedgerReplay,
        planning_audit: OptimizationPlanningAuditReplay,
        planning_provider_audit: OptimizationPlanningProviderEvidenceReplay,
        decision_audit: OptimizationDecisionAuditReplay,
    ) -> None:
        if (
            snapshot.ledger_event_count != len(replay.entries)
            or snapshot.ledger_chain_head_sha256 != replay.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError("episode state does not match ledger trace")
        if (
            snapshot.planning_audit_event_count != len(planning_audit.entries)
            or snapshot.planning_audit_chain_head_sha256 != planning_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError("episode state does not match planning audit trace")
        if (
            snapshot.planning_provider_audit_event_count != len(planning_provider_audit.entries)
            or snapshot.planning_provider_audit_chain_head_sha256
            != planning_provider_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match planning provider audit trace"
            )
        if (
            snapshot.decision_audit_event_count != len(decision_audit.entries)
            or snapshot.decision_audit_chain_head_sha256 != decision_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match decision audit trace"
            )
        known_planning_entries = {entry.entry_sha256 for entry in planning_audit.entries}
        if any(
            entry.planning_entry_sha256 not in known_planning_entries
            for entry in planning_provider_audit.entries
        ):
            raise OptimizationEpisodeControllerError(
                "planning provider evidence does not match planning audit trace"
            )
        if any(
            entry.planning_entry_sha256 not in known_planning_entries
            for entry in decision_audit.entries
        ):
            raise OptimizationEpisodeControllerError(
                "planning decisions do not match planning audit trace"
            )
        objective_sha256 = (
            snapshot.objective.contract_sha256 if snapshot.objective is not None else None
        )
        if any(
            entry.payload.objective_contract_sha256 != objective_sha256
            for entry in replay.entries
            if isinstance(entry.payload, OptimizationInterventionStart)
        ):
            raise OptimizationEpisodeControllerError(
                "outcome ledger does not match the frozen objective"
            )
        if any(
            entry.objective_contract_sha256 != objective_sha256
            for entry in decision_audit.entries
        ):
            raise OptimizationEpisodeControllerError(
                "decision audit does not match the frozen objective"
            )
        if tuple(replay.pending_intervention_ids) != _pending_tuple(snapshot.pending_intervention_id):
            raise OptimizationEpisodeControllerError("episode pending execution does not match ledger trace")


def _knowledge_keys(references: tuple[KnowledgeReference, ...]) -> set[tuple[str, str]]:
    return {(reference.entity_id, reference.chunk_sha256) for reference in references}


def _stage_name(knob_id: OptimizationKnob) -> str:
    if knob_id in {
        OptimizationKnob.FLOORPLAN_CORE_UTIL,
        OptimizationKnob.FLOORPLAN_ASPECT_RATIO,
    }:
        return "Floorplan"
    if knob_id == OptimizationKnob.SYNTH_MAX_FANOUT:
        return "fixFanout"
    return "place"


def _pending_tuple(intervention_id: str | None) -> tuple[str, ...]:
    return () if intervention_id is None else (intervention_id,)


def _write_json_atomic(destination: Path, value: object) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise
