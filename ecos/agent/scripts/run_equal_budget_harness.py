"""Run the frozen Phase 8 accounting harness from external JSON artifacts."""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import fields
from pathlib import Path
from typing import Mapping

from ecos_agent.hashing import canonical_sha256, file_sha256
from ecos_agent.optimization_equal_budget import (
    CandidateTrace,
    EqualBudgetConfig,
    EqualBudgetSummary,
    evaluate_equal_budget,
    validate_design_manifest,
)


def _load_design_manifest(path: Path) -> tuple[str, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    values = payload.get("design_ids") if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        raise ValueError("design manifest must contain design_ids")
    if isinstance(payload, dict) and payload.get("manifest_sha256") is not None:
        expected = canonical_sha256(
            {key: value for key, value in payload.items() if key != "manifest_sha256"}
        )
        if payload["manifest_sha256"] != expected:
            raise ValueError("design manifest hash does not match")
    return validate_design_manifest(values)


def _load_traces(
    path: Path | None, design_ids: tuple[str, ...], *, receipt_aware: bool
) -> list[CandidateTrace]:
    if path is None:
        return []
    allowed = {field.name for field in fields(CandidateTrace)}
    traces: list[CandidateTrace] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict) or set(payload) - allowed:
            raise ValueError("trace contains unknown fields")
        expected_mode = "receipt-aware" if receipt_aware else "requested-only"
        if payload.get("planning_mode") != expected_mode:
            raise ValueError("trace planning mode does not match its evaluation lane")
        if payload.get("started") is True and not payload.get("receipt_status"):
            raise ValueError("started trace lacks receipt measurement")
        if payload.get("design_id") not in design_ids:
            raise ValueError("trace design_id is outside the frozen manifest")
        traces.append(CandidateTrace(**payload))
    return traces


