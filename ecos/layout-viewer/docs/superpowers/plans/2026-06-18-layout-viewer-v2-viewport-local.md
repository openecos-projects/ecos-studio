# Layout Viewer V2 Viewport-Local Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Layout Viewer V2 from full-package in-memory import and linear scans to viewport-local data access, indexed queries, render-plan cache keys, and a first coverage/far-LOD path.

**Architecture:** Keep the V2 greenfield boundary. `layoutdb` gets per-cell/per-layer spatial indexes and a package-backed `LayoutSource` abstraction. `layout-render` plans against a viewport query interface, not a raw `Vec`, and adds cache keys plus density batches. `layout-viewer-native-v2` uses a lazy source session so panning and zooming only decode intersecting package tiles.

**Tech Stack:** Rust 2021, Cargo workspace, `layoutpkg-reader` for package tile access, `layoutdb`/`layout-display`/`layout-render`, `eframe/egui`, TDD with `cargo test --workspace`.

---

## Files

- Modify `crates/layoutdb/src/lib.rs`
- Modify `crates/layoutdb/Cargo.toml`
- Modify `crates/layout-render/src/lib.rs`
- Modify `apps/layout-viewer-native-v2/src/main.rs`
- Modify `docs/superpowers/specs/2026-06-18-layout-viewer-v2-design.md`
- Modify `README.md`
- Modify `docs/native-layout-viewer-split.md`

## Current Limitations This Plan Removes

- `LayoutDb::from_layout_package` calls `load_detail_viewport(world_bbox, ...)`, so package import is full-world.
- `LayoutDb::query_shapes` scans every shape in the top cell and filters by bbox.
- `RenderPlanner::plan` queries once per display layer and therefore repeats linear scans.
- There is no render plan cache key, no tile load stats surfaced in V2, and no density/far LOD batch.

### Task 1: Per-Layer Spatial Index In `layoutdb`

**Files:**
- Modify: `crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing spatial-index tests**

Add tests:

```rust
#[test]
fn indexed_query_checks_only_candidate_bins() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
    db.add_layer(LayerInfo::new(1, "M1"));
    let top = db.top_cell();
    for i in 0..100 {
        let x = i * 10;
        db.add_shape(top, ShapeRecord::new(Rect::new(x, x, x + 4, x + 4), 1, ShapeKind::RegularWire, i as u32));
    }

    let result = db.query_shapes_indexed(top, Some(1), Rect::new(0, 0, 20, 20));

    assert_eq!(result.shapes.len(), 2);
    assert!(result.candidates_checked < 20);
    assert!(result.total_shapes_in_cell >= 100);
}

#[test]
fn indexed_query_can_filter_by_shape_kind() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
    let top = db.top_cell();
    db.add_shape(top, ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::RegularWire, 1));
    db.add_shape(top, ShapeRecord::new(Rect::new(12, 12, 18, 18), 1, ShapeKind::Via, 2));

    let result = db.query_shapes_indexed_with_filter(
        top,
        ShapeQuery::new(Rect::new(0, 0, 30, 30)).with_kind(ShapeKind::Via),
    );

    assert_eq!(result.shapes.len(), 1);
    assert_eq!(result.shapes[0].source_id, 2);
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test -p layoutdb indexed_query`

Expected: compile failure for missing `query_shapes_indexed`, `ShapeQuery`, and query stats.

- [ ] **Step 3: Implement a simple grid spatial index**

Implement:

- `ShapeQuery`
- `ShapeQueryResult`
- `SpatialIndex`
- per-cell index storage
- `LayoutDb::query_shapes_indexed`
- `LayoutDb::query_shapes_indexed_with_filter`

Use a fixed bin size derived from world bbox, for example 128 bins per axis capped to sane minimums. Store shape indexes per bin. Deduplicate candidates when a shape spans multiple bins.

- [ ] **Step 4: Verify spatial-index tests pass**

Run: `cargo test -p layoutdb indexed_query`

Expected: both indexed query tests pass.

### Task 2: Package-Backed Lazy Viewport Source

**Files:**
- Modify: `crates/layoutdb/src/lib.rs`
- Modify: `crates/layoutdb/Cargo.toml`

- [ ] **Step 1: Write failing lazy-source tests**

Add tests using the existing fixture helper:

```rust
#[test]
fn package_source_loads_only_intersecting_tiles_for_viewport() {
    let (_input, package_root) = create_layoutpkg_fixture();
    let source = PackageLayoutSource::open(package_root, 64).unwrap();
    let mut session = LayoutSession::from_source(source).unwrap();

    let first = session.ensure_viewport_loaded(Rect::new(0, 0, 500, 500)).unwrap();

    assert_eq!(first.tile_count, 1);
    assert!(first.loaded_shapes > 0);
    assert!(session.db().query_shapes(session.db().top_cell(), Rect::new(700, 700, 800, 800)).is_empty());
}

