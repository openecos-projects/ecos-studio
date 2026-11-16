use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};

pub(in crate::app::cpu_scene) enum PaintPacket {
    Commands(Vec<PaintCommand>),
    Overlays {
        meshes: Vec<egui::ClippedPrimitive>,
        shapes: Vec<egui::epaint::ClippedShape>,
    },
}

#[derive(Default)]
struct Commands {
    paint: Vec<PaintCommand>,
    records: Vec<(
        Rect32,
        chip_view_db::ShapeGeometry,
        chip_display::LayerStyle,
    )>,
    capture: bool,
}

impl PaintSink for Commands {
    fn paint(&mut self, command: PaintCommand) {
        self.paint.push(command);
    }
}

impl SceneSink for Commands {
    fn begin_shape(
        &mut self,
        bbox: Rect32,
        geometry: chip_view_db::ShapeGeometry,
        style: chip_display::LayerStyle,
    ) {
        if self.capture {
            self.records.push((bbox, geometry, style));
        }
    }
}

pub(in crate::app::cpu_scene) fn build_command_stream(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    mut consume: impl FnMut(PaintPacket) -> bool,
) -> Option<CpuScene> {
    if let Some(source) = request
        .world_source
        .as_ref()
        .filter(|source| source.compatible(request))
    {
        return build_from_source(source, request, is_current, consume);
    }
    let started = Instant::now();
    let workers = worker_count();
    let mut scene = empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    let mut retained = retained_regions::RegionModel::new(request);
    let mut world = world_source::Builder::new(request);
    let capture = retained.is_some() || world.is_some();
    let mut consumer_duration = Duration::ZERO;
    scene.query_duration = queries::run(
        &request.layer_ids,
        workers,
        is_current,
        |layer| {
            request
                .db
                .query_cached_layer_intersect(layer, request.key.viewport)
        },
        |ids: Vec<ShapeId>| {
            build_chunk_sink(
                request,
                &ids,
                is_current,
                Commands {
                    capture,
                    ..Default::default()
                },
            )
        },
        |(mut chunk, commands)| {
            let consumed_at = Instant::now();
            for (bbox, geometry, style) in commands.records {
                if let Some(model) = &mut retained {
                    if !model.push(bbox, geometry, style, &[]) {
                        retained = None;
                    }
                }
                if let Some(model) = &mut world {
                    if !model.push(bbox, geometry, style) {
                        world = None;
                    }
                }
            }
            let current = consume(PaintPacket::Commands(commands.paint));
            consumer_duration += consumed_at.elapsed();
            if !current {
                return false;
            }
            if merge_priority(&mut scene, &mut chunk, &|| is_current()).is_none() {
                return false;
            }
            scene.labels.append(chunk.labels);
            scene.drawn += chunk.drawn;
            scene.primitives += chunk.primitives;
            scene.filter_duration = scene.filter_duration.max(chunk.filter_duration);
            true
        },
    )?;
    if request.key.cache_overlays {
        let (meshes, drawn, shapes) = overlays::build_with_shapes(request, is_current)?;
        let consumed_at = Instant::now();
        let current = consume(PaintPacket::Overlays { meshes, shapes });
        consumer_duration += consumed_at.elapsed();
        if !current {
            return None;
        }
        scene.overlay_drawn = drawn;
    }
    scene.build_duration = started.elapsed().saturating_sub(consumer_duration);
    scene.pipeline_duration = started.elapsed();
    scene.retained = retained.map(Arc::new);
    scene.world_source = world.map(|builder| Arc::new(builder.finish()));
    finish_priority(request, &mut scene, &|| is_current());
    is_current().then_some(scene)
}

fn build_from_source(
    source: &Arc<world_source::WorldSource>,
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    mut consume: impl FnMut(PaintPacket) -> bool,
) -> Option<CpuScene> {
    let started = Instant::now();
    let mut scene = empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    let mut consumed = Duration::ZERO;
    if let Some((labels, completed)) = &request.reused_labels {
        scene.labels = labels.clone();
        scene.completed_labels = Arc::clone(completed);
    } else {
        scene.labels.require_rebuild();
    }
    ordered::run(
        worker_count(),
        is_current,
        |emit| {
            for records in source.chunks() {
                if !is_current() || !emit(records) {
                    return None;
                }
            }
            Some(())
        },
        |records| source.commands(records, request, &|| is_current()),
        |(commands, drawn, primitives)| {
            let before = Instant::now();
            let current = consume(PaintPacket::Commands(commands));
            consumed += before.elapsed();
            scene.drawn += drawn;
            scene.primitives += primitives;
            current
        },
    )?;
    if request.key.cache_overlays {
        let (meshes, drawn, shapes) = overlays::build_with_shapes(request, is_current)?;
        let before = Instant::now();
        if !consume(PaintPacket::Overlays { meshes, shapes }) {
            return None;
        }
        consumed += before.elapsed();
        scene.overlay_drawn = drawn;
    }
    scene.build_duration = started.elapsed().saturating_sub(consumed);
    scene.pipeline_duration = started.elapsed();
    scene.world_source = Some(Arc::clone(source));
    finish_priority(request, &mut scene, &|| is_current());
    is_current().then_some(scene)
}
