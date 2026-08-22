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
from typing import Callable, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    KnowledgeReference,
    ObservationReference,
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationProposal,
    ProposalContextRef,
    StageObservation,
)
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerReplay,
    OptimizationOutcomeKind,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization_retrieval import OptimizationRetrievalResult


_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_STATE_FILE = "optimization-episode-state.v1.json"


class OptimizationEpisodeControllerError(ValueError):
    """An episode cannot safely make the requested state transition."""


class OptimizationAgentMode(StrEnum):
    FULL_AGENT = "full_agent"
    LLM_NO_KNOWLEDGE = "llm_no_knowledge"


@dataclass(frozen=True)
class CandidateExecutionReceipt:
    """The only execution status the M4 fake adapter may return."""

    execution_id: str
    started: bool
    outcome: OptimizationOutcomeKind | None = None

    def __post_init__(self) -> None:
        if not _ID.fullmatch(self.execution_id):
            raise ValueError("execution receipt id is invalid")
        if not isinstance(self.started, bool):
            raise ValueError("execution receipt started flag is invalid")
        if self.outcome is not None and not isinstance(self.outcome, OptimizationOutcomeKind):
            raise ValueError("execution receipt outcome is invalid")


@dataclass(frozen=True)
class OptimizationPlanningContext:
    """The entire, intentionally small input surface exposed to the planner."""

    context_ref: ProposalContextRef
    observation_ref: ObservationReference
    knowledge_refs: tuple[KnowledgeReference, ...]
    knowledge_chunks: tuple[str, ...]


@dataclass(frozen=True)
class CandidateExecutionRequest:
    """A fake execution request with no command, path, workspace, or RPC field."""

    intervention_id: str
    checkpoint_id: str
    proposal: OptimizationProposal


@dataclass(frozen=True)
class OptimizationControlResult:
    state: OptimizationEpisodeState
    proposal: OptimizationProposal | None = None
    rejection_reason: str | None = None


class OptimizationProposalPlanner(Protocol):
    def propose(self, context: OptimizationPlanningContext) -> object: ...


class OptimizationExecutionAdapter(Protocol):
    def start(self, request: CandidateExecutionRequest) -> CandidateExecutionReceipt: ...

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt: ...


