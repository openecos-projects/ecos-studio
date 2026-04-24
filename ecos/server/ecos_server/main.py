#!/usr/bin/env python

import os
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ecc import sse_router, workspace_router


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
    version="0.1.0-alpha.4",
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
        "version": "0.1.0-alpha.4",
        "status": "running",
        "tools": ["ecc"],
    }


@app.get("/health")
async def health():
    """Global health check"""
    return {"status": "ok", "instance_token": os.environ.get("ECOS_SERVER_INSTANCE_TOKEN")}
