#!/usr/bin/env bash
# gen-version-json.sh -- Read component versions from config files, append
# git short hash, write ecos/gui/src-tauri/ecos-version.json.
#
# Usage: scripts/gen-version-json.sh [REPO_ROOT]
#   REPO_ROOT defaults to the parent directory of this script's location.
set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Git short hash (fallback to empty if not in a repo or git unavailable)
git_hash=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || true)
suffix="${git_hash:+-$git_hash}"

gui_ver=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/ecos/gui/src-tauri/tauri.conf.json'))['version'])")
server_ver=$(python3 -c "import tomllib; print(tomllib.load(open('$REPO_ROOT/ecos/server/pyproject.toml','rb'))['project']['version'])")
ecc_ver=$(python3 -c "import tomllib; print(tomllib.load(open('$REPO_ROOT/ecc/pyproject.toml','rb'))['project']['version'])")
dreamplace_ver=$(python3 -c "import tomllib; print(tomllib.load(open('$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-dreamplace/pyproject.toml','rb'))['project']['version'])")

OUT="$REPO_ROOT/ecos/gui/src-tauri/ecos-version.json"
cat > "$OUT" <<EOF
{
  "gui": "${gui_ver}${suffix}",
  "server": "${server_ver}${suffix}",
  "ecc": "${ecc_ver}${suffix}",
  "dreamplace": "${dreamplace_ver}${suffix}"
}
EOF

echo "[gen-version-json] wrote $OUT"
cat "$OUT"
