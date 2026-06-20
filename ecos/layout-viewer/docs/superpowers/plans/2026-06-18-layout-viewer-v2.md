# Layout Viewer V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a greenfield Layout Viewer V2 vertical slice with a new data/display/render architecture, a compatibility adapter for current `.layoutpkg` packages, and a new native app that does not call the old viewer render modules.

**Architecture:** Add three clean crates: `layoutdb` for hierarchical/pseudo-hierarchical layout data, `layout-display` for layer view styles and color composition, and `layout-render` for viewport-local planning, pixel-threshold LOD, separated planes, and picking. Add `layout-viewer-native-v2` as a new app that opens existing packages through an adapter and renders V2 plans with egui.

**Tech Stack:** Rust 2021, Cargo workspace, `layoutpkg-reader` as package input adapter only, `eframe/egui` as the first V2 backend, TDD with `cargo test --workspace`.

---

## Files

- Create `crates/layoutdb/Cargo.toml`
- Create `crates/layoutdb/src/lib.rs`
- Create `crates/layout-display/Cargo.toml`
- Create `crates/layout-display/src/lib.rs`
- Create `crates/layout-render/Cargo.toml`
- Create `crates/layout-render/src/lib.rs`
- Create `apps/layout-viewer-native-v2/Cargo.toml`
- Create `apps/layout-viewer-native-v2/src/main.rs`
- Modify `Cargo.toml`
- Modify `README.md`
- Modify `docs/native-layout-viewer-split.md`

### Task 1: LayoutDb Greenfield Data Model

**Files:**
- Create: `crates/layoutdb/Cargo.toml`
- Create: `crates/layoutdb/src/lib.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Add the crate to the workspace and write failing tests**

Add `crates/layoutdb` to the root workspace members.

Create tests in `crates/layoutdb/src/lib.rs` for:

```rust
#[test]
fn viewport_query_returns_only_intersecting_shapes() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
    db.add_layer(LayerInfo::new(1, "M1"));
    let top = db.top_cell();
    db.add_shape(top, ShapeRecord::new(Rect::new(10, 10, 30, 30), 1, ShapeKind::RegularWire, 7));
    db.add_shape(top, ShapeRecord::new(Rect::new(800, 800, 900, 900), 1, ShapeKind::RegularWire, 8));

    let visible = db.query_shapes(top, Rect::new(0, 0, 100, 100));

    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].source_id, 7);
}

#[test]
fn layoutpkg_adapter_imports_current_package_as_v2_layoutdb() {
    let (_input, package_root) = create_layoutpkg_fixture();
    let mut package = layoutpkg_reader::LayoutPackage::open(package_root).unwrap();

    let db = LayoutDb::from_layout_package(&mut package, 64).unwrap();

    assert_eq!(db.design_name(), "reader-unit");
    assert_eq!(db.layers().len(), 1);
    assert!(db.query_shapes(db.top_cell(), db.world_bbox()).len() >= 3);
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p layoutdb`

Expected: compile failure because the `layoutdb` crate and types do not exist yet.

- [ ] **Step 3: Implement minimal LayoutDb**

Implement `Rect`, `LayerInfo`, `ShapeKind`, `ShapeRecord`, `CellId`, `Cell`, and `LayoutDb`. Store all current package data in the top cell for the first milestone.

Implement `LayoutDb::from_layout_package(package, cache_capacity)` by calling `load_detail_viewport(world_bbox, cache_capacity)` and importing detail tile records plus shared large objects. This is a compatibility adapter, not a dependency on old viewer rendering modules.

- [ ] **Step 4: Run tests to verify green**

Run: `cargo test -p layoutdb`

Expected: all `layoutdb` tests pass.

### Task 2: Display Layer, Color, Pattern, And Composition Model

**Files:**
- Create: `crates/layout-display/Cargo.toml`
- Create: `crates/layout-display/src/lib.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Write failing tests**

Create tests for:

```rust
#[test]
fn style_keeps_fill_and_frame_colors_separate() {
    let style = LayerStyle::new(Color::rgb(20, 40, 60), Color::rgb(220, 230, 240));

    assert_eq!(style.fill_color, Color::rgb(20, 40, 60));
    assert_eq!(style.frame_color, Color::rgb(220, 230, 240));
    assert_eq!(style.text_color, Color::rgb(220, 230, 240));
}

#[test]
fn brightness_shift_preserves_channel_order() {
    let color = Color::rgb(40, 100, 180);
    let brighter = color.shift_brightness(0.5);
    let darker = color.shift_brightness(-0.5);

    assert!(brighter.r > color.r && brighter.g > color.g && brighter.b > color.b);
    assert!(darker.r < color.r && darker.g < color.g && darker.b < color.b);
    assert!(brighter.b >= brighter.g && brighter.g >= brighter.r);
    assert!(darker.b >= darker.g && darker.g >= darker.r);
}

#[test]
fn resolved_display_model_skips_hidden_layers() {
    let mut model = DisplayModel::new();
    model.add_layer(DisplayLayer::physical_layer(1, "M1", LayerStyle::default_for_index(0)));
    model.add_layer(DisplayLayer::physical_layer(2, "M2", LayerStyle::default_for_index(1)).hidden());

    let resolved = model.resolved_layers();

    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].source, SourceSelector::PhysicalLayer(1));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p layout-display`

Expected: compile failure because the crate and types do not exist.

- [ ] **Step 3: Implement display model**

Implement `Color`, `Pattern`, `LineStyle`, `CompositionMode`, `LayerStyle`, `SourceSelector`, `DisplayLayer`, `ResolvedDisplayLayer`, and `DisplayModel`.

Use ECOS-owned palette defaults. Do not copy KLayout palette or stipple definitions.

- [ ] **Step 4: Run tests to verify green**

Run: `cargo test -p layout-display`

Expected: all `layout-display` tests pass.

### Task 3: Render Planner With Planes And Pixel LOD

**Files:**
- Create: `crates/layout-render/Cargo.toml`
- Create: `crates/layout-render/src/lib.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Write failing tests**

Create tests for:

```rust
#[test]
fn planner_outputs_separate_fill_and_frame_batches_for_visible_shape() {
    let db = one_shape_db(Rect::new(10, 10, 110, 110));
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings::default()).plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0),
    );

    assert!(plan.batches.iter().any(|batch| batch.plane == RenderPlane::Fill));
    assert!(plan.batches.iter().any(|batch| batch.plane == RenderPlane::Frame));
}

