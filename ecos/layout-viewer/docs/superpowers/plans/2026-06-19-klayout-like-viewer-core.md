# KLayout-Like Viewer Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first three missing core areas of Layout Viewer V2: a KLayout-like persistent layout data model/index, stable multi-level LOD, and a cached plane-based renderer.

**Architecture:** Follow KLayout's separation of concerns: database cells own per-layer shape containers and child instance arrays; recursive shape/instance queries are region/depth/layer constrained; the view builds redraw work from layer/display state and composes cached render planes. ECOS keeps the existing `.layoutpkg` workflow, but moves expensive hierarchy, array, layer, and overview facts into package-time indexes so the native viewer plans and paints only viewport-relevant data.

**Tech Stack:** Rust workspace under `ecos/layout-viewer`, `layoutpkg-format`, `layoutpkg-packer`, `layoutpkg-reader`, `layoutdb`, `layout-render`, `layout-viewer-native-v2`, `rstar`, `serde`, `egui/eframe`.

---

## KLayout Reference Model

The implementation should follow these KLayout ideas, not copy its code:

- `Cell` model: a cell contains shape containers by layer, child cell instances, and parent/auxiliary metadata. Instances and arrays are represented by one object rather than eagerly expanded into every element. Reference: <https://www.klayout.de/doc/code/class_Cell.html>
- Recursive shape queries: KLayout's recursive shape iterator can be constrained by layer, region, hierarchy depth, shape classes, and properties. Reference: <https://www.klayout.de/doc/code/class_RecursiveShapeIterator.html>
- Recursive instance queries: KLayout's recursive instance iterator supports max/min depth and subtree selection/exclusion. Reference: <https://www.klayout.de/doc/code/class_RecursiveInstanceIterator.html>
- View/redraw split: `LayoutView` owns non-visual redraw state such as redraw thread, layout handles, cell lists, and layer view lists. Reference: <https://www.klayout.de/doc/code/class_LayoutView.html>
- Threaded bitmap composition: KLayout's drawing path uses redraw workers and stashes bitmaps for composition. Reference: <https://www.klayout.de/forum/discussion/2288/threaded-rendering-question>
- Layer display properties: KLayout `.lyp` separates frame/fill colors, brightness, dither pattern, line style, and valid/selectable state. Reference: <https://www.klayout.de/lyp_format.html>

## Scope

This plan implements the first three missing areas:

1. **Data Model / Persistent Indexes**
   - Add extensible geometry records for rectangle, polygon, path, and text.
   - Persist per-cell, per-layer summaries and bbox statistics.
   - Persist array metadata without expanding all array elements.
   - Persist multi-level overview/density data for far and mid LOD.

2. **Stable LOD**
   - Use explicit far/mid/near classification with hysteresis.
   - Far: only hierarchy/array bbox and package overview.
   - Mid: cell outline, array grid/density, coarse geometry from overview.
   - Near: recursive detail shapes with depth/layer/budget constraints.
   - Interaction: current-viewport coarse plan, never stale-plan reuse.

3. **Cached Plane Renderer**
   - Replace direct per-frame egui primitive replay with cached render planes.
   - Use CPU raster planes backed by `egui::TextureHandle` for far/mid/static layer planes.
   - Keep near overlays and selection as vector draw items.
   - Add cache invalidation by viewport bucket, display model hash, layer visibility, data revision, and LOD level.

## Out Of Scope For This Plan

- Full GDS/OASIS parser replacement.
- Boolean geometry operations.
- Editing layout shapes.
- A complete `.lyp` importer. This plan keeps the current color fallback but designs the style hash so `.lyp` can be added cleanly.

## File Structure

### Package Format

- Modify: `ecos/layout-viewer/crates/layoutpkg-format/src/lib.rs`
  - Add `GeometryRecord`, `GeometryPayload`, `PathStyle`, `TextRecord`.
  - Add `CellLayerSummary`, `CellHierarchySummary`, `OverviewPyramidDocument`, `OverviewLevel`, `OverviewBinRecord`.
  - Add schemas:
    - `HIERARCHY_INDEX_SCHEMA = "ecos.layoutpkg.hierarchy_index.v1"`
    - `OVERVIEW_PYRAMID_SCHEMA = "ecos.layoutpkg.overview_pyramid.v1"`

### Packer

- Modify: `ecos/layout-viewer/crates/layoutpkg-packer/src/lib.rs`
  - Write `hierarchy/index.json`.
  - Write `overview/pyramid.json` and level tile binaries.
  - Populate manifest capabilities.

### Reader

- Modify: `ecos/layout-viewer/crates/layoutpkg-reader/src/lib.rs`
  - Load hierarchy index and overview pyramid lazily.
  - Add APIs for selecting overview level by `units_per_pixel`.

### Layout DB

- Modify: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`
  - Add per-cell per-layer indexes.
  - Add `RecursiveShapeQuery`, `RecursiveInstanceQuery`, `RecursiveQueryOptions`.
  - Replace eager array-element R-tree insertion with one array bbox entry and viewport element enumeration.

### Render Planner

- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`
  - Add `LodLevel`, `LodClassifier`, `LodHysteresisState`, `RenderPlanSource`.
  - Add overview/density input to planner.
  - Split exact/detail planning from far/mid planning.

### Native Viewer

- Create: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/plane_cache.rs`
  - Plane cache keys and LRU cache.
- Create: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/raster_plane.rs`
  - CPU rasterizer for rectangles, outlines, markers, and overview density bins.
- Create: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/render_surface.rs`
  - Builds or reuses `egui::TextureHandle` planes and draws vector overlays.
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`
  - Integrate plane renderer, stats, and invalidation.

---

## Task 1: Package Format For KLayout-Like Geometry And Summaries

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutpkg-format/src/lib.rs`

- [ ] **Step 1: Write failing package-format tests**

Add these tests to the existing `#[cfg(test)] mod tests` in `layoutpkg-format/src/lib.rs`:

```rust
#[test]
fn hierarchy_cell_round_trips_layer_summaries() {
    let document = HierarchyDocument {
        schema: HIERARCHY_SCHEMA.to_string(),
        version: 3,
        top_cell: 1,
        cells: vec![HierarchyCell {
            id: 1,
            name: "top".to_string(),
            bbox: [0, 0, 100, 200],
            shapes: vec![],
            instances: vec![],
            layer_summaries: vec![CellLayerSummary {
                layer_id: 7,
                kind: LayoutObjectKind::RegularWire,
                bbox: [10, 20, 30, 40],
                shape_count: 3,
                total_area: 600,
            }],
            hierarchy_summary: CellHierarchySummary {
                direct_instance_count: 2,
                direct_array_count: 1,
                expanded_array_element_count: 64,
            },
        }],
    };

    let encoded = serde_json::to_string(&document).unwrap();
    let decoded: HierarchyDocument = serde_json::from_str(&encoded).unwrap();

    assert_eq!(decoded.cells[0].layer_summaries[0].layer_id, 7);
    assert_eq!(decoded.cells[0].layer_summaries[0].shape_count, 3);
    assert_eq!(decoded.cells[0].hierarchy_summary.expanded_array_element_count, 64);
}

#[test]
fn geometry_record_round_trips_polygon_path_and_text_payloads() {
    let records = vec![
        GeometryRecord {
            layer_id: 3,
            kind: LayoutObjectKind::RegularWire,
            bbox: [0, 0, 10, 10],
            source_id: 11,
            flags: 0,
            payload: GeometryPayload::Polygon {
                points: vec![[0, 0], [10, 0], [10, 10], [0, 10]],
            },
        },
        GeometryRecord {
            layer_id: 4,
            kind: LayoutObjectKind::SpecialWire,
            bbox: [0, 0, 100, 10],
            source_id: 12,
            flags: 0,
            payload: GeometryPayload::Path {
                points: vec![[0, 5], [100, 5]],
                style: PathStyle {
                    width: 10,
                    begin_ext: 0,
                    end_ext: 0,
                },
            },
        },
        GeometryRecord {
            layer_id: 5,
            kind: LayoutObjectKind::IoPin,
            bbox: [20, 30, 20, 30],
            source_id: 13,
            flags: 0,
            payload: GeometryPayload::Text(TextRecord {
                text: "PIN_A".to_string(),
                origin: [20, 30],
                height: 12,
                rotation: 0,
            }),
        },
    ];

    let encoded = serde_json::to_string(&records).unwrap();
    let decoded: Vec<GeometryRecord> = serde_json::from_str(&encoded).unwrap();

    assert_eq!(decoded, records);
}

#[test]
fn overview_pyramid_round_trips_density_levels() {
    let pyramid = OverviewPyramidDocument {
        schema: OVERVIEW_PYRAMID_SCHEMA.to_string(),
        version: 1,
        world_bbox: [0, 0, 1000, 1000],
        levels: vec![OverviewLevel {
            level: 0,
            units_per_bin: 100,
            grid: [10, 10],
            bins: vec![OverviewBinRecord {
                bbox: [0, 0, 100, 100],
                layer_id: 9,
                kind: LayoutObjectKind::Via,
                count: 12,
                coverage_area: 240,
            }],
        }],
    };

    let encoded = serde_json::to_string(&pyramid).unwrap();
    let decoded: OverviewPyramidDocument = serde_json::from_str(&encoded).unwrap();

    assert_eq!(decoded.levels[0].bins[0].count, 12);
    assert_eq!(decoded.levels[0].units_per_bin, 100);
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-format hierarchy_cell_round_trips_layer_summaries -- --nocapture
cargo test -p layoutpkg-format geometry_record_round_trips_polygon_path_and_text_payloads -- --nocapture
cargo test -p layoutpkg-format overview_pyramid_round_trips_density_levels -- --nocapture
```

