# KLayout-Like Hierarchy Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add KLayout-like hierarchy semantics foundation: cell view state, instance/object paths, path-aware recursive queries, render planner integration, and minimal native-v2 hierarchy controls.

**Architecture:** Keep current `.layoutpkg` and `LayoutDb` storage. Add semantic path and policy types to `layoutdb`, expose path-aware query APIs, then let `layout-render` consume those APIs through a new view-aware planner entrypoint. Native V2 owns the active `CellViewState` and `HierarchyPolicy` UI controls.

**Tech Stack:** Rust workspace, `layoutdb`, `layout-render`, `layout-viewer-native-v2`, existing `eframe/egui`, existing test framework.

---

## Reference Spec

Read first:

- `docs/superpowers/specs/2026-06-19-klayout-like-hierarchy-semantics-design.md`

KLayout references summarized in that spec:

- `RecursiveShapeIterator`
- `RecursiveInstanceIterator`
- `CellView`
- `CellInstArray`
- `layRedrawThreadWorker`

## File Structure

- Modify `crates/layoutdb/src/lib.rs`
  - Add `CellViewState`, `InstancePathElement`, `InstancePath`, `ShapeId`, `ObjectPath`, `HierarchyPolicy`.
  - Add path-aware query inputs/results.
  - Add path-aware recursive traversal.
- Modify `crates/layout-render/src/lib.rs`
  - Add view-aware planner API.
  - Include cell view/policy in source-aware cache keys.
  - Route hierarchy near/far/mid through path-aware APIs.
- Modify `apps/layout-viewer-native-v2/src/main.rs`
  - Store active `CellViewState` and `HierarchyPolicy`.
  - Add minimal hierarchy panel rows and controls.
  - Pass view/policy into render planner.
- Modify docs:
  - `docs/native-layout-viewer-split.md`
  - `README.md`

## Task 1: LayoutDB Semantic Types

**Files:**
- Modify: `crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing tests for semantic identity types**

Add tests under `#[cfg(test)] mod tests`:

```rust
#[test]
fn default_cell_view_state_points_at_top_cell() {
    let db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));

    let view = CellViewState::top(&db);

    assert_eq!(view.context_cell(), db.top_cell());
    assert_eq!(view.target_cell(), db.top_cell());
    assert!(view.specific_path().is_empty());
}

#[test]
fn instance_path_tracks_target_cell_and_depth() {
    let parent = CellId::from_raw(0);
    let child = CellId::from_raw(1);
    let path = InstancePath::from_elements(vec![InstancePathElement {
        parent_cell: parent,
        instance_id: 7,
        source_id: 77,
        child_cell: child,
        array_column: 3,
        array_row: 4,
        bbox: Rect::new(10, 20, 30, 40),
    }]);

    assert_eq!(path.depth(), 1);
    assert_eq!(path.target_cell(), Some(child));
    assert_eq!(path.elements()[0].array_column, 3);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p layoutdb default_cell_view_state_points_at_top_cell instance_path_tracks_target_cell_and_depth -- --nocapture
```

Expected: fail because the new types/methods do not exist.

- [ ] **Step 3: Implement semantic types**

Add public types near existing hierarchy records:

