//! Bounded real-record hints captured during a complete source render. Selection
//! uses only cached boxes; the seed renderer still filters and draws actual IDs.
use super::*;
use chip_display::LayerStyle;
use std::cmp::{Ordering as Compare, Reverse};
use std::collections::BinaryHeap;
use std::sync::Weak;

const PER_LAYER: usize = 2048;
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app::cpu_scene) struct PreviewRecord {
    pub(super) id: ShapeId,
    pub(super) bbox: Rect32,
    pub(super) layer: LayerId,
    chromatic: bool,
}

impl PreviewRecord {
    pub(super) fn new(id: ShapeId, bbox: Rect32, style: LayerStyle) -> Self {
        let chromatic = [style.rgba, style.frame_rgba].iter().any(|rgba| {
            rgba[3] > 0 && *rgba[..3].iter().max().unwrap() - *rgba[..3].iter().min().unwrap() > 25
        });
        Self {
            id,
            bbox,
            layer: style.layer_id,
            chromatic,
        }
    }

    fn rank(&self) -> (i64, i64, Reverse<ShapeId>) {
        let w = (i64::from(self.bbox.hx) - i64::from(self.bbox.lx)).max(0);
        let h = (i64::from(self.bbox.hy) - i64::from(self.bbox.ly)).max(0);
        (w.max(h), w + h, Reverse(self.id))
    }
}

impl Ord for PreviewRecord {
    fn cmp(&self, other: &Self) -> Compare {
        self.rank()
            .cmp(&other.rank())
            .then_with(|| self.layer.cmp(&other.layer))
            .then_with(|| {
                (self.bbox.lx, self.bbox.ly, self.bbox.hx, self.bbox.hy).cmp(&(
                    other.bbox.lx,
                    other.bbox.ly,
                    other.bbox.hx,
                    other.bbox.hy,
                ))
            })
            .then_with(|| self.chromatic.cmp(&other.chromatic))
    }
}
impl PartialOrd for PreviewRecord {
    fn partial_cmp(&self, other: &Self) -> Option<Compare> {
        Some(self.cmp(other))
    }
}

struct CacheKey {
    db: Weak<ChipViewDb>,
    epoch: u64,
    layers: u64,
    visibility: ObjectVisibility,
    world: Rect32,
    styles: Box<[(LayerId, LayerStyle)]>,
    requested_layers: Box<[LayerId]>,
    layer_visibility: u64,
    grid_rules: (bool, bool),
}

impl CacheKey {
    fn requested_layers(request: &SceneRequest) -> Box<[LayerId]> {
        let mut layers = request.layer_ids.clone();
        layers.sort_unstable();
        layers.dedup();
        layers.into_boxed_slice()
    }
    fn same_source(&self, other: &Self) -> bool {
        self.db.ptr_eq(&other.db)
            && self.epoch == other.epoch
            && self.layers == other.layers
            && self.visibility == other.visibility
            && self.world == other.world
            && self.styles == other.styles
            && self.requested_layers == other.requested_layers
            && self.layer_visibility == other.layer_visibility
            && self.grid_rules == other.grid_rules
    }
    fn new(request: &SceneRequest) -> Self {
        Self {
            db: Arc::downgrade(&request.db),
            epoch: request.key.epoch,
            layers: request.key.layers,
            visibility: request.key.visibility,
            world: request.key.world,
            styles: request
                .layers
                .style_map
                .iter()
                .map(|(&id, &style)| (id, style))
                .collect(),
            requested_layers: Self::requested_layers(request),
            layer_visibility: request.layers.visibility_hash(),
            grid_rules: (
                request.zoom_rules.track_grid_suppressed,
                request.zoom_rules.gcell_grid_suppressed,
            ),
        }
    }

    fn compatible(&self, request: &SceneRequest) -> bool {
        self.db.as_ptr() == Arc::as_ptr(&request.db)
            && self.epoch == request.key.epoch
            && self.layers == request.key.layers
            && self.visibility == request.key.visibility
            && self.world == request.key.world
            && self.layer_visibility == request.layers.visibility_hash()
            && self.grid_rules
                == (
                    request.zoom_rules.track_grid_suppressed,
                    request.zoom_rules.gcell_grid_suppressed,
                )
            && self.styles.len() == request.layers.style_map.len()
            && self.requested_layers == Self::requested_layers(request)
            && self
                .styles
                .iter()
                .zip(&request.layers.style_map)
                .all(|((a, b), (c, d))| a == c && b == d)
    }
}

pub(in crate::app::cpu_scene) struct PriorityCache {
    key: CacheKey,
    records: Box<[PreviewRecord]>,
}

impl PriorityCache {
    pub(in crate::app::cpu_scene) fn compatible(&self, request: &SceneRequest) -> bool {
        self.key.compatible(request)
    }

    pub(in crate::app::cpu_scene) fn byte_len(&self) -> usize {
        size_of::<Self>()
            + std::mem::size_of_val(self.records.as_ref())
            + std::mem::size_of_val(self.key.styles.as_ref())
            + std::mem::size_of_val(self.key.requested_layers.as_ref())
    }

