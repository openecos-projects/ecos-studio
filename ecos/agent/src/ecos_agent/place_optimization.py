"""Deterministic, non-executable contracts for a place-only density scan."""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.place_contracts import PlaceStrategy
from ecos_agent.workspace_rerun import (
    GuiWorkspaceRerunContract,
    GuiWorkspaceRerunResolver,
    GuiWorkspaceRerunSource,
)


_RUN_ID = re.compile(r"^[A-Za-z0-9_-]+$")


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

    @field_validator("run_id", "baseline_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _RUN_ID.fullmatch(value):
            raise ValueError("optimization identifier is invalid")
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


class OptimizationEvaluation(BaseModel):
    """Terminal evidence reported by the fixed GUI RPC for one frozen candidate."""

    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(min_length=1, max_length=160)
    status: Literal["succeeded", "failed", "cancelled", "blocked"]
    metrics: dict[str, float] = Field(default_factory=dict, max_length=32)
    artifact_refs: list[str] = Field(default_factory=list, max_length=16)
    reason: str | None = Field(default=None, pattern=r"^[a-z_]{1,64}$")

    @field_validator("metrics")
    @classmethod
    def validate_metrics(cls, value: dict[str, float]) -> dict[str, float]:
        if any(not math.isfinite(metric) for metric in value.values()):
            raise ValueError("optimization metrics are invalid")
        return value

    @field_validator("artifact_refs")
    @classmethod
    def validate_artifact_refs(cls, value: list[str]) -> list[str]:
        if any(Path(item).is_absolute() or ".." in Path(item).parts for item in value):
            raise ValueError("optimization artifact reference is invalid")
        return value

    @model_validator(mode="after")
    def validate_success_evidence(self) -> "OptimizationEvaluation":
        hpwl = self.metrics.get("place_hpwl")
        if self.status == "succeeded" and (not self.artifact_refs or hpwl is None or hpwl <= 0):
            raise ValueError("successful optimization evidence is incomplete")
        return self


class OptimizationResult(BaseModel):
    """A complete batch result; values remain derived from the frozen contract."""

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1, max_length=128)
    evaluations: list[OptimizationEvaluation] = Field(min_length=5, max_length=5)

    @field_validator("run_id")
    @classmethod
    def validate_run_id(cls, value: str) -> str:
        if not _RUN_ID.fullmatch(value):
            raise ValueError("optimization identifier is invalid")
        return value

    @model_validator(mode="after")
    def validate_candidates(self) -> "OptimizationResult":
        ids = [item.candidate_id for item in self.evaluations]
        if len(set(ids)) != len(ids):
            raise ValueError("optimization candidates are duplicated")
        return self


class OptimizationRequest(BaseModel):
    """Strategy-derived intent; it does not contain candidate values."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["ecos-place-optimization-request.v1"] = (
        "ecos-place-optimization-request.v1"
    )
    strategy_id: str = Field(min_length=1, max_length=160)
    objective: Literal["place_hpwl"]
    knob_id: Literal["place.target_density"]
    direction: Literal["increase", "decrease"]
    protected_metrics: list[str] = Field(default_factory=list, max_length=16)
    requires_gui_review: Literal[True]


class PlaceOptimizationContract(BaseModel):
    """GUI-owned batch contract containing no executable command text."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["flow-agent.place_optimization_contract.v1"] = (
        "flow-agent.place_optimization_contract.v1"
    )
    request: OptimizationRequest
    run_spec: OptimizationRunSpec
    rerun_contracts: list[GuiWorkspaceRerunContract] = Field(min_length=5, max_length=5)


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


