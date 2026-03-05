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

echo "==> Building ECC wheel..."
bazel run //ecc:build_wheel

wheel_dir="$WS/ecc/dist/wheel/repaired"
latest_wheel="$(ls -1t "$wheel_dir"/ecc-*.whl 2>/dev/null | head -n 1 || true)"
if [[ -z "$latest_wheel" ]]; then
    echo "ERROR: no ecc wheel found in $wheel_dir" >&2
    exit 1
fi

stable_wheel="$wheel_dir/ecc-latest.whl"
ln -sfn "$(basename "$latest_wheel")" "$stable_wheel"
echo "==> Using ECC wheel: $stable_wheel -> $(basename "$latest_wheel")"

echo "==> Syncing ecos/server venv..."
uv sync --frozen --all-groups --python 3.11 --project "$WS/ecos/server"

echo "==> Building ECOS server binary..."
bazel build //ecos:build_ecos_server

echo ""
echo "Done."
echo "  - Prepared wheel: $stable_wheel"
echo "  - Built target:   //ecos:build_ecos_server"
