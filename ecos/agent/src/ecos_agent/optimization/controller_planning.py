"""Planning decisions for controlled optimization episodes."""

from __future__ import annotations

from typing import Literal, Mapping

from pydantic import ValidationError

from ecos_agent.errors import ProposalProviderError
from ecos_agent.optimization.parameters.effective_domain import EffectiveDomainError
from ecos_agent.optimization.contracts import (
    OptimizationDecision,
    OptimizationEpisodeState,
    OptimizationProposal,
    RequestedKnobValue,
    StageObservation,
)
from ecos_agent.optimization.decision_audit import (
    DecisionValidationResult,
)
from ecos_agent.optimization.ledger import (
    OptimizationPlanningAuditEntry,
)
from ecos_agent.optimization.planning import (
    OptimizationPlannerTurn,
    OptimizationPlanningContext,
    v2_domains,
    v2_provider_payload_sha256,
    v2_to_v1,
    validate_planner_proposal,
    validate_v2_proposal,
)
from ecos_agent.optimization.knowledge.retrieval import (
    OptimizationRetrievalResult,
)
from ecos_agent.optimization.parameters.contracts import (
    OptimizationProposalV2,
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
            return self._result(
                "recovery_incomplete" if self.recovery_incomplete else "budget_exhausted"
            )

        self._state = OptimizationEpisodeState.PLANNING
        self._budget = self._consume(planning_calls=1)
        context = self._planning_context(observation, retrieval, current_values)
        planning_entry = self._append_planning_audit(context)
        self._persist()
        planner_source: Literal["llm", "repair"] = "llm"
        planner_turn: OptimizationPlannerTurn | None = None
        provider_payload_sha256 = None
        try:
            provider_payload_sha256 = v2_provider_payload_sha256(context)
        except EffectiveDomainError:
            return self._defer_or_escalate(
                planning_entry,
                context,
                proposal=None,
                reason="parameter_domain_unavailable",
                immediate_escalation=True,
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
            self._decision_audit.append(
                planning_entry_sha256=planning_entry.entry_sha256,
                proposal=None,
                validation_result="rejected",
                rejection_reason=(
                    str(exc) if isinstance(exc, EffectiveDomainError) else "proposal_schema"
                ),
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
                return self._defer_or_escalate(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="planning_budget_exhausted",
                    immediate_escalation=True,
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
                return self._defer_or_escalate(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="proposal_repair_failed",
                    planner_source="repair",
                    immediate_escalation=True,
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
            forbid_knowledge=self.mode == OptimizationAgentMode.LLM_NO_KNOWLEDGE,
        )
        if rejection_reason is not None:
            return self._defer_or_escalate(
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
                    "recovery_incomplete" if self.recovery_incomplete else None,
                    planner_source=planner_source,
                )
            reason = (
                "minimum_candidates_not_met"
                if proposal.decision == OptimizationDecision.STOP
                else "planner_continue"
            )
            return self._defer_or_escalate(
                planning_entry,
                context,
                proposal=proposal,
                reason=reason,
                planner_source=planner_source,
            )
        assert proposal.action is not None
        requested = planner_turn.requested
        if requested is None:
            return self._defer_or_escalate(
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

    def _invoke_planner(
        self, context: OptimizationPlanningContext
    ) -> OptimizationPlannerTurn:
        domains = v2_domains(context)
        if not domains:
            raise EffectiveDomainError("parameter planning domain is unavailable")
        propose_v2 = getattr(self.planner, "propose_v2", None)
        if not callable(propose_v2):
            raise ProposalProviderError(
                "optimization planner does not implement propose_v2",
                failure_class="unsupported",
            )
        raw = propose_v2(context, domains)
        try:
            parsed = OptimizationProposalV2.model_validate(raw)
        except (TypeError, ValueError) as exc:
            raise EffectiveDomainError("optimization proposal v3 is invalid") from exc
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

    def _defer_or_escalate(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        context: OptimizationPlanningContext,
        *,
        proposal: OptimizationProposal | None,
        reason: str,
        planner_source: Literal["llm", "repair"] = "llm",
        immediate_escalation: bool = False,
    ) -> OptimizationControlResult:
        self._planning_only_turns += 1
        self._proposal = None
        self._pending_v2_proposal = None
        self._requested = None
        if not context.legal_actions:
            self._state = OptimizationEpisodeState.STOPPED
            return self._finish_planning(
                planning_entry, proposal, "rejected", "no_legal_candidate",
                planner_source=planner_source,
            )
        if (
            not immediate_escalation
            and self._planning_only_turns < self._budget.budget.max_planning_only_turns
            and self._budget.remaining_planning_calls > 0
            and self._budget.remaining_wall_time_seconds > 0
        ):
            self._state = OptimizationEpisodeState.PLANNING
            return self._finish_planning(
                planning_entry,
                proposal,
                "rejected",
                reason,
                planner_source=planner_source,
            )

        self._state = OptimizationEpisodeState.ESCALATED
        return self._finish_planning(
            planning_entry,
            proposal,
            "rejected",
            reason,
            planner_source=planner_source,
        )

    def _finish_planning(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        proposal: OptimizationProposal | None,
        validation_result: DecisionValidationResult,
        rejection_reason: str | None,
        *,
        planner_source: Literal["llm", "repair"] = "llm",
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
