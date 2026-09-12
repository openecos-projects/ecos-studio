"""Planning context and evidence assembly for optimization episodes."""

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
    PlanningProviderEvidence,
    ProposalAction,
    ProposalContextRef,
    ProposalReason,
    RequestedKnobValue,
    SelectionMetric,
    StageObservation,
    StrategyDirection,
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
    ObjectiveAlignmentError,
    recovery_violation_counts,
)
from ecos_agent.optimization.planning import (
    InFlightExperiment,
    OptimizationHistory,
    OptimizationPlannerTurn,
    OptimizationPlanningContext,
    OptimizationProposalPlanner,
    in_flight_payload,
    optimization_history_payload,
    planning_context_payload,
    stage_evidence_payload,
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
from ecos_agent.optimization.knob_policy import (
    KNOB_ROLES as _KNOB_ROLES,
    allowed_knobs,
    history_layer_signal,
    layer_priority,
    policy_payload,
    select_search_actions,
)
from ecos_agent.optimization.parameters.semantics import (
    LATTICE_VERSION,
    card_hash,
    load_parameter_cards,
)

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


from ecos_agent.optimization.controller_models import (
    OptimizationAgentMode,
    OptimizationControlResult,
    OptimizationEpisodeControllerError,
)


class ControllerContextMixin:
    def _planning_context(
        self,
        observation: StageObservation,
        retrieval: OptimizationRetrievalResult,
        current_values: Mapping[str, bool | int | float],
        stage_observations: Mapping[str, StageObservation] | None = None,
    ) -> OptimizationPlanningContext:
        trajectories = self._history(include_receipts=self.receipt_aware_planning)
        history = trajectories[-6:]
        active_values = {
            knob_id.value: current_values[knob_id.value]
            for knob_id in ACTIVE_OPTIMIZATION_KNOBS if knob_id.value in current_values
        }
        parent_config_sha256 = canonical_sha256(dict(sorted(active_values.items())))
        cards = load_parameter_cards()
        parameter_knowledge = (
            tuple(cards[knob_id] for knob_id in ACTIVE_OPTIMIZATION_KNOBS)
            if self.mode != OptimizationAgentMode.LLM_NO_KNOWLEDGE else ()
        )
        prior_decisions = self._decision_audit.replay().entries
        planning_feedback = (
            (prior_decisions[-1].rejection_reason,)
            if prior_decisions and prior_decisions[-1].validation_result == "rejected"
            and prior_decisions[-1].rejection_reason else ()
        )
        effective_domains = self._parameter_domains(observation, active_values)
        search_layer, selected_actions = self._select_parameter_actions(
            effective_domains, observation
        )
        # Cross-stage actions require the evidence of their own stage: the
        # primary observation covers its stage, extra stages must be supplied.
        stage_evidence = {observation.stage.value}
        if stage_observations:
            stage_evidence.update(stage_observations)
        available_actions = tuple(
            action for action in selected_actions
            if candidate_target_step(action.knob_id) in stage_evidence
        )
        parameter_policy = policy_payload(
            self._objective, search_layer,
            priority=layer_priority(
                self._objective,
                history=tuple(
                    (item.requested.knob_id, item.layer_signal)
                    for item in self._history()
                    if item.layer_signal is not None
                ),
                recovering=self.recovery_incomplete,
            ),
        )
        task_memory = (
            self._task_memory_supplier()
            if self.receipt_aware_planning and self._task_memory_supplier is not None
            else None
        )
        if task_memory is not None and (
            not isinstance(task_memory, OptimizationTaskMemorySnapshot)
            or task_memory.scope.scope_sha256 != self._task_memory_scope_sha256
            or task_memory.scope.episode_id != self.episode_id
            or task_memory.scope.checkpoint_id != self.checkpoint_id
            or (
                self._objective is not None
                and task_memory.scope.objective_contract_sha256
                != self._objective.contract_sha256
            )
        ):
            raise OptimizationEpisodeControllerError(
                "task memory snapshot does not match the episode"
            )
        in_flight = self._in_flight_experiments()
        observation_ref = ObservationReference(
            observation_id=observation.observation_id,
            sha256=canonical_sha256(observation.model_dump(mode="json")),
        )
        active_objective = self.active_objective
        active_primary_metric = (
            active_objective.active_primary_metric
            if active_objective is not None
            else self._objective.primary_metric
            if self._objective is not None
            else None
        )
        active_preserve_metrics = (
            active_objective.active_preserve_metrics
            if active_objective is not None
            else self._objective.preserve_metrics
            if self._objective is not None
            else ()
        )
        if self.mode == OptimizationAgentMode.LLM_NO_KNOWLEDGE:
            knowledge_refs: tuple[KnowledgeReference, ...] = ()
            knowledge_chunks: tuple[str, ...] = ()
            supported_action_view = None
        elif self.mode == OptimizationAgentMode.RAW_RAG:
            knowledge_refs = retrieval.knowledge_refs
            knowledge_chunks = tuple(
                channel.answer_text
                for channel in retrieval.channels
                if channel.answer_text is not None
            )
            supported_action_view = None
        else:
            state_rule_manifest = load_state_rule_manifest()
            supported_action_view = compile_supported_action_view(
                state=build_state_evidence_request(
                    task_id=retrieval.request.task_id,
                    retrieval_request_sha256=retrieval.request_sha256,
                    observation=observation,
                    current_values=current_values,
                    primary_metric=active_primary_metric,
                    preserve_metrics=active_preserve_metrics,
                    objective_contract_sha256=(
                        self._objective.contract_sha256
                        if self._objective is not None
                        else None
                    ),
                    state_rule_manifest_sha256=state_rule_manifest.manifest_sha256,
                    incumbent=self._incumbent,
                    historical_metrics=tuple(
                        {
                            metric.value: value
                            for metric, value in item.terminal_observation.metrics.items()
                        }
                        for item in history
                        if item.terminal_observation is not None
                    ),
                    history_sha256=tuple(
                        canonical_sha256(
                            optimization_history_payload(
                                item, incumbent=self._incumbent
                            )
                        )
                        for item in history
                    ),
                    trend_epsilon=state_rule_manifest.trend_noise_tolerance,
                ),
                catalog=retrieval.support_catalog,
                candidate_refs=retrieval.candidate_refs,
                retrieval_ranked_refs=tuple(
                    ref
                    for channel in retrieval.channels
                    if channel.channel == KnowledgeChannel.GENERAL
                    for ref in channel.knowledge_refs
                    if ref in retrieval.candidate_refs
                ),
                legal_actions=available_actions,
                effective_domains=effective_domains,
            )
            tool_refs = tuple(
                item
                for channel in retrieval.channels
                if channel.channel == KnowledgeChannel.TOOL
                for item in channel.knowledge_refs
            )
            combined_refs = (*tool_refs, *supported_action_view.exposed_claim_refs)
            knowledge_refs = tuple(
                {
                    (ref.entity_id, ref.chunk_sha256): ref for ref in combined_refs
                }.values()
            )
            knowledge_chunks = tuple(
                channel.answer_text
                for channel in retrieval.channels
                if channel.channel == KnowledgeChannel.TOOL
                and channel.answer_text is not None
            )
        if self.mode == OptimizationAgentMode.FULL_AGENT:
            self._sync_case_pool()
            case_replay = self._case_audit.verify()
            selection, empirical_cases = select_empirical_cases(
                case_replay.cases,
                shot_count=self.knowledge_case_shots,
                eligible_binding_ids=tuple(
                    sorted(
                        {item.binding_id for item in supported_action_view.actions}
                    )
                ),
                eligible_toolchain_refs=tuple(
                    sorted(
                        {item.toolchain_ref for item in supported_action_view.actions}
                    )
                ),
                held_out_design=self._design_id(),
            )
            empirical_case_audit = build_empirical_case_audit(
                selection, empirical_cases
            )
            self._case_audit.append_selection(empirical_case_audit)
        else:
            empirical_cases = ()
            empirical_case_audit = None
        context_ref = ProposalContextRef(
            episode_id=self.episode_id,
            checkpoint_id=self.checkpoint_id,
            input_sha256=canonical_sha256(
                {
                    "observation_ref": observation_ref.model_dump(mode="json"),
                    "incumbent": (
                        self._incumbent.model_dump(mode="json")
                        if self._incumbent is not None
                        else None
                    ),
                    "retrieval": retrieval.contract,
                    "supported_action_view": (
                        supported_action_view.model_dump(mode="json")
                        if supported_action_view is not None
                        else None
                    ),
                    "empirical_cases": [
                        item.model_dump(mode="json") for item in empirical_cases
                    ],
                    "empirical_case_audit": (
                        empirical_case_audit.model_dump(mode="json")
                        if empirical_case_audit is not None
                        else None
                    ),
                    "objective": (
                        self._objective.model_dump(mode="json")
                        if self._objective is not None
                        else None
                    ),
                    "objective_alignment": (
                        self._objective_alignment.model_dump(mode="json")
                        if self._objective_alignment is not None
                        else None
                    ),
                    "active_objective": (
                        active_objective.model_dump(mode="json")
                        if active_objective is not None
                        else None
                    ),
                    "budget": self._budget.model_dump(mode="json"),
                    "current_values": dict(sorted(active_values.items())),
                    "parameter_policy": parameter_policy,
                    "legal_actions": [
                        item.model_dump(mode="json") for item in available_actions
                    ],
                    "ledger_head": self.ledger.replay().chain_head_sha256,
                    "history": [
                        optimization_history_payload(
                            item, incumbent=self._incumbent
                        )
                        for item in history
                    ],
                    "parameter_knowledge": [
                        card.model_dump(mode="json") for card in parameter_knowledge
                    ],
                    "parameter_trajectories": [
                        optimization_history_payload(
                            item, incumbent=self._incumbent
                        )
                        for item in trajectories
                    ],
                    "planning_feedback": planning_feedback,
                    "in_flight": [in_flight_payload(item) for item in in_flight],
                    "stage_evidence": stage_evidence_payload(
                        observation.stage.value, observation_ref,
                        stage_observations or {},
                    ),
                    "parent_config_sha256": parent_config_sha256,
                    "task_memory": (
                        task_memory.model_dump(mode="json")
                        if task_memory is not None
                        else None
                    ),
                    "effective_domains": [
                        item.model_dump(mode="json") for item in effective_domains
                    ],
                }
            ),
        )
        return OptimizationPlanningContext(
            context_ref,
            observation_ref,
            self._incumbent,
            history,
            knowledge_refs,
            knowledge_chunks,
            observation,
            self._budget,
            active_values,
            available_actions,
            self._objective,
            task_memory,
            effective_domains,
            supported_action_view,
            empirical_cases,
            empirical_case_audit,
            self._objective_alignment,
            active_objective,
            parameter_knowledge,
            trajectories,
            planning_feedback,
            parameter_policy,
            in_flight,
            dict(stage_observations or {}),
            parent_config_sha256,
        )

    def _in_flight_experiments(self) -> tuple[InFlightExperiment, ...]:
        return tuple(
            InFlightExperiment(
                intervention_id=record.intervention_id,
                execution_id=record.execution_id,
                requested=record.requested,
                direction=record.proposal_v2.action.direction.value
                if record.proposal_v2.action is not None
                else record.proposal.action.direction.value
                if record.proposal.action is not None
                else "increase",
                rationale_summary=record.proposal.rationale_summary,
                parent_config_sha256=record.parent_config_sha256,
            )
            for record in self._pending_executions.values()
        )

    def _parameter_domains(self, observation, current_values):
        cards = load_parameter_cards()
        parent_config_sha256 = canonical_sha256(
            dict(sorted(current_values.items()))
        )
        return tuple(
            compile_effective_domain(
                cards[knob],
                context=self._effective_domain_context(
                    observation, current_values, knob, cards[knob].tool.revision,
                    cards[knob].surface.unit, card_hash(cards[knob]),
                ),
                attempted=self._attempted_requests(parent_config_sha256),
                baseline_surface_value=current_values.get(knob.value),
            )
            for knob in allowed_knobs(self._objective)
        )

    def _select_parameter_actions(self, domains, observation):
        available = tuple(
            LegalAction(knob_id=domain.knob_id, direction=direction)
            for domain in domains for direction in StrategyDirection
            if domain.direction_schema(direction) is not None
        )
        return select_search_actions(
            self._objective, available,
            history=tuple(
                (item.requested.knob_id, item.layer_signal)
                for item in self._history()
                if item.layer_signal is not None
            ),
            recovering=self.recovery_incomplete,
        )

    def planning_stage(self, observation, current_values):
        """Return the recommended layer's stage for the primary observation."""
        active_values = {knob.value: current_values[knob.value] for knob in ACTIVE_OPTIMIZATION_KNOBS if knob.value in current_values}
        layer, actions = self._select_parameter_actions(self._parameter_domains(observation, active_values), observation)
        for action in actions:
            if _KNOB_ROLES.get(action.knob_id) == layer:
                return candidate_target_step(action.knob_id)
        return candidate_target_step(actions[0].knob_id) if actions else "place"

    def planning_stages(self, observation, current_values):
        """Extra stages whose evidence cross-stage legal actions need."""
        stages = {
            candidate_target_step(knob) for knob in allowed_knobs(self._objective)
        }
        stages.discard(observation.stage.value)
        return tuple(sorted(stages))

    def _design_id(self) -> str | None:
        value = self._execution_context.get("design_id")
        return value if isinstance(value, str) and _ID.fullmatch(value) else None

    def _sync_case_pool(self) -> None:
        pool = self._case_pool.verify()
        if self._external_case_pool and (
            pool.event_count != self._case_pool_event_count
            or pool.chain_head_sha256 != self._case_pool_chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "frozen knowledge case pool changed during the episode"
            )
        local = {item.case_id: item for item in self._case_audit.verify().cases}
        for case in pool.cases:
            existing = local.get(case.case_id)
            if existing is not None:
                if existing != case:
                    raise OptimizationEpisodeControllerError(
                        "empirical case pool conflicts with episode audit"
                    )
                continue
            self._case_audit.append_case(case)
            local[case.case_id] = case

    def _effective_domain_context(
        self,
        observation: StageObservation,
        current_values: Mapping[str, bool | int | float],
        knob_id: OptimizationKnob,
        tool_revision: str,
        unit: str,
        parameter_card_sha256: str,
    ) -> dict[str, object]:
        """Build the stable, per-knob context used to bind domain evidence."""
        parent_lineage = (
            self._execution_context.get("parent_lineage_sha256")
            or self._parent_manifest_sha256
            or canonical_sha256(
                {"episode_id": self.episode_id, "checkpoint_id": self.checkpoint_id}
            )
        )
        incumbent_state = (
            self._incumbent.model_dump(mode="json")
            if self._incumbent is not None
            else None
        )
        context = {
            **self._execution_context,
            "design_sha256": self._execution_context.get(
                "design_sha256", observation.evidence_manifest_sha256
            ),
            "parent_lineage_sha256": parent_lineage,
            "incumbent_state_sha256": canonical_sha256(incumbent_state),
            "stage": candidate_target_step(knob_id),
            "backend": self._execution_context.get("backend", "ecc"),
            "tool_revision": tool_revision,
            "parameter_card_sha256": parameter_card_sha256,
            "lattice_version": LATTICE_VERSION,
            "unit": unit,
            "site_width_dbu": self._execution_context.get("site_width_dbu", 1),
            "seed": self._execution_context.get("seed", 0),
            "current_values": dict(sorted(current_values.items())),
            "terminal_execution_contract_sha256": canonical_sha256(
                {
                    "target_step": candidate_target_step(knob_id),
                    "end_step": CANDIDATE_END_STEP,
                    "execution_scope": CANDIDATE_EXECUTION_SCOPE,
                }
            ),
        }
        if self._objective is not None and self._objective.parameter_policy is not None:
            context["objective_contract_sha256"] = self._objective.contract_sha256
            context["parameter_policy_sha256"] = canonical_sha256(
                self._objective.parameter_policy.model_dump(mode="json")
            )
        context["tool_revision"] = tool_revision
        context["parameter_card_sha256"] = parameter_card_sha256
        context["unit"] = unit
        return context

    def _execution_seed(self) -> int:
        seed = self._execution_context.get("seed")
        if type(seed) is not int:
            raise OptimizationEpisodeControllerError(
                "execution context seed is invalid"
            )
        return seed

    def _execution_revision(self) -> str:
        revision = self._execution_context.get("ecc_revision")
        if (
            not isinstance(revision, str)
            or not revision.strip()
            or revision.strip() == "unknown"
        ):
            raise OptimizationEpisodeControllerError(
                "execution context ECC revision is invalid"
            )
        return revision.strip()

    def _append_planning_audit(
        self, context: OptimizationPlanningContext
    ) -> OptimizationPlanningAuditEntry:
        return self._planning_audit.append(
            context_ref=context.context_ref,
            history_refs=tuple(item.reference for item in context.history),
            history_outcomes=tuple(item.outcome for item in context.history),
            budget_snapshot=self._budget,
            incumbent=self._incumbent,
            planner_payload_sha256=canonical_sha256(planning_context_payload(context)),
            task_memory_snapshot_sha256=(
                context.task_memory.snapshot_sha256
                if context.task_memory is not None
                else None
            ),
            task_memory_refs=(
                tuple(item.reference for item in context.task_memory.summaries)
                if context.task_memory is not None
                else ()
            ),
            effective_domains=context.effective_domains,
        )

    def _history(
        self, *, include_receipts: bool = True
    ) -> tuple[OptimizationHistory, ...]:
        replay = self.ledger.replay()
        starts = {
            entry.payload.intervention_id: entry.payload
            for entry in replay.entries
            if isinstance(entry.payload, OptimizationInterventionStart)
        }
        decisions = {
            canonical_sha256(entry.proposal.model_dump(mode="json")): entry
            for entry in self._decision_audit.replay().entries
            if entry.validation_result == "accepted" and entry.proposal is not None
        }
        planning = {
            entry.entry_sha256: entry for entry in self._planning_audit.replay().entries
        }
        history = []
        for outcome in replay.terminal_outcomes:
            start = starts[outcome.intervention_id]
            if start.proposal_action is None or start.requested is None:
                continue
            decision = decisions.get(start.proposal_sha256)
            prior = planning.get(decision.planning_entry_sha256) if decision else None
            active_before = outcome.active_objective
            layer_signal = history_layer_signal(
                incumbent_decision=outcome.incumbent_decision,
                recovery_transition=outcome.recovery_transition,
                active_stage=(
                    active_before.recovery_stage if active_before is not None else None
                ),
                active_primary=(
                    active_before.active_primary_metric.value
                    if active_before is not None
                    else None
                ),
                decisive_metric=(
                    outcome.decisive_metric.value
                    if outcome.decisive_metric is not None
                    else None
                ),
            )
            history.append(
                OptimizationHistory(
                    reference=HistoryReference(
                        intervention_id=outcome.intervention_id,
                        outcome_sha256=canonical_sha256(
                            outcome.model_dump(mode="json")
                        ),
                    ),
                    outcome=outcome.outcome,
                    action=start.proposal_action,
                    requested=start.requested,
                    terminal_observation=outcome.terminal_observation,
                    parameter_application_receipt=(
                        outcome.parameter_application_receipt
                        if include_receipts
                        else None
                    ),
                    rationale_summary=decision.proposal.rationale_summary if decision else None,
                    planning_values=(
                        {
                            domain.knob_id.value: domain.current_coordinate["surface_value"]
                            for domain in prior.effective_domains
                            if domain.current_coordinate is not None
                        }
                        if prior else None
                    ),
                    incumbent_decision=(
                        outcome.incumbent_decision.value
                        if outcome.incumbent_decision is not None
                        else None
                    ),
                    decisive_metric=(
                        outcome.decisive_metric.value
                        if outcome.decisive_metric is not None
                        else None
                    ),
                    recovery_transition=outcome.recovery_transition,
                    layer_signal=layer_signal.value,
                )
            )
        return tuple(history)

    def _record_planning_provider_evidence(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        *,
        expected_payload_sha256: str | None = None,
    ) -> None:
        consume = getattr(self.planner, "consume_planning_evidence", None)
        if consume is None:
            return
        if not callable(consume):
            raise OptimizationEpisodeControllerError(
                "planner evidence reader is invalid"
            )
        evidence = consume()
        if evidence is None:
            return
        try:
            parsed = PlanningProviderEvidence.model_validate(evidence)
        except (TypeError, ValidationError, ValueError) as exc:
            raise OptimizationEpisodeControllerError(
                "planner evidence is invalid"
            ) from exc
        expected_hash = expected_payload_sha256 or planning_entry.planner_payload_sha256
        if parsed.envelope.planner_payload_sha256 != expected_hash:
            raise OptimizationEpisodeControllerError(
                "planner evidence does not match the planning payload"
            )
        self._planning_provider_audit.append(
            planning_entry_sha256=planning_entry.entry_sha256,
            evidence=parsed,
        )
        self._persist()

    def _append_proposal_observation(
        self,
        planning_entry: OptimizationPlanningAuditEntry,
        turn: OptimizationPlannerTurn,
    ) -> None:
        """Persist structured proposal fields for knowledge mediation analysis."""
        path = self.ledger.root / "optimization-proposal-observations.v1.jsonl"
        proposal = turn.proposal
        action = proposal.action
        v2_action = turn.proposal_v2.action if turn.proposal_v2 else None
        payload = {
            "schema_version": "ecos.optimization_proposal_observation.v1",
            "planning_entry_sha256": planning_entry.entry_sha256,
            "proposal_sha256": canonical_sha256(proposal.model_dump(mode="json")),
            "decision": proposal.decision.value,
            "action": action.model_dump(mode="json") if action else None,
            "claim_id": v2_action.claim_id if v2_action else None,
            "binding_id": v2_action.binding_id if v2_action else None,
            "claim_sha256": v2_action.claim_sha256 if v2_action else None,
            "binding_sha256": v2_action.binding_sha256 if v2_action else None,
            "requested_knob_id": (
                turn.requested.knob_id.value if turn.requested else None
            ),
            "requested_value": turn.requested.value if turn.requested else None,
            "expected_effects": (
                [
                    effect.model_dump(mode="json")
                    for effect in v2_action.expected_effects
                ]
                if v2_action
                else []
            ),
            "context_fingerprint": (
                planning_entry.effective_domains[0].context_sha256
                if planning_entry.effective_domains
                else None
            ),
            "knowledge_refs": [ref.model_dump(mode="json") for ref in proposal.knowledge_refs],
        }
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, sort_keys=True) + "\n")
