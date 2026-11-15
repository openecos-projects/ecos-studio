# Change-driven Replay presentation

Approved on 2026-11-15. This replaces execution-time-proportional playback.

The ECC capture contract stays unchanged. A native presentation planner reads
each recording's diffs in sequence and creates lightweight display clips. It
uses one working scene, not a retained scene for every frame. Original elapsed
timestamps remain available in the inspector and tooltips.

- Identical geometry and unchanged metrics consume no display time. Phase and
  subflow boundaries remain short, seekable events. Missing recordings remain
  visible as brief unavailable steps, without invented frames.
- Compatible optimizer samples use interpolated movement. Consecutive movement
  runs receive a bounded display budget; intermediate samples remain in the
  mapping. Structural changes and phase boundaries are never blended as motion.
- Geometry generation is staged by type/layer and spatial order. Deleted or
  replaced objects fade at their previous positions. Final committed geometry
  gets its own transition before the result becomes visible.
- The single bottom timeline, small subflow circles and large completion circles
  use display durations. Completion inspection selects the exact final result.
  Dragging uses the same clip evaluation as playback, including interpolation.
- Results get two seconds, followed by two seconds for each Place heatmap. CTS
  analysis appears in the right sidebar only after completion.
- One playback clock drives clip progress, result holds and maps. Speed applies
  to all of them. Pause preserves the current display state. Capture data is
  never mutated by interpolation or presentation timing.
- Preparation runs off the UI thread; failed/corrupt recordings are reported per
  step. Playback checks attempt identity so a rerun cannot reuse a stale plan.

Implementation order: add frame-index restoration and a presentation planner;
integrate deterministic clip sampling and the timeline; preserve pause and final
transitions; add regressions; run Rust workspace checks, build/install Native.

Validation must cover long idle gaps, repeated checkpoints, final-frame changes,
equal timestamps, deletion/replacement, movement phase boundaries, random seek,
pause/resume, speed-controlled results/maps, and stale recording rejection.

Validation completed with `cargo fmt --all -- --check`, `cargo test --workspace`
(453 passed), `cargo build --release -p chip-viewer-native` and
`cargo build -p chip-viewer-native`. Native Xvfb checks used existing isolated GCD
captures for preFloorplan, postFloorplan and Place, including paused image
comparison, final-state selection and heatmap seeking. No EDA rerun was needed.
Full product packaging (`make build`), full-flow E2E and large-chip performance
testing were not run for this Native-only playback change.

## Completion sidebar update

Place uses a scrollable map list in the right sidebar. The active map is selected
in that list, including during automatic playback. Clicking a map pauses playback
so the chosen map stays visible. The current step checklist has a separate bottom
region; only blocked items are red, all other recorded item states are green.
Labels retain the producer state (including warning or unavailable).

Completed steps with their own clock-tree snapshots embed the existing Native
hierarchical graph in the right sidebar, with the same layout, expand/collapse,
search, zoom and pan controls. Current producers emit postFloorplan, CTS and filler
snapshots. postFloorplan defaults to level; CTS and post-route filler default to
delay when timing exists, otherwise level with an unavailable-timing indication.
No earlier or later step's tree is substituted. Older Replay captures can use the
same step's geometry manifest only when its modification time lies between the
capture start and Replay publication. This avoids requiring an EDA rerun merely
to connect existing analysis data.

Sidebar validation: Rust workspace tests (458 passed), formatting and release/dev
builds passed. Native window checks covered real GCD postFloorplan/Place captures
and a labeled UI harness using existing AES CTS/filler clock-tree snapshots.
No new EDA execution or full product packaging was performed.
