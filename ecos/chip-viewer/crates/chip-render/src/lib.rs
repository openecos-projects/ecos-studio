use std::collections::{BTreeMap, VecDeque};

use chip_view_db::ChipViewDb;
use chipgeom_format::{GeometryViewTileRecord, Rect32, ShapeId};

pub struct RenderPlanner;

impl RenderPlanner {
    pub fn visible_shape_ids(db: &ChipViewDb, layer_id: u16, viewport: Rect32) -> Vec<ShapeId> {
        db.query_layer_intersect(layer_id, viewport)
    }

    pub fn visible_shape_ids_for_layers(
        db: &ChipViewDb,
        layer_ids: &[u16],
        viewport: Rect32,
    ) -> Vec<ShapeId> {
        db.query_layers_intersect(layer_ids, viewport)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RenderPlanKey {
    layer_id: u16,
    lx: i32,
    ly: i32,
    hx: i32,
    hy: i32,
}

impl RenderPlanKey {
    pub fn new(layer_id: u16, viewport: Rect32) -> Self {
        let viewport = normalize_rect(viewport);
        Self {
            layer_id,
            lx: viewport.lx,
            ly: viewport.ly,
            hx: viewport.hx,
            hy: viewport.hy,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RenderLayersPlanKey {
    layer_ids: Vec<u16>,
    lx: i32,
    ly: i32,
    hx: i32,
    hy: i32,
}

impl RenderLayersPlanKey {
    pub fn new(layer_ids: &[u16], viewport: Rect32) -> Self {
        let viewport = normalize_rect(viewport);
        let mut layer_ids = layer_ids.to_vec();
        layer_ids.sort_unstable();
        layer_ids.dedup();
        Self {
            layer_ids,
            lx: viewport.lx,
            ly: viewport.ly,
            hx: viewport.hx,
            hy: viewport.hy,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum RenderPlanCacheKey {
    Layer(RenderPlanKey),
    Layers(RenderLayersPlanKey),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RenderCacheStats {
    pub entries: usize,
    pub hits: usize,
    pub misses: usize,
}

pub struct RenderPlanCache {
    entries: BTreeMap<RenderPlanCacheKey, Vec<ShapeId>>,
    hits: usize,
    max_entries: usize,
    misses: usize,
    order: VecDeque<RenderPlanCacheKey>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ViewTilePlaneKey {
    lod_level: u8,
    layer_id: u16,
    lx: i32,
    ly: i32,
    hx: i32,
    hy: i32,
}

impl ViewTilePlaneKey {
    pub fn new(lod_level: u8, layer_id: u16, viewport: Rect32) -> Self {
        let viewport = normalize_rect(viewport);
        Self {
            lod_level,
            layer_id,
            lx: viewport.lx,
            ly: viewport.ly,
            hx: viewport.hx,
            hy: viewport.hy,
        }
    }
}

pub struct ViewTilePlaneCache {
    entries: BTreeMap<ViewTilePlaneKey, Vec<GeometryViewTileRecord>>,
    hits: usize,
    max_entries: usize,
    misses: usize,
    order: VecDeque<ViewTilePlaneKey>,
}

impl RenderPlanCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            hits: 0,
            max_entries: max_entries.max(1),
            misses: 0,
            order: VecDeque::new(),
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.hits = 0;
        self.misses = 0;
    }

    pub fn visible_shape_ids(
        &mut self,
        db: &ChipViewDb,
        layer_id: u16,
        viewport: Rect32,
    ) -> Vec<ShapeId> {
        let key = RenderPlanKey::new(layer_id, viewport);
        self.get_or_insert_with(key, || {
            RenderPlanner::visible_shape_ids(db, layer_id, viewport)
        })
    }

    pub fn visible_shape_ids_for_layers(
        &mut self,
        db: &ChipViewDb,
        layer_ids: &[u16],
        viewport: Rect32,
    ) -> Vec<ShapeId> {
        let key = RenderLayersPlanKey::new(layer_ids, viewport);
        self.get_or_insert_layers_with(key, || {
            RenderPlanner::visible_shape_ids_for_layers(db, layer_ids, viewport)
        })
    }

    pub fn get_or_insert_with(
        &mut self,
        key: RenderPlanKey,
        build: impl FnOnce() -> Vec<ShapeId>,
    ) -> Vec<ShapeId> {
        self.get_or_insert_cache_key_with(RenderPlanCacheKey::Layer(key), build)
    }

    pub fn get_or_insert_layers_with(
        &mut self,
        key: RenderLayersPlanKey,
        build: impl FnOnce() -> Vec<ShapeId>,
    ) -> Vec<ShapeId> {
        self.get_or_insert_cache_key_with(RenderPlanCacheKey::Layers(key), build)
    }

    fn get_or_insert_cache_key_with(
        &mut self,
        key: RenderPlanCacheKey,
        build: impl FnOnce() -> Vec<ShapeId>,
    ) -> Vec<ShapeId> {
        if let Some(shape_ids) = self.entries.get(&key) {
            self.hits += 1;
            return shape_ids.clone();
        }

        self.misses += 1;
        let shape_ids = build();
        self.insert_cache_key(key, shape_ids.clone());
        shape_ids
    }

    pub fn stats(&self) -> RenderCacheStats {
        RenderCacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
        }
    }

    fn insert_cache_key(&mut self, key: RenderPlanCacheKey, shape_ids: Vec<ShapeId>) {
        if !self.entries.contains_key(&key) {
            self.order.push_back(key.clone());
        }
        self.entries.insert(key, shape_ids);

        while self.entries.len() > self.max_entries {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }
}

impl ViewTilePlaneCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            hits: 0,
            max_entries: max_entries.max(1),
            misses: 0,
            order: VecDeque::new(),
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.hits = 0;
        self.misses = 0;
    }

    pub fn visible_tiles(
        &mut self,
        db: &ChipViewDb,
        lod_level: u8,
        layer_id: u16,
        viewport: Rect32,
    ) -> Vec<GeometryViewTileRecord> {
        let key = ViewTilePlaneKey::new(lod_level, layer_id, viewport);
        self.get_or_insert_with(key, || {
            db.query_view_tiles(lod_level, layer_id, viewport)
                .into_iter()
                .copied()
                .collect()
        })
    }

    pub fn get_or_insert_with(
        &mut self,
        key: ViewTilePlaneKey,
        build: impl FnOnce() -> Vec<GeometryViewTileRecord>,
    ) -> Vec<GeometryViewTileRecord> {
        if let Some(tiles) = self.entries.get(&key) {
            self.hits += 1;
            return tiles.clone();
        }

        self.misses += 1;
        let tiles = build();
        self.insert(key, tiles.clone());
        tiles
    }

    pub fn stats(&self) -> RenderCacheStats {
        RenderCacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
        }
    }

    fn insert(&mut self, key: ViewTilePlaneKey, tiles: Vec<GeometryViewTileRecord>) {
        if !self.entries.contains_key(&key) {
            self.order.push_back(key);
        }
        self.entries.insert(key, tiles);

        while self.entries.len() > self.max_entries {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }
}

impl Default for ViewTilePlaneCache {
    fn default() -> Self {
        Self::new(64)
    }
}

impl Default for RenderPlanCache {
    fn default() -> Self {
        Self::new(64)
    }
}

fn normalize_rect(rect: Rect32) -> Rect32 {
    Rect32 {
        lx: rect.lx.min(rect.hx),
        ly: rect.ly.min(rect.hy),
        hx: rect.lx.max(rect.hx),
        hy: rect.ly.max(rect.hy),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_plan_cache_reuses_identical_layer_viewport_queries() {
        let mut cache = RenderPlanCache::new(8);
        let key = RenderPlanKey::new(
            3,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
        );
        let mut calls = 0;

        assert_eq!(
            cache.get_or_insert_with(key, || {
                calls += 1;
                vec![10, 20]
            }),
            vec![10, 20]
        );
        assert_eq!(
            cache.get_or_insert_with(key, || {
                calls += 1;
                vec![30]
            }),
            vec![10, 20]
        );

        assert_eq!(calls, 1);
        assert_eq!(cache.stats().hits, 1);
        assert_eq!(cache.stats().misses, 1);
    }

    #[test]
    fn render_plan_cache_evicts_oldest_key_when_full() {
        let mut cache = RenderPlanCache::new(1);
        let first = RenderPlanKey::new(
            1,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
        );
        let second = RenderPlanKey::new(
            2,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
        );

        assert_eq!(cache.get_or_insert_with(first, || vec![1]), vec![1]);
        assert_eq!(cache.get_or_insert_with(second, || vec![2]), vec![2]);
        assert_eq!(cache.get_or_insert_with(first, || vec![3]), vec![3]);

        assert_eq!(cache.stats().entries, 1);
        assert_eq!(cache.stats().misses, 3);
    }

    #[test]
    fn render_plan_cache_reuses_identical_layer_set_viewport_queries() {
        let mut cache = RenderPlanCache::new(8);
        let key = RenderLayersPlanKey::new(
            &[3, 1, 3],
            Rect32 {
                lx: 10,
                ly: 20,
                hx: 0,
                hy: 5,
            },
        );
        let same_key = RenderLayersPlanKey::new(
            &[1, 3],
            Rect32 {
                lx: 0,
                ly: 5,
                hx: 10,
                hy: 20,
            },
        );
        let mut calls = 0;

        assert_eq!(
            cache.get_or_insert_layers_with(key, || {
                calls += 1;
                vec![10, 20, 30]
            }),
            vec![10, 20, 30]
        );
        assert_eq!(
            cache.get_or_insert_layers_with(same_key, || {
                calls += 1;
                vec![40]
            }),
            vec![10, 20, 30]
        );

        assert_eq!(calls, 1);
        assert_eq!(cache.stats().entries, 1);
        assert_eq!(cache.stats().hits, 1);
        assert_eq!(cache.stats().misses, 1);
    }

    #[test]
    fn render_plan_cache_eviction_counts_single_and_layer_set_keys_together() {
        let mut cache = RenderPlanCache::new(1);
        let single_key = RenderPlanKey::new(
            1,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
        );
        let layer_set_key = RenderLayersPlanKey::new(
            &[1, 2],
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
        );

        assert_eq!(cache.get_or_insert_with(single_key, || vec![1]), vec![1]);
        assert_eq!(
            cache.get_or_insert_layers_with(layer_set_key, || vec![2]),
            vec![2]
        );
        assert_eq!(cache.get_or_insert_with(single_key, || vec![3]), vec![3]);

        assert_eq!(cache.stats().entries, 1);
        assert_eq!(cache.stats().misses, 3);
    }

    #[test]
    fn view_tile_plane_cache_reuses_identical_lod_layer_viewport_queries() {
        let mut cache = ViewTilePlaneCache::new(8);
        let key = ViewTilePlaneKey::new(
            2,
            3,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
        );
        let mut calls = 0;

        let first = cache.get_or_insert_with(key, || {
            calls += 1;
            vec![chipgeom_format::GeometryViewTileRecord {
                lod_level: 2,
                layer_id: 3,
                shape_count: 4,
                ..chipgeom_format::GeometryViewTileRecord::default()
            }]
        });
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].lod_level, 2);
        assert_eq!(first[0].layer_id, 3);
        assert_eq!(first[0].shape_count, 4);
        assert_eq!(cache.get_or_insert_with(key, || Vec::new()).len(), 1);

        assert_eq!(calls, 1);
        assert_eq!(cache.stats().hits, 1);
        assert_eq!(cache.stats().misses, 1);
    }

    #[test]
    fn view_tile_plane_cache_evicts_oldest_key_when_full() {
        let mut cache = ViewTilePlaneCache::new(1);
        let first = ViewTilePlaneKey::new(
            1,
            1,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
        );
        let second = ViewTilePlaneKey::new(
            1,
            2,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 1,
                hy: 1,
            },
        );

        assert_eq!(
            cache.get_or_insert_with(first, || vec![chipgeom_format::GeometryViewTileRecord {
                layer_id: 1,
                ..chipgeom_format::GeometryViewTileRecord::default()
            }])[0]
                .layer_id,
            1
        );
        assert_eq!(
            cache.get_or_insert_with(second, || vec![chipgeom_format::GeometryViewTileRecord {
                layer_id: 2,
                ..chipgeom_format::GeometryViewTileRecord::default()
            }])[0]
                .layer_id,
            2
        );
        assert_eq!(
            cache.get_or_insert_with(first, || vec![chipgeom_format::GeometryViewTileRecord {
                layer_id: 3,
                ..chipgeom_format::GeometryViewTileRecord::default()
            }])[0]
                .layer_id,
            3
        );

        assert_eq!(cache.stats().entries, 1);
        assert_eq!(cache.stats().misses, 3);
    }

    #[test]
    fn view_tile_plane_cache_clear_resets_entries_and_stats() {
        let mut cache = ViewTilePlaneCache::new(8);
        let key = ViewTilePlaneKey::new(
            2,
            3,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
        );

        assert_eq!(
            cache.get_or_insert_with(key, || vec![chipgeom_format::GeometryViewTileRecord {
                layer_id: 3,
                ..chipgeom_format::GeometryViewTileRecord::default()
            }])[0]
                .layer_id,
            3
        );
        assert_eq!(cache.get_or_insert_with(key, || Vec::new()).len(), 1);
        assert_eq!(cache.stats().hits, 1);
        assert_eq!(cache.stats().misses, 1);

        cache.clear();

        assert_eq!(cache.stats(), RenderCacheStats::default());
    }
}
