"""Replayable, evidence-bound task memory for optimization episodes."""

from __future__ import annotations

import fcntl
import json
import math
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    KnobScalar,
    ObjectiveMetric,
    OptimizationKnob,
    OptimizationTaskMemoryReference,
    ProposalAction,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization_decision_audit import OptimizationDecisionAudit
from ecos_agent.optimization_ledger import (
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationOutcomeKind,
    OptimizationTerminalOutcome,
    _canonical_json,
    _fsync_directory,
    _validate_relative_path,
    _write_json_atomic,
)
from ecos_agent.optimization_legacy_reader import KnobApplicationReceipt
from ecos_agent.parameter_evidence_contracts import ParameterApplicationReceipt

_STORE_FILE = "task-memory.v1.jsonl"
_SCOPE_FILE = "optimization-task-memory-scope.v1.json"
_STATE_FILE = "optimization-episode-state.v6.json"
_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_MAX_RECORDS = 6


class OptimizationTaskMemoryError(ValueError):
    """Task memory cannot be safely created or queried."""


class OptimizationTaskMemoryIntegrityError(OptimizationTaskMemoryError):
    """Persisted task memory or source evidence failed verification."""


class _MemoryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class OptimizationTaskMemoryScope(_MemoryModel):
    schema_version: Literal["ecos.optimization_task_memory_scope.v1"] = (
        "ecos.optimization_task_memory_scope.v1"
    )
    workspace_manifest_sha256: str
    design_id: str
    checkpoint_id: str
    episode_id: str
    objective_contract_sha256: str
    scope_sha256: str

    @field_validator(
        "workspace_manifest_sha256", "objective_contract_sha256", "scope_sha256"
    )
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("task memory scope hash is invalid")
        return value

    @field_validator("design_id", "checkpoint_id", "episode_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("task memory scope identifier is invalid")
        return value

    @model_validator(mode="after")
    def validate_scope_hash(self) -> "OptimizationTaskMemoryScope":
        expected = canonical_sha256(self.model_dump(mode="json", exclude={"scope_sha256"}))
        if self.scope_sha256 != expected:
            raise ValueError("task memory scope hash is invalid")
        return self


class OptimizationTaskMemoryEvidence(_MemoryModel):
    source_episode_id: str
    intervention_id: str
    planning_entry_sha256: str
    decision_entry_sha256: str
    ledger_start_entry_sha256: str
    ledger_terminal_entry_sha256: str
    outcome_sha256: str
    candidate_manifest_sha256: str
    candidate_root_ref: str
    candidate_manifest_ref: str
    receipt_sha256: str
    terminal_observation_sha256: str

    @field_validator("source_episode_id", "intervention_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("task memory evidence identifier is invalid")
        return value

    @field_validator(
        "planning_entry_sha256",
        "decision_entry_sha256",
        "ledger_start_entry_sha256",
        "ledger_terminal_entry_sha256",
        "outcome_sha256",
        "candidate_manifest_sha256",
        "receipt_sha256",
        "terminal_observation_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("task memory evidence hash is invalid")
        return value

    @field_validator("candidate_root_ref", "candidate_manifest_ref")
    @classmethod
    def validate_candidate_ref(cls, value: str) -> str:
        _validate_relative_path(value)
        return value


class OptimizationTaskMemoryEntry(_MemoryModel):
    schema_version: Literal["ecos.optimization_task_memory_entry.v1"] = (
        "ecos.optimization_task_memory_entry.v1"
    )
    sequence: StrictInt = Field(ge=1)
    previous_entry_sha256: str | None = None
    scope: OptimizationTaskMemoryScope
    action: ProposalAction
    requested: RequestedKnobValue
    outcome: OptimizationOutcomeKind
    terminal_observation: TerminalObservation
    evidence: OptimizationTaskMemoryEvidence
    application_receipt: KnobApplicationReceipt | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    parameter_application_receipt: ParameterApplicationReceipt | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    entry_sha256: str

    @field_validator("previous_entry_sha256", "entry_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("task memory entry hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_entry(self) -> "OptimizationTaskMemoryEntry":
        if self.action.knob_id != self.requested.knob_id:
            raise ValueError("task memory action and requested knob do not match")
        if self.evidence.source_episode_id != self.scope.episode_id:
            raise ValueError("task memory evidence does not match its scope")
        if (
            self.application_receipt is not None
            and self.application_receipt.requested != self.requested
        ):
            raise ValueError("task memory receipt does not match requested value")
        if self.parameter_application_receipt is not None:
            requested = self.parameter_application_receipt.requested
            if self.application_receipt is not None:
                raise ValueError("task memory receipt fields are ambiguous")
            if requested.get("knob_id") != self.requested.knob_id.value or requested.get("value") != self.requested.value:
                raise ValueError("task memory parameter receipt does not match requested value")
        expected = _entry_sha256(
            self.sequence,
            self.previous_entry_sha256,
            self.model_dump(
                mode="json",
                exclude={"sequence", "previous_entry_sha256", "entry_sha256"},
            ),
        )
        if self.entry_sha256 != expected:
            raise ValueError("task memory entry hash is invalid")
        return self


class OptimizationTaskMemoryOutcomeCount(_MemoryModel):
    outcome: OptimizationOutcomeKind
    count: StrictInt = Field(ge=1, le=_MAX_RECORDS)


class OptimizationTaskMemoryMetricRange(_MemoryModel):
    metric_id: ObjectiveMetric
    minimum: float
    maximum: float

    @model_validator(mode="after")
    def validate_range(self) -> "OptimizationTaskMemoryMetricRange":
        if not math.isfinite(self.minimum) or not math.isfinite(self.maximum):
            raise ValueError("task memory metric range is invalid")
        if self.minimum > self.maximum:
            raise ValueError("task memory metric range is reversed")
        return self


class OptimizationTaskMemorySummary(_MemoryModel):
    reference: OptimizationTaskMemoryReference
    knob_id: OptimizationKnob
    direction: StrategyDirection
    requested_values: tuple[KnobScalar, ...] = Field(max_length=_MAX_RECORDS)
    outcome_counts: tuple[OptimizationTaskMemoryOutcomeCount, ...]
    metric_ranges: tuple[OptimizationTaskMemoryMetricRange, ...]
    evidence_refs: tuple[OptimizationTaskMemoryEvidence, ...] = Field(
        min_length=1, max_length=_MAX_RECORDS
    )
    application_receipts: tuple[KnobApplicationReceipt, ...] = Field(
        default=(), max_length=_MAX_RECORDS, exclude_if=lambda value: not value
    )
    parameter_application_receipts: tuple[ParameterApplicationReceipt, ...] = Field(
        default=(), max_length=_MAX_RECORDS, exclude_if=lambda value: not value
    )

    @model_validator(mode="after")
    def validate_summary_hash(self) -> "OptimizationTaskMemorySummary":
        if any(
            receipt.requested.knob_id != self.knob_id
            for receipt in self.application_receipts
        ):
            raise ValueError("task memory summary receipt knob does not match")
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"reference"})
        )
        if self.reference.summary_sha256 != expected:
            raise ValueError("task memory summary hash is invalid")
        return self


class OptimizationTaskMemorySnapshot(_MemoryModel):
    schema_version: Literal["ecos.optimization_task_memory_snapshot.v1"] = (
        "ecos.optimization_task_memory_snapshot.v1"
    )
    scope: OptimizationTaskMemoryScope
    source_event_count: StrictInt = Field(ge=0)
    source_evidence_sha256: str | None = None
    summaries: tuple[OptimizationTaskMemorySummary, ...] = Field(max_length=_MAX_RECORDS)
    snapshot_sha256: str

    @field_validator("source_evidence_sha256", "snapshot_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("task memory snapshot hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_snapshot_hash(self) -> "OptimizationTaskMemorySnapshot":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"snapshot_sha256"})
        )
        if self.snapshot_sha256 != expected:
            raise ValueError("task memory snapshot hash is invalid")
        return self


