//! Bounded decoded-frame cache; accounting includes JSON strings and tree overhead.
use chipgeom_format::replay::{Delta, Object, Orientation};
use serde_json::Value;
use std::collections::VecDeque;

pub struct DeltaCache {
    entries: VecDeque<(usize, usize, Delta)>,
    // Large routing checkpoints cannot fit the ordinary delta budget. Retain
    // at most the two used by a transition/seek; objects are shared with Scenes.
    // The additional byte budget is eight times the ordinary budget, capped
    // at 1 GiB; disabling the cache disables both. Scene/anchor memory is separate.
    checkpoints: VecDeque<(usize, usize, Delta)>,
    checkpoint_used: usize,
    checkpoint_limit: usize,
    used: usize,
    limit: usize,
}
impl Default for DeltaCache {
    fn default() -> Self {
        let mib = std::env::var("ECOS_REPLAY_CACHE_MIB")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(128)
            .min(512);
        Self {
            entries: VecDeque::new(),
            checkpoints: VecDeque::new(),
            checkpoint_used: 0,
            checkpoint_limit: (mib * 8).min(1024) * 1024 * 1024,
            used: 0,
            limit: mib * 1024 * 1024,
        }
    }
}
impl DeltaCache {
    pub fn get(&mut self, index: usize) -> Option<Delta> {
        if let Some(at) = self.checkpoints.iter().position(|(id, _, _)| *id == index) {
            let entry = self.checkpoints.remove(at)?;
            let result = entry.2.clone();
            self.checkpoints.push_back(entry);
            return Some(result);
        }
        let at = self.entries.iter().position(|(id, _, _)| *id == index)?;
        let entry = self.entries.remove(at)?;
        let result = entry.2.clone();
        self.entries.push_back(entry);
        Some(result)
    }
    pub fn insert(&mut self, index: usize, delta: &Delta) {
        let strings = delta
            .remove
            .iter()
            .chain(delta.touched.iter())
            .chain(delta.restored.iter())
            .map(|s| s.capacity() + 96)
            .sum::<usize>();
        let objects = delta
            .upsert
            .iter()
            .map(|(key, object)| (key, object.as_ref()))
            .chain(delta.deleted.iter())
            .map(|(key, object)| key.capacity() + object_bytes(object) + 128)
            .sum::<usize>();
        let size = std::mem::size_of::<Delta>()
            + strings
            + objects
            + delta
                .translate
                .keys()
                .map(|id| id.capacity() + 128)
                .sum::<usize>();
        if size > self.limit {
            if size <= self.checkpoint_limit && delta.checkpoint && delta.base_checkpoint.is_none()
            {
                if let Some(at) = self.checkpoints.iter().position(|(id, _, _)| *id == index) {
                    self.checkpoint_used -= self.checkpoints.remove(at).unwrap().1;
                }
                while self.checkpoints.len() >= 2
                    || self.checkpoint_used + size > self.checkpoint_limit
                {
                    let Some((_, bytes, _)) = self.checkpoints.pop_front() else {
                        break;
                    };
                    self.checkpoint_used -= bytes;
                }
                self.checkpoint_used += size;
                self.checkpoints.push_back((index, size, delta.clone()));
            }
            return;
        }
        while self.used + size > self.limit {
            let Some((_, bytes, _)) = self.entries.pop_front() else {
                break;
            };
            self.used -= bytes;
        }
        self.used += size;
        self.entries.push_back((index, size, delta.clone()));
    }
}
fn object_bytes(object: &Object) -> usize {
    std::mem::size_of::<Object>()
        + object.name.capacity()
        + object.kind.capacity()
        + object.layer.capacity()
        + object.master.capacity()
        + match &object.orient {
            Some(Orientation::Name(s)) => s.capacity(),
            _ => 0,
        }
        + object
            .attributes
            .iter()
            .map(|(k, v)| k.capacity() + value_bytes(v) + 128)
            .sum::<usize>()
}
fn value_bytes(value: &Value) -> usize {
    std::mem::size_of::<Value>()
        + match value {
            Value::String(s) => s.capacity(),
            Value::Array(v) => {
                v.capacity() * std::mem::size_of::<Value>()
                    + v.iter().map(value_bytes).sum::<usize>()
            }
            Value::Object(o) => o
                .iter()
                .map(|(k, v)| k.capacity() + value_bytes(v) + 128)
                .sum::<usize>(),
            _ => 0,
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_evicts_old_frames_and_zero_budget_keeps_nothing() {
        let delta: Delta = serde_json::from_value(serde_json::json!({
            "sequence":0,"base_revision":-1,"checkpoint":true,
            "upsert":{},"remove":[],"touched":[]
        }))
        .unwrap();
        let mut cache = DeltaCache {
            entries: VecDeque::new(),
            checkpoints: VecDeque::new(),
            checkpoint_used: 0,
            checkpoint_limit: 0,
            used: 0,
            limit: std::mem::size_of::<Delta>(),
        };
        cache.insert(0, &delta);
        cache.insert(1, &delta);
        assert!(cache.get(0).is_none());
        assert!(cache.get(1).is_some());
        assert!(cache.used <= cache.limit);
        cache.limit = 0;
        cache.entries.clear();
        cache.checkpoints.clear();
        cache.used = 0;
        cache.insert(2, &delta);
        assert!(cache.get(2).is_none());
    }

    #[test]
    fn oversized_checkpoints_share_objects_and_evict_in_lru_order() {
        let delta: Delta = serde_json::from_value(serde_json::json!({
            "sequence":0,"base_revision":-1,"checkpoint":true,
            "upsert":{"wire":{"kind":"wire","bbox":[0,0,100,10]}},
            "remove":[],"touched":[]
        }))
        .unwrap();
        let mut cache = DeltaCache {
            entries: VecDeque::new(),
            checkpoints: VecDeque::new(),
            checkpoint_used: 0,
            checkpoint_limit: 1024 * 1024,
            used: 0,
            limit: 1,
        };
        cache.insert(0, &delta);
        cache.insert(1, &delta);
        let first = cache.get(0).unwrap();
        assert!(std::sync::Arc::ptr_eq(
            &first.upsert["wire"],
            &delta.upsert["wire"]
        ));
        cache.insert(2, &delta);
        assert!(cache.get(1).is_none());
        assert!(cache.get(0).is_some());
        assert!(cache.get(2).is_some());
        assert!(cache.entries.is_empty());
        assert_eq!(cache.checkpoints.len(), 2);
        let mut sparse = delta.clone();
        sparse.checkpoint = false;
        cache.insert(3, &sparse);
        assert!(cache.get(3).is_none());
        let one_frame = cache.checkpoint_used / 2;
        cache.checkpoint_limit = one_frame;
        cache.insert(4, &delta);
        assert_eq!(cache.checkpoints.len(), 1);
        assert!(cache.get(0).is_none());
        assert!(cache.get(4).is_some());
        assert_eq!(cache.checkpoint_used, one_frame);
        cache.checkpoint_limit = one_frame - 1;
        cache.insert(5, &delta);
        assert!(cache.get(5).is_none());
    }
}
