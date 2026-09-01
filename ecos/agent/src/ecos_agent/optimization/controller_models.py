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
    planner_source: Literal["llm", "local_fallback", "repair"] = "llm"


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
    knowledge_case_shots: Literal[0, 3] = Field(
        default=0, exclude_if=lambda value: value == 0
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
    attempted_requests: tuple[RequestedKnobValue, ...] = ()
    pending_intervention_id: str | None = None
    pending_execution_id: str | None = None
    cancel_requested: bool = False
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
        if self.state_sha256 != canonical_sha256(
            self.model_dump(mode="json", exclude={"state_sha256"})
        ):
            raise ValueError("state hash is invalid")
        return self
