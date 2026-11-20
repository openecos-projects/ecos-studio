use super::*;

#[cfg(target_os = "linux")]
#[test]
fn compact_grid_shader_matches_original_full_rgba_at_fractional_cameras() {
    let fixture = Fixture::new();
    let mut renderer = match offscreen::OffscreenRenderer::new("") {
        Ok(renderer) => renderer,
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_COVERAGE_EGL").is_none(),
                "{error}"
            );
            return;
        }
    };
    for scale in [1.0, 1.25, 2.0, 4.0] {
        let mut request = fixture.request(2.6125708, scale);
        request.key.screen_size = [509, 503];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(11.25, 15.5) / scale,
            egui::pos2(499.5, 501.25) / scale,
        );
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        let output = fixture.ctx.run(egui::RawInput::default(), |ctx| {
            let painter = ctx.layer_painter(egui::LayerId::background());
            for index in 0..300 {
                let position = (index as f32 * 1.73 - 3.25) / scale;
                let stroke = egui::Stroke::new(
                    [0.5, 1.0, 2.0, 3.25][index % 4],
                    egui::Color32::from_rgba_premultiplied(
                        (index * 37) as u8,
                        (index * 71) as u8,
                        (index * 137) as u8,
                        [31, 82, 104, 255][index % 4],
                    ),
                );
                painter.line_segment(
                    [
                        egui::pos2(position, -3.25 / scale),
                        egui::pos2(position, 509.75 / scale),
                    ],
                    stroke,
                );
                painter.line_segment(
                    [
                        egui::pos2(-4.5 / scale, position),
                        egui::pos2(513.5 / scale, position),
                    ],
                    stroke,
                );
            }
        });
        let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
        scene.meshes =
            builder::prepare_meshes(request.tessellator.clone().tessellate_shapes(output.shapes));
        for primitive in &mut scene.meshes {
            primitive.clip_rect = request.key.canvas;
        }
        let reference = renderer
            .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap()
            .0;
        let actual = renderer.rasterize_compact(&scene, &request).unwrap();
        renderer.with_context(|gl| {
            if sparse_rects::certified_profile(gl) {
                assert!(renderer.solid_shader_active());
            }
        });
        let differences = actual
            .iter()
            .zip(&reference)
            .enumerate()
            .filter(|(_, (actual, expected))| actual != expected)
            .take(16)
            .collect::<Vec<_>>();
        assert!(differences.is_empty(), "DPR {scale}: {differences:?}");
    }
}

#[test]
fn overlay_only_bitmap_rebuilds_for_mesh_fallback_after_presentation_failure() {
    let mut fixture = Fixture::new();
    fs::write(
        fixture.path.join("geometry.grids.txt"),
        "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\ntrack\t0\tx\t0\t20\t51\t1\t\ngcell\t1\ty\t0\t100\t11\t2\t\n",
    )
    .unwrap();
    fixture.db = Arc::new(ChipViewDb::open(fixture.path.join("geometry.manifest")).unwrap());
    let request = || {
        let mut request = fixture.request(2.0, 1.0);
        request.layer_ids.clear();
        request.key.cache_overlays = true;
        request.glow = true;
        request
    };
    let initial = request();
    let mut scene = builder::build_with_workers(&initial, &|| true, 1).unwrap();
    assert_eq!(scene.drawn, 0);
    assert!(scene.overlay_drawn > 0);
    assert!(!scene.meshes.is_empty());
    scene.bitmap = Some(vec![17; 640 * 480 * 4].into());
    worker::prepare_presentation(&mut scene);
    let mut cache = CpuSceneCache::default();
    cache.key = Some(initial.key);
    cache.ready = Some(Arc::new(scene));
    cache.raster.disable();
    assert!(cache.get_or_request(request()).is_none());
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(rebuilt) = cache.get_or_request(request()) {
            assert_eq!(rebuilt.drawn, 0);
            assert!(rebuilt.overlay_drawn > 0);
            assert!(rebuilt.bitmap.is_none());
            assert!(!rebuilt.prepare_fallback().is_empty());
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn cached_grid_meshes_match_live_overlay_at_different_cameras_and_visibility() {
    let mut fixture = Fixture::new();
    fs::write(
        fixture.path.join("geometry.grids.txt"),
        "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\ntrack\t0\tx\t0\t20\t51\t1\t\ngcell\t1\ty\t0\t100\t11\t2\t\n",
    ).unwrap();
    fixture.db = Arc::new(ChipViewDb::open(fixture.path.join("geometry.manifest")).unwrap());
    assert_eq!(fixture.db.grid_metadata().len(), 2);
    for (zoom, dpi, visible) in [
        (1.0, 1.0, true),
        (2.5, 1.5, true),
        (4.0, 2.0, true),
        (2.5, 1.0, false),
    ] {
        let mut request = fixture.request(zoom, dpi);
        request.key.cache_overlays = true;
        request.key.visibility.set_all_visible(visible);
        request.key.pan = egui::vec2(27.0, -13.0);
        request.key.viewport = screen_to_world_rect(
            request.key.canvas,
            request.key.world,
            request.key.canvas,
            zoom,
            request.key.pan,
        );
        let (actual, drawn) = overlays::build(&request, || true).unwrap();
        let key = &request.key;
        let mut expected_drawn = 0;
        let output = fixture.ctx.run(
            egui::RawInput {
                screen_rect: Some(key.canvas),
                ..Default::default()
            },
            |ctx| {
                let painter = ctx
                    .layer_painter(egui::LayerId::background())
                    .with_clip_rect(key.canvas);
                expected_drawn = paint_parameterized_grid_overlay(
                    &painter,
                    fixture.db.grid_metadata(),
                    &request.grid_layers,
                    key.visibility,
                    key.viewport,
                    key.grid_bounds,
                    key.world,
                    key.canvas,
                    key.zoom,
                    key.pan,
                );
            },
        );
        let expected = request.tessellator.clone().tessellate_shapes(output.shapes);
        let merge = |primitives: Vec<egui::ClippedPrimitive>| {
            let mut combined = egui::Mesh::default();
            for primitive in primitives {
                assert_eq!(primitive.clip_rect, key.canvas);
                let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive else {
                    panic!("unexpected callback");
                };
                combined.append(mesh);
            }
            combined
        };
        assert_eq!(drawn, expected_drawn);
        assert_eq!(drawn > 0, zoom > 1.25 && visible);
        assert_eq!(merge(actual), merge(expected));
        assert!(overlays::build(&request, || false).is_none());
    }
}

#[test]
fn overlay_order_policy_and_grid_bounds_invalidate_completed_scene() {
    let fixture = Fixture::new();
    let source = fixture.request(1.0, 1.0).key;
    let mut changed = source.clone();
    changed.cache_overlays = !source.cache_overlays;
    assert_ne!(source, changed);
    assert!(!source.compatible(&changed));
    let mut changed = source.clone();
    changed.grid_bounds.hx += 1;
    assert_ne!(source, changed);
    assert!(!source.compatible(&changed));
}
