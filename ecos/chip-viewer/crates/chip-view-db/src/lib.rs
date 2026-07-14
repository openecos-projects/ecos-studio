use std::collections::BTreeMap;
use std::mem::size_of;
use std::path::Path;

use anyhow::Result;
use bytemuck::Pod;
use chipgeom_format::{
    GeometryDeltaRecord, GeometryViewTileRecord, LinePayload, OwnerRef, OwnerType, Point32,
    PointPayload, Rect32, RectPayload, ShapeId, ShapeKind, ShapeRecord, ShapeState, ShapeVersion,
};
pub use chipgeom_reader::{
    BusMetadata, ConnectivityMetadata, GeometryManifest, GeometryMappedBytes, GroupMetadata,
    MasterMetadata, SiteMetadata,
};
use chipgeom_reader::{GeometrySnapshot, LayerMetadata};
use rstar::{RTree, RTreeObject, AABB};

pub struct ChipViewDb {
    layer_index: LayerShapeIndex,
    name_index: OwnerNameIndex,
    shape_index: ShapeIdIndex,
    snapshot: GeometrySnapshot,
    view_index: ViewTileIndex,
}

#[derive(Clone, Debug, Default)]
pub struct SnapshotStats {
    pub shape_count: usize,
    pub owner_count: usize,
    pub name_count: usize,
    pub site_count: usize,
    pub master_count: usize,
    pub connectivity_count: usize,
    pub bus_count: usize,
    pub group_count: usize,
    pub bbox: Option<Rect32>,
    pub owner_type_counts: BTreeMap<u8, usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChipViewIndexMemoryStats {
    pub layer_index_bytes: usize,
    pub shape_index_bytes: usize,
    pub view_index_bytes: usize,
    pub name_index_bytes: usize,
    pub total_bytes: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChipViewMemoryStats {
    pub mapped_bytes: GeometryMappedBytes,
    pub index_bytes: ChipViewIndexMemoryStats,
    pub mapped_plus_index_bytes: usize,
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

#[derive(Clone, Debug)]
pub struct ShapeDetail {
    pub shape: ShapeRecord,
    pub owner: OwnerRef,
    pub owner_name: Option<String>,
    pub owner_local_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeGeometry {
    Rect(Rect32),
    Line(LinePayload),
    Point(PointPayload),
}

#[derive(Clone, Debug, Default)]
pub struct LayerShapeIndex {
    by_layer: BTreeMap<u16, Vec<usize>>,
    spatial_by_layer: BTreeMap<u16, RTree<LayerSpatialEntry>>,
}

#[derive(Clone, Debug, Default)]
pub struct ShapeIdIndex {
    by_id: BTreeMap<ShapeId, usize>,
}

#[derive(Clone, Debug, Default)]
pub struct ViewTileIndex {
    by_lod_layer: BTreeMap<(u8, u16), Vec<usize>>,
}

#[derive(Clone, Debug, Default)]
pub struct OwnerNameIndex {
    by_name: BTreeMap<String, Vec<ShapeId>>,
    name_by_owner: BTreeMap<(u8, u64), String>,
    shapes_by_owner: BTreeMap<(u8, u64), Vec<ShapeId>>,
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

impl LayerShapeIndex {
    pub fn from_shapes(shapes: &[ShapeRecord]) -> Self {
        let mut by_layer = BTreeMap::<u16, Vec<usize>>::new();
        let mut spatial_entries_by_layer = BTreeMap::<u16, Vec<LayerSpatialEntry>>::new();
        for (index, shape) in shapes.iter().enumerate() {
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            by_layer.entry(shape.layer_id).or_default().push(index);
            spatial_entries_by_layer
                .entry(shape.layer_id)
                .or_default()
                .push(LayerSpatialEntry {
                    index,
                    envelope: rect_envelope(shape.bbox),
                });
        }
        let spatial_by_layer = spatial_entries_by_layer
            .into_iter()
            .map(|(layer_id, entries)| (layer_id, RTree::bulk_load(entries)))
            .collect();
        Self {
            by_layer,
            spatial_by_layer,
        }
    }

    pub fn candidate_count(&self, layer_id: u16) -> usize {
        self.by_layer.get(&layer_id).map_or(0, std::vec::Vec::len)
    }

    pub fn query_candidate_count(&self, layer_id: u16, bbox: Rect32) -> usize {
        self.spatial_candidate_indices(layer_id, bbox).len()
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>()
            + self
                .by_layer
                .values()
                .map(|indices| {
                    size_of::<u16>()
                        + size_of::<Vec<usize>>()
                        + indices.capacity() * size_of::<usize>()
                })
                .sum::<usize>()
            + self
                .spatial_by_layer
                .values()
                .map(|tree| {
                    size_of::<RTree<LayerSpatialEntry>>()
                        + tree.size() * size_of::<LayerSpatialEntry>()
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
        let mut hits = Vec::new();
        for layer_id in layer_ids {
            let mut layer_hits = self.query_layer_intersect(shapes, *layer_id, bbox);
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
        self.spatial_candidate_indices(layer_id, bbox)
            .into_iter()
            .filter(|index| shapes[*index].bbox.intersects(bbox))
            .collect()
    }

    fn spatial_candidate_indices(&self, layer_id: u16, bbox: Rect32) -> Vec<usize> {
        let mut indices = self
            .spatial_by_layer
            .get(&layer_id)
            .into_iter()
            .flat_map(|tree| tree.locate_in_envelope_intersecting(rect_envelope(bbox)))
            .map(|entry| entry.index)
            .collect::<Vec<_>>();
        indices.sort_unstable();
        indices
    }

    #[cfg(test)]
    fn spatial_candidate_count(&self, layer_id: u16, bbox: Rect32) -> usize {
        self.spatial_by_layer.get(&layer_id).map_or(0, |tree| {
            tree.locate_in_envelope_intersecting(rect_envelope(bbox))
                .count()
        })
    }

    pub fn pick_top_rect(
        &self,
        shapes: &[ShapeRecord],
        layer_ids: &[u16],
        point: Point32,
    ) -> Option<ShapeId> {
        layer_ids
            .iter()
            .flat_map(|layer_id| self.spatial_candidate_indices(*layer_id, point_bbox(point)))
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
            .flat_map(|layer_id| self.spatial_candidate_indices(*layer_id, point_bbox(point)))
            .filter(|index| {
                let shape = &shapes[*index];
                shape.state == ShapeState::Alive as u8
                    && is_pickable_shape_kind(shape.kind)
                    && rect_contains_point(shape.bbox, point)
            })
            .max()
            .map(|index| shapes[index].id)
    }
}

impl ShapeIdIndex {
    pub fn from_shapes(shapes: &[ShapeRecord]) -> Self {
        let mut by_id = BTreeMap::<ShapeId, usize>::new();
        for (index, shape) in shapes.iter().enumerate() {
            by_id.entry(shape.id).or_insert(index);
        }
        Self { by_id }
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>() + self.by_id.len() * size_of::<(ShapeId, usize)>()
    }

    pub fn find<'a>(
        &self,
        shapes: &'a [ShapeRecord],
        shape_id: ShapeId,
    ) -> Option<&'a ShapeRecord> {
        self.by_id
            .get(&shape_id)
            .and_then(|index| shapes.get(*index))
    }
}

impl ViewTileIndex {
    pub fn from_tiles(tiles: &[GeometryViewTileRecord]) -> Self {
        let mut by_lod_layer = BTreeMap::<(u8, u16), Vec<usize>>::new();
        for (index, tile) in tiles.iter().enumerate() {
            if tile.shape_count == 0 {
                continue;
            }
            by_lod_layer
                .entry((tile.lod_level, tile.layer_id))
                .or_default()
                .push(index);
        }
        Self { by_lod_layer }
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>()
            + self
                .by_lod_layer
                .values()
                .map(|indices| {
                    size_of::<(u8, u16)>()
                        + size_of::<Vec<usize>>()
                        + indices.capacity() * size_of::<usize>()
                })
                .sum::<usize>()
    }

    pub fn query_tiles<'a>(
        &self,
        tiles: &'a [GeometryViewTileRecord],
        lod_level: u8,
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<&'a GeometryViewTileRecord> {
        self.by_lod_layer
            .get(&(lod_level, layer_id))
            .into_iter()
            .flat_map(|indices| indices.iter().copied())
            .filter_map(|index| tiles.get(index))
            .filter(|tile| tile.bbox.intersects(bbox))
            .collect()
    }
}

impl OwnerNameIndex {
    fn from_snapshot(snapshot: &GeometrySnapshot) -> Self {
        let owner_names = snapshot.name_records().iter().filter_map(|record| {
            Some((
                record.owner_type,
                record.owner_id,
                snapshot.owner_name(record)?.to_string(),
            ))
        });
        Self::from_shapes_and_names(snapshot.shapes(), snapshot.owners(), owner_names)
    }

    fn from_shapes_and_names(
        shapes: &[ShapeRecord],
        owners: &[OwnerRef],
        owner_names: impl IntoIterator<Item = (u8, u64, String)>,
    ) -> Self {
        let mut shapes_by_owner = BTreeMap::<(u8, u64), Vec<ShapeId>>::new();
        for shape in shapes {
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            let Some(owner) = owners.get(shape.owner_index as usize) else {
                continue;
            };
            shapes_by_owner
                .entry((owner.owner_type, owner.owner_id))
                .or_default()
                .push(shape.id);
        }
        for shape_ids in shapes_by_owner.values_mut() {
            shape_ids.sort_unstable();
            shape_ids.dedup();
        }

        let mut by_name = BTreeMap::<String, Vec<ShapeId>>::new();
        let mut name_by_owner = BTreeMap::<(u8, u64), String>::new();
        for (owner_type, owner_id, name) in owner_names {
            name_by_owner
                .entry((owner_type, owner_id))
                .or_insert_with(|| name.clone());
            let Some(shape_ids) = shapes_by_owner.get(&(owner_type, owner_id)) else {
                continue;
            };
            by_name.entry(name).or_default().extend(shape_ids);
        }
        for shape_ids in by_name.values_mut() {
            shape_ids.sort_unstable();
            shape_ids.dedup();
        }
        Self {
            by_name,
            name_by_owner,
            shapes_by_owner,
        }
    }

    pub fn query(&self, name: &str) -> Vec<ShapeId> {
        self.by_name.get(name).cloned().unwrap_or_default()
    }

    pub fn query_owner(&self, owner_type: u8, owner_id: u64) -> Vec<ShapeId> {
        self.shapes_by_owner
            .get(&(owner_type, owner_id))
            .cloned()
            .unwrap_or_default()
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        let by_name_bytes = self
            .by_name
            .iter()
            .map(|(name, shape_ids)| {
                size_of::<String>()
                    + name.capacity()
                    + size_of::<Vec<ShapeId>>()
                    + shape_ids.capacity() * size_of::<ShapeId>()
            })
            .sum::<usize>();
        let name_by_owner_bytes = self
            .name_by_owner
            .values()
            .map(|name| size_of::<(u8, u64)>() + size_of::<String>() + name.capacity())
            .sum::<usize>();
        let shapes_by_owner_bytes = self
            .shapes_by_owner
            .values()
            .map(|shape_ids| {
                size_of::<(u8, u64)>()
                    + size_of::<Vec<ShapeId>>()
                    + shape_ids.capacity() * size_of::<ShapeId>()
            })
            .sum::<usize>();
        size_of::<Self>() + by_name_bytes + name_by_owner_bytes + shapes_by_owner_bytes
    }

    pub fn name_for_owner(&self, owner_type: u8, owner_id: u64) -> Option<&str> {
        self.name_by_owner
            .get(&(owner_type, owner_id))
            .map(String::as_str)
    }
}

impl ChipViewIndexMemoryStats {
    pub fn from_indexes(
        layer_index: &LayerShapeIndex,
        shape_index: &ShapeIdIndex,
        view_index: &ViewTileIndex,
        name_index: &OwnerNameIndex,
    ) -> Self {
        let layer_index_bytes = layer_index.estimated_heap_bytes();
        let shape_index_bytes = shape_index.estimated_heap_bytes();
        let view_index_bytes = view_index.estimated_heap_bytes();
        let name_index_bytes = name_index.estimated_heap_bytes();
        Self {
            layer_index_bytes,
            shape_index_bytes,
            view_index_bytes,
            name_index_bytes,
            total_bytes: layer_index_bytes
                + shape_index_bytes
                + view_index_bytes
                + name_index_bytes,
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

fn is_pickable_shape_kind(kind: u8) -> bool {
    kind == ShapeKind::Rect as u8 || kind == ShapeKind::Line as u8 || kind == ShapeKind::Point as u8
}

fn rect_envelope(rect: Rect32) -> AABB<[i32; 2]> {
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
        let snapshot = GeometrySnapshot::open(manifest_path)?;
        let layer_index = LayerShapeIndex::from_shapes(snapshot.shapes());
        let name_index = OwnerNameIndex::from_snapshot(&snapshot);
        let shape_index = ShapeIdIndex::from_shapes(snapshot.shapes());
        let view_index = ViewTileIndex::from_tiles(snapshot.view_tile_records());
        Ok(Self {
            layer_index,
            name_index,
            shape_index,
            snapshot,
            view_index,
        })
    }

    pub fn snapshot(&self) -> &GeometrySnapshot {
        &self.snapshot
    }

    pub fn stats(&self) -> SnapshotStats {
        let mut stats = SnapshotStats {
            shape_count: self.snapshot.shapes().len(),
            owner_count: self.snapshot.owners().len(),
            name_count: self.snapshot.name_records().len(),
            site_count: self.snapshot.site_metadata().len(),
            master_count: self.snapshot.master_metadata().len(),
            connectivity_count: self.snapshot.connectivity_metadata().len(),
            bus_count: self.snapshot.bus_metadata().len(),
            group_count: self.snapshot.group_metadata().len(),
            ..SnapshotStats::default()
        };

        for shape in self.snapshot.shapes() {
            stats
                .bbox
                .as_mut()
                .map(|bbox| bbox.include(shape.bbox))
                .unwrap_or_else(|| stats.bbox = Some(shape.bbox));
            if let Some(owner) = self.snapshot.owners().get(shape.owner_index as usize) {
                *stats.owner_type_counts.entry(owner.owner_type).or_insert(0) += 1;
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
            &self.name_index,
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

    pub fn site_metadata(&self) -> &[SiteMetadata] {
        self.snapshot.site_metadata()
    }

    pub fn master_metadata(&self) -> &[MasterMetadata] {
        self.snapshot.master_metadata()
    }

    pub fn connectivity_metadata(&self) -> &[ConnectivityMetadata] {
        self.snapshot.connectivity_metadata()
    }

    pub fn bus_metadata(&self) -> &[BusMetadata] {
        self.snapshot.bus_metadata()
    }

    pub fn group_metadata(&self) -> &[GroupMetadata] {
        self.snapshot.group_metadata()
    }

    pub fn connectivity_for_net(&self, net_name: &str) -> Vec<&ConnectivityMetadata> {
        self.snapshot
            .connectivity_metadata()
            .iter()
            .filter(|endpoint| endpoint.net_name == net_name)
            .collect()
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
        self.layer_index.query_candidate_count(layer_id, bbox)
    }

    pub fn view_tile_count(&self) -> usize {
        self.snapshot.view_tile_records().len()
    }

    pub fn memory_stats(&self) -> ChipViewMemoryStats {
        let mapped_bytes = self.snapshot.mapped_bytes();
        let index_bytes = ChipViewIndexMemoryStats::from_indexes(
            &self.layer_index,
            &self.shape_index,
            &self.view_index,
            &self.name_index,
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
        self.view_index
            .query_tiles(self.snapshot.view_tile_records(), lod_level, layer_id, bbox)
    }

    pub fn query_owner_name(&self, name: &str) -> Vec<ShapeId> {
        self.name_index.query(name)
    }

    pub fn query_owner_shapes(&self, owner_type: OwnerType, owner_id: u64) -> Vec<ShapeId> {
        self.name_index.query_owner(owner_type as u8, owner_id)
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

    pub fn pick_top_rect(&self, layer_ids: &[u16], point: Point32) -> Option<ShapeId> {
        self.layer_index
            .pick_top_rect(self.snapshot.shapes(), layer_ids, point)
    }

    pub fn pick_top_shape(&self, layer_ids: &[u16], point: Point32) -> Option<ShapeId> {
        self.layer_index
            .pick_top_shape(self.snapshot.shapes(), layer_ids, point)
    }

    pub fn owner_name(&self, owner: &OwnerRef) -> Option<&str> {
        self.name_index
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
mod tests {
    use super::*;
    use chipgeom_format::{Rect32, ShapeKind, ShapeState};

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
        assert!(index.spatial_candidate_count(4, bbox) < index.candidate_count(4));
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

        assert_eq!(index.query_candidate_count(3, viewport), 1);
        assert!(index.query_candidate_count(3, viewport) < index.candidate_count(3));
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

        assert_eq!(index.query("synthetic_clk"), vec![1, 2]);
        assert_eq!(index.query("u0"), vec![3]);
        assert!(index.query("missing").is_empty());
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
            index.query_owner(OwnerType::NetWireSegment as u8, 10),
            vec![2, 9]
        );
        assert_eq!(
            index.query_owner(OwnerType::InstanceBBox as u8, 20),
            vec![3]
        );
        assert!(index
            .query_owner(OwnerType::NetWireSegment as u8, 99)
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

        assert_eq!(index.query_owner(OwnerType::Region as u8, 7), vec![1]);
        assert_eq!(index.query("region0"), vec![1]);
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
                name_index.query("clk"),
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
                name_index.query("u0"),
                &shapes,
                &owners,
                &[OwnerType::InstanceBBox as u8, OwnerType::InstanceHalo as u8],
            ),
            vec![3, 4]
        );
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
        let stats = ChipViewIndexMemoryStats::from_indexes(
            &layer_index,
            &shape_index,
            &view_index,
            &name_index,
        );

        assert!(stats.layer_index_bytes >= 3 * core::mem::size_of::<usize>());
        assert!(stats.shape_index_bytes >= 3 * core::mem::size_of::<(ShapeId, usize)>());
        assert!(stats.view_index_bytes >= 2 * core::mem::size_of::<usize>());
        assert!(stats.name_index_bytes >= "synthetic_clk".len());
        assert_eq!(
            stats.total_bytes,
            stats.layer_index_bytes
                + stats.shape_index_bytes
                + stats.view_index_bytes
                + stats.name_index_bytes
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
