# Layout Viewer Redraw Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `layout-viewer-native-v2` pan, zoom, and near-detail navigation responsive by adopting a KLayout-style redraw pipeline: instrument first, degrade during interaction, load/plan progressively, reuse per-cell display work, and enforce draw budgets.

**Architecture:** Keep geometry ownership in `layoutdb`, render planning in `layout-render`, and UI/runtime scheduling in `layout-viewer-native-v2`. The viewer should render a cheap coarse frame immediately during interaction, then refine from cached data after input settles. Heavy viewport loading and near-detail planning must be budgeted or moved out of the UI frame path.

**Tech Stack:** Rust workspace under `ecos/layout-viewer`, `eframe/egui` native UI, `layoutdb` R-tree hierarchy queries, `layout-render` planning and LOD policy, `std::thread`/`std::sync::mpsc` for background jobs, existing `cargo test`/`cargo check` validation.

---

## Scope Check

This plan covers performance and redraw responsiveness only. It does not redesign the color system, add GPU rendering, or replace `egui` painting. It creates the seams needed for those later changes by adding frame timing, background loading, progressive render planning, and cacheable display units.

KLayout-inspired references:
- Hierarchy depth display modes: <https://www.klayout.de/doc/manual/hier.html>
- Recursive iterator with maximum hierarchy depth: <https://www.klayout.de/doc/code/class_RecursiveShapeIterator.html>
- LayoutView redraw thread separation: <https://www.klayout.de/doc/code/class_LayoutView.html>

## Current Hot Spots

Current files and responsibilities:
- `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`
  - Owns `LayoutViewerV2App`, egui event handling, synchronous `ensure_viewport_loaded`, render plan creation, and painting.
  - This is the likely cause of interactive stalls because loading, planning, and painting all happen inside the UI update path.
- `ecos/layout-viewer/crates/layout-render/src/lib.rs`
  - Owns `RenderSettings`, `RenderPlan`, hierarchy far/mid/near policy, array LOD, and draw item generation.
  - Needs frame budgets, planner cache keys that tolerate coarse interaction buckets, and real per-cell template reuse.
- `ecos/layout-viewer/crates/layoutdb/src/lib.rs`
  - Owns `LayoutSession`, tile loading, shape storage, hierarchy traversal, and R-tree instance queries.
  - Needs nonblocking viewport load request/result separation or a wrapper that lets native-v2 avoid blocking the UI frame.

## Target Behavior

During pan/zoom:
- The UI frame never waits for disk tile loading.
- The planner uses forced coarse mode.
- The previous good plan remains visible until the coarse plan is ready.
- The frame displays timing counters so bottlenecks are visible.

After interaction settles:
- A background load request fetches missing tiles.
- Planning refines from coarse to near detail within item/time budgets.
- Repeated cell display work is reused from a cell-local template cache.
- If the budget is exceeded, the viewer paints a partial plan and continues refinement in later frames.

---

### Task 1: Add Frame Profiling HUD

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write the failing test for timing state defaults**

Add this test inside the existing `#[cfg(test)] mod tests` in `apps/layout-viewer-native-v2/src/main.rs`:

```rust
#[test]
fn frame_timing_state_tracks_named_stages() {
    let mut timing = FrameTimingState::default();

    timing.record_load(std::time::Duration::from_micros(1_500));
    timing.record_plan(std::time::Duration::from_micros(2_000));
    timing.record_paint(std::time::Duration::from_micros(3_250));

    assert_eq!(timing.load_ms, 1.5);
    assert_eq!(timing.plan_ms, 2.0);
    assert_eq!(timing.paint_ms, 3.25);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 frame_timing_state_tracks_named_stages -- --nocapture
```

Expected: FAIL because `FrameTimingState` does not exist.

- [ ] **Step 3: Add timing state**

Add near `LayoutViewerV2App` fields:

```rust
#[derive(Debug, Clone, Copy, Default)]
struct FrameTimingState {
    load_ms: f32,
    plan_ms: f32,
    paint_ms: f32,
}

impl FrameTimingState {
    fn record_load(&mut self, duration: std::time::Duration) {
        self.load_ms = duration.as_secs_f32() * 1_000.0;
    }

    fn record_plan(&mut self, duration: std::time::Duration) {
        self.plan_ms = duration.as_secs_f32() * 1_000.0;
    }

    fn record_paint(&mut self, duration: std::time::Duration) {
        self.paint_ms = duration.as_secs_f32() * 1_000.0;
    }
}
```

Add a field to `LayoutViewerV2App`:

```rust
frame_timing: FrameTimingState,
```

Initialize in `LayoutViewerV2App::open`:

```rust
frame_timing: FrameTimingState::default(),
```

- [ ] **Step 4: Instrument load, plan, and paint**

In `draw_canvas`, wrap synchronous load:

```rust
let load_started = std::time::Instant::now();
let load_result = self.session.ensure_viewport_loaded(viewport.world);
self.frame_timing.record_load(load_started.elapsed());
```

Wrap plan creation:

```rust
let plan_started = std::time::Instant::now();
let plan = RenderPlanner::new(self.lod_tuning.render_settings()).plan(
    self.session.db(),
    &self.display,
    viewport,
);
self.frame_timing.record_plan(plan_started.elapsed());
```

Wrap the paint loop:

```rust
let paint_started = std::time::Instant::now();
for batch in &plan.batches {
    for item in &batch.items {
        // existing match body
    }
}
self.frame_timing.record_paint(paint_started.elapsed());
```

- [ ] **Step 5: Show timings in HUD**

Update `draw_hud` format string to include:

```rust
"\\ntiming load={:.2}ms plan={:.2}ms paint={:.2}ms"
```

Pass:

```rust
self.frame_timing.load_ms,
self.frame_timing.plan_ms,
self.frame_timing.paint_ms,
```

- [ ] **Step 6: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 frame_timing_state_tracks_named_stages -- --nocapture
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: all tests pass.

---

### Task 2: Detect Active Interaction And Force Coarse LOD

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing render test for forced coarse mode**

Add this test in `crates/layout-render/src/lib.rs` tests:

```rust
#[test]
fn interaction_mode_forces_mid_coarse_without_near_expansion() {
    let db = hierarchy_db();
    let model = one_layer_display_model();

    let plan = RenderPlanner::new(RenderSettings {
        force_interaction_coarse: true,
        hierarchy_bbox_units_per_pixel: 100.0,
        hierarchy_coarse_units_per_pixel: 5.0,
        ..Default::default()
    })
    .plan(
        &db,
        &model,
        Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0),
    );

    assert!(plan.lod_stats.coarse + plan.lod_stats.array_grid + plan.lod_stats.array_bbox > 0);
    assert_eq!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render interaction_mode_forces_mid_coarse_without_near_expansion -- --nocapture
```

Expected: FAIL because `force_interaction_coarse` does not exist.

- [ ] **Step 3: Add render setting**

In `RenderSettings` add:

```rust
pub force_interaction_coarse: bool,
```

In `Default` add:

```rust
force_interaction_coarse: false,
```

In `render_cache_key`, add:

```rust
hash.write_u8(u8::from(settings.force_interaction_coarse));
```

- [ ] **Step 4: Apply forced coarse mode**

At the top of `RenderPlanner::hierarchy_lod_mode`, after the flat-DB guard, add:

```rust
if self.settings.force_interaction_coarse {
    return HierarchyLodMode::MidCoarse;
}
```

- [ ] **Step 5: Track interaction in native-v2**

Add fields:

```rust
last_interaction_at: Option<std::time::Instant>,
interaction_settle_ms: u64,
```

Initialize:

```rust
last_interaction_at: None,
interaction_settle_ms: 120,
```

In drag and scroll branches, after changing view:

```rust
self.last_interaction_at = Some(std::time::Instant::now());
```

Add method:

```rust
fn interaction_active(&self) -> bool {
    self.last_interaction_at
        .map(|instant| instant.elapsed().as_millis() < u128::from(self.interaction_settle_ms))
        .unwrap_or(false)
}
```

