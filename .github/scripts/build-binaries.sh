#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_FILE/../.." && pwd)"

build_chip_viewer() {
  cd "$REPO_ROOT/ecos/chip-viewer"

  cargo build --release \
    -p chip-viewer-native
}

build_agent_provider() {
  cd "$REPO_ROOT/ecos/agent"

  uv run --locked --with pyinstaller==6.17 pyinstaller \
    --clean \
    --noconfirm \
    --onefile \
    --name ecos-agent \
    --distpath dist \
    --specpath build \
    --workpath build \
    --add-data "$PWD/knowledge:knowledge" \
    packaging/run_ecos_agent.py
}

validate_packaged_binaries() {
  local binary_dir="$REPO_ROOT/ecos/gui/apps/desktop-electron/resources/binaries"
  local agent_dir="$REPO_ROOT/ecos/gui/apps/desktop-electron/resources/agent"
  local missing=0

  local required_files=(
    "$binary_dir/chip-viewer-native"
  )

  for required_file in "${required_files[@]}"; do
    if [[ ! -x "$required_file" ]]; then
      printf 'required packaged binary is missing or not executable: %s\n' "$required_file" >&2
      missing=1
    fi
  done

  if [[ ! -x "$agent_dir/ecos-agent" ]]; then
    printf 'required packaged agent provider is missing or not executable: %s\n' "$agent_dir/ecos-agent" >&2
    missing=1
  fi

  if [[ ! -f "$agent_dir/agent-provider.json" ]]; then
    printf 'required packaged agent manifest is missing: %s\n' "$agent_dir/agent-provider.json" >&2
    missing=1
  fi

  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

build_chip_viewer
build_agent_provider

# ECC is deliberately NOT staged: packages stay slim and acquire the pinned
# ECC bundle from the registry on first run (the CLI installer's slim path).
cd "$REPO_ROOT"
rm -rf ecos/gui/apps/desktop-electron/resources
mkdir -p ecos/gui/apps/desktop-electron/resources/{agent,binaries}
cp ecos/chip-viewer/target/release/chip-viewer-native ecos/gui/apps/desktop-electron/resources/binaries
cp ecos/agent/dist/ecos-agent ecos/gui/apps/desktop-electron/resources/agent
cp ecos/agent/agent-provider.packaged.json ecos/gui/apps/desktop-electron/resources/agent/agent-provider.json
validate_packaged_binaries
