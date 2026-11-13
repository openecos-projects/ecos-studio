#!/usr/bin/env python3
"""Compare real zoom-out transition frames with completed layout references."""

import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import time

from PIL import Image, ImageChops, ImageDraw

from interaction_render_e2e import (
    IsolatedDisplay, Pointer, capture, percentile, stop, wait_ready,
)
from static_render_e2e import read_samples, screenshot, viewer_window
from render_latency import camera_latencies
from x11_capture import WindowCapture


def layout(image):
    width, height = image.size
    return image.crop((350, 110, width - 440, height - 90))


def colored_difference(first, second):
    def channel_range(image):
        red, green, blue = image.split()
        highest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        lowest = ImageChops.darker(ImageChops.darker(red, green), blue)
        return highest, ImageChops.subtract(highest, lowest)

    first, second = layout(first), layout(second)
    delta, _ = channel_range(ImageChops.difference(first, second))
    _, first_chroma = channel_range(first)
    _, second_chroma = channel_range(second)
    colored = ImageChops.lighter(first_chroma, second_chroma)
    threshold = [0] * 25 + [255] * 231
    mask = ImageChops.multiply(delta.point(threshold), colored.point(threshold))
    return mask.histogram()[255]


def capture_frame(window, output, name, stats, direct=None):
    before = len(read_samples(stats))
    directory = output / name
    directory.mkdir(exist_ok=True)
    image = (direct.capture(window) if direct else
             screenshot(window, directory, compress_level=None))
    return image, before, len(read_samples(stats))


def progress_references(output, zoom=None):
    references = []
    for metadata in (output / "progress").glob("*.json"):
        record = json.loads(metadata.read_text())
        if zoom is not None and abs(record["zoom"] / zoom - 1) > 0.0001:
            continue
        size = record["width"], record["height"]
        data = metadata.with_suffix(".rgba").read_bytes()
        image = Image.frombytes("RGBA", size, data, "raw", "RGBA", 0, -1).convert("RGB")
        references.append(image)
    return references


def geometry_reference(pointer, center, process, window, stats, output, name, timeout):
    pointer.move(center)
    pointer.button(2, True)
    try:
        time.sleep(0.05)
        pointer.move((center[0] + 8, center[1]))
        time.sleep(0.05)
        pointer.move(center)
        wait_ready(process, stats, timeout, len(read_samples(stats)))
        time.sleep(0.03)
        image = capture(window, output, name)
        assert read_samples(stats)[-1]["label_count"] == 0, "drag did not hide label overlays"
        return image
    finally:
        pointer.button(2, False)
        time.sleep(0.05)


def comparison_sheet(output, records):
    sheet = Image.new("RGB", (1000, 335 * len(records)))
    draw = ImageDraw.Draw(sheet)
    for index, record in enumerate(records):
        for column, state in enumerate(("early", "exact")):
            image = Image.open(output / f"out-{index:02}-{state}" / "screen.png")
            image = layout(image)
            image.thumbnail((490, 310))
            sheet.paste(image, (500 * column, 335 * index + 20))
            draw.text((500 * column, 335 * index),
                      f"{state} target zoom {record['zoom']:.4f}", fill="white")
    sheet.save(output / "comparison.png")


def prepare_uncached_camera(pointer, center, process, stats, timeout):
    samples = read_samples(stats)
    before_pan = len(samples)
    rasterizations_before_pan = samples[-1]["cpu_rasterizations"]
    pointer.move(center)
    pointer.button(2, True)
    try:
        time.sleep(0.05)
        pointer.move((center[0] + 17, center[1] + 11))
        started = time.monotonic()
        while True:
            assert process.poll() is None, "viewer exited during uncached preparation"
            samples = read_samples(stats)
            if samples and samples[-1]["cpu_rasterizations"] > rasterizations_before_pan:
                break
            if time.monotonic() - started > timeout:
                raise TimeoutError("uncached preparation did not rasterize the changed high camera")
            time.sleep(0.01)
    finally:
        pointer.button(2, False)
    wait_ready(process, stats, timeout, before_pan)
    assert read_samples(stats)[-1]["cpu_rasterizations"] > rasterizations_before_pan, \
        "uncached preparation did not rasterize the changed high camera"
    pointer.move(center)


