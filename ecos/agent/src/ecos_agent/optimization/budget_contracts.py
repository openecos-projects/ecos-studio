"""Episode budget contracts for the optimization loop."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _BudgetContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


CANDIDATE_EXECUTION_LIMIT = 20
WALL_TIME_LIMIT_MULTIPLIER = 22


class EpisodeBudget(_BudgetContractModel):
    schema_version: Literal["ecos.optimization_budget.v5"] = (
        "ecos.optimization_budget.v5"
    )
    candidate_execution_limit: Literal[20] = CANDIDATE_EXECUTION_LIMIT
    planning_call_limit: Literal[60] = 60
    minimum_candidate_executions: Literal[20] = CANDIDATE_EXECUTION_LIMIT
    # Bound on consecutive non-productive planning turns before escalation.
    # A turn is productive when it dispatches a candidate, waits on in-flight
    # evidence, or continues under a declared strategy with a viable step, so
    # "continue while a reasonable hypothesis exists" no longer escalates by
    # a fixed two-turn count.  Widened from the frozen Literal[2]; stored
    # value 2 from older episodes still validates.
    max_planning_only_turns: int = Field(default=4, ge=2, le=10)
    reference_place_to_harden_seconds: float
    wall_time_limit_seconds: float

    @field_validator("reference_place_to_harden_seconds")
    @classmethod
    def validate_reference_time(cls, value: float) -> float:
        if not math.isfinite(value) or value <= 0:
            raise ValueError("reference rerun time must be finite and positive")
        return value

    @model_validator(mode="after")
    def validate_wall_time_limit(self) -> "EpisodeBudget":
        if not math.isclose(
            self.wall_time_limit_seconds,
            WALL_TIME_LIMIT_MULTIPLIER * self.reference_place_to_harden_seconds,
            rel_tol=0,
            abs_tol=1e-9,
        ):
            raise ValueError("wall time limit must equal 22 times the reference rerun")
        return self

    @classmethod
    def from_reference_rerun(cls, duration: float) -> "EpisodeBudget":
        return cls(
            reference_place_to_harden_seconds=duration,
            wall_time_limit_seconds=WALL_TIME_LIMIT_MULTIPLIER * duration,
        )


class BudgetSnapshot(_BudgetContractModel):
    budget: EpisodeBudget
    consumed_candidates: int = Field(default=0, ge=0)
    consumed_planning_calls: int = Field(default=0, ge=0)
    elapsed_wall_time_seconds: float = Field(default=0, ge=0)

    @field_validator("elapsed_wall_time_seconds")
    @classmethod
    def validate_elapsed_time(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("elapsed wall time must be finite")
        return value

    @model_validator(mode="after")
    def validate_consumption(self) -> "BudgetSnapshot":
        if self.consumed_candidates > self.budget.candidate_execution_limit:
            raise ValueError("candidate budget is exceeded")
        if self.consumed_planning_calls > self.budget.planning_call_limit:
            raise ValueError("planning budget is exceeded")
        return self

    @property
    def remaining_candidates(self) -> int:
        return self.budget.candidate_execution_limit - self.consumed_candidates

    @property
    def remaining_planning_calls(self) -> int:
        return self.budget.planning_call_limit - self.consumed_planning_calls

    @property
    def remaining_wall_time_seconds(self) -> float:
        return max(
            0.0, self.budget.wall_time_limit_seconds - self.elapsed_wall_time_seconds
        )

    @property
    def exhausted(self) -> bool:
        return (
            self.remaining_candidates == 0
            or self.remaining_planning_calls == 0
            or self.elapsed_wall_time_seconds >= self.budget.wall_time_limit_seconds
        )
