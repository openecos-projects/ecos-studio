# Native Viewer Visibility And Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add kind/layer visibility controls and render parameterized track/gcell overlays in the standalone native layout viewer.

**Architecture:** `layoutpkg-reader` will expose typed dictionary data from `dictionaries/layers.json` and `dictionaries/grid_overlays.json`. `layout-viewer-native` will keep a small visibility state, filter decoded records during drawing, show a right-side control panel, and draw tracks/gcell lines directly from overlay parameters without expanding them into package records.

**Tech Stack:** Rust workspace, `serde`, `layoutpkg-reader`, `eframe/egui`, existing binary tile format.

---

### Task 1: Reader Dictionary API

**Files:**
- Modify: `crates/layoutpkg-reader/src/lib.rs`

- [ ] Add typed structs for layers, tracks, gcell grids, and grid overlays.
- [ ] Add `LayoutPackage::layers()` and `LayoutPackage::grid_overlays()` APIs.
- [ ] Test that fixture dictionaries are parsed and exposed.

### Task 2: Viewer Visibility State

**Files:**
- Create: `apps/layout-viewer-native/src/visibility.rs`
- Modify: `apps/layout-viewer-native/src/main.rs`

- [ ] Add `VisibilityState` with default-enabled kinds and layers.
- [ ] Add tests for kind/layer filtering.
- [ ] Filter detail, overview, and large-object records before drawing.

### Task 3: Viewer Sidebar And Parametric Overlays

**Files:**
- Modify: `apps/layout-viewer-native/src/main.rs`

- [ ] Add a right-side `Layers`, `Kinds`, and `Overlays` panel.
- [ ] Draw tracks and gcell grids from `GridOverlaySet`.
- [ ] Only draw track overlays when their layer is visible.
- [ ] Avoid drawing ultra-dense overlays when projected spacing is below a pixel threshold.

### Task 4: Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] Document viewer controls.
- [ ] Run `cargo test --workspace`.
- [ ] Run `cargo run -p layoutpkg-probe -- <real .layoutpkg> --viewport ...`.
- [ ] Run `cargo run -p layout-viewer-native -- --help`.
