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
from typing import Callable, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ecos_agent.errors import ProposalProviderError
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainError,
    compile_effective_domain,
)
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    ExpectedEffect,
    ExpectedEffectDirection,
    HistoryReference,
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
from ecos_agent.optimization.decision_audit import (
    DecisionValidationResult,
    OptimizationDecisionAudit,
    OptimizationDecisionAuditReplay,
)
from ecos_agent.optimization.execution import (
    CANDIDATE_END_STEP,
    CANDIDATE_EXECUTION_SCOPE,
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
    CandidateExecutionRequest,
    OptimizationExecutionAdapter,
    candidate_target_step,
)
from ecos_agent.optimization.knowledge.compiler import (
    build_state_evidence_request,
    compile_supported_action_view,
)
from ecos_agent.optimization.knowledge.cases import (
    EmpiricalCaseAuditReplay,
    EmpiricalCaseAuditStore,
    EmpiricalCaseDiagnostic,
    EmpiricalOutcome,
    build_empirical_case_audit,
    build_terminal_empirical_case,
    select_empirical_cases,
)
from ecos_agent.optimization.ledger import (
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
from ecos_agent.optimization.memory import OptimizationTaskMemorySnapshot
from ecos_agent.optimization.planning import (
    OptimizationHistory,
    OptimizationPlannerTurn,
    OptimizationPlanningContext,
    OptimizationProposalPlanner,
    optimization_history_payload,
    planning_context_payload,
    v2_domains,
    v2_provider_payload_sha256,
    v2_to_v1,
    validate_planner_proposal,
    validate_v2_proposal,
)
from ecos_agent.optimization.knowledge.retrieval import (
    KnowledgeChannel,
    OptimizationRetrievalResult,
)
from ecos_agent.optimization.rules import (
    ACTIVE_OPTIMIZATION_KNOBS,
    IncumbentComparison,
    IncumbentDecision,
    legal_actions,
    native_receipt_is_effective,
    select_requested_value,
    terminal_candidate_is_promotable,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
    ParameterApplicationReceipt,
)
from ecos_agent.optimization.parameters.semantics import (
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

from ecos_agent.optimization.controller_context import ControllerContextMixin
from ecos_agent.optimization.controller_execution import ControllerExecutionMixin
from ecos_agent.optimization.controller_helpers import _pending_tuple, _write_json_atomic
from ecos_agent.optimization.controller_models import (
    _PersistedEpisodeState,
    OptimizationAgentMode,
    OptimizationControlResult,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.controller_planning import ControllerPlanningMixin


class OptimizationEpisodeController(
    ControllerPlanningMixin,
    ControllerContextMixin,
    ControllerExecutionMixin,
):
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
        task_memory_supplier: Callable[[], OptimizationTaskMemorySnapshot]
        | None = None,
        execution_context: Mapping[str, object] | None = None,
        receipt_aware_planning: bool = True,
        knowledge_case_shots: Literal[0, 3] = 0,
        knowledge_case_pool_root: Path | None = None,
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
        if type(knowledge_case_shots) is not int or knowledge_case_shots not in {0, 3}:
            raise OptimizationEpisodeControllerError(
                "knowledge case shots must be zero or three"
            )
        if mode != OptimizationAgentMode.FULL_AGENT and knowledge_case_shots:
            raise OptimizationEpisodeControllerError(
                "knowledge cases require full-agent mode"
            )
        self.knowledge_case_shots = knowledge_case_shots
        self.planner = planner
        self.executor = executor
        self.ledger = ledger
        self._planning_audit = OptimizationPlanningAudit(ledger.root)
        self._planning_provider_audit = OptimizationPlanningProviderEvidenceAudit(
            ledger.root
        )
        self._decision_audit = OptimizationDecisionAudit(ledger.root)
        self._case_audit = EmpiricalCaseAuditStore(ledger.root)
        self._external_case_pool = knowledge_case_pool_root is not None
        self._case_pool = EmpiricalCaseAuditStore(
            knowledge_case_pool_root
            if knowledge_case_pool_root is not None
            else ledger.root.parent / "knowledge-case-pool",
            read_only=knowledge_case_pool_root is not None,
        )
        pool = self._case_pool.verify()
        if self._external_case_pool and any(case.split != "train" for case in pool.cases):
            raise OptimizationEpisodeControllerError(
                "external knowledge case pool contains a non-training case"
            )
        self._case_pool_event_count = pool.event_count
        self._case_pool_chain_head_sha256 = pool.chain_head_sha256
        self._clock = clock
        self._started_at = self._valid_clock()
        self._budget = budget
        self._incumbent = incumbent
        self._objective = objective
        self._incumbent_candidate_root_ref: str | None = None
        self._incumbent_candidate_manifest_ref: str | None = None
        self._incumbent_candidate_manifest_sha256: str | None = None
        if parent_manifest_sha256 is not None and not _SHA256.fullmatch(
            parent_manifest_sha256
        ):
            raise OptimizationEpisodeControllerError("parent manifest hash is invalid")
        self._parent_manifest_sha256 = parent_manifest_sha256
        if task_memory_scope_sha256 is not None and not _SHA256.fullmatch(
            task_memory_scope_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "task memory scope hash is invalid"
            )
        self._task_memory_scope_sha256 = task_memory_scope_sha256
        self._task_memory_supplier = task_memory_supplier
        self._execution_context = dict(execution_context or {})
        self._state = OptimizationEpisodeState.CREATED
        self._proposal: OptimizationProposal | None = None
        self._pending_v2_proposal: OptimizationProposalV2 | None = None
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
        self._set_incumbent(candidate, evidence)
        self._persist()

    def _set_incumbent(
        self,
        candidate: TerminalObservation,
        evidence: CandidateExecutionEvidence | None,
    ) -> None:
        self._incumbent = candidate
        self._incumbent_candidate_root_ref = (
            evidence.candidate_root_ref if evidence else None
        )
        self._incumbent_candidate_manifest_ref = (
            evidence.candidate_manifest_ref if evidence else None
        )
        self._incumbent_candidate_manifest_sha256 = (
            evidence.candidate_manifest_sha256 if evidence else None
        )

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

    @classmethod
    def recover(
        cls,
        *,
        planner: OptimizationProposalPlanner,
        executor: OptimizationExecutionAdapter,
        ledger: OptimizationLedger,
        clock: Callable[[], float],
        task_memory_scope_sha256: str | None = None,
        task_memory_supplier: Callable[[], OptimizationTaskMemorySnapshot]
        | None = None,
        execution_context: Mapping[str, object] | None = None,
        receipt_aware_planning: bool = True,
        knowledge_case_shots: Literal[0, 3] = 0,
        knowledge_case_pool_root: Path | None = None,
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
            raise OptimizationEpisodeControllerError(
                "episode state hash is invalid"
            ) from exc
        replay = ledger.recover()
        planning_audit = OptimizationPlanningAudit(ledger.root)
        audit_replay = planning_audit.verify()
        planning_provider_audit = OptimizationPlanningProviderEvidenceAudit(ledger.root)
        provider_audit_replay = planning_provider_audit.verify()
        decision_audit = OptimizationDecisionAudit(ledger.root)
        decision_audit_replay = decision_audit.verify()
        case_audit = EmpiricalCaseAuditStore(ledger.root)
        case_audit_replay = case_audit.verify()
        cls._verify_snapshot_trace(
            snapshot,
            replay,
            audit_replay,
            provider_audit_replay,
            decision_audit_replay,
            case_audit_replay,
        )
        if snapshot.task_memory_scope_sha256 != task_memory_scope_sha256:
            raise OptimizationEpisodeControllerError(
                "task memory scope does not match the recovered episode"
            )
        recovered_execution_context = dict(execution_context or {})
        if snapshot.execution_context_sha256 != canonical_sha256(
            recovered_execution_context
        ):
            raise OptimizationEpisodeControllerError(
                "execution context does not match the recovered episode"
            )

        controller = cls.__new__(cls)
        controller.episode_id = snapshot.episode_id
        controller.checkpoint_id = snapshot.checkpoint_id
        controller.mode = snapshot.mode
        if snapshot.knowledge_case_shots != knowledge_case_shots:
            raise OptimizationEpisodeControllerError(
                "knowledge case shots do not match the recovered episode"
            )
        controller.knowledge_case_shots = snapshot.knowledge_case_shots
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
        controller._execution_context = recovered_execution_context
        controller._planning_audit = planning_audit
        controller._planning_provider_audit = planning_provider_audit
        controller._decision_audit = decision_audit
        controller._case_audit = case_audit
        controller._external_case_pool = knowledge_case_pool_root is not None
        controller._case_pool = EmpiricalCaseAuditStore(
            knowledge_case_pool_root
            if knowledge_case_pool_root is not None
            else ledger.root.parent / "knowledge-case-pool",
            read_only=knowledge_case_pool_root is not None,
        )
        pool = controller._case_pool.verify()
        if controller._external_case_pool and any(
            case.split != "train" for case in pool.cases
        ):
            raise OptimizationEpisodeControllerError(
                "external knowledge case pool contains a non-training case"
            )
        if (
            snapshot.external_case_pool != controller._external_case_pool
            or snapshot.case_pool_event_count != pool.event_count
            or snapshot.case_pool_chain_head_sha256 != pool.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "knowledge case pool does not match the recovered episode"
            )
        controller._case_pool_event_count = pool.event_count
        controller._case_pool_chain_head_sha256 = pool.chain_head_sha256
        controller._state = snapshot.state
        controller._proposal = snapshot.proposal
        controller._pending_v2_proposal = snapshot.pending_v2_proposal
        controller._requested = snapshot.requested
        controller._attempted_request_values = snapshot.attempted_requests
        controller._pending_intervention_id = snapshot.pending_intervention_id
        controller._pending_execution_id = snapshot.pending_execution_id
        controller._cancel_requested = snapshot.cancel_requested
        controller._planning_only_turns = snapshot.planning_only_turns
        controller._incumbent_candidate_root_ref = snapshot.incumbent_candidate_root_ref
        controller._incumbent_candidate_manifest_ref = (
            snapshot.incumbent_candidate_manifest_ref
        )
        controller._incumbent_candidate_manifest_sha256 = (
            snapshot.incumbent_candidate_manifest_sha256
        )

        if replay.pending_intervention_ids:
            controller._budget = controller._consume(
                candidates=0, minimum_candidates=len(replay.pending_intervention_ids)
            )
            controller._state = OptimizationEpisodeState.QUARANTINED
            controller._proposal = None
            controller._pending_v2_proposal = None
            controller._persist()
        return controller

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
        elapsed = max(
            self._budget.elapsed_wall_time_seconds,
            self._valid_clock() - self._started_at,
        )
        if not math.isclose(
            elapsed, self._budget.elapsed_wall_time_seconds, abs_tol=1e-9
        ):
            self._budget = self._budget.model_copy(
                update={"elapsed_wall_time_seconds": elapsed}
            )

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
                "consumed_planning_calls": self._budget.consumed_planning_calls
                + planning_calls,
            }
        )

    def _valid_clock(self) -> float:
        value = self._clock()
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
        ):
            raise OptimizationEpisodeControllerError("controller clock is invalid")
        return float(value)

    def _persist(self) -> None:
        replay = self.ledger.replay()
        planning_audit = self._planning_audit.replay()
        planning_provider_audit = self._planning_provider_audit.replay()
        decision_audit = self._decision_audit.replay()
        case_audit = self._case_audit.replay()
        value = {
            "schema_version": "ecos.optimization_episode_state.v6",
            "episode_id": self.episode_id,
            "checkpoint_id": self.checkpoint_id,
            "mode": self.mode.value,
            "state": self._state.value,
            "budget": self._budget.model_dump(mode="json"),
            "incumbent": self._incumbent.model_dump(mode="json")
            if self._incumbent
            else None,
            "objective": self._objective.model_dump(mode="json")
            if self._objective
            else None,
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
            "proposal": self._proposal.model_dump(mode="json")
            if self._proposal
            else None,
            "requested": self._requested.model_dump(mode="json")
            if self._requested
            else None,
            "attempted_requests": [
                request.model_dump(mode="json")
                for request in self._attempted_request_values
            ],
            "pending_intervention_id": self._pending_intervention_id,
            "pending_execution_id": self._pending_execution_id,
            "cancel_requested": self._cancel_requested,
            "execution_context_sha256": canonical_sha256(self._execution_context),
        }
        if not self.receipt_aware_planning:
            value["receipt_aware_planning"] = False
        if self.knowledge_case_shots:
            value["knowledge_case_shots"] = self.knowledge_case_shots
        if case_audit.event_count:
            value["case_audit_event_count"] = case_audit.event_count
            value["case_audit_chain_head_sha256"] = case_audit.chain_head_sha256
        if self._external_case_pool:
            value["external_case_pool"] = True
            if self._case_pool_event_count:
                value["case_pool_event_count"] = self._case_pool_event_count
            if self._case_pool_chain_head_sha256 is not None:
                value["case_pool_chain_head_sha256"] = (
                    self._case_pool_chain_head_sha256
                )
        if self._pending_v2_proposal is not None:
            value["pending_v2_proposal"] = self._pending_v2_proposal.model_dump(
                mode="json"
            )
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
        case_audit: EmpiricalCaseAuditReplay,
    ) -> None:
        if (
            snapshot.ledger_event_count != len(replay.entries)
            or snapshot.ledger_chain_head_sha256 != replay.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match ledger trace"
            )
        if (
            snapshot.planning_audit_event_count != len(planning_audit.entries)
            or snapshot.planning_audit_chain_head_sha256
            != planning_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match planning audit trace"
            )
        if (
            snapshot.planning_provider_audit_event_count
            != len(planning_provider_audit.entries)
            or snapshot.planning_provider_audit_chain_head_sha256
            != planning_provider_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match planning provider audit trace"
            )
        if (
            snapshot.decision_audit_event_count != len(decision_audit.entries)
            or snapshot.decision_audit_chain_head_sha256
            != decision_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match decision audit trace"
            )
        if (
            snapshot.case_audit_event_count != case_audit.event_count
            or snapshot.case_audit_chain_head_sha256 != case_audit.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "episode state does not match empirical case audit trace"
            )
        known_planning_entries = {
            entry.entry_sha256 for entry in planning_audit.entries
        }
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
            snapshot.objective.contract_sha256
            if snapshot.objective is not None
            else None
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
        if tuple(replay.pending_intervention_ids) != _pending_tuple(
            snapshot.pending_intervention_id
        ):
            raise OptimizationEpisodeControllerError(
                "episode pending execution does not match ledger trace"
            )
