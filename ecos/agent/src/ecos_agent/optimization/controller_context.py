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
    OptimizationProposal,
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
    ) -> OptimizationPlanningContext:
        trajectories = self._history(include_receipts=self.receipt_aware_planning)
        history = trajectories[-6:]
        attempted = self._attempted_requests()
        active_values = {
            knob_id.value: current_values[knob_id.value]
            for knob_id in ACTIVE_OPTIMIZATION_KNOBS
        }
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
        effective_domains = tuple(
            compile_effective_domain(
                cards[knob_id],
                context=self._effective_domain_context(
                    observation,
                    active_values,
                    knob_id,
                    cards[knob_id].tool.revision,
                    cards[knob_id].surface.unit,
                    card_hash(cards[knob_id]),
                ),
                attempted=attempted,
                baseline_surface_value=active_values.get(knob_id.value),
            )
            for knob_id in ACTIVE_OPTIMIZATION_KNOBS
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
        available_actions = tuple(
            LegalAction(knob_id=domain.knob_id, direction=direction)
            for domain in effective_domains
            for direction in StrategyDirection
            if candidate_target_step(domain.knob_id) == observation.stage.value
            and domain.direction_schema(direction) is not None
        )
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
            supported_action_view = compile_supported_action_view(
                state=build_state_evidence_request(
                    task_id=retrieval.request.task_id,
                    retrieval_request_sha256=retrieval.request_sha256,
                    observation=observation,
                    current_values=current_values,
                    primary_metric=active_primary_metric,
                    preserve_metrics=active_preserve_metrics,
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
                        canonical_sha256(optimization_history_payload(item))
                        for item in history
                    ),
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
                    "legal_actions": [
                        item.model_dump(mode="json") for item in available_actions
                    ],
                    "ledger_head": self.ledger.replay().chain_head_sha256,
                    "history": [
                        optimization_history_payload(item) for item in history
                    ],
                    "parameter_knowledge": [
                        card.model_dump(mode="json") for card in parameter_knowledge
                    ],
                    "parameter_trajectories": [
                        optimization_history_payload(item) for item in trajectories
                    ],
                    "planning_feedback": planning_feedback,
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
        )

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
