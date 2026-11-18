//! Two-stage current-camera layer seeds: a bounded UI geometry sample for the
//! first GL callback, then a larger worker sample before the exact stream.
//! The worker reuses the UI seed geometry and publishes ordered refinement.
use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};

const GRID: usize = 4;
const MAX_LAYERS: usize = 64;
const MAX_CANDIDATES: usize = 32_768;
const WORKER_BUDGET: Duration = Duration::from_millis(250);
const UI_SPATIAL_CANDIDATES: usize = 256;
const UI_CACHED_CANDIDATES: usize = 512;
const UI_PRIORITY_CANDIDATES: usize = UI_CACHED_CANDIDATES * 3 / 4;
const UI_MIXED_SPATIAL_CANDIDATES: usize = UI_CACHED_CANDIDATES - UI_PRIORITY_CANDIDATES;

struct SeedSink(geometry::GeometryMeshSink);

impl PaintSink for SeedSink {
    fn paint(&mut self, command: PaintCommand) {
        self.0.paint(command);
    }
}

impl SceneSink for SeedSink {
    fn collect_labels(&self) -> bool {
        false
    }
}

/// Prepare actual current-camera ExactRaster meshes, including managed pattern
/// textures and feathered lines/points. Software coverage holes never erase a
/// colored layer. The offscreen worker renders this scene into a fresh target.
pub(in crate::app::cpu_scene) fn build_initial_scene(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
) -> Option<CpuScene> {
    let started = Instant::now();
    build_initial_scene_with_budget(request, is_current, &|| started.elapsed() < WORKER_BUDGET)
}

/// Clock expiry keeps prepared geometry. Camera cancellation discards it. All
/// participating layers get their first bounded chunk before additional work.
pub(in crate::app::cpu_scene) fn build_initial_scene_with_budget(
    request: &SceneRequest,
    is_current: &(impl Fn() -> bool + Sync),
    within_budget: &impl Fn() -> bool,
) -> Option<CpuScene> {
    const SHAPES_PER_CHUNK: usize = 32;
    struct LayerSeed {
        ids: Vec<ShapeId>,
        next: usize,
        sink: Option<SeedSink>,
        tail: Vec<ShapeId>,
    }
    let started = Instant::now();
    let mut sampled = sampled_layers(request, is_current, MAX_CANDIDATES)?;
    let ui_layers = ui_sampled_layers(request, is_current)?;
    // Cached priority IDs can lie outside the bounded spatial sample. Merge
    // them before preparing sorted prefixes so every UI ID below a frontier
    // has actually been painted. The protected set is at most 512 records.
    for (ids, required) in sampled.iter_mut().zip(&ui_layers) {
        ids.extend_from_slice(required);
        ids.sort_unstable();
        ids.dedup();
    }
    let mut layers = sampled
        .into_iter()
        .map(|ids| LayerSeed {
            ids,
            next: 0,
            sink: None,
            tail: Vec::new(),
        })
        .collect::<Vec<_>>();
    let sampled_count = layers.iter().map(|layer| layer.ids.len()).sum::<usize>();
    let mut scene = empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    let mut first_round = true;
    'rounds: loop {
        let mut advanced = false;
        for layer in &mut layers {
            if !is_current() {
                return None;
            }
            if layer.next == layer.ids.len() {
                continue;
            }
            if !first_round && !within_budget() {
                break 'rounds;
            }
            let sink = layer.sink.take().unwrap_or_else(|| {
                SeedSink(geometry::GeometryMeshSink::for_raster_with_patterns(
                    request.tessellator.clone(),
                    request.key.canvas,
                    request.key.tessellation,
                    request.key.pixels_per_point,
                    Arc::clone(&request.pattern_textures),
                ))
            });
            let end = (layer.next + SHAPES_PER_CHUNK).min(layer.ids.len());
            let (chunk, sink) =
                build_chunk_sink(request, &layer.ids[layer.next..end], is_current, sink)?;
            layer.next = end;
            layer.sink = Some(sink);
            scene.drawn += chunk.drawn;
            scene.primitives += chunk.primitives;
            scene.filter_duration += chunk.filter_duration;
            advanced = true;
        }
        if !advanced {
            break;
        }
        first_round = false;
    }
    // Restore UI records beyond this layer's sorted prefix before finalizing
    // its persistent sink. This adds at most 512 records with a priority cache,
    // or 256 without one, using the same selection as the UI. No extra full
    // spatial scan or owner/style ranking is needed. These are real records,
    // and appending only IDs above the frontier preserves blend order without
    // painting a seed twice. Generation cancellation still aborts everything.
    for (layer, ui_ids) in layers.iter_mut().zip(ui_layers) {
        if !is_current() {
            return None;
        }
        let frontier = layer.next.checked_sub(1).map(|index| layer.ids[index]);
        layer.tail = ui_ids
            .into_iter()
            .filter(|id| frontier.is_none_or(|last| *id > last))
            .collect();
        for tail in layer.tail.chunks(SHAPES_PER_CHUNK) {
            let sink = layer.sink.take().unwrap_or_else(|| {
                SeedSink(geometry::GeometryMeshSink::for_raster_with_patterns(
                    request.tessellator.clone(),
                    request.key.canvas,
                    request.key.tessellation,
                    request.key.pixels_per_point,
                    Arc::clone(&request.pattern_textures),
                ))
            });
            let (chunk, sink) = build_chunk_sink(request, tail, is_current, sink)?;
            layer.sink = Some(sink);
            scene.drawn += chunk.drawn;
            scene.primitives += chunk.primitives;
            scene.filter_duration += chunk.filter_duration;
        }
    }
    // Work ran round robin, while output remains layer-then-shape-ID ordered.
    // A persistent sink per layer also preserves batching across its chunks.
    for layer in &mut layers {
        if !is_current() {
            return None;
        }
        if let Some(sink) = layer.sink.take() {
            scene.meshes.extend(prepare_meshes(sink.0.finish()));
        }
    }
    let mut prepared = layers
        .iter()
        .flat_map(|layer| layer.ids[..layer.next].iter().chain(&layer.tail).copied())
        .collect::<Vec<_>>();
    prepared.sort_unstable();
    prepared.dedup();
    scene.initial_records = Some(prepared.into());
    scene.build_duration = started.elapsed();
    scene.pipeline_duration = scene.build_duration;
    if std::env::var_os("ECOS_RENDER_RASTER_TRACE").is_some() {
        eprintln!("Initial GL seeds: layers={}, sampled={}, prepared={}, primitives={}, meshes={}, prepare_ms={:.3}",
            layers.len(), sampled_count, layers.iter().map(|layer| layer.next + layer.tail.len()).sum::<usize>(),
            scene.primitives, scene.meshes.len(), started.elapsed().as_secs_f64() * 1000.0);
    }
    (scene.drawn > 0 && is_current()).then_some(scene)
}