Expected: compile fails because `CellLayerSummary`, `CellHierarchySummary`, `GeometryRecord`, `GeometryPayload`, `PathStyle`, `TextRecord`, and `OverviewPyramidDocument` do not exist.

- [ ] **Step 3: Add format structs**

Add these definitions after `HierarchyInstance` in `layoutpkg-format/src/lib.rs`:

```rust
pub const HIERARCHY_INDEX_SCHEMA: &str = "ecos.layoutpkg.hierarchy_index.v1";
pub const OVERVIEW_PYRAMID_SCHEMA: &str = "ecos.layoutpkg.overview_pyramid.v1";

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CellLayerSummary {
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub bbox: [i32; 4],
    pub shape_count: u32,
    pub total_area: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CellHierarchySummary {
    pub direct_instance_count: u32,
    pub direct_array_count: u32,
    pub expanded_array_element_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeometryRecord {
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub bbox: [i32; 4],
    pub source_id: u32,
    pub flags: u8,
    pub payload: GeometryPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GeometryPayload {
    Rect,
    Polygon { points: Vec<[i32; 2]> },
    Path { points: Vec<[i32; 2]>, style: PathStyle },
    Text(TextRecord),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathStyle {
    pub width: i32,
    pub begin_ext: i32,
    pub end_ext: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRecord {
    pub text: String,
    pub origin: [i32; 2],
    pub height: i32,
    pub rotation: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewPyramidDocument {
    pub schema: String,
    pub version: u32,
    pub world_bbox: [i32; 4],
    pub levels: Vec<OverviewLevel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewLevel {
    pub level: u32,
    pub units_per_bin: i32,
    pub grid: [u32; 2],
    pub bins: Vec<OverviewBinRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewBinRecord {
    pub bbox: [i32; 4],
    pub layer_id: u16,
    pub kind: LayoutObjectKind,
    pub count: u32,
    pub coverage_area: i64,
}
```

Modify `HierarchyCell`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HierarchyCell {
    pub id: u32,
    pub name: String,
    pub bbox: [i32; 4],
    #[serde(default)]
    pub shapes: Vec<HierarchyShape>,
    #[serde(default)]
    pub instances: Vec<HierarchyInstance>,
    #[serde(default)]
    pub layer_summaries: Vec<CellLayerSummary>,
    #[serde(default)]
    pub hierarchy_summary: CellHierarchySummary,
}
```

- [ ] **Step 4: Run package-format tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-format -- --nocapture
```

Expected: all `layoutpkg-format` tests pass.

- [ ] **Step 5: Commit**

```bash
git add ecos/layout-viewer/crates/layoutpkg-format/src/lib.rs
git commit -m "feat(layoutpkg): add hierarchy summaries and geometry records"
```

---

## Task 2: Packer Writes Persistent Cell Summaries And Overview Pyramid

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutpkg-packer/src/lib.rs`
- Test: existing test module in `layoutpkg-packer/src/lib.rs`

- [ ] **Step 1: Write failing packer tests**

Add these tests to the existing `#[cfg(test)] mod tests` in `layoutpkg-packer/src/lib.rs`:

```rust
#[test]
fn packer_writes_cell_layer_summaries() {
    let (_tmp, input, output) = sample_view_json_package();
    pack_viewjson_to_layoutpkg(PackLayoutPackageOptions::new(&input, &output)).unwrap();

    let hierarchy: HierarchyDocument =
        serde_json::from_str(&fs::read_to_string(output.join("hierarchy/cells.json")).unwrap())
            .unwrap();
    let top = hierarchy
        .cells
        .iter()
        .find(|cell| cell.id == hierarchy.top_cell)
        .unwrap();

    assert!(top
        .layer_summaries
        .iter()
        .any(|summary| summary.shape_count > 0 && summary.bbox[0] <= summary.bbox[2]));
    assert_eq!(
        top.hierarchy_summary.direct_instance_count as usize,
        top.instances.len()
    );
}

#[test]
fn packer_writes_overview_pyramid_document() {
    let (_tmp, input, output) = sample_view_json_package();
    pack_viewjson_to_layoutpkg(PackLayoutPackageOptions::new(&input, &output)).unwrap();

    let pyramid: OverviewPyramidDocument =
        serde_json::from_str(&fs::read_to_string(output.join("overview/pyramid.json")).unwrap())
            .unwrap();

    assert_eq!(pyramid.schema, OVERVIEW_PYRAMID_SCHEMA);
    assert!(pyramid.levels.len() >= 3);
    assert!(pyramid.levels.windows(2).all(|pair| {
        pair[1].units_per_bin > pair[0].units_per_bin
    }));
    assert!(pyramid
        .levels
        .iter()
        .any(|level| level.bins.iter().any(|bin| bin.count > 0)));
}

#[test]
fn manifest_advertises_hierarchy_summaries_and_overview_pyramid() {
    let (_tmp, input, output) = sample_view_json_package();
    pack_viewjson_to_layoutpkg(PackLayoutPackageOptions::new(&input, &output)).unwrap();

    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output.join("manifest.json")).unwrap()).unwrap();

    assert_eq!(manifest["capabilities"]["cell_layer_summaries"], true);
    assert_eq!(manifest["capabilities"]["overview_pyramid"], true);
    assert_eq!(
        manifest["tilesets"]["overview_pyramid"],
        "overview/pyramid.json"
    );
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-packer packer_writes_cell_layer_summaries -- --nocapture
cargo test -p layoutpkg-packer packer_writes_overview_pyramid_document -- --nocapture
cargo test -p layoutpkg-packer manifest_advertises_hierarchy_summaries_and_overview_pyramid -- --nocapture
```

Expected: compile failure because new format types are not imported, then assertion failure because files and manifest keys are not written.

- [ ] **Step 3: Import new format types**

Update the `layoutpkg_format` import in `layoutpkg-packer/src/lib.rs`:

```rust
use layoutpkg_format::{
    write_detail_tile, CellArray, CellHierarchySummary, CellLayerSummary, DetailTile,
    HierarchyCell, HierarchyDocument, HierarchyInstance, HierarchyShape, LayoutObjectKind,
    LayoutRectRecord, Orientation, OverviewBinRecord, OverviewLevel, OverviewPyramidDocument,
    Transform, DETAIL_INDEX_SCHEMA, HIERARCHY_SCHEMA, LAYOUTPKG_SCHEMA, OVERVIEW_INDEX_SCHEMA,
    OVERVIEW_PYRAMID_SCHEMA, QUERY_INDEX_SCHEMA,
};
```

- [ ] **Step 4: Add summary helpers**

Add these helper functions near `build_hierarchy_document`:

```rust
fn cell_layer_summaries(shapes: &[HierarchyShape]) -> Vec<CellLayerSummary> {
    let mut summaries: BTreeMap<(u16, LayoutObjectKind), CellLayerSummary> = BTreeMap::new();
    for shape in shapes {
        let key = (shape.layer_id, shape.kind);
        let bbox = shape.bbox;
        let area = i64::from((bbox[2] - bbox[0]).max(0)) * i64::from((bbox[3] - bbox[1]).max(0));
        summaries
            .entry(key)
            .and_modify(|summary| {
                summary.bbox[0] = summary.bbox[0].min(bbox[0]);
                summary.bbox[1] = summary.bbox[1].min(bbox[1]);
                summary.bbox[2] = summary.bbox[2].max(bbox[2]);
                summary.bbox[3] = summary.bbox[3].max(bbox[3]);
                summary.shape_count += 1;
                summary.total_area += area;
            })
            .or_insert(CellLayerSummary {
                layer_id: shape.layer_id,
                kind: shape.kind,
                bbox,
                shape_count: 1,
                total_area: area,
            });
    }
    summaries.into_values().collect()
}

fn cell_hierarchy_summary(instances: &[HierarchyInstance]) -> CellHierarchySummary {
    let mut direct_array_count = 0;
    let mut expanded_array_element_count = 0_u64;
    for instance in instances {
        let columns = instance.array.columns.max(1);
        let rows = instance.array.rows.max(1);
        let elements = u64::from(columns) * u64::from(rows);
        if elements > 1 {
            direct_array_count += 1;
        }
        expanded_array_element_count += elements;
    }
    CellHierarchySummary {
        direct_instance_count: instances.len() as u32,
        direct_array_count,
        expanded_array_element_count,
    }
}
```

In `build_hierarchy_document`, before pushing each `HierarchyCell`, set:

```rust
let layer_summaries = cell_layer_summaries(&cell.shapes);
let hierarchy_summary = cell_hierarchy_summary(&cell.instances);
cell.layer_summaries = layer_summaries;
cell.hierarchy_summary = hierarchy_summary;
```

For cells constructed inline, initialize fields explicitly:

```rust
layer_summaries: Vec::new(),
hierarchy_summary: CellHierarchySummary::default(),
```

- [ ] **Step 5: Add overview pyramid builder**

Add this function near `build_overview_tiles`:

```rust
fn build_overview_pyramid(world_bbox: [i32; 4], rects: &[LayoutRectRecord]) -> OverviewPyramidDocument {
    let world_width = (world_bbox[2] - world_bbox[0]).max(1);
    let base_bin = (world_width / 512).max(1);
    let levels = [base_bin, base_bin * 4, base_bin * 16, base_bin * 64]
        .into_iter()
        .enumerate()
        .map(|(level, units_per_bin)| {
            let columns = ((world_width + units_per_bin - 1) / units_per_bin).max(1) as u32;
            let world_height = (world_bbox[3] - world_bbox[1]).max(1);
            let rows = ((world_height + units_per_bin - 1) / units_per_bin).max(1) as u32;
            let mut bins: BTreeMap<(u32, u32, u16, LayoutObjectKind), OverviewBinRecord> = BTreeMap::new();
            for rect in rects {
                let min_col = ((rect.x1 - world_bbox[0]).max(0) / units_per_bin) as u32;
                let max_col = ((rect.x2 - world_bbox[0]).max(0) / units_per_bin).min(columns as i32 - 1) as u32;
                let min_row = ((rect.y1 - world_bbox[1]).max(0) / units_per_bin) as u32;
                let max_row = ((rect.y2 - world_bbox[1]).max(0) / units_per_bin).min(rows as i32 - 1) as u32;
                for row in min_row..=max_row {
                    for col in min_col..=max_col {
                        let x1 = world_bbox[0] + col as i32 * units_per_bin;
                        let y1 = world_bbox[1] + row as i32 * units_per_bin;
                        let x2 = (x1 + units_per_bin).min(world_bbox[2]);
                        let y2 = (y1 + units_per_bin).min(world_bbox[3]);
                        let key = (col, row, rect.layer_id, rect.kind);
                        let clipped_area = clipped_rect_area([rect.x1, rect.y1, rect.x2, rect.y2], [x1, y1, x2, y2]);
                        bins.entry(key)
                            .and_modify(|bin| {
                                bin.count += 1;
                                bin.coverage_area += clipped_area;
                            })
                            .or_insert(OverviewBinRecord {
                                bbox: [x1, y1, x2, y2],
                                layer_id: rect.layer_id,
                                kind: rect.kind,
                                count: 1,
                                coverage_area: clipped_area,
                            });
                    }
                }
            }
            OverviewLevel {
                level: level as u32,
                units_per_bin,
                grid: [columns, rows],
                bins: bins.into_values().collect(),
            }
        })
        .collect();
    OverviewPyramidDocument {
        schema: OVERVIEW_PYRAMID_SCHEMA.to_string(),
        version: 1,
        world_bbox,
        levels,
    }
}

fn clipped_rect_area(rect: [i32; 4], clip: [i32; 4]) -> i64 {
    let x1 = rect[0].max(clip[0]);
    let y1 = rect[1].max(clip[1]);
    let x2 = rect[2].min(clip[2]);
    let y2 = rect[3].min(clip[3]);
    i64::from((x2 - x1).max(0)) * i64::from((y2 - y1).max(0))
}
```

- [ ] **Step 6: Write `overview/pyramid.json` and manifest keys**

After writing `overview/index.json`, add:

```rust
let overview_pyramid = build_overview_pyramid(world_bbox, &dataset.rects);
write_json_pretty(
    options.output_root.join("overview/pyramid.json"),
    &overview_pyramid,
)?;
```

In manifest `capabilities`, add:

```rust
"cell_layer_summaries": true,
"overview_pyramid": true,
```

In manifest `tilesets`, add:

```rust
"overview_pyramid": "overview/pyramid.json",
```

- [ ] **Step 7: Run packer tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-packer -- --nocapture
```

Expected: all `layoutpkg-packer` tests pass.

- [ ] **Step 8: Commit**

```bash
git add ecos/layout-viewer/crates/layoutpkg-packer/src/lib.rs
git commit -m "feat(packer): persist hierarchy summaries and overview pyramid"
```

---

## Task 3: Reader Loads Persistent Viewer Indexes Lazily

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutpkg-reader/src/lib.rs`

- [ ] **Step 1: Write failing reader tests**

Add these tests to `layoutpkg-reader/src/lib.rs`:

```rust
#[test]
fn loads_overview_pyramid_once_and_selects_level_by_upp() {
    let (_tmp, root) = sample_package_with_overview_pyramid();
    let mut package = LayoutPackage::open(&root).unwrap();

    let level = package.load_overview_level_for_units_per_pixel(80.0).unwrap();
    let cached = package.load_overview_level_for_units_per_pixel(80.0).unwrap();

    assert_eq!(level.units_per_bin, cached.units_per_bin);
    assert!(!level.bins.is_empty());
}

#[test]
fn exposes_hierarchy_cell_layer_summaries() {
    let (_tmp, root) = sample_package_with_overview_pyramid();
    let mut package = LayoutPackage::open(&root).unwrap();
    let hierarchy = package.load_hierarchy().unwrap().unwrap();

    let top = hierarchy
        .cells
        .iter()
        .find(|cell| cell.id == hierarchy.top_cell)
        .unwrap();

    assert!(!top.layer_summaries.is_empty());
    assert!(top.hierarchy_summary.direct_instance_count >= top.instances.len() as u32);
}
```

