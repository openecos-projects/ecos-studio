# Layout Viewer V2 Design

## Goal

Rebuild the layout viewer rendering architecture around a clean-room,
KLayout-inspired data and drawing pipeline. The goal is not to copy KLayout
source code or UI, but to adopt the architectural ideas that make large IC
layouts readable: hierarchical data, viewport-local traversal, pixel-budget LOD,
layer display specifications, separated fill/frame/text/marker planes, and
deterministic color composition.

The current native viewer can remain as a reference implementation while V2 is
developed. V2 may discard the existing immediate `draw_records` path and define
new modules, package semantics, and rendering contracts.

## Greenfield Rewrite Boundary

V2 is a fresh implementation, not an incremental rewrite of the current native
viewer. Existing `apps/layout-viewer-native` code should not define V2 module
boundaries, rendering flow, state model, style model, or LOD behavior.

The current codebase may only be used for:

- understanding the current `.layoutpkg` input shape,
- comparing visual behavior before and after V2,
- keeping a temporary package compatibility adapter if needed,
- reusing generic, non-rendering utilities only after an explicit review.

V2 should not depend on the old `draw_records` path, current `lod_style` mapping,
current `VisibilityState`, or current `LayoutViewerApp` render loop. If an old
abstraction conflicts with the V2 data/display/render split, V2 should define a
new abstraction instead.

## License Boundary

KLayout is GPL-licensed. V2 must be implemented as a clean-room design:

- Use KLayout documentation and behavior as conceptual reference.
- Do not copy KLayout source code, algorithms verbatim, tables, palettes, pattern
  definitions, or implementation details into ECOS.
- Define ECOS-native data structures, APIs, tests, and visual defaults.
- Keep notes and source links in this document for architectural traceability.

## Design Principles

- Keep layout data hierarchical for as long as possible.
- Treat display layers as user-facing rendering specifications, not raw database
  layers.
- Build a render plan from the active viewport, display layer tree, hierarchy
  range, and LOD policy before drawing.
- Apply LOD during traversal and batching with pixel thresholds, not only with a
  fixed far/overview/detail switch.
- Separate fill, frame, marker, text, selection, and overlay drawing so dense
  layouts stay readable.
- Make color composition deterministic. Prefer patterns, frame colors, brightness
  shifts, and explicit composition modes over stacking many translucent fills.

## High-Level Architecture

```txt
layout package / imported data
  -> LayoutDb
      -> Cell
          -> per-layer ShapeStore
          -> child InstanceStore
          -> bbox and viewport query indexes
  -> DisplayModel
      -> LayerViewTree
      -> StylePalette
      -> PatternPalette
      -> LineStylePalette
  -> ViewSession
      -> viewport
      -> current cell / context path
      -> hierarchy range
      -> selected display layers
      -> selection and query mode
  -> RenderPlanner
      -> redraw tasks
      -> traversal rules
      -> LOD decisions
      -> draw batches or planes
  -> RenderBackend
      -> CPU/egui prototype backend
      -> future GPU or bitmap-plane backend
```

## Data Model

V2 should introduce a `LayoutDb` abstraction that is independent from the old
flat tile record model.

Core entities:

- `LayoutDb`: owns cells, layer dictionary, properties dictionary, and global
  units.
- `Cell`: owns per-layer shape stores and child instances.
- `ShapeStore`: stores rectangles, polygons, paths, texts, and markers for one
  layer inside one cell.
- `InstanceStore`: stores child cell references, transforms, and array
  repetition metadata.
- `SpatialIndex`: supports viewport-local `touching` and `overlapping` queries
  on shapes and instances.

Initial implementation can import the current package data into a shallow
hierarchical model if true source hierarchy is not yet available. The important
contract is that render code consumes `LayoutDb` and `DisplayModel`, not raw tile
records.

### Implemented V2 Data Path

The current V2 implementation uses a package-backed session rather than a
full-package import in the viewer:

