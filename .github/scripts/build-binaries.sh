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

build_agent_provider() {
  cd "$REPO_ROOT/ecos/agent"

  uv run --locked --with pyinstaller==6.17 pyinstaller \
    --clean \
    --noconfirm \
    --onefile \
    --name ecos-agent \
    --distpath dist \
    --specpath build \
    --workpath build \
    --add-data "$PWD/knowledge:knowledge" \
    src/ecos_agent/gui/__main__.py
}

is_portable_sizer_runtime() {
  local root="$1"
  [[ -n "$root" &&
    -x "$root/bin/Sizer" &&
    -x "$root/libexec/Sizer" &&
    -x "$root/lib/ld-linux-x86-64.so.2" &&
    -f "$root/src/sizer_os.tcl" ]]
}

prepare_sizer_runtime() {
  local source_root="${CHIPCOMPILER_ECC_SIZER_ROOT:-}"
  local download_dir="$REPO_ROOT/ecc/dist/ecc-sizer-download"
  local stage_dir="$REPO_ROOT/ecc/dist/ecos-sizer-runtime"

  if ! is_portable_sizer_runtime "$source_root"; then
    if ! command -v gh >/dev/null 2>&1; then
      printf 'Sizer runtime not found; set CHIPCOMPILER_ECC_SIZER_ROOT or install gh for artifact download.\n' >&2
      return 1
    fi

    local run_id
    run_id="$(
      gh api 'repos/openecos-projects/ecc-sizer/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=20' \
        --jq '[.workflow_runs[] | select(.conclusion == "success") | .id][0] // empty'
    )"
    if [[ -z "$run_id" ]]; then
      printf 'No successful ecc-sizer CI artifact found on main.\n' >&2
      return 1
    fi

    rm -rf "$download_dir"
    mkdir -p "$download_dir"
    printf 'Downloading ecc-sizer-linux-x64 from CI run %s\n' "$run_id"
    gh run download "$run_id" \
      --repo openecos-projects/ecc-sizer \
      --name ecc-sizer-linux-x64 \
      --dir "$download_dir"

    local archive
    archive="$(find "$download_dir" -name 'ecc-sizer-linux-x64.tar.gz' -print -quit)"
    if [[ -z "$archive" ]]; then
      printf 'Downloaded ecc-sizer artifact does not contain ecc-sizer-linux-x64.tar.gz.\n' >&2
      return 1
    fi
    tar -xzf "$archive" -C "$download_dir"
    source_root="$(find "$download_dir" -type f -path '*/src/sizer_os.tcl' -printf '%h\n' | sed 's#/src$##' | head -n 1)"
  fi

  if ! is_portable_sizer_runtime "$source_root"; then
    printf 'Invalid portable Sizer runtime at %s.\n' "${source_root:-<empty>}" >&2
    return 1
  fi

  if [[ -d "$stage_dir" ]]; then
    find "$stage_dir" -type d -exec chmod u+w {} +
  fi
  rm -rf "$stage_dir"
  mkdir -p "$stage_dir"
  cp -a "$source_root/." "$stage_dir/"
  find "$stage_dir" -type d -exec chmod u+w {} +
  SIZER_RUNTIME_ROOT="$stage_dir"
}

validate_packaged_binaries() {
  local binary_dir="$REPO_ROOT/ecos/gui/apps/desktop-electron/resources/binaries"
  local agent_dir="$REPO_ROOT/ecos/gui/apps/desktop-electron/resources/agent"
  local missing=0

  local required_files=(
    "$binary_dir/ecc"
    "$binary_dir/ecc-agent-rpc"
    "$binary_dir/chip-viewer-native"
    "$binary_dir/sizer/bin/Sizer"
    "$binary_dir/sizer/libexec/Sizer"
    "$binary_dir/sizer/lib/ld-linux-x86-64.so.2"
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

  if [[ ! -f "$binary_dir/sizer/src/sizer_os.tcl" ]]; then
    printf 'required Sizer runtime script is missing: %s\n' "$binary_dir/sizer/src/sizer_os.tcl" >&2
    missing=1
  fi

  if [[ ! -x "$agent_dir/ecos-agent" ]]; then
    printf 'required packaged agent provider is missing or not executable: %s\n' "$agent_dir/ecos-agent" >&2
    missing=1
  fi

  if [[ ! -f "$agent_dir/agent-provider.json" ]]; then
    printf 'required packaged agent manifest is missing: %s\n' "$agent_dir/agent-provider.json" >&2
    missing=1
  fi

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

build_ecc
build_chip_viewer
build_agent_provider
prepare_sizer_runtime

cd "$REPO_ROOT"
if [[ -d ecos/gui/apps/desktop-electron/resources/binaries/sizer ]]; then
  find ecos/gui/apps/desktop-electron/resources/binaries/sizer -type d -exec chmod u+w {} +
fi
rm -rf ecos/gui/apps/desktop-electron/resources
mkdir -p ecos/gui/apps/desktop-electron/resources/{agent,binaries}
cp -r ecc/dist/ecc/* ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/chip-viewer/target/release/chip-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
cp -a "$SIZER_RUNTIME_ROOT" ecos/gui/apps/desktop-electron/resources/binaries/sizer
cp ecos/agent/dist/ecos-agent ecos/gui/apps/desktop-electron/resources/agent
cp ecos/agent/agent-provider.packaged.json ecos/gui/apps/desktop-electron/resources/agent/agent-provider.json
validate_packaged_binaries
