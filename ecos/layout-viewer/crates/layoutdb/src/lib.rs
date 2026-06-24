use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap, HashSet},
    ops::Range,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::Result;
use layoutpkg_format::{
    CellArray, DetailCoordinates, DetailScopeDocument, HierarchyDocument, LayoutObjectKind,
    LayoutRectRecord, Orientation, OverviewBinRecord, Transform,
};
use rstar::{RTree, RTreeObject, AABB};

const EXPANDED_ARRAY_INSTANCE_THRESHOLD: u64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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

    pub fn width(self) -> i32 {
        self.x2 - self.x1
    }

    pub fn height(self) -> i32 {
        self.y2 - self.y1
    }

    pub fn intersects(self, other: Self) -> bool {
        self.x1 < other.x2 && self.x2 > other.x1 && self.y1 < other.y2 && self.y2 > other.y1
    }

    pub fn contains_point(self, x: i32, y: i32) -> bool {
        x >= self.x1 && x < self.x2 && y >= self.y1 && y < self.y2
    }
}

impl From<layoutpkg_reader::Rect> for Rect {
    fn from(rect: layoutpkg_reader::Rect) -> Self {
        Self::new(rect.x1, rect.y1, rect.x2, rect.y2)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerInfo {
    pub id: u16,
    pub name: String,
    pub layer_type: Option<String>,
    pub direction: Option<String>,
}

impl LayerInfo {
    pub fn new(id: u16, name: impl Into<String>) -> Self {
        Self {
            id,
            name: name.into(),
            layer_type: None,
            direction: None,
        }
    }
}

impl From<layoutpkg_reader::LayoutLayer> for LayerInfo {
    fn from(layer: layoutpkg_reader::LayoutLayer) -> Self {
        Self {
            id: layer.id,
            name: layer.name,
            layer_type: layer.layer_type,
            direction: layer.direction,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShapeKind {
    Die,
    Core,
    Instance,
    RegularWire,
    SpecialWire,
    Via,
    IoPin,
    Blockage,
    Fill,
    Region,
    Row,
    Track,
    GCellGrid,
}

impl ShapeKind {
    pub fn is_queryable(self) -> bool {
        matches!(
            self,
            Self::Instance
                | Self::RegularWire
                | Self::SpecialWire
                | Self::Via
                | Self::IoPin
                | Self::Blockage
                | Self::Fill
                | Self::Region
        )
    }
}

impl From<LayoutObjectKind> for ShapeKind {
    fn from(kind: LayoutObjectKind) -> Self {
        match kind {
            LayoutObjectKind::Die => Self::Die,
            LayoutObjectKind::Core => Self::Core,
            LayoutObjectKind::Instance => Self::Instance,
            LayoutObjectKind::RegularWire => Self::RegularWire,
            LayoutObjectKind::SpecialWire => Self::SpecialWire,
            LayoutObjectKind::Via => Self::Via,
            LayoutObjectKind::IoPin => Self::IoPin,
            LayoutObjectKind::Blockage => Self::Blockage,
            LayoutObjectKind::Fill => Self::Fill,
            LayoutObjectKind::Region => Self::Region,
            LayoutObjectKind::Row => Self::Row,
            LayoutObjectKind::Track => Self::Track,
            LayoutObjectKind::GCellGrid => Self::GCellGrid,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShapeRecord {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub source_id: u32,
    pub flags: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverviewDensityBin {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub count: u32,
    pub coverage_area: i64,
}

impl From<OverviewBinRecord> for OverviewDensityBin {
    fn from(record: OverviewBinRecord) -> Self {
        Self {
            bbox: Rect::new(
                record.bbox[0],
                record.bbox[1],
                record.bbox[2],
                record.bbox[3],
            ),
            layer_id: record.layer_id,
            kind: ShapeKind::from(record.kind),
            count: record.count,
            coverage_area: record.coverage_area,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellLayerStats {
    pub layer_id: u16,
    pub bbox: Rect,
    pub shape_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyShapeRecord {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub source_id: u32,
    pub instance_id: u32,
    pub cell: CellId,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HierarchyQueryResult {
    pub shapes: Vec<HierarchyShapeRecord>,
    pub instance_candidates_checked: usize,
    pub total_instances: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyInstanceRecord {
    pub bbox: Rect,
    pub array_bbox: Rect,
    pub instance_id: u32,
    pub source_id: u32,
    pub cell: CellId,
    pub child_cell: CellId,
    pub array_columns: u32,
    pub array_rows: u32,
    pub array_column: u32,
    pub array_row: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HierarchyInstanceQueryResult {
    pub instances: Vec<HierarchyInstanceRecord>,
    pub candidates_checked: usize,
    pub total_instances: usize,
    pub total_array_elements: u64,
    pub compact_array_elements_checked: u64,
}

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyPolicy {
    pub min_depth: usize,
    pub max_depth: usize,
    pub expand_arrays: bool,
    pub hidden_cells: HashSet<CellId>,
    pub selected_cells: HashSet<CellId>,
    pub ghost_cells: HashSet<CellId>,
}

impl Default for HierarchyPolicy {
    fn default() -> Self {
        Self {
            min_depth: 0,
            max_depth: usize::MAX,
            expand_arrays: true,
            hidden_cells: HashSet::new(),
            selected_cells: HashSet::new(),
            ghost_cells: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewShapeQuery {
    pub cell_view: CellViewState,
    pub viewport: Rect,
    pub min_depth: usize,
    pub max_depth: usize,
    pub layer_ids: Vec<u16>,
    pub include_kinds: Vec<ShapeKind>,
    pub policy: HierarchyPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewShapeRecord {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub source_id: u32,
    pub instance_id: u32,
    pub cell: CellId,
    pub depth: usize,
    pub instance_path: InstancePath,
    pub object_path: ObjectPath,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CellViewShapeQueryResult {
    pub shapes: Vec<CellViewShapeRecord>,
    pub instance_candidates_checked: usize,
    pub total_instances: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewInstanceQuery {
    pub cell_view: CellViewState,
    pub viewport: Rect,
    pub min_depth: usize,
    pub max_depth: usize,
    pub expand_arrays: bool,
    pub policy: HierarchyPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewInstanceRecord {
    pub bbox: Rect,
    pub array_bbox: Rect,
    pub instance_id: u32,
    pub source_id: u32,
    pub cell: CellId,
    pub child_cell: CellId,
    pub array_columns: u32,
    pub array_rows: u32,
    pub array_column: u32,
    pub array_row: u32,
    pub depth: usize,
    pub instance_path: InstancePath,
    pub object_path: ObjectPath,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CellViewInstanceQueryResult {
    pub instances: Vec<CellViewInstanceRecord>,
    pub candidates_checked: usize,
    pub total_instances: usize,
    pub total_array_elements: u64,
    pub compact_array_elements_checked: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HierarchyTreeRow {
    pub depth: usize,
    pub cell: CellId,
    pub parent_cell: Option<CellId>,
    pub instance_id: Option<u32>,
    pub source_id: Option<u32>,
    pub name: String,
    pub cell_name: String,
    pub bbox: Rect,
    pub instance_path: InstancePath,
    pub child_instance_count: usize,
    pub shape_count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HierarchyTreeRows {
    pub rows: Vec<HierarchyTreeRow>,
    pub truncated: bool,
}

impl HierarchyTreeRows {
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InstancePathElement {
    pub parent_cell: CellId,
    pub instance_id: u32,
    pub source_id: u32,
    pub child_cell: CellId,
    pub array_column: u32,
    pub array_row: u32,
    pub bbox: Rect,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct InstancePath {
    elements: Vec<InstancePathElement>,
}

impl InstancePath {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_elements(elements: Vec<InstancePathElement>) -> Self {
        Self { elements }
    }

    pub fn elements(&self) -> &[InstancePathElement] {
        &self.elements
    }

    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    pub fn depth(&self) -> usize {
        self.elements.len()
    }

    pub fn target_cell(&self) -> Option<CellId> {
        self.elements.last().map(|element| element.child_cell)
    }

    fn pushed(&self, element: InstancePathElement) -> Self {
        let mut elements = self.elements.clone();
        elements.push(element);
        Self { elements }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ShapeId {
    pub cell: CellId,
    pub shape_index: usize,
    pub source_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ObjectPathTarget {
    Shape(ShapeId),
    Instance {
        parent_cell: CellId,
        instance_id: u32,
        source_id: u32,
        child_cell: CellId,
        array_column: u32,
        array_row: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ObjectPath {
    pub instance_path: InstancePath,
    pub target: ObjectPathTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellViewState {
    context_cell: CellId,
    target_cell: CellId,
    specific_path: InstancePath,
}

impl CellViewState {
    pub fn top(db: &LayoutDb) -> Self {
        Self {
            context_cell: db.top_cell(),
            target_cell: db.top_cell(),
            specific_path: InstancePath::new(),
        }
    }

    pub fn from_path(context_cell: CellId, specific_path: InstancePath) -> Self {
        let target_cell = specific_path.target_cell().unwrap_or(context_cell);
        Self {
            context_cell,
            target_cell,
            specific_path,
        }
    }

    pub fn context_cell(&self) -> CellId {
        self.context_cell
    }

    pub fn target_cell(&self) -> CellId {
        self.target_cell
    }

    pub fn specific_path(&self) -> &InstancePath {
        &self.specific_path
    }

    pub fn ascend(&self) -> Self {
        let mut elements = self.specific_path.elements.clone();
        elements.pop();
        Self::from_path(self.context_cell, InstancePath::from_elements(elements))
    }

    pub fn reset_to_top(db: &LayoutDb) -> Self {
        Self::top(db)
    }
}

impl ShapeRecord {
    pub fn new(bbox: Rect, layer_id: u16, kind: ShapeKind, source_id: u32) -> Self {
        Self {
            bbox,
            layer_id,
            kind,
            source_id,
            flags: 0,
        }
    }
}

impl From<&LayoutRectRecord> for ShapeRecord {
    fn from(record: &LayoutRectRecord) -> Self {
        Self {
            bbox: Rect::new(record.x1, record.y1, record.x2, record.y2),
            layer_id: record.layer_id,
            kind: ShapeKind::from(record.kind),
            source_id: record.source_id,
            flags: record.flags,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CellId(usize);

impl CellId {
    #[cfg(test)]
    fn from_raw(raw: usize) -> Self {
        Self(raw)
    }

    pub fn raw(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone)]
pub struct Cell {
    name: String,
    bbox: Rect,
    shapes: Vec<ShapeRecord>,
    instances: Vec<CellInstance>,
    index: RefCell<Option<SpatialIndex>>,
    hierarchy_index: RefCell<Option<HierarchyIndex>>,
    layer_stats: HashMap<u16, CellLayerStats>,
}

#[derive(Debug, Clone)]
struct HierarchyIndex {
    instance_index: RTree<InstanceIndexEntry>,
    array_index: RTree<ArrayIndexEntry>,
}

impl Cell {
    fn new(name: impl Into<String>, world_bbox: Rect) -> Self {
        Self {
            name: name.into(),
            bbox: world_bbox,
            shapes: Vec::new(),
            instances: Vec::new(),
            index: RefCell::new(None),
            hierarchy_index: RefCell::new(None),
            layer_stats: HashMap::new(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn bbox(&self) -> Rect {
        self.bbox
    }

    pub fn shapes(&self) -> &[ShapeRecord] {
        &self.shapes
    }

    pub fn instances(&self) -> &[CellInstance] {
        &self.instances
    }

    pub fn layer_stats(&self, layer_id: u16) -> Option<CellLayerStats> {
        self.layer_stats.get(&layer_id).copied()
    }

    pub fn array_index_len(&self) -> usize {
        self.ensure_hierarchy_index().array_index.size()
    }

    #[cfg(test)]
    fn hierarchy_index_is_built(&self) -> bool {
        self.hierarchy_index.borrow().is_some()
    }

    #[cfg(test)]
    fn shape_index_is_built(&self) -> bool {
        self.index.borrow().is_some()
    }

    fn ensure_shape_index(&self) -> std::cell::Ref<'_, SpatialIndex> {
        if self.index.borrow().is_none() {
            self.index
                .replace(Some(SpatialIndex::from_shapes(self.bbox, &self.shapes)));
        }
        std::cell::Ref::map(self.index.borrow(), |index| {
            index.as_ref().expect("shape index should be built")
        })
    }

    fn add_instance(&mut self, instance: CellInstance, child_bbox: Rect) {
        let _ = child_bbox;
        self.instances.push(instance);
        self.hierarchy_index.replace(None);
    }

    fn ensure_hierarchy_index(&self) -> std::cell::Ref<'_, HierarchyIndex> {
        if self.hierarchy_index.borrow().is_none() {
            let mut instance_entries = Vec::new();
            let mut array_entries = Vec::new();
            for (instance_index, instance) in self.instances.iter().enumerate() {
                append_hierarchy_index_entries(
                    instance_index,
                    instance,
                    &mut instance_entries,
                    &mut array_entries,
                );
            }
            self.hierarchy_index.replace(Some(HierarchyIndex {
                instance_index: RTree::bulk_load(instance_entries),
                array_index: RTree::bulk_load(array_entries),
            }));
        }
        std::cell::Ref::map(self.hierarchy_index.borrow(), |index| {
            index.as_ref().expect("hierarchy index should be built")
        })
    }
}

fn append_hierarchy_index_entries(
    instance_index: usize,
    instance: &CellInstance,
    instance_entries: &mut Vec<InstanceIndexEntry>,
    array_entries: &mut Vec<ArrayIndexEntry>,
) {
    let columns = instance.array.columns.max(1);
    let rows = instance.array.rows.max(1);
    let elements = u64::from(columns) * u64::from(rows);
    if elements > EXPANDED_ARRAY_INSTANCE_THRESHOLD {
        array_entries.push(ArrayIndexEntry {
            bbox: instance.bbox,
            instance_index,
        });
    } else {
        for row in 0..rows {
            for column in 0..columns {
                instance_entries.push(InstanceIndexEntry {
                    bbox: instance.bbox,
                    instance_index,
                    column,
                    row,
                });
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellInstance {
    pub id: u32,
    pub name: String,
    pub child_cell: CellId,
    pub transform: Transform,
    pub array: CellArray,
    pub bbox: Rect,
    pub source_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct InstanceIndexEntry {
    bbox: Rect,
    instance_index: usize,
    column: u32,
    row: u32,
}

impl RTreeObject for InstanceIndexEntry {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        rect_to_aabb(self.bbox)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ArrayIndexEntry {
    bbox: Rect,
    instance_index: usize,
}

impl RTreeObject for ArrayIndexEntry {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        rect_to_aabb(self.bbox)
    }
}

fn rect_to_aabb(rect: Rect) -> AABB<[f64; 2]> {
    AABB::from_corners(
        [f64::from(rect.x1), f64::from(rect.y1)],
        [f64::from(rect.x2), f64::from(rect.y2)],
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShapeQuery {
    pub viewport: Rect,
    pub layer_id: Option<u16>,
    pub kind: Option<ShapeKind>,
}

impl ShapeQuery {
    pub fn new(viewport: Rect) -> Self {
        Self {
            viewport,
            layer_id: None,
            kind: None,
        }
    }

    pub fn with_layer(mut self, layer_id: u16) -> Self {
        self.layer_id = Some(layer_id);
        self
    }

    pub fn with_kind(mut self, kind: ShapeKind) -> Self {
        self.kind = Some(kind);
        self
    }
}

#[derive(Debug, Clone)]
pub struct ShapeQueryResult<'a> {
    pub shapes: Vec<&'a ShapeRecord>,
    pub candidates_checked: usize,
    pub total_shapes_in_cell: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageRecord {
    pub bbox: Rect,
    pub layer_id: u16,
    pub kind: ShapeKind,
    pub source_id: u32,
    pub flags: u8,
}

impl From<&LayoutRectRecord> for CoverageRecord {
    fn from(record: &LayoutRectRecord) -> Self {
        Self {
            bbox: Rect::new(record.x1, record.y1, record.x2, record.y2),
            layer_id: record.layer_id,
            kind: ShapeKind::from(record.kind),
            source_id: record.source_id,
            flags: record.flags,
        }
    }
}

#[derive(Debug, Clone)]
struct SpatialIndex {
    world_bbox: Rect,
    bins_per_axis: usize,
    all_bins: HashMap<SpatialBin, Vec<usize>>,
    layer_bins: HashMap<u16, HashMap<SpatialBin, Vec<usize>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct SpatialBin {
    x: usize,
    y: usize,
}

impl SpatialIndex {
    fn new(world_bbox: Rect) -> Self {
        Self {
            world_bbox,
            bins_per_axis: 128,
            all_bins: HashMap::new(),
            layer_bins: HashMap::new(),
        }
    }

    fn from_shapes(world_bbox: Rect, shapes: &[ShapeRecord]) -> Self {
        let mut index = Self::new(world_bbox);
        for (shape_index, shape) in shapes.iter().enumerate() {
            index.insert(shape_index, shape);
        }
        index
    }

    fn insert(&mut self, shape_index: usize, shape: &ShapeRecord) {
        for bin in self.bins_for_rect(shape.bbox) {
            self.all_bins.entry(bin).or_default().push(shape_index);
            self.layer_bins
                .entry(shape.layer_id)
                .or_default()
                .entry(bin)
                .or_default()
                .push(shape_index);
        }
    }

    fn candidate_indexes(&self, query: ShapeQuery) -> Vec<usize> {
        let bins = self.bins_for_rect(query.viewport);
        let source_bins = query
            .layer_id
            .and_then(|layer_id| self.layer_bins.get(&layer_id))
            .unwrap_or(&self.all_bins);
        let mut seen = HashSet::new();
        let mut candidates = Vec::new();
        for bin in bins {
            let Some(indexes) = source_bins.get(&bin) else {
                continue;
            };
            for index in indexes {
                if seen.insert(*index) {
                    candidates.push(*index);
                }
            }
        }
        candidates
    }

    fn bins_for_rect(&self, rect: Rect) -> Vec<SpatialBin> {
        let min_x = self.bin_x(rect.x1);
        let max_x = self.bin_x(rect.x2.saturating_sub(1));
        let min_y = self.bin_y(rect.y1);
        let max_y = self.bin_y(rect.y2.saturating_sub(1));
        let mut bins = Vec::new();
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                bins.push(SpatialBin { x, y });
            }
        }
        bins
    }

    fn bin_x(&self, value: i32) -> usize {
        self.bin_for_axis(value, self.world_bbox.x1, self.world_bbox.width())
    }

    fn bin_y(&self, value: i32) -> usize {
        self.bin_for_axis(value, self.world_bbox.y1, self.world_bbox.height())
    }

    fn bin_for_axis(&self, value: i32, origin: i32, extent: i32) -> usize {
        let extent = extent.max(1) as f64;
        let local = (value - origin) as f64;
        let raw = ((local / extent) * self.bins_per_axis as f64).floor() as isize;
        raw.clamp(0, self.bins_per_axis as isize - 1) as usize
    }
}

#[derive(Debug, Clone)]
pub struct LayoutDb {
    design_name: String,
    world_bbox: Rect,
    layers: Vec<LayerInfo>,
    cells: Vec<Cell>,
    top_cell: CellId,
    package_cell_ids: HashMap<u32, CellId>,
    package_layer_counts: BTreeMap<u16, usize>,
    coverage: Vec<CoverageRecord>,
    overview_bins: Vec<OverviewDensityBin>,
}

impl LayoutDb {
    pub fn new(design_name: impl Into<String>, world_bbox: Rect) -> Self {
        Self {
            design_name: design_name.into(),
            world_bbox,
            layers: Vec::new(),
            cells: vec![Cell::new("top", world_bbox)],
            top_cell: CellId(0),
            package_cell_ids: HashMap::from([(0, CellId(0))]),
            package_layer_counts: BTreeMap::new(),
            coverage: Vec::new(),
            overview_bins: Vec::new(),
        }
    }

    pub fn from_layout_package(
        package: &mut layoutpkg_reader::LayoutPackage,
        cache_capacity: usize,
    ) -> Result<Self> {
        let mut db = Self::new(package.design_name(), Rect::from(package.world_bbox()));
        db.set_package_layer_counts(package.detail_layer_counts());
        for layer in package.layers()? {
            db.add_layer(LayerInfo::from(layer));
        }

        let batch = package.load_detail_viewport(package.world_bbox(), cache_capacity)?;
        let top = db.top_cell();
        for tile in &batch.tiles {
            for record in tile.records.iter() {
                db.add_shape(top, ShapeRecord::from(record));
            }
        }
        for record in batch.large_objects.records.iter() {
            db.add_shape(top, ShapeRecord::from(record));
        }

        Ok(db)
    }

    pub fn from_hierarchy_document(
        design_name: impl Into<String>,
        world_bbox: Rect,
        hierarchy: HierarchyDocument,
    ) -> Self {
        Self::from_hierarchy_document_profiled(design_name, world_bbox, hierarchy).0
    }

    pub fn from_hierarchy_document_profiled(
        design_name: impl Into<String>,
        world_bbox: Rect,
        hierarchy: HierarchyDocument,
    ) -> (Self, HierarchyBuildProfile) {
        let layer_count_started = std::time::Instant::now();
        let package_layer_counts = hierarchy_layer_counts(&hierarchy);
        let layer_count = layer_count_started.elapsed();
        let mut db = Self {
            design_name: design_name.into(),
            world_bbox,
            layers: Vec::new(),
            cells: Vec::new(),
            top_cell: CellId(0),
            package_cell_ids: HashMap::new(),
            package_layer_counts,
            coverage: Vec::new(),
            overview_bins: Vec::new(),
        };
        let cell_alloc_started = std::time::Instant::now();
        let mut cell_ids = HashMap::new();
        for cell in &hierarchy.cells {
            let id = CellId(db.cells.len());
            if cell.id == hierarchy.top_cell {
                db.top_cell = id;
            }
            cell_ids.insert(cell.id, id);
            db.cells.push(Cell::new(
                cell.name.clone(),
                Rect::new(cell.bbox[0], cell.bbox[1], cell.bbox[2], cell.bbox[3]),
            ));
        }
        let cell_alloc = cell_alloc_started.elapsed();
        let cell_map_started = std::time::Instant::now();
        db.package_cell_ids = cell_ids.clone();
        let cell_map = cell_map_started.elapsed();
        let mut shape_import = Duration::default();
        let mut instance_import = Duration::default();
        for cell in hierarchy.cells {
            let Some(cell_id) = cell_ids.get(&cell.id).copied() else {
                continue;
            };
            let shape_import_started = std::time::Instant::now();
            for shape in cell.shapes {
                db.add_shape(
                    cell_id,
                    ShapeRecord::new(
                        Rect::new(shape.bbox[0], shape.bbox[1], shape.bbox[2], shape.bbox[3]),
                        shape.layer_id,
                        ShapeKind::from(shape.kind),
                        shape.source_id,
                    ),
                );
            }
            shape_import += shape_import_started.elapsed();
            let instance_import_started = std::time::Instant::now();
            for instance in cell.instances {
                let Some(child_cell) = cell_ids.get(&instance.child_cell).copied() else {
                    continue;
                };
                db.add_instance(
                    cell_id,
                    CellInstance {
                        id: instance.id,
                        name: instance.name,
                        child_cell,
                        transform: instance.transform,
                        array: instance.array,
                        bbox: Rect::new(
                            instance.bbox[0],
                            instance.bbox[1],
                            instance.bbox[2],
                            instance.bbox[3],
                        ),
                        source_id: instance.source_id,
                    },
                );
            }
            instance_import += instance_import_started.elapsed();
        }
        (
            db,
            HierarchyBuildProfile {
                layer_count,
                cell_alloc,
                cell_map,
                shape_import,
                instance_import,
            },
        )
    }

    pub fn design_name(&self) -> &str {
        &self.design_name
    }

    pub fn world_bbox(&self) -> Rect {
        self.world_bbox
    }

    pub fn top_cell(&self) -> CellId {
        self.top_cell
    }

    pub fn add_layer(&mut self, layer: LayerInfo) {
        self.layers.push(layer);
    }

    pub fn layers(&self) -> &[LayerInfo] {
        &self.layers
    }

    pub fn set_package_layer_counts(&mut self, counts: BTreeMap<u16, usize>) {
        self.package_layer_counts = counts;
    }

    pub fn package_layer_counts(&self) -> &BTreeMap<u16, usize> {
        &self.package_layer_counts
    }

    pub fn with_overview_bins(mut self, bins: Vec<OverviewDensityBin>) -> Self {
        self.overview_bins = bins;
        self
    }

    pub fn set_overview_bins(&mut self, bins: Vec<OverviewDensityBin>) {
        self.overview_bins = bins;
    }

    pub fn overview_bins(&self, viewport: Rect) -> impl Iterator<Item = &OverviewDensityBin> {
        self.overview_bins
            .iter()
            .filter(move |bin| bin.bbox.intersects(viewport))
    }

    pub fn cell(&self, id: CellId) -> Option<&Cell> {
        self.cells.get(id.0)
    }

    pub fn cell_by_name(&self, name: &str) -> Option<CellId> {
        self.cells
            .iter()
            .position(|cell| cell.name() == name)
            .map(CellId)
    }

    pub fn add_shape(&mut self, cell: CellId, shape: ShapeRecord) {
        if let Some(cell) = self.cells.get_mut(cell.0) {
            cell.layer_stats
                .entry(shape.layer_id)
                .and_modify(|stats| {
                    stats.bbox = Rect::new(
                        stats.bbox.x1.min(shape.bbox.x1),
                        stats.bbox.y1.min(shape.bbox.y1),
                        stats.bbox.x2.max(shape.bbox.x2),
                        stats.bbox.y2.max(shape.bbox.y2),
                    );
                    stats.shape_count += 1;
                })
                .or_insert(CellLayerStats {
                    layer_id: shape.layer_id,
                    bbox: shape.bbox,
                    shape_count: 1,
                });
            cell.shapes.push(shape);
            cell.index.replace(None);
        }
    }

    pub fn add_cell(&mut self, name: impl Into<String>, bbox: Rect) -> CellId {
        let id = CellId(self.cells.len());
        self.cells.push(Cell::new(name, bbox));
        id
    }

    pub fn add_instance(&mut self, cell: CellId, instance: CellInstance) {
        let Some(child_bbox) = self.cells.get(instance.child_cell.0).map(child_bbox) else {
            return;
        };
        if let Some(cell) = self.cells.get_mut(cell.0) {
            cell.add_instance(instance, child_bbox);
        }
    }

    pub fn query_shapes(&self, cell: CellId, viewport: Rect) -> Vec<&ShapeRecord> {
        self.cells
            .get(cell.0)
            .map(|cell| {
                cell.shapes
                    .iter()
                    .filter(|shape| shape.bbox.intersects(viewport))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn query_shapes_by_layer(
        &self,
        cell: CellId,
        layer_id: u16,
        viewport: Rect,
    ) -> Vec<&ShapeRecord> {
        self.query_shapes(cell, viewport)
            .into_iter()
            .filter(|shape| shape.layer_id == layer_id)
            .collect()
    }

    pub fn query_shapes_indexed(
        &self,
        cell: CellId,
        layer_id: Option<u16>,
        viewport: Rect,
    ) -> ShapeQueryResult<'_> {
        let query = match layer_id {
            Some(layer_id) => ShapeQuery::new(viewport).with_layer(layer_id),
            None => ShapeQuery::new(viewport),
        };
        self.query_shapes_indexed_with_filter(cell, query)
    }

    pub fn query_shapes_indexed_with_filter(
        &self,
        cell: CellId,
        query: ShapeQuery,
    ) -> ShapeQueryResult<'_> {
        let Some(cell) = self.cells.get(cell.0) else {
            return ShapeQueryResult {
                shapes: Vec::new(),
                candidates_checked: 0,
                total_shapes_in_cell: 0,
            };
        };
        let candidates = cell.ensure_shape_index().candidate_indexes(query);
        let mut shapes = Vec::new();
        for index in &candidates {
            let Some(shape) = cell.shapes.get(*index) else {
                continue;
            };
            if !shape.bbox.intersects(query.viewport) {
                continue;
            }
            if let Some(layer_id) = query.layer_id {
                if shape.layer_id != layer_id {
                    continue;
                }
            }
            if let Some(kind) = query.kind {
                if shape.kind != kind {
                    continue;
                }
            }
            shapes.push(shape);
        }
        ShapeQueryResult {
            shapes,
            candidates_checked: candidates.len(),
            total_shapes_in_cell: cell.shapes.len(),
        }
    }

    pub fn query_hierarchy_shapes(
        &self,
        viewport: Rect,
        max_depth: usize,
    ) -> Vec<HierarchyShapeRecord> {
        self.query_hierarchy_shapes_indexed(viewport, max_depth)
            .shapes
    }

    pub fn query_hierarchy_shapes_indexed(
        &self,
        viewport: Rect,
        max_depth: usize,
    ) -> HierarchyQueryResult {
        let mut result = HierarchyQueryResult::default();
        let mut path = Vec::new();
        self.collect_hierarchy_shapes(
            self.top_cell,
            viewport,
            max_depth,
            0,
            0,
            AffineTransform::identity(),
            0,
            &mut result,
            &mut path,
        );
        result
    }

    pub fn query_hierarchy_instances_indexed(
        &self,
        viewport: Rect,
        max_depth: usize,
    ) -> HierarchyInstanceQueryResult {
        let mut result = HierarchyInstanceQueryResult::default();
        let mut path = Vec::new();
        self.collect_hierarchy_instances(
            self.top_cell,
            viewport,
            max_depth,
            0,
            0,
            true,
            AffineTransform::identity(),
            &mut result,
            &mut path,
        );
        result
    }

    pub fn query_hierarchy_instances_aggregate(
        &self,
        viewport: Rect,
        max_depth: usize,
    ) -> HierarchyInstanceQueryResult {
        let mut result = HierarchyInstanceQueryResult::default();
        let mut path = Vec::new();
        self.collect_hierarchy_instances_unexpanded(
            self.top_cell,
            viewport,
            max_depth,
            0,
            0,
            AffineTransform::identity(),
            &mut result,
            &mut path,
        );
        result
    }

    pub fn query_recursive_shapes(&self, query: RecursiveShapeQuery) -> HierarchyQueryResult {
        let mut result = HierarchyQueryResult::default();
        let mut path = Vec::new();
        self.collect_hierarchy_shapes(
            self.top_cell,
            query.viewport,
            query.max_depth,
            0,
            query.min_depth,
            AffineTransform::identity(),
            0,
            &mut result,
            &mut path,
        );
        result.shapes.retain(|shape| {
            (query.layer_ids.is_empty() || query.layer_ids.contains(&shape.layer_id))
                && (query.include_kinds.is_empty() || query.include_kinds.contains(&shape.kind))
        });
        result
    }

    pub fn query_cell_view_shapes(&self, query: CellViewShapeQuery) -> CellViewShapeQueryResult {
        let mut result = CellViewShapeQueryResult::default();
        let mut path = Vec::new();
        let min_depth = query.min_depth.max(query.policy.min_depth);
        let max_depth = query.max_depth.min(query.policy.max_depth);
        self.collect_cell_view_shapes(
            query.cell_view.target_cell(),
            query.viewport,
            max_depth,
            0,
            min_depth,
            AffineTransform::identity(),
            0,
            query.cell_view.specific_path().clone(),
            &query.layer_ids,
            &query.include_kinds,
            &query.policy,
            &mut result,
            &mut path,
        );
        result
    }

    pub fn query_recursive_instances(
        &self,
        query: RecursiveInstanceQuery,
    ) -> HierarchyInstanceQueryResult {
        if !query.expand_arrays {
            let mut result = HierarchyInstanceQueryResult::default();
            let mut path = Vec::new();
            self.collect_hierarchy_instances_unexpanded(
                self.top_cell,
                query.viewport,
                query.max_depth,
                0,
                query.min_depth,
                AffineTransform::identity(),
                &mut result,
                &mut path,
            );
            return result;
        }
        let mut result = HierarchyInstanceQueryResult::default();
        let mut path = Vec::new();
        self.collect_hierarchy_instances(
            self.top_cell,
            query.viewport,
            query.max_depth,
            0,
            query.min_depth,
            query.expand_arrays,
            AffineTransform::identity(),
            &mut result,
            &mut path,
        );
        result
    }

    pub fn query_cell_view_instances(
        &self,
        query: CellViewInstanceQuery,
    ) -> CellViewInstanceQueryResult {
        let mut result = CellViewInstanceQueryResult::default();
        let mut path = Vec::new();
        let min_depth = query.min_depth.max(query.policy.min_depth);
        let max_depth = query.max_depth.min(query.policy.max_depth);
        let expand_arrays = query.expand_arrays && query.policy.expand_arrays;
        self.collect_cell_view_instances(
            query.cell_view.target_cell(),
            query.viewport,
            max_depth,
            0,
            min_depth,
            expand_arrays,
            AffineTransform::identity(),
            query.cell_view.specific_path().clone(),
            &query.policy,
            &mut result,
            &mut path,
        );
        result
    }

    pub fn hierarchy_tree_rows(
        &self,
        cell_view: CellViewState,
        max_depth: usize,
        max_rows: usize,
    ) -> HierarchyTreeRows {
        let mut result = HierarchyTreeRows::default();
        let Some(cell) = self.cell(cell_view.target_cell()) else {
            return result;
        };
        let root_path = cell_view.specific_path().clone();
        if !push_hierarchy_tree_row(
            &mut result,
            max_rows,
            HierarchyTreeRow {
                depth: 0,
                cell: cell_view.target_cell(),
                parent_cell: None,
                instance_id: None,
                source_id: None,
                name: cell.name().to_owned(),
                cell_name: cell.name().to_owned(),
                bbox: cell.bbox(),
                instance_path: root_path.clone(),
                child_instance_count: cell.instances.len(),
                shape_count: cell.shapes.len(),
            },
        ) {
            return result;
        }
        if max_depth == 0 {
            return result;
        }
        let mut path = cell_view_cell_stack(&cell_view);
        if !path.contains(&cell_view.target_cell()) {
            path.push(cell_view.target_cell());
        }
        self.collect_hierarchy_tree_rows(
            cell_view.target_cell(),
            0,
            max_depth,
            AffineTransform::identity(),
            root_path,
            &mut path,
            max_rows,
            &mut result,
        );
        result
    }

    fn collect_cell_view_shapes(
        &self,
        cell_id: CellId,
        viewport: Rect,
        depth_remaining: usize,
        current_depth: usize,
        min_depth: usize,
        cell_to_world: AffineTransform,
        instance_id: u32,
        instance_path: InstancePath,
        layer_ids: &[u16],
        include_kinds: &[ShapeKind],
        policy: &HierarchyPolicy,
        result: &mut CellViewShapeQueryResult,
        path: &mut Vec<CellId>,
    ) {
        if policy.hidden_cells.contains(&cell_id) {
            return;
        }
        let Some(cell) = self.cell(cell_id) else {
            return;
        };
        result.total_instances += cell.instances.len();
        path.push(cell_id);
        for (shape_index, shape) in cell.shapes.iter().enumerate() {
            let bbox = cell_to_world.transform_rect(shape.bbox);
            if !bbox.intersects(viewport) {
                continue;
            }
            if current_depth < min_depth {
                continue;
            }
            if !layer_ids.is_empty() && !layer_ids.contains(&shape.layer_id) {
                continue;
            }
            if !include_kinds.is_empty() && !include_kinds.contains(&shape.kind) {
                continue;
            }
            let shape_id = ShapeId {
                cell: cell_id,
                shape_index,
                source_id: shape.source_id,
            };
            result.shapes.push(CellViewShapeRecord {
                bbox,
                layer_id: shape.layer_id,
                kind: shape.kind,
                source_id: shape.source_id,
                instance_id,
                cell: cell_id,
                depth: current_depth,
                instance_path: instance_path.clone(),
                object_path: ObjectPath {
                    instance_path: instance_path.clone(),
                    target: ObjectPathTarget::Shape(shape_id),
                },
            });
        }
        if depth_remaining == 0 {
            path.pop();
            return;
        }
        let query_viewport = cell_to_world
            .inverse()
            .map(|world_to_cell| world_to_cell.transform_rect(viewport))
            .unwrap_or(viewport);
        let hierarchy_index = cell.ensure_hierarchy_index();
        for candidate in hierarchy_index
            .instance_index
            .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
        {
            result.instance_candidates_checked += 1;
            let Some(instance) = cell.instances.get(candidate.instance_index) else {
                continue;
            };
            if !policy.expand_arrays
                && (instance.array.columns.max(1) > 1 || instance.array.rows.max(1) > 1)
            {
                continue;
            }
            let Some(child) = self.cell(instance.child_cell) else {
                continue;
            };
            if policy.hidden_cells.contains(&instance.child_cell) {
                continue;
            }
            if path.contains(&instance.child_cell) {
                continue;
            }
            let child_bbox = child_bbox(child);
            let child_to_parent = AffineTransform::from_instance(
                instance,
                child_bbox,
                candidate.column,
                candidate.row,
            );
            let child_to_world = cell_to_world.then(child_to_parent);
            let bbox = child_to_world.transform_rect(child_bbox);
            if !bbox.intersects(viewport) {
                continue;
            }
            let child_path = instance_path.pushed(InstancePathElement {
                parent_cell: cell_id,
                instance_id: instance.id,
                source_id: instance.source_id,
                child_cell: instance.child_cell,
                array_column: candidate.column,
                array_row: candidate.row,
                bbox,
            });
            self.collect_cell_view_shapes(
                instance.child_cell,
                viewport,
                depth_remaining - 1,
                current_depth + 1,
                min_depth,
                child_to_world,
                instance.id,
                child_path,
                layer_ids,
                include_kinds,
                policy,
                result,
                path,
            );
        }
        if policy.expand_arrays {
            for entry in hierarchy_index
                .array_index
                .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
            {
                result.instance_candidates_checked += 1;
                let Some(instance) = cell.instances.get(entry.instance_index) else {
                    continue;
                };
                let Some(child) = self.cell(instance.child_cell) else {
                    continue;
                };
                if policy.hidden_cells.contains(&instance.child_cell) {
                    continue;
                }
                if path.contains(&instance.child_cell) {
                    continue;
                }
                let child_bbox = child_bbox(child);
                let (column_range, row_range) =
                    compact_array_candidate_ranges(instance, child_bbox, query_viewport);
                for row in row_range {
                    for column in column_range.clone() {
                        let child_to_parent =
                            AffineTransform::from_instance(instance, child_bbox, column, row);
                        let child_to_world = cell_to_world.then(child_to_parent);
                        let bbox = child_to_world.transform_rect(child_bbox);
                        if !bbox.intersects(viewport) {
                            continue;
                        }
                        let child_path = instance_path.pushed(InstancePathElement {
                            parent_cell: cell_id,
                            instance_id: instance.id,
                            source_id: instance.source_id,
                            child_cell: instance.child_cell,
                            array_column: column,
                            array_row: row,
                            bbox,
                        });
                        self.collect_cell_view_shapes(
                            instance.child_cell,
                            viewport,
                            depth_remaining - 1,
                            current_depth + 1,
                            min_depth,
                            child_to_world,
                            instance.id,
                            child_path,
                            layer_ids,
                            include_kinds,
                            policy,
                            result,
                            path,
                        );
                    }
                }
            }
        }
        path.pop();
    }

    fn collect_cell_view_instances(
        &self,
        cell_id: CellId,
        viewport: Rect,
        depth_remaining: usize,
        current_depth: usize,
        min_depth: usize,
        expand_arrays: bool,
        cell_to_world: AffineTransform,
        instance_path: InstancePath,
        policy: &HierarchyPolicy,
        result: &mut CellViewInstanceQueryResult,
        path: &mut Vec<CellId>,
    ) {
        if policy.hidden_cells.contains(&cell_id) {
            return;
        }
        let Some(cell) = self.cell(cell_id) else {
            return;
        };
        result.total_instances += cell.instances.len();
        if depth_remaining == 0 {
            return;
        }
        path.push(cell_id);
        if expand_arrays {
            let query_viewport = cell_to_world
                .inverse()
                .map(|world_to_cell| world_to_cell.transform_rect(viewport))
                .unwrap_or(viewport);
            let hierarchy_index = cell.ensure_hierarchy_index();
            for candidate in hierarchy_index
                .instance_index
                .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
            {
                result.candidates_checked += 1;
                let Some(instance) = cell.instances.get(candidate.instance_index) else {
                    continue;
                };
                let Some(child) = self.cell(instance.child_cell) else {
                    continue;
                };
                if policy.hidden_cells.contains(&instance.child_cell) {
                    continue;
                }
                if path.contains(&instance.child_cell) {
                    continue;
                }
                let child_bbox = child_bbox(child);
                let child_to_parent = AffineTransform::from_instance(
                    instance,
                    child_bbox,
                    candidate.column,
                    candidate.row,
                );
                let child_to_world = cell_to_world.then(child_to_parent);
                let bbox = child_to_world.transform_rect(child_bbox);
                if !bbox.intersects(viewport) {
                    continue;
                }
                let array_bbox = cell_to_world.transform_rect(instance.bbox);
                let child_path = instance_path.pushed(InstancePathElement {
                    parent_cell: cell_id,
                    instance_id: instance.id,
                    source_id: instance.source_id,
                    child_cell: instance.child_cell,
                    array_column: candidate.column,
                    array_row: candidate.row,
                    bbox,
                });
                let instance_depth = current_depth + 1;
                if instance_depth >= min_depth {
                    push_cell_view_instance_record(
                        result,
                        cell_id,
                        instance,
                        bbox,
                        array_bbox,
                        candidate.column,
                        candidate.row,
                        instance_depth,
                        child_path.clone(),
                    );
                }
                self.collect_cell_view_instances(
                    instance.child_cell,
                    viewport,
                    depth_remaining - 1,
                    instance_depth,
                    min_depth,
                    expand_arrays,
                    child_to_world,
                    child_path,
                    policy,
                    result,
                    path,
                );
            }
            for entry in hierarchy_index
                .array_index
                .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
            {
                result.candidates_checked += 1;
                let Some(instance) = cell.instances.get(entry.instance_index) else {
                    continue;
                };
                let Some(child) = self.cell(instance.child_cell) else {
                    continue;
                };
                if policy.hidden_cells.contains(&instance.child_cell) {
                    continue;
                }
                if path.contains(&instance.child_cell) {
                    continue;
                }
                let child_bbox = child_bbox(child);
                let columns = instance.array.columns.max(1);
                let rows = instance.array.rows.max(1);
                result.total_array_elements = result
                    .total_array_elements
                    .saturating_add(u64::from(columns) * u64::from(rows));
                let array_bbox = cell_to_world.transform_rect(instance.bbox);
                let (column_range, row_range) =
                    compact_array_candidate_ranges(instance, child_bbox, query_viewport);
                let instance_depth = current_depth + 1;
                for row in row_range {
                    for column in column_range.clone() {
                        result.compact_array_elements_checked =
                            result.compact_array_elements_checked.saturating_add(1);
                        let child_to_parent =
                            AffineTransform::from_instance(instance, child_bbox, column, row);
                        let child_to_world = cell_to_world.then(child_to_parent);
                        let bbox = child_to_world.transform_rect(child_bbox);
                        if !bbox.intersects(viewport) {
                            continue;
                        }
                        let child_path = instance_path.pushed(InstancePathElement {
                            parent_cell: cell_id,
                            instance_id: instance.id,
                            source_id: instance.source_id,
                            child_cell: instance.child_cell,
                            array_column: column,
                            array_row: row,
                            bbox,
                        });
                        if instance_depth >= min_depth {
                            push_cell_view_instance_record(
                                result,
                                cell_id,
                                instance,
                                bbox,
                                array_bbox,
                                column,
                                row,
                                instance_depth,
                                child_path.clone(),
                            );
                        }
                        self.collect_cell_view_instances(
                            instance.child_cell,
                            viewport,
                            depth_remaining - 1,
                            instance_depth,
                            min_depth,
                            expand_arrays,
                            child_to_world,
                            child_path,
                            policy,
                            result,
                            path,
                        );
                    }
                }
            }
        } else {
            for instance in &cell.instances {
                result.candidates_checked += 1;
                let Some(child) = self.cell(instance.child_cell) else {
                    continue;
                };
                if policy.hidden_cells.contains(&instance.child_cell) {
                    continue;
                }
                if path.contains(&instance.child_cell) {
                    continue;
                }
                let bbox = cell_to_world.transform_rect(instance.bbox);
                if !bbox.intersects(viewport) {
                    continue;
                }
                let child_bbox = child_bbox(child);
                let child_path = instance_path.pushed(InstancePathElement {
                    parent_cell: cell_id,
                    instance_id: instance.id,
                    source_id: instance.source_id,
                    child_cell: instance.child_cell,
                    array_column: 0,
                    array_row: 0,
                    bbox,
                });
                let instance_depth = current_depth + 1;
                if instance_depth >= min_depth {
                    push_cell_view_instance_record(
                        result,
                        cell_id,
                        instance,
                        bbox,
                        bbox,
                        0,
                        0,
                        instance_depth,
                        child_path.clone(),
                    );
                }
                if instance.array.columns.max(1) == 1 && instance.array.rows.max(1) == 1 {
                    let child_to_parent =
                        AffineTransform::from_instance(instance, child_bbox, 0, 0);
                    let child_to_world = cell_to_world.then(child_to_parent);
                    self.collect_cell_view_instances(
                        instance.child_cell,
                        viewport,
                        depth_remaining - 1,
                        instance_depth,
                        min_depth,
                        expand_arrays,
                        child_to_world,
                        child_path,
                        policy,
                        result,
                        path,
                    );
                }
            }
        }
        path.pop();
    }

    fn collect_hierarchy_tree_rows(
        &self,
        cell_id: CellId,
        current_depth: usize,
        max_depth: usize,
        cell_to_root: AffineTransform,
        instance_path: InstancePath,
        path: &mut Vec<CellId>,
        max_rows: usize,
        result: &mut HierarchyTreeRows,
    ) {
        if result.truncated || current_depth >= max_depth {
            return;
        }
        let Some(cell) = self.cell(cell_id) else {
            return;
        };
        for instance in &cell.instances {
            let Some(child) = self.cell(instance.child_cell) else {
                continue;
            };
            let child_bbox = child.bbox();
            let columns = instance.array.columns.max(1);
            let rows = instance.array.rows.max(1);
            for row in 0..rows {
                for column in 0..columns {
                    let child_to_parent =
                        AffineTransform::from_instance(instance, child_bbox, column, row);
                    let child_to_root = cell_to_root.then(child_to_parent);
                    let bbox = child_to_root.transform_rect(child_bbox);
                    let child_path = instance_path.pushed(InstancePathElement {
                        parent_cell: cell_id,
                        instance_id: instance.id,
                        source_id: instance.source_id,
                        child_cell: instance.child_cell,
                        array_column: column,
                        array_row: row,
                        bbox,
                    });
                    let depth = current_depth + 1;
                    if !push_hierarchy_tree_row(
                        result,
                        max_rows,
                        HierarchyTreeRow {
                            depth,
                            cell: instance.child_cell,
                            parent_cell: Some(cell_id),
                            instance_id: Some(instance.id),
                            source_id: Some(instance.source_id),
                            name: instance.name.clone(),
                            cell_name: child.name().to_owned(),
                            bbox,
                            instance_path: child_path.clone(),
                            child_instance_count: child.instances.len(),
                            shape_count: child.shapes.len(),
                        },
                    ) {
                        return;
                    }
                    if path.contains(&instance.child_cell) {
                        continue;
                    }
                    path.push(instance.child_cell);
                    self.collect_hierarchy_tree_rows(
                        instance.child_cell,
                        depth,
                        max_depth,
                        child_to_root,
                        child_path,
                        path,
                        max_rows,
                        result,
                    );
                    path.pop();
                    if result.truncated {
                        return;
                    }
                }
            }
        }
    }

    fn collect_hierarchy_instances_unexpanded(
        &self,
        cell_id: CellId,
        viewport: Rect,
        depth_remaining: usize,
        current_depth: usize,
        min_depth: usize,
        cell_to_world: AffineTransform,
        result: &mut HierarchyInstanceQueryResult,
        path: &mut Vec<CellId>,
    ) {
        let Some(cell) = self.cell(cell_id) else {
            return;
        };
        result.total_instances += cell.instances.len();
        if depth_remaining == 0 {
            return;
        }
        path.push(cell_id);
        for instance in &cell.instances {
            result.candidates_checked += 1;
            let Some(child) = self.cell(instance.child_cell) else {
                continue;
            };
            if path.contains(&instance.child_cell) {
                continue;
            }
            let bbox = cell_to_world.transform_rect(instance.bbox);
            if !bbox.intersects(viewport) {
                continue;
            }
            let instance_depth = current_depth + 1;
            let columns = instance.array.columns.max(1);
            let rows = instance.array.rows.max(1);
            if instance_depth >= min_depth {
                result.instances.push(HierarchyInstanceRecord {
                    bbox,
                    array_bbox: bbox,
                    instance_id: instance.id,
                    source_id: instance.source_id,
                    cell: cell_id,
                    child_cell: instance.child_cell,
                    array_columns: columns,
                    array_rows: rows,
                    array_column: 0,
                    array_row: 0,
                });
            }
            if columns == 1 && rows == 1 {
                let child_bbox = child_bbox(child);
                let child_to_parent = AffineTransform::from_instance(instance, child_bbox, 0, 0);
                let child_to_world = cell_to_world.then(child_to_parent);
                self.collect_hierarchy_instances_unexpanded(
                    instance.child_cell,
                    viewport,
                    depth_remaining - 1,
                    instance_depth,
                    min_depth,
                    child_to_world,
                    result,
                    path,
                );
            }
        }
        path.pop();
    }

    fn collect_hierarchy_instances(
        &self,
        cell_id: CellId,
        viewport: Rect,
        depth_remaining: usize,
        current_depth: usize,
        min_depth: usize,
        include_compact_arrays: bool,
        cell_to_world: AffineTransform,
        result: &mut HierarchyInstanceQueryResult,
        path: &mut Vec<CellId>,
    ) {
        let Some(cell) = self.cell(cell_id) else {
            return;
        };
        result.total_instances += cell.instances.len();
        if depth_remaining == 0 {
            return;
        }
        path.push(cell_id);
        let query_viewport = cell_to_world
            .inverse()
            .map(|world_to_cell| world_to_cell.transform_rect(viewport))
            .unwrap_or(viewport);
        let hierarchy_index = cell.ensure_hierarchy_index();
        for candidate in hierarchy_index
            .instance_index
            .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
        {
            result.candidates_checked += 1;
            let Some(instance) = cell.instances.get(candidate.instance_index) else {
                continue;
            };
            let Some(child) = self.cell(instance.child_cell) else {
                continue;
            };
            if path.contains(&instance.child_cell) {
                continue;
            }
            let child_bbox = child_bbox(child);
            let child_to_parent = AffineTransform::from_instance(
                instance,
                child_bbox,
                candidate.column,
                candidate.row,
            );
            let child_to_world = cell_to_world.then(child_to_parent);
            let bbox = child_to_world.transform_rect(child_bbox);
            if !bbox.intersects(viewport) {
                continue;
            }
            let array_bbox = cell_to_world.transform_rect(instance.bbox);
            let instance_depth = current_depth + 1;
            if instance_depth >= min_depth {
                result.instances.push(HierarchyInstanceRecord {
                    bbox,
                    array_bbox,
                    instance_id: instance.id,
                    source_id: instance.source_id,
                    cell: cell_id,
                    child_cell: instance.child_cell,
                    array_columns: instance.array.columns.max(1),
                    array_rows: instance.array.rows.max(1),
                    array_column: candidate.column,
                    array_row: candidate.row,
                });
            }
            self.collect_hierarchy_instances(
                instance.child_cell,
                viewport,
                depth_remaining - 1,
                instance_depth,
                min_depth,
                include_compact_arrays,
                child_to_world,
                result,
                path,
            );
        }
        if include_compact_arrays {
            for entry in hierarchy_index
                .array_index
                .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
            {
                result.candidates_checked += 1;
                let Some(instance) = cell.instances.get(entry.instance_index) else {
                    continue;
                };
                let Some(child) = self.cell(instance.child_cell) else {
                    continue;
                };
                if path.contains(&instance.child_cell) {
                    continue;
                }
                let child_bbox = child_bbox(child);
                let columns = instance.array.columns.max(1);
                let rows = instance.array.rows.max(1);
                result.total_array_elements = result
                    .total_array_elements
                    .saturating_add(u64::from(columns) * u64::from(rows));
                let array_bbox = cell_to_world.transform_rect(instance.bbox);
                let (column_range, row_range) =
                    compact_array_candidate_ranges(instance, child_bbox, query_viewport);
                let instance_depth = current_depth + 1;
                for row in row_range {
                    for column in column_range.clone() {
                        result.compact_array_elements_checked =
                            result.compact_array_elements_checked.saturating_add(1);
                        let child_to_parent =
                            AffineTransform::from_instance(instance, child_bbox, column, row);
                        let child_to_world = cell_to_world.then(child_to_parent);
                        let bbox = child_to_world.transform_rect(child_bbox);
                        if !bbox.intersects(viewport) {
                            continue;
                        }
                        if instance_depth >= min_depth {
                            result.instances.push(HierarchyInstanceRecord {
                                bbox,
                                array_bbox,
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
                        self.collect_hierarchy_instances(
                            instance.child_cell,
                            viewport,
                            depth_remaining - 1,
                            instance_depth,
                            min_depth,
                            include_compact_arrays,
                            child_to_world,
                            result,
                            path,
                        );
                    }
                }
            }
        }
        path.pop();
    }

    fn collect_hierarchy_shapes(
        &self,
        cell_id: CellId,
        viewport: Rect,
        depth_remaining: usize,
        current_depth: usize,
        min_depth: usize,
        cell_to_world: AffineTransform,
        instance_id: u32,
        result: &mut HierarchyQueryResult,
        path: &mut Vec<CellId>,
    ) {
        let Some(cell) = self.cell(cell_id) else {
            return;
        };
        result.total_instances += cell.instances.len();
        path.push(cell_id);
        for shape in &cell.shapes {
            let bbox = cell_to_world.transform_rect(shape.bbox);
            if !bbox.intersects(viewport) {
                continue;
            }
            if current_depth < min_depth {
                continue;
            }
            result.shapes.push(HierarchyShapeRecord {
                bbox,
                layer_id: shape.layer_id,
                kind: shape.kind,
                source_id: shape.source_id,
                instance_id,
                cell: cell_id,
            });
        }
        if depth_remaining == 0 {
            path.pop();
            return;
        }
        let query_viewport = cell_to_world
            .inverse()
            .map(|world_to_cell| world_to_cell.transform_rect(viewport))
            .unwrap_or(viewport);
        let hierarchy_index = cell.ensure_hierarchy_index();
        for candidate in hierarchy_index
            .instance_index
            .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
        {
            result.instance_candidates_checked += 1;
            let Some(instance) = cell.instances.get(candidate.instance_index) else {
                continue;
            };
            let Some(child) = self.cell(instance.child_cell) else {
                continue;
            };
            if path.contains(&instance.child_cell) {
                continue;
            }
            let child_bbox = child_bbox(child);
            let child_to_parent = AffineTransform::from_instance(
                instance,
                child_bbox,
                candidate.column,
                candidate.row,
            );
            let child_to_world = cell_to_world.then(child_to_parent);
            if !child_to_world
                .transform_rect(child_bbox)
                .intersects(viewport)
            {
                continue;
            }
            self.collect_hierarchy_shapes(
                instance.child_cell,
                viewport,
                depth_remaining - 1,
                current_depth + 1,
                min_depth,
                child_to_world,
                instance.id,
                result,
                path,
            );
        }
        for entry in hierarchy_index
            .array_index
            .locate_in_envelope_intersecting(rect_to_aabb(query_viewport))
        {
            result.instance_candidates_checked += 1;
            let Some(instance) = cell.instances.get(entry.instance_index) else {
                continue;
            };
            let Some(child) = self.cell(instance.child_cell) else {
                continue;
            };
            if path.contains(&instance.child_cell) {
                continue;
            }
            let child_bbox = child_bbox(child);
            let (column_range, row_range) =
                compact_array_candidate_ranges(instance, child_bbox, query_viewport);
            for row in row_range {
                for column in column_range.clone() {
                    let child_to_parent =
                        AffineTransform::from_instance(instance, child_bbox, column, row);
                    let child_to_world = cell_to_world.then(child_to_parent);
                    if !child_to_world
                        .transform_rect(child_bbox)
                        .intersects(viewport)
                    {
                        continue;
                    }
                    self.collect_hierarchy_shapes(
                        instance.child_cell,
                        viewport,
                        depth_remaining - 1,
                        current_depth + 1,
                        min_depth,
                        child_to_world,
                        instance.id,
                        result,
                        path,
                    );
                }
            }
        }
        path.pop();
    }

    pub fn add_coverage(&mut self, coverage: CoverageRecord) {
        self.coverage.push(coverage);
    }

    pub fn coverage(&self) -> &[CoverageRecord] {
        &self.coverage
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AffineTransform {
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    tx: i32,
    ty: i32,
}

impl AffineTransform {
    fn identity() -> Self {
        Self {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            tx: 0,
            ty: 0,
        }
    }

    fn from_instance(instance: &CellInstance, child_bbox: Rect, column: u32, row: u32) -> Self {
        let mut transform = Self::from_orientation(
            instance.transform.orient,
            child_bbox,
            instance.transform.dx,
            instance.transform.dy,
        );
        transform.tx += column as i32 * instance.array.step_x;
        transform.ty += row as i32 * instance.array.step_y;
        transform
    }

    fn from_orientation(orientation: Orientation, child_bbox: Rect, dx: i32, dy: i32) -> Self {
        let width = child_bbox.width();
        let height = child_bbox.height();
        let x0 = child_bbox.x1;
        let y0 = child_bbox.y1;
        match orientation {
            Orientation::R90 => Self {
                a: 0,
                b: -1,
                c: 1,
                d: 0,
                tx: dx + height + y0,
                ty: dy - x0,
            },
            Orientation::R180 => Self {
                a: -1,
                b: 0,
                c: 0,
                d: -1,
                tx: dx + width + x0,
                ty: dy + height + y0,
            },
            Orientation::R270 => Self {
                a: 0,
                b: 1,
                c: -1,
                d: 0,
                tx: dx - y0,
                ty: dy + width + x0,
            },
            Orientation::MX => Self {
                a: 1,
                b: 0,
                c: 0,
                d: -1,
                tx: dx - x0,
                ty: dy + height + y0,
            },
            Orientation::MY => Self {
                a: -1,
                b: 0,
                c: 0,
                d: 1,
                tx: dx + width + x0,
                ty: dy - y0,
            },
            Orientation::MXR90 => Self {
                a: 0,
                b: 1,
                c: 1,
                d: 0,
                tx: dx - y0,
                ty: dy - x0,
            },
            Orientation::MYR90 => Self {
                a: 0,
                b: -1,
                c: -1,
                d: 0,
                tx: dx + height + y0,
                ty: dy + width + x0,
            },
            Orientation::R0 | Orientation::Unknown => Self {
                a: 1,
                b: 0,
                c: 0,
                d: 1,
                tx: dx - x0,
                ty: dy - y0,
            },
        }
    }

    fn then(self, next: Self) -> Self {
        Self {
            a: self.a * next.a + self.b * next.c,
            b: self.a * next.b + self.b * next.d,
            c: self.c * next.a + self.d * next.c,
            d: self.c * next.b + self.d * next.d,
            tx: self.a * next.tx + self.b * next.ty + self.tx,
            ty: self.c * next.tx + self.d * next.ty + self.ty,
        }
    }

    fn inverse(self) -> Option<Self> {
        let det = self.a * self.d - self.b * self.c;
        if det == 0 {
            return None;
        }
        Some(Self {
            a: self.d / det,
            b: -self.b / det,
            c: -self.c / det,
            d: self.a / det,
            tx: (self.b * self.ty - self.d * self.tx) / det,
            ty: (self.c * self.tx - self.a * self.ty) / det,
        })
    }

    fn transform_rect(self, rect: Rect) -> Rect {
        let corners = [
            self.transform_point(rect.x1, rect.y1),
            self.transform_point(rect.x1, rect.y2),
            self.transform_point(rect.x2, rect.y1),
            self.transform_point(rect.x2, rect.y2),
        ];
        let (mut x1, mut y1) = corners[0];
        let (mut x2, mut y2) = corners[0];
        for (x, y) in corners.into_iter().skip(1) {
            x1 = x1.min(x);
            y1 = y1.min(y);
            x2 = x2.max(x);
            y2 = y2.max(y);
        }
        Rect::new(x1, y1, x2, y2)
    }

    fn transform_point(self, x: i32, y: i32) -> (i32, i32) {
        (
            self.a * x + self.b * y + self.tx,
            self.c * x + self.d * y + self.ty,
        )
    }
}

fn child_bbox(cell: &Cell) -> Rect {
    cell.bbox()
}

fn hierarchy_layer_counts(hierarchy: &HierarchyDocument) -> BTreeMap<u16, usize> {
    let mut counts = BTreeMap::new();
    for cell in &hierarchy.cells {
        for summary in &cell.layer_summaries {
            if summary.layer_id == 0 {
                continue;
            }
            *counts.entry(summary.layer_id).or_default() += summary.shape_count as usize;
        }
    }
    counts
}

fn cell_view_cell_stack(cell_view: &CellViewState) -> Vec<CellId> {
    let mut cells = vec![cell_view.context_cell()];
    for element in cell_view.specific_path().elements() {
        if cells.last().copied() != Some(element.parent_cell)
            && !cells.contains(&element.parent_cell)
        {
            cells.push(element.parent_cell);
        }
        cells.push(element.child_cell);
    }
    cells
}

fn push_hierarchy_tree_row(
    result: &mut HierarchyTreeRows,
    max_rows: usize,
    row: HierarchyTreeRow,
) -> bool {
    if result.rows.len() >= max_rows {
        result.truncated = true;
        return false;
    }
    result.rows.push(row);
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DetailDestination {
    Top,
    Cell(CellId),
    FallbackTop,
}

fn detail_scope_destinations(
    db: &LayoutDb,
    document: DetailScopeDocument,
) -> HashMap<u32, DetailDestination> {
    document
        .records
        .into_iter()
        .map(|scope| {
            let destination = match scope.coordinates {
                DetailCoordinates::Top => DetailDestination::Top,
                DetailCoordinates::CellLocal => db
                    .package_cell_ids
                    .get(&scope.cell_id)
                    .copied()
                    .map(DetailDestination::Cell)
                    .unwrap_or(DetailDestination::FallbackTop),
            };
            (scope.source_id, destination)
        })
        .collect()
}

fn push_cell_view_instance_record(
    result: &mut CellViewInstanceQueryResult,
    parent_cell: CellId,
    instance: &CellInstance,
    bbox: Rect,
    array_bbox: Rect,
    array_column: u32,
    array_row: u32,
    depth: usize,
    instance_path: InstancePath,
) {
    result.instances.push(CellViewInstanceRecord {
        bbox,
        array_bbox,
        instance_id: instance.id,
        source_id: instance.source_id,
        cell: parent_cell,
        child_cell: instance.child_cell,
        array_columns: instance.array.columns.max(1),
        array_rows: instance.array.rows.max(1),
        array_column,
        array_row,
        depth,
        object_path: ObjectPath {
            instance_path: instance_path.clone(),
            target: ObjectPathTarget::Instance {
                parent_cell,
                instance_id: instance.id,
                source_id: instance.source_id,
                child_cell: instance.child_cell,
                array_column,
                array_row,
            },
        },
        instance_path,
    });
}

fn compact_array_candidate_ranges(
    instance: &CellInstance,
    child_bbox: Rect,
    query_viewport: Rect,
) -> (Range<u32>, Range<u32>) {
    let columns = instance.array.columns.max(1);
    let rows = instance.array.rows.max(1);

    let origin =
        AffineTransform::from_instance(instance, child_bbox, 0, 0).transform_rect(child_bbox);
    let column_range = stepped_axis_range(
        columns,
        instance.array.step_x,
        origin.x1,
        origin.x2,
        query_viewport.x1,
        query_viewport.x2,
    );
    let row_range = stepped_axis_range(
        rows,
        instance.array.step_y,
        origin.y1,
        origin.y2,
        query_viewport.y1,
        query_viewport.y2,
    );
    (column_range, row_range)
}

fn stepped_axis_range(
    count: u32,
    step: i32,
    element_min: i32,
    element_max: i32,
    query_min: i32,
    query_max: i32,
) -> Range<u32> {
    if count == 0 {
        return 0..0;
    }
    if step == 0 {
        return if element_min < query_max && element_max > query_min {
            0..count
        } else {
            0..0
        };
    }
    let count_i64 = i64::from(count);
    let step_i64 = i64::from(step);
    let min_delta = i64::from(query_min) - i64::from(element_max) + 1;
    let max_delta = i64::from(query_max) - i64::from(element_min) - 1;
    let (first, last) = if step_i64 > 0 {
        (
            div_ceil_i64(min_delta, step_i64),
            div_floor_i64(max_delta, step_i64),
        )
    } else {
        (
            div_ceil_i64(max_delta, step_i64),
            div_floor_i64(min_delta, step_i64),
        )
    };
    let start = first.clamp(0, count_i64);
    let end = (last + 1).clamp(0, count_i64);
    if start >= end {
        return 0..0;
    }
    start as u32..end as u32
}

fn div_floor_i64(numerator: i64, denominator: i64) -> i64 {
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;
    if remainder != 0 && ((remainder > 0) != (denominator > 0)) {
        quotient - 1
    } else {
        quotient
    }
}

fn div_ceil_i64(numerator: i64, denominator: i64) -> i64 {
    -div_floor_i64(-numerator, denominator)
}

#[cfg(test)]
mod transform_tests {
    use super::{AffineTransform, Rect};
    use layoutpkg_format::Orientation;

    #[test]
    fn r90_orientation_maps_child_coordinates_into_parent_space() {
        let transform = AffineTransform::from_orientation(
            Orientation::R90,
            Rect::new(0, 0, 100, 80),
            1000,
            2000,
        );

        assert_eq!(
            transform.transform_rect(Rect::new(10, 20, 30, 40)),
            Rect::new(1040, 2010, 1060, 2030)
        );
    }

    #[test]
    fn affine_composition_applies_child_transform_before_parent_transform() {
        let parent =
            AffineTransform::from_orientation(Orientation::R0, Rect::new(0, 0, 200, 200), 100, 200);
        let child =
            AffineTransform::from_orientation(Orientation::R0, Rect::new(0, 0, 100, 100), 10, 20);

        assert_eq!(
            parent.then(child).transform_rect(Rect::new(2, 3, 8, 9)),
            Rect::new(112, 223, 118, 229)
        );
    }
}

#[derive(Debug)]
pub struct PackageLayoutSource {
    root: PathBuf,
    package: layoutpkg_reader::LayoutPackage,
    cache_capacity: usize,
}

pub type ViewportLoadBatch = layoutpkg_reader::ViewportBatch;

impl PackageLayoutSource {
    pub fn open(root: impl AsRef<Path>, cache_capacity: usize) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        Ok(Self {
            package: layoutpkg_reader::LayoutPackage::open(&root)?,
            root,
            cache_capacity,
        })
    }

    pub fn package_root(&self) -> &Path {
        &self.root
    }

    pub fn load_viewport_batch(&mut self, viewport: Rect) -> Result<ViewportLoadBatch> {
        self.package
            .load_detail_viewport(viewport.into(), self.cache_capacity)
    }

    pub fn load_overview_bins_for_units_per_pixel(
        &mut self,
        units_per_pixel: f32,
    ) -> Result<(i32, Vec<OverviewDensityBin>)> {
        let level = self
            .package
            .load_overview_level_for_units_per_pixel(units_per_pixel)?;
        let units_per_bin = level.units_per_bin;
        let bins = level
            .bins
            .into_iter()
            .map(OverviewDensityBin::from)
            .collect();
        Ok((units_per_bin, bins))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ViewportLoadStats {
    pub tile_count: usize,
    pub loaded_shapes: usize,
    pub new_shapes: usize,
    pub cache_hits: usize,
    pub cache_misses: usize,
    pub disk_reads: usize,
    pub evictions: usize,
    pub large_object_disk_reads: usize,
    pub loaded_detail_tile_count: usize,
    pub scoped_shapes: usize,
    pub scope_fallback_shapes: usize,
}

#[derive(Debug)]
pub struct LayoutSession {
    source: PackageLayoutSource,
    db: LayoutDb,
    loaded_detail_tiles: HashSet<String>,
    large_objects_loaded: bool,
    detail_scopes: Option<HashMap<u32, DetailDestination>>,
    overview_loaded: bool,
    applied_overview_units_per_bin: Option<i32>,
    last_load_stats: ViewportLoadStats,
    revision: u64,
    hierarchy_revision: u64,
    overview_revision: u64,
    detail_revision: u64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct LayoutSessionLoadProfile {
    pub total: Duration,
    pub hierarchy_load: Duration,
    pub hierarchy_build: Duration,
    pub hierarchy_build_detail: HierarchyBuildProfile,
    pub layers_load: Duration,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct HierarchyBuildProfile {
    pub layer_count: Duration,
    pub cell_alloc: Duration,
    pub cell_map: Duration,
    pub shape_import: Duration,
    pub instance_import: Duration,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ViewportApplyProfile {
    pub total: Duration,
    pub scope_load: Duration,
}

impl LayoutSession {
    pub fn from_source(source: PackageLayoutSource) -> Result<Self> {
        Ok(Self::from_source_profiled(source)?.0)
    }

    pub fn from_source_profiled(
        mut source: PackageLayoutSource,
    ) -> Result<(Self, LayoutSessionLoadProfile)> {
        let total_started = std::time::Instant::now();
        let detail_layer_counts = source.package.detail_layer_counts();
        let hierarchy_load_started = std::time::Instant::now();
        let hierarchy = source.package.load_hierarchy()?;
        let hierarchy_load = hierarchy_load_started.elapsed();
        let hierarchy_build_started = std::time::Instant::now();
        let (mut db, hierarchy_build_detail) = if let Some(hierarchy) = hierarchy {
            LayoutDb::from_hierarchy_document_profiled(
                source.package.design_name(),
                Rect::from(source.package.world_bbox()),
                hierarchy,
            )
        } else {
            (
                LayoutDb::new(
                    source.package.design_name(),
                    Rect::from(source.package.world_bbox()),
                ),
                HierarchyBuildProfile::default(),
            )
        };
        let hierarchy_build = hierarchy_build_started.elapsed();
        if !detail_layer_counts.is_empty() {
            db.set_package_layer_counts(detail_layer_counts);
        }
        let layers_started = std::time::Instant::now();
        for layer in source.package.layers()? {
            db.add_layer(LayerInfo::from(layer));
        }
        let layers_load = layers_started.elapsed();
        Ok((
            Self {
                source,
                db,
                loaded_detail_tiles: HashSet::new(),
                large_objects_loaded: false,
                detail_scopes: None,
                overview_loaded: false,
                applied_overview_units_per_bin: None,
                last_load_stats: ViewportLoadStats::default(),
                revision: 0,
                hierarchy_revision: 0,
                overview_revision: 0,
                detail_revision: 0,
            },
            LayoutSessionLoadProfile {
                total: total_started.elapsed(),
                hierarchy_load,
                hierarchy_build,
                hierarchy_build_detail,
                layers_load,
            },
        ))
    }

    pub fn db(&self) -> &LayoutDb {
        &self.db
    }

    pub fn last_load_stats(&self) -> &ViewportLoadStats {
        &self.last_load_stats
    }

    pub fn loaded_detail_tile_count(&self) -> usize {
        self.loaded_detail_tiles.len()
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn hierarchy_revision(&self) -> u64 {
        self.hierarchy_revision
    }

    pub fn overview_revision(&self) -> u64 {
        self.overview_revision
    }

    pub fn detail_revision(&self) -> u64 {
        self.detail_revision
    }

    pub fn ensure_viewport_loaded(&mut self, viewport: Rect) -> Result<ViewportLoadStats> {
        let batch = self.source.load_viewport_batch(viewport)?;
        self.apply_viewport_batch(batch)
    }

    pub fn apply_viewport_batch(&mut self, batch: ViewportLoadBatch) -> Result<ViewportLoadStats> {
        Ok(self.apply_viewport_batch_profiled(batch)?.0)
    }

    pub fn apply_viewport_batch_profiled(
        &mut self,
        batch: ViewportLoadBatch,
    ) -> Result<(ViewportLoadStats, ViewportApplyProfile)> {
        let total_started = std::time::Instant::now();
        let scope_started = std::time::Instant::now();
        self.ensure_detail_scopes_loaded()?;
        let scope_load = scope_started.elapsed();
        let mut new_shapes = 0;
        let mut scoped_shapes = 0;
        let mut scope_fallback_shapes = 0;
        if !self.large_objects_loaded {
            for record in batch.large_objects.records.iter() {
                let destination = self.detail_destination_for_record(record);
                match destination {
                    DetailDestination::Cell(cell) => {
                        self.db.add_shape(cell, ShapeRecord::from(record));
                        scoped_shapes += 1;
                    }
                    DetailDestination::Top => {
                        self.db
                            .add_shape(self.db.top_cell(), ShapeRecord::from(record));
                    }
                    DetailDestination::FallbackTop => {
                        self.db
                            .add_shape(self.db.top_cell(), ShapeRecord::from(record));
                        scope_fallback_shapes += 1;
                    }
                }
                new_shapes += 1;
            }
            self.large_objects_loaded = true;
        }
        for tile in &batch.tiles {
            if !self.loaded_detail_tiles.insert(tile.id.clone()) {
                continue;
            }
            for record in tile.records.iter() {
                let destination = self.detail_destination_for_record(record);
                match destination {
                    DetailDestination::Cell(cell) => {
                        self.db.add_shape(cell, ShapeRecord::from(record));
                        scoped_shapes += 1;
                    }
                    DetailDestination::Top => {
                        self.db
                            .add_shape(self.db.top_cell(), ShapeRecord::from(record));
                    }
                    DetailDestination::FallbackTop => {
                        self.db
                            .add_shape(self.db.top_cell(), ShapeRecord::from(record));
                        scope_fallback_shapes += 1;
                    }
                }
                new_shapes += 1;
            }
        }
        if new_shapes > 0 {
            self.revision = self.revision.saturating_add(1);
            self.detail_revision = self.detail_revision.saturating_add(1);
        }
        let stats = ViewportLoadStats {
            tile_count: batch.tiles.len(),
            loaded_shapes: new_shapes,
            new_shapes,
            cache_hits: batch.stats.cache_hits,
            cache_misses: batch.stats.cache_misses,
            disk_reads: batch.stats.disk_reads,
            evictions: batch.stats.evictions,
            large_object_disk_reads: batch.stats.large_object_disk_reads,
            loaded_detail_tile_count: self.loaded_detail_tiles.len(),
            scoped_shapes,
            scope_fallback_shapes,
        };
        self.last_load_stats = stats.clone();
        Ok((
            stats,
            ViewportApplyProfile {
                total: total_started.elapsed(),
                scope_load,
            },
        ))
    }

    fn ensure_detail_scopes_loaded(&mut self) -> Result<()> {
        if self.detail_scopes.is_some() {
            return Ok(());
        }
        let detail_scopes = self
            .source
            .package
            .load_detail_scope()?
            .map(|scope| detail_scope_destinations(&self.db, scope))
            .unwrap_or_default();
        self.detail_scopes = Some(detail_scopes);
        Ok(())
    }

    fn detail_destination_for_record(&self, record: &LayoutRectRecord) -> DetailDestination {
        self.detail_scopes
            .as_ref()
            .and_then(|scopes| scopes.get(&record.source_id).copied())
            .unwrap_or(DetailDestination::Top)
    }

    pub fn ensure_overview_for_units_per_pixel(&mut self, units_per_pixel: f32) -> Result<bool> {
        let (units_per_bin, bins) = self
            .source
            .load_overview_bins_for_units_per_pixel(units_per_pixel)?;
        if self.applied_overview_units_per_bin == Some(units_per_bin) {
            return Ok(false);
        }
        let current_bins = self
            .db
            .overview_bins(self.db.world_bbox())
            .cloned()
            .collect::<Vec<_>>();
        if current_bins == bins {
            self.applied_overview_units_per_bin = Some(units_per_bin);
            return Ok(false);
        }

        self.db.set_overview_bins(bins);
        self.applied_overview_units_per_bin = Some(units_per_bin);
        self.revision = self.revision.saturating_add(1);
        self.overview_revision = self.overview_revision.saturating_add(1);
        Ok(true)
    }

    pub fn load_overview_coverage(&mut self) -> Result<Vec<CoverageRecord>> {
        if !self.overview_loaded {
            for tile in self.source.package.load_overview()? {
                for record in tile.records.iter() {
                    self.db.add_coverage(CoverageRecord::from(record));
                }
            }
            self.overview_loaded = true;
        }
        Ok(self.db.coverage().to_vec())
    }
}

impl From<Rect> for layoutpkg_reader::Rect {
    fn from(rect: Rect) -> Self {
        Self::new(rect.x1, rect.y1, rect.x2, rect.y2)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use layoutpkg_format::{CellArray, Orientation, Transform};
    use layoutpkg_packer::{pack_viewjson_to_layoutpkg, PackLayoutPackageOptions};
    use serde_json::json;
    use tempfile::TempDir;

    use crate::{
        CellId, CellInstance, CellViewInstanceQuery, CellViewShapeQuery, CellViewState,
        HierarchyPolicy, InstancePath, InstancePathElement, LayerInfo, LayoutDb, LayoutSession,
        ObjectPathTarget, OverviewDensityBin, PackageLayoutSource, Rect, RecursiveInstanceQuery,
        RecursiveShapeQuery, ShapeKind, ShapeQuery, ShapeRecord,
    };

    fn write_json(path: &std::path::Path, value: serde_json::Value) {
        fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    }

    fn create_layoutpkg_fixture() -> (TempDir, std::path::PathBuf) {
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
        write_json(
            &root.join("design/regular_wires.json"),
            json!({
                "schema": "ieda.view.v1",
                "kind": "regular_wires",
                "data": [
                    { "id": 1, "kind": "patch", "layer_id": 1, "rect": [100, 100, 150, 150] },
                    { "id": 2, "kind": "patch", "layer_id": 1, "rect": [700, 700, 750, 750] }
                ]
            }),
        );
        for file in [
            "special_wires",
            "io_pins",
            "blockages",
            "fills",
            "regions",
            "rows",
            "tracks",
            "gcell_grids",
        ] {
            write_json(
                &root.join(format!("design/{file}.json")),
                json!({ "schema": "ieda.view.v1", "kind": file, "data": [] }),
            );
        }

        let output = root.join(".layoutpkg");
        pack_viewjson_to_layoutpkg(PackLayoutPackageOptions {
            input_root: root.to_path_buf(),
            output_root: output.clone(),
            detail_grid_columns: 2,
            detail_grid_rows: 2,
            max_tiles_per_object: 16,
            target_primitives_per_tile: 6000,
            max_subdivision_depth: 4,
        })
        .unwrap();

        (tmp, output)
    }

    fn write_identical_two_level_overview_pyramid(package_root: &std::path::Path) {
        let bin = layoutpkg_format::OverviewBinRecord {
            bbox: [0, 0, 1000, 1000],
            layer_id: 1,
            kind: layoutpkg_format::LayoutObjectKind::RegularWire,
            count: 2,
            coverage_area: 5000,
        };
        let pyramid = layoutpkg_format::OverviewPyramidDocument {
            schema: layoutpkg_format::OVERVIEW_PYRAMID_SCHEMA.to_string(),
            version: 1,
            world_bbox: [0, 0, 1000, 1000],
            levels: vec![
                layoutpkg_format::OverviewLevel {
                    level: 0,
                    units_per_bin: 10,
                    grid: [1, 1],
                    bins: vec![bin.clone()],
                },
                layoutpkg_format::OverviewLevel {
                    level: 1,
                    units_per_bin: 100,
                    grid: [1, 1],
                    bins: vec![bin],
                },
            ],
        };
        let mut bytes = Vec::new();
        layoutpkg_format::write_overview_pyramid(&mut bytes, &pyramid).unwrap();
        fs::write(package_root.join("overview/pyramid.bin"), bytes).unwrap();
        let manifest_path = package_root.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        manifest["tilesets"]["overview_pyramid"] = json!("overview/pyramid.bin");
        write_json(&manifest_path, manifest);
    }

    fn advertise_detail_scope(package_root: &std::path::Path) {
        let manifest_path = package_root.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        manifest["capabilities"]["detail_scope"] = json!(true);
        manifest["tilesets"]["detail_scope"] = json!("detail/scope.json");
        write_json(&manifest_path, manifest);
    }

    fn nested_test_db() -> LayoutDb {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
        db.add_layer(LayerInfo::new(1, "M1"));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200, 200));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(1, 2, 5, 6), 1, ShapeKind::IoPin, 99),
        );
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "leaf0".to_owned(),
                child_cell: leaf,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10, 20, 30, 40),
                source_id: 230,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_owned(),
                child_cell: mid,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 200, 300, 400),
                source_id: 170,
            },
        );
        db
    }

    fn hierarchy_test_db_and_leaf_view() -> (LayoutDb, CellViewState) {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1_000, 1_000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200, 200));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(2, 2, 8, 8), 1, ShapeKind::RegularWire, 9),
        );
        db.add_instance(
            mid,
            CellInstance {
                id: 20,
                name: "leaf0".to_owned(),
                child_cell: leaf,
                transform: Transform {
                    dx: 5,
                    dy: 7,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(5, 7, 25, 27),
                source_id: 20,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 10,
                name: "mid0".to_owned(),
                child_cell: mid,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 200, 300, 400),
                source_id: 10,
            },
        );
        let view = CellViewState::from_path(
            db.top_cell(),
            InstancePath::from_elements(vec![
                InstancePathElement {
                    parent_cell: db.top_cell(),
                    instance_id: 10,
                    source_id: 10,
                    child_cell: mid,
                    array_column: 0,
                    array_row: 0,
                    bbox: Rect::new(100, 200, 300, 400),
                },
                InstancePathElement {
                    parent_cell: mid,
                    instance_id: 20,
                    source_id: 20,
                    child_cell: leaf,
                    array_column: 0,
                    array_row: 0,
                    bbox: Rect::new(5, 7, 25, 27),
                },
            ]),
        );
        (db, view)
    }

    #[test]
    fn cell_bbox_accessor_returns_hierarchy_bbox() {
        let (db, _leaf_view) = hierarchy_test_db_and_leaf_view();
        let top = db.cell(db.top_cell()).unwrap();

        assert_eq!(top.bbox(), Rect::new(0, 0, 1_000, 1_000));
    }

    #[test]
    fn hierarchy_tree_rows_start_at_focused_cell_view() {
        let (db, leaf_view) = hierarchy_test_db_and_leaf_view();

        let rows = db.hierarchy_tree_rows(leaf_view.clone(), 8, 16);

        assert_eq!(rows.rows.len(), 1);
        assert!(!rows.truncated);
        assert_eq!(rows.rows[0].depth, 0);
        assert_eq!(rows.rows[0].cell, leaf_view.target_cell());
        assert_eq!(rows.rows[0].name, "leaf");
        assert_eq!(rows.rows[0].cell_name, "leaf");
        assert_eq!(rows.rows[0].bbox, Rect::new(0, 0, 20, 20));
        assert_eq!(
            rows.rows[0].instance_path,
            leaf_view.specific_path().clone()
        );
        assert_eq!(rows.rows[0].child_instance_count, 0);
        assert_eq!(rows.rows[0].shape_count, 1);
    }

    #[test]
    fn hierarchy_tree_rows_are_instance_path_based_and_capped() {
        let (db, _leaf_view) = hierarchy_test_db_and_leaf_view();

        let rows = db.hierarchy_tree_rows(CellViewState::top(&db), 8, 2);

        assert_eq!(rows.rows.len(), 2);
        assert!(rows.rows[0].instance_path.is_empty());
        assert_eq!(rows.rows[1].depth, 1);
        assert_eq!(rows.rows[1].cell_name, "mid");
        assert_eq!(rows.rows[1].name, "mid0");
        assert_eq!(rows.rows[1].instance_id, Some(10));
        assert_eq!(rows.rows[1].source_id, Some(10));
        assert_eq!(rows.rows[1].parent_cell, Some(db.top_cell()));
        assert_eq!(rows.rows[1].bbox, Rect::new(100, 200, 300, 400));
        assert_eq!(rows.rows[1].instance_path.depth(), 1);
        assert_eq!(rows.rows[1].instance_path.elements()[0].instance_id, 10);
        assert!(rows.truncated);
    }

    #[test]
    fn hierarchy_tree_rows_preserve_array_member_coordinates() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 10, 10));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 7,
                name: "leaf_array".to_owned(),
                child_cell: leaf,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 2,
                    rows: 2,
                    step_x: 20,
                    step_y: 30,
                },
                bbox: Rect::new(100, 200, 130, 240),
                source_id: 77,
            },
        );

        let rows = db.hierarchy_tree_rows(CellViewState::top(&db), 1, 8);
        let mut members = rows.rows[1..]
            .iter()
            .map(|row| {
                let element = &row.instance_path.elements()[0];
                (element.array_column, element.array_row, row.bbox)
            })
            .collect::<Vec<_>>();
        members.sort_by_key(|(column, row, _bbox)| (*row, *column));

        assert_eq!(
            members,
            vec![
                (0, 0, Rect::new(100, 200, 110, 210)),
                (1, 0, Rect::new(120, 200, 130, 210)),
                (0, 1, Rect::new(100, 230, 110, 240)),
                (1, 1, Rect::new(120, 230, 130, 240)),
            ]
        );
    }

    #[test]
    fn default_cell_view_state_points_at_top_cell() {
        let db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));

        let view = CellViewState::top(&db);

        assert_eq!(view.context_cell(), db.top_cell());
        assert_eq!(view.target_cell(), db.top_cell());
        assert!(view.specific_path().is_empty());
    }

    #[test]
    fn instance_path_tracks_target_cell_and_depth() {
        let parent = CellId::from_raw(0);
        let child = CellId::from_raw(1);
        let path = InstancePath::from_elements(vec![InstancePathElement {
            parent_cell: parent,
            instance_id: 7,
            source_id: 77,
            child_cell: child,
            array_column: 3,
            array_row: 4,
            bbox: Rect::new(10, 20, 30, 40),
        }]);

        assert_eq!(path.depth(), 1);
        assert_eq!(path.target_cell(), Some(child));
        assert_eq!(path.elements()[0].array_column, 3);
    }

    #[test]
    fn cell_view_shape_query_returns_instance_and_object_paths() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(1, 2, 5, 6), 1, ShapeKind::IoPin, 99),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 7,
                name: "u0".to_owned(),
                child_cell: child,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 200, 120, 220),
                source_id: 77,
            },
        );

        let result = db.query_cell_view_shapes(CellViewShapeQuery {
            cell_view: CellViewState::top(&db),
            viewport: Rect::new(90, 190, 130, 230),
            min_depth: 1,
            max_depth: 1,
            layer_ids: Vec::new(),
            include_kinds: Vec::new(),
            policy: HierarchyPolicy::default(),
        });

        assert_eq!(result.shapes.len(), 1);
        let shape = &result.shapes[0];
        assert_eq!(shape.bbox, Rect::new(101, 202, 105, 206));
        assert_eq!(shape.instance_path.depth(), 1);
        assert_eq!(shape.instance_path.elements()[0].instance_id, 7);
        assert!(matches!(
            shape.object_path.target,
            ObjectPathTarget::Shape(_)
        ));
    }

    #[test]
    fn cell_view_focused_on_child_queries_child_local_shapes() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(1, 2, 5, 6), 1, ShapeKind::IoPin, 99),
        );

        let view = CellViewState::from_path(
            db.top_cell(),
            InstancePath::from_elements(vec![InstancePathElement {
                parent_cell: db.top_cell(),
                instance_id: 7,
                source_id: 77,
                child_cell: child,
                array_column: 0,
                array_row: 0,
                bbox: Rect::new(100, 200, 120, 220),
            }]),
        );

        let result = db.query_cell_view_shapes(CellViewShapeQuery {
            cell_view: view,
            viewport: Rect::new(0, 0, 20, 20),
            min_depth: 0,
            max_depth: 0,
            layer_ids: Vec::new(),
            include_kinds: Vec::new(),
            policy: HierarchyPolicy::default(),
        });

        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.shapes[0].bbox, Rect::new(1, 2, 5, 6));
        assert_eq!(result.shapes[0].cell, child);
    }

    #[test]
    fn cell_view_instance_query_returns_object_paths() {
        let db = nested_test_db();
        let result = db.query_cell_view_instances(CellViewInstanceQuery {
            cell_view: CellViewState::top(&db),
            viewport: Rect::new(0, 0, 500, 500),
            min_depth: 1,
            max_depth: 2,
            expand_arrays: true,
            policy: HierarchyPolicy::default(),
        });

        assert!(!result.instances.is_empty());
        assert!(result
            .instances
            .iter()
            .all(|instance| instance.instance_path.depth() >= 1));
        assert!(result.instances.iter().all(|instance| {
            matches!(
                instance.object_path.target,
                ObjectPathTarget::Instance { .. }
            )
        }));
    }

    #[test]
    fn hidden_cells_prune_cell_view_shape_traversal() {
        let db = nested_test_db();
        let hidden_child = db.cell_by_name("leaf").unwrap();
        let mut policy = HierarchyPolicy::default();
        policy.hidden_cells.insert(hidden_child);

        let result = db.query_cell_view_shapes(CellViewShapeQuery {
            cell_view: CellViewState::top(&db),
            viewport: Rect::new(0, 0, 500, 500),
            min_depth: 0,
            max_depth: 8,
            layer_ids: Vec::new(),
            include_kinds: Vec::new(),
            policy,
        });

        assert!(result.shapes.iter().all(|shape| shape.cell != hidden_child));
    }

    #[test]
    fn cell_view_shape_query_does_not_expand_small_arrays_when_policy_disables_arrays() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 10, 10));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(1, 1, 4, 4), 1, ShapeKind::IoPin, 99),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 7,
                name: "array0".to_owned(),
                child_cell: child,
                transform: Transform {
                    dx: 100,
                    dy: 100,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 2,
                    rows: 2,
                    step_x: 20,
                    step_y: 20,
                },
                bbox: Rect::new(100, 100, 130, 130),
                source_id: 77,
            },
        );
        let mut policy = HierarchyPolicy::default();
        policy.expand_arrays = false;

        let result = db.query_cell_view_shapes(CellViewShapeQuery {
            cell_view: CellViewState::top(&db),
            viewport: Rect::new(0, 0, 500, 500),
            min_depth: 0,
            max_depth: 1,
            layer_ids: Vec::new(),
            include_kinds: Vec::new(),
            policy,
        });

        assert!(result.shapes.is_empty());
    }

    #[test]
    fn repeated_sibling_instances_of_same_cell_keep_distinct_paths() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 500, 500));
        db.add_layer(LayerInfo::new(1, "M1"));
        let child = db.add_cell("leaf", Rect::new(0, 0, 10, 10));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(1, 1, 4, 4), 1, ShapeKind::IoPin, 99),
        );
        for (index, dx) in [100, 200].into_iter().enumerate() {
            db.add_instance(
                db.top_cell(),
                CellInstance {
                    id: 7 + index as u32,
                    name: format!("u{index}"),
                    child_cell: child,
                    transform: Transform {
                        dx,
                        dy: 100,
                        orient: Orientation::R0,
                    },
                    array: CellArray::default(),
                    bbox: Rect::new(dx, 100, dx + 10, 110),
                    source_id: 77 + index as u32,
                },
            );
        }

        let result = db.query_cell_view_shapes(CellViewShapeQuery {
            cell_view: CellViewState::top(&db),
            viewport: Rect::new(0, 0, 500, 500),
            min_depth: 1,
            max_depth: 1,
            layer_ids: Vec::new(),
            include_kinds: Vec::new(),
            policy: HierarchyPolicy::default(),
        });
        let mut instance_ids = result
            .shapes
            .iter()
            .map(|shape| shape.instance_path.elements()[0].instance_id)
            .collect::<Vec<_>>();
        instance_ids.sort_unstable();

        assert_eq!(result.shapes.len(), 2);
        assert_eq!(instance_ids, vec![7, 8]);
    }

    #[test]
    fn viewport_query_returns_only_intersecting_shapes() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 30, 30), 1, ShapeKind::RegularWire, 7),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(800, 800, 900, 900), 1, ShapeKind::RegularWire, 8),
        );

        let visible = db.query_shapes(top, Rect::new(0, 0, 100, 100));

        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].source_id, 7);
    }

    #[test]
    fn indexed_query_checks_only_candidate_bins() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        db.add_layer(LayerInfo::new(1, "M1"));
        let top = db.top_cell();
        for i in 0..100 {
            let x = i * 10;
            db.add_shape(
                top,
                ShapeRecord::new(
                    Rect::new(x, x, x + 4, x + 4),
                    1,
                    ShapeKind::RegularWire,
                    i as u32,
                ),
            );
        }

        let result = db.query_shapes_indexed(top, Some(1), Rect::new(0, 0, 20, 20));

        assert_eq!(result.shapes.len(), 2);
        assert!(result.candidates_checked < 20);
        assert!(result.total_shapes_in_cell >= 100);
    }

    #[test]
    fn shape_spatial_index_is_built_lazily_on_first_indexed_query() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::RegularWire, 7),
        );

        assert!(!db.cell(top).unwrap().shape_index_is_built());

        let result = db.query_shapes_indexed(top, Some(1), Rect::new(0, 0, 30, 30));

        assert!(db.cell(top).unwrap().shape_index_is_built());
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.shapes[0].source_id, 7);
    }

    #[test]
    fn indexed_query_can_filter_by_shape_kind() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::RegularWire, 1),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(12, 12, 18, 18), 1, ShapeKind::Via, 2),
        );

        let result = db.query_shapes_indexed_with_filter(
            top,
            ShapeQuery::new(Rect::new(0, 0, 30, 30)).with_kind(ShapeKind::Via),
        );

        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.shapes[0].source_id, 2);
    }

