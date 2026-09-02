"""Resume an interrupted RQ1 parameter-gap run from existing candidates."""

from __future__ import annotations

import concurrent.futures
import fcntl
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
from ecos_agent.optimization.experiments.gate0 import (
    PilotCandidateExecutionError,
    run_pilot_candidate,
)
from ecos_agent.optimization.experiments.parameter_gap import (
    ProbeResult,
)
from ecos_agent.optimization.experiments.parameter_gap_artifacts import (
    build_report,
    timestamp,
    write_json,
    write_outputs,
)
from ecos_agent.optimization.experiments.parameter_gap_setup import (
    ParameterGapConfig,
    ParameterGapError,
    ParameterGapResumeConfig,
    load_parameter_gap_config,
    load_parameter_gap_resume_config,
    resume_readiness_report,
)
from ecos_agent.optimization.experiments.parameter_gap_resume_artifacts import (
    _archive_failed_probe_output,
    _completed_resume_result,
    _copy_completed_probes,
    _has_resumable_workspace,
    _import_previous_resume,
    _load_source_results,
    _read_candidate_root_ref,
    _read_json_object,
    _read_observation,
    _resume_manifest,
    _resume_summaries,
    _source_parent_ref,
    _validate_resume_source,
    _verify_imported_resume,
    _verify_resume_preservation,
)


def resume_parameter_gap(
    config_path: Path,
    resume_config_path: Path,
    results_root: Path,
    *,
    candidate_id: str | None = None,
) -> dict[str, Any]:
    config_path = Path(config_path).resolve()
    resume_config_path = Path(resume_config_path).resolve()
    config = load_parameter_gap_config(config_path)
    resume = load_parameter_gap_resume_config(resume_config_path)
    readiness = resume_readiness_report(config_path, resume_config_path)
    run_root = Path(results_root).resolve() / resume.source_run_id
    resume_root = run_root / "resumes" / resume.resume_id
    if not run_root.is_dir():
        raise ParameterGapError("parameter gap resume directory state is invalid")
    source_report = _read_json_object(run_root / "gcd-gap-report.v1.json")
    _validate_resume_source(source_report, resume, run_root)
    source_results = _load_source_results(run_root, source_report["candidate_count"])
    with _exclusive_resume_lock(resume_root):
        return _resume_parameter_gap_locked(
            config,
            resume,
            readiness,
            run_root,
            resume_root,
            source_report,
            source_results,
            candidate_id,
        )


def _resume_parameter_gap_locked(
    config: ParameterGapConfig,
    resume: ParameterGapResumeConfig,
    readiness: dict[str, Any],
    run_root: Path,
    resume_root: Path,
    source_report: dict[str, Any],
    source_results: tuple[ProbeResult, ...],
    candidate_id: str | None,
) -> dict[str, Any]:
    started_at = _prepare_resume_root(
        resume_root,
        resume,
        readiness,
        run_root,
        source_report,
        frozenset(item.candidate_id for item in source_results),
    )
    try:
        report = _run_resume_candidates(
            config,
            readiness,
            run_root,
            resume_root,
            source_report,
            source_results,
            started_at,
            candidate_id,
            resume.max_workers,
        )
        manifest = _read_json_object(resume_root / "resume-manifest.v1.json")
        preservation = _verify_resume_preservation(run_root, manifest)
        _verify_imported_resume(
            resume_root,
            manifest.get("previous_resume"),
            required=manifest.get("previous_resume_id") is not None,
        )
        result_path = (
            resume_root / "resume-progress.v1.json"
            if candidate_id is not None
            else resume_root / "resume-result.v1.json"
        )
        write_json(
            result_path,
            {
                "completed_at": timestamp(),
                "candidate_id": candidate_id,
                "report_sha256": file_sha256(resume_root / "gcd-gap-report.v1.json"),
                **preservation,
                "terminal_closed_count": report["terminal_closed_count"],
                "verdict": report["verdict"],
            },
        )
        return report
    except Exception as exc:
        write_json(
            resume_root / "failure.v1.json",
            {"error_type": type(exc).__name__, "message": str(exc), "at": timestamp()},
        )
        raise


