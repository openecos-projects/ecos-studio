use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{bail, Context, Result};
use layoutpkg_format::{
    read_detail_tile, read_overview_pyramid, DetailScopeDocument, HierarchyDocument,
    LayoutObjectKind, LayoutRectRecord, OverviewLevel, OverviewPyramidDocument,
};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

impl Rect {
    pub fn new(x1: i32, y1: i32, x2: i32, y2: i32) -> Self {
        Self {
            x1: x1.min(x2),
            y1: y1.min(y2),
            x2: x1.max(x2),
            y2: y1.max(y2),
        }
    }

    fn from_bbox(bbox: [i32; 4]) -> Self {
        Self::new(bbox[0], bbox[1], bbox[2], bbox[3])
    }

    pub fn width(self) -> i32 {
        self.x2 - self.x1
    }

    pub fn height(self) -> i32 {
        self.y2 - self.y1
    }

    fn intersects(self, other: Self) -> bool {
        self.x1 < other.x2 && self.x2 > other.x1 && self.y1 < other.y2 && self.y2 > other.y1
    }
}

#[derive(Debug, Clone)]
pub struct LayoutPackage {
    root: PathBuf,
    manifest: PackageManifest,
    detail_index: TileIndex,
    overview_index: Option<TileIndex>,
    cache: TileCache,
    large_objects_cache: Option<Arc<[LayoutRectRecord]>>,
    overview_cache: Option<Vec<LoadedTile>>,
    layers_cache: Option<Vec<LayoutLayer>>,
    grid_overlays_cache: Option<GridOverlaySet>,
    hierarchy_cache: Option<HierarchyDocument>,
    detail_scope_cache: Option<Option<DetailScopeDocument>>,
    overview_pyramid_cache: Option<OverviewPyramidDocument>,
}

#[derive(Debug, Clone)]
pub struct ViewportBatch {
    pub tiles: Vec<LoadedTile>,
    pub large_objects: LoadedLargeObjects,
    pub stats: LoadStats,
}

#[derive(Debug, Clone)]
pub struct LoadedTile {
    pub id: String,
    pub bbox: Rect,
    pub records: Arc<[LayoutRectRecord]>,
}