@dataclass(frozen=True)
class OptimizationTaskMemoryReplay:
    entries: tuple[OptimizationTaskMemoryEntry, ...]
    chain_head_sha256: str | None


@dataclass(frozen=True)
class _Candidate:
    scope: OptimizationTaskMemoryScope
    action: ProposalAction
    requested: RequestedKnobValue
    outcome: OptimizationOutcomeKind
    terminal_observation: TerminalObservation
    evidence: OptimizationTaskMemoryEvidence
    parameter_application_receipt: ParameterApplicationReceipt | None = None


def build_task_memory_scope(
    *,
    workspace_manifest_sha256: str,
    design_id: str,
    checkpoint_id: str,
    episode_id: str,
    objective_contract_sha256: str,
) -> OptimizationTaskMemoryScope:
    value = {
        "schema_version": "ecos.optimization_task_memory_scope.v1",
        "workspace_manifest_sha256": workspace_manifest_sha256,
        "design_id": design_id,
        "checkpoint_id": checkpoint_id,
        "episode_id": episode_id,
        "objective_contract_sha256": objective_contract_sha256,
    }
    return OptimizationTaskMemoryScope(**value, scope_sha256=canonical_sha256(value))


class OptimizationTaskMemoryStore:
    """Append terminal evidence and derive a bounded cross-episode snapshot."""

    def __init__(self, root: Path, scope: OptimizationTaskMemoryScope) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.scope = scope
        self.store_path = self.root / _STORE_FILE
        self._lock_path = self.root / ".task-memory.lock"

    def ensure_episode_scope(
        self, episode_root: Path, scope: OptimizationTaskMemoryScope | None = None
    ) -> None:
        expected = scope or self.scope
        path = episode_root.resolve() / _SCOPE_FILE
        if path.is_file():
            if _load_scope(path) != expected:
                raise OptimizationTaskMemoryIntegrityError(
                    "task memory scope conflicts with the episode"
                )
            return
        _write_json_atomic(path, expected.model_dump(mode="json"))

    def verify_episode_scope(self, episode_root: Path) -> None:
        if _load_scope(episode_root.resolve() / _SCOPE_FILE) != self.scope:
            raise OptimizationTaskMemoryIntegrityError(
                "task memory scope does not match the recovered episode"
            )

    def replay(self) -> OptimizationTaskMemoryReplay:
        with self._exclusive_lock():
            return self._verify_locked()

    def synchronize(self) -> OptimizationTaskMemoryReplay:
        with self._exclusive_lock():
            replay = self._verify_locked()
            known = {_evidence_key(entry.evidence) for entry in replay.entries}
            candidates = []
            for episode_root in sorted(path for path in self.root.iterdir() if path.is_dir()):
                if (episode_root / _SCOPE_FILE).is_file():
                    candidates.extend(_derive_candidates(episode_root))
            derived = {_evidence_key(candidate.evidence) for candidate in candidates}
            if not known.issubset(derived):
                raise OptimizationTaskMemoryIntegrityError(
                    "task memory source evidence is unavailable"
                )
            candidates.sort(
                key=lambda item: (
                    item.scope.episode_id,
                    item.evidence.ledger_terminal_entry_sha256,
                )
            )
            entries = list(replay.entries)
            previous = replay.chain_head_sha256
            for candidate in candidates:
                if _evidence_key(candidate.evidence) in known:
                    continue
                entry = _build_entry(len(entries) + 1, previous, candidate)
                with self.store_path.open("ab") as stream:
                    stream.write(_canonical_json(entry.model_dump(mode="json")) + b"\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                entries.append(entry)
                previous = entry.entry_sha256
                known.add(_evidence_key(candidate.evidence))
            if entries != list(replay.entries):
                _fsync_directory(self.root)
            return OptimizationTaskMemoryReplay(tuple(entries), previous)

    def snapshot(self) -> OptimizationTaskMemorySnapshot:
        replay = self.synchronize()
        matching = [
            entry
            for entry in replay.entries
            if _same_task(entry.scope, self.scope)
            and entry.scope.episode_id != self.scope.episode_id
        ]
        selected = matching[-_MAX_RECORDS:]
        summaries = _summaries(tuple(selected))
        value = {
            "schema_version": "ecos.optimization_task_memory_snapshot.v1",
            "scope": self.scope.model_dump(mode="json"),
            "source_event_count": len(matching),
            "source_evidence_sha256": (
                canonical_sha256(
                    [entry.evidence.model_dump(mode="json") for entry in matching]
                )
                if matching
                else None
            ),
            "summaries": [item.model_dump(mode="json") for item in summaries],
        }
        return OptimizationTaskMemorySnapshot(
            **value, snapshot_sha256=canonical_sha256(value)
        )

    def _verify_locked(self) -> OptimizationTaskMemoryReplay:
        if not self.store_path.exists():
            return OptimizationTaskMemoryReplay((), None)
        payload = self.store_path.read_bytes()
        if payload and not payload.endswith(b"\n"):
            raise OptimizationTaskMemoryIntegrityError(
                "task memory store has a torn final record"
            )
        entries = []
        previous = None
        for line_number, raw_line in enumerate(payload.splitlines(), start=1):
            try:
                entry = OptimizationTaskMemoryEntry.model_validate_json(raw_line)
            except ValueError as exc:
                raise OptimizationTaskMemoryIntegrityError(
                    f"task memory record {line_number} has an invalid hash or schema"
                ) from exc
            if entry.sequence != line_number or entry.previous_entry_sha256 != previous:
                raise OptimizationTaskMemoryIntegrityError(
                    "task memory hash chain is broken"
                )
            entries.append(entry)
            previous = entry.entry_sha256
        return OptimizationTaskMemoryReplay(tuple(entries), previous)

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        with self._lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _derive_candidates(episode_root: Path) -> tuple[_Candidate, ...]:
    scope = _load_scope(episode_root / _SCOPE_FILE)
    state = _verified_state(episode_root / _STATE_FILE)
    ledger = OptimizationLedger(episode_root).verify()
    decisions = OptimizationDecisionAudit(episode_root).verify()
    _verify_source_trace(scope, state, ledger, decisions)
    accepted = {
        canonical_sha256(entry.proposal.model_dump(mode="json")): entry
        for entry in decisions.entries
        if entry.validation_result in {"accepted", "fallback"}
        and entry.proposal is not None
    }
    starts = {
        entry.payload.intervention_id: (entry, entry.payload)
        for entry in ledger.entries
        if isinstance(entry.payload, OptimizationInterventionStart)
    }
    result = []
    for terminal_entry in ledger.entries:
        terminal = terminal_entry.payload
        if not isinstance(terminal, OptimizationTerminalOutcome):
            continue
        start_entry, start = starts[terminal.intervention_id]
        if not _eligible(start, terminal):
            continue
        decision = accepted.get(start.proposal_sha256)
        if decision is None:
            raise OptimizationTaskMemoryIntegrityError(
                "terminal memory evidence has no accepted decision"
            )
        assert start.proposal_action is not None and start.requested is not None
        assert terminal.terminal_observation is not None
        assert terminal.terminal_observation_sha256 is not None
        assert terminal.candidate_root_ref is not None
        assert terminal.candidate_manifest_ref is not None
        assert terminal.receipt_sha256 is not None
        result.append(
            _Candidate(
                scope=scope,
                action=start.proposal_action,
                requested=start.requested,
                outcome=terminal.outcome,
                terminal_observation=terminal.terminal_observation,
                evidence=OptimizationTaskMemoryEvidence(
                    source_episode_id=scope.episode_id,
                    intervention_id=start.intervention_id,
                    planning_entry_sha256=decision.planning_entry_sha256,
                    decision_entry_sha256=decision.entry_sha256,
                    ledger_start_entry_sha256=start_entry.entry_sha256,
                    ledger_terminal_entry_sha256=terminal_entry.entry_sha256,
                    outcome_sha256=canonical_sha256(terminal.model_dump(mode="json")),
                    candidate_manifest_sha256=terminal.candidate_manifest_sha256,
                    candidate_root_ref=terminal.candidate_root_ref,
                    candidate_manifest_ref=terminal.candidate_manifest_ref,
                    receipt_sha256=terminal.receipt_sha256,
                    terminal_observation_sha256=terminal.terminal_observation_sha256,
                ),
                parameter_application_receipt=terminal.parameter_application_receipt,
            )
        )
    return tuple(result)


def _verified_state(path: Path) -> dict[str, object]:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        recorded = state.pop("state_sha256")
    except (OSError, json.JSONDecodeError, KeyError, AttributeError) as exc:
        raise OptimizationTaskMemoryIntegrityError(
            "task memory source state is unavailable"
        ) from exc
    if recorded != canonical_sha256(state):
        raise OptimizationTaskMemoryIntegrityError("task memory source state hash is invalid")
    state["state_sha256"] = recorded
    return state


def _verify_source_trace(scope, state, ledger, decisions) -> None:
    objective = state.get("objective")
    if (
        state.get("schema_version") != "ecos.optimization_episode_state.v6"
        or state.get("episode_id") != scope.episode_id
        or state.get("checkpoint_id") != scope.checkpoint_id
        or state.get("parent_manifest_sha256") != scope.workspace_manifest_sha256
        or state.get("task_memory_scope_sha256") != scope.scope_sha256
        or not isinstance(objective, dict)
        or objective.get("contract_sha256") != scope.objective_contract_sha256
        or state.get("ledger_event_count") != len(ledger.entries)
        or state.get("ledger_chain_head_sha256") != ledger.chain_head_sha256
        or state.get("decision_audit_event_count") != len(decisions.entries)
        or state.get("decision_audit_chain_head_sha256") != decisions.chain_head_sha256
    ):
        raise OptimizationTaskMemoryIntegrityError(
            "task memory source scope does not match its evidence trace"
        )
    for entry in ledger.entries:
        if isinstance(entry.payload, OptimizationInterventionStart) and (
            entry.payload.parent_checkpoint_id != scope.checkpoint_id
            or entry.payload.parent_manifest_sha256 != scope.workspace_manifest_sha256
            or entry.payload.objective_contract_sha256 != scope.objective_contract_sha256
        ):
            raise OptimizationTaskMemoryIntegrityError(
                "task memory intervention does not match its scope"
            )


def _eligible(start, terminal) -> bool:
    return all(
        value is not None
        for value in (
            start.proposal_action,
            start.requested,
            terminal.candidate_root_ref,
            terminal.candidate_manifest_ref,
            terminal.receipt_sha256,
            terminal.terminal_observation,
            terminal.terminal_observation_sha256,
        )
    )


def _build_entry(sequence: int, previous: str | None, candidate: _Candidate):
    payload = {
        "schema_version": "ecos.optimization_task_memory_entry.v1",
        "scope": candidate.scope.model_dump(mode="json"),
        "action": candidate.action.model_dump(mode="json"),
        "requested": candidate.requested.model_dump(mode="json"),
        "outcome": candidate.outcome.value,
        "terminal_observation": candidate.terminal_observation.model_dump(mode="json"),
        "evidence": candidate.evidence.model_dump(mode="json"),
    }
    if candidate.parameter_application_receipt is not None:
        payload["parameter_application_receipt"] = candidate.parameter_application_receipt.model_dump(mode="json")
    return OptimizationTaskMemoryEntry(
        sequence=sequence,
        previous_entry_sha256=previous,
        **payload,
        entry_sha256=_entry_sha256(sequence, previous, payload),
    )


def _entry_sha256(sequence: int, previous: str | None, payload: object) -> str:
    return canonical_sha256(
        {
            "schema_version": "ecos.optimization_task_memory_entry.v1",
            "sequence": sequence,
            "previous_entry_sha256": previous,
            "payload": payload,
        }
    )


def _summaries(
    entries: tuple[OptimizationTaskMemoryEntry, ...]
) -> tuple[OptimizationTaskMemorySummary, ...]:
    groups: dict[tuple[str, str], list[OptimizationTaskMemoryEntry]] = {}
    for entry in entries:
        groups.setdefault((entry.action.knob_id.value, entry.action.direction.value), []).append(
            entry
        )
    result = []
    for key in sorted(groups):
        group = groups[key]
        counts = tuple(
            OptimizationTaskMemoryOutcomeCount(outcome=outcome, count=count)
            for outcome, count in sorted(
                (
                    (outcome, sum(entry.outcome == outcome for entry in group))
                    for outcome in {entry.outcome for entry in group}
                ),
                key=lambda item: item[0].value,
            )
        )
        ranges = []
        for metric in ObjectiveMetric:
            values = [entry.terminal_observation.metrics[metric] for entry in group]
            ranges.append(
                OptimizationTaskMemoryMetricRange(
                    metric_id=metric, minimum=min(values), maximum=max(values)
                )
            )
        payload = {
            "knob_id": group[0].action.knob_id.value,
            "direction": group[0].action.direction.value,
            "requested_values": [entry.requested.value for entry in group],
            "outcome_counts": [item.model_dump(mode="json") for item in counts],
            "metric_ranges": [item.model_dump(mode="json") for item in ranges],
            "evidence_refs": [entry.evidence.model_dump(mode="json") for entry in group],
        }
        native_receipts = [
            entry.parameter_application_receipt.model_dump(mode="json")
            for entry in group
            if entry.parameter_application_receipt is not None
        ]
        if native_receipts:
            payload["parameter_application_receipts"] = native_receipts
        result.append(
            OptimizationTaskMemorySummary(
                reference=OptimizationTaskMemoryReference(
                    summary_sha256=canonical_sha256(payload)
                ),
                **payload,
            )
        )
    return tuple(result)


def _same_task(left: OptimizationTaskMemoryScope, right: OptimizationTaskMemoryScope) -> bool:
    return (
        left.workspace_manifest_sha256 == right.workspace_manifest_sha256
        and left.design_id == right.design_id
        and left.checkpoint_id == right.checkpoint_id
        and left.objective_contract_sha256 == right.objective_contract_sha256
    )


def _evidence_key(evidence: OptimizationTaskMemoryEvidence) -> tuple[str, str, str]:
    return (
        evidence.source_episode_id,
        evidence.intervention_id,
        evidence.outcome_sha256,
    )


def _load_scope(path: Path) -> OptimizationTaskMemoryScope:
    try:
        return OptimizationTaskMemoryScope.model_validate_json(path.read_bytes())
    except (OSError, ValueError) as exc:
        raise OptimizationTaskMemoryIntegrityError("task memory scope hash is invalid") from exc
