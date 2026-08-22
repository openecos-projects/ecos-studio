"""Fake-only orchestration for one bounded optimization planning turn."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from ecos_agent.optimization_contracts import BudgetSnapshot, OptimizationEpisodeState, StageObservation
from ecos_agent.optimization_controller import (
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
    ) -> None:
        self._controller = controller
        self._observation_supplier = observation_supplier
        self._retrieval_supplier = retrieval_supplier
        self._current_values = current_values

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
        execution = (
            self._controller.execute()
            if planning.state == OptimizationEpisodeState.AWAITING_EXECUTION
            else None
        )
        return OptimizationEpisodeTurn(observation, retrieval, planning, execution)

    def _previous_outcome(self) -> OptimizationOutcomeKind | None:
        outcomes = self._controller.ledger.replay().terminal_outcomes
        return outcomes[-1].outcome if outcomes else None
