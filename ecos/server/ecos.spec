"""
PyInstaller spec file for ECOS Studio API Server.

This packages ecos_server as a backend API server (onefile mode).
The main user interface is provided by the GUI (Tauri app).

Prerequisites:
    - Install ecc wheel: pip install ../../ecc/dist/ecc-*.whl
    - Or build wheel first: cd ../../ecc && bazel build //:build_wheel

Usage:
    pyinstaller ecos.spec
"""

import os
import sys
import warnings
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata

# Server directory (ecos/server/)
SERVER_DIR = Path(SPECPATH)

# PyInstaller hooks directory
HOOKS_DIR = SERVER_DIR / "hooks"

# macOS code signing identity (optional)
CODESIGN_IDENTITY = os.environ.get("APPLE_SIGNING_IDENTITY")

REQUIRED_DISTRIBUTION_METADATA = (
    "ecos-server",
    "ecc",
    "ecc-dreamplace",
    "ecc-tools",
)

# --- Collect ecc (chipcompiler) package from wheel ---
# The ecc wheel should be installed before running PyInstaller
ecc_datas, ecc_binaries, ecc_hiddenimports = collect_all("chipcompiler")

# --- Collect klayout package resources ---
klayout_datas, klayout_binaries, klayout_hiddenimports = collect_all("klayout")

# --- Collect PyTorch (DreamPlace dependency) ---
try:
    torch_datas, torch_binaries, torch_hiddenimports = collect_all("torch")
except Exception as exc:
    warnings.warn(
        f"Failed to collect torch package: {exc}. "
        "DreamPlace placement will not work in the packaged binary.",
        stacklevel=1,
    )
    torch_datas, torch_binaries, torch_hiddenimports = [], [], []

# --- Collect DreamPlace (ecc-dreamplace) package ---
try:
    dp_datas, dp_binaries, dp_hiddenimports = collect_all("dreamplace")
except Exception as exc:
    warnings.warn(
        f"Failed to collect dreamplace package: {exc}. "
        "DreamPlace placement will not work in the packaged binary.",
        stacklevel=1,
    )
    dp_datas, dp_binaries, dp_hiddenimports = [], [], []

# --- Data files ---
datas = []
datas.extend(ecc_datas)
datas.extend(klayout_datas)
datas.extend(torch_datas)
datas.extend(dp_datas)

# Bundle required distribution metadata so the packaged runtime can resolve
# installed versions via importlib.metadata; this is not for module imports.
for dist_name in REQUIRED_DISTRIBUTION_METADATA:
    try:
        datas.extend(copy_metadata(dist_name))
    except Exception as exc:
        raise SystemExit(
            f"Missing required distribution metadata for '{dist_name}'. "
            "Ensure the build environment has the locked dependencies installed."
        ) from exc

# DreamPlace ships thirdparty data files that native C++ code opens via fixed
# relative paths (e.g. thirdparty/flute/lut.ICCAD2015/POWV9.dat).  These are
# NOT included in the dreamplace wheel, so collect_all() cannot find them.
# We locate them from the source tree and bundle them at the expected paths.
# (run_server.py sets CWD to _MEIPASS so the relative open() resolves.)
_dreamplace_thirdparty = (
    Path(SPECPATH).parent.parent
    / "ecc"
    / "chipcompiler"
    / "thirdparty"
    / "ecc-dreamplace"
    / "thirdparty"
)


def _collect_thirdparty_files(subdir, targets, warning_msg):
    """Collect files from a DreamPlace thirdparty subdirectory into datas."""
    src_dir = _dreamplace_thirdparty / subdir
    bundle_dest = f"thirdparty/{subdir}"
    found = set()
    for fname in targets:
        src = src_dir / fname
        if src.exists():
            datas.append((str(src), bundle_dest))
            found.add(fname)
    if found != targets:
        warnings.warn(f"{warning_msg} (missing from {src_dir})", stacklevel=2)


_collect_thirdparty_files(
    "flute/lut.ICCAD2015",
    {"POWV9.dat", "POST9.dat"},
    "DreamPlace FLUTE LUT files not found; placement may fail at runtime.",
)
_collect_thirdparty_files(
    "NCTUgr.ICCAD2012",
    {"NCTUgr", "PORT9.dat", "POST9.dat", "POWV9.dat", "DAC12.set", "ICCAD12.set"},
    "DreamPlace NCTUgr files not found; routability optimization will fail at runtime.",
)

# --- Binaries ---
binaries = []
binaries.extend(ecc_binaries)
binaries.extend(klayout_binaries)
binaries.extend(torch_binaries)
binaries.extend(dp_binaries)

