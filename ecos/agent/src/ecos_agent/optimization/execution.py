"""Shared typed contracts for fixed optimization candidate execution."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    OptimizationOutcomeKind,
    OptimizationProposal,
    RequestedKnobValue,
)
from ecos_agent.optimization.parameters.contracts import ParameterApplicationReceipt

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")

CANDIDATE_END_STEP = "Harden"
CANDIDATE_EXECUTION_SCOPE = "full_flow"
_CANDIDATE_TARGET_STEPS = {
    OptimizationKnob.FLOORPLAN_CORE_UTIL: "Floorplan",
    OptimizationKnob.FLOORPLAN_ASPECT_RATIO: "Floorplan",
    OptimizationKnob.TARGET_DENSITY: "place",
    OptimizationKnob.TARGET_OVERFLOW: "place",
    OptimizationKnob.CELL_PADDING_X: "place",
    OptimizationKnob.ROUTABILITY_OPT: "place",
    OptimizationKnob.DENSITY_WEIGHT: "place",
}


def candidate_target_step(knob_id: OptimizationKnob) -> str:
    return _CANDIDATE_TARGET_STEPS[knob_id]


@dataclass(frozen=True)
class CandidateExecutionEvidence:
    candidate_root_ref: str
    candidate_manifest_ref: str
    candidate_manifest_sha256: str
    target_step: str | None = None
    end_step: str | None = None
    execution_scope: str | None = None

    def __post_init__(self) -> None:
        for value in (self.candidate_root_ref, self.candidate_manifest_ref):
            if (
                not value
                or "\\" in value
                or value.startswith("/")
                or "." in value.split("/")
                or ".." in value.split("/")
            ):
                raise ValueError("candidate evidence reference is invalid")
        if not _SHA256.fullmatch(self.candidate_manifest_sha256):
            raise ValueError("candidate manifest hash is invalid")


@dataclass(frozen=True)
class CandidateExecutionReceipt:
    """The only execution status the fixed adapter may return."""

    execution_id: str
    started: bool
    outcome: OptimizationOutcomeKind | None = None
    evidence: CandidateExecutionEvidence | None = None
    parameter_application_receipt: ParameterApplicationReceipt | None = None

    def __post_init__(self) -> None:
        if not _ID.fullmatch(self.execution_id):
            raise ValueError("execution receipt id is invalid")
        if not isinstance(self.started, bool):
            raise ValueError("execution receipt started flag is invalid")
        if self.outcome is not None and not isinstance(
            self.outcome, OptimizationOutcomeKind
        ):
            raise ValueError("execution receipt outcome is invalid")
        if self.evidence is not None and not isinstance(
            self.evidence, CandidateExecutionEvidence
        ):
            raise ValueError("execution receipt evidence is invalid")
        if self.parameter_application_receipt is not None and not isinstance(
            self.parameter_application_receipt, ParameterApplicationReceipt
        ):
            raise ValueError("execution parameter receipt is invalid")


@dataclass(frozen=True)
class CandidateExecutionRequest:
    """A typed execution request with no command or unrestricted path field."""

    intervention_id: str
    episode_id: str
    checkpoint_id: str
    proposal: OptimizationProposal
    requested: RequestedKnobValue
    context_sha256: str
    seed: int
    ecc_revision: str
    parent_candidate_root_ref: str | None = None

    def __post_init__(self) -> None:
        if type(self.seed) is not int:
            raise ValueError("candidate execution seed is invalid")
        if (
            not isinstance(self.ecc_revision, str)
            or not self.ecc_revision.strip()
            or self.ecc_revision.strip() == "unknown"
        ):
            raise ValueError("candidate execution ECC revision is invalid")


class OptimizationExecutionAdapter(Protocol):
    def start(
        self, request: CandidateExecutionRequest
    ) -> CandidateExecutionReceipt: ...

    def cancel(self, intervention_id: str) -> CandidateExecutionReceipt: ...
