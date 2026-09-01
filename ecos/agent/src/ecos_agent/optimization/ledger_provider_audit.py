"""Append-only evidence for Codex planning turns."""

from __future__ import annotations

import fcntl
import os
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from ecos_agent.optimization.contracts import PlanningProviderEvidence
from ecos_agent.optimization.ledger import (
    _LedgerModel,
    OptimizationPlanningProviderAuditIntegrityError,
)
from ecos_agent.optimization.ledger_artifacts import (
    _canonical_json,
    _fsync_directory,
    _planning_provider_audit_entry_sha256,
    _validate_sha256,
)


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
                mode="json",
                exclude={"entry_sha256", "sequence", "previous_entry_sha256"},
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
                entry = OptimizationPlanningProviderEvidenceEntry.model_validate_json(
                    raw_line
                )
            except ValueError as exc:
                raise OptimizationPlanningProviderAuditIntegrityError(
                    f"planning provider audit record {line_number} has an invalid hash or schema"
                ) from exc
            if (
                entry.sequence != line_number
                or entry.previous_entry_sha256 != previous_hash
            ):
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
