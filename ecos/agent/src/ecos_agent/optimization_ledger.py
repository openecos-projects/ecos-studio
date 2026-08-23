"""Append-only, hash-bound outcome storage for optimization episodes."""

from __future__ import annotations

import fcntl
import json
import os
import re
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Annotated, Iterator, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_contracts import (
    BudgetSnapshot,
    HistoryReference,
    PlanningProviderEvidence,
    ProposalContextRef,
    ProposalAction,
    RequestedKnobValue,
    SelectionMetric,
    TerminalObservation,
)
from ecos_agent.optimization_rules import IncumbentDecision

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


class OptimizationLedgerError(ValueError):
    """Base error for optimization ledger operations."""


class OptimizationLedgerIntegrityError(OptimizationLedgerError):
    """The persisted chain or its semantic state cannot be trusted."""


class OptimizationLedgerRecoveryRequired(OptimizationLedgerError):
    """The ledger ended in a torn record and must be recovered explicitly."""


class OptimizationPlanningAuditIntegrityError(OptimizationLedgerError):
    """The planning-input audit chain cannot be trusted."""


class OptimizationPlanningProviderAuditIntegrityError(OptimizationLedgerError):
    """The Codex planning-turn evidence chain cannot be trusted."""


class OptimizationLedgerStateError(OptimizationLedgerError):
    """An append would violate the intervention lifecycle."""


class OptimizationArtifactManifestError(OptimizationLedgerError):
    """An artifact manifest is unsafe, incomplete, or no longer matches disk."""


class _LedgerModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class OptimizationOutcomeKind(StrEnum):
    IMPROVED = "improved"
    DEGRADED = "degraded"
    TRADEOFF = "tradeoff"
    INFEASIBLE = "infeasible"
    EXECUTION_SUCCEEDED = "execution_succeeded"
    CANDIDATE_INELIGIBLE = "candidate_ineligible"
    EXECUTION_FAILED = "execution_failed"
    EVIDENCE_INVALID = "evidence_invalid"
    TIMED_OUT_CANCELLED = "timed_out_cancelled"
    INDETERMINATE = "indeterminate"


