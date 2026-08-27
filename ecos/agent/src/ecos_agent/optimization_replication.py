"""Deterministic public projections and keyless verification for optimization episodes."""

from __future__ import annotations

import argparse
import getpass
import json
import re
import socket
from pathlib import Path
from typing import Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ecos_agent.effective_domain import EffectiveDomainSnapshot
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization_contracts import (
    OptimizationEpisodeState,
    OptimizationProposal,
    OptimizationTaskMemoryReference,
    ProposalContextRef,
)
from ecos_agent.optimization_decision_audit import (
    OptimizationDecisionAudit,
    PlannerSource,
)
from ecos_agent.optimization_ledger import (
    OptimizationArtifactManifest,
    OptimizationInterventionStart,
    OptimizationLedger,
    OptimizationPlanningAudit,
    OptimizationPlanningProviderEvidenceAudit,
    OptimizationTerminalOutcome,
    _write_json_atomic,
    build_optimization_artifact_manifest,
    verify_optimization_artifact_manifest,
)

_SOURCE_FILES = (
    "optimization-outcomes.v1.jsonl",
    "optimization-planning-audit.v1.jsonl",
    "optimization-planning-provider-audit.v1.jsonl",
    "optimization-decision-audit.v1.jsonl",
)
_PROJECTION_FILE = "optimization-replay.v1.json"
_MANIFEST_FILE = "replication-manifest.v1.json"
_RULES = (
    "omit_provider_thread_turn_identifiers",
    "replace_absolute_posix_paths",
    "replace_email_addresses",
    "replace_hostnames",
    "replace_usernames",
)
_ABSOLUTE_PATH = re.compile(r"(?<![A-Za-z0-9])/(?:[^\s\"'<>]+)")
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_HOSTNAME = re.compile(r"\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b")
_HOME_USERNAME = re.compile(r"(?<![A-Za-z0-9])/home/([^/\s]+)")
_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")


class OptimizationReplicationError(ValueError):
    """The public package is incomplete, unsafe, or has been modified."""


class _ReplicationModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublicPlanningEnvelope(_ReplicationModel):
    provider_id: Literal["codex_app_server"]
    requested_model: str | None
    prompt: str
    output_schema: dict[str, object]
    planner_payload_sha256: str
    source_envelope_sha256: str
    sanitized_envelope_sha256: str

    @field_validator(
        "planner_payload_sha256", "source_envelope_sha256", "sanitized_envelope_sha256"
    )
    @classmethod
    def validate_hash(cls, value: str) -> str:
        return _validated_hash(value)

    @model_validator(mode="after")
    def validate_content_hash(self) -> "PublicPlanningEnvelope":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"sanitized_envelope_sha256"})
        )
        if self.sanitized_envelope_sha256 != expected:
            raise ValueError("sanitized envelope hash does not match")
        return self


class PublicPlanningRecord(_ReplicationModel):
    planning_entry_sha256: str
    context_ref: ProposalContextRef
    planner_payload_sha256: str
    task_memory_snapshot_sha256: str | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    task_memory_refs: tuple[OptimizationTaskMemoryReference, ...] = Field(
        default=(), max_length=6, exclude_if=lambda value: not value
    )
    effective_domains: tuple[EffectiveDomainSnapshot, ...] = Field(
        default=(), exclude_if=lambda value: not value
    )
    response_sha256: str
    envelope: PublicPlanningEnvelope
    proposal: OptimizationProposal | None
    source_proposal_sha256: str | None
    validation_result: Literal["accepted", "rejected", "fallback"]
    rejection_reason: str | None
    state: OptimizationEpisodeState
    planner_source: PlannerSource = Field(
        default="llm", exclude_if=lambda value: value == "llm"
    )

    @field_validator(
        "planning_entry_sha256",
        "planner_payload_sha256",
        "task_memory_snapshot_sha256",
        "response_sha256",
        "source_proposal_sha256",
    )
    @classmethod
    def validate_hash(cls, value: str | None) -> str | None:
        return _validated_hash(value) if value is not None else None

    @model_validator(mode="after")
    def validate_proposal_context(self) -> "PublicPlanningRecord":
        if self.proposal is not None and self.proposal.context_ref != self.context_ref:
            raise ValueError("proposal does not match its planning context")
        if self.envelope.planner_payload_sha256 != self.planner_payload_sha256:
            raise ValueError("planning envelope does not match its planning payload")
        if (self.proposal is None) != (self.source_proposal_sha256 is None):
            raise ValueError("planning proposal hash is incomplete")
        if self.task_memory_refs and self.task_memory_snapshot_sha256 is None:
            raise ValueError("planning task memory references require a snapshot")
        return self


