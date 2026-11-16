use super::*;
#[cfg(test)]
use std::sync::atomic::AtomicUsize;

#[path = "cpu_ordered_stream.rs"]
mod ordered;

#[path = "cpu_layer_query.rs"]
mod queries;

#[cfg(target_os = "linux")]
#[path = "cpu_command_stream.rs"]
mod commands;
#[cfg(target_os = "linux")]
pub(in crate::app::cpu_scene) use commands::{build_command_stream, PaintPacket};

#[cfg(test)]
pub(in crate::app::cpu_scene) fn build_streaming(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    mut consume: impl FnMut(&[egui::ClippedPrimitive]) -> bool,
) -> Option<CpuScene> {
    build_output(
        request,
        is_current,
        |meshes, _| consume(meshes),
        geometry::GeometryOutput::Reference,
    )
}

pub(in crate::app::cpu_scene) fn build_raster_stream(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    consume: impl FnMut(&[egui::ClippedPrimitive], &[Option<geometry::PackedMesh>]) -> bool,
) -> Option<CpuScene> {
    build_output(
        request,
        is_current,
        consume,
        geometry::GeometryOutput::ExactRaster,
    )
}

fn build_output(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    mut consume: impl FnMut(&[egui::ClippedPrimitive], &[Option<geometry::PackedMesh>]) -> bool,
    output: geometry::GeometryOutput,
) -> Option<CpuScene> {
    let started = Instant::now();
    let workers = worker_count();
    let mut scene = empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    let mut consumer_duration = Duration::ZERO;
    let query_duration = queries::run(
        &request.layer_ids,
        workers,
        is_current,
        |layer| {
            request
                .db
                .query_cached_layer_intersect(layer, request.key.viewport)
        },
        |ids: Vec<ShapeId>| {
            let chunk = build_chunk(request, &ids, is_current, output)?;
            let packed = match output {
                geometry::GeometryOutput::Reference => Vec::new(),
                geometry::GeometryOutput::ExactRaster => geometry::pack_meshes(&chunk.meshes),
            };
            is_current().then_some((chunk, packed))
        },
        |(mut chunk, packed)| {
            let consumed_at = Instant::now();
            let current = consume(&chunk.meshes, &packed);
            consumer_duration += consumed_at.elapsed();
            if !current {
                return false;
            }
            if merge_priority(&mut scene, &mut chunk, &|| is_current()).is_none() {
                return false;
            }
            scene.meshes.extend(chunk.meshes);
            scene.labels.append(chunk.labels);
            scene.drawn += chunk.drawn;
            scene.primitives += chunk.primitives;
            scene.filter_duration = scene.filter_duration.max(chunk.filter_duration);
            true
        },
    )?;
    if !is_current() {
        return None;
    }
    scene.query_duration = query_duration;
    if request.key.cache_overlays {
        let (meshes, drawn) = overlays::build(request, is_current)?;
        let packed = match output {
            geometry::GeometryOutput::Reference => Vec::new(),
            geometry::GeometryOutput::ExactRaster => geometry::pack_meshes(&meshes),
        };
        let consumed_at = Instant::now();
        let current = consume(&meshes, &packed);
        consumer_duration += consumed_at.elapsed();
        if !current {
            return None;
        }
        scene.meshes.extend(meshes);
        scene.overlay_drawn = drawn;
    }
    if !request.glow {
        scene.prepare_fallback();
    }
    scene.build_duration = started.elapsed().saturating_sub(consumer_duration);
    scene.pipeline_duration = started.elapsed();
    finish_priority(request, &mut scene, &|| is_current());
    is_current().then_some(scene)
}

#[cfg(test)]
fn ordered_chunks<T: Send>(
    count: usize,
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    build: impl Fn(usize) -> Option<T> + Sync,
    mut consume: impl FnMut(T) -> bool,
) -> bool {
    ordered::run(
        workers,
        is_current,
        |emit| {
            for index in 0..count {
                if !emit(index) {
                    return None;
                }
            }
            Some(())
        },
        build,
        &mut consume,
    )
    .is_some()
}

#[cfg(test)]
#[path = "cpu_scene_stream_tests.rs"]
mod tests;
