use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::mem::size_of;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use anyhow::Result;
use bytemuck::Pod;
use chipgeom_format::{
    GeometryDeltaRecord, GeometryViewTileRecord, LinePayload, OwnerRef, OwnerType, Point32,
    PointPayload, Rect32, RectPayload, ShapeId, ShapeKind, ShapeRecord, ShapeState, ShapeVersion,
};
pub use chipgeom_reader::{
    BusMetadata, ConnectivityMetadata, GeometryManifest, GeometryMappedBytes, GridMetadata,
    GroupMetadata, MasterMetadata, NetMetadata, SiteMetadata, ViaMetadata,
};
use chipgeom_reader::{GeometrySnapshot, LayerMetadata};
use regex::Regex;
use rstar::{RTree, RTreeObject, AABB};

mod view_tiles;
pub use view_tiles::ViewTileIndex;

mod query_prefix;
pub use query_prefix::QueryPrefixLimits;

mod query_sample;
pub use query_sample::LayerQuerySample;

mod query_window;

mod search;
mod shape_lookup;

pub use search::BoundedShapeSearch;

pub mod clock_tree;

pub struct ChipViewDb {
    connectivity_index: OnceLock<ConnectivityIndex>,
    layer_index: LayerShapeIndex,
    name_index: OnceLock<OwnerNameIndex>,
    net_guides: OnceLock<Vec<UnroutedNetGuide>>,
    net_index: OnceLock<NetMetadataIndex>,
    shape_index: ShapeIdIndex,
    snapshot: GeometrySnapshot,
    view_index: OnceLock<ViewTileIndex>,
    window_queries: query_window::WindowQueries,
}

#[derive(Clone, Debug, Default)]
pub struct SnapshotStats {
    pub shape_count: usize,
    pub owner_count: usize,
    pub name_count: usize,
    pub site_count: usize,
    pub master_count: usize,
    pub via_count: usize,
    pub grid_count: usize,
    pub connectivity_count: usize,
    pub net_count: usize,
    pub bus_count: usize,
    pub group_count: usize,
    pub bbox: Option<Rect32>,
    pub die_bbox: Option<Rect32>,
    pub owner_type_counts: BTreeMap<u8, usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChipViewIndexMemoryStats {
    pub layer_index_bytes: usize,
    pub shape_index_bytes: usize,
    pub view_index_bytes: usize,
    pub name_index_bytes: usize,
    pub net_index_bytes: usize,
    pub connectivity_index_bytes: usize,
    pub total_bytes: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChipViewMemoryStats {
    pub mapped_bytes: GeometryMappedBytes,
    pub index_bytes: ChipViewIndexMemoryStats,
    pub mapped_plus_index_bytes: usize,
}

/// Per-phase wall-clock timings collected while opening a [`ChipViewDb`].
/// All fields are elapsed microseconds measured with [`Instant`]; index
/// phases are built in parallel, so their individual durations overlap.
/// `open` builds only the geometry-query indexes; name, net, connectivity and
/// view indexes are lazy and therefore report zero until requested. The
/// diagnostic `open_with_timings` eagerly builds them for comparable reports.
/// `net_guides` is always zero because guides are lazy on first access.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OpenTimings {
    pub snapshot_open: u128,
    pub connectivity_index: u128,
    pub net_index: u128,
    pub view_index: u128,
    pub layer_index: u128,
    pub shape_index: u128,
    pub name_index: u128,
    pub net_guides: u128,
    pub total: u128,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DeltaStats {
    pub record_count: usize,
    pub latest_sequence_id: Option<u64>,
    pub latest_command_id: Option<u64>,
    pub latest_shape_id: Option<ShapeId>,
    pub latest_old_version: Option<ShapeVersion>,
    pub latest_new_version: Option<ShapeVersion>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NearestShape {
    pub shape_id: ShapeId,
    pub distance_squared: u64,
}

/// Geometry available for one requested timing endpoint.
///
/// `pin_bbox` is the preferred timing-path anchor. `instance_bbox` is the
/// fallback when a pin-port shape is absent from the geometry snapshot.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EndpointPinGeometry {
    pub instance_bbox: Option<Rect32>,
    pub pin_bbox: Option<Rect32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerSummary {
    pub layer_id: u16,
    pub shape_count: usize,
    pub order: u32,
    pub name: String,
    pub layer_type: String,
    pub direction: String,
    pub width: i32,
    pub pitch_x: i32,
    pub pitch_y: i32,
    pub min_spacing: i32,
    pub min_area: i32,
    pub min_step: i32,
    pub cut_spacing: i32,
    pub enclosure_below: String,
    pub enclosure_above: String,
    pub lef58_rule_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnroutedNetGuide {
    pub net_name: String,
    pub net_kind: String,
    pub hub: Point32,
    pub pin_centers: Vec<Point32>,
    pub bbox: Rect32,
}

#[derive(Clone, Debug)]
pub struct ShapeDetail {
    pub shape: ShapeRecord,
    pub owner: OwnerRef,
    pub owner_name: Option<String>,
    pub owner_local_name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OwnerLocalInfo {
    pub kind: String,
    pub fields: BTreeMap<String, String>,
}

impl OwnerLocalInfo {
    pub fn parse(local_name: &str) -> Option<Self> {
        let mut kind = String::new();
        let mut fields = BTreeMap::new();

        for token in local_name.split_whitespace() {
            let Some((key, value)) = token.split_once(':') else {
                continue;
            };
            if key.is_empty() || value.is_empty() {
                continue;
            }
            if kind.is_empty() {
                kind = key.to_string();
            }
            fields.insert(key.to_string(), value.to_string());
        }

        if fields.is_empty() {
            return None;
        }

        Some(Self { kind, fields })
    }

    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields.get(key).map(String::as_str)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeGeometry {
    Rect(Rect32),
    Line(LinePayload),
    Point(PointPayload),
}

#[derive(Clone, Debug, Default)]
pub struct LayerShapeIndex {
    by_layer: BTreeMap<u16, Arc<[usize]>>,
    spatial_by_layer: BTreeMap<u16, OnceLock<RTree<LayerSpatialEntry>>>,
    layer_bboxes: RTree<LayerBBoxEntry>,
}

#[derive(Clone, Debug, Default)]
pub struct ShapeIdIndex {
    by_id: HashMap<ShapeId, usize>,
    dense_base: Option<ShapeId>,
}

#[derive(Clone, Debug, Default)]
pub struct OwnerNameIndex {
    names: Vec<Arc<str>>,
    name_by_owner: HashMap<(u8, u64), u32>,
    aliases_by_owner: HashMap<(u8, u64), Vec<u32>>,
    owner_shapes: OnceLock<OwnerShapeLookup>,
}

#[derive(Clone, Debug, Default)]
struct OwnerShapeLookup {
    by_name: BTreeMap<Arc<str>, Vec<ShapeId>>,
    shapes_by_owner: HashMap<(u8, u64), Vec<ShapeId>>,
}

#[derive(Clone, Debug, Default)]
struct NetMetadataIndex {
    kind_by_name: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default)]
struct ConnectivityIndex {
    by_instance_name: BTreeMap<String, Vec<usize>>,
    by_net_name: BTreeMap<String, Vec<usize>>,
    by_pin_name: BTreeMap<String, Vec<usize>>,
    by_qualified_pin_name: BTreeMap<String, Vec<usize>>,
}

#[derive(Clone, Debug, Default)]
struct EndpointPinLookup {
    instance_paths_by_name: BTreeMap<String, BTreeSet<u32>>,
    instance_pin_bboxes_by_path: BTreeMap<u32, BTreeMap<String, Rect32>>,
    instance_pin_bboxes_by_name: BTreeMap<String, Rect32>,
    io_pin_bboxes_by_name: BTreeMap<String, Rect32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LayerSpatialEntry {
    index: usize,
    envelope: AABB<[i32; 2]>,
}

impl RTreeObject for LayerSpatialEntry {
    type Envelope = AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

/// A single leaf in the top-level layer bounding-box R-Tree.
/// Stores the layer ID plus the merged AABB of all shapes on that layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LayerBBoxEntry {
    layer_id: u16,
    envelope: AABB<[i32; 2]>,
}

impl RTreeObject for LayerBBoxEntry {
    type Envelope = AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

/// Number of worker threads for index construction. Capped so machines with
/// very high core counts do not spawn more threads than index phases.
fn index_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|threads| threads.get())
        .unwrap_or(1)
        .min(32)
}

/// Number of shapes below which a single-threaded layer scan is cheaper than
/// spawning workers and merging partial results.
const PARALLEL_SCAN_MIN_SHAPES: usize = 16 * 1024;

/// Endpoint count below which the sort-and-group connectivity index build
/// runs on the calling thread instead of spawning one worker per map.
const CONNECTIVITY_PARALLEL_MIN_ENDPOINTS: usize = 4096;

/// Result of scanning one chunk for the ordered layer directory and bounds.
#[derive(Default)]
struct LayerScan {
    by_layer: BTreeMap<u16, Vec<usize>>,
    layer_bbox_map: BTreeMap<u16, [i32; 4]>,
}

fn scan_layer_chunk(shapes: &[ShapeRecord], index_offset: usize) -> LayerScan {
    let mut scan = LayerScan::default();
    for (local_index, shape) in shapes.iter().enumerate() {
        if shape.state != ShapeState::Alive as u8 {
            continue;
        }
        let index = index_offset + local_index;
        scan.by_layer.entry(shape.layer_id).or_default().push(index);
        // Merge this shape's bbox into the per-layer AABB.
        let b = shape.bbox;
        let lx = b.lx.min(b.hx);
        let ly = b.ly.min(b.hy);
        let hx = b.lx.max(b.hx);
        let hy = b.ly.max(b.hy);
        scan.layer_bbox_map
            .entry(shape.layer_id)
            .and_modify(|acc| {
                acc[0] = acc[0].min(lx);
                acc[1] = acc[1].min(ly);
                acc[2] = acc[2].max(hx);
                acc[3] = acc[3].max(hy);
            })
            .or_insert([lx, ly, hx, hy]);
    }
    scan
}

fn parallel_layer_scans(shapes: &[ShapeRecord], workers: usize) -> Vec<LayerScan> {
    let chunk_len = shapes.len().div_ceil(workers);
    std::thread::scope(|scope| {
        shapes
            .chunks(chunk_len)
            .enumerate()
            .map(|(chunk_index, chunk)| {
                let index_offset = chunk_index * chunk_len;
                scope.spawn(move || scan_layer_chunk(chunk, index_offset))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().expect("layer scan worker panicked"))
            .collect()
    })
}

/// Runs a build phase and reports how long it took, so `open` can report
/// per-index timings even when phases run concurrently.
fn timed<T>(phase: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let value = phase();
    (value, start.elapsed())
}

impl LayerShapeIndex {
    pub fn from_shapes(shapes: &[ShapeRecord]) -> Self {
        let workers = index_worker_count();
        let scans = if workers > 1 && shapes.len() >= PARALLEL_SCAN_MIN_SHAPES {
            parallel_layer_scans(shapes, workers)
        } else {
            vec![scan_layer_chunk(shapes, 0)]
        };
        let mut by_layer: BTreeMap<u16, Vec<usize>> = BTreeMap::new();
        let mut layer_bbox_map: BTreeMap<u16, [i32; 4]> = BTreeMap::new();
        // Merge chunk scans in chunk order so per-layer index and entry
        // vectors keep their original ascending-by-shape-index ordering.
        for scan in scans {
            for (layer_id, indices) in scan.by_layer {
                by_layer.entry(layer_id).or_default().extend(indices);
            }
            for (layer_id, bbox) in scan.layer_bbox_map {
                layer_bbox_map
                    .entry(layer_id)
                    .and_modify(|acc| {
                        acc[0] = acc[0].min(bbox[0]);
                        acc[1] = acc[1].min(bbox[1]);
                        acc[2] = acc[2].max(bbox[2]);
                        acc[3] = acc[3].max(bbox[3]);
                    })
                    .or_insert(bbox);
            }
        }
        let by_layer = by_layer
            .into_iter()
            .map(|(layer_id, indices)| (layer_id, Arc::from(indices)))
            .collect::<BTreeMap<_, _>>();
        let spatial_by_layer = by_layer
            .keys()
            .map(|layer_id| (*layer_id, OnceLock::new()))
            .collect();
        // Build the top-level layer bounding-box R-Tree.
        let layer_bbox_entries: Vec<LayerBBoxEntry> = layer_bbox_map
            .into_iter()
            .map(|(layer_id, [lx, ly, hx, hy])| LayerBBoxEntry {
                layer_id,
                envelope: AABB::from_corners([lx, ly], [hx, hy]),
            })
            .collect();
        let layer_bboxes = RTree::bulk_load(layer_bbox_entries);
        Self {
            by_layer,
            spatial_by_layer,
            layer_bboxes,
        }
    }

    pub fn candidate_count(&self, layer_id: u16) -> usize {
        self.by_layer
            .get(&layer_id)
            .map_or(0, |indices| indices.len())
    }

    pub fn query_candidate_count(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
    ) -> usize {
        self.spatial_candidate_indices(shapes, layer_id, bbox).len()
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>()
            + self.spatial_by_layer.len() * size_of::<(u16, OnceLock<RTree<LayerSpatialEntry>>)>()
            + self
                .by_layer
                .values()
                .map(|indices| {
                    size_of::<u16>()
                        + size_of::<Arc<[usize]>>()
                        + indices.len() * size_of::<usize>()
                })
                .sum::<usize>()
            + self
                .spatial_by_layer
                .values()
                .map(|tree| {
                    tree.get().map_or(0, |tree| {
                        size_of::<RTree<LayerSpatialEntry>>()
                            + tree.size() * size_of::<LayerSpatialEntry>()
                    })
                })
                .sum::<usize>()
    }

    pub fn query_layer_intersect(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<ShapeId> {
        self.query_layer_intersect_indices(shapes, layer_id, bbox)
            .into_iter()
            .map(|index| shapes[index].id)
            .collect()
    }

    pub fn query_layers_intersect(
        &self,
        shapes: &[ShapeRecord],
        layer_ids: &[u16],
        bbox: Rect32,
    ) -> Vec<ShapeId> {
        let viewport_envelope = rect_envelope(bbox);
        let layers_in_view: HashMap<_, _> = self
            .layer_bboxes
            .locate_in_envelope_intersecting(viewport_envelope)
            .map(|entry| (entry.layer_id, entry.envelope))
            .collect();

        let mut hits = Vec::new();
        for layer_id in layer_ids {
            // Skip layers whose entire extent lies outside the viewport.
            let Some(envelope) = layers_in_view.get(layer_id) else {
                continue;
            };
            let mut layer_hits: Vec<_> = if bbox.lx <= bbox.hx
                && bbox.ly <= bbox.hy
                && bbox.lx <= envelope.lower()[0]
                && bbox.ly <= envelope.lower()[1]
                && bbox.hx >= envelope.upper()[0]
                && bbox.hy >= envelope.upper()[1]
            {
                self.by_layer
                    .get(layer_id)
                    .into_iter()
                    .flat_map(|indices| indices.iter())
                    .map(|index| shapes[*index].id)
                    .collect()
            } else {
                self.query_layer_intersect(shapes, *layer_id, bbox)
            };
            layer_hits.sort_unstable();
            hits.extend(layer_hits);
        }
        hits
    }

    pub fn query_layer_intersect_indices(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<usize> {
        self.spatial_candidate_indices(shapes, layer_id, bbox)
            .into_iter()
            .filter(|index| shapes[*index].bbox.intersects(bbox))
            .collect()
    }

    fn spatial_tree(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
    ) -> Option<&RTree<LayerSpatialEntry>> {
        let indices = self.by_layer.get(&layer_id)?;
        let tree = self.spatial_by_layer.get(&layer_id)?.get_or_init(|| {
            let entries = indices
                .iter()
                .map(|&index| LayerSpatialEntry {
                    index,
                    envelope: rect_envelope(shapes[index].bbox),
                })
                .collect();
            RTree::bulk_load(entries)
        });
        Some(tree)
    }

    fn spatial_candidate_indices(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<usize> {
        let mut indices = self
            .spatial_tree(shapes, layer_id)
            .into_iter()
            .flat_map(|tree| tree.locate_in_envelope_intersecting(rect_envelope(bbox)))
            .map(|entry| entry.index)
            .collect::<Vec<_>>();
        indices.sort_unstable();
        indices
    }

    #[cfg(test)]
    fn spatial_candidate_count(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
    ) -> usize {
        self.spatial_tree(shapes, layer_id).map_or(0, |tree| {
            tree.locate_in_envelope_intersecting(rect_envelope(bbox))
                .count()
        })
    }

    #[cfg(test)]
    fn initialized_spatial_tree_count(&self) -> usize {
        self.spatial_by_layer
            .values()
            .filter(|tree| tree.get().is_some())
            .count()
    }

    fn prewarm_spatial_indexes(&self, shapes: &[ShapeRecord]) {
        for layer_id in self.by_layer.keys() {
            let _ = self.spatial_tree(shapes, *layer_id);
        }
    }

    pub fn pick_top_rect(
        &self,
        shapes: &[ShapeRecord],
        layer_ids: &[u16],
        point: Point32,
    ) -> Option<ShapeId> {
        layer_ids
            .iter()
            .flat_map(|layer_id| {
                self.spatial_candidate_indices(shapes, *layer_id, point_bbox(point))
            })
            .filter(|index| {
                let shape = &shapes[*index];
                shape.state == ShapeState::Alive as u8
                    && shape.kind == ShapeKind::Rect as u8
                    && rect_contains_point(shape.bbox, point)
            })
            .max()
            .map(|index| shapes[index].id)
    }

    pub fn pick_top_shape(
        &self,
        shapes: &[ShapeRecord],
        layer_ids: &[u16],
        point: Point32,
    ) -> Option<ShapeId> {
        layer_ids
            .iter()
            .flat_map(|layer_id| {
                self.spatial_candidate_indices(shapes, *layer_id, point_bbox(point))
            })
            .filter(|index| {
                let shape = &shapes[*index];
                shape.state == ShapeState::Alive as u8
                    && is_pickable_shape_kind(shape.kind)
                    && rect_contains_point(shape.bbox, point)
            })
            .max()
            .map(|index| shapes[index].id)
    }

    pub fn nearest_shape(
        &self,
        shapes: &[ShapeRecord],
        layer_ids: &[u16],
        point: Point32,
        max_distance: Option<i32>,
    ) -> Option<NearestShape> {
        let max_distance_squared =
            max_distance.map(|distance| saturating_square_u64(distance.max(0) as i64));
        let candidates = if let Some(distance) = max_distance {
            let radius = distance.max(0);
            let bbox = Rect32 {
                lx: point.x.saturating_sub(radius),
                ly: point.y.saturating_sub(radius),
                hx: point.x.saturating_add(radius),
                hy: point.y.saturating_add(radius),
            };
            layer_ids
                .iter()
                .flat_map(|layer_id| self.spatial_candidate_indices(shapes, *layer_id, bbox))
                .collect::<Vec<_>>()
        } else {
            layer_ids
                .iter()
                .flat_map(|layer_id| {
                    self.by_layer
                        .get(layer_id)
                        .into_iter()
                        .flat_map(|indices| indices.iter().copied())
                })
                .collect::<Vec<_>>()
        };

        candidates
            .into_iter()
            .filter_map(|index| {
                let shape = shapes.get(index)?;
                if shape.state != ShapeState::Alive as u8 || !is_pickable_shape_kind(shape.kind) {
                    return None;
                }
                let distance_squared = rect_distance_squared(shape.bbox, point);
                if max_distance_squared.is_some_and(|limit| distance_squared > limit) {
                    return None;
                }
                Some((distance_squared, shape.layer_id, shape.id))
            })
            .min()
            .map(|(distance_squared, _, shape_id)| NearestShape {
                shape_id,
                distance_squared,
            })
    }
}

fn extend_name_shapes(
    by_name: &mut BTreeMap<Arc<str>, Vec<ShapeId>>,
    names: &[Arc<str>],
    name_id: u32,
    shape_ids: &[ShapeId],
) {
    let Some(name) = names.get(name_id as usize) else {
        return;
    };
    by_name
        .entry(Arc::clone(name))
        .or_default()
        .extend_from_slice(shape_ids);
}

impl OwnerNameIndex {
    fn from_snapshot(snapshot: &GeometrySnapshot) -> Self {
        let owner_names = snapshot.name_records().iter().filter_map(|record| {
            Some((
                record.owner_type,
                record.owner_id,
                snapshot.owner_name(record)?,
            ))
        });
        Self::from_names(owner_names)
    }

    fn from_names<S: AsRef<str>>(owner_names: impl IntoIterator<Item = (u8, u64, S)>) -> Self {
        // Intern names once so each unique name is allocated a single time
        // and shared between the name table and the lazy search lookup.
        let mut names = Vec::<Arc<str>>::new();
        let mut name_ids = HashMap::<Arc<str>, u32>::new();
        let mut name_by_owner = HashMap::<(u8, u64), u32>::new();
        let mut aliases_by_owner = HashMap::<(u8, u64), Vec<u32>>::new();
        for (owner_type, owner_id, name) in owner_names {
            // Local names (for example via master names stored on OwnerRef.name_id)
            // share the name-record file but are not owner-name query keys.
            if owner_type == OwnerType::None as u8 {
                continue;
            }
            let owner_key = (owner_type, owner_id);
            let name = name.as_ref();
            let name_id = match name_ids.get(name) {
                Some(&name_id) => name_id,
                None => {
                    let interned: Arc<str> = Arc::from(name);
                    let name_id = names.len() as u32;
                    names.push(interned.clone());
                    name_ids.insert(interned, name_id);
                    name_id
                }
            };
            if let Some(&canonical) = name_by_owner.get(&owner_key) {
                if canonical != name_id {
                    let aliases = aliases_by_owner.entry(owner_key).or_default();
                    if !aliases.contains(&name_id) {
                        aliases.push(name_id);
                    }
                }
            } else {
                name_by_owner.insert(owner_key, name_id);
            }
        }
        Self {
            names,
            name_by_owner,
            aliases_by_owner,
            owner_shapes: OnceLock::new(),
        }
    }

    #[cfg(test)]
    fn from_shapes_and_names<S: AsRef<str>>(
        shapes: &[ShapeRecord],
        owners: &[OwnerRef],
        owner_names: impl IntoIterator<Item = (u8, u64, S)>,
    ) -> Self {
        let index = Self::from_names(owner_names);
        let lookup = index.build_owner_shapes(shapes, owners);
        let _ = index.owner_shapes.set(lookup);
        index
    }

    fn owner_shapes(&self, shapes: &[ShapeRecord], owners: &[OwnerRef]) -> &OwnerShapeLookup {
        self.owner_shapes
            .get_or_init(|| self.build_owner_shapes(shapes, owners))
    }

    fn build_owner_shapes(&self, shapes: &[ShapeRecord], owners: &[OwnerRef]) -> OwnerShapeLookup {
        // Group alive shapes by owner key with a single sort instead of
        // growing one small Vec per owner through repeated map inserts.
        let mut owner_shape_pairs = Vec::with_capacity(shapes.len());
        for shape in shapes {
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            let Some(owner) = owners.get(shape.owner_index as usize) else {
                continue;
            };
            owner_shape_pairs.push(((owner.owner_type, owner.owner_id), shape.id));
        }
        owner_shape_pairs.sort_unstable();
        let mut shapes_by_owner = HashMap::<(u8, u64), Vec<ShapeId>>::new();
        let mut group_start = 0;
        while group_start < owner_shape_pairs.len() {
            let mut group_end = group_start + 1;
            while group_end < owner_shape_pairs.len()
                && owner_shape_pairs[group_end].0 == owner_shape_pairs[group_start].0
            {
                group_end += 1;
            }
            // Sorting the full pair makes each group's ids ascending; distinct
            // shape records can still share one id, so dedup once per group.
            let mut shape_ids: Vec<ShapeId> = owner_shape_pairs[group_start..group_end]
                .iter()
                .map(|pair| pair.1)
                .collect();
            shape_ids.dedup();
            shapes_by_owner.insert(owner_shape_pairs[group_start].0, shape_ids);
            group_start = group_end;
        }

        let mut by_name = BTreeMap::<Arc<str>, Vec<ShapeId>>::new();
        for (&owner_key, &name_id) in &self.name_by_owner {
            let Some(shape_ids) = shapes_by_owner.get(&owner_key) else {
                continue;
            };
            extend_name_shapes(&mut by_name, &self.names, name_id, shape_ids);
            if let Some(aliases) = self.aliases_by_owner.get(&owner_key) {
                for &alias_id in aliases {
                    extend_name_shapes(&mut by_name, &self.names, alias_id, shape_ids);
                }
            }
        }
        for shape_ids in by_name.values_mut() {
            shape_ids.sort_unstable();
            shape_ids.dedup();
        }
        OwnerShapeLookup {
            by_name,
            shapes_by_owner,
        }
    }

    pub fn query(&self, shapes: &[ShapeRecord], owners: &[OwnerRef], name: &str) -> Vec<ShapeId> {
        self.owner_shapes(shapes, owners)
            .by_name
            .get(name)
            .cloned()
            .unwrap_or_default()
    }

    pub fn query_pattern(
        &self,
        shapes: &[ShapeRecord],
        owners: &[OwnerRef],
        pattern: &Regex,
    ) -> Vec<ShapeId> {
        self.owner_shapes(shapes, owners)
            .by_name
            .iter()
            .filter(|(name, _)| pattern.is_match(name.as_ref()))
            .flat_map(|(_, shape_ids)| shape_ids.iter().copied())
            .collect()
    }

    pub fn query_owner(
        &self,
        shapes: &[ShapeRecord],
        owners: &[OwnerRef],
        owner_type: u8,
        owner_id: u64,
    ) -> Vec<ShapeId> {
        self.owner_shapes(shapes, owners)
            .shapes_by_owner
            .get(&(owner_type, owner_id))
            .cloned()
            .unwrap_or_default()
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        let name_bytes = self
            .names
            .iter()
            .map(|name| size_of::<Arc<str>>() + name.len())
            .sum::<usize>();
        let name_by_owner_bytes =
            self.name_by_owner.len() * (size_of::<(u8, u64)>() + size_of::<u32>());
        let aliases_by_owner_bytes = self
            .aliases_by_owner
            .values()
            .map(|name_ids| size_of::<Vec<u32>>() + name_ids.capacity() * size_of::<u32>())
            .sum::<usize>();
        let owner_shape_bytes = self.owner_shapes.get().map_or(0, |lookup| {
            let by_name_bytes = lookup.by_name.len() * size_of::<Arc<str>>()
                + lookup
                    .by_name
                    .values()
                    .map(|shape_ids| {
                        size_of::<Vec<ShapeId>>() + shape_ids.capacity() * size_of::<ShapeId>()
                    })
                    .sum::<usize>();
            let shapes_by_owner_bytes = lookup
                .shapes_by_owner
                .values()
                .map(|shape_ids| {
                    size_of::<(u8, u64)>()
                        + size_of::<Vec<ShapeId>>()
                        + shape_ids.capacity() * size_of::<ShapeId>()
                })
                .sum::<usize>();
            by_name_bytes + shapes_by_owner_bytes
        });
        size_of::<Self>()
            + name_bytes
            + name_by_owner_bytes
            + aliases_by_owner_bytes
            + owner_shape_bytes
    }

    pub fn name_for_owner(&self, owner_type: u8, owner_id: u64) -> Option<&str> {
        self.name_by_owner
            .get(&(owner_type, owner_id))
            .map(|&name_id| self.names[name_id as usize].as_ref())
    }
}

impl NetMetadataIndex {
    fn from_nets(nets: &[NetMetadata]) -> Self {
        let mut kind_by_name = BTreeMap::<String, String>::new();
        for net in nets {
            if net.name.is_empty() {
                continue;
            }
            kind_by_name
                .entry(net.name.clone())
                .or_insert_with(|| net.kind.clone());
        }
        Self { kind_by_name }
    }

    fn kind_for_name(&self, name: &str) -> Option<&str> {
        self.kind_by_name.get(name).map(String::as_str)
    }

    fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>()
            + self
                .kind_by_name
                .iter()
                .map(|(name, kind)| {
                    size_of::<(String, String)>() + name.capacity() + kind.capacity()
                })
                .sum::<usize>()
    }
}

impl ConnectivityIndex {
    fn from_endpoints(endpoints: &[ConnectivityMetadata]) -> Self {
        // Each map is built independently: collect (name, endpoint_index)
        // pairs, sort, and group once. That replaces one String allocation
        // plus a BTreeMap descent per endpoint with a single allocation per
        // unique name and exact-size index vectors.
        let workers = index_worker_count();
        if workers > 1 && endpoints.len() >= CONNECTIVITY_PARALLEL_MIN_ENDPOINTS {
            let mut by_instance_name = Vec::with_capacity(endpoints.len());
            let mut by_net_name = Vec::with_capacity(endpoints.len());
            let mut by_pin_name = Vec::with_capacity(endpoints.len());
            let mut by_qualified = Vec::with_capacity(endpoints.len());
            for (index, endpoint) in endpoints.iter().enumerate() {
                if !endpoint.instance_name.is_empty() {
                    by_instance_name.push((endpoint.instance_name.as_str(), index));
                }
                if !endpoint.net_name.is_empty() {
                    by_net_name.push((endpoint.net_name.as_str(), index));
                }
                if !endpoint.pin_name.is_empty() {
                    by_pin_name.push((endpoint.pin_name.as_str(), index));
                }
                if !endpoint.instance_name.is_empty() && !endpoint.pin_name.is_empty() {
                    by_qualified.push((
                        (endpoint.instance_name.as_str(), endpoint.pin_name.as_str()),
                        index,
                    ));
                }
            }
            std::thread::scope(|scope| {
                let instance = scope.spawn(move || grouped_connectivity_index(by_instance_name));
                let net = scope.spawn(move || grouped_connectivity_index(by_net_name));
                let pin = scope.spawn(move || grouped_connectivity_index(by_pin_name));
                let qualified = scope.spawn(move || grouped_qualified_index(by_qualified));
                Self {
                    by_instance_name: instance
                        .join()
                        .expect("instance connectivity index worker panicked"),
                    by_net_name: net.join().expect("net connectivity index worker panicked"),
                    by_pin_name: pin.join().expect("pin connectivity index worker panicked"),
                    by_qualified_pin_name: qualified
                        .join()
                        .expect("qualified connectivity index worker panicked"),
                }
            })
        } else {
            let mut index = Self::default();
            for (endpoint_index, endpoint) in endpoints.iter().enumerate() {
                push_connectivity_index(
                    &mut index.by_instance_name,
                    &endpoint.instance_name,
                    endpoint_index,
                );
                push_connectivity_index(&mut index.by_net_name, &endpoint.net_name, endpoint_index);
                push_connectivity_index(&mut index.by_pin_name, &endpoint.pin_name, endpoint_index);
                if !endpoint.instance_name.is_empty() && !endpoint.pin_name.is_empty() {
                    push_connectivity_index(
                        &mut index.by_qualified_pin_name,
                        &format!("{}/{}", endpoint.instance_name, endpoint.pin_name),
                        endpoint_index,
                    );
                }
            }
            index
        }
    }

    fn endpoints_for_instance<'a>(
        &self,
        endpoints: &'a [ConnectivityMetadata],
        instance_name: &str,
    ) -> Vec<&'a ConnectivityMetadata> {
        self.endpoint_refs(endpoints, self.by_instance_name.get(instance_name))
    }

    fn endpoints_for_net<'a>(
        &self,
        endpoints: &'a [ConnectivityMetadata],
        net_name: &str,
    ) -> Vec<&'a ConnectivityMetadata> {
        self.endpoint_refs(endpoints, self.by_net_name.get(net_name))
    }

    fn endpoints_for_pin<'a>(
        &self,
        endpoints: &'a [ConnectivityMetadata],
        pin_name: &str,
    ) -> Vec<&'a ConnectivityMetadata> {
        self.endpoint_refs(endpoints, self.indices_for_pin(pin_name))
    }

    fn indices_for_pin(&self, pin_name: &str) -> Option<&Vec<usize>> {
        if pin_name.contains('/') {
            self.by_qualified_pin_name.get(pin_name)
        } else {
            self.by_pin_name.get(pin_name)
        }
    }

    fn endpoint_refs<'a>(
        &self,
        endpoints: &'a [ConnectivityMetadata],
        indices: Option<&Vec<usize>>,
    ) -> Vec<&'a ConnectivityMetadata> {
        indices
            .into_iter()
            .flat_map(|indices| indices.iter().copied())
            .filter_map(|index| endpoints.get(index))
            .collect()
    }

    fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>()
            + connectivity_index_map_bytes(&self.by_instance_name)
            + connectivity_index_map_bytes(&self.by_net_name)
            + connectivity_index_map_bytes(&self.by_pin_name)
            + connectivity_index_map_bytes(&self.by_qualified_pin_name)
    }
}

impl EndpointPinLookup {
    fn from_parts(
        shapes: &[ShapeRecord],
        owners: &[OwnerRef],
        name_index: &OwnerNameIndex,
    ) -> Self {
        let mut lookup = Self::default();
        for shape in shapes {
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            let Some(owner) = owners.get(shape.owner_index as usize) else {
                continue;
            };
            let owner_type = OwnerType::from_raw(owner.owner_type);
            if !matches!(
                owner_type,
                Some(
                    OwnerType::InstanceBBox
                        | OwnerType::InstanceHalo
                        | OwnerType::InstancePinPortShape
                        | OwnerType::IoPinPortShape
                        | OwnerType::PinPortShape
                )
            ) {
                continue;
            }
            let Some(owner_name) = name_index.name_for_owner(owner.owner_type, owner.owner_id)
            else {
                continue;
            };

            match owner_type {
                Some(OwnerType::InstanceBBox | OwnerType::InstanceHalo) => {
                    for name in lookup_name_variants(owner_name) {
                        lookup
                            .instance_paths_by_name
                            .entry(name.to_string())
                            .or_default()
                            .insert(owner.path0);
                    }
                }
                Some(OwnerType::InstancePinPortShape) => {
                    for name in lookup_name_variants(owner_name) {
                        merge_named_rect(&mut lookup.instance_pin_bboxes_by_name, name, shape.bbox);
                        lookup
                            .instance_pin_bboxes_by_path
                            .entry(owner.path0)
                            .or_default()
                            .entry(name.to_string())
                            .and_modify(|current| *current = union_rect(*current, shape.bbox))
                            .or_insert(shape.bbox);
                    }
                }
                Some(OwnerType::IoPinPortShape) => {
                    for name in lookup_name_variants(owner_name) {
                        merge_named_rect(&mut lookup.io_pin_bboxes_by_name, name, shape.bbox);
                    }
                }
                Some(OwnerType::PinPortShape) if owner.path0 == 0 => {
                    for name in lookup_name_variants(owner_name) {
                        merge_named_rect(&mut lookup.io_pin_bboxes_by_name, name, shape.bbox);
                    }
                }
                _ => {}
            }
        }
        lookup
    }

    fn instance_pin_bbox(&self, endpoint: &ConnectivityMetadata) -> Option<Rect32> {
        let mut bbox = None;
        let mut matched_instance = false;
        for instance_name in lookup_name_variants(&endpoint.instance_name) {
            let Some(paths) = self.instance_paths_by_name.get(instance_name) else {
                continue;
            };
            matched_instance = true;
            for path in paths {
                let Some(pin_bboxes) = self.instance_pin_bboxes_by_path.get(path) else {
                    continue;
                };
                for pin_name in lookup_name_variants(&endpoint.pin_name) {
                    if let Some(pin_bbox) = pin_bboxes.get(pin_name) {
                        bbox = Some(match bbox {
                            Some(current) => union_rect(current, *pin_bbox),
                            None => *pin_bbox,
                        });
                    }
                }
            }
        }

        if bbox.is_none() && !matched_instance {
            bbox = self.any_instance_pin_bbox(&endpoint.pin_name);
        }
        bbox
    }

    fn io_pin_bbox(&self, endpoint: &ConnectivityMetadata) -> Option<Rect32> {
        let mut bbox = None;
        for pin_name in lookup_name_variants(&endpoint.pin_name) {
            if let Some(pin_bbox) = self.io_pin_bboxes_by_name.get(pin_name) {
                bbox = Some(match bbox {
                    Some(current) => union_rect(current, *pin_bbox),
                    None => *pin_bbox,
                });
            }
        }
        bbox
    }

    fn any_instance_pin_bbox(&self, pin_name: &str) -> Option<Rect32> {
        let mut bbox = None;
        for name in lookup_name_variants(pin_name) {
            if let Some(pin_bbox) = self.instance_pin_bboxes_by_name.get(name) {
                bbox = Some(match bbox {
                    Some(current) => union_rect(current, *pin_bbox),
                    None => *pin_bbox,
                });
            }
        }
        bbox
    }
}

