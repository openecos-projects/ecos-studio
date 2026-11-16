#!/usr/bin/env python3
"""Benchmark an idle, fullscreen, all-visible exact 2D scene on X11.

Requires xwininfo, xprop, xwd and Pillow. No pointer or keyboard input is sent.
"""

import argparse
import ctypes
import ctypes.util
import json
import os
import re
import statistics
import struct
import subprocess
import time
from pathlib import Path

from PIL import Image, ImageChops


def viewer_window(process_id):
    tree = subprocess.check_output(["xwininfo", "-root", "-tree"], text=True)
    for window_id in re.findall(r'(0x[0-9a-f]+) "Chip Viewer"', tree):
        properties = subprocess.check_output(
            ["xprop", "-id", window_id, "_NET_WM_PID"], text=True
        )
        if re.search(rf"= {process_id}\s*$", properties):
            return window_id
    return None


def resize_window(window_id, size):
    width, height = map(int, size.split("x"))
    x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XMoveResizeWindow.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
        ctypes.c_uint, ctypes.c_uint,
    ]
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(None)
    assert display, "cannot open X11 display"
    try:
        x11.XMoveResizeWindow(display, int(window_id, 16), 0, 0, width, height)
        x11.XSync(display, 0)
    finally:
        x11.XCloseDisplay(display)


def screenshot(window_id, output, *, compress_level=6):
    dump = output / "screen.xwd"
    subprocess.run(["xwd", "-silent", "-id", window_id, "-out", str(dump)], check=True)
    data = dump.read_bytes()
    header = struct.unpack(">25I", data[:100])
    width, height, byte_order, bits_per_pixel, stride = (
        header[4], header[5], header[7], header[11], header[12]
    )
    assert bits_per_pixel == 32, f"unsupported XWD pixel format: {bits_per_pixel}"
    pixels = data[header[0] + header[19] * 12 :]
    image = Image.frombytes(
        "RGB", (width, height), pixels, "raw", "BGRX" if byte_order == 0 else "XRGB", stride
    )
    if compress_level is not None:
        image.save(output / "screen.png", compress_level=compress_level)
    return image


def read_samples(path):
    if not path.exists():
        return []
    lines = path.read_text().splitlines()
    return [json.loads(line) for line in lines if line.endswith("}")]


