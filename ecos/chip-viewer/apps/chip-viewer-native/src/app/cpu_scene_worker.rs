use super::*;

pub(super) fn spawn(
    worker_inbox: Arc<WorkerInbox>,
    worker_progress: Arc<progress::ProgressMailbox>,
    outgoing: mpsc::Sender<(u64, Arc<CpuScene>)>,
) {
    thread::spawn(move || {
        let label_worker = labels::LabelWorker::new(Arc::clone(&worker_inbox));
        let evidence_directory =
            std::env::var_os("ECOS_RENDER_PROGRESS_EVIDENCE").map(PathBuf::from);
        #[cfg(target_os = "linux")]
        let mut renderer = None;
        loop {
            let (generation, request, retained) = {
                let mut pending = worker_inbox.request.lock().unwrap();
                while pending.is_none() && !worker_inbox.stopped.load(Ordering::Relaxed) {
                    pending = worker_inbox.wake.wait(pending).unwrap();
                }
                if worker_inbox.stopped.load(Ordering::Relaxed) {
                    break;
                }
                pending.take().unwrap()
            };
            let is_current = || {
                !worker_inbox.stopped.load(Ordering::Relaxed)
                    && worker_inbox.generation.load(Ordering::Relaxed) == generation
            };
            let scene = if let Some(scene) = retained {
                scene
            } else if let Some(mut scene) = {
                #[cfg(target_os = "linux")]
                {
                    build_raster_scene(
                        &request,
                        &mut renderer,
                        is_current,
                        |pixels, sequence| {
                            if is_current() {
                                let frame = progress::ProgressFrame {
                                    key: request.key.clone(),
                                    generation,
                                    sequence,
                                    pixels: pixels.into(),
                                };
                                if let Some(directory) = &evidence_directory {
                                    if let Err(error) = frame.record_evidence(directory) {
                                        eprintln!("Progress evidence unavailable: {error}");
                                    }
                                }
                                worker_progress.publish(frame);
                                request.repaint.request_repaint();
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