Add helper:

```rust
fn sample_package_with_overview_pyramid() -> (tempfile::TempDir, std::path::PathBuf) {
    let (tmp, root) = sample_package();
    let pyramid = OverviewPyramidDocument {
        schema: OVERVIEW_PYRAMID_SCHEMA.to_string(),
        version: 1,
        world_bbox: [0, 0, 1000, 1000],
        levels: vec![
            OverviewLevel {
                level: 0,
                units_per_bin: 10,
                grid: [100, 100],
                bins: vec![OverviewBinRecord {
                    bbox: [0, 0, 10, 10],
                    layer_id: 1,
                    kind: LayoutObjectKind::RegularWire,
                    count: 1,
                    coverage_area: 10,
                }],
            },
            OverviewLevel {
                level: 1,
                units_per_bin: 100,
                grid: [10, 10],
                bins: vec![OverviewBinRecord {
                    bbox: [0, 0, 100, 100],
                    layer_id: 1,
                    kind: LayoutObjectKind::RegularWire,
                    count: 7,
                    coverage_area: 700,
                }],
            },
        ],
    };
    std::fs::write(
        root.join("overview/pyramid.json"),
        serde_json::to_vec_pretty(&pyramid).unwrap(),
    )
    .unwrap();
    let manifest_path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["tilesets"]["overview_pyramid"] = serde_json::json!("overview/pyramid.json");
    manifest["capabilities"]["overview_pyramid"] = serde_json::json!(true);
    std::fs::write(manifest_path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    (tmp, root)
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-reader loads_overview_pyramid_once_and_selects_level_by_upp -- --nocapture
cargo test -p layoutpkg-reader exposes_hierarchy_cell_layer_summaries -- --nocapture
```

Expected: compile failure because overview pyramid types and reader methods are missing.

- [ ] **Step 3: Import overview types and extend manifest structs**

Update imports:

```rust
use layoutpkg_format::{
    read_detail_tile, HierarchyDocument, LayoutObjectKind, LayoutRectRecord, OverviewLevel,
    OverviewPyramidDocument,
};
```

Extend `PackageTilesets`:

```rust
#[derive(Debug, Deserialize)]
struct PackageTilesets {
    detail: String,
    overview: Option<String>,
    query: Option<String>,
    overview_pyramid: Option<String>,
}
```

Extend `LayoutPackage` fields:

```rust
overview_pyramid_cache: Option<OverviewPyramidDocument>,
```

Initialize it in `LayoutPackage::open`:

```rust
overview_pyramid_cache: None,
```

- [ ] **Step 4: Add lazy overview APIs**

Add methods to `impl LayoutPackage`:

```rust
pub fn load_overview_pyramid(&mut self) -> Result<Option<OverviewPyramidDocument>> {
    if let Some(pyramid) = &self.overview_pyramid_cache {
        return Ok(Some(pyramid.clone()));
    }
    let Some(path) = self.manifest.tilesets.overview_pyramid.as_ref() else {
        return Ok(None);
    };
    let pyramid: OverviewPyramidDocument = read_json(self.root.join(path))?;
    self.overview_pyramid_cache = Some(pyramid.clone());
    Ok(Some(pyramid))
}

pub fn load_overview_level_for_units_per_pixel(&mut self, upp: f32) -> Result<OverviewLevel> {
    let Some(pyramid) = self.load_overview_pyramid()? else {
        anyhow::bail!("overview pyramid is not available");
    };
    let target = upp.ceil().max(1.0) as i32;
    pyramid
        .levels
        .into_iter()
        .find(|level| level.units_per_bin >= target)
        .or_else(|| pyramid.levels.into_iter().last())
        .ok_or_else(|| anyhow::anyhow!("overview pyramid has no levels"))
}
```

- [ ] **Step 5: Run reader tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutpkg-reader -- --nocapture
```

Expected: all reader tests pass.

- [ ] **Step 6: Commit**

```bash
git add ecos/layout-viewer/crates/layoutpkg-reader/src/lib.rs
git commit -m "feat(reader): load overview pyramid and hierarchy summaries"
```

---

## Task 4: LayoutDb KLayout-Like Recursive Query Model

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing LayoutDb tests**

Add tests to `layoutdb/src/lib.rs`:

```rust
#[test]
fn cell_keeps_per_layer_shape_counts_and_bboxes() {
    let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200, 200));
    db.add_layer(LayerInfo::new(1, "M1"));
    let top = db.top_cell();
    db.add_shape(top, ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::RegularWire, 1));
    db.add_shape(top, ShapeRecord::new(Rect::new(20, 20, 40, 40), 1, ShapeKind::RegularWire, 2));

    let stats = db.cell(top).unwrap().layer_stats(1).unwrap();

    assert_eq!(stats.shape_count, 2);
    assert_eq!(stats.bbox, Rect::new(0, 0, 40, 40));
}

#[test]
fn recursive_shape_query_filters_layer_before_returning_shapes() {
    let db = hierarchy_db_with_two_layers();
    let query = RecursiveShapeQuery {
        viewport: Rect::new(900, 1900, 1200, 2200),
        layer_ids: vec![2],
        max_depth: 8,
        min_depth: 0,
        include_kinds: vec![ShapeKind::RegularWire],
    };

    let result = db.query_recursive_shapes(query);

    assert!(!result.shapes.is_empty());
    assert!(result.shapes.iter().all(|shape| shape.layer_id == 2));
    assert!(result.instance_candidates_checked > 0);
}

