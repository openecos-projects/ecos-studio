use super::*;

#[path = "cpu_scene_stream.rs"]
mod stream;

#[path = "cpu_selection_refresh.rs"]
mod selection;
pub(super) use selection::refresh_labels;

#[cfg(target_os = "linux")]
#[path = "cpu_initial_progress.rs"]
mod initial;
#[cfg(target_os = "linux")]
pub(super) use initial::build_initial_progress;

pub(super) use stream::build_raster_stream;
#[cfg(test)]
pub(super) use stream::build_streaming;
#[cfg(target_os = "linux")]
pub(super) use stream::{build_command_stream, PaintPacket};

/// Receives shape boundaries around the ordered paint commands from one record.
/// Sinks that retain inputs must also retain records producing no commands.
trait SceneSink: chip_render::geometry2d::PaintSink {
    fn begin_shape(
        &mut self,
        _bbox: Rect32,
        _geometry: chip_view_db::ShapeGeometry,
        _style: chip_display::LayerStyle,
    ) {
    }

    fn end_shape(&mut self) {}
}

impl SceneSink for geometry::GeometryMeshSink {}

pub(super) fn build_scene(
    request: &SceneRequest,
    is_current: impl Fn() -> bool + Sync,
) -> Option<CpuScene> {
    let workers = worker_count();
    build_with_workers(request, &is_current, workers)
}

pub(super) fn worker_count() -> usize {
    thread::available_parallelism()
        .map_or(1, usize::from)
        .div_ceil(2)
        .clamp(1, 8)
}

pub(super) fn build_with_workers(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    workers: usize,
) -> Option<CpuScene> {
    let started = Instant::now();
    let ids = request
        .db
        .query_layers_intersect(&request.layer_ids, request.key.viewport);
    let query_duration = started.elapsed();
    if !is_current() {
        return None;
    }
    let chunk_size = ids.len().div_ceil(workers).max(1);
    let chunks = thread::scope(|scope| {
        let tasks: Vec<_> = ids
            .chunks(chunk_size)
            .map(|ids| {
                scope.spawn(move || {
                    build_chunk(
                        request,
                        ids,
                        is_current,
                        geometry::GeometryOutput::Reference,
                    )
                })
            })
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().expect("exact geometry worker panicked"))
            .collect::<Option<Vec<_>>>()
    })?;
    let mut scene = empty_scene(&request.key);
    for chunk in chunks {
        scene.meshes.extend(chunk.meshes);
        scene.labels.append(chunk.labels);
        scene.drawn += chunk.drawn;
        scene.primitives += chunk.primitives;
        scene.filter_duration = scene.filter_duration.max(chunk.filter_duration);
    }
    scene.query_duration = query_duration;
    if request.key.cache_overlays {
        let (meshes, drawn) = overlays::build(request, is_current)?;
        scene.meshes.extend(meshes);
        scene.overlay_drawn = drawn;
    }
    if !request.glow {
        scene.prepare_fallback();
    }
    scene.build_duration = started.elapsed();
    scene.pipeline_duration = scene.build_duration;
    is_current().then_some(scene)
}

fn empty_scene(key: &SceneKey) -> CpuScene {
    CpuScene {
        key: key.clone(),
        generation: 0,
        meshes: Vec::new(),
        fallback_meshes: OnceLock::new(),
        labels: Default::default(),
        drawn: 0,
        primitives: 0,
        build_duration: Duration::ZERO,
        pipeline_duration: Duration::ZERO,
        query_duration: Duration::ZERO,
        filter_duration: Duration::ZERO,
        bitmap: None,
        retained: None,
        raster_duration: Duration::ZERO,
        completed_labels: Arc::default(),
        overlay_drawn: 0,
    }
}

fn build_chunk(
    request: &SceneRequest,
    ids: &[ShapeId],
    is_current: &(impl Fn() -> bool + Sync),
    output: geometry::GeometryOutput,
) -> Option<CpuScene> {
    let key = &request.key;
    let sink = match output {
        geometry::GeometryOutput::Reference => geometry::GeometryMeshSink::new(
            request.tessellator.clone(),
            key.canvas,
            key.tessellation,
        ),
        geometry::GeometryOutput::ExactRaster => geometry::GeometryMeshSink::for_raster(
            request.tessellator.clone(),
            key.canvas,
            key.tessellation,
            key.pixels_per_point,
        ),
    };
    let (mut scene, sink) = build_chunk_sink(request, ids, is_current, sink)?;
    scene.meshes = prepare_meshes(sink.finish());
    is_current().then_some(scene)
}