def run(args):
    stats = args.output / "stats.jsonl"
    stats.unlink(missing_ok=True)
    environment = {
        name: value for name, value in os.environ.items()
        if not name.startswith(("ECOS_PERF_", "ECOS_RENDER_")) and name != "ECOS_FORCE_CPU"
    }
    environment.update(
        ECOS_PERF_ALL_VISIBLE="1", ECOS_PERF_FULLSCREEN="1", ECOS_PERF_INITIAL_ZOOM="1",
        ECOS_PERF_BENCHMARK="1", ECOS_RENDER_STATS_LOG=str(stats.resolve()),
        ECOS_RENDER_PROGRESS_EVIDENCE=str((args.output / "progress").resolve()),
    )
    if args.raster_trace:
        trace_path = args.output / "raster.jsonl"
        trace_path.unlink(missing_ok=True)
        environment["ECOS_RENDER_RASTER_TRACE"] = str(trace_path.resolve())
    with (args.output / "viewer.log").open("w") as log:
        process = subprocess.Popen(
            [str(args.binary.resolve()), "--manifest", str(args.manifest.resolve()), "--x11"],
            env=environment, stdout=log, stderr=log,
        )
        pointer = Pointer()
        direct = WindowCapture() if args.direct_capture else None
        try:
            window = None
            started = time.monotonic()
            while window is None and time.monotonic() - started < args.timeout:
                assert process.poll() is None, "viewer exited during startup"
                window = viewer_window(process.pid)
                time.sleep(0.05)
            assert window, "cannot locate isolated viewer window"
            pointer.fullscreen(window, args.size)
            wait_ready(process, stats, args.timeout)
            initial = capture(window, args.output, "fit")
            width, height = initial.size
            assert (width, height) == tuple(map(int, args.size.split("x")))
            center = (width // 2, height // 2)
            pointer.move(center)
            for _ in range(6):
                pointer.wheel(1)
                time.sleep(0.08)
            wait_ready(process, stats, args.timeout, len(read_samples(stats)))
            previous = capture(window, args.output, "high")
            previous_geometry = geometry_reference(
                pointer, center, process, window, stats, args.output, "high-geometry", args.timeout,
            )
            if args.uncached_steps:
                prepare_uncached_camera(pointer, center, process, stats, args.timeout)
                previous = capture(window, args.output, "uncached-high")
                previous_geometry = geometry_reference(
                    pointer, center, process, window, stats, args.output,
                    "uncached-high-geometry", args.timeout,
                )
            references = [previous, previous_geometry]
            assert read_samples(stats)[-1]["zoom"] > 100, "high zoom was not established"
            records = []
            failures = []
            for step in range(6):
                before = len(read_samples(stats))
                started = time.monotonic()
                if args.uncached_steps and step == 5:
                    pointer.home(window)
                else:
                    pointer.wheel(-1)
                time.sleep(0.02)
                early, first, last = capture_frame(
                    window, args.output, f"out-{step:02}-early", stats, direct,
                )
                captured_at = time.monotonic() - started
                frames = [early]
                while True:
                    samples = read_samples(stats)
                    if len(samples) >= before + 2 and all(
                        sample["zoom"] < samples[before - 1]["zoom"] * 0.9
                        and not sample.get("scene_pending", True)
                        for sample in samples[-2:]
                    ):
                        break
                    assert time.monotonic() - started < args.timeout, "zoom did not settle"
                    frames.append(capture_frame(
                        window, args.output, f"out-{step:02}-frame-{len(frames):03}", stats, direct,
                    )[0])
                wait_ready(process, stats, args.timeout, before)
                time.sleep(0.05)
                exact = capture(window, args.output, f"out-{step:02}-exact")
                samples = read_samples(stats)
                zoom = samples[-1]["zoom"]
                for index, frame in enumerate(frames):
                    name = f"out-{step:02}-early" if index == 0 else f"out-{step:02}-frame-{index:03}"
                    frame.save(args.output / name / "screen.png")
                exact_geometry = geometry_reference(
                    pointer, center, process, window, stats, args.output,
                    f"out-{step:02}-geometry", args.timeout,
                )
                prior_difference = colored_difference(early, previous)
                current_difference = colored_difference(early, exact)
                pixel_count = layout(exact).width * layout(exact).height
                progressive = progress_references(args.output, zoom)
                unknown_fraction = max(
                    min(colored_difference(frame, reference) for reference in
                        (previous, previous_geometry, exact, exact_geometry, *progressive))
                    for frame in frames
                ) / pixel_count
                active = samples[before:]
                latencies = camera_latencies(active, zoom)
                response_seconds = latencies["geometry_response_seconds"]
                feedback_seconds = latencies["first_current_view_seconds"]
                record = {
                    "zoom": zoom, "capture_seconds": captured_at,
                    "captured_transition_frames": len(frames),
                    "capture_sample_range": [first, last],
                    "difference_from_prior_exact": prior_difference,
                    "difference_from_current_exact": current_difference,
                    "unrecognized_colored_pixel_fraction": unknown_fraction,
                    **latencies,
                    "published_partial_references": len(progressive),
                    "frame_p95_ms": percentile([item["frame_interval_ms"] for item in active], 0.95),
                    "max_frame_ms": max(item["frame_interval_ms"] for item in active),
                }
                if args.uncached_steps and step < 5 and record["full_response_cache_hit"] is not False:
                    failures.append(f"step {step}: uncached camera unexpectedly restored history")
                records.append(record)
                print(json.dumps(record), flush=True)
                if unknown_fraction > 0.025:
                    failures.append(f"step {step}: transition is neither prior nor current exact geometry")
                if colored_difference(previous, exact) < 1000:
                    failures.append(f"step {step}: zoom did not change visible layout")
                if response_seconds is None or response_seconds > args.max_response_seconds:
                    failures.append(f"step {step}: new geometry response exceeds its budget")
                if args.max_feedback_seconds is not None and (
                    feedback_seconds is None or feedback_seconds > args.max_feedback_seconds
                ):
                    failures.append(f"step {step}: current-camera feedback exceeds its budget")
                if args.max_full_response_seconds is not None and (
                    latencies["full_response_seconds"] is None
                    or latencies["full_response_seconds"] > args.max_full_response_seconds
                ):
                    failures.append(f"step {step}: exact geometry and labels exceed their budget")
                if record["frame_p95_ms"] > args.max_p95_ms:
                    failures.append(f"step {step}: UI frame p95 exceeds its budget")
                if record["max_frame_ms"] > args.max_stall_ms:
                    failures.append(f"step {step}: UI stall exceeds its budget")
                previous = exact
                previous_geometry = exact_geometry
                references.extend((exact, exact_geometry))
            assert abs(records[-1]["zoom"] - 1) < 0.00001
            for _ in range(6):
                pointer.wheel(1)
                time.sleep(0.08)
            wait_ready(process, stats, args.timeout, len(read_samples(stats)))
            if args.uncached_steps:
                prepare_uncached_camera(pointer, center, process, stats, args.timeout)
            continuous = []
            before = len(read_samples(stats))
            for step in range(6):
                started = time.monotonic()
                pointer.wheel(-1)
                time.sleep(0.02)
                continuous.append(capture_frame(
                    window, args.output, f"continuous-{step:02}", stats, direct,
                )[0])
                remaining = 0.08 - (time.monotonic() - started)
                if remaining > 0:
                    time.sleep(remaining)
            wait_ready(process, stats, args.timeout, before)
            for index, frame in enumerate(continuous):
                frame.save(args.output / f"continuous-{index:02}" / "screen.png")
            continuous_unknown = max(
                min(colored_difference(frame, reference) for reference in
                    (*references, *progress_references(args.output)))
                for frame in continuous
            ) / pixel_count
            if continuous_unknown > 0.025:
                failures.append("continuous zoom: frame does not match any completed camera")
            comparison_sheet(args.output, records)
            evidence_complete = "evidence unavailable:" not in (args.output / "viewer.log").read_text().lower()
            if not evidence_complete:
                failures.append("progress evidence could not be persisted")
            final_samples = read_samples(stats)
            report = {"steps": records, "failures": failures,
                      "stats_phases": {stage: sum(bool(sample.get("cpu_stats_after_paint", False)) == after_paint
                           for sample in final_samples) for stage, after_paint in
                           (("gl_after_paint", True), ("ui_before_paint", False))},
                      "progress_evidence_complete": evidence_complete,
                      "raster_trace_diagnostic": args.raster_trace,
                      "uncached_steps": args.uncached_steps,
                      "capture_backend": "XGetImage" if args.direct_capture else "xwd",
                      "continuous_unrecognized_colored_pixel_fraction": continuous_unknown,
                      "display_size": list(initial.size), "is_gpu": samples[-1]["is_gpu"]}
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            assert not failures, "\n".join(failures)
        finally:
            if direct:
                direct.close()
            pointer.close()
            stop(process)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", default="2048x1280")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--max-response-seconds", type=float, default=1)
    parser.add_argument("--max-feedback-seconds", type=float)
    parser.add_argument("--max-full-response-seconds", type=float)
    parser.add_argument("--max-p95-ms", type=float, default=33.3)
    parser.add_argument("--max-stall-ms", type=float, default=250)
    parser.add_argument("--raster-trace", action="store_true")
    parser.add_argument("--uncached-steps", action="store_true",
                        help="pan the high view before stepping, then restore fit with Home")
    parser.add_argument("--direct-capture", action="store_true",
                        help="capture the same window pixels directly and save PNGs after settling")
    args = parser.parse_args()
    for name in ("max_feedback_seconds", "max_full_response_seconds", "max_response_seconds",
                 "max_p95_ms", "max_stall_ms"):
        value = getattr(args, name)
        if value is not None and (not math.isfinite(value) or value <= 0):
            parser.error(f"--{name.replace('_', '-')} must be finite and positive")
    args.output.mkdir(parents=True, exist_ok=True)
    with IsolatedDisplay(args.output, args.size):
        run(args)
