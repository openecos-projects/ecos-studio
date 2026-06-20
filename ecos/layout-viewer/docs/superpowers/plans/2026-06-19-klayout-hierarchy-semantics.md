# KLayout-Like Hierarchy Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add path-aware selection, click-to-enter, a path-based hierarchy browser, and backward-compatible detail ownership metadata to Layout Viewer V2.

**Architecture:** Follow KLayout's split between `CellView` and `ObjectInstPath`: `CellViewState` controls what is displayed, while `PickHit`/`ObjectPath` controls what is selected. Package detail remains compatible with old flat tiles, with optional ownership metadata for future cell-local detail.

**Tech Stack:** Rust workspace under `ecos/layout-viewer`, `layoutdb`, `layout-render`, `layoutpkg-format`, `layoutpkg-packer`, `eframe/egui` native app, existing rstar indexes.

---

## File Structure

- Modify `crates/layoutdb/src/lib.rs`
  - expose cell bbox/name helpers
  - add path row data helpers for hierarchy browser
  - add scoped detail ownership metadata storage/load plumbing
- Modify `crates/layout-render/src/lib.rs`
  - extend `PickHit`
  - add `PickHitTarget`
  - pick both shapes and instances with path-aware ranking
- Modify `apps/layout-viewer-native-v2/src/main.rs`
  - add selection path display
  - add Enter action
  - add capped path-based hierarchy tree
  - reset/focus viewport after cell navigation
- Modify `crates/layoutpkg-format/src/lib.rs`
  - add serializable detail ownership metadata types
  - keep existing binary detail tile v1 unchanged
- Modify `crates/layoutpkg-packer/src/lib.rs`
  - emit top-scope metadata for current flat detail sources
  - keep hierarchy cell pin/local shapes as `HierarchyCell.shapes`
- Modify docs
  - update `README.md` and `docs/native-layout-viewer-split.md` with the new hierarchy semantics.

---

### Task 1: LayoutDB Hierarchy Helpers

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing tests**

Add tests in the existing `#[cfg(test)]` module:

```rust
#[test]
fn cell_bbox_accessor_returns_hierarchy_bbox() {
    let (db, _leaf_view) = hierarchy_test_db_and_leaf_view();
    let top = db.cell(db.top_cell()).unwrap();
    assert_eq!(top.bbox(), Rect::new(0, 0, 1_000, 1_000));
}

#[test]
fn hierarchy_tree_rows_are_instance_path_based_and_capped() {
    let (db, _leaf_view) = hierarchy_test_db_and_leaf_view();
    let rows = db.hierarchy_tree_rows(CellViewState::top(&db), 8, 2);
    assert_eq!(rows.len(), 2);
    assert!(rows[0].instance_path.is_empty());
    assert_eq!(rows[1].depth, 1);
    assert_eq!(rows[1].instance_path.depth(), 1);
    assert!(rows.truncated);
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutdb cell_bbox_accessor_returns_hierarchy_bbox hierarchy_tree_rows_are_instance_path_based_and_capped -- --nocapture
```

Expected: compile failure because `Cell::bbox`, `hierarchy_tree_rows`, and the row return type do not exist.