/// UI prepares only a bounded first batch; it is drawn in that frame's GL
/// callback. The worker receives this same geometry and refines independently.
pub(in crate::app::cpu_scene) fn build_ui_initial_scene(
    request: &SceneRequest,
) -> Option<CpuScene> {
    const UI_BUDGET: Duration = Duration::from_millis(3);
    let started = Instant::now();
    // Every active layer gets a small first query before further sampling.
    // Keep already sampled geometry on deadline, rather than erasing the frame.
    // Cache selection projects cached bounds only. Reuse its result if the
    // small spatial query reaches the deadline; never rank via DB/owner scans.
    let priority = ui_priority(request);
    let layers = mixed_ui_layers(
        request,
        &|| started.elapsed() < UI_BUDGET,
        priority.as_deref(),
    )
    .or_else(|| mixed_ui_layers(request, &|| true, priority.as_deref()))?;
    let mut ids = layers.into_iter().flatten().collect::<Vec<_>>();
    let sink = SeedSink(geometry::GeometryMeshSink::for_raster_with_patterns(
        request.tessellator.clone(),
        request.key.canvas,
        request.key.tessellation,
        request.key.pixels_per_point,
        Arc::clone(&request.pattern_textures),
    ));
    let (mut scene, sink) = build_chunk_sink(request, &ids, &|| true, sink)?;
    scene.meshes = prepare_meshes(sink.0.finish());
    ids.sort_unstable();
    ids.dedup();
    scene.initial_records = Some(ids.into());
    scene.build_duration = started.elapsed();
    scene.pipeline_duration = scene.build_duration;
    (scene.drawn > 0).then_some(scene)
}

