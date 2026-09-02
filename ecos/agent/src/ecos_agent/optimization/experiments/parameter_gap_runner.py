"""Run the preregistered eight-knob requested/effective/activation gap screen."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Sequence

from ecos_agent.optimization.contracts import (
    OptimizationKnob,
    RequestedKnobValue,
    StrategyDirection,
    TerminalObservation,
)
from ecos_agent.optimization.ecc.rpc_client import EccContentLengthRpcClient
from ecos_agent.optimization.experiments.gate0 import (
    PilotCandidateExecutionError,
    _run_canonical,
    run_pilot_candidate,
)
from ecos_agent.optimization.experiments.parameter_gap_artifacts import (
    build_report,
    peak_child_memory_mb,
    timestamp,
    write_json,
    write_outputs,
)
from ecos_agent.optimization.experiments.parameter_gap import (
    KnobGapSummary,
    ProbeResult,
    summarize_knob,
)
from ecos_agent.optimization.experiments.parameter_gap_resume import (
    _read_candidate_root_ref,
    resume_parameter_gap,
)
from ecos_agent.optimization.experiments.parameter_gap_setup import (
    ParameterGapConfig,
    ParameterGapError,
    load_parameter_gap_config,
    overall_verdict,
    readiness_report,
    resume_readiness_report,
    screen_values,
)
from ecos_agent.optimization.parameters.contracts import (
    ParameterApplicationReceipt,
    ParameterSemanticsCard,
)
from ecos_agent.optimization.parameters.semantics import load_parameter_cards
from ecos_agent.optimization.runtime import _current_values

_RUN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")


def run_parameter_gap(
    config_path: Path, results_root: Path, *, run_id: str
) -> dict[str, Any]:
    if not _RUN_ID.fullmatch(run_id):
        raise ParameterGapError("run id is invalid")
    config_path = Path(config_path).resolve()
    config = load_parameter_gap_config(config_path)
    readiness = readiness_report(config_path)
    run_root = Path(results_root).resolve() / run_id
    if run_root.exists():
        raise ParameterGapError("parameter gap run directory already exists")
    run_root.mkdir(parents=True)
    started_at = timestamp()
    write_json(
        run_root / "run-manifest.v1.json",
        {
            "schema_version": "ecos.rq1_parameter_gap_run.v1",
            "run_id": run_id,
            "started_at": started_at,
            "seed": config.seed,
            "max_workers": config.max_workers,
            "baseline_replays": config.baseline_replays,
            "terminal_timeout_seconds": config.terminal_timeout_seconds,
            "readiness": readiness,
        },
    )
    try:
        baselines = _run_baselines(config_path, config, readiness, run_root)
        anchor_workspace = run_root / "baseline-1" / "workspace"
        current = _current_values(anchor_workspace, readiness["site_width_dbu"])
        results, summaries = _run_knobs(
            config, readiness, anchor_workspace, baselines[0], current, run_root
        )
        report = build_report(
            run_id, started_at, readiness, baselines, current, results, summaries
        )
        write_outputs(run_root, report, results)
        return report
    except Exception as exc:
        write_json(
            run_root / "failure.v1.json",
            {"error_type": type(exc).__name__, "message": str(exc), "at": timestamp()},
        )
        raise


def _run_baselines(
    config_path: Path,
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    run_root: Path,
) -> tuple[TerminalObservation, ...]:
    observations = []
    for index in range(1, config.baseline_replays + 1):
        output = run_root / f"baseline-{index}"
        output.mkdir()
        client = EccContentLengthRpcClient(
            Path(readiness["ecc_executable"]), response_timeout_seconds=30
        )
        try:
            result = _run_canonical(
                config_path, config, config.design, output / "workspace", output, client, readiness
            )
        finally:
            client.close()
        observation = result["observation"]
        if not isinstance(observation, TerminalObservation):
            raise ParameterGapError("canonical observation is invalid")
        observations.append(observation)
    return tuple(observations)


def _run_knobs(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    current: dict[str, bool | int | float],
    run_root: Path,
) -> tuple[tuple[ProbeResult, ...], tuple[KnobGapSummary, ...]]:
    cards = load_parameter_cards()
    all_results: list[ProbeResult] = []
    summaries: list[KnobGapSummary] = []
    sequence = 0
    for knob in OptimizationKnob:
        knob_results, summary, sequence = _run_knob(
            config,
            readiness,
            workspace,
            baseline,
            knob,
            cards[knob],
            current[knob.value],
            sequence,
            run_root,
        )
        all_results.extend(knob_results)
        summaries.append(summary)
    return tuple(all_results), tuple(summaries)


def _run_knob(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    knob: OptimizationKnob,
    card: ParameterSemanticsCard,
    current: bool | int | float,
    sequence: int,
    run_root: Path,
) -> tuple[list[ProbeResult], KnobGapSummary, int]:
    results, tested, sequence = _screen_knob(
        config, readiness, workspace, baseline, knob, card, current, sequence, run_root
    )
    if summarize_knob(knob, results).verdict != "gap_confirmed":
        sequence = _expand_knob(
            config,
            readiness,
            workspace,
            baseline,
            knob,
            card,
            current,
            results,
            tested,
            sequence,
            run_root,
        )
    required = set(card.requested_domain.values) - {current}
    if knob == OptimizationKnob.ROUTABILITY_OPT:
        required.add(current)
    summary = summarize_knob(knob, results, lattice_complete=required <= tested)
    return results, summary, sequence


def _screen_knob(
    config: ParameterGapConfig, readiness: dict[str, Any], workspace: Path,
    baseline: TerminalObservation, knob: OptimizationKnob,
    card: ParameterSemanticsCard, current: bool | int | float,
    sequence: int, run_root: Path,
) -> tuple[list[ProbeResult], set[bool | int | float], int]:
    results: list[ProbeResult] = []
    tested: set[bool | int | float] = set()
    values = list(screen_values(card, current))
    if knob == OptimizationKnob.ROUTABILITY_OPT:
        values.append(current)
    for value in values:
        sequence += 1
        try:
            observation, parent, parent_value = _probe_parent(
                run_root, results, value, current, baseline
            )
        except ParameterGapError as exc:
            results.append(
                _record_unavailable_parent(knob, value, sequence, run_root, str(exc))
            )
            tested.add(value)
            continue
        result = _execute_probe(
            config, readiness, workspace, observation, knob, value, parent_value,
            sequence, run_root,
            parent_candidate_root_ref=(
                _read_candidate_root_ref(run_root, parent) if parent else None
            ),
        )
        results.append(result)
        tested.add(value)
        sequence = _repeat_gap(
            config, readiness, workspace, observation, knob, value, parent_value,
            result, results, sequence, run_root, parent,
        )
    return results, tested, sequence


def _probe_parent(
    run_root: Path,
    results: list[ProbeResult],
    value: bool | int | float,
    current: bool | int | float,
    baseline: TerminalObservation,
) -> tuple[TerminalObservation, str | None, bool | int | float]:
    parent = results[0].candidate_id if value == current else None
    if parent is None:
        return baseline, None, current
    return _read_observation(run_root, parent), parent, not current


def _expand_knob(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    knob: OptimizationKnob,
    card: ParameterSemanticsCard,
    current: bool | int | float,
    results: list[ProbeResult],
    tested: set[bool | int | float],
    sequence: int,
    run_root: Path,
) -> int:
    remaining = tuple(
        value for value in card.requested_domain.values
        if value != current and value not in tested
    )
    for value in remaining:
        sequence += 1
        result = _execute_probe(
            config,
            readiness,
            workspace,
            baseline,
            knob,
            value,
            current,
            sequence,
            run_root,
        )
        results.append(result)
        tested.add(value)
        sequence = _repeat_gap(
            config,
            readiness,
            workspace,
            baseline,
            knob,
            value,
            current,
            result,
            results,
            sequence,
            run_root,
            None,
        )
        if summarize_knob(knob, results).verdict == "gap_confirmed":
            break
    return sequence


def _repeat_gap(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    knob: OptimizationKnob,
    value: bool | int | float,
    parent_value: bool | int | float,
    first: ProbeResult,
    results: list[ProbeResult],
    sequence: int,
    run_root: Path,
    parent: str | None,
) -> int:
    if not set(first.gap_kinds) - {"mapping_only"}:
        return sequence
    for _ in range(2):
        sequence += 1
        results.append(
            _execute_probe(
                config,
                readiness,
                workspace,
                baseline,
                knob,
                value,
                parent_value,
                sequence,
                run_root,
                parent_candidate_root_ref=(
                    _read_candidate_root_ref(run_root, parent) if parent else None
                ),
            )
        )
    return sequence


def _execute_probe(
    config: ParameterGapConfig,
    readiness: dict[str, Any],
    workspace: Path,
    baseline: TerminalObservation,
    knob: OptimizationKnob,
    value: bool | int | float,
    parent_value: bool | int | float,
    sequence: int,
    run_root: Path,
    *,
    parent_candidate_root_ref: str | None = None,
) -> ProbeResult:
    candidate_id = f"rq1-{knob.value.replace('.', '-')}-{sequence:03d}"
    output = run_root / "probes" / candidate_id
    output.parent.mkdir(exist_ok=True)
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
            parent_candidate_root_ref,
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
    payload = {**result.to_dict(), "peak_child_memory_mb": peak_child_memory_mb()}
    write_json(output / "probe-result.v1.json", payload)
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
    parent_candidate_root_ref: str | None,
) -> tuple[ParameterApplicationReceipt | None, bool, str | None]:
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
            readiness["config_sha256"],
            float(config.terminal_timeout_seconds),
            episode_id="rq1-gcd-gap",
            parent_candidate_root_ref=parent_candidate_root_ref,
            rationale_summary="Execute one preregistered RQ1 parameter-gap probe.",
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
        output.mkdir(exist_ok=True)
        write_json(output / "failure.v1.json", {"error": error})
        return None, False, error


def _direction(
    value: bool | int | float, current: bool | int | float
) -> StrategyDirection:
    if isinstance(value, bool):
        return StrategyDirection.ENABLE if value else StrategyDirection.DISABLE
    return StrategyDirection.INCREASE if value > current else StrategyDirection.DECREASE


def _record_unavailable_parent(
    knob: OptimizationKnob,
    value: bool | int | float,
    sequence: int,
    run_root: Path,
    error: str,
) -> ProbeResult:
    candidate_id = f"rq1-{knob.value.replace('.', '-')}-{sequence:03d}"
    result = ProbeResult.from_receipt(
        candidate_id=candidate_id,
        requested_value=value,
        receipt=None,
        terminal_closed=False,
        runtime_seconds=0.0,
        error=f"parent_unavailable: {error}",
        site_width_dbu=1,
    )
    output = run_root / "probes" / candidate_id
    write_json(output / "probe-result.v1.json", result.to_dict())
    return result


def _read_observation(run_root: Path, candidate_id: str) -> TerminalObservation:
    path = run_root / "probes" / candidate_id / "terminal-observation.v1.json"
    try:
        return TerminalObservation.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ParameterGapError("routability parent observation is unavailable") from exc


def main(argv: Sequence[str] | None = None) -> int:
    agent_root = Path(__file__).resolve().parents[4]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config", type=Path, default=agent_root / "experiments/rq1/gcd-gap-config.v1.json"
    )
    parser.add_argument(
        "--results-root", type=Path, default=agent_root / "experiments/rq1/runs"
    )
    parser.add_argument("--resume-config", type=Path)
    parser.add_argument("--resume-candidate")
    parser.add_argument("--run-id", default=time.strftime("gcd-gap-%Y%m%dT%H%M%S", time.gmtime()))
    parser.add_argument("--readiness-only", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.resume_config is not None:
            result = (
                resume_readiness_report(args.config, args.resume_config)
                if args.readiness_only
                else resume_parameter_gap(
                    args.config,
                    args.resume_config,
                    args.results_root,
                    candidate_id=args.resume_candidate,
                )
            )
        else:
            result = (
                readiness_report(args.config)
                if args.readiness_only
                else run_parameter_gap(args.config, args.results_root, run_id=args.run_id)
            )
    except ParameterGapError as exc:
        print(f"RQ1 parameter gap failed: {exc}", file=os.sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
