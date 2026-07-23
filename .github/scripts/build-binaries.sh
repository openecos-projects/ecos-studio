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

  download_ecc_ci_artifact() {
    local artifact_dir commit run_id artifact

    commit="$(git rev-parse HEAD)"
    if ! run_id="$(
      gh api "repos/openecos-projects/ecc/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=20" \
        --jq '[.workflow_runs[] | select(.conclusion == "success") | .id][0] // empty'
    )"; then
      echo "ERROR: failed to look up ECC CI artifacts for ${commit}." >&2
      return 1
    fi

    if [ -z "$run_id" ]; then
      echo "ERROR: no successful ECC CI run found for submodule commit ${commit}." >&2
      return 1
    fi

    artifact_dir="dist/ecc-ci-artifact"
    rm -rf dist/ecc "$artifact_dir"
    mkdir -p dist/ecc "$artifact_dir"

    if ! gh run download "$run_id" \
      --repo openecos-projects/ecc \
      --name ecc-cli-linux-x86_64 \
      --dir "$artifact_dir"; then
      echo "ERROR: failed to download ECC CI artifact from run ${run_id}." >&2
      return 1
    fi

    artifact="$(find "$artifact_dir" -maxdepth 1 -type f -name 'ecc.tar' -print -quit)"
    if [ -z "$artifact" ]; then
      echo "ERROR: ECC CI artifact from run ${run_id} did not contain ecc.tar." >&2
      return 1
    fi

    if ! tar -xf "$artifact" -C dist/ecc; then
      echo "ERROR: failed to extract ECC CI artifact from run ${run_id}." >&2
      return 1
    fi

    if ! ecc_supports_rpc; then
      echo "ERROR: ECC CI artifact from run ${run_id} does not support 'ecc rpc serve --help'." >&2
      return 1
    fi
  }

  if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
    if ! download_ecc_ci_artifact; then
      echo "ERROR: AppImage builds require the verified ECC artifact for the pinned submodule commit." >&2
      exit 1
    fi
    return
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