- [ ] **Step 6: Pass forced mode into render settings**

Change `LodTuningState::render_settings(self)` to:

```rust
fn render_settings(self, force_interaction_coarse: bool) -> RenderSettings
```

Set:

```rust
force_interaction_coarse,
```

Update calls:

```rust
let interaction_active = self.interaction_active();
let plan = RenderPlanner::new(self.lod_tuning.render_settings(interaction_active)).plan(...);
```

For picking, pass `false`:

```rust
RenderPlanner::new(self.lod_tuning.render_settings(false)).pick(...)
```

- [ ] **Step 7: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render interaction_mode_forces_mid_coarse_without_near_expansion -- --nocapture
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: all tests pass.

---

### Task 3: Make Viewport Loading Nonblocking In The UI Frame

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`
- Add tests in same file.

- [ ] **Step 1: Write failing test for load worker request coalescing**

Add test:

```rust
#[test]
fn async_load_state_keeps_only_latest_pending_request() {
    let mut state = AsyncLoadState::default();
    state.request(Rect::new(0, 0, 10, 10), 1);
    state.request(Rect::new(10, 10, 20, 20), 2);

    assert_eq!(state.pending_request().unwrap().generation, 2);
    assert_eq!(state.pending_request().unwrap().viewport, Rect::new(10, 10, 20, 20));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 async_load_state_keeps_only_latest_pending_request -- --nocapture
```

Expected: FAIL because `AsyncLoadState` does not exist.

- [ ] **Step 3: Add request state**

Add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LoadRequest {
    viewport: Rect,
    generation: u64,
}

#[derive(Debug, Default)]
struct AsyncLoadState {
    pending: Option<LoadRequest>,
    completed_generation: u64,
}

impl AsyncLoadState {
    fn request(&mut self, viewport: Rect, generation: u64) {
        self.pending = Some(LoadRequest { viewport, generation });
    }

    fn pending_request(&self) -> Option<LoadRequest> {
        self.pending
    }

    fn take_pending(&mut self) -> Option<LoadRequest> {
        self.pending.take()
    }

    fn mark_completed(&mut self, generation: u64) {
        self.completed_generation = self.completed_generation.max(generation);
    }
}
```

- [ ] **Step 4: Add native app fields**

Add:

```rust
async_load: AsyncLoadState,
load_generation: u64,
```

Initialize:

```rust
async_load: AsyncLoadState::default(),
load_generation: 0,
```

- [ ] **Step 5: Replace synchronous load during interaction**

In `draw_canvas`, compute:

```rust
let interaction_active = self.interaction_active();
```

Replace direct `ensure_viewport_loaded` with:

```rust
let load_started = std::time::Instant::now();
if interaction_active {
    self.load_generation += 1;
    self.async_load.request(viewport.world, self.load_generation);
    self.last_error = None;
} else {
    let load_result = self.session.ensure_viewport_loaded(viewport.world);
    match load_result {
        Ok(_) => self.last_error = None,
        Err(error) => self.last_error = Some(error.to_string()),
    }
    self.async_load.mark_completed(self.load_generation);
}
self.frame_timing.record_load(load_started.elapsed());
```

This does not start a background thread yet. It removes the worst UI-frame behavior while moving the viewport: no disk load during active pan/zoom.

- [ ] **Step 6: Drain latest pending load after interaction settles**

After the interaction branch:

```rust
if !interaction_active {
    if let Some(request) = self.async_load.take_pending() {
        let load_result = self.session.ensure_viewport_loaded(request.viewport);
        match load_result {
            Ok(_) => {
                self.last_error = None;
                self.async_load.mark_completed(request.generation);
            }
            Err(error) => self.last_error = Some(error.to_string()),
        }
    }
}
```

- [ ] **Step 7: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 async_load_state_keeps_only_latest_pending_request -- --nocapture
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: all tests pass.

---

### Task 4: Add Render Item Budget And Progressive Near Detail

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing test for item budget**

Add test in `layout-render`:

```rust
#[test]
fn near_expand_stops_when_render_item_budget_is_reached() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 100_000, 100_000));
    db.add_layer(LayerInfo::new(1, "M1"));
    let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
    db.add_shape(child, ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 9));
    for i in 0..200 {
        let x = i * 50;
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: i as u32,
                name: format!("u{i}"),
                child_cell: child,
                transform: Transform { dx: x, dy: 0, orient: Orientation::R0 },
                array: CellArray::default(),
                bbox: Rect::new(x, 0, x + 20, 20),
                source_id: i as u32,
            },
        );
    }
    let model = one_layer_display_model();

    let plan = RenderPlanner::new(RenderSettings {
        max_render_items: 20,
        hierarchy_bbox_units_per_pixel: 1_000.0,
        hierarchy_coarse_units_per_pixel: 100.0,
        ..Default::default()
    })
    .plan(&db, &model, Viewport::new(Rect::new(0, 0, 10_000, 100), 2_000.0, 200.0));

    assert!(plan.truncated);
    assert!(plan.batches.iter().map(|batch| batch.items.len()).sum::<usize>() <= 20);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render near_expand_stops_when_render_item_budget_is_reached -- --nocapture
```

Expected: FAIL because `max_render_items` and `truncated` do not exist.

- [ ] **Step 3: Add budget fields**

In `RenderSettings`:

```rust
pub max_render_items: usize,
```

Default:

```rust
max_render_items: 80_000,
```

In `RenderPlan`:

```rust
pub truncated: bool,
```

In `render_cache_key`:

```rust
hash.write_usize(settings.max_render_items);
```

- [ ] **Step 4: Enforce budget in `push_item`**

Change `push_item` signature:

```rust
fn push_item(
    plan: &mut RenderPlan,
    plane: RenderPlane,
    layer: &ResolvedDisplayLayer,
    item: DrawItem,
    max_items: usize,
)
```

At top:

```rust
let current_items = plan.batches.iter().map(|batch| batch.items.len()).sum::<usize>();
if current_items >= max_items {
    plan.truncated = true;
    return;
}
```

Update every call to pass `settings.max_render_items`. For helper functions, add a `max_items` argument and pass it through.

- [ ] **Step 5: Show budget state in HUD**

In native-v2 add:

```rust
last_plan_truncated: bool,
```

Set after planning:

```rust
self.last_plan_truncated = plan.truncated;
```

HUD line:

```rust
"\\nrender truncated={}"
```

- [ ] **Step 6: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render near_expand_stops_when_render_item_budget_is_reached -- --nocapture
cargo test -p layout-render -- --nocapture
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: all tests pass.

---

### Task 5: Add Real Per-Cell Shape Template Cache

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing test for template cache**

Add test:

```rust
#[test]
fn repeated_cell_templates_are_built_once_and_reused() {
    let db = repeated_cell_hierarchy_db();
    let model = one_layer_display_model();

    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 1_000.0,
        hierarchy_coarse_units_per_pixel: 10.0,
        enable_cell_template_cache: true,
        ..Default::default()
    })
    .plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 1_000, 200), 100.0, 20.0),
    );

    assert_eq!(plan.query_stats.display_cache_misses, 1);
    assert_eq!(plan.query_stats.display_cache_hits, 2);
    assert!(plan.query_stats.cached_template_items > 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render repeated_cell_templates_are_built_once_and_reused -- --nocapture
```

Expected: FAIL because `enable_cell_template_cache` and `cached_template_items` do not exist.

- [ ] **Step 3: Add cache controls and stats**

In `RenderSettings`:

```rust
pub enable_cell_template_cache: bool,
```

Default:

```rust
enable_cell_template_cache: true,
```

In `RenderQueryStats`:

```rust
pub cached_template_items: usize,
```

Initialize to 0.

- [ ] **Step 4: Add template structs**

In `layout-render/src/lib.rs`:

```rust
#[derive(Debug, Clone, Default)]
struct CellTemplateCache {
    templates: HashMap<CellId, CellTemplate>,
}

#[derive(Debug, Clone, Default)]
struct CellTemplate {
    items: Vec<TemplateItem>,
}

#[derive(Debug, Clone)]
struct TemplateItem {
    bbox: Rect,
    layer_id: u16,
    kind: ShapeKind,
    source_id: u32,
}
```

- [ ] **Step 5: Build local template from cell shapes**

Add:

```rust
impl CellTemplateCache {
    fn template_for<'a>(&'a mut self, db: &LayoutDb, cell_id: CellId) -> (&'a CellTemplate, bool) {
        if self.templates.contains_key(&cell_id) {
            return (self.templates.get(&cell_id).unwrap(), true);
        }
        let mut template = CellTemplate::default();
        if let Some(cell) = db.cell(cell_id) {
            for shape in cell.shapes() {
                template.items.push(TemplateItem {
                    bbox: shape.bbox,
                    layer_id: shape.layer_id,
                    kind: shape.kind,
                    source_id: shape.source_id,
                });
            }
        }
        self.templates.insert(cell_id, template);
        (self.templates.get(&cell_id).unwrap(), false)
    }
}
```

- [ ] **Step 6: Use template in mid coarse mode**

In `push_coarse_hierarchy`, replace `CellDisplayCache` with `CellTemplateCache`.

For each `ViewportElements` instance:

```rust
let (template, hit) = cell_template_cache.template_for(db, instance.child_cell);
if hit {
    plan.query_stats.display_cache_hits += 1;
} else {
    plan.query_stats.display_cache_misses += 1;
}
plan.query_stats.cached_template_items += template.items.len();
```

Keep coarse drawing as bbox for now; this task proves real cache construction and reuse without increasing draw cost.

- [ ] **Step 7: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render repeated_cell_templates_are_built_once_and_reused -- --nocapture
cargo test -p layout-render -- --nocapture
```

Expected: all tests pass.

---

### Task 6: Reuse Last Render Plan During Interaction

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing test for plan reuse decision**

Add pure function and test target:

```rust
#[test]
fn should_reuse_last_plan_when_interacting_and_current_plan_is_truncated() {
    assert!(should_reuse_last_plan(true, true, 12_000));
    assert!(!should_reuse_last_plan(false, true, 12_000));
    assert!(!should_reuse_last_plan(true, false, 12_000));
    assert!(!should_reuse_last_plan(true, true, 0));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 should_reuse_last_plan_when_interacting_and_current_plan_is_truncated -- --nocapture
```

Expected: FAIL because function does not exist.

- [ ] **Step 3: Add function**

```rust
fn should_reuse_last_plan(interaction_active: bool, current_truncated: bool, last_item_count: usize) -> bool {
    interaction_active && current_truncated && last_item_count > 0
}
```

- [ ] **Step 4: Add last plan storage**

Add field:

```rust
last_render_plan: Option<layout_render::RenderPlan>,
```

Initialize:

```rust
last_render_plan: None,
```

- [ ] **Step 5: Choose plan for painting**

After creating `plan`:

```rust
let last_item_count = self
    .last_render_plan
    .as_ref()
    .map(|plan| plan.batches.iter().map(|batch| batch.items.len()).sum())
    .unwrap_or(0);
let paint_plan = if should_reuse_last_plan(interaction_active, plan.truncated, last_item_count) {
    self.last_render_plan.as_ref().unwrap()
} else {
    self.last_render_plan = Some(plan);
    self.last_render_plan.as_ref().unwrap()
};
```

Update subsequent stats and paint loops to use `paint_plan`.

- [ ] **Step 6: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 should_reuse_last_plan_when_interacting_and_current_plan_is_truncated -- --nocapture
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: all tests pass.

---

### Task 7: Add Layer-Visible Query Narrowing

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing test that hidden physical layers are not expanded**

Add test:

```rust
#[test]
fn near_expand_skips_hidden_physical_layers_before_pushing_shapes() {
    let db = hierarchy_db();
    let mut model = one_layer_display_model();
    model.layers_mut()[0].visible = false;

    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 1_000.0,
        hierarchy_coarse_units_per_pixel: 100.0,
        ..Default::default()
    })
    .plan(
        &db,
        &model,
        Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0),
    );

    assert_eq!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker, 0);
}
```

- [ ] **Step 2: Run test**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render near_expand_skips_hidden_physical_layers_before_pushing_shapes -- --nocapture
```

