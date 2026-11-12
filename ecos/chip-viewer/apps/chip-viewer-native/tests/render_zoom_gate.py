#!/usr/bin/env python3
"""Aggregate exact-camera zoom evidence without mixing cached and uncached work."""

import argparse
import json
import math
from pathlib import Path


def percentile95(values):
    if not values:
        return None
    return sorted(values)[math.ceil(len(values) * .95) - 1]


def collect(reports, label, failures, observations):
    cameras = {}
    routes = set()
    for index, report in enumerate(reports):
        context = f"{label}[{index}]"
        if report.get("display_size") != [2048, 1280]:
            failures.append(f"{context}: missing or wrong fullscreen dimensions")
        if report.get("raster_trace_diagnostic") is not False:
            failures.append(f"{context}: diagnostic timings are not acceptance evidence")
        if type(report.get("is_gpu")) is not bool:
            failures.append(f"{context}: missing renderer route")
        else:
            routes.add(report["is_gpu"])
        observations.extend(f"{context}: {failure}" for failure in report.get("failures", []))
        continuous = report.get("continuous_unrecognized_colored_pixel_fraction")
        if not valid_number(continuous) or continuous > .025:
            failures.append(f"{context}: continuous zoom fidelity failed or missing")
        steps = report.get("steps", [])
        if len(steps) != 6:
            failures.append(f"{context}: expected all six stepped zoom cameras")
        seen = set()
        for step in steps:
            zoom = step.get("zoom")
            if not valid_number(zoom) or zoom <= 0:
                failures.append(f"{context}: invalid camera zoom")
                continue
            key = round(zoom, 4)
            if key in seen:
                failures.append(f"{context}: duplicate camera {key}")
            seen.add(key)
            cache_hit = step.get("full_response_cache_hit")
            if type(cache_hit) is not bool:
                failures.append(f"{context}/{key}: completion cache classification missing")
                continue
            values = [step.get(field) for field in (
                "first_current_view_seconds", "geometry_response_seconds", "full_response_seconds",
            )]
            if not all(valid_number(value) for value in values):
                failures.append(f"{context}/{key}: current geometry or label completion missing")
                continue
            if not values[0] <= values[1] <= values[2]:
                failures.append(f"{context}/{key}: readiness stages are out of order")
            unknown = step.get("unrecognized_colored_pixel_fraction")
            if not valid_number(unknown) or unknown > .025:
                failures.append(f"{context}/{key}: stepped zoom fidelity failed or missing")
            for field, limit in [("frame_p95_ms", 33.3), ("max_frame_ms", 250)]:
                value = step.get(field)
                if not valid_number(value):
                    failures.append(f"{context}/{key}: {field} is missing or invalid")
                elif value > limit:
                    observations.append(f"{context}/{key}: {field} exceeds {limit} ms")
            bucket = cameras.setdefault(key, {"cached": [], "uncached": []})
            bucket["cached" if cache_hit else "uncached"].append([value * 1000 for value in values])
    if len(routes) != 1:
        failures.append(f"{label}: renderer route changed or was not recorded")
    return cameras, routes


def valid_number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def summarize(rows):
    return {
        "samples": len(rows),
        **{field: percentile95([row[index] for row in rows]) for index, field in enumerate((
            "feedback_p95_ms", "geometry_p95_ms", "full_p95_ms",
        ))},
    }


def evaluate(baseline_reports, candidate_reports, minimum_samples=20):
    if minimum_samples < 1:
        raise ValueError("minimum_samples must be positive")
    failures = []
    baseline_failures = []
    baseline, baseline_routes = collect(baseline_reports, "baseline", failures, baseline_failures)
    candidate, candidate_routes = collect(candidate_reports, "candidate", failures, failures)
    if baseline_routes != candidate_routes:
        failures.append("baseline and candidate renderer routes differ")
    if baseline.keys() != candidate.keys():
        failures.append("baseline and candidate camera sets differ")
    cameras = []
    for zoom in sorted(baseline.keys() | candidate.keys()):
        before = baseline.get(zoom, {"cached": [], "uncached": []})
        after = candidate.get(zoom, {"cached": [], "uncached": []})
        record = {"zoom": zoom, "baseline": {}, "candidate": {}}
        for label, samples in [("baseline", before), ("candidate", after)]:
            record[label] = {kind: summarize(rows) for kind, rows in samples.items()}
        uncached = record["candidate"]["uncached"]
        if zoom != 1.0 or before["uncached"] or after["uncached"]:
            for label in ("baseline", "candidate"):
                if record[label]["uncached"]["samples"] < minimum_samples:
                    failures.append(f"{zoom}: {label} has fewer than {minimum_samples} uncached samples")
            for field, limit in [("feedback_p95_ms", 50), ("geometry_p95_ms", 250), ("full_p95_ms", 250)]:
                value = uncached[field]
                if value is None or value > limit:
                    failures.append(f"{zoom}: uncached {field} exceeds {limit} ms or is missing")
            previous = record["baseline"]["uncached"]["full_p95_ms"]
            current = uncached["full_p95_ms"]
            if previous is not None and current is not None and current > previous:
                failures.append(f"{zoom}: uncached full-recovery p95 regressed")
        for field, limit in [("feedback_p95_ms", 50), ("full_p95_ms", 250)]:
            value = record["candidate"]["cached"][field]
            if value is not None and value > limit:
                failures.append(f"{zoom}: cached {field} exceeds {limit} ms")
        cameras.append(record)
    return {
        "status": "fail" if failures else "pass",
        "scope": "stepped and continuous zoom only; not whole-renderer acceptance",
        "minimum_uncached_samples_per_camera": minimum_samples,
        "cameras": cameras,
        "failures": failures,
        "baseline_failures": baseline_failures,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", nargs="+", type=Path, required=True)
    parser.add_argument("--candidate", nargs="+", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-samples", type=int, default=20)
    args = parser.parse_args()
    if args.minimum_samples < 1:
        parser.error("--minimum-samples must be positive")
    try:
        report = evaluate(
            [json.loads(path.read_text()) for path in args.baseline],
            [json.loads(path.read_text()) for path in args.candidate],
            args.minimum_samples,
        )
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    report["artifacts"] = {name: [str(path.resolve()) for path in getattr(args, name)]
                           for name in ("baseline", "candidate")}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(report, indent=2, allow_nan=False))
    if report["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
