"""Planning decisions for controlled optimization episodes."""

from __future__ import annotations

from typing import Literal, Mapping

from pydantic import ValidationError

from ecos_agent.errors import ProposalProviderError
from ecos_agent.hashing import canonical_sha256
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
from ecos_agent.optimization.reflection import (
    PlanningFeedbackEntry,
    rejection_feedback_entry,
)
from ecos_agent.optimization.strategy import viable_strategy_step_count
from ecos_agent.optimization.knowledge.compiler import KnowledgeApplicability
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
        stage_observations: Mapping[str, StageObservation] | None = None,
    ) -> OptimizationControlResult:
        self._refresh_budget()
        if self._state not in {
            OptimizationEpisodeState.CREATED,
            OptimizationEpisodeState.PLANNING,
            OptimizationEpisodeState.EXECUTING,
        }:
            raise OptimizationEpisodeControllerError(
                "episode is not ready for planning"
            )
        if self._budget.exhausted:
            # B3: an exhausted budget only blocks new dispatch.  In-flight
            # candidates must still be collected before the episode may stop.
            if self._pending_executions:
                return self._result(
                    "recovery_incomplete" if self.recovery_incomplete else "budget_exhausted"
                )
            self._state = OptimizationEpisodeState.STOPPED
            self._proposal = None
            self._pending_v2_proposal = None
            self._requested = None
            self._persist()
            return self._result(
                "recovery_incomplete" if self.recovery_incomplete else "budget_exhausted"
            )
        if self.free_candidate_slots <= 0:
            # All in-flight slots are taken; wait for a terminal first.
            return self._result("no_free_candidate_slot")

        self._state = (
            OptimizationEpisodeState.PLANNING
            if not self._pending_executions
            else self._state
        )
        self._budget = self._consume(planning_calls=1)
        context = self._planning_context(
            observation, retrieval, current_values, stage_observations
        )
        planning_entry = self._append_planning_audit(context)
        self._persist()
        planner_source: Literal["llm", "repair"] = "llm"
        planner_turn: OptimizationPlannerTurn | None = None
        provider_payload_sha256 = None
        if not context.legal_actions:
            return self._defer_or_escalate(
                planning_entry, context, proposal=None, reason="no_legal_candidate",
            )
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
            rejection = (
                str(exc)
                if isinstance(exc, (EffectiveDomainError, ProposalProviderError))
                # planning_feedback forwards this text to the next turn: a
                # bare code gives the model nothing to correct.
                else f"proposal_schema: {str(exc)[:300]}"
            )
            self._record_planning_provider_evidence(
                planning_entry,
                expected_payload_sha256=provider_payload_sha256,
            )
            self._decision_audit.append(
                planning_entry_sha256=planning_entry.entry_sha256,
                proposal=None,
                validation_result="rejected",
                rejection_reason=rejection,
                attribution=rejection_feedback_entry(
                    rejection, legal_actions=context.legal_actions
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
            context = self._planning_context(
                observation, retrieval, current_values, stage_observations
            )
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
                # A failed repair is a formatting stall, not a fatal blocker:
                # one flaky output must not kill the episode (the glm7 pilot
                # escalated on a single misnamed strategy field).  Defer and
                # let the next turn retry; max_planning_only_turns still
                # bounds consecutive non-productive turns.
                return self._defer_or_escalate(
                    planning_entry,
                    context,
                    proposal=None,
                    reason="proposal_repair_failed",
                    planner_source="repair",
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
        self._append_proposal_observation(planning_entry, planner_turn)

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
        # A well-formed turn may refresh the declared multi-step strategy on
        # any decision; the strategy is planning guidance and every step still
        # passes full validation when it becomes the dispatched action.
        self._maybe_adopt_strategy(planner_turn.proposal_v2, context)
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
        # A4: remember the parent snapshot the proposal was validated against
        # so a later start cannot silently rebind it to a newer incumbent.
        self._approved_planning_entry_sha256 = planning_entry.entry_sha256
        self._approved_parent_incumbent_sha256 = (
            canonical_sha256(context.incumbent.model_dump(mode="json"))
            if context.incumbent is not None
            else None
        )
        self._approved_parent_config_sha256 = context.parent_config_sha256
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
            raise EffectiveDomainError(
                f"optimization proposal v3 is invalid: {exc}"
            ) from exc
        if parsed.action is None:
            return OptimizationPlannerTurn(
                v2_to_v1(parsed),
                None,
                v2_provider_payload_sha256(context),
                parsed,
            )
        proposal = validate_v2_proposal(
            parsed,
            context,
            attempted=self._attempted_requests(context.parent_config_sha256),
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

    def _maybe_adopt_strategy(
        self,
        proposal_v2: OptimizationProposalV2 | None,
        context: OptimizationPlanningContext,
    ) -> None:
        strategy = proposal_v2.strategy if proposal_v2 is not None else None
        if strategy is None:
            return
        self._active_strategy = strategy
        self._strategy_parent_config_sha256 = context.parent_config_sha256

    def _viable_strategy_steps(
        self, context: OptimizationPlanningContext
    ) -> int:
        return viable_strategy_step_count(
            self._active_strategy,
            incumbent=context.incumbent,
            history=context.history,
            legal_actions=context.legal_actions,
            attempted=self._attempted_requests(context.parent_config_sha256),
        )

    def _non_dispatch_is_productive(
        self, context: OptimizationPlanningContext, reason: str
    ) -> bool:
        """A continue is productive while a reasonable hypothesis exists.

        Waiting for dispatched in-flight evidence, continuing under a
        declared strategy with a legal, unattempted, unblocked step, and
        abstaining because the state compiler evaluated the supplied
        knowledge claims as blocked or unknown are all forward progress;
        they must not burn the escalation budget.  A bare continue with
        nothing declared still counts toward the stall limit.
        """
        if reason != "planner_continue":
            return False
        if self._pending_executions:
            return True
        if self._viable_strategy_steps(context) > 0:
            return True
        view = context.supported_action_view
        return view is not None and any(
            match.applicability in {
                KnowledgeApplicability.BLOCKED,
                KnowledgeApplicability.UNKNOWN,
            }
            for match in view.matches
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
        self._proposal = None
        self._pending_v2_proposal = None
        self._requested = None
        if not context.legal_actions:
            self._state = OptimizationEpisodeState.STOPPED
            return self._finish_planning(
                planning_entry, proposal, "rejected", "no_legal_candidate",
                planner_source=planner_source,
                attribution=rejection_feedback_entry(
                    "no_legal_candidate", legal_actions=context.legal_actions
                ),
            )
        attribution = rejection_feedback_entry(
            reason, legal_actions=context.legal_actions
        )
        if self._non_dispatch_is_productive(context, reason):
            self._planning_only_turns = 0
        else:
            self._planning_only_turns += 1
        if (
            not immediate_escalation
            and self._planning_only_turns < self._budget.budget.max_planning_only_turns
            and self._budget.remaining_planning_calls > 0
            and self._budget.remaining_wall_time_seconds > 0
        ):
            self._state = (
                OptimizationEpisodeState.EXECUTING
                if self._pending_executions
                else OptimizationEpisodeState.PLANNING
            )
            return self._finish_planning(
                planning_entry,
                proposal,
                "rejected",
                reason,
                planner_source=planner_source,
                attribution=attribution,
            )

        self._state = OptimizationEpisodeState.ESCALATED
        return self._finish_planning(
            planning_entry,
            proposal,
            "rejected",
            reason,
            planner_source=planner_source,
            attribution=attribution,
        )

    def _finish_planning(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        proposal: OptimizationProposal | None,
        validation_result: DecisionValidationResult,
        rejection_reason: str | None,
        *,
        planner_source: Literal["llm", "repair"] = "llm",
        attribution: PlanningFeedbackEntry | None = None,
    ) -> OptimizationControlResult:
        self._decision_audit.append(
            planning_entry_sha256=planning_entry.entry_sha256,
            proposal=proposal,
            validation_result=validation_result,
            rejection_reason=rejection_reason,
            attribution=attribution,
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
