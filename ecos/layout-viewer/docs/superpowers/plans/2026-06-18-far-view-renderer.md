# Far View Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated far-view rendering layer so zoomed-out layout views show chip structure instead of only density blocks.

**Architecture:** The reader exposes shared large objects directly. The native viewer adds a third display mode, `FarView`, above `OverviewDensity` and `Detail`. FarView uses dark background, die/core outline, weak overlays, and lightly styled large-object/routing density.

**Tech Stack:** Rust, `layoutpkg-reader`, `eframe/egui`, existing `.layoutpkg` records.

---

### Task 1: Reader Large Object API

**Files:**
- Modify: `crates/layoutpkg-reader/src/lib.rs`

- [ ] Add `LayoutPackage::load_large_objects_only()`.
- [ ] Test that it returns shared objects and caches them.

### Task 2: Far View Mode And Style

**Files:**
- Modify: `apps/layout-viewer-native/src/lod_style.rs`
- Modify: `apps/layout-viewer-native/src/main.rs`

- [ ] Add `LodMode::FarView`.
- [ ] Add a display-mode classifier: far / overview / detail.
- [ ] Add tests for mode thresholds.
- [ ] Render FarView with dark background, die/core outlines, weak density, and small markers.

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] Document far-view behavior and thresholds.
- [ ] Run `cargo test --workspace`.
- [ ] Run real package probe.
- [ ] Run native viewer help build.