fn ui_priority(request: &SceneRequest) -> Option<Vec<(LayerId, ShapeId)>> {
    request
        .priority
        .as_ref()
        .map(|cache| cache.select(request, UI_PRIORITY_CANDIDATES))
        .filter(|ids| !ids.is_empty())
}

fn ui_sampled_layers(
    request: &SceneRequest,
    is_current: &impl Fn() -> bool,
) -> Option<Vec<Vec<ShapeId>>> {
    let priority = ui_priority(request);
    mixed_ui_layers(request, is_current, priority.as_deref())
}

fn mixed_ui_layers(
    request: &SceneRequest,
    is_current: &impl Fn() -> bool,
    priority: Option<&[(LayerId, ShapeId)]>,
) -> Option<Vec<Vec<ShapeId>>> {
    let priority = priority.filter(|ids| !ids.is_empty());
    let spatial_quota = if priority.is_some() {
        UI_MIXED_SPATIAL_CANDIDATES
    } else {
        UI_SPATIAL_CANDIDATES
    };
    let active = active_layers(request)?;
    let mut layers = sampled_layers(request, is_current, spatial_quota)?;
    if let Some(priority) = priority {
        for &(layer, id) in priority.iter().take(UI_PRIORITY_CANDIDATES) {
            if !is_current() {
                return None;
            }
            if let Some(index) = active.iter().position(|&active| active == layer) {
                layers[index].push(id);
            }
        }
        for layer in &mut layers {
            layer.sort_unstable();
            layer.dedup();
        }
    }
    is_current().then_some(layers)
}

#[cfg(test)]
fn initial_shape_ids(
    request: &SceneRequest,
    is_current: &impl Fn() -> bool,
) -> Option<Vec<ShapeId>> {
    sampled_ids(request, is_current, MAX_CANDIDATES)
}

#[cfg(test)]
fn sampled_ids(
    request: &SceneRequest,
    is_current: &impl Fn() -> bool,
    limit: usize,
) -> Option<Vec<ShapeId>> {
    Some(
        sampled_layers(request, is_current, limit)?
            .into_iter()
            .flatten()
            .collect(),
    )
}

fn sampled_layers(
    request: &SceneRequest,
    is_current: &impl Fn() -> bool,
    limit: usize,
) -> Option<Vec<Vec<ShapeId>>> {
    let active = active_layers(request)?;
    let cells = (limit / active.len().max(1)).clamp(1, GRID * GRID);
    let per_cell = (limit / active.len().max(1) / cells).max(1);
    let view = request.key.viewport;
    let mut layers = vec![Vec::new(); active.len()];
    // Round robin across layers in each cell, with a global candidate bound.
    // Small UI quotas use fewer distributed cells rather than exceeding quota
    // when the active-layer count is larger than the per-cell allowance.
    for sample_cell in 0..cells {
        let index = sample_cell * GRID * GRID / cells;
        let (row, column) = (index / GRID, index % GRID);
        let coordinate = |low: i32, high: i32, index: usize| {
            (i64::from(low) + (i64::from(high) - i64::from(low)) * index as i64 / GRID as i64)
                as i32
        };
        let cell = Rect32 {
            lx: coordinate(view.lx, view.hx, column),
            ly: coordinate(view.ly, view.hy, row),
            hx: coordinate(view.lx, view.hx, column + 1),
            hy: coordinate(view.ly, view.hy, row + 1),
        };
        for (index, &layer) in active.iter().enumerate() {
            if !is_current() {
                return None;
            }
            let sample = request
                .db
                .query_layer_intersect_sample(layer, cell, per_cell);
            layers[index].extend(sample.ids);
        }
    }
    for layer in &mut layers {
        layer.sort_unstable();
        layer.dedup();
    }
    is_current().then_some(layers)
}

