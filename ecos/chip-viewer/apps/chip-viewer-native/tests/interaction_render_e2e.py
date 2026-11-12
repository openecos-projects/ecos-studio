#!/usr/bin/env python3
"""Exercise fullscreen, all-visible native pan/zoom using isolated X11 input."""

import argparse
import ctypes
import ctypes.util
import json
import math
import os
from pathlib import Path
import select
import statistics
import subprocess
import time

from PIL import Image, ImageChops

from static_render_e2e import read_samples, screenshot, viewer_window
from render_interaction_evidence import interaction_readiness


class IsolatedDisplay:
    def __init__(self, output, size):
        self.output = output
        self.size = size
        self.process = None
        self.previous = os.environ.get("DISPLAY")

    def __enter__(self):
        read_fd, write_fd = os.pipe()
        self.log = (self.output / "xephyr.log").open("w")
        try:
            self.process = subprocess.Popen(
                ["Xephyr", "-displayfd", str(write_fd), "-screen", self.size,
                 "-ac", "-noreset", "-no-host-grab", "-nolisten", "tcp"],
                pass_fds=(write_fd,), stdout=self.log, stderr=self.log,
            )
            os.close(write_fd)
            write_fd = None
            assert select.select([read_fd], [], [], 15)[0], "Xephyr startup timed out"
            number = os.read(read_fd, 64).decode().strip()
            assert number.isdecimal(), "Xephyr did not provide a display number"
            os.environ["DISPLAY"] = f":{number}"
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)

    def __exit__(self, *_):
        if self.previous is None:
            os.environ.pop("DISPLAY", None)
        else:
            os.environ["DISPLAY"] = self.previous
        if self.process is not None:
            stop(self.process)
        self.log.close()


class Pointer:
    def __init__(self):
        self.x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
        self.xtest = ctypes.CDLL(ctypes.util.find_library("Xtst"))
        self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x11.XOpenDisplay.restype = ctypes.c_void_p
        self.x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.x11.XMoveResizeWindow.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
            ctypes.c_uint, ctypes.c_uint,
        ]
        self.x11.XMapRaised.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XSetInputFocus.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong,
        ]
        self.x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.xtest.XTestFakeMotionEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong,
        ]
        self.xtest.XTestFakeButtonEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong,
        ]
        self.xtest.XTestFakeKeyEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong,
        ]
        self.display = self.x11.XOpenDisplay(None)
        assert self.display, "cannot open isolated X11 display"

    def fullscreen(self, window, size):
        width, height = map(int, size.split("x"))
        self.x11.XMoveResizeWindow(self.display, int(window, 16), 0, 0, width, height)
        self.x11.XMapRaised(self.display, int(window, 16))
        self.x11.XSync(self.display, 0)

    def move(self, position):
        assert self.xtest.XTestFakeMotionEvent(
            self.display, 0, round(position[0]), round(position[1]), 0,
        ), "cannot send pointer motion"
        self.x11.XSync(self.display, 0)

    def button(self, button, pressed):
        assert self.xtest.XTestFakeButtonEvent(
            self.display, button, int(pressed), 0,
        ), "cannot send pointer button"
        self.x11.XSync(self.display, 0)

    def wheel(self, direction):
        button = 4 if direction > 0 else 5
        self.button(button, True)
        self.button(button, False)

    def home(self, window):
        self.x11.XSetInputFocus(self.display, int(window, 16), 1, 0)
        keycode = self.x11.XKeysymToKeycode(self.display, 0xFF50)
        assert keycode, "Home key is unavailable"
        for pressed in (True, False):
            assert self.xtest.XTestFakeKeyEvent(self.display, keycode, pressed, 0)
        self.x11.XSync(self.display, 0)

    def close(self):
        for button in (1, 2, 3, 4, 5):
            self.button(button, False)
        self.x11.XCloseDisplay(self.display)


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def percentile(values, fraction):
    return sorted(values)[min(len(values) - 1, math.ceil(len(values) * fraction) - 1)]


