#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_FILE/../.." && pwd)"

build_ecc() {
  cd "$REPO_ROOT/ecc"

  if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
    version="$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml | head -n 1)"

    mkdir -p dist/ecc
    gh release download "v$version" \
      --repo openecos-projects/ecc \
      --pattern '*.tar.gz' \
      --output dist/ecc.tar.gz \
      --clobber
    tar -xvf dist/ecc.tar.gz -C dist/ecc
    return
  fi

  if [ "${ECOS_USE_NIX:-}" = "1" ]; then
    nix develop "$REPO_ROOT" --command uv run pyinstaller ecc.spec --clean --noconfirm
    return
  fi

  uv run pyinstaller ecc.spec --clean --noconfirm
}

build_layout_viewer() {
  cd "$REPO_ROOT/ecos/layout-viewer"

  cargo build --release \
    -p layout-viewer-native \
    -p ecos-layout-packer
}

build_chip_viewer() {
  cd "$REPO_ROOT/ecos/chip-viewer"

  cargo build --release \
    -p chip-viewer-native
}

build_geometry_snapshot() {
  cmake --build "$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-tools/build" \
    --target ecc_geometry_snapshot
}

resolve_geometry_snapshot_binary() {
  local candidates=(
    "$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-tools/build/src/apps/geometry_snapshot/ecc-geometry-snapshot"
    "$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-tools/bin/ecc-geometry-snapshot"
    "$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-tools/build/bin/ecc-geometry-snapshot"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf 'ecc-geometry-snapshot binary was not found after build\n' >&2
  return 1
}

build_ecc
build_layout_viewer
build_chip_viewer
build_geometry_snapshot

cd "$REPO_ROOT"
rm -rf ecos/gui/apps/desktop-electron/resources
mkdir -p ecos/gui/apps/desktop-electron/resources/binaries
cp -r ecc/dist/ecc/* ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/layout-viewer/target/release/ecos-layout-packer ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/layout-viewer/target/release/layout-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/chip-viewer/target/release/chip-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
cp "$(resolve_geometry_snapshot_binary)" ecos/gui/apps/desktop-electron/resources/binaries