class PublicLifecycleRecord(_ReplicationModel):
    kind: Literal["intervention_start", "terminal_outcome"]
    payload: dict[str, object]

    @model_validator(mode="after")
    def validate_payload(self) -> "PublicLifecycleRecord":
        model = (
            OptimizationInterventionStart
            if self.kind == "intervention_start"
            else OptimizationTerminalOutcome
        )
        model.model_validate(self.payload)
        return self


class OptimizationReplayProjection(_ReplicationModel):
    schema_version: Literal["ecos.optimization_public_replay.v1"] = (
        "ecos.optimization_public_replay.v1"
    )
    rules_version: Literal["ecos.optimization_sanitization.v1"] = (
        "ecos.optimization_sanitization.v1"
    )
    lifecycle: tuple[PublicLifecycleRecord, ...]
    planning: tuple[PublicPlanningRecord, ...]
    projection_sha256: str

    @field_validator("projection_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        return _validated_hash(value)

    @model_validator(mode="after")
    def validate_projection(self) -> "OptimizationReplayProjection":
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"projection_sha256"})
        )
        if self.projection_sha256 != expected:
            raise ValueError("projection hash does not match")
        _verify_lifecycle(self.lifecycle)
        planning_ids = tuple(record.planning_entry_sha256 for record in self.planning)
        if len(set(planning_ids)) != len(planning_ids):
            raise ValueError("planning records are not unique")
        _verify_execution_proposals(self.lifecycle, self.planning)
        return self


class ReplicationPackageManifest(_ReplicationModel):
    schema_version: Literal["ecos.optimization_replication_package.v1"] = (
        "ecos.optimization_replication_package.v1"
    )
    rules_version: Literal["ecos.optimization_sanitization.v1"] = (
        "ecos.optimization_sanitization.v1"
    )
    transformations: tuple[str, ...]
    raw_manifest: OptimizationArtifactManifest
    sanitized_manifest: OptimizationArtifactManifest
    raw_root_sha256: str
    sanitized_root_sha256: str
    manifest_sha256: str

    @field_validator("raw_root_sha256", "sanitized_root_sha256", "manifest_sha256")
    @classmethod
    def validate_hash(cls, value: str) -> str:
        return _validated_hash(value)

    @model_validator(mode="after")
    def validate_manifest(self) -> "ReplicationPackageManifest":
        if self.transformations != _RULES:
            raise ValueError("replication transformations are unsupported")
        if self.raw_root_sha256 != _manifest_root(self.raw_manifest):
            raise ValueError("raw root hash does not match")
        if self.sanitized_root_sha256 != _manifest_root(self.sanitized_manifest):
            raise ValueError("sanitized root hash does not match")
        expected = canonical_sha256(
            self.model_dump(mode="json", exclude={"manifest_sha256"})
        )
        if self.manifest_sha256 != expected:
            raise ValueError("replication manifest hash does not match")
        return self


