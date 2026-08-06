"""Deterministic, non-executable contracts for a place-only density scan."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class OptimizationRunSpec(BaseModel):
    """Frozen input for five evaluations: one baseline plus four candidates."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos-place-optimization-run.v1"] = "ecos-place-optimization-run.v1"
    run_id: str = Field(min_length=1, max_length=128)
    source_workspace: str = Field(min_length=1, max_length=4096)
    baseline_id: str = Field(min_length=1, max_length=128)
    objective: Literal["place_hpwl"]
    knob_id: Literal["place.target_density"]
    lower: float
    upper: float
    direction: Literal["increase", "decrease"]
    seed: int = Field(ge=0, le=2**31 - 1)
    budget: Literal[5]
    requires_gui_review: Literal[True]

    @field_validator("lower", "upper")
    @classmethod
    def validate_density(cls, value: float) -> float:
        if not math.isfinite(value) or not 0.1 <= value <= 0.95:
            raise ValueError("target density is outside the authorized range")
        return value

    @model_validator(mode="after")
    def validate_interval(self) -> "OptimizationRunSpec":
        if self.lower >= self.upper:
            raise ValueError("target density interval is empty")
        return self


class OptimizationCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str
    value: float


def generate_candidates(spec: OptimizationRunSpec) -> list[OptimizationCandidate]:
    span = spec.upper - spec.lower
    values = (
        [spec.upper - span * index / 4 for index in range(1, 5)]
        if spec.direction == "decrease"
        else [spec.lower + span * index / 4 for index in range(1, 5)]
    )
    return [
        OptimizationCandidate(candidate_id=f"candidate_{index}", value=round(value, 10))
        for index, value in enumerate(values, start=1)
    ]


def append_evaluation(
    path: Path,
    *,
    run_id: str,
    candidate_id: str,
    status: Literal["planned", "running", "succeeded", "failed", "cancelled", "blocked"],
    value: float,
    metrics: dict[str, float],
    artifact_refs: list[str],
) -> None:
    if not run_id or not candidate_id or not math.isfinite(value):
        raise ValueError("optimization evaluation is invalid")
    if any(not math.isfinite(metric) for metric in metrics.values()):
        raise ValueError("optimization metrics are invalid")
    if any(Path(reference).is_absolute() or ".." in Path(reference).parts for reference in artifact_refs):
        raise ValueError("optimization artifact reference is invalid")
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schema_version": "ecos-place-optimization-evaluation.v1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "candidate_id": candidate_id,
        "status": status,
        "parameter": {"place.target_density": value},
        "metrics": metrics,
        "artifact_refs": artifact_refs,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
