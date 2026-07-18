#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHIP_VIEWER_DIR="$ROOT/ecos/chip-viewer"

WORKSPACE=""
OUT_DIR="${CHIP_VIEWER_WORKSPACE_SMOKE_OUT:-/tmp/chip_viewer_workspace_smoke}"
DRY_RUN=false
BENCH_VIEWPORT=false
ITERATIONS="${CHIP_VIEWER_WORKSPACE_SMOKE_ITERATIONS:-25}"
LAYER_ID="${CHIP_VIEWER_WORKSPACE_SMOKE_LAYER:-auto}"
MAX_VIEWPORT_P95_NS="${CHIP_VIEWER_WORKSPACE_SMOKE_MAX_VIEWPORT_P95_NS:-0}"
MAX_MAPPED_PLUS_INDEX_BYTES="${CHIP_VIEWER_WORKSPACE_SMOKE_MAX_MAPPED_PLUS_INDEX_BYTES:-0}"
MAX_VIEW_TILES="${CHIP_VIEWER_WORKSPACE_SMOKE_MAX_VIEW_TILES:-0}"
STEPS=()
BBOX=()

usage() {
  cat <<'EOF'
Usage: chip-viewer-workspace-smoke.sh --workspace <path> [options]

Open existing geometry manifests from an ECOS workspace with chipgeom-probe.
This validates that step geometry snapshots are readable without launching the GUI.

Options:
  --workspace <path>      ECOS workspace path.
  --step <name-or-dir>    Step name or step directory. May be repeated.
  --out <dir>             Directory for per-step probe JSON reports.
  --bench-viewport        Also run a viewport query benchmark for each step.
  --iterations <count>    Benchmark iterations. Default: 25.
  --layer <id|auto>       Benchmark layer id. Default: auto.
  --bbox <lx> <ly> <hx> <hy>
                          Benchmark viewport. Default: center quarter of design bbox.
  --max-viewport-p95-ns <ns>
                          Fail when benchmark viewport p95 exceeds this value. 0 disables.
  --max-mapped-plus-index-bytes <n>
                          Fail when mapped plus index memory exceeds this value. 0 disables.
  --max-view-tiles <n>    Fail when view tile count exceeds this value. 0 disables.
  --dry-run               Print probe commands without executing.
  -h, --help              Show this help.

Reports:
  Writes per-step probe JSON files and a summary.jsonl file under --out.
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
    --bench-viewport)
      BENCH_VIEWPORT=true
      shift
      ;;
    --iterations)
      ITERATIONS="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --layer)
      LAYER_ID="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --bbox)
      if [ "$#" -lt 5 ]; then
        echo "--bbox requires four values" >&2
        exit 2
      fi
      BBOX=("$2" "$3" "$4" "$5")
      shift 5
      ;;
    --max-viewport-p95-ns)
      MAX_VIEWPORT_P95_NS="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --max-mapped-plus-index-bytes)
      MAX_MAPPED_PLUS_INDEX_BYTES="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --max-view-tiles)
      MAX_VIEW_TILES="$(require_value "$1" "${2:-}")"
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
  : > "$OUT_DIR/summary.jsonl"
fi

for step_dir in "${step_dirs[@]}"; do
  step_name="$(basename "$step_dir")"
  manifest="$step_dir/output/geometry/geometry.manifest"
  report="$OUT_DIR/${step_name}.chipgeom-probe.json"
  bench_report="$OUT_DIR/${step_name}.chipgeom-probe.bench.json"

  if [ "$DRY_RUN" = true ]; then
    echo "cd $CHIP_VIEWER_DIR && cargo run -p chipgeom-probe -- --manifest $manifest --json > $report"
    if [ "$BENCH_VIEWPORT" = true ]; then
      if [ "$LAYER_ID" != "auto" ] && [ "${#BBOX[@]}" -eq 4 ]; then
        echo "cd $CHIP_VIEWER_DIR && cargo run -p chipgeom-probe -- --manifest $manifest --json --bench-viewport --layer $LAYER_ID --bbox ${BBOX[*]} --iterations $ITERATIONS > $bench_report"
      else
        echo "derive benchmark viewport from $report, then run chipgeom-probe --bench-viewport --layer $LAYER_ID --iterations $ITERATIONS > $bench_report"
      fi
      echo "append benchmark summary to $OUT_DIR/summary.jsonl"
    else
      echo "append readable snapshot summary to $OUT_DIR/summary.jsonl"
    fi
    continue
  fi

  (
    cd "$CHIP_VIEWER_DIR"
    cargo run -p chipgeom-probe -- --manifest "$manifest" --json
  ) > "$report"

  if [ "$BENCH_VIEWPORT" = true ]; then
    if [ "$LAYER_ID" = "auto" ] || [ "${#BBOX[@]}" -ne 4 ]; then
      auto_bench_values="$(
        python3 - "$report" "$LAYER_ID" "${BBOX[@]}" <<'PY'
