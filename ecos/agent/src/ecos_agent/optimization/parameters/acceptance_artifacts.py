"""Serialize parameter acceptance evidence without performing validation."""

from __future__ import annotations

import json
from pathlib import Path

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.controller import CandidateExecutionEvidence


def candidate_paths(workspace: Path, candidate_id: str) -> dict[str, Path]:
    root = workspace / ".agent" / "candidates" / candidate_id
    analysis = root / "analysis"
    return {
        "root": root,
        "manifest": analysis / "candidate_workspace.v1.json",
        "materialization": analysis / "candidate_materialization.v1.json",
        "receipt": analysis / "parameter_application_receipt.v1.json",
        "runtime_report": analysis / "parameter_runtime_report.v1.json",
        "replay": analysis / "candidate_execution_receipt.v1.json",
    }


def candidate_evidence(payload: dict, candidate_manifest: Path) -> CandidateExecutionEvidence:
    return CandidateExecutionEvidence(
        payload["candidate_root_ref"],
        payload["candidate_root_ref"] + "/analysis/candidate_workspace.v1.json",
        file_sha256(candidate_manifest),
        payload["target_step"],
        payload["end_step"],
        payload["execution_scope"],
    )


def write_terminal_observation(output: Path, knob_id: str, observation) -> Path:
    observation_path = output / "terminal-observations" / f"{knob_id}.json"
    observation_path.parent.mkdir(parents=True, exist_ok=True)
    observation_path.write_text(
        json.dumps(observation.model_dump(mode="json"), sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return observation_path


def build_entry_payload(
    workspace: Path,
    output: Path,
    *,
    knob_id: str,
    candidate_id: str,
    evidence: CandidateExecutionEvidence,
    paths: dict[str, Path],
    receipt_payload: dict,
    observation_path: Path,
    terminal_sha256: str,
    card_sha256: str,
    trace_episode: Path | None,
    replay_available: bool,
    issues: list[str],
) -> dict:
    return {
        "knob_id": knob_id,
        "card_sha256": card_sha256,
        "candidate_id": candidate_id,
        "candidate_root_ref": evidence.candidate_root_ref,
        "candidate_manifest_ref": evidence.candidate_manifest_ref,
        "candidate_manifest_sha256": evidence.candidate_manifest_sha256,
        "materialization_ref": paths["materialization"].relative_to(workspace).as_posix(),
        "materialization_sha256": (
            file_sha256(paths["materialization"])
            if paths["materialization"].is_file()
            else None
        ),
        "native_receipt_ref": paths["receipt"].relative_to(workspace).as_posix(),
        "native_receipt_sha256": (
            file_sha256(paths["receipt"]) if paths["receipt"].is_file() else None
        ),
        "activation_status": receipt_payload.get("activation", {}).get("status"),
        "issues": issues,
        "terminal_observation_ref": observation_path.relative_to(output).as_posix(),
        "terminal_observation_sha256": terminal_sha256,
        "optimization_trace": {
            "episode_root_ref": (
                trace_episode.relative_to(workspace).as_posix()
                if trace_episode is not None
                else None
            ),
            "verified": trace_episode is not None,
        },
        "replay": {
            "operation": "candidate.rerun",
            "target_step": evidence.target_step,
            "end_step": evidence.end_step,
            "available": replay_available,
        },
    }


def write_acceptance_outputs(
    output: Path,
    workspace: Path,
    entries: list[dict],
    provenance: dict,
    ignored_knobs: tuple[str, ...],
) -> dict:
    manifest = {
        "schema_version": "ecos.parameter_acceptance_manifest.v1",
        "workspace": str(workspace),
        "candidate_count": len(entries),
        "ignored_knobs": list(ignored_knobs),
        "provenance": provenance,
        "entries": entries,
    }
    manifest["manifest_sha256"] = canonical_sha256(manifest)
    (output / "acceptance-manifest.v1.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    report = {
        "schema_version": "ecos.parameter_acceptance_report.v1",
        "ignored_knobs": list(ignored_knobs),
        "classification": (
            "Engineering Complete"
            if provenance["current"] and all(not entry["issues"] for entry in entries)
            else "Engineering Incomplete"
        ),
        "research_claim": "not_assessed",
        "terminal_closed_knobs": [
            entry["knob_id"]
            for entry in entries
            if not entry["issues"]
            and (
                entry["activation_status"] == "used"
                or (
                    entry["knob_id"] == "place.routability_opt"
                    and entry["activation_status"] == "not_activated"
                )
            )
        ],
        "entries": entries,
        "provenance": provenance,
        "manifest_sha256": manifest["manifest_sha256"],
    }
    (output / "acceptance-report.v1.json").write_text(
        json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    return manifest
