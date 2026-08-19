#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_FILE/../../ecc"

# Keep native dependency builds responsive on development machines.  Use the
# available CPU count, leaving three cores for the desktop and the OS.
cpu_count="$(nproc 2>/dev/null || true)"
if ! [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]]; then
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
fi
if ! [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]]; then
  cpu_count=1
fi

build_jobs=$((cpu_count > 2 ? cpu_count - 2 : 1))
export CMAKE_BUILD_PARALLEL_LEVEL="$build_jobs"
export MAKEFLAGS="-j${build_jobs}"
export NINJAFLAGS="-j${build_jobs}"

printf '[ecc-wrapper] limiting native builds to %s job(s) (%s online CPU core(s))\n' \
  "$build_jobs" "$cpu_count" >&2

if [ "${ECOS_ECC_USE_NIX:-}" = "1" ]; then
  exec nix develop --command uv run ecc "$@"
fi

exec uv run ecc "$@"
