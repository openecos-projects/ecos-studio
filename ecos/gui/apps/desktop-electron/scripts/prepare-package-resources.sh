#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUI_DIR="$(cd "$APP_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$GUI_DIR/../.." && pwd)"
RESOURCES_DIR="$APP_DIR/resources"
BINARIES_DIR="$RESOURCES_DIR/binaries"
OSS_CAD_DIR="$RESOURCES_DIR/oss-cad-suite"

resolve_ecc_cli_artifact() {
  if [[ -n "${ECOS_ECC_CLI_ARTIFACT:-}" ]]; then
    readlink -f "$ECOS_ECC_CLI_ARTIFACT"
    return 0
  fi

  if ! command -v bazel >/dev/null 2>&1; then
    echo "ERROR: bazel is required to resolve the packaged ECC CLI artifact automatically." >&2
    echo "Set ECOS_ECC_CLI_ARTIFACT explicitly or install bazel." >&2
    exit 1
  fi

  (
    cd "$REPO_ROOT"
    bazel build @ecc//:build_ecc_cli_bundle >/dev/null
    readlink -f "$(bazel cquery --output=files @ecc//:build_ecc_cli_bundle 2>/dev/null | head -n 1)"
  )
}

install_ecc_cli_artifact() {
  local artifact_path="$1"
  local target_dir="$2"

  if [[ ! -f "$artifact_path" ]]; then
    echo "ERROR: ECC CLI artifact not found: $artifact_path" >&2
    exit 1
  fi

  rm -rf "$target_dir"
  mkdir -p "$target_dir/ecc-runtime"

  if tar -tf "$artifact_path" >/dev/null 2>&1; then
    tar -xf "$artifact_path" -C "$target_dir/ecc-runtime"
  else
    cp -f "$artifact_path" "$target_dir/ecc-runtime/ecc"
  fi

  if [[ ! -x "$target_dir/ecc-runtime/ecc" ]]; then
    echo "ERROR: ECC CLI bundle is missing executable: $target_dir/ecc-runtime/ecc" >&2
    exit 1
  fi

  cat > "$target_dir/ecc" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/ecc-runtime/ecc" "$@"
EOF
  chmod +x "$target_dir/ecc"
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
  local ecc_cli_artifact
  if ! ecc_cli_artifact="$(resolve_ecc_cli_artifact)"; then
    echo "ERROR: ECC CLI artifact is required for desktop packaging." >&2
    echo "Set ECOS_ECC_CLI_ARTIFACT to the bundled ECC CLI artifact." >&2
    exit 1
  fi

  install_ecc_cli_artifact "$ecc_cli_artifact" "$BINARIES_DIR"
  prepare_oss_cad_dir
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
