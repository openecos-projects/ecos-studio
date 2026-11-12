use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};

pub(in crate::app::cpu_scene) enum PaintPacket {
    Commands(Vec<PaintCommand>),
    Overlays(Vec<egui::ClippedPrimitive>),
}

#[derive(Default)]
struct Commands(Vec<PaintCommand>);

impl PaintSink for Commands {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

pub(in crate::app::cpu_scene) fn build_command_stream(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    mut consume: impl FnMut(PaintPacket) -> bool,
) -> Option<CpuScene> {
    let started = Instant::now();
    let workers = worker_count();
    let mut scene = empty_scene(&request.key);
    let mut consumer_duration = Duration::ZERO;
    scene.query_duration = ordered::run(
        workers,
        is_current,
        |emit| {
            queries::produce(
                &request.layer_ids,
                workers,
                is_current,
                |layer| {
                    request
                        .db
                        .query_layers_intersect(&[layer], request.key.viewport)
                },
                emit,
            )
        },
        |ids: Vec<ShapeId>| build_chunk_sink(request, &ids, is_current, Commands::default()),
        |(chunk, commands)| {
            let consumed_at = Instant::now();
            let current = consume(PaintPacket::Commands(commands.0));
            consumer_duration += consumed_at.elapsed();
            if !current {
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
        let (meshes, drawn) = overlays::build(request, is_current)?;
        let consumed_at = Instant::now();
        let current = consume(PaintPacket::Overlays(meshes));
        consumer_duration += consumed_at.elapsed();
        if !current {
            return None;
        }
        scene.overlay_drawn = drawn;
    }
    scene.build_duration = started.elapsed().saturating_sub(consumer_duration);
    scene.pipeline_duration = started.elapsed();
    is_current().then_some(scene)
}