fn lookup_name_variants(name: &str) -> Vec<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Vec::new();
    }
    if let Some((_, local_name)) = name.rsplit_once('/') {
        let local_name = local_name.trim();
        if !local_name.is_empty() && local_name != name {
            return vec![name, local_name];
        }
    }
    vec![name]
}

fn merge_named_rect(map: &mut BTreeMap<String, Rect32>, name: &str, bbox: Rect32) {
    map.entry(name.to_string())
        .and_modify(|current| *current = union_rect(*current, bbox))
        .or_insert(bbox);
}

fn push_connectivity_index(
    map: &mut BTreeMap<String, Vec<usize>>,
    name: &str,
    endpoint_index: usize,
) {
    if name.is_empty() {
        return;
    }
    map.entry(name.to_string())
        .or_default()
        .push(endpoint_index);
}

/// Groups sorted (name, endpoint_index) pairs into an ordered name index.
/// Sorting by (name, index) keeps each name's endpoint indices ascending in
/// original record order, matching the incremental push-based builder.
fn grouped_connectivity_index<K>(pairs: Vec<(K, usize)>) -> BTreeMap<String, Vec<usize>>
where
    K: Ord + AsRef<str> + Into<String>,
{
    let mut pairs = pairs;
    pairs.sort_unstable();
    // Group into sorted key-value pairs and bulk-collect: BTreeMap builds
    // from a sorted iterator in linear time instead of rebalancing per key.
    let mut grouped = Vec::with_capacity(pairs.len());
    let mut group_start = 0;
    while group_start < pairs.len() {
        let mut group_end = group_start + 1;
        while group_end < pairs.len() && pairs[group_end].0 == pairs[group_start].0 {
            group_end += 1;
        }
        grouped.push((
            pairs[group_start].0.as_ref().to_string(),
            pairs[group_start..group_end]
                .iter()
                .map(|pair| pair.1)
                .collect(),
        ));
        group_start = group_end;
    }
    grouped.into_iter().collect()
}

/// Groups qualified (instance, pin) pairs without formatting every endpoint:
/// pairs are sorted as tuples and the "instance/pin" key is allocated once
/// per unique pair. Pair grouping is equivalent to formatting first because
/// the map is injective, and the BTreeMap keeps keys ordered regardless of
/// insertion order, so the result matches the incremental builder exactly.
fn grouped_qualified_index(pairs: Vec<((&str, &str), usize)>) -> BTreeMap<String, Vec<usize>> {
    let mut pairs = pairs;
    pairs.sort_unstable();
    let mut grouped = Vec::with_capacity(pairs.len());
    let mut group_start = 0;
    while group_start < pairs.len() {
        let mut group_end = group_start + 1;
        while group_end < pairs.len() && pairs[group_end].0 == pairs[group_start].0 {
            group_end += 1;
        }
        grouped.push((
            format!("{}/{}", pairs[group_start].0 .0, pairs[group_start].0 .1),
            pairs[group_start..group_end]
                .iter()
                .map(|pair| pair.1)
                .collect(),
        ));
        group_start = group_end;
    }
    grouped.into_iter().collect()
}

fn connectivity_index_map_bytes(map: &BTreeMap<String, Vec<usize>>) -> usize {
    map.iter()
        .map(|(name, indices)| {
            size_of::<String>()
                + name.capacity()
                + size_of::<Vec<usize>>()
                + indices.capacity() * size_of::<usize>()
        })
        .sum()
}

impl ChipViewIndexMemoryStats {
    fn from_indexes(
        layer_index: &LayerShapeIndex,
        shape_index: &ShapeIdIndex,
        view_index: Option<&ViewTileIndex>,
        name_index: Option<&OwnerNameIndex>,
        net_index: Option<&NetMetadataIndex>,
        connectivity_index: Option<&ConnectivityIndex>,
    ) -> Self {
        let layer_index_bytes = layer_index.estimated_heap_bytes();
        let shape_index_bytes = shape_index.estimated_heap_bytes();
        let view_index_bytes = view_index.map_or(0, ViewTileIndex::estimated_heap_bytes);
        let name_index_bytes = name_index.map_or(0, OwnerNameIndex::estimated_heap_bytes);
        let net_index_bytes = net_index.map_or(0, NetMetadataIndex::estimated_heap_bytes);
        let connectivity_index_bytes =
            connectivity_index.map_or(0, ConnectivityIndex::estimated_heap_bytes);
        Self {
            layer_index_bytes,
            shape_index_bytes,
            view_index_bytes,
            name_index_bytes,
            net_index_bytes,
            connectivity_index_bytes,
            total_bytes: layer_index_bytes
                + shape_index_bytes
                + view_index_bytes
                + name_index_bytes
                + net_index_bytes
                + connectivity_index_bytes,
        }
    }
}

pub fn layer_summaries_from_shapes(shapes: &[ShapeRecord]) -> Vec<LayerSummary> {
    layer_summaries_from_shapes_and_metadata(shapes, &[])
}

pub fn layer_summaries_from_shapes_and_metadata(
    shapes: &[ShapeRecord],
    metadata: &[LayerMetadata],
) -> Vec<LayerSummary> {
    let mut counts = BTreeMap::<u16, usize>::new();
    for shape in shapes {
        if shape.state != ShapeState::Alive as u8 {
            continue;
        }
        *counts.entry(shape.layer_id).or_insert(0) += 1;
    }
    let metadata_by_layer = metadata
        .iter()
        .map(|metadata| (metadata.layer_id, metadata))
        .collect::<BTreeMap<_, _>>();
    let mut summaries = counts
        .into_iter()
        .map(|(layer_id, shape_count)| LayerSummary {
            layer_id,
            shape_count,
            ..layer_summary_defaults(layer_id)
        })
        .collect::<Vec<_>>();
    for summary in &mut summaries {
        if let Some(metadata) = metadata_by_layer.get(&summary.layer_id) {
            summary.order = metadata.order;
            summary.name = metadata.name.clone();
            summary.layer_type = metadata.layer_type.clone();
            summary.direction = metadata.direction.clone();
            summary.width = metadata.width;
            summary.pitch_x = metadata.pitch_x;
            summary.pitch_y = metadata.pitch_y;
            summary.min_spacing = metadata.min_spacing;
            summary.min_area = metadata.min_area;
            summary.min_step = metadata.min_step;
            summary.cut_spacing = metadata.cut_spacing;
            summary.enclosure_below = metadata.enclosure_below.clone();
            summary.enclosure_above = metadata.enclosure_above.clone();
            summary.lef58_rule_count = metadata.lef58_rule_count;
        }
    }
    summaries.sort_by_key(|summary| (summary.order, summary.layer_id));
    summaries
}

/// Builds the physical-layer catalog from the technology metadata exported by
/// IDB.  Geometry contributes only the live-shape count for each catalog
/// entry; it does not decide which physical layers exist.
pub fn layer_catalog_from_metadata_and_shapes(
    metadata: &[LayerMetadata],
    shapes: &[ShapeRecord],
) -> Vec<LayerSummary> {
    let mut counts = BTreeMap::<u16, usize>::new();
    for shape in shapes {
        if shape.state != ShapeState::Alive as u8 {
            continue;
        }
        *counts.entry(shape.layer_id).or_insert(0) += 1;
    }

    layer_catalog_from_counts(metadata, |layer_id| {
        counts.get(&layer_id).copied().unwrap_or(0)
    })
}

fn layer_catalog_from_counts(
    metadata: &[LayerMetadata],
    count: impl Fn(u16) -> usize,
) -> Vec<LayerSummary> {
    let mut catalog = metadata
        .iter()
        .map(|metadata| LayerSummary {
            layer_id: metadata.layer_id,
            shape_count: count(metadata.layer_id),
            order: metadata.order,
            name: metadata.name.clone(),
            layer_type: metadata.layer_type.clone(),
            direction: metadata.direction.clone(),
            width: metadata.width,
            pitch_x: metadata.pitch_x,
            pitch_y: metadata.pitch_y,
            min_spacing: metadata.min_spacing,
            min_area: metadata.min_area,
            min_step: metadata.min_step,
            cut_spacing: metadata.cut_spacing,
            enclosure_below: metadata.enclosure_below.clone(),
            enclosure_above: metadata.enclosure_above.clone(),
            lef58_rule_count: metadata.lef58_rule_count,
        })
        .collect::<Vec<_>>();
    catalog.sort_by_key(|layer| (layer.order, layer.layer_id));
    catalog
}

fn layer_summary_defaults(layer_id: u16) -> LayerSummary {
    LayerSummary {
        layer_id,
        shape_count: 0,
        order: u32::from(layer_id),
        name: format!("L{layer_id}"),
        layer_type: "unknown".to_string(),
        direction: "unknown".to_string(),
        width: 0,
        pitch_x: 0,
        pitch_y: 0,
        min_spacing: 0,
        min_area: 0,
        min_step: 0,
        cut_spacing: 0,
        enclosure_below: String::new(),
        enclosure_above: String::new(),
        lef58_rule_count: 0,
    }
}

pub fn delta_stats_from_records(records: &[GeometryDeltaRecord]) -> DeltaStats {
    let latest = records.iter().max_by_key(|record| record.sequence_id);
    DeltaStats {
        record_count: records.len(),
        latest_sequence_id: latest.map(|record| record.sequence_id),
        latest_command_id: latest.map(|record| record.command_id),
        latest_shape_id: latest.map(|record| record.shape_id),
        latest_old_version: latest.map(|record| record.old_version),
        latest_new_version: latest.map(|record| record.new_version),
    }
}

fn rect_contains_point(rect: Rect32, point: Point32) -> bool {
    point.x >= rect.lx && point.x <= rect.hx && point.y >= rect.ly && point.y <= rect.hy
}

fn rect_distance_squared(rect: Rect32, point: Point32) -> u64 {
    let lx = rect.lx.min(rect.hx);
    let hx = rect.lx.max(rect.hx);
    let ly = rect.ly.min(rect.hy);
    let hy = rect.ly.max(rect.hy);
    let dx = if point.x < lx {
        (lx as i64) - (point.x as i64)
    } else if point.x > hx {
        (point.x as i64) - (hx as i64)
    } else {
        0
    };
    let dy = if point.y < ly {
        (ly as i64) - (point.y as i64)
    } else if point.y > hy {
        (point.y as i64) - (hy as i64)
    } else {
        0
    };

    saturating_square_u64(dx).saturating_add(saturating_square_u64(dy))
}

fn saturating_square_u64(value: i64) -> u64 {
    let value = value.unsigned_abs();
    value.saturating_mul(value)
}

fn is_pickable_shape_kind(kind: u8) -> bool {
    kind == ShapeKind::Rect as u8 || kind == ShapeKind::Line as u8 || kind == ShapeKind::Point as u8
}

pub(crate) fn rect_envelope(rect: Rect32) -> AABB<[i32; 2]> {
    AABB::from_corners(
        [rect.lx.min(rect.hx), rect.ly.min(rect.hy)],
        [rect.lx.max(rect.hx), rect.ly.max(rect.hy)],
    )
}

fn point_bbox(point: Point32) -> Rect32 {
    Rect32 {
        lx: point.x,
        ly: point.y,
        hx: point.x,
        hy: point.y,
    }
}

fn shape_detail_from_parts(
    shape_index: &ShapeIdIndex,
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    shape_id: ShapeId,
) -> Option<ShapeDetail> {
    let shape = *shape_index.find(shapes, shape_id)?;
    let owner = *owners.get(shape.owner_index as usize)?;
    let owner_name = name_index
        .name_for_owner(owner.owner_type, owner.owner_id)
        .map(str::to_string);
    Some(ShapeDetail {
        shape,
        owner,
        owner_name,
        owner_local_name: None,
    })
}

fn shape_geometry_from_payload(shape: &ShapeRecord, payload_bytes: &[u8]) -> ShapeGeometry {
    if shape.kind == ShapeKind::Line as u8 {
        decode_shape_payload::<LinePayload>(shape, payload_bytes)
            .map(ShapeGeometry::Line)
            .unwrap_or(ShapeGeometry::Rect(shape.bbox))
    } else if shape.kind == ShapeKind::Point as u8 {
        decode_shape_payload::<PointPayload>(shape, payload_bytes)
            .map(ShapeGeometry::Point)
            .unwrap_or(ShapeGeometry::Rect(shape.bbox))
    } else if shape.kind == ShapeKind::Rect as u8 {
        decode_shape_payload::<RectPayload>(shape, payload_bytes)
            .map(|payload| ShapeGeometry::Rect(payload.rect))
            .unwrap_or(ShapeGeometry::Rect(shape.bbox))
    } else {
        ShapeGeometry::Rect(shape.bbox)
    }
}

fn decode_shape_payload<T: Pod>(shape: &ShapeRecord, payload_bytes: &[u8]) -> Option<T> {
    let begin = shape.payload_offset as usize;
    let size = shape.payload_size as usize;
    let end = begin.checked_add(size)?;
    if size != size_of::<T>() || end > payload_bytes.len() {
        return None;
    }
    Some(bytemuck::pod_read_unaligned(payload_bytes.get(begin..end)?))
}

fn query_bus_shape_ids_from_parts(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    bus: &BusMetadata,
) -> Vec<ShapeId> {
    let mut shape_ids = BTreeSet::new();
    for name in bus.net_names.iter().chain(bus.pin_names.iter()) {
        collect_named_shape_ids(shapes, owners, name_index, name, &mut shape_ids);
        if let Some((_, pin_name)) = name.rsplit_once('/') {
            collect_named_shape_ids(shapes, owners, name_index, pin_name, &mut shape_ids);
        }
    }
    if shape_ids.is_empty() {
        collect_named_shape_ids(shapes, owners, name_index, &bus.name, &mut shape_ids);
    }
    shape_ids.into_iter().collect()
}

fn query_group_shape_ids_from_parts(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    group: &GroupMetadata,
) -> Vec<ShapeId> {
    let mut shape_ids = BTreeSet::new();
    for instance_name in &group.instance_names {
        collect_named_shape_ids(shapes, owners, name_index, instance_name, &mut shape_ids);
    }
    collect_named_shape_ids(
        shapes,
        owners,
        name_index,
        &group.region_name,
        &mut shape_ids,
    );
    shape_ids.into_iter().collect()
}

#[cfg(test)]
fn query_pin_shape_ids_from_parts(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    endpoints: &[ConnectivityMetadata],
    pin_name: &str,
) -> Vec<ShapeId> {
    let matching_endpoints = endpoints
        .iter()
        .filter(|endpoint| endpoint_matches_pin(endpoint, pin_name))
        .collect::<Vec<_>>();
    query_pin_shape_ids_from_endpoint_refs(
        shapes,
        owners,
        name_index,
        &matching_endpoints,
        pin_name,
    )
}

fn query_pin_shape_ids_from_endpoint_refs(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    endpoints: &[&ConnectivityMetadata],
    pin_name: &str,
) -> Vec<ShapeId> {
    let mut shape_ids = BTreeSet::new();
    for endpoint in endpoints {
        collect_named_shape_ids(
            shapes,
            owners,
            name_index,
            &endpoint.pin_name,
            &mut shape_ids,
        );
        collect_named_shape_ids(
            shapes,
            owners,
            name_index,
            &endpoint.net_name,
            &mut shape_ids,
        );
        if !endpoint.instance_name.is_empty() && !endpoint.pin_name.is_empty() {
            collect_named_shape_ids(
                shapes,
                owners,
                name_index,
                &format!("{}/{}", endpoint.instance_name, endpoint.pin_name),
                &mut shape_ids,
            );
        }
    }
    if shape_ids.is_empty() {
        collect_named_shape_ids(shapes, owners, name_index, pin_name, &mut shape_ids);
        if let Some((_, local_pin_name)) = pin_name.rsplit_once('/') {
            collect_named_shape_ids(shapes, owners, name_index, local_pin_name, &mut shape_ids);
        }
    }
    shape_ids.into_iter().collect()
}

/// Resolves a batch of timing endpoints with one pass for instance extents and
/// one pass for pin-port shapes. Timing paths contain tens of stages, so this
/// avoids repeating the full shape scan performed by single-endpoint queries.
fn resolve_endpoint_pins_from_parts(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    shape_index: &ShapeIdIndex,
    name_index: &OwnerNameIndex,
    requests: &[(&str, &str)],
) -> Vec<EndpointPinGeometry> {
    let mut resolved = vec![EndpointPinGeometry::default(); requests.len()];
    if requests.is_empty() {
        return resolved;
    }

    let mut requests_by_instance = HashMap::<&str, Vec<usize>>::new();
    let mut io_requests_by_pin = HashMap::<&str, Vec<usize>>::new();
    for (index, (instance_name, pin_name)) in requests.iter().enumerate() {
        let instance_name = instance_name.trim();
        let pin_name = pin_name.trim();
        if instance_name.is_empty() {
            if !pin_name.is_empty() {
                io_requests_by_pin.entry(pin_name).or_default().push(index);
            }
        } else {
            requests_by_instance
                .entry(instance_name)
                .or_default()
                .push(index);
        }
    }

    let mut requests_by_path = HashMap::<u32, Vec<usize>>::new();
    for (instance_name, request_indexes) in requests_by_instance {
        for shape_id in name_index.query(shapes, owners, instance_name) {
            let Some(shape) = shape_index.find(shapes, shape_id) else {
                continue;
            };
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            let Some(owner) = owners.get(shape.owner_index as usize) else {
                continue;
            };
            if !matches!(
                OwnerType::from_raw(owner.owner_type),
                Some(OwnerType::InstanceBBox | OwnerType::InstanceHalo)
            ) {
                continue;
            }
            for &request_index in &request_indexes {
                requests_by_path
                    .entry(owner.path0)
                    .or_default()
                    .push(request_index);
                let instance_bbox = resolved[request_index]
                    .instance_bbox
                    .map_or(shape.bbox, |bbox| union_rect(bbox, shape.bbox));
                resolved[request_index].instance_bbox = Some(instance_bbox);
            }
        }
    }
    for request_indexes in requests_by_path.values_mut() {
        request_indexes.sort_unstable();
        request_indexes.dedup();
    }

    for shape in shapes {
        if shape.state != ShapeState::Alive as u8 {
            continue;
        }
        let Some(owner) = owners.get(shape.owner_index as usize) else {
            continue;
        };
        let Some(owner_type) = OwnerType::from_raw(owner.owner_type) else {
            continue;
        };
        let Some(owner_name) = name_index.name_for_owner(owner.owner_type, owner.owner_id) else {
            continue;
        };
        let owner_name = owner_name.trim();

        match owner_type {
            OwnerType::InstancePinPortShape => {
                let Some(request_indexes) = requests_by_path.get(&owner.path0) else {
                    continue;
                };
                for request_index in request_indexes {
                    let (_, pin_name) = requests[*request_index];
                    if !pin_name_matches(pin_name, owner_name) {
                        continue;
                    }
                    let pin_bbox = resolved[*request_index]
                        .pin_bbox
                        .map_or(shape.bbox, |bbox| union_rect(bbox, shape.bbox));
                    resolved[*request_index].pin_bbox = Some(pin_bbox);
                }
            }
            OwnerType::IoPinPortShape | OwnerType::PinPortShape if owner.path0 == 0 => {
                let Some(request_indexes) = io_requests_by_pin.get(owner_name) else {
                    continue;
                };
                for request_index in request_indexes {
                    let (_, pin_name) = requests[*request_index];
                    if !pin_name_matches(pin_name, owner_name) {
                        continue;
                    }
                    let pin_bbox = resolved[*request_index]
                        .pin_bbox
                        .map_or(shape.bbox, |bbox| union_rect(bbox, shape.bbox));
                    resolved[*request_index].pin_bbox = Some(pin_bbox);
                }
            }
            OwnerType::None
            | OwnerType::Die
            | OwnerType::Core
            | OwnerType::Row
            | OwnerType::InstanceBBox
            | OwnerType::InstanceHalo
            | OwnerType::NetWireSegment
            | OwnerType::SpecialWireSegment
            | OwnerType::Via
            | OwnerType::IoPinPortShape
            | OwnerType::PinPortShape
            | OwnerType::Blockage
            | OwnerType::Fill
            | OwnerType::Region
            | OwnerType::Slot
            | OwnerType::TrackGrid
            | OwnerType::GCellGrid
            | OwnerType::Obs => {}
        }
    }

    resolved
}

