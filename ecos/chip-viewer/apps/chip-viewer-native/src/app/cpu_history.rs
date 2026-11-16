//! Bounded history of exact views, accounting for mesh and bitmap capacities.

use super::{CpuScene, PriorityCache, SceneKey, SceneRequest};
use std::collections::VecDeque;
use std::mem::size_of;
use std::sync::Arc;

const MAX_SCENES: usize = 4;
const MAX_BYTES: usize = 192 * 1024 * 1024;

#[derive(Default)]
pub(super) struct CpuSceneHistory {
    history: History<CpuScene>,
}

impl CpuSceneHistory {
    pub(super) fn insert(&mut self, scene: Arc<CpuScene>) {
        let scene = if scene.bitmap.is_some() && scene.labels_ready() {
            Arc::new(CpuScene {
                key: scene.key.clone(),
                pattern_textures: Arc::clone(&scene.pattern_textures),
                generation: scene.generation,
                meshes: Vec::new(),
                fallback_meshes: std::sync::OnceLock::new(),
                labels: scene.labels.clone(),
                drawn: scene.drawn,
                primitives: scene.primitives,
                build_duration: scene.build_duration,
                pipeline_duration: scene.pipeline_duration,
                query_duration: scene.query_duration,
                filter_duration: scene.filter_duration,
                bitmap: scene.bitmap.as_ref().map(Arc::clone),
                retained: scene.retained.as_ref().map(Arc::clone),
                raster_duration: scene.raster_duration,
                completed_labels: Arc::clone(&scene.completed_labels),
                overlay_drawn: scene.overlay_drawn,
                initial_records: None,
                priority: scene.priority.as_ref().map(Arc::clone),
                priority_collector: None,
                world_source: None,
            })
        } else {
            scene
        };
        let bytes = retained_bytes(&scene.meshes, scene.bitmap.as_ref())
            .saturating_add(scene.retained.as_ref().map_or(0, |model| model.byte_len()))
            .saturating_add(scene.priority.as_ref().map_or(0, |cache| cache.byte_len()))
            .saturating_add(
                scene
                    .world_source
                    .as_ref()
                    .map_or(0, |source| source.byte_len()),
            );
        self.history.insert(scene.key().clone(), scene, bytes);
        self.trim_labels();
    }

    pub(super) fn get(&mut self, key: &SceneKey) -> Option<Arc<CpuScene>> {
        self.trim_labels();
        self.history.get(key)
    }

    pub(super) fn priority(&self, request: &SceneRequest) -> Option<Arc<PriorityCache>> {
        self.history
            .entries
            .iter()
            .rev()
            .filter_map(|entry| entry.value.priority.as_ref())
            .find(|cache| cache.compatible(request))
            .map(Arc::clone)
    }

    pub(super) fn clear(&mut self) {
        self.history.clear();
    }

    pub(super) fn byte_len(&self) -> usize {
        self.history
            .entries
            .iter()
            .fold(self.history.bytes, |bytes, entry| {
                bytes.saturating_add(entry.value.labels.byte_len())
            })
    }

    fn trim_labels(&mut self) {
        // Label completion can install the compact source after this scene was
        // inserted. Reconcile that asynchronous allocation before every lookup
        // or insertion. Shared sources are conservatively charged per entry.
        while self.byte_len() > MAX_BYTES {
            let Some(oldest) = self.history.entries.pop_front() else {
                break;
            };
            self.history.bytes -= oldest.bytes;
        }
    }
}

struct Entry<T> {
    key: SceneKey,
    value: Arc<T>,
    bytes: usize,
}

struct History<T> {
    entries: VecDeque<Entry<T>>,
    bytes: usize,
}

impl<T> Default for History<T> {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            bytes: 0,
        }
    }
}

