"""Crash recovery and in-flight reattachment for optimization episodes."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Literal, Mapping

from pydantic import ValidationError

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.contracts import (
    OptimizationEpisodeState,
    TerminalObservation,
)
from ecos_agent.optimization.controller_models import (
    _PersistedEpisodeState,
    OptimizationEpisodeControllerError,
)
from ecos_agent.optimization.decision_audit import (
    OptimizationDecisionAudit,
)
from ecos_agent.optimization.execution import CandidateExecutionEvidence
from ecos_agent.optimization.knowledge.cases import (
    EmpiricalCaseAuditReplay,
    EmpiricalCaseAuditStore,
    replay_case_audit_prefix,
)
from ecos_agent.optimization.ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationLedgerReplay,
    OptimizationPlanningAudit,
    OptimizationPlanningAuditReplay,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationPlanningProviderEvidenceReplay,
    OptimizationTerminalOutcome,
)
from ecos_agent.optimization.memory import OptimizationTaskMemorySnapshot
from ecos_agent.optimization.objective_alignment import (
    ActiveOptimizationObjective,
    OptimizationObjectiveAlignment,
)
from ecos_agent.optimization.planning import OptimizationProposalPlanner
from ecos_agent.optimization.execution import OptimizationExecutionAdapter
from ecos_agent.optimization.geometry import GeometrySnapshot
from ecos_agent.optimization.rules import geometry_constraint_error


_STATE_FILE = "optimization-episode-state.v10.json"
_SINGLE_PENDING_STATE_FILE = "optimization-episode-state.v9.json"
_LEGACY_STATE_FILES = (
    "optimization-episode-state.v2.json",
    "optimization-episode-state.v3.json",
    "optimization-episode-state.v4.json",
    "optimization-episode-state.v5.json",
    "optimization-episode-state.v6.json",
    "optimization-episode-state.v7.json",
    "optimization-episode-state.v8.json",
)


class ControllerRecoveryMixin:
    @classmethod
    def recover(
        cls,
        *,
        planner: OptimizationProposalPlanner,
        executor: OptimizationExecutionAdapter,
        ledger: OptimizationLedger,
        clock: Callable[[], float],
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
    ) -> "OptimizationEpisodeController":
        path = ledger.root / _STATE_FILE
        if not path.is_file():
            if (ledger.root / _SINGLE_PENDING_STATE_FILE).is_file():
                raise OptimizationEpisodeControllerError(
                    "single-pending episode state cannot be recovered; "
                    "start a new optimization episode"
                )
            if any(
                (ledger.root / name).is_file() for name in _LEGACY_STATE_FILES
            ):
                raise OptimizationEpisodeControllerError(
                    "pre-policy episode cannot be recovered; start a new optimization episode"
                )
        try:
            snapshot = _PersistedEpisodeState.model_validate_json(path.read_bytes())
        except (OSError, ValidationError, ValueError) as exc:
            raise OptimizationEpisodeControllerError(
                "episode state hash is invalid"
            ) from exc
        replay = ledger.recover()
        planning_audit = OptimizationPlanningAudit(ledger.root)
        audit_replay = planning_audit.verify()
        planning_provider_audit = OptimizationPlanningProviderEvidenceAudit(ledger.root)
        provider_audit_replay = planning_provider_audit.verify()
        decision_audit = OptimizationDecisionAudit(ledger.root)
        decision_audit_replay = decision_audit.verify()
        case_audit = EmpiricalCaseAuditStore(ledger.root)
        case_audit_replay = case_audit.verify()
        # R2: a crash between the ledger append and the state write leaves the
        # ledger ahead of the snapshot.  Replay only the surplus terminal
        # outcomes; any other divergence stays an integrity error.  Case-audit
        # entries appended by the surplus merges are tolerated the same way.
        surplus_terminals: tuple[OptimizationTerminalOutcome, ...] = ()
        prefix_replay = replay
        prefix_case_audit = case_audit_replay
        if snapshot.ledger_event_count != len(replay.entries):
            surplus_terminals = cls._surplus_terminal_outcomes(snapshot, replay)
            prefix_replay = cls._replay_prefix(replay, snapshot.ledger_event_count)
            prefix_case_audit = replay_case_audit_prefix(
                case_audit_replay, snapshot.case_audit_event_count
            )
        cls._verify_snapshot_trace(
            snapshot,
            prefix_replay,
            audit_replay,
            provider_audit_replay,
            decision_audit_replay,
            prefix_case_audit,
        )
        if snapshot.task_memory_scope_sha256 != task_memory_scope_sha256:
            raise OptimizationEpisodeControllerError(
                "task memory scope does not match the recovered episode"
            )
        recovered_execution_context = dict(execution_context or {})
        if snapshot.execution_context_sha256 != canonical_sha256(
            recovered_execution_context
        ):
            raise OptimizationEpisodeControllerError(
                "execution context does not match the recovered episode"
            )

        controller = cls.__new__(cls)
        controller.episode_id = snapshot.episode_id
        controller.checkpoint_id = snapshot.checkpoint_id
        controller.mode = snapshot.mode
        controller._trend_noise_epsilon = controller._validated_trend_noise_epsilon(
            trend_noise_epsilon
        )
        controller._episode_design_id = controller._manifest_scope_check(design_id)
        if snapshot.knowledge_case_shots != knowledge_case_shots:
            raise OptimizationEpisodeControllerError(
                "knowledge case shots do not match the recovered episode"
            )
        controller.knowledge_case_shots = snapshot.knowledge_case_shots
        if snapshot.receipt_aware_planning != receipt_aware_planning:
            raise OptimizationEpisodeControllerError(
                "receipt-aware planning mode does not match the recovered episode"
            )
        controller.receipt_aware_planning = snapshot.receipt_aware_planning
        if snapshot.max_in_flight_candidates != max_in_flight_candidates:
            raise OptimizationEpisodeControllerError(
                "in-flight candidate limit does not match the recovered episode"
            )
        controller.max_in_flight_candidates = snapshot.max_in_flight_candidates
        controller.planner = planner
        controller.executor = executor
        controller.ledger = ledger
        controller._clock = clock
        controller._started_at = snapshot.started_at
        controller._budget = snapshot.budget
        controller._incumbent = snapshot.incumbent
        controller._objective = snapshot.objective
        controller._baseline_geometry = snapshot.baseline_geometry
        controller._objective_alignment = snapshot.objective_alignment
        controller._frozen_objective = snapshot.frozen_objective
        controller._parent_manifest_sha256 = snapshot.parent_manifest_sha256
        controller._task_memory_scope_sha256 = snapshot.task_memory_scope_sha256
        controller._task_memory_supplier = task_memory_supplier
        controller._execution_context = recovered_execution_context
        controller._planning_audit = planning_audit
        controller._planning_provider_audit = planning_provider_audit
        controller._decision_audit = decision_audit
        controller._case_audit = case_audit
        controller._external_case_pool = knowledge_case_pool_root is not None
        controller._case_pool = EmpiricalCaseAuditStore(
            knowledge_case_pool_root
            if knowledge_case_pool_root is not None
            else ledger.root.parent / "knowledge-case-pool",
            read_only=knowledge_case_pool_root is not None,
        )
        pool = controller._case_pool.verify()
        if controller._external_case_pool and any(
            case.split != "train" for case in pool.cases
        ):
            raise OptimizationEpisodeControllerError(
                "external knowledge case pool contains a non-training case"
            )
        if (
            snapshot.external_case_pool != controller._external_case_pool
            or snapshot.case_pool_event_count != pool.event_count
            or snapshot.case_pool_chain_head_sha256 != pool.chain_head_sha256
        ):
            raise OptimizationEpisodeControllerError(
                "knowledge case pool does not match the recovered episode"
            )
        controller._case_pool_event_count = pool.event_count
        controller._case_pool_chain_head_sha256 = pool.chain_head_sha256
        controller._state = snapshot.state
        controller._proposal = snapshot.proposal
        controller._pending_v2_proposal = snapshot.pending_v2_proposal
        controller._requested = snapshot.requested
        controller._approved_planning_entry_sha256 = (
            snapshot.approved_planning_entry_sha256
        )
        controller._approved_parent_incumbent_sha256 = (
            snapshot.approved_parent_incumbent_sha256
        )
        controller._approved_parent_config_sha256 = (
            snapshot.approved_parent_config_sha256
        )
        controller._attempted_probes = snapshot.attempted_probes
        controller._pending_executions = {
            record.intervention_id: record
            for record in snapshot.pending_executions
        }
        controller._execution_bindings = snapshot.execution_bindings
        controller._planning_only_turns = snapshot.planning_only_turns
        controller._incumbent_candidate_root_ref = snapshot.incumbent_candidate_root_ref
        controller._incumbent_candidate_manifest_ref = (
            snapshot.incumbent_candidate_manifest_ref
        )
        controller._incumbent_candidate_manifest_sha256 = (
            snapshot.incumbent_candidate_manifest_sha256
        )

        if controller._objective is not None:
            violation = geometry_constraint_error(
                controller._objective, controller._baseline_geometry, controller._incumbent,
            )
            if violation is not None:
                raise OptimizationEpisodeControllerError(violation)
        expected_geometry = recovered_execution_context.get("geometry_baseline_sha256")
        if expected_geometry is not None and expected_geometry != canonical_sha256(
            controller._baseline_geometry.model_dump(mode="json") if controller._baseline_geometry else None
        ):
            raise OptimizationEpisodeControllerError("initial geometry does not match the execution context")
        # R2: apply the already-ledgered terminal outcomes that the snapshot
        # never saw, in chain order, exactly once.
        if surplus_terminals:
            controller._reconcile_surplus_terminals(surplus_terminals)
        # R1: in-flight candidates keep their identity, parent snapshot, and
        # budget reservation; the coordinator reattaches and keeps collecting.
        if controller._pending_executions:
            if controller._state not in {
                OptimizationEpisodeState.QUARANTINED,
                OptimizationEpisodeState.STOPPED,
                OptimizationEpisodeState.TERMINAL,
                OptimizationEpisodeState.ESCALATED,
            }:
                controller._state = OptimizationEpisodeState.EXECUTING
        elif controller._state == OptimizationEpisodeState.EXECUTING:
            controller._state = OptimizationEpisodeState.PLANNING
        if surplus_terminals or controller._state != snapshot.state:
            controller._persist()
        return controller

    @staticmethod
    def _surplus_terminal_outcomes(
        snapshot: _PersistedEpisodeState, replay: OptimizationLedgerReplay
    ) -> tuple[OptimizationTerminalOutcome, ...]:
        count = snapshot.ledger_event_count
        if count < 0 or count > len(replay.entries):
            raise OptimizationEpisodeControllerError(
                "episode state does not match ledger trace"
            )
        prefix_head = (
            replay.entries[count - 1].entry_sha256 if count else None
        )
        if prefix_head != snapshot.ledger_chain_head_sha256:
            raise OptimizationEpisodeControllerError(
                "episode state does not match ledger trace"
            )
        surplus = tuple(
            entry.payload
            for entry in replay.entries[count:]
            if isinstance(entry.payload, OptimizationTerminalOutcome)
        )
        if len(surplus) != len(replay.entries) - count:
            raise OptimizationEpisodeControllerError(
                "episode state does not match ledger trace"
            )
        pending_ids = {record.intervention_id for record in snapshot.pending_executions}
        if any(outcome.intervention_id not in pending_ids for outcome in surplus):
            raise OptimizationEpisodeControllerError(
                "episode state does not match ledger trace"
            )
        return surplus

    @staticmethod
    def _replay_prefix(
        replay: OptimizationLedgerReplay, count: int
    ) -> OptimizationLedgerReplay:
        entries = replay.entries[:count]
        starts = [
            entry.payload.intervention_id
            for entry in entries
            if isinstance(entry.payload, OptimizationInterventionStart)
        ]
        terminals = {
            entry.payload.intervention_id
            for entry in entries
            if isinstance(entry.payload, OptimizationTerminalOutcome)
        }
        return OptimizationLedgerReplay(
            entries=entries,
            pending_intervention_ids=tuple(
                intervention_id
                for intervention_id in starts
                if intervention_id not in terminals
            ),
            terminal_outcomes=tuple(
                entry.payload
                for entry in entries
                if isinstance(entry.payload, OptimizationTerminalOutcome)
            ),
            chain_head_sha256=entries[-1].entry_sha256 if entries else None,
        )

    def _reconcile_surplus_terminals(
        self, surplus: tuple[OptimizationTerminalOutcome, ...]
    ) -> None:
        from ecos_agent.optimization.rules import PROMOTING_DECISIONS, IncumbentDecision

        for outcome in surplus:
            record = self._pending_executions.pop(outcome.intervention_id, None)
            if record is None:
                raise OptimizationEpisodeControllerError(
                    "episode state does not match ledger trace"
                )
            decision = (
                IncumbentDecision(outcome.incumbent_decision)
                if outcome.incumbent_decision is not None
                else None
            )
            if decision in PROMOTING_DECISIONS - {IncumbentDecision.INITIALIZED}:
                terminal = outcome.terminal_observation
                if terminal is None:
                    raise OptimizationEpisodeControllerError(
                        "promoted surplus outcome has no terminal observation"
                    )
                evidence = (
                    CandidateExecutionEvidence(
                        candidate_root_ref=outcome.candidate_root_ref,
                        candidate_manifest_ref=outcome.candidate_manifest_ref,
                        candidate_manifest_sha256=(
                            outcome.candidate_manifest_sha256
                        ),
                    )
                    if outcome.candidate_root_ref is not None
                    and outcome.candidate_manifest_ref is not None
                    and outcome.candidate_manifest_sha256 is not None
                    else None
                )
                self._set_incumbent(terminal, evidence)
        if not self._pending_executions and self._state == (
            OptimizationEpisodeState.EXECUTING
        ):
            self._state = OptimizationEpisodeState.PLANNING
        if self._budget.exhausted and not self._pending_executions and self._state == (
            OptimizationEpisodeState.PLANNING
        ):
            self._state = OptimizationEpisodeState.STOPPED

