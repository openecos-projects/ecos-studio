# Chip Viewer Render And View Design

## Goal

Make Chip Viewer render generated ECC geometry snapshots as a recognizable
physical layout on first open. Its visual language and view controls will
follow `ecos/layout-viewer`: a dark canvas, distinct technology-layer colors,
low-opacity fills, frames, patterns, and a right-side visibility panel.

The route snapshot at
`/nfs/home/huangzengrong/test/project_gcd1/ws_0001/route_ecc/output/geometry/geometry.manifest`
is the acceptance fixture. It is valid and contains 25,378 shapes. The current
viewer reads it but renders 260 LOD-2 aggregate tiles as overlapping opaque
rectangles, which hides the actual layout.

## Scope

This change is limited to the native `ecos/chip-viewer` Rust workspace and its
packaged desktop binary. Geometry snapshot schema, ECC flow output, Chip Viewer
launch IPC, edit protocol, and Layout Viewer remain unchanged.

## Architecture

### Display Style

Extend `chip-display` from one RGBA value per layer to a style model equivalent
to the useful subset of `layout-display`:

- fill, frame, selection, and text colors;
- fill and frame alpha values;
- `Hollow`, `Solid`, `SparseDots`, `DenseDots`, `DiagonalHatch`, and
  `CrossHatch` patterns;
- layer-role inference from the snapshot layer name.

The role mapping will match Layout Viewer conventions: overlap and boundary
layers are hollow; routing metals alternate diagonal and cross hatch styles;
top metals and RDL use stronger frames; vias use dotted marks; and unknown
layers use a deterministic fallback palette. The implementation stays local to
Chip Viewer rather than creating a dependency between the two independent Rust
workspaces.

### Detail And Overview Rendering

The default fitted view will use indexed, per-shape rendering. It must not use
aggregate view tiles at the default zoom. This gives the user recognizable
instances, wires, vias, and boundaries immediately after opening a step.

Rendering uses the existing layer index and cached viewport query. Shapes with
small screen rectangles use a low-opacity fill or thin line; patterns are used
only for sufficiently large screen rectangles, with bounded pattern operations.
This keeps the visual result readable without replaying excessive hatch lines.

View tiles remain an overview optimization only for sufficiently far zoom.
Their alpha is capped and derived from tile occupancy so they provide density
context rather than masking the entire canvas. Selecting, searching, editing,
or zooming in uses precise shape rendering.

### View UI

Move Chip Viewer controls to a resizable right-side panel styled after Layout
Viewer. It contains:

- snapshot metadata and diagnostics;
- search, selection, reload, fit, and existing edit controls;
- layer rows with style swatches, visibility checkboxes, and shape counts;
- object visibility toggles for Instances, PDN, Net, and IO Pin.

The dark canvas remains the main surface. Draw die/core boundaries as hollow
frames and retain selected/search-highlight overlays above detail and overview
content. Existing Chip Viewer behaviors remain available; this is a visual and
visibility-control evolution, not a replacement of its workflow.

### Object Visibility

Map snapshot owner types to the four Layout Viewer-style controls:

- `InstanceBBox` and `InstanceHalo` -> Instances;
- `SpecialWireSegment` -> PDN;
- `NetWireSegment` -> Net;
- `PinPortShape` -> IO Pin.

Other geometry, such as die/core, blockages, rows, grids, fills, and vias,
stays visible as context. The visibility predicate is shared by detail drawing,
overview preparation, clicking, and search focus so hidden objects cannot be
painted or selected unexpectedly.

## Failure And Performance Behavior

An unreadable snapshot keeps the existing explicit error state. A valid snapshot
with zero visible shapes shows an empty-layout message and the active filter
state rather than a blank canvas that resembles a loading failure.

The existing viewport caches remain in use. Pattern detail is bounded per shape,
and overview tiles are reserved for far zoom. This maintains interactive pan
and zoom behavior for larger workspaces while making the normal fitted view
truthful and useful.

## Validation

- Unit tests for layer-role style mapping, pattern selection, object visibility,
  default detail LOD, and far-overview LOD.
- Unit tests that hidden object categories are excluded from drawing and picking.
- Existing Chip Viewer workspace tests and the Rust workspace tests.
- Build `chip-viewer-native`, copy it into desktop resources, and verify a
  virtual-display screenshot of the route fixture shows distinct routed layout
  detail and patterns at first open.
- Rebuild the ECOS Studio AppImage and inspect it for the updated binary.

## Non-Goals

- Changing the geometry snapshot format or regenerating workspace snapshots.
- Reusing Layout Viewer's package reader or layout database from Chip Viewer.
- Replacing Chip Viewer editing, command bridge, or selection APIs.
