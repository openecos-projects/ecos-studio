"""Run the frozen Phase 8 accounting harness from external JSON artifacts."""

from __future__ import annotations

import argparse
import json
from dataclasses import fields
from pathlib import Path

from ecos_agent.hashing import canonical_sha256
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
    return validate_design_manifest(values)


def _load_traces(path: Path | None, design_ids: tuple[str, ...]) -> list[CandidateTrace]:
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
        if payload.get("design_id") not in design_ids:
            raise ValueError("trace design_id is outside the frozen manifest")
        traces.append(CandidateTrace(**payload))
    return traces


def _requested_only(trace: CandidateTrace) -> CandidateTrace:
    """Erase receipt-derived fields to make the information boundary explicit."""
    return CandidateTrace(
        design_id=trace.design_id,
        candidate_id=trace.candidate_id,
        started=trace.started,
        terminal_success=trace.terminal_success,
        terminal_utility=trace.terminal_utility,
        reference_utility=trace.reference_utility,
        ppa=trace.ppa,
        drc=trace.drc,
        timing=trace.timing,
        congestion=trace.congestion,
        requested_value=trace.requested_value,
        runtime_seconds=trace.runtime_seconds,
        peak_memory_mb=trace.peak_memory_mb,
    )


def run(manifest_path: Path, output: Path, traces_path: Path | None, planning_calls: int) -> dict:
    design_ids = _load_design_manifest(manifest_path)
    traces = _load_traces(traces_path, design_ids)
    config = EqualBudgetConfig()
    requested = evaluate_equal_budget(
        [_requested_only(item) for item in traces],
        mode="requested-only",
        config=config,
        planning_calls=planning_calls,
    )
    receipt = evaluate_equal_budget(
        traces,
        mode="receipt-aware",
        config=config,
        planning_calls=planning_calls,
    )
    output.mkdir(parents=True, exist_ok=True)
    raw = output / "raw-trace.jsonl"
    raw.write_text(
        "".join(json.dumps(item.__dict__, sort_keys=True) + "\n" for item in traces),
        encoding="utf-8",
    )
    payload = {
        "schema_version": "ecos.optimization_equal_budget_harness.v1",
        "status": "completed" if any(item.started for item in traces) else "not_run",
        "design_manifest_ref": str(manifest_path),
        "design_manifest_sha256": canonical_sha256({"design_ids": list(design_ids)}),
        "design_ids": list(design_ids),
        "trace_count": len(traces),
        "planning_calls": planning_calls,
        "candidate_budget": config.candidate_limit,
        "wall_time_limit_seconds": config.wall_time_limit_seconds,
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
    parser.add_argument("--traces", type=Path)
    parser.add_argument("--planning-calls", type=int, default=0)
    args = parser.parse_args()
    run(args.design_manifest, args.output, args.traces, args.planning_calls)


if __name__ == "__main__":
    main()
