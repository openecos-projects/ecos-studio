import ctypes
import os
from pathlib import Path
import tempfile
import unittest

from interaction_render_e2e import IsolatedDisplay
from static_render_e2e import screenshot
from x11_capture import WindowCapture


@unittest.skipUnless(os.environ.get("ECOS_REQUIRE_CAPTURE_X11"), "requires isolated Xephyr capture oracle")
class DirectCaptureTests(unittest.TestCase):
    def test_complete_window_pixels_match_independent_xwd_at_all_sizes(self):
        with tempfile.TemporaryDirectory(prefix="ecos-capture-oracle-") as directory:
            output = Path(directory)
            with IsolatedDisplay(output, "2048x1280"):
                capture = WindowCapture()
                x11, display = capture.x11, capture.display
                x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
                x11.XDefaultRootWindow.restype = ctypes.c_ulong
                x11.XCreateSimpleWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong,
                    ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint,
                    ctypes.c_uint, ctypes.c_ulong, ctypes.c_ulong]
                x11.XCreateSimpleWindow.restype = ctypes.c_ulong
                x11.XMapWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
                x11.XCreateGC.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
                x11.XCreateGC.restype = ctypes.c_void_p
                x11.XSetForeground.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
                x11.XFillRectangle.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p,
                    ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint]
                x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
                x11.XFreeGC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
                x11.XDestroyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
                try:
                    for width, height in [(513, 317), (1024, 768), (2048, 1280)]:
                        window = x11.XCreateSimpleWindow(display, x11.XDefaultRootWindow(display),
                            0, 0, width, height, 0, 0, 0x123456)
                        context = x11.XCreateGC(display, window, 0, None)
                        try:
                            x11.XMapWindow(display, window)
                            for index, color in enumerate([0xff0000, 0x00ff00, 0x0000ff, 0xffffff, 0x5937b1]):
                                x11.XSetForeground(display, context, color)
                                x11.XFillRectangle(display, window, context,
                                    index * 17, index * 23, 71, 109)
                            x11.XSync(display, 0)
                            expected = screenshot(hex(window), output, compress_level=None)
                            for _ in range(3):
                                actual = capture.capture(window)
                                self.assertEqual(actual.size, (width, height))
                                self.assertTrue(actual.tobytes() == expected.tobytes(),
                                    f"complete RGB differs at {width}x{height}")
                        finally:
                            x11.XFreeGC(display, context)
                            x11.XDestroyWindow(display, window)
                finally:
                    capture.close()