#[derive(Debug, Clone)]
pub struct LoadedLargeObjects {
    pub records: Arc<[LayoutRectRecord]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryHit {
    pub record: LayoutRectRecord,
    pub tile_id: Option<String>,
    pub source: QueryHitSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryHitSource {
    Tile,
    LargeObject,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LayoutLayer {
    pub id: u16,
    pub name: String,
    #[serde(default)]
    pub layer_type: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GridOverlaySet {
    #[serde(default)]
    pub tracks: Vec<GridOverlay>,
    #[serde(default)]
    pub gcell_grids: Vec<GridOverlay>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GridOverlay {
    pub id: u32,
    pub direction: OverlayDirection,
    pub start: i32,
    pub count: u32,
    pub step: i32,
    #[serde(default)]
    pub width: Option<i32>,
    #[serde(default)]
    pub layer_id: Option<u16>,
    #[serde(default)]
    pub layer_ids: Vec<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum OverlayDirection {
    #[serde(rename = "X")]
    X,
    #[serde(rename = "Y")]
    Y,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct LoadStats {
    pub disk_reads: usize,
    pub cache_hits: usize,
    pub cache_misses: usize,
    pub evictions: usize,
    pub large_object_disk_reads: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct PackageManifest {
    design_name: Option<String>,
    world_bbox: [i32; 4],
    dictionaries: Option<PackageDictionaries>,
    tilesets: PackageTilesets,
    hierarchy: Option<PackageHierarchy>,
}

#[derive(Debug, Clone, Deserialize)]
struct PackageDictionaries {
    layers: Option<String>,
    grid_overlays: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct PackageTilesets {
    detail: String,
    detail_scope: Option<String>,
    overview: Option<String>,
    overview_pyramid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct PackageHierarchy {
    cells: String,
}

#[derive(Debug, Clone, Deserialize)]
struct TileIndex {
    tiles: Vec<TileEntry>,
    large_objects: Option<LargeObjectsEntry>,
    #[serde(default)]
    statistics: Option<TileIndexStatistics>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct TileIndexStatistics {
    #[serde(default)]
    by_layer: BTreeMap<u16, usize>,
}

#[derive(Debug, Clone, Deserialize)]
struct TileEntry {
    id: String,
    bbox: [i32; 4],
    file: String,
    byte_offset: Option<u64>,
    byte_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct LargeObjectsEntry {
    file: String,
}

#[derive(Debug, Clone)]
struct TileCache {
    entries: HashMap<String, Arc<[LayoutRectRecord]>>,
    order: VecDeque<String>,
}

impl LayoutPackage {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let manifest: PackageManifest = read_json(root.join("manifest.json"))?;
        let detail_index: TileIndex = read_json(root.join(&manifest.tilesets.detail))?;
        let overview_index = manifest
            .tilesets
            .overview
            .as_ref()
            .map(|overview| read_json(root.join(overview)))
            .transpose()?;
        Ok(Self {
            root,
            manifest,
            detail_index,
            overview_index,
            cache: TileCache::new(),
            large_objects_cache: None,
            overview_cache: None,
            layers_cache: None,
            grid_overlays_cache: None,
            hierarchy_cache: None,
            detail_scope_cache: None,
            overview_pyramid_cache: None,
        })
    }

    pub fn load_detail_viewport(
        &mut self,
        viewport: Rect,
        cache_capacity: usize,
    ) -> Result<ViewportBatch> {
        let mut stats = LoadStats::default();
        let mut tiles = Vec::new();
        let intersecting = self
            .detail_index
            .tiles
            .iter()
            .filter(|entry| Rect::from_bbox(entry.bbox).intersects(viewport))
            .cloned()
            .collect::<Vec<_>>();
        for entry in intersecting {
            let records = self.load_tile_records(&entry, cache_capacity, &mut stats)?;
            tiles.push(LoadedTile {
                id: entry.id.clone(),
                bbox: Rect::from_bbox(entry.bbox),
                records,
            });
        }
        let large_objects = self.load_large_objects(&mut stats)?;
        Ok(ViewportBatch {
            tiles,
            large_objects,
            stats,
        })
    }

    pub fn query_point(
        &mut self,
        x: i32,
        y: i32,
        tolerance: i32,
        cache_capacity: usize,
    ) -> Result<Option<QueryHit>> {
        let tolerance = tolerance.max(0);
        let query_rect = Rect::new(
            x - tolerance,
            y - tolerance,
            x + tolerance + 1,
            y + tolerance + 1,
        );
        let batch = self.load_detail_viewport(query_rect, cache_capacity)?;
        let mut best: Option<QueryHit> = None;
        for tile in &batch.tiles {
            for record in tile.records.iter() {
                consider_query_hit(
                    &mut best,
                    QueryHit {
                        record: record.clone(),
                        tile_id: Some(tile.id.clone()),
                        source: QueryHitSource::Tile,
                    },
                    x,
                    y,
                    query_rect,
                );
            }
        }
        for record in batch.large_objects.records.iter() {
            consider_query_hit(
                &mut best,
                QueryHit {
                    record: record.clone(),
                    tile_id: None,
                    source: QueryHitSource::LargeObject,
                },
                x,
                y,
                query_rect,
            );
        }
        Ok(best)
    }

    pub fn load_large_objects_only(&mut self) -> Result<LoadedLargeObjects> {
        let mut stats = LoadStats::default();
        self.load_large_objects(&mut stats)
    }

    pub fn cache_len(&self) -> usize {
        self.cache.entries.len()
    }

    pub fn detail_tileset_path(&self) -> &str {
        &self.manifest.tilesets.detail
    }

    pub fn detail_layer_counts(&self) -> BTreeMap<u16, usize> {
        self.detail_index
            .statistics
            .as_ref()
            .map(|statistics| statistics.by_layer.clone())
            .unwrap_or_default()
    }

    pub fn design_name(&self) -> &str {
        self.manifest.design_name.as_deref().unwrap_or("layout")
    }

    pub fn world_bbox(&self) -> Rect {
        Rect::from_bbox(self.manifest.world_bbox)
    }

    pub fn layers(&self) -> Result<Vec<LayoutLayer>> {
        if let Some(layers) = &self.layers_cache {
            return Ok(layers.clone());
        }
        let Some(path) = self
            .manifest
            .dictionaries
            .as_ref()
            .and_then(|dictionaries| dictionaries.layers.as_ref())
        else {
            return Ok(Vec::new());
        };
        let dictionary: LayersDictionary = read_json(self.root.join(path))?;
        Ok(dictionary.layers)
    }

    pub fn grid_overlays(&self) -> Result<GridOverlaySet> {
        if let Some(overlays) = &self.grid_overlays_cache {
            return Ok(overlays.clone());
        }
        let Some(path) = self
            .manifest
            .dictionaries
            .as_ref()
            .and_then(|dictionaries| dictionaries.grid_overlays.as_ref())
        else {
            return Ok(GridOverlaySet::default());
        };
        read_json(self.root.join(path))
    }

    pub fn load_hierarchy(&mut self) -> Result<Option<HierarchyDocument>> {
        if let Some(hierarchy) = &self.hierarchy_cache {
            return Ok(Some(hierarchy.clone()));
        }
        let Some(path) = self
            .manifest
            .hierarchy
            .as_ref()
            .map(|hierarchy| &hierarchy.cells)
        else {
            return Ok(None);
        };
        let hierarchy: HierarchyDocument = read_json(self.root.join(path))?;
        self.hierarchy_cache = Some(hierarchy.clone());
        Ok(Some(hierarchy))
    }

    pub fn load_detail_scope(&mut self) -> Result<Option<DetailScopeDocument>> {
        if let Some(scope) = &self.detail_scope_cache {
            return Ok(scope.clone());
        }
        let Some(path) = self.manifest.tilesets.detail_scope.as_deref() else {
            self.detail_scope_cache = Some(None);
            return Ok(None);
        };
        let scope: DetailScopeDocument = read_json(self.root.join(path))?;
        self.detail_scope_cache = Some(Some(scope.clone()));
        Ok(Some(scope))
    }

    pub fn load_overview_pyramid(&mut self) -> Result<Option<OverviewPyramidDocument>> {
        if let Some(pyramid) = &self.overview_pyramid_cache {
            return Ok(Some(pyramid.clone()));
        }
        let Some(path) = self.manifest.tilesets.overview_pyramid.as_ref() else {
            return Ok(None);
        };
        let pyramid_path = self.root.join(path);
        let file = fs::File::open(&pyramid_path)
            .with_context(|| format!("failed to open {}", pyramid_path.display()))?;
        let mut reader = std::io::BufReader::new(file);
        let pyramid = read_overview_pyramid(&mut reader)
            .with_context(|| format!("failed to read {}", pyramid_path.display()))?;
        self.overview_pyramid_cache = Some(pyramid.clone());
        Ok(Some(pyramid))
    }

    pub fn load_overview_level_for_units_per_pixel(&mut self, upp: f32) -> Result<OverviewLevel> {
        let Some(pyramid) = self.load_overview_pyramid()? else {
            bail!("overview pyramid is not available");
        };
        let Some(last_level) = pyramid.levels.last() else {
            bail!("overview pyramid has no levels");
        };
        let target_units_per_bin = overview_target_units_per_bin(upp);
        Ok(pyramid
            .levels
            .iter()
            .find(|level| level.units_per_bin >= target_units_per_bin)
            .unwrap_or(last_level)
            .clone())
    }

    pub fn load_overview(&mut self) -> Result<Vec<LoadedTile>> {
        if let Some(tiles) = &self.overview_cache {
            return Ok(tiles.clone());
        }
        let Some(index) = &self.overview_index else {
            return Ok(Vec::new());
        };
        let mut tiles = Vec::new();
        for entry in &index.tiles {
            tiles.push(LoadedTile {
                id: entry.id.clone(),
                bbox: Rect::from_bbox(entry.bbox),
                records: read_tile_file(self.root.join(&entry.file))?,
            });
        }
        self.overview_cache = Some(tiles.clone());
        Ok(tiles)
    }

    fn load_tile_records(
        &mut self,
        entry: &TileEntry,
        cache_capacity: usize,
        stats: &mut LoadStats,
    ) -> Result<Arc<[LayoutRectRecord]>> {
        if let Some(records) = self.cache.get(&entry.id) {
            stats.cache_hits += 1;
            return Ok(records);
        }
        stats.cache_misses += 1;
        stats.disk_reads += 1;
        let records = read_tile_entry(&self.root, entry)?;
        self.cache
            .insert(entry.id.clone(), records.clone(), cache_capacity, stats);
        Ok(records)
    }

    fn load_large_objects(&mut self, stats: &mut LoadStats) -> Result<LoadedLargeObjects> {
        if let Some(records) = &self.large_objects_cache {
            return Ok(LoadedLargeObjects {
                records: records.clone(),
            });
        }
        let Some(entry) = &self.detail_index.large_objects else {
            return Ok(LoadedLargeObjects {
                records: Arc::from([]),
            });
        };
        stats.large_object_disk_reads += 1;
        let records = read_tile_file(self.root.join(&entry.file))?;
        self.large_objects_cache = Some(records.clone());
        Ok(LoadedLargeObjects { records })
    }
}

fn overview_target_units_per_bin(upp: f32) -> i32 {
    const MIN_SCREEN_BIN_PX: f32 = 64.0;
    if upp.is_nan() || upp <= 1.0 {
        1
    } else if upp.is_infinite() {
        i32::MAX
    } else {
        let target = (upp * MIN_SCREEN_BIN_PX).ceil();
        (target as i64).min(i64::from(i32::MAX)) as i32
    }
}

fn consider_query_hit(
    best: &mut Option<QueryHit>,
    candidate: QueryHit,
    x: i32,
    y: i32,
    query_rect: Rect,
) {
    if !is_queryable_kind(candidate.record.kind) {
        return;
    }
    if !record_intersects_rect(&candidate.record, query_rect) {
        return;
    }
    let replace = best
        .as_ref()
        .map(|current| query_rank(&candidate, x, y) < query_rank(current, x, y))
        .unwrap_or(true);
    if replace {
        *best = Some(candidate);
    }
}

fn query_rank(hit: &QueryHit, x: i32, y: i32) -> (i64, i64) {
    let record = &hit.record;
    let width = (record.x2 - record.x1).max(1) as i64;
    let height = (record.y2 - record.y1).max(1) as i64;
    let area = width * height;
    let cx2 = record.x1 as i64 + record.x2 as i64;
    let cy2 = record.y1 as i64 + record.y2 as i64;
    let dx2 = cx2 - x as i64 * 2;
    let dy2 = cy2 - y as i64 * 2;
    (area, dx2 * dx2 + dy2 * dy2)
}

fn record_intersects_rect(record: &LayoutRectRecord, rect: Rect) -> bool {
    Rect::new(record.x1, record.y1, record.x2, record.y2).intersects(rect)
}

fn is_queryable_kind(kind: LayoutObjectKind) -> bool {
    matches!(
        kind,
        LayoutObjectKind::Instance
            | LayoutObjectKind::RegularWire
            | LayoutObjectKind::SpecialWire
            | LayoutObjectKind::Via
            | LayoutObjectKind::IoPin
            | LayoutObjectKind::Blockage
            | LayoutObjectKind::Fill
            | LayoutObjectKind::Region
    )
}

impl Default for GridOverlaySet {
    fn default() -> Self {
        Self {
            tracks: Vec::new(),
            gcell_grids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct LayersDictionary {
    layers: Vec<LayoutLayer>,
}

impl TileCache {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn get(&mut self, id: &str) -> Option<Arc<[LayoutRectRecord]>> {
        let records = Arc::clone(self.entries.get(id)?);
        self.touch(id);
        Some(records)
    }

    fn insert(
        &mut self,
        id: String,
        records: Arc<[LayoutRectRecord]>,
        capacity: usize,
        stats: &mut LoadStats,
    ) {
        if capacity == 0 {
            return;
        }
        if self.entries.contains_key(&id) {
            self.entries.insert(id.clone(), records);
            self.touch(&id);
            return;
        }
        while self.entries.len() >= capacity {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if self.entries.remove(&oldest).is_some() {
                stats.evictions += 1;
            }
        }
        self.entries.insert(id.clone(), records);
        self.order.push_back(id);
    }

    fn touch(&mut self, id: &str) {
        if let Some(position) = self.order.iter().position(|item| item == id) {
            self.order.remove(position);
        }
        self.order.push_back(id.to_string());
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: impl AsRef<Path>) -> Result<T> {
    let path = path.as_ref();
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("failed to parse {}", path.display()))
}

fn read_tile_file(path: impl AsRef<Path>) -> Result<Arc<[LayoutRectRecord]>> {
    let path = path.as_ref();
    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let tile = read_detail_tile(&mut bytes.as_slice())
        .with_context(|| format!("failed to decode {}", path.display()))?;
    Ok(Arc::from(tile.rects))
}

fn read_tile_entry(root: &Path, entry: &TileEntry) -> Result<Arc<[LayoutRectRecord]>> {
    let path = root.join(&entry.file);
    let Some(byte_offset) = entry.byte_offset else {
        return read_tile_file(path);
    };
    let byte_size = entry
        .byte_size
        .with_context(|| format!("tile {} is missing byte_size", entry.id))?;
    let byte_size = usize::try_from(byte_size)
        .with_context(|| format!("tile {} byte_size is too large", entry.id))?;
    let mut file =
        fs::File::open(&path).with_context(|| format!("failed to open {}", path.display()))?;
    file.seek(SeekFrom::Start(byte_offset))
        .with_context(|| format!("failed to seek {}", path.display()))?;
    let mut bytes = vec![0_u8; byte_size];
    file.read_exact(&mut bytes).with_context(|| {
        format!(
            "failed to read {} at offset {}",
            path.display(),
            byte_offset
        )
    })?;
    let tile = read_detail_tile(&mut bytes.as_slice()).with_context(|| {
        format!(
            "failed to decode {} at offset {}",
            path.display(),
            byte_offset
        )
    })?;
    Ok(Arc::from(tile.rects))
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use layoutpkg_packer::{pack_viewjson_to_layoutpkg, PackLayoutPackageOptions};
    use serde_json::json;
    use tempfile::TempDir;

    use crate::{LayoutPackage, OverlayDirection, QueryHitSource, Rect};

    fn write_json(path: &std::path::Path, value: serde_json::Value) {
        fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    }

    fn create_viewjson_fixture_with_wide_wire(include_wide_wire: bool) -> TempDir {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("design")).unwrap();
        write_json(
            &root.join("manifest.json"),
            json!({
                "schema": "ieda.view.v1",
                "format": "layout_view_package",
                "design_name": "reader-unit",
                "unit": { "dbu_per_micron": 1000 },
                "bbox": [0, 0, 1000, 1000],
                "files": {
                    "die": "design/die.json",
                    "layers": "design/layers.json",
                    "cell_masters": "tech/cell_masters.json",
                    "instances": "design/instances.json",
                    "regular_wires": "design/regular_wires.json",
                    "special_wires": "design/special_wires.json",
                    "io_pins": "design/io_pins.json",
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
            &root.join("design/die.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "die",
                "data": { "die_area": [0, 0, 1000, 1000], "core_area": [100, 100, 900, 900] }
            }),
        );
        write_json(
            &root.join("design/layers.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "layers",
                "data": [{ "id": 1, "name": "M1", "type": "routing", "direction": "HORIZONTAL" }]
            }),
        );
        fs::create_dir_all(root.join("tech")).unwrap();
        write_json(
            &root.join("tech/cell_masters.json"),
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
            &root.join("design/instances.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "instances",
                "data": [
                    { "id": 17, "name": "u0", "master_id": 1, "origin": [10, 20], "orient": "N_R0", "bbox": [10, 20, 30, 40] }
                ]
            }),
        );
        let mut regular_wires = vec![
            json!({ "id": 1, "kind": "patch", "layer_id": 1, "rect": [100, 100, 150, 150] }),
            json!({ "id": 2, "kind": "patch", "layer_id": 1, "rect": [700, 100, 750, 150] }),
            json!({ "id": 3, "kind": "patch", "layer_id": 1, "rect": [100, 700, 150, 750] }),
            json!({ "id": 4, "kind": "patch", "layer_id": 1, "rect": [700, 700, 750, 750] }),
        ];
        if include_wide_wire {
            regular_wires
                .push(json!({ "id": 5, "kind": "patch", "layer_id": 1, "rect": [0, 0, 1000, 10] }));
        }
        write_json(
            &root.join("design/regular_wires.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": regular_wires
            }),
        );
        for file in [
            "special_wires",
            "io_pins",
            "blockages",
            "fills",
            "regions",
            "rows",
        ] {
            write_json(
                &root.join(format!("design/{file}.json")),
                json!({ "schema": "ieda.view.v1", "kind": file, "data": [] }),
            );
        }
        write_json(
            &root.join("design/tracks.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "tracks",
                "data": [
                    { "id": 7, "direction": "X", "start": 10, "count": 3, "step": 20, "width": 0, "layer_id": 1 }
                ]
            }),
        );
        write_json(
            &root.join("design/gcell_grids.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "gcell_grids",
                "data": [
                    { "id": 3, "direction": "Y", "start": 5, "count": 2, "step": 50 }
                ]
            }),
        );
        tmp
    }

    fn create_layoutpkg() -> (TempDir, std::path::PathBuf) {
        create_layoutpkg_with_options(2, 2, 16, false)
    }

    fn create_layoutpkg_with_options(
        detail_grid_columns: usize,
        detail_grid_rows: usize,
        max_tiles_per_object: usize,
        include_wide_wire: bool,
    ) -> (TempDir, std::path::PathBuf) {
        let input = create_viewjson_fixture_with_wide_wire(include_wide_wire);
        let output = input.path().join(".layoutpkg");
        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: input.path().to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns,
            detail_grid_rows,
            max_tiles_per_object,
            target_primitives_per_tile: 6000,
            max_subdivision_depth: 4,
        })
        .unwrap();
        (input, output)
    }

    fn write_custom_overview_pyramid(package_root: &std::path::Path, units_per_bins: &[i32]) {
        let levels = units_per_bins
            .iter()
            .enumerate()
            .map(|(level, units_per_bin)| layoutpkg_format::OverviewLevel {
                level: level as u32,
                units_per_bin: *units_per_bin,
                grid: [1, 1],
                bins: vec![layoutpkg_format::OverviewBinRecord {
                    bbox: [0, 0, *units_per_bin, *units_per_bin],
                    layer_id: 1,
                    kind: layoutpkg_format::LayoutObjectKind::RegularWire,
                    count: 1,
                    coverage_area: i64::from(*units_per_bin) * i64::from(*units_per_bin),
                }],
            })
            .collect::<Vec<_>>();
        let pyramid = layoutpkg_format::OverviewPyramidDocument {
            schema: layoutpkg_format::OVERVIEW_PYRAMID_SCHEMA.to_string(),
            version: 1,
            world_bbox: [0, 0, 1000, 1000],
            levels,
        };
        let mut bytes = Vec::new();
        layoutpkg_format::write_overview_pyramid(&mut bytes, &pyramid).unwrap();
        fs::write(package_root.join("overview/pyramid.bin"), bytes).unwrap();
        let manifest_path = package_root.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["tilesets"]["overview_pyramid"] = json!("overview/pyramid.bin");
        write_json(&manifest_path, manifest);
    }

    fn remove_overview_pyramid_from_manifest(package_root: &std::path::Path) {
        let manifest_path = package_root.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["tilesets"]
            .as_object_mut()
            .unwrap()
            .remove("overview_pyramid");
        write_json(&manifest_path, manifest);
    }

    fn write_detail_scope(package_root: &std::path::Path) {
        write_json(
            &package_root.join("detail/scope.json"),
            json!({
                "schema": layoutpkg_format::DETAIL_SCOPE_SCHEMA,
                "version": 1,
                "records": [
                    { "source_id": 1, "cell_id": 0, "coordinates": "top" }
                ]
            }),
        );
        let manifest_path = package_root.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["capabilities"]["detail_scope"] = json!(true);
        manifest["tilesets"]["detail_scope"] = json!("detail/scope.json");
        write_json(&manifest_path, manifest);
    }

    #[test]
    fn loads_only_tiles_intersecting_viewport() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let batch = package
            .load_detail_viewport(Rect::new(0, 0, 500, 500), 8)
            .unwrap();

        assert_eq!(batch.tiles.len(), 1);
        assert_eq!(batch.tiles[0].id, "0:0");
        assert_eq!(batch.tiles[0].records.len(), 2);
        assert_eq!(batch.stats.disk_reads, 1);
        assert_eq!(batch.stats.cache_hits, 0);
        assert_eq!(batch.stats.cache_misses, 1);
        assert_eq!(batch.large_objects.records.len(), 2);
    }

    #[test]
    fn reuses_cached_tiles_for_repeated_viewports() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let first = package
            .load_detail_viewport(Rect::new(0, 0, 500, 500), 8)
            .unwrap();
        assert_eq!(first.stats.large_object_disk_reads, 1);
        let batch = package
            .load_detail_viewport(Rect::new(0, 0, 500, 500), 8)
            .unwrap();

        assert_eq!(batch.tiles.len(), 1);
        assert_eq!(batch.stats.disk_reads, 0);
        assert_eq!(batch.stats.cache_hits, 1);
        assert_eq!(batch.stats.cache_misses, 0);
        assert_eq!(batch.stats.large_object_disk_reads, 0);
        assert!(Arc::ptr_eq(
            &first.tiles[0].records,
            &batch.tiles[0].records
        ));
        assert!(Arc::ptr_eq(
            &first.large_objects.records,
            &batch.large_objects.records
        ));
    }

    #[test]
    fn evicts_least_recently_used_tiles_when_capacity_is_exceeded() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        package
            .load_detail_viewport(Rect::new(0, 0, 500, 500), 1)
            .unwrap();
        package
            .load_detail_viewport(Rect::new(500, 0, 1000, 500), 1)
            .unwrap();
        let batch = package
            .load_detail_viewport(Rect::new(0, 0, 500, 500), 1)
            .unwrap();

        assert_eq!(batch.tiles[0].id, "0:0");
        assert_eq!(batch.stats.disk_reads, 1);
        assert_eq!(batch.stats.cache_hits, 0);
        assert_eq!(batch.stats.evictions, 1);
        assert_eq!(package.cache_len(), 1);
    }

    #[test]
    fn loads_overview_tiles_once_for_low_zoom() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        assert_eq!(package.design_name(), "reader-unit");
        assert_eq!(package.world_bbox(), Rect::new(0, 0, 1000, 1000));

        let overview = package.load_overview().unwrap();
        let cached = package.load_overview().unwrap();

        assert_eq!(overview.len(), 1);
        assert_eq!(overview[0].records.len(), cached[0].records.len());
    }

    #[test]
    fn loads_overview_pyramid_once_and_selects_level_by_upp() {
        let (_input, package_root) = create_layoutpkg();
        let pyramid_path = package_root.join("overview/pyramid.bin");
        assert!(pyramid_path.exists());
        assert!(!package_root.join("overview/pyramid.json").exists());

        let mut package = LayoutPackage::open(&package_root).unwrap();

        let first = package.load_overview_pyramid().unwrap().unwrap();
        assert_eq!(first.schema, layoutpkg_format::OVERVIEW_PYRAMID_SCHEMA);
        assert!(!first.levels.is_empty());
        fs::remove_file(&pyramid_path).unwrap();
        let cached = package.load_overview_pyramid().unwrap().unwrap();
        assert_eq!(first, cached);

        let low_upp = 1.0_f32;
        let low_level = package
            .load_overview_level_for_units_per_pixel(low_upp)
            .unwrap();
        assert!(low_level.units_per_bin >= low_upp.ceil() as i32);
        assert!(!low_level.bins.is_empty());

        let mid_upp = first.levels[first.levels.len() / 2].units_per_bin as f32 - 0.25;
        let target = mid_upp.max(1.0).ceil() as i32;
        let mid_level = package
            .load_overview_level_for_units_per_pixel(mid_upp)
            .unwrap();
        if first
            .levels
            .iter()
            .any(|level| level.units_per_bin >= target)
        {
            assert!(mid_level.units_per_bin >= target);
        }
        assert!(!mid_level.bins.is_empty());
    }

    #[test]
    fn selects_screen_sized_overview_level_for_units_per_pixel() {
        let (_input, package_root) = create_layoutpkg();
        write_custom_overview_pyramid(&package_root, &[10, 100, 1_000, 10_000]);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        for (upp, expected_units_per_bin) in [
            (1.0, 10),
            (10.0, 1_000),
            (80.0, 10_000),
            (100.0, 10_000),
            (10_000.0, 10_000),
            (-5.0, 10),
            (f32::NAN, 10),
            (f32::INFINITY, 10_000),
        ] {
            let level = package
                .load_overview_level_for_units_per_pixel(upp)
                .unwrap();
            assert_eq!(level.units_per_bin, expected_units_per_bin, "upp={upp}");
        }
    }

    #[test]
    fn selects_coarse_screen_overview_level_for_far_zoom() {
        let (_input, package_root) = create_layoutpkg();
        write_custom_overview_pyramid(&package_root, &[1024, 4096, 16_384, 65_536]);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let level = package
            .load_overview_level_for_units_per_pixel(768.0)
            .unwrap();

        assert_eq!(level.units_per_bin, 65_536);
    }

    #[test]
    fn reports_missing_overview_pyramid_as_unavailable() {
        let (_input, package_root) = create_layoutpkg();
        remove_overview_pyramid_from_manifest(&package_root);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        assert!(package.load_overview_pyramid().unwrap().is_none());
        assert!(package
            .load_overview_level_for_units_per_pixel(1.0)
            .is_err());
    }

    #[test]
    fn errors_when_overview_pyramid_has_no_levels() {
        let (_input, package_root) = create_layoutpkg();
        write_custom_overview_pyramid(&package_root, &[]);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let pyramid = package.load_overview_pyramid().unwrap().unwrap();
        assert!(pyramid.levels.is_empty());
        assert!(package
            .load_overview_level_for_units_per_pixel(1.0)
            .is_err());
    }

    #[test]
    fn exposes_layer_and_grid_overlay_dictionaries() {
        let (_input, package_root) = create_layoutpkg();
        let package = LayoutPackage::open(&package_root).unwrap();

        let layers = package.layers().unwrap();
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].id, 1);
        assert_eq!(layers[0].name, "M1");
        assert_eq!(layers[0].layer_type.as_deref(), Some("routing"));
        assert_eq!(layers[0].direction.as_deref(), Some("HORIZONTAL"));

        let overlays = package.grid_overlays().unwrap();
        assert_eq!(overlays.tracks.len(), 1);
        assert_eq!(overlays.tracks[0].id, 7);
        assert_eq!(overlays.tracks[0].direction, OverlayDirection::X);
        assert_eq!(overlays.tracks[0].layer_id, Some(1));
        assert_eq!(overlays.gcell_grids.len(), 1);
        assert_eq!(overlays.gcell_grids[0].direction, OverlayDirection::Y);
        assert_eq!(overlays.gcell_grids[0].step, 50);
    }

    #[test]
    fn exposes_detail_layer_counts_from_index_statistics() {
        let (_input, package_root) = create_layoutpkg();
        let package = LayoutPackage::open(&package_root).unwrap();

        let counts = package.detail_layer_counts();

        assert_eq!(counts.get(&1), Some(&4));
    }

    #[test]
    fn loads_klayout_like_hierarchy_document() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let hierarchy = package.load_hierarchy().unwrap().unwrap();
        let cached = package.load_hierarchy().unwrap().unwrap();

        assert_eq!(hierarchy, cached);
        assert_eq!(hierarchy.top_cell, 0);
        assert_eq!(hierarchy.cells[0].name, "reader-unit");
        assert_eq!(hierarchy.cells[0].instances.len(), 1);
        assert_eq!(hierarchy.cells[0].instances[0].child_cell, 2);
        let master = hierarchy.cells.iter().find(|cell| cell.id == 2).unwrap();
        assert_eq!(master.name, "NAND2");
        assert_eq!(master.shapes.len(), 1);
        assert_eq!(master.shapes[0].bbox, [2, 3, 8, 9]);
    }

    #[test]
    fn loads_detail_scope_document() {
        let (_input, package_root) = create_layoutpkg();
        write_detail_scope(&package_root);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let scope = package.load_detail_scope().unwrap().unwrap();
        let cached = package.load_detail_scope().unwrap().unwrap();

        assert_eq!(scope, cached);
        assert_eq!(scope.schema, layoutpkg_format::DETAIL_SCOPE_SCHEMA);
        assert!(scope.records.iter().any(|record| {
            record.source_id == 1
                && record.cell_id == 0
                && record.coordinates == layoutpkg_format::DetailCoordinates::Top
        }));
    }

    #[test]
    fn missing_detail_scope_is_reported_as_unavailable() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        assert!(package.load_detail_scope().unwrap().is_none());
    }

