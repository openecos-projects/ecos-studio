# ECOS Layout Viewer

This workspace is the start of the standalone native layout viewer pipeline.

Current scope:

- Convert existing ECC View JSON packages into a rebuildable `.layoutpkg` cache.
- Define the first layout package manifest and binary detail tile format.
- Read `.layoutpkg` viewport tiles through a small headless reader/probe path.
- Open `.layoutpkg` directly in the native viewer.
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

For cache checks, the packer can print the current source metadata without
rewriting the package:

```bash
cargo run -p ecos-layout-packer -- --fingerprint --json /path/to/view-json-package
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
activity. This is the headless check that the native viewer path can stay
viewport-local without opening the original View JSON files.

The current converter writes:

```txt
.layoutpkg/
  manifest.json
  dictionaries/layers.json
  detail/index.json
  detail/shard_0.bin
  detail/large_objects.bin       # only when wide objects exceed the threshold
  overview/index.json
  overview/tile_<x>_<y>.bin
  overview/pyramid.bin
  query/index.json
```

## Package Semantics

- `detail/index.json` is the viewport-driven tileset. Each tile entry points to
  a shard plus `byte_offset` and `byte_size`, so a viewer should read only the
  intersecting byte ranges at close zoom.
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
- `overview/pyramid.bin` is a compact multi-resolution density pyramid used by
  the renderer for far/mid zoom summary drawing.
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

## Open The Native Viewer

```bash
cargo run -p layout-viewer-native -- \
  /path/to/view-json-package/.layoutpkg
```

The native viewer opens current `.layoutpkg` output through `PackageLayoutSource`
and `LayoutSession`, initializes metadata without loading detail geometry, then
loads only viewport-intersecting detail tiles as the view pans and zooms. LOD is
applied inside `RenderPlanner` with a KLayout-like split: far/mid zoom can draw
hierarchy boxes, array grids, or overview density bins, while near zoom expands
visible detail geometry. Far/mid plans are composed through cached raster planes
instead of replaying every primitive through the immediate painter.

The current native viewer architecture is:

- `layoutdb`: package-independent layout data model with per-layer spatial
  indexes, KLayout-like `CellViewState`, instance/object paths, compact
  hierarchy/array queries, lazy package sessions, viewport tile loading, and
  overview density bins loaded from the package pyramid.
- `layout-display`: display layers, fill/frame color separation, patterns,
  brightness shifts, and composition modes.
- `layout-render`: viewport render planning, indexed query partitioning,
  source-aware and cell-view-aware cache keys, stable far/mid/near LOD
  decisions, hierarchy bbox and array grid planning, overview density planning,
  separate frame/marker occupancy budgeting, draw planes, and
  visible-layer-aware picking.
- `layout-viewer-native`: app shell with asynchronous package opening,
  source-aware plan reuse, cached far/mid raster planes, near vector detail, and
  vector selection overlays. The sidebar includes a minimal hierarchy panel for
  the active cell view and hierarchy depth policy.

## Native KLayout-Like Core Validation

```bash
cargo fmt --all -- --check
cargo test --workspace -- --nocapture
cargo run --release -p layout-viewer-native -- /path/to/package.layoutpkg
```

Expected interactive behavior:

- Far zoom uses hierarchy/array bboxes or overview density.
- Mid zoom uses coarse cell/array/grid/density planes.
- Near zoom shows detailed layer geometry.
- Drag/zoom does not reuse a render plan from a mismatched source or viewport.
- Cell view and hierarchy policy changes do not reuse a stale render plan.
- Far/mid raster-plane cache reuse keeps pan and zoom interaction responsive.
