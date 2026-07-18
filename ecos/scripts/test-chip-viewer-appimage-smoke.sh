#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="$SCRIPT_DIR/chip-viewer-appimage-smoke.sh"

if [ ! -f "$SMOKE_SCRIPT" ]; then
  echo "missing smoke script: $SMOKE_SCRIPT" >&2
  exit 1
fi

help_output="$(bash "$SMOKE_SCRIPT" --help)"
for expected in "--appimage" "--out" "--dry-run" "ecc-geometry-snapshot" "AppImage"; do
  if [[ "$help_output" != *"$expected"* ]]; then
    echo "missing help text: $expected" >&2
    exit 1
  fi
done

dry_run_output="$(
  bash "$SMOKE_SCRIPT" \
    --dry-run \
    --appimage /tmp/ECOS-Studio.AppImage \
    --out /tmp/chip-viewer-appimage-smoke-test
)"
for expected in "/tmp/ECOS-Studio.AppImage --appimage-offset" "unsquashfs -ll" "resources/binaries/chip-viewer-native" "resources/binaries/_internal/ecc_tools_bin/lib" "/tmp/chip-viewer-appimage-smoke-test/appimage-files.txt"; do
  if [[ "$dry_run_output" != *"$expected"* ]]; then
    echo "missing dry-run command fragment: $expected" >&2
    exit 1
  fi
done

set +e
missing_appimage_output="$(
  bash "$SMOKE_SCRIPT" --appimage /tmp/does-not-exist.AppImage 2>&1
)"
missing_appimage_status=$?
set -e
if [ "$missing_appimage_status" -eq 0 ]; then
  echo "expected missing AppImage to fail" >&2
  exit 1
fi
if [[ "$missing_appimage_output" != *"AppImage does not exist"* ]]; then
  echo "unexpected missing AppImage output: $missing_appimage_output" >&2
  exit 1
fi
