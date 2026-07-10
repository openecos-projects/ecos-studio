use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use chipgeom_format::{
    GeometryViewTileRecord, OwnerRef, OwnerType, Point32, Rect32, ShapeId, ShapeKind, ShapeRecord,
    ShapeState,
};
use chipgeom_reader::GeometrySnapshot;

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
    pub bbox: Option<Rect32>,
    pub owner_type_counts: BTreeMap<u8, usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerSummary {
    pub layer_id: u16,
    pub shape_count: usize,
}

#[derive(Clone, Debug, Default)]
pub struct LayerShapeIndex {
    by_layer: BTreeMap<u16, Vec<usize>>,
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
}

impl LayerShapeIndex {
    pub fn from_shapes(shapes: &[ShapeRecord]) -> Self {
        let mut by_layer = BTreeMap::<u16, Vec<usize>>::new();
        for (index, shape) in shapes.iter().enumerate() {
            if shape.state != ShapeState::Alive as u8 {
                continue;
            }
            by_layer.entry(shape.layer_id).or_default().push(index);
        }
        Self { by_layer }
    }

    pub fn candidate_count(&self, layer_id: u16) -> usize {
        self.by_layer.get(&layer_id).map_or(0, std::vec::Vec::len)
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

    pub fn query_layer_intersect_indices(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<usize> {
        self.by_layer
            .get(&layer_id)
            .into_iter()
            .flat_map(|indices| indices.iter().copied())
            .filter(|index| shapes[*index].bbox.intersects(bbox))
            .collect()
    }

    pub fn pick_top_rect(
        &self,
        shapes: &[ShapeRecord],
        layer_ids: &[u16],
        point: Point32,
    ) -> Option<ShapeId> {
        layer_ids
            .iter()
            .filter_map(|layer_id| self.by_layer.get(layer_id))
            .flat_map(|indices| indices.iter().copied())
            .filter(|index| {
                let shape = &shapes[*index];
                shape.state == ShapeState::Alive as u8
                    && shape.kind == ShapeKind::Rect as u8
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
        }
    }

    pub fn query(&self, name: &str) -> Vec<ShapeId> {
        self.by_name.get(name).cloned().unwrap_or_default()
    }

    pub fn name_for_owner(&self, owner_type: u8, owner_id: u64) -> Option<&str> {
        self.name_by_owner
            .get(&(owner_type, owner_id))
            .map(String::as_str)
    }
}

pub fn layer_summaries_from_shapes(shapes: &[ShapeRecord]) -> Vec<LayerSummary> {
    let mut counts = BTreeMap::<u16, usize>::new();
    for shape in shapes {
        if shape.state != ShapeState::Alive as u8 {
            continue;
        }
        *counts.entry(shape.layer_id).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(layer_id, shape_count)| LayerSummary {
            layer_id,
            shape_count,
        })
        .collect()
}

fn rect_contains_point(rect: Rect32, point: Point32) -> bool {
    point.x >= rect.lx && point.x <= rect.hx && point.y >= rect.ly && point.y <= rect.hy
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

    pub fn layer_summaries(&self) -> Vec<LayerSummary> {
        layer_summaries_from_shapes(self.snapshot.shapes())
    }

    pub fn query_layer_intersect(&self, layer_id: u16, bbox: Rect32) -> Vec<ShapeId> {
        self.layer_index
            .query_layer_intersect(self.snapshot.shapes(), layer_id, bbox)
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

    pub fn view_tile_count(&self) -> usize {
        self.snapshot.view_tile_records().len()
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

    pub fn pick_top_rect(&self, layer_ids: &[u16], point: Point32) -> Option<ShapeId> {
        self.layer_index
            .pick_top_rect(self.snapshot.shapes(), layer_ids, point)
    }

    pub fn owner_name(&self, owner: &OwnerRef) -> Option<&str> {
        self.name_index
            .name_for_owner(owner.owner_type, owner.owner_id)
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
    fn shape_id_index_finds_records_by_id() {
        let shapes = [shape(40, 7), shape(10, 7), shape(25, 8)];
        let index = ShapeIdIndex::from_shapes(&shapes);

        assert_eq!(index.find(&shapes, 10).map(|shape| shape.id), Some(10));
        assert_eq!(index.find(&shapes, 25).map(|shape| shape.layer_id), Some(8));
        assert!(index.find(&shapes, 999).is_none());
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
