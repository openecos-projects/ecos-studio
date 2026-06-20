# Native Viewer Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add viewport-local object selection to the native layout viewer without reading source View JSON files.

**Architecture:** `layoutpkg-reader` will expose a `query_point` API that reuses detail tile records and shared large objects. `layout-viewer-native` will translate click coordinates into world coordinates, query with a screen-scaled tolerance, draw a selection highlight, and show object metadata in the right-side panel.

**Tech Stack:** Rust workspace, `layoutpkg-reader`, existing binary tile records, `eframe/egui`.

---

### Task 1: Reader Point Query

**Files:**
- Modify: `crates/layoutpkg-reader/src/lib.rs`

- [ ] Add `QueryHit` with `record`, `tile_id`, `source`, and `bbox`.
- [ ] Add `LayoutPackage::query_point(x, y, tolerance, cache_capacity)`.
- [ ] Reuse `load_detail_viewport` internally with a small query rect.
- [ ] Filter to queryable object kinds.
- [ ] Pick the smallest-area hit, then nearest center as tie-breaker.
- [ ] Add tests for local tile hit, miss, and large-object hit.

### Task 2: Viewer Selection State

**Files:**
- Create: `apps/layout-viewer-native/src/selection.rs`
- Modify: `apps/layout-viewer-native/src/main.rs`

- [ ] Add `SelectedObject` and helper formatting for kind/layer/bbox.
- [ ] On primary click, convert screen position to world point and call `query_point`.
- [ ] Respect current layer/kind visibility for what is displayed.
- [ ] Store and draw the selected bbox highlight.

### Task 3: Properties Panel

**Files:**
- Modify: `apps/layout-viewer-native/src/main.rs`
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] Extend the right panel with a `Selection` section.
- [ ] Show kind, layer id/name, source id, bbox, tile id, and source bucket.
- [ ] Document click selection.

### Task 4: Verification

**Files:**
- No code files

- [ ] Run `cargo test --workspace`.
- [ ] Run the real `.layoutpkg` probe command.
- [ ] Run `cargo run -p layout-viewer-native -- --help`.
