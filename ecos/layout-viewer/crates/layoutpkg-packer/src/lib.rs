use std::{
    collections::BTreeMap,
    fmt, fs,
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    time::Instant,
};

use anyhow::{bail, Context, Result};
use layoutpkg_format::{
    write_detail_tile, write_overview_pyramid, CellArray, CellHierarchySummary, CellLayerSummary,
    DetailTile, HierarchyCell, HierarchyDocument, HierarchyInstance, HierarchyShape,
    LayoutObjectKind, LayoutRectRecord, Orientation, OverviewBinRecord, OverviewLevel,
    OverviewPyramidDocument, Transform, DETAIL_INDEX_SCHEMA, HIERARCHY_SCHEMA, LAYOUTPKG_SCHEMA,
    OVERVIEW_INDEX_SCHEMA, OVERVIEW_PYRAMID_SCHEMA, QUERY_INDEX_SCHEMA,
};
use serde::de::{DeserializeSeed, Error as DeError, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const OVERVIEW_COVERAGE_BINS_PER_TILE: usize = 16;
const DEFAULT_OVERVIEW_GRID_COLUMNS: usize = 1;
const DEFAULT_OVERVIEW_GRID_ROWS: usize = 1;
const DEFAULT_TARGET_PRIMITIVES_PER_TILE: usize = 6000;
const DEFAULT_MAX_SUBDIVISION_DEPTH: usize = 6;
const OVERVIEW_PYRAMID_BIN_SIZES: [i32; 4] = [1024, 4096, 16384, 65536];
const OVERVIEW_PYRAMID_MAX_BINS_PER_RECT_PER_LEVEL: u64 = 256;
const DETAIL_TILE_SHARD_FILE: &str = "detail/shard_0.bin";
pub const LAYOUTPKG_GENERATOR_NAME: &str = "ecos-layout-packer";
pub const LAYOUTPKG_GENERATOR_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone)]
pub struct PackLayoutPackageOptions {
    pub input_root: PathBuf,
    pub output_root: PathBuf,
    pub detail_grid_columns: usize,
    pub detail_grid_rows: usize,
    pub max_tiles_per_object: usize,
    pub target_primitives_per_tile: usize,
    pub max_subdivision_depth: usize,
}