- [ ] **Step 3: Implement minimal helpers**

Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyTreeRow {
    pub depth: usize,
    pub cell: CellId,
    pub parent_cell: Option<CellId>,
    pub instance_id: Option<u32>,
    pub source_id: Option<u32>,
    pub name: String,
    pub cell_name: String,
    pub bbox: Rect,
    pub instance_path: InstancePath,
    pub child_instance_count: usize,
    pub shape_count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HierarchyTreeRows {
    pub rows: Vec<HierarchyTreeRow>,
    pub truncated: bool,
}
```

Implement `Cell::bbox()` by returning the spatial index bounds or a stored bbox. If the bbox is not currently stored, add `bbox: Rect` to `Cell` and initialize it in `Cell::new`.

Implement:

```rust
pub fn hierarchy_tree_rows(
    &self,
    cell_view: CellViewState,
    max_depth: usize,
    max_rows: usize,
) -> HierarchyTreeRows
```

It should start with `cell_view.target_cell()`, recursively append concrete instance rows, carry `InstancePath`, and stop once `max_rows` is reached.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutdb hierarchy_tree_rows -- --nocapture
```

Expected: new hierarchy helper tests pass.

---

### Task 2: Path-Aware Picking

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing tests**

Add render tests:

```rust
#[test]
fn pick_for_cell_view_returns_shape_object_path() {
    let (db, model, view) = hierarchy_render_test_model();
    let hit = RenderPlanner::new(RenderSettings::default())
        .pick_for_cell_view(
            &db,
            &model,
            PickRequest::new(115, 115, 4),
            &view,
            &HierarchyPolicy::default(),
        )
        .expect("shape hit");
    assert!(matches!(hit.target, PickHitTarget::Shape));
    assert_eq!(hit.instance_path.depth(), 1);
    assert_eq!(hit.object_path.instance_path.depth(), 1);
}

#[test]
fn pick_for_cell_view_can_return_instance_target() {
    let (db, model, top_view) = hierarchy_render_test_top_model();
    let hit = RenderPlanner::new(RenderSettings::default())
        .pick_for_cell_view(
            &db,
            &model,
            PickRequest::new(100, 100, 4),
            &top_view,
            &HierarchyPolicy::default(),
        )
        .expect("instance hit");
    assert!(matches!(hit.target, PickHitTarget::Instance { .. }));
    assert_eq!(hit.instance_path.depth(), 1);
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render pick_for_cell_view_returns_shape_object_path pick_for_cell_view_can_return_instance_target -- --nocapture
```

Expected: compile failure because `PickHitTarget` and path fields do not exist.

- [ ] **Step 3: Implement path-aware `PickHit`**

Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PickHitTarget {
    Shape,
    Instance {
        parent_cell: CellId,
        child_cell: CellId,
        instance_id: u32,
        array_column: u32,
        array_row: u32,
    },
}
```

Extend `PickHit` with `cell`, `depth`, `instance_path`, `object_path`, and `target`.

Update shape candidates to copy fields from `CellViewShapeRecord`.

Query instance candidates with `db.query_cell_view_instances` over the pick rect. Add a small ranking penalty so shape hits beat instance hits at equal distance.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render pick_for_cell_view -- --nocapture
```

Expected: all pick tests pass.

---

### Task 3: Native Click-To-Enter and Selection Display

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing helper tests**

Add tests:

```rust
#[test]
fn enter_path_for_shape_hit_uses_shape_instance_path() {
    let (_db, leaf_view) = hierarchy_test_db_and_leaf_view();
    let hit = test_shape_pick_hit_from_view(&leaf_view);
    let enter = enter_path_for_hit(&hit).expect("enter path");
    assert_eq!(enter.depth(), 1);
}

#[test]
fn selection_summary_includes_target_and_path_depth() {
    let (_db, leaf_view) = hierarchy_test_db_and_leaf_view();
    let hit = test_shape_pick_hit_from_view(&leaf_view);
    let summary = selection_summary_text(&hit);
    assert!(summary.contains("shape"));
    assert!(summary.contains("depth=1"));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 enter_path_for_shape_hit_uses_shape_instance_path selection_summary_includes_target_and_path_depth -- --nocapture
```

Expected: compile failure because helper functions are missing.

- [ ] **Step 3: Implement helpers and UI**

Implement:

```rust
fn enter_path_for_hit(hit: &PickHit) -> Option<InstancePath>
fn selection_summary_text(hit: &PickHit) -> String
fn focus_view_on_cell_bbox(view: &mut Option<V2ViewState>, db: &LayoutDb, cell_view: &CellViewState)
```

Add an `Enter` button in the selection panel and hierarchy panel. On enter:

```rust
if let Some(path) = self.selected.as_ref().and_then(enter_path_for_hit) {
    self.cell_view = CellViewState::from_path(self.cell_view.context_cell(), path);
    self.selected = None;
    focus_view_on_cell_bbox(&mut self.view, self.session.db(), &self.cell_view);
    self.clear_render_history();
}
```

Show path depth, target type, cell id/name, source id, layer, bbox, and instance array coordinates in the selection panel.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 selection -- --nocapture
```

Expected: native selection helper tests pass.

---

### Task 4: Native Hierarchy Browser

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`
- Uses API from: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing tests**

Add tests:

```rust
#[test]
fn hierarchy_row_label_includes_instance_and_cell_name() {
    let (db, _leaf_view) = hierarchy_test_db_and_leaf_view();
    let rows = db.hierarchy_tree_rows(CellViewState::top(&db), 4, 32);
    let label = hierarchy_row_label(&db, &rows.rows[1]);
    assert!(label.contains("mid"));
    assert!(label.contains("u_mid"));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 hierarchy_row_label_includes_instance_and_cell_name -- --nocapture
```

Expected: compile failure because `hierarchy_row_label` is missing.

- [ ] **Step 3: Implement panel rows**

In `draw_hierarchy_panel`, below Top/Up/Enter:

- call `db.hierarchy_tree_rows(self.cell_view.clone(), 8, 512)`
- render rows in `egui::ScrollArea::vertical().max_height(220.0)`
- indent by `row.depth * 12`
- add a small `Focus` button for each row
- on focus, set `self.cell_view = CellViewState::from_path(self.cell_view.context_cell(), row.instance_path.clone())`
- show a truncated message when `rows.truncated` is true

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 hierarchy -- --nocapture
```

Expected: hierarchy UI helper tests pass.

---

### Task 5: Detail Ownership Metadata

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutpkg-format/src/lib.rs`
- Modify: `ecos/layout-viewer/crates/layoutpkg-packer/src/lib.rs`
- Modify: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing format tests**

Add tests in `layoutpkg-format`:

```rust
#[test]
fn detail_scope_manifest_round_trips() {
    let scopes = DetailScopeDocument {
        schema: "ecos-layout-detail-scope".to_string(),
        version: 1,
        records: vec![DetailRecordScope {
            source_id: 7,
            cell_id: 3,
            coordinates: DetailCoordinates::CellLocal,
        }],
    };
    let encoded = serde_json::to_string(&scopes).unwrap();
    let decoded: DetailScopeDocument = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded.records[0].cell_id, 3);
    assert_eq!(decoded.records[0].coordinates, DetailCoordinates::CellLocal);
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-format detail_scope_manifest_round_trips -- --nocapture
```

Expected: compile failure because scope types do not exist.

- [ ] **Step 3: Implement format types**

Add serializable types:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetailScopeDocument {
    pub schema: String,
    pub version: u32,
    pub records: Vec<DetailRecordScope>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetailRecordScope {
    pub source_id: u32,
    pub cell_id: u32,
    pub coordinates: DetailCoordinates,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailCoordinates {
    Top,
    CellLocal,
}
```

Keep binary detail tile v1 unchanged.

- [ ] **Step 4: Add loader behavior tests**

In `layoutdb`, add a unit test building a DB from hierarchy, then applying a viewport batch with one record scoped to a child cell and one legacy record. Assert child cell shape count increases for scoped record and top cell shape count increases for legacy record.

- [ ] **Step 5: Implement loader plumbing**

Add `detail_scopes_by_source_id: HashMap<u32, DetailRecordScope>` or equivalent to `LayoutSession`. Update `apply_viewport_batch` to resolve destination cell:

- no scope: top cell
- `Top`: top cell
- `CellLocal`: mapped hierarchy cell id, falling back to top if unknown

Expose stats for scoped/fallback counts if convenient.

- [ ] **Step 6: Update packer emission**

Emit a JSON scope sidecar for current known flat sources with `coordinates: "top"`. Do not guess cell-local ownership for global wires.

- [ ] **Step 7: Run package tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-format -- --nocapture
cargo test -p layoutpkg-packer -- --nocapture
cargo test -p layoutdb detail_scope -- --nocapture
```

Expected: all pass.

---

### Task 6: Docs and Full Verification

**Files:**
- Modify: `ecos/layout-viewer/README.md`
- Modify: `ecos/layout-viewer/docs/native-layout-viewer-split.md`

- [ ] **Step 1: Update docs**

Document:

- selection now uses object paths
- Enter/Up/Top behavior
- hierarchy browser is path-based and capped
- detail records without scope remain top-cell records
- scoped detail records are the required path for future full child-cell local detail

- [ ] **Step 2: Run full workspace verification**

Run:

```bash
cd ecos/layout-viewer
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace -- --nocapture
```

Expected: all commands pass.

---

## Subagent Split

- Worker A: `layoutdb` hierarchy helpers and detail scope loader plumbing.
- Worker B: `layout-render` path-aware picking.
- Worker C: native app Enter/selection/hierarchy panel.
- Main agent: plan integration, docs, package format/packer review, final verification.

Workers must not revert unrelated changes. This repository may have user changes and generated package data.
