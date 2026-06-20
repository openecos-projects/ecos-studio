# ECOS Layout Viewer

This workspace is the start of the standalone native layout viewer pipeline.

Current scope:

- Convert existing ECC View JSON packages into a rebuildable `.layoutpkg` cache.
- Define the first layout package manifest and binary detail tile format.
- Read `.layoutpkg` viewport tiles through a small headless reader/probe path.
- Open `.layoutpkg` directly in a first native viewer MVP.
- Keep the new pipeline independent from the Electron renderer and ECC writer.

## Build And Test

```bash
cargo test --workspace
```

## Convert A View JSON Package

```bash
cargo run -p ecos-layout-packer -- \
  /path/to/view-json-package \
  /path/to/view-json-package/.layoutpkg
```

By default, the packer uses a `128 x 128` fixed detail grid and writes only
non-empty tiles. Override it for experiments:

```bash
cargo run -p ecos-layout-packer -- \
  --detail-grid-columns 64 \
  --detail-grid-rows 64 \
  --max-tiles-per-object 16 \
  --target-primitives-per-tile 6000 \
  --max-subdivision-depth 6 \
  /path/to/view-json-package \
  /path/to/view-json-package/.layoutpkg
```

## Probe A Viewport

```bash
cargo run -p layoutpkg-probe -- \
  /path/to/view-json-package/.layoutpkg \
  --viewport 280000 280000 292000 292000 \
  --cache-capacity 32
```

The probe opens the package, finds detail tiles intersecting the viewport,
decodes only those tile binaries, reads shared large objects, and prints cache
load stats. This is the headless check that the native viewer path can stay
viewport-local.

## Open The Native Viewer

```bash
cargo run -p layout-viewer-native -- \
  /path/to/view-json-package/.layoutpkg
```

The native viewer starts in overview mode, pans with drag, zooms with the wheel,
selects objects with a primary click, switches to detail tiles when
`units_per_pixel <= 200`, and provides a right-side visibility panel for object
kinds, layers, tracks, gcell grids, and selected-object properties. Override the
detail threshold or cache size for experiments:

```bash
cargo run -p layout-viewer-native -- \
  /path/to/view-json-package/.layoutpkg \
  --detail-units-per-pixel 200 \
  --cache-capacity 128
```

The HUD shows the active mode, units per pixel, loaded tile count, decoded
record count, shared large-object count, and cache hit/miss/eviction counters.
The viewer has three visual modes:

- `far-view`: dark chip skeleton view for very far zoom. It emphasizes die/core
  outlines, weak routing density, IO markers, and shared large objects.
- `overview-density`: outline/density LOD for medium zoom. Die/core are rendered
  as outlines, routing coverage is low alpha, and vias/pins are capped markers.
- `detail`: exact detail tile records for close zoom.

Tracks and gcell grids are drawn from parameterized overlay dictionaries instead
of expanded tile records, and dense overlays are skipped when their projected
spacing is too small to inspect.

Selection is viewport-local: the viewer queries detail tiles and shared large
objects through the `.layoutpkg` reader and does not open the source View JSON
files. The first properties view shows kind, layer, source id, bbox, tile id,
and whether the hit came from a regular tile or shared large-object storage.

The current converter writes:

```txt
.layoutpkg/
  manifest.json
  dictionaries/layers.json
  detail/index.json
  detail/tile_<x>_<y>.bin
  detail/large_objects.bin       # only when wide objects exceed the threshold
  overview/index.json
  overview/tile_<x>_<y>.bin
  overview/pyramid.json
  query/index.json
```

## Package Semantics

- `detail/index.json` is the viewport-driven tileset. A viewer should load only
  intersecting `detail/tile_<x>_<y>.bin` files at close zoom.
- Detail records are clipped to tile bounds so a tile does not carry geometry
  that belongs outside its viewport region.
- Overfull detail tiles are adaptively subdivided. The packer avoids subdivisions
  that would mostly duplicate the same geometry, so a few dense tiles may remain
  over target when splitting would make the package larger without reducing peak
  load.
- `detail/large_objects.bin` stores die/core outlines and objects that cross too
  many tiles. A viewer can load this small shared set once instead of duplicating
  it into every detail tile.
- `overview/index.json` is a coarse coverage tileset for low zoom. It uses
  bounded coverage bins, so it does not replay every wire segment while zoomed
  out.
- `overview/pyramid.json` is a multi-resolution density pyramid used by the V2
  renderer for far/mid zoom summary drawing.
- `query/index.json` is the hover/selection index. It reuses detail records and
  declares the queryable kinds, so selection can stay viewport-local without
  duplicating tile binaries or opening full source JSON.
- Tracks and gcell grids are stored as parametric overlay dictionaries, not as
  expanded per-line detail primitives.
- `manifest.json` exposes `capabilities`, `tilesets`, and `statistics` so a
  native viewer can decide which path to use without opening the source View
  JSON files.

The converter currently handles die/core, instances, regular wires, special
wires, wire vias, IO pin port rects and vias, blockages, fills, regions, rows,
tracks, and gcell grids. The native GUI viewer renders rectangle tile records,
shared large objects, layer/kind visibility controls, and parametric track/gcell
overlays. It also supports click selection for queryable objects. Rich source
property lookup and a dedicated GPU renderer are separate follow-up slices.

## Open The Native Viewer V2

```bash
cargo run -p layout-viewer-native-v2 -- \
  /path/to/view-json-package/.layoutpkg
```

V2 is a greenfield viewer path, not an incremental rewrite of
`layout-viewer-native`. It opens current `.layoutpkg` output through
`PackageLayoutSource` and `LayoutSession`, initializes metadata without loading
detail geometry, then loads only viewport-intersecting detail tiles as the view
pans and zooms. LOD is applied inside `RenderPlanner` with a KLayout-like split:
far/mid zoom can draw hierarchy boxes, array grids, or overview density bins,
while near zoom expands visible detail geometry. The first backend uses egui,
but far/mid plans are composed through cached raster planes instead of replaying
every primitive through the immediate painter.

The V2 vertical slice already establishes the architecture intended for the next
renderer:

- `layoutdb`: package-independent layout data model with per-layer spatial
  indexes, KLayout-like `CellViewState`, instance/object paths, compact
  hierarchy/array queries, lazy package sessions, viewport tile load stats, and
  overview density bins loaded from the package pyramid.
- `layout-display`: display layers, fill/frame color separation, patterns,
  brightness shifts, and composition modes.
- `layout-render`: viewport render planning, indexed query partitioning,
  source-aware and cell-view-aware cache keys, stable far/mid/near LOD
  decisions, hierarchy bbox and array grid planning, overview density planning,
  separate frame/marker occupancy budgeting, draw planes, and
  visible-layer-aware picking.
- `layout-viewer-native-v2`: a new app shell with readable render stats,
  source-aware plan reuse, cached far/mid raster planes, near vector detail, and
  vector selection overlays. The sidebar includes a minimal hierarchy panel for
  the active cell view and hierarchy depth policy.

## Native V2 KLayout-Like Core Validation

```bash
cargo fmt --all -- --check
cargo test --workspace -- --nocapture
cargo run --release -p layout-viewer-native-v2 -- /path/to/package.layoutpkg
```

Expected interactive behavior:

- Far zoom uses hierarchy/array bboxes or overview density.
- Mid zoom uses coarse cell/array/grid/density planes.
- Near zoom shows detailed layer geometry.
- Drag/zoom does not reuse a render plan from a mismatched source or viewport.
- Cell view and hierarchy policy changes do not reuse a stale render plan.
- `Plane Cache Frame` reports far/mid raster-plane cache activity.
