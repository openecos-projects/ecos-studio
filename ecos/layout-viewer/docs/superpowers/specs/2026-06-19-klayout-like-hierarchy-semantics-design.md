# KLayout-Like Hierarchy Semantics Design

## Purpose

This document defines the next V2 hierarchy milestone for ECOS Layout Viewer. The goal is to move from "hierarchy-aware rendering queries" to a KLayout-like display model where the current view is a cell view plus an instance path, recursive traversal preserves object identity, and rendering policy can decide how far into hierarchy to expand.

This is not a full clone of KLayout. It is a focused foundation that keeps the current `.layoutpkg` and `layoutdb` architecture but introduces the missing semantic objects needed for later KLayout-level interactions.

## KLayout References Studied

Official API documentation:

- `RecursiveShapeIterator`: region-aware recursive shape iteration, `min_depth`, `max_depth`, current cell, current transform, layer selection, and instance path delivery.
  URL: `https://www.klayout.de/doc/code/class_RecursiveShapeIterator.html`
- `RecursiveInstanceIterator`: recursive instance traversal, target cells, cell selection/exclusion, `min_depth`, `max_depth`, current transform, current depth, and path.
  URL: `https://www.klayout.de/doc/code/class_RecursiveInstanceIterator.html`
- `CellView`: viewer-facing context model that points at a target cell inside a layout and stores both an unspecific cell path and a specific instance path.
  URL: `https://www.klayout.de/doc/code/class_CellView.html`
- `CellInstArray`: instance arrays as first-class objects rather than flattened repeated instances.
  URL: `https://www.klayout.de/doc/code/class_CellInstArray.html`

Source files inspected from `/tmp/klayout-src`:

- `src/db/db/dbRecursiveShapeIterator.h`
- `src/db/db/dbRecursiveInstanceIterator.h`
- `src/db/db/dbCellInst.h`
- `src/laybasic/laybasic/layCellView.h`
- `src/laybasic/laybasic/layRedrawThreadWorker.cc`

The important KLayout ideas for our implementation are:

- A layout stores cells, shapes, and `CellInstArray` objects. The viewer does not flatten by default.
- A `CellView` is the displayed context: context cell, target cell, and specific instance path.
- Recursive iterators carry depth, transform, cell, layer, and path information.
- Traversal is region-constrained using cell/instance bounding boxes.
- Arrays are iterated only as needed and can be simplified when they are visually too small.
- Display is policy-driven: hierarchy min/max levels, hidden cells, ghost cells, small-cell dropping, and cell variant caching are separate from raw geometry.

## Current ECOS V2 State

Already present:

- `LayoutDb` has `Cell`, `CellInstance`, `CellArray`, `ShapeRecord`, `HierarchyShapeRecord`, and `HierarchyInstanceRecord`.
- Instances and compact arrays have spatial indexes.
- Render planner has far/mid/near hierarchy LOD and adaptive far coalescing.
- Native V2 has an LOD panel and render stats.

Missing semantic layer:

- There is no `CellViewState`; rendering always starts at `top_cell()`.
- Recursive query results do not carry a stable instance path.
- Selection/picking cannot identify a unique occurrence of a repeated cell shape.
- There is no stable `ObjectPath` for properties, highlighting, cache keys, or "enter cell".
- Hierarchy display settings are mixed into LOD settings instead of represented as a policy.
- UI cannot descend into an instance, ascend back to parent, or render a selected cell in context.

## Target Model

### Cell View State

Add a `CellViewState` to `layoutdb`.

It represents the displayed cell context:

- `context_cell`: the cell whose coordinate system defines the view.
- `target_cell`: the cell selected for focus.
- `specific_path`: ordered instance elements from context to target.
- `context_transform`: accumulated transform from target-local coordinates into context coordinates.

For the first implementation, the default view is:

- `context_cell = top_cell`
- `target_cell = top_cell`
- `specific_path = []`
- `context_transform = identity`

### Instance Path

Add stable path objects:

- `InstancePathElement`
  - parent cell
  - instance id
  - source id
  - child cell
  - array column
  - array row
  - element bbox
- `InstancePath`
  - ordered elements
  - helper methods: `depth`, `is_empty`, `target_cell`

### Object Path

Add object identity objects:

- `ShapeId`
  - cell id
  - shape index
  - source id
- `ObjectPath`
  - instance path
  - object kind: shape or instance
  - stable enough for selection and rendering cache keys

This is the replacement for identifying an object only by `source_id`.

### Hierarchy Policy

Add a policy object shared by db queries and render:

- `min_depth`
- `max_depth`
- `expand_arrays`
- `selected_cells`
- `hidden_cells`
- `ghost_cells`

First implementation requirements:

- `min_depth` and `max_depth` must work.
- `expand_arrays` must preserve current behavior.
- `hidden_cells` must prune traversal.
- `selected_cells` and `ghost_cells` can be represented but may initially be pass-through in rendering.

### Path-Aware Recursive Queries

Add new query APIs instead of breaking existing ones:

- `query_cell_view_shapes(CellViewQuery) -> CellViewShapeQueryResult`
- `query_cell_view_instances(CellViewInstanceQuery) -> CellViewInstanceQueryResult`

Each returned shape/instance includes:

- world/context bbox
- original cell id
- layer/kind/source id
- `InstancePath`
- `ObjectPath`
- current depth

Legacy query methods remain and internally can be migrated later.

### Render Integration

Render planner gets a view-aware API:

- `plan_for_cell_view(db, model, viewport, cell_view, hierarchy_policy, hysteresis)`

The existing `plan` and `plan_with_hysteresis_state` stay as top-cell wrappers.

Near LOD should use `query_cell_view_shapes`.
Far and mid LOD should use `query_cell_view_instances`.
Cache keys must include cell view and hierarchy policy.

### Native V2 UI

Add minimal hierarchy panel controls:

- Show current context/target cell.
- `Top` resets to top cell.
- `Up` ascends one path element.
- `Depth min` and `Depth max` numeric controls.
- Optional: selected instance can become target cell if a selected hit has an instance path.

This first panel does not need a full tree widget yet. It only exposes enough state to verify that rendering no longer assumes top cell.

## Scope

In scope:

- Data structures for path identity and cell view state.
- Path-aware recursive shape and instance queries.
- Render planner view-aware wrappers.
- Native V2 state and panel controls for current cell view and hierarchy depth.
- Tests for transform/path/depth/cell-view behavior.

Out of scope for this milestone:

- Full KLayout hidden/ghost visual styling.
- Full tree browser with search.
- Editing cells or modifying hierarchy.
- Complete polygon/path/text geometry rendering.
- GPU-backed plane composition.

## Acceptance Criteria

- Existing tests continue passing.
- New layoutdb tests prove:
  - Default `CellViewState` behaves like top-cell traversal.
  - Path-aware recursive shapes include an instance path and object path.
  - A cell view focused on a child cell starts traversal at that child.
  - `min_depth` and `max_depth` are respected.
  - Hidden cells prune traversal.
- New layout-render tests prove:
  - Top-cell wrappers keep existing behavior.
  - View-aware planning uses `CellViewState`.
  - Cache key changes when cell view or hierarchy policy changes.
- New native-v2 tests prove:
  - Hierarchy panel rows show the current target cell.
  - Depth controls map to `HierarchyPolicy`.
  - Reset-to-top returns to default `CellViewState`.

## Future Work

After this foundation:

- Add full cell tree panel and click-to-enter selected instance.
- Add ghost/hidden cell styling and UI.
- Add context rendering above target cell using negative hierarchy levels like KLayout.
- Build real per-cell render templates keyed by cell id, layer mask, style, and policy.
- Add path-based picking/highlighting and object properties panel.