@contextmanager
def _exclusive_resume_lock(resume_root: Path) -> Iterator[None]:
    lock_path = resume_root.parent / f".{resume_root.name}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ParameterGapError("parameter gap resume is already running") from exc
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _run_resume_candidates(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    run_root: Path,
    resume_root: Path,
    source_report: dict[str, Any],
    source_results: tuple[ProbeResult, ...],
    started_at: str,
    candidate_id: str | None,
    max_workers: int,
) -> dict[str, Any]:
    baselines = tuple(
        TerminalObservation.model_validate(item)
        for item in source_report["baseline_observations"]
    )
    current = dict(source_report["current_values"])
    if candidate_id is not None and all(
        item.candidate_id != candidate_id for item in source_results
    ):
        raise ParameterGapError("selected resume candidate is unavailable")
    results = _resume_results(
        config,
        readiness,
        run_root,
        resume_root,
        baselines[0],
        current,
        source_results,
        source_report,
        candidate_id,
        max_workers=max_workers,
    )
    report = build_report(
        source_report["run_id"],
        started_at,
        readiness,
        baselines,
        current,
        results,
        _resume_summaries(results, source_report),
    )
    report.update(
        {
            "schema_version": "ecos.rq1_parameter_gap_resume_report.v1",
            "source_report_sha256": file_sha256(run_root / "gcd-gap-report.v1.json"),
            "resume_id": resume_root.name,
            "max_workers": max_workers,
        }
    )
    write_outputs(resume_root, report, results)
    return report


def _prepare_resume_root(
    resume_root: Path,
    resume: ParameterGapResumeConfig,
    readiness: dict[str, Any],
    run_root: Path,
    source_report: dict[str, Any],
    source_candidate_ids: frozenset[str],
) -> str:
    manifest_path = resume_root / "resume-manifest.v1.json"
    if resume_root.is_symlink():
        raise ParameterGapError("parameter gap resume directory is invalid")
    if not resume_root.exists():
        started_at = timestamp()
        resume_root.mkdir(parents=True)
        try:
            previous = _import_previous_resume(
                run_root,
                resume_root,
                resume,
                file_sha256(run_root / "gcd-gap-report.v1.json"),
                source_candidate_ids,
            )
            write_json(
                manifest_path,
                _resume_manifest(
                    resume, readiness, run_root, source_report, started_at, previous
                ),
            )
        except Exception:
            shutil.rmtree(resume_root)
            raise
        return started_at
    if (resume_root / "resume-result.v1.json").exists():
        raise ParameterGapError("parameter gap resume is already complete")
    manifest = _read_json_object(manifest_path)
    expected = {
        "source_run_id": resume.source_run_id,
        "resume_id": resume.resume_id,
        "reason": resume.reason,
        "max_workers": resume.max_workers,
        "previous_resume_id": resume.previous_resume_id,
        "expected_previous_manifest_sha256": (
            resume.expected_previous_manifest_sha256
        ),
        "source_report_sha256": file_sha256(run_root / "gcd-gap-report.v1.json"),
    }
    manifest_readiness = manifest.get("readiness")
    if any(manifest.get(key) != value for key, value in expected.items()) or any(
        not isinstance(manifest_readiness, dict)
        or manifest_readiness.get(key) != readiness.get(key)
        for key in (
            "source_config_sha256",
            "resume_config_sha256",
            "ecos_revision",
            "ecc_revision",
            "ecc_executable_sha256",
            "pdk_revision",
        )
    ):
        raise ParameterGapError("parameter gap resume manifest binding is invalid")
    started_at = manifest.get("started_at")
    if not isinstance(started_at, str):
        raise ParameterGapError("parameter gap resume manifest is invalid")
    _verify_imported_resume(
        resume_root,
        manifest.get("previous_resume"),
        required=resume.previous_resume_id is not None,
    )
    return started_at


def _resume_results(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    run_root: Path,
    resume_root: Path,
    baseline: TerminalObservation,
    current: dict[str, bool | int | float],
    source_results: tuple[ProbeResult, ...],
    source_report: dict[str, Any],
    candidate_id: str | None,
    *,
    max_workers: int,
) -> tuple[ProbeResult, ...]:
    workspace = run_root / "baseline-1" / "workspace"
    resumed: list[ProbeResult] = []
    offset = 0
    for knob_payload in source_report["knobs"]:
        knob = OptimizationKnob(knob_payload["knob_id"])
        count = knob_payload["candidate_count"]
        selected = source_results[offset : offset + count]

        def resume_one(result: ProbeResult) -> ProbeResult:
            return _resume_or_preserve_probe(
                config,
                readiness,
                workspace,
                baseline,
                current[knob.value],
                knob,
                result,
                run_root,
                resume_root,
                resumed,
                candidate_id,
            )

        if knob == OptimizationKnob.ROUTABILITY_OPT:
            for result in selected:
                resumed.append(resume_one(result))
            offset += count
            continue
        if max_workers == 1 or candidate_id is not None:
            knob_results = tuple(resume_one(result) for result in selected)
        else:
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=max_workers
            ) as executor:
                knob_results = tuple(executor.map(resume_one, selected))
        resumed.extend(knob_results)
        offset += count
    if offset != len(source_results):
        raise ParameterGapError("source probe grouping is invalid")
    return tuple(resumed)


