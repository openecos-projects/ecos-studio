#!/usr/bin/env python3
"""Compare zoom transitions against completed minirv/TPU targets with colored routes."""

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
from render_zoom_content import conservative_feedback_seconds, feedback_capture, layout_feedback
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
    for metadata in (output / "progress").rglob("*.json"):
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


def wait_initial_frame(process, stats, timeout):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        assert process.poll() is None, "viewer exited before its first frame"
        samples = read_samples(stats)
        if len(samples) >= 2:
            return samples
        time.sleep(0.01)
    raise TimeoutError("viewer did not produce its first frames")


def wait_target_ready(process, stats, timeout, target_zoom, labels_ready=False):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        assert process.poll() is None, "viewer exited before the target camera settled"
        samples = read_samples(stats)
        if samples:
            current = samples[-1]
            ready = (
                abs(current["zoom"] - target_zoom) <= max(0.002, target_zoom * 0.001)
                and current.get("geometry_drawn_shapes", current["drawn_shapes"]) > 0
                and not current.get("scene_pending", current.get("cpu_scene_pending", False))
                and (not labels_ready or not current.get("cpu_labels_pending", False))
            )
            stable_exact = len(samples) >= 2 and all(
                abs(sample["zoom"] - target_zoom) <= max(0.002, target_zoom * 0.001)
                and sample.get("geometry_drawn_shapes", sample["drawn_shapes"]) > 0
                and not sample.get("scene_pending", sample.get("cpu_scene_pending", False))
                and (not labels_ready or not sample.get("cpu_labels_pending", False))
                for sample in samples[-2:]
            )
            if ready and (current.get("use_view_tiles", False) or stable_exact):
                return time.monotonic() - started, samples
        time.sleep(0.01)
    raise TimeoutError("target camera did not settle")


def wait_exact_geometry(process, stats, timeout, target_zoom):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        assert process.poll() is None, "viewer exited before exact geometry appeared"
        samples = read_samples(stats)
        if samples:
            current = samples[-1]
            exact = (
                abs(current["zoom"] - target_zoom) <= max(0.002, target_zoom * 0.001)
                and current.get("geometry_drawn_shapes", 0) > 0
                and not current.get("use_view_tiles", False)
                and not current.get("cpu_scene_held", False)
                and not current.get("cpu_scene_preview", False)
                and not current.get("cpu_scene_partial", False)
            )
            if exact:
                return time.monotonic() - started, current
        time.sleep(0.01)
    raise TimeoutError("exact geometry did not appear at the target camera")


def run_during_initial_load(args, process, pointer, window, stats):
    samples = wait_initial_frame(process, stats, args.timeout)
    first = samples[-1]
    width, height = map(int, args.size.split("x"))
    center = (width // 2, height // 2)
    pointer.fullscreen(window, args.size)
    pointer.move(center)
    time.sleep(0.02)

    interaction_sample_start = len(read_samples(stats))
    started = time.monotonic()
    for direction in [1] * 6:
        pointer.wheel(direction)
        time.sleep(0.08)
    pointer.move(center)
    pointer.button(1, True)
    pointer.button(1, False)
    pointer.home(window)
    released_at = time.monotonic()
    target_zoom = 1.0
    geometry_seconds, samples = wait_target_ready(
        process, stats, args.timeout, target_zoom,
    )
    label_seconds, samples = wait_target_ready(
        process, stats, args.timeout, target_zoom, labels_ready=True,
    )
    final = samples[-1]
    image = capture(window, args.output, "initial-load-zoom-final")
    ink_pixels = sum(
        max(pixel) - min(pixel) > 24 and max(pixel) > 80
        for pixel in layout(image).getdata()
    )
    record = {
        "scenario": "zoom-during-initial-load-and-return-to-full-layout",
        "initial_sample_zoom": first["zoom"],
        "initial_scene_pending": first.get("scene_pending", first.get("cpu_scene_pending", False)),
        "initial_drawn_shapes": first.get("geometry_drawn_shapes", first["drawn_shapes"]),
        "input_seconds": released_at - started,
        "active_p95_frame_ms": percentile(
            [sample["frame_interval_ms"] for sample in samples[interaction_sample_start:]], 0.95
        ) if len(samples) > interaction_sample_start else 0.0,
        "geometry_ready_after_release_seconds": geometry_seconds,
        "labels_ready_after_release_seconds": label_seconds,
        "target_zoom": target_zoom,
        "drawn_shapes": final.get("geometry_drawn_shapes", final["drawn_shapes"]),
        "uses_view_tiles": final.get("use_view_tiles", False),
        "query_ms": final.get("query_time_ms", 0.0),
        "filter_ms": final.get("filter_time_ms", 0.0),
        "scene_build_ms": final.get("cpu_scene_build_ms", 0.0),
        "scene_pipeline_ms": final.get("cpu_scene_pipeline_ms", 0.0),
        "raster_ms": final.get("cpu_scene_raster_ms", 0.0),
        "label_resolve_ms": final.get("cpu_label_resolve_ms", 0.0),
        "rasterizations": final.get("cpu_rasterizations", 0),
        "layout_ink_pixels": ink_pixels,
        "is_gpu": final["is_gpu"],
        "failures": [],
    }
    if abs(target_zoom - 1.0) > 0.01:
        record["failures"].append("zoom cycle did not return to the full-layout camera")
    if ink_pixels < 1000 or record["drawn_shapes"] < 1000:
        record["failures"].append("final camera did not restore the full layout")
    if args.max_response_seconds is not None and geometry_seconds > args.max_response_seconds:
        record["failures"].append(
            f"full-layout geometry recovery exceeded {args.max_response_seconds}s"
        )
    if args.max_full_response_seconds is not None and label_seconds > args.max_full_response_seconds:
        record["failures"].append(
            f"full-layout geometry and labels exceeded {args.max_full_response_seconds}s"
        )
    (args.output / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record), flush=True)
    assert not record["failures"], "\n".join(record["failures"])


