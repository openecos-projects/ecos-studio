"""Append-only audit of validated optimization planning decisions."""

from __future__ import annotations

import fcntl
import json
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    OptimizationEpisodeState,
    OptimizationProposal,
    RequestedKnobValue,
)

DecisionValidationResult = Literal["accepted", "rejected", "fallback"]
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


class OptimizationDecisionAuditIntegrityError(ValueError):
    """The planning-decision chain cannot be trusted."""


class OptimizationDecisionAuditEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ecos.optimization_decision_audit.v1"] = (
        "ecos.optimization_decision_audit.v1"
    )
    sequence: int = Field(ge=1)
    previous_entry_sha256: str | None = None
    planning_entry_sha256: str
    proposal: OptimizationProposal | None = None
    validation_result: DecisionValidationResult
    rejection_reason: str | None = None
    requested: RequestedKnobValue | None = None
    state: OptimizationEpisodeState
    entry_sha256: str

    @field_validator("previous_entry_sha256", "planning_entry_sha256", "entry_sha256")
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        if value is not None and not _SHA256.fullmatch(value):
            raise ValueError("decision audit hash is invalid")
        return value

    @model_validator(mode="after")
    def validate_entry(self) -> "OptimizationDecisionAuditEntry":
        payload = self.model_dump(
            mode="json", exclude={"entry_sha256", "sequence", "previous_entry_sha256"}
        )
        expected = canonical_sha256(
            {
                "schema_version": self.schema_version,
                "sequence": self.sequence,
                "previous_entry_sha256": self.previous_entry_sha256,
                **payload,
            }
        )
        if self.entry_sha256 != expected:
            raise ValueError("decision audit entry hash is invalid")
        if self.validation_result == "accepted" and self.rejection_reason is not None:
            raise ValueError("accepted decision cannot have a rejection reason")
        if self.validation_result != "accepted" and not self.rejection_reason:
            raise ValueError("non-accepted decision requires a reason")
        return self


@dataclass(frozen=True)
class OptimizationDecisionAuditReplay:
    entries: tuple[OptimizationDecisionAuditEntry, ...]
    chain_head_sha256: str | None


class OptimizationDecisionAudit:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.audit_path = self.root / "optimization-decision-audit.v1.jsonl"
        self._lock_path = self.root / ".optimization-decision-audit.lock"

    def append(
        self,
        *,
        planning_entry_sha256: str,
        proposal: OptimizationProposal | None,
        validation_result: DecisionValidationResult,
        rejection_reason: str | None,
        requested: RequestedKnobValue | None,
        state: OptimizationEpisodeState,
    ) -> OptimizationDecisionAuditEntry:
        with self._exclusive_lock():
            replay = self._verify_locked()
            sequence = len(replay.entries) + 1
            payload = {
                "planning_entry_sha256": planning_entry_sha256,
                "proposal": proposal.model_dump(mode="json") if proposal else None,
                "validation_result": validation_result,
                "rejection_reason": rejection_reason,
                "requested": requested.model_dump(mode="json") if requested else None,
                "state": state.value,
            }
            hash_payload = {
                "schema_version": "ecos.optimization_decision_audit.v1",
                "sequence": sequence,
                "previous_entry_sha256": replay.chain_head_sha256,
                **payload,
            }
            entry = OptimizationDecisionAuditEntry(
                schema_version="ecos.optimization_decision_audit.v1",
                sequence=sequence,
                previous_entry_sha256=replay.chain_head_sha256,
                **payload,
                entry_sha256=canonical_sha256(hash_payload),
            )
            with self.audit_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(entry.model_dump(mode="json"), sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            return entry

    def replay(self) -> OptimizationDecisionAuditReplay:
        with self._exclusive_lock():
            return self._verify_locked()

    verify = replay

    def _verify_locked(self) -> OptimizationDecisionAuditReplay:
        if not self.audit_path.exists():
            return OptimizationDecisionAuditReplay((), None)
        payload = self.audit_path.read_bytes()
        if payload and not payload.endswith(b"\n"):
            raise OptimizationDecisionAuditIntegrityError("decision audit has a torn record")
        entries = []
        previous = None
        for line_number, line in enumerate(payload.splitlines(), start=1):
            try:
                entry = OptimizationDecisionAuditEntry.model_validate_json(line)
            except ValueError as exc:
                raise OptimizationDecisionAuditIntegrityError(
                    f"decision audit record {line_number} is invalid"
                ) from exc
            if entry.sequence != line_number or entry.previous_entry_sha256 != previous:
                raise OptimizationDecisionAuditIntegrityError("decision audit chain is broken")
            entries.append(entry)
            previous = entry.entry_sha256
        return OptimizationDecisionAuditReplay(tuple(entries), previous)

    @contextmanager
    def _exclusive_lock(self) -> Iterator[None]:
        with self._lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