#[test]
fn large_array_index_keeps_one_array_entry_and_expands_visible_elements_only() {
    let db = large_array_hierarchy_db(1_000, 1_000);
    let top = db.top_cell();

    assert_eq!(db.cell(top).unwrap().array_index_len(), 1);

    let result = db.query_recursive_instances(RecursiveInstanceQuery {
        viewport: Rect::new(0, 0, 120, 120),
        max_depth: 1,
        min_depth: 0,
        expand_arrays: true,
    });

    assert!(result.instances.len() < 200);
    assert!(result.total_array_elements >= 1_000_000);
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutdb cell_keeps_per_layer_shape_counts_and_bboxes -- --nocapture
cargo test -p layoutdb recursive_shape_query_filters_layer_before_returning_shapes -- --nocapture
cargo test -p layoutdb large_array_index_keeps_one_array_entry_and_expands_visible_elements_only -- --nocapture
```

Expected: compile failure because query structs, layer stats, and array index APIs do not exist.

- [ ] **Step 3: Add layer stats types**

Add after `ShapeRecord`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellLayerStats {
    pub layer_id: u16,
    pub bbox: Rect,
    pub shape_count: usize,
}
```

Modify `Cell`:

```rust
layer_stats: HashMap<u16, CellLayerStats>,
array_index: RTree<ArrayIndexEntry>,
```

Initialize in `Cell::new`:

```rust
layer_stats: HashMap::new(),
array_index: RTree::new(),
```

Add methods:

```rust
pub fn layer_stats(&self, layer_id: u16) -> Option<CellLayerStats> {
    self.layer_stats.get(&layer_id).copied()
}

pub fn array_index_len(&self) -> usize {
    self.array_index.size()
}
```

Update `LayoutDb::add_shape`:

```rust
let stats = cell.layer_stats.entry(shape.layer_id).or_insert(CellLayerStats {
    layer_id: shape.layer_id,
    bbox: shape.bbox,
    shape_count: 0,
});
stats.bbox = Rect::new(
    stats.bbox.x1.min(shape.bbox.x1),
    stats.bbox.y1.min(shape.bbox.y1),
    stats.bbox.x2.max(shape.bbox.x2),
    stats.bbox.y2.max(shape.bbox.y2),
);
stats.shape_count += 1;
```

- [ ] **Step 4: Add recursive query structs**

Add after `HierarchyInstanceQueryResult`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecursiveShapeQuery {
    pub viewport: Rect,
    pub layer_ids: Vec<u16>,
    pub max_depth: usize,
    pub min_depth: usize,
    pub include_kinds: Vec<ShapeKind>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecursiveInstanceQuery {
    pub viewport: Rect,
    pub max_depth: usize,
    pub min_depth: usize,
    pub expand_arrays: bool,
}
```

Extend `HierarchyInstanceQueryResult`:

```rust
pub total_array_elements: u64,
```

Update constructors/default consumers to set `total_array_elements: 0`.

- [ ] **Step 5: Add array index entry**

Add near `InstanceIndexEntry`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ArrayIndexEntry {
    bbox: Rect,
    instance_index: usize,
}

impl RTreeObject for ArrayIndexEntry {
    type Envelope = AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        rect_to_aabb(self.bbox)
    }
}
```

Modify `Cell::add_instance`:

```rust
let columns = instance.array.columns.max(1);
let rows = instance.array.rows.max(1);
let elements = u64::from(columns) * u64::from(rows);
let instance_index = self.instances.len();
if elements > 256 {
    self.array_index.insert(ArrayIndexEntry {
        bbox: instance.bbox,
        instance_index,
    });
} else {
    for row in 0..rows {
        for column in 0..columns {
            let bbox = AffineTransform::from_instance(&instance, child_bbox, column, row)
                .transform_rect(child_bbox);
            self.instance_index.insert(InstanceIndexEntry {
                bbox,
                instance_index,
                column,
                row,
            });
        }
    }
}
self.instances.push(instance);
```

- [ ] **Step 6: Implement query wrappers**

Add methods to `impl LayoutDb`:

```rust
pub fn query_recursive_shapes(&self, query: RecursiveShapeQuery) -> HierarchyQueryResult {
    let mut result = self.query_hierarchy_shapes_indexed(query.viewport, query.max_depth);
    result.shapes.retain(|shape| {
        (query.layer_ids.is_empty() || query.layer_ids.contains(&shape.layer_id))
            && (query.include_kinds.is_empty() || query.include_kinds.contains(&shape.kind))
    });
    result
}

pub fn query_recursive_instances(&self, query: RecursiveInstanceQuery) -> HierarchyInstanceQueryResult {
    let mut result = self.query_hierarchy_instances_indexed(query.viewport, query.max_depth);
    if query.expand_arrays {
        self.collect_visible_large_array_elements(self.top_cell, query.viewport, &mut result);
    }
    result
}
```

Add:

```rust
fn collect_visible_large_array_elements(
    &self,
    cell_id: CellId,
    viewport: Rect,
    result: &mut HierarchyInstanceQueryResult,
) {
    let Some(cell) = self.cell(cell_id) else {
        return;
    };
    for entry in cell.array_index.locate_in_envelope_intersecting(rect_to_aabb(viewport)) {
        let Some(instance) = cell.instances.get(entry.instance_index) else {
            continue;
        };
        let Some(child) = self.cell(instance.child_cell) else {
            continue;
        };
        let child_bbox = child_bbox(child);
        let columns = instance.array.columns.max(1);
        let rows = instance.array.rows.max(1);
        result.total_array_elements += u64::from(columns) * u64::from(rows);
        for row in 0..rows {
            for column in 0..columns {
                let transform = AffineTransform::from_instance(instance, child_bbox, column, row);
                let bbox = transform.transform_rect(child_bbox);
                if !bbox.intersects(viewport) {
                    continue;
                }
                result.instances.push(HierarchyInstanceRecord {
                    bbox,
                    array_bbox: instance.bbox,
                    instance_id: instance.id,
                    source_id: instance.source_id,
                    cell: cell_id,
                    child_cell: instance.child_cell,
                    array_columns: columns,
                    array_rows: rows,
                    array_column: column,
                    array_row: row,
                });
            }
        }
    }
}
```

- [ ] **Step 7: Run LayoutDb tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutdb -- --nocapture
```

Expected: all layoutdb tests pass. If existing tests expect every array element to be in `instance_index`, update those tests to assert visible results rather than internal index expansion.

- [ ] **Step 8: Commit**

```bash
git add ecos/layout-viewer/crates/layoutdb/src/lib.rs
git commit -m "feat(layoutdb): add recursive query model and compact array index"
```

---

## Task 5: Stable Far/Mid/Near LOD Classifier

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`

- [ ] **Step 1: Write failing LOD classifier tests**

Add these tests to `layout-render/src/lib.rs`:

```rust
#[test]
fn lod_classifier_uses_hysteresis_to_prevent_threshold_flicker() {
    let mut state = LodHysteresisState::default();
    let settings = RenderSettings {
        hierarchy_bbox_units_per_pixel: 160.0,
        hierarchy_coarse_units_per_pixel: 32.0,
        ..Default::default()
    };

    let first = classify_lod(170.0, settings, &mut state);
    let second = classify_lod(155.0, settings, &mut state);
    let third = classify_lod(120.0, settings, &mut state);

    assert_eq!(first, LodLevel::Far);
    assert_eq!(second, LodLevel::Far);
    assert_eq!(third, LodLevel::Mid);
}

#[test]
fn far_lod_never_outputs_detail_planes_when_hierarchy_exists() {
    let db = hierarchy_db();
    let model = one_layer_display_model();
    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 100.0,
        hierarchy_coarse_units_per_pixel: 4.0,
        force_interaction_coarse: true,
        ..Default::default()
    })
    .plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0),
    );

    assert_eq!(plan.source, RenderPlanSource::HierarchyFar);
    assert!(plan
        .batches
        .iter()
        .all(|batch| matches!(batch.plane, RenderPlane::Hierarchy)));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render lod_classifier_uses_hysteresis_to_prevent_threshold_flicker -- --nocapture
cargo test -p layout-render far_lod_never_outputs_detail_planes_when_hierarchy_exists -- --nocapture
```

Expected: compile failure because `LodLevel`, `LodHysteresisState`, `classify_lod`, and `RenderPlanSource` are missing.

- [ ] **Step 3: Add LOD source types**

Add near `RenderPlane`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LodLevel {
    Far,
    Mid,
    Near,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LodHysteresisState {
    previous: Option<LodLevel>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RenderPlanSource {
    #[default]
    FlatDetail,
    HierarchyFar,
    HierarchyMid,
    HierarchyNear,
    OverviewDensity,
}
```

Extend `RenderPlan`:

```rust
pub source: RenderPlanSource,
```

- [ ] **Step 4: Add classifier**

Add:

```rust
pub fn classify_lod(
    units_per_pixel: f32,
    settings: RenderSettings,
    state: &mut LodHysteresisState,
) -> LodLevel {
    let far_enter = settings.hierarchy_bbox_units_per_pixel;
    let far_exit = far_enter * 0.80;
    let mid_enter = settings.hierarchy_coarse_units_per_pixel;
    let mid_exit = mid_enter * 0.80;

    let level = match state.previous {
        Some(LodLevel::Far) if units_per_pixel >= far_exit => LodLevel::Far,
        Some(LodLevel::Mid) if units_per_pixel >= mid_exit && units_per_pixel < far_enter => {
            LodLevel::Mid
        }
        _ if units_per_pixel >= far_enter => LodLevel::Far,
        _ if units_per_pixel >= mid_enter => LodLevel::Mid,
        _ => LodLevel::Near,
    };
    state.previous = Some(level);
    level
}
```

- [ ] **Step 5: Mark render plan source**

In `RenderPlanner::plan`, set `plan.source` in each branch:

```rust
match self.hierarchy_lod_mode(db, viewport) {
    HierarchyLodMode::FarBBox => {
        plan.source = RenderPlanSource::HierarchyFar;
        self.push_hierarchy_bboxes(db, &mut plan, viewport, 1);
    }
    HierarchyLodMode::MidCoarse => {
        plan.source = RenderPlanSource::HierarchyMid;
        self.push_coarse_hierarchy(db, &mut plan, viewport);
    }
    HierarchyLodMode::NearExpand => {
        plan.source = RenderPlanSource::HierarchyNear;
        self.push_expanded_hierarchy_shapes(db, &layers, &mut plan, viewport, &mut occupancy);
        for shape in query.shapes {
            self.push_shape_lod(&layers, &mut plan, viewport, &mut occupancy, shape);
        }
    }
}
```

For flat databases without hierarchy, keep `RenderPlanSource::FlatDetail`.

- [ ] **Step 6: Run render tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render -- --nocapture
```

Expected: all render tests pass.

- [ ] **Step 7: Commit**

```bash
git add ecos/layout-viewer/crates/layout-render/src/lib.rs
git commit -m "feat(render): add stable LOD classifier and plan source"
```

---

## Task 6: Render Planner Uses Overview Pyramid For Far/Mid Density

**Files:**
- Modify: `ecos/layout-viewer/crates/layout-render/src/lib.rs`
- Modify: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`

- [ ] **Step 1: Write failing overview planning tests**

Add to `layout-render/src/lib.rs`:

```rust
#[test]
fn mid_lod_can_render_overview_density_without_detail_shapes() {
    let db = LayoutDb::new("overview", Rect::new(0, 0, 1000, 1000))
        .with_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 100, 100),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 10,
            coverage_area: 500,
        }]);
    let model = one_layer_display_model();

    let plan = RenderPlanner::new(RenderSettings {
        hierarchy_bbox_units_per_pixel: 1000.0,
        hierarchy_coarse_units_per_pixel: 10.0,
        ..Default::default()
    })
    .plan(
        &db,
        &model,
        Viewport::new(Rect::new(0, 0, 1000, 1000), 100.0, 100.0),
    );

    assert_eq!(plan.source, RenderPlanSource::OverviewDensity);
    assert_eq!(plan.query_stats.candidates_checked, 0);
    assert!(plan.lod_stats.coarse > 0);
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-render mid_lod_can_render_overview_density_without_detail_shapes -- --nocapture
```

Expected: compile failure because `OverviewDensityBin` and `LayoutDb::with_overview_bins` do not exist.

- [ ] **Step 3: Add overview bins to LayoutDb**

In `layoutdb/src/lib.rs`, add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverviewDensityBin {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub count: u32,
    pub coverage_area: i64,
}
```

Add field to `LayoutDb`:

```rust
overview_bins: Vec<OverviewDensityBin>,
```

Initialize in constructors with `Vec::new()`.

Add methods:

```rust
pub fn with_overview_bins(mut self, bins: Vec<OverviewDensityBin>) -> Self {
    self.overview_bins = bins;
    self
}

pub fn overview_bins(&self, viewport: Rect) -> impl Iterator<Item = &OverviewDensityBin> {
    self.overview_bins.iter().filter(move |bin| bin.bbox.intersects(viewport))
}
```

- [ ] **Step 4: Add overview rendering branch**

In `layout-render/src/lib.rs`, import `OverviewDensityBin` and add:

```rust
fn db_has_overview_density(db: &LayoutDb, viewport: Viewport) -> bool {
    db.overview_bins(viewport.world).next().is_some()
}
```

At the beginning of `RenderPlanner::plan`, after computing `units_per_pixel`, route mid/far flat planning through overview:

```rust
if db_has_overview_density(db, viewport)
    && viewport.units_per_pixel_x().max(viewport.units_per_pixel_y())
        >= self.settings.hierarchy_coarse_units_per_pixel
{
    plan.source = RenderPlanSource::OverviewDensity;
    self.push_overview_density(db, &layers, &mut plan, viewport);
    return plan;
}
```

Add:

```rust
fn push_overview_density(
    &self,
    db: &LayoutDb,
    layers: &[ResolvedDisplayLayer],
    plan: &mut RenderPlan,
    viewport: Viewport,
) {
    let visible = VisibleShapeSources::from_layers(layers);
    for bin in db.overview_bins(viewport.world) {
        if !visible.matches(bin.layer_id, bin.kind) {
            continue;
        }
        let shape = ShapeRecord::new(bin.bbox, bin.layer_id, bin.kind, bin.count);
        if let Some(layer) = layers.iter().find(|layer| layer.matches_shape(&shape)) {
            push_item(
                plan,
                RenderPlane::Frame,
                layer,
                DrawItem::Rect(DrawRect {
                    world: bin.bbox,
                    color: layer.style.frame_color,
                    source_id: bin.count,
                    layer_id: bin.layer_id,
                    composition: CompositionMode::MaskPattern,
                }),
                self.settings.max_render_items,
            );
            plan.lod_stats.record(LodDecision::Coarse);
        }
    }
}
```

- [ ] **Step 5: Wire reader overview bins into session**

Modify `PackageLayoutSource::load_viewport_batch` or `LayoutSession::apply_viewport_batch` so overview pyramid bins populate `LayoutDb::overview_bins` when `units_per_pixel` is far/mid. The method signature should be:

```rust
pub fn apply_overview_bins(&mut self, bins: Vec<OverviewDensityBin>) {
    self.db.set_overview_bins(bins);
}
```

Add to `LayoutDb`:

```rust
pub fn set_overview_bins(&mut self, bins: Vec<OverviewDensityBin>) {
    self.overview_bins = bins;
}
```

- [ ] **Step 6: Run render and db tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutdb -- --nocapture
cargo test -p layout-render -- --nocapture
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ecos/layout-viewer/crates/layoutdb/src/lib.rs ecos/layout-viewer/crates/layout-render/src/lib.rs
git commit -m "feat(render): use overview density for far and mid LOD"
```

---

## Task 7: Plane Cache And CPU Raster Plane Renderer

**Files:**
- Create: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/plane_cache.rs`
- Create: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/raster_plane.rs`
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing plane cache tests**

Create `plane_cache.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plane_cache_reuses_matching_key() {
        let mut cache = PlaneCache::new(2);
        let key = PlaneKey {
            viewport_bucket: [0, 0, 10, 10],
            lod_level: "mid".to_string(),
            display_hash: 7,
            data_revision: 1,
            layer_mask_hash: 9,
            plane: "frame".to_string(),
        };
        cache.insert(key.clone(), CachedPlane::new_for_test(100, 100));

        assert!(cache.get(&key).is_some());
        assert_eq!(cache.stats().hits, 1);
    }

    #[test]
    fn plane_cache_evicts_least_recently_used_plane() {
        let mut cache = PlaneCache::new(1);
        let first = PlaneKey::for_test("first");
        let second = PlaneKey::for_test("second");
        cache.insert(first.clone(), CachedPlane::new_for_test(10, 10));
        cache.insert(second.clone(), CachedPlane::new_for_test(10, 10));

        assert!(cache.get(&first).is_none());
        assert!(cache.get(&second).is_some());
    }
}
```

- [ ] **Step 2: Implement plane cache**

Add:

```rust
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PlaneKey {
    pub viewport_bucket: [i32; 4],
    pub lod_level: String,
    pub display_hash: u64,
    pub data_revision: u64,
    pub layer_mask_hash: u64,
    pub plane: String,
}

