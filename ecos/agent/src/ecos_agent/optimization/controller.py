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
from ecos_agent.optimization.geometry import GeometrySnapshot
from ecos_agent.optimization.rules import geometry_constraint_error
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
    load_state_rule_manifest,
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
    validate_objective_alignment,
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
    PROMOTING_DECISIONS,
    compare_recovery_incumbent,
    freeze_routability_objective,
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
_STATE_FILE = "optimization-episode-state.v10.json"

from ecos_agent.optimization.controller_cases import ControllerCaseRecordingMixin
from ecos_agent.optimization.controller_context import ControllerContextMixin
from ecos_agent.optimization.controller_execution import ControllerExecutionMixin
from ecos_agent.optimization.controller_helpers import _write_json_atomic
from ecos_agent.optimization.controller_models import (
    AttemptedProbe,
    ExecutionBinding,
    PendingExecutionRecord,
    _PersistedEpisodeState,
    OptimizationAgentMode,
    OptimizationControlResult,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.controller_planning import ControllerPlanningMixin
from ecos_agent.optimization.controller_recovery import ControllerRecoveryMixin


class OptimizationEpisodeController(
    ControllerPlanningMixin,
    ControllerContextMixin,
    ControllerExecutionMixin,
    ControllerCaseRecordingMixin,
    ControllerRecoveryMixin,
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
        objective_alignment: OptimizationObjectiveAlignment | None = None,
        task_memory_scope_sha256: str | None = None,
        task_memory_supplier: Callable[[], OptimizationTaskMemorySnapshot]
        | None = None,
        execution_context: Mapping[str, object] | None = None,
        receipt_aware_planning: bool = True,
        knowledge_case_shots: Literal[0, 3] = 0,
        knowledge_case_pool_root: Path | None = None,
        max_in_flight_candidates: Literal[1, 2] = 1,
        design_id: str | None = None,
        trend_noise_epsilon: Mapping[str, float] | None = None,
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
        self._trend_noise_epsilon = self._validated_trend_noise_epsilon(
            trend_noise_epsilon
        )
        self._episode_design_id = self._manifest_scope_check(design_id)
        if type(max_in_flight_candidates) is not int or max_in_flight_candidates not in {
            1, 2,
        }:
            raise OptimizationEpisodeControllerError(
                "max in-flight candidates must be one or two"
            )
        self.max_in_flight_candidates = max_in_flight_candidates
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
        self._baseline_geometry = incumbent.geometry if incumbent is not None else None
        if objective_alignment is not None:
            if objective is None or incumbent is None:
                raise OptimizationEpisodeControllerError(
                    "objective alignment requires an objective and incumbent"
                )
            try:
                validate_objective_alignment(objective_alignment, objective, incumbent)
            except ValueError as exc:
                raise OptimizationEpisodeControllerError(
                    "objective alignment does not match the episode baseline"
                ) from exc
        self._objective_alignment = objective_alignment
        # Frozen from the construction-time incumbent, which is the episode
        # baseline, so promote_incumbent enforces the same frozen protection
        # envelope as the runner-side classification.
        self._frozen_objective = (
            freeze_routability_objective(incumbent, objective_alignment=objective_alignment)
            if objective_alignment is not None
            else None
        )
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
        self._approved_planning_entry_sha256: str | None = None
        self._approved_parent_incumbent_sha256: str | None = None
        self._approved_parent_config_sha256: str | None = None
        self._attempted_probes: tuple[AttemptedProbe, ...] = ()
        self._pending_executions: dict[str, PendingExecutionRecord] = {}
        self._execution_bindings: tuple[ExecutionBinding, ...] = ()
        self._planning_only_turns = 0
        self._persist()

    @property
    def state(self) -> OptimizationEpisodeState:
        return self._state

    def _validated_trend_noise_epsilon(
        self, trend_noise_epsilon: Mapping[str, float] | None
    ) -> dict[str, float] | None:
        if trend_noise_epsilon is None:
            return None
        for key, value in trend_noise_epsilon.items():
            if (
                not key
                or isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                raise OptimizationEpisodeControllerError(
                    "trend noise epsilon entries must be finite and non-negative"
                )
        return dict(trend_noise_epsilon)

    def _manifest_scope_check(self, design_id: str | None) -> str | None:
        """Gate knowledge-consuming episodes on manifest scope and calibration.

        Fail closed: a full-agent episode for a design inside the frozen
        state-rule manifest scope must carry its calibrated per-metric trend
        epsilon (noise-epsilon.v1.json); episodes without calibration must
        not silently fall back to a zero tolerance.  Knowledge-free modes
        never compile the supported-action view, so the manifest does not
        constrain them.
        """
        if design_id is None:
            return None
        if not _ID.fullmatch(design_id):
            raise OptimizationEpisodeControllerError("design id is invalid")
        if self.mode != OptimizationAgentMode.FULL_AGENT:
            return design_id
        manifest = load_state_rule_manifest()
        if design_id not in manifest.scope:
            raise OptimizationEpisodeControllerError(
                f"design is outside the frozen state-rule manifest scope: {design_id}"
            )
        if self._trend_noise_epsilon is None:
            raise OptimizationEpisodeControllerError(
                "full-agent episode lacks the calibrated trend noise epsilon; "
                "run the default-replay noise calibration (noise-epsilon.v1.json) "
                f"for design {design_id}"
            )
        return design_id

    @property
    def pending_execution_ids(self) -> tuple[str, ...]:
        return tuple(
            record.execution_id
            for record in self._pending_executions.values()
        )

    @property
    def pending_intervention_ids(self) -> tuple[str, ...]:
        return tuple(self._pending_executions)

    @property
    def pending_execution_id(self) -> str | None:
        ids = self.pending_execution_ids
        return ids[0] if len(ids) == 1 else None

    @property
    def free_candidate_slots(self) -> int:
        return self.max_in_flight_candidates - len(self._pending_executions)

    def pending_execution(self, execution_id: str) -> PendingExecutionRecord | None:
        for record in self._pending_executions.values():
            if record.execution_id == execution_id:
                return record
        return None

    def _pending_by_intervention(self, intervention_id: str) -> PendingExecutionRecord | None:
        return self._pending_executions.get(intervention_id)

    @property
    def incumbent(self) -> TerminalObservation | None:
        return self._incumbent

    @property
    def baseline_geometry(self) -> GeometrySnapshot | None:
        return self._baseline_geometry

    @property
    def objective(self) -> OptimizationObjectiveContract | None:
        return self._objective

    @property
    def objective_alignment(self) -> OptimizationObjectiveAlignment | None:
        return self._objective_alignment

    @property
    def active_objective(self) -> ActiveOptimizationObjective | None:
        if (
            self._objective_alignment is None
            or self._objective is None
            or self._incumbent is None
        ):
            return None
        return build_active_objective(
            self._objective_alignment, self._objective, self._incumbent
        )

    @property
    def recovery_incomplete(self) -> bool:
        active = self.active_objective
        return active is not None and active.recovery_stage != "original"

    @property
    def incumbent_candidate_root_ref(self) -> str | None:
        return self._incumbent_candidate_root_ref

    def promote_incumbent(
        self,
        candidate: TerminalObservation,
        evidence: CandidateExecutionEvidence | None = None,
    ) -> None:
        recovery_promotion = bool(
            self._objective_alignment is not None
            and self._incumbent is not None
            and self.recovery_incomplete
            and compare_recovery_incumbent(
                incumbent=self._incumbent,
                candidate=candidate,
                alignment=self._objective_alignment,
                semantic_objective=self._objective,
                objective=self._frozen_objective,
            ).decision
            in PROMOTING_DECISIONS - {IncumbentDecision.INITIALIZED}
        )
        if not candidate.eligible_for_incumbent and not recovery_promotion:
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
        violation = geometry_constraint_error(self._objective, self._baseline_geometry, candidate)
        if violation is not None:
            raise OptimizationEpisodeControllerError(violation)
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

    def _result(self, rejection_reason: str | None = None) -> OptimizationControlResult:
        return OptimizationControlResult(
            self._state,
            self._proposal,
            self._requested,
            rejection_reason,
            "llm",
        )

    def _attempted_requests(
        self, parent_config_sha256: str | None = None
    ) -> tuple[RequestedKnobValue, ...]:
        """Requests already dispatched, scoped to one parent configuration.

        An attempted value only blocks the same value again under the same
        parent configuration; a materially different parent may justify a
        retest.  In-flight requests count as attempted for their parent.
        """
        requests = [
            probe.requested
            for probe in self._attempted_probes
            if parent_config_sha256 is None
            or probe.parent_config_sha256 == parent_config_sha256
        ]
        requests.extend(
            record.requested
            for record in self._pending_executions.values()
            if parent_config_sha256 is None
            or record.parent_config_sha256 == parent_config_sha256
        )
        return tuple(requests)

    def _record_attempted_probe(
        self, requested: RequestedKnobValue, parent_config_sha256: str
    ) -> None:
        self._attempted_probes = (
            *self._attempted_probes,
            AttemptedProbe(
                parent_config_sha256=parent_config_sha256,
                requested=requested,
            ),
        )

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
            "schema_version": "ecos.optimization_episode_state.v10",
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
            "objective_alignment": (
                self._objective_alignment.model_dump(mode="json")
                if self._objective_alignment is not None
                else None
            ),
            "active_objective": (
                self.active_objective.model_dump(mode="json")
                if self.active_objective is not None
                else None
            ),
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
            "attempted_probes": [
                probe.model_dump(mode="json") for probe in self._attempted_probes
            ],
            "pending_executions": [
                record.model_dump(mode="json")
                for record in self._pending_executions.values()
            ],
            "execution_bindings": [
                binding.model_dump(mode="json")
                for binding in self._execution_bindings
            ],
            "execution_context_sha256": canonical_sha256(self._execution_context),
        }
        if self._baseline_geometry is not None:
            value["baseline_geometry"] = self._baseline_geometry.model_dump(mode="json")
        if self._frozen_objective is not None:
            value["frozen_objective"] = self._frozen_objective.model_dump(mode="json")
        if not self.receipt_aware_planning:
            value["receipt_aware_planning"] = False
        if self.knowledge_case_shots:
            value["knowledge_case_shots"] = self.knowledge_case_shots
        if self.max_in_flight_candidates != 1:
            value["max_in_flight_candidates"] = self.max_in_flight_candidates
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
        if self._approved_planning_entry_sha256 is not None:
            value["approved_planning_entry_sha256"] = (
                self._approved_planning_entry_sha256
            )
        if self._approved_parent_incumbent_sha256 is not None:
            value["approved_parent_incumbent_sha256"] = (
                self._approved_parent_incumbent_sha256
            )
        if self._approved_parent_config_sha256 is not None:
            value["approved_parent_config_sha256"] = (
                self._approved_parent_config_sha256
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
        alignment_sha256 = (
            snapshot.objective_alignment.alignment_contract_sha256
            if snapshot.objective_alignment is not None
            else None
        )
        if any(
            getattr(entry.payload, "objective_alignment_sha256", None)
            != alignment_sha256
            for entry in replay.entries
        ):
            raise OptimizationEpisodeControllerError(
                "outcome ledger does not match the objective alignment"
            )
        if any(
            entry.objective_contract_sha256 != objective_sha256
            for entry in decision_audit.entries
        ):
            raise OptimizationEpisodeControllerError(
                "decision audit does not match the frozen objective"
            )
        if tuple(replay.pending_intervention_ids) != tuple(
            record.intervention_id for record in snapshot.pending_executions
        ):
            raise OptimizationEpisodeControllerError(
                "episode pending execution does not match ledger trace"
            )
