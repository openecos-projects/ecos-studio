#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../ecos/chip-viewer"
if [[ "${1:-}" == "--build-only" ]]; then
  shift
  if (($# > 0)); then
    printf '%s\n' 'Unexpected arguments for Chip Viewer build-only mode.' >&2
    exit 64
  fi
  exec cargo build --release --package chip-viewer-native --bin chip-viewer-native
fi
# Interactive launches must never wait for compilation or Cargo's build lock.
viewer_target="${CARGO_TARGET_DIR:-target}"
viewer_binary="$viewer_target/release/chip-viewer-native"
if [[ ! -x "$viewer_binary" ]]; then
  echo "Chip Viewer is not built. Run: cd ecos/chip-viewer && cargo build --release -p chip-viewer-native" >&2
  exit 1
fi
exec "$viewer_binary" "$@"
