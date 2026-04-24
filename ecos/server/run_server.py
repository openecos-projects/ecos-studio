#!/usr/bin/env python

"""
Standalone script to run the FastAPI server.
This script is intended to be spawned by Tauri at application startup.
"""

import os
import sys
import time

# Track startup phases so a packaged binary can be diagnosed purely from stdout.
# These prints are unconditional (independent of log level) and cheap.
_STARTUP_T0 = time.monotonic()


def _phase(label: str) -> None:
    print(
        f"[API_PHASE] t={time.monotonic() - _STARTUP_T0:.2f}s {label}",
        file=sys.stderr,
        flush=True,
    )


_phase("process_started")

# In PyInstaller onefile mode, native C++ code (e.g. FLUTE) opens files via
# relative paths anchored at _MEIPASS. Switch CWD so those paths resolve.
if hasattr(sys, "_MEIPASS"):
    os.chdir(sys._MEIPASS)
    _phase("meipass_extracted_and_cwd_set")

# Add project root to path for imports
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(script_dir, "../.."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import argparse
import logging

_phase("import_uvicorn_start")
import uvicorn

_phase("import_uvicorn_done")

_phase("import_chipcompiler_log_start")
from chipcompiler.utility.log import (
    build_timestamped_log_file,
    init_api_runtime_log,
)

_phase("import_chipcompiler_log_done")


def _setup_logging(args) -> str:
    """
    Configure runtime log file and stdio redirection. Returns resolved log path.
    """
    log_file = os.path.abspath(os.path.expanduser(args.log_file))

    if args.timestamp_log_file:
        log_file = build_timestamped_log_file(log_file=log_file, pid=os.getpid())

    if args.disable_stdio_redirect:
        print(
            "[API_LOG] stdio redirect disabled; logs stay on console.", file=sys.stderr, flush=True
        )
        logging.getLogger("ecos_server").setLevel(logging.INFO)
        return log_file

    log_file = init_api_runtime_log(
        log_file=log_file,
        max_bytes=args.log_max_bytes,
        backup_count=args.log_backup_count,
    )

    print(f"[API_LOG] log -> {log_file} (tail -f {log_file})", file=sys.stderr, flush=True)

    return log_file


def main():
    parser = argparse.ArgumentParser(description="Run ECOS Studio API server")
    parser.add_argument("--host", default="127.0.0.1", help="Host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port (default: 8765)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    parser.add_argument(
        "--reload-dir",
        dest="reload_dirs",
        action="append",
        default=[],
        help="Directory to watch for reload (can be specified multiple times)",
    )
    parser.add_argument(
        "--log-file", default="/tmp/ecos-studio-api-server.log", help="Runtime log file path"
    )
    parser.add_argument(
        "--log-max-bytes",
        type=int,
        default=20 * 1024 * 1024,
        help="Rotate on startup if log exceeds this size",
    )
    parser.add_argument(
        "--log-backup-count", type=int, default=5, help="Number of backup files to keep"
    )
    parser.add_argument(
        "--disable-stdio-redirect", action="store_true", help="Keep stdout/stderr on console"
    )
    parser.add_argument(
        "--log-level",
        default=os.environ.get("ECOS_API_LOG_LEVEL", "warning"),
        help="Uvicorn log level (default: warning)",
    )
    parser.add_argument(
        "--access-log", dest="access_log", action="store_true", help="Enable Uvicorn access logs"
    )
    parser.add_argument(
        "--no-access-log",
        dest="access_log",
        action="store_false",
        help="Disable Uvicorn access logs (default)",
    )
    parser.set_defaults(access_log=False)
    parser.add_argument(
        "--timestamp-log-file",
        dest="timestamp_log_file",
        action="store_true",
        default=True,
        help="Timestamped log filename per startup (default)",
    )
    parser.add_argument(
        "--no-timestamp-log-file",
        dest="timestamp_log_file",
        action="store_false",
        help="Use exact --log-file path",
    )

    args = parser.parse_args()
    log_file = _setup_logging(args)

    reload_dirs = [
        os.path.abspath(os.path.expanduser(path))
        for path in args.reload_dirs
        if path and path.strip()
    ]

    print(
        f"[API_START] pid={os.getpid()} {args.host}:{args.port} "
        f"reload={args.reload} reload_dirs={reload_dirs or 'default'} "
        f"log={'console' if args.disable_stdio_redirect else log_file}",
        flush=True,
    )

    # Expose the anchor timestamp so ecos_server.main can emit [API_READY] with
    # a consistent "seconds since process start" measurement.
    os.environ["ECOS_SERVER_STARTUP_T0"] = str(_STARTUP_T0)

    _phase("uvicorn_run_called")
    uvicorn.run(
        "ecos_server.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=reload_dirs or None,
        log_level=args.log_level,
        access_log=args.access_log,
    )


if __name__ == "__main__":
    main()
