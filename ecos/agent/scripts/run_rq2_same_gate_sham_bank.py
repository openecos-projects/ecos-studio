#!/usr/bin/env python3
"""Prepare, run, and merge the RQ2 same-gate sham provider-only replication."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from ecos_agent.codex.provider import CodexAppServerProposalProvider
from ecos_agent.hashing import canonical_sha256
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    AdaptiveConfig,
    SAME_GATE_NO_SEMANTIC_GUIDANCE,
)
from ecos_agent.optimization.experiments.rq2_order_balanced_runner import (
    build_same_gate_sham_schedule,
    run_same_gate_sham_worker,
    validate_same_gate_sham_schedule,
)
from ecos_agent.optimization.experiments.runner_environment import apply_runner_environment


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _write_new(path: Path, payload: object) -> None:
    if path.exists():
        raise RuntimeError(f"refusing to overwrite versioned artifact: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def prepare(args: argparse.Namespace) -> int:
    bank = _read(args.bank)
    contexts = [
        context
        for context in bank["contexts"]
        if context.get("eligibility") == "eligible"
        and context.get("state_stratum") == "knowledge_opportunity"
    ]
    schedule = build_same_gate_sham_schedule(
        contexts, seed=args.seed, repeats=args.repeats, workers=args.workers
    )
    validate_same_gate_sham_schedule(schedule)
    subset = {
        "schema_version": "ecos.rq2_opportunity_context_bank.v1",
        "source_bank_sha256": _sha256(args.bank),
        "contexts": contexts,
    }
    subset["bank_sha256"] = canonical_sha256(subset)
    subset_path = args.output_root / "context-bank-opportunity.v1.json"
    _write_new(subset_path, subset)

    source_root = Path(__file__).resolve().parents[3]
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=source_root, text=True
    ).strip()
    manifest = {
        "schema_version": "ecos.rq2_same_gate_sham_preregistration.v1",
        "prepared_at": datetime.now(timezone.utc).isoformat(),
        "source_bank": str(args.bank),
        "source_bank_sha256": _sha256(args.bank),
        "opportunity_bank": str(subset_path),
        "opportunity_bank_sha256": _sha256(subset_path),
        "ecos_revision": revision,
        "model": args.model,
        "reasoning_effort": args.reasoning_effort,
        "provider_sampling_seed": "unavailable",
        "experiment_seed": args.seed,
        "repeats": args.repeats,
        "workers": args.workers,
        "contexts": len(contexts),
        "treatments": [
            "state-conditioned-dual-layer-zero-shot",
            SAME_GATE_NO_SEMANTIC_GUIDANCE,
        ],
        "provider_calls_registered": len(schedule["observations"]),
        "ecc_executions_registered": 0,
        "schedule": schedule,
        "analysis_protocol": {
            "primary": "paired Dual-vs-sham equal-weight matched-context L2 empirical TV",
            "inference": "within-context label permutation and design-block bootstrap CI",
            "role": "secondary mechanism-isolation diagnostic; not terminal utility evidence",
            "sham_contract": (
                "preserve state gate, legal action cardinality, knob/direction affordances, "
                "and effective domains; replace knowledge text, claim identities, bindings, "
                "and parameter cards with inert placeholders"
            ),
        },
    }
    manifest["manifest_sha256"] = canonical_sha256(manifest)
    _write_new(args.output_root / "preregistration.v1.json", manifest)
    print(json.dumps({
        "contexts": len(contexts),
        "provider_calls": len(schedule["observations"]),
        "ecc_executions": 0,
    }, sort_keys=True))
    return 0


def run_worker(args: argparse.Namespace) -> int:
    manifest = _read(args.output_root / "preregistration.v1.json")
    body = {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    if canonical_sha256(body) != manifest["manifest_sha256"]:
        raise RuntimeError("preregistration manifest hash mismatch")
    schedule = manifest["schedule"]
    validate_same_gate_sham_schedule(schedule)
    worker_index_text, _, workers_text = args.worker.partition("/")
    if not worker_index_text.isdigit() or not workers_text.isdigit():
        raise ValueError("--worker must look like i/N")
    worker_index, workers = int(worker_index_text), int(workers_text)
    if workers != int(manifest["workers"]):
        raise ValueError("worker count differs from preregistration")
    print("[runner-env]", apply_runner_environment(model=manifest["model"]), flush=True)

    bank = _read(Path(manifest["opportunity_bank"]))
    part_path = args.output_root / f"observations.part-w{worker_index}.jsonl"
    existing = [
        json.loads(line)
        for line in part_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ] if part_path.exists() else []
    completed_ids = [str(row["observation_id"]) for row in existing]
    if len(set(completed_ids)) != len(completed_ids):
        raise RuntimeError(f"duplicate observation ids in continuation part: {part_path}")
    planned_ids = {
        str(row["observation_id"])
        for row in schedule["observations"]
        if int(row["worker_index"]) == worker_index
    }
    unexpected = sorted(set(completed_ids) - planned_ids)
    if unexpected:
        raise RuntimeError(f"unexpected continuation observation ids: {unexpected}")

    def provider_factory():
        return CodexAppServerProposalProvider(
            cwd=Path.cwd(), env=dict(os.environ), diagnostics_path=None, ephemeral=True
        )

    def on_observation(row) -> None:
        with part_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    summary = run_same_gate_sham_worker(
        bank["contexts"],
        schedule=schedule,
        worker_index=worker_index,
        provider_factory=provider_factory,
        config=AdaptiveConfig(
            model=manifest["model"],
            reasoning_effort=manifest["reasoning_effort"],
            levels=(int(manifest["repeats"]),),
        ),
        completed_observation_ids=set(completed_ids),
        on_observation=on_observation,
    )
    (args.output_root / f"worker-{worker_index}-of-{workers}.summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, sort_keys=True))
    return 0


def merge(args: argparse.Namespace) -> int:
    manifest = _read(args.output_root / "preregistration.v1.json")
    expected = {
        str(row["observation_id"]): row for row in manifest["schedule"]["observations"]
    }
    rows = []
    for worker_index in range(int(manifest["workers"])):
        part = args.output_root / f"observations.part-w{worker_index}.jsonl"
        if not part.is_file():
            raise RuntimeError(f"missing worker output: {part}")
        rows.extend(
            json.loads(line)
            for line in part.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    ids = [str(row["observation_id"]) for row in rows]
    counts = {observation_id: ids.count(observation_id) for observation_id in set(ids)}
    duplicates = sorted(item for item, count in counts.items() if count > 1)
    missing = sorted(set(expected) - set(ids))
    unexpected = sorted(set(ids) - set(expected))
    if duplicates or missing or unexpected:
        raise RuntimeError(
            f"merge mismatch duplicates={duplicates} missing={missing} unexpected={unexpected}"
        )
    schedule_order = {observation_id: index for index, observation_id in enumerate(expected)}
    rows.sort(key=lambda row: schedule_order[str(row["observation_id"])])
    output = args.output_root / "observations.v1.jsonl"
    if output.exists():
        raise RuntimeError(f"refusing to overwrite versioned artifact: {output}")
    output.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    status_counts: dict[str, int] = {}
    for row in rows:
        status = str(row["schema_status"])
        status_counts[status] = status_counts.get(status, 0) + 1
    reconciliation = {
        "schema_version": "ecos.rq2_same_gate_sham_reconciliation.v1",
        "registered": len(expected),
        "observed": len(rows),
        "unique_observation_ids": len(set(ids)),
        "schema_status_counts": dict(sorted(status_counts.items())),
        "provider_error_rows_retained": sum(row["schema_status"] != "valid" for row in rows),
        "ecc_executions": 0,
        "observations_sha256": _sha256(output),
    }
    _write_new(args.output_root / "reconciliation.v1.json", reconciliation)
    print(json.dumps(reconciliation, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=Path)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--model", default="glm-5.3-flash")
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--seed", type=int, default=20260927)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--workers", type=int, default=4)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--worker")
    mode.add_argument("--merge", action="store_true")
    args = parser.parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    if args.prepare:
        if args.bank is None:
            parser.error("--bank is required with --prepare")
        return prepare(args)
    if args.merge:
        return merge(args)
    return run_worker(args)


if __name__ == "__main__":
    sys.exit(main())