```txt
PackageLayoutSource
  -> LayoutSession
      -> LayoutDb metadata on open
      -> ensure_viewport_loaded(viewport) for detail tiles
```

`LayoutSession::from_source` initializes design metadata and display layers
without decoding detail tile geometry. Close zoom calls
`ensure_viewport_loaded`, which asks `layoutpkg-reader` for only
viewport-intersecting detail tiles and imports only newly seen tile ids into the
top cell. V2 rendering does not switch to overview coverage for normal far-zoom
display; overview coverage remains a package capability for future diagnostics
or explicit debug views.

`LayoutDb` now maintains a per-cell spatial index with per-layer bins. Detail
render planning uses `query_shapes_indexed` so a viewport query checks only
candidate bins before display-layer partitioning.

`LayoutDb::from_layout_package` remains as a compatibility/test helper for the
old full-world import path. `layout-viewer-native-v2` should use
`LayoutSession`, not this helper.

## Display Model

V2 should introduce display layers similar in spirit to KLayout layer views.
A display layer is a rendering rule:

```txt
DisplayLayer {
  id
  name
  source_selector
  visible
  draw_order
  hierarchy_filter
  property_filter
  style
  lod_policy
  pick_policy
}
```

`source_selector` may select by physical layer, object kind, route class, net
class, property tag, or pseudo-layer such as cell frames and selection overlays.

The display layer tree supports groups. Group attributes may be inherited by
children, but effective properties are resolved before rendering so the planner
does not depend on UI tree traversal.

## Color And Composition Model

Color is a first-class part of V2. The old `kind -> rgba` mapping should be
replaced by a display style model:

```txt
LayerStyle {
  fill_color
  frame_color
  text_color
  marker_color
  fill_pattern
  line_style
  line_width_px
  brightness_shift
  composition_mode
  marked
}
```

Key rules:

- Fill color and frame color are separate.
- Frame remains visible even when fill is hollow, patterned, or suppressed.
- Fill pattern is preferred over heavy alpha for dense overlapping layers.
- Brightness shifts are used for hierarchy context, disabled layers, hover
  states, and inactive context. They should preserve hue while moving the color
  toward the background or foreground.
- Text color defaults to frame color unless explicitly overridden.
- Markers and selection highlights are overlay styles, not mutations of base
  layer styles.

Composition modes:

- `Copy`: opaque replacement for crisp current-layer geometry.
- `AdditiveOr`: useful on dark backgrounds and sparse marker planes.
- `SubtractiveAnd`: useful on bright backgrounds for transparent-like display.
- `Alpha`: available for UI overlays, but not the default for normal layout
  layers.
- `MaskPattern`: applies a fill or line pattern before composition.

V2 should define an ECOS-owned default palette. The palette should have high
layer distinguishability, include a set of auto-assignable bright colors, and
support light/dark canvas variants. Do not copy KLayout palette values or
pattern bitmaps.

## Render Planning

Rendering starts by compiling the current session into a render plan.

Inputs:

- Viewport in world units and screen pixels.
- Current cell and context path.
- Active hierarchy range.
- Effective display layer list.
- Layer visibility and draw order.
- LOD thresholds.
- Selection/query state.

Output:

```txt
RenderPlan {
  background_tasks
  layer_tasks
  overlay_tasks
  composition_ops
  cache_key
}
```

Each `LayerTask` carries:

- effective source selector
- hierarchy range
- viewport region
- effective style
- target plane or batch type
- LOD policy

The first backend may draw directly into egui primitives, but it should receive
planned batches instead of reading layout package records directly.

### Implemented V2 Render Planning Slice

The current `layout-render` crate emits:

- fill, frame, and marker batches,
- `RenderQueryStats` with viewport query count and indexed candidate counts,
- `RenderCacheKey` from viewport, screen size, visible display layers, styles,
  and LOD settings,
- `LodDecision` values for exact fill/frame, frame-only, marker, or suppress,
- long-thin geometry preservation so visually meaningful wires degrade to
  frame-only instead of disappearing into markers,