```rust
impl CellId {
    pub fn from_raw(raw: usize) -> Self {
        Self(raw)
    }

    pub fn raw(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InstancePathElement {
    pub parent_cell: CellId,
    pub instance_id: u32,
    pub source_id: u32,
    pub child_cell: CellId,
    pub array_column: u32,
    pub array_row: u32,
    pub bbox: Rect,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct InstancePath {
    elements: Vec<InstancePathElement>,
}

impl InstancePath {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_elements(elements: Vec<InstancePathElement>) -> Self {
        Self { elements }
    }

    pub fn elements(&self) -> &[InstancePathElement] {
        &self.elements
    }

    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    pub fn depth(&self) -> usize {
        self.elements.len()
    }

    pub fn target_cell(&self) -> Option<CellId> {
        self.elements.last().map(|element| element.child_cell)
    }

    fn pushed(&self, element: InstancePathElement) -> Self {
        let mut elements = self.elements.clone();
        elements.push(element);
        Self { elements }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ShapeId {
    pub cell: CellId,
    pub shape_index: usize,
    pub source_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ObjectPathTarget {
    Shape(ShapeId),
    Instance {
        parent_cell: CellId,
        instance_id: u32,
        source_id: u32,
        child_cell: CellId,
        array_column: u32,
        array_row: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ObjectPath {
    pub instance_path: InstancePath,
    pub target: ObjectPathTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewState {
    context_cell: CellId,
    target_cell: CellId,
    specific_path: InstancePath,
}

impl CellViewState {
    pub fn top(db: &LayoutDb) -> Self {
        Self {
            context_cell: db.top_cell(),
            target_cell: db.top_cell(),
            specific_path: InstancePath::new(),
        }
    }

    pub fn from_path(context_cell: CellId, specific_path: InstancePath) -> Self {
        let target_cell = specific_path.target_cell().unwrap_or(context_cell);
        Self {
            context_cell,
            target_cell,
            specific_path,
        }
    }

    pub fn context_cell(&self) -> CellId {
        self.context_cell
    }

    pub fn target_cell(&self) -> CellId {
        self.target_cell
    }

    pub fn specific_path(&self) -> &InstancePath {
        &self.specific_path
    }

    pub fn ascend(&self) -> Self {
        let mut elements = self.specific_path.elements.clone();
        elements.pop();
        Self::from_path(self.context_cell, InstancePath::from_elements(elements))
    }

    pub fn reset_to_top(db: &LayoutDb) -> Self {
        Self::top(db)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cargo test -p layoutdb default_cell_view_state_points_at_top_cell instance_path_tracks_target_cell_and_depth -- --nocapture
```

Expected: pass.

## Task 2: LayoutDB Path-Aware Recursive Queries

**Files:**
- Modify: `crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing tests for path-aware shapes and focused cell view**

Add tests:

```rust
#[test]
fn cell_view_shape_query_returns_instance_and_object_paths() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
    db.add_layer(LayerInfo::new(1, "M1"));
    let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
    db.add_shape(child, ShapeRecord::new(Rect::new(1, 2, 5, 6), 1, ShapeKind::IoPin, 99));
    db.add_instance(
        db.top_cell(),
        CellInstance {
            id: 7,
            name: "u0".to_owned(),
            child_cell: child,
            transform: Transform { dx: 100, dy: 200, orient: Orientation::R0 },
            array: CellArray::default(),
            bbox: Rect::new(100, 200, 120, 220),
            source_id: 77,
        },
    );

    let result = db.query_cell_view_shapes(CellViewShapeQuery {
        cell_view: CellViewState::top(&db),
        viewport: Rect::new(90, 190, 130, 230),
        min_depth: 1,
        max_depth: 1,
        layer_ids: Vec::new(),
        include_kinds: Vec::new(),
        policy: HierarchyPolicy::default(),
    });

    assert_eq!(result.shapes.len(), 1);
    let shape = &result.shapes[0];
    assert_eq!(shape.bbox, Rect::new(101, 202, 105, 206));
    assert_eq!(shape.instance_path.depth(), 1);
    assert_eq!(shape.instance_path.elements()[0].instance_id, 7);
    assert!(matches!(shape.object_path.target, ObjectPathTarget::Shape(_)));
}