fn pin_name_matches(requested: &str, owner_name: &str) -> bool {
    let requested = lookup_name_variants(requested);
    let owner_name = lookup_name_variants(owner_name);
    requested.iter().any(|requested_name| {
        owner_name.iter().any(|owner_name| {
            requested_name.eq_ignore_ascii_case(owner_name)
                || requested_name
                    .split_once('[')
                    .is_some_and(|(base, _)| base.eq_ignore_ascii_case(owner_name))
                || owner_name
                    .split_once('[')
                    .is_some_and(|(base, _)| base.eq_ignore_ascii_case(requested_name))
        })
    })
}

fn query_endpoint_pin_shape_ids_from_parts(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    instance_name: &str,
    pin_name: &str,
) -> Vec<ShapeId> {
    if instance_name.is_empty() {
        let mut pin_names = lookup_name_variants(pin_name);
        if let Some((_, local_pin_name)) = pin_name.rsplit_once('/') {
            pin_names.extend(lookup_name_variants(local_pin_name));
        }
        let pin_names = pin_names.into_iter().collect::<BTreeSet<_>>();
        return shapes
            .iter()
            .filter(|shape| shape.state == ShapeState::Alive as u8)
            .filter(|shape| {
                let Some(owner) = owners.get(shape.owner_index as usize) else {
                    return false;
                };
                matches!(
                    OwnerType::from_raw(owner.owner_type),
                    Some(OwnerType::IoPinPortShape | OwnerType::PinPortShape)
                ) && name_index
                    .name_for_owner(owner.owner_type, owner.owner_id)
                    .is_some_and(|name| pin_names.contains(name.trim()))
            })
            .map(|shape| shape.id)
            .collect();
    }

    let instance_names = lookup_name_variants(instance_name)
        .into_iter()
        .collect::<BTreeSet<_>>();
    let instance_paths = shapes
        .iter()
        .filter(|shape| shape.state == ShapeState::Alive as u8)
        .filter_map(|shape| owners.get(shape.owner_index as usize))
        .filter(|owner| {
            matches!(
                OwnerType::from_raw(owner.owner_type),
                Some(OwnerType::InstanceBBox | OwnerType::InstanceHalo)
            ) && name_index
                .name_for_owner(owner.owner_type, owner.owner_id)
                .is_some_and(|name| instance_names.contains(name.trim()))
        })
        .map(|owner| owner.path0)
        .collect::<BTreeSet<_>>();
    if instance_paths.is_empty() {
        return Vec::new();
    }

    let qualified = format!("{instance_name}/{pin_name}");
    let pin_names = lookup_name_variants(&qualified)
        .into_iter()
        .chain(lookup_name_variants(pin_name))
        .collect::<BTreeSet<_>>();
    shapes
        .iter()
        .filter(|shape| shape.state == ShapeState::Alive as u8)
        .filter(|shape| {
            let Some(owner) = owners.get(shape.owner_index as usize) else {
                return false;
            };
            OwnerType::from_raw(owner.owner_type) == Some(OwnerType::InstancePinPortShape)
                && instance_paths.contains(&owner.path0)
                && name_index
                    .name_for_owner(owner.owner_type, owner.owner_id)
                    .is_some_and(|name| pin_names.contains(name.trim()))
        })
        .map(|shape| shape.id)
        .collect()
}

fn endpoint_matches_pin(endpoint: &ConnectivityMetadata, pin_name: &str) -> bool {
    if let Some((instance_name, local_pin_name)) = pin_name.rsplit_once('/') {
        endpoint.instance_name == instance_name && endpoint.pin_name == local_pin_name
    } else {
        endpoint.pin_name == pin_name
    }
}

fn collect_named_shape_ids(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    name: &str,
    shape_ids: &mut BTreeSet<ShapeId>,
) {
    if name.is_empty() {
        return;
    }
    shape_ids.extend(name_index.query(shapes, owners, name));
}

fn unrouted_net_guides_from_parts(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
    net_index: &NetMetadataIndex,
    endpoints: &[ConnectivityMetadata],
) -> Vec<UnroutedNetGuide> {
    let routed_nets = routed_net_names(shapes, owners, name_index);
    let mut endpoints_by_net = BTreeMap::<String, Vec<&ConnectivityMetadata>>::new();
    for endpoint in endpoints {
        if endpoint.net_name.is_empty() {
            continue;
        }
        endpoints_by_net
            .entry(endpoint.net_name.clone())
            .or_default()
            .push(endpoint);
    }

    let mut endpoint_lookup = None::<EndpointPinLookup>;
    let mut guides = Vec::new();
    for (net_name, net_endpoints) in endpoints_by_net {
        if routed_nets.contains(&net_name) {
            continue;
        }

        let lookup = endpoint_lookup
            .get_or_insert_with(|| EndpointPinLookup::from_parts(shapes, owners, name_index));
        let mut pin_bboxes = BTreeMap::<(i32, i32, i32, i32), Rect32>::new();
        for endpoint in &net_endpoints {
            if let Some(bbox) = endpoint_pin_bbox(lookup, endpoint) {
                let normalized = normalize_rect(bbox);
                pin_bboxes.insert(
                    (normalized.lx, normalized.ly, normalized.hx, normalized.hy),
                    normalized,
                );
            }
        }
        if pin_bboxes.len() < 2 {
            continue;
        }

        let pin_centers = pin_bboxes
            .values()
            .map(|bbox| rect_center(*bbox))
            .collect::<Vec<_>>();
        let hub = point_centroid(&pin_centers);
        let bbox = guide_bbox(pin_bboxes.values().copied(), hub);
        let net_kind = net_index
            .kind_for_name(&net_name)
            .or_else(|| {
                net_endpoints
                    .iter()
                    .map(|endpoint| endpoint.net_kind.trim())
                    .find(|kind| !kind.is_empty())
            })
            .unwrap_or("other")
            .to_string();

        guides.push(UnroutedNetGuide {
            net_name,
            net_kind,
            hub,
            pin_centers,
            bbox,
        });
    }
    guides
}

fn routed_net_names(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    name_index: &OwnerNameIndex,
) -> BTreeSet<String> {
    let mut routed = BTreeSet::new();
    let mut seen_owners = HashSet::new();
    for shape in shapes {
        let Some(owner) = owners.get(shape.owner_index as usize) else {
            continue;
        };
        if owner.owner_type != OwnerType::NetWireSegment as u8
            || !seen_owners.insert(owner.owner_id)
        {
            continue;
        }
        if let Some(name) = name_index.name_for_owner(owner.owner_type, owner.owner_id) {
            routed.insert(name.to_string());
        }
    }
    routed
}

fn endpoint_pin_bbox(
    lookup: &EndpointPinLookup,
    endpoint: &ConnectivityMetadata,
) -> Option<Rect32> {
    match endpoint.endpoint_type.trim().to_ascii_lowercase().as_str() {
        "instance" => endpoint_instance_pin_bbox(lookup, endpoint),
        "io" => endpoint_io_pin_bbox(lookup, endpoint),
        _ => endpoint_any_pin_bbox(lookup, endpoint),
    }
}

fn endpoint_instance_pin_bbox(
    lookup: &EndpointPinLookup,
    endpoint: &ConnectivityMetadata,
) -> Option<Rect32> {
    lookup.instance_pin_bbox(endpoint)
}

fn endpoint_io_pin_bbox(
    lookup: &EndpointPinLookup,
    endpoint: &ConnectivityMetadata,
) -> Option<Rect32> {
    lookup.io_pin_bbox(endpoint)
}

fn endpoint_any_pin_bbox(
    lookup: &EndpointPinLookup,
    endpoint: &ConnectivityMetadata,
) -> Option<Rect32> {
    endpoint_instance_pin_bbox(lookup, endpoint).or_else(|| endpoint_io_pin_bbox(lookup, endpoint))
}

fn rect_center(rect: Rect32) -> Point32 {
    let rect = normalize_rect(rect);
    Point32 {
        x: midpoint_i32(rect.lx, rect.hx),
        y: midpoint_i32(rect.ly, rect.hy),
    }
}

fn point_centroid(points: &[Point32]) -> Point32 {
    let count = points.len().max(1) as i64;
    let sum_x = points.iter().map(|point| i64::from(point.x)).sum::<i64>();
    let sum_y = points.iter().map(|point| i64::from(point.y)).sum::<i64>();
    Point32 {
        x: saturating_i64_to_i32(sum_x / count),
        y: saturating_i64_to_i32(sum_y / count),
    }
}

fn guide_bbox(pin_bboxes: impl IntoIterator<Item = Rect32>, hub: Point32) -> Rect32 {
    let mut bbox = Rect32 {
        lx: hub.x,
        ly: hub.y,
        hx: hub.x,
        hy: hub.y,
    };
    for pin_bbox in pin_bboxes {
        bbox = union_rect(bbox, pin_bbox);
    }
    bbox
}

fn midpoint_i32(lhs: i32, rhs: i32) -> i32 {
    saturating_i64_to_i32((i64::from(lhs) + i64::from(rhs)) / 2)
}

fn saturating_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn normalize_rect(rect: Rect32) -> Rect32 {
    Rect32 {
        lx: rect.lx.min(rect.hx),
        ly: rect.ly.min(rect.hy),
        hx: rect.lx.max(rect.hx),
        hy: rect.ly.max(rect.hy),
    }
}

fn union_rect(lhs: Rect32, rhs: Rect32) -> Rect32 {
    Rect32 {
        lx: lhs.lx.min(rhs.lx),
        ly: lhs.ly.min(rhs.ly),
        hx: lhs.hx.max(rhs.hx),
        hy: lhs.hy.max(rhs.hy),
    }
}

#[cfg(test)]
fn filter_shape_ids_by_owner_types(
    shape_ids: Vec<ShapeId>,
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
    owner_types: &[u8],
) -> Vec<ShapeId> {
    shape_ids
        .into_iter()
        .filter(|shape_id| {
            shapes
                .iter()
                .find(|shape| shape.id == *shape_id)
                .and_then(|shape| owners.get(shape.owner_index as usize))
                .is_some_and(|owner| owner_types.contains(&owner.owner_type))
        })
        .collect()
}

impl ChipViewDb {
    pub fn open(manifest_path: impl AsRef<Path>) -> Result<Self> {
        let (db, _timings) = Self::open_internal(manifest_path, false)?;
        Ok(db)
    }

    /// Opens the database with all indexes built concurrently and reports
    /// per-phase timings. This is intended for diagnostics and benchmarks;
    /// normal viewer startup uses [`ChipViewDb::open`] to defer indexes that
    /// are not needed to prepare the initial geometry. Unrouted net guides are
    /// always lazy, so `OpenTimings::net_guides` is zero.
    pub fn open_with_timings(manifest_path: impl AsRef<Path>) -> Result<(Self, OpenTimings)> {
        Self::open_internal(manifest_path, true)
    }

    fn open_internal(
        manifest_path: impl AsRef<Path>,
        build_auxiliary_indexes: bool,
    ) -> Result<(Self, OpenTimings)> {
        let total_start = Instant::now();
        let snapshot_start = Instant::now();
        let snapshot = GeometrySnapshot::open(manifest_path)?;
        let snapshot_open = snapshot_start.elapsed();

        let (optional, layer_index, shape_index) = std::thread::scope(|scope| {
            let connectivity = build_auxiliary_indexes.then(|| {
                scope.spawn(|| {
                    timed(|| ConnectivityIndex::from_endpoints(snapshot.connectivity_metadata()))
                })
            });
            let nets = build_auxiliary_indexes.then(|| {
                scope.spawn(|| timed(|| NetMetadataIndex::from_nets(snapshot.net_metadata())))
            });
            let views = build_auxiliary_indexes.then(|| {
                scope.spawn(|| timed(|| ViewTileIndex::from_tiles(snapshot.view_tile_records())))
            });
            let layers = scope.spawn(|| {
                timed(|| {
                    let index = LayerShapeIndex::from_shapes(snapshot.shapes());
                    if build_auxiliary_indexes {
                        index.prewarm_spatial_indexes(snapshot.shapes());
                    }
                    index
                })
            });
            let shapes = scope.spawn(|| timed(|| ShapeIdIndex::from_shapes(snapshot.shapes())));
            let names =
                build_auxiliary_indexes.then(|| timed(|| OwnerNameIndex::from_snapshot(&snapshot)));
            let optional = (
                connectivity.map(|job| job.join().expect("connectivity index worker panicked")),
                nets.map(|job| job.join().expect("net index worker panicked")),
                views.map(|job| job.join().expect("view index worker panicked")),
                names,
            );
            (
                optional,
                layers.join().expect("layer index worker panicked"),
                shapes.join().expect("shape index worker panicked"),
            )
        });
        let (connectivity, nets, views, names) = optional;
        let (connectivity_index, connectivity_elapsed) =
            connectivity.unwrap_or_else(|| (ConnectivityIndex::default(), Duration::ZERO));
        let (net_index, net_elapsed) =
            nets.unwrap_or_else(|| (NetMetadataIndex::default(), Duration::ZERO));
        let (view_index, view_elapsed) =
            views.unwrap_or_else(|| (ViewTileIndex::default(), Duration::ZERO));
        let (name_index, name_elapsed) =
            names.unwrap_or_else(|| (OwnerNameIndex::default(), Duration::ZERO));
        let (layer_index, layer_elapsed) = layer_index;
        let (shape_index, shape_elapsed) = shape_index;

        let timings = OpenTimings {
            snapshot_open: snapshot_open.as_micros(),
            connectivity_index: connectivity_elapsed.as_micros(),
            net_index: net_elapsed.as_micros(),
            view_index: view_elapsed.as_micros(),
            layer_index: layer_elapsed.as_micros(),
            shape_index: shape_elapsed.as_micros(),
            name_index: name_elapsed.as_micros(),
            net_guides: 0,
            total: total_start.elapsed().as_micros(),
        };
        let db = Self {
            connectivity_index: OnceLock::new(),
            layer_index,
            name_index: OnceLock::new(),
            net_guides: OnceLock::new(),
            net_index: OnceLock::new(),
            shape_index,
            snapshot,
            view_index: OnceLock::new(),
            window_queries: Default::default(),
        };
        if build_auxiliary_indexes {
            let _ = db.connectivity_index.set(connectivity_index);
            let _ = db.net_index.set(net_index);
            let _ = db.view_index.set(view_index);
            let _ = db.name_index.set(name_index);
        }
        Ok((db, timings))
    }

    fn name_index(&self) -> &OwnerNameIndex {
        self.name_index
            .get_or_init(|| OwnerNameIndex::from_snapshot(&self.snapshot))
    }

    fn net_index(&self) -> &NetMetadataIndex {
        self.net_index
            .get_or_init(|| NetMetadataIndex::from_nets(self.snapshot.net_metadata()))
    }

    fn connectivity_index(&self) -> &ConnectivityIndex {
        self.connectivity_index.get_or_init(|| {
            ConnectivityIndex::from_endpoints(self.snapshot.connectivity_metadata())
        })
    }

    fn view_index(&self) -> &ViewTileIndex {
        self.view_index
            .get_or_init(|| ViewTileIndex::from_tiles(self.snapshot.view_tile_records()))
    }

    /// Build the optional indexes used by labels, category classification and
    /// overview tiles on a caller-owned worker thread.
    pub fn prewarm_render_indexes(&self) {
        std::thread::scope(|scope| {
            scope.spawn(|| self.name_index());
            scope.spawn(|| self.net_index());
            scope.spawn(|| self.view_index());
            scope.spawn(|| self.connectivity_index());
        });
    }

    /// Build the spatial query trees after the exact initial scene is visible.
    /// Whole-layer startup queries do not need these indexes.
    pub fn prewarm_spatial_indexes(&self) {
        self.layer_index
            .prewarm_spatial_indexes(self.snapshot.shapes());
    }

    pub fn snapshot(&self) -> &GeometrySnapshot {
        &self.snapshot
    }

    /// Load the optional clock-tree extension lazily when the viewer opens it.
    pub fn clock_tree(&self) -> Result<Option<&chipgeom_reader::ClockTreeSnapshot>> {
        self.snapshot.clock_tree()
    }

    pub fn has_clock_tree_manifest(&self) -> bool {
        self.snapshot.has_clock_tree_manifest()
    }

