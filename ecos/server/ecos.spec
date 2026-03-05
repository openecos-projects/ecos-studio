# -*- mode: python ; coding: utf-8 -*-

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
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

# Server directory (ecos/server/)
SERVER_DIR = Path(SPECPATH)

# macOS code signing identity (optional)
CODESIGN_IDENTITY = os.environ.get("APPLE_SIGNING_IDENTITY")

# --- Collect ecc (chipcompiler) package from wheel ---
# The ecc wheel should be installed before running PyInstaller
ecc_datas, ecc_binaries, ecc_hiddenimports = collect_all("chipcompiler")

# --- Collect klayout package resources ---
klayout_datas, klayout_binaries, klayout_hiddenimports = collect_all("klayout")

# --- Data files ---
datas = []
datas.extend(ecc_datas)
datas.extend(klayout_datas)

# --- Binaries ---
binaries = []
binaries.extend(ecc_binaries)
binaries.extend(klayout_binaries)

# Add system libraries if needed (Linux)
if sys.platform.startswith("linux"):
    binaries.extend([
        ("/lib/x86_64-linux-gnu/libgomp.so.1", "lib"),
        ("/lib/x86_64-linux-gnu/libtbb.so.12", "lib"),
    ])

# --- Hidden imports ---
hiddenimports = [
    # Core dependencies
    "numpy",
    "pandas",
    "matplotlib",
    "scipy",
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
    "chipcompiler.server",
    "chipcompiler.server.main",
    "chipcompiler.utility.log",
    "chipcompiler.server.routers",
    "chipcompiler.server.schemas",
    "chipcompiler.server.services",
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
    "numpy._core._methods",
    "numpy.lib.format",
]
hiddenimports.extend(ecc_hiddenimports)
hiddenimports.extend(klayout_hiddenimports)
hiddenimports.extend(collect_submodules("ecos_server"))

# --- Analysis & packaging ---
a = Analysis(
    [str(SERVER_DIR / "run_server.py")],
    pathex=[str(SERVER_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "test"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="chipcompiler",
    strip=False,
    upx=True,
    console=True,
    codesign_identity=CODESIGN_IDENTITY,
)
