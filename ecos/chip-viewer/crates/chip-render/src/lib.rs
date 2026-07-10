use std::collections::{BTreeMap, VecDeque};

use chip_view_db::ChipViewDb;
use chipgeom_format::{Rect32, ShapeId};

pub struct RenderPlanner;

impl RenderPlanner {
    pub fn visible_shape_ids(db: &ChipViewDb, layer_id: u16, viewport: Rect32) -> Vec<ShapeId> {
        db.query_layer_intersect(layer_id, viewport)
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RenderCacheStats {
    pub entries: usize,
    pub hits: usize,
    pub misses: usize,
}

pub struct RenderPlanCache {
    entries: BTreeMap<RenderPlanKey, Vec<ShapeId>>,
    hits: usize,
    max_entries: usize,
    misses: usize,
    order: VecDeque<RenderPlanKey>,
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

    pub fn get_or_insert_with(
        &mut self,
        key: RenderPlanKey,
        build: impl FnOnce() -> Vec<ShapeId>,
    ) -> Vec<ShapeId> {
        if let Some(shape_ids) = self.entries.get(&key) {
            self.hits += 1;
            return shape_ids.clone();
        }

        self.misses += 1;
        let shape_ids = build();
        self.insert(key, shape_ids.clone());
        shape_ids
    }

    pub fn stats(&self) -> RenderCacheStats {
        RenderCacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
        }
    }

    fn insert(&mut self, key: RenderPlanKey, shape_ids: Vec<ShapeId>) {
        if !self.entries.contains_key(&key) {
            self.order.push_back(key);
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
}
