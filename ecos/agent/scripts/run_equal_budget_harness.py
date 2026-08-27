"""Run the frozen Phase 8 accounting harness from external JSON artifacts."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import fields
from pathlib import Path

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


_RECEIPT_FIELDS = {
    "application_status",
    "activation_status",
    "application_signature",
    "response_signature",
    "transition_status",
    "alias",
    "alias_valid",
    "stale_rule",
    "fail_closed",
    "receipt_status",
}


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
        if not receipt_aware and set(payload) & _RECEIPT_FIELDS:
            raise ValueError("requested-only trace contains receipt-derived fields")
        if receipt_aware and payload.get("started") is True and not set(payload) & _RECEIPT_FIELDS:
            raise ValueError("receipt-aware started trace lacks receipt-derived fields")
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
    reference_runtime_seconds: float = 1.0,
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
    config = EqualBudgetConfig(reference_runtime_seconds=reference_runtime_seconds)
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
    required_designs = set(design_ids)
    complete = all(
        summary.started_candidates == config.candidate_limit
        and {item.design_id for item in traces if item.started} == required_designs
        for summary, traces in (
            (requested, requested_traces),
            (receipt, receipt_traces),
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
        "wall_time_limit_seconds": config.wall_time_limit_seconds,
        "reference_runtime_seconds": config.reference_runtime_seconds,
        "seed": seed,
        "tool_revision": tool_revision,
        "input_manifest_sha256": input_manifest_sha256,
        "requested_only_raw_trace_sha256": file_sha256(requested_raw),
        "receipt_aware_raw_trace_sha256": file_sha256(receipt_raw),
        "requested_only": requested.to_dict(),
        "receipt_aware": receipt.to_dict(),
        "metric_fields": ["simple_regret", "ppa", "drc", "timing", "congestion"],
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--design-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--requested-only-traces", type=Path)
    parser.add_argument("--receipt-aware-traces", type=Path)
    parser.add_argument("--requested-only-planning-calls", type=int, default=0)
    parser.add_argument("--receipt-aware-planning-calls", type=int, default=0)
    parser.add_argument("--reference-runtime-seconds", type=float, default=1.0)
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
        reference_runtime_seconds=args.reference_runtime_seconds,
        seed=args.seed,
        tool_revision=args.tool_revision,
        input_manifest_sha256=args.input_manifest_sha256,
    )


if __name__ == "__main__":
    main()
