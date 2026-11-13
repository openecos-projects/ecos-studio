use super::*;

#[cfg(target_os = "linux")]
#[test]
fn initial_evidence_for_superseded_cameras_is_flushed_before_the_latest_scene_arrives() {
    let fixture = Fixture::new();
    let directory = fixture.path.join("queued-camera-evidence");
    let evidence = progress::InitialEvidence::new(Some(directory.clone()));
    let payload = [13, 29, 51, 255].repeat(640 * 480);
    for generation in [4, 5] {
        evidence
            .enqueue(Arc::new(progress::ProgressFrame::new(
                fixture.request(generation as f32, 1.0).key,
                generation,
                64,
                payload.clone(),
            )))
            .unwrap();
    }
    let mut request = fixture.request(5.0, 1.0);
    request.glow = false;
    let inbox = Arc::new(WorkerInbox {
        request: Mutex::new(Some((5, request, None))),
        wake: Condvar::new(),
        generation: AtomicU64::new(5),
        stopped: AtomicBool::new(false),
        initial_evidence: evidence,
    });
    let (outgoing, incoming) = mpsc::channel();
    worker::spawn(Arc::clone(&inbox), Arc::default(), outgoing);
    let (generation, _) = incoming.recv_timeout(Duration::from_secs(5)).unwrap();
    inbox.stopped.store(true, Ordering::Relaxed);
    inbox.wake.notify_one();
    assert_eq!(generation, 5);
    for generation in [4, 5] {
        assert_eq!(
            fs::read(directory.join(format!("{generation}-64.rgba"))).unwrap(),
            payload
        );
        assert!(directory.join(format!("{generation}-64.json")).exists());
    }
}

#[test]
fn publishing_progress_keeps_the_original_pixel_allocation() {
    let fixture = Fixture::new();
    let key = fixture.request(1.0, 1.0).key;
    let mut pixels = Vec::with_capacity(4096);
    pixels.extend([13, 29, 51, 83].repeat(256));
    let original = pixels.as_ptr();
    let frame = progress::ProgressFrame::new(key.clone(), 4, 32, pixels);
    let mailbox = progress::ProgressMailbox::default();
    let frame = mailbox.publish(frame);
    assert_eq!(frame.pixels.as_ptr(), original);
    let current = mailbox.current(&key, 4).unwrap();
    assert!(Arc::ptr_eq(&current, &frame));
    assert_eq!(
        current.pixels.as_ref(),
        [13, 29, 51, 83].repeat(256).as_slice()
    );
}

#[test]
fn repeated_prefix_requires_every_pixel_and_all_publication_identity_fields_to_match() {
    let fixture = Fixture::new();
    let key = fixture.request(1.0, 1.0).key;
    let mailbox = progress::ProgressMailbox::default();
    let pixels = [13, 29, 51, 83].repeat(256);
    assert!(!mailbox.contains(&key, 4, 64, &pixels));
    mailbox.publish(progress::ProgressFrame::new(
        key.clone(),
        4,
        64,
        pixels.clone(),
    ));
    assert!(mailbox.contains(&key, 4, 64, &pixels));
    assert!(!mailbox.contains(&key, 5, 64, &pixels));
    assert!(!mailbox.contains(&key, 4, 65, &pixels));
    assert!(!mailbox.contains(&fixture.request(2.0, 1.0).key, 4, 64, &pixels));
    assert!(!mailbox.contains(&key, 4, 64, &pixels[..pixels.len() - 1]));
    let mut changed = pixels.clone();
    *changed.last_mut().unwrap() ^= 1;
    assert!(!mailbox.contains(&key, 4, 64, &changed));
}

#[test]
fn progress_mailbox_rejects_stale_camera_and_generation() {
    let fixture = Fixture::new();
    let key = fixture.request(1.0, 1.0).key;
    let mailbox = progress::ProgressMailbox::default();
    for sequence in [16, 32] {
        let published = mailbox.publish(progress::ProgressFrame {
            key: key.clone(),
            generation: 4,
            sequence,
            pixels: Arc::new(vec![sequence as u8; 4]),
        });
        assert!(Arc::ptr_eq(&published, &mailbox.current(&key, 4).unwrap()));
        let evidence = fixture.path.join("progress-evidence");
        published.record_evidence(&evidence).unwrap();
        assert_eq!(
            fs::read(evidence.join(format!("4-{sequence}.rgba"))).unwrap(),
            published.pixels.as_slice(),
        );
        assert!(Arc::ptr_eq(&published, &mailbox.current(&key, 4).unwrap()));
    }
    assert_eq!(mailbox.current(&key, 4).unwrap().sequence, 32);
    assert!(mailbox.current(&key, 3).is_none());
    assert!(mailbox.current(&fixture.request(2.0, 1.0).key, 4).is_none());
    mailbox.clear();
    assert!(mailbox.current(&key, 4).is_none());
}

#[test]
fn exact_camera_history_reuses_scene_after_intermediate_view() {
    let fixture = Fixture::new();
    let mut cache = CpuSceneCache::default();
    let wait = |cache: &mut CpuSceneCache, zoom| {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(scene) = cache.get_or_request(fixture.request(zoom, 1.0)) {
                if scene.labels_ready() {
                    break scene;
                }
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        }
    };
    let first = wait(&mut cache, 1.0);
    let second = wait(&mut cache, 2.0);
    let third = wait(&mut cache, 3.0);
    assert!(!Arc::ptr_eq(&second, &third));
    let restored = cache.get_or_request(fixture.request(2.0, 1.0)).unwrap();
    assert!(Arc::ptr_eq(&second, &restored));
    assert!(cache.pending.is_none());
    let restored = cache.get_or_request(fixture.request(1.0, 1.0)).unwrap();
    assert!(Arc::ptr_eq(&first, &restored));
}