    #[test]
    fn exposes_hierarchy_cell_layer_summaries() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let hierarchy = package.load_hierarchy().unwrap().unwrap();

        let top_cell = hierarchy
            .cells
            .iter()
            .find(|cell| cell.id == hierarchy.top_cell)
            .unwrap();
        assert!(top_cell.hierarchy_summary.direct_instance_count > 0);

        let layer_summary = hierarchy
            .cells
            .iter()
            .flat_map(|cell| &cell.layer_summaries)
            .find(|summary| summary.shape_count > 0 && summary.total_area > 0)
            .expect("expected a non-empty cell layer summary");
        assert!(layer_summary.shape_count > 0);
        assert!(layer_summary.total_area > 0);
    }

    #[test]
    fn query_point_finds_smallest_queryable_record_near_point() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let hit = package.query_point(125, 125, 2, 8).unwrap().unwrap();

        assert_eq!(hit.tile_id.as_deref(), Some("0:0"));
        assert_eq!(hit.record.source_id, 1);
        assert_eq!(hit.record.x1, 100);
        assert_eq!(hit.record.y1, 100);
        assert_eq!(hit.record.x2, 150);
        assert_eq!(hit.record.y2, 150);
        assert_eq!(hit.source, QueryHitSource::Tile);
    }

    #[test]
    fn query_point_reads_records_from_detail_shard_offset() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let hit = package.query_point(725, 125, 2, 8).unwrap().unwrap();

        assert_eq!(hit.tile_id.as_deref(), Some("1:0"));
        assert_eq!(hit.record.source_id, 2);
        assert_eq!(hit.record.x1, 700);
        assert_eq!(hit.record.y1, 100);
        assert_eq!(hit.record.x2, 750);
        assert_eq!(hit.record.y2, 150);
        assert_eq!(hit.source, QueryHitSource::Tile);
    }

    #[test]
    fn query_point_returns_none_when_no_queryable_record_intersects_tolerance() {
        let (_input, package_root) = create_layoutpkg();
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let hit = package.query_point(500, 500, 2, 8).unwrap();

        assert!(hit.is_none());
    }

    #[test]
    fn query_point_can_return_shared_large_objects() {
        let (_input, package_root) = create_layoutpkg_with_options(8, 8, 2, true);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let hit = package.query_point(500, 5, 2, 8).unwrap().unwrap();

        assert_eq!(hit.source, QueryHitSource::LargeObject);
        assert_eq!(hit.record.x1, 0);
        assert_eq!(hit.record.y1, 0);
        assert_eq!(hit.record.x2, 1000);
        assert_eq!(hit.record.y2, 10);
    }

    #[test]
    fn loads_shared_large_objects_without_loading_detail_tiles() {
        let (_input, package_root) = create_layoutpkg_with_options(8, 8, 2, true);
        let mut package = LayoutPackage::open(&package_root).unwrap();

        let large = package.load_large_objects_only().unwrap();

        assert!(large
            .records
            .iter()
            .any(|record| record.x1 == 0 && record.y1 == 0));
        assert_eq!(package.cache_len(), 0);
    }
}
