"""Evidence-bound, episode-local task memory derived from optimization traces."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    ProposalAction,
    RequestedKnobValue,
    SelectionMetric,
    TerminalObservation,
)
from ecos_agent.optimization_decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
)

_MEMORY_FILE = "optimization-task-memory.v1.json"
_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


class OptimizationTaskMemoryError(ValueError):
    """Task memory cannot be trusted for replay or retrieval."""


class OptimizationTaskMemoryScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    workspace_id: str
    design_id: str
    design_fingerprint_sha256: str
    episode_id: str
    objective_contract_sha256: str | None = None

    @field_validator("workspace_id", "design_id", "episode_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("memory scope id is invalid")
        return value

    @field_validator("design_fingerprint_sha256", "objective_contract_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("memory scope hash is invalid")
        return value


class OptimizationTaskMemoryEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ledger_event_count: int = Field(ge=0)
    ledger_chain_head_sha256: str | None = None
    start_entry_sha256: str
    terminal_entry_sha256: str
    terminal_outcome_sha256: str
    planning_entry_sha256: str | None = None
    decision_entry_sha256: str | None = None
    candidate_manifest_sha256: str
    candidate_root_ref: str | None = None
    candidate_manifest_ref: str | None = None
    receipt_sha256: str | None = None

    @field_validator(
        "ledger_chain_head_sha256",
        "start_entry_sha256",
        "terminal_entry_sha256",
        "terminal_outcome_sha256",
        "planning_entry_sha256",
        "decision_entry_sha256",
        "candidate_manifest_sha256",
        "receipt_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("memory evidence hash is invalid")
        return value


class OptimizationTaskMemoryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    intervention_id: str
    stage: str
    action: ProposalAction
    requested: RequestedKnobValue | None = None
    outcome: OptimizationOutcomeKind
    incumbent_decision: str | None = None
    decisive_metric: SelectionMetric | None = None
    terminal_observation: TerminalObservation | None = None
    summary: str
    evidence: OptimizationTaskMemoryEvidence

    @field_validator("intervention_id", "stage")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("memory entry id is invalid")
        return value


class OptimizationTaskMemory(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.optimization_task_memory.v1"] = (
        "ecos.optimization_task_memory.v1"
    )
    scope: OptimizationTaskMemoryScope
    entries: tuple[OptimizationTaskMemoryEntry, ...] = ()
    memory_sha256: str

    @field_validator("memory_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("memory hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_memory_hash(self) -> "OptimizationTaskMemory":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"memory_sha256"})
        )
        if self.memory_sha256 != expected:
            raise ValueError("memory hash is invalid")
        return self


def derive_episode_task_memory(
    episode_root: Path,
    *,
    workspace_id: str,
    design_id: str,
    design_fingerprint_sha256: str,
) -> OptimizationTaskMemory:
    root = episode_root.resolve()
    ledger_replay = OptimizationLedger(root).verify()
    decisions = OptimizationDecisionAudit(root).verify()
    accepted = {
        canonical_sha256(entry.proposal.model_dump(mode="json")): entry
        for entry in decisions.entries
        if entry.validation_result in {"accepted", "fallback"} and entry.proposal is not None
    }
    starts = {
        entry.payload.intervention_id: (entry, entry.payload)
        for entry in ledger_replay.entries
        if isinstance(entry.payload, OptimizationInterventionStart)
    }
    objective_hashes = {
        payload.objective_contract_sha256
        for _, payload in starts.values()
        if payload.objective_contract_sha256 is not None
    }
    scope = OptimizationTaskMemoryScope(
        workspace_id=workspace_id,
        design_id=design_id,
        design_fingerprint_sha256=design_fingerprint_sha256,
        episode_id=_episode_id(decisions),
        objective_contract_sha256=_single_objective_hash(objective_hashes),
    )
    entries = []
    for terminal_entry in ledger_replay.entries:
        outcome = getattr(terminal_entry.payload, "outcome", None)
        if outcome is None:
            continue
        start_entry, start = starts[terminal_entry.payload.intervention_id]
        decision = accepted.get(start.proposal_sha256)
        if decision is None or start.proposal_action is None:
            continue
        entries.append(
            OptimizationTaskMemoryEntry(
                intervention_id=start.intervention_id,
                stage=start.parent_checkpoint_id,
                action=start.proposal_action,
                requested=start.requested,
                outcome=terminal_entry.payload.outcome,
                incumbent_decision=(
                    terminal_entry.payload.incumbent_decision.value
                    if terminal_entry.payload.incumbent_decision is not None
                    else None
                ),
                decisive_metric=terminal_entry.payload.decisive_metric,
                terminal_observation=terminal_entry.payload.terminal_observation,
                summary=_summary(start.proposal_action, terminal_entry.payload.outcome),
                evidence=OptimizationTaskMemoryEvidence(
                    ledger_event_count=terminal_entry.sequence,
                    ledger_chain_head_sha256=terminal_entry.entry_sha256,
                    start_entry_sha256=start_entry.entry_sha256,
                    terminal_entry_sha256=terminal_entry.entry_sha256,
                    terminal_outcome_sha256=canonical_sha256(
                        terminal_entry.payload.model_dump(mode="json")
                    ),
                    planning_entry_sha256=decision.planning_entry_sha256,
                    decision_entry_sha256=decision.entry_sha256,
                    candidate_manifest_sha256=terminal_entry.payload.candidate_manifest_sha256,
                    candidate_root_ref=terminal_entry.payload.candidate_root_ref,
                    candidate_manifest_ref=terminal_entry.payload.candidate_manifest_ref,
                    receipt_sha256=terminal_entry.payload.receipt_sha256,
                ),
            )
        )
    memory = _build_memory(scope, tuple(entries))
    _reject_conflict(root, memory)
    _write_json_atomic(root / _MEMORY_FILE, memory.model_dump(mode="json"))
    return memory


def load_episode_task_memory(
    episode_root: Path,
    *,
    workspace_id: str | None = None,
    design_id: str | None = None,
    design_fingerprint_sha256: str | None = None,
    episode_id: str | None = None,
) -> OptimizationTaskMemory:
    try:
        memory = OptimizationTaskMemory.model_validate_json(
            (episode_root / _MEMORY_FILE).read_bytes()
        )
    except (OSError, ValueError) as exc:
        raise OptimizationTaskMemoryError("task memory hash is invalid") from exc
    expected = {
        "workspace_id": workspace_id,
        "design_id": design_id,
        "design_fingerprint_sha256": design_fingerprint_sha256,
        "episode_id": episode_id,
    }
    for key, value in expected.items():
        if value is not None and getattr(memory.scope, key) != value:
            raise OptimizationTaskMemoryError("task memory scope does not match")
    return memory


def optimization_task_memory_path(episode_root: Path) -> Path:
    return episode_root / _MEMORY_FILE


def _build_memory(
    scope: OptimizationTaskMemoryScope,
    entries: tuple[OptimizationTaskMemoryEntry, ...],
) -> OptimizationTaskMemory:
    value = {
        "schema_version": "ecos.optimization_task_memory.v1",
        "scope": scope.model_dump(mode="json"),
        "entries": [entry.model_dump(mode="json") for entry in entries],
    }
    return OptimizationTaskMemory(**value, memory_sha256=canonical_sha256(value))


def _episode_id(decisions) -> str:
    for entry in decisions.entries:
        if entry.proposal is not None:
            return entry.proposal.context_ref.episode_id
    raise OptimizationTaskMemoryError("task memory has no planning evidence")


def _single_objective_hash(values: set[str]) -> str | None:
    if len(values) > 1:
        raise OptimizationTaskMemoryError("task memory objective scope is ambiguous")
    return next(iter(values), None)


def _summary(action: ProposalAction, outcome: OptimizationOutcomeKind) -> str:
    return f"{action.knob_id} {action.direction.value} -> {outcome.value}"


def _reject_conflict(root: Path, memory: OptimizationTaskMemory) -> None:
    path = root / _MEMORY_FILE
    if not path.exists():
        return
    existing = load_episode_task_memory(root)
    if existing.scope != memory.scope:
        raise OptimizationTaskMemoryError("task memory scope conflicts with episode")
    if existing.entries != memory.entries[: len(existing.entries)]:
        raise OptimizationTaskMemoryError("task memory conflicts with evidence")


def _write_json_atomic(destination: Path, value: object) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise
