# KLayout-Like Hierarchy Semantics Design

## Goal

Implement the missing hierarchy semantics in Layout Viewer V2 so selection, cell navigation, hierarchy browsing, and package detail ownership follow the same core ideas as KLayout: a visible cell is always shown through a cell view context, and a selected object is always identified by an instantiation path plus a shape or instance target.

## KLayout References Studied

- Local source: `/tmp/klayout-src/src/laybasic/laybasic/layCellView.h` and `.cc`
  - `CellView` stores an unspecific cell path, a specific `db::InstElement` path, a context cell, and a target cell.
  - Setting the unspecific path clears the specific path; setting the specific path updates the target cell.
- Local source: `/tmp/klayout-src/src/laybasic/laybasic/layObjectInstPath.h` and `.cc`
  - `ObjectInstPath` is the selection identity. It stores the top cell, cellview index, instantiation path, and either a shape target or an instance target.
- Local source: `/tmp/klayout-src/src/laybasic/laybasic/layFinder.cc`
  - Finder recursion maintains `m_path` while descending. Shape and instance hits both copy this path into `ObjectInstPath`; instances add the selected instance as the last path element.
- Local source: `/tmp/klayout-src/src/laybasic/laybasic/layLayoutViewBase.cc`
  - `select_cell` changes the unspecific path and clears the specific path.
  - `descend` appends an instance path to the current cell view; `ascend` pops it.
- Official docs used for cross-check:
  - `https://www.klayout.de/doc/code/class_CellView.html`
  - `https://www.klayout.de/doc/code/class_ObjectInstPath.html`
  - `https://www.klayout.de/doc/code/class_RecursiveShapeIterator.html`

## Current State

The Rust database already has most of the low-level path primitives:

- `layoutdb::CellViewState` stores `context_cell`, `target_cell`, and `specific_path`.
- `layoutdb::InstancePath` and `ObjectPath` can represent recursive shape and instance identity.
- `query_cell_view_shapes` and `query_cell_view_instances` already return path-aware records.
- The render planner can plan from a `CellViewState`.

The missing parts are above and below this layer:

- `layout-render::PickHit` drops `ObjectPath` and `InstancePath`, so UI selection cannot enter the clicked instance/cell.
- Native UI only has Top/Up and a small hierarchy summary; it does not have a usable instance/cell tree.
- Click-to-enter does not exist.
- Lazy detail tiles are still loaded into the top cell because `LayoutRectRecord` has no cell scope. This is correct for global wires/fill, but not enough for future detail records that are local to child cells.

## Design

### 1. Path-Aware Selection

`PickHit` becomes the Rust equivalent of KLayout's `ObjectInstPath`:

- It keeps the existing display fields: display layer, source id, layer id, kind, bbox.
- It adds:
  - `cell: CellId`
  - `depth: usize`
  - `instance_path: InstancePath`
  - `object_path: ObjectPath`
  - `target: PickHitTarget`

`PickHitTarget` distinguishes shape hits from instance hits:

```rust
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

`pick_for_cell_view` will search both shape records and instance records. It keeps the KLayout behavior where shapes win a slight priority over instances at the same geometric distance, because selecting geometry should not be unexpectedly shadowed by the containing cell bbox.

### 2. Click-To-Enter

Entering uses the selected hit's path:

- Shape hit with non-empty `instance_path`: focus the shape's owning cell through that path.
- Instance hit: focus the selected instance's child cell through the instance target path.
- Top-level shape with empty path: cannot enter.

Native UI adds an `Enter` action near the selection panel and hierarchy panel. Enter sets:

```rust
self.cell_view = CellViewState::from_path(self.cell_view.context_cell(), enter_path);
```

After changing cell view:

- clear selected object
- clear render history and cache reuse state
- fit the viewport to the new target cell bbox when available

This mirrors KLayout's `descend` concept without implementing unspecific path switching yet.

### 3. Hierarchy Browser

Add a compact instance tree panel:

- root row is the current context cell
- child rows are concrete instances, not just cell definitions
- each row carries an `InstancePath`, target `CellId`, depth, instance id/name, child cell name, array member, and child counts
- clicking a row focuses that exact path
- cap rows by default to avoid UI stalls on large layouts

The first version is an always-expanded, capped tree because it is predictable and cheap. It is still semantically correct because every row is path-based, not merely cell-name-based.

### 4. Detail Data Ownership Upgrade

Existing format:

```rust
pub struct LayoutRectRecord {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub flags: u8,
    pub source_id: u32,
}
```

This is intentionally flat and has no cell ownership. Therefore the loader can only place lazy detail into the top cell today. That is the source of the remaining child-cell detail gap.

The compatible upgrade is:

- keep binary detail tile v1 readable
- introduce optional v2 detail ownership metadata at the package level:

```rust
pub struct DetailRecordScope {
    pub source_id: u32,
    pub cell_id: u32,
    pub coordinates: DetailCoordinates,
}

pub enum DetailCoordinates {
    Top,
    CellLocal,
}
```

Loader behavior:

- if a detail record has no scope, load it into top cell as today
- if scope says `CellLocal`, map package cell id to `LayoutDb::CellId` and load into that cell unchanged
- if scope says `Top`, load into top cell
- if scope references an unknown cell, fall back to top cell and report a stat counter

Packer behavior:

- master cell pin/local shapes already go into `HierarchyCell.shapes`
- future local detail sources can emit scope metadata keyed by `source_id`
- current global sources remain top-scoped

This preserves old `.layoutpkg` compatibility while making the data model explicit enough for true child-cell detail.

## Non-Goals

- No color editor or layer style authoring in this pass.
- No full KLayout negative/context levels beyond the current `specific_path` model.
- No GPU plane rewrite in this pass.
- No inference of child-cell ownership from flat global rectangles. If source data does not declare ownership, the viewer must not guess.

## Tests

Coverage must include:

- path-aware shape pick exposes `object_path` and `instance_path`
- instance pick returns `PickHitTarget::Instance`
- `enter_path_for_hit` enters shape-owned child cells and selected instances
- hierarchy tree rows are path-based and capped
- scoped detail records load into child cells while legacy records load into top
- old package/detail format tests remain green

## Acceptance Criteria

- A click on a child shape or instance bbox can be inspected as a full path.
- The viewer can enter the selected occurrence and return with Up/Top.
- The hierarchy panel can focus a concrete child occurrence.
- Detail loading has an explicit, backward-compatible cell-scope path.
- `cargo fmt --all -- --check`, `cargo check --workspace`, and `cargo test --workspace -- --nocapture` pass under `ecos/layout-viewer`.
