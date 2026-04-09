#!/usr/bin/env bash
# gen-version-json.sh -- Read component versions from config files, append
# git short hash, write ecos/gui/src-tauri/ecos-version.json.
#
# Usage: scripts/gen-version-json.sh [REPO_ROOT]
#   REPO_ROOT defaults to the parent directory of this script's location.
set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Per-component last-modified git short hash.
# Each component gets the hash of the last commit that touched its source tree.
git_hash_for() {
    git -C "$REPO_ROOT" log -1 --format=%h -- "$@" 2>/dev/null || true
}

gui_ver=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/ecos/gui/src-tauri/tauri.conf.json'))['version'])")
gui_hash=$(git_hash_for ecos/gui/)

server_ver=$(python3 -c "import tomllib; print(tomllib.load(open('$REPO_ROOT/ecos/server/pyproject.toml','rb'))['project']['version'])")
server_hash=$(git_hash_for ecos/server/)

ecc_ver=$(python3 -c "import tomllib; print(tomllib.load(open('$REPO_ROOT/ecc/pyproject.toml','rb'))['project']['version'])")
ecc_hash=$(git_hash_for ecc/ ':!ecc/chipcompiler/thirdparty/ecc-dreamplace/')

dreamplace_ver=$(python3 -c "import tomllib; print(tomllib.load(open('$REPO_ROOT/ecc/chipcompiler/thirdparty/ecc-dreamplace/pyproject.toml','rb'))['project']['version'])")
dreamplace_hash=$(git_hash_for ecc/chipcompiler/thirdparty/ecc-dreamplace/)

# Compose version strings: <base>-<hash> or just <base> if git unavailable
fmt() { local v="$1" h="$2"; echo "${v}${h:+-$h}"; }

OUT="$REPO_ROOT/ecos/gui/src-tauri/ecos-version.json"
cat > "$OUT" <<EOF
{
  "gui": "$(fmt "$gui_ver" "$gui_hash")",
  "server": "$(fmt "$server_ver" "$server_hash")",
  "ecc": "$(fmt "$ecc_ver" "$ecc_hash")",
  "dreamplace": "$(fmt "$dreamplace_ver" "$dreamplace_hash")"
}
EOF

echo "[gen-version-json] wrote $OUT"
cat "$OUT"
