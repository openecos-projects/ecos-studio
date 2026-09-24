use super::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::Arc;

struct TileRequest {
    key: crate::canvas_gpu::GpuBufferKey,
    bbox: Rect32,
    layer_ids: Vec<LayerId>,
    layers: LayerRenderIndex,
    build_labels: bool,
}

type TileResponse = (crate::canvas_gpu::GpuBufferKey, Arc<GpuTileData>);

pub(super) struct GpuTileWorker {
    requests: SyncSender<TileRequest>,
    responses: Receiver<TileResponse>,
    pending: HashSet<crate::canvas_gpu::GpuBufferKey>,
    active_epoch: Arc<AtomicU64>,
    active_layers: Arc<AtomicU64>,
    cancelled: Arc<AtomicBool>,
}

impl GpuTileWorker {
    pub(super) fn new(db: Arc<ChipViewDb>) -> Self {
        let (requests, incoming) = sync_channel::<TileRequest>(4);
        let (outgoing, responses) = mpsc::channel();
        let active_epoch = Arc::new(AtomicU64::new(0));
        let active_layers = Arc::new(AtomicU64::new(0));
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_epoch = Arc::clone(&active_epoch);
        let worker_layers = Arc::clone(&active_layers);
        let worker_cancelled = Arc::clone(&cancelled);
        thread::spawn(move || {
            let mut owner_cache = OwnerCategoryCache::default();
            let zoom_rules = ZoomVisibilityRules::new(&db);
            while let Ok(request) = incoming.recv() {
                let is_current = || {
                    !worker_cancelled.load(Ordering::Relaxed)
                        && request.key.geometry_epoch == worker_epoch.load(Ordering::Relaxed)
                        && request.key.layer_visibility_hash
                            == worker_layers.load(Ordering::Relaxed)
                };
                if !is_current() {
                    continue;
                }
                let mut shapes = Vec::new();
                let mut labels = Vec::new();
                let mut counts = [[0; 32]; 2];
                for (index, shape_id) in db
                    .query_layers_intersect(&request.layer_ids, request.bbox)
                    .into_iter()
                    .enumerate()
                {
                    if index % 4096 == 0 && !is_current() {
                        break;
                    }
                    let Some(shape) = db.find_shape(shape_id) else {
                        continue;
                    };
                    if !is_renderable_shape(shape) {
                        continue;
                    }
                    let owner = db.owner_for_shape(shape);
                    let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
                    if !zoom_rules.is_drawn_at_zoom(owner_type, f32::INFINITY) {
                        continue;
                    }
                    let owner_category = owner
                        .and_then(|owner| owner_cache.get(request.key.geometry_epoch, &db, owner));
                    if shape_uses_layer_visibility(shape, owner_type)
                        && !request.layers.is_layer_visible(shape.layer_id)
                    {
                        continue;
                    }
                    let Some(style) =
                        visible_style_for_shape_fast(shape, owner, owner_type, &request.layers)
                    else {
                        continue;
                    };
                    let geometry = db.shape_geometry(shape);
                    let category = owner_category.map_or(
                        crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY,
                        |category| category as u8,
                    );
                    let context_only = owner_type
                        .is_some_and(|owner_type| is_context_owner_type(owner_type as u8));
                    if request.build_labels {
                        if let Some(mut label) = shape_label_info(
                            &geometry,
                            owner,
                            owner.and_then(|owner| db.owner_name(owner)),
                        ) {
                            label.category = category;
                            label.context_only = context_only;
                            labels.push(label);
                        }
                    }
                    counts[usize::from(context_only)][usize::from(category)] += 1;
                    shapes.push((geometry, style, category, context_only));
                }
                if !is_current() {
                    continue;
                }
                let instances =
                    Arc::new(crate::canvas_gpu::build_gpu_instances(shapes.into_iter()));
                let byte_size = instances.len()
                    * std::mem::size_of::<crate::canvas_gpu::GpuShapeInstance>()
                    + labels
                        .iter()
                        .map(|label| std::mem::size_of::<GpuCachedLabel>() + label.text.len())
                        .sum::<usize>();
                let data = Arc::new(GpuTileData {
                    instances,
                    labels,
                    category_counts: counts,
                    byte_size,
                });
                if outgoing.send((request.key, data)).is_err() {
                    break;
                }
            }
        });
        Self {
            requests,
            responses,
            pending: HashSet::new(),
            active_epoch,
            active_layers,
            cancelled,
        }
    }

    pub(super) fn set_view_state(&mut self, epoch: u64, layers: u64) {
        // Object and zoom visibility are applied by the GPU; only geometry and layer changes invalidate jobs.
        self.active_epoch.store(epoch, Ordering::Relaxed);
        self.active_layers.store(layers, Ordering::Relaxed);
        self.pending
            .retain(|key| key.geometry_epoch == epoch && key.layer_visibility_hash == layers);
    }

    pub(super) fn request(
        &mut self,
        key: crate::canvas_gpu::GpuBufferKey,
        bbox: Rect32,
        layer_ids: &[LayerId],
        layers: &LayerRenderIndex,
        build_labels: bool,
    ) -> Result<(), &'static str> {
        if self.pending.contains(&key) {
            return Ok(());
        }
        let request = TileRequest {
            key,
            bbox,
            layer_ids: layer_ids.to_vec(),
            layers: layers.clone(),
            build_labels,
        };
        match self.requests.try_send(request) {
            Ok(()) => {
                self.pending.insert(key);
                Ok(())
            }
            Err(TrySendError::Full(_)) => Ok(()),
            Err(TrySendError::Disconnected(_)) => Err("geometry tile worker stopped"),
        }
    }

    pub(super) fn poll(&mut self) -> Vec<TileResponse> {
        let ready: Vec<_> = self.responses.try_iter().collect();
        for (key, _) in &ready {
            self.pending.remove(key);
        }
        ready
    }
}

impl Drop for GpuTileWorker {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}
