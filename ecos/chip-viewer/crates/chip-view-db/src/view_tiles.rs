use std::collections::BTreeMap;
use std::mem::size_of;

use chipgeom_format::{GeometryViewTileRecord, Rect32};
use rstar::{RTree, RTreeObject, AABB};

use crate::rect_envelope;

/// Spatial index over view-tile records, grouped by (lod level, layer).
///
/// Each group keeps the record indices in original file order so query
/// results preserve the ordering produced by the previous linear scan, and
/// adds an R-Tree over tile bounding boxes so viewport queries cost
/// O(log n + hits) instead of scanning every tile in the group.
///
/// Tile grid coordinates (`tile_x`/`tile_y`) are deliberately not used as a
/// pruning bound: large-shape summary tiles carry the grid cell of their
/// lower-left corner while their bounding box may span far beyond that cell,
/// so only the bounding-box R-Tree gives an exact intersection filter.
#[derive(Clone, Debug, Default)]
pub struct ViewTileIndex {
    by_lod_layer: BTreeMap<(u8, u16), ViewTileGroup>,
}

#[derive(Clone, Debug, Default)]
struct ViewTileGroup {
    /// Record indices in original file order; drives result ordering.
    indices: Vec<usize>,
    /// Staging area for tree entries during `from_tiles`; emptied once the
    /// group's R-Tree is bulk-loaded.
    entries: Vec<ViewTileEntry>,
    tree: RTree<ViewTileEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ViewTileEntry {
    index: usize,
    envelope: AABB<[i32; 2]>,
}

impl RTreeObject for ViewTileEntry {
    type Envelope = AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

impl ViewTileIndex {
    pub fn from_tiles(tiles: &[GeometryViewTileRecord]) -> Self {
        let mut by_lod_layer = BTreeMap::<(u8, u16), ViewTileGroup>::new();
        for (index, tile) in tiles.iter().enumerate() {
            if tile.shape_count == 0 {
                continue;
            }
            let group = by_lod_layer
                .entry((tile.lod_level, tile.layer_id))
                .or_default();
            group.indices.push(index);
            group.entries.push(ViewTileEntry {
                index,
                envelope: rect_envelope(tile.bbox),
            });
        }
        for group in by_lod_layer.values_mut() {
            // Bulk-load instead of inserting one by one: inserts route through
            // `Envelope::area`, whose i32 product overflows for die-sized
            // bounding boxes in debug builds (and wraps in release).
            group.tree = RTree::bulk_load(std::mem::take(&mut group.entries));
        }
        Self { by_lod_layer }
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>()
            + self
                .by_lod_layer
                .values()
                .map(|group| {
                    size_of::<(u8, u16)>()
                        + size_of::<ViewTileGroup>()
                        + group.indices.capacity() * size_of::<usize>()
                        + size_of::<RTree<ViewTileEntry>>()
                        + group.tree.size() * size_of::<ViewTileEntry>()
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
        let Some(group) = self.by_lod_layer.get(&(lod_level, layer_id)) else {
            return Vec::new();
        };
        let mut indices: Vec<usize> = group
            .tree
            .locate_in_envelope_intersecting(rect_envelope(bbox))
            .map(|entry| entry.index)
            .collect();
        indices.sort_unstable();
        indices
            .into_iter()
            .filter_map(|index| tiles.get(index))
            .filter(|tile| tile.bbox.intersects(bbox))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(
        lod_level: u8,
        layer_id: u16,
        tile_x: i32,
        tile_y: i32,
        bbox: Rect32,
    ) -> GeometryViewTileRecord {
        GeometryViewTileRecord {
            lod_level,
            layer_id,
            tile_x,
            tile_y,
            shape_count: 1,
            bbox,
            ..GeometryViewTileRecord::default()
        }
    }

    fn query_naive(
        tiles: &[GeometryViewTileRecord],
        lod_level: u8,
        layer_id: u16,
        bbox: Rect32,
    ) -> Vec<&GeometryViewTileRecord> {
        tiles
            .iter()
            .filter(|tile| tile.shape_count > 0)
            .filter(|tile| tile.lod_level == lod_level && tile.layer_id == layer_id)
            .filter(|tile| tile.bbox.intersects(bbox))
            .collect()
    }

    fn sample_tiles() -> Vec<GeometryViewTileRecord> {
        let mut tiles = Vec::new();
        // lod 0 layer 4: a coarse grid including negative coordinates.
        for ty in -3..4 {
            for tx in -3..4 {
                let lx = tx * 100;
                let ly = ty * 100;
                tiles.push(tile(
                    0,
                    4,
                    tx,
                    ty,
                    Rect32 {
                        lx,
                        ly,
                        hx: lx + 90,
                        hy: ly + 90,
                    },
                ));
            }
        }
        // lod 1 layer 4: shifted grid so lods do not align.
        for ty in -2..3 {
            for tx in -2..3 {
                let lx = tx * 100 + 37;
                let ly = ty * 100 - 11;
                tiles.push(tile(
                    1,
                    4,
                    tx,
                    ty,
                    Rect32 {
                        lx,
                        ly,
                        hx: lx + 55,
                        hy: ly + 55,
                    },
                ));
            }
        }
        // lod 0 layer 9: disjoint layer.
        for ty in 0..3 {
            for tx in 0..3 {
                let lx = tx * 1000;
                let ly = ty * 1000;
                tiles.push(tile(
                    0,
                    9,
                    tx,
                    ty,
                    Rect32 {
                        lx,
                        ly,
                        hx: lx + 400,
                        hy: ly + 400,
                    },
                ));
            }
        }
        // A large-shape summary tile: bounding box far beyond its tile coords.
        tiles.push(tile(
            0,
            4,
            0,
            0,
            Rect32 {
                lx: -1000,
                ly: -1000,
                hx: 4000,
                hy: 4000,
            },
        ));
        // An empty tile must be excluded exactly like the linear scan did.
        tiles.push(GeometryViewTileRecord {
            lod_level: 0,
            layer_id: 4,
            shape_count: 0,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
            ..GeometryViewTileRecord::default()
        });
        tiles
    }

    #[test]
    fn spatial_queries_match_naive_linear_filter() {
        let tiles = sample_tiles();
        let index = ViewTileIndex::from_tiles(&tiles);
        let viewports = [
            Rect32 {
                lx: -5000,
                ly: -5000,
                hx: 5000,
                hy: 5000,
            },
            Rect32 {
                lx: -215,
                ly: -175,
                hx: 137,
                hy: 212,
            },
            Rect32 {
                lx: 89,
                ly: 90,
                hx: 91,
                hy: 92,
            },
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 0,
                hy: 0,
            },
            Rect32 {
                lx: 1_000_000,
                ly: 1_000_000,
                hx: 1_000_100,
                hy: 1_000_100,
            },
            Rect32 {
                lx: -63,
                ly: -63,
                hx: -62,
                hy: -62,
            },
        ];
        for lod in [0_u8, 1, 2, 3] {
            for layer in [4_u16, 9, 77] {
                for viewport in viewports {
                    let expected = query_naive(&tiles, lod, layer, viewport);
                    let hits = index.query_tiles(&tiles, lod, layer, viewport);
                    assert_eq!(
                        hits.iter()
                            .map(|tile| *tile as *const _)
                            .collect::<Vec<_>>(),
                        expected
                            .iter()
                            .map(|tile| *tile as *const _)
                            .collect::<Vec<_>>(),
                        "lod {lod} layer {layer} viewport {viewport:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn query_results_keep_original_tile_order() {
        let tiles = sample_tiles();
        let index = ViewTileIndex::from_tiles(&tiles);
        let hits = index.query_tiles(
            &tiles,
            0,
            4,
            Rect32 {
                lx: -5000,
                ly: -5000,
                hx: 5000,
                hy: 5000,
            },
        );
        let hit_positions: Vec<usize> = hits
            .iter()
            .map(|hit| {
                tiles
                    .iter()
                    .position(|tile| std::ptr::eq(*hit, tile))
                    .unwrap()
            })
            .collect();
        let mut sorted = hit_positions.clone();
        sorted.sort_unstable();
        assert_eq!(hit_positions, sorted);
    }

    #[test]
    fn empty_groups_and_missing_layers_return_no_hits() {
        let tiles = sample_tiles();
        let index = ViewTileIndex::from_tiles(&tiles);
        assert!(index
            .query_tiles(
                &tiles,
                3,
                4,
                Rect32 {
                    lx: -5000,
                    ly: -5000,
                    hx: 5000,
                    hy: 5000
                }
            )
            .is_empty());
        assert!(index
            .query_tiles(
                &tiles,
                0,
                77,
                Rect32 {
                    lx: -5000,
                    ly: -5000,
                    hx: 5000,
                    hy: 5000
                }
            )
            .is_empty());
    }

    #[test]
    fn edge_touching_tiles_intersect() {
        let tiles = [tile(
            0,
            4,
            0,
            0,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 100,
                hy: 100,
            },
        )];
        let index = ViewTileIndex::from_tiles(&tiles);
        let hits = index.query_tiles(
            &tiles,
            0,
            4,
            Rect32 {
                lx: 100,
                ly: 100,
                hx: 200,
                hy: 200,
            },
        );
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn die_sized_tile_bounding_boxes_do_not_overflow_i32_area() {
        // A die-sized bounding box has an area far above i32::MAX. Inserting
        // such envelopes one by one panics in debug builds inside rstar's
        // subtree selection; bulk loading must stay overflow-free.
        let tiles = vec![
            tile(
                3,
                8,
                0,
                0,
                Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 754_401,
                    hy: 755_801,
                },
            ),
            tile(
                3,
                8,
                1,
                0,
                Rect32 {
                    lx: 754_401,
                    ly: 0,
                    hx: 1_508_802,
                    hy: 755_801,
                },
            ),
        ];
        let index = ViewTileIndex::from_tiles(&tiles);
        let hits = index.query_tiles(
            &tiles,
            3,
            8,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 754_401,
                hy: 755_801,
            },
        );
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn heap_estimate_grows_with_tile_count() {
        let few = sample_tiles();
        let many: Vec<_> = few
            .iter()
            .copied()
            .cycle()
            .take(few.len() * 4)
            .enumerate()
            .map(|(index, mut tile)| {
                tile.lod_level = (index % 4) as u8;
                tile
            })
            .collect();
        let small = ViewTileIndex::from_tiles(&few);
        let large = ViewTileIndex::from_tiles(&many);
        assert!(large.estimated_heap_bytes() > small.estimated_heap_bytes());
    }
}