    #[test]
    fn overview_density_bins_can_be_stored_replaced_and_queried_by_viewport() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000)).with_overview_bins(vec![
            OverviewDensityBin {
                bbox: Rect::new(0, 0, 100, 100),
                layer_id: 1,
                kind: ShapeKind::RegularWire,
                count: 10,
                coverage_area: 400,
            },
            OverviewDensityBin {
                bbox: Rect::new(800, 800, 900, 900),
                layer_id: 2,
                kind: ShapeKind::Via,
                count: 4,
                coverage_area: 80,
            },
        ]);

        let first = db
            .overview_bins(Rect::new(50, 50, 120, 120))
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].layer_id, 1);
        assert_eq!(first[0].count, 10);

        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(400, 400, 500, 500),
            layer_id: 3,
            kind: ShapeKind::Fill,
            count: 7,
            coverage_area: 250,
        }]);

        assert!(db
            .overview_bins(Rect::new(50, 50, 120, 120))
            .next()
            .is_none());
        let replacement = db
            .overview_bins(Rect::new(450, 450, 470, 470))
            .collect::<Vec<_>>();
        assert_eq!(replacement.len(), 1);
        assert_eq!(replacement[0].kind, ShapeKind::Fill);
        assert_eq!(replacement[0].coverage_area, 250);
    }

    #[test]
    fn cell_keeps_per_layer_shape_counts_and_bboxes() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 20, 30, 40), 2, ShapeKind::RegularWire, 1),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(5, 25, 35, 50), 2, ShapeKind::Via, 2),
        );

        let stats = db.cell(top).unwrap().layer_stats(2).unwrap();

        assert_eq!(stats.layer_id, 2);
        assert_eq!(stats.shape_count, 2);
        assert_eq!(stats.bbox, Rect::new(5, 20, 35, 50));
        assert!(db.cell(top).unwrap().layer_stats(3).is_none());
    }

    #[test]
    fn recursive_shape_query_filters_layer_before_returning_shapes() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 40, 40), 1, ShapeKind::RegularWire, 1),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(20, 20, 50, 50), 2, ShapeKind::Via, 2),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(30, 30, 60, 60), 2, ShapeKind::RegularWire, 3),
        );

        let result = db.query_recursive_shapes(RecursiveShapeQuery {
            viewport: Rect::new(0, 0, 100, 100),
            layer_ids: vec![2],
            max_depth: 0,
            min_depth: 0,
            include_kinds: vec![ShapeKind::RegularWire],
        });

        assert_eq!(result.shapes.len(), 1);
        assert!(result
            .shapes
            .iter()
            .all(|shape| shape.layer_id == 2 && shape.kind == ShapeKind::RegularWire));
        assert_eq!(result.shapes[0].source_id, 3);
    }

    #[test]
    fn hierarchy_query_expands_child_shapes_through_instance_transform() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(2, 3, 8, 9), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u0".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10, 20, 110, 120),
                source_id: 17,
            },
        );

        let shapes = db.query_hierarchy_shapes(Rect::new(0, 0, 40, 50), 1);

        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].bbox, Rect::new(12, 23, 18, 29));
        assert_eq!(shapes[0].instance_id, 17);
        assert_eq!(shapes[0].source_id, 11);
    }

    #[test]
    fn hierarchy_query_respects_depth_zero() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(2, 3, 8, 9), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u0".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10, 20, 110, 120),
                source_id: 17,
            },
        );

        let shapes = db.query_hierarchy_shapes(Rect::new(0, 0, 40, 50), 0);

        assert!(shapes.is_empty());
    }

    #[test]
    fn hierarchy_query_recurses_through_nested_instances() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200, 200));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(2, 3, 8, 9), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "leaf0".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10, 20, 110, 120),
                source_id: 23,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_string(),
                child_cell: mid,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 200, 300, 400),
                source_id: 17,
            },
        );

        let shallow = db.query_hierarchy_shapes(Rect::new(0, 0, 200, 300), 1);
        let deep = db.query_hierarchy_shapes(Rect::new(0, 0, 200, 300), 2);

        assert!(shallow.is_empty());
        assert_eq!(deep.len(), 1);
        assert_eq!(deep[0].bbox, Rect::new(112, 223, 118, 229));
        assert_eq!(deep[0].instance_id, 23);
    }

    #[test]
    fn hierarchy_query_expands_array_instances() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 2,
                    rows: 2,
                    step_x: 100,
                    step_y: 50,
                },
                bbox: Rect::new(10, 20, 130, 90),
                source_id: 17,
            },
        );

        let mut bboxes = db
            .query_hierarchy_shapes(Rect::new(0, 0, 200, 120), 1)
            .into_iter()
            .map(|shape| shape.bbox)
            .collect::<Vec<_>>();
        bboxes.sort_by_key(|rect| (rect.y1, rect.x1));

        assert_eq!(
            bboxes,
            vec![
                Rect::new(10, 20, 20, 30),
                Rect::new(110, 20, 120, 30),
                Rect::new(10, 70, 20, 80),
                Rect::new(110, 70, 120, 80),
            ]
        );
    }

    #[test]
    fn hierarchy_query_applies_rotated_instance_orientation() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 2000, 3000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 80));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(10, 20, 30, 40), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_r90".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1000,
                    dy: 2000,
                    orient: Orientation::R90,
                },
                array: CellArray::default(),
                bbox: Rect::new(1000, 2000, 1080, 2100),
                source_id: 17,
            },
        );

        let shapes = db.query_hierarchy_shapes(Rect::new(1000, 2000, 1100, 2100), 1);

        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].bbox, Rect::new(1040, 2010, 1060, 2030));
    }

    #[test]
    fn hierarchy_query_uses_instance_spatial_index_for_viewport_candidates() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::IoPin, 11),
        );
        for i in 0..10_000 {
            let x = (i % 100) * 1_000;
            let y = (i / 100) * 1_000;
            db.add_instance(
                db.top_cell(),
                CellInstance {
                    id: i as u32,
                    name: format!("u{i}"),
                    child_cell: child,
                    transform: Transform {
                        dx: x,
                        dy: y,
                        orient: Orientation::R0,
                    },
                    array: CellArray::default(),
                    bbox: Rect::new(x, y, x + 100, y + 100),
                    source_id: i as u32,
                },
            );
        }

        let result =
            db.query_hierarchy_shapes_indexed(Rect::new(50_000, 50_000, 51_000, 51_000), 1);

        assert_eq!(result.total_instances, 10_000);
        assert!(result.instance_candidates_checked < 20);
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(
            result.shapes[0].bbox,
            Rect::new(50_010, 50_010, 50_020, 50_020)
        );
    }

    #[test]
    fn hierarchy_instance_index_is_built_lazily_on_first_indexed_query() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 20_000, 20_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u0".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1_000,
                    dy: 1_000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(1_000, 1_000, 1_100, 1_100),
                source_id: 17,
            },
        );

        assert!(!db.cell(db.top_cell()).unwrap().hierarchy_index_is_built());

        let result = db.query_hierarchy_shapes_indexed(Rect::new(1_000, 1_000, 1_100, 1_100), 1);

        assert!(db.cell(db.top_cell()).unwrap().hierarchy_index_is_built());
        assert_eq!(result.shapes.len(), 1);
    }

    #[test]
    fn small_arrays_use_compact_array_index_instead_of_per_element_instance_index() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1_000, 1_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 2,
                    rows: 2,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 120, 120),
                source_id: 17,
            },
        );

        let result = db.query_hierarchy_shapes_indexed(Rect::new(100, 100, 120, 120), 1);
        let top = db.cell(db.top_cell()).unwrap();

        assert_eq!(top.array_index_len(), 1);
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.shapes[0].bbox, Rect::new(100, 100, 110, 110));
    }

    #[test]
    fn hierarchy_query_indexes_each_array_element_as_a_candidate() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 1_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            child,
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::IoPin, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 128,
                    rows: 1,
                    step_x: 100,
                    step_y: 0,
                },
                bbox: Rect::new(0, 0, 12_800, 20),
                source_id: 17,
            },
        );

        let result = db.query_hierarchy_shapes_indexed(Rect::new(5_000, 0, 5_020, 20), 1);

        assert_eq!(result.total_instances, 1);
        assert!(result.instance_candidates_checked <= 2);
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(result.shapes[0].bbox, Rect::new(5_000, 0, 5_010, 10));
    }

    #[test]
    fn large_array_index_keeps_one_array_entry_and_expands_visible_elements_only() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_big_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );

        assert_eq!(db.cell(db.top_cell()).unwrap().array_index_len(), 1);

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(50_000, 50_000, 50_250, 50_250),
            max_depth: 1,
            min_depth: 0,
            expand_arrays: true,
        });

        assert!(result.instances.len() < 20);
        assert!(!result.instances.is_empty());
        assert!(result.instances.iter().all(|instance| instance
            .bbox
            .intersects(Rect::new(50_000, 50_000, 50_250, 50_250))));
        assert!(result.total_array_elements >= 1_000_000);
    }

    #[test]
    fn recursive_instance_query_respects_expand_arrays_false() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_big_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(50_000, 50_000, 50_250, 50_250),
            max_depth: 1,
            min_depth: 0,
            expand_arrays: false,
        });

        assert_eq!(result.instances.len(), 1);
        assert_eq!(result.instances[0].bbox, Rect::new(0, 0, 100_000, 100_000));
        assert_eq!(
            result.instances[0].array_bbox,
            Rect::new(0, 0, 100_000, 100_000)
        );
        assert_eq!(result.instances[0].array_columns, 1_000);
        assert_eq!(result.instances[0].array_rows, 1_000);
        assert_eq!(result.instances[0].array_column, 0);
        assert_eq!(result.instances[0].array_row, 0);
        assert_eq!(result.total_array_elements, 0);
        assert_eq!(result.compact_array_elements_checked, 0);
    }

    #[test]
    fn recursive_instance_query_returns_unexpanded_small_array_when_expand_arrays_false() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 20_000, 20_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_small_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1_000,
                    dy: 2_000,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 4,
                    rows: 3,
                    step_x: 100,
                    step_y: 50,
                },
                bbox: Rect::new(1_000, 2_000, 1_320, 2_120),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(900, 1_900, 1_400, 2_200),
            max_depth: 1,
            min_depth: 0,
            expand_arrays: false,
        });

        assert_eq!(result.instances.len(), 1);
        assert_eq!(
            result.instances[0].bbox,
            Rect::new(1_000, 2_000, 1_320, 2_120)
        );
        assert_eq!(
            result.instances[0].array_bbox,
            Rect::new(1_000, 2_000, 1_320, 2_120)
        );
        assert_eq!(result.instances[0].array_columns, 4);
        assert_eq!(result.instances[0].array_rows, 3);
        assert_eq!(result.instances[0].array_column, 0);
        assert_eq!(result.instances[0].array_row, 0);
    }

    #[test]
    fn recursive_instance_query_returns_unexpanded_compact_array_when_expand_arrays_false() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 300_000, 300_000));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "u_big_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 1_000,
                    dy: 2_000,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(1_000, 2_000, 101_000, 102_000),
                source_id: 23,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_string(),
                child_cell: mid,
                transform: Transform {
                    dx: 10_000,
                    dy: 20_000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10_000, 20_000, 210_000, 220_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(11_000, 22_000, 111_000, 122_000),
            max_depth: 2,
            min_depth: 2,
            expand_arrays: false,
        });

        assert_eq!(result.instances.len(), 1);
        assert_eq!(result.instances[0].instance_id, 23);
        assert_eq!(
            result.instances[0].bbox,
            Rect::new(11_000, 22_000, 111_000, 122_000)
        );
        assert_eq!(
            result.instances[0].array_bbox,
            Rect::new(11_000, 22_000, 111_000, 122_000)
        );
        assert_eq!(result.instances[0].array_columns, 1_000);
        assert_eq!(result.instances[0].array_rows, 1_000);
        assert_eq!(result.instances[0].array_column, 0);
        assert_eq!(result.instances[0].array_row, 0);
        assert_eq!(result.compact_array_elements_checked, 0);
    }

    #[test]
    fn hierarchy_instance_aggregate_query_returns_one_record_for_compact_array() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_big_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );

        let result = db.query_hierarchy_instances_aggregate(Rect::new(0, 0, 200_000, 200_000), 1);

        assert_eq!(result.instances.len(), 1);
        assert_eq!(result.instances[0].bbox, Rect::new(0, 0, 100_000, 100_000));
        assert_eq!(
            result.instances[0].array_bbox,
            Rect::new(0, 0, 100_000, 100_000)
        );
        assert_eq!(result.instances[0].array_columns, 1_000);
        assert_eq!(result.instances[0].array_rows, 1_000);
        assert_eq!(result.instances[0].array_column, 0);
        assert_eq!(result.instances[0].array_row, 0);
        assert_eq!(result.compact_array_elements_checked, 0);
    }

    #[test]
    fn recursive_queries_respect_min_depth() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200, 200));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 100, 100));
        db.add_shape(
            mid,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::RegularWire, 101),
        );
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(2, 3, 8, 9), 1, ShapeKind::RegularWire, 202),
        );
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "leaf0".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 10,
                    dy: 20,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10, 20, 110, 120),
                source_id: 23,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_string(),
                child_cell: mid,
                transform: Transform {
                    dx: 100,
                    dy: 200,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(100, 200, 300, 400),
                source_id: 17,
            },
        );

        let shapes = db.query_recursive_shapes(RecursiveShapeQuery {
            viewport: Rect::new(0, 0, 400, 500),
            layer_ids: vec![1],
            max_depth: 2,
            min_depth: 2,
            include_kinds: vec![ShapeKind::RegularWire],
        });
        let instances = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(0, 0, 400, 500),
            max_depth: 2,
            min_depth: 2,
            expand_arrays: true,
        });

        assert_eq!(shapes.shapes.len(), 1);
        assert_eq!(shapes.shapes[0].source_id, 202);
        assert_eq!(instances.instances.len(), 1);
        assert_eq!(instances.instances[0].instance_id, 23);
    }

    #[test]
    fn compact_array_expansion_prunes_to_visible_element_range() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_big_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(50_000, 50_000, 50_020, 50_020),
            max_depth: 1,
            min_depth: 0,
            expand_arrays: true,
        });

        assert_eq!(result.total_array_elements, 1_000_000);
        assert_eq!(result.instances.len(), 1);
        assert!(result.compact_array_elements_checked > 0);
        assert!(result.compact_array_elements_checked < 100);
    }

    #[test]
    fn compact_array_expansion_prunes_rotated_arrays_to_visible_range() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_rotated_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R90,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(0, 0, 20, 20),
            max_depth: 1,
            min_depth: 0,
            expand_arrays: true,
        });

        assert!(!result.instances.is_empty());
        assert!(result.compact_array_elements_checked > 0);
        assert!(result.compact_array_elements_checked < 100);
    }

    #[test]
    fn recursive_instance_query_expands_nested_compact_arrays() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 300_000, 300_000));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200_000, 200_000));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "leaf_array".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 23,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_string(),
                child_cell: mid,
                transform: Transform {
                    dx: 10_000,
                    dy: 20_000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10_000, 20_000, 210_000, 220_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(60_000, 70_000, 60_250, 70_250),
            max_depth: 2,
            min_depth: 0,
            expand_arrays: true,
        });

        assert!(result.total_array_elements >= 1_000_000);
        assert!(result.instances.iter().any(|instance| {
            instance.instance_id == 23
                && instance.array_column == 500
                && instance.array_row == 500
                && instance.bbox == Rect::new(60_000, 70_000, 60_020, 70_020)
        }));
    }

    #[test]
    fn hierarchy_shape_query_recurses_into_compact_array_elements() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 200_000));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(2, 3, 8, 9), 2, ShapeKind::RegularWire, 11),
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "leaf_array".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 1_000,
                    rows: 1_000,
                    step_x: 100,
                    step_y: 100,
                },
                bbox: Rect::new(0, 0, 100_000, 100_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_shapes(RecursiveShapeQuery {
            viewport: Rect::new(50_000, 50_000, 50_020, 50_020),
            layer_ids: vec![2],
            max_depth: 1,
            min_depth: 0,
            include_kinds: vec![ShapeKind::RegularWire],
        });

        assert_eq!(result.shapes.len(), 1);
        assert_eq!(
            result.shapes[0].bbox,
            Rect::new(50_002, 50_003, 50_008, 50_009)
        );
        assert_eq!(result.shapes[0].instance_id, 17);
    }

    #[test]
    fn compact_array_traversal_applies_parent_transform_to_world_bboxes() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 300_000, 300_000));
        let mid = db.add_cell("mid", Rect::new(0, 0, 200_000, 200_000));
        let leaf = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            mid,
            CellInstance {
                id: 23,
                name: "leaf_array".to_string(),
                child_cell: leaf,
                transform: Transform {
                    dx: 1_000,
                    dy: 2_000,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 300,
                    rows: 1,
                    step_x: 100,
                    step_y: 0,
                },
                bbox: Rect::new(1_000, 2_000, 31_020, 2_020),
                source_id: 23,
            },
        );
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "mid0".to_string(),
                child_cell: mid,
                transform: Transform {
                    dx: 10_000,
                    dy: 20_000,
                    orient: Orientation::R0,
                },
                array: CellArray::default(),
                bbox: Rect::new(10_000, 20_000, 210_000, 220_000),
                source_id: 17,
            },
        );

        let result = db.query_recursive_instances(RecursiveInstanceQuery {
            viewport: Rect::new(16_000, 22_000, 16_020, 22_020),
            max_depth: 2,
            min_depth: 0,
            expand_arrays: true,
        });

        let array_element = result
            .instances
            .iter()
            .find(|instance| instance.instance_id == 23)
            .unwrap();

        assert_eq!(array_element.array_column, 50);
        assert_eq!(
            array_element.bbox,
            Rect::new(16_000, 22_000, 16_020, 22_020)
        );
        assert_eq!(
            array_element.array_bbox,
            Rect::new(11_000, 22_000, 41_020, 22_020)
        );
    }

    #[test]
    fn hierarchy_instance_query_returns_visible_array_elements_with_metadata() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 200_000, 1_000));
        let child = db.add_cell("leaf", Rect::new(0, 0, 20, 20));
        db.add_instance(
            db.top_cell(),
            CellInstance {
                id: 17,
                name: "u_array".to_string(),
                child_cell: child,
                transform: Transform {
                    dx: 0,
                    dy: 0,
                    orient: Orientation::R0,
                },
                array: CellArray {
                    columns: 128,
                    rows: 1,
                    step_x: 100,
                    step_y: 0,
                },
                bbox: Rect::new(0, 0, 12_800, 20),
                source_id: 17,
            },
        );

        let result = db.query_hierarchy_instances_indexed(Rect::new(5_000, 0, 5_020, 20), 1);

        assert_eq!(result.total_instances, 1);
        assert!(result.candidates_checked <= 2);
        assert_eq!(result.instances.len(), 1);
        assert_eq!(result.instances[0].bbox, Rect::new(5_000, 0, 5_020, 20));
        assert_eq!(result.instances[0].array_bbox, Rect::new(0, 0, 12_800, 20));
        assert_eq!(result.instances[0].array_columns, 128);
        assert_eq!(result.instances[0].array_column, 50);
    }

    #[test]
    fn package_source_loads_only_intersecting_tiles_for_viewport() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();

        let first = session
            .ensure_viewport_loaded(Rect::new(0, 0, 500, 500))
            .unwrap();

        assert_eq!(first.tile_count, 1);
        assert!(first.loaded_shapes > 0);
        let distant_shapes = session
            .db()
            .query_shapes(session.db().top_cell(), Rect::new(700, 700, 800, 800));
        assert!(distant_shapes
            .iter()
            .any(|shape| shape.kind == ShapeKind::Die));
        assert!(distant_shapes
            .iter()
            .any(|shape| shape.kind == ShapeKind::Core));
        assert!(!distant_shapes
            .iter()
            .any(|shape| shape.kind == ShapeKind::RegularWire && shape.source_id == 2));
    }

    #[test]
    fn package_source_reuses_loaded_viewport_tiles() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();

        session
            .ensure_viewport_loaded(Rect::new(0, 0, 500, 500))
            .unwrap();
        let second = session
            .ensure_viewport_loaded(Rect::new(0, 0, 500, 500))
            .unwrap();

        assert_eq!(second.new_shapes, 0);
        assert_eq!(second.cache_hits, 1);
    }

    #[test]
    fn viewport_batch_can_be_loaded_then_applied_idempotently() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let mut worker_source = PackageLayoutSource::open(&package_root, 64).unwrap();
        let source = PackageLayoutSource::open(&package_root, 64).unwrap();
        assert_eq!(source.package_root(), package_root.as_path());
        let mut session = LayoutSession::from_source(source).unwrap();
        let initial_revision = session.revision();

        let batch = worker_source
            .load_viewport_batch(Rect::new(0, 0, 500, 500))
            .unwrap();

        let first = session.apply_viewport_batch(batch.clone()).unwrap();
        let loaded_revision = session.revision();
        let shapes_after_first = session
            .db()
            .query_shapes(session.db().top_cell(), session.db().world_bbox())
            .len();
        let kinds_after_first = session
            .db()
            .query_shapes(session.db().top_cell(), session.db().world_bbox())
            .into_iter()
            .map(|shape| shape.kind)
            .collect::<std::collections::HashSet<_>>();
        let second = session.apply_viewport_batch(batch).unwrap();
        let shapes_after_second = session
            .db()
            .query_shapes(session.db().top_cell(), session.db().world_bbox())
            .len();

        assert_eq!(first.tile_count, 1);
        assert!(first.new_shapes > 0);
        assert!(kinds_after_first.contains(&ShapeKind::Die));
        assert!(kinds_after_first.contains(&ShapeKind::Core));
        assert_eq!(first.loaded_detail_tile_count, 1);
        assert!(loaded_revision > initial_revision);
        assert_eq!(second.new_shapes, 0);
        assert_eq!(second.loaded_shapes, 0);
        assert_eq!(second.loaded_detail_tile_count, 1);
        assert_eq!(shapes_after_second, shapes_after_first);
        assert_eq!(session.revision(), loaded_revision);
        assert_eq!(session.loaded_detail_tile_count(), 1);
    }

    #[test]
    fn layout_session_imports_package_layer_counts_without_loading_detail_tiles() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let session = LayoutSession::from_source(source).unwrap();

        assert_eq!(session.loaded_detail_tile_count(), 0);
        assert_eq!(session.db().package_layer_counts().get(&1), Some(&2));
    }

    #[test]
    fn layout_session_defers_detail_scope_until_detail_batch_apply() {
        let (_input, package_root) = create_layoutpkg_fixture();
        advertise_detail_scope(&package_root);
        fs::write(package_root.join("detail/scope.json"), b"{not-json").unwrap();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();

        let session = LayoutSession::from_source(source);

        assert!(
            session.is_ok(),
            "session startup should not read detail/scope.json"
        );
        let mut session = session.unwrap();
        let error = session
            .ensure_viewport_loaded(Rect::new(0, 0, 500, 500))
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("detail/scope.json") || error.contains("expected"),
            "detail scope errors should surface when detail batches are applied: {error}"
        );
    }

    #[test]
    fn layout_session_tracks_detail_and_overview_revisions_separately() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();
        let initial_hierarchy_revision = session.hierarchy_revision();
        let initial_overview_revision = session.overview_revision();
        let initial_detail_revision = session.detail_revision();

        session
            .ensure_viewport_loaded(Rect::new(0, 0, 500, 500))
            .unwrap();
        let detail_loaded_revision = session.detail_revision();

        assert_eq!(session.hierarchy_revision(), initial_hierarchy_revision);
        assert_eq!(session.overview_revision(), initial_overview_revision);
        assert!(detail_loaded_revision > initial_detail_revision);

        session.ensure_overview_for_units_per_pixel(250.0).unwrap();

        assert_eq!(session.hierarchy_revision(), initial_hierarchy_revision);
        assert!(session.overview_revision() > initial_overview_revision);
        assert_eq!(session.detail_revision(), detail_loaded_revision);
    }

    #[test]
    fn layout_session_applies_scoped_detail_records_to_child_cells() {
        let (_input, package_root) = create_layoutpkg_fixture();
        advertise_detail_scope(&package_root);
        write_json(
            &package_root.join("detail/scope.json"),
            json!({
                "schema": layoutpkg_format::DETAIL_SCOPE_SCHEMA,
                "version": 1,
                "records": [
                    { "source_id": 1, "cell_id": 2, "coordinates": "cell_local" },
                    { "source_id": 2, "cell_id": 0, "coordinates": "top" }
                ]
            }),
        );
        let source = PackageLayoutSource::open(&package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();
        let master = session.db().cell_by_name("NAND2").unwrap();
        let child_shapes_before = session.db().cell(master).unwrap().shapes().len();

        let stats = session
            .ensure_viewport_loaded(Rect::new(0, 0, 1_000, 1_000))
            .unwrap();
        let child_shapes = session.db().cell(master).unwrap().shapes();
        let top_shapes = session
            .db()
            .query_shapes(session.db().top_cell(), session.db().world_bbox());

        assert_eq!(stats.scoped_shapes, 1);
        assert!(stats.scope_fallback_shapes == 0);
        assert_eq!(child_shapes.len(), child_shapes_before + 1);
        assert!(child_shapes.iter().any(|shape| shape.source_id == 1));
        assert!(!top_shapes.iter().any(|shape| shape.source_id == 1));
        assert!(top_shapes.iter().any(|shape| shape.source_id == 2));
    }

    #[test]
    fn package_source_loads_overview_coverage_without_detail_tiles() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();

        let coverage = session.load_overview_coverage().unwrap();

        assert!(!coverage.is_empty());
        assert_eq!(session.loaded_detail_tile_count(), 0);
    }

    #[test]
    fn layout_session_loads_overview_bins_for_zoom_level_idempotently() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();
        let world = session.db().world_bbox();

        let first_changed = session.ensure_overview_for_units_per_pixel(250.0).unwrap();
        let loaded_revision = session.revision();
        let bins_after_first = session.db().overview_bins(world).count();
        let second_changed = session.ensure_overview_for_units_per_pixel(250.0).unwrap();

        assert!(first_changed);
        assert!(bins_after_first > 0);
        assert!(!second_changed);
        assert_eq!(session.db().overview_bins(world).count(), bins_after_first);
        assert_eq!(session.revision(), loaded_revision);
        assert_eq!(session.loaded_detail_tile_count(), 0);
    }

    #[test]
    fn layout_session_does_not_bump_revision_when_new_overview_level_has_identical_bins() {
        let (_input, package_root) = create_layoutpkg_fixture();
        write_identical_two_level_overview_pyramid(&package_root);
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let mut session = LayoutSession::from_source(source).unwrap();
        let world = session.db().world_bbox();

        let first_changed = session.ensure_overview_for_units_per_pixel(1.0).unwrap();
        let loaded_revision = session.revision();
        let bins_after_first = session
            .db()
            .overview_bins(world)
            .cloned()
            .collect::<Vec<_>>();
        let second_changed = session.ensure_overview_for_units_per_pixel(80.0).unwrap();

        assert!(first_changed);
        assert_eq!(bins_after_first.len(), 1);
        assert!(!second_changed);
        assert_eq!(
            session
                .db()
                .overview_bins(world)
                .cloned()
                .collect::<Vec<_>>(),
            bins_after_first
        );
        assert_eq!(session.revision(), loaded_revision);
    }

    #[test]
    fn layoutpkg_adapter_imports_current_package_as_v2_layoutdb() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let mut package = layoutpkg_reader::LayoutPackage::open(package_root).unwrap();

        let db = LayoutDb::from_layout_package(&mut package, 64).unwrap();

        assert_eq!(db.design_name(), "reader-unit");
        assert_eq!(db.layers().len(), 1);
        assert!(db.query_shapes(db.top_cell(), db.world_bbox()).len() >= 3);
    }

    #[test]
    fn layout_session_imports_hierarchy_cells_and_instances() {
        let (_input, package_root) = create_layoutpkg_fixture();
        let source = PackageLayoutSource::open(package_root, 64).unwrap();
        let session = LayoutSession::from_source(source).unwrap();

        let top = session.db().cell(session.db().top_cell()).unwrap();
        assert_eq!(top.name(), "reader-unit");
        assert_eq!(top.instances().len(), 1);
        let instance = &top.instances()[0];
        assert_eq!(instance.name, "u0");
        assert_eq!(instance.transform.dx, 10);
        assert_eq!(instance.transform.dy, 20);

        let child = session.db().cell(instance.child_cell).unwrap();
        assert_eq!(child.name(), "NAND2");
        assert_eq!(child.shapes().len(), 1);
        assert_eq!(child.shapes()[0].bbox, Rect::new(2, 3, 8, 9));
    }
}