import json
import sys

report_path = sys.argv[1]
layer_arg = sys.argv[2]
bbox_args = sys.argv[3:]

with open(report_path, "r", encoding="utf-8") as handle:
    report = json.load(handle)

layers = report.get("layers") or []
if layer_arg == "auto":
    if not layers:
        raise SystemExit("cannot auto-select benchmark layer: report has no layers")
    layer = max(layers, key=lambda item: (int(item.get("shape_count", 0)), -int(item.get("order", 0))))
    layer_id = int(layer.get("layer_id", 0))
else:
    layer_id = int(layer_arg)

if len(bbox_args) == 4:
    bbox = [int(value) for value in bbox_args]
else:
    design_bbox = report.get("bbox") or {}
    try:
        lx = int(design_bbox["lx"])
        ly = int(design_bbox["ly"])
        hx = int(design_bbox["hx"])
        hy = int(design_bbox["hy"])
    except KeyError as exc:
        raise SystemExit(f"cannot derive benchmark bbox: missing bbox.{exc.args[0]}") from exc
    if hx <= lx or hy <= ly:
        raise SystemExit(f"cannot derive benchmark bbox from empty design bbox: {design_bbox}")
    width = hx - lx
    height = hy - ly
    view_width = max(1, width // 4)
    view_height = max(1, height // 4)
    cx = lx + width // 2
    cy = ly + height // 2
    bx0 = max(lx, cx - view_width // 2)
    by0 = max(ly, cy - view_height // 2)
    bx1 = min(hx, bx0 + view_width)
    by1 = min(hy, by0 + view_height)
    if bx1 <= bx0:
        bx1 = min(hx, bx0 + 1)
    if by1 <= by0:
        by1 = min(hy, by0 + 1)
    bbox = [bx0, by0, bx1, by1]

print(layer_id, *bbox)
PY
      )"
      read -r bench_layer bench_lx bench_ly bench_hx bench_hy <<< "$auto_bench_values"
    else
      bench_layer="$LAYER_ID"
      bench_lx="${BBOX[0]}"
      bench_ly="${BBOX[1]}"
      bench_hx="${BBOX[2]}"
      bench_hy="${BBOX[3]}"
    fi

    (
      cd "$CHIP_VIEWER_DIR"
      cargo run -p chipgeom-probe -- \
        --manifest "$manifest" \
        --json \
        --bench-viewport \
        --layer "$bench_layer" \
        --bbox "$bench_lx" "$bench_ly" "$bench_hx" "$bench_hy" \
        --iterations "$ITERATIONS"
    ) > "$bench_report"
  else
    bench_report=""
  fi

  python3 - \
    "$report" \
    "$bench_report" \
    "$step_name" \
    "$manifest" \
    "$OUT_DIR/summary.jsonl" \
    "$MAX_VIEWPORT_P95_NS" \
    "$MAX_MAPPED_PLUS_INDEX_BYTES" \
    "$MAX_VIEW_TILES" <<'PY'
import json
import sys

report_path = sys.argv[1]
bench_report_path = sys.argv[2]
step_name = sys.argv[3]
manifest_path = sys.argv[4]
summary_path = sys.argv[5]
max_viewport_p95_ns = int(sys.argv[6])
max_mapped_plus_index_bytes = int(sys.argv[7])
max_view_tiles = int(sys.argv[8])

with open(report_path, "r", encoding="utf-8") as handle:
    report = json.load(handle)

shape_count = int(report.get("shape_count", 0))
layer_count = int(report.get("layer_count", 0))
schema_version = report.get("schema_version")

if shape_count <= 0:
    raise SystemExit(f"{step_name}: shape_count must be positive")
if layer_count <= 0:
    raise SystemExit(f"{step_name}: layer_count must be positive")

bench = None
if bench_report_path:
    with open(bench_report_path, "r", encoding="utf-8") as handle:
        bench_report = json.load(handle)
    bench = bench_report.get("bench_viewport")
    if not bench:
        raise SystemExit(f"{step_name}: missing bench_viewport report")

memory = report.get("memory") or {}
snapshot_write = report.get("snapshot_write") or {}
mapped_plus_index = int(memory.get("mapped_plus_index_bytes", -1))
view_tiles = int(report.get("view_tile_count", -1))

failures = []
if max_mapped_plus_index_bytes > 0:
    if mapped_plus_index < 0:
        failures.append("missing memory.mapped_plus_index_bytes")
    elif mapped_plus_index > max_mapped_plus_index_bytes:
        failures.append(
            f"memory.mapped_plus_index_bytes={mapped_plus_index} exceeds {max_mapped_plus_index_bytes}"
        )

if max_view_tiles > 0:
    if view_tiles < 0:
        failures.append("missing view_tile_count")
    elif view_tiles > max_view_tiles:
        failures.append(f"view_tile_count={view_tiles} exceeds {max_view_tiles}")

if bench is not None and max_viewport_p95_ns > 0:
    viewport_p95 = int(bench.get("p95_ns", -1))
    if viewport_p95 < 0:
        failures.append("missing bench_viewport.p95_ns")
    elif viewport_p95 > max_viewport_p95_ns:
        failures.append(f"bench_viewport.p95_ns={viewport_p95} exceeds {max_viewport_p95_ns}")

summary = {
    "step": step_name,
    "manifest": manifest_path,
    "report": report_path,
    "schema_version": schema_version,
    "shape_count": shape_count,
    "owner_count": int(report.get("owner_count", 0)),
    "layer_count": layer_count,
    "view_tile_count": view_tiles,
    "memory_mapped_plus_index_bytes": mapped_plus_index,
    "snapshot_write": {
        "dirty_lod_tile_count": snapshot_write.get("dirty_lod_tile_count"),
        "dirty_lod_rebuild_candidate_count": snapshot_write.get("dirty_lod_rebuild_candidate_count"),
    },
}

if bench is not None:
    summary["bench_report"] = bench_report_path
    summary["bench_viewport"] = {
        "layer": bench.get("layer"),
        "bbox": bench.get("bbox"),
        "iterations": bench.get("iterations"),
        "hits": bench.get("hits"),
        "candidates": bench.get("candidates"),
        "p50_ns": bench.get("p50_ns"),
        "p95_ns": bench.get("p95_ns"),
    }

with open(summary_path, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(summary, sort_keys=True) + "\n")

bench_text = ""
if bench is not None:
    bench_text = (
        f" viewport_p95_ns={bench.get('p95_ns')} "
        f"viewport_hits={bench.get('hits')} viewport_candidates={bench.get('candidates')}"
    )
dirty_text = ""
if snapshot_write.get("dirty_lod_tile_count") is not None:
    dirty_text += f" dirty_lod_tiles={snapshot_write.get('dirty_lod_tile_count')}"
if snapshot_write.get("dirty_lod_rebuild_candidate_count") is not None:
    dirty_text += f" dirty_lod_candidates={snapshot_write.get('dirty_lod_rebuild_candidate_count')}"

print(
    f"{step_name}: schema={schema_version} shapes={shape_count} "
    f"layers={layer_count} view_tiles={view_tiles} "
    f"mapped_plus_index_bytes={mapped_plus_index}{dirty_text}{bench_text} report={report_path}"
)

if failures:
    for failure in failures:
        print(f"FAIL: {step_name}: {failure}", file=sys.stderr)
    sys.exit(1)
PY
done