impl<T> History<T> {
    fn insert(&mut self, key: SceneKey, value: Arc<T>, bytes: usize) {
        self.invalidate(&key);
        if bytes > MAX_BYTES {
            return;
        }
        if let Some(index) = self.entries.iter().position(|entry| entry.key == key) {
            let previous = self.entries.remove(index).expect("existing history entry");
            self.bytes -= previous.bytes;
        }
        while self.entries.len() >= MAX_SCENES || self.bytes > MAX_BYTES - bytes {
            let oldest = self.entries.pop_front().expect("nonempty bounded history");
            self.bytes -= oldest.bytes;
        }
        self.bytes += bytes;
        self.entries.push_back(Entry { key, value, bytes });
    }

    fn get(&mut self, key: &SceneKey) -> Option<Arc<T>> {
        self.invalidate(key);
        let index = self.entries.iter().position(|entry| entry.key == *key)?;
        let entry = self.entries.remove(index)?;
        let value = Arc::clone(&entry.value);
        self.entries.push_back(entry);
        Some(value)
    }

    fn invalidate(&mut self, key: &SceneKey) {
        if self.entries.back().is_some_and(|entry| {
            !entry.key.compatible(key)
                || entry.key.canvas != key.canvas
                || entry.key.screen_size != key.screen_size
        }) {
            self.clear();
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }
}

fn retained_bytes(meshes: &[egui::ClippedPrimitive], bitmap: Option<&Arc<[u8]>>) -> usize {
    let mut bytes = bitmap.map_or(0, |bitmap| bitmap.len());
    for primitive in meshes {
        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
            return usize::MAX;
        };
        bytes = bytes
            .saturating_add(
                mesh.vertices
                    .capacity()
                    .saturating_mul(size_of::<egui::epaint::Vertex>()),
            )
            .saturating_add(mesh.indices.capacity().saturating_mul(size_of::<u32>()))
            .saturating_add(
                mesh.vertices
                    .len()
                    .saturating_mul(size_of::<egui::epaint::Vertex>()),
            )
            .saturating_add(mesh.indices.len().saturating_mul(size_of::<u32>()));
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{ObjectVisibility, Rect32};
    use std::collections::BTreeSet;

    fn key(zoom: f32) -> SceneKey {
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        SceneKey {
            epoch: 1,
            layers: 1,
            visibility: ObjectVisibility::default(),
            world,
            viewport: world,
            canvas: egui::Rect::from_min_max(egui::pos2(10.0, 20.0), egui::pos2(510.0, 420.0)),
            zoom,
            pan: egui::Vec2::ZERO,
            pixels_per_point: 1.0,
            tessellation: egui::epaint::TessellationOptions::default(),
            font_texture_size: [1024, 1024],
            selected: None,
            highlighted: BTreeSet::new(),
            screen_size: [640, 480],
            background: egui::Color32::BLACK,
            grid_bounds: world,
            cache_overlays: false,
        }
    }

    #[test]
    fn default_and_clear_release_entries_and_bytes() {
        let mut history = History::default();
        assert!(history.get(&key(1.0)).is_none());
        assert_eq!(history.bytes, 0);
        let value = Arc::new(());
        history.insert(key(1.0), Arc::clone(&value), 100);
        history.clear();
        history.clear();
        assert!(history.entries.is_empty());
        assert_eq!(history.bytes, 0);
        assert_eq!(Arc::strong_count(&value), 1);
        history.insert(key(2.0), Arc::clone(&value), 7);
        assert!(Arc::ptr_eq(&history.get(&key(2.0)).unwrap(), &value));
        assert_eq!(history.bytes, 7);
    }

    #[test]
    fn exact_hits_reuse_the_original_arc() {
        let mut history = History::default();
        let value = Arc::new(());
        history.insert(key(1.0), Arc::clone(&value), 123);
        for _ in 0..3 {
            assert!(Arc::ptr_eq(&history.get(&key(1.0)).unwrap(), &value));
        }
        assert_eq!((history.entries.len(), history.bytes), (1, 123));
    }

    #[test]
    fn lookup_requires_the_complete_exact_key() {
        let original = key(1.0);
        let mut history = History::default();
        history.insert(original.clone(), Arc::new(()), 1);
        let mut changed_keys = Vec::new();
        let mut changed = original.clone();
        changed.zoom = f32::from_bits(original.zoom.to_bits() + 1);
        assert!(original.same_raster_scale(&changed));
        changed_keys.push(changed);
        let mut changed = original.clone();
        changed.pan.x += 1.0;
        changed_keys.push(changed);
        let mut changed = original.clone();
        changed.viewport.hx += 1;
        changed_keys.push(changed);
        let mut changed = original.clone();
        changed.selected = Some(1);
        changed_keys.push(changed);
        let mut changed = original.clone();
        changed.highlighted.insert(1);
        changed_keys.push(changed);
        let mut changed = original.clone();
        changed.font_texture_size[0] += 1;
        changed_keys.push(changed);
        for changed in changed_keys {
            assert!(
                history.get(&changed).is_none(),
                "unexpected hit: {changed:?}"
            );
        }
        assert!(history.get(&original).is_some());
    }

    #[test]
    fn successful_lookups_touch_lru_and_misses_do_not() {
        let mut history = History::default();
        for zoom in 1..=4 {
            history.insert(key(zoom as f32), Arc::new(()), zoom);
        }
        assert!(history.get(&key(1.0)).is_some());
        assert!(history.get(&key(9.0)).is_none());
        history.insert(key(5.0), Arc::new(()), 5);
        assert_eq!((history.entries.len(), history.bytes), (4, 13));
        assert!(history.get(&key(2.0)).is_none());
        assert!(history.get(&key(1.0)).is_some());
        for zoom in 3..=5 {
            assert!(history.get(&key(zoom as f32)).is_some());
        }
    }

    #[test]
    fn duplicate_keys_replace_payload_and_touch_lru() {
        let mut history = History::default();
        let previous = Arc::new(1);
        history.insert(key(1.0), Arc::clone(&previous), 10);
        for zoom in 2..=4 {
            history.insert(key(zoom as f32), Arc::new(zoom), 10);
        }
        let replacement = Arc::new(9);
        history.insert(key(1.0), Arc::clone(&replacement), 25);
        assert_eq!((history.entries.len(), history.bytes), (4, 55));
        assert_eq!(Arc::strong_count(&previous), 1);
        history.insert(key(5.0), Arc::new(5), 10);
        assert!(history.get(&key(2.0)).is_none());
        assert!(Arc::ptr_eq(&history.get(&key(1.0)).unwrap(), &replacement));
        assert_eq!(history.bytes, 55);
    }

    #[test]
    fn byte_limit_evicts_multiple_lru_entries() {
        let mut history = History::default();
        let quarter = MAX_BYTES / 4;
        for zoom in 1..=4 {
            history.insert(key(zoom as f32), Arc::new(()), quarter);
        }
        assert_eq!(history.bytes, MAX_BYTES);
        history.get(&key(1.0)).unwrap();
        history.insert(key(5.0), Arc::new(()), quarter * 3);
        assert_eq!((history.entries.len(), history.bytes), (2, MAX_BYTES));
        assert!(history.get(&key(1.0)).is_some());
        for zoom in 2..=4 {
            assert!(history.get(&key(zoom as f32)).is_none());
        }
        assert!(history.get(&key(5.0)).is_some());
    }

    #[test]
    fn exact_budget_is_allowed_and_oversized_insertions_leave_valid_history() {
        let mut history = History::default();
        history.insert(key(1.0), Arc::new(()), MAX_BYTES);
        for bytes in [MAX_BYTES + 1, usize::MAX] {
            history.insert(key(2.0), Arc::new(()), bytes);
            history.insert(key(1.0), Arc::new(()), bytes);
            assert_eq!((history.entries.len(), history.bytes), (1, MAX_BYTES));
            assert!(history.get(&key(1.0)).is_some());
            assert!(history.get(&key(2.0)).is_none());
        }
    }

    #[test]
    fn zero_payload_entries_still_obey_the_scene_limit() {
        let mut history = History::default();
        for zoom in 1..=5 {
            history.insert(key(zoom as f32), Arc::new(()), 0);
        }
        assert_eq!((history.entries.len(), history.bytes), (4, 0));
        assert!(history.get(&key(1.0)).is_none());
    }

    #[test]
    fn incompatible_inserts_and_changed_bounds_clear_old_views() {
        let original = key(1.0);
        let changes: &[fn(&mut SceneKey)] = &[
            |key| key.epoch += 1,
            |key| key.layers += 1,
            |key| key.visibility.set_all_visible(false),
            |key| key.world.hx += 1,
            |key| key.pixels_per_point = 2.0,
            |key| key.tessellation.feathering = !key.tessellation.feathering,
            |key| key.background = egui::Color32::WHITE,
            |key| key.grid_bounds.hx += 1,
            |key| key.cache_overlays = !key.cache_overlays,
            |key| key.screen_size[0] += 1,
            |key| key.canvas.max.x += 1.0,
            |key| key.canvas = key.canvas.translate(egui::vec2(1.0, 0.0)),
        ];
        for change in changes {
            let mut history = History::default();
            history.insert(original.clone(), Arc::new(()), 100);
            history.insert(key(2.0), Arc::new(()), 200);
            let mut changed = original.clone();
            change(&mut changed);
            history.insert(changed.clone(), Arc::new(()), 7);
            assert_eq!((history.entries.len(), history.bytes), (1, 7));
            assert!(history.get(&changed).is_some());
            assert!(history.get(&original).is_none(), "stale view: {changed:?}");
        }
    }

    #[test]
    fn rejected_incompatible_insert_still_invalidates_old_views() {
        let mut history = History::default();
        history.insert(key(1.0), Arc::new(()), 1);
        let mut changed = key(2.0);
        changed.epoch += 1;
        history.insert(changed, Arc::new(()), usize::MAX);
        assert_eq!((history.entries.len(), history.bytes), (0, 0));
        assert!(history.get(&key(1.0)).is_none());
    }

    #[test]
    fn incompatible_lookup_invalidates_before_a_replacement_finishes() {
        let changes: &[fn(&mut SceneKey)] = &[
            |key| key.epoch += 1,
            |key| key.layers += 1,
            |key| key.visibility.set_all_visible(false),
            |key| key.pixels_per_point = 2.0,
            |key| key.tessellation.feathering = !key.tessellation.feathering,
            |key| key.screen_size[0] += 1,
            |key| key.canvas.max.x += 1.0,
        ];
        for change in changes {
            let mut history = History::default();
            history.insert(key(1.0), Arc::new(()), 100);
            let mut changed = key(2.0);
            change(&mut changed);
            assert!(history.get(&changed).is_none());
            assert_eq!((history.entries.len(), history.bytes), (0, 0));
            assert!(history.get(&key(1.0)).is_none());
        }
    }

    #[test]
    fn retained_payload_counts_capacity_for_every_mesh_and_bitmap() {
        let meshes: Vec<_> = [(8, 12), (3, 6)]
            .into_iter()
            .map(|(vertices, indices)| egui::ClippedPrimitive {
                clip_rect: egui::Rect::EVERYTHING,
                primitive: egui::epaint::Primitive::Mesh(egui::Mesh {
                    vertices: Vec::with_capacity(vertices),
                    indices: Vec::with_capacity(indices),
                    ..Default::default()
                }),
            })
            .collect();
        let bitmap: Arc<[u8]> = vec![0; 4096].into();
        let expected = 11 * size_of::<egui::epaint::Vertex>() + 18 * size_of::<u32>();
        assert_eq!(retained_bytes(&meshes, None), expected);
        assert_eq!(retained_bytes(&meshes, Some(&bitmap)), expected + 4096);
        assert_eq!(retained_bytes(&[], None), 0);
    }

    #[test]
    fn opaque_callback_payloads_are_rejected() {
        let meshes = [egui::ClippedPrimitive {
            clip_rect: egui::Rect::EVERYTHING,
            primitive: egui::epaint::Primitive::Callback(egui::PaintCallback {
                rect: egui::Rect::EVERYTHING,
                callback: Arc::new(()),
            }),
        }];
        assert_eq!(retained_bytes(&meshes, None), usize::MAX);
    }
}