#[test]
fn package_source_reuses_loaded_viewport_tiles() {
    let (_input, package_root) = create_layoutpkg_fixture();
    let source = PackageLayoutSource::open(package_root, 64).unwrap();
    let mut session = LayoutSession::from_source(source).unwrap();

    session.ensure_viewport_loaded(Rect::new(0, 0, 500, 500)).unwrap();
    let second = session.ensure_viewport_loaded(Rect::new(0, 0, 500, 500)).unwrap();

    assert_eq!(second.new_shapes, 0);
    assert_eq!(second.cache_hits, 1);
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test -p layoutdb package_source`

Expected: compile failure for missing `PackageLayoutSource`, `LayoutSession`, and viewport load stats.

- [ ] **Step 3: Implement lazy source and session**

Implement:

- `PackageLayoutSource`
- `LayoutSession`
- `ViewportLoadStats`
- loaded tile id tracking

`LayoutSession::from_source` should initialize metadata and layers without loading detail geometry. `ensure_viewport_loaded` should call `LayoutPackage::load_detail_viewport(viewport, cache_capacity)`, import only newly seen tile ids plus large objects once, and update spatial indexes.

- [ ] **Step 4: Verify lazy-source tests pass**

Run: `cargo test -p layoutdb package_source`

Expected: lazy-source tests pass.

### Task 3: Render Planner Uses Indexed Queries Once Per Viewport

**Files:**
- Modify: `crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing planner query-efficiency tests**

Add tests:

```rust
#[test]
fn planner_uses_indexed_viewport_query_once_then_partitions_by_layer() {
    let db = many_layer_db();
    let mut model = DisplayModel::new();
    model.add_layer(DisplayLayer::physical_layer(1, "M1", LayerStyle::default_for_index(0)));
    model.add_layer(DisplayLayer::physical_layer(2, "M2", LayerStyle::default_for_index(1)));

    let plan = RenderPlanner::new(RenderSettings::default()).plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 100, 100), 400.0, 400.0),
    );

    assert_eq!(plan.query_stats.viewport_queries, 1);
    assert!(plan.query_stats.candidates_checked < plan.query_stats.total_shapes_in_cell);
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test -p layout-render query_efficiency`

Expected: compile failure for missing `RenderPlan::query_stats`.

- [ ] **Step 3: Update planner to query once and partition**

Add `RenderQueryStats` to `RenderPlan`. Replace per-layer `matching_shapes` calls with one indexed viewport query, then partition candidates by visible source selectors.

- [ ] **Step 4: Verify planner tests pass**

Run: `cargo test -p layout-render`

Expected: all render tests pass.

### Task 4: Render Plan Cache Key

**Files:**
- Modify: `crates/layout-render/src/lib.rs`
- Modify: `crates/layout-display/src/lib.rs`

- [ ] **Step 1: Write failing cache-key tests**

Add tests:

```rust
#[test]
fn cache_key_changes_when_viewport_or_visible_layers_change() {
    let db = one_shape_db(Rect::new(10, 10, 110, 110));
    let mut model = one_layer_display_model();
    let planner = RenderPlanner::new(RenderSettings::default());

    let first = planner.plan(&db, &model, Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0));
    let second = planner.plan(&db, &model, Viewport::new(Rect::new(0, 0, 400, 400), 400.0, 400.0));
    model.layers_mut()[0].visible = false;
    let hidden = planner.plan(&db, &model, Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0));

    assert_ne!(first.cache_key, second.cache_key);
    assert_ne!(first.cache_key, hidden.cache_key);
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test -p layout-render cache_key`

Expected: compile failure for missing `cache_key`.

- [ ] **Step 3: Implement stable cache key**

Add a stable `RenderCacheKey` composed from viewport world rect, screen size bucket, visible display layer ids, draw order, style generation/hash, and render settings.

- [ ] **Step 4: Verify cache-key tests pass**

Run: `cargo test -p layout-render cache_key`

Expected: cache-key tests pass.

### Task 5: Coverage/Far LOD Batch From Existing Overview Tiles

**Files:**
- Modify: `crates/layoutdb/src/lib.rs`
- Modify: `crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing coverage tests**

Add tests:

```rust
#[test]
fn package_source_loads_overview_coverage_without_detail_tiles() {
    let (_input, package_root) = create_layoutpkg_fixture();
    let source = PackageLayoutSource::open(package_root, 64).unwrap();
    let mut session = LayoutSession::from_source(source).unwrap();

    let coverage = session.load_overview_coverage().unwrap();

    assert!(!coverage.is_empty());
    assert_eq!(session.loaded_detail_tile_count(), 0);
}

#[test]
fn planner_emits_density_plane_when_units_per_pixel_is_large() {
    let db = coverage_db();
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings { density_units_per_pixel: 200.0, ..Default::default() }).plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 10000, 10000), 100.0, 100.0),
    );

    assert!(plan.batches.iter().any(|batch| batch.plane == RenderPlane::Density));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p layoutdb coverage`

Run: `cargo test -p layout-render density`

Expected: compile failure for missing overview coverage and density plane.

- [ ] **Step 3: Implement coverage path**

Add `CoverageRecord` storage to `LayoutDb` and import existing overview records as coverage. Add `RenderPlane::Density`, `RenderSettings::density_units_per_pixel`, and emit density batches when the viewport units-per-pixel exceeds the threshold.

- [ ] **Step 4: Verify coverage tests pass**

Run: `cargo test -p layoutdb coverage`

Run: `cargo test -p layout-render density`

Expected: coverage and density tests pass.

### Task 6: V2 App Uses Lazy Session

**Files:**
- Modify: `apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write compile-failing app expectation**

