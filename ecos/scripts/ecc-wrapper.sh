#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_FILE/../../ecc"

if [ "${ECOS_ECC_USE_NIX:-}" = "1" ]; then
  exec nix develop --command uv run ecc "$@"
fi

exec uv run ecc "$@"
