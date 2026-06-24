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
            viewport_bucket: [0, 0, 100, 100],
            lod_level: "test".to_owned(),
            display_hash: 1,
            data_revision: 1,
            layer_mask_hash: 1,
            plane: name.to_owned(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CachedPlane {
    pub width: usize,
    pub height: usize,
    #[allow(dead_code)]
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
    entries: HashMap<PlaneKey, CachedPlane>,
    lru: VecDeque<PlaneKey>,
    stats: PlaneCacheStats,
}

impl PlaneCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: HashMap::new(),
            lru: VecDeque::new(),
            stats: PlaneCacheStats::default(),
        }
    }

    pub fn get(&mut self, key: &PlaneKey) -> Option<&CachedPlane> {
        if self.entries.contains_key(key) {
            self.stats.hits += 1;
            self.touch(key);
            self.entries.get(key)
        } else {
            self.stats.misses += 1;
            None
        }
    }

    pub fn insert(&mut self, key: PlaneKey, plane: CachedPlane) {
        if self.capacity == 0 {
            return;
        }

        self.entries.insert(key.clone(), plane);
        self.touch(&key);

        while self.entries.len() > self.capacity {
            if let Some(evicted_key) = self.lru.pop_front() {
                if self.entries.remove(&evicted_key).is_some() {
                    self.stats.evictions += 1;
                }
            } else {
                break;
            }
        }
    }

    pub fn stats(&self) -> PlaneCacheStats {
        self.stats
    }

    fn touch(&mut self, key: &PlaneKey) {
        self.lru.retain(|cached_key| cached_key != key);
        self.lru.push_back(key.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuses_matching_key_and_increments_hits() {
        let key = PlaneKey::for_test("metal1");
        let plane = CachedPlane::new_for_test(3, 2);
        let mut cache = PlaneCache::new(2);

        cache.insert(key.clone(), plane);

        let cached = cache.get(&key).expect("matching key should be cached");
        assert_eq!(cached.width, 3);
        assert_eq!(cached.height, 2);
        assert_eq!(
            cache.stats(),
            PlaneCacheStats {
                hits: 1,
                misses: 0,
                evictions: 0
            }
        );
    }

    #[test]
    fn evicts_least_recently_used_plane() {
        let key_a = PlaneKey::for_test("a");
        let key_b = PlaneKey::for_test("b");
        let key_c = PlaneKey::for_test("c");
        let mut cache = PlaneCache::new(2);

        cache.insert(key_a.clone(), CachedPlane::new_for_test(1, 1));
        cache.insert(key_b.clone(), CachedPlane::new_for_test(2, 1));
        assert!(cache.get(&key_a).is_some(), "get should touch key a");

        cache.insert(key_c.clone(), CachedPlane::new_for_test(3, 1));

        assert!(cache.get(&key_b).is_none(), "key b should be evicted");
        assert!(cache.get(&key_a).is_some(), "key a should remain cached");
        assert!(cache.get(&key_c).is_some(), "key c should be cached");
        assert_eq!(cache.stats().evictions, 1);
    }

    #[test]
    fn get_miss_increments_misses() {
        let mut cache = PlaneCache::new(1);

        assert!(cache.get(&PlaneKey::for_test("missing")).is_none());

        assert_eq!(
            cache.stats(),
            PlaneCacheStats {
                hits: 0,
                misses: 1,
                evictions: 0
            }
        );
    }

    #[test]
    fn capacity_zero_is_safe() {
        let key = PlaneKey::for_test("zero");
        let mut cache = PlaneCache::new(0);

        cache.insert(key.clone(), CachedPlane::new_for_test(1, 1));

        assert!(cache.get(&key).is_none());
        assert_eq!(cache.stats().hits, 0);
        assert_eq!(cache.stats().misses, 1);
    }
}
