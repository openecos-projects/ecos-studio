"""Artifact validation and preservation helpers for parameter-gap resume."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization.contracts import OptimizationKnob, TerminalObservation
from ecos_agent.optimization.experiments.parameter_gap import (
    KnobGapSummary,
    ProbeResult,
    summarize_knob,
)
from ecos_agent.optimization.experiments.parameter_gap_setup import (
    ParameterGapError,
    ParameterGapResumeConfig,
)

_CANDIDATE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$")


def _archive_failed_probe_output(
    resume_root: Path, output: Path, candidate_id: str
) -> None:
    if not output.exists():
        return
    attempts = resume_root / "attempts" / candidate_id
    attempts.mkdir(parents=True, exist_ok=True)
    sequence = sum(path.is_dir() for path in attempts.glob("attempt-*")) + 1
    output.replace(attempts / f"attempt-{sequence:03d}")


def _read_json_object(path: Path) -> dict[str, Any]:
    if path.is_symlink():
        raise ParameterGapError(f"invalid JSON artifact: {path.name}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ParameterGapError(f"invalid JSON artifact: {path.name}") from exc
    if not isinstance(payload, dict):
        raise ParameterGapError(f"invalid JSON artifact: {path.name}")
    return payload


def _validate_resume_source(
    source: dict[str, Any], resume: ParameterGapResumeConfig, run_root: Path
) -> None:
    readiness = source.get("readiness")
    if (
        source.get("schema_version") != "ecos.rq1_parameter_gap_report.v1"
        or source.get("run_id") != resume.source_run_id
        or not isinstance(readiness, dict)
        or readiness.get("config_sha256") != resume.source_config_sha256
        or not (run_root / "baseline-1/workspace").is_dir()
    ):
        raise ParameterGapError("source parameter gap run binding is invalid")


def _resume_manifest(
    resume: ParameterGapResumeConfig,
    readiness: dict[str, Any],
    run_root: Path,
    source_report: dict[str, Any],
    started_at: str,
    previous_resume: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "schema_version": "ecos.rq1_parameter_gap_resume_run.v1",
        "source_run_id": resume.source_run_id,
        "resume_id": resume.resume_id,
        "reason": resume.reason,
        "max_workers": resume.max_workers,
        "previous_resume_id": resume.previous_resume_id,
        "expected_previous_manifest_sha256": (
            resume.expected_previous_manifest_sha256
        ),
        "previous_resume": previous_resume,
        "started_at": started_at,
        "source_report_sha256": file_sha256(run_root / "gcd-gap-report.v1.json"),
        "source_candidate_count": source_report["candidate_count"],
        "source_terminal_closed_count": source_report["terminal_closed_count"],
        "resume_step_counts": _resume_step_counts(run_root),
        "preserved_success_step_sha256": _success_step_digests(run_root),
        "readiness": readiness,
        "baseline_artifact_sha256": {
            f"baseline-{index}": file_sha256(
                run_root / f"baseline-{index}" / "flow-terminal-result.v1.json"
            )
            for index in range(1, 4)
        },
    }


def _import_previous_resume(
    run_root: Path,
    resume_root: Path,
    resume: ParameterGapResumeConfig,
    source_report_sha256: str,
    source_candidate_ids: frozenset[str],
) -> dict[str, Any] | None:
    previous_id = resume.previous_resume_id
    if previous_id is None:
        return None
    if previous_id == resume.resume_id:
        raise ParameterGapError("previous resume must differ from current resume")
    previous_root = run_root / "resumes" / previous_id
    if previous_root.is_symlink() or not previous_root.is_dir():
        raise ParameterGapError("previous resume directory is invalid")
    manifest_path = previous_root / "resume-manifest.v1.json"
    manifest = _read_json_object(manifest_path)
    manifest_sha256 = file_sha256(manifest_path)
    previous_readiness = manifest.get("readiness")
    if (
        manifest.get("schema_version") != "ecos.rq1_parameter_gap_resume_run.v1"
        or manifest.get("source_run_id") != resume.source_run_id
        or manifest.get("resume_id") != previous_id
        or manifest_sha256 != resume.expected_previous_manifest_sha256
        or manifest.get("source_report_sha256") != source_report_sha256
        or not isinstance(previous_readiness, dict)
        or previous_readiness.get("source_config_sha256")
        != resume.source_config_sha256
    ):
        raise ParameterGapError("previous resume binding is invalid")
    imported = _copy_completed_probes(
        previous_root, resume_root, source_candidate_ids
    )
    return {
        "resume_id": previous_id,
        "manifest_sha256": manifest_sha256,
        "candidate_artifact_sha256": imported,
    }


def _copy_completed_probes(
    previous_root: Path,
    resume_root: Path,
    source_candidate_ids: frozenset[str],
) -> dict[str, str]:
    imported: dict[str, str] = {}
    paths = sorted((previous_root / "probes").glob("*/probe-result.v1.json"))
    for result_path in paths:
        candidate_id = result_path.parent.name
        if candidate_id not in source_candidate_ids:
            raise ParameterGapError("previous resume candidate is invalid")
        if not _read_probe_result(result_path).terminal_closed:
            continue
        source = result_path.parent
        if source.is_symlink() or any(path.is_symlink() for path in source.rglob("*")):
            raise ParameterGapError("previous resume artifact is unsafe")
        destination = resume_root / "probes" / candidate_id
        if destination.exists() or destination.is_symlink():
            raise ParameterGapError("resume import destination already exists")
        shutil.copytree(source, destination)
        imported[candidate_id] = _tree_digest(destination)
    return dict(sorted(imported.items()))


def _verify_imported_resume(
    resume_root: Path, value: object, *, required: bool = False
) -> None:
    if value is None:
        if required:
            raise ParameterGapError("imported resume artifact binding is missing")
        return
    candidates = value.get("candidate_artifact_sha256") if isinstance(value, dict) else None
    if not isinstance(candidates, dict) or any(
        not isinstance(candidate_id, str)
        or not _CANDIDATE_ID.fullmatch(candidate_id)
        or not isinstance(digest, str)
        or _tree_digest(resume_root / "probes" / candidate_id) != digest
        for candidate_id, digest in candidates.items()
    ):
        raise ParameterGapError("imported resume artifact binding is invalid")


def _success_step_digests(run_root: Path) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    candidates = run_root / "baseline-1/workspace/.agent/candidates"
    for flow_path in candidates.glob("*/home/flow.json"):
        candidate = flow_path.parents[1]
        steps = _read_json_object(flow_path).get("steps")
        if not isinstance(steps, list):
            raise ParameterGapError("candidate flow steps are invalid")
        preserved = {}
        for step in steps:
            if not isinstance(step, dict) or step.get("state") != "Success":
                break
            name, tool = step.get("name"), step.get("tool")
            if not isinstance(name, str) or not isinstance(tool, str):
                raise ParameterGapError("candidate flow step is invalid")
            directory = f"{name}_{tool}"
            preserved[directory] = _tree_digest(candidate / directory)
        result[candidate.name] = preserved
    return dict(sorted(result.items()))


def _tree_digest(root: Path) -> str:
    if root.is_symlink() or not root.is_dir():
        raise ParameterGapError("preserved candidate step directory is invalid")
    hashes = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ParameterGapError("preserved candidate step artifact is unsafe")
        if not path.is_file():
            continue
        hashes[path.relative_to(root).as_posix()] = file_sha256(path)
    return canonical_sha256(hashes)


def _verify_resume_preservation(
    run_root: Path, manifest: dict[str, Any]
) -> dict[str, bool]:
    baselines = manifest.get("baseline_artifact_sha256")
    preserved = manifest.get("preserved_success_step_sha256")
    if not isinstance(baselines, dict) or not isinstance(preserved, dict):
        raise ParameterGapError("resume preservation manifest is invalid")
    baseline_ok = all(
        digest == file_sha256(run_root / name / "flow-terminal-result.v1.json")
        for name, digest in baselines.items()
    )
    candidates = run_root / "baseline-1/workspace/.agent/candidates"
    step_ok = all(
        digest == _tree_digest(candidates / candidate / directory)
        for candidate, steps in preserved.items()
        for directory, digest in steps.items()
    )
    if not baseline_ok or not step_ok:
        raise ParameterGapError("resume modified a preserved artifact")
    return {
        "baseline_artifacts_unchanged": True,
        "preserved_success_steps_unchanged": True,
    }


def _resume_step_counts(run_root: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    candidates = run_root / "baseline-1/workspace/.agent/candidates"
    for flow_path in candidates.glob("*/home/flow.json"):
        candidate = flow_path.parents[1]
        if not (candidate / "analysis/candidate_materialization.v1.json").is_file():
            continue
        steps = _read_json_object(flow_path).get("steps")
        first = next(
            (
                item.get("name")
                for item in steps
                if isinstance(item, dict) and item.get("state") != "Success"
            ),
            None,
        ) if isinstance(steps, list) else None
        if isinstance(first, str):
            counts[first] = counts.get(first, 0) + 1
    return dict(sorted(counts.items()))


def _load_source_results(run_root: Path, expected_count: int) -> tuple[ProbeResult, ...]:
    paths = sorted(
        (run_root / "probes").glob("*/probe-result.v1.json"),
        key=lambda path: _candidate_sequence(path.parent.name),
    )
    if len(paths) != expected_count:
        raise ParameterGapError("source probe count is invalid")
    return tuple(_read_probe_result(path) for path in paths)


def _completed_resume_result(resume_root: Path, candidate_id: str) -> ProbeResult | None:
    path = resume_root / "probes" / candidate_id / "probe-result.v1.json"
    if not path.is_file():
        return None
    result = _read_probe_result(path)
    return result if result.terminal_closed else None


def _read_probe_result(path: Path) -> ProbeResult:
    payload = _read_json_object(path)
    payload.pop("peak_child_memory_mb", None)
    if set(payload) != set(ProbeResult.__dataclass_fields__):
        raise ParameterGapError("source probe result is invalid")
    candidate_id = payload.get("candidate_id")
    if not isinstance(candidate_id, str) or not _CANDIDATE_ID.fullmatch(candidate_id):
        raise ParameterGapError("source probe result is invalid")
    for key in ("gap_kinds", "typed_rule_ids"):
        value = payload.get(key)
        if not isinstance(value, list):
            raise ParameterGapError("source probe result is invalid")
        payload[key] = tuple(value)
    try:
        return ProbeResult(**payload)
    except TypeError as exc:
        raise ParameterGapError("source probe result is invalid") from exc


def _resume_summaries(
    results: tuple[ProbeResult, ...], source_report: dict[str, Any]
) -> tuple[KnobGapSummary, ...]:
    summaries = []
    offset = 0
    for source in source_report["knobs"]:
        count = source["candidate_count"]
        summaries.append(
            summarize_knob(
                OptimizationKnob(source["knob_id"]),
                results[offset : offset + count],
                lattice_complete=source["lattice_complete"],
            )
        )
        offset += count
    return tuple(summaries)


def _has_resumable_workspace(workspace: Path, source_probe: Path) -> bool:
    try:
        candidate_ref = _candidate_root_ref_from_path(
            source_probe / "candidate-evidence.v1.json"
        )
        candidate = (workspace / candidate_ref).resolve()
        candidate.relative_to(workspace.resolve())
    except (OSError, ParameterGapError, ValueError):
        return False
    return (
        candidate.is_dir()
        and not candidate.is_symlink()
        and (candidate / "analysis/candidate_materialization.v1.json").is_file()
    )


def _source_parent_ref(source_probe: Path) -> str | None:
    value = _read_json_object(source_probe / "candidate-request.v1.json").get(
        "parent_candidate_root_ref"
    )
    if value is None:
        return None
    parts = Path(value).parts if isinstance(value, str) else ()
    if (
        len(parts) != 3
        or parts[:2] != (".agent", "candidates")
        or not _CANDIDATE_ID.fullmatch(parts[2])
    ):
        raise ParameterGapError("source parent candidate ref is invalid")
    return value


def _candidate_sequence(candidate_id: str) -> int:
    match = re.search(r"-(\d{3})$", candidate_id)
    if match is None:
        raise ParameterGapError("source candidate sequence is invalid")
    return int(match.group(1))


def _read_observation(run_root: Path, candidate_id: str) -> TerminalObservation:
    path = run_root / "probes" / candidate_id / "terminal-observation.v1.json"
    if path.is_symlink():
        raise ParameterGapError("routability parent observation is unavailable")
    try:
        return TerminalObservation.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ParameterGapError("routability parent observation is unavailable") from exc


def _read_candidate_root_ref(run_root: Path, candidate_id: str) -> str:
    return _candidate_root_ref_from_path(
        run_root / "probes" / candidate_id / "candidate-evidence.v1.json"
    )


def _candidate_root_ref_from_path(path: Path) -> str:
    value = _read_json_object(path).get("candidate_root_ref")
    parts = Path(value).parts if isinstance(value, str) else ()
    if (
        len(parts) != 3
        or parts[:2] != (".agent", "candidates")
        or not _CANDIDATE_ID.fullmatch(parts[2])
    ):
        raise ParameterGapError("candidate parent evidence is invalid")
    return value