def peak_rss_kib(process_id):
    try:
        status = (Path("/proc") / str(process_id) / "status").read_text()
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        return None
    for line in status.splitlines():
        if line.startswith("VmHWM:"):
            return int(line.split()[1])
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--zoom", type=float, default=1)
    parser.add_argument("--size", help="set and verify viewport size, for example 2048x1280")
    parser.add_argument("--max-frame-ms", type=float, default=100)
    parser.add_argument("--max-frame-interval-ms", type=float, default=1000)
    parser.add_argument("--max-warm-p95-ms", type=float, default=50)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--raster-trace", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    stats_path = args.output / "stats.jsonl"
    stats_path.unlink(missing_ok=True)
    environment = dict(os.environ)
    for name in list(environment):
        if name.startswith(("ECOS_PERF_", "ECOS_RENDER_")) or name == "ECOS_FORCE_CPU":
            del environment[name]
    environment.update(
        ECOS_PERF_ALL_VISIBLE="1",
        ECOS_PERF_FULLSCREEN="1",
        ECOS_PERF_INITIAL_ZOOM=str(args.zoom),
        ECOS_PERF_BENCHMARK="1",
        ECOS_PERF_BENCHMARK_MS="8000",
        ECOS_RENDER_STATS_LOG=str(stats_path.resolve()),
    )
    if args.raster_trace:
        trace_path = args.output / "raster.jsonl"
        trace_path.unlink(missing_ok=True)
        environment["ECOS_RENDER_RASTER_TRACE"] = str(trace_path.resolve())
    started = time.monotonic()
    captured = False
    first_geometry_seconds = None
    window_id = None
    peak_viewer_rss_kib = None
    with (args.output / "viewer.log").open("w") as log:
        process = subprocess.Popen(
            [str(args.binary.resolve()), "--manifest", str(args.manifest.resolve()), "--x11"],
            env=environment, stdout=log, stderr=log,
        )
        try:
            while process.poll() is None:
                rss = peak_rss_kib(process.pid)
                if rss is not None:
                    peak_viewer_rss_kib = max(peak_viewer_rss_kib or 0, rss)
                if window_id is None:
                    window_id = viewer_window(process.pid)
                    if window_id and args.size:
                        resize_window(window_id, args.size)
                samples = read_samples(stats_path)
                ready = [item for item in samples if item["drawn_shapes"] > 0
                         and item.get("geometry_drawn_shapes", item["drawn_shapes"]) > 0
                         and not item.get("scene_pending", item.get("cpu_scene_pending", False))]
                if ready and first_geometry_seconds is None:
                    first_geometry_seconds = time.monotonic() - started
                if len(ready) >= 2 and not captured:
                    window_id = viewer_window(process.pid)
                    if window_id:
                        time.sleep(0.5)
                        image = screenshot(window_id, args.output)
                        if args.size:
                            assert image.size == tuple(map(int, args.size.split("x"))), \
                                "viewer did not reach the requested fullscreen dimensions"
                        captured = True
                if time.monotonic() - started > args.timeout:
                    raise TimeoutError("viewer did not complete the idle benchmark")
                time.sleep(0.1)
            assert process.returncode == 0, f"viewer exited with {process.returncode}"
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    samples = read_samples(stats_path)
    ready = [item for item in samples if item["drawn_shapes"] > 0
             and item.get("geometry_drawn_shapes", item["drawn_shapes"]) > 0
             and not item.get("scene_pending", item.get("cpu_scene_pending", False))]
    assert len(ready) >= 2, "no complete exact scene rendered"
    assert captured, "no viewer screenshot captured"
    frames = [item["frame_time_ms"] for item in samples]
    complete_frames = [item["frame_time_ms"] for item in ready]
    intervals = [item["frame_interval_ms"] for item in samples[1:]]
    warm_intervals = sorted(item["frame_interval_ms"] for item in ready[2:])
    report = {
        "raster_trace_diagnostic": args.raster_trace,
        "frames": len(samples),
        "complete_frames": len(ready),
        "max_canvas_ms": max(frames),
        "median_canvas_ms": statistics.median(frames),
        "median_complete_canvas_ms": statistics.median(complete_frames),
        "max_frame_interval_ms": max(intervals),
        "first_geometry_ready_seconds": first_geometry_seconds,
        "background_scene_build_ms": ready[-1].get("cpu_scene_build_ms", 0),
        "background_scene_raster_ms": ready[-1].get("cpu_scene_raster_ms", 0),
        "background_label_resolve_ms": ready[-1].get("cpu_label_resolve_ms", 0),
        "max_label_resolve_ms": max(item.get("label_resolve_time_ms", 0) for item in samples),
        "max_raster_present_ms": max(item.get("previous_raster_present_ms", 0) for item in samples),
        "cpu_rasterizations": ready[-1].get("cpu_rasterizations", 0),
        "median_warm_frame_interval_ms": statistics.median(warm_intervals) if warm_intervals else None,
        "p95_warm_frame_interval_ms": warm_intervals[min(len(warm_intervals) - 1, int(len(warm_intervals) * .95))] if warm_intervals else None,
        "drawn_shapes": ready[-1]["drawn_shapes"],
        "estimated_primitives": ready[-1]["estimated_primitives"],
        "exact_ready_frames": sum(not item["use_view_tiles"] for item in ready),
        "overview_feedback_frames": sum(item["use_view_tiles"] for item in samples),
        "exact_all_frames": all(not item["use_view_tiles"] for item in ready),
        "is_gpu": ready[-1]["is_gpu"],
        "peak_viewer_rss_kib": peak_viewer_rss_kib,
    }
    if args.reference:
        reference_report_path = args.reference.with_name("report.json")
        if reference_report_path.exists():
            reference_report = json.loads(reference_report_path.read_text())
            for field in ("drawn_shapes", "estimated_primitives"):
                assert report[field] == reference_report[field], f"{field} differs from reference"
        reference = Image.open(args.reference).convert("RGB")
        assert image.size == reference.size, "reference viewport size differs"
        width, height = image.size
        bounds = (350, 110, width - 440, height - 90)
        difference = ImageChops.difference(image.crop(bounds), reference.crop(bounds))
        report["changed_layout_pixels"] = sum(
            pixel != (0, 0, 0) for pixel in difference.getdata()
        )
        difference.save(args.output / "layout-diff.png")
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    assert report["exact_all_frames"], "approximate overview remained after exact geometry settled"
    if report["cpu_rasterizations"]:
        assert all(item["cpu_rasterizations"] == ready[0]["cpu_rasterizations"] for item in ready), \
            "unchanged complete scene was rasterized again"
    if args.reference:
        assert report["changed_layout_pixels"] == 0, "layout pixels differ from reference"
    assert max(frames) < args.max_frame_ms, "UI canvas blocks beyond its frame budget"
    assert max(intervals) < args.max_frame_interval_ms, "idle frame stalls beyond its budget"
    assert report["p95_warm_frame_interval_ms"] is not None, "not enough completed warm frames"
    assert report["p95_warm_frame_interval_ms"] < args.max_warm_p95_ms, "warm completed scene exceeds its frame budget"


if __name__ == "__main__":
    main()
