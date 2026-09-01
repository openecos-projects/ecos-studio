"""Artifact manifests and hash-chain helpers for the outcome ledger."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path, PurePosixPath

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.ledger import (
    _SHA256,
    OptimizationArtifactEntry,
    OptimizationArtifactManifest,
    OptimizationArtifactManifestError,
    OptimizationInterventionStart,
    OptimizationLedgerEntry,
    OptimizationLedgerIntegrityError,
    OptimizationLedgerPayload,
    OptimizationLedgerReplay,
    OptimizationTerminalOutcome,
)


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
        raise OptimizationArtifactManifestError(
            "artifact workspace root is unavailable"
        )
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
        raise OptimizationArtifactManifestError(
            "artifact workspace root is unavailable"
        )
    for entry in manifest.entries:
        path = _resolve_artifact_path(root, entry.relative_path)
        if file_sha256(path) != entry.sha256:
            raise OptimizationArtifactManifestError(
                "artifact hash does not match the manifest"
            )
        if path.stat().st_size != entry.size_bytes:
            raise OptimizationArtifactManifestError(
                "artifact size does not match the manifest"
            )


def write_optimization_artifact_manifest(
    manifest: OptimizationArtifactManifest,
    destination: Path,
) -> None:
    _write_json_atomic(destination, manifest.model_dump(mode="json"))


def load_optimization_artifact_manifest(
    destination: Path,
) -> OptimizationArtifactManifest:
    try:
        return OptimizationArtifactManifest.model_validate_json(
            destination.read_bytes()
        )
    except (OSError, ValueError) as exc:
        raise OptimizationArtifactManifestError("artifact manifest is invalid") from exc


def _replay_entries(
    entries: tuple[OptimizationLedgerEntry, ...],
) -> OptimizationLedgerReplay:
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
                raise OptimizationLedgerIntegrityError(
                    "ledger contains a duplicate intervention"
                )
            starts[payload.intervention_id] = payload
        else:
            if (
                payload.intervention_id not in starts
                or payload.intervention_id in terminal_by_id
            ):
                raise OptimizationLedgerIntegrityError(
                    "terminal outcome does not match one pending intervention"
                )
            start = starts[payload.intervention_id]
            if payload.application_receipt is not None and (
                start.requested is None
                or payload.application_receipt.requested != start.requested
            ):
                raise OptimizationLedgerIntegrityError(
                    "terminal application receipt does not match intervention request"
                )
            if payload.parameter_application_receipt is not None:
                requested = payload.parameter_application_receipt.requested
                if (
                    start.requested is None
                    or requested.get("knob_id") != start.requested.knob_id.value
                    or requested.get("value") != start.requested.value
                ):
                    raise OptimizationLedgerIntegrityError(
                        "terminal parameter receipt does not match intervention request"
                    )
            if (
                payload.target_step != start.target_step
                or payload.end_step != start.end_step
                or payload.execution_scope != start.execution_scope
            ):
                raise OptimizationLedgerIntegrityError(
                    "terminal execution contract does not match intervention start"
                )
            terminal_by_id[payload.intervention_id] = payload
            outcomes.append(payload)
        previous_hash = entry.entry_sha256
    pending = tuple(
        intervention_id
        for intervention_id in starts
        if intervention_id not in terminal_by_id
    )
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
            raise OptimizationArtifactManifestError(
                "artifact path must not contain a symlink"
            )
        current = current.parent
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise OptimizationArtifactManifestError("artifact path is unavailable")
    return path


def _validate_relative_path(value: str) -> None:
    path = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or path.is_absolute()
        or "." in path.parts
        or ".." in path.parts
    ):
        raise OptimizationArtifactManifestError(
            "artifact path must be relative and normalized"
        )


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