class _PersistedEpisodeState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = "ecos.optimization_episode_state.v1"
    episode_id: str
    checkpoint_id: str
    mode: OptimizationAgentMode
    state: OptimizationEpisodeState
    budget: BudgetSnapshot
    started_at: float
    ledger_event_count: int = Field(ge=0)
    ledger_chain_head_sha256: str | None = None
    proposal: OptimizationProposal | None = None
    pending_intervention_id: str | None = None
    pending_execution_id: str | None = None
    cancel_requested: bool = False
    state_sha256: str

    @model_validator(mode="after")
    def validate_state_hash(self) -> "_PersistedEpisodeState":
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
    ) -> None:
        if not _ID.fullmatch(episode_id) or not _ID.fullmatch(checkpoint_id):
            raise OptimizationEpisodeControllerError("episode identifiers are invalid")
        self.episode_id = episode_id
        self.checkpoint_id = checkpoint_id
        self.mode = OptimizationAgentMode(mode)
        self.planner = planner
        self.executor = executor
        self.ledger = ledger
        self._clock = clock
        self._started_at = self._valid_clock()
        self._budget = budget
        self._state = OptimizationEpisodeState.CREATED
        self._proposal: OptimizationProposal | None = None
        self._pending_intervention_id: str | None = None
        self._pending_execution_id: str | None = None
        self._cancel_requested = False
        self._persist()

    @property
    def state(self) -> OptimizationEpisodeState:
        return self._state

    @property
    def budget(self) -> BudgetSnapshot:
        self._refresh_budget()
        return self._budget

    @property
    def state_path(self) -> Path:
        return self.ledger.root / _STATE_FILE

    def plan(
        self,
        observation: StageObservation,
        retrieval: OptimizationRetrievalResult,
    ) -> OptimizationControlResult:
        self._refresh_budget()
        if self._state not in {OptimizationEpisodeState.CREATED, OptimizationEpisodeState.PLANNING}:
            raise OptimizationEpisodeControllerError("episode is not ready for planning")
        if self._budget.exhausted:
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._persist()
            return self._result("budget_exhausted")

        self._state = OptimizationEpisodeState.PLANNING
        self._budget = self._consume(planning_calls=1)
        context = self._planning_context(observation, retrieval)
        self._persist()
        try:
            proposal = self._parse_proposal(self.planner.propose(context))
        except (TypeError, ValidationError, ValueError):
            return self._reject("proposal_schema")

        rejection_reason = self._validate_proposal(proposal, context)
        if rejection_reason is not None:
            return self._reject(rejection_reason)
        if proposal.decision != OptimizationDecision.PROPOSE:
            self._proposal = None
            self._state = {
                OptimizationDecision.CONTINUE: OptimizationEpisodeState.PLANNING,
                OptimizationDecision.STOP: OptimizationEpisodeState.STOPPED,
                OptimizationDecision.ESCALATE: OptimizationEpisodeState.ESCALATED,
            }[proposal.decision]
            self._persist()
            return OptimizationControlResult(self._state, proposal)
        self._proposal = proposal
        self._state = OptimizationEpisodeState.AWAITING_EXECUTION
        self._persist()
        return self._result()

    def execute(self) -> OptimizationControlResult:
        self._refresh_budget()
        if self._state != OptimizationEpisodeState.AWAITING_EXECUTION or self._proposal is None:
            raise OptimizationEpisodeControllerError("episode has no approved proposal to execute")
        if self._budget.exhausted:
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._persist()
            return self._result("budget_exhausted")

        intervention_id = self._next_intervention_id()
        request = CandidateExecutionRequest(intervention_id, self.checkpoint_id, self._proposal)
        try:
            receipt = self._start_once_with_retry(request)
        except OptimizationEpisodeControllerError:
            self._budget = self._consume(candidates=1)
            self._pending_intervention_id = intervention_id
            self._pending_execution_id = "unknown-execution"
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
        try:
            snapshot = _PersistedEpisodeState.model_validate_json(path.read_bytes())
        except (OSError, ValidationError, ValueError) as exc:
            raise OptimizationEpisodeControllerError("episode state hash is invalid") from exc
        replay = ledger.recover()
        cls._verify_snapshot_trace(snapshot, replay)

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
        controller._state = snapshot.state
        controller._proposal = snapshot.proposal
        controller._pending_intervention_id = snapshot.pending_intervention_id
        controller._pending_execution_id = snapshot.pending_execution_id
        controller._cancel_requested = snapshot.cancel_requested

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
    ) -> OptimizationPlanningContext:
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
                    "retrieval": retrieval.contract,
                    "budget": self._budget.model_dump(mode="json"),
                    "ledger_head": self.ledger.replay().chain_head_sha256,
                }
            ),
        )
        return OptimizationPlanningContext(context_ref, observation_ref, knowledge_refs, knowledge_chunks)

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
        if not self._history_refs_are_current(proposal):
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

    def _history_refs_are_current(self, proposal: OptimizationProposal) -> bool:
        outcomes = {
            (outcome.intervention_id, canonical_sha256(outcome.model_dump(mode="json")))
            for outcome in self.ledger.replay().terminal_outcomes
        }
        return all((item.intervention_id, item.outcome_sha256) in outcomes for item in proposal.history_refs)

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
                "checkpoint_id": request.checkpoint_id,
                "proposal_sha256": proposal_sha256,
            }
        )
        return OptimizationInterventionStart(
            intervention_id=request.intervention_id,
            parent_checkpoint_id=self.checkpoint_id,
            candidate_checkpoint_id=f"candidate-{request.intervention_id}",
            parameter_before_sha256=canonical_sha256({"checkpoint_id": self.checkpoint_id}),
            parameter_after_sha256=canonical_sha256({"proposal_sha256": proposal_sha256}),
            proposal_sha256=proposal_sha256,
            execution_contract_sha256=execution_contract_sha256,
            parent_manifest_sha256=canonical_sha256(
                {"checkpoint_id": self.checkpoint_id, "episode_id": self.episode_id}
            ),
            environment_sha256=canonical_sha256({"mode": self.mode.value}),
        )

    def _complete(
        self,
        outcome: OptimizationOutcomeKind,
        receipt: CandidateExecutionReceipt,
    ) -> OptimizationControlResult:
        if self._pending_intervention_id is None:
            raise OptimizationEpisodeControllerError("terminal receipt has no pending intervention")
        details = {
            "execution_id": receipt.execution_id,
            "started": receipt.started,
            "outcome": outcome.value,
        }
        self.ledger.append_terminal(
            OptimizationTerminalOutcome(
                intervention_id=self._pending_intervention_id,
                outcome=outcome,
                candidate_manifest_sha256=canonical_sha256(details),
                receipt_sha256=canonical_sha256(details),
                outcome_details_sha256=canonical_sha256(details),
            )
        )
        self._pending_intervention_id = None
        self._pending_execution_id = None
        self._cancel_requested = False
        self._proposal = None
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

    def _reject(self, reason: str) -> OptimizationControlResult:
        self._state = OptimizationEpisodeState.PLANNING
        self._proposal = None
        self._persist()
        return self._result(reason)

    def _result(self, rejection_reason: str | None = None) -> OptimizationControlResult:
        return OptimizationControlResult(self._state, self._proposal, rejection_reason)

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
        value = {
            "schema_version": "ecos.optimization_episode_state.v1",
            "episode_id": self.episode_id,
            "checkpoint_id": self.checkpoint_id,
            "mode": self.mode.value,
            "state": self._state.value,
            "budget": self._budget.model_dump(mode="json"),
            "started_at": self._started_at,
            "ledger_event_count": len(replay.entries),
            "ledger_chain_head_sha256": replay.chain_head_sha256,
            "proposal": self._proposal.model_dump(mode="json") if self._proposal else None,
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
    ) -> None:
        if (
            snapshot.ledger_event_count != len(replay.entries)
            or snapshot.ledger_chain_head_sha256 != replay.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError("episode state does not match ledger trace")
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
