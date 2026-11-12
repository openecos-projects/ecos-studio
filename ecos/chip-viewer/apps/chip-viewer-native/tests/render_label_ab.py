#!/usr/bin/env python3
"""Interleave cold dense-label startup checks for two renderer executables."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys

from interaction_render_e2e import IsolatedDisplay


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def measure(args, pair, label):
    output = args.output / f"{pair}-{label}"
    output.mkdir()
    command = [
        sys.executable, str(Path(__file__).with_name("static_render_e2e.py")),
        "--binary", str(getattr(args, label).resolve()),
        "--manifest", str(args.manifest.resolve()),
        "--reference", str(args.reference.resolve()),
        "--output", str(output.resolve()), "--size", args.size,
        "--zoom", str(args.zoom), "--max-warm-p95-ms", "33.3",
        "--max-frame-interval-ms", "250",
    ]
    with IsolatedDisplay(output, args.size), (output / "check.log").open("w") as log:
        process = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    record = {"pair": pair, "executable": label, "command": command,
              "returncode": process.returncode, "failures": []}
    if process.returncode:
        record["failures"].append(f"static check exited {process.returncode}")
    report = output / "report.json"
    if not report.is_file():
        record["failures"].append("missing static result")
        return record
    result = json.loads(report.read_text())
    record.update(
        label_ms=result["background_label_resolve_ms"],
        startup_full_ready_ms=result["first_geometry_ready_seconds"] * 1000,
        raster_ms=result["background_scene_raster_ms"],
        warm_p95_ms=result["p95_warm_frame_interval_ms"],
        drawn_shapes=result["drawn_shapes"],
        changed_layout_pixels=result.get("changed_layout_pixels"),
        is_gpu=result["is_gpu"],
        peak_viewer_rss_kib=result.get("peak_viewer_rss_kib"),
    )
    if record["changed_layout_pixels"] != 0:
        record["failures"].append("layout differs from the independent reference")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("before", "after", "manifest", "reference", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--zoom", type=float, default=2.612572)
    parser.add_argument("--size", default="2048x1280")
    parser.add_argument("--pairs", type=int, default=3)
    args = parser.parse_args()
    if args.pairs < 1:
        parser.error("--pairs must be positive")
    if not math.isfinite(args.zoom) or args.zoom <= 0:
        parser.error("--zoom must be finite and positive")
    for name in ("before", "after", "manifest", "reference"):
        if not getattr(args, name).is_file():
            parser.error(f"missing {name} input")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("--output must be new or empty")
    args.output.mkdir(parents=True, exist_ok=True)
    hashes = {name: digest(getattr(args, name)) for name in ("before", "after", "manifest", "reference")}
    runs = []
    for pair in range(1, args.pairs + 1):
        for label in (("before", "after") if pair % 2 else ("after", "before")):
            record = measure(args, pair, label)
            runs.append(record)
            print(json.dumps(record), flush=True)
    report = {"inputs": hashes, "runs": runs, "failures": []}
    for record in runs:
        report["failures"].extend(
            f"{record['pair']}-{record['executable']}: {failure}"
            for failure in record["failures"]
        )
    for name in hashes:
        if digest(getattr(args, name)) != hashes[name]:
            report["failures"].append(f"{name} input changed during measurement")
    for label in ("before", "after"):
        selected = [item for item in runs if item["executable"] == label and "label_ms" in item]
        if len(selected) != args.pairs:
            report["failures"].append(f"{label}: missing measurements")
            continue
        report[label] = {field: statistics.median(item[field] for item in selected)
                         for field in ("label_ms", "startup_full_ready_ms", "raster_ms", "warm_p95_ms")}
        rss = [item["peak_viewer_rss_kib"] for item in selected]
        if all(value is not None for value in rss):
            report[label]["peak_viewer_rss_kib"] = statistics.median(rss)
        elif sys.platform.startswith("linux"):
            report["failures"].append(f"{label}: missing Linux peak RSS samples")
    for field in ("drawn_shapes", "is_gpu"):
        if len({item.get(field) for item in runs}) != 1:
            report["failures"].append(f"{field} differs between runs")
    if "before" in report and "after" in report:
        for field in ("label_ms", "startup_full_ready_ms"):
            if report["after"][field] >= report["before"][field]:
                report["failures"].append(f"median {field} did not improve")
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "runs"}, indent=2))
    if report["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
