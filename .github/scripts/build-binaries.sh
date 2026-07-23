#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_FILE/../.." && pwd)"

build_ecc() {
  cd "$REPO_ROOT/ecc"

  build_ecc_from_source() {
    rm -rf dist/ecc
    if [ "${ECOS_USE_NIX:-}" = "1" ]; then
      nix develop "$REPO_ROOT" --command uv run pyinstaller ecc.spec --clean --noconfirm
      return
    fi

    uv run pyinstaller ecc.spec --clean --noconfirm
  }

  ecc_supports_rpc() {
    [ -x dist/ecc/ecc ] && dist/ecc/ecc rpc serve --help >/dev/null
  }

  if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
    version="$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml | head -n 1)"

    rm -rf dist/ecc
    mkdir -p dist/ecc
    if gh release download "v$version" \
      --repo openecos-projects/ecc \
      --pattern '*.tar.gz' \
      --output dist/ecc.tar.gz \
      --clobber && \
      tar -xvf dist/ecc.tar.gz -C dist/ecc && \
      ecc_supports_rpc; then
      return
    fi

    echo "ECC release v$version is unavailable or lacks the required RPC sidecar; building from source."
  fi

  build_ecc_from_source
  if ! ecc_supports_rpc; then
    echo "ERROR: built ECC binary does not support 'ecc rpc serve --help'." >&2
    exit 1
  fi
}

build_layout_viewer() {
  cd "$REPO_ROOT/ecos/layout-viewer"

  cargo build --release \
    -p layout-viewer-native \
    -p ecos-layout-packer
}

build_ecc
build_layout_viewer

cd "$REPO_ROOT"
rm -rf ecos/gui/apps/desktop-electron/resources
mkdir -p ecos/gui/apps/desktop-electron/resources/binaries
cp -r ecc/dist/ecc/* ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/layout-viewer/target/release/ecos-layout-packer ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/layout-viewer/target/release/layout-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
