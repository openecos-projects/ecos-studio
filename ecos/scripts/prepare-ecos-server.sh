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

check_platform() {
    local glibc_major
    local glibc_minor
    local glibc_version

    if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
        echo "ERROR: ECOS Studio server development currently requires Linux x86_64 with glibc >= 2.34." >&2
        echo "The locked uv environment uses pinned manylinux_2_34_x86_64 wheels for ecc-dreamplace and ecc-tools." >&2
        exit 1
    fi

    glibc_version="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{ print $2 }' || true)"
    glibc_major="${glibc_version%%.*}"
    glibc_minor="${glibc_version#*.}"
    if [[ "$glibc_minor" == "$glibc_version" ]]; then
        glibc_minor="0"
    fi
    glibc_minor="${glibc_minor%%[^0-9]*}"
    glibc_major="${glibc_major:-0}"
    glibc_minor="${glibc_minor:-0}"

    if ((glibc_major < 2 || (glibc_major == 2 && glibc_minor < 34))); then
        echo "ERROR: ECOS Studio server development requires glibc >= 2.34 (detected: ${glibc_version:-unknown})." >&2
        echo "The pinned ecc-dreamplace and ecc-tools wheels are tagged manylinux_2_34_x86_64." >&2
        exit 1
    fi
}

check_platform

echo "==> Syncing ecos/server venv..."
uv sync --frozen --all-groups --python 3.11 --project "$WS/ecos/server"

echo "==> Building ECOS server binary..."
bazel build //ecos:build_ecos_server

echo ""
echo "Done."
echo "  - Built target:   //ecos:build_ecos_server"
