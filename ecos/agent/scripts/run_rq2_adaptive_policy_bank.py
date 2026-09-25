#!/usr/bin/env python3
"""Run the formal RQ2 adaptive frozen-context behavior bank (sharded workers).

Each worker owns a disjoint, deterministic shard of context groups (all four
treatments of a context stay in one worker so matched comparisons never split
across processes) and appends part files; ``--merge`` later consolidates the
parts into the versioned bank outputs.  Provider errors, schema failures and
timeouts stay in the denominator -- nothing is silently retried or dropped.
"""

import argparse
import json
import sys
from pathlib import Path

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.optimization.experiments.knowledge_treatments import (
    ZERO_SHOT_GATE_TREATMENTS,
)
from ecos_agent.optimization.experiments.rq2_adaptive_runner import (
    run_rq2_adaptive_bank,
)
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    AdaptiveConfig,
    RQ2_TREATMENTS,
)
from ecos_agent.optimization.experiments.runner_environment import (
    apply_runner_environment,
)


def _append_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def run_worker(args, config: AdaptiveConfig, worker_index: int, workers: int, treatments: list[str]) -> int:
    bank = json.loads(args.bank.read_text(encoding="utf-8"))
    contexts = sorted(
        (context for context in bank["contexts"] if context.get("eligibility") == "eligible"),
        key=lambda context: str(context["context_fingerprint"]),
    )
    shard = [
        context
        for index, context in enumerate(contexts)
        if index % workers == worker_index
    ]
    worker = f"{worker_index}/{workers}"

    def provider_factory():
        return CodexAppServerProposalProvider(
            cwd=Path.cwd(),
            env=dict(__import__("os").environ),
            diagnostics_path=None,
            ephemeral=True,
        )

    observations_root = args.output_root
    samples_part = observations_root / f"adaptive-policy-samples.part-w{worker_index}.jsonl"
    diagnostics_part = observations_root / f"diagnostics.part-w{worker_index}.jsonl"
    if samples_part.exists():
        samples_part.unlink()
    if diagnostics_part.exists():
        diagnostics_part.unlink()

    def on_group(group) -> None:
        design = group["rows"][0]["design"] if group["rows"] else "unknown"
        for treatment in treatments:
            rows = [row for row in group["rows"] if row["treatment"] == treatment]
            _append_jsonl(
                observations_root / design / treatment / f"observations.part-w{worker_index}.jsonl",
                rows,
            )
            _append_jsonl(
                observations_root / design / treatment / f"posterior.part-w{worker_index}.jsonl",
                [
                    posterior
                    for posterior in group["posteriors"]
                    if posterior["treatment"] == treatment
                ],
            )
        _append_jsonl(samples_part, group["samples"])
        _append_jsonl(
            diagnostics_part,
            [
                {
                    "context_fingerprint": group["context_fingerprint"],
                    "design": design,
                    "repeats_used": group["repeats_used"],
                    "treatment_diffs": group["treatment_diffs"],
                    "rows": len(group["rows"]),
                }
            ],
        )

    summary = run_rq2_adaptive_bank(
        shard,
        provider_factory=provider_factory,
        treatments=tuple(treatments),
        config=config,
        worker=worker,
        on_group=on_group,
    )
    (observations_root / f"worker-{worker_index}-of-{workers}.summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps({"worker": worker, **summary}, sort_keys=True))
    return 0


def merge(args) -> int:
    root = args.output_root
    designs = sorted(
        path.name
        for path in root.iterdir()
        if path.is_dir()
        and path.name not in {"logs"}
        and not path.name.startswith(("pilot", "g4-attempt1"))
    )
    reconciliation = {"schema_version": "ecos.rq2_offline_reconciliation.v1", "designs": {}}
    for design in designs:
        treatments = sorted(
            (path.name for path in (root / design).iterdir() if path.is_dir())
        ) if (root / design).is_dir() else []
        reconciliation["designs"][design] = {}
        for treatment in treatments:
            directory = root / design / treatment
            observation_parts = sorted(directory.glob("observations.part-w*.jsonl"))
            posterior_parts = sorted(directory.glob("posterior.part-w*.jsonl"))
            rows = []
            for part in observation_parts:
                rows.extend(
                    json.loads(line)
                    for line in part.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                )
            posteriors = []
            for part in posterior_parts:
                posteriors.extend(
                    json.loads(line)
                    for line in part.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                )
            (directory / "observations.v1.jsonl").write_text(
                "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
                encoding="utf-8",
            )
            (directory / "posterior.v1.json").write_text(
                json.dumps(posteriors, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            statuses: dict[str, int] = {}
            for row in rows:
                status = str(row.get("schema_status"))
                statuses[status] = statuses.get(status, 0) + 1
            reconciliation["designs"][design][treatment] = {
                "rows": len(rows),
                "cells": len(posteriors),
                "schema_status_counts": statuses,
            }
    samples_parts = sorted(root.glob("adaptive-policy-samples.part-w*.jsonl"))
    samples = []
    for part in samples_parts:
        samples.extend(
            json.loads(line)
            for line in part.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    (root / "adaptive-policy-samples.v1.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in samples),
        encoding="utf-8",
    )
    diagnostics_parts = sorted(root.glob("diagnostics.part-w*.jsonl"))
    diagnostics = []
    for part in diagnostics_parts:
        diagnostics.extend(
            json.loads(line)
            for line in part.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    (root / "diagnostics.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in diagnostics),
        encoding="utf-8",
    )
    (root / "reconciliation.v1.json").write_text(
        json.dumps(reconciliation, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(reconciliation, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument(
        "--treatments",
        default=",".join(RQ2_TREATMENTS),
        help="comma-separated treatment ids",
    )
    parser.add_argument("--model", default="glm-5.3-flash")
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--min-repeats", type=int, default=3)
    parser.add_argument("--max-repeats", type=int, default=7)
    parser.add_argument("--material-shift-threshold", type=float, default=0.20)
    parser.add_argument("--draws", type=int, default=4000)
    parser.add_argument(
        "--worker",
        default=None,
        help="shard spec i/N; omit with --merge to consolidate part files",
    )
    parser.add_argument("--merge", action="store_true")
    args = parser.parse_args()
    treatments = [item for item in args.treatments.split(",") if item]
    known = {config.treatment.value for config in ZERO_SHOT_GATE_TREATMENTS}
    if not treatments or any(item not in known for item in treatments):
        raise SystemExit(f"treatments must be drawn from {sorted(known)}")
    if args.merge:
        return merge(args)
    if not args.worker:
        parser.error("--worker i/N is required unless --merge")
    index, _, workers = args.worker.partition("/")
    if not index.isdigit() or not workers.isdigit() or int(workers) < 1:
        parser.error("--worker must look like i/N")
    if int(index) >= int(workers):
        parser.error("worker index must be smaller than the worker count")
    print("[runner-env]", apply_runner_environment(model=args.model), flush=True)
    levels = tuple(
        level
        for level in (3, 5, 7)
        if args.min_repeats <= level <= args.max_repeats
    )
    config = AdaptiveConfig(
        model=args.model,
        reasoning_effort=args.reasoning_effort,
        tau=args.material_shift_threshold,
        levels=levels or (3, 5, 7),
        draws=args.draws,
    )
    return run_worker(args, config, int(index), int(workers), treatments)


if __name__ == "__main__":
    sys.exit(main())
