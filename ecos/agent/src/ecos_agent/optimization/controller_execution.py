"""Execution lifecycle for controlled optimization episodes."""

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
from ecos_agent.optimization.knob_policy import allowed_knobs
from ecos_agent.optimization.rules import geometry_constraint_error
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
    CandidateExecutionBusy,
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
from ecos_agent.optimization.objective_alignment import build_active_objective
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
    ExpectedEffectV2,
    OptimizationProposalV2,
    ParameterApplicationReceipt,
)
from ecos_agent.optimization.parameters.semantics import (
    LATTICE_VERSION,
    card_hash,
    load_parameter_card,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


from ecos_agent.optimization.controller_models import (
    ExecutionBinding,
    OptimizationAgentMode,
    OptimizationControlResult,
    OptimizationEpisodeControllerError,
    PendingExecutionRecord,
)


class ControllerExecutionMixin:
    def execute(self) -> OptimizationControlResult:
        self._refresh_budget()
        if (
            self._state != OptimizationEpisodeState.AWAITING_EXECUTION
            or self._proposal is None
            or self._requested is None
        ):
            raise OptimizationEpisodeControllerError(
                "episode has no approved proposal to execute"
            )
        if self._budget.exhausted:
            # B3: an exhausted budget only blocks new dispatch; in-flight
            # candidates must still be collected before the episode may stop.
            self._clear_approved_proposal()
            if self._pending_executions:
                self._state = OptimizationEpisodeState.EXECUTING
                self._persist()
                return self._result("budget_exhausted")
            self._state = OptimizationEpisodeState.STOPPED
            self._persist()
            return self._result(
                "recovery_incomplete" if self.recovery_incomplete else "budget_exhausted"
            )
        # B1: the coordinator reserves the slot and the budget atomically;
        # an over-limit dispatch is a caller bug, never a silent queue.
        if self.free_candidate_slots <= 0:
            raise OptimizationEpisodeControllerError(
                "no free in-flight candidate slot"
            )
        # A4: a proposal planned against an older incumbent must be re-planned,
        # not silently rebound to the current parent workspace.
        current_parent = (
            canonical_sha256(self._incumbent.model_dump(mode="json"))
            if self._incumbent is not None
            else None
        )
        if (
            self._approved_parent_incumbent_sha256 is not None
            and current_parent is not None
            and self._approved_parent_incumbent_sha256 != current_parent
        ):
            self._clear_approved_proposal()
            self._state = (
                OptimizationEpisodeState.EXECUTING
                if self._pending_executions
                else OptimizationEpisodeState.PLANNING
            )
            self._persist()
            return self._result("stale_proposal_parent_changed")

        if self._requested.knob_id not in allowed_knobs(self._objective):
            raise OptimizationEpisodeControllerError("requested knob is forbidden by the task parameter policy")
        violation = geometry_constraint_error(self._objective, self._baseline_geometry, self._incumbent)
        if violation is not None:
            raise OptimizationEpisodeControllerError(violation)
        if self._pending_v2_proposal is None or self._pending_v2_proposal.action is None:
            raise OptimizationEpisodeControllerError("execution request has no validated exact-value proposal")
        action = self._pending_v2_proposal.action
        if action.knob_id != self._requested.knob_id or action.requested_value != self._requested.value:
            raise OptimizationEpisodeControllerError("execution request differs from the validated exact-value proposal")
        if self._approved_planning_entry_sha256 is None or (
            self._approved_parent_config_sha256 is None
        ):
            raise OptimizationEpisodeControllerError(
                "approved proposal has no parent snapshot binding"
            )
        decision = next(
            (
                entry for entry in reversed(self._decision_audit.replay().entries)
                if entry.validation_result == "accepted"
                and entry.proposal is not None
                and canonical_sha256(entry.proposal.model_dump(mode="json"))
                == canonical_sha256(self._proposal.model_dump(mode="json"))
                and entry.requested == self._requested
            ),
            None,
        )
        planning_by_sha = {
            entry.entry_sha256: entry
            for entry in self._planning_audit.replay().entries
        }
        planning_entry = planning_by_sha.get(self._approved_planning_entry_sha256)
        if (
            decision is None
            or planning_entry is None
            or decision.planning_entry_sha256 != planning_entry.entry_sha256
            or self._proposal.context_ref != planning_entry.context_ref
        ):
            raise OptimizationEpisodeControllerError("execution request does not match the approved planning decision")
        domain = next(
            (
                item
                for item in planning_entry.effective_domains
                if item.knob_id == self._requested.knob_id
            ),
            None,
        )
        if domain is None:
            raise OptimizationEpisodeControllerError(
                "approved proposal has no context-bound effective domain"
            )
        if (
            action.effective_domain_sha256 != domain.snapshot_sha256
            or domain.direction_schema(action.direction) is None
            or not domain.accepts(self._requested.value)
        ):
            raise OptimizationEpisodeControllerError("execution request does not match the approved parameter domain")
        intervention_id = self._next_intervention_id()
        request = CandidateExecutionRequest(
            intervention_id=intervention_id,
            episode_id=self.episode_id,
            checkpoint_id=self.checkpoint_id,
            proposal=self._proposal,
            requested=self._requested,
            context_sha256=domain.context_sha256,
            seed=self._execution_seed(),
            ecc_revision=self._execution_revision(),
            parent_candidate_root_ref=self._incumbent_candidate_root_ref,
        )
        parent_config_sha256 = self._approved_parent_config_sha256
        try:
            receipt = self._start_once_with_retry(request)
        except CandidateExecutionBusy:
            # The backend still owns an active candidate operation: keep the
            # approved proposal for a later start and wait for an in-flight
            # terminal.  No budget is consumed and nothing is re-dispatched.
            self._state = (
                OptimizationEpisodeState.AWAITING_EXECUTION
                if self._pending_executions
                else OptimizationEpisodeState.PLANNING
            )
            self._persist()
            return self._result("execution_backend_busy")
        except OptimizationEpisodeControllerError:
            record = self._register_started_candidate(
                intervention_id=intervention_id,
                execution_id="unknown-execution",
                request=request,
                planning_entry_sha256=planning_entry.entry_sha256,
                parent_config_sha256=parent_config_sha256,
            )
            self.ledger.append_start(self._ledger_start(request, record))
            return self._quarantine_indeterminate("unknown-execution")
        if receipt is None:
            self._clear_approved_proposal()
            self._state = (
                OptimizationEpisodeState.EXECUTING
                if self._pending_executions
                else OptimizationEpisodeState.PLANNING
            )
            self._persist()
            return self._result("execution_not_started")

        record = self._register_started_candidate(
            intervention_id=intervention_id,
            execution_id=receipt.execution_id,
            request=request,
            planning_entry_sha256=planning_entry.entry_sha256,
            parent_config_sha256=parent_config_sha256,
        )
        self.ledger.append_start(self._ledger_start(request, record))
        if receipt.outcome in {
            None,
            OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        }:
            self._state = OptimizationEpisodeState.EXECUTING
            self._persist()
            return self._result()
        return self._complete(receipt.outcome, receipt, record)

    def _clear_approved_proposal(self) -> None:
        self._proposal = None
        self._pending_v2_proposal = None
        self._requested = None
        self._approved_planning_entry_sha256 = None
        self._approved_parent_incumbent_sha256 = None
        self._approved_parent_config_sha256 = None

    def _register_started_candidate(
        self,
        *,
        intervention_id: str,
        execution_id: str,
        request: CandidateExecutionRequest,
        planning_entry_sha256: str,
        parent_config_sha256: str,
    ) -> PendingExecutionRecord:
        """Consume budget, record the probe, and bind one immutable pending record."""
        self._budget = self._consume(candidates=1)
        self._record_attempted_probe(request.requested, parent_config_sha256)
        record = PendingExecutionRecord(
            intervention_id=intervention_id,
            execution_id=execution_id,
            proposal=request.proposal,
            proposal_v2=self._pending_v2_proposal,
            requested=request.requested,
            context_sha256=request.context_sha256,
            planning_entry_sha256=planning_entry_sha256,
            parent_config_sha256=parent_config_sha256,
            parent_incumbent_sha256=self._approved_parent_incumbent_sha256,
            parent_candidate_root_ref=request.parent_candidate_root_ref,
        )
        self._pending_executions[record.intervention_id] = record
        self._execution_bindings = (
            *self._execution_bindings,
            ExecutionBinding(
                intervention_id=intervention_id, execution_id=execution_id
            ),
        )
        self._clear_approved_proposal()
        return record

    def timeout(self, execution_id: str | None = None) -> OptimizationControlResult:
        record = self._select_pending_execution(execution_id)
        if record is None:
            raise OptimizationEpisodeControllerError(
                "cancel already requested or no execution is pending"
            )
        if record.cancel_requested:
            raise OptimizationEpisodeControllerError("cancel already requested")
        record = record.model_copy(update={"cancel_requested": True})
        self._pending_executions[record.intervention_id] = record
        self._persist()
        try:
            receipt = self.executor.cancel(record.execution_id)
        except Exception:
            return self._quarantine_indeterminate(record.execution_id)
        if not isinstance(receipt, CandidateExecutionReceipt):
            return self._quarantine_indeterminate(record.execution_id)
        if receipt.outcome == OptimizationOutcomeKind.TIMED_OUT_CANCELLED:
            return self._complete(receipt.outcome, receipt, record)
        return self._quarantine_indeterminate(record.execution_id)

    def _select_pending_execution(
        self, execution_id: str | None
    ) -> PendingExecutionRecord | None:
        if execution_id is not None:
            return next(
                (
                    record
                    for record in self._pending_executions.values()
                    if record.execution_id == execution_id
                ),
                None,
            )
        if len(self._pending_executions) == 1:
            return next(iter(self._pending_executions.values()))
        return None

    def stop_before_execution(self) -> OptimizationControlResult:
        if self._state != OptimizationEpisodeState.AWAITING_EXECUTION:
            raise OptimizationEpisodeControllerError(
                "episode has no unstarted execution to stop"
            )
        self._clear_approved_proposal()
        self._state = (
            OptimizationEpisodeState.EXECUTING
            if self._pending_executions
            else OptimizationEpisodeState.STOPPED
        )
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
        record = next(
            (
                item
                for item in self._pending_executions.values()
                if item.execution_id == receipt.execution_id
            ),
            None,
        )
        if record is None:
            # E3: replays of an already-merged terminal stay no-ops.
            if self._execution_already_merged(receipt.execution_id):
                return self._result()
            raise OptimizationEpisodeControllerError(
                "terminal receipt does not match pending execution"
            )
        if not receipt.started or receipt.outcome is None:
            raise OptimizationEpisodeControllerError(
                "terminal receipt does not match pending execution"
            )
        return self._complete(
            outcome or receipt.outcome,
            receipt,
            record,
            terminal_observation,
            incumbent_decision=incumbent_decision,
            decisive_metric=decisive_metric,
        )

    def _execution_already_merged(self, execution_id: str) -> bool:
        merged = {
            outcome.intervention_id
            for outcome in self.ledger.replay().terminal_outcomes
        }
        return any(
            binding.execution_id == execution_id
            and binding.intervention_id in merged
            for binding in self._execution_bindings
        )

    def _start_once_with_retry(
        self,
        request: CandidateExecutionRequest,
    ) -> CandidateExecutionReceipt | None:
        for _ in range(2):
            try:
                receipt = self.executor.start(request)
            except CandidateExecutionBusy:
                raise
            except Exception as exc:
                raise OptimizationEpisodeControllerError(
                    "fake execution adapter failed"
                ) from exc
            if not isinstance(receipt, CandidateExecutionReceipt):
                raise OptimizationEpisodeControllerError(
                    "fake execution receipt is invalid"
                )
            if receipt.started:
                return receipt
        return None

    def _ledger_start(
        self, request: CandidateExecutionRequest, record: PendingExecutionRecord
    ) -> OptimizationInterventionStart:
        proposal_sha256 = canonical_sha256(request.proposal.model_dump(mode="json"))
        target_step = candidate_target_step(request.requested.knob_id)
        execution_scope = CANDIDATE_EXECUTION_SCOPE
        end_step = CANDIDATE_END_STEP
        execution_contract_sha256 = canonical_sha256(
            {
                "intervention_id": request.intervention_id,
                "episode_id": request.episode_id,
                "checkpoint_id": request.checkpoint_id,
                "proposal_sha256": proposal_sha256,
                "objective_contract_sha256": (
                    self._objective.contract_sha256
                    if self._objective is not None
                    else None
                ),
                "objective_alignment_sha256": (
                    self._objective_alignment.alignment_contract_sha256
                    if self._objective_alignment is not None
                    else None
                ),
                "active_objective": (
                    self.active_objective.model_dump(mode="json")
                    if self.active_objective is not None
                    else None
                ),
                "requested": request.requested.model_dump(mode="json"),
                "context_sha256": request.context_sha256,
                "parent_candidate_root_ref": request.parent_candidate_root_ref,
                "parent_config_sha256": record.parent_config_sha256,
                "parent_incumbent_sha256": record.parent_incumbent_sha256,
                "target_step": target_step,
                "end_step": end_step,
                "execution_scope": execution_scope,
            }
        )
        return OptimizationInterventionStart(
            intervention_id=request.intervention_id,
            parent_checkpoint_id=self.checkpoint_id,
            candidate_checkpoint_id=f"candidate-{request.intervention_id}",
            parameter_before_sha256=canonical_sha256(
                {"checkpoint_id": self.checkpoint_id}
            ),
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
                    "knowledge_case_shots": self.knowledge_case_shots,
                    "max_in_flight_candidates": self.max_in_flight_candidates,
                }
            ),
            objective_contract_sha256=(
                self._objective.contract_sha256 if self._objective is not None else None
            ),
            objective_alignment_sha256=(
                self._objective_alignment.alignment_contract_sha256
                if self._objective_alignment is not None
                else None
            ),
            active_objective=self.active_objective,
            proposal_action=request.proposal.action,
            requested=request.requested,
            target_step=target_step,
            end_step=end_step,
            execution_scope=execution_scope,
            parent_config_sha256=record.parent_config_sha256,
            parent_incumbent_sha256=record.parent_incumbent_sha256,
        )

    def _complete(
        self,
        outcome: OptimizationOutcomeKind,
        receipt: CandidateExecutionReceipt,
        record: PendingExecutionRecord,
        terminal_observation: TerminalObservation | None = None,
        *,
        incumbent_decision: str | None = None,
        decisive_metric: SelectionMetric | None = None,
    ) -> OptimizationControlResult:
        requested = record.requested
        if receipt.parameter_application_receipt is not None:
            native_requested = receipt.parameter_application_receipt.requested
            if (
                native_requested.get("knob_id") != requested.knob_id.value
                or native_requested.get("value") != requested.value
            ):
                raise OptimizationEpisodeControllerError(
                    "terminal parameter receipt does not match requested value"
                )
        if receipt.evidence is not None:
            expected_contract = (
                candidate_target_step(requested.knob_id),
                CANDIDATE_END_STEP,
                CANDIDATE_EXECUTION_SCOPE,
            )
            observed_contract = (
                receipt.evidence.target_step,
                receipt.evidence.end_step,
                receipt.evidence.execution_scope,
            )
            if (
                any(value is not None for value in observed_contract)
                and observed_contract != expected_contract
            ):
                raise OptimizationEpisodeControllerError(
                    "terminal candidate evidence execution contract does not match"
                )
        constraint_violation = geometry_constraint_error(
            self._objective, self._baseline_geometry, terminal_observation,
        ) if receipt.outcome == OptimizationOutcomeKind.EXECUTION_SUCCEEDED else None
        if constraint_violation is not None:
            outcome = OptimizationOutcomeKind.CANDIDATE_INELIGIBLE
            incumbent_decision = IncumbentDecision.CANDIDATE_INELIGIBLE.value
            decisive_metric = None
        comparison = (
            IncumbentDecision(incumbent_decision)
            if incumbent_decision is not None
            else None
        )
        promote = terminal_candidate_is_promotable(
            execution_outcome=receipt.outcome,
            candidate=terminal_observation,
            comparison=(
                None
                if comparison is None
                else IncumbentComparison(comparison, decisive_metric)
            ),
            requested=requested,
            parameter_receipt=receipt.parameter_application_receipt,
            objective_alignment=self._objective_alignment,
            recovery_active=self.recovery_incomplete,
            semantic_objective=self._objective,
            baseline_geometry=self._baseline_geometry,
        )
        active_objective = self.active_objective
        next_active_objective = active_objective
        if (
            promote
            and terminal_observation is not None
            and self._objective_alignment is not None
            and self._objective is not None
        ):
            next_active_objective = build_active_objective(
                self._objective_alignment, self._objective, terminal_observation
            )
        details = {
            "execution_id": receipt.execution_id,
            "started": receipt.started,
            "outcome": outcome.value,
        }
        if receipt.evidence is not None:
            details["candidate_root_ref"] = receipt.evidence.candidate_root_ref
            details["candidate_manifest_ref"] = receipt.evidence.candidate_manifest_ref
            details["candidate_manifest_sha256"] = (
                receipt.evidence.candidate_manifest_sha256
            )
            details["target_step"] = receipt.evidence.target_step
            details["end_step"] = receipt.evidence.end_step
            details["execution_scope"] = receipt.evidence.execution_scope
        if receipt.parameter_application_receipt is not None:
            details["parameter_application_receipt"] = (
                receipt.parameter_application_receipt.model_dump(mode="json")
            )
        if terminal_observation is not None:
            details["terminal_observation_sha256"] = canonical_sha256(
                terminal_observation.model_dump(mode="json")
            )
        if incumbent_decision is not None:
            details["incumbent_decision"] = incumbent_decision
        if decisive_metric is not None:
            details["decisive_metric"] = decisive_metric.value
        # A2: the candidate's original parent snapshot stays recorded next to
        # the merge-time decision so both comparisons remain replayable.
        details["parent_config_sha256"] = record.parent_config_sha256
        if record.parent_incumbent_sha256 is not None:
            details["parent_incumbent_sha256"] = record.parent_incumbent_sha256
        if self._objective_alignment is not None:
            details["objective_alignment_sha256"] = (
                self._objective_alignment.alignment_contract_sha256
            )
            details["active_objective"] = active_objective.model_dump(mode="json")
            details["next_active_objective"] = next_active_objective.model_dump(
                mode="json"
            )
        terminal_outcome = OptimizationTerminalOutcome(
            intervention_id=record.intervention_id,
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
            parameter_application_receipt=receipt.parameter_application_receipt,
            parameter_card_sha256=(
                card_hash(load_parameter_card(requested.knob_id))
                if receipt.parameter_application_receipt is not None
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
            objective_alignment_sha256=(
                self._objective_alignment.alignment_contract_sha256
                if self._objective_alignment is not None
                else None
            ),
            active_objective=active_objective,
            next_active_objective=next_active_objective,
            recovery_transition=(
                f"{active_objective.recovery_stage}_to_{next_active_objective.recovery_stage}"
                if active_objective is not None
                and next_active_objective is not None
                and active_objective.recovery_stage
                != next_active_objective.recovery_stage
                else None
            ),
            constraint_violation=constraint_violation,
            outcome_details_sha256=canonical_sha256(details),
            target_step=candidate_target_step(requested.knob_id),
            end_step=CANDIDATE_END_STEP,
            execution_scope=CANDIDATE_EXECUTION_SCOPE,
        )
        self.ledger.append_terminal(terminal_outcome)
        if self.mode == OptimizationAgentMode.FULL_AGENT:
            self._record_empirical_case(
                terminal_outcome,
                receipt.parameter_application_receipt,
                terminal_observation,
                record,
            )
        if promote:
            assert terminal_observation is not None
            self._set_incumbent(terminal_observation, receipt.evidence)
        self._pending_executions.pop(record.intervention_id, None)
        # Serial merge: the next decision sees the state this merge produced.
        if outcome == OptimizationOutcomeKind.INDETERMINATE:
            self._state = OptimizationEpisodeState.QUARANTINED
        elif self._proposal is not None:
            self._state = OptimizationEpisodeState.AWAITING_EXECUTION
        elif self._pending_executions:
            self._state = OptimizationEpisodeState.EXECUTING
        elif self._budget.exhausted:
            self._state = OptimizationEpisodeState.STOPPED
        else:
            self._state = OptimizationEpisodeState.PLANNING
        self._persist()
        return self._result()

    def _quarantine_indeterminate(
        self, execution_id: str | None = None
    ) -> OptimizationControlResult:
        record = self._select_pending_execution(execution_id)
        if record is None:
            record = next(iter(self._pending_executions.values()), None)
        if record is None:
            raise OptimizationEpisodeControllerError(
                "indeterminate terminal has no pending execution"
            )
        receipt = CandidateExecutionReceipt(
            execution_id=record.execution_id,
            started=True,
            outcome=OptimizationOutcomeKind.INDETERMINATE,
        )
        return self._complete(OptimizationOutcomeKind.INDETERMINATE, receipt, record)

    def _next_intervention_id(self) -> str:
        replay = self.ledger.replay()
        started = sum(
            1
            for entry in replay.entries
            if isinstance(entry.payload, OptimizationInterventionStart)
        )
        return f"intervention-{started + 1}"
