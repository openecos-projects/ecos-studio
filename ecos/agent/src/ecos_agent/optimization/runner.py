"""Fake-only orchestration for one bounded optimization planning turn."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable, Mapping

from ecos_agent.optimization.contracts import (
    BudgetSnapshot,
    OptimizationEpisodeState,
    OptimizationObjectiveContract,
    RequestedKnobValue,
    RoutabilityObjectiveContract,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization.controller import (
    OptimizationControlResult,
    OptimizationEpisodeController,
)
from ecos_agent.optimization.execution import CandidateExecutionReceipt
from ecos_agent.optimization.ledger import OptimizationOutcomeKind
from ecos_agent.optimization.knowledge.retrieval import OptimizationRetrievalResult
from ecos_agent.optimization.objective_alignment import ActiveOptimizationObjective
from ecos_agent.optimization.observations import OptimizationObservationError
from ecos_agent.optimization.rules import (
    IncumbentComparison,
    IncumbentDecision,
    classify_terminal_candidate,
)


class OptimizationEpisodeRunnerError(ValueError):
    """The fake runner cannot advance the persisted controller state safely."""


_PLANNABLE_STATES = {
    OptimizationEpisodeState.CREATED,
    OptimizationEpisodeState.PLANNING,
    OptimizationEpisodeState.EXECUTING,
    OptimizationEpisodeState.AWAITING_EXECUTION,
}


@dataclass(frozen=True)
class OptimizationEpisodeTurn:
    observation: StageObservation
    retrieval: OptimizationRetrievalResult
    planning: OptimizationControlResult
    execution: OptimizationControlResult | None
    terminal_observation: TerminalObservation | None = None
    incumbent_comparison: IncumbentComparison | None = None
    active_objective_before: ActiveOptimizationObjective | None = None
    active_objective_after: ActiveOptimizationObjective | None = None


class OptimizationEpisodeRunner:
    """Build fresh bounded inputs and let the controller own all side effects.

    One turn fills every free candidate slot (plan and start), then absorbs
    exactly one completed terminal so its evidence immediately feeds the next
    turn.  With a single-slot controller this is the original serial turn.
    """

    def __init__(
        self,
        *,
        controller: OptimizationEpisodeController,
        observation_supplier: Callable[[BudgetSnapshot], StageObservation],
        retrieval_supplier: Callable[
            [StageObservation, OptimizationOutcomeKind | None], OptimizationRetrievalResult
        ],
        current_values: Mapping[str, bool | int | float],
        terminal_waiter: Callable[[str], CandidateExecutionReceipt] | None = None,
        terminal_observation_supplier: Callable[
            [StageObservation, CandidateExecutionReceipt], TerminalObservation
        ]
        | None = None,
        objective: RoutabilityObjectiveContract | None = None,
        stop_event: threading.Event | None = None,
        site_width_dbu: int = 1,
        terminal_waiter_any: Callable[
            [tuple[str, ...]], CandidateExecutionReceipt
        ]
        | None = None,
        current_values_supplier: Callable[
            [str | None], Mapping[str, bool | int | float]
        ]
        | None = None,
        stage_observation_supplier: Callable[
            [StageObservation, tuple[str, ...]], Mapping[str, StageObservation]
        ]
        | None = None,
    ) -> None:
        if type(site_width_dbu) is not int or site_width_dbu <= 0:
            raise OptimizationEpisodeRunnerError("site width is invalid")
        self._controller = controller
        self._observation_supplier = observation_supplier
        self._retrieval_supplier = retrieval_supplier
        self._current_values = dict(current_values)
        self._terminal_waiter = terminal_waiter
        self._terminal_observation_supplier = terminal_observation_supplier
        self._objective = objective
        self._stop_event = stop_event or threading.Event()
        self._site_width_dbu = site_width_dbu
        self._terminal_waiter_any = terminal_waiter_any
        self._current_values_supplier = current_values_supplier
        self._stage_observation_supplier = stage_observation_supplier
        # Optional GUI progress hook; set after construction so factory
        # call sites and test fakes keep their two-argument signature.
        self.event_listener: Callable[[str, Mapping[str, object]], None] | None = None

    def _emit_event(self, kind: str, payload: Mapping[str, object]) -> None:
        if self.event_listener is None:
            return
        try:
            self.event_listener(kind, dict(payload))
        except Exception:
            # Progress display must never take down the episode.
            pass

    def emit_step_event(self, event: Mapping[str, object]) -> None:
        """Forward a step-level ECC runtime event to the progress listener."""
        payload = event.get("payload")
        detail: dict[str, object] = {
            "operation_id": event.get("operationId"),
            "event_type": event.get("type"),
            "step": payload.get("step") if isinstance(payload, Mapping) else None,
            "tool": payload.get("tool") if isinstance(payload, Mapping) else None,
            "step_state": (
                payload.get("state") if isinstance(payload, Mapping) else None
            ),
        }
        self._emit_event("ecc_step", detail)

    @property
    def current_values(self) -> Mapping[str, bool | int | float]:
        return dict(self._current_values)

    @property
    def state(self) -> OptimizationEpisodeState:
        return self._controller.state

    @property
    def episode_id(self) -> str:
        return self._controller.episode_id

    @property
    def objective(self) -> OptimizationObjectiveContract | None:
        return self._controller.objective

    @property
    def budget(self) -> BudgetSnapshot:
        return self._controller.budget

    @property
    def incumbent_candidate_root_ref(self) -> str | None:
        return self._controller.incumbent_candidate_root_ref

    @property
    def pending_execution_ids(self) -> tuple[str, ...]:
        return self._controller.pending_execution_ids

    @property
    def active_objective(self) -> ActiveOptimizationObjective | None:
        return self._controller.active_objective

    @property
    def recovery_incomplete(self) -> bool:
        return self._controller.recovery_incomplete

    def close(self) -> None:
        ledger = getattr(self._controller, "ledger", None)
        write_manifest = getattr(ledger, "write_manifest", None)
        if callable(write_manifest):
            write_manifest()
        executor = getattr(self._controller, "executor", None)
        close = getattr(executor, "close", None)
        if callable(close):
            close()

    def request_stop(self) -> None:
        self._stop_event.set()

    def finish_stop(self) -> None:
        self._controller.stop()

    def run_turn(self, *, paused: bool = False) -> OptimizationEpisodeTurn:
        if self._controller.state not in _PLANNABLE_STATES:
            raise OptimizationEpisodeRunnerError(
                "episode is not ready for a planning turn"
            )
        observation = self._fresh_observation()
        retrieval: OptimizationRetrievalResult | None = None
        planning: OptimizationControlResult | None = None
        execution: OptimizationControlResult | None = None
        # Fill phase: start candidates until every slot is used or dispatch
        # must wait.  A busy backend keeps the approved proposal for a retry
        # after the next terminal; nothing is re-planned or re-charged.  A
        # paused episode skips dispatch entirely but still absorbs one
        # terminal below, so pause never strands in-flight evidence.
        while not self._stop_event.is_set() and not paused:
            if self._controller.state not in _PLANNABLE_STATES:
                break
            if self._controller.free_candidate_slots <= 0:
                break
            observation = self._fresh_observation()
            if self._controller.state == OptimizationEpisodeState.AWAITING_EXECUTION:
                execution = self._controller.execute()
                if (
                    execution.state == OptimizationEpisodeState.EXECUTING
                    and self._controller.free_candidate_slots > 0
                ):
                    continue
                break
            retrieval = self._retrieval_supplier(
                observation, self._previous_outcome()
            )
            planning = self._controller.plan(
                observation,
                retrieval,
                self._current_values,
                stage_observations=self._stage_observations(observation),
            )
            proposal = planning.proposal
            if proposal is not None:
                self._emit_event(
                    "proposal",
                    {
                        "proposal_decision": proposal.decision.value,
                        "proposal_reason": proposal.reason_code.value,
                        "rationale_summary": proposal.rationale_summary,
                        "action": (
                            proposal.action.model_dump(mode="json")
                            if proposal.action
                            else None
                        ),
                        "requested": (
                            planning.requested.model_dump(mode="json")
                            if planning.requested
                            else None
                        ),
                        "rejection_reason": planning.rejection_reason,
                    },
                )
            if planning.state != OptimizationEpisodeState.AWAITING_EXECUTION:
                break
            if self._stop_event.is_set():
                execution = self._controller.stop_before_execution()
                break
            execution = self._controller.execute()
            self._emit_event(
                "dispatched",
                {
                    "execution_state": execution.state.value,
                    "in_flight": len(self._controller.pending_execution_ids),
                    "requested": (
                        planning.requested.model_dump(mode="json")
                        if planning.requested
                        else None
                    ),
                    "rejection_reason": execution.rejection_reason,
                },
            )
            if (
                execution.state == OptimizationEpisodeState.EXECUTING
                and self._controller.free_candidate_slots > 0
                and execution.rejection_reason is None
            ):
                continue
            break
        if self._stop_event.is_set() and (
            self._controller.state
            == OptimizationEpisodeState.AWAITING_EXECUTION
        ):
            execution = self._controller.stop_before_execution()
        # Wait phase: absorb exactly one completed candidate so its evidence
        # reaches the next planning turn without waiting for the other slot.
        absorbed = self._absorb_one_terminal(observation)
        if absorbed is not None:
            terminal_observation, comparison, active_before, active_after, (
                completed,
            ) = absorbed
            # The absorbed terminal's completion result is the turn's final
            # execution state, matching the original serial turn contract.
            return OptimizationEpisodeTurn(
                observation,
                retrieval,
                planning
                or OptimizationControlResult(self._controller.state),
                completed,
                terminal_observation,
                comparison,
                active_before,
                active_after,
            )
        return OptimizationEpisodeTurn(
            observation,
            retrieval,
            planning or OptimizationControlResult(self._controller.state),
            execution,
        )

    def _fresh_observation(self) -> StageObservation:
        budget = self._controller.budget
        observation = self._observation_supplier(budget)
        if observation.budget != budget:
            raise OptimizationEpisodeRunnerError(
                "observation budget does not match the controller"
            )
        return observation

    def _stage_observations(
        self, observation: StageObservation
    ) -> Mapping[str, StageObservation] | None:
        if self._stage_observation_supplier is None:
            return None
        stages = self._controller.planning_stages(
            observation, self._current_values
        )
        if not stages:
            return None
        supplied = self._stage_observation_supplier(observation, stages)
        return {
            stage: item for stage, item in supplied.items()
            if isinstance(item, StageObservation)
        }

    def _absorb_one_terminal(self, observation: StageObservation):
        pending_ids = self._controller.pending_execution_ids
        if not pending_ids:
            return None
        if self._terminal_waiter is None and self._terminal_waiter_any is None:
            return self._indeterminate_absorb(observation, None, None)
        try:
            receipt = (
                self._terminal_waiter_any(pending_ids)
                if self._terminal_waiter_any is not None
                else self._terminal_waiter(pending_ids[0])
            )
        except Exception:
            return self._indeterminate_absorb(observation, None, None)
        if not isinstance(receipt, CandidateExecutionReceipt):
            return self._indeterminate_absorb(observation, None, None)
        if receipt.execution_id not in pending_ids:
            return self._indeterminate_absorb(observation, None, None)
        if not receipt.started or receipt.outcome is None:
            return self._indeterminate_absorb(observation, None, None)
        record = self._controller.pending_execution(receipt.execution_id)
        try:
            terminal_observation = (
                self._terminal_observation_supplier(observation, receipt)
                if self._terminal_observation_supplier is not None
                else None
            )
        except OptimizationObservationError:
            # ECC-QoR draft 3 (section 10.3): corrupt or missing candidate
            # artifacts are an evidence gap for this candidate, not a
            # protocol-level indeterminate: the episode keeps running and the
            # planner sees the knob effect as unknown, never as a loss.
            return self._evidence_limited_absorb(receipt)
        active_before = self._controller.active_objective
        classification = classify_terminal_candidate(
            execution_outcome=receipt.outcome,
            candidate=terminal_observation,
            incumbent=self._controller.incumbent,
            objective=self._objective,
            semantic_objective=self._controller.objective,
            baseline_geometry=self._controller.baseline_geometry,
            objective_alignment=self._controller.objective_alignment,
            requested=record.requested if record is not None else None,
            parameter_receipt=receipt.parameter_application_receipt,
            receipt_aware_planning=self._controller.receipt_aware_planning,
        )
        comparison = classification.comparison
        completed = self._controller.complete_terminal(
            receipt,
            terminal_observation,
            outcome=classification.outcome,
            incumbent_decision=comparison.decision.value if comparison else None,
            decisive_metric=comparison.decisive_metric if comparison else None,
        )
        self._emit_event(
            "terminal",
            {
                "outcome": classification.outcome.value,
                "incumbent_decision": (
                    comparison.decision.value if comparison else None
                ),
                "decisive_metric": (
                    comparison.decisive_metric.value
                    if comparison and comparison.decisive_metric
                    else None
                ),
                "promoted": classification.promote,
            },
        )
        self._absorb_promotion(record, classification.promote)
        return (
            terminal_observation,
            comparison,
            active_before,
            self._controller.active_objective,
            (completed,),
        )

    def _absorb_promotion(self, record, promote: bool) -> None:
        if not promote or record is None:
            return
        if self._current_values_supplier is not None:
            # A3: promotion switches to the promoted candidate's complete,
            # executed configuration; untested coordinate splices are forbidden.
            values = self._current_values_supplier(
                self._controller.incumbent_candidate_root_ref
            )
            self._current_values = dict(values)
            return
        # Native normalization is evidence, not a replacement for the
        # request coordinate.
        self._current_values[record.requested.knob_id.value] = (
            record.requested.value
        )

    def _previous_outcome(self) -> OptimizationOutcomeKind | None:
        outcomes = self._controller.ledger.replay().terminal_outcomes
        return outcomes[-1].outcome if outcomes else None

    def _evidence_limited_absorb(
        self,
        receipt: CandidateExecutionReceipt,
    ):
        active_before = self._controller.active_objective
        completed = self._controller.complete_terminal(
            receipt,
            None,
            outcome=OptimizationOutcomeKind.EVIDENCE_INVALID,
            incumbent_decision=IncumbentDecision.EVIDENCE_LIMITED.value,
        )
        self._emit_event(
            "terminal",
            {
                "outcome": OptimizationOutcomeKind.EVIDENCE_INVALID.value,
                "incumbent_decision": IncumbentDecision.EVIDENCE_LIMITED.value,
                "decisive_metric": None,
                "promoted": False,
            },
        )
        return (
            None,
            IncumbentComparison(IncumbentDecision.EVIDENCE_LIMITED, None),
            active_before,
            self._controller.active_objective,
            (completed,),
        )

    def _indeterminate_absorb(
        self,
        observation: StageObservation,
        planning: OptimizationControlResult | None,
        execution: OptimizationControlResult | None,
    ):
        pending_ids = self._controller.pending_execution_ids
        if not pending_ids:
            raise OptimizationEpisodeRunnerError(
                "indeterminate terminal has no pending execution"
            )
        receipt = CandidateExecutionReceipt(
            execution_id=pending_ids[0],
            started=True,
            outcome=OptimizationOutcomeKind.INDETERMINATE,
        )
        completed = self._controller.complete_terminal(receipt)
        self._emit_event(
            "terminal",
            {
                "outcome": OptimizationOutcomeKind.INDETERMINATE.value,
                "incumbent_decision": None,
                "decisive_metric": None,
                "promoted": False,
            },
        )
        return (
            None,
            None,
            None,
            self._controller.active_objective,
            (completed,),
        )