impl PlaneKey {
    #[cfg(test)]
    pub fn for_test(name: &str) -> Self {
        Self {
            viewport_bucket: [0, 0, 1, 1],
            lod_level: name.to_string(),
            display_hash: 0,
            data_revision: 0,
            layer_mask_hash: 0,
            plane: name.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CachedPlane {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl CachedPlane {
    #[cfg(test)]
    pub fn new_for_test(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![0; width * height * 4],
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PlaneCacheStats {
    pub hits: usize,
    pub misses: usize,
    pub evictions: usize,
}

pub struct PlaneCache {
    capacity: usize,
    map: HashMap<PlaneKey, CachedPlane>,
    order: VecDeque<PlaneKey>,
    stats: PlaneCacheStats,
}

impl PlaneCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            map: HashMap::new(),
            order: VecDeque::new(),
            stats: PlaneCacheStats::default(),
        }
    }

    pub fn get(&mut self, key: &PlaneKey) -> Option<&CachedPlane> {
        if self.map.contains_key(key) {
            self.stats.hits += 1;
            self.touch(key);
            self.map.get(key)
        } else {
            self.stats.misses += 1;
            None
        }
    }

    pub fn insert(&mut self, key: PlaneKey, plane: CachedPlane) {
        if !self.map.contains_key(&key) {
            self.order.push_back(key.clone());
        }
        self.map.insert(key, plane);
        while self.map.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                if self.map.remove(&oldest).is_some() {
                    self.stats.evictions += 1;
                }
            }
        }
    }

    pub fn stats(&self) -> PlaneCacheStats {
        self.stats
    }

    fn touch(&mut self, key: &PlaneKey) {
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.clone());
    }
}
```

- [ ] **Step 3: Write failing raster tests**

Create `raster_plane.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raster_rect_clips_to_plane_bounds() {
        let mut plane = RasterPlane::new(8, 8);
        plane.fill_rect([-4, -4, 4, 4], [255, 0, 0, 255]);

        assert_eq!(plane.non_zero_pixels(), 16);
    }

    #[test]
    fn raster_outline_draws_rect_edges() {
        let mut plane = RasterPlane::new(10, 10);
        plane.stroke_rect([2, 2, 7, 7], [0, 255, 0, 255]);

        assert!(plane.pixel_alpha(2, 2) > 0);
        assert!(plane.pixel_alpha(4, 4) == 0);
    }
}
```

- [ ] **Step 4: Implement raster plane**

Add:

```rust
#[derive(Debug, Clone)]
pub struct RasterPlane {
    width: usize,
    height: usize,
    pixels: Vec<u8>,
}

