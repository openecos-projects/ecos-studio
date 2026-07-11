#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SNAPSHOT_WRAPPER="$ROOT/ecos/scripts/ecc-geometry-snapshot-wrapper.sh"
CHIP_VIEWER_DIR="$ROOT/ecos/chip-viewer"

OUT_DIR="${CHIPGEOM_PERF_OUT:-/tmp/ecc_geometry_snapshot_perf_smoke}"
SYNTHETIC_SHAPES="${CHIPGEOM_PERF_SYNTHETIC_SHAPES:-50000}"
ITERATIONS="${CHIPGEOM_PERF_ITERATIONS:-50}"
LAYER_ID="${CHIPGEOM_PERF_LAYER:-0}"
BBOX=(0 0 5000 5000)
NAME="${CHIPGEOM_PERF_NAME:-synthetic_clk}"
MAX_P95_NS="${CHIPGEOM_PERF_MAX_P95_NS:-5000000}"
MAX_NAME_P95_NS="${CHIPGEOM_PERF_MAX_NAME_P95_NS:-1000000}"
MAX_MAPPED_PLUS_INDEX_BYTES="${CHIPGEOM_PERF_MAX_MAPPED_PLUS_INDEX_BYTES:-200000000}"
MAX_VIEW_TILES="${CHIPGEOM_PERF_MAX_VIEW_TILES:-200000}"
DRY_RUN=false
GEOMETRY_ARGS=()

usage() {
  cat <<'EOF'
Usage: chipgeom-performance-smoke.sh [options]

Generate a synthetic geometry snapshot, run chipgeom-probe viewport/name
benchmarks, and fail if performance or memory thresholds are exceeded.

Options:
  --out <dir>                         Snapshot and report output directory.
  --synthetic-shapes <count>          Synthetic shape count.
  --iterations <count>                Benchmark iterations.
  --layer <id>                        Layer id for viewport benchmark.
  --bbox <lx> <ly> <hx> <hy>          Viewport bbox.
  --name <owner-name>                 Name query benchmark target.
  --max-p95-ns <ns>                   Max viewport query p95.
  --max-name-p95-ns <ns>              Max name query p95.
  --max-mapped-plus-index-bytes <n>   Max mmap plus Rust index bytes.
  --max-view-tiles <count>            Max view tile records.
  --geometry-base-tile-size <dbu>     Forwarded snapshot LOD base tile size.
  --geometry-lod-levels <count>       Forwarded snapshot LOD level count.
  --geometry-max-tile-refs-per-shape <count>
                                      Forwarded snapshot large-shape threshold.
  --geometry-spatial-tile-size <dbu>  Forwarded exact spatial index tile size.
  --geometry-spatial-max-tiles-per-shape <count>
                                      Forwarded exact spatial large-shape threshold.
  --dry-run                           Print commands without executing.
  -h, --help                          Show this help.
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
    --out)
      OUT_DIR="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --synthetic-shapes)
      SYNTHETIC_SHAPES="$(require_value "$1" "${2:-}")"
      shift 2
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
    --name)
      NAME="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --max-p95-ns)
      MAX_P95_NS="$(require_value "$1" "${2:-}")"
      shift 2
      ;;
    --max-name-p95-ns)
      MAX_NAME_P95_NS="$(require_value "$1" "${2:-}")"
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
    --geometry-base-tile-size | --geometry-lod-levels | --geometry-max-tile-refs-per-shape | --geometry-spatial-tile-size | --geometry-spatial-max-tiles-per-shape)
      value="$(require_value "$1" "${2:-}")"
      GEOMETRY_ARGS+=("$1" "$value")
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

MANIFEST_PATH="$OUT_DIR/geometry.manifest"
REPORT_JSON="$OUT_DIR/chipgeom-probe-report.json"

if [ "$DRY_RUN" = true ]; then
  echo "$SNAPSHOT_WRAPPER --mode synthetic --out $OUT_DIR --synthetic-shapes $SYNTHETIC_SHAPES ${GEOMETRY_ARGS[*]}"
  echo "cd $CHIP_VIEWER_DIR && cargo run -p chipgeom-probe -- --manifest $MANIFEST_PATH --json --bench-viewport --layer $LAYER_ID --bbox ${BBOX[*]} --iterations $ITERATIONS --name $NAME > $REPORT_JSON"
  echo "python3 threshold-check $REPORT_JSON $MAX_P95_NS $MAX_NAME_P95_NS $MAX_MAPPED_PLUS_INDEX_BYTES $MAX_VIEW_TILES"
  exit 0
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

"$SNAPSHOT_WRAPPER" \
  --mode synthetic \
  --out "$OUT_DIR" \
  --synthetic-shapes "$SYNTHETIC_SHAPES" \
  "${GEOMETRY_ARGS[@]}"

(
  cd "$CHIP_VIEWER_DIR"
  cargo run -p chipgeom-probe -- \
    --manifest "$MANIFEST_PATH" \
    --json \
    --bench-viewport \
    --layer "$LAYER_ID" \
    --bbox "${BBOX[@]}" \
    --iterations "$ITERATIONS" \
    --name "$NAME"
) > "$REPORT_JSON"

python3 - "$REPORT_JSON" "$MAX_P95_NS" "$MAX_NAME_P95_NS" "$MAX_MAPPED_PLUS_INDEX_BYTES" "$MAX_VIEW_TILES" <<'PY'
import json
import sys

report_path = sys.argv[1]
max_p95_ns = int(sys.argv[2])
max_name_p95_ns = int(sys.argv[3])
max_mapped_plus_index_bytes = int(sys.argv[4])
max_view_tiles = int(sys.argv[5])

with open(report_path, "r", encoding="utf-8") as handle:
    report = json.load(handle)

failures = []
bench = report.get("bench_viewport") or {}
bench_name = report.get("bench_name") or {}
memory = report.get("memory") or {}

viewport_p95 = int(bench.get("p95_ns", -1))
name_p95 = int(bench_name.get("p95_ns", -1))
mapped_plus_index = int(memory.get("mapped_plus_index_bytes", -1))
view_tiles = int(report.get("view_tile_count", -1))

if viewport_p95 < 0:
    failures.append("missing bench_viewport.p95_ns")
elif viewport_p95 > max_p95_ns:
    failures.append(f"bench_viewport.p95_ns={viewport_p95} exceeds {max_p95_ns}")

if name_p95 < 0:
    failures.append("missing bench_name.p95_ns")
elif name_p95 > max_name_p95_ns:
    failures.append(f"bench_name.p95_ns={name_p95} exceeds {max_name_p95_ns}")

if mapped_plus_index < 0:
    failures.append("missing memory.mapped_plus_index_bytes")
elif mapped_plus_index > max_mapped_plus_index_bytes:
    failures.append(
        f"memory.mapped_plus_index_bytes={mapped_plus_index} exceeds {max_mapped_plus_index_bytes}"
    )

if view_tiles < 0:
    failures.append("missing view_tile_count")
elif view_tiles > max_view_tiles:
    failures.append(f"view_tile_count={view_tiles} exceeds {max_view_tiles}")

print(f"report={report_path}")
print(f"bench_viewport.p95_ns={viewport_p95}")
print(f"bench_name.p95_ns={name_p95}")
print(f"memory.mapped_plus_index_bytes={mapped_plus_index}")
print(f"view_tile_count={view_tiles}")

if failures:
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    sys.exit(1)
PY
