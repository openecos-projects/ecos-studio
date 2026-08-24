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

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    ExpectedEffect,
    ExpectedEffectDirection,
    HistoryReference,
    ObjectiveMetric,
    KnowledgeReference,
    LegalAction,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
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
    OptimizationPlanningAudit,
    OptimizationPlanningAuditEntry,
    OptimizationPlanningAuditReplay,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationPlanningProviderEvidenceReplay,
    OptimizationLedgerReplay,
    OptimizationOutcomeKind,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization_retrieval import OptimizationRetrievalResult
from ecos_agent.optimization_rules import legal_actions, select_requested_value

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_STATE_FILE = "optimization-episode-state.v6.json"
_LEGACY_STATE_FILES = (
    "optimization-episode-state.v2.json",
    "optimization-episode-state.v3.json",
    "optimization-episode-state.v4.json",
    "optimization-episode-state.v5.json",
)


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

    def __post_init__(self) -> None:
        if not _ID.fullmatch(self.execution_id):
            raise ValueError("execution receipt id is invalid")
        if not isinstance(self.started, bool):
            raise ValueError("execution receipt started flag is invalid")
        if self.outcome is not None and not isinstance(self.outcome, OptimizationOutcomeKind):
            raise ValueError("execution receipt outcome is invalid")
        if self.evidence is not None and not isinstance(self.evidence, CandidateExecutionEvidence):
            raise ValueError("execution receipt evidence is invalid")


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


@dataclass(frozen=True)
class OptimizationHistory:
    """A bounded, typed prior intervention exposed to the next planner turn."""

    reference: HistoryReference
    outcome: OptimizationOutcomeKind
    action: ProposalAction
    requested: RequestedKnobValue
    terminal_observation: TerminalObservation | None = None


