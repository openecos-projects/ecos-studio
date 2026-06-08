#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUI_DIR="$(cd "$APP_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$GUI_DIR/../.." && pwd)"
RESOURCES_DIR="$APP_DIR/resources"
BINARIES_DIR="$RESOURCES_DIR/binaries"

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


main() {
  local ecc_cli_artifact
  if ! ecc_cli_artifact="$(resolve_ecc_cli_artifact)"; then
    echo "ERROR: ECC CLI artifact is required for desktop packaging." >&2
    echo "Set ECOS_ECC_CLI_ARTIFACT to the bundled ECC CLI artifact." >&2
    exit 1
  fi

  install_ecc_cli_artifact "$ecc_cli_artifact" "$BINARIES_DIR"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