fn build_chunk_sink<Sink: SceneSink>(
    request: &SceneRequest,
    ids: &[ShapeId],
    is_current: &(impl Fn() -> bool + Sync),
    mut sink: Sink,
) -> Option<(CpuScene, Sink)> {
    let key = &request.key;
    let filter_started = Instant::now();
    let mut owner_cache = OwnerCategoryCache::default();
    let mut shapes = Vec::with_capacity(ids.len());
    for (index, shape_id) in ids.iter().enumerate() {
        if index % 1024 == 0 && !is_current() {
            return None;
        }
        let Some(shape) = request.db.find_shape(*shape_id) else {
            continue;
        };
        if !is_renderable_shape(shape) {
            continue;
        }
        let owner = request.db.owner_for_shape(shape);
        let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
        if !request.zoom_rules.is_drawn_at_zoom(owner_type, key.zoom) {
            continue;
        }
        let category = owner.and_then(|owner| owner_cache.get(key.epoch, &request.db, owner));
        if !shape_is_visible_fast(
            shape,
            owner_type,
            category,
            &request.layers,
            &key.visibility,
        ) {
            continue;
        }
        let Some(style) = visible_style_for_shape_fast(shape, owner, owner_type, &request.layers)
        else {
            continue;
        };
        shapes.push((shape, owner, request.db.shape_geometry(shape), style));
    }
    let mut scene = empty_scene(key);
    scene.filter_duration = filter_started.elapsed();
    let pass = chip_render::geometry2d::GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
    for (index, (shape, owner, geometry, style)) in shapes.iter().enumerate() {
        if index % 1024 == 0 && !is_current() {
            return None;
        }
        sink.begin_shape(shape.bbox, *geometry, *style);
        let primitives = pass.draw(*geometry, style, &mut sink);
        sink.end_shape();
        if primitives == 0 {
            continue;
        }
        scene.drawn += 1;
        scene.primitives += primitives;
        if let Some(label) = shape_label_candidate(
            *geometry,
            *owner,
            owner.and_then(|owner| request.db.owner_name(owner)),
            key.selected == Some(shape.id),
            key.highlighted.contains(&shape.id),
            key.world,
            key.canvas,
            key.zoom,
            key.pan,
        ) {
            scene.labels.insert(label);
        }
    }
    if !is_current() {
        return None;
    }
    drop(shapes);
    is_current().then_some((scene, sink))
}

pub(super) fn prepare_meshes(
    primitives: Vec<egui::ClippedPrimitive>,
) -> Vec<egui::ClippedPrimitive> {
    primitives
        .into_iter()
        .flat_map(|primitive| {
            let clip_rect = primitive.clip_rect;
            match primitive.primitive {
                egui::epaint::Primitive::Mesh(mesh) => split_batches(mesh)
                    .into_iter()
                    .map(|mesh| egui::ClippedPrimitive {
                        clip_rect,
                        primitive: egui::epaint::Primitive::Mesh(mesh),
                    })
                    .collect::<Vec<_>>(),
                egui::epaint::Primitive::Callback(_) => {
                    unreachable!("CPU geometry contains no callbacks")
                }
            }
        })
        .collect()
}

pub(super) fn split_batches(mesh: egui::Mesh) -> Vec<egui::Mesh> {
    const MAX_INDICES: usize = geometry::MAX_MESH_INDICES;
    if mesh.indices.len() <= MAX_INDICES {
        return vec![mesh];
    }
    let mut batches = Vec::with_capacity(mesh.indices.len().div_ceil(MAX_INDICES));
    let mut remap = vec![u32::MAX; mesh.vertices.len()];
    let mut used = Vec::with_capacity(MAX_INDICES);
    for indices in mesh.indices.chunks(MAX_INDICES) {
        let mut batch = egui::Mesh::with_texture(mesh.texture_id);
        batch.indices.reserve(indices.len());
        for &index in indices {
            let index = index as usize;
            if remap[index] == u32::MAX {
                remap[index] = batch.vertices.len() as u32;
                batch.vertices.push(mesh.vertices[index]);
                used.push(index);
            }
            batch.indices.push(remap[index]);
        }
        for index in used.drain(..) {
            remap[index] = u32::MAX;
        }
        batches.push(batch);
    }
    batches
}

#[cfg(test)]
#[test]
fn bounded_batches_preserve_every_triangle_vertex_and_texture() {
    let mesh = egui::Mesh {
        indices: (0..30_000).map(|index| index % 257).collect(),
        vertices: (0..257)
            .map(|index| egui::epaint::Vertex {
                pos: egui::pos2(index as f32, index as f32 * 0.5),
                uv: egui::pos2(index as f32 * 0.001, 0.5),
                color: egui::Color32::from_rgb(index as u8, 51, 203),
            })
            .collect(),
        texture_id: egui::TextureId::User(42),
    };
    let expected: Vec<_> = mesh
        .indices
        .iter()
        .map(|index| mesh.vertices[*index as usize])
        .collect();
    let batches = split_batches(mesh);
    assert_eq!(batches.len(), 3);
    assert!(batches.iter().all(|batch| batch.is_valid()
        && batch.indices.len() <= 12_288
        && batch.texture_id == egui::TextureId::User(42)));
    let actual: Vec<_> = batches
        .iter()
        .flat_map(|batch| {
            batch
                .indices
                .iter()
                .map(|index| batch.vertices[*index as usize])
        })
        .collect();
    assert_eq!(actual, expected);
}
