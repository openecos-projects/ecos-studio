#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../ecos/chip-viewer"
exec cargo run --package chip-viewer-native --bin chip-viewer-native -- "$@"
