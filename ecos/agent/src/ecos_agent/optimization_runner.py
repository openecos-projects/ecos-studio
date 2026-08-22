"""Fake-only orchestration for one bounded optimization planning turn."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    OptimizationEpisodeState,
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


class OptimizationEpisodeRunnerError(ValueError):
    """The fake runner cannot advance the persisted controller state safely."""


@dataclass(frozen=True)
class OptimizationEpisodeTurn:
    observation: StageObservation
    retrieval: OptimizationRetrievalResult
    planning: OptimizationControlResult
    execution: OptimizationControlResult | None
    terminal_observation: TerminalObservation | None = None


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
    ) -> None:
        self._controller = controller
        self._observation_supplier = observation_supplier
        self._retrieval_supplier = retrieval_supplier
        self._current_values = current_values
        self._terminal_waiter = terminal_waiter
        self._terminal_observation_supplier = terminal_observation_supplier

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
            raise OptimizationEpisodeRunnerError("terminal waiter is required for a running candidate")
        receipt = self._terminal_waiter(self._controller.pending_execution_id)
        if not isinstance(receipt, CandidateExecutionReceipt):
            raise OptimizationEpisodeRunnerError("terminal receipt is invalid")
        if receipt.execution_id != self._controller.pending_execution_id:
            raise OptimizationEpisodeRunnerError("terminal receipt does not match the running candidate")
        if not receipt.started or receipt.outcome is None:
            receipt = CandidateExecutionReceipt(
                execution_id=receipt.execution_id,
                started=True,
                outcome=OptimizationOutcomeKind.INDETERMINATE,
            )
            completed = self._controller.complete_terminal(receipt)
            return OptimizationEpisodeTurn(observation, retrieval, planning, completed)
        terminal_observation = (
            self._terminal_observation_supplier(observation, receipt)
            if self._terminal_observation_supplier is not None
            else None
        )
        completed = self._controller.complete_terminal(receipt, terminal_observation)
        return OptimizationEpisodeTurn(
            observation, retrieval, planning, completed, terminal_observation
        )

    def _previous_outcome(self) -> OptimizationOutcomeKind | None:
        outcomes = self._controller.ledger.replay().terminal_outcomes
        return outcomes[-1].outcome if outcomes else None
