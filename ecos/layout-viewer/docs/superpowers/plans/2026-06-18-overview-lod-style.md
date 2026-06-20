# Overview LOD Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native viewer overview mode read visually like a chip layout instead of saturated coverage blocks.

**Architecture:** Keep the existing overview coverage tile data, but render it with a separate overview style and drawing path. Detail mode still draws full rectangles; overview mode draws low-alpha density, outlines for die/core, and pixel-capped markers for vias/pins.

**Tech Stack:** Rust, `eframe/egui`, existing `.layoutpkg` overview tiles.

---

### Task 1: Overview Style Model

**Files:**
- Create: `apps/layout-viewer-native/src/lod_style.rs`

- [ ] Add `DrawPrimitiveKind` for `Fill`, `Stroke`, and `Marker`.
- [ ] Add `draw_style_for_mode(kind, mode)` returning separate overview/detail styles.
- [ ] Test that overview die/core are strokes, routing is low-alpha fill, and detail keeps stronger fills.

### Task 2: Overview Drawing Path

**Files:**
- Modify: `apps/layout-viewer-native/src/main.rs`

- [ ] Replace `draw_records` in overview mode with `draw_overview_records`.
- [ ] Draw records in a deterministic chip-like order: die/core, rows, density wires, vias/pins.
- [ ] Limit overview marker sizes and reduce coverage-bin alpha.

### Task 3: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/native-layout-viewer-split.md`

- [ ] Document overview as density/outline LOD rather than real detail geometry.
- [ ] Run `cargo test --workspace`.
- [ ] Run real package probe.
- [ ] Run native viewer help build.