Expected: pass if current resolved layers already filter hidden layers. If it passes, keep the test as regression coverage and continue.

- [ ] **Step 3: Add visible layer set for query filtering**

If the test fails or profiling shows expensive hidden-layer expansion, add:

```rust
fn visible_physical_layers(layers: &[ResolvedDisplayLayer]) -> HashSet<u16> {
    layers
        .iter()
        .filter_map(|layer| match layer.source {
            SourceSelector::PhysicalLayer(layer_id) => Some(layer_id),
            _ => None,
        })
        .collect()
}
```

In `push_expanded_hierarchy_shapes`, before pushing:

```rust
let visible_layers = visible_physical_layers(layers);
if !visible_layers.is_empty() && !visible_layers.contains(&record.layer_id) {
    continue;
}
```

- [ ] **Step 4: Verify**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render near_expand_skips_hidden_physical_layers_before_pushing_shapes -- --nocapture
cargo test -p layout-render -- --nocapture
```

Expected: all tests pass.

---

### Task 8: Add Coarse Render Quality Gates

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`

- [ ] **Step 1: Add tests for the four required LOD outcomes**

Ensure these tests exist and pass:

```rust
#[test]
fn far_view_outputs_only_hierarchy_or_array_bbox_when_hierarchy_exists() {
    let db = hierarchy_db();
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 100.0,
        ..Default::default()
    })
    .plan(&db, &model, Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0));

    assert!(plan.lod_stats.hierarchy_bbox + plan.lod_stats.array_bbox > 0);
    assert_eq!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker, 0);
}
```

