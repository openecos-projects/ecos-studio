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
        uv run python -c "$import_check" || uv sync --reinstall-package ecc-tools-bin --no-build-isolation-package ecc-tools-bin
        uv run python -c "$import_check"
        uv run pyinstaller ecc.spec --clean --noconfirm
      '
    return
  fi

  ensure_ecc_tools_python_extension
  uv run pyinstaller ecc.spec --clean --noconfirm
}

build_chip_viewer() {
  cd "$REPO_ROOT/ecos/chip-viewer"

  cargo build --release \
    -p chip-viewer-native
}

build_geometry_snapshot() {
  local ecc_tools_dir="$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-tools"
  local python_executable="$REPO_ROOT/ecc/.venv/bin/python"
  local python_include_dir
  local python_numpy_include_dir

  python_include_dir="$($python_executable -c 'import sysconfig; print(sysconfig.get_path("platinclude"))')"
  python_numpy_include_dir="$($python_executable -c 'import numpy; print(numpy.get_include())')"

  # scikit-build configures the editable extension with a temporary Python
  # environment.  That directory disappears after installation, so refresh
  # CMake's Python discovery against ECC's persistent virtual environment
  # before building the standalone geometry snapshot.
  cmake -S "$ecc_tools_dir" -B "$ecc_tools_dir/build" \
    -DPython_EXECUTABLE="$python_executable" \
    -DPYTHON_EXECUTABLE="$python_executable" \
    -DPython_INCLUDE_DIR="$python_include_dir" \
    -DPython_NumPy_INCLUDE_DIR="$python_numpy_include_dir"

  cmake --build "$ecc_tools_dir/build" \
    --target ecc_geometry_snapshot \
    --parallel "$(nproc)"
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

validate_packaged_binaries() {
  local binary_dir="$REPO_ROOT/ecos/gui/apps/desktop-electron/resources/binaries"
  local missing=0

  local required_files=(
    "$binary_dir/ecc"
    "$binary_dir/chip-viewer-native"
    "$binary_dir/ecc-geometry-snapshot"
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
build_geometry_snapshot

cd "$REPO_ROOT"
rm -rf ecos/gui/apps/desktop-electron/resources
mkdir -p ecos/gui/apps/desktop-electron/resources/binaries
cp -r ecc/dist/ecc/* ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/chip-viewer/target/release/chip-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
cp "$(resolve_geometry_snapshot_binary)" ecos/gui/apps/desktop-electron/resources/binaries
validate_packaged_binaries
