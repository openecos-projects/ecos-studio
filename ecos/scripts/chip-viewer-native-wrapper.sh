#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../ecos/chip-viewer"
# Interactive launches must never wait for compilation or Cargo's build lock.
viewer_target="${CARGO_TARGET_DIR:-target}"
viewer_binary="$viewer_target/release/chip-viewer-native"
if [[ ! -x "$viewer_binary" ]]; then
  echo "Chip Viewer is not built. Run: cd ecos/chip-viewer && cargo build --release -p chip-viewer-native" >&2
  exit 1
fi
exec "$viewer_binary" "$@"