```rust
#[test]
fn mid_view_outputs_coarse_or_array_grid_without_near_detail() {
    let db = array_hierarchy_db();
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 1_000.0,
        hierarchy_coarse_units_per_pixel: 10.0,
        array_bbox_units_per_pixel: 1_000.0,
        array_grid_units_per_pixel: 10.0,
        ..Default::default()
    })
    .plan(&db, &model, Viewport::new(Rect::new(0, 0, 10_000, 200), 100.0, 20.0));

    assert!(plan.lod_stats.coarse + plan.lod_stats.array_grid + plan.lod_stats.array_bbox > 0);
    assert_eq!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker, 0);
}
```

```rust
#[test]
fn near_view_outputs_detail_when_under_budget() {
    let db = hierarchy_db();
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings {
        max_render_items: 10_000,
        hierarchy_bbox_units_per_pixel: 1_000.0,
        hierarchy_coarse_units_per_pixel: 100.0,
        ..Default::default()
    })
    .plan(&db, &model, Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0));

    assert!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker > 0);
    assert!(!plan.truncated);
}
```

```rust
#[test]
fn flat_db_keeps_existing_flat_lod_behavior() {
    let db = one_shape_db(Rect::new(10, 10, 110, 110));
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 1.0,
        ..Default::default()
    })
    .plan(&db, &model, Viewport::new(Rect::new(0, 0, 200, 200), 400.0, 400.0));

    assert!(plan.lod_stats.exact + plan.lod_stats.frame_only + plan.lod_stats.marker > 0);
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render far_view_outputs_only_hierarchy_or_array_bbox_when_hierarchy_exists -- --nocapture
cargo test -p layout-render mid_view_outputs_coarse_or_array_grid_without_near_detail -- --nocapture
cargo test -p layout-render near_view_outputs_detail_when_under_budget -- --nocapture
cargo test -p layout-render flat_db_keeps_existing_flat_lod_behavior -- --nocapture
```

