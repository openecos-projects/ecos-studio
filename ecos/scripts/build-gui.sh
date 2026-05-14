#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<EOF
Usage: $0 --gui-src-dir <dir> --api-server-bin <path> --out-tar <path> [--oss-cad-bin <path>]
EOF
}

read_repo_node_version() {
    local search_dir="$1"

    while [[ "$search_dir" != "/" ]]; do
        local nvmrc="$search_dir/.nvmrc"
        if [[ -f "$nvmrc" ]]; then
            tr -d '[:space:]' < "$nvmrc"
            return 0
        fi
        search_dir="$(dirname "$search_dir")"
    done

    echo "ERROR: .nvmrc not found while searching upward from $1" >&2
    exit 1
}

pnpm_with_repo_node() {
    local gui_dir="$1"
    shift

    local node_version
    node_version="$(read_repo_node_version "$gui_dir")"
    if ! command -v pnpm >/dev/null 2>&1; then
        echo "ERROR: pnpm not found in PATH. Run the Node.js/pnpm setup before building the GUI bundle." >&2
        exit 1
    fi

    npx -y -p "node@${node_version}" -- bash -c 'exec pnpm --dir "$1" "${@:2}"' bash "$gui_dir" "$@"
}

normalize_csv() {
    echo "$1" | tr -d '[:space:]' | tr -s ',' | sed 's/^,//; s/,$//'
}

