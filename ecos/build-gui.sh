#!/usr/bin/env bash
set -euo pipefail

inject_oss_cad_into_appimage() {
    local appimage_path="$1"
    local oss_cad_source="$2"

    if [[ "${ENABLE_OSS_CAD_SUITE:-true}" != "true" ]]; then
        return 0
    fi
    if [[ ! -f "$appimage_path" || ! -d "$oss_cad_source" ]]; then
        echo "ERROR: AppImage or OSS CAD source not found"
        return 1
    fi

    local appimage_abs
    appimage_abs=$(readlink -f "$appimage_path")
    local work_dir
    work_dir=$(mktemp -d)
    trap 'rm -rf "$work_dir"' RETURN

    echo "[inject] Extracting AppImage: $appimage_abs"
    if ! (cd "$work_dir" && APPIMAGE_EXTRACT_AND_RUN=1 "$appimage_abs" --appimage-extract >/dev/null); then
        echo "ERROR: failed to extract AppImage"
        return 1
    fi

    local target_dir
    target_dir=$(find "$work_dir/squashfs-root/usr/lib" -type d -path "*/resources/oss-cad-suite" -print -quit 2>/dev/null || true)
    if [[ -z "$target_dir" ]]; then
        target_dir="$work_dir/squashfs-root/usr/lib/ECOS-Studio/resources/oss-cad-suite"
    fi
    rm -rf "$target_dir"
    mkdir -p "$(dirname "$target_dir")"
    cp -a "$oss_cad_source" "$target_dir"

    for lib in libwayland-client.so.0 libreadline.so.8; do
        rm -f "$work_dir/squashfs-root/usr/lib/$lib"
    done

    local appimagetool="${APPIMAGETOOL_PATH:-${APPIMAGETOOL_BIN:-}}"
    if [[ -z "$appimagetool" ]]; then
        echo "ERROR: appimagetool not provided via APPIMAGETOOL_PATH or APPIMAGETOOL_BIN"
        return 1
    fi

    echo "[inject] Repacking AppImage"
    if ! env -u SOURCE_DATE_EPOCH APPIMAGE_EXTRACT_AND_RUN=1 "$appimagetool" "$work_dir/squashfs-root" "$appimage_abs" >/dev/null; then
        echo "ERROR: appimagetool repack failed"
        return 1
    fi

    chmod +x "$appimage_abs"
    echo "[inject] AppImage post-injected: $appimage_abs"
}

usage() {
    cat <<EOF
Usage: $0 --gui-src-dir <dir> --api-server-bin <path> --out-tar <path> --work-root <dir> [--appimagetool-bin <path>] [--oss-cad-bin <path>]
EOF
}

GUI_SRC_DIR=""
API_SERVER_BIN=""
OUT_TAR=""
WORK_ROOT=""
APPIMAGETOOL_BIN=""
OSS_CAD_BIN=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gui-src-dir)
            GUI_SRC_DIR="$2"
            shift 2
            ;;
        --api-server-bin)
            API_SERVER_BIN="$2"
            shift 2
            ;;
        --out-tar)
            OUT_TAR="$2"
            shift 2
            ;;
        --work-root)
            WORK_ROOT="$2"
            shift 2
            ;;
        --appimagetool-bin)
            APPIMAGETOOL_BIN="$2"
            shift 2
            ;;
        --oss-cad-bin)
            OSS_CAD_BIN="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ -z "$GUI_SRC_DIR" || -z "$API_SERVER_BIN" || -z "$OUT_TAR" || -z "$WORK_ROOT" ]]; then
    echo "ERROR: missing required arguments" >&2
    usage >&2
    exit 1
fi

API_SERVER_BIN="$(readlink -f "$API_SERVER_BIN")"
TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
GUI_DIR="$WORK_ROOT/gui"

if [[ -n "$APPIMAGETOOL_BIN" ]]; then
    APPIMAGETOOL_BIN="$(readlink -f "$APPIMAGETOOL_BIN")"
    if [[ ! -f "$APPIMAGETOOL_BIN" ]]; then
        echo "ERROR: appimagetool not found: $APPIMAGETOOL_BIN" >&2
        exit 1
    fi
fi

if [[ ! -f "$API_SERVER_BIN" ]]; then
    echo "ERROR: api server binary not found: $API_SERVER_BIN" >&2
    exit 1
fi
if [[ -z "$TARGET_TRIPLE" ]]; then
    echo "ERROR: failed to resolve rust target triple from rustc -vV" >&2
    exit 1
fi

rm -rf "$WORK_ROOT"
mkdir -p "$GUI_DIR"

# Bazel sandbox exposes source files as symlinks. Vite/Rollup may resolve
# realpaths outside the workspace root and reject emitted asset names.
# Copy with dereference to build from a physical tree.
cp -RL "$GUI_SRC_DIR/." "$GUI_DIR/"

mkdir -p "$GUI_DIR/src-tauri/binaries"
cp -f "$API_SERVER_BIN" "$GUI_DIR/src-tauri/binaries/api-server-$TARGET_TRIPLE"
chmod +x "$GUI_DIR/src-tauri/binaries/api-server-$TARGET_TRIPLE"