class OptimizationArtifactEntry(_LedgerModel):
    relative_path: str
    size_bytes: StrictInt = Field(ge=0)
    sha256: str

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        _validate_relative_path(value)
        return value

    @field_validator("sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        _validate_sha256(value)
        return value


class OptimizationArtifactManifest(_LedgerModel):
    schema_version: Literal["ecos.optimization_artifact_manifest.v1"] = (
        "ecos.optimization_artifact_manifest.v1"
    )
    entries: tuple[OptimizationArtifactEntry, ...] = Field(min_length=1)

    @field_validator("entries")
    @classmethod
    def validate_entries(
        cls, value: tuple[OptimizationArtifactEntry, ...]
    ) -> tuple[OptimizationArtifactEntry, ...]:
        paths = tuple(entry.relative_path for entry in value)
        if paths != tuple(sorted(paths)) or len(set(paths)) != len(paths):
            raise ValueError("artifact manifest paths must be unique and sorted")
        return value

    @property
    def manifest_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class OptimizationInterventionStart(_LedgerModel):
    record_type: Literal["intervention_started"] = "intervention_started"
    intervention_id: str
    parent_checkpoint_id: str
    candidate_checkpoint_id: str
    parameter_before_sha256: str
    parameter_after_sha256: str
    proposal_sha256: str
    execution_contract_sha256: str
    parent_manifest_sha256: str
    environment_sha256: str
    objective_contract_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    proposal_action: ProposalAction | None = None
    requested: RequestedKnobValue | None = None

    @field_validator("intervention_id", "parent_checkpoint_id", "candidate_checkpoint_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("ledger identifier is invalid")
        return value

    @field_validator(
        "parameter_before_sha256",
        "parameter_after_sha256",
        "proposal_sha256",
        "execution_contract_sha256",
        "parent_manifest_sha256",
        "environment_sha256",
        "objective_contract_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_sha256(value)
        return value

    @model_validator(mode="after")
    def validate_checkpoints(self) -> "OptimizationInterventionStart":
        if self.parent_checkpoint_id == self.candidate_checkpoint_id:
            raise ValueError("parent and candidate checkpoints must be different")
        if (self.proposal_action is None) != (self.requested is None):
            raise ValueError("ledger proposal action and requested value must be paired")
        if self.proposal_action is not None and self.requested is not None:
            if self.proposal_action.knob_id != self.requested.knob_id:
                raise ValueError("ledger proposal action and requested knob must match")
        return self


class OptimizationTerminalOutcome(_LedgerModel):
    record_type: Literal["terminal_outcome"] = "terminal_outcome"
    intervention_id: str
    outcome: OptimizationOutcomeKind
    candidate_manifest_sha256: str
    candidate_root_ref: str | None = None
    candidate_manifest_ref: str | None = None
    receipt_sha256: str | None = None
    terminal_observation_sha256: str | None = None
    terminal_observation: TerminalObservation | None = None
    incumbent_decision: IncumbentDecision | None = None
    decisive_metric: SelectionMetric | None = None
    outcome_details_sha256: str

    @model_validator(mode="after")
    def validate_terminal_observation_hash(self) -> "OptimizationTerminalOutcome":
        if self.terminal_observation is not None:
            expected = canonical_sha256(self.terminal_observation.model_dump(mode="json"))
            if self.terminal_observation_sha256 != expected:
                raise ValueError("terminal observation hash is invalid")
        if self.incumbent_decision is None and self.decisive_metric is not None:
            raise ValueError("decisive metric requires an incumbent decision")
        return self

    @field_validator("intervention_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError("ledger identifier is invalid")
        return value

    @field_validator("candidate_root_ref", "candidate_manifest_ref")
    @classmethod
    def validate_candidate_refs(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_relative_path(value)
        return value

    @field_validator(
        "candidate_manifest_sha256",
        "receipt_sha256",
        "terminal_observation_sha256",
        "outcome_details_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_sha256(value)
        return value


OptimizationLedgerPayload = Annotated[
    OptimizationInterventionStart | OptimizationTerminalOutcome,
    Field(discriminator="record_type"),
]


class OptimizationLedgerEntry(_LedgerModel):
    schema_version: Literal["ecos.optimization_ledger_entry.v1"] = "ecos.optimization_ledger_entry.v1"
    sequence: StrictInt = Field(ge=1)
    previous_entry_sha256: str | None = None
    payload: OptimizationLedgerPayload
    entry_sha256: str

    @field_validator("previous_entry_sha256", "entry_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_sha256(value)
        return value

    @model_validator(mode="after")
    def validate_entry_hash(self) -> "OptimizationLedgerEntry":
        if self.entry_sha256 != _entry_sha256(
            self.sequence,
            self.previous_entry_sha256,
            self.payload,
        ):
            raise ValueError("ledger entry hash is invalid")
        return self


class OptimizationLedgerManifest(_LedgerModel):
    schema_version: Literal["ecos.optimization_ledger_manifest.v1"] = (
        "ecos.optimization_ledger_manifest.v1"
    )
    event_count: StrictInt = Field(ge=0)
    ledger_sha256: str
    chain_head_sha256: str | None

    @field_validator("ledger_sha256", "chain_head_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_sha256(value)
        return value


@dataclass(frozen=True)
class OptimizationLedgerReplay:
    entries: tuple[OptimizationLedgerEntry, ...]
    pending_intervention_ids: tuple[str, ...]
    terminal_outcomes: tuple[OptimizationTerminalOutcome, ...]
    chain_head_sha256: str | None


class OptimizationPlanningAuditEntry(_LedgerModel):
    schema_version: Literal["ecos.optimization_planning_audit.v1"] = (
        "ecos.optimization_planning_audit.v1"
    )
    sequence: StrictInt = Field(ge=1)
    previous_entry_sha256: str | None = None
    context_ref: ProposalContextRef
    context_input_sha256: str
    history_refs: tuple[HistoryReference, ...] = ()
    history_outcomes: tuple[OptimizationOutcomeKind, ...] = ()
    history_count: StrictInt = Field(ge=0, le=6)
    budget_snapshot_sha256: str
    incumbent_sha256: str | None = None
    planner_payload_sha256: str
    entry_sha256: str

    @field_validator(
        "previous_entry_sha256",
        "context_input_sha256",
        "budget_snapshot_sha256",
        "incumbent_sha256",
        "planner_payload_sha256",
        "entry_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_sha256(value)
        return value

    @model_validator(mode="after")
    def validate_audit_entry(self) -> "OptimizationPlanningAuditEntry":
        if self.context_input_sha256 != self.context_ref.input_sha256:
            raise ValueError("planning context hash does not match context reference")
        if (
            len(self.history_refs) != self.history_count
            or len(self.history_outcomes) != self.history_count
        ):
            raise ValueError("planning history count does not match history references")
        expected = _planning_audit_entry_sha256(
            self.sequence,
            self.previous_entry_sha256,
            self.model_dump(
                mode="json", exclude={"entry_sha256", "sequence", "previous_entry_sha256"}
            ),
        )
        if self.entry_sha256 != expected:
            raise ValueError("planning audit entry hash is invalid")
        return self


@dataclass(frozen=True)
class OptimizationPlanningAuditReplay:
    entries: tuple[OptimizationPlanningAuditEntry, ...]
    chain_head_sha256: str | None


class OptimizationPlanningAudit:
    """Append-only hash chain for the exact inputs supplied to each planner call."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.audit_path = self.root / "optimization-planning-audit.v1.jsonl"
        self._lock_path = self.root / ".optimization-planning-audit.lock"

    def append(
        self,
        *,
        context_ref: ProposalContextRef,
        history_refs: tuple[HistoryReference, ...],
        history_outcomes: tuple[OptimizationOutcomeKind, ...],
        budget_snapshot: BudgetSnapshot,
        incumbent: TerminalObservation | None,
        planner_payload_sha256: str,
    ) -> OptimizationPlanningAuditEntry:
        with self._exclusive_lock():
            replay = self._verify_locked()
            entry_payload = {
                "schema_version": "ecos.optimization_planning_audit.v1",
                "context_ref": context_ref.model_dump(mode="json"),
                "context_input_sha256": context_ref.input_sha256,
                "history_refs": [item.model_dump(mode="json") for item in history_refs],
                "history_outcomes": [item.value for item in history_outcomes],
                "history_count": len(history_refs),
                "budget_snapshot_sha256": canonical_sha256(budget_snapshot.model_dump(mode="json")),
                "incumbent_sha256": (
                    canonical_sha256(incumbent.model_dump(mode="json"))
                    if incumbent is not None
                    else None
                ),
                "planner_payload_sha256": planner_payload_sha256,
            }
            entry = OptimizationPlanningAuditEntry(
                sequence=len(replay.entries) + 1,
                previous_entry_sha256=replay.chain_head_sha256,
                **entry_payload,
                entry_sha256=_planning_audit_entry_sha256(
                    len(replay.entries) + 1,
                    replay.chain_head_sha256,
                    entry_payload,
                ),
            )
            with self.audit_path.open("ab") as stream:
                stream.write(_canonical_json(entry.model_dump(mode="json")) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            _fsync_directory(self.audit_path.parent)
            return entry

    def verify(self) -> OptimizationPlanningAuditReplay:
        with self._exclusive_lock():
            return self._verify_locked()

    def replay(self) -> OptimizationPlanningAuditReplay:
        return self.verify()

    def _verify_locked(self) -> OptimizationPlanningAuditReplay:
        if not self.audit_path.exists():
            return OptimizationPlanningAuditReplay((), None)
        payload = self.audit_path.read_bytes()
        if payload and not payload.endswith(b"\n"):
            raise OptimizationPlanningAuditIntegrityError("planning audit has a torn final record")
        entries: list[OptimizationPlanningAuditEntry] = []
        previous_hash = None
        for line_number, raw_line in enumerate(payload.splitlines(), start=1):
            try:
                entry = OptimizationPlanningAuditEntry.model_validate_json(raw_line)
            except ValueError as exc:
                raise OptimizationPlanningAuditIntegrityError(
                    f"planning audit record {line_number} has an invalid hash or schema"
                ) from exc
            if entry.sequence != line_number or entry.previous_entry_sha256 != previous_hash:
                raise OptimizationPlanningAuditIntegrityError("planning audit hash chain is broken")
            entries.append(entry)
            previous_hash = entry.entry_sha256
        return OptimizationPlanningAuditReplay(tuple(entries), previous_hash)

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        with self._lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


class OptimizationPlanningProviderEvidenceEntry(_LedgerModel):
    schema_version: Literal["ecos.optimization_planning_provider_audit.v1"] = (
        "ecos.optimization_planning_provider_audit.v1"
    )
    sequence: StrictInt = Field(ge=1)
    previous_entry_sha256: str | None = None
    planning_entry_sha256: str
    evidence: PlanningProviderEvidence
    entry_sha256: str

    @field_validator("previous_entry_sha256", "planning_entry_sha256", "entry_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None:
            _validate_sha256(value)
        return value

    @model_validator(mode="after")
    def validate_evidence_entry(self) -> "OptimizationPlanningProviderEvidenceEntry":
        expected = _planning_provider_audit_entry_sha256(
            self.sequence,
            self.previous_entry_sha256,
            self.model_dump(
                mode="json", exclude={"entry_sha256", "sequence", "previous_entry_sha256"}
            ),
        )
        if self.entry_sha256 != expected:
            raise ValueError("planning provider audit entry hash is invalid")
        return self


@dataclass(frozen=True)
class OptimizationPlanningProviderEvidenceReplay:
    entries: tuple[OptimizationPlanningProviderEvidenceEntry, ...]
    chain_head_sha256: str | None


class OptimizationPlanningProviderEvidenceAudit:
    """Append-only proof that a planning input produced a Codex turn."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.audit_path = self.root / "optimization-planning-provider-audit.v1.jsonl"
        self._lock_path = self.root / ".optimization-planning-provider-audit.lock"

    def append(
        self,
        *,
        planning_entry_sha256: str,
        evidence: PlanningProviderEvidence,
    ) -> OptimizationPlanningProviderEvidenceEntry:
        with self._exclusive_lock():
            replay = self._verify_locked()
            payload = {
                "schema_version": "ecos.optimization_planning_provider_audit.v1",
                "planning_entry_sha256": planning_entry_sha256,
                "evidence": evidence.model_dump(mode="json"),
            }
            entry = OptimizationPlanningProviderEvidenceEntry(
                sequence=len(replay.entries) + 1,
                previous_entry_sha256=replay.chain_head_sha256,
                **payload,
                entry_sha256=_planning_provider_audit_entry_sha256(
                    len(replay.entries) + 1,
                    replay.chain_head_sha256,
                    payload,
                ),
            )
            with self.audit_path.open("ab") as stream:
                stream.write(_canonical_json(entry.model_dump(mode="json")) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            _fsync_directory(self.audit_path.parent)
            return entry

    def verify(self) -> OptimizationPlanningProviderEvidenceReplay:
        with self._exclusive_lock():
            return self._verify_locked()

    def replay(self) -> OptimizationPlanningProviderEvidenceReplay:
        return self.verify()

    def _verify_locked(self) -> OptimizationPlanningProviderEvidenceReplay:
        if not self.audit_path.exists():
            return OptimizationPlanningProviderEvidenceReplay((), None)
        payload = self.audit_path.read_bytes()
        if payload and not payload.endswith(b"\n"):
            raise OptimizationPlanningProviderAuditIntegrityError(
                "planning provider audit has a torn final record"
            )
        entries: list[OptimizationPlanningProviderEvidenceEntry] = []
        previous_hash = None
        for line_number, raw_line in enumerate(payload.splitlines(), start=1):
            try:
                entry = OptimizationPlanningProviderEvidenceEntry.model_validate_json(raw_line)
            except ValueError as exc:
                raise OptimizationPlanningProviderAuditIntegrityError(
                    f"planning provider audit record {line_number} has an invalid hash or schema"
                ) from exc
            if entry.sequence != line_number or entry.previous_entry_sha256 != previous_hash:
                raise OptimizationPlanningProviderAuditIntegrityError(
                    "planning provider audit hash chain is broken"
                )
            entries.append(entry)
            previous_hash = entry.entry_sha256
        return OptimizationPlanningProviderEvidenceReplay(tuple(entries), previous_hash)

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        with self._lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


class OptimizationLedger:
    """A per-episode JSONL ledger that never rewrites valid records."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.ledger_path = self.root / "optimization-outcomes.v1.jsonl"
        self.manifest_path = self.root / "optimization-ledger-manifest.v1.json"
        self._lock_path = self.root / ".optimization-ledger.lock"

    def append_start(self, start: OptimizationInterventionStart) -> OptimizationLedgerEntry:
        with self._exclusive_lock():
            replay = self._verify_locked()
            known_ids = {
                entry.payload.intervention_id
                for entry in replay.entries
                if isinstance(entry.payload, OptimizationInterventionStart)
            }
            if start.intervention_id in known_ids:
                raise OptimizationLedgerStateError("intervention already exists in the outcome ledger")
            return self._append_locked(replay, start)

    def append_terminal(self, outcome: OptimizationTerminalOutcome) -> OptimizationLedgerEntry:
        with self._exclusive_lock():
            replay = self._verify_locked()
            if outcome.intervention_id not in replay.pending_intervention_ids:
                raise OptimizationLedgerStateError("intervention is not pending in the outcome ledger")
            return self._append_locked(replay, outcome)

    def verify(self) -> OptimizationLedgerReplay:
        with self._exclusive_lock():
            return self._verify_locked()

    def replay(self) -> OptimizationLedgerReplay:
        return self.verify()

    def recover(self) -> OptimizationLedgerReplay:
        """Repair a missing final newline or discard only an incomplete final write."""
        with self._exclusive_lock():
            if self.ledger_path.is_file():
                payload = self.ledger_path.read_bytes()
                if payload and not payload.endswith(b"\n"):
                    self._recover_final_record(payload)
            return self._verify_locked()

    def write_manifest(self) -> OptimizationLedgerManifest:
        with self._exclusive_lock():
            replay = self._verify_locked()
            manifest = self._manifest_locked(replay)
            _write_json_atomic(self.manifest_path, manifest.model_dump(mode="json"))
            return manifest

    def verify_manifest(self, manifest: OptimizationLedgerManifest) -> None:
        with self._exclusive_lock():
            if manifest != self._manifest_locked(self._verify_locked()):
                raise OptimizationLedgerIntegrityError("ledger manifest does not match the retained chain")

    def _append_locked(
        self,
        replay: OptimizationLedgerReplay,
        payload: OptimizationLedgerPayload,
    ) -> OptimizationLedgerEntry:
        entry = _new_entry(len(replay.entries) + 1, replay.chain_head_sha256, payload)
        encoded = _canonical_json(entry.model_dump(mode="json")) + b"\n"
        with self.ledger_path.open("ab") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        _fsync_directory(self.ledger_path.parent)
        return entry

    def _verify_locked(self) -> OptimizationLedgerReplay:
        return _replay_entries(self._read_entries())

    def _manifest_locked(self, replay: OptimizationLedgerReplay) -> OptimizationLedgerManifest:
        if not self.ledger_path.exists():
            with self.ledger_path.open("wb") as stream:
                stream.flush()
                os.fsync(stream.fileno())
            _fsync_directory(self.ledger_path.parent)
        return OptimizationLedgerManifest(
            event_count=len(replay.entries),
            ledger_sha256=file_sha256(self.ledger_path),
            chain_head_sha256=replay.chain_head_sha256,
        )

    def _read_entries(self) -> tuple[OptimizationLedgerEntry, ...]:
        if not self.ledger_path.exists():
            return ()
        payload = self.ledger_path.read_bytes()
        if payload and not payload.endswith(b"\n"):
            raise OptimizationLedgerRecoveryRequired("ledger has a torn final record; call recover")
        return _parse_entries(payload)

    def _recover_final_record(self, payload: bytes) -> None:
        prefix, separator, tail = payload.rpartition(b"\n")
        retained = prefix + separator
        try:
            entry = OptimizationLedgerEntry.model_validate_json(tail)
        except ValueError:
            self._truncate_to(retained)
            return
        _replay_entries((*_parse_entries(retained), entry))
        with self.ledger_path.open("ab") as stream:
            stream.write(b"\n")
            stream.flush()
            os.fsync(stream.fileno())

    def _truncate_to(self, retained: bytes) -> None:
        with self.ledger_path.open("r+b") as stream:
            stream.truncate(len(retained))
            stream.flush()
            os.fsync(stream.fileno())

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        with self._lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _parse_entries(payload: bytes) -> tuple[OptimizationLedgerEntry, ...]:
    entries = []
    for line_number, raw_line in enumerate(payload.splitlines(), start=1):
        if not raw_line:
            raise OptimizationLedgerIntegrityError("ledger contains an empty record")
        try:
            entry = OptimizationLedgerEntry.model_validate_json(raw_line)
        except ValueError as exc:
            raise OptimizationLedgerIntegrityError(
                f"ledger record {line_number} has an invalid hash or schema"
            ) from exc
        entries.append(entry)
    return tuple(entries)


def build_optimization_artifact_manifest(
    workspace_root: Path,
    relative_paths: tuple[str, ...],
) -> OptimizationArtifactManifest:
    root = workspace_root.resolve()
    if not root.is_dir():
        raise OptimizationArtifactManifestError("artifact workspace root is unavailable")
    entries = []
    for relative_path in relative_paths:
        path = _resolve_artifact_path(root, relative_path)
        entries.append(
            OptimizationArtifactEntry(
                relative_path=relative_path,
                size_bytes=path.stat().st_size,
                sha256=file_sha256(path),
            )
        )
    try:
        return OptimizationArtifactManifest(
            entries=tuple(sorted(entries, key=lambda entry: entry.relative_path))
        )
    except ValueError as exc:
        raise OptimizationArtifactManifestError(str(exc)) from exc


def verify_optimization_artifact_manifest(
    workspace_root: Path,
    manifest: OptimizationArtifactManifest,
) -> None:
    root = workspace_root.resolve()
    if not root.is_dir():
        raise OptimizationArtifactManifestError("artifact workspace root is unavailable")
    for entry in manifest.entries:
        path = _resolve_artifact_path(root, entry.relative_path)
        if file_sha256(path) != entry.sha256:
            raise OptimizationArtifactManifestError("artifact hash does not match the manifest")
        if path.stat().st_size != entry.size_bytes:
            raise OptimizationArtifactManifestError("artifact size does not match the manifest")


def write_optimization_artifact_manifest(
    manifest: OptimizationArtifactManifest,
    destination: Path,
) -> None:
    _write_json_atomic(destination, manifest.model_dump(mode="json"))


def load_optimization_artifact_manifest(destination: Path) -> OptimizationArtifactManifest:
    try:
        return OptimizationArtifactManifest.model_validate_json(destination.read_bytes())
    except (OSError, ValueError) as exc:
        raise OptimizationArtifactManifestError("artifact manifest is invalid") from exc


def _replay_entries(entries: tuple[OptimizationLedgerEntry, ...]) -> OptimizationLedgerReplay:
    previous_hash = None
    starts: dict[str, OptimizationInterventionStart] = {}
    terminal_by_id: dict[str, OptimizationTerminalOutcome] = {}
    outcomes = []
    for expected_sequence, entry in enumerate(entries, start=1):
        if entry.sequence != expected_sequence:
            raise OptimizationLedgerIntegrityError("ledger sequence is not contiguous")
        if entry.previous_entry_sha256 != previous_hash:
            raise OptimizationLedgerIntegrityError("ledger hash chain is broken")
        payload = entry.payload
        if isinstance(payload, OptimizationInterventionStart):
            if payload.intervention_id in starts:
                raise OptimizationLedgerIntegrityError("ledger contains a duplicate intervention")
            starts[payload.intervention_id] = payload
        else:
            if payload.intervention_id not in starts or payload.intervention_id in terminal_by_id:
                raise OptimizationLedgerIntegrityError("terminal outcome does not match one pending intervention")
            terminal_by_id[payload.intervention_id] = payload
            outcomes.append(payload)
        previous_hash = entry.entry_sha256
    pending = tuple(intervention_id for intervention_id in starts if intervention_id not in terminal_by_id)
    return OptimizationLedgerReplay(entries, pending, tuple(outcomes), previous_hash)


def _new_entry(
    sequence: int,
    previous_entry_sha256: str | None,
    payload: OptimizationLedgerPayload,
) -> OptimizationLedgerEntry:
    return OptimizationLedgerEntry(
        sequence=sequence,
        previous_entry_sha256=previous_entry_sha256,
        payload=payload,
        entry_sha256=_entry_sha256(sequence, previous_entry_sha256, payload),
    )


def _entry_sha256(
    sequence: int,
    previous_entry_sha256: str | None,
    payload: OptimizationLedgerPayload,
) -> str:
    return canonical_sha256(
        {
            "schema_version": "ecos.optimization_ledger_entry.v1",
            "sequence": sequence,
            "previous_entry_sha256": previous_entry_sha256,
            "payload": payload.model_dump(mode="json"),
        }
    )


def _planning_audit_entry_sha256(
    sequence: int,
    previous_entry_sha256: str | None,
    payload: object,
) -> str:
    return canonical_sha256(
        {
            "schema_version": "ecos.optimization_planning_audit.v1",
            "sequence": sequence,
            "previous_entry_sha256": previous_entry_sha256,
            "payload": payload,
        }
    )


def _planning_provider_audit_entry_sha256(
    sequence: int,
    previous_entry_sha256: str | None,
    payload: object,
) -> str:
    return canonical_sha256(
        {
            "schema_version": "ecos.optimization_planning_provider_audit.v1",
            "sequence": sequence,
            "previous_entry_sha256": previous_entry_sha256,
            "payload": payload,
        }
    )


def _resolve_artifact_path(root: Path, relative_path: str) -> Path:
    _validate_relative_path(relative_path)
    relative = PurePosixPath(relative_path)
    path = root.joinpath(*relative.parts)
    current = path
    while current != root:
        if current.is_symlink():
            raise OptimizationArtifactManifestError("artifact path must not contain a symlink")
        current = current.parent
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise OptimizationArtifactManifestError("artifact path is unavailable")
    return path


def _validate_relative_path(value: str) -> None:
    path = PurePosixPath(value)
    if not value or "\\" in value or path.is_absolute() or "." in path.parts or ".." in path.parts:
        raise OptimizationArtifactManifestError("artifact path must be relative and normalized")


def _validate_sha256(value: str) -> None:
    if not _SHA256.fullmatch(value):
        raise ValueError("sha256 value is invalid")


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _write_json_atomic(destination: Path, value: object) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(_canonical_json(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, destination)
        _fsync_directory(destination.parent)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def _fsync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