Expected: all pass.

- [ ] **Step 3: Fix any failing case by adjusting policy only**

Allowed policy edits:
- `RenderPlanner::hierarchy_lod_mode`
- `RenderPlanner::push_hierarchy_bboxes`
- `RenderPlanner::push_coarse_hierarchy`
- `RenderPlanner::push_expanded_hierarchy_shapes`

Do not change test expectations to match weaker behavior.

---

### Task 9: Final Verification And Manual Probe

**Files:**
- No code changes unless verification reveals a defect.

- [ ] **Step 1: Run formatting**

Run:

```bash
cd ecos/layout-viewer
cargo fmt --all -- --check
```

Expected: exit 0.

- [ ] **Step 2: Run all tests**

Run:

```bash
cd ecos/layout-viewer
cargo test --workspace -- --nocapture
```

Expected: exit 0 with all crate tests passing.

- [ ] **Step 3: Run native-v2 check**

Run:

```bash
cd ecos/layout-viewer
cargo check -p layout-viewer-native-v2
```

Expected: exit 0.

- [ ] **Step 4: Manual performance probe**

Run with the real package:

```bash
cd ecos/layout-viewer
cargo run -p layout-viewer-native-v2 -- /home/ekko/Desktop/ECOS/templates/t8/route_ecc/output/gcd_route_view/.layoutpkg
```