def run_initial_overview_to_exact(args, process, pointer, window, stats):
    total_started = time.monotonic()
    samples = wait_initial_frame(process, stats, args.timeout)
    first = samples[-1]
    started = time.monotonic()
    feedback = None
    while time.monotonic() - started < args.timeout:
        assert process.poll() is None, "viewer exited before overview feedback"
        samples = read_samples(stats)
        if samples:
            current = samples[-1]
            visible_shapes = (
                current.get("drawn_shapes", 0)
                if current.get("use_view_tiles", False)
                else current.get("geometry_drawn_shapes", current["drawn_shapes"])
            )
            overview_ready = current.get("use_view_tiles", False) and visible_shapes > 0
            exact_ready = (
                current.get("cpu_rasterizations", 0) > 0
                and not current.get("scene_pending", current.get("cpu_scene_pending", False))
                and not current.get("cpu_labels_pending", False)
            )
            if overview_ready or exact_ready:
                feedback = current
                break
        time.sleep(0.01)
    if feedback is None:
        raise TimeoutError("initial layout feedback did not become visible")
    feedback_seconds = time.monotonic() - started
    feedback_kind = "overview" if feedback.get("use_view_tiles", False) else "exact"
    feedback_image = capture(window, args.output, "initial-feedback")
    feedback_ink_pixels = sum(
        max(pixel) - min(pixel) > 24 and max(pixel) > 80
        for pixel in layout(feedback_image).getdata()
    )
    exact_started = time.monotonic()

    while time.monotonic() - started < args.timeout:
        assert process.poll() is None, "viewer exited before exact initial geometry settled"
        samples = read_samples(stats)
        if samples:
            current = samples[-1]
            if (
                current.get("cpu_rasterizations", 0) > 0
                and not current.get("scene_pending", current.get("cpu_scene_pending", False))
                and not current.get("cpu_labels_pending", False)
            ):
                break
        time.sleep(0.01)
    else:
        raise TimeoutError("exact initial scene did not settle behind the overview")

    exact = samples[-1]
    exact_seconds = time.monotonic() - exact_started
    image = capture(window, args.output, "initial-exact-final")
    ink_pixels = sum(
        max(pixel) - min(pixel) > 24 and max(pixel) > 80
        for pixel in layout(image).getdata()
    )
    record = {
        "scenario": "initial-overview-to-exact-scene",
        "initial_zoom": first["zoom"],
        "initial_use_view_tiles": first.get("use_view_tiles", False),
        "initial_scene_pending": first.get("scene_pending", first.get("cpu_scene_pending", False)),
        "initial_drawn_shapes": first.get("drawn_shapes", 0)
        if first.get("use_view_tiles", False)
        else first.get("geometry_drawn_shapes", first["drawn_shapes"]),
        "first_feedback_kind": feedback_kind,
        "first_feedback_seconds": feedback_seconds,
        "first_feedback_ink_pixels": feedback_ink_pixels,
        "exact_ready_seconds": time.monotonic() - total_started,
        "exact_work_after_overview_seconds": exact_seconds,
        "exact_zoom": exact["zoom"],
        "exact_drawn_shapes": exact.get("geometry_drawn_shapes", exact["drawn_shapes"]),
        "exact_uses_view_tiles_policy": exact.get("use_view_tiles", False),
        "query_ms": exact.get("query_time_ms", 0.0),
        "scene_build_ms": exact.get("cpu_scene_build_ms", 0.0),
        "scene_pipeline_ms": exact.get("cpu_scene_pipeline_ms", 0.0),
        "raster_ms": exact.get("cpu_scene_raster_ms", 0.0),
        "label_resolve_ms": exact.get("cpu_label_resolve_ms", 0.0),
        "rasterizations": exact.get("cpu_rasterizations", 0),
        "layout_ink_pixels": ink_pixels,
        "is_gpu": exact["is_gpu"],
        "failures": [],
    }
    if record["rasterizations"] == 0 or (
        record["initial_use_view_tiles"]
        and record["exact_drawn_shapes"] <= record["initial_drawn_shapes"]
    ):
        record["failures"].append("exact geometry did not replace the overview tile image")
    if feedback_ink_pixels < 1000 or ink_pixels < 1000:
        record["failures"].append("overview or exact capture does not contain the layout")
    if args.max_response_seconds is not None and exact_seconds > args.max_response_seconds:
        record["failures"].append(f"exact readiness exceeded {args.max_response_seconds}s")
    (args.output / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record), flush=True)
    assert not record["failures"], "\n".join(record["failures"])


