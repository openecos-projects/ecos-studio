#!/usr/bin/env python

import os
import sys
import time
from contextlib import asynccontextmanager
from functools import lru_cache
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as distribution_version

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ecc import sse_router, workspace_router


def _read_distribution_version(dist_name: str) -> str:
    try:
        return distribution_version(dist_name)
    except PackageNotFoundError:
        return "unknown"


@lru_cache(maxsize=1)
def _runtime_versions() -> dict[str, str]:
    return {
        "server": _read_distribution_version("ecos-server"),
        "ecc": _read_distribution_version("ecc"),
        "dreamplace": _read_distribution_version("ecc-dreamplace"),
    }


def _elapsed_since_process_start() -> float:
    """Seconds since `run_server.py` started, if the anchor is available."""
    try:
        t0 = float(os.environ.get("ECOS_SERVER_STARTUP_T0", ""))
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, time.monotonic() - t0)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Emit a single-line readiness marker so the Tauri host can see when
    the FastAPI app is actually serving requests (not just when uvicorn.run
    was invoked). Written unconditionally to stderr so it survives any uvicorn
    log-level configuration."""
    elapsed = _elapsed_since_process_start()
    print(
        f"[API_READY] pid={os.getpid()} elapsed={elapsed:.2f}s "
        f"token={os.environ.get('ECOS_SERVER_INSTANCE_TOKEN', '')[:8]}",
        file=sys.stderr,
        flush=True,
    )
    yield


app = FastAPI(
    title="ECOS Studio API",
    description="Backend API for ECOS Studio",
    version=_runtime_versions()["server"],
    lifespan=lifespan,
)

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",  # Tauri dev server
        "http://127.0.0.1:1420",
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",
        "tauri://localhost",  # Tauri production (v1 style)
        "https://tauri.localhost",  # Tauri v2 production
        "http://tauri.localhost",  # Tauri v2 production (http)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(workspace_router)
app.include_router(sse_router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "name": "ECOS Studio API",
        "version": _runtime_versions()["server"],
        "status": "running",
        "tools": ["ecc"],
    }


@app.get("/api/about")
async def about():
    """Runtime component versions for the desktop About dialog."""
    return _runtime_versions()


@app.get("/health")
async def health():
    """Global health check"""
    return {"status": "ok", "instance_token": os.environ.get("ECOS_SERVER_INSTANCE_TOKEN")}
