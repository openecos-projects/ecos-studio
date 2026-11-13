use super::*;

fn geometry_inbox(generation: u64) -> Arc<WorkerInbox> {
    Arc::new(WorkerInbox {
        request: Mutex::new(None),
        wake: Condvar::new(),
        generation: AtomicU64::new(generation),
        stopped: AtomicBool::new(false),
        #[cfg(target_os = "linux")]
        initial_evidence: progress::InitialEvidence::new(None),
    })
}

fn wait_for_labels(completed: &LabelCompletion) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while completed.get().is_none() {
        assert!(
            Instant::now() < deadline,
            "label worker never completed the current scene"
        );
        thread::sleep(Duration::from_millis(2));
    }
}

fn scene_with_candidate(request: &SceneRequest) -> CpuScene {
    let mut scene = builder::build_with_workers(request, &|| true, 1).unwrap();
    scene.labels.insert(ShapeLabelCandidate {
        key: ShapeLabelKey::Owner {
            owner_type: OwnerType::InstanceBBox as u8,
            owner_id: 901,
        },
        anchor_rect: request.key.canvas,
        text: "worker-owned-candidate".to_string(),
        kind: ShapeLabelKind::Instance,
        rank_area: request.key.canvas.area(),
        selected: true,
        highlighted: false,
    });
    scene
}

#[test]
fn label_job_shares_inputs_and_can_finish_after_geometry_scene_is_dropped() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.5);
    let scene = scene_with_candidate(&request);
    let expected = labels::LabelResolver::default()
        .resolve(&request, &scene.labels.snapshot(), || true)
        .unwrap();
    let completed = Arc::clone(&scene.completed_labels);
    let worker = labels::LabelWorker::new(geometry_inbox(7));
    worker.submit(&request, 7, &scene);
    worker.submit(&request, 7, &scene);
    drop(scene);
    wait_for_labels(&completed);
    assert_eq!(*completed.get().unwrap().0, expected);
}

#[test]
fn obsolete_generation_is_rejected_and_cached_unfinished_labels_can_resume() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.0);
    let scene = scene_with_candidate(&request);
    let expected = labels::LabelResolver::default()
        .resolve(&request, &scene.labels.snapshot(), || true)
        .unwrap();
    let inbox = geometry_inbox(9);
    let worker = labels::LabelWorker::new(Arc::clone(&inbox));
    worker.submit(&request, 8, &scene);
    assert!(!scene.labels_ready());
    worker.submit(&request, 9, &scene);
    inbox.generation.store(10, Ordering::Relaxed);
    worker.submit(&request, 10, &scene);
    wait_for_labels(&scene.completed_labels);
    assert_eq!(*scene.resolved_labels(), expected);
    let started = Instant::now();
    drop(worker);
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn full_ready_retires_raw_candidates_while_scene_and_cached_completion_stay_alive() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.0);
    let scene = Arc::new(scene_with_candidate(&request));
    let candidates = scene.labels.snapshot();
    assert!(!candidates.is_empty());
    let expected = labels::LabelResolver::default()
        .resolve(&request, &candidates, || true)
        .unwrap();
    assert!(!expected.labels.is_empty());
    let retired = Arc::downgrade(&candidates);
    drop(candidates);
    let completed = Arc::clone(&scene.completed_labels);
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&scene));
    let worker = labels::LabelWorker::new(geometry_inbox(11));
    worker.submit(&request, 11, &scene);
    wait_for_labels(&completed);
    assert!(retired.upgrade().is_none());
    assert!(scene.labels.snapshot().is_empty());
    assert_eq!(*scene.resolved_labels(), expected);
    let restored = history.get(&request.key).unwrap();
    assert_eq!(*restored.resolved_labels(), expected);
    worker.submit(&request, 11, &restored);
    assert_eq!(*restored.resolved_labels(), expected);
}

#[cfg(target_os = "linux")]
#[test]
fn labels_can_finish_before_the_geometry_raster_readback() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let worker = labels::LabelWorker::new(geometry_inbox(3));
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL label-overlap check unavailable");
        return;
    };
    let scene = renderer
        .build_streaming_scene_with_prepared(
            &request,
            || true,
            |_, _| {},
            |scene| {
                assert!(scene.bitmap.is_none());
                worker.submit(&request, 3, scene);
                wait_for_labels(&scene.completed_labels);
            },
        )
        .unwrap()
        .unwrap();
    assert!(scene.bitmap.is_some());
    assert!(scene.labels_ready());
}