# Add system libraries if needed (Linux)
if sys.platform.startswith("linux"):
    # In onefile mode, PyInstaller exposes bundled shared libraries from _MEIPASS.
    # Put required .so files at extraction root (".") so the dynamic loader can
    # resolve dreamplace C++ op dependencies (e.g. draw_place_cpp -> libxcb.so.1).
    linux_runtime_libs = [
        "/lib/x86_64-linux-gnu/libgomp.so.1",
        "/lib/x86_64-linux-gnu/libtbb.so.12",
        # draw_place_cpp.so dependencies (Cairo/X11 rendering)
        "/lib/x86_64-linux-gnu/libcairo.so.2",
        "/lib/x86_64-linux-gnu/libX11.so.6",
        "/lib/x86_64-linux-gnu/libxcb.so.1",
        "/lib/x86_64-linux-gnu/libxcb-render.so.0",
        "/lib/x86_64-linux-gnu/libxcb-shm.so.0",
        "/lib/x86_64-linux-gnu/libpng16.so.16",
        "/lib/x86_64-linux-gnu/libfreetype.so.6",
    ]
    for so_path in linux_runtime_libs:
        if Path(so_path).exists():
            binaries.append((so_path, "."))
        else:
            warnings.warn(
                f"Optional runtime library not found and will not be bundled: {so_path}",
                stacklevel=1,
            )

# --- Hidden imports ---
hiddenimports = [
    # Core dependencies
    "numpy",
    "pandas",
    "matplotlib",
    "scipy",
    "torch",
    "pyjson5",
    "yaml",
    "tqdm",
    "klayout",
    "fastapi",
    "uvicorn",
    "starlette",
    "pydantic",
    "anyio",
    # uvicorn internals
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "anyio._backends",
    "anyio._backends._asyncio",
    # ChipCompiler modules
    "chipcompiler",
    "chipcompiler.utility.log",
    "chipcompiler.data",
    "chipcompiler.engine",
    "chipcompiler.tools",
    "chipcompiler.tools.ecc",
    "chipcompiler.tools.ecc.builder",
    "chipcompiler.tools.ecc.runner",
    "chipcompiler.tools.ecc.module",
    "chipcompiler.tools.ecc.bin.ecc_py",
    "chipcompiler.tools.yosys",
    "chipcompiler.tools.yosys.builder",
    "chipcompiler.tools.yosys.runner",
    "chipcompiler.tools.yosys.utility",
    "chipcompiler.tools.klayout_tool",
    "chipcompiler.tools.klayout_tool.builder",
    "chipcompiler.tools.klayout_tool.runner",
    "chipcompiler.tools.klayout_tool.module",
    "chipcompiler.tools.klayout_tool.utility",
    # Multiprocessing support
    "multiprocessing",
    "multiprocessing.process",
    "multiprocessing.spawn",
    # Submodules PyInstaller misses
    "scipy.special",
    "scipy.linalg",
    "scipy.sparse",
    "matplotlib.backends.backend_agg",
    # NumPy runtime modules commonly imported from pybind11/C-extensions
    # (DreamPlace ops may import legacy path `numpy.core.multiarray`)
    "numpy.core",
    "numpy.core.multiarray",
    "numpy.core._multiarray_umath",
    "numpy.core.umath",
    "numpy._core._methods",
    "numpy._core.multiarray",
    "numpy.lib.format",
]
hiddenimports.extend(ecc_hiddenimports)
hiddenimports.extend(klayout_hiddenimports)
hiddenimports.extend(torch_hiddenimports)
hiddenimports.extend(dp_hiddenimports)
hiddenimports.extend(
    [
        "ecos_server",
        "ecos_server.main",
        "ecos_server.ecc",
        "ecos_server.ecc.routers",
        "ecos_server.ecc.routers.sse",
        "ecos_server.ecc.routers.workspace",
        "ecos_server.ecc.schemas",
        "ecos_server.ecc.schemas.ecc",
        "ecos_server.ecc.schemas.info",
        "ecos_server.ecc.services",
        "ecos_server.ecc.services.ecc",
        "ecos_server.ecc.services.info",
        "ecos_server.ecc.sse",
        "ecos_server.ecc.sse.models",
        "ecos_server.ecc.sse.notify_service",
        "ecos_server.sse",
        "ecos_server.sse.manager",
    ]
)

# --- Analysis & packaging ---
a = Analysis(
    [str(SERVER_DIR / "run_server.py")],
    pathex=[str(SERVER_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[str(HOOKS_DIR)],
    excludes=[
        "tkinter",
        "test",
        "chipcompiler.thirdparty.ecc_tools",
        "setuptools",
        "_distutils_hack",
        "mypy",
        "pip",
        "pkg_resources",
    ],
    noarchive=False,
)

# Remove ecc-tools files that collect_all("chipcompiler") pulled in.
# The needed ECC binaries (ecc_py*.so, lib/*.so) are already collected via
# collect_all into ecc_binaries, but the full ecc-tools source tree
# (~1.1 GB of build scripts/src/docs) is not needed at runtime.
a.datas = [d for d in a.datas if not d[0].startswith("chipcompiler/thirdparty/ecc-tools")]
a.binaries = [b for b in a.binaries if not b[0].startswith("chipcompiler/thirdparty/ecc-tools")]

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="ecos-server",
    strip=False,
    upx=True,
    console=True,
    codesign_identity=CODESIGN_IDENTITY,
)