    pub fn stats(&self) -> SnapshotStats {
        let mut stats = SnapshotStats {
            owner_count: self.snapshot.owners().len(),
            name_count: self.snapshot.name_records().len(),
            site_count: self.snapshot.site_metadata().len(),
            master_count: self.snapshot.master_metadata().len(),
            via_count: self.snapshot.via_metadata().len(),
            grid_count: self.snapshot.grid_metadata().len(),
            connectivity_count: self.snapshot.connectivity_metadata().len(),
            net_count: self.snapshot.net_metadata().len(),
            bus_count: self.snapshot.bus_metadata().len(),
            group_count: self.snapshot.group_metadata().len(),
            ..SnapshotStats::default()
        };

        for shape in self.snapshot.shapes() {
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            stats.shape_count += 1;
            stats
                .bbox
                .as_mut()
                .map(|bbox| bbox.include(shape.bbox))
                .unwrap_or_else(|| stats.bbox = Some(shape.bbox));
            if let Some(owner) = self.snapshot.owners().get(shape.owner_index as usize) {
                *stats.owner_type_counts.entry(owner.owner_type).or_insert(0) += 1;
                if owner.owner_type == OwnerType::Die as u8 {
                    stats
                        .die_bbox
                        .as_mut()
                        .map(|bbox| bbox.include(shape.bbox))
                        .unwrap_or_else(|| stats.die_bbox = Some(shape.bbox));
                }
            }
        }

        stats
    }

    pub fn find_shape(&self, shape_id: ShapeId) -> Option<&ShapeRecord> {
        self.shape_index.find(self.snapshot.shapes(), shape_id)
    }

    pub fn owner_for_shape(&self, shape: &ShapeRecord) -> Option<&OwnerRef> {
        self.snapshot.owners().get(shape.owner_index as usize)
    }

    pub fn shape_geometry(&self, shape: &ShapeRecord) -> ShapeGeometry {
        shape_geometry_from_payload(shape, self.snapshot.payload_bytes())
    }

    pub fn shape_detail(&self, shape_id: ShapeId) -> Option<ShapeDetail> {
        let mut detail = shape_detail_from_parts(
            &self.shape_index,
            self.snapshot.shapes(),
            self.snapshot.owners(),
            self.name_index(),
            shape_id,
        )?;
        detail.owner_local_name = self
            .snapshot
            .name_by_id(detail.owner.name_id)
            .map(str::to_string);
        Some(detail)
    }

    pub fn layer_summaries(&self) -> Vec<LayerSummary> {
        layer_summaries_from_shapes_and_metadata(
            self.snapshot.shapes(),
            self.snapshot.layer_metadata(),
        )
    }

    /// Returns the physical-layer catalog defined by the IDB-derived layer
    /// metadata side file.  Empty or unknown geometry layers are deliberately
    /// excluded so UI controls cannot infer technology from rendered shapes.
    pub fn layer_catalog(&self) -> Vec<LayerSummary> {
        layer_catalog_from_counts(self.snapshot.layer_metadata(), |layer_id| {
            self.layer_index.candidate_count(layer_id)
        })
    }

    pub fn site_metadata(&self) -> &[SiteMetadata] {
        self.snapshot.site_metadata()
    }

    pub fn master_metadata(&self) -> &[MasterMetadata] {
        self.snapshot.master_metadata()
    }

    pub fn via_metadata(&self) -> &[ViaMetadata] {
        self.snapshot.via_metadata()
    }

    pub fn grid_metadata(&self) -> &[GridMetadata] {
        self.snapshot.grid_metadata()
    }

    pub fn connectivity_metadata(&self) -> &[ConnectivityMetadata] {
        self.snapshot.connectivity_metadata()
    }

    pub fn net_metadata(&self) -> &[NetMetadata] {
        self.snapshot.net_metadata()
    }

    pub fn net_kind_for_name(&self, net_name: &str) -> Option<&str> {
        self.net_index().kind_for_name(net_name)
    }

    /// Returns the unrouted-net guides, building them on first access so
    /// `open` does not pay for a structure only some consumers need.
    pub fn unrouted_net_guides(&self) -> &[UnroutedNetGuide] {
        self.net_guides
            .get_or_init(|| self.build_unrouted_net_guides())
            .as_slice()
    }

    /// Returns already-built unrouted-net guides without starting a build.
    /// UI paint paths use this to avoid blocking the first frame on a large
    /// design; [`ChipViewDb::prewarm_unrouted_net_guides`] fills the cache in
    /// the background.
    pub fn try_unrouted_net_guides(&self) -> Option<&[UnroutedNetGuide]> {
        self.net_guides.get().map(Vec::as_slice)
    }

    /// Builds unrouted-net guides for a background prewarm. Safe to call more
    /// than once; only the first completed build is retained.
    pub fn prewarm_unrouted_net_guides(&self) {
        if self.net_guides.get().is_some() {
            return;
        }
        let _ = self.net_guides.set(self.build_unrouted_net_guides());
    }

    fn build_unrouted_net_guides(&self) -> Vec<UnroutedNetGuide> {
        unrouted_net_guides_from_parts(
            self.snapshot.shapes(),
            self.snapshot.owners(),
            self.name_index(),
            self.net_index(),
            self.snapshot.connectivity_metadata(),
        )
    }

    pub fn bus_metadata(&self) -> &[BusMetadata] {
        self.snapshot.bus_metadata()
    }

    pub fn group_metadata(&self) -> &[GroupMetadata] {
        self.snapshot.group_metadata()
    }

    pub fn bus_by_name(&self, name: &str) -> Option<&BusMetadata> {
        self.snapshot
            .bus_metadata()
            .iter()
            .find(|bus| bus.name == name)
    }

    pub fn group_by_name(&self, name: &str) -> Option<&GroupMetadata> {
        self.snapshot
            .group_metadata()
            .iter()
            .find(|group| group.name == name)
    }

    pub fn query_bus_name(&self, name: &str) -> Vec<ShapeId> {
        self.bus_by_name(name)
            .map(|bus| {
                query_bus_shape_ids_from_parts(
                    self.snapshot.shapes(),
                    self.snapshot.owners(),
                    self.name_index(),
                    bus,
                )
            })
            .unwrap_or_default()
    }

    pub fn query_group_name(&self, name: &str) -> Vec<ShapeId> {
        self.group_by_name(name)
            .map(|group| {
                query_group_shape_ids_from_parts(
                    self.snapshot.shapes(),
                    self.snapshot.owners(),
                    self.name_index(),
                    group,
                )
            })
            .unwrap_or_default()
    }

    pub fn query_pin_name(&self, pin_name: &str) -> Vec<ShapeId> {
        let endpoints = self.connectivity_for_pin(pin_name);
        query_pin_shape_ids_from_endpoint_refs(
            self.snapshot.shapes(),
            self.snapshot.owners(),
            self.name_index(),
            &endpoints,
            pin_name,
        )
    }

    pub fn query_endpoint_pin_name(&self, instance_name: &str, pin_name: &str) -> Vec<ShapeId> {
        query_endpoint_pin_shape_ids_from_parts(
            self.snapshot.shapes(),
            self.snapshot.owners(),
            self.name_index(),
            instance_name,
            pin_name,
        )
    }

    /// Resolves instance and pin bounding boxes for a batch of timing
    /// endpoints. The lookup scans shapes twice per batch instead of once per
    /// endpoint, which keeps timing-path overlay resolution bounded.
    pub fn resolve_endpoint_pins(&self, requests: &[(&str, &str)]) -> Vec<EndpointPinGeometry> {
        resolve_endpoint_pins_from_parts(
            self.snapshot.shapes(),
            self.snapshot.owners(),
            &self.shape_index,
            self.name_index(),
            requests,
        )
    }

    pub fn connectivity_for_net(&self, net_name: &str) -> Vec<&ConnectivityMetadata> {
        self.connectivity_index()
            .endpoints_for_net(self.snapshot.connectivity_metadata(), net_name)
    }

    pub fn connectivity_for_pin(&self, pin_name: &str) -> Vec<&ConnectivityMetadata> {
        self.connectivity_index()
            .endpoints_for_pin(self.snapshot.connectivity_metadata(), pin_name)
    }

    pub fn connectivity_for_instance(&self, instance_name: &str) -> Vec<&ConnectivityMetadata> {
        self.connectivity_index()
            .endpoints_for_instance(self.snapshot.connectivity_metadata(), instance_name)
    }

    pub fn site_by_name(&self, name: &str) -> Option<&SiteMetadata> {
        self.snapshot
            .site_metadata()
            .iter()
            .find(|site| site.name == name)
    }

    pub fn master_by_name(&self, name: &str) -> Option<&MasterMetadata> {
        self.snapshot
            .master_metadata()
            .iter()
            .find(|master| master.name == name)
    }

    pub fn query_layer_intersect(&self, layer_id: u16, bbox: Rect32) -> Vec<ShapeId> {
        self.layer_index
            .query_layer_intersect(self.snapshot.shapes(), layer_id, bbox)
    }

    pub fn query_layers_intersect(&self, layer_ids: &[u16], bbox: Rect32) -> Vec<ShapeId> {
        self.layer_index
            .query_layers_intersect(self.snapshot.shapes(), layer_ids, bbox)
    }

    pub fn query_layers_at_point(&self, layer_ids: &[u16], point: Point32) -> Vec<ShapeId> {
        self.query_layers_intersect(layer_ids, point_bbox(point))
    }

    pub fn query_layers_near_point(
        &self,
        layer_ids: &[u16],
        point: Point32,
        radius: i32,
    ) -> Vec<ShapeId> {
        let radius = radius.max(0);
        self.query_layers_intersect(
            layer_ids,
            Rect32 {
                lx: point.x.saturating_sub(radius),
                ly: point.y.saturating_sub(radius),
                hx: point.x.saturating_add(radius),
                hy: point.y.saturating_add(radius),
            },
        )
    }

    pub fn nearest_shape(
        &self,
        layer_ids: &[u16],
        point: Point32,
        max_distance: Option<i32>,
    ) -> Option<NearestShape> {
        self.layer_index
            .nearest_shape(self.snapshot.shapes(), layer_ids, point, max_distance)
    }

    pub fn query_layer_intersect_records(&self, layer_id: u16, bbox: Rect32) -> Vec<&ShapeRecord> {
        self.layer_index
            .query_layer_intersect_indices(self.snapshot.shapes(), layer_id, bbox)
            .into_iter()
            .filter_map(|index| self.snapshot.shapes().get(index))
            .collect()
    }

    pub fn layer_query_candidate_count(&self, layer_id: u16) -> usize {
        self.layer_index.candidate_count(layer_id)
    }

    pub fn layer_viewport_candidate_count(&self, layer_id: u16, bbox: Rect32) -> usize {
        self.layer_index
            .query_candidate_count(self.snapshot.shapes(), layer_id, bbox)
    }

    pub fn view_tile_count(&self) -> usize {
        self.snapshot.view_tile_records().len()
    }

    pub fn memory_stats(&self) -> ChipViewMemoryStats {
        let mapped_bytes = self.snapshot.mapped_bytes();
        let index_bytes = ChipViewIndexMemoryStats::from_indexes(
            &self.layer_index,
            &self.shape_index,
            self.view_index.get(),
            self.name_index.get(),
            self.net_index.get(),
            self.connectivity_index.get(),
        );
        ChipViewMemoryStats {
            mapped_plus_index_bytes: mapped_bytes.total() + index_bytes.total_bytes,
            mapped_bytes,
            index_bytes,
        }
    }

    pub fn delta_stats(&self) -> DeltaStats {
        delta_stats_from_records(self.snapshot.delta_records())
    }

    pub fn query_view_tiles(
        &self,
        lod_level: u8,
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<&GeometryViewTileRecord> {
        self.view_index()
            .query_tiles(self.snapshot.view_tile_records(), lod_level, layer_id, bbox)
    }

    pub fn query_owner_name(&self, name: &str) -> Vec<ShapeId> {
        self.name_index()
            .query(self.snapshot.shapes(), self.snapshot.owners(), name)
    }

    pub fn query_owner_name_pattern(&self, pattern: &Regex) -> Vec<ShapeId> {
        self.name_index()
            .query_pattern(self.snapshot.shapes(), self.snapshot.owners(), pattern)
    }

    pub fn query_owner_shapes(&self, owner_type: OwnerType, owner_id: u64) -> Vec<ShapeId> {
        self.name_index().query_owner(
            self.snapshot.shapes(),
            self.snapshot.owners(),
            owner_type as u8,
            owner_id,
        )
    }

    pub fn query_owner_name_for_owner_types(
        &self,
        name: &str,
        owner_types: &[OwnerType],
    ) -> Vec<ShapeId> {
        let owner_type_values: Vec<u8> = owner_types
            .iter()
            .map(|owner_type| *owner_type as u8)
            .collect();
        self.query_owner_name(name)
            .into_iter()
            .filter(|shape_id| {
                self.find_shape(*shape_id)
                    .and_then(|shape| self.owner_for_shape(shape))
                    .is_some_and(|owner| owner_type_values.contains(&owner.owner_type))
            })
            .collect()
    }

    pub fn query_owner_name_for_owner_types_pattern(
        &self,
        pattern: &Regex,
        owner_types: &[OwnerType],
    ) -> Vec<ShapeId> {
        let owner_type_values: Vec<u8> = owner_types
            .iter()
            .map(|owner_type| *owner_type as u8)
            .collect();
        self.query_owner_name_pattern(pattern)
            .into_iter()
            .filter(|shape_id| {
                self.find_shape(*shape_id)
                    .and_then(|shape| self.owner_for_shape(shape))
                    .is_some_and(|owner| owner_type_values.contains(&owner.owner_type))
            })
            .collect()
    }

    pub fn pick_top_rect(&self, layer_ids: &[u16], point: Point32) -> Option<ShapeId> {
        self.layer_index
            .pick_top_rect(self.snapshot.shapes(), layer_ids, point)
    }

    pub fn pick_top_shape(&self, layer_ids: &[u16], point: Point32) -> Option<ShapeId> {
        self.layer_index
            .pick_top_shape(self.snapshot.shapes(), layer_ids, point)
    }

    pub fn owner_name(&self, owner: &OwnerRef) -> Option<&str> {
        self.name_index()
            .name_for_owner(owner.owner_type, owner.owner_id)
    }

    pub fn owner_local_name(&self, owner: &OwnerRef) -> Option<&str> {
        self.snapshot.name_by_id(owner.name_id)
    }

    pub fn owner_type_label(owner_type: u8) -> &'static str {
        match OwnerType::from_raw(owner_type) {
            Some(OwnerType::Die) => "die",
            Some(OwnerType::Core) => "core",
            Some(OwnerType::Row) => "row",
            Some(OwnerType::InstanceBBox) => "instance_bbox",
            Some(OwnerType::InstanceHalo) => "instance_halo",
            Some(OwnerType::NetWireSegment) => "net_wire_segment",
            Some(OwnerType::SpecialWireSegment) => "special_wire_segment",
            Some(OwnerType::Via) => "via",
            Some(OwnerType::PinPortShape) => "pin_port_shape",
            Some(OwnerType::InstancePinPortShape) => "instance_pin_port_shape",
            Some(OwnerType::IoPinPortShape) => "io_pin_port_shape",
            Some(OwnerType::Blockage) => "blockage",
            Some(OwnerType::Fill) => "fill",
            Some(OwnerType::Region) => "region",
            Some(OwnerType::Slot) => "slot",
            Some(OwnerType::TrackGrid) => "track_grid",
            Some(OwnerType::GCellGrid) => "gcell_grid",
            Some(OwnerType::Obs) => "obs",
            _ => "other",
        }
    }
}