def export_replication_package(
    episode_root: Path, package_root: Path
) -> ReplicationPackageManifest:
    episode_root = episode_root.resolve()
    package_root = package_root.resolve()
    try:
        ledger = OptimizationLedger(episode_root).verify()
        planning = OptimizationPlanningAudit(episode_root).verify()
        provider = OptimizationPlanningProviderEvidenceAudit(episode_root).verify()
        decisions = OptimizationDecisionAudit(episode_root).verify()
        if not ledger.terminal_outcomes or not planning.entries:
            raise OptimizationReplicationError("episode has no replayable evidence")
        if ledger.pending_intervention_ids:
            raise OptimizationReplicationError("episode has no terminal closure")
        raw_manifest = build_optimization_artifact_manifest(episode_root, _SOURCE_FILES)
        projection = _build_projection(ledger.entries, planning.entries, provider.entries, decisions.entries)
        package_root.mkdir(parents=True, exist_ok=True)
        _write_json_atomic(package_root / _PROJECTION_FILE, projection.model_dump(mode="json"))
        sanitized_manifest = build_optimization_artifact_manifest(
            package_root, (_PROJECTION_FILE,)
        )
        payload = {
            "schema_version": "ecos.optimization_replication_package.v1",
            "rules_version": "ecos.optimization_sanitization.v1",
            "transformations": _RULES,
            "raw_manifest": raw_manifest.model_dump(mode="json"),
            "sanitized_manifest": sanitized_manifest.model_dump(mode="json"),
            "raw_root_sha256": _manifest_root(raw_manifest),
            "sanitized_root_sha256": _manifest_root(sanitized_manifest),
        }
        manifest = ReplicationPackageManifest(
            **payload, manifest_sha256=canonical_sha256(payload)
        )
        _write_json_atomic(package_root / _MANIFEST_FILE, manifest.model_dump(mode="json"))
        return manifest
    except OptimizationReplicationError:
        raise
    except (OSError, ValueError) as exc:
        raise OptimizationReplicationError(f"replication export failed: {exc}") from exc


def verify_replication_package(package_root: Path) -> ReplicationPackageManifest:
    package_root = package_root.resolve()
    try:
        manifest = ReplicationPackageManifest.model_validate_json(
            (package_root / _MANIFEST_FILE).read_bytes()
        )
        verify_optimization_artifact_manifest(package_root, manifest.sanitized_manifest)
        expected_manifest = build_optimization_artifact_manifest(
            package_root, (_PROJECTION_FILE,)
        )
        if manifest.sanitized_manifest != expected_manifest:
            raise OptimizationReplicationError(
                "sanitized manifest does not bind the replay projection"
            )
        projection = OptimizationReplayProjection.model_validate_json(
            (package_root / _PROJECTION_FILE).read_bytes()
        )
        if projection.rules_version != manifest.rules_version:
            raise OptimizationReplicationError("projection rules version does not match")
        return manifest
    except OptimizationReplicationError:
        raise
    except (OSError, ValueError) as exc:
        raise OptimizationReplicationError(f"replication hash or schema verification failed: {exc}") from exc


def _build_projection(ledger_entries, planning_entries, provider_entries, decision_entries):
    providers = _unique_by_planning_ref(provider_entries)
    decisions = _unique_by_planning_ref(decision_entries)
    planning_ids = {entry.entry_sha256 for entry in planning_entries}
    if set(providers) != planning_ids or set(decisions) != planning_ids:
        raise OptimizationReplicationError("planning evidence references are incomplete")
    lifecycle = tuple(
        PublicLifecycleRecord(
            kind=(
                "intervention_start"
                if isinstance(entry.payload, OptimizationInterventionStart)
                else "terminal_outcome"
            ),
            payload=_sanitize(entry.payload.model_dump(mode="json")),
        )
        for entry in ledger_entries
    )
    planning = tuple(
        _public_planning(entry, providers[entry.entry_sha256], decisions[entry.entry_sha256])
        for entry in planning_entries
    )
    payload = {
        "schema_version": "ecos.optimization_public_replay.v1",
        "rules_version": "ecos.optimization_sanitization.v1",
        "lifecycle": [record.model_dump(mode="json") for record in lifecycle],
        "planning": [record.model_dump(mode="json") for record in planning],
    }
    return OptimizationReplayProjection(
        **payload, projection_sha256=canonical_sha256(payload)
    )


