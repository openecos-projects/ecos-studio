#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../ecos/chip-viewer"
# Interactive layout/replay performance must match the packaged viewer.
exec cargo run --release --package chip-viewer-native --bin chip-viewer-native -- "$@"
