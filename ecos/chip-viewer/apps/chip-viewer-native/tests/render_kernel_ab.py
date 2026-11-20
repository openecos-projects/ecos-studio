#!/usr/bin/env python3
"""Interleave isolated, uncached native pan checks for two renderer builds."""

import argparse
import json
from pathlib import Path
import statistics
import subprocess
import sys


def measure(args, pair, label):
    output = args.output / f"{pair}-{label}"
    binary = getattr(args, label)
    command = [
        sys.executable,
        str(Path(__file__).with_name("interaction_render_e2e.py")),
        "--binary", str(binary.resolve()),
        "--manifest", str(args.manifest.resolve()),
        "--output", str(output.resolve()),
        "--size", args.size,
        "--scenario", "left-drag",
        "--max-p95-ms", str(args.max_p95_ms),
        "--max-stall-ms", str(args.max_stall_ms),
        "--max-settle-seconds", str(args.max_settle_seconds),
    ]
    with (args.output / f"{pair}-{label}.log").open("w") as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    record = {
        "pair": pair,
        "backend": label,
        "command": command,
        "returncode": result.returncode,
        "failures": [],
    }
    if result.returncode:
        record["failures"].append(f"interaction check exited {result.returncode}")
    report_path = output / "report.json"
    stats_path = output / "stats.jsonl"
    if not report_path.is_file() or not stats_path.is_file():
        record["failures"].append("missing interaction report or statistics")
        return record
    report = json.loads(report_path.read_text())
    record["failures"].extend(report["failures"])
    scenario = report["scenarios"][0]
    samples = [json.loads(line) for line in stats_path.read_text().splitlines()]
    complete = [
        sample for sample in samples
        if not sample["scene_pending"] and sample["geometry_drawn_shapes"] > 0
    ]
    if not complete:
        record["failures"].append("no complete geometry sample")
        return record
    record.update(
        settle_seconds=scenario["settle_seconds"],
        active_p95_ms=scenario["active_p95_frame_ms"],
        build_ms=complete[-1]["cpu_scene_build_ms"],
        raster_ms=complete[-1]["cpu_scene_raster_ms"],
        pipeline_ms=complete[-1].get(
            "cpu_scene_pipeline_ms",
            complete[-1]["cpu_scene_build_ms"] + complete[-1]["cpu_scene_raster_ms"],
        ),
        pipeline_measurement=(
            "wall-clock" if "cpu_scene_pipeline_ms" in complete[-1] else "sequential phase sum"
        ),
        final_drawn_shapes=scenario["final_drawn_shapes"],
        is_gpu=report["is_gpu"],
    )
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", default="2048x1280")
    parser.add_argument("--pairs", type=int, default=3)
    parser.add_argument("--max-p95-ms", type=float, default=33.3)
    parser.add_argument("--max-stall-ms", type=float, default=250)
    parser.add_argument("--max-settle-seconds", type=float, default=1)
    parser.add_argument("--max-regression-percent", type=float, default=0)
    args = parser.parse_args()
    if args.pairs < 1:
        parser.error("--pairs must be positive")
    for path in (args.before, args.after, args.manifest):
        if not path.is_file():
            parser.error(f"input file does not exist: {path}")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("--output must be a new or empty directory")
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for pair in range(1, args.pairs + 1):
        order = ("before", "after") if pair % 2 else ("after", "before")
        for label in order:
            record = measure(args, pair, label)
            records.append(record)
            print(json.dumps(record), flush=True)
    summary = {"runs": records, "failures": []}
    for record in records:
        summary["failures"].extend(
            f"{record['pair']}-{record['backend']}: {failure}"
            for failure in record["failures"]
        )
    for label in ("before", "after"):
        selected = [item for item in records if item["backend"] == label and "build_ms" in item]
        if len(selected) != args.pairs:
            summary["failures"].append(f"{label}: missing measured runs")
            continue
        summary[label] = {
            field: statistics.median(item[field] for item in selected)
            for field in ("settle_seconds", "active_p95_ms", "build_ms", "raster_ms", "pipeline_ms")
        }
    if len({record.get("final_drawn_shapes") for record in records}) != 1:
        summary["failures"].append("final shape counts differ between builds/runs")
    if len({record.get("is_gpu") for record in records}) != 1:
        summary["failures"].append("renderer route differs between builds/runs")
    if "before" in summary and "after" in summary:
        before = summary["before"]["settle_seconds"]
        after = summary["after"]["settle_seconds"]
        summary["recovery_change_percent"] = (after / before - 1) * 100
        if after > before * (1 + args.max_regression_percent / 100):
            summary["failures"].append("median uncached recovery regressed")
    (args.output / "report.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: value for key, value in summary.items() if key != "runs"}, indent=2))
    if summary["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
