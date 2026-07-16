#!/usr/bin/env bash
set -euo pipefail

ROOT="$(dirname "${BASH_SOURCE[0]}")/../../ecc/chipcompiler/thirdparty/ecc-tools"
cd "$ROOT"

if [ ! -d build ]; then
  cmake -S . -B build
fi

cmake --build build --target ecc_geometry_snapshot -j "${ECOS_BUILD_JOBS:-4}"
if [ -x bin/ecc-geometry-snapshot ]; then
  exec bin/ecc-geometry-snapshot "$@"
fi

exec build/src/apps/geometry_snapshot/ecc-geometry-snapshot "$@"