fn active_layers(request: &SceneRequest) -> Option<Vec<LayerId>> {
    let layers = request
        .layer_ids
        .iter()
        .copied()
        .filter(|layer| {
            // Catalog entries include empty technology layers. Missing metadata is
            // not proof of emptiness (layout layer 0 commonly has no entry).
            request
                .grid_layers
                .iter()
                .find(|entry| entry.layer_id == *layer)
                .is_none_or(|entry| entry.shape_count > 0)
        })
        .collect::<Vec<_>>();
    (layers.len() <= MAX_LAYERS).then_some(layers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_priority_selection_obeys_both_quotas_and_original_layer_order() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let mut request = fixture.request(1.0, 1.0);
        request.layer_ids = vec![2, 1];
        // The cache supplies layer-tagged IDs. Selection must not resolve them
        // through the DB merely to order or rank them a second time.
        let priority = (10_000..11_000)
            .rev()
            .map(|id| (if id % 2 == 0 { 1 } else { 2 }, id))
            .collect::<Vec<_>>();
        let mixed = mixed_ui_layers(&request, &|| true, Some(&priority)).unwrap();
        let spatial = sampled_layers(&request, &|| true, UI_MIXED_SPATIAL_CANDIDATES).unwrap();
        assert_eq!(mixed.len(), 2);
        for (index, &layer) in request.layer_ids.iter().enumerate() {
            let mut expected = spatial[index].clone();
            expected.extend(
                priority
                    .iter()
                    .take(UI_PRIORITY_CANDIDATES)
                    .filter_map(|&(id_layer, id)| (id_layer == layer).then_some(id)),
            );
            expected.sort_unstable();
            expected.dedup();
            assert_eq!(mixed[index], expected);
            assert!(mixed[index].windows(2).all(|ids| ids[0] < ids[1]));
        }
        assert_eq!(
            mixed.iter().flatten().filter(|&&id| id >= 10_000).count(),
            384
        );
        assert!(mixed.iter().map(Vec::len).sum::<usize>() <= 512);
    }

    #[test]
    fn missing_and_empty_priority_use_the_same_256_spatial_fallback() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let request = fixture.request(1.0, 1.0);
        let expected = sampled_layers(&request, &|| true, UI_SPATIAL_CANDIDATES).unwrap();
        assert_eq!(mixed_ui_layers(&request, &|| true, None).unwrap(), expected);
        assert_eq!(
            mixed_ui_layers(&request, &|| true, Some(&[])).unwrap(),
            expected
        );
        assert!(expected.iter().map(Vec::len).sum::<usize>() <= 256);
        assert!(mixed_ui_layers(&request, &|| false, None).is_none());
    }

    #[test]
    fn mixed_selection_deduplicates_priority_and_spatial_records() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let request = fixture.request(1.0, 1.0);
        let spatial = sampled_layers(&request, &|| true, UI_MIXED_SPATIAL_CANDIDATES).unwrap();
        let layer = request.layer_ids[0];
        let id = spatial[0][0];
        let mixed = mixed_ui_layers(&request, &|| true, Some(&[(layer, id), (layer, id)])).unwrap();
        assert_eq!(mixed, spatial, "duplicate cache hits must neither change alpha multiplicity nor consume another layer's geometry");
    }

    #[test]
    fn empty_catalog_layers_do_not_dilute_quota_and_missing_metadata_is_retained() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let mut request = fixture.request(1.0, 1.0);
        request.layer_ids = (0..21).collect();
        request.grid_layers = (1..21)
            .map(|layer| {
                let mut entry = crate::app::tests::layer_state(layer, true);
                entry.shape_count = if [1, 2, 7, 9].contains(&layer) { 20 } else { 0 };
                entry
            })
            .collect();
        let layers = active_layers(&request).unwrap();
        assert_eq!(layers, [0, 1, 2, 7, 9]);
        let per_cell = MAX_CANDIDATES / layers.len() / (GRID * GRID);
        assert!(per_cell > MAX_CANDIDATES / request.layer_ids.len() / (GRID * GRID));
        assert!(per_cell * layers.len() * GRID * GRID <= MAX_CANDIDATES);
    }

    #[test]
    fn cancelled_initial_geometry_is_not_prepared_or_published() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let request = fixture.request(1.0, 1.0);
        assert!(build_initial_scene(&request, &|| false).is_none());
    }

    #[test]
    fn sampling_preserves_exact_layer_and_id_order_without_duplicates() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let request = fixture.request(1.0, 1.0);
        let sampled = initial_shape_ids(&request, &|| true).unwrap();
        assert_eq!(
            sampled,
            request
                .db
                .query_layers_intersect(&request.layer_ids, request.key.viewport)
        );
        assert!(sampled.len() <= MAX_CANDIDATES);
    }
}
