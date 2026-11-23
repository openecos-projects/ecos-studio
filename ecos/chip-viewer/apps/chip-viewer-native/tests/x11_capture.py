"""Copy lossless X11 window pixels without subprocesses or synchronous files."""

import ctypes
import ctypes.util

from PIL import Image


class XImage(ctypes.Structure):
    _fields_ = [
        ("width", ctypes.c_int), ("height", ctypes.c_int),
        ("xoffset", ctypes.c_int), ("format", ctypes.c_int),
        ("data", ctypes.c_void_p), ("byte_order", ctypes.c_int),
        ("bitmap_unit", ctypes.c_int), ("bitmap_bit_order", ctypes.c_int),
        ("bitmap_pad", ctypes.c_int), ("depth", ctypes.c_int),
        ("bytes_per_line", ctypes.c_int), ("bits_per_pixel", ctypes.c_int),
        ("red_mask", ctypes.c_ulong), ("green_mask", ctypes.c_ulong),
        ("blue_mask", ctypes.c_ulong),
    ]


class WindowCapture:
    def __init__(self):
        self.x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
        self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x11.XOpenDisplay.restype = ctypes.c_void_p
        self.x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.x11.XGetGeometry.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
            ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
            *[ctypes.POINTER(ctypes.c_uint)] * 4,
        ]
        self.x11.XGetImage.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
            ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int,
        ]
        self.x11.XGetImage.restype = ctypes.POINTER(XImage)
        self.x11.XDestroyImage.argtypes = [ctypes.POINTER(XImage)]
        self.display = self.x11.XOpenDisplay(None)
        assert self.display, "cannot open X11 capture display"

    def capture(self, window):
        assert self.display, "X11 capture display is closed"
        window = int(window, 16) if isinstance(window, str) else window
        root = ctypes.c_ulong()
        left, top = ctypes.c_int(), ctypes.c_int()
        width, height, border, depth = (ctypes.c_uint() for _ in range(4))
        assert self.x11.XGetGeometry(
            self.display, window, ctypes.byref(root), ctypes.byref(left),
            ctypes.byref(top), ctypes.byref(width), ctypes.byref(height),
            ctypes.byref(border), ctypes.byref(depth),
        ), "cannot query capture window geometry"
        image = self.x11.XGetImage(
            self.display, window, 0, 0, width.value, height.value,
            ctypes.c_ulong(-1).value, 2,
        )
        assert image, "cannot capture X11 window image"
        try:
            header = image.contents
            assert header.bits_per_pixel == 32, "capture requires 32-bit X11 pixels"
            assert (header.red_mask, header.green_mask, header.blue_mask) == (
                0xff0000, 0xff00, 0xff,
            ), "unsupported X11 RGB channel masks"
            assert header.xoffset == 0 and header.byte_order in (0, 1)
            data = ctypes.string_at(header.data, header.bytes_per_line * header.height)
            return Image.frombytes(
                "RGB", (header.width, header.height), data, "raw",
                "BGRX" if header.byte_order == 0 else "XRGB", header.bytes_per_line,
            )
        finally:
            self.x11.XDestroyImage(image)

    def close(self):
        if self.display:
            self.x11.XCloseDisplay(self.display)
            self.display = None
