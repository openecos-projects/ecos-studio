#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHIP_VIEWER_DIR="$ROOT/ecos/chip-viewer"

WORKSPACE=""
OUT_DIR="${CHIP_VIEWER_WORKSPACE_SMOKE_OUT:-/tmp/chip_viewer_workspace_smoke}"
DRY_RUN=false
STEPS=()

usage() {
  cat <<'EOF'
Usage: chip-viewer-workspace-smoke.sh --workspace <path> [options]

Open existing geometry manifests from an ECOS workspace with chipgeom-probe.
This validates that step geometry snapshots are readable without launching the GUI.

Options:
  --workspace <path>      ECOS workspace path.
  --step <name-or-dir>    Step name or step directory. May be repeated.
  --out <dir>             Directory for per-step probe JSON reports.
  --dry-run               Print probe commands without executing.
  -h, --help              Show this help.
EOF
}

require_value() {
  local option_name="$1"
  local value="${2-}"
  if [ -z "$value" ]; then
    echo "$option_name requires a value" >&2
    exit 2
  fi
  printf '%s\n' "$value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --workspace)
      WORKSPACE="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --step)
      STEPS+=("$(require_value "$1" "${2:-}")")
      shift 2
      ;;
    --out)
      OUT_DIR="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$WORKSPACE" ]; then
  echo "--workspace is required" >&2
  usage >&2
  exit 2
fi
if [ ! -d "$WORKSPACE" ]; then
  echo "workspace does not exist: $WORKSPACE" >&2
  exit 1
fi

resolve_step_dir() {
  local step="$1"
  if [ -d "$WORKSPACE/$step" ]; then
    printf '%s\n' "$WORKSPACE/$step"
    return 0
  fi

  local match=""
  while IFS= read -r candidate; do
    match="$candidate"
    break
  done < <(
    find "$WORKSPACE" -mindepth 1 -maxdepth 1 -type d \
      \( -iname "$step" -o -iname "${step}_*" -o -iname "*_${step}" \) | sort
  )

  if [ -n "$match" ]; then
    printf '%s\n' "$match"
    return 0
  fi

  return 1
}

step_dirs=()
if [ "${#STEPS[@]}" -eq 0 ]; then
  while IFS= read -r candidate; do
    if [ -f "$candidate/output/geometry/geometry.manifest" ]; then
      step_dirs+=("$candidate")
    fi
  done < <(
    find "$WORKSPACE" -mindepth 1 -maxdepth 1 -type d \
      \( -name "*_ecc" -o -name "*_dreamplace" -o -name "*_yosys" \) | sort
  )
else
  for step in "${STEPS[@]}"; do
    if ! step_dir="$(resolve_step_dir "$step")"; then
      echo "step directory not found: $step" >&2
      exit 1
    fi
    manifest="$step_dir/output/geometry/geometry.manifest"
    if [ ! -f "$manifest" ]; then
      echo "step geometry manifest does not exist: $manifest" >&2
      exit 1
    fi
    step_dirs+=("$step_dir")
  done
fi

if [ "${#step_dirs[@]}" -eq 0 ]; then
  echo "no step geometry manifests found under: $WORKSPACE" >&2
  exit 1
fi

if [ "$DRY_RUN" = false ]; then
  rm -rf "$OUT_DIR"
  mkdir -p "$OUT_DIR"
fi

for step_dir in "${step_dirs[@]}"; do
  step_name="$(basename "$step_dir")"
  manifest="$step_dir/output/geometry/geometry.manifest"
  report="$OUT_DIR/${step_name}.chipgeom-probe.json"

  if [ "$DRY_RUN" = true ]; then
    echo "cd $CHIP_VIEWER_DIR && cargo run -p chipgeom-probe -- --manifest $manifest --json > $report"
    continue
  fi

  (
    cd "$CHIP_VIEWER_DIR"
    cargo run -p chipgeom-probe -- --manifest "$manifest" --json
  ) > "$report"

  python3 - "$report" "$step_name" <<'PY'
import json
import sys

report_path = sys.argv[1]
step_name = sys.argv[2]

with open(report_path, "r", encoding="utf-8") as handle:
    report = json.load(handle)

shape_count = int(report.get("shape_count", 0))
layer_count = int(report.get("layer_count", 0))
schema_version = report.get("schema_version")

if shape_count <= 0:
    raise SystemExit(f"{step_name}: shape_count must be positive")
if layer_count <= 0:
    raise SystemExit(f"{step_name}: layer_count must be positive")

print(
    f"{step_name}: schema={schema_version} shapes={shape_count} "
    f"layers={layer_count} report={report_path}"
)
PY
done
