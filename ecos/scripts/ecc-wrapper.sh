#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_FILE/../../ecc"

if command -v direnv; then
  eval "$(direnv export bash)"
fi

exec uv run ecc "$@"
