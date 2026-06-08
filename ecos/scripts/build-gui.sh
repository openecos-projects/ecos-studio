#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<EOF
Usage: $0 --gui-src-dir <dir> --out-tar <path> --ecc-cli-artifact <path> [--oss-cad-bin <ignored>]
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

validate_no_packaged_oss_cad_suite() {
    local release_dir="$1"
    local packaged_root

    packaged_root="$(find "$release_dir" -path '*/resources/oss-cad-suite' -print -quit)"
    if [[ -n "$packaged_root" ]]; then
        echo "ERROR: packaged OSS CAD suite must not be present: $packaged_root" >&2
        exit 1
    fi
}

validate_requested_linux_artifacts() {
    local release_dir="$1"
    local requested_targets="$2"
    local lower_targets

    lower_targets="$(echo "$requested_targets" | tr '[:upper:]' '[:lower:]')"

    if [[ ",$lower_targets," == *",appimage,"* ]]; then
        if [[ -z "$(find "$release_dir" -type f -name "*.AppImage" -print -quit)" ]]; then
            echo "ERROR: AppImage artifact not found under: $release_dir" >&2
            find "$release_dir" -maxdepth 4 -mindepth 1 -print >&2 || true
            exit 1
        fi
    fi

    if [[ ",$lower_targets," == *",deb,"* ]]; then
        if [[ -z "$(find "$release_dir" -type f -name "*.deb" -print -quit)" ]]; then
            echo "ERROR: deb artifact not found under: $release_dir" >&2
            find "$release_dir" -maxdepth 4 -mindepth 1 -print >&2 || true
            exit 1
        fi
    fi

    if [[ ",$lower_targets," == *",rpm,"* ]]; then
        if [[ -z "$(find "$release_dir" -type f -name "*.rpm" -print -quit)" ]]; then
            echo "ERROR: rpm artifact not found under: $release_dir" >&2
            find "$release_dir" -maxdepth 4 -mindepth 1 -print >&2 || true
            exit 1
        fi
    fi

    if [[ ",$lower_targets," == *",dir,"* ]]; then
        if [[ ! -d "$release_dir/linux-unpacked" ]]; then
            echo "ERROR: dir artifact not found under: $release_dir" >&2
            find "$release_dir" -maxdepth 4 -mindepth 1 -print >&2 || true
            exit 1
        fi
    fi
}

main() {
    GUI_SRC_DIR=""
    OUT_TAR=""
    ECC_CLI_ARTIFACT=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --gui-src-dir)
                GUI_SRC_DIR="$2"
                shift 2
                ;;
            --out-tar)
                OUT_TAR="$2"
                shift 2
                ;;
            --oss-cad-bin)
                echo "WARN: --oss-cad-bin is deprecated and ignored; desktop Yosys comes from Resource Manager." >&2
                shift 2
                ;;
            --ecc-cli-artifact)
                ECC_CLI_ARTIFACT="$2"
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

    if [[ -z "$GUI_SRC_DIR" || -z "$OUT_TAR" || -z "$ECC_CLI_ARTIFACT" ]]; then
        echo "ERROR: missing required arguments" >&2
        usage >&2
        exit 1
    fi

    ECC_CLI_ARTIFACT="$(readlink -f "$ECC_CLI_ARTIFACT")"
    if [[ ! -f "$ECC_CLI_ARTIFACT" ]]; then
        echo "ERROR: ECC CLI artifact not found: $ECC_CLI_ARTIFACT" >&2
        exit 1
    fi

    WORK_ROOT="$(mktemp -d)"
    trap 'rm -rf "$WORK_ROOT"' EXIT
    GUI_DIR="$WORK_ROOT/gui"
    ELECTRON_APP_DIR="$GUI_DIR/apps/desktop-electron"
    ELECTRON_RESOURCES_DIR="$ELECTRON_APP_DIR/resources"
    ELECTRON_BINARIES_DIR="$ELECTRON_RESOURCES_DIR/binaries"
    RELEASE_DIR="$ELECTRON_APP_DIR/release"

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

    install_ecc_cli_artifact "$ECC_CLI_ARTIFACT" "$ELECTRON_BINARIES_DIR"

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


    # The source copy above dereferences pnpm's symlinked node_modules, breaking
    # module resolution. Remove any copied workspace node_modules so pnpm can
    # recreate the proper symlink layout from a clean tree.
    find "$GUI_DIR" -type d -name node_modules -prune -exec rm -rf '{}' +

    pnpm_with_repo_node "$GUI_DIR" install --frozen-lockfile
    pnpm_with_repo_node "$GUI_DIR" run desktop:build
    rm -rf "$RELEASE_DIR"
    pnpm_with_repo_node "$ELECTRON_APP_DIR" exec electron-builder --config electron-builder.yml --linux "${ELECTRON_TARGET_ARGS[@]}"

    if [[ ! -d "$RELEASE_DIR" ]]; then
        echo "ERROR: Electron release directory not found: $RELEASE_DIR" >&2
        exit 1
    fi

    if [[ -z "$(find "$RELEASE_DIR" -mindepth 1 -print -quit)" ]]; then
        echo "ERROR: Electron release directory is empty: $RELEASE_DIR" >&2
        find "$ELECTRON_APP_DIR" -maxdepth 4 -mindepth 1 -print >&2 || true
        exit 1
    fi

    validate_no_packaged_oss_cad_suite "$RELEASE_DIR"

    validate_requested_linux_artifacts "$RELEASE_DIR" "$ECOS_ELECTRON_LINUX_TARGETS"

    mkdir -p "$(dirname "$OUT_TAR")"
    tar -cf "$OUT_TAR" -C "$RELEASE_DIR" .
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