impl RasterPlane {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![0; width * height * 4],
        }
    }

    pub fn fill_rect(&mut self, rect: [i32; 4], rgba: [u8; 4]) {
        let x1 = rect[0].max(0) as usize;
        let y1 = rect[1].max(0) as usize;
        let x2 = rect[2].min(self.width as i32).max(0) as usize;
        let y2 = rect[3].min(self.height as i32).max(0) as usize;
        for y in y1..y2 {
            for x in x1..x2 {
                self.set_pixel(x, y, rgba);
            }
        }
    }

    pub fn stroke_rect(&mut self, rect: [i32; 4], rgba: [u8; 4]) {
        self.fill_rect([rect[0], rect[1], rect[2], rect[1] + 1], rgba);
        self.fill_rect([rect[0], rect[3] - 1, rect[2], rect[3]], rgba);
        self.fill_rect([rect[0], rect[1], rect[0] + 1, rect[3]], rgba);
        self.fill_rect([rect[2] - 1, rect[1], rect[2], rect[3]], rgba);
    }

    pub fn into_pixels(self) -> Vec<u8> {
        self.pixels
    }

    #[cfg(test)]
    fn non_zero_pixels(&self) -> usize {
        self.pixels.chunks_exact(4).filter(|px| px[3] > 0).count()
    }

    #[cfg(test)]
    fn pixel_alpha(&self, x: usize, y: usize) -> u8 {
        self.pixels[(y * self.width + x) * 4 + 3]
    }

    fn set_pixel(&mut self, x: usize, y: usize, rgba: [u8; 4]) {
        let offset = (y * self.width + x) * 4;
        self.pixels[offset..offset + 4].copy_from_slice(&rgba);
    }
}
```

- [ ] **Step 5: Register modules**

At the top of `main.rs`, add:

```rust
mod plane_cache;
mod raster_plane;
```

- [ ] **Step 6: Run native tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add ecos/layout-viewer/apps/layout-viewer-native-v2/src/plane_cache.rs ecos/layout-viewer/apps/layout-viewer-native-v2/src/raster_plane.rs ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs
git commit -m "feat(viewer): add cached raster render planes"
```

---

## Task 8: Compose Cached Planes In Native Viewer

**Files:**
- Create: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/render_surface.rs`
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing render surface tests**

Create `render_surface.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_bucket_is_stable_for_small_pan_inside_bucket() {
        let first = viewport_bucket([0, 0, 1000, 1000], 256);
        let second = viewport_bucket([10, 10, 1010, 1010], 256);

        assert_eq!(first, second);
    }

    #[test]
    fn viewport_bucket_changes_after_large_pan() {
        let first = viewport_bucket([0, 0, 1000, 1000], 256);
        let second = viewport_bucket([300, 0, 1300, 1000], 256);

        assert_ne!(first, second);
    }
}
```

- [ ] **Step 2: Implement render surface helpers**

Add:

```rust
pub fn viewport_bucket(viewport: [i32; 4], bucket_units: i32) -> [i32; 4] {
    let bucket = bucket_units.max(1);
    [
        viewport[0].div_euclid(bucket),
        viewport[1].div_euclid(bucket),
        viewport[2].div_euclid(bucket),
        viewport[3].div_euclid(bucket),
    ]
}
```

Add a `RenderSurface` struct:

```rust
pub struct RenderSurface {
    pub cache: crate::plane_cache::PlaneCache,
}

impl RenderSurface {
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: crate::plane_cache::PlaneCache::new(capacity),
        }
    }
}
```

- [ ] **Step 3: Add render surface field**

In `main.rs`, add:

```rust
mod render_surface;
```

Add field to `LayoutViewerV2App`:

```rust
render_surface: render_surface::RenderSurface,
```

Initialize in `open`:

```rust
render_surface: render_surface::RenderSurface::new(32),
```

- [ ] **Step 4: Add draw path switch**

In `draw_canvas`, before the existing direct primitive loop, add:

```rust
let use_plane_renderer = matches!(
    paint_plan.source,
    layout_render::RenderPlanSource::HierarchyFar
        | layout_render::RenderPlanSource::HierarchyMid
        | layout_render::RenderPlanSource::OverviewDensity
);
```

For this task, if `use_plane_renderer` is true, keep the existing primitive loop but record:

```rust
self.last_plan_reused = self.last_plan_reused || use_plane_renderer;
```

This keeps behavior unchanged while the surface and cache land behind tests. Task 9 performs the actual plane draw replacement.

- [ ] **Step 5: Run native tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: native tests pass.

- [ ] **Step 6: Commit**

```bash
git add ecos/layout-viewer/apps/layout-viewer-native-v2/src/render_surface.rs ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs
git commit -m "feat(viewer): introduce render surface cache"
```

---

## Task 9: Replace Far/Mid Direct Primitive Replay With Cached Raster Planes

**Files:**
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/render_surface.rs`
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/raster_plane.rs`
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing pure render surface test**

Add to `render_surface.rs` tests:

```rust
#[test]
fn plane_key_changes_when_data_revision_changes() {
    let first = build_plane_key([0, 0, 10, 10], "mid", 1, 2, 3, "frame");
    let second = build_plane_key([0, 0, 10, 10], "mid", 1, 99, 3, "frame");

    assert_ne!(first, second);
}
```

- [ ] **Step 2: Implement plane key builder**

Add:

```rust
pub fn build_plane_key(
    viewport_bucket: [i32; 4],
    lod_level: &str,
    display_hash: u64,
    data_revision: u64,
    layer_mask_hash: u64,
    plane: &str,
) -> crate::plane_cache::PlaneKey {
    crate::plane_cache::PlaneKey {
        viewport_bucket,
        lod_level: lod_level.to_string(),
        display_hash,
        data_revision,
        layer_mask_hash,
        plane: plane.to_string(),
    }
}
```

- [ ] **Step 3: Add rasterization from `RenderPlan`**

Add to `render_surface.rs`:

```rust
pub fn rasterize_plan(
    plan: &layout_render::RenderPlan,
    width: usize,
    height: usize,
    world_to_screen: impl Fn(layoutdb::Rect) -> [i32; 4],
) -> crate::plane_cache::CachedPlane {
    let mut raster = crate::raster_plane::RasterPlane::new(width, height);
    for batch in &plan.batches {
        for item in &batch.items {
            if let layout_render::DrawItem::Rect(rect) = item {
                let screen = world_to_screen(rect.world);
                let color = match batch.plane {
                    layout_render::RenderPlane::Fill => [
                        batch.style.fill_color.r,
                        batch.style.fill_color.g,
                        batch.style.fill_color.b,
                        batch.style.fill_alpha,
                    ],
                    _ => [
                        rect.color.r,
                        rect.color.g,
                        rect.color.b,
                        batch.style.frame_alpha,
                    ],
                };
                match batch.plane {
                    layout_render::RenderPlane::Fill => raster.fill_rect(screen, color),
                    _ => raster.stroke_rect(screen, color),
                }
            }
        }
    }
    crate::plane_cache::CachedPlane {
        width,
        height,
        pixels: raster.into_pixels(),
    }
}
```

- [ ] **Step 4: Compose texture in egui**

In `main.rs`, in `draw_canvas`, when `use_plane_renderer` is true:

```rust
let bucket = render_surface::viewport_bucket(
    [viewport.world.x1, viewport.world.y1, viewport.world.x2, viewport.world.y2],
    (view.units_per_pixel * 256.0).ceil().max(1.0) as i32,
);
let key = render_surface::build_plane_key(
    bucket,
    if interaction_active { "interaction" } else { "steady" },
    expected_cache_key.value(),
    self.session.revision(),
    expected_cache_key.value(),
    "main",
);
```

If `self.render_surface.cache.get(&key)` returns `Some(plane)`, upload/update an `egui::TextureHandle` and draw it:

```rust
let image = egui::ColorImage::from_rgba_unmultiplied([plane.width, plane.height], &plane.pixels);
```

If cache misses, call `rasterize_plan`, insert the plane, upload it, then draw it.

Keep the existing vector primitive loop for `Near` plans and selection highlight.

- [ ] **Step 5: Update stats**

Add fields to `LayoutViewerV2App`:

```rust
last_plane_cache_hits: usize,
last_plane_cache_misses: usize,
```

Display them in `stats_panel_rows` as:

```rust
("Plane Cache", format!("hits={} misses={}", plane_hits, plane_misses))
```

- [ ] **Step 6: Run native tests and manual smoke**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layout-viewer-native-v2 -- --nocapture
cargo run --release -p layout-viewer-native-v2 -- /path/to/package.layoutpkg
```

