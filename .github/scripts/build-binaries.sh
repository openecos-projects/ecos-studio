#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_FILE/../.." && pwd)"

ensure_ecc_tools_python_extension() {
  local import_check='from ecc_tools_bin import ecc_py; print(ecc_py.__file__)'

  if uv run python -c "$import_check"; then
    return
  fi

  uv sync --reinstall-package ecc-tools-bin --no-build-isolation-package ecc-tools-bin
  uv run python -c "$import_check"
}

ensure_ecc_dreamplace_native_extensions() {
  # DreamPlace C++ operators link against the installed PyTorch ABI.  An
  # editable install can retain operators built for an older Torch release.
  local import_check='from dreamplace.ops.rc_timing.rc_timing import RCTiming; import dreamplace.NonLinearPlace; print(RCTiming)'

  if uv run python -c "$import_check"; then
    return
  fi

  uv sync --reinstall-package ecc-dreamplace --no-build-isolation-package ecc-dreamplace
  uv run python -c "$import_check"
}

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
    nix develop "$REPO_ROOT" --command bash -lc \
      '
        import_check="from ecc_tools_bin import ecc_py; print(ecc_py.__file__)"
        dreamplace_import_check="from dreamplace.ops.rc_timing.rc_timing import RCTiming; import dreamplace.NonLinearPlace; print(RCTiming)"
        uv run python -c "$import_check" || uv sync --reinstall-package ecc-tools-bin --no-build-isolation-package ecc-tools-bin
        uv run python -c "$import_check"
        uv run python -c "$dreamplace_import_check" || uv sync --reinstall-package ecc-dreamplace --no-build-isolation-package ecc-dreamplace
        uv run python -c "$dreamplace_import_check"
        uv run pyinstaller ecc.spec --clean --noconfirm
      '
    return
  fi

  ensure_ecc_tools_python_extension
  ensure_ecc_dreamplace_native_extensions
  uv run pyinstaller ecc.spec --clean --noconfirm
}

build_chip_viewer() {
  cd "$REPO_ROOT/ecos/chip-viewer"

  cargo build --release \
    -p chip-viewer-native
}

validate_packaged_binaries() {
  local binary_dir="$REPO_ROOT/ecos/gui/apps/desktop-electron/resources/binaries"
  local missing=0

  local required_files=(
    "$binary_dir/ecc"
    "$binary_dir/chip-viewer-native"
  )

  for required_file in "${required_files[@]}"; do
    if [[ ! -x "$required_file" ]]; then
      printf 'required packaged binary is missing or not executable: %s\n' "$required_file" >&2
      missing=1
    fi
  done

  if ! find "$binary_dir" -path '*/ecc_tools_bin/ecc_py*.so' -type f -print -quit | grep -q .; then
    printf 'required ecc_tools_bin/ecc_py extension was not packaged under %s\n' "$binary_dir" >&2
    missing=1
  fi

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

build_ecc
build_chip_viewer

cd "$REPO_ROOT"
rm -rf ecos/gui/apps/desktop-electron/resources
mkdir -p ecos/gui/apps/desktop-electron/resources/binaries
cp -r ecc/dist/ecc/* ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/chip-viewer/target/release/chip-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
validate_packaged_binaries
