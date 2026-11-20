use super::*;

pub(super) fn spawn(
    worker_inbox: Arc<WorkerInbox>,
    worker_progress: Arc<progress::ProgressMailbox>,
    outgoing: mpsc::Sender<(u64, Arc<CpuScene>)>,
) {
    thread::spawn(move || {
        let label_worker = labels::LabelWorker::new(Arc::clone(&worker_inbox));
        let mut selection_labels = labels::LabelResolver::default();
        #[cfg(target_os = "linux")]
        let mut renderer = None;
        loop {
            let (generation, mut request, retained) = {
                let mut pending = worker_inbox.request.lock().unwrap();
                while pending.is_none() && !worker_inbox.stopped.load(Ordering::Relaxed) {
                    pending = worker_inbox.wake.wait(pending).unwrap();
                }
                if worker_inbox.stopped.load(Ordering::Relaxed) {
                    break;
                }
                pending.take().unwrap()
            };
            let worker_started = Instant::now();
            #[cfg(target_os = "linux")]
            let mut evidence_write =
                progress::InitialEvidenceWrite::start(Arc::clone(&worker_inbox));
            let is_current = || {
                !worker_inbox.stopped.load(Ordering::Relaxed)
                    && worker_inbox.generation.load(Ordering::Relaxed) == generation
            };
            if request.glow
                && request
                    .world_source
                    .as_ref()
                    .is_some_and(|source| source.compatible(&request))
                && retained.is_none()
                && request.reused_labels.is_none()
            {
                let labels_scene =
                    builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
                labels_scene.labels.require_rebuild();
                label_worker.submit(&request, generation, &labels_scene);
                request.reused_labels = Some((
                    labels_scene.labels.clone(),
                    Arc::clone(&labels_scene.completed_labels),
                ));
            }
            let scene = if let Some(scene) = retained {
                if scene.key == request.key {
                    scene
                } else {
                    let Some(mut scene) = builder::refresh_labels(
                        &request,
                        &scene,
                        &mut selection_labels,
                        &is_current,
                    ) else {
                        continue;
                    };
                    scene.generation = generation;
                    Arc::new(scene)
                }
            } else if let Some(mut scene) = {
                #[cfg(target_os = "linux")]
                {
                    build_raster_scene(
                        &request,
                        &mut renderer,
                        is_current,
                        |pixels, sequence| {
                            if is_current() {
                                let frame =
                                    worker_progress.publish_initial(progress::ProgressFrame::new(
                                        request.key.clone(),
                                        generation,
                                        sequence,
                                        pixels,
                                    ));
                                request.repaint.request_repaint();
                                if let Err(error) = worker_inbox.initial_evidence.enqueue(frame) {
                                    eprintln!("Initial progress evidence unavailable: {error}");
                                }
                            }
                        },
                        |pixels, sequence| {
                            if is_current()
                                && !worker_progress.contains(
                                    &request.key,
                                    generation,
                                    sequence,
                                    &pixels,
                                )
                            {
                                let frame = progress::ProgressFrame::new(
                                    request.key.clone(),
                                    generation,
                                    sequence,
                                    pixels,
                                );
                                let Some(frame) = worker_progress.publish_ordered(frame) else {
                                    return;
                                };
                                request.repaint.request_repaint();
                                if let Err(error) = worker_inbox.initial_evidence.enqueue(frame) {
                                    eprintln!("Progress evidence unavailable: {error}");
                                }
                            }
                        },
                        |scene| label_worker.submit(&request, generation, scene),
                    )
                }
                #[cfg(not(target_os = "linux"))]
                {
                    build_scene(&request, is_current)
                }
            } {
                if !is_current() {
                    continue;
                }
                if request.glow && scene.bitmap.is_none() {
                    scene.meshes = builder::prepare_meshes(std::mem::take(&mut scene.meshes));
                }
                prepare_presentation(&mut scene);
                scene.generation = generation;
                Arc::new(scene)
            } else {
                continue;
            };
            #[cfg(target_os = "linux")]
            let initial_evidence_duration = evidence_write.finish().unwrap_or_else(|error| {
                eprintln!("Initial progress evidence unavailable: {error}");
                Duration::ZERO
            });
            #[cfg(not(target_os = "linux"))]
            let initial_evidence_duration = Duration::ZERO;
            if std::env::var_os("ECOS_RENDER_RASTER_TRACE").is_some() {
                eprintln!(
                    "Scene worker generation {generation}: initial evidence {:.3} ms, before handoff {:.3} ms, raster pipeline {:.3} ms",
                    initial_evidence_duration.as_secs_f64() * 1000.0,
                    worker_started.elapsed().as_secs_f64() * 1000.0,
                    scene.pipeline_duration.as_secs_f64() * 1000.0,
                );
            }
            if outgoing.send((generation, Arc::clone(&scene))).is_err() {
                break;
            }
            request.repaint.request_repaint();
            label_worker.submit(&request, generation, &scene);
        }
    });
}

pub(super) fn prepare_presentation(scene: &mut CpuScene) {
    if scene.bitmap.is_some() {
        let started = Instant::now();
        scene.meshes = Vec::new();
        scene.fallback_meshes = OnceLock::new();
        scene.pipeline_duration += started.elapsed();
    }
}

#[cfg(target_os = "linux")]
fn build_raster_scene(
    request: &SceneRequest,
    renderer: &mut Option<Result<offscreen::OffscreenRenderer, ()>>,
    is_current: impl Fn() -> bool + Sync,
    mut publish_initial: impl FnMut(Vec<u8>, usize),
    publish: impl FnMut(Vec<u8>, usize),
    prepared: impl FnOnce(&CpuScene),
) -> Option<CpuScene> {
    if request.glow {
        let renderer = renderer.get_or_insert_with(|| {
            offscreen::OffscreenRenderer::new(request.glow_renderer.as_deref().unwrap_or_default())
                .map_err(|error| {
                    eprintln!("Background rasterization unavailable; using UI batches: {error}");
                })
        });
        if let Ok(active) = renderer {
            if request.initial_progress {
                // Reuse the UI-prepared geometry as the first worker seed. A
                // larger bounded sample may refine it without a gray prefix.
                if let Some(seeds) = request
                    .initial_scene
                    .clone()
                    .or_else(|| builder::build_initial_scene(request, &is_current).map(Arc::new))
                {
                    match active.rasterize_initial_seeds(&seeds, request, &is_current) {
                        Ok(Some((pixels, _))) if is_current() => {
                            publish_initial(pixels, seeds.primitives)
                        }
                        Ok(_) => {}
                        Err(error) => eprintln!("Initial seed rasterization unavailable: {error}"),
                    }
                }
            }

            if request.initial_scene.is_some() && is_current() {
                if let Some(refined) =
                    builder::build_initial_scene(request, &is_current).filter(|refined| {
                        request
                            .initial_scene
                            .as_ref()
                            .is_some_and(|initial| refined.covers_initial_records(initial))
                    })
                {
                    match active.rasterize_initial_seeds(&refined, request, &is_current) {
                        Ok(Some((pixels, _))) if is_current() => {
                            publish_initial(pixels, refined.primitives)
                        }
                        Ok(_) => {}
                        Err(error) => eprintln!("Initial refinement unavailable: {error}"),
                    }
                }
            }

            match active.build_streaming_scene_with_prepared(
                request,
                &is_current,
                publish,
                prepared,
            ) {
                Ok(scene) => return scene,
                Err(error) => {
                    eprintln!("Background rasterization failed; using UI batches: {error}");
                    *renderer = Err(());
                }
            }
        }
    }
    builder::build_with_workers(request, &is_current, builder::worker_count())
}