detect_api_server_triple() {
    local uname_s
    local uname_m
    uname_s="$(uname -s)"
    uname_m="$(uname -m)"

    case "$uname_s/$uname_m" in
        Linux/x86_64)
            echo "x86_64-unknown-linux-gnu"
            ;;
        Linux/aarch64|Linux/arm64)
            echo "aarch64-unknown-linux-gnu"
            ;;
        Darwin/arm64)
            echo "aarch64-apple-darwin"
            ;;
        Darwin/x86_64)
            echo "x86_64-apple-darwin"
            ;;
        MINGW*/*|MSYS*/*|CYGWIN*/*)
            echo "x86_64-pc-windows-msvc"
            ;;
        *)
            echo "ERROR: unsupported host platform for API server bundle naming: $uname_s/$uname_m" >&2
            exit 1
            ;;
    esac
}

map_linux_target() {
    local raw_target
    raw_target="$(echo "$1" | tr '[:upper:]' '[:lower:]')"

    case "$raw_target" in
        appimage)
            echo "AppImage"
            ;;
        deb|dir|rpm)
            echo "$raw_target"
            ;;
        *)
            echo "ERROR: unsupported Electron Linux target: $1" >&2
            exit 1
            ;;
    esac
}

prepare_placeholder_oss_cad_suite() {
    local target_dir="$1"
    rm -rf "$target_dir"
    mkdir -p "$target_dir"
    echo "placeholder for electron package build" > "$target_dir/README"
    echo "placeholder" > "$target_dir/placeholder.txt"
}

verify_yosys_slang_support() {
    local yosys_bin="$1"

    if ! "$yosys_bin" -Q -m slang -p 'help' >/dev/null 2>&1; then
        echo "ERROR: yosys slang plugin check failed for $yosys_bin" >&2
        echo "Provide an OSS CAD suite bundle whose yosys can load the slang plugin." >&2
        exit 1
    fi
}

resolve_oss_cad_bin() {
    if [[ -n "$OSS_CAD_BIN" ]]; then
        readlink -f "$OSS_CAD_BIN"
        return 0
    fi

    if [[ -n "${CHIPCOMPILER_OSS_CAD_DIR:-}" && -f "${CHIPCOMPILER_OSS_CAD_DIR}/bin/yosys" ]]; then
        readlink -f "${CHIPCOMPILER_OSS_CAD_DIR}/bin/yosys"
        return 0
    fi

    return 1
}

install_api_server_artifact() {
    local artifact_path="$1"
    local target_path="$2"

    rm -rf "$target_path"

    if tar -tf "$artifact_path" >/dev/null 2>&1; then
        mkdir -p "$target_path"
        tar -xf "$artifact_path" -C "$target_path"
        local executable_path="$target_path/ecos-server"
        if [[ ! -x "$executable_path" ]]; then
            echo "ERROR: API server bundle is missing executable: $executable_path" >&2
            exit 1
        fi
        chmod +x "$executable_path"
        return 0
    fi

    cp -f "$artifact_path" "$target_path"
    chmod +x "$target_path"
}

validate_packaged_oss_cad_suite() {
    local release_dir="$1"

    if [[ "${ENABLE_OSS_CAD_SUITE:-true}" != "true" ]]; then
        return 0
    fi

    local packaged_root="$release_dir/linux-unpacked/resources/resources/oss-cad-suite"
    local packaged_yosys="$packaged_root/bin/yosys"
    local packaged_slang="$packaged_root/share/yosys/plugins/slang.so"

    if [[ ! -x "$packaged_yosys" ]]; then
        echo "ERROR: packaged OSS CAD suite is missing yosys at: $packaged_yosys" >&2
        exit 1
    fi

    if [[ ! -f "$packaged_slang" ]]; then
        echo "ERROR: packaged OSS CAD suite is missing slang plugin at: $packaged_slang" >&2
        exit 1
    fi

    verify_yosys_slang_support "$packaged_yosys"
}

main() {
    GUI_SRC_DIR=""
    API_SERVER_BIN=""
    OUT_TAR=""
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

    if [[ -z "$GUI_SRC_DIR" || -z "$API_SERVER_BIN" || -z "$OUT_TAR" ]]; then
        echo "ERROR: missing required arguments" >&2
        usage >&2
        exit 1
    fi

    API_SERVER_BIN="$(readlink -f "$API_SERVER_BIN")"
    TARGET_TRIPLE="${ECOS_API_SERVER_TRIPLE:-$(detect_api_server_triple)}"
    WORK_ROOT="$(mktemp -d)"
    trap 'rm -rf "$WORK_ROOT"' EXIT
    GUI_DIR="$WORK_ROOT/gui"
    ELECTRON_APP_DIR="$GUI_DIR/apps/desktop-electron"
    ELECTRON_RESOURCES_DIR="$ELECTRON_APP_DIR/resources"
    ELECTRON_BINARIES_DIR="$ELECTRON_RESOURCES_DIR/binaries"
    OSS_CAD_BUNDLE_DIR="$ELECTRON_RESOURCES_DIR/oss-cad-suite"
    RELEASE_DIR="$ELECTRON_APP_DIR/release"

    if [[ ! -f "$API_SERVER_BIN" ]]; then
        echo "ERROR: api server artifact not found: $API_SERVER_BIN" >&2
        exit 1
    fi
    if [[ -z "$TARGET_TRIPLE" ]]; then
        echo "ERROR: failed to resolve API server bundle target triple" >&2
        exit 1
    fi

    rm -rf "$WORK_ROOT"
    mkdir -p "$GUI_DIR"

    # Bazel sandbox exposes source files as symlinks. Vite/Rollup may resolve
    # realpaths outside the workspace root and reject emitted asset names.
    # Copy with dereference to build from a physical tree, while leaving local
    # dependency trees and generated bundles behind. Those directories may contain
    # stale pnpm symlinks after switching branches.
    (
        cd "$GUI_SRC_DIR"
        tar \
            --create \
            --dereference \
            --exclude='./node_modules' \
            --exclude='*/node_modules' \
            --exclude='./dist' \
            --exclude='*/dist' \
            --exclude='./dist-ssr' \
            --exclude='*/dist-ssr' \
            --exclude='./release' \
            --exclude='*/release' \
            --exclude='./apps/*/release' \
            -f - \
            .
    ) | (
        cd "$GUI_DIR"
        tar -xf -
    )

    mkdir -p "$ELECTRON_BINARIES_DIR"
    install_api_server_artifact "$API_SERVER_BIN" "$ELECTRON_BINARIES_DIR/api-server-$TARGET_TRIPLE"

    ECOS_ELECTRON_LINUX_TARGETS="${ECOS_ELECTRON_LINUX_TARGETS:-AppImage,deb}"
    ECOS_ELECTRON_LINUX_TARGETS="$(normalize_csv "$ECOS_ELECTRON_LINUX_TARGETS")"
    if [[ -z "$ECOS_ELECTRON_LINUX_TARGETS" ]]; then
        echo "ERROR: no Electron Linux targets specified" >&2
        exit 1
    fi
    echo "[bundle] electron linux targets: $ECOS_ELECTRON_LINUX_TARGETS"

    declare -a ELECTRON_TARGET_ARGS=()
    IFS=',' read -r -a RAW_ELECTRON_TARGETS <<< "$ECOS_ELECTRON_LINUX_TARGETS"
    for raw_target in "${RAW_ELECTRON_TARGETS[@]}"; do
        ELECTRON_TARGET_ARGS+=("$(map_linux_target "$raw_target")")
    done

    if [[ "${ENABLE_OSS_CAD_SUITE:-true}" == "true" ]]; then
        if ! OSS_CAD_BIN="$(resolve_oss_cad_bin)"; then
            echo "ERROR: OSS CAD suite is required for GUI packaging, but no yosys binary was provided." >&2
            echo "Pass --oss-cad-bin or set CHIPCOMPILER_OSS_CAD_DIR to a yosys/slang-capable bundle." >&2
            echo "If you intentionally want a package without flow support, set ENABLE_OSS_CAD_SUITE=false." >&2
            exit 1
        fi
        if [[ ! -f "$OSS_CAD_BIN" ]]; then
            echo "ERROR: OSS CAD yosys binary not found: $OSS_CAD_BIN" >&2
            exit 1
        fi
        verify_yosys_slang_support "$OSS_CAD_BIN"
        OSS_CAD_ROOT="$(dirname "$(dirname "$OSS_CAD_BIN")")"
        if [[ ! -f "$OSS_CAD_ROOT/bin/yosys" ]]; then
            echo "ERROR: invalid OSS CAD suite root: $OSS_CAD_ROOT" >&2
            exit 1
        fi
        rm -rf "$OSS_CAD_BUNDLE_DIR"
        cp -a "$OSS_CAD_ROOT" "$OSS_CAD_BUNDLE_DIR"
        verify_yosys_slang_support "$OSS_CAD_BUNDLE_DIR/bin/yosys"
    else
        prepare_placeholder_oss_cad_suite "$OSS_CAD_BUNDLE_DIR"
    fi

    # cp -RL above dereferences pnpm's symlinked node_modules, breaking module
    # resolution. Remove any copied workspace node_modules so pnpm can recreate
    # the proper symlink layout from a clean tree.
    find "$GUI_DIR" -type d -name node_modules -prune -exec rm -rf '{}' +

    pnpm_with_repo_node "$GUI_DIR" install --frozen-lockfile
    pnpm_with_repo_node "$GUI_DIR" run desktop:build
    rm -rf "$RELEASE_DIR"
    pnpm_with_repo_node "$ELECTRON_APP_DIR" exec electron-builder --config electron-builder.yml --linux "${ELECTRON_TARGET_ARGS[@]}"

    if [[ ! -d "$RELEASE_DIR" ]]; then
        echo "ERROR: Electron release directory not found: $RELEASE_DIR" >&2
        exit 1
    fi

    if ! find "$RELEASE_DIR" -mindepth 1 -print -quit | grep -q .; then
        echo "ERROR: Electron release directory is empty: $RELEASE_DIR" >&2
        find "$ELECTRON_APP_DIR" -maxdepth 4 -mindepth 1 -print >&2 || true
        exit 1
    fi

    validate_packaged_oss_cad_suite "$RELEASE_DIR"

    LOWER_ELECTRON_TARGETS="$(echo "$ECOS_ELECTRON_LINUX_TARGETS" | tr '[:upper:]' '[:lower:]')"

    if [[ ",$LOWER_ELECTRON_TARGETS," == *",appimage,"* ]]; then
        if ! find "$RELEASE_DIR" -type f -name "*.AppImage" -print -quit | grep -q .; then
            echo "ERROR: AppImage artifact not found under: $RELEASE_DIR" >&2
            find "$RELEASE_DIR" -maxdepth 4 -mindepth 1 -print >&2 || true
            exit 1
        fi
    fi

    if [[ ",$LOWER_ELECTRON_TARGETS," == *",deb,"* ]]; then
        if ! find "$RELEASE_DIR" -type f -name "*.deb" -print -quit | grep -q .; then
            echo "ERROR: deb artifact not found under: $RELEASE_DIR" >&2
            find "$RELEASE_DIR" -maxdepth 4 -mindepth 1 -print >&2 || true
            exit 1
        fi
    fi

    mkdir -p "$(dirname "$OUT_TAR")"
    tar -cf "$OUT_TAR" -C "$RELEASE_DIR" .
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
