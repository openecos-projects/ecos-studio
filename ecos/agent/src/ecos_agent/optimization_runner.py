"""Fake-only orchestration for one bounded optimization planning turn."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    OptimizationEpisodeState,
    RoutabilityObjectiveContract,
    StageObservation,
    TerminalObservation,
)
from ecos_agent.optimization_controller import (
    CandidateExecutionReceipt,
    OptimizationControlResult,
    OptimizationEpisodeController,
)
from ecos_agent.optimization_ledger import OptimizationOutcomeKind
from ecos_agent.optimization_retrieval import OptimizationRetrievalResult
from ecos_agent.optimization_rules import (
    IncumbentComparison,
    IncumbentDecision,
    compare_incumbent,
)


class OptimizationEpisodeRunnerError(ValueError):
    """The fake runner cannot advance the persisted controller state safely."""


@dataclass(frozen=True)
class OptimizationEpisodeTurn:
    observation: StageObservation
    retrieval: OptimizationRetrievalResult
    planning: OptimizationControlResult
    execution: OptimizationControlResult | None
    terminal_observation: TerminalObservation | None = None
    incumbent_comparison: IncumbentComparison | None = None


class OptimizationEpisodeRunner:
    """Build fresh bounded inputs and let the controller own all side effects."""

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
    ) -> None:
        self._controller = controller
        self._observation_supplier = observation_supplier
        self._retrieval_supplier = retrieval_supplier
        self._current_values = current_values
        self._terminal_waiter = terminal_waiter
        self._terminal_observation_supplier = terminal_observation_supplier
        self._objective = objective

    @property
    def state(self) -> OptimizationEpisodeState:
        return self._controller.state

    @property
    def episode_id(self) -> str:
        return self._controller.episode_id

    def close(self) -> None:
        ledger = getattr(self._controller, "ledger", None)
        write_manifest = getattr(ledger, "write_manifest", None)
        if callable(write_manifest):
            write_manifest()
        executor = getattr(self._controller, "executor", None)
        close = getattr(executor, "close", None)
        if callable(close):
            close()

    def run_turn(self) -> OptimizationEpisodeTurn:
        if self._controller.state not in {
            OptimizationEpisodeState.CREATED,
            OptimizationEpisodeState.PLANNING,
        }:
            raise OptimizationEpisodeRunnerError("episode is not ready for a planning turn")
        budget = self._controller.budget
        observation = self._observation_supplier(budget)
        if observation.budget != budget:
            raise OptimizationEpisodeRunnerError("observation budget does not match the controller")
        retrieval = self._retrieval_supplier(observation, self._previous_outcome())
        planning = self._controller.plan(observation, retrieval, self._current_values)
        if planning.state != OptimizationEpisodeState.AWAITING_EXECUTION:
            return OptimizationEpisodeTurn(observation, retrieval, planning, None)
        execution = self._controller.execute()
        if execution.state != OptimizationEpisodeState.EXECUTING:
            return OptimizationEpisodeTurn(observation, retrieval, planning, execution)
        if self._terminal_waiter is None or self._controller.pending_execution_id is None:
            return self._indeterminate_turn(observation, retrieval, planning, execution)
        execution_id = self._controller.pending_execution_id
        try:
            receipt = self._terminal_waiter(execution_id)
        except Exception:
            return self._indeterminate_turn(observation, retrieval, planning, execution)
        if not isinstance(receipt, CandidateExecutionReceipt):
            return self._indeterminate_turn(observation, retrieval, planning, execution)
        if receipt.execution_id != execution_id:
            return self._indeterminate_turn(observation, retrieval, planning, execution)
        if not receipt.started or receipt.outcome is None:
            return self._indeterminate_turn(observation, retrieval, planning, execution)
        try:
            terminal_observation = (
                self._terminal_observation_supplier(observation, receipt)
                if self._terminal_observation_supplier is not None
                else None
            )
        except Exception:
            return self._indeterminate_turn(observation, retrieval, planning, execution)
        comparison = self._compare(terminal_observation)
        completed = self._controller.complete_terminal(
            receipt,
            terminal_observation,
            incumbent_decision=comparison.decision.value if comparison else None,
            decisive_metric=comparison.decisive_metric if comparison else None,
        )
        self._promote(terminal_observation, comparison)
        return OptimizationEpisodeTurn(
            observation,
            retrieval,
            planning,
            completed,
            terminal_observation,
            comparison,
        )

    def _previous_outcome(self) -> OptimizationOutcomeKind | None:
        outcomes = self._controller.ledger.replay().terminal_outcomes
        return outcomes[-1].outcome if outcomes else None

    def _compare(
        self, candidate: TerminalObservation | None
    ) -> IncumbentComparison | None:
        if candidate is None or self._objective is None:
            return None
        incumbent = self._controller.incumbent
        if incumbent is None:
            return IncumbentComparison(IncumbentDecision.INITIALIZED, None)
        comparison = compare_incumbent(
            incumbent=incumbent,
            candidate=candidate,
            objective=self._objective,
        )
        return comparison

    def _promote(
        self,
        candidate: TerminalObservation | None,
        comparison: IncumbentComparison | None,
    ) -> None:
        if (
            candidate is not None
            and candidate.eligible_for_incumbent
            and comparison is not None
            and comparison.decision
            in {IncumbentDecision.INITIALIZED, IncumbentDecision.CANDIDATE_BETTER}
        ):
            self._controller.promote_incumbent(candidate)

    def _indeterminate_turn(
        self,
        observation: StageObservation,
        retrieval: OptimizationRetrievalResult,
        planning: OptimizationControlResult,
        execution: OptimizationControlResult,
    ) -> OptimizationEpisodeTurn:
        execution_id = self._controller.pending_execution_id or "unknown-execution"
        receipt = CandidateExecutionReceipt(
            execution_id=execution_id,
            started=True,
            outcome=OptimizationOutcomeKind.INDETERMINATE,
        )
        completed = self._controller.complete_terminal(receipt)
        return OptimizationEpisodeTurn(observation, retrieval, planning, completed)