def planning_context_payload(context: OptimizationPlanningContext) -> dict[str, object]:
    """Return the canonical JSON payload exposed to a planner implementation."""
    payload: dict[str, object] = {
        "context_ref": context.context_ref.model_dump(mode="json"),
        "observation_ref": context.observation_ref.model_dump(mode="json"),
        "incumbent": (
            context.incumbent.model_dump(mode="json") if context.incumbent is not None else None
        ),
        "history": [
            {
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
            for item in context.history
        ],
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
    return payload


@dataclass(frozen=True)
class CandidateExecutionRequest:
    """A fake execution request with no command, path, workspace, or RPC field."""

    intervention_id: str
    episode_id: str
    checkpoint_id: str
    proposal: OptimizationProposal
    requested: RequestedKnobValue


@dataclass(frozen=True)
class OptimizationControlResult:
    state: OptimizationEpisodeState
    proposal: OptimizationProposal | None = None
    requested: RequestedKnobValue | None = None
    rejection_reason: str | None = None


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
    state_sha256: str

    @model_validator(mode="after")
    def validate_state_hash(self) -> "_PersistedEpisodeState":
        if self.parent_manifest_sha256 is not None and not _SHA256.fullmatch(
            self.parent_manifest_sha256
        ):
            raise ValueError("parent manifest hash is invalid")
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
    ) -> None:
        if not _ID.fullmatch(episode_id) or not _ID.fullmatch(checkpoint_id):
            raise OptimizationEpisodeControllerError("episode identifiers are invalid")
        self.episode_id = episode_id
        self.checkpoint_id = checkpoint_id
        self.mode = OptimizationAgentMode(mode)
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
        )
        self._persist()
        try:
            proposal = self._parse_proposal(self.planner.propose(context))
        except (TypeError, ValidationError, ValueError):
            self._record_planning_provider_evidence(planning_entry)
            return self._defer_or_fallback(
                planning_entry,
                context,
                proposal=None,
                reason="proposal_schema",
            )
        self._record_planning_provider_evidence(planning_entry)

        rejection_reason = self._validate_proposal(proposal, context)
        if rejection_reason is not None:
            return self._defer_or_fallback(
                planning_entry,
                context,
                proposal=proposal,
                reason=rejection_reason,
            )
        if proposal.decision != OptimizationDecision.PROPOSE:
            if proposal.decision == OptimizationDecision.ESCALATE:
                self._state = OptimizationEpisodeState.ESCALATED
                return self._finish_planning(planning_entry, proposal, "accepted", None)
            if proposal.decision == OptimizationDecision.STOP and (
                self._budget.consumed_candidates
                >= self._budget.budget.minimum_candidate_executions
                or not context.legal_actions
            ):
                self._state = OptimizationEpisodeState.STOPPED
                return self._finish_planning(planning_entry, proposal, "accepted", None)
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
            )
        assert proposal.action is not None
        requested = select_requested_value(
            proposal.action,
            current_values=current_values,
            attempted=self._attempted_requests(),
        )
        if requested is None:
            return self._defer_or_fallback(
                planning_entry,
                context,
                proposal=proposal,
                reason="no_legal_candidate",
            )
        self._proposal = proposal
        self._requested = requested
        self._planning_only_turns = 0
        self._state = OptimizationEpisodeState.AWAITING_EXECUTION
        return self._finish_planning(planning_entry, proposal, "accepted", None)

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

        controller = cls.__new__(cls)
        controller.episode_id = snapshot.episode_id
        controller.checkpoint_id = snapshot.checkpoint_id
        controller.mode = snapshot.mode
        controller.planner = planner
        controller.executor = executor
        controller.ledger = ledger
        controller._clock = clock
        controller._started_at = snapshot.started_at
        controller._budget = snapshot.budget
        controller._incumbent = snapshot.incumbent
        controller._objective = snapshot.objective
        controller._parent_manifest_sha256 = snapshot.parent_manifest_sha256
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
        history = self._history()
        available_actions = legal_actions(
            current_values=current_values,
            attempted=self._attempted_requests(),
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
                    "history": [
                        {
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
                        for item in history
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
        )

    def _parse_proposal(self, payload: object) -> OptimizationProposal:
        if isinstance(payload, OptimizationProposal):
            return payload
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

    def _history(self) -> tuple[OptimizationHistory, ...]:
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
            environment_sha256=canonical_sha256({"mode": self.mode.value}),
            objective_contract_sha256=(
                self._objective.contract_sha256 if self._objective is not None else None
            ),
            proposal_action=request.proposal.action,
            requested=request.requested,
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
        details = {
            "execution_id": receipt.execution_id,
            "started": receipt.started,
            "outcome": outcome.value,
        }
        if receipt.evidence is not None:
            details["candidate_root_ref"] = receipt.evidence.candidate_root_ref
            details["candidate_manifest_ref"] = receipt.evidence.candidate_manifest_ref
            details["candidate_manifest_sha256"] = receipt.evidence.candidate_manifest_sha256
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
                receipt_sha256=canonical_sha256(details),
                terminal_observation_sha256=(
                    canonical_sha256(terminal_observation.model_dump(mode="json"))
                    if terminal_observation is not None
                    else None
                ),
                terminal_observation=terminal_observation,
                incumbent_decision=incumbent_decision,
                decisive_metric=decisive_metric,
                outcome_details_sha256=canonical_sha256(details),
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
        self, planning_entry: OptimizationPlanningAuditEntry
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
        if parsed.envelope.planner_payload_sha256 != planning_entry.planner_payload_sha256:
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
    ) -> OptimizationControlResult:
        self._planning_only_turns += 1
        self._proposal = None
        self._requested = None
        if not context.legal_actions:
            self._state = OptimizationEpisodeState.STOPPED
            return self._finish_planning(
                planning_entry, proposal, "rejected", "no_legal_candidate"
            )
        if self._planning_only_turns < self._budget.budget.max_planning_only_turns:
            self._state = OptimizationEpisodeState.PLANNING
            return self._finish_planning(planning_entry, proposal, "rejected", reason)

        action = context.legal_actions[0]
        fallback = self._fallback_proposal(context, action)
        assert fallback.action is not None
        requested = select_requested_value(
            fallback.action,
            current_values=context.current_values or {},
            attempted=self._attempted_requests(),
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
            "controlled_coordinate_fallback",
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
        )

    def _result(self, rejection_reason: str | None = None) -> OptimizationControlResult:
        return OptimizationControlResult(
            self._state,
            self._proposal,
            self._requested,
            rejection_reason,
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