Update app code references in a branch to use `LayoutSession` and run:

Run: `cargo check -p layout-viewer-native-v2`

Expected before implementation: compile failure where app still assumes owned `LayoutDb`.

- [ ] **Step 2: Update app state**

Change `LayoutViewerV2App` to hold `LayoutSession` instead of `LayoutDb`. On each frame:

1. Compute current viewport.
2. Call `session.ensure_viewport_loaded(viewport.world)`.
3. Pass `session.db()` to the planner.
4. Show tile load stats in HUD.

Keep picking visible-layer-aware through `RenderPlanner::pick`.

- [ ] **Step 3: Verify app compiles**

Run: `cargo check -p layout-viewer-native-v2`

Expected: check succeeds.

### Task 7: Docs And Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-18-layout-viewer-v2-design.md`
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] **Step 1: Update docs**

Document that V2 no longer full-imports packages on open. Clarify:

- `LayoutSession` loads detail tiles by viewport.
- `LayoutDb` indexes loaded geometry per layer.
- Far zoom can use overview coverage records.
- HUD reports loaded tile count and indexed query stats.

- [ ] **Step 2: Run full verification**

Run: `cargo test --workspace`

Expected: all tests pass.

Run: `cargo check -p layout-viewer-native-v2`

Expected: check succeeds.

Run:

```bash
cargo run -p layoutpkg-probe -- \
  /home/ekko/Desktop/ECOS/templates/t8/route_ecc/output/gcd_route_view/.layoutpkg \
  --viewport 0 0 100000 100000
```

Expected: probe succeeds and prints a finite tile count. If the fixture path is unavailable, use any existing `.layoutpkg` path found under `/home/ekko/Desktop/ECOS`.
