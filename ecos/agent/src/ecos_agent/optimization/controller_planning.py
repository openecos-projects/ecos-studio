"""Planning decisions for controlled optimization episodes."""

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


from ecos_agent.optimization.controller_models import (
    OptimizationAgentMode,
    OptimizationControlResult,
    OptimizationEpisodeControllerError,
)


class ControllerPlanningMixin:
    def plan(
        self,
        observation: StageObservation,
        retrieval: OptimizationRetrievalResult,
        current_values: Mapping[str, bool | int | float],
    ) -> OptimizationControlResult:
        self._refresh_budget()
        if self._state not in {
            OptimizationEpisodeState.CREATED,
            OptimizationEpisodeState.PLANNING,
        }:
            raise OptimizationEpisodeControllerError(
                "episode is not ready for planning"
            )
        if self._budget.exhausted:
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._pending_v2_proposal = None
            self._requested = None
            self._persist()
            return self._result("budget_exhausted")

        self._state = OptimizationEpisodeState.PLANNING
        self._budget = self._consume(planning_calls=1)
        context = self._planning_context(observation, retrieval, current_values)
        planning_entry = self._append_planning_audit(context)
        self._persist()
        planner_source: Literal["llm", "local_fallback", "repair"] = "llm"
        planner_turn: OptimizationPlannerTurn | None = None
        provider_payload_sha256 = None
        if self._v2_enabled():
            try:
                provider_payload_sha256 = v2_provider_payload_sha256(context)
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
        except (ProposalProviderError, TypeError, ValidationError, ValueError) as exc:
            if (
                isinstance(exc, ProposalProviderError)
                and exc.failure_class != "parse_error"
            ):
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
            self._decision_audit.append(
                planning_entry_sha256=planning_entry.entry_sha256,
                proposal=None,
                validation_result="rejected",
                rejection_reason="proposal_schema",
                requested=None,
                state=self._state,
                objective_contract_sha256=(
                    self._objective.contract_sha256
                    if self._objective is not None
                    else None
                ),
            )
            self._persist()
            self._refresh_budget()
            if (
                self._budget.remaining_planning_calls == 0
                or self._budget.remaining_wall_time_seconds == 0
            ):
                return self._defer_or_fallback(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="planning_budget_exhausted",
                    immediate_fallback=True,
                )
            self._budget = self._consume(planning_calls=1)
            context = self._planning_context(observation, retrieval, current_values)
            planning_entry = self._append_planning_audit(context)
            provider_payload_sha256 = v2_provider_payload_sha256(context)
            self._persist()
            try:
                planner_turn = self._invoke_planner(context)
            except (
                ProposalProviderError,
                TypeError,
                ValidationError,
                ValueError,
            ) as repair_exc:
                if (
                    isinstance(repair_exc, ProposalProviderError)
                    and repair_exc.failure_class != "parse_error"
                ):
                    raise
                self._record_planning_provider_evidence(
                    planning_entry,
                    expected_payload_sha256=provider_payload_sha256,
                )
                self._decision_audit.append(
                    planning_entry_sha256=planning_entry.entry_sha256,
                    proposal=None,
                    validation_result="rejected",
                    rejection_reason="v2_repair_failed",
                    requested=None,
                    state=self._state,
                    objective_contract_sha256=(
                        self._objective.contract_sha256
                        if self._objective is not None
                        else None
                    ),
                    planner_source="repair",
                )
                self._persist()
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

        rejection_reason = validate_planner_proposal(
            proposal,
            context,
            require_knowledge=self.mode == OptimizationAgentMode.FULL_AGENT,
            forbid_knowledge=self.mode == OptimizationAgentMode.LLM_NO_KNOWLEDGE,
        )
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
                    planning_entry,
                    proposal,
                    "accepted",
                    None,
                    planner_source=planner_source,
                )
            if proposal.decision == OptimizationDecision.STOP and (
                self._budget.consumed_candidates
                >= self._budget.budget.minimum_candidate_executions
                or not context.legal_actions
            ):
                self._state = OptimizationEpisodeState.STOPPED
                return self._finish_planning(
                    planning_entry,
                    proposal,
                    "accepted",
                    None,
                    planner_source=planner_source,
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
            known_aliases=context.excluded_surface_values,
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
        self._pending_v2_proposal = planner_turn.proposal_v2
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
    def _parse_proposal(self, payload: object) -> OptimizationProposal:
        if isinstance(payload, OptimizationProposal):
            return payload
        return OptimizationProposal.model_validate(payload)

    def _v2_enabled(self) -> bool:
        configured = getattr(self.planner, "optimization_proposal_v2_enabled", None)
        enabled = (
            configured
            if isinstance(configured, bool)
            else os.environ.get("ECOS_ENABLE_OPTIMIZATION_PROPOSAL_V2", "1") == "1"
        )
        return enabled

    def _invoke_planner(
        self, context: OptimizationPlanningContext
    ) -> OptimizationPlannerTurn:
        if not self._v2_enabled():
            return OptimizationPlannerTurn(
                self._parse_proposal(self.planner.propose(context))
            )
        domains = v2_domains(context)
        if not domains:
            raise EffectiveDomainError("v2 planning domain is unavailable")
        propose_v2 = getattr(self.planner, "propose_v2", None)
        if not callable(propose_v2):
            raise ProposalProviderError(
                "optimization v2 planner does not implement propose_v2",
                failure_class="unsupported",
            )
        raw = propose_v2(context, domains)
        try:
            parsed = OptimizationProposalV2.model_validate(raw)
        except (TypeError, ValueError) as exc:
            raise EffectiveDomainError("optimization proposal v2 is invalid") from exc
        if parsed.action is None:
            return OptimizationPlannerTurn(
                v2_to_v1(parsed),
                None,
                v2_provider_payload_sha256(context),
            )
        proposal = validate_v2_proposal(
            parsed,
            context,
            attempted=self._attempted_requests(),
            require_knowledge_support=self.mode == OptimizationAgentMode.FULL_AGENT,
        )
        return OptimizationPlannerTurn(
            v2_to_v1(proposal),
            (
                RequestedKnobValue(
                    knob_id=proposal.action.knob_id,
                    value=proposal.action.requested_value,
                )
                if proposal.action is not None
                else None
            ),
            v2_provider_payload_sha256(context),
            proposal,
        )

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
        self._pending_v2_proposal = None
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

        attempted_knobs = {item.knob_id for item in self._attempted_requests()}
        action = next(
            (
                item
                for item in context.legal_actions
                if item.knob_id not in attempted_knobs
            ),
            context.legal_actions[0],
        )
        fallback = self._fallback_proposal(context, action)
        assert fallback.action is not None
        requested = select_requested_value(
            fallback.action,
            current_values=context.current_values or {},
            attempted=self._attempted_requests(),
            known_aliases=context.excluded_surface_values,
        )
        if requested is None:
            raise OptimizationEpisodeControllerError(
                "local fallback has no legal value"
            )
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