- separate per-screen-bin frame and marker occupancy limits so dense geometry
  does not flood the drawing backend,
- cross-layer low-priority screen quad saturation so repeated geometry stops
  drawing once a screen bin no longer gains visible information,
- context-shape priority so die/core/instance/region frames survive occupancy
  suppression.

Detail planning performs one indexed viewport query, then partitions returned
shapes by visible display layer source selectors. This avoids repeating a DB
scan once per display layer.

## LOD Strategy

LOD is pixel-budget driven and applied during traversal.

Hierarchy LOD:

- Stop recursion at the configured hierarchy depth.
- If a child cell projects below a small-cell threshold, draw cell bbox or a
  marker instead of expanding it.
- Allow current cell, parent context, and child context to use different style
  brightness and hollow/fill policies.

Shape LOD:

- If a shape projects below a marker threshold, draw a pixel-capped marker or
  simplified bbox.
- If a shape is thin but projects as a long visible segment, draw frame-only
  instead of collapsing it into a marker.
- If a polygon/path is too small to inspect, draw bbox/frame instead of exact
  edges.
- If a text label is below readability threshold, skip it or draw a small text
  presence marker.

Array LOD:

- If an instance array cell and pitch both project below threshold, draw array
  bbox or sparse edge instances rather than expanding every member.
- If only array interior is dense, draw border instances and a fill/pattern
  summary for the interior.

Screen Occupancy LOD:

- For far zoom, continue querying viewport detail geometry, but simplify based
  on projected pixel size.
- Use screen-space bins to cap how many tiny frames or markers from a display
  layer can occupy the same visual region.
- Apply separate budgets to frame-only geometry and marker geometry; frames carry
  more directional information than markers and should not share the same cap.
- Apply a global low-priority budget per screen bin across layers. This prevents
  repeated frame/marker candidates from different layers from repainting the
  same saturated visual region.
- If a long-thin or otherwise frame-eligible shape cannot reserve frame budget,
  suppress it rather than collapsing it into a marker. Markers are reserved for
  genuinely tiny geometry.
- Exempt context shapes such as die, core, instances, and regions from occupancy
  caps so orientation and large structure remain visible.
- Coverage summaries may be used later for explicit debug or background
  prefetch decisions, but should not replace the normal display layer model.
- Far zoom should preserve die/core/cell frame orientation and major
  routing/blockage structure through frame-only and marker decisions.

Redraw skipping:

- Track which screen regions or small quads are already represented by simplified
  marks.
- Skip lower-detail work when further traversal cannot improve visible output.

## Rendering Planes

V2 should model separate planes even if the first backend does not physically
use bitmap planes:

- `FillPlane`: layer interiors, possibly patterned.
- `FramePlane`: outlines and paths.
- `MarkerPlane`: vias, tiny shapes, vertices, pins, simplified small geometry.
- `TextPlane`: labels and property text.
- `ContextPlane`: parent/child hierarchy context.
- `OverlayPlane`: selection, hover, measurement, rulers, search results.

Each plane has its own composition operation. This is the core reason dense
layout views stay readable: outlines and markers can remain crisp while fills
are sparse, patterned, or suppressed.

## Caching And Redraw

The render planner should generate cache keys from:

- viewport transform
- visible display layer ids and generations
- hierarchy range
- style palette generation
- LOD settings
- selected overlays that affect base rendering

Recommended cache layers:

- Spatial indexes per cell/layer.
- Resolved display layer list.
- Render plans for stable view state.
- Optional per-cell rendered batches or bitmap planes for repeated instances.
- Background grid and static overlay cache.

Redraw should be layer-task based so visibility/style changes can invalidate a
small part of the rendered scene.

The first implemented cache boundary is the render-plan cache key. The app does
not yet memoize plans, but `RenderPlan::cache_key` provides the stable invalidation
handle needed for that next step.

## Interaction Model

Minimum V2 interactions:

- Pan and zoom with stable cursor-centered zoom.
- Layer display tree with visibility, solo, reorder, color, fill pattern, frame
  style, and hierarchy filters.
- Current cell and context path controls.
- Hierarchy depth control.
- Object selection constrained by visible display layers.
- Selection metadata: display layer, physical layer, object kind, cell path,
  source id, bbox, and properties if available.

Selection should use the same source selectors and hierarchy traversal rules as
rendering, with a pick tolerance expressed in screen pixels.

## Migration Plan

V2 should be developed beside the current native viewer:

```txt
apps/layout-viewer-native-v2/
crates/layoutdb/
crates/layout-display/
crates/layout-render/
```

The old native viewer can remain as a visual comparison tool while V2 is built.
It should not be used as the architectural starting point. Any compatibility with
the existing `.layoutpkg` format should enter through an adapter that produces
the V2 `LayoutDb` model.

The old native viewer can be retired once V2 supports:

- opening current `.layoutpkg` output,
- showing basic layers,
- hierarchy or pseudo-hierarchy traversal,
- pixel-threshold LOD,
- separated fill/frame rendering,
- layer style editing,
- selection against visible geometry.

## First Milestone Acceptance Criteria

The first V2 milestone is complete when a developer can open an existing package
and verify these behaviors:

- Panning and zooming only render viewport-relevant geometry.
- Layer display styles are resolved from display layers, not hard-coded object
  kinds.
- At least three planes are visible in the render path: fill, frame, and marker
  or overlay.
- The V2 render loop does not call the old native viewer rendering modules.
- Dense overlapping layers remain readable without relying primarily on alpha
  stacking.
- Small geometry, small cells, or pseudo-cells are simplified by pixel threshold.
- Selection respects layer visibility and returns display-layer-aware metadata.
- A style change invalidates only the affected display layer tasks.

Current V2 status:

- Package open in `layout-viewer-native-v2` is metadata-only.
- Detail geometry is loaded by viewport through `LayoutSession`.
- Loaded detail geometry is spatially indexed per cell/layer.
- Render planning performs one indexed viewport query per detail plan.
- Far zoom uses screen-space `LodDecision` simplification rather than overview
  coverage density batches.
- Long-thin shapes degrade to frame-only rather than marker-only.
- Dense frame-only and marker geometry are capped by separate per-screen-bin
  occupancy budgets.
- Low-priority frame/marker geometry is also capped by cross-layer screen-bin
  saturation.
- Context shapes are preserved even when local occupancy is high.
- The HUD reports viewport tile count, loaded tile count, cache hits/misses,
  newly loaded shapes, total loaded shapes, indexed candidates, batch count, and
  item count.

## Open Questions

- Should V2 introduce a new `.layoutpkg` format that preserves source hierarchy,
  or should it first build pseudo-hierarchy from current package records?
- Should the first render backend be CPU bitmap planes, egui batches, or a GPU
  batch renderer?
- Which display presets should be built in: light CAD, dark CAD, Innovus-like
  implementation, and debug density?
- How much net/property dictionary data must be in the package for useful
  selection in the first V2 milestone?

## References Studied

- KLayout layer views documentation:
  <https://www.klayout.de/doc/manual/layer_views.html>
- KLayout `db::Cell` hierarchical data model:
  <https://github.com/KLayout/klayout/blob/master/src/db/db/dbCell.h>
- KLayout layer display properties:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layLayerProperties.h>
- KLayout hierarchy level selection:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layParsedLayerSource.h>
- KLayout redraw layer info:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layRedrawLayerInfo.h>
- KLayout renderer plane interface:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layRenderer.h>
- KLayout bitmap composition operations:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layViewOp.h>
- KLayout redraw worker, hierarchy traversal, and LOD-like simplification:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layRedrawThreadWorker.cc>
- KLayout canvas redraw/cache pipeline:
  <https://github.com/KLayout/klayout/blob/master/src/laybasic/laybasic/layLayoutCanvas.h>