def run(
    manifest_path: Path,
    output: Path,
    requested_only_traces_path: Path | None,
    receipt_aware_traces_path: Path | None,
    requested_only_planning_calls: int,
    receipt_aware_planning_calls: int,
    *,
    reference_runtime_seconds_by_design: Mapping[str, float] | None = None,
    elapsed_wall_time_seconds_by_mode: Mapping[str, Mapping[str, float]] | None = None,
    functional_smoke_design_ids: tuple[str, ...] | None = None,
    seed: int | None = None,
    tool_revision: str | None = None,
    input_manifest_sha256: str | None = None,
) -> dict:
    design_ids = _load_design_manifest(manifest_path)
    requested_traces = _load_traces(
        requested_only_traces_path, design_ids, receipt_aware=False
    )
    receipt_traces = _load_traces(
        receipt_aware_traces_path, design_ids, receipt_aware=True
    )
    started = any(item.started for item in (*requested_traces, *receipt_traces))
    if input_manifest_sha256 is not None and not re.fullmatch(
        r"sha256:[0-9a-f]{64}", input_manifest_sha256
    ):
        raise ValueError("input manifest hash is invalid")
    if seed is not None and type(seed) is not int:
        raise ValueError("seed is invalid")
    if started and (seed is None or not tool_revision or not input_manifest_sha256):
        raise ValueError(
            "started traces require reproducibility metadata: seed, tool revision, and input manifest hash"
        )
    requested_designs = {item.design_id for item in requested_traces if item.started}
    receipt_designs = {item.design_id for item in receipt_traces if item.started}
    observed_designs = requested_designs | receipt_designs
    runtime_designs = tuple(item for item in design_ids if item in observed_designs)
    if reference_runtime_seconds_by_design is not None and not set(
        reference_runtime_seconds_by_design
    ).issubset(design_ids):
        raise ValueError("per-design reference runtimes contain unknown designs")
    selected_runtimes = (
        {
            design_id: reference_runtime_seconds_by_design[design_id]
            for design_id in runtime_designs
            if design_id in reference_runtime_seconds_by_design
        }
        if reference_runtime_seconds_by_design is not None
        else None
    )
    runtimes = _reference_runtimes(
        selected_runtimes,
        runtime_designs if started else design_ids,
        required=started,
    )
    config = EqualBudgetConfig(reference_runtime_seconds=sum(runtimes.values()))
    requested_ids = {item.candidate_id for item in requested_traces if item.started}
    receipt_ids = {item.candidate_id for item in receipt_traces if item.started}
    if started and (
        requested_only_traces_path == receipt_aware_traces_path
        or requested_ids & receipt_ids
    ):
        raise ValueError("equal-budget modes require independent candidate executions")
    requested = evaluate_equal_budget(
        requested_traces,
        mode="requested-only",
        config=config,
        planning_calls=requested_only_planning_calls,
    )
    receipt = evaluate_equal_budget(
        receipt_traces,
        mode="receipt-aware",
        config=config,
        planning_calls=receipt_aware_planning_calls,
    )
    output.mkdir(parents=True, exist_ok=True)
    requested_raw = output / "requested-only-raw-trace.jsonl"
    receipt_raw = output / "receipt-aware-raw-trace.jsonl"
    requested_raw.write_text(
        "".join(json.dumps(item.__dict__, sort_keys=True) + "\n" for item in requested_traces),
        encoding="utf-8",
    )
    receipt_raw.write_text(
        "".join(json.dumps(item.__dict__, sort_keys=True) + "\n" for item in receipt_traces),
        encoding="utf-8",
    )
    runtime_by_mode = {
        "requested_only": _runtime_by_design(requested_traces, runtime_designs),
        "receipt_aware": _runtime_by_design(receipt_traces, runtime_designs),
    }
    elapsed = _elapsed_wall_times(
        elapsed_wall_time_seconds_by_mode, runtime_designs, required=started
    )
    wall_limits = {design_id: 22.0 * runtimes[design_id] for design_id in runtime_designs}
    elapsed_within_budget = all(
        elapsed[mode][design_id] <= wall_limits[design_id]
        for mode in ("requested_only", "receipt_aware")
        for design_id in runtime_designs
    )
    complete = all(
        summary.started_candidates == config.candidate_limit
        and {
            design_id: sum(item.started and item.design_id == design_id for item in traces)
            for design_id in design_ids
        }
        == {design_id: 2 for design_id in design_ids}
        and all(
            runtime_by_mode[mode][design_id] <= wall_limits[design_id]
            for design_id in design_ids
        )
        for mode, summary, traces in (
            ("requested_only", requested, requested_traces),
            ("receipt_aware", receipt, receipt_traces),
        )
    ) and elapsed_within_budget
    smoke_ids = _functional_smoke_ids(functional_smoke_design_ids, design_ids)
    smoke_planning_calls = 2 * len(smoke_ids)
    smoke_complete = (
        bool(smoke_ids)
        and requested_only_planning_calls == smoke_planning_calls
        and receipt_aware_planning_calls == smoke_planning_calls
        and all(
            _functional_smoke_mode_complete(summary, traces, smoke_ids)
            for summary, traces in (
                (requested, requested_traces),
                (receipt, receipt_traces),
            )
        )
        and requested_designs == receipt_designs == set(smoke_ids)
        and elapsed_within_budget
    )
    research_status = "completed" if complete else "incomplete" if started else "not_run"
    engineering_status = (
        "completed" if complete or smoke_complete else "incomplete" if started else "not_run"
    )
    payload = {
        "schema_version": "ecos.optimization_equal_budget_harness.v1",
        "status": research_status,
        "engineering_status": engineering_status,
        "engineering_classification": (
            "Engineering Complete"
            if engineering_status == "completed"
            else "Engineering Incomplete"
        ),
        "research_evaluation_status": research_status,
        "research_claim": "not_assessed",
        "research_classification": "Research Claim Not Assessed",
        "ignored_knobs": ["place.routability_opt"],
        "design_manifest_ref": str(manifest_path),
        "design_manifest_sha256": file_sha256(manifest_path),
        "design_ids": list(design_ids),
        "design_coverage": {
            "required": list(design_ids),
            "observed": [item for item in design_ids if item in observed_designs],
            "missing": [item for item in design_ids if item not in observed_designs],
        },
        "functional_smoke_design_ids": list(smoke_ids),
        "trace_count": {
            "requested_only": len(requested_traces),
            "receipt_aware": len(receipt_traces),
        },
        "planning_calls": {
            "requested_only": requested_only_planning_calls,
            "receipt_aware": receipt_aware_planning_calls,
        },
        "candidate_budget": config.candidate_limit,
        "wall_time_limit_seconds_by_design": wall_limits,
        "reference_runtime_seconds_by_design": runtimes,
        "runtime_seconds_by_design": runtime_by_mode,
        "elapsed_wall_time_seconds_by_mode": elapsed,
        "seed": seed,
        "tool_revision": tool_revision,
        "input_manifest_sha256": input_manifest_sha256,
        "requested_only_raw_trace_sha256": file_sha256(requested_raw),
        "receipt_aware_raw_trace_sha256": file_sha256(receipt_raw),
        "requested_only": requested.to_dict(),
        "receipt_aware": receipt.to_dict(),
        "metric_fields": [
            "simple_regret",
            "area",
            "dynamic_power",
            "leakage_power",
            "frequency",
            "drc",
            "timing",
            "congestion",
        ],
    }
    (output / "requested-only-report.v1.json").write_text(
        json.dumps(requested.to_dict(), sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    (output / "receipt-aware-report.v1.json").write_text(
        json.dumps(receipt.to_dict(), sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    (output / "aggregate-report.v1.json").write_text(
        json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    return payload


def _reference_runtimes(
    values: Mapping[str, float] | None,
    design_ids: tuple[str, ...],
    *,
    required: bool,
) -> dict[str, float]:
    if values is None:
        if required:
            raise ValueError("started traces require per-design reference runtimes")
        return {design_id: 1.0 for design_id in design_ids}
    if set(values) != set(design_ids) or any(
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(value)
        or value <= 0
        for value in values.values()
    ):
        raise ValueError("per-design reference runtimes are invalid")
    return {design_id: float(values[design_id]) for design_id in design_ids}


def _elapsed_wall_times(
    values: Mapping[str, Mapping[str, float]] | None,
    design_ids: tuple[str, ...],
    *,
    required: bool,
) -> dict[str, dict[str, float]]:
    modes = ("requested_only", "receipt_aware")
    if values is None:
        if required:
            raise ValueError("started traces require per-design episode elapsed wall time")
        return {mode: {design_id: 0.0 for design_id in design_ids} for mode in modes}
    if set(values) != set(modes):
        raise ValueError("episode elapsed wall time modes are invalid")
    result = {}
    for mode in modes:
        rows = values[mode]
        if set(rows) != set(design_ids) or any(
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
            or value < 0
            for value in rows.values()
        ):
            raise ValueError("per-design episode elapsed wall time is invalid")
        result[mode] = {design_id: float(rows[design_id]) for design_id in design_ids}
    return result


def _functional_smoke_ids(
    values: tuple[str, ...] | None, design_ids: tuple[str, ...]
) -> tuple[str, ...]:
    if values is None:
        return ()
    if not values or len(set(values)) != len(values) or any(item not in design_ids for item in values):
        raise ValueError("functional smoke design ids are invalid")
    ordered = tuple(item for item in design_ids if item in values)
    if ordered != values:
        raise ValueError("functional smoke design ids must follow the frozen manifest")
    return values


def _functional_smoke_mode_complete(
    summary: EqualBudgetSummary,
    traces: list[CandidateTrace],
    design_ids: tuple[str, ...],
) -> bool:
    expected = 2 * len(design_ids)
    return (
        len(traces) == expected
        and summary.started_candidates == expected
        and all(
            item.started
            and item.terminal_success
            and item.receipt_status == "ok"
            and item.application_status == "applied"
            and item.activation_status == "used"
            for item in traces
        )
        and {
            design_id: sum(item.design_id == design_id for item in traces)
            for design_id in design_ids
        }
        == {design_id: 2 for design_id in design_ids}
    )


def _runtime_by_design(
    traces: list[CandidateTrace], design_ids: tuple[str, ...]
) -> dict[str, float]:
    return {
        design_id: sum(
            item.runtime_seconds
            for item in traces
            if item.started and item.design_id == design_id
        )
        for design_id in design_ids
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--design-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--requested-only-traces", type=Path)
    parser.add_argument("--receipt-aware-traces", type=Path)
    parser.add_argument("--requested-only-planning-calls", type=int, default=0)
    parser.add_argument("--receipt-aware-planning-calls", type=int, default=0)
    parser.add_argument("--reference-runtime-seconds-by-design", type=Path)
    parser.add_argument("--elapsed-wall-time-seconds-by-mode", type=Path)
    parser.add_argument("--functional-smoke-design-ids", nargs="*")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--tool-revision")
    parser.add_argument("--input-manifest-sha256")
    args = parser.parse_args()
    run(
        args.design_manifest,
        args.output,
        args.requested_only_traces,
        args.receipt_aware_traces,
        args.requested_only_planning_calls,
        args.receipt_aware_planning_calls,
        reference_runtime_seconds_by_design=(
            json.loads(args.reference_runtime_seconds_by_design.read_text(encoding="utf-8"))
            if args.reference_runtime_seconds_by_design is not None
            else None
        ),
        elapsed_wall_time_seconds_by_mode=(
            json.loads(args.elapsed_wall_time_seconds_by_mode.read_text(encoding="utf-8"))
            if args.elapsed_wall_time_seconds_by_mode is not None
            else None
        ),
        functional_smoke_design_ids=(
            tuple(args.functional_smoke_design_ids)
            if args.functional_smoke_design_ids
            else None
        ),
        seed=args.seed,
        tool_revision=args.tool_revision,
        input_manifest_sha256=args.input_manifest_sha256,
    )


if __name__ == "__main__":
    main()