Manual expected result:

- Far zoom: stable bbox/density view.
- Drag/zoom: no stale viewport content.
- `Plane Cache` hits increase while panning inside viewport bucket.
- Near zoom: detailed vector overlay remains visible.

- [ ] **Step 7: Commit**

```bash
git add ecos/layout-viewer/apps/layout-viewer-native-v2/src/render_surface.rs ecos/layout-viewer/apps/layout-viewer-native-v2/src/raster_plane.rs ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs
git commit -m "feat(viewer): compose far and mid views from cached raster planes"
```

---

## Task 10: Integration From Package Overview To Viewer Plan

**Files:**
- Modify: `ecos/layout-viewer/crates/layoutdb/src/lib.rs`
- Modify: `ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs`

- [ ] **Step 1: Write failing integration tests**

Add to `layoutdb/src/lib.rs`:

```rust
#[test]
fn package_source_applies_overview_pyramid_bins_to_session() {
    let (_tmp, root) = layoutpkg_reader::tests::sample_package_with_overview_pyramid();
    let mut source = PackageLayoutSource::open(root, 8).unwrap();
    let mut session = LayoutSession::from_source(source).unwrap();

    session.ensure_overview_for_units_per_pixel(100.0).unwrap();

    assert!(session.db().overview_bins(Rect::new(0, 0, 1000, 1000)).count() > 0);
}
```

- [ ] **Step 2: Add session overview API**

Add to `PackageLayoutSource`:

```rust
pub fn load_overview_bins_for_units_per_pixel(
    &mut self,
    upp: f32,
) -> Result<Vec<OverviewDensityBin>> {
    let level = self.source.package.load_overview_level_for_units_per_pixel(upp)?;
    Ok(level
        .bins
        .into_iter()
        .map(|bin| OverviewDensityBin {
            bbox: Rect::new(bin.bbox[0], bin.bbox[1], bin.bbox[2], bin.bbox[3]),
            layer_id: bin.layer_id,
            kind: ShapeKind::from(bin.kind),
            count: bin.count,
            coverage_area: bin.coverage_area,
        })
        .collect())
}
```

Add to `LayoutSession`:

```rust
pub fn ensure_overview_for_units_per_pixel(&mut self, upp: f32) -> Result<()> {
    let bins = self.source.load_overview_bins_for_units_per_pixel(upp)?;
    self.db.set_overview_bins(bins);
    self.revision += 1;
    Ok(())
}
```

- [ ] **Step 3: Call overview API from native viewer**

In `draw_canvas`, before planning:

```rust
if view.units_per_pixel >= self.lod_tuning.hierarchy_coarse_units_per_pixel {
    if let Err(error) = self.session.ensure_overview_for_units_per_pixel(view.units_per_pixel) {
        self.last_error = Some(error.to_string());
    }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd ecos/layout-viewer
cargo test -p layoutdb -- --nocapture
cargo test -p layout-viewer-native-v2 -- --nocapture
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add ecos/layout-viewer/crates/layoutdb/src/lib.rs ecos/layout-viewer/apps/layout-viewer-native-v2/src/main.rs
git commit -m "feat(viewer): feed package overview pyramid into render planner"
```

---

## Task 11: End-To-End Validation And Regression Guards

**Files:**
- Modify: `ecos/layout-viewer/README.md`
- Modify: `ecos/layout-viewer/docs/native-layout-viewer-split.md`

- [ ] **Step 1: Add documented validation commands**

Append this section to `README.md`:

```markdown
## Native V2 KLayout-Like Core Validation

Run the package pipeline and native viewer checks:

```bash
cargo fmt --all -- --check
cargo test --workspace -- --nocapture
cargo run --release -p layout-viewer-native-v2 -- /path/to/package.layoutpkg
```

Expected interactive behavior:

- Far zoom uses hierarchy/array bbox or overview density.
- Mid zoom uses coarse cell/array/grid/density planes.
- Near zoom shows detailed layer geometry.
- Drag/zoom never reuses a render plan from a mismatched viewport.
- `Plane Cache` hits increase during small pans.
```
```

- [ ] **Step 2: Update design doc**

Append this section to `docs/native-layout-viewer-split.md`:

```markdown
## KLayout-Like V2 Core

V2 now follows a KLayout-like split:

- `.layoutpkg` stores cell hierarchy, per-cell layer summaries, compact arrays, and overview density.
- `layoutdb` exposes recursive shape/instance queries with viewport, layer, and depth constraints.
- `layout-render` chooses far/mid/near LOD through a stable classifier.
- `layout-viewer-native-v2` composes far/mid display through cached raster planes and keeps near overlays as vector primitives.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
cd ecos/layout-viewer
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace -- --nocapture
```

Expected: all commands exit with status 0.

- [ ] **Step 4: Commit**

```bash
git add ecos/layout-viewer/README.md ecos/layout-viewer/docs/native-layout-viewer-split.md
git commit -m "docs(viewer): document klayout-like v2 validation"
```

---

## Self-Review Checklist

- **Spec coverage:** Tasks 1-4 implement the data model/index work; Tasks 5-6 implement stable LOD; Tasks 7-10 implement cached plane rendering; Task 11 documents validation.
- **KLayout alignment:** The plan adopts cell/layer containers, recursive region/depth queries, compact arrays, redraw-state separation, and cached plane composition.
- **Regression coverage:** Tests guard the previously observed stale viewport bug, far/coarse priority, array explosion, LOD flicker, overview usage, and plane cache invalidation.
- **Execution order:** Tasks are ordered so package format lands before packer/reader, db before render, render before native plane composition.
- **Manual validation:** Release-mode native viewer run remains required because egui texture composition and interactive smoothness need visual confirmation.

