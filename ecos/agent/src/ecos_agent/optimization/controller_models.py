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

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ecos_agent.errors import ProposalProviderError
from ecos_agent.optimization.parameters.effective_domain import (
    EffectiveDomainError,
    compile_effective_domain,
)
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.geometry import GeometrySnapshot
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
    RoutabilityObjectiveContract,
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
from ecos_agent.optimization.objective_alignment import (
    ActiveOptimizationObjective,
    OptimizationObjectiveAlignment,
    build_active_objective,
)
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
    native_receipt_is_effective,
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

class OptimizationEpisodeControllerError(ValueError):
    """An episode cannot safely make the requested state transition."""


class OptimizationAgentMode(StrEnum):
    FULL_AGENT = "full_agent"
    LLM_NO_KNOWLEDGE = "llm_no_knowledge"
    RAW_RAG = "raw_rag"


@dataclass(frozen=True)
class OptimizationControlResult:
    state: OptimizationEpisodeState
    proposal: OptimizationProposal | None = None
    requested: RequestedKnobValue | None = None
    rejection_reason: str | None = None
    planner_source: Literal["llm", "repair"] = "llm"


class _PersistedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AttemptedProbe(_PersistedModel):
    """A dispatched request scoped to the parent configuration it probed."""

    parent_config_sha256: str
    requested: RequestedKnobValue

    @field_validator("parent_config_sha256")
    @classmethod
    def _validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("attempted probe parent hash is invalid")
        return value


class ExecutionBinding(_PersistedModel):
    """Stable execution-id to intervention mapping for idempotent merges."""

    intervention_id: str
    execution_id: str


class PendingExecutionRecord(_PersistedModel):
    """One immutable in-flight candidate bound to its parent snapshot."""

    intervention_id: str
    execution_id: str
    proposal: OptimizationProposal
    proposal_v2: OptimizationProposalV2
    requested: RequestedKnobValue
    context_sha256: str
    planning_entry_sha256: str
    parent_config_sha256: str
    parent_incumbent_sha256: str | None = None
    parent_candidate_root_ref: str | None = None
    cancel_requested: bool = False

    @field_validator("context_sha256", "planning_entry_sha256", "parent_config_sha256")
    @classmethod
    def _validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("pending execution hash is invalid")
        return value

    @field_validator("parent_incumbent_sha256")
    @classmethod
    def _validate_optional_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("pending execution parent hash is invalid")
        return value


class _PersistedEpisodeState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos.optimization_episode_state.v10"] = (
        "ecos.optimization_episode_state.v10"
    )
    episode_id: str
    checkpoint_id: str
    mode: OptimizationAgentMode
    receipt_aware_planning: bool = Field(
        default=True, exclude_if=lambda value: value is True
    )
    knowledge_case_shots: Literal[0, 3] = Field(
        default=0, exclude_if=lambda value: value == 0
    )
    max_in_flight_candidates: Literal[1, 2] = Field(
        default=1, exclude_if=lambda value: value == 1
    )
    state: OptimizationEpisodeState
    budget: BudgetSnapshot
    started_at: float
    incumbent: TerminalObservation | None = None
    baseline_geometry: GeometrySnapshot | None = Field(default=None, exclude_if=lambda value: value is None)
    objective: OptimizationObjectiveContract | None = None
    objective_alignment: OptimizationObjectiveAlignment | None = None
    frozen_objective: RoutabilityObjectiveContract | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    active_objective: ActiveOptimizationObjective | None = None
    parent_manifest_sha256: str | None = None
    ledger_event_count: int = Field(ge=0)
    ledger_chain_head_sha256: str | None = None
    planning_audit_event_count: int = Field(default=0, ge=0)
    planning_audit_chain_head_sha256: str | None = None
    planning_provider_audit_event_count: int = Field(default=0, ge=0)
    planning_provider_audit_chain_head_sha256: str | None = None
    decision_audit_event_count: int = Field(default=0, ge=0)
    decision_audit_chain_head_sha256: str | None = None
    case_audit_event_count: int = Field(
        default=0, ge=0, exclude_if=lambda value: value == 0
    )
    case_audit_chain_head_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    external_case_pool: bool = Field(
        default=False, exclude_if=lambda value: value is False
    )
    case_pool_event_count: int = Field(
        default=0, ge=0, exclude_if=lambda value: value == 0
    )
    case_pool_chain_head_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    planning_only_turns: int = Field(default=0, ge=0)
    incumbent_candidate_root_ref: str | None = None
    incumbent_candidate_manifest_ref: str | None = None
    incumbent_candidate_manifest_sha256: str | None = None
    proposal: OptimizationProposal | None = None
    pending_v2_proposal: OptimizationProposalV2 | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    requested: RequestedKnobValue | None = None
    approved_planning_entry_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    approved_parent_incumbent_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    approved_parent_config_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    attempted_probes: tuple[AttemptedProbe, ...] = ()
    pending_executions: tuple[PendingExecutionRecord, ...] = ()
    execution_bindings: tuple[ExecutionBinding, ...] = ()
    task_memory_scope_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    execution_context_sha256: str
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
        if not _SHA256.fullmatch(self.execution_context_sha256):
            raise ValueError("execution context hash is invalid")
        if self.objective_alignment is not None:
            if self.objective is None or self.incumbent is None:
                raise ValueError("objective alignment requires an objective and incumbent")
            if (
                self.objective_alignment.objective_contract_sha256
                != self.objective.contract_sha256
                or self.active_objective
                != build_active_objective(
                    self.objective_alignment, self.objective, self.incumbent
                )
            ):
                raise ValueError("active objective does not match episode alignment")
        elif self.active_objective is not None:
            raise ValueError("active objective requires objective alignment")
        if self.frozen_objective is not None and self.objective_alignment is None:
            raise ValueError("frozen objective requires objective alignment")
        if self.state_sha256 != canonical_sha256(
            self.model_dump(mode="json", exclude={"state_sha256"})
        ):
            raise ValueError("state hash is invalid")
        return self
