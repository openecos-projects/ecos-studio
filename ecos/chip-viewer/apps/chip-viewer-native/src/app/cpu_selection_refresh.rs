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
    let resolved = resolver.resolve(request, &candidates.snapshot(), is_current)?;
    let mut scene = empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    scene.meshes = previous.meshes.clone();
    scene.fallback_meshes = previous.fallback_meshes.clone();
    scene.bitmap = previous.bitmap.as_ref().map(Arc::clone);
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