def wait_ready(process, stats_path, timeout, after_sample=0):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        assert process.poll() is None, "viewer exited before completing the scene"
        samples = read_samples(stats_path)
        if len(samples) >= after_sample + 2 and all(
            sample.get("geometry_drawn_shapes", sample["drawn_shapes"]) > 0
            and not sample.get("scene_pending", sample.get("cpu_scene_pending", False))
            for sample in samples[-2:]
        ):
            return time.monotonic() - started
        time.sleep(0.02)
    raise TimeoutError("scene did not settle after interaction")


def capture(window, output, name):
    directory = output / name
    directory.mkdir(exist_ok=True)
    return screenshot(window, directory)


def changed_pixels(first, second):
    assert first.size == second.size, "viewport dimensions changed"
    width, height = first.size
    bounds = (350, 110, width - 440, height - 90)
    return sum(
        pixel != (0, 0, 0)
        for pixel in ImageChops.difference(first.crop(bounds), second.crop(bounds)).getdata()
    )


def layout_ink_pixels(image):
    width, height = image.size
    return sum(
        max(pixel) - min(pixel) > 24 and max(pixel) > 80
        for pixel in image.crop((350, 110, width - 440, height - 90)).getdata()
    )


def run_scenario(name, action, process, window, stats_path, output, timeout):
    before = read_samples(stats_path)
    started = time.monotonic()
    action(lambda: capture(window, output, f"{name}-during"))
    active = read_samples(stats_path)[len(before):]
    while len(active) < 2 and time.monotonic() - started < timeout:
        assert process.poll() is None, "viewer exited during input"
        time.sleep(0.02)
        active = read_samples(stats_path)[len(before):]
    released_at = time.monotonic()
    settle = wait_ready(process, stats_path, timeout, len(before) + len(active))
    time.sleep(0.1)
    after = read_samples(stats_path)
    image = capture(window, output, f"{name}-after")
    active_intervals = [sample["frame_interval_ms"] for sample in active]
    assert active_intervals, f"no frames during {name}"
    presented = [
        sample.get("geometry_drawn_shapes", sample["drawn_shapes"]) > 0
        if sample["is_gpu"] else sample.get("cpu_scene_visible", False)
        for sample in active
    ]
    return {
        "name": name,
        "first_sample": len(before),
        "last_sample": len(after),
        "active_frames": len(active),
        "active_seconds": released_at - started,
        "active_p50_frame_ms": statistics.median(active_intervals),
        "active_p95_frame_ms": percentile(active_intervals, 0.95),
        "active_max_frame_ms": max(active_intervals),
        "active_max_canvas_ms": max(sample["frame_time_ms"] for sample in active),
        "max_frame_ms_including_settle": max(
            sample["frame_interval_ms"] for sample in after[len(before):]
        ),
        "geometry_visible_fraction": sum(presented) / len(presented),
        "pending_fraction": sum(sample.get("scene_pending", sample.get("cpu_scene_pending", False)) for sample in active) / len(active),
        "preview_fraction": sum(sample.get("cpu_scene_preview", False) for sample in active) / len(active),
        "settle_seconds": settle,
        "final_zoom": after[-1]["zoom"],
        "min_active_zoom": min(sample["zoom"] for sample in active),
        "max_active_zoom": max(sample["zoom"] for sample in active),
        "final_drawn_shapes": after[-1]["drawn_shapes"],
        "selected_shape_ids": sorted({
            sample["selected_shape_id"] for sample in after[len(before):]
            if sample.get("selected_shape_id") is not None
        }),
        "rasterizations_during": after[-1].get("cpu_rasterizations", 0)
        - before[-1].get("cpu_rasterizations", 0),
        "no_overview_substitution": all(not sample["use_view_tiles"] for sample in after[len(before):]),
        **interaction_readiness(active),
    }, image