#[test]
fn cell_view_focused_on_child_queries_child_local_shapes() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
    db.add_layer(LayerInfo::new(1, "M1"));
    let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
    db.add_shape(child, ShapeRecord::new(Rect::new(1, 2, 5, 6), 1, ShapeKind::IoPin, 99));

    let view = CellViewState::from_path(db.top_cell(), InstancePath::from_elements(vec![
        InstancePathElement {
            parent_cell: db.top_cell(),
            instance_id: 7,
            source_id: 77,
            child_cell: child,
            array_column: 0,
            array_row: 0,
            bbox: Rect::new(100, 200, 120, 220),
        },
    ]));

    let result = db.query_cell_view_shapes(CellViewShapeQuery {
        cell_view: view,
        viewport: Rect::new(0, 0, 20, 20),
        min_depth: 0,
        max_depth: 0,
        layer_ids: Vec::new(),
        include_kinds: Vec::new(),
        policy: HierarchyPolicy::default(),
    });

    assert_eq!(result.shapes.len(), 1);
    assert_eq!(result.shapes[0].bbox, Rect::new(1, 2, 5, 6));
    assert_eq!(result.shapes[0].cell, child);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p layoutdb cell_view_shape_query_returns_instance_and_object_paths cell_view_focused_on_child_queries_child_local_shapes -- --nocapture
```

Expected: fail because query types/APIs do not exist.

- [ ] **Step 3: Implement query types**

Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyPolicy {
    pub min_depth: usize,
    pub max_depth: usize,
    pub expand_arrays: bool,
    pub hidden_cells: HashSet<CellId>,
    pub selected_cells: HashSet<CellId>,
    pub ghost_cells: HashSet<CellId>,
}

impl Default for HierarchyPolicy {
    fn default() -> Self {
        Self {
            min_depth: 0,
            max_depth: usize::MAX,
            expand_arrays: true,
            hidden_cells: HashSet::new(),
            selected_cells: HashSet::new(),
            ghost_cells: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewShapeQuery {
    pub cell_view: CellViewState,
    pub viewport: Rect,
    pub min_depth: usize,
    pub max_depth: usize,
    pub layer_ids: Vec<u16>,
    pub include_kinds: Vec<ShapeKind>,
    pub policy: HierarchyPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewShapeRecord {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub source_id: u32,
    pub instance_id: u32,
    pub cell: CellId,
    pub depth: usize,
    pub instance_path: InstancePath,
    pub object_path: ObjectPath,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CellViewShapeQueryResult {
    pub shapes: Vec<CellViewShapeRecord>,
    pub instance_candidates_checked: usize,
    pub total_instances: usize,
}
```

- [ ] **Step 4: Implement path-aware shape traversal**

Add `LayoutDb::query_cell_view_shapes` and a recursive helper modeled after `collect_hierarchy_shapes`.

Rules:

- Start at `query.cell_view.target_cell()`.
- Use identity transform for focused target cell coordinates.
- For default top cell view this matches existing top-cell traversal.
- Append `InstancePathElement` when entering child instances.
- Include shapes only when `current_depth` is within both query min/max and policy min/max.
- Skip children whose cell id is in `policy.hidden_cells`.
- Respect `layer_ids` and `include_kinds`.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test -p layoutdb cell_view_shape_query_returns_instance_and_object_paths cell_view_focused_on_child_queries_child_local_shapes -- --nocapture
```

Expected: pass.

## Task 3: LayoutDB Path-Aware Instance Queries and Hidden Cells

**Files:**
- Modify: `crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing tests for instances and hidden cells**

Add:

```rust
#[test]
fn cell_view_instance_query_returns_object_paths() {
    let db = nested_test_db();
    let result = db.query_cell_view_instances(CellViewInstanceQuery {
        cell_view: CellViewState::top(&db),
        viewport: Rect::new(0, 0, 500, 500),
        min_depth: 1,
        max_depth: 2,
        expand_arrays: true,
        policy: HierarchyPolicy::default(),
    });

    assert!(!result.instances.is_empty());
    assert!(result.instances.iter().all(|instance| instance.instance_path.depth() >= 1));
    assert!(result.instances.iter().all(|instance| {
        matches!(instance.object_path.target, ObjectPathTarget::Instance { .. })
    }));
}

#[test]
fn hidden_cells_prune_cell_view_shape_traversal() {
    let db = nested_test_db();
    let hidden_child = db.cell_by_name("leaf").unwrap();
    let mut policy = HierarchyPolicy::default();
    policy.hidden_cells.insert(hidden_child);

    let result = db.query_cell_view_shapes(CellViewShapeQuery {
        cell_view: CellViewState::top(&db),
        viewport: Rect::new(0, 0, 500, 500),
        min_depth: 0,
        max_depth: 8,
        layer_ids: Vec::new(),
        include_kinds: Vec::new(),
        policy,
    });

    assert!(result.shapes.iter().all(|shape| shape.cell != hidden_child));
}
```