def run_fit_recovery(args, process, pointer, window, stats):
    wait_ready(process, stats, args.timeout)
    initial = read_samples(stats)[-1]
    assert initial["geometry_drawn_shapes"] > 0, "initial fit scene is not exact"

    width, height = map(int, args.size.split("x"))
    center = (width // 2, height // 2)
    pointer.move(center)
    for _ in range(6):
        before = len(read_samples(stats))
        pointer.wheel(1)
        wait_ready(process, stats, args.timeout, before)
    extra_steps = 0
    while read_samples(stats)[-1]["zoom"] < 300 and extra_steps < 8:
        before = len(read_samples(stats))
        pointer.wheel(1)
        wait_ready(process, stats, args.timeout, before)
        extra_steps += 1
    assert read_samples(stats)[-1]["zoom"] >= 300, "high zoom was not established"

    prepare_uncached_camera(pointer, center, process, stats, args.timeout)
    before_fit = len(read_samples(stats))
    started = time.monotonic()
    pointer.home(window)
    geometry_seconds, geometry_sample = wait_exact_geometry(
        process, stats, args.timeout, 1.0,
    )
    wait_target_ready(process, stats, args.timeout, 1.0, labels_ready=True)
    full_seconds = time.monotonic() - started
    final = read_samples(stats)[-1]
    record = {
        "scenario": "uncached-high-camera-return-to-fit",
        "renderer": "gpu" if final["is_gpu"] else "cpu",
        "world_source_cache_enabled": "ECOS_DISABLE_WORLD_SOURCE" not in os.environ,
        "initial_exact_shapes": initial["geometry_drawn_shapes"],
        "initial_cpu_cache_bytes": initial.get("cpu_history_bytes", 0),
        "high_zoom": max(sample["zoom"] for sample in read_samples(stats)[before_fit - 2:]),
        "fit_zoom": final["zoom"],
        "fit_geometry_shapes": final["geometry_drawn_shapes"],
        "fit_overview_visible": final.get("use_view_tiles", False),
        "fit_geometry_response_seconds": geometry_seconds,
        "labels_pending_when_exact_appeared": geometry_sample.get("cpu_labels_pending", False),
        "fit_full_response_seconds": full_seconds,
        "fit_query_ms": final.get("query_time_ms", 0.0),
        "fit_scene_build_ms": final.get("cpu_scene_build_ms", 0.0),
        "fit_scene_pipeline_ms": final.get("cpu_scene_pipeline_ms", 0.0),
        "fit_raster_ms": final.get("cpu_scene_raster_ms", 0.0),
        "fit_label_resolve_ms": final.get("cpu_label_resolve_ms", 0.0),
        "fit_cpu_cache_bytes": final.get("cpu_history_bytes", 0),
        "fit_rasterizations": final.get("cpu_rasterizations", 0),
        "scene_history_cache_hit": final.get("cpu_scene_cache_hit", False),
        "failures": [],
    }
    if abs(record["fit_zoom"] - 1.0) > 0.001 or record["fit_geometry_shapes"] == 0:
        record["failures"].append("fit did not restore exact layout geometry")
    if record["scene_history_cache_hit"]:
        record["failures"].append("fit response came from scene history, not source reuse")
    if record["world_source_cache_enabled"]:
        if record["initial_cpu_cache_bytes"] == 0 or record["fit_query_ms"] >= 0.1:
            record["failures"].append("fit source cache was not reused; full query work remained")
    elif record["fit_query_ms"] < 0.1:
        record["failures"].append("disabled-source control did not exercise a full query")
    if record["world_source_cache_enabled"] and record["labels_pending_when_exact_appeared"]:
        record["failures"].append("exact fit replay did not reuse its completed label result")
    (args.output / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record), flush=True)
    assert not record["failures"], "\n".join(record["failures"])


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
    )
    if not (args.during_initial_load or args.settle_initial_exact or args.fit_recovery_only):
        environment["ECOS_RENDER_PROGRESS_EVIDENCE"] = str(
            (args.output / "progress").resolve()
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
            if args.settle_initial_exact:
                run_initial_overview_to_exact(args, process, pointer, window, stats)
                return
            if args.fit_recovery_only:
                run_fit_recovery(args, process, pointer, window, stats)
                return
            if args.during_initial_load:
                run_during_initial_load(args, process, pointer, window, stats)
                return
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
            extra_zoom_steps = 0
            while read_samples(stats)[-1]["zoom"] < 300 and extra_zoom_steps < 8:
                before_zoom_step = len(read_samples(stats))
                pointer.wheel(1)
                time.sleep(0.08)
                wait_ready(process, stats, args.timeout, before_zoom_step)
                extra_zoom_steps += 1
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
            target_geometry = []
            failures = []
            for step in range(6):
                before = len(read_samples(stats))
                started = time.monotonic()
                if step == 5:
                    pointer.home(window)
                else:
                    pointer.wheel(-1)
                time.sleep(0.02)
                early, first, last = capture_frame(
                    window, args.output, f"out-{step:02}-early", stats, direct,
                )
                captured_at = time.monotonic() - started
                frames = [early]
                capture_evidence = [(captured_at, first, last)]
                while True:
                    samples = read_samples(stats)
                    if len(samples) >= before + 2 and all(
                        sample["zoom"] < samples[before - 1]["zoom"] * 0.9
                        and not sample.get("scene_pending", True)
                        for sample in samples[-2:]
                    ):
                        break
                    assert time.monotonic() - started < args.timeout, "zoom did not settle"
                    frame, frame_first, frame_last = capture_frame(
                        window, args.output, f"out-{step:02}-frame-{len(frames):03}", stats, direct,
                    )
                    frames.append(frame)
                    capture_evidence.append((time.monotonic() - started, frame_first, frame_last))
                wait_ready(process, stats, args.timeout, before)
                time.sleep(0.05)
                exact = capture(window, args.output, f"out-{step:02}-exact")
                exact_captured_at = time.monotonic() - started
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
                image_evidence = []
                for frame, (at, sample_first, sample_last) in zip(frames, capture_evidence):
                    evidence = feedback_capture(
                        frame, exact_geometry,
                        samples[max(before, sample_first - 1):max(sample_first, sample_last)], zoom,
                    )
                    image_evidence.append({"captured_at_seconds": at, **evidence})
                exact_content = layout_feedback(exact, exact_geometry)
                # Feedback includes screenshot overhead: it is a conservative
                # upper bound, and cannot establish <50ms from an earlier flag.
                # Keep the raw native feedback separately for diagnosis.
                verified = next((item["captured_at_seconds"] for item in image_evidence
                                 if item["verified_current_layout"]), None)
                if verified is None and exact_content["usable_layout_image"]:
                    verified = exact_captured_at
                flag_feedback = latencies["first_current_view_seconds"]
                latencies["first_current_view_seconds"] = conservative_feedback_seconds(
                    flag_feedback, verified,
                )
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
                    "stats_first_current_view_seconds": flag_feedback,
                    "first_verified_layout_capture_seconds": verified,
                    "layout_feedback_captures": image_evidence,
                    "exact_colored_route_pixels": exact_content["colored_route_pixels"],
                    "reference_colored_route_pixels": exact_content["reference_colored_route_pixels"],
                    "published_partial_references": len(progressive),
                    "frame_p95_ms": percentile([item["frame_interval_ms"] for item in active], 0.95),
                    "max_frame_ms": max(item["frame_interval_ms"] for item in active),
                }
                if args.uncached_steps and step < 5 and record["full_response_cache_hit"] is not False:
                    failures.append(f"step {step}: uncached camera unexpectedly restored history")
                records.append(record)
                target_geometry.append(exact_geometry)
                print(json.dumps(record), flush=True)
                if unknown_fraction > 0.025:
                    failures.append(f"step {step}: transition is neither prior nor current exact geometry")
                if not exact_content["colored_reference_applicable"]:
                    failures.append(f"step {step}: completed layout reference has no colored routes")
                elif not exact_content["usable_layout_image"]:
                    failures.append(f"step {step}: completed screenshot has less than 25% of target route ink")
                if any(item["partial_insufficient_routes"] for item in image_evidence):
                    failures.append(f"step {step}: current partial has less than 25% of target route ink")
                if any(not item["usable_layout_image"] for item in image_evidence):
                    failures.append(f"step {step}: captured transition has less than 25% of target route ink")
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
            continuous_ranges = []
            before = len(read_samples(stats))
            for step in range(6):
                started = time.monotonic()
                if step == 5:
                    pointer.home(window)
                else:
                    pointer.wheel(-1)
                time.sleep(0.02)
                frame, first, last = capture_frame(
                    window, args.output, f"continuous-{step:02}", stats, direct,
                )
                continuous.append(frame)
                continuous_ranges.append((first, last))
                remaining = 0.08 - (time.monotonic() - started)
                if remaining > 0:
                    time.sleep(remaining)
            wait_ready(process, stats, args.timeout, before)
            for index, frame in enumerate(continuous):
                frame.save(args.output / f"continuous-{index:02}" / "screen.png")
            continuous_unknown = max(
                min(colored_difference(frame, reference) for reference in
                    (*references, *progress_references(args.output, records[step]["zoom"])))
                for step, frame in enumerate(continuous)
            ) / pixel_count
            if continuous_unknown > 0.025:
                failures.append("continuous zoom: frame does not match any completed camera")
            continuous_samples = read_samples(stats)
            continuous_content = []
            for step, (frame, (first, last)) in enumerate(zip(continuous, continuous_ranges)):
                # Compare each camera with its own completed geometry. Fit-view
                # route density is not the denominator for a high-zoom view.
                zoom = records[step]["zoom"]
                content = feedback_capture(
                    frame, target_geometry[step],
                    continuous_samples[max(before, first - 1):max(first, last)], zoom,
                )
                # A restored exact target can reach the window before another
                # stats line is written. An independent, identical target crop
                # establishes correctness even without a new partial flag.
                matches_target = ImageChops.difference(
                    layout(frame), layout(target_geometry[step]),
                ).getbbox() is None
                content["matches_completed_target_pixels"] = matches_target
                content["verified_current_layout"] = content["verified_current_layout"] or (
                    matches_target and content["usable_layout_image"]
                )
                continuous_content.append({"zoom": zoom, **content})
            if any(not item["usable_layout_image"] for item in continuous_content):
                failures.append("continuous zoom: captured layout has less than 25% of target route ink")
            if any(not item["verified_current_layout"] for item in continuous_content):
                failures.append("continuous zoom: capture does not establish current-camera routing")
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
                      "raster_trace_diagnostic": args.raster_trace or (args.output / "progress" / "ui").exists(),
                      "ui_seed_readback_diagnostic": (args.output / "progress" / "ui").exists(),
                      "uncached_steps": args.uncached_steps,
                      "capture_backend": "XGetImage" if args.direct_capture else "xwd",
                      "colored_layout_reference_required": True,
                      "minimum_reference_route_ink_fraction": 0.25,
                      "continuous_unrecognized_colored_pixel_fraction": continuous_unknown,
                      "continuous_layout_content": continuous_content,
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
    parser.add_argument(
        "--during-initial-load", action="store_true",
        help="zoom in and back to the full layout before the initial exact scene is ready",
    )
    parser.add_argument(
        "--settle-initial-exact", action="store_true",
        help="measure exact scene readiness after first-frame overview feedback",
    )
    parser.add_argument(
        "--fit-recovery-only", action="store_true",
        help="measure exact fit recovery after an uncached high-camera interaction",
    )
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