def run(args):
    stats_path = args.output / "stats.jsonl"
    stats_path.unlink(missing_ok=True)
    environment = dict(os.environ)
    for name in list(environment):
        if name.startswith(("ECOS_PERF_", "ECOS_RENDER_")) or name == "ECOS_FORCE_CPU":
            del environment[name]
    environment.update(
        ECOS_PERF_ALL_VISIBLE="1", ECOS_PERF_FULLSCREEN="1", ECOS_PERF_INITIAL_ZOOM="1",
        ECOS_PERF_BENCHMARK="1", ECOS_RENDER_STATS_LOG=str(stats_path.resolve()),
    )
    if args.presentation_trace:
        trace_path = args.output / "presentation.jsonl"
        trace_path.unlink(missing_ok=True)
        environment["ECOS_RENDER_PRESENT_TRACE"] = str(trace_path.resolve())
    if args.raster_trace:
        trace_path = args.output / "raster.jsonl"
        trace_path.unlink(missing_ok=True)
        environment["ECOS_RENDER_RASTER_TRACE"] = str(trace_path.resolve())
    scenarios = []
    with (args.output / "viewer.log").open("w") as log:
        process = subprocess.Popen(
            [str(args.binary.resolve()), "--manifest", str(args.manifest.resolve()), "--x11"],
            env=environment, stdout=log, stderr=log,
        )
        pointer = Pointer()
        try:
            started = time.monotonic()
            window = None
            while window is None and time.monotonic() - started < args.timeout:
                assert process.poll() is None, "viewer exited during startup"
                window = viewer_window(process.pid)
                time.sleep(0.05)
            assert window, "cannot locate the test viewer's own window"
            pointer.fullscreen(window, args.size)
            time.sleep(0.1)
            wait_ready(process, stats_path, args.timeout)
            initial_ready = time.monotonic() - started
            time.sleep(0.2)
            initial = capture(window, args.output, "initial")
            initial_ink = layout_ink_pixels(initial)
            assert initial_ink > 1000, "initial completed frame does not contain the layout"
            width, height = initial.size
            assert (width, height) == tuple(map(int, args.size.split("x"))), "viewer is not fullscreen"
            center = (width // 2, height // 2)
            pointer.move(center)
            time.sleep(0.1)

            def drag(button, during):
                pointer.move(center)
                pointer.button(button, True)
                try:
                    for step in range(1, 121):
                        distance = step if step <= 60 else 120 - step
                        pointer.move((center[0] + distance * 3, center[1] + distance))
                        time.sleep(1 / 60)
                        if step == 60:
                            during()
                finally:
                    pointer.button(button, False)

            def zoom(directions, during):
                pointer.move(center)
                for index, direction in enumerate(directions):
                    pointer.wheel(direction)
                    time.sleep(0.08)
                    if index == len(directions) // 2:
                        during()

            def select_shapes(during):
                for index, offset in enumerate([(-80, -50), (40, 30), (100, -80), (-40, 70)]):
                    pointer.move((center[0] + offset[0], center[1] + offset[1]))
                    pointer.button(1, True)
                    pointer.button(1, False)
                    time.sleep(0.15)
                    if index == 1:
                        during()

            actions = [
                ("left-drag", lambda during: drag(1, during)),
                ("middle-drag", lambda during: drag(2, during)),
                ("right-drag", lambda during: drag(3, during)),
                ("zoom-in", lambda during: zoom([1] * 6, during)),
                ("zoom-out", lambda during: zoom([-1] * 6, during)),
                ("alternating-zoom", lambda during: zoom([1, -1] * 12, during)),
                ("fit-to-view", lambda during: pointer.home(window)),
                ("selection", select_shapes),
            ]
            for name, action in actions:
                if args.scenario and name != args.scenario:
                    continue
                measured_action = lambda during: action(
                    (lambda: None) if args.skip_during_screenshots else during
                )
                result, image = run_scenario(
                    name, measured_action, process, window, stats_path, args.output, args.timeout,
                )
                if "drag" in name and not args.skip_during_screenshots:
                    during = Image.open(args.output / f"{name}-during" / "screen.png").convert("RGB")
                    result["changed_during_pixels"] = changed_pixels(initial, during)
                    result["visible_layout_pixels_during"] = layout_ink_pixels(during)
                if name == "fit-to-view":
                    result["returned_layout_pixels"] = changed_pixels(initial, image)
                scenarios.append(result)
                print(json.dumps(result), flush=True)
            samples = read_samples(stats_path)
            report = {
                "presentation_trace_diagnostic": args.presentation_trace,
                "raster_trace_diagnostic": args.raster_trace,
                "initial_geometry_ready_seconds": initial_ready,
                "display_size": list(initial.size),
                "is_gpu": samples[-1]["is_gpu"],
                "initial_layout_pixels": initial_ink,
                "during_screenshots": not args.skip_during_screenshots,
                "max_frame_interval_ms": max(sample["frame_interval_ms"] for sample in samples[1:]),
                "scenarios": scenarios,
            }
            failures = []
            for scenario in scenarios:
                name = scenario["name"]
                if scenario["active_p95_frame_ms"] >= args.max_p95_ms:
                    failures.append(f"{name}: p95 frame exceeds {args.max_p95_ms} ms")
                if scenario["max_frame_ms_including_settle"] >= args.max_stall_ms:
                    failures.append(f"{name}: frame stalls beyond {args.max_stall_ms} ms")
                if scenario["geometry_visible_fraction"] < 0.95:
                    failures.append(f"{name}: geometry disappears during input")
                if scenario["settle_seconds"] >= args.max_settle_seconds:
                    failures.append(f"{name}: exact scene takes too long after input")
                if args.max_proxy_run_ms is not None and (
                    scenario["max_old_view_or_empty_run_ms"] is None
                    or scenario["max_old_view_or_empty_run_ms"] > args.max_proxy_run_ms
                ):
                    failures.append(f"{name}: current-camera geometry absent beyond {args.max_proxy_run_ms} ms during input")
                if not scenario["no_overview_substitution"]:
                    failures.append(f"{name}: overview substituted for exact geometry")
                if "changed_during_pixels" in scenario and scenario["changed_during_pixels"] < 1000:
                    failures.append(f"{name}: drag did not move the layout")
                if "visible_layout_pixels_during" in scenario and scenario["visible_layout_pixels_during"] < initial_ink * 0.25:
                    failures.append(f"{name}: screenshot lost the visible layout")
                if name == "fit-to-view" and scenario["returned_layout_pixels"] != 0:
                    failures.append(f"{name}: settled layout pixels differ from initial exact scene")
                if name == "selection":
                    if len(scenario["selected_shape_ids"]) < 2:
                        failures.append("selection: clicks did not select different shapes")
                    if scenario["rasterizations_during"] != 0:
                        failures.append("selection: selecting shapes rerasterized the layout")
                    if scenario["preview_fraction"] != 0:
                        failures.append("selection: complete geometry was replaced by a preview")
            if any(scenario["name"] == "zoom-in" and scenario["final_zoom"] <= 1.1 for scenario in scenarios):
                failures.append("wheel input did not zoom in")
            if any(scenario["name"] == "zoom-out" and abs(scenario["final_zoom"] - 1) > 0.00001 for scenario in scenarios):
                failures.append("wheel input did not return to the initial zoom")
            report["failures"] = failures
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            assert not failures, "\n".join(failures)
        finally:
            pointer.close()
            stop(process)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", default="2048x1280")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--max-p95-ms", type=float, default=50)
    parser.add_argument("--max-stall-ms", type=float, default=250)
    parser.add_argument("--max-settle-seconds", type=float, default=1)
    parser.add_argument("--max-proxy-run-ms", type=float)
    parser.add_argument("--skip-during-screenshots", action="store_true")
    parser.add_argument("--presentation-trace", action="store_true")
    parser.add_argument("--raster-trace", action="store_true")
    parser.add_argument("--scenario", choices=[
        "left-drag", "middle-drag", "right-drag", "zoom-in", "zoom-out",
        "alternating-zoom", "fit-to-view",
        "selection",
    ])
    args = parser.parse_args()
    if args.max_proxy_run_ms is not None and (
        not math.isfinite(args.max_proxy_run_ms) or args.max_proxy_run_ms < 0
    ):
        parser.error("--max-proxy-run-ms must be finite and nonnegative")
    args.output.mkdir(parents=True, exist_ok=True)
    with IsolatedDisplay(args.output, args.size):
        run(args)


if __name__ == "__main__":
    main()