impl PackLayoutPackageOptions {
    pub fn new(input_root: impl Into<PathBuf>, output_root: impl Into<PathBuf>) -> Self {
        Self {
            input_root: input_root.into(),
            output_root: output_root.into(),
            detail_grid_columns: 128,
            detail_grid_rows: 128,
            max_tiles_per_object: 16,
            target_primitives_per_tile: DEFAULT_TARGET_PRIMITIVES_PER_TILE,
            max_subdivision_depth: DEFAULT_MAX_SUBDIVISION_DEPTH,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PackLayoutPackageResult {
    pub output_root: PathBuf,
    pub detail_tile_count: usize,
    pub overview_tile_count: usize,
    pub primitive_count: usize,
    pub timing: PackTimingStats,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PackTimingStats {
    pub total_ms: f32,
    pub manifest_ms: f32,
    pub layers_ms: f32,
    pub hierarchy_ms: f32,
    pub geometry_ms: f32,
    pub detail_tiles_ms: f32,
    pub overview_tiles_ms: f32,
    pub overview_pyramid_ms: f32,
    pub write_ms: f32,
    pub fingerprint_ms: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LayoutPackageGenerator {
    pub name: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LayoutPackageSource {
    pub kind: &'static str,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LayoutPackageSourceMetadata {
    pub generator: LayoutPackageGenerator,
    pub source: LayoutPackageSource,
}

impl PackTimingStats {
    pub fn summary(&self) -> String {
        format!(
            concat!(
                "total={:.1}ms manifest={:.1}ms layers={:.1}ms hierarchy={:.1}ms ",
                "geometry={:.1}ms detail_tiles={:.1}ms overview_tiles={:.1}ms ",
                "overview_pyramid={:.1}ms write={:.1}ms fingerprint={:.1}ms"
            ),
            self.total_ms,
            self.manifest_ms,
            self.layers_ms,
            self.hierarchy_ms,
            self.geometry_ms,
            self.detail_tiles_ms,
            self.overview_tiles_ms,
            self.overview_pyramid_ms,
            self.write_ms,
            self.fingerprint_ms
        )
    }
}

pub fn viewjson_source_metadata(
    input_root: impl AsRef<Path>,
) -> Result<LayoutPackageSourceMetadata> {
    let root = input_root.as_ref();
    let manifest_path = root.join("manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let source_manifest: ViewJsonManifest = serde_json::from_str(&manifest_text)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    viewjson_source_metadata_from_manifest(root, &source_manifest)
}

fn viewjson_source_metadata_from_manifest(
    root: &Path,
    source_manifest: &ViewJsonManifest,
) -> Result<LayoutPackageSourceMetadata> {
    let fingerprint = source_fingerprint(root, source_manifest)?;
    Ok(LayoutPackageSourceMetadata {
        generator: LayoutPackageGenerator {
            name: LAYOUTPKG_GENERATOR_NAME,
            version: LAYOUTPKG_GENERATOR_VERSION,
        },
        source: LayoutPackageSource {
            kind: "view-json",
            fingerprint,
        },
    })
}

pub fn pack_viewjson_to_layoutpkg(
    options: PackLayoutPackageOptions,
) -> Result<PackLayoutPackageResult> {
    let total_started = Instant::now();
    let mut timing = PackTimingStats::default();
    let manifest_started = Instant::now();
    let manifest_path = options.input_root.join("manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let source_manifest: ViewJsonManifest = serde_json::from_str(&manifest_text)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let world_bbox = match source_manifest.bbox {
        Some(bbox) => bbox,
        None => read_die_bbox(&options.input_root, &source_manifest)?.unwrap_or([0, 0, 0, 0]),
    };
    timing.manifest_ms = elapsed_ms(manifest_started);
    let layers_started = Instant::now();
    let layers = read_layers(&options.input_root, &source_manifest)?;
    timing.layers_ms = elapsed_ms(layers_started);
    let hierarchy_started = Instant::now();
    let hierarchy = build_hierarchy_document(&options.input_root, &source_manifest, world_bbox)?;
    timing.hierarchy_ms = elapsed_ms(hierarchy_started);
    let geometry_started = Instant::now();
    let dataset = collect_geometry_dataset(&options.input_root, &source_manifest, world_bbox)?;
    timing.geometry_ms = elapsed_ms(geometry_started);

    let detail_tiles_started = Instant::now();
    let detail_grid = DetailTileGrid::new(
        world_bbox,
        options.detail_grid_columns,
        options.detail_grid_rows,
    )?;
    let detail_tiles = build_detail_tiles(
        &detail_grid,
        dataset.rects.clone(),
        options.max_tiles_per_object,
        options.target_primitives_per_tile,
        options.max_subdivision_depth,
    );
    timing.detail_tiles_ms = elapsed_ms(detail_tiles_started);

    let overview_tiles_started = Instant::now();
    let overview_grid = DetailTileGrid::new(
        world_bbox,
        DEFAULT_OVERVIEW_GRID_COLUMNS,
        DEFAULT_OVERVIEW_GRID_ROWS,
    )?;
    let overview_tiles = build_overview_tiles(
        &overview_grid,
        &dataset.rects,
        OVERVIEW_COVERAGE_BINS_PER_TILE,
    );
    timing.overview_tiles_ms = elapsed_ms(overview_tiles_started);
    let overview_pyramid_started = Instant::now();
    let overview_pyramid = build_overview_pyramid(world_bbox, &dataset.rects);
    timing.overview_pyramid_ms = elapsed_ms(overview_pyramid_started);
    let write_started = Instant::now();
    recreate_dir(&options.output_root.join("detail"))?;
    recreate_dir(&options.output_root.join("overview"))?;
    recreate_dir(&options.output_root.join("query"))?;
    recreate_dir(&options.output_root.join("dictionaries"))?;
    recreate_dir(&options.output_root.join("hierarchy"))?;

    let mut tile_entries = Vec::new();
    let mut detail_shard = None::<BufWriter<fs::File>>;
    let mut detail_shard_offset = 0_u64;
    for tile in detail_tiles.tiles {
        let mut tile_bytes = Vec::new();
        write_detail_tile(
            &mut tile_bytes,
            &DetailTile {
                rects: tile.rects.clone(),
            },
        )?;
        if detail_shard.is_none() {
            let shard_path = options.output_root.join(DETAIL_TILE_SHARD_FILE);
            let shard_file = fs::File::create(&shard_path)
                .with_context(|| format!("failed to create {}", shard_path.display()))?;
            detail_shard = Some(BufWriter::new(shard_file));
        }
        let byte_offset = detail_shard_offset;
        let byte_size = tile_bytes.len();
        detail_shard
            .as_mut()
            .expect("detail shard writer is initialized before writes")
            .write_all(&tile_bytes)
            .with_context(|| format!("failed to write {}", DETAIL_TILE_SHARD_FILE))?;
        detail_shard_offset = detail_shard_offset
            .checked_add(byte_size as u64)
            .context("detail tile shard offset overflow")?;
        let layers = tile_layers(&tile.rects);
        tile_entries.push(json!({
            "id": detail_tile_id(&tile),
            "lod": 0,
            "subdivision_depth": tile.subdivision_depth,
            "bbox": tile.bbox,
            "file": DETAIL_TILE_SHARD_FILE,
            "byte_offset": byte_offset,
            "byte_size": byte_size,
            "primitive_count": tile.rects.len(),
            "layers": layers,
            "kind_counts": kind_counts_json(&tile.rects),
        }));
    }
    if let Some(mut detail_shard) = detail_shard {
        detail_shard
            .flush()
            .with_context(|| format!("failed to flush {}", DETAIL_TILE_SHARD_FILE))?;
    }
    let large_objects = write_large_objects(&options.output_root, &detail_tiles.large_objects)?;

    let detail_index = json!({
        "schema": DETAIL_INDEX_SCHEMA,
        "version": 1,
        "world_bbox": world_bbox,
        "grid": { "columns": detail_grid.columns, "rows": detail_grid.rows },
        "tiles": tile_entries,
        "large_objects": large_objects,
        "statistics": {
            "primitive_count": dataset.rects.len(),
            "by_kind": kind_counts_json(&dataset.rects),
            "by_layer": layer_counts_json(&dataset.rects),
            "large_object_count": detail_tiles.large_objects.len(),
        },
    });
    write_json_pretty(options.output_root.join("detail/index.json"), &detail_index)?;

    let mut overview_entries = Vec::new();
    for tile in overview_tiles {
        let tile_file = format!("overview/tile_{}_{}.bin", tile.x, tile.y);
        let tile_path = options.output_root.join(&tile_file);
        let mut tile_bytes = Vec::new();
        write_detail_tile(
            &mut tile_bytes,
            &DetailTile {
                rects: tile.rects.clone(),
            },
        )?;
        fs::write(&tile_path, &tile_bytes)
            .with_context(|| format!("failed to write {}", tile_path.display()))?;
        overview_entries.push(json!({
            "id": format!("{}:{}", tile.x, tile.y),
            "lod": 0,
            "bbox": tile.bbox,
            "file": tile_file,
            "byte_size": tile_bytes.len(),
            "primitive_count": tile.rects.len(),
            "layers": tile_layers(&tile.rects),
            "kind_counts": kind_counts_json(&tile.rects),
        }));
    }

    let overview_index = json!({
        "schema": OVERVIEW_INDEX_SCHEMA,
        "version": 1,
        "source_tileset": "detail",
        "world_bbox": world_bbox,
        "grid": { "columns": overview_grid.columns, "rows": overview_grid.rows },
        "coverage_bins_per_tile": OVERVIEW_COVERAGE_BINS_PER_TILE,
        "tiles": overview_entries,
    });
    write_json_pretty(
        options.output_root.join("overview/index.json"),
        &overview_index,
    )?;
    write_overview_pyramid_file(
        options.output_root.join("overview/pyramid.bin"),
        &overview_pyramid,
    )?;

    let query_index = json!({
        "schema": QUERY_INDEX_SCHEMA,
        "version": 1,
        "source_tileset": "detail",
        "storage": "reuse_detail_records",
        "queryable_kinds": queryable_kind_keys(),
        "world_bbox": world_bbox,
        "grid": { "columns": detail_grid.columns, "rows": detail_grid.rows },
        "tiles": "detail/index.json#/tiles",
        "large_objects": "detail/index.json#/large_objects",
    });
    write_json_pretty(options.output_root.join("query/index.json"), &query_index)?;
    write_json_pretty(
        options.output_root.join("hierarchy/cells.json"),
        &serde_json::to_value(&hierarchy)?,
    )?;

    let layers_dict = json!({
        "schema": "ecos.layoutpkg.layers.v1",
        "layers": layers,
    });
    write_json_pretty(
        options.output_root.join("dictionaries/layers.json"),
        &layers_dict,
    )?;
    let grid_overlays = json!({
        "schema": "ecos.layoutpkg.grid_overlays.v1",
        "tracks": dataset.tracks,
        "gcell_grids": dataset.gcell_grids,
    });
    write_json_pretty(
        options.output_root.join("dictionaries/grid_overlays.json"),
        &grid_overlays,
    )?;

    let tilesets = json!({
        "detail": "detail/index.json",
        "overview": "overview/index.json",
        "query": "query/index.json",
        "overview_pyramid": "overview/pyramid.bin",
    });
    let fingerprint_started = Instant::now();
    let source_metadata =
        viewjson_source_metadata_from_manifest(&options.input_root, &source_manifest)?;
    timing.fingerprint_ms = elapsed_ms(fingerprint_started);
    let manifest = json!({
        "schema": LAYOUTPKG_SCHEMA,
        "version": 1,
        "generator": source_metadata.generator,
        "design_name": source_manifest.design_name.as_deref().unwrap_or("layout"),
        "dbu_per_micron": source_manifest.unit.as_ref().and_then(|unit| unit.dbu_per_micron).unwrap_or(1000),
        "world_bbox": world_bbox,
        "source": {
            "kind": source_metadata.source.kind,
            "root": options.input_root.to_string_lossy(),
            "fingerprint": source_metadata.source.fingerprint,
        },
        "dictionaries": {
            "layers": "dictionaries/layers.json",
            "grid_overlays": "dictionaries/grid_overlays.json",
        },
        "capabilities": {
            "detail_tiles": true,
            "overview_tiles": true,
            "query_tiles": true,
            "large_objects": !detail_tiles.large_objects.is_empty(),
            "source_view_json_fallback": true,
            "cell_layer_summaries": true,
            "overview_pyramid": true,
            "detail_scope": false,
        },
        "tilesets": tilesets,
        "hierarchy": {
            "cells": "hierarchy/cells.json",
        },
        "statistics": {
            "primitive_count": dataset.rects.len(),
            "by_kind": kind_counts_json(&dataset.rects),
            "by_layer": layer_counts_json(&dataset.rects),
            "source_files": dataset.source_files,
        },
    });
    write_json_pretty(options.output_root.join("manifest.json"), &manifest)?;
    timing.write_ms = elapsed_ms(write_started);
    timing.total_ms = elapsed_ms(total_started);

    Ok(PackLayoutPackageResult {
        output_root: options.output_root,
        detail_tile_count: tile_entries.len(),
        overview_tile_count: overview_entries.len(),
        primitive_count: dataset.rects.len(),
        timing,
    })
}

fn elapsed_ms(started: Instant) -> f32 {
    started.elapsed().as_secs_f32() * 1_000.0
}

#[derive(Debug, Clone, Deserialize)]
struct ViewJsonManifest {
    design_name: Option<String>,
    unit: Option<ViewJsonUnit>,
    bbox: Option<[i32; 4]>,
    files: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ViewJsonUnit {
    dbu_per_micron: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LayoutLayer {
    id: u16,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    layer_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    direction: Option<String>,
}

#[derive(Debug, Clone)]
struct DetailTileGrid {
    world_bbox: [i32; 4],
    columns: usize,
    rows: usize,
    tile_width: f64,
    tile_height: f64,
}

#[derive(Debug, Clone)]
struct DetailTileBucket {
    x: usize,
    y: usize,
    subdivision_depth: usize,
    bbox: [i32; 4],
    rects: Vec<LayoutRectRecord>,
}

#[derive(Debug, Clone)]
struct DetailTiles {
    tiles: Vec<DetailTileBucket>,
    large_objects: Vec<LayoutRectRecord>,
}

#[derive(Debug, Clone)]
struct GeometryDataset {
    rects: Vec<LayoutRectRecord>,
    source_files: BTreeMap<String, usize>,
    tracks: Vec<Value>,
    gcell_grids: Vec<Value>,
}

impl DetailTileGrid {
    fn new(world_bbox: [i32; 4], columns: usize, rows: usize) -> Result<Self> {
        if columns == 0 || rows == 0 {
            bail!("detail tile grid must have at least one column and row");
        }
        let width = (world_bbox[2] - world_bbox[0]).max(1) as f64;
        let height = (world_bbox[3] - world_bbox[1]).max(1) as f64;
        Ok(Self {
            world_bbox,
            columns,
            rows,
            tile_width: width / columns as f64,
            tile_height: height / rows as f64,
        })
    }

    fn tile_bbox(&self, x: usize, y: usize) -> [i32; 4] {
        let lx = self.world_bbox[0] as f64 + self.tile_width * x as f64;
        let ly = self.world_bbox[1] as f64 + self.tile_height * y as f64;
        let ux = if x + 1 == self.columns {
            self.world_bbox[2]
        } else {
            (self.world_bbox[0] as f64 + self.tile_width * (x + 1) as f64).round() as i32
        };
        let uy = if y + 1 == self.rows {
            self.world_bbox[3]
        } else {
            (self.world_bbox[1] as f64 + self.tile_height * (y + 1) as f64).round() as i32
        };
        [lx.round() as i32, ly.round() as i32, ux, uy]
    }

    fn tile_range_for_rect(&self, rect: &LayoutRectRecord) -> (usize, usize, usize, usize) {
        let x0 = self.tile_x_for_coord(rect.x1);
        let x1 = self.tile_x_for_coord(rect.x2.saturating_sub(1));
        let y0 = self.tile_y_for_coord(rect.y1);
        let y1 = self.tile_y_for_coord(rect.y2.saturating_sub(1));
        (x0.min(x1), x0.max(x1), y0.min(y1), y0.max(y1))
    }

    fn tile_x_for_coord(&self, value: i32) -> usize {
        let local = (value - self.world_bbox[0]) as f64;
        let raw = (local / self.tile_width).floor() as isize;
        raw.clamp(0, self.columns as isize - 1) as usize
    }

    fn tile_y_for_coord(&self, value: i32) -> usize {
        let local = (value - self.world_bbox[1]) as f64;
        let raw = (local / self.tile_height).floor() as isize;
        raw.clamp(0, self.rows as isize - 1) as usize
    }
}

fn build_detail_tiles(
    grid: &DetailTileGrid,
    rects: Vec<LayoutRectRecord>,
    max_tiles_per_object: usize,
    target_primitives_per_tile: usize,
    max_subdivision_depth: usize,
) -> DetailTiles {
    let mut buckets: BTreeMap<(usize, usize), Vec<LayoutRectRecord>> = BTreeMap::new();
    let mut large_objects = Vec::new();
    for rect in rects {
        let (x0, x1, y0, y1) = grid.tile_range_for_rect(&rect);
        let intersected_tile_count = (x1 - x0 + 1) * (y1 - y0 + 1);
        if is_shared_geometry(rect.kind)
            || (max_tiles_per_object > 0 && intersected_tile_count > max_tiles_per_object)
        {
            large_objects.push(rect);
            continue;
        }
        for y in y0..=y1 {
            for x in x0..=x1 {
                if let Some(clipped) = clip_rect_to_bbox(&rect, grid.tile_bbox(x, y)) {
                    buckets.entry((x, y)).or_default().push(clipped);
                }
            }
        }
    }
    let mut tiles = Vec::new();
    for ((x, y), rects) in buckets {
        let bbox = grid.tile_bbox(x, y);
        subdivide_detail_bucket(
            x,
            y,
            bbox,
            rects,
            0,
            target_primitives_per_tile,
            max_subdivision_depth,
            &mut tiles,
        );
    }
    sort_detail_tiles(&mut tiles);
    DetailTiles {
        tiles,
        large_objects,
    }
}

fn subdivide_detail_bucket(
    x: usize,
    y: usize,
    bbox: [i32; 4],
    rects: Vec<LayoutRectRecord>,
    depth: usize,
    target_primitives_per_tile: usize,
    max_depth: usize,
    output: &mut Vec<DetailTileBucket>,
) {
    if rects.is_empty() {
        return;
    }
    let should_keep = target_primitives_per_tile == 0
        || rects.len() <= target_primitives_per_tile
        || depth >= max_depth
        || bbox[2] - bbox[0] <= 1
        || bbox[3] - bbox[1] <= 1;
    if should_keep {
        output.push(DetailTileBucket {
            x,
            y,
            subdivision_depth: depth,
            bbox,
            rects,
        });
        return;
    }

    let mid_x = bbox[0] + (bbox[2] - bbox[0]) / 2;
    let mid_y = bbox[1] + (bbox[3] - bbox[1]) / 2;
    let child_bboxes = [
        [bbox[0], bbox[1], mid_x, mid_y],
        [mid_x, bbox[1], bbox[2], mid_y],
        [bbox[0], mid_y, mid_x, bbox[3]],
        [mid_x, mid_y, bbox[2], bbox[3]],
    ];
    let original_rects = rects.clone();
    let mut children = [
        Vec::<LayoutRectRecord>::new(),
        Vec::<LayoutRectRecord>::new(),
        Vec::<LayoutRectRecord>::new(),
        Vec::<LayoutRectRecord>::new(),
    ];
    for rect in rects {
        for (index, child_bbox) in child_bboxes.iter().enumerate() {
            if let Some(clipped) = clip_rect_to_bbox(&rect, *child_bbox) {
                children[index].push(clipped);
            }
        }
    }
    let largest_child = children.iter().map(Vec::len).max().unwrap_or(0);
    let total_child_records = children.iter().map(Vec::len).sum::<usize>();
    let split_does_not_reduce_peak = largest_child >= original_rects.len();
    let split_amplifies_too_much = total_child_records > original_rects.len() * 2
        && largest_child > target_primitives_per_tile
        && largest_child > original_rects.len() * 3 / 4;
    if split_does_not_reduce_peak || split_amplifies_too_much {
        output.push(DetailTileBucket {
            x,
            y,
            subdivision_depth: depth,
            bbox,
            rects: original_rects,
        });
        return;
    }
    for (index, child_rects) in children.into_iter().enumerate() {
        if child_rects.is_empty() {
            continue;
        }
        subdivide_detail_bucket(
            x * 2 + index % 2,
            y * 2 + index / 2,
            child_bboxes[index],
            child_rects,
            depth + 1,
            target_primitives_per_tile,
            max_depth,
            output,
        );
    }
}

fn detail_tile_id(tile: &DetailTileBucket) -> String {
    if tile.subdivision_depth == 0 {
        format!("{}:{}", tile.x, tile.y)
    } else {
        format!("{}:{}@{}", tile.x, tile.y, tile.subdivision_depth)
    }
}

fn sort_detail_tiles(tiles: &mut [DetailTileBucket]) {
    tiles.sort_by_key(|tile| {
        (
            tile.subdivision_depth,
            tile.y,
            tile.x,
            tile.bbox[0],
            tile.bbox[1],
        )
    });
}

fn is_shared_geometry(kind: LayoutObjectKind) -> bool {
    matches!(kind, LayoutObjectKind::Die | LayoutObjectKind::Core)
}

fn build_overview_tiles(
    grid: &DetailTileGrid,
    rects: &[LayoutRectRecord],
    bins_per_tile: usize,
) -> Vec<DetailTileBucket> {
    let mut tiles = Vec::new();
    for y in 0..grid.rows {
        for x in 0..grid.columns {
            let tile_bbox = grid.tile_bbox(x, y);
            let mut bins: BTreeMap<(usize, usize, u16, LayoutObjectKind), LayoutRectRecord> =
                BTreeMap::new();
            for rect in rects {
                let Some(clipped_to_tile) = clip_rect_to_bbox(rect, tile_bbox) else {
                    continue;
                };
                let bin_bbox = overview_bin_bbox(tile_bbox, &clipped_to_tile, bins_per_tile);
                let bin_key = (
                    bin_bbox.0,
                    bin_bbox.1,
                    clipped_to_tile.layer_id,
                    clipped_to_tile.kind,
                );
                let rect_bbox = overview_bin_rect(tile_bbox, bin_bbox.0, bin_bbox.1, bins_per_tile);
                bins.entry(bin_key).or_insert(LayoutRectRecord {
                    x1: rect_bbox[0],
                    y1: rect_bbox[1],
                    x2: rect_bbox[2],
                    y2: rect_bbox[3],
                    layer_id: clipped_to_tile.layer_id,
                    kind: clipped_to_tile.kind,
                    flags: 0,
                    source_id: 0,
                });
            }
            if !bins.is_empty() {
                tiles.push(DetailTileBucket {
                    x,
                    y,
                    subdivision_depth: 0,
                    bbox: tile_bbox,
                    rects: bins.into_values().collect(),
                });
            }
        }
    }
    tiles
}

fn build_overview_pyramid(
    world_bbox: [i32; 4],
    rects: &[LayoutRectRecord],
) -> OverviewPyramidDocument {
    let width = (world_bbox[2] as i64)
        .saturating_sub(world_bbox[0] as i64)
        .max(1);
    let height = (world_bbox[3] as i64)
        .saturating_sub(world_bbox[1] as i64)
        .max(1);
    let normalized_world_bbox = [
        world_bbox[0],
        world_bbox[1],
        world_bbox[0].saturating_add(width.min(i32::MAX as i64) as i32),
        world_bbox[1].saturating_add(height.min(i32::MAX as i64) as i32),
    ];

    let levels = OVERVIEW_PYRAMID_BIN_SIZES
        .iter()
        .enumerate()
        .map(|(level_index, units_per_bin)| {
            let units = (*units_per_bin).max(1) as i64;
            let columns = div_ceil_i64(width, units).clamp(1, u32::MAX as i64) as u32;
            let rows = div_ceil_i64(height, units).clamp(1, u32::MAX as i64) as u32;
            let mut bins: BTreeMap<(u32, u32, u16, LayoutObjectKind), OverviewBinAccumulator> =
                BTreeMap::new();

            for rect in rects {
                if is_overview_pyramid_background_kind(rect.kind) {
                    continue;
                }
                let Some(clipped_to_world) = clip_rect_to_bbox(rect, normalized_world_bbox) else {
                    continue;
                };
                let x0 = pyramid_bin_index(
                    clipped_to_world.x1,
                    normalized_world_bbox[0],
                    units,
                    columns,
                );
                let x1 = pyramid_bin_index(
                    clipped_to_world.x2.saturating_sub(1),
                    normalized_world_bbox[0],
                    units,
                    columns,
                );
                let y0 =
                    pyramid_bin_index(clipped_to_world.y1, normalized_world_bbox[1], units, rows);
                let y1 = pyramid_bin_index(
                    clipped_to_world.y2.saturating_sub(1),
                    normalized_world_bbox[1],
                    units,
                    rows,
                );
                let touched_columns = (x1 - x0 + 1) as u64;
                let touched_rows = (y1 - y0 + 1) as u64;
                if touched_columns.saturating_mul(touched_rows)
                    > OVERVIEW_PYRAMID_MAX_BINS_PER_RECT_PER_LEVEL
                {
                    let bin_x = (x0 as u64 + x1 as u64) / 2;
                    let bin_y = (y0 as u64 + y1 as u64) / 2;
                    let bin_bbox = pyramid_bin_bbox(
                        normalized_world_bbox,
                        units,
                        columns,
                        rows,
                        bin_x.min(u32::MAX as u64) as u32,
                        bin_y.min(u32::MAX as u64) as u32,
                    );
                    let area = rect_area(
                        clipped_to_world.x1,
                        clipped_to_world.y1,
                        clipped_to_world.x2,
                        clipped_to_world.y2,
                    );
                    if area > 0 {
                        add_overview_pyramid_bin(
                            &mut bins,
                            bin_x as u32,
                            bin_y as u32,
                            rect,
                            bin_bbox,
                            area,
                        );
                    }
                    continue;
                }

                for bin_y in y0..=y1 {
                    for bin_x in x0..=x1 {
                        let bin_bbox = pyramid_bin_bbox(
                            normalized_world_bbox,
                            units,
                            columns,
                            rows,
                            bin_x,
                            bin_y,
                        );
                        let Some(clipped_to_bin) = clip_rect_to_bbox(&clipped_to_world, bin_bbox)
                        else {
                            continue;
                        };
                        let area = rect_area(
                            clipped_to_bin.x1,
                            clipped_to_bin.y1,
                            clipped_to_bin.x2,
                            clipped_to_bin.y2,
                        );
                        if area <= 0 {
                            continue;
                        }
                        add_overview_pyramid_bin(&mut bins, bin_x, bin_y, rect, bin_bbox, area);
                    }
                }
            }

            let bins = bins
                .into_iter()
                .map(|((_, _, layer_id, kind), accumulator)| OverviewBinRecord {
                    bbox: accumulator.bbox,
                    layer_id,
                    kind,
                    count: accumulator.count,
                    coverage_area: accumulator.coverage_area,
                })
                .collect();

            OverviewLevel {
                level: level_index.min(u32::MAX as usize) as u32,
                units_per_bin: *units_per_bin,
                grid: [columns, rows],
                bins,
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

fn is_overview_pyramid_background_kind(kind: LayoutObjectKind) -> bool {
    !matches!(
        kind,
        LayoutObjectKind::RegularWire
            | LayoutObjectKind::SpecialWire
            | LayoutObjectKind::Via
            | LayoutObjectKind::IoPin
            | LayoutObjectKind::Blockage
            | LayoutObjectKind::Fill
    )
}

fn add_overview_pyramid_bin(
    bins: &mut BTreeMap<(u32, u32, u16, LayoutObjectKind), OverviewBinAccumulator>,
    bin_x: u32,
    bin_y: u32,
    rect: &LayoutRectRecord,
    bin_bbox: [i32; 4],
    coverage_area: i64,
) {
    let key = (bin_x, bin_y, rect.layer_id, rect.kind);
    let accumulator = bins.entry(key).or_insert_with(|| OverviewBinAccumulator {
        bbox: bin_bbox,
        count: 0,
        coverage_area: 0,
    });
    accumulator.count = accumulator.count.saturating_add(1);
    accumulator.coverage_area = accumulator.coverage_area.saturating_add(coverage_area);
}

#[derive(Debug, Clone)]
struct OverviewBinAccumulator {
    bbox: [i32; 4],
    count: u32,
    coverage_area: i64,
}

fn div_ceil_i64(value: i64, divisor: i64) -> i64 {
    if value <= 0 {
        0
    } else {
        (value - 1) / divisor + 1
    }
}

fn pyramid_bin_index(value: i32, origin: i32, units_per_bin: i64, limit: u32) -> u32 {
    let local = (value as i64).saturating_sub(origin as i64);
    let raw = local.div_euclid(units_per_bin);
    raw.clamp(0, limit.saturating_sub(1) as i64) as u32
}

fn pyramid_bin_bbox(
    world_bbox: [i32; 4],
    units_per_bin: i64,
    columns: u32,
    rows: u32,
    bin_x: u32,
    bin_y: u32,
) -> [i32; 4] {
    let x1 = (world_bbox[0] as i64)
        .saturating_add(units_per_bin.saturating_mul(bin_x as i64))
        .clamp(i32::MIN as i64, i32::MAX as i64) as i32;
    let y1 = (world_bbox[1] as i64)
        .saturating_add(units_per_bin.saturating_mul(bin_y as i64))
        .clamp(i32::MIN as i64, i32::MAX as i64) as i32;
    let x2 = if bin_x + 1 == columns {
        world_bbox[2]
    } else {
        (world_bbox[0] as i64)
            .saturating_add(units_per_bin.saturating_mul(bin_x as i64 + 1))
            .clamp(i32::MIN as i64, i32::MAX as i64) as i32
    };
    let y2 = if bin_y + 1 == rows {
        world_bbox[3]
    } else {
        (world_bbox[1] as i64)
            .saturating_add(units_per_bin.saturating_mul(bin_y as i64 + 1))
            .clamp(i32::MIN as i64, i32::MAX as i64) as i32
    };
    [x1, y1, x2, y2]
}

fn overview_bin_bbox(
    tile_bbox: [i32; 4],
    rect: &LayoutRectRecord,
    bins_per_tile: usize,
) -> (usize, usize) {
    let width = (tile_bbox[2] - tile_bbox[0]).max(1) as f64;
    let height = (tile_bbox[3] - tile_bbox[1]).max(1) as f64;
    let cx = rect.x1 as f64 + (rect.x2 - rect.x1) as f64 / 2.0;
    let cy = rect.y1 as f64 + (rect.y2 - rect.y1) as f64 / 2.0;
    let bx = (((cx - tile_bbox[0] as f64) / width) * bins_per_tile as f64).floor() as isize;
    let by = (((cy - tile_bbox[1] as f64) / height) * bins_per_tile as f64).floor() as isize;
    (
        bx.clamp(0, bins_per_tile as isize - 1) as usize,
        by.clamp(0, bins_per_tile as isize - 1) as usize,
    )
}

fn overview_bin_rect(
    tile_bbox: [i32; 4],
    bin_x: usize,
    bin_y: usize,
    bins_per_tile: usize,
) -> [i32; 4] {
    let width = (tile_bbox[2] - tile_bbox[0]).max(1) as f64 / bins_per_tile as f64;
    let height = (tile_bbox[3] - tile_bbox[1]).max(1) as f64 / bins_per_tile as f64;
    let x1 = tile_bbox[0] as f64 + width * bin_x as f64;
    let y1 = tile_bbox[1] as f64 + height * bin_y as f64;
    let x2 = if bin_x + 1 == bins_per_tile {
        tile_bbox[2]
    } else {
        (tile_bbox[0] as f64 + width * (bin_x + 1) as f64).round() as i32
    };
    let y2 = if bin_y + 1 == bins_per_tile {
        tile_bbox[3]
    } else {
        (tile_bbox[1] as f64 + height * (bin_y + 1) as f64).round() as i32
    };
    [x1.round() as i32, y1.round() as i32, x2, y2]
}

fn clip_rect_to_bbox(rect: &LayoutRectRecord, bbox: [i32; 4]) -> Option<LayoutRectRecord> {
    let x1 = rect.x1.max(bbox[0]);
    let y1 = rect.y1.max(bbox[1]);
    let x2 = rect.x2.min(bbox[2]);
    let y2 = rect.y2.min(bbox[3]);
    if x1 >= x2 || y1 >= y2 {
        return None;
    }
    Some(LayoutRectRecord {
        x1,
        y1,
        x2,
        y2,
        layer_id: rect.layer_id,
        kind: rect.kind,
        flags: rect.flags,
        source_id: rect.source_id,
    })
}

fn tile_layers(rects: &[LayoutRectRecord]) -> Vec<u16> {
    let mut layers = rects.iter().map(|rect| rect.layer_id).collect::<Vec<_>>();
    layers.sort_unstable();
    layers.dedup();
    layers
}

fn kind_counts_json(rects: &[LayoutRectRecord]) -> Value {
    let mut counts = BTreeMap::<String, usize>::new();
    for rect in rects {
        *counts.entry(kind_key(rect.kind).to_string()).or_default() += 1;
    }
    json!(counts)
}

fn layer_counts_json(rects: &[LayoutRectRecord]) -> Value {
    let mut counts = BTreeMap::<u16, usize>::new();
    for rect in rects {
        if rect.layer_id > 0 {
            *counts.entry(rect.layer_id).or_default() += 1;
        }
    }
    json!(counts)
}

fn kind_key(kind: LayoutObjectKind) -> &'static str {
    match kind {
        LayoutObjectKind::Die => "die",
        LayoutObjectKind::Core => "core",
        LayoutObjectKind::Instance => "instance",
        LayoutObjectKind::RegularWire => "regular_wire",
        LayoutObjectKind::SpecialWire => "special_wire",
        LayoutObjectKind::Via => "via",
        LayoutObjectKind::IoPin => "io_pin",
        LayoutObjectKind::Blockage => "blockage",
        LayoutObjectKind::Fill => "fill",
        LayoutObjectKind::Region => "region",
        LayoutObjectKind::Row => "row",
        LayoutObjectKind::Track => "track",
        LayoutObjectKind::GCellGrid => "gcell_grid",
    }
}

fn queryable_kind_keys() -> Vec<&'static str> {
    [
        LayoutObjectKind::Instance,
        LayoutObjectKind::RegularWire,
        LayoutObjectKind::SpecialWire,
        LayoutObjectKind::Via,
        LayoutObjectKind::IoPin,
        LayoutObjectKind::Blockage,
        LayoutObjectKind::Fill,
        LayoutObjectKind::Region,
    ]
    .into_iter()
    .filter(|kind| kind.is_queryable())
    .map(kind_key)
    .collect()
}

fn recreate_dir(path: &Path) -> Result<()> {
    if path.exists() {
        fs::remove_dir_all(path).with_context(|| format!("failed to remove {}", path.display()))?;
    }
    fs::create_dir_all(path).with_context(|| format!("failed to create {}", path.display()))
}

fn write_large_objects(output_root: &Path, rects: &[LayoutRectRecord]) -> Result<Value> {
    write_binary_rects(output_root, "detail/large_objects.bin", rects)
}

fn write_binary_rects(output_root: &Path, file: &str, rects: &[LayoutRectRecord]) -> Result<Value> {
    if rects.is_empty() {
        return Ok(Value::Null);
    }
    let path = output_root.join(file);
    let mut bytes = Vec::new();
    write_detail_tile(
        &mut bytes,
        &DetailTile {
            rects: rects.to_vec(),
        },
    )?;
    fs::write(&path, &bytes).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(json!({
        "file": file,
        "count": rects.len(),
        "byte_size": bytes.len(),
    }))
}

fn write_overview_pyramid_file(path: PathBuf, pyramid: &OverviewPyramidDocument) -> Result<()> {
    let parent = path.parent().context("output path has no parent")?;
    fs::create_dir_all(parent)?;
    let mut bytes = Vec::new();
    write_overview_pyramid(&mut bytes, pyramid)?;
    fs::write(&path, bytes).with_context(|| format!("failed to write {}", path.display()))
}

fn write_json_pretty(path: PathBuf, value: &Value) -> Result<()> {
    let parent = path.parent().context("output path has no parent")?;
    fs::create_dir_all(parent)?;
    fs::write(&path, serde_json::to_vec_pretty(value)?)
        .with_context(|| format!("failed to write {}", path.display()))
}

fn package_file(root: &Path, manifest: &ViewJsonManifest, key: &str) -> Option<PathBuf> {
    manifest.files.get(key).map(|relative| root.join(relative))
}

fn read_json_file(path: &Path) -> Result<Value> {
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("failed to parse {}", path.display()))
}

fn for_each_data_item(
    root: &Path,
    manifest: &ViewJsonManifest,
    key: &str,
    mut visit: impl FnMut(Value) -> Result<()>,
) -> Result<usize> {
    let Some(path) = package_file(root, manifest, key) else {
        return Ok(0);
    };
    let file =
        fs::File::open(&path).with_context(|| format!("failed to open {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut seed = DataArraySeed {
        key,
        count: 0,
        visit: &mut visit,
    };
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    seed.deserialize(&mut deserializer)
        .with_context(|| format!("failed to parse data array in {}", path.display()))
}

struct DataArraySeed<'a, F>
where
    F: FnMut(Value) -> Result<()>,
{
    key: &'a str,
    count: usize,
    visit: &'a mut F,
}

impl<'de, 'a, F> DeserializeSeed<'de> for &'a mut DataArraySeed<'_, F>
where
    F: FnMut(Value) -> Result<()>,
{
    type Value = usize;

    fn deserialize<D>(self, deserializer: D) -> std::result::Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(DataMapVisitor { seed: self })
    }
}

struct DataMapVisitor<'a, 'seed, F>
where
    F: FnMut(Value) -> Result<()>,
{
    seed: &'a mut DataArraySeed<'seed, F>,
}

impl<'de, F> Visitor<'de> for DataMapVisitor<'_, '_, F>
where
    F: FnMut(Value) -> Result<()>,
{
    type Value = usize;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("view json object with a data array")
    }

    fn visit_map<A>(self, mut map: A) -> std::result::Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut saw_data = false;
        while let Some(key) = map.next_key::<String>()? {
            if key == "data" {
                saw_data = true;
                map.next_value_seed(DataSeqSeed {
                    seed: &mut *self.seed,
                })?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        if !saw_data {
            return Err(A::Error::custom(format!(
                "{} data field must be present",
                self.seed.key
            )));
        }
        Ok(self.seed.count)
    }
}

struct DataSeqSeed<'a, 'seed, F>
where
    F: FnMut(Value) -> Result<()>,
{
    seed: &'a mut DataArraySeed<'seed, F>,
}

impl<'de, F> DeserializeSeed<'de> for DataSeqSeed<'_, '_, F>
where
    F: FnMut(Value) -> Result<()>,
{
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> std::result::Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_seq(DataSeqVisitor { seed: self.seed })
    }
}

struct DataSeqVisitor<'a, 'seed, F>
where
    F: FnMut(Value) -> Result<()>,
{
    seed: &'a mut DataArraySeed<'seed, F>,
}

impl<'de, F> Visitor<'de> for DataSeqVisitor<'_, '_, F>
where
    F: FnMut(Value) -> Result<()>,
{
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("data array")
    }

    fn visit_seq<A>(self, mut seq: A) -> std::result::Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while let Some(item) = seq.next_element::<Value>()? {
            (self.seed.visit)(item).map_err(A::Error::custom)?;
            self.seed.count += 1;
        }
        Ok(())
    }
}

fn read_die_bbox(root: &Path, manifest: &ViewJsonManifest) -> Result<Option<[i32; 4]>> {
    let Some(path) = package_file(root, manifest, "die") else {
        return Ok(None);
    };
    let value = read_json_file(&path)?;
    Ok(value.get("data").and_then(|data| {
        data.get("die_area")
            .and_then(parse_bbox)
            .or_else(|| data.get("bbox").and_then(parse_bbox))
    }))
}

fn read_layers(root: &Path, manifest: &ViewJsonManifest) -> Result<Vec<LayoutLayer>> {
    let Some(path) = package_file(root, manifest, "layers") else {
        return Ok(Vec::new());
    };
    let value = read_json_file(&path)?;
    let data = value.get("data").cloned().unwrap_or(Value::Null);
    let Some(items) = data.as_array() else {
        bail!("layers data must be an array");
    };
    let mut layers = Vec::new();
    for item in items {
        let Some(id) = item.get("id").and_then(Value::as_u64) else {
            continue;
        };
        if id > u16::MAX as u64 {
            continue;
        }
        layers.push(LayoutLayer {
            id: id as u16,
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("layer")
                .to_string(),
            layer_type: item.get("type").and_then(Value::as_str).map(str::to_string),
            direction: item
                .get("direction")
                .and_then(Value::as_str)
                .map(str::to_string),
        });
    }
    Ok(layers)
}

fn build_hierarchy_document(
    root: &Path,
    manifest: &ViewJsonManifest,
    world_bbox: [i32; 4],
) -> Result<HierarchyDocument> {
    let mut cells = Vec::new();
    let top_cell_id = 0;
    let mut top_cell = HierarchyCell {
        id: top_cell_id,
        name: manifest
            .design_name
            .clone()
            .unwrap_or_else(|| "top".to_string()),
        bbox: world_bbox,
        shapes: Vec::new(),
        instances: Vec::new(),
        layer_summaries: Vec::new(),
        hierarchy_summary: CellHierarchySummary::default(),
    };

    let master_cells = read_master_cells(root, manifest)?;
    for cell in master_cells {
        cells.push(cell);
    }

    for_each_data_item(root, manifest, "instances", |item| {
        let Some(master_id) = item.get("master_id").and_then(Value::as_u64) else {
            return Ok(());
        };
        let Some(bbox) = item.get("bbox").and_then(parse_bbox) else {
            return Ok(());
        };
        let origin = item
            .get("origin")
            .and_then(parse_point)
            .unwrap_or([bbox[0], bbox[1]]);
        let orient = item
            .get("orient")
            .and_then(Value::as_str)
            .map(parse_orientation)
            .unwrap_or(Orientation::Unknown);
        top_cell.instances.push(HierarchyInstance {
            id: source_id(&item),
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            child_cell: master_cell_id(master_id as u32),
            transform: Transform {
                dx: origin[0],
                dy: origin[1],
                orient,
            },
            array: parse_cell_array(&item),
            bbox,
            source_id: source_id(&item),
        });
        Ok(())
    })?;

    top_cell.layer_summaries = cell_layer_summaries(&top_cell.shapes);
    top_cell.hierarchy_summary = cell_hierarchy_summary(&top_cell.instances);
    cells.insert(0, top_cell);
    Ok(HierarchyDocument {
        schema: HIERARCHY_SCHEMA.to_string(),
        version: 2,
        top_cell: top_cell_id,
        cells,
    })
}

fn read_master_cells(root: &Path, manifest: &ViewJsonManifest) -> Result<Vec<HierarchyCell>> {
    let Some(path) = package_file(root, manifest, "cell_masters") else {
        return Ok(Vec::new());
    };
    let value = read_json_file(&path)?;
    let Some(items) = value.get("data").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut cells = Vec::new();
    for item in items {
        let Some(master_id) = item.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let size = item.get("size").and_then(parse_point).unwrap_or([0, 0]);
        let bbox = [0, 0, size[0].max(0), size[1].max(0)];
        let mut cell = HierarchyCell {
            id: master_cell_id(master_id as u32),
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("cell")
                .to_string(),
            bbox,
            shapes: Vec::new(),
            instances: Vec::new(),
            layer_summaries: Vec::new(),
            hierarchy_summary: CellHierarchySummary::default(),
        };
        if let Some(pins) = item.get("pins").and_then(Value::as_array) {
            for pin in pins {
                collect_port_shapes(pin, &mut cell.shapes, master_id as u32);
            }
        }
        cell.layer_summaries = cell_layer_summaries(&cell.shapes);
        cell.hierarchy_summary = cell_hierarchy_summary(&cell.instances);
        cells.push(cell);
    }
    Ok(cells)
}

fn cell_layer_summaries(shapes: &[HierarchyShape]) -> Vec<CellLayerSummary> {
    let mut summaries: BTreeMap<(u16, LayoutObjectKind), CellLayerSummary> = BTreeMap::new();
    for shape in shapes {
        let entry = summaries
            .entry((shape.layer_id, shape.kind))
            .or_insert(CellLayerSummary {
                layer_id: shape.layer_id,
                kind: shape.kind,
                bbox: shape.bbox,
                shape_count: 0,
                total_area: 0,
            });
        entry.bbox = merge_bbox(entry.bbox, shape.bbox);
        entry.shape_count = entry.shape_count.saturating_add(1);
        entry.total_area = entry.total_area.saturating_add(rect_area(
            shape.bbox[0],
            shape.bbox[1],
            shape.bbox[2],
            shape.bbox[3],
        ));
    }
    summaries.into_values().collect()
}

fn cell_hierarchy_summary(instances: &[HierarchyInstance]) -> CellHierarchySummary {
    let direct_instance_count = instances.len().min(u32::MAX as usize) as u32;
    let mut direct_array_count = 0u32;
    let mut expanded_array_element_count = 0u64;
    for instance in instances {
        if instance.array.columns > 1 || instance.array.rows > 1 {
            direct_array_count = direct_array_count.saturating_add(1);
        }
        let columns = instance.array.columns.max(1) as u64;
        let rows = instance.array.rows.max(1) as u64;
        expanded_array_element_count =
            expanded_array_element_count.saturating_add(columns.saturating_mul(rows));
    }
    CellHierarchySummary {
        direct_instance_count,
        direct_array_count,
        expanded_array_element_count,
    }
}

fn parse_cell_array(item: &Value) -> CellArray {
    let explicit_array = item
        .get("array")
        .or_else(|| item.get("repetition"))
        .or_else(|| item.get("repeat"));
    let array = explicit_array.unwrap_or(item);
    let default = CellArray::default();
    CellArray {
        columns: u32_field(array, &["columns", "cols", "nx", "column_count"])
            .or_else(|| u32_field(item, &["columns", "cols", "nx", "column_count"]))
            .unwrap_or(default.columns)
            .max(1),
        rows: u32_field(array, &["rows", "ny", "row_count"])
            .or_else(|| u32_field(item, &["rows", "ny", "row_count"]))
            .unwrap_or(default.rows)
            .max(1),
        step_x: explicit_array
            .and_then(|array| i32_field(array, &["step_x", "x_step", "dx"]))
            .or_else(|| i32_field(item, &["step_x", "x_step"]))
            .unwrap_or(default.step_x),
        step_y: explicit_array
            .and_then(|array| i32_field(array, &["step_y", "y_step", "dy"]))
            .or_else(|| i32_field(item, &["step_y", "y_step"]))
            .unwrap_or(default.step_y),
    }
}

fn u32_field(item: &Value, keys: &[&str]) -> Option<u32> {
    keys.iter()
        .filter_map(|key| item.get(*key))
        .find_map(Value::as_u64)
        .map(|value| value.min(u32::MAX as u64) as u32)
}

fn i32_field(item: &Value, keys: &[&str]) -> Option<i32> {
    keys.iter()
        .filter_map(|key| item.get(*key))
        .find_map(Value::as_i64)
        .map(|value| value.clamp(i32::MIN as i64, i32::MAX as i64) as i32)
}

fn merge_bbox(a: [i32; 4], b: [i32; 4]) -> [i32; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}

fn rect_area(x1: i32, y1: i32, x2: i32, y2: i32) -> i64 {
    let width = (x2 as i64).saturating_sub(x1 as i64).max(0);
    let height = (y2 as i64).saturating_sub(y1 as i64).max(0);
    width.saturating_mul(height)
}

fn collect_port_shapes(item: &Value, shapes: &mut Vec<HierarchyShape>, source_id: u32) {
    let Some(ports) = item.get("ports").and_then(Value::as_array) else {
        return;
    };
    for port in ports {
        let layer_id = layer_id(port);
        let Some(rects) = port.get("rects").and_then(Value::as_array) else {
            continue;
        };
        for rect in rects {
            if let Some(bbox) = parse_bbox(rect) {
                shapes.push(HierarchyShape {
                    layer_id,
                    kind: LayoutObjectKind::IoPin,
                    bbox,
                    source_id,
                });
            }
        }
    }
}

fn master_cell_id(master_id: u32) -> u32 {
    master_id.saturating_add(1)
}

fn parse_orientation(value: &str) -> Orientation {
    match value {
        "N" | "R0" | "N_R0" => Orientation::R0,
        "R90" | "N_R90" => Orientation::R90,
        "R180" | "N_R180" => Orientation::R180,
        "R270" | "N_R270" => Orientation::R270,
        "MX" | "FS_MX" => Orientation::MX,
        "MY" | "FN_MY" => Orientation::MY,
        "MXR90" | "FS_MXR90" => Orientation::MXR90,
        "MYR90" | "FN_MYR90" => Orientation::MYR90,
        _ => Orientation::Unknown,
    }
}

fn collect_geometry_dataset(
    root: &Path,
    manifest: &ViewJsonManifest,
    world_bbox: [i32; 4],
) -> Result<GeometryDataset> {
    let mut rects = Vec::new();
    let mut source_files = BTreeMap::new();
    let mut tracks = Vec::new();
    let mut gcell_grids = Vec::new();
    let die_count = collect_die(root, manifest, &mut rects, world_bbox)?;
    source_files.insert("die".to_string(), die_count);
    let instances_count = collect_instances(root, manifest, &mut rects)?;
    source_files.insert("instances".to_string(), instances_count);
    let io_pins_count = collect_io_pins(root, manifest, &mut rects)?;
    source_files.insert("io_pins".to_string(), io_pins_count);
    let regular_wires_count = collect_wire_rects(
        root,
        manifest,
        "regular_wires",
        LayoutObjectKind::RegularWire,
        &mut rects,
    )?;
    source_files.insert("regular_wires".to_string(), regular_wires_count);
    let special_wires_count = collect_wire_rects(
        root,
        manifest,
        "special_wires",
        LayoutObjectKind::SpecialWire,
        &mut rects,
    )?;
    source_files.insert("special_wires".to_string(), special_wires_count);
    let blockage_count = collect_rect_like(
        root,
        manifest,
        "blockages",
        LayoutObjectKind::Blockage,
        &mut rects,
    )?;
    source_files.insert("blockages".to_string(), blockage_count);
    let fill_count =
        collect_rect_like(root, manifest, "fills", LayoutObjectKind::Fill, &mut rects)?;
    source_files.insert("fills".to_string(), fill_count);
    let region_count = collect_rect_like(
        root,
        manifest,
        "regions",
        LayoutObjectKind::Region,
        &mut rects,
    )?;
    source_files.insert("regions".to_string(), region_count);
    let row_count = collect_rect_like(root, manifest, "rows", LayoutObjectKind::Row, &mut rects)?;
    source_files.insert("rows".to_string(), row_count);
    let track_count = collect_grid_overlay(root, manifest, "tracks", &mut tracks)?;
    source_files.insert("tracks".to_string(), track_count);
    let gcell_count = collect_grid_overlay(root, manifest, "gcell_grids", &mut gcell_grids)?;
    source_files.insert("gcell_grids".to_string(), gcell_count);
    Ok(GeometryDataset {
        rects,
        source_files,
        tracks,
        gcell_grids,
    })
}

fn collect_die(
    root: &Path,
    manifest: &ViewJsonManifest,
    rects: &mut Vec<LayoutRectRecord>,
    world_bbox: [i32; 4],
) -> Result<usize> {
    let Some(path) = package_file(root, manifest, "die") else {
        return Ok(0);
    };
    let value = read_json_file(&path)?;
    let Some(data) = value.get("data") else {
        return Ok(1);
    };
    if let Some(bbox) = data
        .get("die_area")
        .and_then(parse_bbox)
        .or_else(|| data.get("bbox").and_then(parse_bbox))
        .or_else(|| valid_bbox(world_bbox))
    {
        push_bbox_rect(rects, bbox, 0, LayoutObjectKind::Die, 0);
    }
    if let Some(bbox) = data.get("core_area").and_then(parse_bbox) {
        push_bbox_rect(rects, bbox, 0, LayoutObjectKind::Core, 0);
    }
    Ok(1)
}

fn collect_instances(
    root: &Path,
    manifest: &ViewJsonManifest,
    rects: &mut Vec<LayoutRectRecord>,
) -> Result<usize> {
    for_each_data_item(root, manifest, "instances", |item| {
        let Some(bbox) = item.get("bbox").and_then(parse_bbox) else {
            return Ok(());
        };
        push_bbox_rect(rects, bbox, 0, LayoutObjectKind::Instance, source_id(&item));
        Ok(())
    })
}

fn collect_wire_rects(
    root: &Path,
    manifest: &ViewJsonManifest,
    key: &str,
    kind: LayoutObjectKind,
    rects: &mut Vec<LayoutRectRecord>,
) -> Result<usize> {
    for_each_data_item(root, manifest, key, |item| {
        let layer_id = layer_id(&item);
        let source_id = source_id(&item);
        let wire_kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        if wire_kind == "via" {
            if let Some(bbox) = item.get("bbox").and_then(parse_bbox) {
                for via_layer in via_layers_for_item(&item, layer_id) {
                    push_bbox_rect(rects, bbox, via_layer, LayoutObjectKind::Via, source_id);
                }
            }
            return Ok(());
        }
        if let Some(rect) = item.get("rect").and_then(parse_bbox) {
            push_bbox_rect(rects, rect, layer_id, kind, source_id);
            return Ok(());
        }
        if let Some(bbox) = item
            .get("bbox")
            .and_then(parse_bbox)
            .filter(|_| wire_kind == "patch")
        {
            push_bbox_rect(rects, bbox, layer_id, kind, source_id);
            return Ok(());
        }
        let width = item
            .get("width")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0) as i32;
        let Some(points) = item.get("points").and_then(Value::as_array) else {
            return Ok(());
        };
        for pair in points.windows(2) {
            let Some(a) = parse_point(&pair[0]) else {
                continue;
            };
            let Some(b) = parse_point(&pair[1]) else {
                continue;
            };
            rects.push(segment_to_rect(a, b, width, layer_id, kind, source_id));
        }
        Ok(())
    })
}

fn collect_io_pins(
    root: &Path,
    manifest: &ViewJsonManifest,
    rects: &mut Vec<LayoutRectRecord>,
) -> Result<usize> {
    for_each_data_item(root, manifest, "io_pins", |item| {
        let source_id = source_id(&item);
        if let Some(ports) = item.get("ports").and_then(Value::as_array) {
            for port in ports {
                let layer_id = layer_id(port);
                if let Some(port_rects) = port.get("rects").and_then(Value::as_array) {
                    for rect in port_rects {
                        if let Some(bbox) = parse_bbox(rect) {
                            push_bbox_rect(
                                rects,
                                bbox,
                                layer_id,
                                LayoutObjectKind::IoPin,
                                source_id,
                            );
                        }
                    }
                }
            }
        }
        if let Some(vias) = item.get("vias").and_then(Value::as_array) {
            for via in vias {
                let Some(bbox) = via.get("bbox").and_then(parse_bbox) else {
                    continue;
                };
                for layer_id in via_layers_for_item(via, layer_id(via)) {
                    push_bbox_rect(rects, bbox, layer_id, LayoutObjectKind::Via, source_id);
                }
            }
        }
        if let Some(bbox) = item.get("bbox").and_then(parse_bbox) {
            let already_has_port = item
                .get("ports")
                .and_then(Value::as_array)
                .is_some_and(|ports| !ports.is_empty());
            if !already_has_port {
                push_bbox_rect(
                    rects,
                    bbox,
                    layer_id(&item),
                    LayoutObjectKind::IoPin,
                    source_id,
                );
            }
        }
        Ok(())
    })
}

fn collect_rect_like(
    root: &Path,
    manifest: &ViewJsonManifest,
    key: &str,
    kind: LayoutObjectKind,
    rects: &mut Vec<LayoutRectRecord>,
) -> Result<usize> {
    for_each_data_item(root, manifest, key, |item| {
        let layer_id = layer_id(&item);
        let source_id = source_id(&item);
        if let Some(rect) = item.get("rect").and_then(parse_bbox) {
            push_bbox_rect(rects, rect, layer_id, kind, source_id);
        }
        if let Some(rects_array) = item.get("rects").and_then(Value::as_array) {
            for rect in rects_array {
                if let Some(bbox) = parse_bbox(rect) {
                    push_bbox_rect(rects, bbox, layer_id, kind, source_id);
                }
            }
        }
        if let Some(bbox) = item.get("bbox").and_then(parse_bbox) {
            push_bbox_rect(rects, bbox, layer_id, kind, source_id);
        }
        Ok(())
    })
}

fn collect_grid_overlay(
    root: &Path,
    manifest: &ViewJsonManifest,
    key: &str,
    overlays: &mut Vec<Value>,
) -> Result<usize> {
    for_each_data_item(root, manifest, key, |item| {
        overlays.push(item);
        Ok(())
    })
}

fn parse_bbox(value: &Value) -> Option<[i32; 4]> {
    let items = value.as_array()?;
    if items.len() < 4 {
        return None;
    }
    let x1 = items[0].as_i64()? as i32;
    let y1 = items[1].as_i64()? as i32;
    let x2 = items[2].as_i64()? as i32;
    let y2 = items[3].as_i64()? as i32;
    valid_bbox([x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2)])
}

fn valid_bbox(bbox: [i32; 4]) -> Option<[i32; 4]> {
    if bbox[0] < bbox[2] && bbox[1] < bbox[3] {
        Some(bbox)
    } else {
        None
    }
}

fn parse_point(value: &Value) -> Option<[i32; 2]> {
    let items = value.as_array()?;
    if items.len() < 2 {
        return None;
    }
    Some([items[0].as_i64()? as i32, items[1].as_i64()? as i32])
}

fn segment_to_rect(
    a: [i32; 2],
    b: [i32; 2],
    width: i32,
    layer_id: u16,
    kind: LayoutObjectKind,
    source_id: u32,
) -> LayoutRectRecord {
    let half = width / 2;
    let x1 = a[0].min(b[0]) - half;
    let y1 = a[1].min(b[1]) - half;
    let x2 = a[0].max(b[0]) + half;
    let y2 = a[1].max(b[1]) + half;
    LayoutRectRecord {
        x1,
        y1,
        x2: if x2 == x1 { x2 + width.max(1) } else { x2 },
        y2: if y2 == y1 { y2 + width.max(1) } else { y2 },
        layer_id,
        kind,
        flags: 0,
        source_id,
    }
}

fn push_bbox_rect(
    rects: &mut Vec<LayoutRectRecord>,
    bbox: [i32; 4],
    layer_id: u16,
    kind: LayoutObjectKind,
    source_id: u32,
) {
    if let Some(bbox) = valid_bbox(bbox) {
        rects.push(LayoutRectRecord {
            x1: bbox[0],
            y1: bbox[1],
            x2: bbox[2],
            y2: bbox[3],
            layer_id,
            kind,
            flags: 0,
            source_id,
        });
    }
}

fn source_id(item: &Value) -> u32 {
    item.get("id").and_then(Value::as_u64).unwrap_or(0) as u32
}

fn layer_id(item: &Value) -> u16 {
    item.get("layer_id")
        .and_then(Value::as_u64)
        .or_else(|| {
            item.get("layer_ids")
                .and_then(Value::as_array)
                .and_then(|layers| layers.first())
                .and_then(Value::as_u64)
        })
        .or_else(|| {
            item.get("layers")
                .and_then(Value::as_array)
                .and_then(|layers| layers.first())
                .and_then(Value::as_u64)
        })
        .unwrap_or(0)
        .min(u16::MAX as u64) as u16
}

fn layers_for_item(item: &Value) -> Vec<u16> {
    item.get("layers")
        .or_else(|| item.get("layer_ids"))
        .and_then(Value::as_array)
        .map(|layers| {
            layers
                .iter()
                .filter_map(Value::as_u64)
                .map(|layer| layer.min(u16::MAX as u64) as u16)
                .collect()
        })
        .unwrap_or_default()
}

fn via_layers_for_item(item: &Value, fallback_layer_id: u16) -> Vec<u16> {
    let layers = layers_for_item(item);
    if layers.len() >= 3 {
        vec![layers[layers.len() / 2]]
    } else if let Some(layer_id) = layers.first().copied() {
        vec![layer_id]
    } else if fallback_layer_id > 0 {
        vec![fallback_layer_id]
    } else {
        Vec::new()
    }
}

fn source_fingerprint(root: &Path, manifest: &ViewJsonManifest) -> Result<String> {
    let mut hasher = Sha256::new();
    let manifest_path = root.join("manifest.json");
    update_hash_with_file(&mut hasher, &manifest_path)?;
    for relative in manifest.files.values() {
        let path = root.join(relative);
        if path.is_file() {
            hasher.update(relative.as_bytes());
            update_hash_with_file(&mut hasher, &path)?;
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn update_hash_with_file(hasher: &mut Sha256, path: &Path) -> Result<()> {
    let file =
        fs::File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .with_context(|| format!("failed to read {}", path.display()))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use tempfile::TempDir;

    use super::*;

    fn write_json(path: &std::path::Path, value: serde_json::Value) {
        fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    }

    fn create_minimal_viewjson_package() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("design")).unwrap();
        write_json(
            root.join("manifest.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "format": "view_json",
                "design_name": "unit",
                "unit": { "dbu_per_micron": 1000 },
                "bbox": [0, 0, 1000, 1000],
                "files": {
                    "die": "design/die.json",
                    "layers": "design/layers.json",
                    "cell_masters": "tech/cell_masters.json",
                    "instances": "design/instances.json",
                    "io_pins": "design/io_pins.json",
                    "regular_wires": "design/regular_wires.json",
                    "special_wires": "design/special_wires.json",
                    "blockages": "design/blockages.json",
                    "fills": "design/fills.json",
                    "regions": "design/regions.json",
                    "rows": "design/rows.json",
                    "tracks": "design/tracks.json",
                    "gcell_grids": "design/gcell_grids.json"
                }
            }),
        );
        write_json(
            root.join("design/die.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "die",
                "data": { "die_area": [0, 0, 1000, 1000], "core_area": [100, 100, 900, 900] }
            }),
        );
        write_json(
            root.join("design/layers.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "layers",
                "data": [
                    { "id": 1, "name": "M1", "type": "routing", "direction": "H" }
                ]
            }),
        );
        fs::create_dir_all(root.join("tech")).unwrap();
        write_json(
            root.join("tech/cell_masters.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "cell_masters",
                "data": [
                    {
                        "id": 1,
                        "name": "NAND2",
                        "size": [20, 20],
                        "pins": [
                            {
                                "name": "A",
                                "ports": [
                                    { "layer_id": 1, "rects": [[2, 3, 8, 9]] }
                                ]
                            }
                        ]
                    }
                ]
            }),
        );
        write_json(
            root.join("design/instances.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": [
                    { "id": 7, "name": "u0", "master_id": 1, "origin": [10, 20], "orient": "N", "bbox": [10, 20, 30, 40] }
                ]
            }),
        );
        write_json(
            root.join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 11, "kind": "path", "layer_id": 1, "width": 10, "points": [[100, 100], [300, 100]] },
                    { "id": 12, "kind": "patch", "layer_id": 1, "rect": [400, 400, 460, 460] }
                ]
            }),
        );
        write_json(
            root.join("design/special_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "special_wires",
                "data": []
            }),
        );
        for file in [
            "io_pins",
            "blockages",
            "fills",
            "regions",
            "rows",
            "tracks",
            "gcell_grids",
        ] {
            write_json(
                root.join(format!("design/{file}.json")).as_path(),
                json!({
                    "schema": "ieda.view.v1",
                    "kind": file,
                    "data": []
                }),
            );
        }
        tmp
    }

    fn read_index(output: &std::path::Path, relative: &str) -> serde_json::Value {
        let text = fs::read_to_string(output.join(relative)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn read_tile_from_entry(output: &std::path::Path, entry: &serde_json::Value) -> DetailTile {
        let bytes = fs::read(output.join(entry["file"].as_str().unwrap())).unwrap();
        let offset = entry["byte_offset"].as_u64().unwrap_or(0) as usize;
        let byte_size = entry["byte_size"].as_u64().unwrap() as usize;
        layoutpkg_format::read_detail_tile(&mut &bytes[offset..offset + byte_size]).unwrap()
    }

    #[test]
    fn packer_writes_layoutpkg_manifest_and_detail_tile() {
        let input = create_minimal_viewjson_package();
        let output = input.path().join(".layoutpkg");

        let result = pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        assert_eq!(result.output_root, output);
        assert_eq!(result.detail_tile_count, 1);
        assert!(result.timing.total_ms >= result.timing.manifest_ms);
        assert!(result.timing.summary().contains("total="));
        assert!(result.timing.summary().contains("fingerprint="));

        let manifest_text = fs::read_to_string(output.join("manifest.json")).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&manifest_text).unwrap();
        assert_eq!(manifest["schema"], "ecos.layoutpkg.v1");
        assert_eq!(manifest["generator"]["name"], "ecos-layout-packer");
        assert_eq!(
            manifest["generator"]["version"],
            LAYOUTPKG_GENERATOR_VERSION
        );
        assert_eq!(manifest["design_name"], "unit");
        assert_eq!(manifest["source"]["kind"], "view-json");
        assert!(manifest["source"]["fingerprint"].as_str().unwrap().len() >= 16);
        assert_eq!(manifest["tilesets"]["detail"], "detail/index.json");
        assert_eq!(manifest["tilesets"]["overview"], "overview/index.json");
        assert_eq!(manifest["tilesets"]["query"], "query/index.json");
        assert_eq!(manifest["hierarchy"]["cells"], "hierarchy/cells.json");
        assert_eq!(
            manifest["dictionaries"]["grid_overlays"],
            "dictionaries/grid_overlays.json"
        );
        assert_eq!(manifest["capabilities"]["detail_tiles"], true);
        assert_eq!(manifest["capabilities"]["overview_tiles"], true);
        assert_eq!(manifest["capabilities"]["query_tiles"], true);
        assert_eq!(manifest["statistics"]["by_kind"]["die"], 1);
        assert_eq!(manifest["statistics"]["by_kind"]["core"], 1);

        let detail_index = read_index(&output, "detail/index.json");
        assert_eq!(detail_index["schema"], "ecos.layoutpkg.detail_index.v1");
        assert_eq!(detail_index["tiles"].as_array().unwrap().len(), 1);
        assert_eq!(detail_index["tiles"][0]["primitive_count"], 3);
        assert_eq!(detail_index["statistics"]["by_kind"]["regular_wire"], 2);
        assert_eq!(detail_index["statistics"]["by_layer"]["1"], 2);
        assert_eq!(detail_index["large_objects"]["count"], 2);

        let tile_path = output.join(detail_index["tiles"][0]["file"].as_str().unwrap());
        let tile = fs::read(tile_path).unwrap();
        assert!(tile.starts_with(layoutpkg_format::DETAIL_TILE_MAGIC));

        let overview_index = read_index(&output, "overview/index.json");
        assert_eq!(overview_index["schema"], "ecos.layoutpkg.overview_index.v1");
        assert_eq!(overview_index["source_tileset"], "detail");
        assert!(overview_index["tiles"].as_array().unwrap().len() >= 1);

        let grid_overlays = read_index(&output, "dictionaries/grid_overlays.json");
        assert_eq!(grid_overlays["schema"], "ecos.layoutpkg.grid_overlays.v1");

        let query_index = read_index(&output, "query/index.json");
        assert_eq!(query_index["schema"], "ecos.layoutpkg.query_index.v1");
        assert_eq!(query_index["source_tileset"], "detail");
        assert_eq!(query_index["storage"], "reuse_detail_records");
        assert_eq!(query_index["tiles"], "detail/index.json#/tiles");
        assert_eq!(
            query_index["large_objects"],
            "detail/index.json#/large_objects"
        );
        assert!(query_index["queryable_kinds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|kind| kind == "regular_wire"));
    }

    #[test]
    fn source_fingerprint_matches_read_all_reference_hash() {
        let input = create_minimal_viewjson_package();
        let manifest: ViewJsonManifest =
            serde_json::from_str(&fs::read_to_string(input.path().join("manifest.json")).unwrap())
                .unwrap();
        let mut hasher = Sha256::new();
        let manifest_path = input.path().join("manifest.json");
        hasher.update(fs::read(&manifest_path).unwrap());
        for relative in manifest.files.values() {
            let path = input.path().join(relative);
            if path.is_file() {
                hasher.update(relative.as_bytes());
                hasher.update(fs::read(&path).unwrap());
            }
        }
        let expected = format!("{:x}", hasher.finalize());

        let actual = source_fingerprint(input.path(), &manifest).unwrap();

        assert_eq!(actual, expected);
    }

    #[test]
    fn viewjson_source_metadata_exposes_generator_and_fingerprint() {
        let input = create_minimal_viewjson_package();

        let metadata = viewjson_source_metadata(input.path()).unwrap();

        assert_eq!(metadata.generator.name, "ecos-layout-packer");
        assert_eq!(metadata.generator.version, LAYOUTPKG_GENERATOR_VERSION);
        assert_eq!(metadata.source.kind, "view-json");
        assert_eq!(metadata.source.fingerprint.len(), 64);
    }

    #[test]
    fn packer_writes_klayout_like_hierarchy_cells_and_instances() {
        let input = create_minimal_viewjson_package();
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let hierarchy: HierarchyDocument =
            serde_json::from_value(read_index(&output, "hierarchy/cells.json")).unwrap();

        assert_eq!(hierarchy.schema, HIERARCHY_SCHEMA);
        assert_eq!(hierarchy.top_cell, 0);
        assert_eq!(hierarchy.cells[0].name, "unit");
        assert_eq!(hierarchy.cells[0].instances.len(), 1);
        assert_eq!(hierarchy.cells[0].instances[0].child_cell, 2);
        assert_eq!(hierarchy.cells[0].instances[0].transform.dx, 10);
        assert_eq!(hierarchy.cells[0].instances[0].transform.dy, 20);
        assert_eq!(
            hierarchy.cells[0].instances[0].transform.orient,
            Orientation::R0
        );

        let master = hierarchy.cells.iter().find(|cell| cell.id == 2).unwrap();
        assert_eq!(master.name, "NAND2");
        assert_eq!(master.bbox, [0, 0, 20, 20]);
        assert_eq!(master.shapes.len(), 1);
        assert_eq!(master.shapes[0].layer_id, 1);
        assert_eq!(master.shapes[0].bbox, [2, 3, 8, 9]);
    }

    #[test]
    fn packer_writes_cell_layer_summaries() {
        let input = create_minimal_viewjson_package();
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let hierarchy: HierarchyDocument =
            serde_json::from_value(read_index(&output, "hierarchy/cells.json")).unwrap();

        let top_cell = hierarchy
            .cells
            .iter()
            .find(|cell| cell.id == hierarchy.top_cell)
            .unwrap();
        assert_eq!(top_cell.hierarchy_summary.direct_instance_count, 1);

        let io_pin_summary = hierarchy
            .cells
            .iter()
            .flat_map(|cell| &cell.layer_summaries)
            .find(|summary| summary.layer_id == 1 && summary.kind == LayoutObjectKind::IoPin)
            .expect("expected an IoPin layer summary for layer 1");
        assert!(io_pin_summary.shape_count > 0);
        assert!(io_pin_summary.total_area > 0);
    }

    #[test]
    fn packer_preserves_instance_arrays_in_hierarchy_summary() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/instances.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": [
                    {
                        "id": 7,
                        "name": "u_array",
                        "master_id": 1,
                        "origin": [10, 20],
                        "orient": "N",
                        "bbox": [10, 20, 90, 80],
                        "array": {
                            "columns": 4,
                            "rows": 3,
                            "step_x": 20,
                            "step_y": 15
                        }
                    }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let hierarchy: HierarchyDocument =
            serde_json::from_value(read_index(&output, "hierarchy/cells.json")).unwrap();

        let top_cell = hierarchy
            .cells
            .iter()
            .find(|cell| cell.id == hierarchy.top_cell)
            .unwrap();
        assert_eq!(top_cell.hierarchy_summary.direct_array_count, 1);
        assert_eq!(top_cell.hierarchy_summary.expanded_array_element_count, 12);
        assert_eq!(top_cell.instances[0].array.columns, 4);
        assert_eq!(top_cell.instances[0].array.rows, 3);
    }

    #[test]
    fn parse_cell_array_ignores_top_level_transform_dx_dy_for_steps() {
        let item = json!({
            "columns": 4,
            "rows": 3,
            "dx": 120,
            "dy": 240
        });

        let array = parse_cell_array(&item);

        assert_eq!(array.columns, 4);
        assert_eq!(array.rows, 3);
        assert_eq!(array.step_x, 0);
        assert_eq!(array.step_y, 0);
    }

    #[test]
    fn overview_pyramid_bounds_full_world_density_rects() {
        let rects = vec![
            LayoutRectRecord {
                x1: 0,
                y1: 0,
                x2: 65_536,
                y2: 65_536,
                layer_id: 1,
                kind: LayoutObjectKind::RegularWire,
                flags: 0,
                source_id: 1,
            },
            LayoutRectRecord {
                x1: 0,
                y1: 0,
                x2: 65_536,
                y2: 65_536,
                layer_id: 0,
                kind: LayoutObjectKind::Die,
                flags: 0,
                source_id: 2,
            },
            LayoutRectRecord {
                x1: 0,
                y1: 0,
                x2: 65_536,
                y2: 65_536,
                layer_id: 0,
                kind: LayoutObjectKind::Instance,
                flags: 0,
                source_id: 3,
            },
            LayoutRectRecord {
                x1: 0,
                y1: 0,
                x2: 65_536,
                y2: 65_536,
                layer_id: 0,
                kind: LayoutObjectKind::Row,
                flags: 0,
                source_id: 4,
            },
        ];

        let pyramid = build_overview_pyramid([0, 0, 65_536, 65_536], &rects);
        let total_bins: usize = pyramid.levels.iter().map(|level| level.bins.len()).sum();

        assert!(total_bins <= 256 * pyramid.levels.len());
        assert!(pyramid
            .levels
            .iter()
            .flat_map(|level| &level.bins)
            .all(|bin| matches!(
                bin.kind,
                LayoutObjectKind::RegularWire
                    | LayoutObjectKind::SpecialWire
                    | LayoutObjectKind::Via
                    | LayoutObjectKind::IoPin
                    | LayoutObjectKind::Blockage
                    | LayoutObjectKind::Fill
            )));
        assert!(pyramid
            .levels
            .iter()
            .flat_map(|level| &level.bins)
            .any(|bin| bin.kind == LayoutObjectKind::RegularWire
                && bin.count > 0
                && bin.coverage_area > 0));
    }

    #[test]
    fn packer_writes_overview_pyramid() {
        let input = create_minimal_viewjson_package();
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        assert!(!output.join("overview/pyramid.json").exists());
        let pyramid_bytes = fs::read(output.join("overview/pyramid.bin")).unwrap();
        assert!(pyramid_bytes.starts_with(layoutpkg_format::OVERVIEW_PYRAMID_MAGIC));
        let pyramid =
            layoutpkg_format::read_overview_pyramid(&mut pyramid_bytes.as_slice()).unwrap();
        assert_eq!(pyramid.schema, layoutpkg_format::OVERVIEW_PYRAMID_SCHEMA);
        assert_eq!(pyramid.world_bbox, [0, 0, 1000, 1000]);
        assert!(!pyramid.levels.is_empty());
        assert!(pyramid
            .levels
            .iter()
            .flat_map(|level| &level.bins)
            .any(|bin| bin.count > 0 && bin.coverage_area > 0));

        let manifest = read_index(&output, "manifest.json");
        assert_eq!(manifest["capabilities"]["overview_pyramid"], true);
        assert_eq!(manifest["capabilities"]["cell_layer_summaries"], true);
        assert_eq!(
            manifest["tilesets"]["overview_pyramid"],
            "overview/pyramid.bin"
        );
    }

    #[test]
    fn packer_omits_redundant_top_detail_scope() {
        let input = create_minimal_viewjson_package();
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let manifest = read_index(&output, "manifest.json");

        assert!(!output.join("detail/scope.json").exists());
        assert_eq!(manifest["capabilities"]["detail_scope"], false);
        assert!(manifest["tilesets"].get("detail_scope").is_none());
    }

    #[test]
    fn packer_writes_only_non_empty_fixed_grid_detail_tiles() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 11, "kind": "path", "layer_id": 1, "width": 10, "points": [[100, 100], [300, 100]] },
                    { "id": 12, "kind": "patch", "layer_id": 1, "rect": [400, 400, 460, 460] },
                    { "id": 13, "kind": "patch", "layer_id": 1, "rect": [700, 700, 760, 760] }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        let result = pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 2,
            detail_grid_rows: 2,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        assert_eq!(result.detail_tile_count, 2);

        let detail_index_text = fs::read_to_string(output.join("detail/index.json")).unwrap();
        let detail_index: serde_json::Value = serde_json::from_str(&detail_index_text).unwrap();
        assert_eq!(detail_index["grid"]["columns"], 2);
        assert_eq!(detail_index["grid"]["rows"], 2);

        let tiles = detail_index["tiles"].as_array().unwrap();
        let ids = tiles
            .iter()
            .map(|tile| tile["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["0:0", "1:1"]);
        assert_eq!(tiles[0]["primitive_count"], 3);
        assert_eq!(tiles[1]["primitive_count"], 1);
        assert_eq!(tiles[0]["bbox"], json!([0, 0, 500, 500]));
        assert_eq!(tiles[1]["bbox"], json!([500, 500, 1000, 1000]));

        for tile in tiles {
            let tile_path = output.join(tile["file"].as_str().unwrap());
            assert!(tile_path.is_file());
        }
    }

    #[test]
    fn packer_writes_detail_tiles_into_shared_shard_file() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 11, "kind": "patch", "layer_id": 1, "rect": [100, 100, 160, 160] },
                    { "id": 12, "kind": "patch", "layer_id": 1, "rect": [700, 700, 760, 760] }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        let result = pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 2,
            detail_grid_rows: 2,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        assert_eq!(result.detail_tile_count, 2);

        let detail_index = read_index(&output, "detail/index.json");
        let tiles = detail_index["tiles"].as_array().unwrap();
        assert_eq!(tiles.len(), 2);
        assert!(tiles
            .iter()
            .all(|tile| tile["file"] == "detail/shard_0.bin"));
        assert_eq!(tiles[0]["byte_offset"], 0);
        assert!(tiles[1]["byte_offset"].as_u64().unwrap() > 0);
        assert!(!output.join("detail/tile_0_0.bin").exists());
        assert!(!output.join("detail/tile_1_1.bin").exists());

        let shard = fs::read(output.join("detail/shard_0.bin")).unwrap();
        for tile_entry in tiles {
            let offset = tile_entry["byte_offset"].as_u64().unwrap() as usize;
            let byte_size = tile_entry["byte_size"].as_u64().unwrap() as usize;
            let decoded =
                layoutpkg_format::read_detail_tile(&mut &shard[offset..offset + byte_size])
                    .unwrap();
            assert_eq!(
                decoded.rects.len(),
                tile_entry["primitive_count"].as_u64().unwrap() as usize
            );
        }
    }

    #[test]
    fn packer_clips_detail_records_to_tile_bounds() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/die.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "die",
                "data": { "die_area": [0, 0, 1000, 1000] }
            }),
        );
        write_json(
            input.path().join("design/instances.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": []
            }),
        );
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 21, "kind": "patch", "layer_id": 1, "rect": [400, 100, 600, 200] }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 2,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let detail_index = read_index(&output, "detail/index.json");
        let tiles = detail_index["tiles"].as_array().unwrap();
        assert_eq!(tiles.len(), 2);

        let left_tile = read_tile_from_entry(&output, &tiles[0]);
        let right_tile = read_tile_from_entry(&output, &tiles[1]);
        assert!(left_tile.rects.iter().any(|rect| rect.source_id == 21
            && [rect.x1, rect.y1, rect.x2, rect.y2] == [400, 100, 500, 200]));
        assert!(right_tile.rects.iter().any(|rect| rect.source_id == 21
            && [rect.x1, rect.y1, rect.x2, rect.y2] == [500, 100, 600, 200]));
    }

    #[test]
    fn packer_collects_auxiliary_geometry_kinds() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/io_pins.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "io_pins",
                "data": [
                    {
                        "id": 51,
                        "ports": [
                            { "layer_id": 2, "rects": [[10, 500, 50, 540]] }
                        ],
                        "vias": [
                            { "bbox": [20, 520, 40, 560], "layers": [2, 3] }
                        ],
                        "bbox": [10, 500, 50, 560]
                    }
                ]
            }),
        );
        write_json(
            input.path().join("design/blockages.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "blockages",
                "data": [
                    { "id": 61, "layer_id": 2, "rect": [100, 500, 150, 550] }
                ]
            }),
        );
        write_json(
            input.path().join("design/fills.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "fills",
                "data": [
                    { "id": 71, "layer_id": 2, "rect": [200, 500, 250, 550] }
                ]
            }),
        );
        write_json(
            input.path().join("design/regions.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regions",
                "data": [
                    { "id": 81, "bbox": [300, 500, 350, 550] }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let manifest = read_index(&output, "manifest.json");
        assert_eq!(manifest["statistics"]["by_kind"]["io_pin"], 1);
        assert_eq!(manifest["statistics"]["by_kind"]["via"], 1);
        assert_eq!(manifest["statistics"]["by_kind"]["blockage"], 1);
        assert_eq!(manifest["statistics"]["by_kind"]["fill"], 1);
        assert_eq!(manifest["statistics"]["by_kind"]["region"], 1);

        let detail_index = read_index(&output, "detail/index.json");
        let tile = read_tile_from_entry(&output, &detail_index["tiles"][0]);
        let kinds = tile.rects.iter().map(|rect| rect.kind).collect::<Vec<_>>();
        assert!(kinds.contains(&LayoutObjectKind::IoPin));
        assert!(kinds.contains(&LayoutObjectKind::Via));
        assert!(kinds.contains(&LayoutObjectKind::Blockage));
        assert!(kinds.contains(&LayoutObjectKind::Fill));
        assert!(kinds.contains(&LayoutObjectKind::Region));
    }

    #[test]
    fn packer_assigns_via_records_to_cut_layer_from_layer_stack() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/layers.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "layers",
                "data": [
                    { "id": 7, "name": "MET1", "type": "ROUTING", "direction": "HORIZONTAL" },
                    { "id": 8, "name": "VIA1", "type": "CUT" },
                    { "id": 9, "name": "MET2", "type": "ROUTING", "direction": "VERTICAL" }
                ]
            }),
        );
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    {
                        "id": 91,
                        "kind": "via",
                        "bbox": [120, 120, 180, 180],
                        "layers": [7, 8, 9]
                    }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let detail_index = read_index(&output, "detail/index.json");
        let tile = read_tile_from_entry(&output, &detail_index["tiles"][0]);

        assert!(tile.rects.iter().any(|rect| {
            rect.source_id == 91 && rect.kind == LayoutObjectKind::Via && rect.layer_id == 8
        }));
        assert!(!tile.rects.iter().any(|rect| {
            rect.source_id == 91
                && rect.kind == LayoutObjectKind::Via
                && (rect.layer_id == 7 || rect.layer_id == 9)
        }));
    }

    #[test]
    fn packer_writes_overview_tiles_as_bounded_coverage() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 91, "kind": "patch", "layer_id": 1, "rect": [0, 0, 1000, 1000] },
                    { "id": 92, "kind": "patch", "layer_id": 1, "rect": [0, 0, 1000, 1000] },
                    { "id": 93, "kind": "patch", "layer_id": 1, "rect": [0, 0, 1000, 1000] }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 2,
            detail_grid_rows: 2,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        let overview_index = read_index(&output, "overview/index.json");
        assert_eq!(overview_index["grid"]["columns"], 1);
        assert_eq!(overview_index["grid"]["rows"], 1);
        assert_eq!(overview_index["coverage_bins_per_tile"], 16);

        let overview_tile = read_tile_from_entry(&output, &overview_index["tiles"][0]);
        assert!(overview_tile.rects.len() <= 16 * 16);
        assert!(overview_tile
            .rects
            .iter()
            .all(|rect| { rect.x1 >= 0 && rect.y1 >= 0 && rect.x2 <= 1000 && rect.y2 <= 1000 }));
    }

    #[test]
    fn packer_subdivides_overfull_detail_tiles() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/die.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "die",
                "data": { "die_area": [0, 0, 1000, 1000] }
            }),
        );
        write_json(
            input.path().join("design/instances.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": []
            }),
        );
        let patches = (0..10)
            .map(|index| {
                json!({
                    "id": 200 + index,
                    "kind": "patch",
                    "layer_id": 1,
                    "rect": [index * 80, 100, index * 80 + 20, 120]
                })
            })
            .collect::<Vec<_>>();
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": patches
            }),
        );
        let output = input.path().join(".layoutpkg");

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            target_primitives_per_tile: 3,
            max_subdivision_depth: 4,
        })
        .unwrap();

        let detail_index = read_index(&output, "detail/index.json");
        let tiles = detail_index["tiles"].as_array().unwrap();
        assert!(tiles.len() > 1);
        assert!(tiles
            .iter()
            .all(|tile| tile["primitive_count"].as_u64().unwrap() <= 3));
        assert!(tiles.iter().any(|tile| tile["subdivision_depth"] == 1));
    }

    #[test]
    fn packer_removes_stale_tile_files_before_writing() {
        let input = create_minimal_viewjson_package();
        let output = input.path().join(".layoutpkg");
        fs::create_dir_all(output.join("detail")).unwrap();
        fs::create_dir_all(output.join("overview")).unwrap();
        fs::create_dir_all(output.join("query")).unwrap();
        fs::write(output.join("detail/stale.bin"), b"old").unwrap();
        fs::write(output.join("overview/stale.bin"), b"old").unwrap();
        fs::write(output.join("query/stale.bin"), b"old").unwrap();

        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 1,
            detail_grid_rows: 1,
            max_tiles_per_object: 16,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        assert!(!output.join("detail/stale.bin").exists());
        assert!(!output.join("overview/stale.bin").exists());
        assert!(!output.join("query/stale.bin").exists());
        assert!(output.join("query/index.json").exists());
    }

    #[test]
    fn data_item_scanner_visits_only_data_array_entries() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/instances.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": [
                    { "id": 101, "bbox": [1, 2, 3, 4] },
                    { "id": 102, "bbox": [5, 6, 7, 8] }
                ],
                "large_ignored_tail": [
                    { "id": 999, "bbox": [0, 0, 1000, 1000] }
                ]
            }),
        );

        let mut ids = Vec::new();
        let count = for_each_data_item(
            input.path(),
            &serde_json::from_str(&fs::read_to_string(input.path().join("manifest.json")).unwrap())
                .unwrap(),
            "instances",
            |item| {
                ids.push(item["id"].as_u64().unwrap());
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(count, 2);
        assert_eq!(ids, vec![101, 102]);
    }

    #[test]
    fn packer_keeps_wide_objects_out_of_regular_detail_tiles() {
        let input = create_minimal_viewjson_package();
        write_json(
            input.path().join("design/instances.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": []
            }),
        );
        write_json(
            input.path().join("design/regular_wires.json").as_path(),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 44, "kind": "path", "layer_id": 1, "width": 10, "points": [[0, 500], [1000, 500]] }
                ]
            }),
        );
        let output = input.path().join(".layoutpkg");

        let result = pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 4,
            detail_grid_rows: 4,
            max_tiles_per_object: 4,
            ..PackLayoutPackageOptions::new(input.path(), &output)
        })
        .unwrap();

        assert_eq!(result.detail_tile_count, 0);

        let detail_index = read_index(&output, "detail/index.json");
        assert_eq!(detail_index["tiles"].as_array().unwrap().len(), 0);
        assert_eq!(detail_index["large_objects"]["count"], 3);
        assert_eq!(
            detail_index["large_objects"]["file"],
            "detail/large_objects.bin"
        );

        let large_objects = fs::read(output.join("detail/large_objects.bin")).unwrap();
        assert!(large_objects.starts_with(layoutpkg_format::DETAIL_TILE_MAGIC));
        let large_tile = layoutpkg_format::read_detail_tile(&mut large_objects.as_slice()).unwrap();
        assert!(large_tile.rects.iter().any(|rect| rect.source_id == 44));

        let query_index = read_index(&output, "query/index.json");
        assert_eq!(
            query_index["large_objects"],
            "detail/index.json#/large_objects"
        );
    }
}
