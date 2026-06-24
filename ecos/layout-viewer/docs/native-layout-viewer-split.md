# Native Layout Viewer Split

## Boundary

ECOS Studio Electron remains the workflow shell. It owns project navigation, flow execution, logs, reports, and launching tools. It should not own high-volume layout rendering.

The native layout viewer owns layout package loading, tile scheduling, GPU rendering, layer visibility, hover/selection query, and viewer-local cache management.

## Source Locations

```txt
ecos/layout-viewer/
  crates/layoutpkg-format/
  crates/layoutdb/
  crates/layout-display/
  crates/layout-render/
  crates/viewjson-importer/
  crates/layoutpkg-packer/
  crates/layoutpkg-reader/
  apps/layout-packer-cli/
  apps/layoutpkg-probe-cli/
  apps/layout-viewer-native/
```

This keeps the new pipeline separate from both Electron renderer code and ECC writer code.

## Generated Data

The converter writes a rebuildable package cache next to the current ECC View JSON package:

```txt
<view-json-package-root>/
  manifest.json
  design/
  .layoutpkg/
    manifest.json
    dictionaries/
    detail/
    overview/
    query/
```

The `.layoutpkg` directory is a cache. The current View JSON output remains the source input until ECC grows a direct layout package writer.

## Current Slice

The first implemented slice writes:

```txt
.layoutpkg/
  manifest.json
  dictionaries/layers.json
  detail/index.json
  detail/shard_0.bin
  detail/large_objects.bin
  overview/index.json
  overview/tile_<x>_<y>.bin
  overview/pyramid.bin
  query/index.json
```

Each `detail/index.json` tile entry points at a binary rectangle tile stored in
`detail/shard_0.bin` with `file`, `byte_offset`, and `byte_size`. The tile bytes
use this fixed record layout:

```txt
magic:      8 bytes  "ELDTILE1"
version:    u16
flags:      u16
rect_count: u32
reserved:   u32

rect records:
  x1:        i32
  y1:        i32
  x2:        i32
  y2:        i32
  layer_id:  u16
  kind:      u8
  flags:     u8
  source_id: u32
```

The packer now performs fixed-grid detail tile cutting with adaptive subdivision,
clips records to tile bounds, writes only non-empty tiles, and moves die/core
plus objects that cross too many tiles into `large_objects.bin`. It avoids
subdivision when splitting mostly duplicates geometry. It also writes an overview
coverage tileset for low zoom, so the native viewer can avoid replaying full
detail while zoomed out, plus a multi-level overview density pyramid for the
render planner. It writes a query index for hover/selection so the viewer does
not need to open full source JSON for picking; the query index reuses detail
records instead of duplicating tile binaries. Tracks and gcell grids remain
parametric dictionary overlays instead of expanded per-line primitives.

`layoutpkg-reader` opens a package, resolves only detail tiles intersecting the
current viewport, decodes binary tile records into memory, keeps an LRU cache
bounded by tile count, exposes typed layer/grid-overlay dictionaries, and can
query a point by reusing detail records plus shared large objects. `layoutpkg-probe`
exposes this same path as a headless verification tool.

## Native Viewer Slice

`layout-viewer-native` is the active native rendering slice. It owns the
package session, viewport-local loading, render planning, cached far/mid raster
planes, near vector detail, layer visibility, and selection overlay.

The native viewer currently opens existing `.layoutpkg` packages through a lazy package session:

```txt
.layoutpkg
  -> layoutdb::PackageLayoutSource
  -> layoutdb::LayoutSession
      -> metadata and layer dictionary on open
      -> viewport detail tile import on demand
  -> layout-display::DisplayModel
  -> layout-render::RenderPlanner
  -> layout-viewer-native egui backend
```

The native data/display/render split is:

- `layoutdb`: package-independent layout data, cell/instance hierarchy records,
  KLayout-like `CellViewState`, path-aware recursive shape/instance queries,
  per-layer spatial indexes, compact hierarchy/array queries, lazy viewport tile
  loading, tile load stats, and overview density bins selected from the package
  pyramid.
- `layout-display`: display layers with source selectors, separate fill/frame
  colors, patterns, line styles, brightness shifts, and composition modes.
- `layout-render`: render plans with fill/frame/marker/hierarchy planes,
  source-aware and cell-view-aware cache keys, stable far/mid/near LOD
  classification, hierarchy bbox and array grid planning, overview density
  summary planning, pixel-threshold shape simplification, long-thin shape
  preservation, per-screen-bin occupancy limits, and picking constrained by
  visible display layers.
- `layout-viewer-native`: app shell for validating pan, zoom, layer
  visibility, picking, cached far/mid raster-plane drawing, near vector detail,
  lazy tile loading, a minimal hierarchy panel, and readable HUD/sidebar stats.

The native backend still uses egui, but far/mid plans are rasterized into cached CPU
planes before texture composition, while near plans and selection overlays remain
vector primitives. This keeps the architecture open for a future GPU batch
backend without coupling package data to the UI toolkit.

## KLayout-Like Native Core

The native viewer now follows a KLayout-like split:

- `.layoutpkg` stores hierarchy metadata, per-cell layer summaries, compact array
  metadata, and overview density levels.
- `layoutdb` exposes `CellViewState`, instance/object paths, hierarchy policy,
  viewport/depth-aware hierarchy and shape queries, plus overview bins selected
  by units-per-pixel.
- `layout-render` chooses a stable source for each frame: hierarchy far,
  hierarchy mid, overview density, hierarchy near, or flat detail. The
  view-aware planner includes the active cell view and hierarchy policy in cache
  keys so a focused cell or depth change cannot reuse the wrong render plan.
- `layout-viewer-native` composes far/mid/overview plans from cached raster
  planes, preserves near detail as vector drawing, keeps selection overlays
  vector-on-top, and exposes Top/Up hierarchy controls for the active cell view.

Validation:

```bash
cargo fmt --all -- --check
cargo test --workspace -- --nocapture
cargo run --release -p layout-viewer-native -- /path/to/package.layoutpkg
```

## Next Steps

- Add binary dictionaries for nets, instances, cell masters, and via masters.
- Add richer object property lookup through source dictionaries or dedicated
  property tiles.
- Add a full cell tree, click-to-enter selected instance, path-aware selection,
  and KLayout-like context/negative hierarchy levels.
- Map lazy detail records back into their source child cells when the package
  can preserve full source hierarchy for all detail geometry.
- Replace the cached CPU plane compositor with a dedicated GPU draw path once
  the data path is settled.