#[cfg(test)]
#[path = "layer_query_tests.rs"]
mod layer_query_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use chipgeom_format::{
        GeometryFileHeader, GeometryFileKind, GeometryMetaRecord, GeometryNameRecord,
        GeometrySidMapRecord, GeometryViewTileRecord, Rect32, ShapeKind, ShapeState,
        GEOMETRY_FILE_HEADER_SIZE, GEOMETRY_FILE_MAGIC, GEOMETRY_SCHEMA_VERSION,
    };
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_open_fixture() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("chip-view-db-open-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let owner = OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 7,
            ..OwnerRef::default()
        };
        let deleted_owner = OwnerRef {
            owner_type: OwnerType::Die as u8,
            owner_id: 8,
            ..OwnerRef::default()
        };
        let shape = ShapeRecord {
            id: 1,
            layer_id: 1,
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Alive as u8,
            owner_index: 0,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
            ..ShapeRecord::default()
        };
        let deleted_shape = ShapeRecord {
            id: 2,
            layer_id: 2,
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Deleted as u8,
            owner_index: 1,
            bbox: Rect32 {
                lx: 1_000,
                ly: 2_000,
                hx: 3_000,
                hy: 4_000,
            },
            ..ShapeRecord::default()
        };
        let shapes = [shape, deleted_shape];
        let owners = [owner, deleted_owner];
        let owner_name = b"netA";
        let name_record = GeometryNameRecord {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 7,
            name_size: owner_name.len() as u32,
            ..GeometryNameRecord::default()
        };
        let meta = GeometryMetaRecord {
            shape_count: shapes.len() as u64,
            owner_count: owners.len() as u64,
            next_shape_id: 3,
            name_record_count: 1,
            name_payload_size: owner_name.len() as u64,
            ..GeometryMetaRecord::default()
        };
        let write_file = |name: &str, kind: GeometryFileKind, record_size: u32, bytes: &[u8]| {
            let header = GeometryFileHeader {
                magic: GEOMETRY_FILE_MAGIC,
                schema_version: GEOMETRY_SCHEMA_VERSION,
                header_size: GEOMETRY_FILE_HEADER_SIZE as u32,
                file_kind: kind as u16,
                record_size,
                record_count: if record_size == 0 {
                    0
                } else {
                    bytes.len() as u64 / u64::from(record_size)
                },
                payload_size: bytes.len() as u64,
                ..GeometryFileHeader::default()
            };
            let mut file = File::create(directory.join(name)).unwrap();
            file.write_all(bytemuck::bytes_of(&header)).unwrap();
            file.write_all(bytes).unwrap();
        };
        write_file(
            "geometry.meta.bin",
            GeometryFileKind::Meta,
            size_of::<GeometryMetaRecord>() as u32,
            bytemuck::bytes_of(&meta),
        );
        write_file(
            "geometry.shapes.bin",
            GeometryFileKind::Shapes,
            size_of::<ShapeRecord>() as u32,
            bytemuck::cast_slice(&shapes),
        );
        write_file(
            "geometry.owners.bin",
            GeometryFileKind::Owners,
            size_of::<OwnerRef>() as u32,
            bytemuck::cast_slice(&owners),
        );
        write_file("geometry.payload.bin", GeometryFileKind::Payload, 1, &[]);
        write_file("geometry.names.bin", GeometryFileKind::Names, 1, owner_name);
        write_file(
            "geometry.name_index.bin",
            GeometryFileKind::NameIndex,
            size_of::<GeometryNameRecord>() as u32,
            bytemuck::bytes_of(&name_record),
        );
        write_file(
            "geometry.sidmap.bin",
            GeometryFileKind::SidMap,
            size_of::<GeometrySidMapRecord>() as u32,
            bytemuck::cast_slice(&[
                GeometrySidMapRecord { shape_id: 1, owner },
                GeometrySidMapRecord {
                    shape_id: 2,
                    owner: deleted_owner,
                },
            ]),
        );
        write_file(
            "geometry.view.bin",
            GeometryFileKind::View,
            size_of::<GeometryViewTileRecord>() as u32,
            bytemuck::bytes_of(&GeometryViewTileRecord {
                layer_id: 1,
                shape_count: 1,
                bbox: shape.bbox,
                ..GeometryViewTileRecord::default()
            }),
        );
        let manifest = directory.join("geometry.manifest");
        std::fs::write(
            &manifest,
            "schema_version=1\nshape_count=2\nowner_count=2\npayload_size=0\n\
             meta=geometry.meta.bin\nshapes=geometry.shapes.bin\nowners=geometry.owners.bin\n\
             payload=geometry.payload.bin\nnames=geometry.names.bin\n\
             name_index=geometry.name_index.bin\nsidmap=geometry.sidmap.bin\n\
             view=geometry.view.bin\n",
        )
        .unwrap();
        manifest
    }

    fn shape(id: ShapeId, layer_id: u16) -> ShapeRecord {
        ShapeRecord {
            id,
            layer_id,
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Alive as u8,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
            ..ShapeRecord::default()
        }
    }

    #[test]
    fn normal_open_defers_auxiliary_indexes_until_a_consumer_requests_them() {
        let manifest = write_open_fixture();
        let directory = manifest.parent().unwrap().to_path_buf();
        let db = ChipViewDb::open(&manifest).unwrap();

        assert!(db.name_index.get().is_none());
        assert!(db.net_index.get().is_none());
        assert!(db.connectivity_index.get().is_none());
        assert!(db.view_index.get().is_none());
        let memory = db.memory_stats();
        assert_eq!(memory.index_bytes.name_index_bytes, 0);
        assert_eq!(memory.index_bytes.connectivity_index_bytes, 0);
        assert_eq!(memory.index_bytes.view_index_bytes, 0);

        let layer_indices = Arc::clone(db.layer_index.by_layer.get(&1).unwrap());
        let viewport = db.stats().bbox.unwrap();
        let queried_indices = db.query_cached_layer_record_indices(1, viewport);
        assert!(Arc::ptr_eq(&layer_indices, &queried_indices));
        assert_eq!(queried_indices.as_ref(), &[0]);
        assert_eq!(db.query_cached_layer_intersect(1, viewport), vec![1]);

        let owner = db.owner_for_shape(db.find_shape(1).unwrap()).unwrap();
        assert_eq!(db.owner_name(owner), Some("netA"));
        assert_eq!(db.query_owner_name("netA"), vec![1]);
        assert!(db.name_index.get().is_some());
        assert!(db.connectivity_for_net("netA").is_empty());
        assert!(db.connectivity_index.get().is_some());
        assert_eq!(db.query_view_tiles(0, 1, Rect32::default()).len(), 1);
        assert!(db.view_index.get().is_some());
        assert_eq!(db.net_kind_for_name("netA"), None);
        assert!(db.net_index.get().is_some());

        drop(db);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stats_ignore_deleted_shapes_for_shape_derived_values() {
        let manifest = write_open_fixture();
        let directory = manifest.parent().unwrap().to_path_buf();
        let db = ChipViewDb::open(&manifest).unwrap();

        let stats = db.stats();

        assert_eq!(stats.shape_count, 1);
        assert_eq!(
            stats.bbox,
            Some(Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            })
        );
        assert_eq!(stats.die_bbox, None);
        assert_eq!(
            stats.owner_type_counts,
            BTreeMap::from([(OwnerType::NetWireSegment as u8, 1)])
        );

        drop(db);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn layer_summaries_are_sorted_and_count_alive_shapes() {
        let summaries = layer_summaries_from_shapes(&[
            shape(1, 3),
            shape(2, 1),
            shape(3, 3),
            ShapeRecord {
                state: ShapeState::Deleted as u8,
                ..shape(4, 2)
            },
        ]);

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].layer_id, 1);
        assert_eq!(summaries[0].shape_count, 1);
        assert_eq!(summaries[1].layer_id, 3);
        assert_eq!(summaries[1].shape_count, 2);
    }

    #[test]
    fn layer_summaries_merge_metadata_when_available() {
        let summaries = layer_summaries_from_shapes_and_metadata(
            &[shape(1, 3), shape(2, 1), shape(3, 3)],
            &[
                chipgeom_reader::LayerMetadata {
                    layer_id: 3,
                    order: 9,
                    name: "M3".to_string(),
                    layer_type: "routing".to_string(),
                    direction: "vertical".to_string(),
                    width: 120,
                    pitch_x: 240,
                    pitch_y: 480,
                    min_spacing: 70,
                    min_area: 400,
                    min_step: 50,
                    lef58_rule_count: 5,
                    ..chipgeom_reader::LayerMetadata::default()
                },
                chipgeom_reader::LayerMetadata {
                    layer_id: 7,
                    order: 11,
                    name: "M7".to_string(),
                    layer_type: "routing".to_string(),
                    direction: "horizontal".to_string(),
                    width: 220,
                    pitch_x: 440,
                    pitch_y: 880,
                    min_spacing: 80,
                    min_area: 500,
                    min_step: 60,
                    lef58_rule_count: 6,
                    ..chipgeom_reader::LayerMetadata::default()
                },
            ],
        );

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].layer_id, 1);
        assert_eq!(summaries[0].name, "L1");
        assert_eq!(summaries[0].layer_type, "unknown");
        assert_eq!(summaries[1].layer_id, 3);
        assert_eq!(summaries[1].name, "M3");
        assert_eq!(summaries[1].layer_type, "routing");
        assert_eq!(summaries[1].direction, "vertical");
        assert_eq!(summaries[1].order, 9);
        assert_eq!(summaries[1].width, 120);
        assert_eq!(summaries[1].pitch_x, 240);
        assert_eq!(summaries[1].pitch_y, 480);
        assert_eq!(summaries[1].min_spacing, 70);
        assert_eq!(summaries[1].min_area, 400);
        assert_eq!(summaries[1].min_step, 50);
        assert_eq!(summaries[1].lef58_rule_count, 5);
    }

    #[test]
    fn layer_catalog_uses_idb_metadata_even_without_geometry() {
        let catalog = layer_catalog_from_metadata_and_shapes(
            &[
                chipgeom_reader::LayerMetadata {
                    layer_id: 3,
                    order: 9,
                    name: "M3".to_string(),
                    layer_type: "routing".to_string(),
                    ..chipgeom_reader::LayerMetadata::default()
                },
                chipgeom_reader::LayerMetadata {
                    layer_id: 7,
                    order: 11,
                    name: "V7".to_string(),
                    layer_type: "cut".to_string(),
                    ..chipgeom_reader::LayerMetadata::default()
                },
            ],
            &[shape(1, 3), shape(2, 1)],
        );

        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog[0].layer_id, 3);
        assert_eq!(catalog[0].shape_count, 1);
        assert_eq!(catalog[1].layer_id, 7);
        assert_eq!(catalog[1].shape_count, 0);
        assert!(catalog.iter().all(|layer| layer.layer_id != 1));
    }

    #[test]
    fn indexed_layer_catalog_matches_shape_scan() {
        let metadata = [chipgeom_reader::LayerMetadata {
            layer_id: 3,
            name: "M3".to_string(),
            ..chipgeom_reader::LayerMetadata::default()
        }];
        let shapes = [
            shape(1, 3),
            shape(2, 3),
            ShapeRecord {
                state: ShapeState::Deleted as u8,
                ..shape(3, 3)
            },
            shape(4, 8),
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);

        assert_eq!(
            layer_catalog_from_counts(&metadata, |layer_id| index.candidate_count(layer_id)),
            layer_catalog_from_metadata_and_shapes(&metadata, &shapes),
        );
    }

    #[test]
    fn owner_local_info_parses_key_value_tokens() {
        let info = OwnerLocalInfo::parse(
            "via:VIA12 master:VIA12 type:fixed bottom:M1 cut:VIA12 top:M2 rowcol:1x2",
        )
        .unwrap();

        assert_eq!(info.kind, "via");
        assert_eq!(info.field("via"), Some("VIA12"));
        assert_eq!(info.field("master"), Some("VIA12"));
        assert_eq!(info.field("type"), Some("fixed"));
        assert_eq!(info.field("bottom"), Some("M1"));
        assert_eq!(info.field("cut"), Some("VIA12"));
        assert_eq!(info.field("top"), Some("M2"));
        assert_eq!(info.field("rowcol"), Some("1x2"));
        assert_eq!(info.field("missing"), None);
    }

    #[test]
    fn owner_local_info_ignores_unstructured_local_name() {
        assert!(OwnerLocalInfo::parse("").is_none());
        assert!(OwnerLocalInfo::parse("plain_name_without_fields").is_none());
    }

    #[test]
    fn layer_shape_index_queries_only_requested_layer() {
        let shapes = [
            shape(1, 7),
            ShapeRecord {
                bbox: Rect32 {
                    lx: 100,
                    ly: 100,
                    hx: 120,
                    hy: 120,
                },
                ..shape(2, 7)
            },
            shape(3, 8),
            ShapeRecord {
                state: ShapeState::Deleted as u8,
                ..shape(4, 7)
            },
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);

        let hits = index.query_layer_intersect(
            &shapes,
            7,
            Rect32 {
                lx: 5,
                ly: 5,
                hx: 15,
                hy: 15,
            },
        );

        assert_eq!(index.candidate_count(7), 2);
        assert_eq!(index.candidate_count(8), 1);
        assert_eq!(hits, vec![1]);
    }

    #[test]
    fn layer_shape_index_uses_spatial_candidates_for_viewport_queries() {
        let mut shapes = Vec::new();
        for id in 1..=200 {
            shapes.push(ShapeRecord {
                bbox: Rect32 {
                    lx: id * 1000,
                    ly: id * 1000,
                    hx: id * 1000 + 10,
                    hy: id * 1000 + 10,
                },
                ..shape(id as ShapeId, 4)
            });
        }
        shapes.push(ShapeRecord {
            bbox: Rect32 {
                lx: 5,
                ly: 5,
                hx: 15,
                hy: 15,
            },
            ..shape(999, 4)
        });
        let index = LayerShapeIndex::from_shapes(&shapes);

        let bbox = Rect32 {
            lx: 0,
            ly: 0,
            hx: 20,
            hy: 20,
        };

        assert_eq!(index.query_layer_intersect(&shapes, 4, bbox), vec![999]);
        assert!(index.spatial_candidate_count(&shapes, 4, bbox) < index.candidate_count(4));
    }

    #[test]
    fn layer_shape_index_reports_viewport_candidate_count_from_spatial_index() {
        let mut shapes = Vec::new();
        for id in 1..=40 {
            shapes.push(ShapeRecord {
                bbox: Rect32 {
                    lx: id * 500,
                    ly: id * 500,
                    hx: id * 500 + 10,
                    hy: id * 500 + 10,
                },
                ..shape(id as ShapeId, 3)
            });
        }
        shapes.push(ShapeRecord {
            bbox: Rect32 {
                lx: 10,
                ly: 10,
                hx: 20,
                hy: 20,
            },
            ..shape(99, 3)
        });
        let index = LayerShapeIndex::from_shapes(&shapes);
        let viewport = Rect32 {
            lx: 0,
            ly: 0,
            hx: 30,
            hy: 30,
        };

        assert_eq!(index.query_candidate_count(&shapes, 3, viewport), 1);
        assert!(index.query_candidate_count(&shapes, 3, viewport) < index.candidate_count(3));
    }

    #[test]
    fn whole_layer_queries_do_not_build_spatial_trees_until_a_partial_view_needs_them() {
        let shapes = [
            shape(1, 4),
            ShapeRecord {
                bbox: Rect32 {
                    lx: 100,
                    ly: 100,
                    hx: 110,
                    hy: 110,
                },
                ..shape(2, 4)
            },
            shape(3, 7),
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);
        let whole_layer = Rect32 {
            lx: -1,
            ly: -1,
            hx: 111,
            hy: 111,
        };
        let partial = Rect32 {
            lx: 5,
            ly: 5,
            hx: 15,
            hy: 15,
        };

        assert_eq!(index.initialized_spatial_tree_count(), 0);
        assert_eq!(
            index.query_layers_intersect(&shapes, &[4], whole_layer),
            vec![1, 2]
        );
        assert_eq!(index.initialized_spatial_tree_count(), 0);
        assert_eq!(index.query_layer_intersect(&shapes, 4, partial), vec![1]);
        assert_eq!(index.initialized_spatial_tree_count(), 1);
    }

    #[test]
    fn query_layers_intersect_returns_only_requested_layers() {
        let shapes = [
            shape(1, 1),
            ShapeRecord {
                bbox: Rect32 {
                    lx: 100,
                    ly: 100,
                    hx: 120,
                    hy: 120,
                },
                ..shape(2, 1)
            },
            shape(3, 2),
            shape(4, 3),
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);

        let hits = index.query_layers_intersect(
            &shapes,
            &[3, 1],
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 20,
                hy: 20,
            },
        );

        assert_eq!(hits, vec![4, 1]);
    }

    #[test]
    fn query_layers_intersect_keeps_layer_then_shape_id_stable_order() {
        let shapes = [
            ShapeRecord {
                layer_id: 2,
                ..shape(30, 2)
            },
            ShapeRecord {
                layer_id: 1,
                ..shape(20, 1)
            },
            ShapeRecord {
                layer_id: 2,
                ..shape(10, 2)
            },
            ShapeRecord {
                layer_id: 1,
                ..shape(40, 1)
            },
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);

        assert_eq!(
            index.query_layers_intersect(
                &shapes,
                &[2, 1],
                Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 20,
                    hy: 20,
                },
            ),
            vec![10, 30, 20, 40]
        );
    }

    #[test]
    fn layer_shape_index_finds_nearest_shape_by_bbox_distance() {
        let shapes = [
            ShapeRecord {
                bbox: Rect32 {
                    lx: 100,
                    ly: 100,
                    hx: 120,
                    hy: 120,
                },
                ..shape(10, 1)
            },
            ShapeRecord {
                bbox: Rect32 {
                    lx: 20,
                    ly: 20,
                    hx: 30,
                    hy: 30,
                },
                ..shape(20, 1)
            },
            ShapeRecord {
                bbox: Rect32 {
                    lx: 12,
                    ly: 12,
                    hx: 14,
                    hy: 14,
                },
                state: ShapeState::Deleted as u8,
                ..shape(30, 1)
            },
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);

        assert_eq!(
            index.nearest_shape(&shapes, &[1], Point32 { x: 0, y: 0 }, None),
            Some(NearestShape {
                shape_id: 20,
                distance_squared: 800,
            })
        );
        assert_eq!(
            index.nearest_shape(&shapes, &[1], Point32 { x: 0, y: 0 }, Some(15)),
            None
        );
        assert_eq!(
            index.nearest_shape(&shapes, &[1], Point32 { x: 21, y: 22 }, Some(1)),
            Some(NearestShape {
                shape_id: 20,
                distance_squared: 0,
            })
        );
    }

    #[test]
    fn layer_shape_index_picks_top_non_rect_shape_by_bbox() {
        let shapes = [
            ShapeRecord {
                kind: ShapeKind::Line as u8,
                bbox: Rect32 {
                    lx: 0,
                    ly: 5,
                    hx: 20,
                    hy: 5,
                },
                ..shape(10, 3)
            },
            ShapeRecord {
                kind: ShapeKind::Point as u8,
                bbox: Rect32 {
                    lx: 25,
                    ly: 5,
                    hx: 25,
                    hy: 5,
                },
                ..shape(20, 3)
            },
            ShapeRecord {
                kind: ShapeKind::Rect as u8,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..shape(30, 3)
            },
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);

        assert_eq!(
            index.pick_top_shape(&shapes, &[3], Point32 { x: 5, y: 5 }),
            Some(30)
        );
        assert_eq!(
            index.pick_top_shape(&shapes, &[3], Point32 { x: 15, y: 5 }),
            Some(10)
        );
        assert_eq!(
            index.pick_top_shape(&shapes, &[3], Point32 { x: 25, y: 5 }),
            Some(20)
        );
        assert_eq!(
            index.pick_top_rect(&shapes, &[3], Point32 { x: 25, y: 5 }),
            None
        );
    }

    #[test]
    fn shape_id_index_finds_records_by_id() {
        let shapes = [shape(40, 7), shape(10, 7), shape(25, 8)];
        let index = ShapeIdIndex::from_shapes(&shapes);

        assert_eq!(index.find(&shapes, 10).map(|shape| shape.id), Some(10));
        assert_eq!(index.find(&shapes, 25).map(|shape| shape.layer_id), Some(8));
        assert!(index.find(&shapes, 999).is_none());
        assert_eq!(index.dense_base, None);
        assert_eq!(index.by_id.len(), shapes.len());
    }

    #[test]
    fn shape_id_index_uses_direct_lookup_for_contiguous_ids() {
        let shapes = [shape(100, 7), shape(101, 7), shape(102, 8)];
        let index = ShapeIdIndex::from_shapes(&shapes);

        assert_eq!(index.dense_base, Some(100));
        assert!(index.by_id.is_empty());
        assert_eq!(
            index.find(&shapes, 100).map(|shape| shape.layer_id),
            Some(7)
        );
        assert_eq!(
            index.find(&shapes, 102).map(|shape| shape.layer_id),
            Some(8)
        );
        assert!(index.find(&shapes, 99).is_none());
        assert!(index.find(&shapes, 103).is_none());
    }

    #[test]
    fn shape_geometry_decodes_line_payload_when_size_matches() {
        let payload = LinePayload {
            begin: Point32 { x: 1, y: 2 },
            end: Point32 { x: 30, y: 40 },
            width: 5,
            flags: 7,
        };
        let mut payload_bytes = vec![0xaa, 0xbb, 0xcc, 0xdd];
        payload_bytes.extend_from_slice(bytemuck::bytes_of(&payload));
        let shape = ShapeRecord {
            kind: ShapeKind::Line as u8,
            payload_offset: 4,
            payload_size: size_of::<LinePayload>() as u32,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
            ..shape(1, 1)
        };

        assert_eq!(
            shape_geometry_from_payload(&shape, &payload_bytes),
            ShapeGeometry::Line(payload)
        );
    }

    #[test]
    fn shape_geometry_decodes_point_payload_when_size_matches() {
        let payload = PointPayload {
            point: Point32 { x: 11, y: 22 },
            symbol_id: 3,
            flags: 4,
        };
        let mut payload_bytes = vec![0xaa, 0xbb];
        payload_bytes.extend_from_slice(bytemuck::bytes_of(&payload));
        let shape = ShapeRecord {
            kind: ShapeKind::Point as u8,
            payload_offset: 2,
            payload_size: size_of::<PointPayload>() as u32,
            ..shape(2, 1)
        };

        assert_eq!(
            shape_geometry_from_payload(&shape, &payload_bytes),
            ShapeGeometry::Point(payload)
        );
    }

    #[test]
    fn shape_geometry_falls_back_to_bbox_for_missing_or_bad_payload() {
        let bbox = Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        };
        let bad_size = ShapeRecord {
            kind: ShapeKind::Line as u8,
            payload_offset: 0,
            payload_size: 3,
            bbox,
            ..shape(3, 1)
        };
        let bad_offset = ShapeRecord {
            kind: ShapeKind::Point as u8,
            payload_offset: 100,
            payload_size: size_of::<PointPayload>() as u32,
            bbox,
            ..shape(4, 1)
        };

        assert_eq!(
            shape_geometry_from_payload(&bad_size, &[1, 2, 3]),
            ShapeGeometry::Rect(bbox)
        );
        assert_eq!(
            shape_geometry_from_payload(&bad_offset, &[1, 2, 3]),
            ShapeGeometry::Rect(bbox)
        );
    }

    #[test]
    fn owner_type_label_includes_instance_halo() {
        assert_eq!(
            ChipViewDb::owner_type_label(OwnerType::InstanceHalo as u8),
            "instance_halo"
        );
    }

    #[test]
    fn owner_type_label_includes_via_overlays_and_obs() {
        assert_eq!(ChipViewDb::owner_type_label(OwnerType::Via as u8), "via");
        assert_eq!(
            ChipViewDb::owner_type_label(OwnerType::TrackGrid as u8),
            "track_grid"
        );
        assert_eq!(
            ChipViewDb::owner_type_label(OwnerType::GCellGrid as u8),
            "gcell_grid"
        );
        assert_eq!(ChipViewDb::owner_type_label(OwnerType::Obs as u8), "obs");
        assert_eq!(
            ChipViewDb::owner_type_label(OwnerType::InstancePinPortShape as u8),
            "instance_pin_port_shape"
        );
        assert_eq!(
            ChipViewDb::owner_type_label(OwnerType::IoPinPortShape as u8),
            "io_pin_port_shape"
        );
    }

    #[test]
    fn view_tile_index_queries_requested_lod_and_layer() {
        let tiles = [
            GeometryViewTileRecord {
                lod_level: 2,
                layer_id: 4,
                shape_count: 10,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 100,
                    hy: 100,
                },
                ..GeometryViewTileRecord::default()
            },
            GeometryViewTileRecord {
                lod_level: 1,
                layer_id: 4,
                shape_count: 10,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 100,
                    hy: 100,
                },
                ..GeometryViewTileRecord::default()
            },
            GeometryViewTileRecord {
                lod_level: 2,
                layer_id: 5,
                shape_count: 10,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 100,
                    hy: 100,
                },
                ..GeometryViewTileRecord::default()
            },
        ];
        let index = ViewTileIndex::from_tiles(&tiles);

        let hits = index.query_tiles(
            &tiles,
            2,
            4,
            Rect32 {
                lx: 50,
                ly: 50,
                hx: 60,
                hy: 60,
            },
        );

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].lod_level, 2);
        assert_eq!(hits[0].layer_id, 4);
    }

    #[test]
    fn owner_name_index_returns_alive_shape_ids_for_named_owner() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 1)
            },
            ShapeRecord {
                owner_index: 0,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(3, 1)
            },
            ShapeRecord {
                owner_index: 0,
                state: ShapeState::Deleted as u8,
                ..shape(4, 1)
            },
        ];
        let index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (
                    OwnerType::NetWireSegment as u8,
                    10,
                    "synthetic_clk".to_string(),
                ),
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
            ],
        );

        assert_eq!(index.query(&shapes, &owners, "synthetic_clk"), vec![1, 2]);
        assert_eq!(index.query(&shapes, &owners, "u0"), vec![3]);
        assert!(index.query(&shapes, &owners, "missing").is_empty());
    }

    #[test]
    fn bounded_pattern_search_limits_results_and_supports_cancellation() {
        let manifest = write_open_fixture();
        let db = ChipViewDb::open(&manifest).unwrap();
        let pattern = Regex::new("^net").unwrap();
        let query = |owner_types, limit| {
            db.query_owner_name_pattern_bounded(&pattern, owner_types, limit, || true)
                .unwrap()
        };
        let expected = BoundedShapeSearch {
            shape_ids: vec![1],
            truncated: false,
        };
        assert_eq!(query(Some(&[OwnerType::NetWireSegment]), 1), expected);
        assert_eq!(
            query(Some(&[OwnerType::InstanceBBox]), 1),
            BoundedShapeSearch::default()
        );
        assert_eq!(
            query(None, 0),
            BoundedShapeSearch {
                shape_ids: Vec::new(),
                truncated: true,
            }
        );
        let checks = std::cell::Cell::new(0);
        assert!(db
            .query_owner_name_pattern_bounded(&pattern, None, 1, || {
                checks.set(checks.get() + 1);
                checks.get() == 1
            })
            .is_none());
        assert!(db.name_index.get().is_none());
        assert_eq!(db.query_owner_name("netA"), vec![1]);
        assert_eq!(query(None, 1), expected);
        drop(db);
        std::fs::remove_dir_all(manifest.parent().unwrap()).unwrap();
    }

    #[test]
    fn owner_name_index_ignores_local_names_and_keeps_owner_aliases() {
        let owners = [OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 10,
            ..OwnerRef::default()
        }];
        let shapes = [ShapeRecord {
            owner_index: 0,
            ..shape(1, 1)
        }];
        let index = OwnerNameIndex::from_names([
            (OwnerType::None as u8, 0, "via:VIA12"),
            (OwnerType::NetWireSegment as u8, 10, "clk"),
            (OwnerType::NetWireSegment as u8, 10, "clock"),
            (OwnerType::NetWireSegment as u8, 10, "clock"),
        ]);

        assert!(index.name_for_owner(OwnerType::None as u8, 0).is_none());
        assert!(index.query(&shapes, &owners, "via:VIA12").is_empty());
        assert_eq!(index.query(&shapes, &owners, "clk"), vec![1]);
        assert_eq!(index.query(&shapes, &owners, "clock"), vec![1]);
        assert_eq!(
            index.query_owner(&shapes, &owners, OwnerType::NetWireSegment as u8, 10),
            vec![1]
        );
    }

    #[test]
    fn owner_name_search_index_is_built_on_demand() {
        let owners = [OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 10,
            ..OwnerRef::default()
        }];
        let shapes = [ShapeRecord {
            owner_index: 0,
            ..shape(1, 1)
        }];
        let index =
            OwnerNameIndex::from_names([(OwnerType::NetWireSegment as u8, 10, "clk".to_string())]);

        assert!(index.owner_shapes.get().is_none());
        assert_eq!(index.query(&shapes, &owners, "clk"), vec![1]);
        assert!(index.owner_shapes.get().is_some());
    }

    #[test]
    fn owner_shape_index_returns_alive_shape_ids_for_owner_type_and_id() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(9, 1)
            },
            ShapeRecord {
                owner_index: 0,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(3, 1)
            },
        ];
        let index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::NetWireSegment as u8, 10, "clk".to_string()),
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
            ],
        );

        assert_eq!(
            index.query_owner(&shapes, &owners, OwnerType::NetWireSegment as u8, 10),
            vec![2, 9]
        );
        assert_eq!(
            index.query_owner(&shapes, &owners, OwnerType::InstanceBBox as u8, 20),
            vec![3]
        );
        assert!(index
            .query_owner(&shapes, &owners, OwnerType::NetWireSegment as u8, 99)
            .is_empty());
    }

    #[test]
    fn owner_shape_index_ignores_deleted_shapes_and_bad_owner_index() {
        let owners = [OwnerRef {
            owner_type: OwnerType::Region as u8,
            owner_id: 7,
            ..OwnerRef::default()
        }];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 0)
            },
            ShapeRecord {
                owner_index: 0,
                state: ShapeState::Deleted as u8,
                ..shape(2, 0)
            },
            ShapeRecord {
                owner_index: 99,
                ..shape(3, 0)
            },
        ];
        let index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [(OwnerType::Region as u8, 7, "region0".to_string())],
        );

        assert_eq!(
            index.query_owner(&shapes, &owners, OwnerType::Region as u8, 7),
            vec![1]
        );
        assert_eq!(index.query(&shapes, &owners, "region0"), vec![1]);
    }

    #[test]
    fn owner_name_index_returns_name_for_owner() {
        let index = OwnerNameIndex::from_shapes_and_names(
            &[],
            &[],
            [(OwnerType::InstanceBBox as u8, 20, "u0".to_string())],
        );

        assert_eq!(
            index.name_for_owner(OwnerType::InstanceBBox as u8, 20),
            Some("u0")
        );
        assert_eq!(
            index.name_for_owner(OwnerType::InstanceBBox as u8, 21),
            None
        );
    }

    #[test]
    fn layer_shape_index_scan_matches_sequential_grouping_over_many_shapes() {
        // Enough shapes, layers, and deleted records to exercise the chunked
        // parallel scan and its per-layer merge.
        let mut shapes = Vec::new();
        for id in 1..=20_000u64 {
            shapes.push(ShapeRecord {
                layer_id: (id % 5) as u16,
                state: if id % 7 == 0 {
                    ShapeState::Deleted as u8
                } else {
                    ShapeState::Alive as u8
                },
                bbox: Rect32 {
                    lx: (id * 37) as i32,
                    ly: (id * 91) as i32,
                    hx: (id * 37) as i32 + 20,
                    hy: (id * 91) as i32 + 20,
                },
                ..shape(id, 0)
            });
        }
        let index = LayerShapeIndex::from_shapes(&shapes);

        for layer_id in 0..5u16 {
            let expected_count = shapes
                .iter()
                .filter(|shape| {
                    shape.layer_id == layer_id && shape.state == ShapeState::Alive as u8
                })
                .count();
            assert_eq!(index.candidate_count(layer_id), expected_count);
        }

        let viewport = Rect32 {
            lx: 1_000,
            ly: 2_000,
            hx: 20_000,
            hy: 60_000,
        };
        for layer_id in [0u16, 3] {
            let mut expected = shapes
                .iter()
                .filter(|shape| {
                    shape.layer_id == layer_id
                        && shape.state == ShapeState::Alive as u8
                        && shape.bbox.intersects(viewport)
                })
                .map(|shape| shape.id)
                .collect::<Vec<_>>();
            expected.sort_unstable();
            assert_eq!(
                index.query_layer_intersect(&shapes, layer_id, viewport),
                expected
            );
        }
    }

    #[test]
    fn owner_name_index_merges_same_name_owners_and_dedupes_shape_ids() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::SpecialWireSegment as u8,
                owner_id: 11,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
        ];
        // Ids are deliberately unordered, id 5 appears twice under one owner,
        // and owner 11 has no name record at all.
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(9, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(4, 1)
            },
            ShapeRecord {
                owner_index: 0,
                ..shape(5, 1)
            },
            ShapeRecord {
                owner_index: 0,
                ..shape(5, 2)
            },
            ShapeRecord {
                owner_index: 0,
                state: ShapeState::Deleted as u8,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                ..shape(30, 1)
            },
        ];
        let index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::NetWireSegment as u8, 10, "clk"),
                (OwnerType::SpecialWireSegment as u8, 11, "clk"),
                (OwnerType::InstanceBBox as u8, 20, "u0"),
            ],
        );

        assert_eq!(index.query(&shapes, &owners, "clk"), vec![4, 5, 9]);
        assert_eq!(
            index.query_owner(&shapes, &owners, OwnerType::NetWireSegment as u8, 10),
            vec![5, 9]
        );
        assert_eq!(
            index.query_owner(&shapes, &owners, OwnerType::SpecialWireSegment as u8, 11),
            vec![4]
        );
        assert_eq!(
            index.name_for_owner(OwnerType::NetWireSegment as u8, 10),
            Some("clk")
        );
        assert_eq!(
            index.name_for_owner(OwnerType::SpecialWireSegment as u8, 11),
            Some("clk")
        );
        assert_eq!(index.query(&shapes, &owners, "u0"), vec![30]);
    }

    #[test]
    fn shape_detail_includes_shape_owner_owner_name_and_owner_path() {
        let owners = [OwnerRef {
            owner_type: OwnerType::Region as u8,
            owner_id: 7,
            path0: 3,
            path1: 4,
            ..OwnerRef::default()
        }];
        let shapes = [ShapeRecord {
            owner_index: 0,
            ..shape(42, 0)
        }];
        let shape_index = ShapeIdIndex::from_shapes(&shapes);
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [(OwnerType::Region as u8, 7, "region0".to_string())],
        );

        let detail = shape_detail_from_parts(&shape_index, &shapes, &owners, &name_index, 42)
            .expect("shape detail");

        assert_eq!(detail.shape.id, 42);
        assert_eq!(detail.owner.owner_type, OwnerType::Region as u8);
        assert_eq!(detail.owner.owner_id, 7);
        assert_eq!(detail.owner.path0, 3);
        assert_eq!(detail.owner.path1, 4);
        assert_eq!(detail.owner_name.as_deref(), Some("region0"));
        assert!(shape_detail_from_parts(&shape_index, &shapes, &owners, &name_index, 99).is_none());
    }

    #[test]
    fn query_owner_name_filters_by_owner_type_for_net_and_instance_queries() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::Via as u8,
                owner_id: 11,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceHalo as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                ..shape(3, 0)
            },
            ShapeRecord {
                owner_index: 3,
                ..shape(4, 0)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::NetWireSegment as u8, 10, "clk".to_string()),
                (OwnerType::Via as u8, 11, "clk".to_string()),
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
                (OwnerType::InstanceHalo as u8, 20, "u0".to_string()),
            ],
        );

        assert_eq!(
            filter_shape_ids_by_owner_types(
                name_index.query(&shapes, &owners, "clk"),
                &shapes,
                &owners,
                &[
                    OwnerType::NetWireSegment as u8,
                    OwnerType::SpecialWireSegment as u8,
                ],
            ),
            vec![1]
        );
        assert_eq!(
            filter_shape_ids_by_owner_types(
                name_index.query(&shapes, &owners, "u0"),
                &shapes,
                &owners,
                &[OwnerType::InstanceBBox as u8, OwnerType::InstanceHalo as u8],
            ),
            vec![3, 4]
        );
    }

    #[test]
    fn bounded_pin_search_preserves_the_local_name_fallback() {
        let manifest = write_open_fixture();
        let db = ChipViewDb::open(&manifest).unwrap();
        let expected = db.query_pin_name_bounded("instance/netA", 1, &|| true);
        assert_eq!(
            expected,
            Some(BoundedShapeSearch {
                shape_ids: vec![1],
                truncated: false,
            })
        );
        assert!(db.name_index.get().is_none());
        assert!(db.connectivity_index.get().is_none());
        assert_eq!(db.query_pin_name("instance/netA"), vec![1]);
        assert_eq!(
            db.query_pin_name_bounded("instance/netA", 1, &|| true),
            expected
        );
        drop(db);
        std::fs::remove_dir_all(manifest.parent().unwrap()).unwrap();
    }

    #[test]
    fn bus_and_group_queries_expand_member_metadata_to_shape_ids() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 11,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::Region as u8,
                owner_id: 30,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(4, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                ..shape(8, 0)
            },
            ShapeRecord {
                owner_index: 3,
                ..shape(6, 0)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::NetWireSegment as u8, 10, "data[0]".to_string()),
                (OwnerType::InstancePinPortShape as u8, 11, "A".to_string()),
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
                (OwnerType::Region as u8, 30, "region0".to_string()),
            ],
        );
        let bus = BusMetadata {
            name: "data".to_string(),
            net_names: vec!["data[0]".to_string()],
            pin_names: vec!["u0/A".to_string()],
            ..BusMetadata::default()
        };
        let group = GroupMetadata {
            name: "cluster0".to_string(),
            region_name: "region0".to_string(),
            instance_names: vec!["u0".to_string()],
            ..GroupMetadata::default()
        };

        assert_eq!(
            query_bus_shape_ids_from_parts(&shapes, &owners, &name_index, &bus),
            vec![2, 4]
        );
        assert_eq!(
            query_group_shape_ids_from_parts(&shapes, &owners, &name_index, &group),
            vec![6, 8]
        );
    }

    #[test]
    fn pin_query_uses_connectivity_endpoints_and_owner_names() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 11,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 12,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(4, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                ..shape(6, 1)
            },
            ShapeRecord {
                owner_index: 3,
                ..shape(8, 0)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::NetWireSegment as u8, 10, "clk".to_string()),
                (OwnerType::IoPinPortShape as u8, 11, "A".to_string()),
                (
                    OwnerType::InstancePinPortShape as u8,
                    12,
                    "u0/A".to_string(),
                ),
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
            ],
        );
        let endpoint = ConnectivityMetadata {
            net_name: "clk".to_string(),
            endpoint_type: "instance".to_string(),
            instance_name: "u0".to_string(),
            pin_name: "A".to_string(),
            master_name: "NAND2_X1".to_string(),
            ..ConnectivityMetadata::default()
        };

        assert!(endpoint_matches_pin(&endpoint, "A"));
        assert!(endpoint_matches_pin(&endpoint, "u0/A"));
        assert!(!endpoint_matches_pin(&endpoint, "u1/A"));
        assert_eq!(
            query_pin_shape_ids_from_parts(
                &shapes,
                &owners,
                &name_index,
                std::slice::from_ref(&endpoint),
                "A",
            ),
            vec![2, 4, 6]
        );
        assert_eq!(
            query_pin_shape_ids_from_parts(&shapes, &owners, &name_index, &[endpoint], "u0/A"),
            vec![2, 4, 6]
        );
        assert_eq!(
            query_pin_shape_ids_from_parts(&shapes, &owners, &name_index, &[], "u0/A"),
            vec![2, 6]
        );
    }

    #[test]
    fn endpoint_pin_query_disambiguates_duplicate_local_pin_names_by_instance_path() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 30,
                path0: 7,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 21,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 31,
                path0: 7,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 22,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 1)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                ..shape(3, 2)
            },
            ShapeRecord {
                owner_index: 3,
                ..shape(4, 2)
            },
            ShapeRecord {
                owner_index: 4,
                ..shape(5, 3)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
                (OwnerType::InstanceBBox as u8, 30, "u1".to_string()),
                (OwnerType::InstancePinPortShape as u8, 21, "A".to_string()),
                (OwnerType::InstancePinPortShape as u8, 31, "A".to_string()),
                (OwnerType::IoPinPortShape as u8, 22, "CLK".to_string()),
            ],
        );

        assert_eq!(
            query_endpoint_pin_shape_ids_from_parts(&shapes, &owners, &name_index, "u0", "A"),
            vec![3]
        );
        assert_eq!(
            query_endpoint_pin_shape_ids_from_parts(&shapes, &owners, &name_index, "u1", "A"),
            vec![4]
        );
        assert_eq!(
            query_endpoint_pin_shape_ids_from_parts(&shapes, &owners, &name_index, "", "CLK"),
            vec![5]
        );
        assert!(query_endpoint_pin_shape_ids_from_parts(
            &shapes,
            &owners,
            &name_index,
            "missing",
            "A"
        )
        .is_empty());
    }

    #[test]
    fn batch_endpoint_resolution_merges_instance_and_pin_geometry() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceHalo as u8,
                owner_id: 40,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 21,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 22,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 30,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..shape(1, 1)
            },
            ShapeRecord {
                owner_index: 1,
                bbox: Rect32 {
                    lx: 20,
                    ly: 20,
                    hx: 30,
                    hy: 30,
                },
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                bbox: Rect32 {
                    lx: 40,
                    ly: 40,
                    hx: 50,
                    hy: 50,
                },
                ..shape(3, 2)
            },
            ShapeRecord {
                owner_index: 3,
                bbox: Rect32 {
                    lx: 45,
                    ly: 45,
                    hx: 60,
                    hy: 60,
                },
                ..shape(4, 2)
            },
            ShapeRecord {
                owner_index: 4,
                bbox: Rect32 {
                    lx: 70,
                    ly: 70,
                    hx: 80,
                    hy: 80,
                },
                ..shape(5, 3)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
                (OwnerType::InstanceHalo as u8, 40, "u0".to_string()),
                (OwnerType::InstancePinPortShape as u8, 21, "A".to_string()),
                (OwnerType::InstancePinPortShape as u8, 22, "A".to_string()),
                (OwnerType::IoPinPortShape as u8, 30, "CLK".to_string()),
            ],
        );
        let shape_index = ShapeIdIndex::from_shapes(&shapes);

        let resolved = resolve_endpoint_pins_from_parts(
            &shapes,
            &owners,
            &shape_index,
            &name_index,
            &[("u0", "A"), ("", "CLK"), ("missing", "A")],
        );

        assert_eq!(
            resolved[0].instance_bbox,
            Some(Rect32 {
                lx: 0,
                ly: 0,
                hx: 30,
                hy: 30,
            })
        );
        assert_eq!(
            resolved[0].pin_bbox,
            Some(Rect32 {
                lx: 40,
                ly: 40,
                hx: 60,
                hy: 60,
            })
        );
        assert_eq!(resolved[1].instance_bbox, None);
        assert_eq!(
            resolved[1].pin_bbox,
            Some(Rect32 {
                lx: 70,
                ly: 70,
                hx: 80,
                hy: 80,
            })
        );
        assert_eq!(resolved[2], EndpointPinGeometry::default());
    }

    #[test]
    fn unrouted_net_guides_connect_pin_centers_when_net_has_no_wire_shapes() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 21,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 22,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 100,
                    hy: 100,
                },
                ..shape(1, 0)
            },
            ShapeRecord {
                owner_index: 1,
                bbox: Rect32 {
                    lx: 10,
                    ly: 10,
                    hx: 20,
                    hy: 20,
                },
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                bbox: Rect32 {
                    lx: 50,
                    ly: 30,
                    hx: 70,
                    hy: 50,
                },
                ..shape(3, 1)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
                (OwnerType::InstancePinPortShape as u8, 21, "A".to_string()),
                (OwnerType::IoPinPortShape as u8, 22, "CLK".to_string()),
            ],
        );
        let net_index = NetMetadataIndex::from_nets(&[NetMetadata {
            name: "clk".to_string(),
            kind: "clock".to_string(),
        }]);
        let endpoints = [
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                net_kind: "clock".to_string(),
                endpoint_type: "instance".to_string(),
                instance_name: "u0".to_string(),
                pin_name: "A".to_string(),
                master_name: "INVX1".to_string(),
            },
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                net_kind: "clock".to_string(),
                endpoint_type: "io".to_string(),
                pin_name: "CLK".to_string(),
                ..ConnectivityMetadata::default()
            },
        ];

        let guides =
            unrouted_net_guides_from_parts(&shapes, &owners, &name_index, &net_index, &endpoints);

        assert_eq!(
            guides,
            vec![UnroutedNetGuide {
                net_name: "clk".to_string(),
                net_kind: "clock".to_string(),
                hub: Point32 { x: 37, y: 27 },
                pin_centers: vec![Point32 { x: 15, y: 15 }, Point32 { x: 60, y: 40 }],
                bbox: Rect32 {
                    lx: 10,
                    ly: 10,
                    hx: 70,
                    hy: 50,
                },
            }]
        );
    }

    #[test]
    fn unrouted_net_guides_disambiguate_duplicate_instance_pin_names_by_instance_path() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 20,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                owner_id: 21,
                path0: 4,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 22,
                path0: 3,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstancePinPortShape as u8,
                owner_id: 23,
                path0: 4,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 24,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 0)
            },
            ShapeRecord {
                owner_index: 1,
                ..shape(2, 0)
            },
            ShapeRecord {
                owner_index: 2,
                bbox: Rect32 {
                    lx: 10,
                    ly: 10,
                    hx: 20,
                    hy: 20,
                },
                ..shape(3, 1)
            },
            ShapeRecord {
                owner_index: 3,
                bbox: Rect32 {
                    lx: 1000,
                    ly: 1000,
                    hx: 1010,
                    hy: 1010,
                },
                ..shape(4, 1)
            },
            ShapeRecord {
                owner_index: 4,
                bbox: Rect32 {
                    lx: 50,
                    ly: 30,
                    hx: 70,
                    hy: 50,
                },
                ..shape(5, 1)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::InstanceBBox as u8, 20, "u0".to_string()),
                (OwnerType::InstanceBBox as u8, 21, "u1".to_string()),
                (
                    OwnerType::InstancePinPortShape as u8,
                    22,
                    "u0/A".to_string(),
                ),
                (
                    OwnerType::InstancePinPortShape as u8,
                    23,
                    "u1/A".to_string(),
                ),
                (OwnerType::IoPinPortShape as u8, 24, "CLK".to_string()),
            ],
        );
        let endpoints = [
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                endpoint_type: "instance".to_string(),
                instance_name: "u0".to_string(),
                pin_name: "A".to_string(),
                ..ConnectivityMetadata::default()
            },
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                endpoint_type: "io".to_string(),
                pin_name: "CLK".to_string(),
                ..ConnectivityMetadata::default()
            },
        ];

        let guides = unrouted_net_guides_from_parts(
            &shapes,
            &owners,
            &name_index,
            &NetMetadataIndex::default(),
            &endpoints,
        );

        assert_eq!(guides.len(), 1);
        assert_eq!(
            guides[0].pin_centers,
            vec![Point32 { x: 15, y: 15 }, Point32 { x: 60, y: 40 }]
        );
        assert_eq!(
            guides[0].bbox,
            Rect32 {
                lx: 10,
                ly: 10,
                hx: 70,
                hy: 50,
            }
        );
    }

    #[test]
    fn unrouted_net_guides_skip_nets_with_real_wire_shapes() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::NetWireSegment as u8,
                owner_id: 10,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 22,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::IoPinPortShape as u8,
                owner_id: 23,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 1)
            },
            ShapeRecord {
                owner_index: 1,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..shape(2, 1)
            },
            ShapeRecord {
                owner_index: 2,
                bbox: Rect32 {
                    lx: 100,
                    ly: 100,
                    hx: 110,
                    hy: 110,
                },
                ..shape(3, 1)
            },
        ];
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &shapes,
            &owners,
            [
                (OwnerType::NetWireSegment as u8, 10, "clk".to_string()),
                (OwnerType::IoPinPortShape as u8, 22, "CLK0".to_string()),
                (OwnerType::IoPinPortShape as u8, 23, "CLK1".to_string()),
            ],
        );
        let endpoints = [
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                endpoint_type: "io".to_string(),
                pin_name: "CLK0".to_string(),
                ..ConnectivityMetadata::default()
            },
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                endpoint_type: "io".to_string(),
                pin_name: "CLK1".to_string(),
                ..ConnectivityMetadata::default()
            },
        ];

        assert!(unrouted_net_guides_from_parts(
            &shapes,
            &owners,
            &name_index,
            &NetMetadataIndex::default(),
            &endpoints,
        )
        .is_empty());
    }

    #[test]
    fn connectivity_index_queries_endpoints_by_net_instance_and_pin() {
        let endpoints = [
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                endpoint_type: "instance".to_string(),
                instance_name: "u0".to_string(),
                pin_name: "A".to_string(),
                master_name: "NAND2_X1".to_string(),
                ..ConnectivityMetadata::default()
            },
            ConnectivityMetadata {
                net_name: "data".to_string(),
                endpoint_type: "instance".to_string(),
                instance_name: "u1".to_string(),
                pin_name: "A".to_string(),
                master_name: "INV_X1".to_string(),
                ..ConnectivityMetadata::default()
            },
            ConnectivityMetadata {
                net_name: "clk".to_string(),
                endpoint_type: "io".to_string(),
                pin_name: "CLK".to_string(),
                ..ConnectivityMetadata::default()
            },
        ];
        let index = ConnectivityIndex::from_endpoints(&endpoints);

        assert_eq!(
            index
                .endpoints_for_net(&endpoints, "clk")
                .into_iter()
                .map(|endpoint| endpoint.pin_name.as_str())
                .collect::<Vec<_>>(),
            vec!["A", "CLK"]
        );
        assert_eq!(
            index
                .endpoints_for_instance(&endpoints, "u1")
                .into_iter()
                .map(|endpoint| endpoint.net_name.as_str())
                .collect::<Vec<_>>(),
            vec!["data"]
        );
        assert_eq!(
            index
                .endpoints_for_pin(&endpoints, "A")
                .into_iter()
                .map(|endpoint| endpoint.instance_name.as_str())
                .collect::<Vec<_>>(),
            vec!["u0", "u1"]
        );
        assert_eq!(
            index
                .endpoints_for_pin(&endpoints, "u0/A")
                .into_iter()
                .map(|endpoint| endpoint.net_name.as_str())
                .collect::<Vec<_>>(),
            vec!["clk"]
        );
    }

    #[test]
    fn connectivity_index_parallel_build_preserves_query_semantics() {
        // Enough endpoints to exercise the sort-and-group parallel builder.
        let mut endpoints = Vec::new();
        for i in 0..5000usize {
            endpoints.push(ConnectivityMetadata {
                net_name: format!("net{}", i % 97),
                endpoint_type: "instance".to_string(),
                instance_name: if i % 13 == 0 {
                    String::new()
                } else {
                    format!("inst{}", i % 61)
                },
                pin_name: format!("pin{}", i % 53),
                master_name: format!("m{}", i % 7),
                ..ConnectivityMetadata::default()
            });
        }
        let index = ConnectivityIndex::from_endpoints(&endpoints);

        let expected_net_indices = |name: &str| {
            endpoints
                .iter()
                .enumerate()
                .filter(|(_, endpoint)| endpoint.net_name == name)
                .map(|(i, _)| i)
                .collect::<Vec<_>>()
        };
        for name in ["net0", "net96", "net53"] {
            let hits = index.endpoints_for_net(&endpoints, name);
            assert_eq!(hits.len(), expected_net_indices(name).len());
            assert!(hits
                .iter()
                .zip(expected_net_indices(name))
                .all(|(endpoint, i)| std::ptr::eq(*endpoint, &endpoints[i])));
        }

        // Qualified pin lookup uses the "instance/pin" map and skips
        // endpoints with an empty instance name.
        let qualified_hits = index.endpoints_for_pin(&endpoints, "inst1/pin2");
        let expected_qualified = endpoints
            .iter()
            .enumerate()
            .filter(|(_, endpoint)| {
                endpoint.instance_name == "inst1" && endpoint.pin_name == "pin2"
            })
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        assert_eq!(qualified_hits.len(), expected_qualified.len());
        assert!(qualified_hits
            .iter()
            .zip(expected_qualified)
            .all(|(endpoint, i)| std::ptr::eq(*endpoint, &endpoints[i])));

        // Instance lookup skips empty instance names.
        let instance_hits = index.endpoints_for_instance(&endpoints, "inst2");
        let expected_instance = endpoints
            .iter()
            .enumerate()
            .filter(|(_, endpoint)| endpoint.instance_name == "inst2")
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        assert_eq!(instance_hits.len(), expected_instance.len());
    }

    #[test]
    fn net_metadata_index_queries_kind_by_net_name() {
        let index = NetMetadataIndex::from_nets(&[
            NetMetadata {
                name: "clk".to_string(),
                kind: "clock".to_string(),
            },
            NetMetadata {
                name: "data".to_string(),
                kind: "signal".to_string(),
            },
        ]);

        assert_eq!(index.kind_for_name("clk"), Some("clock"));
        assert_eq!(index.kind_for_name("data"), Some("signal"));
        assert_eq!(index.kind_for_name("missing"), None);
    }

    #[test]
    fn index_memory_estimates_include_heap_backing_storage() {
        let shapes = [
            shape(40, 7),
            shape(10, 7),
            ShapeRecord {
                bbox: Rect32 {
                    lx: 100,
                    ly: 100,
                    hx: 120,
                    hy: 120,
                },
                ..shape(25, 8)
            },
        ];
        let tiles = [
            GeometryViewTileRecord {
                lod_level: 2,
                layer_id: 4,
                shape_count: 10,
                ..GeometryViewTileRecord::default()
            },
            GeometryViewTileRecord {
                lod_level: 2,
                layer_id: 4,
                shape_count: 4,
                ..GeometryViewTileRecord::default()
            },
        ];
        let owners = [OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 10,
            ..OwnerRef::default()
        }];
        let named_shapes = [
            ShapeRecord {
                owner_index: 0,
                ..shape(1, 1)
            },
            ShapeRecord {
                owner_index: 0,
                ..shape(2, 1)
            },
        ];

        let layer_index = LayerShapeIndex::from_shapes(&shapes);
        let shape_index = ShapeIdIndex::from_shapes(&shapes);
        let view_index = ViewTileIndex::from_tiles(&tiles);
        let name_index = OwnerNameIndex::from_shapes_and_names(
            &named_shapes,
            &owners,
            [(
                OwnerType::NetWireSegment as u8,
                10,
                "synthetic_clk".to_string(),
            )],
        );
        let net_index = NetMetadataIndex::from_nets(&[NetMetadata {
            name: "synthetic_clk".to_string(),
            kind: "clock".to_string(),
        }]);
        let connectivity_index = ConnectivityIndex::from_endpoints(&[ConnectivityMetadata {
            net_name: "synthetic_clk".to_string(),
            endpoint_type: "instance".to_string(),
            instance_name: "u0".to_string(),
            pin_name: "A".to_string(),
            master_name: "NAND2_X1".to_string(),
            ..ConnectivityMetadata::default()
        }]);
        let stats = ChipViewIndexMemoryStats::from_indexes(
            &layer_index,
            &shape_index,
            Some(&view_index),
            Some(&name_index),
            Some(&net_index),
            Some(&connectivity_index),
        );

        assert!(stats.layer_index_bytes >= 3 * core::mem::size_of::<usize>());
        assert!(stats.shape_index_bytes >= 3 * core::mem::size_of::<(ShapeId, usize)>());
        assert!(stats.view_index_bytes >= 2 * core::mem::size_of::<usize>());
        assert!(stats.name_index_bytes >= "synthetic_clk".len());
        assert!(stats.net_index_bytes >= "synthetic_clk".len());
        assert!(stats.connectivity_index_bytes >= "synthetic_clk".len());
        assert_eq!(
            stats.total_bytes,
            stats.layer_index_bytes
                + stats.shape_index_bytes
                + stats.view_index_bytes
                + stats.name_index_bytes
                + stats.net_index_bytes
                + stats.connectivity_index_bytes
        );
    }

    #[test]
    fn delta_stats_report_latest_delta_record() {
        let records = [
            GeometryDeltaRecord {
                sequence_id: 1,
                command_id: 10,
                shape_id: 40,
                old_version: 1,
                new_version: 2,
                ..GeometryDeltaRecord::default()
            },
            GeometryDeltaRecord {
                sequence_id: 2,
                command_id: 11,
                shape_id: 41,
                old_version: 3,
                new_version: 4,
                ..GeometryDeltaRecord::default()
            },
        ];

        let stats = delta_stats_from_records(&records);

        assert_eq!(stats.record_count, 2);
        assert_eq!(stats.latest_sequence_id, Some(2));
        assert_eq!(stats.latest_command_id, Some(11));
        assert_eq!(stats.latest_shape_id, Some(41));
        assert_eq!(stats.latest_old_version, Some(3));
        assert_eq!(stats.latest_new_version, Some(4));
    }

    #[test]
    fn layer_shape_index_picks_top_rect_from_visible_layers_without_scanning_all_layers() {
        let shapes = [
            ShapeRecord {
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..shape(1, 1)
            },
            ShapeRecord {
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..shape(2, 2)
            },
            ShapeRecord {
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..shape(3, 1)
            },
            ShapeRecord {
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                state: ShapeState::Deleted as u8,
                ..shape(4, 1)
            },
        ];
        let index = LayerShapeIndex::from_shapes(&shapes);
        let point = chipgeom_format::Point32 { x: 5, y: 5 };

        assert_eq!(index.pick_top_rect(&shapes, &[1], point), Some(3));
        assert_eq!(index.pick_top_rect(&shapes, &[2], point), Some(2));
        assert_eq!(index.pick_top_rect(&shapes, &[3], point), None);
    }
}