Also add a `nested_test_db()` helper if one is not available in the layoutdb tests.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p layoutdb cell_view_instance_query_returns_object_paths hidden_cells_prune_cell_view_shape_traversal -- --nocapture
```

Expected: fail because instance query and `cell_by_name` do not exist.

- [ ] **Step 3: Implement `cell_by_name` and instance query types**

Add:

```rust
pub fn cell_by_name(&self, name: &str) -> Option<CellId> {
    self.cells
        .iter()
        .position(|cell| cell.name() == name)
        .map(CellId)
}
```

Add `CellViewInstanceQuery`, `CellViewInstanceRecord`, `CellViewInstanceQueryResult` analogous to shape query records.

- [ ] **Step 4: Implement path-aware instance traversal**

Use the same traversal rules as Task 2. For each returned instance, build:

- `InstancePath`
- `ObjectPathTarget::Instance`
- depth
- bbox / array bbox

Hidden child cells must prune traversal and exclude those instances.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test -p layoutdb cell_view_instance_query_returns_object_paths hidden_cells_prune_cell_view_shape_traversal -- --nocapture
```

Expected: pass.

## Task 4: Render Planner CellView Integration

**Files:**
- Modify: `crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing render tests**

Add:

```rust
#[test]
fn planner_cell_view_wrapper_matches_top_cell_default() {
    let db = hierarchy_db();
    let model = one_layer_display_model();
    let viewport = Viewport::new(Rect::new(990, 1990, 1120, 2100), 400.0, 400.0);
    let planner = RenderPlanner::new(RenderSettings::default());
    let mut old_state = LodHysteresisState::default();
    let mut new_state = LodHysteresisState::default();

    let old = planner.plan_with_hysteresis_state(&db, &model, viewport, &mut old_state);
    let new = planner.plan_for_cell_view(
        &db,
        &model,
        viewport,
        &layoutdb::CellViewState::top(&db),
        &layoutdb::HierarchyPolicy::default(),
        &mut new_state,
    );

    assert_eq!(render_plan_item_count(&old), render_plan_item_count(&new));
    assert_eq!(old.source, new.source);
}

#[test]
fn planner_cache_key_changes_with_cell_view_target() {
    let db = hierarchy_db();
    let model = one_layer_display_model();
    let viewport = Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);
    let planner = RenderPlanner::new(RenderSettings::default());
    let top = layoutdb::CellViewState::top(&db);
    let child = db.cell_by_name("leaf").unwrap();
    let focused = layoutdb::CellViewState::from_path(
        db.top_cell(),
        layoutdb::InstancePath::from_elements(vec![layoutdb::InstancePathElement {
            parent_cell: db.top_cell(),
            instance_id: 77,
            source_id: 77,
            child_cell: child,
            array_column: 0,
            array_row: 0,
            bbox: Rect::new(1000, 2000, 1100, 2080),
        }]),
    );

    assert_ne!(
        planner.cache_key_for_cell_view(&model, viewport, RenderPlanSource::HierarchyNear, &top, &layoutdb::HierarchyPolicy::default()),
        planner.cache_key_for_cell_view(&model, viewport, RenderPlanSource::HierarchyNear, &focused, &layoutdb::HierarchyPolicy::default())
    );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p layout-render planner_cell_view_wrapper_matches_top_cell_default planner_cache_key_changes_with_cell_view_target -- --nocapture
