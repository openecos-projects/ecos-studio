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

if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl not found in PATH." >&2
    exit 1
fi

wheel_dir="$WS/ecc/dist/wheel/repaired"
ecc_wheel_url="https://github.com/openecos-projects/ecc/releases/download/v0.1.0-alpha/ecc-0.1.0a0-py3-none-any.whl"
dreamplace_wheel_url="https://github.com/openecos-projects/ecc-dreamplace/releases/download/v0.1.0-alpha.1/ecc_dreamplace-0.1.0a1-py3-none-manylinux_2_34_x86_64.whl"
ecc_tools_wheel_url="https://github.com/openecos-projects/ecc-tools/releases/download/v0.1.0-alpha/ecc_tools-0.1.0a0-py3-none-manylinux_2_34_x86_64.whl"
ecc_wheel="$wheel_dir/$(basename "$ecc_wheel_url")"
dreamplace_wheel="$wheel_dir/$(basename "$dreamplace_wheel_url")"
ecc_tools_wheel="$wheel_dir/$(basename "$ecc_tools_wheel_url")"

download_wheel() {
    local label="$1"
    local url="$2"
    local dest="$3"

    if [[ -f "$dest" ]]; then
        echo "==> Using cached $label wheel: $dest"
        return
    fi

    echo "==> Downloading $label wheel from GitHub Releases..."
    mkdir -p "$wheel_dir"
    local tmp="${dest}.tmp"
    curl -fL -o "$tmp" "$url"
    mv "$tmp" "$dest"
    echo "==> Downloaded: $url"
}

download_wheel "ecc" "$ecc_wheel_url" "$ecc_wheel"
download_wheel "ecc-dreamplace" "$dreamplace_wheel_url" "$dreamplace_wheel"
download_wheel "ecc-tools" "$ecc_tools_wheel_url" "$ecc_tools_wheel"

echo "==> Syncing ecos/server venv..."
uv sync --frozen --all-groups --python 3.11 --project "$WS/ecos/server"

echo "==> Installing release wheels into ecos/server venv..."
(
    cd "$WS/ecos/server"
    uv pip install --reinstall --no-deps "$ecc_wheel" "$dreamplace_wheel" "$ecc_tools_wheel"
)

echo "==> Building ECOS server binary..."
bazel build //ecos:build_ecos_server

echo ""
echo "Done."
echo "  - Installed wheel: $ecc_wheel"
echo "  - Installed wheel: $dreamplace_wheel"
echo "  - Installed wheel: $ecc_tools_wheel"
echo "  - Built target:   //ecos:build_ecos_server"
