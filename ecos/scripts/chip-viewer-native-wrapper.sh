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
# Interactive layout/replay performance must match the packaged viewer.
exec cargo run --release --package chip-viewer-native --bin chip-viewer-native -- "$@"
