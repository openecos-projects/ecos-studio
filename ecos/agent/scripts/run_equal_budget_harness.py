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
    runtimes = _reference_runtimes(
        reference_runtime_seconds_by_design, design_ids, required=started
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
        "requested_only": _runtime_by_design(requested_traces, design_ids),
        "receipt_aware": _runtime_by_design(receipt_traces, design_ids),
    }
    wall_limits = {design_id: 22.0 * runtimes[design_id] for design_id in design_ids}
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
    )
    payload = {
        "schema_version": "ecos.optimization_equal_budget_harness.v1",
        "status": "completed" if complete else "incomplete" if started else "not_run",
        "design_manifest_ref": str(manifest_path),
        "design_manifest_sha256": file_sha256(manifest_path),
        "design_ids": list(design_ids),
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
        seed=args.seed,
        tool_revision=args.tool_revision,
        input_manifest_sha256=args.input_manifest_sha256,
    )


if __name__ == "__main__":
    main()