#[test]
fn bitmap_history_shares_pixels_and_rebuilds_meshes_when_gl_cache_fails() {
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    let mut original = build_scene(&mut request, || true).unwrap();
    original.bitmap = Some(vec![17; 640 * 480 * 4].into());
    let _ = original
        .completed_labels
        .set((Arc::default(), Duration::ZERO));
    let original = Arc::new(original);
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&original));
    let cached = history.get(&request.key).unwrap();
    assert!(cached.meshes.is_empty());
    assert!(Arc::ptr_eq(
        original.bitmap.as_ref().unwrap(),
        cached.bitmap.as_ref().unwrap()
    ));
    assert_eq!(history.byte_len(), 640 * 480 * 4);
    let mut cache = CpuSceneCache::default();
    cache.key = Some(request.key.clone());
    cache.ready = Some(cached);
    cache.raster.disable();
    request.glow = true;
    assert!(cache.get_or_request(request).is_none());
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let mut request = fixture.request(1.0, 1.0);
        request.glow = true;
        if let Some(rebuilt) = cache.get_or_request(request) {
            assert!(!rebuilt.meshes.is_empty());
            assert!(rebuilt.bitmap.is_none());
            assert!(!rebuilt.prepare_fallback().is_empty());
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn completed_bitmap_retires_geometry_before_ui_handoff_and_preserves_label_resumption() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    assert!(!scene.meshes.is_empty());
    worker::prepare_presentation(&mut scene);
    assert!(!scene.meshes.is_empty());
    assert!(!scene.prepare_fallback().is_empty());
    let pixels: Arc<[u8]> = vec![17; 640 * 480 * 4].into();
    scene.bitmap = Some(Arc::clone(&pixels));
    let labels = scene.labels.snapshot();
    let completion = Arc::clone(&scene.completed_labels);
    let counts = (scene.drawn, scene.primitives, scene.overlay_drawn);
    worker::prepare_presentation(&mut scene);
    assert!(scene.meshes.is_empty());
    assert!(scene.fallback_meshes.get().is_none());
    assert!(Arc::ptr_eq(scene.bitmap.as_ref().unwrap(), &pixels));
    assert!(Arc::ptr_eq(&scene.labels.snapshot(), &labels));
    assert!(Arc::ptr_eq(&scene.completed_labels, &completion));
    assert_eq!((scene.drawn, scene.primitives, scene.overlay_drawn), counts);
    let scene = Arc::new(scene);
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&scene));
    let restored = history.get(&request.key).unwrap();
    assert!(Arc::ptr_eq(&restored, &scene));
    assert!(!restored.labels_ready());
    let _ = completion.set((Arc::default(), Duration::ZERO));
    assert!(restored.labels_ready());
}

#[test]
fn mesh_history_reserves_the_fallback_copy_before_it_is_materialized() {
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    let mut scene = build_scene(&mut request, || true).unwrap();
    scene.fallback_meshes = OnceLock::new();
    let primary: usize = scene
        .meshes
        .iter()
        .map(|primitive| {
            let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                unreachable!()
            };
            mesh.vertices.capacity() * size_of::<egui::epaint::Vertex>()
                + mesh.indices.capacity() * size_of::<u32>()
        })
        .sum();
    let scene = Arc::new(scene);
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&scene));
    assert!(history.byte_len() > primary);
    let reserved = history.byte_len();
    assert!(!scene.prepare_fallback().is_empty());
    history.insert(scene);
    assert_eq!(history.byte_len(), reserved);
}

#[cfg(target_os = "linux")]
#[test]
fn progressive_gl_snapshots_match_original_ordered_geometry_prefixes() {
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL snapshot check unavailable");
        return;
    };
    let mut request = fixture.request(1.0, 1.0);
    let mut scene = build_scene(&mut request, || true).unwrap();
    let original = std::mem::take(&mut scene.meshes);
    scene.meshes = (0..64)
        .map(|index| original[index % original.len()].clone())
        .collect();
    let mut updates = Vec::new();
    let complete = renderer
        .rasterize_updates(
            &scene,
            &request,
            || true,
            |pixels, count| updates.push((pixels, count)),
            Some([Duration::ZERO; 2]),
        )
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(updates.len(), 3);
    let meshes = scene.meshes.clone();
    for (pixels, count) in updates {
        scene.meshes = meshes[..count].to_vec();
        let expected = renderer
            .rasterize(&scene, &request, || true, |_, _| {})
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(pixels, expected);
    }
    scene.meshes = meshes;
    let repeated = renderer
        .rasterize(&scene, &request, || true, |_, _| {})
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(complete, repeated);
    request.publication = progress::Publication::Complete;
    let mut publications = 0;
    let final_only = renderer
        .rasterize(&scene, &request, || true, |_, _| publications += 1)
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(publications, 0);
    assert_eq!(final_only, complete);
    let current = AtomicBool::new(true);
    let cancelled = renderer
        .rasterize_updates(
            &scene,
            &request,
            || current.load(Ordering::Relaxed),
            |_, _| current.store(false, Ordering::Relaxed),
            Some([Duration::ZERO; 2]),
        )
        .unwrap();
    assert!(cancelled.is_none());
}