Expected interactive behavior:
- During pan/zoom, HUD shows `force_interaction_coarse` effect through high `coarse`, `array_bbox`, or `array_grid` counts and low near-detail counts.
- During pan/zoom, `load_ms` should stay near zero because tile loading is deferred.
- After input settles, `load_ms` may spike once, then detail refines.
- `plan_ms` and `paint_ms` should be visible in HUD and guide the next optimization.
- If `truncated=true`, the view remains responsive and uses the previous plan when interacting.

- [ ] **Step 5: Record findings**

Append a short note to `ecos/layout-viewer/docs/native-layout-viewer-split.md`:

```markdown
## Redraw Performance Probe

- Package: `/home/ekko/Desktop/ECOS/templates/t8/route_ecc/output/gcd_route_view/.layoutpkg`
- Interaction behavior: pan/zoom uses coarse mode while input is active.
- HUD fields to watch: `timing load`, `timing plan`, `timing paint`, `render truncated`, `display cache h/m`, `hier candidates`.
- Next bottleneck decision:
  - High `load_ms`: move loading to a dedicated worker thread.
  - High `plan_ms`: deepen cell template cache and add layer-filtered hierarchy query.
  - High `paint_ms`: add bitmap/plane cache or reduce draw item count.
```

---

## Follow-Up Plan Boundaries

If Task 9 shows `paint_ms` remains high after these changes, create a separate plan for bitmap/plane caching. That work should introduce a renderer-side plane cache and is large enough to deserve its own plan.

If `load_ms` remains high only after interaction settles, create a separate plan for a real background loader thread that owns package IO. That requires changing `LayoutSession` ownership and should be isolated from the render planner changes above.

## Self-Review

Spec coverage:
- Profiling HUD: Task 1.
- Interaction coarse frame: Task 2.
- Avoid UI frame synchronous loading during pan/zoom: Task 3.
- Near-detail budget and progressive behavior: Task 4.
- Per-cell display cache: Task 5.
- Last-plan reuse: Task 6.
- Visible layer narrowing: Task 7.
- Far/mid/near quality gates: Task 8.
- Full verification and manual probe: Task 9.

Placeholder scan:
- No `TBD` markers.
- No unspecified tests.
- Each task has concrete files, code snippets, commands, and expected results.

Type consistency:
- `FrameTimingState`, `AsyncLoadState`, `RenderSettings::force_interaction_coarse`, `RenderSettings::max_render_items`, `RenderPlan::truncated`, `RenderQueryStats::cached_template_items`, and `RenderSettings::enable_cell_template_cache` are introduced before use.
- Native-v2 plan reuse depends on `RenderPlan: Clone`, which already holds cloneable fields. If compilation reports otherwise, derive `Clone` for `RenderPlan`, `DrawBatch`, and draw item types in `layout-render/src/lib.rs`.