def _public_planning(planning, provider, decision) -> PublicPlanningRecord:
    envelope = provider.evidence.envelope
    envelope_payload = {
        "provider_id": envelope.provider_id,
        "requested_model": envelope.requested_model,
        "prompt": _sanitize_text(envelope.prompt),
        "output_schema": _sanitize(envelope.output_schema),
        "planner_payload_sha256": envelope.planner_payload_sha256,
        "source_envelope_sha256": envelope.envelope_sha256,
    }
    public_envelope = PublicPlanningEnvelope(
        **envelope_payload,
        sanitized_envelope_sha256=canonical_sha256(envelope_payload),
    )
    return PublicPlanningRecord(
        planning_entry_sha256=planning.entry_sha256,
        context_ref=planning.context_ref,
        planner_payload_sha256=planning.planner_payload_sha256,
        task_memory_snapshot_sha256=planning.task_memory_snapshot_sha256,
        task_memory_refs=planning.task_memory_refs,
        effective_domains=planning.effective_domains,
        response_sha256=provider.evidence.response_sha256,
        envelope=public_envelope,
        proposal=(
            OptimizationProposal.model_validate(_sanitize(decision.proposal.model_dump(mode="json")))
            if decision.proposal is not None
            else None
        ),
        source_proposal_sha256=(
            canonical_sha256(decision.proposal.model_dump(mode="json"))
            if decision.proposal is not None
            else None
        ),
        validation_result=decision.validation_result,
        rejection_reason=(
            _sanitize_text(decision.rejection_reason)
            if decision.rejection_reason is not None
            else None
        ),
        state=decision.state,
        planner_source=decision.planner_source,
    )


def _unique_by_planning_ref(entries) -> dict[str, object]:
    indexed = {}
    for entry in entries:
        if entry.planning_entry_sha256 in indexed:
            raise OptimizationReplicationError("planning evidence reference is duplicated")
        indexed[entry.planning_entry_sha256] = entry
    return indexed


def _sanitize(value):
    if isinstance(value, dict):
        return {key: _sanitize(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, str):
        return _sanitize_text(value)
    return value


def _sanitize_text(value: str) -> str:
    usernames = set(_HOME_USERNAME.findall(value)) | {getpass.getuser()}
    for username in sorted(usernames, key=len, reverse=True):
        if username:
            value = re.sub(rf"\b{re.escape(username)}\b", "<username>", value)
    hostname = socket.gethostname()
    if hostname:
        value = value.replace(hostname, "<hostname>")
    value = _ABSOLUTE_PATH.sub("<absolute-path>", value)
    value = _EMAIL.sub("<email>", value)
    return _HOSTNAME.sub("<hostname>", value)


def _verify_lifecycle(records: tuple[PublicLifecycleRecord, ...]) -> None:
    starts = set()
    terminals = set()
    for record in records:
        intervention_id = record.payload.get("intervention_id")
        target = starts if record.kind == "intervention_start" else terminals
        if not isinstance(intervention_id, str) or intervention_id in target:
            raise ValueError("replication lifecycle record is duplicated")
        if record.kind == "terminal_outcome" and intervention_id not in starts:
            raise ValueError("terminal outcome has no intervention start")
        target.add(intervention_id)
    if starts != terminals:
        raise ValueError("replication lifecycle is not terminal-closed")


def _verify_execution_proposals(
    lifecycle: tuple[PublicLifecycleRecord, ...],
    planning: tuple[PublicPlanningRecord, ...],
) -> None:
    accepted = {
        record.source_proposal_sha256
        for record in planning
        if record.validation_result == "accepted"
        and record.proposal is not None
        and record.proposal.decision.value == "propose"
    }
    executed = {
        record.payload.get("proposal_sha256")
        for record in lifecycle
        if record.kind == "intervention_start"
    }
    if None in executed or not executed.issubset(accepted):
        raise ValueError("execution does not reference an accepted proposal")


def _manifest_root(manifest: OptimizationArtifactManifest) -> str:
    return canonical_sha256(manifest.model_dump(mode="json"))


def _validated_hash(value: str) -> str:
    if not _HASH.fullmatch(value):
        raise ValueError("replication hash is invalid")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export")
    export_parser.add_argument("episode_root", type=Path)
    export_parser.add_argument("package_root", type=Path)
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("package_root", type=Path)
    args = parser.parse_args(argv)
    manifest = (
        export_replication_package(args.episode_root, args.package_root)
        if args.command == "export"
        else verify_replication_package(args.package_root)
    )
    print(json.dumps(manifest.model_dump(mode="json"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
