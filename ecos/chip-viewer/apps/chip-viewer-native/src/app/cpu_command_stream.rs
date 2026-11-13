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
        std::ops::Range<usize>,
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
            self.records
                .push((bbox, geometry, style, self.paint.len()..self.paint.len()));
        }
    }

    fn end_shape(&mut self) {
        if let Some(record) = self.records.last_mut() {
            record.3.end = self.paint.len();
        }
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
    let mut retained = retained_regions::RegionModel::new(request);
    let capture = retained.is_some();
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
        |(chunk, commands)| {
            let consumed_at = Instant::now();
            if let Some(model) = &mut retained {
                for (bbox, geometry, style, range) in commands.records {
                    if !model.push(bbox, geometry, style, &commands.paint[range]) {
                        retained = None;
                        break;
                    }
                }
            }
            let current = consume(PaintPacket::Commands(commands.paint));
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
    is_current().then_some(scene)
}