#[test]
fn planner_simplifies_tiny_shapes_to_marker_plane() {
    let db = one_shape_db(Rect::new(10, 10, 11, 11));
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings { small_shape_px: 4.0, ..Default::default() }).plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 1000, 1000), 200.0, 200.0),
    );

    assert!(plan.batches.iter().any(|batch| batch.plane == RenderPlane::Marker));
    assert!(!plan.batches.iter().any(|batch| batch.plane == RenderPlane::Fill));
}

#[test]
fn picking_respects_display_layer_visibility() {
    let db = one_shape_db(Rect::new(10, 10, 110, 110));
    let mut model = one_layer_display_model();
    model.layers_mut()[0].visible = false;

    let hit = RenderPlanner::new(RenderSettings::default()).pick(
        &db,
        &model,
        PickRequest::new(50, 50, 2),
    );

    assert!(hit.is_none());
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p layout-render`

Expected: compile failure because the render crate and types do not exist.

- [ ] **Step 3: Implement render planner**

Implement:

- `Viewport`
- `RenderSettings`
- `RenderPlane`
- `DrawRect`
- `DrawMarker`
- `DrawBatch`
- `RenderPlan`
- `RenderPlanner::plan`
- `RenderPlanner::pick`

The planner must consume `LayoutDb` and `DisplayModel`, not package records or old viewer modules.

- [ ] **Step 4: Run tests to verify green**

Run: `cargo test -p layout-render`

Expected: all `layout-render` tests pass.

### Task 4: Native V2 App Shell

**Files:**
- Create: `apps/layout-viewer-native-v2/Cargo.toml`
- Create: `apps/layout-viewer-native-v2/src/main.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Write failing CLI/app compile target**

Add `apps/layout-viewer-native-v2` to the workspace and create a minimal binary test target by running:

Run: `cargo check -p layout-viewer-native-v2`

Expected: fail before the app crate exists.

- [ ] **Step 2: Implement V2 app**

Create a new app that:

- opens `LayoutPackage`,
- converts it to `LayoutDb` via `LayoutDb::from_layout_package`,
- creates a `DisplayModel` from imported layers,
- maintains fresh `V2ViewState`,
- calls `RenderPlanner::plan`,
- draws `Fill`, `Frame`, and `Marker` batches with egui,
- performs picking through `RenderPlanner::pick`,
- exposes a basic right panel for display layer visibility.

The app must not import modules from `apps/layout-viewer-native`.

- [ ] **Step 3: Verify app compiles**

Run: `cargo check -p layout-viewer-native-v2`

Expected: check succeeds.

### Task 5: Documentation And Workspace Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] **Step 1: Update docs**

Document:

- V2 is greenfield and clean-room.
- V2 uses `.layoutpkg` through an adapter into `LayoutDb`.
- V2 rendering uses display layers, fill/frame/marker planes, and pixel-threshold LOD.
- V2 can be launched with `cargo run -p layout-viewer-native-v2 -- <package>`.

- [ ] **Step 2: Run full verification**

Run: `cargo test --workspace`

Expected: all tests pass.

Run: `cargo check -p layout-viewer-native-v2`

Expected: check succeeds.
