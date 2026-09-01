"""Gate 0 configuration and deterministic qualification logic."""

from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, Sequence

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    field_validator,
    model_validator,
)

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import (
    ROUTABILITY_OBJECTIVE_ORDER,
    TIMING_GUARDRAIL_ORDER,
    OptimizationKnob,
    TerminalObservation,
)
from ecos_agent.optimization.execution import (
    CandidateExecutionEvidence,
    CandidateExecutionReceipt,
)
from ecos_agent.optimization.experiments.gate0 import _EXPECTED_PROBES
from ecos_agent.optimization.ledger import OptimizationOutcomeKind

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


class Gate0Error(RuntimeError):
    """The pilot cannot produce trustworthy Gate 0 evidence."""


class PilotCandidateExecutionError(Gate0Error):
    """A candidate consumed execution budget but did not complete successfully."""

    def __init__(self, receipt: CandidateExecutionReceipt) -> None:
        super().__init__("candidate execution did not succeed")
        self.receipt = receipt


@dataclass(frozen=True)
class PilotCandidateRun:
    observation: TerminalObservation
    receipt: CandidateExecutionReceipt


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Gate0Snapshot(_Model):
    path: str
    sha256: str

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        path = Path(value)
        if not value or path.is_absolute() or ".." in path.parts or "\x00" in value:
            raise ValueError("snapshot path must be safe and relative")
        return value

    @field_validator("sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("snapshot hash is invalid")
        return value


class Gate0Design(_Model):
    design_id: str
    top_module: str
    clock_name: str
    baseline_replay_count: Literal[1, 3] = 3
    rtl: Gate0Snapshot
    filelist: Gate0Snapshot
    sdc: Gate0Snapshot

    @field_validator("design_id", "top_module", "clock_name")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("design identifier is invalid")
        return value


class Gate0Baseline(_Model):
    frequency_mhz: StrictInt | StrictFloat = Field(gt=0)
    max_fanout: StrictInt = Field(gt=0)
    utilitization: StrictFloat = Field(gt=0, le=1)
    target_density: StrictFloat = Field(ge=0.1, le=0.95)
    target_overflow: StrictInt | StrictFloat = Field(ge=0, le=1)
    cell_padding_sites: StrictInt = Field(ge=1, le=2)
    routability_opt: StrictBool


class Gate0Probe(_Model):
    probe_id: str
    knob_id: OptimizationKnob
    delta: StrictInt | StrictFloat | None

    @field_validator("probe_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("probe id is invalid")
        return value


class Gate0Config(_Model):
    schema_version: Literal["ecos.optimization_gate0_config.v1"]
    pdk_root: str
    default_replays: Literal[3]
    terminal_timeout_seconds: StrictInt | StrictFloat = Field(gt=0)
    baseline: Gate0Baseline
    probes: tuple[Gate0Probe, ...] = Field(min_length=5, max_length=5)
    designs: tuple[Gate0Design, ...] = Field(min_length=1)

    @field_validator("pdk_root")
    @classmethod
    def validate_pdk_root(cls, value: str) -> str:
        if not value or "\x00" in value:
            raise ValueError("PDK root is invalid")
        return value

    @model_validator(mode="after")
    def validate_experiment(self) -> "Gate0Config":
        probes = {(item.probe_id, item.knob_id, item.delta) for item in self.probes}
        if probes != _EXPECTED_PROBES:
            raise ValueError("Gate 0 probes do not match the frozen pilot design")
        ids = [item.design_id for item in self.designs]
        if len(ids) != len(set(ids)):
            raise ValueError("Gate 0 design ids must be unique")
        return self


def load_gate0_config(config_path: Path) -> Gate0Config:
    path = Path(config_path).resolve()
    try:
        config = Gate0Config.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Gate0Error("Gate 0 config is invalid") from exc
    for design in config.designs:
        for snapshot in (design.rtl, design.filelist, design.sdc):
            candidate = _snapshot_path(path, snapshot)
            if candidate.is_symlink() or not candidate.is_file():
                raise Gate0Error(f"snapshot is unavailable: {snapshot.path}")
            if file_sha256(candidate) != snapshot.sha256:
                raise Gate0Error(f"snapshot hash does not match: {snapshot.path}")
    return config


def noise_profile(
    default_replays: Sequence[TerminalObservation],
) -> dict[str, dict[str, float]]:
    if len(default_replays) < 2 or any(
        not item.eligible_for_incumbent for item in default_replays
    ):
        raise Gate0Error("default replays cannot define a noise profile")
    rows = [_all_metrics(item) for item in default_replays]
    keys = tuple(rows[0])
    return {
        "reference": {
            key: float(statistics.median(row[key] for row in rows)) for key in keys
        },
        "epsilon": {
            key: max(row[key] for row in rows) - min(row[key] for row in rows)
            for key in keys
        },
    }


def compare_observations(
    reference: Mapping[str, float],
    candidate: TerminalObservation,
    epsilon: Mapping[str, float],
) -> str:
    if not candidate.eligible_for_incumbent:
        return "candidate_ineligible"
    metrics = _all_metrics(candidate)
    required = {
        item.value for item in (*ROUTABILITY_OBJECTIVE_ORDER, *TIMING_GUARDRAIL_ORDER)
    }
    if set(reference) != required or set(epsilon) != required:
        raise Gate0Error("noise comparison metrics are incomplete")
    for metric in TIMING_GUARDRAIL_ORDER:
        key = metric.value
        if metrics[key] < reference[key] - epsilon[key]:
            return "timing_regression"
    for metric in ROUTABILITY_OBJECTIVE_ORDER:
        key = metric.value
        if metrics[key] < reference[key] - epsilon[key]:
            return "better"
        if metrics[key] > reference[key] + epsilon[key]:
            return "worse"
    return "noise_tie"


def qualify_design(
    canonical: TerminalObservation,
    default_replays: Sequence[TerminalObservation],
    probes: Mapping[str, TerminalObservation],
) -> dict[str, object]:
    if len(default_replays) != 3 or set(probes) != {
        item[0] for item in _EXPECTED_PROBES
    }:
        raise Gate0Error("Gate 0 design evidence is incomplete")
    profile = noise_profile(default_replays)
    reference, epsilon = profile["reference"], profile["epsilon"]
    details = {
        probe_id: {
            "eligible": observation.eligible_for_incumbent,
            "distinct": _is_distinct(reference, observation, epsilon),
            "comparison": compare_observations(reference, observation, epsilon),
        }
        for probe_id, observation in sorted(probes.items())
    }
    distinct = sum(bool(item["distinct"]) for item in details.values())
    improving = [key for key, item in details.items() if item["comparison"] == "better"]
    best = min(improving, key=lambda key: _objective_tuple(probes[key]), default=None)
    defaults_eligible = all(item.eligible_for_incumbent for item in default_replays)
    return {
        "qualified": canonical.eligible_for_incumbent
        and defaults_eligible
        and distinct >= 2
        and bool(improving),
        "canonical_eligible": canonical.eligible_for_incumbent,
        "default_replays_eligible": defaults_eligible,
        "distinct_probe_count": distinct,
        "improving_probe_count": len(improving),
        "best_probe_id": best,
        "noise_profile": profile,
        "probes": details,
    }


def qualify_pool(designs: Mapping[str, Mapping[str, object]]) -> dict[str, object]:
    all_qualified = bool(designs) and all(
        item.get("qualified") is True for item in designs.values()
    )
    best = {
        item.get("best_probe_id")
        for item in designs.values()
        if item.get("best_probe_id")
    }
    return {
        "qualified": all_qualified and len(best) > 1,
        "all_designs_qualified": all_qualified,
        "best_probe_diversity": len(best),
    }


def require_terminal_receipt(
    receipt: CandidateExecutionReceipt,
) -> CandidateExecutionEvidence:
    if (
        not receipt.started
        or receipt.outcome != OptimizationOutcomeKind.EXECUTION_SUCCEEDED
    ):
        raise Gate0Error("candidate execution did not succeed")
    if receipt.evidence is None:
        raise Gate0Error("candidate terminal evidence is missing")
    if receipt.parameter_application_receipt is None:
        raise Gate0Error("candidate native parameter application receipt is missing")
    return receipt.evidence


def _snapshot_path(config_path: Path, snapshot: Gate0Snapshot) -> Path:
    base = Path(config_path).resolve().parent
    path = (base / snapshot.path).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise Gate0Error("snapshot path escapes the pilot directory") from exc
    return path


def _all_metrics(observation: TerminalObservation) -> dict[str, float]:
    return {
        **{key.value: float(value) for key, value in observation.metrics.items()},
        **{
            key.value: float(value)
            for key, value in observation.timing_guardrail.items()
        },
    }


def _objective_tuple(observation: TerminalObservation) -> tuple[float, ...]:
    return tuple(float(observation.metrics[key]) for key in ROUTABILITY_OBJECTIVE_ORDER)


def _is_distinct(
    reference: Mapping[str, float],
    observation: TerminalObservation,
    epsilon: Mapping[str, float],
) -> bool:
    if not observation.eligible_for_incumbent:
        return False
    return any(
        abs(value - reference[key]) > epsilon[key]
        for key, value in _all_metrics(observation).items()
    )