```

Expected: fail because APIs do not exist.

- [ ] **Step 3: Add view-aware cache key**

Add public method:

```rust
pub fn cache_key_for_cell_view(
    &self,
    model: &DisplayModel,
    viewport: Viewport,
    source: RenderPlanSource,
    cell_view: &layoutdb::CellViewState,
    policy: &layoutdb::HierarchyPolicy,
) -> RenderCacheKey
```

Hash existing source-aware key plus:

- context cell raw id
- target cell raw id
- each path element fields
- policy min/max depth
- expand arrays
- hidden/selected/ghost cell ids sorted

- [ ] **Step 4: Add `plan_for_cell_view`**

Initial implementation can share most existing logic but must use:

- `db.query_cell_view_instances(...)` for far/mid hierarchy.
- `db.query_cell_view_shapes(...)` for near hierarchy.

Existing `plan_with_hysteresis_state` should call `plan_for_cell_view` with `CellViewState::top(db)` and a default policy to preserve old behavior.

- [ ] **Step 5: Run render tests**

Run:

```bash
cargo test -p layout-render planner_cell_view_wrapper_matches_top_cell_default planner_cache_key_changes_with_cell_view_target -- --nocapture
cargo test -p layout-render -- --nocapture
```

Expected: pass.

## Task 5: Native V2 Hierarchy State and Panel

**Files:**
- Modify: `apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing tests for panel helpers**

Add pure helper tests:

```rust
#[test]
fn hierarchy_summary_names_target_cell() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));
    let child = db.add_cell("leaf", Rect::new(0, 0, 10, 10));
    let view = layoutdb::CellViewState::from_path(
        db.top_cell(),
        layoutdb::InstancePath::from_elements(vec![layoutdb::InstancePathElement {
            parent_cell: db.top_cell(),
            instance_id: 1,
            source_id: 1,
            child_cell: child,
            array_column: 0,
            array_row: 0,
            bbox: Rect::new(0, 0, 10, 10),
        }]),
    );

    let text = hierarchy_summary_text(&db, &view, &layoutdb::HierarchyPolicy::default());

    assert!(text.contains("target=leaf"));
    assert!(text.contains("depth=1"));
}

#[test]
fn hierarchy_policy_from_tuning_uses_depth_control() {
    let mut tuning = LodTuningState::default();
    tuning.hierarchy_expand_depth = 3;

    let policy = hierarchy_policy_from_tuning(tuning);

    assert_eq!(policy.min_depth, 0);
    assert_eq!(policy.max_depth, 3);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p layout-viewer-native-v2 hierarchy_summary_names_target_cell hierarchy_policy_from_tuning_uses_depth_control -- --nocapture
```

Expected: fail because helpers do not exist.

- [ ] **Step 3: Add app state**

Add fields:

```rust
cell_view: layoutdb::CellViewState,
hierarchy_policy: layoutdb::HierarchyPolicy,
```

Initialize after `LayoutSession::from_source`:

```rust
let cell_view = layoutdb::CellViewState::top(session.db());
let hierarchy_policy = layoutdb::HierarchyPolicy::default();
```

- [ ] **Step 4: Pass state into planner**

In `draw_canvas`, replace planning call with `plan_for_cell_view`.
Set `self.hierarchy_policy = hierarchy_policy_from_tuning(self.lod_tuning)` before planning.

- [ ] **Step 5: Add minimal hierarchy panel**

In sidebar, add a collapsing header after LOD:

- summary text from `hierarchy_summary_text`
- `Top` button resets `self.cell_view`
- `Up` button sets `self.cell_view = self.cell_view.ascend()`
- drag value for max depth or reuse existing hierarchy depth control

- [ ] **Step 6: Run native tests**

Run:

```bash
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: pass.

## Task 6: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] **Step 1: Update docs**

Document:

- `CellViewState`
- path-aware recursive queries
- `HierarchyPolicy`
- minimal hierarchy panel
- limitations: no full tree, no ghost/hidden styling yet

- [ ] **Step 2: Run full verification**

Run:

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace -- --nocapture
```

Expected: all pass.

## Self-Review

- Spec coverage: tasks cover data semantics, path-aware traversal, render integration, native panel, docs.
- No placeholders: all tasks include concrete files, commands, and expected outcomes.
- Type consistency: names match the design spec. If implementation needs small signature adjustments, update both tests and docs consistently.
