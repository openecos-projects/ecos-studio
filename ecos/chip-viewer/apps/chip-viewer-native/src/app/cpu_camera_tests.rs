use super::*;

#[test]
fn anchored_pan_dispatches_without_waiting_for_input_to_stop() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let scene = Arc::new(builder::build_with_workers(&request, &|| true, 1).unwrap());
    let mut cache = CpuSceneCache::default();
    cache.key = Some(request.key.clone());
    cache.anchor = Some(Arc::clone(&scene));
    cache.ready = Some(scene);
    for offset in [3.0, 6.0, 9.0] {
        let mut next = fixture.request(1.0, 1.0);
        next.key.pan.x = offset;
        assert!(cache.get_or_request(next).is_none());
        assert!(cache.pending.is_none(), "pan must dispatch during input");
    }
}

#[test]
fn preview_transform_matches_camera_projection_after_pan_zoom_and_resize() {
    let fixture = Fixture::new();
    let source = fixture.request(1.0, 1.0).key;
    for zoom in [0.5, 1.0, 4.0] {
        let mut current = source.clone();
        current.zoom = zoom;
        current.pan = egui::vec2(37.0, -19.0);
        current.canvas =
            egui::Rect::from_min_size(egui::pos2(40.0, 50.0), egui::vec2(800.0, 600.0));
        let transform =
            egui::emath::RectTransform::from_to(source.canvas, current.destination(&source));
        for point in [
            Point32 { x: 0, y: 0 },
            Point32 { x: 1000, y: 1000 },
            Point32 { x: 370, y: 610 },
        ] {
            let previous =
                world_to_screen_point(point, source.world, source.canvas, source.zoom, source.pan);
            let expected = world_to_screen_point(
                point,
                current.world,
                current.canvas,
                current.zoom,
                current.pan,
            );
            assert!((transform.transform_pos(previous) - expected).length() < 0.001);
        }
    }
}

#[test]
fn preview_accepts_camera_changes_but_rejects_hidden_or_changed_geometry() {
    let fixture = Fixture::new();
    let source = fixture.request(1.0, 1.0).key;
    let mut camera = fixture.request(4.0, 1.0).key;
    camera.pan.x = 40.0;
    camera.viewport.hx -= 10;
    camera.font_texture_size[1] *= 2;
    camera.selected = Some(1);
    camera.highlighted.insert(2);
    assert!(camera.compatible(&source));
    let mut changed = camera.clone();
    changed.epoch += 1;
    assert!(!changed.compatible(&source));
    let mut changed = camera.clone();
    changed.layers += 1;
    assert!(!changed.compatible(&source));
    let mut changed = camera;
    changed.visibility.set_all_visible(false);
    assert!(!changed.compatible(&source));
}

#[test]
fn zoom_transition_rejects_completed_pixels_from_a_different_scale() {
    let fixture = Fixture::new();
    for source_zoom in [1.0, 2.6125715, 46.587826, 317.98645] {
        let source = fixture.request(source_zoom, 1.0).key;
        for zoom in [1.0, 2.6125715, 6.825528, 17.832176, 46.587826, 121.714] {
            let mut requested = fixture.request(zoom, 1.0).key;
            requested.pan = egui::vec2(37.0, -19.0);
            assert_eq!(
                requested.raster_destination(&source),
                (zoom == source_zoom).then(|| requested.destination(&source))
            );
        }
    }
}

#[test]
fn same_scale_pan_still_translates_the_completed_frame() {
    let fixture = Fixture::new();
    let source = fixture.request(2.0, 1.0).key;
    let mut requested = source.clone();
    requested.pan = egui::vec2(37.0, -19.0);
    assert_eq!(
        requested.raster_destination(&source),
        Some(source.canvas.translate(requested.pan))
    );
    requested.canvas.max.x += 250.0;
    requested.canvas.max.y += 200.0;
    assert_eq!(requested.raster_destination(&source), None);
}

#[test]
fn returning_to_geometry_with_cancelled_labels_resumes_the_same_scene() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let scene = Arc::new(builder::build_with_workers(&request, &|| true, 1).unwrap());
    let expected = labels::LabelResolver::default()
        .resolve(&request, &scene.labels.snapshot(), || true)
        .unwrap();
    let mut cache = CpuSceneCache::default();
    cache.anchor = Some(Arc::clone(&scene));
    cache.key = Some(fixture.request(4.0, 1.0).key);
    let ready = cache.get_or_request(fixture.request(1.0, 1.0)).unwrap();
    assert!(Arc::ptr_eq(&scene, &ready));
    assert!(cache.pending.is_none());
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.labels_ready() {
        assert!(
            Instant::now() < deadline,
            "cached scene labels never resumed"
        );
        thread::sleep(Duration::from_millis(5));
    }
    let refreshed = cache.get_or_request(fixture.request(1.0, 1.0)).unwrap();
    assert!(Arc::ptr_eq(&scene, &refreshed));
    assert_eq!(*refreshed.resolved_labels(), expected);
}

#[test]
fn zoom_requests_start_without_waiting_for_pan_debounce() {
    let fixture = Fixture::new();
    let mut cache = CpuSceneCache::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    while cache.get_or_request(fixture.request(1.0, 1.0)).is_none() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    for zoom in [
        317.98645, 121.714, 46.587826, 17.832176, 6.825528, 2.6125715,
    ] {
        let _scene = cache.get_or_request(fixture.request(zoom, 1.0));
        assert!(
            cache.pending.is_none(),
            "zoom work was delayed until input stopped"
        );
    }
}

#[test]
fn repeating_camera_requests_does_not_restart_inflight_work() {
    let fixture = Fixture::new();
    let mut cache = CpuSceneCache::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    while cache.get_or_request(fixture.request(1.0, 1.0)).is_none() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    let mut request = fixture.request(1.0, 1.0);
    request.key.pan.x = 30.0;
    let _scene = cache.get_or_request(request);
    let generation = cache.inbox.generation.load(Ordering::Relaxed);
    for _attempt in 0..3 {
        let mut request = fixture.request(1.0, 1.0);
        request.key.pan.x = 30.0;
        let _scene = cache.get_or_request(request);
        assert!(cache.pending.is_none());
        assert_eq!(cache.inbox.generation.load(Ordering::Relaxed), generation);
    }
}

#[test]
fn parallel_chunks_preserve_full_mesh_and_label_results() {
    let fixture = Fixture::new();
    for zoom in [1.0, 2.0] {
        let request = fixture.request(zoom, 1.5);
        let serial = builder::build_with_workers(&request, &|| true, 1).unwrap();
        let parallel = builder::build_with_workers(&request, &|| true, 3).unwrap();
        let merged = |scene: &CpuScene| {
            let mut mesh = egui::Mesh::default();
            for part in &scene.meshes {
                let egui::epaint::Primitive::Mesh(part) = &part.primitive else {
                    panic!("expected an exact mesh");
                };
                mesh.append(part.clone());
            }
            mesh
        };
        assert_eq!(merged(&serial), merged(&parallel));
        assert_eq!(
            (serial.drawn, serial.primitives),
            (parallel.drawn, parallel.primitives)
        );
        let labels = |scene: &CpuScene| {
            scene
                .labels
                .snapshot()
                .resolve(request.key.canvas, |text, size| {
                    egui::vec2(text.len() as f32 * size * 0.5, size)
                })
        };
        assert_eq!(
            format!("{:?}", labels(&serial)),
            format!("{:?}", labels(&parallel))
        );
    }
}
