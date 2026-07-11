#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="$SCRIPT_DIR/chipgeom-performance-smoke.sh"

if [ ! -f "$SMOKE_SCRIPT" ]; then
  echo "missing smoke script: $SMOKE_SCRIPT" >&2
  exit 1
fi

help_output="$(bash "$SMOKE_SCRIPT" --help)"
for expected in "--synthetic-shapes" "--max-p95-ns" "--max-mapped-plus-index-bytes" "--max-view-tiles" "--geometry-base-tile-size" "--geometry-lod-levels"; do
  if [[ "$help_output" != *"$expected"* ]]; then
    echo "missing help text: $expected" >&2
    exit 1
  fi
done

dry_run_output="$(
  bash "$SMOKE_SCRIPT" \
    --dry-run \
    --out /tmp/chipgeom-smoke-test \
    --synthetic-shapes 1024 \
    --iterations 3 \
    --geometry-base-tile-size 128 \
    --geometry-lod-levels 1 \
    --max-p95-ns 999999 \
    --max-mapped-plus-index-bytes 99999999 \
    --max-view-tiles 99999
)"
for expected in "ecc-geometry-snapshot-wrapper.sh" "cargo run -p chipgeom-probe" "--bench-viewport" "synthetic_clk" "--geometry-base-tile-size 128" "--geometry-lod-levels 1"; do
  if [[ "$dry_run_output" != *"$expected"* ]]; then
    echo "missing dry-run command fragment: $expected" >&2
    exit 1
  fi
done

set +e
missing_value_output="$(bash "$SMOKE_SCRIPT" --dry-run --out 2>&1)"
missing_value_status=$?
set -e
if [ "$missing_value_status" -eq 0 ]; then
  echo "expected missing --out value to fail" >&2
  exit 1
fi
if [[ "$missing_value_output" != *"--out requires a value"* ]]; then
  echo "unexpected missing value output: $missing_value_output" >&2
  exit 1
fi
