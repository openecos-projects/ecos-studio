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
    load_parameter_card,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_STATE_FILE = "optimization-episode-state.v7.json"
_LEGACY_STATE_FILES = (
    "optimization-episode-state.v2.json",
    "optimization-episode-state.v3.json",
    "optimization-episode-state.v4.json",
    "optimization-episode-state.v5.json",
    "optimization-episode-state.v6.json",
)


from ecos_agent.optimization.controller_models import (
    OptimizationAgentMode,
    OptimizationControlResult,
    OptimizationEpisodeControllerError,
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
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._pending_v2_proposal = None
            self._requested = None
            self._persist()
            return self._result(
                "recovery_incomplete" if self.recovery_incomplete else "budget_exhausted"
            )

        intervention_id = self._next_intervention_id()
        planning_entries = self._planning_audit.replay().entries
        domain = (
            next(
                (
                    item
                    for item in planning_entries[-1].effective_domains
                    if item.knob_id == self._requested.knob_id
                ),
                None,
            )
            if planning_entries
            else None
        )
        if domain is None:
            raise OptimizationEpisodeControllerError(
                "approved proposal has no context-bound effective domain"
            )
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
        try:
            receipt = self._start_once_with_retry(request)
        except OptimizationEpisodeControllerError:
            self._budget = self._consume(candidates=1)
            self._pending_intervention_id = intervention_id
            self._pending_execution_id = "unknown-execution"
            self._attempted_request_values = (
                *self._attempted_request_values,
                request.requested,
            )
            self.ledger.append_start(self._ledger_start(request))
            return self._quarantine_indeterminate()
        if receipt is None:
            self._state = OptimizationEpisodeState.PLANNING
            self._proposal = None
            self._pending_v2_proposal = None
            self._persist()
            return self._result("execution_not_started")

        self._budget = self._consume(candidates=1)
        self._pending_intervention_id = intervention_id
        self._pending_execution_id = receipt.execution_id
        self._attempted_request_values = (
            *self._attempted_request_values,
            request.requested,
        )
        self.ledger.append_start(self._ledger_start(request))
        if receipt.outcome in {
            None,
            OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        }:
            self._state = OptimizationEpisodeState.EXECUTING
            self._persist()
            return self._result()
        return self._complete(receipt.outcome, receipt)

    def timeout(self) -> OptimizationControlResult:
        if (
            self._state != OptimizationEpisodeState.EXECUTING
            or self._pending_execution_id is None
        ):
            raise OptimizationEpisodeControllerError(
                "cancel already requested or no execution is pending"
            )
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
        self._pending_v2_proposal = None
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
            raise OptimizationEpisodeControllerError(
                "terminal receipt does not match pending execution"
            )
        return self._complete(
            outcome or receipt.outcome,
            receipt,
            terminal_observation,
            incumbent_decision=incumbent_decision,
            decisive_metric=decisive_metric,
        )
    def _start_once_with_retry(
        self,
        request: CandidateExecutionRequest,
    ) -> CandidateExecutionReceipt | None:
        for _ in range(2):
            try:
                receipt = self.executor.start(request)
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
        self, request: CandidateExecutionRequest
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
            raise OptimizationEpisodeControllerError(
                "terminal receipt has no pending intervention"
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
            expected_contract = (
                candidate_target_step(self._requested.knob_id),
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
            requested=self._requested,
            parameter_receipt=receipt.parameter_application_receipt,
            objective_alignment=self._objective_alignment,
            recovery_active=self.recovery_incomplete,
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
        if self._objective_alignment is not None:
            details["objective_alignment_sha256"] = (
                self._objective_alignment.alignment_contract_sha256
            )
            details["active_objective"] = active_objective.model_dump(mode="json")
            details["next_active_objective"] = next_active_objective.model_dump(
                mode="json"
            )
        terminal_outcome = OptimizationTerminalOutcome(
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
            parameter_application_receipt=receipt.parameter_application_receipt,
            parameter_card_sha256=(
                card_hash(load_parameter_card(self._requested.knob_id))
                if receipt.parameter_application_receipt is not None
                and self._requested is not None
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
            outcome_details_sha256=canonical_sha256(details),
            target_step=candidate_target_step(self._requested.knob_id)
            if self._requested
            else "place",
            end_step=CANDIDATE_END_STEP,
            execution_scope=CANDIDATE_EXECUTION_SCOPE,
        )
        self.ledger.append_terminal(terminal_outcome)
        if self.mode == OptimizationAgentMode.FULL_AGENT:
            self._record_empirical_case(
                terminal_outcome,
                receipt.parameter_application_receipt,
                terminal_observation,
            )
        if promote:
            assert terminal_observation is not None
            self._set_incumbent(terminal_observation, receipt.evidence)
        self._pending_intervention_id = None
        self._pending_execution_id = None
        self._cancel_requested = False
        self._proposal = None
        self._pending_v2_proposal = None
        self._requested = None
        self._state = (
            OptimizationEpisodeState.QUARANTINED
            if outcome == OptimizationOutcomeKind.INDETERMINATE
            else OptimizationEpisodeState.PLANNING
        )
        self._persist()
        return self._result()

    def _record_empirical_case(
        self,
        outcome: OptimizationTerminalOutcome,
        receipt: ParameterApplicationReceipt | None,
        terminal: TerminalObservation | None,
    ) -> None:
        proposal = self._pending_v2_proposal
        if proposal is None or receipt is None or terminal is None:
            self._append_case_diagnostic(
                "missing_terminal_case_evidence", outcome, receipt, terminal
            )
            return
        action = proposal.action
        domain = next(
            (
                item
                for item in self._planning_audit.replay().entries[-1].effective_domains
                if action is not None
                and item.snapshot_sha256 == action.effective_domain_sha256
            ),
            None,
        )
        if domain is None:
            self._append_case_diagnostic(
                "missing_effective_domain", outcome, receipt, terminal
            )
            return
        try:
            case = build_terminal_empirical_case(
                case_id=f"case-{self.episode_id}-{outcome.intervention_id}",
                proposal=proposal,
                effective_domain=domain,
                receipt=receipt,
                terminal_outcome=outcome,
                terminal=terminal,
                outcome_class=self._empirical_outcome(outcome.outcome, receipt, terminal),
                guardrail_status="pass" if terminal.eligible_for_incumbent else "fail",
                design_id=self._design_id(),
            )
        except ValueError:
            self._append_case_diagnostic(
                "terminal_case_chain_invalid", outcome, receipt, terminal
            )
            return
        if not self._external_case_pool:
            self._case_pool.append_case(case)
        self._case_audit.append_case(case)

    @staticmethod
    def _empirical_outcome(
        outcome: OptimizationOutcomeKind,
        receipt: ParameterApplicationReceipt,
        terminal: TerminalObservation,
    ) -> EmpiricalOutcome:
        if not native_receipt_is_effective(receipt):
            return EmpiricalOutcome.INEFFECTIVE
        if not terminal.eligible_for_incumbent or outcome in {
            OptimizationOutcomeKind.CANDIDATE_INELIGIBLE,
            OptimizationOutcomeKind.INFEASIBLE,
        }:
            return EmpiricalOutcome.GUARDRAIL_FAILURE
        if outcome in {
            OptimizationOutcomeKind.IMPROVED,
            OptimizationOutcomeKind.EXECUTION_SUCCEEDED,
        }:
            return EmpiricalOutcome.SUPPORTED
        if outcome in {
            OptimizationOutcomeKind.DEGRADED,
            OptimizationOutcomeKind.TRADEOFF,
        }:
            return EmpiricalOutcome.CONTRADICTED
        return EmpiricalOutcome.FAILURE

    def _append_case_diagnostic(
        self,
        reason_code: str,
        outcome: OptimizationTerminalOutcome,
        receipt: ParameterApplicationReceipt | None,
        terminal: TerminalObservation | None,
    ) -> None:
        self._case_audit.append_diagnostic(
            EmpiricalCaseDiagnostic(
                intervention_id=outcome.intervention_id,
                reason_code=reason_code,
                proposal_sha256=(
                    canonical_sha256(self._pending_v2_proposal.model_dump(mode="json"))
                    if self._pending_v2_proposal is not None
                    else None
                ),
                receipt_sha256=(receipt.evidence_sha256 if receipt is not None else None),
                terminal_outcome_sha256=canonical_sha256(
                    outcome.model_dump(mode="json")
                ),
                terminal_observation_sha256=(
                    canonical_sha256(terminal.model_dump(mode="json"))
                    if terminal is not None
                    else None
                ),
            )
        )

    def _quarantine_indeterminate(self) -> OptimizationControlResult:
        receipt = CandidateExecutionReceipt(
            execution_id=self._pending_execution_id or "unknown-execution",
            started=True,
            outcome=OptimizationOutcomeKind.INDETERMINATE,
        )
        return self._complete(OptimizationOutcomeKind.INDETERMINATE, receipt)

    def _next_intervention_id(self) -> str:
        return f"intervention-{len(self.ledger.replay().entries) + 1}"
