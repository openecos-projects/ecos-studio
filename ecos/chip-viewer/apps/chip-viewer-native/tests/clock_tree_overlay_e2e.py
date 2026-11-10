#!/usr/bin/env python3
"""Native Chip Viewer E2E for Clock Tree overlay lifecycle.

Requires an X11 DISPLAY, libX11, libXtst, and xwd. The manifest must point to a
real geometry snapshot with clock-tree sidecars.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WINDOW_TITLE = b"Chip Viewer"
WIN_WIDTH = 1400
WIN_HEIGHT = 900
CLOCK_TREE_GREEN = (74, 222, 128)
CLOCK_TREE_ORANGE = (255, 166, 64)
CLOCK_TREE_OVERLAY_LIMIT = 100
CLOCK_TREE_OVERLAY_MINIMUM = 300


class Window:
    def __init__(self, window_id: int) -> None:
        self.id = window_id


def open_x11() -> ctypes.CDLL:
    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XQueryTree.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)),
        ctypes.POINTER(ctypes.c_uint),
    ]
    x11.XQueryTree.restype = ctypes.c_int
    x11.XFetchName.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_char_p),
    ]
    x11.XFetchName.restype = ctypes.c_int
    x11.XGetGeometry.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
    ]
    x11.XGetGeometry.restype = ctypes.c_int
    x11.XMoveResizeWindow.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_uint,
    ]
    x11.XMoveResizeWindow.restype = ctypes.c_int
    x11.XTranslateCoordinates.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_ulong),
    ]
    x11.XTranslateCoordinates.restype = ctypes.c_int
    x11.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    x11.XRaiseWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_uint
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XFree.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    return x11


def open_xtst() -> ctypes.CDLL:
    xtst = ctypes.CDLL("libXtst.so.6")
    xtst.XTestFakeMotionEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    xtst.XTestFakeButtonEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    xtst.XTestFakeKeyEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    return xtst


def window_geometry(x11: ctypes.CDLL, display: ctypes.c_void_p, window_id: int) -> tuple[int, int]:
    root = ctypes.c_ulong()
    x = ctypes.c_int()
    y = ctypes.c_int()
    width = ctypes.c_uint()
    height = ctypes.c_uint()
    border = ctypes.c_uint()
    depth = ctypes.c_uint()
    if not x11.XGetGeometry(
        display,
        window_id,
        ctypes.byref(root),
        ctypes.byref(x),
        ctypes.byref(y),
        ctypes.byref(width),
        ctypes.byref(height),
        ctypes.byref(border),
        ctypes.byref(depth),
    ):
        raise RuntimeError(f"cannot inspect X11 window {window_id:#x}")
    return width.value, height.value


def find_window(x11: ctypes.CDLL, display: ctypes.c_void_p) -> Window | None:
    root = x11.XDefaultRootWindow(display)
    pending = [root]
    candidates: list[Window] = []
    while pending:
        parent = pending.pop()
        root_return = ctypes.c_ulong()
        parent_return = ctypes.c_ulong()
        children = ctypes.POINTER(ctypes.c_ulong)()
        count = ctypes.c_uint()
        if not x11.XQueryTree(
            display,
            parent,
            ctypes.byref(root_return),
            ctypes.byref(parent_return),
            ctypes.byref(children),
            ctypes.byref(count),
        ):
            continue
        try:
            for index in range(count.value):
                child = int(children[index])
                name = ctypes.c_char_p()
                title = b""
                if x11.XFetchName(display, child, ctypes.byref(name)) and name.value:
                    title = name.value
                    x11.XFree(name)
                if title == WINDOW_TITLE:
                    candidates.append(Window(child))
                pending.append(child)
        finally:
            if children:
                x11.XFree(children)
    for candidate in candidates:
        if window_geometry(x11, display, candidate.id) == (800, 600):
            return candidate
    return candidates[-1] if candidates else None


def wait_for_window(
    x11: ctypes.CDLL,
    display: ctypes.c_void_p,
    process: subprocess.Popen[bytes],
    timeout: float = 30.0,
) -> Window:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Chip Viewer exited before opening a window: {process.returncode}")
        found = find_window(x11, display)
        if found is not None:
            return found
        time.sleep(0.2)
    raise TimeoutError("Chip Viewer window did not appear")


def window_origin(x11: ctypes.CDLL, display: ctypes.c_void_p, window_id: int) -> tuple[int, int]:
    root = x11.XDefaultRootWindow(display)
    x = ctypes.c_int()
    y = ctypes.c_int()
    child = ctypes.c_ulong()
    if not x11.XTranslateCoordinates(
        display,
        window_id,
        root,
        0,
        0,
        ctypes.byref(x),
        ctypes.byref(y),
        ctypes.byref(child),
    ):
        raise RuntimeError("cannot translate Chip Viewer coordinates")
    return x.value, y.value


def click(
    x11: ctypes.CDLL,
    xtst: ctypes.CDLL,
    display: ctypes.c_void_p,
    x: int,
    y: int,
) -> None:
    xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
    x11.XFlush(display)
    time.sleep(0.2)
    xtst.XTestFakeButtonEvent(display, 1, 1, 0)
    x11.XFlush(display)
    time.sleep(0.1)
    xtst.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
    time.sleep(0.5)


def press_escape(x11: ctypes.CDLL, xtst: ctypes.CDLL, display: ctypes.c_void_p) -> None:
    keycode = x11.XKeysymToKeycode(display, 0xFF1B)
    xtst.XTestFakeKeyEvent(display, keycode, 1, 0)
    x11.XFlush(display)
    time.sleep(0.2)
    xtst.XTestFakeKeyEvent(display, keycode, 0, 0)
    x11.XFlush(display)
    time.sleep(0.5)


def screenshot(window_id: int, output: Path) -> None:
    subprocess.run(
        ["xwd", "-silent", "-id", f"0x{window_id:x}", "-out", str(output)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def clock_tree_color_pixels(path: Path, target: tuple[int, int, int]) -> int:
    data = path.read_bytes()
    header = struct.unpack(">25I", data[:100])
    width = header[4]
    height = header[5]
    byte_order = header[7]
    bytes_per_line = header[12]
    ncolors = header[19]
    offset = header[0] + ncolors * 12
    pixels = data[offset:]
    count = 0
    for y in range(min(height, 440)):
        row = y * bytes_per_line
        for x in range(300, min(width, 1050)):
            index = row + x * 4
            first, green, third = pixels[index : index + 3]
            if byte_order == 0:
                blue, red = first, third
            else:
                red, blue = first, third
            if (red, green, blue) == target:
                count += 1
    return count


def scroll_up(
    x11: ctypes.CDLL,
    xtst: ctypes.CDLL,
    display: ctypes.c_void_p,
    x: int,
    y: int,
    steps: int,
) -> None:
    xtst.XTestFakeMotionEvent(display, -1, x, y, 0)
    x11.XFlush(display)
    time.sleep(0.2)
    for _ in range(steps):
        xtst.XTestFakeButtonEvent(display, 4, 1, 0)
        xtst.XTestFakeButtonEvent(display, 4, 0, 0)
        x11.XFlush(display)
        time.sleep(0.1)


def run(args: argparse.Namespace) -> None:
    if not os.environ.get("DISPLAY"):
        raise RuntimeError("DISPLAY is required for the native GUI E2E")
    display_name = os.environ["DISPLAY"]
    manifest = Path(args.manifest).resolve()
    if not manifest.is_file():
        raise FileNotFoundError(f"clock-tree manifest does not exist: {manifest}")
    binary = Path(args.binary).resolve()
    if not binary.is_file():
        raise FileNotFoundError(f"Chip Viewer binary does not exist: {binary}")

    out_dir = Path(args.output or tempfile.mkdtemp(prefix="ecos-clock-tree-e2e-", dir="/tmp"))
    out_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop("WAYLAND_DISPLAY", None)
    env.pop("WAYLAND_SOCKET", None)

    x11 = open_x11()
    xtst = open_xtst()
    display = x11.XOpenDisplay(display_name.encode())
    if not display:
        raise RuntimeError(f"cannot open X11 display {display_name}")
    process = subprocess.Popen(
        [str(binary), "--x11", "--egui-only", "--manifest", str(manifest)],
        cwd=str(binary.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        window = wait_for_window(x11, display, process)
        x11.XMoveResizeWindow(display, window.id, 100, 50, WIN_WIDTH, WIN_HEIGHT)
        x11.XFlush(display)
        time.sleep(1.0)
        width, height = window_geometry(x11, display, window.id)
        if width < 1300 or height < 800:
            raise RuntimeError(f"Chip Viewer window did not resize for E2E: {width}x{height}")
        origin_x, origin_y = window_origin(x11, display, window.id)

        x11.XSetInputFocus(display, window.id, 2, 0)
        x11.XRaiseWindow(display, window.id)
        x11.XFlush(display)
        time.sleep(5.0)

        before = out_dir / "clock-tree-before.xwd"
        screenshot(window.id, before)
        before_green = clock_tree_color_pixels(before, CLOCK_TREE_GREEN)
        before_orange = clock_tree_color_pixels(before, CLOCK_TREE_ORANGE)
        if before_green > CLOCK_TREE_OVERLAY_LIMIT or before_orange > CLOCK_TREE_OVERLAY_LIMIT:
            raise AssertionError(
                "unexpected clock-tree overlay before selection: "
                f"{before_green} green, {before_orange} orange pixels"
            )

        click(x11, xtst, display, origin_x + 76, origin_y + 259)
        time.sleep(0.8)
        # Unit-delay mode separates topology levels, making the first buffer's
        # input node selectable even though its arrival is close to the root.
        click(x11, xtst, display, origin_x + 740, origin_y + 493)
        time.sleep(0.8)
        scroll_up(x11, xtst, display, origin_x + 682, origin_y + 600, 12)
        time.sleep(0.8)
        # Fixture node: cts_flow_clk_0_clk_regular_root_buf/A. This node has
        # real parent clock-net geometry in the layout snapshot.
        click(x11, xtst, display, origin_x + 670, origin_y + 589)

        highlighted = out_dir / "clock-tree-highlighted.xwd"
        overlay_green = -1
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            screenshot(window.id, highlighted)
            overlay_green = clock_tree_color_pixels(highlighted, CLOCK_TREE_GREEN)
            if overlay_green >= CLOCK_TREE_OVERLAY_MINIMUM:
                break
            time.sleep(0.3)
        if overlay_green < CLOCK_TREE_OVERLAY_MINIMUM:
            raise AssertionError(
                f"clock-tree parent overlay did not render: {overlay_green} green pixels"
            )

        # Search refresh owns the generic highlight set as well as the role
        # overlay. It must clear both rather than leaving a fallback highlight.
        click(x11, xtst, display, origin_x + 1355, origin_y + 870)

        refreshed = out_dir / "clock-tree-refreshed.xwd"
        refreshed_green = -1
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            screenshot(window.id, refreshed)
            refreshed_green = clock_tree_color_pixels(refreshed, CLOCK_TREE_GREEN)
            if refreshed_green <= CLOCK_TREE_OVERLAY_LIMIT:
                break
            time.sleep(0.3)
        if refreshed_green > CLOCK_TREE_OVERLAY_LIMIT:
            raise AssertionError(
                f"clock-tree overlay was not cleared by search refresh: {refreshed_green} green pixels"
            )

        click(x11, xtst, display, origin_x + 670, origin_y + 589)
        rehighlighted = out_dir / "clock-tree-rehighlighted.xwd"
        rehighlighted_green = -1
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            screenshot(window.id, rehighlighted)
            rehighlighted_green = clock_tree_color_pixels(rehighlighted, CLOCK_TREE_GREEN)
            if rehighlighted_green >= CLOCK_TREE_OVERLAY_MINIMUM:
                break
            time.sleep(0.3)
        if rehighlighted_green < CLOCK_TREE_OVERLAY_MINIMUM:
            raise AssertionError(
                "clock-tree parent overlay did not return after reselection: "
                f"{rehighlighted_green} green pixels"
            )

        x11.XSetInputFocus(display, window.id, 2, 0)
        x11.XRaiseWindow(display, window.id)
        x11.XFlush(display)
        press_escape(x11, xtst, display)

        escaped = out_dir / "clock-tree-escaped.xwd"
        escaped_green = -1
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            screenshot(window.id, escaped)
            escaped_green = clock_tree_color_pixels(escaped, CLOCK_TREE_GREEN)
            if escaped_green <= CLOCK_TREE_OVERLAY_LIMIT:
                break
            time.sleep(0.3)
        if escaped_green > CLOCK_TREE_OVERLAY_LIMIT:
            raise AssertionError(
                f"clock-tree overlay was not cleared by Escape: {escaped_green} green pixels"
            )

        print(
            "clock-tree overlay E2E passed: "
            f"baseline={before_green}, highlighted={overlay_green}, "
            f"refreshed={refreshed_green}, escaped={escaped_green}, artifacts={out_dir}"
        )
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        stderr = process.stderr.read().decode(errors="replace") if process.stderr else ""
        if process.returncode not in (0, -15, 143):
            print(stderr[-4000:], file=sys.stderr)
        x11.XCloseDisplay(display)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        run(args)
    except Exception as error:
        print(f"clock-tree overlay E2E failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
