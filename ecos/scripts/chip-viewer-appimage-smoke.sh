#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_APPIMAGE="$ROOT/ecos/gui/apps/desktop-electron/release/ECOS-Studio_0.1.0-alpha.6_x86_64.AppImage"

APPIMAGE="${CHIP_VIEWER_APPIMAGE:-$DEFAULT_APPIMAGE}"
OUT_DIR="${CHIP_VIEWER_APPIMAGE_SMOKE_OUT:-/tmp/chip_viewer_appimage_smoke}"
DRY_RUN=false

REQUIRED_ENTRIES=(
  "resources/binaries/chip-viewer-native"
  "resources/binaries/ecc"
  "resources/binaries/plocate"
  "resources/binaries/updatedb"
  "resources/binaries/hdl-index-libs"
  "resources/binaries/_internal/ecc_tools_bin"
  "resources/binaries/_internal/ecc_tools_bin/lib"
  "resources/binaries/_internal/ecc_tools_bin/ecc_py.cpython-311-x86_64-linux-gnu.so"
  "resources/binaries/_internal/ecc_tools_bin/lib/libgeometry_db.so"
  "resources/binaries/_internal/ecc_tools_bin/lib/libidb.so"
  "resources/binaries/_internal/dreamplace/Params.py"
  "resources/binaries/_internal/dreamplace/Placer.py"
  "resources/binaries/_internal/dreamplace/ops/place_io/place_io_cpp.cpython-311-x86_64-linux-gnu.so"
  "resources/binaries/_internal/torch/lib/libtorch.so"
)

usage() {
  cat <<'EOF'
Usage: chip-viewer-appimage-smoke.sh [options]

Inspect the ECOS Studio AppImage and fail if required chip viewer runtime
payload files are missing.
Required payload includes chip-viewer-native, ecc, plocate, updatedb,
and the packaged ecc_tools_bin runtime libraries.

Options:
  --appimage <path>   AppImage path. Defaults to the desktop-electron release.
  --out <dir>         Directory for inspection report files.
  --dry-run           Print inspection commands without executing.
  -h, --help          Show this help.
EOF
}

require_value() {
  local option_name="$1"
  local value="${2-}"
  if [ -z "$value" ]; then
    echo "$option_name requires a value" >&2
    exit 2
  fi
  printf '%s\n' "$value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --appimage)
      APPIMAGE="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --out)
      OUT_DIR="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

LIST_REPORT="$OUT_DIR/appimage-files.txt"

if [ "$DRY_RUN" = true ]; then
  echo "$APPIMAGE --appimage-offset"
  echo "unsquashfs -ll -o <offset> $APPIMAGE > $LIST_REPORT"
  for entry in "${REQUIRED_ENTRIES[@]}"; do
    echo "require squashfs-root/$entry"
  done
  exit 0
fi

if [ ! -f "$APPIMAGE" ]; then
  echo "AppImage does not exist: $APPIMAGE" >&2
  exit 1
fi
if [ ! -x "$APPIMAGE" ]; then
  echo "AppImage is not executable: $APPIMAGE" >&2
  exit 1
fi
if ! command -v unsquashfs >/dev/null 2>&1; then
  echo "unsquashfs is required to inspect AppImage contents" >&2
  exit 1
fi

offset="$("$APPIMAGE" --appimage-offset)"
if [[ ! "$offset" =~ ^[0-9]+$ ]]; then
  echo "failed to read AppImage offset from: $APPIMAGE" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
unsquashfs -ll -o "$offset" "$APPIMAGE" > "$LIST_REPORT"

missing=()
for entry in "${REQUIRED_ENTRIES[@]}"; do
  if ! grep -F "squashfs-root/$entry" "$LIST_REPORT" >/dev/null; then
    missing+=("$entry")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  printf 'missing AppImage runtime payload entries:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  printf 'inspection report: %s\n' "$LIST_REPORT" >&2
  exit 1
fi

printf 'AppImage chip viewer payload OK: %s\n' "$APPIMAGE"
printf 'inspection report: %s\n' "$LIST_REPORT"