export TAURI_API_SERVER_BIN="$API_SERVER_BIN"
export APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-1}"

TAURI_BUNDLES="${TAURI_BUNDLES:-deb,appimage}"
TAURI_BUNDLES="$(echo "$TAURI_BUNDLES" | tr -d '[:space:]' | tr -s ',' | sed 's/^,//; s/,$//')"
echo "[bundle] tauri bundles: $TAURI_BUNDLES"

TAURI_DIR="$GUI_DIR/src-tauri"
OSS_CAD_BUNDLE_DIR="$TAURI_DIR/resources/oss-cad-suite"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

if [[ "${ENABLE_OSS_CAD_SUITE:-true}" == "true" ]] && [[ -n "$OSS_CAD_BIN" ]]; then
    OSS_CAD_BIN="$(readlink -f "$OSS_CAD_BIN")"
    if [[ ! -f "$OSS_CAD_BIN" ]]; then
        echo "ERROR: OSS CAD yosys binary not found: $OSS_CAD_BIN" >&2
        exit 1
    fi
    OSS_CAD_ROOT="$(dirname "$(dirname "$OSS_CAD_BIN")")"
    if [[ ! -f "$OSS_CAD_ROOT/bin/yosys" ]]; then
        echo "ERROR: invalid OSS CAD suite root: $OSS_CAD_ROOT" >&2
        exit 1
    fi
    mkdir -p "$TAURI_DIR/resources"
    rm -rf "$OSS_CAD_BUNDLE_DIR"
    cp -a "$OSS_CAD_ROOT" "$OSS_CAD_BUNDLE_DIR"
fi

(cd "$GUI_DIR" && pnpm install --frozen-lockfile)

if [[ "$TARGET_TRIPLE" == *linux* ]] && [[ ",$TAURI_BUNDLES," == *",appimage,"* ]]; then
    NON_APPIMAGE_BUNDLES="$(echo "$TAURI_BUNDLES" | sed -E 's/(^|,)appimage(,|$)/,/g' | tr -s ',' | sed 's/^,//; s/,$//')"

    if [[ -n "$NON_APPIMAGE_BUNDLES" ]]; then
        echo "[bundle] building non-appimage bundles with full OSS CAD suite: $NON_APPIMAGE_BUNDLES"
        (cd "$GUI_DIR" && pnpm exec tauri build --verbose --bundles "$NON_APPIMAGE_BUNDLES")
    fi

    if [[ ! -d "$OSS_CAD_BUNDLE_DIR" ]]; then
        echo "ERROR: OSS CAD suite resources dir not found: $OSS_CAD_BUNDLE_DIR" >&2
        exit 1
    fi

    PAYLOAD_STAGE_DIR="$(mktemp -d "$WORK_ROOT/oss-cad-payload.XXXXXX")"
    mv "$OSS_CAD_BUNDLE_DIR" "$PAYLOAD_STAGE_DIR/oss-cad-suite"
    mkdir -p "$OSS_CAD_BUNDLE_DIR"
    echo "Placeholder" > "$OSS_CAD_BUNDLE_DIR/README"

    # Restore the real OSS CAD suite on both success and failure.
    restore_oss_cad() {
        rm -rf "$OSS_CAD_BUNDLE_DIR"
        mv "$PAYLOAD_STAGE_DIR/oss-cad-suite" "$OSS_CAD_BUNDLE_DIR" 2>/dev/null || true
        rm -rf "$PAYLOAD_STAGE_DIR"
    }
    trap restore_oss_cad EXIT

    if ! (cd "$GUI_DIR" && pnpm exec tauri build --verbose --bundles appimage); then
        echo "ERROR: Tauri appimage build failed" >&2
        exit 1
    fi

    APPIMAGE_PATH="$(find "$BUNDLE_DIR" -type f -name "*.AppImage" 2>/dev/null | sort | tail -1)"
    if [[ -z "$APPIMAGE_PATH" || ! -f "$APPIMAGE_PATH" ]]; then
        echo "ERROR: AppImage artifact not found under: $BUNDLE_DIR" >&2
        exit 1
    fi

    if ! inject_oss_cad_into_appimage "$APPIMAGE_PATH" "$PAYLOAD_STAGE_DIR/oss-cad-suite"; then
        exit 1
    fi

    # Disarm the trap — restore manually so the script can continue.
    trap - EXIT
    restore_oss_cad
else
    (cd "$GUI_DIR" && pnpm exec tauri build --verbose --bundles "$TAURI_BUNDLES")
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
    echo "ERROR: Tauri bundle directory not found: $BUNDLE_DIR" >&2
    exit 1
fi

if ! find "$BUNDLE_DIR" -mindepth 1 -type f -print -quit | grep -q .; then
    echo "ERROR: Tauri bundle directory is empty: $BUNDLE_DIR" >&2
    find "$GUI_DIR/src-tauri/target" -maxdepth 5 -mindepth 1 -print >&2 || true
    exit 1
fi

mkdir -p "$(dirname "$OUT_TAR")"
tar -cf "$OUT_TAR" -C "$BUNDLE_DIR" .
