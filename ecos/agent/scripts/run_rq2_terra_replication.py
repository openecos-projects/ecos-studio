#!/usr/bin/env python3
"""Run the RQ2 provider-only replication with the Terra model, never GLM."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from run_rq2_order_balanced_bank import main as run_four_arm
from run_rq2_same_gate_sham_bank import main as run_sham

MODEL = "gpt-5.6-terra"
REASONING_EFFORT = "medium"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arm", choices=("four-arm", "sham"), required=True)
    parser.add_argument("--bank", type=Path)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260927)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--workers", type=int, default=4)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--worker")
    mode.add_argument("--merge", action="store_true")
    args = parser.parse_args()

    if args.prepare and args.bank is None:
        parser.error("--bank is required with --prepare")
    if args.worker is not None:
        index, separator, workers = args.worker.partition("/")
        if not separator or not index.isdigit() or not workers.isdigit():
            parser.error("--worker must look like i/N")

    forwarded = [
        "run_rq2_terra_replication.py",
        "--output-root",
        str(args.output_root),
        "--model",
        MODEL,
        "--reasoning-effort",
        REASONING_EFFORT,
        "--seed",
        str(args.seed),
        "--repeats",
        str(args.repeats),
        "--workers",
        str(args.workers),
    ]
    if args.prepare:
        forwarded.extend(("--prepare", "--bank", str(args.bank)))
    elif args.worker is not None:
        forwarded.extend(("--worker", args.worker))
    else:
        forwarded.append("--merge")

    sys.argv = forwarded
    return (run_four_arm if args.arm == "four-arm" else run_sham)()


if __name__ == "__main__":
    raise SystemExit(main())