def _resume_or_preserve_probe(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    current: bool | int | float,
    knob: OptimizationKnob,
    result: ProbeResult,
    run_root: Path,
    resume_root: Path,
    resumed: list[ProbeResult],
    selected_candidate_id: str | None,
) -> ProbeResult:
    completed = _completed_resume_result(resume_root, result.candidate_id)
    if completed is not None:
        return completed
    if selected_candidate_id is not None and result.candidate_id != selected_candidate_id:
        return result
    if result.terminal_closed:
        return result
    source_probe = run_root / "probes" / result.candidate_id
    if _has_resumable_workspace(workspace, source_probe):
        return _run_probe(
            config,
            readiness,
            workspace,
            baseline,
            knob,
            result.requested_value,
            current,
            result.candidate_id,
            resume_root,
            parent_ref=_source_parent_ref(source_probe),
            resume_existing=True,
        )
    if (
        knob == OptimizationKnob.ROUTABILITY_OPT
        and result.error
        and result.error.startswith("parent_unavailable:")
    ):
        parent = resumed[-1]
        return _run_probe(
            config,
            readiness,
            workspace,
            _read_observation(resume_root, parent.candidate_id),
            knob,
            result.requested_value,
            not current,
            result.candidate_id,
            resume_root,
            parent_ref=_read_candidate_root_ref(resume_root, parent.candidate_id),
            resume_existing=False,
        )
    return result


def _run_probe(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    knob: OptimizationKnob,
    value: bool | int | float,
    parent_value: bool | int | float,
    candidate_id: str,
    resume_root: Path,
    *,
    parent_ref: str | None,
    resume_existing: bool,
) -> ProbeResult:
    output = resume_root / "probes" / candidate_id
    output.parent.mkdir(exist_ok=True)
    _archive_failed_probe_output(resume_root, output, candidate_id)
    client = EccContentLengthRpcClient(
        Path(readiness["ecc_executable"]), response_timeout_seconds=30
    )
    started = time.monotonic()
    try:
        receipt, terminal_closed, error = _probe_evidence(
            client,
            config,
            readiness,
            workspace,
            baseline,
            knob,
            value,
            parent_value,
            candidate_id,
            output,
            parent_ref,
            resume_existing,
        )
    finally:
        client.close()
    result = ProbeResult.from_receipt(
        candidate_id=candidate_id,
        requested_value=value,
        receipt=receipt,
        terminal_closed=terminal_closed,
        runtime_seconds=time.monotonic() - started,
        error=error,
        site_width_dbu=readiness["site_width_dbu"],
    )
    write_json(output / "probe-result.v1.json", result.to_dict())
    return result


def _probe_evidence(
    client: EccContentLengthRpcClient,
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    knob: OptimizationKnob,
    value: bool | int | float,
    parent_value: bool | int | float,
    candidate_id: str,
    output: Path,
    parent_ref: str | None,
    resume_existing: bool,
) -> tuple[Any | None, bool, str | None]:
    try:
        workspace_id = client.open_workspace(workspace)
        run = run_pilot_candidate(
            client,
            workspace_id,
            workspace,
            readiness["site_width_dbu"],
            baseline,
            RequestedKnobValue(knob_id=knob, value=value),
            _direction(value, parent_value),
            candidate_id,
            output,
            readiness["source_config_sha256"],
            float(config.terminal_timeout_seconds),
            episode_id="rq1-gcd-gap",
            parent_candidate_root_ref=parent_ref,
            rationale_summary=(
                "Resume one preregistered RQ1 parameter-gap probe."
                if resume_existing
                else "Execute the missing preregistered RQ1 parameter-gap probe."
            ),
            resume_existing=resume_existing,
        )
        return (
            run.receipt.parameter_application_receipt,
            run.observation.eligible_for_incumbent,
            None,
        )
    except PilotCandidateExecutionError as exc:
        return exc.receipt.parameter_application_receipt, False, type(exc).__name__
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        output.mkdir(parents=True, exist_ok=True)
        write_json(output / "failure.v1.json", {"error": error})
        return None, False, error


def _direction(
    value: bool | int | float, current: bool | int | float
) -> StrategyDirection:
    if isinstance(value, bool):
        return StrategyDirection.ENABLE if value else StrategyDirection.DISABLE
    return StrategyDirection.INCREASE if value > current else StrategyDirection.DECREASE
