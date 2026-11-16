use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};

struct LabelsOnly;

impl PaintSink for LabelsOnly {
    fn paint(&mut self, _: PaintCommand) {}
}

impl SceneSink for LabelsOnly {
    fn capture_priority(&self) -> bool {
        false
    }
}

pub(in crate::app::cpu_scene) fn promoted(request: &SceneRequest) -> ShapeLabelCollector {
    let mut result = ShapeLabelCollector::default();
    let mut ids: Vec<_> = request
        .key
        .selected
        .into_iter()
        .chain(request.key.highlighted.iter().copied())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    ids.sort_by_key(|id| {
        let rank = request
            .db
            .find_shape(*id)
            .and_then(|shape| {
                request
                    .layer_ids
                    .iter()
                    .position(|layer| *layer == shape.layer_id)
            })
            .unwrap_or(usize::MAX);
        (rank, *id)
    });
    let pass = chip_render::geometry2d::GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    let mut categories = OwnerCategoryCache::default();
    let mut sink = LabelsOnly;
    for id in ids {
        let Some(shape) = request.db.find_shape(id) else {
            continue;
        };
        if !is_renderable_shape(shape)
            || !shape.bbox.intersects(request.key.viewport)
            || !request.layer_ids.contains(&shape.layer_id)
        {
            continue;
        }
        let owner = request.db.owner_for_shape(shape);
        let kind = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
        let category =
            owner.and_then(|owner| categories.get(request.key.epoch, &request.db, owner));
        if !request.zoom_rules.is_drawn_at_zoom(kind, request.key.zoom)
            || !shape_is_visible_fast(
                shape,
                kind,
                category,
                &request.layers,
                &request.key.visibility,
            )
        {
            continue;
        }
        let Some(style) = visible_style_for_shape_fast(shape, owner, kind, &request.layers) else {
            continue;
        };
        let geometry = request.db.shape_geometry(shape);
        if pass.draw(geometry, &style, &mut sink) == 0 {
            continue;
        }
        if let Some(label) = shape_label_candidate(
            geometry,
            owner,
            owner.and_then(|owner| request.db.owner_name(owner)),
            request.key.selected == Some(id),
            request.key.highlighted.contains(&id),
            request.key.world,
            request.key.canvas,
            request.key.zoom,
            request.key.pan,
        ) {
            result.insert(label);
        }
    }
    result
}

pub(in crate::app::cpu_scene) fn refresh_labels(
    request: &SceneRequest,
    previous: &CpuScene,
    resolver: &mut labels::LabelResolver,
    is_current: &(impl Fn() -> bool + Sync),
) -> Option<CpuScene> {
    if !previous.key.same_geometry(&request.key) || !is_current() {
        return None;
    }
    let started = Instant::now();
    let candidates = if let Some(cached) = previous.labels.reusable() {
        cached
    } else {
        collect_labels(request, is_current)?
    };
    let resolved = resolver.resolve(request, &candidates, is_current)?;
    drop(candidates);
    // A prior label job may have been cancelled before compacting its source.
    // Retire that raw source on this worker before publishing full readiness.
    drop(previous.labels.retire(request.key.canvas));
    let mut scene = empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    scene.meshes = previous.meshes.clone();
    scene.fallback_meshes = previous.fallback_meshes.clone();
    scene.bitmap = previous.bitmap.as_ref().map(Arc::clone);
    scene.labels = previous.labels.clone();
    scene.retained = previous.retained.as_ref().map(Arc::clone);
    scene.priority = previous
        .priority
        .as_ref()
        .filter(|cache| cache.compatible(request))
        .map(Arc::clone);
    scene.drawn = previous.drawn;
    scene.primitives = previous.primitives;
    scene.overlay_drawn = previous.overlay_drawn;
    let _ = scene
        .completed_labels
        .set((Arc::new(resolved), started.elapsed()));
    is_current().then_some(scene)
}

pub(in crate::app::cpu_scene) fn collect_labels(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
) -> Option<Arc<ShapeLabelCollector>> {
    let ids = request
        .db
        .query_layers_intersect(&request.layer_ids, request.key.viewport);
    let chunks = thread::scope(|scope| {
        let tasks: Vec<_> = ids
            .chunks(ids.len().div_ceil(worker_count()).max(1))
            .map(|ids| scope.spawn(move || build_chunk_sink(request, ids, is_current, LabelsOnly)))
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().expect("selection label worker panicked"))
            .collect::<Option<Vec<_>>>()
    })?;
    let mut candidates = labels::Candidates::default();
    for (chunk, _) in chunks {
        candidates.append(chunk.labels);
    }
    Some(candidates.snapshot())
}
