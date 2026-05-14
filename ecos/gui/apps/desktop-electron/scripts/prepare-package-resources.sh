#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUI_DIR="$(cd "$APP_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$GUI_DIR/../.." && pwd)"
RESOURCES_DIR="$APP_DIR/resources"
BINARIES_DIR="$RESOURCES_DIR/binaries"
OSS_CAD_DIR="$RESOURCES_DIR/oss-cad-suite"

detect_api_server_triple() {
  local uname_s
  local uname_m
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"

  case "$uname_s/$uname_m" in
    Linux/x86_64)
      echo "x86_64-unknown-linux-gnu"
      ;;
    Linux/aarch64|Linux/arm64)
      echo "aarch64-unknown-linux-gnu"
      ;;
    Darwin/arm64)
      echo "aarch64-apple-darwin"
      ;;
    Darwin/x86_64)
      echo "x86_64-apple-darwin"
      ;;
    MINGW*/*|MSYS*/*|CYGWIN*/*)
      echo "x86_64-pc-windows-msvc"
      ;;
    *)
      echo "ERROR: unsupported host platform for API server bundle naming: $uname_s/$uname_m" >&2
      exit 1
      ;;
  esac
}

resolve_api_server_artifact() {
  if [[ -n "${ECOS_API_SERVER_BIN:-}" ]]; then
    readlink -f "$ECOS_API_SERVER_BIN"
    return 0
  fi

  if [[ -n "${ECOS_API_SERVER_BUNDLE:-}" ]]; then
    readlink -f "$ECOS_API_SERVER_BUNDLE"
    return 0
  fi

  if ! command -v bazel >/dev/null 2>&1; then
    echo "ERROR: bazel is required to resolve the packaged API server artifact automatically." >&2
    echo "Set ECOS_API_SERVER_BIN or ECOS_API_SERVER_BUNDLE explicitly or install bazel." >&2
    exit 1
  fi

  (
    cd "$REPO_ROOT"
    bazel build //ecos:build_ecos_server_bundle >/dev/null
    readlink -f "$(bazel cquery --output=files //ecos:build_ecos_server_bundle 2>/dev/null | head -n 1)"
  )
}

install_api_server_artifact() {
  local artifact_path="$1"
  local target_path="$2"

  rm -rf "$target_path"

  if tar -tf "$artifact_path" >/dev/null 2>&1; then
    mkdir -p "$target_path"
    tar -xf "$artifact_path" -C "$target_path"
    local executable_path="$target_path/ecos-server"
    if [[ ! -x "$executable_path" ]]; then
      echo "ERROR: API server bundle is missing executable: $executable_path" >&2
      exit 1
    fi
    chmod +x "$executable_path"
    return 0
  fi

  cp -f "$artifact_path" "$target_path"
  chmod +x "$target_path"
}

verify_yosys_slang_support() {
  local yosys_bin="$1"

  if ! "$yosys_bin" -Q -m slang -p 'help' >/dev/null 2>&1; then
    echo "ERROR: yosys slang plugin check failed for $yosys_bin" >&2
    echo "Provide an OSS CAD suite bundle whose yosys can load the slang plugin." >&2
    exit 1
  fi
}

resolve_oss_cad_yosys_bin() {
  if [[ -n "${ECOS_OSS_CAD_BIN:-}" ]]; then
    readlink -f "$ECOS_OSS_CAD_BIN"
    return 0
  fi

  if [[ -n "${CHIPCOMPILER_OSS_CAD_DIR:-}" && -f "${CHIPCOMPILER_OSS_CAD_DIR}/bin/yosys" ]]; then
    readlink -f "${CHIPCOMPILER_OSS_CAD_DIR}/bin/yosys"
    return 0
  fi

  return 1
}

prepare_oss_cad_dir() {
  rm -rf "$OSS_CAD_DIR"
  mkdir -p "$OSS_CAD_DIR"

  if [[ "${ENABLE_OSS_CAD_SUITE:-true}" != "true" ]]; then
    echo "WARN: packaging desktop app without OSS CAD suite support (ENABLE_OSS_CAD_SUITE=false)." >&2
    echo "WARN: synthesis flows that depend on yosys/slang will be unavailable in the packaged app." >&2
    echo "placeholder for electron package build" > "$OSS_CAD_DIR/README"
    echo "placeholder" > "$OSS_CAD_DIR/placeholder.txt"
    return 0
  fi

  local yosys_bin
  if ! yosys_bin="$(resolve_oss_cad_yosys_bin)"; then
    echo "ERROR: OSS CAD suite is required for desktop packaging, but no yosys binary was provided." >&2
    echo "Set ECOS_OSS_CAD_BIN or CHIPCOMPILER_OSS_CAD_DIR to a yosys/slang-capable bundle." >&2
    echo "If you intentionally want a package without flow support, set ENABLE_OSS_CAD_SUITE=false." >&2
    exit 1
  fi

  if [[ ! -f "$yosys_bin" ]]; then
    echo "ERROR: OSS CAD yosys binary not found: $yosys_bin" >&2
    exit 1
  fi

  verify_yosys_slang_support "$yosys_bin"

  local oss_root
  oss_root="$(dirname "$(dirname "$(readlink -f "$yosys_bin")")")"
  if [[ ! -f "$oss_root/bin/yosys" ]]; then
    echo "ERROR: invalid OSS CAD suite root inferred from $yosys_bin" >&2
    exit 1
  fi

  cp -a "$oss_root/." "$OSS_CAD_DIR/"
  verify_yosys_slang_support "$OSS_CAD_DIR/bin/yosys"
}

main() {
  local api_server_artifact
  api_server_artifact="$(resolve_api_server_artifact)"
  if [[ ! -f "$api_server_artifact" ]]; then
    echo "ERROR: api server artifact not found: $api_server_artifact" >&2
    exit 1
  fi

  local target_triple
  target_triple="${ECOS_API_SERVER_TRIPLE:-$(detect_api_server_triple)}"

  mkdir -p "$BINARIES_DIR"
  install_api_server_artifact "$api_server_artifact" "$BINARIES_DIR/api-server-$target_triple"

  prepare_oss_cad_dir
}

main "$@"
