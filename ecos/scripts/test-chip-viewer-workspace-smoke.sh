#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="$SCRIPT_DIR/chip-viewer-workspace-smoke.sh"

if [ ! -f "$SMOKE_SCRIPT" ]; then
  echo "missing smoke script: $SMOKE_SCRIPT" >&2
  exit 1
fi

help_output="$(bash "$SMOKE_SCRIPT" --help)"
for expected in "--workspace" "--step" "--out" "--dry-run" "chipgeom-probe"; do
  if [[ "$help_output" != *"$expected"* ]]; then
    echo "missing help text: $expected" >&2
    exit 1
  fi
done

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/place_dreamplace/output/geometry"
printf 'schema_version=1\n' > "$workspace/place_dreamplace/output/geometry/geometry.manifest"

dry_run_output="$(
  bash "$SMOKE_SCRIPT" \
    --dry-run \
    --workspace "$workspace" \
    --step place \
    --out /tmp/chip-viewer-workspace-smoke-test
)"
for expected in "cargo run -p chipgeom-probe" "place_dreamplace" "geometry.manifest" "/tmp/chip-viewer-workspace-smoke-test"; do
  if [[ "$dry_run_output" != *"$expected"* ]]; then
    echo "missing dry-run command fragment: $expected" >&2
    exit 1
  fi
done

set +e
missing_workspace_output="$(bash "$SMOKE_SCRIPT" --dry-run 2>&1)"
missing_workspace_status=$?
set -e
if [ "$missing_workspace_status" -eq 0 ]; then
  echo "expected missing --workspace to fail" >&2
  exit 1
fi
if [[ "$missing_workspace_output" != *"--workspace is required"* ]]; then
  echo "unexpected missing workspace output: $missing_workspace_output" >&2
  exit 1
fi