def freeze_place_optimization_contract(
    workspace: Path, design_id: str, strategy: PlaceStrategy, run_id: str
) -> PlaceOptimizationContract:
    direction = strategy.allowed_directions.get("place.target_density")
    if direction is None:
        raise ValueError("reviewed strategy does not authorize target density")
    resolver = GuiWorkspaceRerunResolver(workspace.resolve().parent)
    discovery = resolver.discover_workspace(workspace, design_id)
    values = dict(resolver.parameter_values(discovery.source, "place"))
    density = values.get("place.target_density")
    if type(density) not in {int, float} or not math.isfinite(density):
        raise ValueError("workspace target density is unavailable")
    lower, upper = (0.1, float(density)) if direction == "decrease" else (float(density), 0.95)
    request = OptimizationRequest(
        strategy_id=strategy.strategy_id,
        objective="place_hpwl",
        knob_id="place.target_density",
        direction=direction,
        protected_metrics=strategy.protected_metrics,
        requires_gui_review=True,
    )
    run_spec = OptimizationRunSpec(
        run_id=run_id,
        source_workspace=str(workspace.resolve()),
        baseline_id="baseline",
        objective=request.objective,
        knob_id=request.knob_id,
        lower=lower,
        upper=upper,
        direction=request.direction,
        seed=0,
        budget=5,
        requires_gui_review=True,
    )
    return PlaceOptimizationContract(
        request=request,
        run_spec=run_spec,
        rerun_contracts=freeze_rerun_contracts(run_spec, discovery.source),
    )


def freeze_rerun_contracts(
    spec: OptimizationRunSpec, source: GuiWorkspaceRerunSource
) -> list[GuiWorkspaceRerunContract]:
    workspace = source.workspace_path.resolve()
    if str(workspace) != spec.source_workspace or "place" not in source.allowed_stages:
        raise ValueError("optimization source evidence is invalid")
    labels = [(spec.baseline_id, None)] + [
        (candidate.candidate_id, candidate.value) for candidate in generate_candidates(spec)
    ]
    contracts = []
    for label, value in labels:
        target = workspace.with_name(f"{workspace.name}_optimization_{spec.run_id}_{label}")
        if target.exists():
            raise ValueError("optimization target workspace already exists")
        contracts.append(
            GuiWorkspaceRerunContract(
                source_workspace=str(workspace),
                target_workspace=str(target),
                rerun_id=f"{spec.run_id}_{label}",
                design_id=source.design_id,
                target_step=ECCStepName.PLACEMENT,
                end_step=ECCStepName.PLACEMENT,
                execution_scope="single_step",
                source_flow_json_sha256=source.flow_json_sha256,
                source_stage_artifact=source.stage_artifact_ref["place"],
                source_stage_artifact_sha256=source.stage_artifact_sha256["place"],
                parameter_patch=(
                    [] if value is None else [{"knob_id": spec.knob_id, "value": value}]
                ),
            )
        )
    return contracts


def append_evaluation(
    path: Path,
    *,
    run_id: str | None = None,
    run_spec: OptimizationRunSpec | None = None,
    design_id: str | None = None,
    protected_metrics: list[str] | None = None,
    input_artifact_refs: list[str] | None = None,
    candidate_id: str,
    status: Literal["planned", "running", "succeeded", "failed", "cancelled", "blocked"],
    value: float,
    metrics: dict[str, float],
    artifact_refs: list[str],
    reason: str | None = None,
) -> None:
    run_id = run_spec.run_id if run_spec is not None else run_id
    if not run_id or not candidate_id or not math.isfinite(value):
        raise ValueError("optimization evaluation is invalid")
    if any(not math.isfinite(metric) for metric in metrics.values()):
        raise ValueError("optimization metrics are invalid")
    if any(Path(reference).is_absolute() or ".." in Path(reference).parts for reference in artifact_refs):
        raise ValueError("optimization artifact reference is invalid")
    if input_artifact_refs and any(
        Path(reference).is_absolute() or ".." in Path(reference).parts
        for reference in input_artifact_refs
    ):
        raise ValueError("optimization input artifact reference is invalid")
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
        "fixed_rpc_operation": "candidate.rerun",
    }
    if run_spec is not None:
        record["run_spec"] = {
            "budget": run_spec.budget,
            "direction": run_spec.direction,
            "knob_id": run_spec.knob_id,
            "lower": run_spec.lower,
            "objective": run_spec.objective,
            "seed": run_spec.seed,
            "upper": run_spec.upper,
        }
        record["design_id"] = design_id
        record["input_artifact_refs"] = input_artifact_refs or []
        record["protected_metrics"] = protected_metrics or []
    if reason is not None:
        record["error"] = reason
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def default_experiment_memory_path() -> Path:
    root = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    return root / "ecos-agent" / "place-experiment-memory.jsonl"
