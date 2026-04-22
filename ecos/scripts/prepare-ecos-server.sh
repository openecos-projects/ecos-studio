#!/usr/bin/env bash
# Prepare ECOS server build environment.
# Usage: bazel run //ecos:prepare_ecos_server
set -euo pipefail

WS="${BUILD_WORKSPACE_DIRECTORY:?Must run via: bazel run //ecos:prepare_ecos_server}"
cd "$WS"

if ! command -v bazel >/dev/null 2>&1; then
    echo "ERROR: bazel not found in PATH." >&2
    exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
    echo "ERROR: uv not found in PATH." >&2
    exit 1
fi

echo "==> Syncing ecos/server venv..."
uv sync --frozen --all-groups --python 3.11 --project "$WS/ecos/server"

echo "==> Building ECOS server binary..."
bazel build //ecos:build_ecos_server

echo ""
echo "Done."
echo "  - Built target:   //ecos:build_ecos_server"