    /// No database/owner access, no full sort. Returned IDs are in requested
    /// layer order, then ShapeID; callers apply current render policy once.
    pub(in crate::app::cpu_scene) fn select(
        &self,
        request: &SceneRequest,
        quota: usize,
    ) -> Vec<(LayerId, ShapeId)> {
        if quota == 0 || !self.compatible(request) {
            return Vec::new();
        }
        let pass = chip_render::geometry2d::GeometryPass::new(
            request.key.world,
            request.key.canvas,
            request.key.zoom,
            request.key.pan,
        );
        let mut candidates = Vec::new();
        let mut previous = None;
        let mut rank = None;
        for record in &self.records {
            if previous != Some(record.layer) {
                previous = Some(record.layer);
                rank = request
                    .layer_ids
                    .iter()
                    .position(|layer| *layer == record.layer);
            }
            let Some(layer_rank) = rank else {
                continue;
            };
            if !record.chromatic || !record.bbox.intersects(request.key.viewport) {
                continue;
            }
            let bounds = pass
                .project(chip_view_db::ShapeGeometry::Rect(record.bbox))
                .bounds()
                .intersect(request.key.canvas);
            if bounds.is_positive() {
                candidates.push((
                    bounds.width().max(bounds.height()),
                    layer_rank,
                    record.layer,
                    record.id,
                ));
            }
        }
        let compare = |a: &(f32, usize, LayerId, ShapeId), b: &(f32, usize, LayerId, ShapeId)| {
            b.0.total_cmp(&a.0)
                .then_with(|| a.1.cmp(&b.1))
                .then_with(|| a.3.cmp(&b.3))
        };
        if candidates.len() > quota {
            candidates.select_nth_unstable_by(quota, compare);
            candidates.truncate(quota);
        }
        candidates.sort_unstable_by_key(|&(_, rank, _, id)| (rank, id));
        candidates
            .into_iter()
            .map(|(_, _, layer, id)| (layer, id))
            .collect()
    }
}

pub(in crate::app::cpu_scene) struct PriorityBuilder {
    key: CacheKey,
    heaps: BTreeMap<LayerId, BinaryHeap<Reverse<PreviewRecord>>>,
    count: usize,
    overflow: bool,
}

impl PriorityBuilder {
    pub(in crate::app::cpu_scene) fn eligible(request: &SceneRequest) -> bool {
        request.data_bounds.is_some_and(|world| {
            let view = request.key.viewport;
            view.lx <= world.lx && view.ly <= world.ly && view.hx >= world.hx && view.hy >= world.hy
        }) && !request
            .priority
            .as_ref()
            .is_some_and(|cache| cache.compatible(request))
    }

    pub(in crate::app::cpu_scene) fn new(request: &SceneRequest) -> Option<Self> {
        Self::eligible(request).then(|| Self {
            key: CacheKey::new(request),
            heaps: BTreeMap::new(),
            count: 0,
            overflow: false,
        })
    }

    pub(in crate::app::cpu_scene) fn observe(
        &mut self,
        id: ShapeId,
        bbox: Rect32,
        style: LayerStyle,
    ) {
        self.push(PreviewRecord::new(id, bbox, style));
    }

    pub(super) fn push(&mut self, record: PreviewRecord) {
        if self.overflow {
            return;
        }
        let heap = self.heaps.entry(record.layer).or_default();
        if heap.len() == PER_LAYER {
            if record > heap.peek().unwrap().0 {
                *heap.peek_mut().unwrap() = Reverse(record);
            }
        } else {
            heap.push(Reverse(record));
            self.count += 1;
            if self.count * size_of::<PreviewRecord>()
                + size_of::<PriorityCache>()
                + std::mem::size_of_val(self.key.styles.as_ref())
                + std::mem::size_of_val(self.key.requested_layers.as_ref())
                > MAX_BYTES
            {
                self.overflow = true;
                self.heaps.clear();
            }
        }
    }

    pub(super) fn merge(&mut self, other: Self, is_current: &impl Fn() -> bool) -> Option<()> {
        if !is_current() {
            return None;
        }
        if !self.key.same_source(&other.key) {
            return None;
        }
        if other.overflow {
            self.overflow = true;
            self.heaps.clear();
        }
        for (index, Reverse(record)) in other.heaps.into_values().flatten().enumerate() {
            if index % 64 == 0 && !is_current() {
                return None;
            }
            self.push(record);
        }
        is_current().then_some(())
    }

    /// Call only after the complete ordered source stream and overlays finish.
    pub(in crate::app::cpu_scene) fn finish(
        self,
        is_current: &impl Fn() -> bool,
    ) -> Option<Arc<PriorityCache>> {
        if self.overflow || !is_current() {
            return None;
        }
        let mut records = Vec::with_capacity(self.count);
        for heap in self.heaps.into_values() {
            if !is_current() {
                return None;
            }
            records.extend(heap.into_iter().map(|Reverse(record)| record));
        }
        records.sort_unstable_by_key(|record| (record.layer, record.id));
        records.dedup_by_key(|record| (record.layer, record.id));
        let cache = PriorityCache {
            key: self.key,
            records: records.into_boxed_slice(),
        };
        (is_current() && cache.byte_len() <= MAX_BYTES).then(|| Arc::new(cache))
    }
}

#[cfg(test)]
#[path = "cpu_preview_priority_tests.rs"]
mod tests;
