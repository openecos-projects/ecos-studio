use super::*;

fn layered_request(fixture: &Fixture, records_per_layer: usize) -> SceneRequest {
    layered_request_with_spread(fixture, records_per_layer, false)
}

fn layered_request_with_spread(
    fixture: &Fixture,
    records_per_layer: usize,
    spread: bool,
) -> SceneRequest {
    use crate::app::tests::{write_empty_geometry_file, write_empty_snapshot};
    use chipgeom_format::{GeometryFileKind, GeometryMetaRecord};
    let path = fixture
        .path
        .join(format!("initial-layers-{records_per_layer}-{spread}"));
    fs::create_dir_all(&path).unwrap();
    write_empty_snapshot(&path, false);
    let mut shapes = Vec::new();
    for layer in 0..3 {
        for index in 0..records_per_layer {
            shapes.push(ShapeRecord {
                id: (layer as usize * records_per_layer + index + 1) as u64,
                layer_id: layer,
                kind: chipgeom_format::ShapeKind::Rect as u8,
                state: chipgeom_format::ShapeState::Alive as u8,
                bbox: if spread {
                    let x = (index % 16) as i32 * 8;
                    let y = ((index / 16) % 4) as i32 * 8 + i32::from(layer) * 40;
                    Rect32 {
                        lx: x,
                        ly: y,
                        hx: x + 6,
                        hy: y + 6,
                    }
                } else {
                    Rect32 {
                        lx: 4 + i32::from(layer) * 36,
                        ly: 8,
                        hx: 24 + i32::from(layer) * 36,
                        hy: 28,
                    }
                },
                ..Default::default()
            });
        }
    }
    let meta = GeometryMetaRecord {
        shape_count: shapes.len() as u64,
        ..Default::default()
    };
    write_empty_geometry_file(
        &path.join("geometry.meta.bin"),
        GeometryFileKind::Meta,
        size_of::<GeometryMetaRecord>() as u32,
        bytemuck::bytes_of(&meta),
    );
    write_empty_geometry_file(
        &path.join("geometry.shapes.bin"),
        GeometryFileKind::Shapes,
        size_of::<ShapeRecord>() as u32,
        bytemuck::cast_slice(&shapes),
    );
    let sidmap = shapes
        .iter()
        .map(|shape| chipgeom_format::GeometrySidMapRecord {
            shape_id: shape.id,
            ..Default::default()
        })
        .collect::<Vec<_>>();
    write_empty_geometry_file(
        &path.join("geometry.sidmap.bin"),
        GeometryFileKind::SidMap,
        size_of::<chipgeom_format::GeometrySidMapRecord>() as u32,
        bytemuck::cast_slice(&sidmap),
    );
    write_empty_geometry_file(
        &path.join("geometry.view.bin"),
        GeometryFileKind::View,
        size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
        bytemuck::bytes_of(&chipgeom_format::GeometryViewTileRecord::default()),
    );
    let manifest = path.join("geometry.manifest");
    fs::write(
        &manifest,
        fs::read_to_string(&manifest)
            .unwrap()
            .replace("shape_count=0", &format!("shape_count={}", shapes.len())),
    )
    .unwrap();
    let mut request = fixture.request(1.0, 1.0);
    request.db = Arc::new(ChipViewDb::open(manifest).unwrap());
    request.data_bounds = request.db.stats().bbox;
    request.key.world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 128,
        hy: 128,
    };
    request.key.viewport = request.key.world;
    request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(128.0, 128.0));
    request.key.screen_size = [128; 2];
    request.layer_ids = vec![0, 1, 2];
    request.layers = LayerRenderIndex::default();
    for (layer, rgba) in [
        (0, [128, 128, 128, 255]),
        (1, [237, 61, 47, 255]),
        (2, [41, 211, 117, 255]),
    ] {
        let mut style =
            chip_display::LayerStyle::default_for_layer(layer, chip_display::ColorTheme::Vivid);
        style.fill_pattern = FillPattern::Solid;
        style.rgba = rgba;
        style.frame_rgba = [0; 4];
        request.layers.visible_layer_map.insert(layer, true);
        request.layers.style_map.insert(layer, style);
    }
    request.zoom_rules = ZoomVisibilityRules::new(&request.db);
    request
}

fn renderer() -> offscreen::OffscreenRenderer {
    offscreen::OffscreenRenderer::new("").expect("initial GL seeds require EGL; do not skip")
}

fn initial_pixels(
    renderer: &mut offscreen::OffscreenRenderer,
    request: &SceneRequest,
) -> (usize, Vec<u8>) {
    let seeds =
        builder::build_initial_scene(request, &|| true).expect("visible layer seeds prepare");
    let (pixels, _) = renderer
        .rasterize_initial_seeds(&seeds, request, || true)
        .unwrap()
        .unwrap();
    (seeds.primitives, pixels)
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_does_not_starve_visible_layers_behind_layer_zero() {
    let fixture = Fixture::new();
    let request = layered_request(&fixture, 128);
    let (_, pixels) = initial_pixels(&mut renderer(), &request);
    for color in [[237, 61, 47, 255], [41, 211, 117, 255]] {
        assert!(
            pixels.chunks_exact(4).any(|pixel| pixel == color),
            "visible layer color {color:?} missing from the first current-camera frame"
        );
    }
}

#[test]
fn initial_progress_worker_refines_the_ui_sample_to_full_visible_layer_coverage() {
    let fixture = Fixture::new();
    let request = layered_request_with_spread(&fixture, 1024, true);
    let ui = builder::build_ui_initial_scene(&request).unwrap();
    let refined = builder::build_initial_scene(&request, &|| true).unwrap();

    assert!(refined.covers_initial_records(&ui));
    assert!(refined.drawn > ui.drawn);
    assert_eq!(refined.drawn, 3 * 1024);
    assert_eq!(refined.initial_records.as_ref().unwrap().len(), 3 * 1024);
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_matches_ordered_layer_samples_and_independent_gl_pixels() {
    let mut renderer = renderer();
    let fixture = Fixture::new();
    for scale in [1.0, 2.0, 4.0] {
        for zoom in [1.0, 2.612572, 6.825526] {
            let request = fixture.request(zoom, scale);
            let mut reference = builder::build_with_workers(&request, &|| true, 1).unwrap();
            reference.meshes.clear();
            builder::build_raster_stream(&request, &|| true, |meshes, _| {
                reference.meshes.extend_from_slice(meshes);
                true
            })
            .unwrap();
            let expected = renderer
                .rasterize_updates(&reference, &request, || true, |_, _| {}, None)
                .unwrap()
                .unwrap()
                .0;
            let (_, actual) = initial_pixels(&mut renderer, &request);
            assert_eq!(actual, expected, "zoom {zoom}, DPR {scale}");
        }
    }
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [4096, 2160];
    assert!(
        builder::build_initial_scene(&request, &|| true).is_some(),
        "GL geometry preparation must not inherit the old 4M CPU pixel limit"
    );
    assert!(builder::build_initial_scene(&request, &|| false).is_none());
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; production GL seed diagnostic, not window acceptance timing"]
fn real_design_initial_progress_cost() {
    let path = std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
    let fixture = Fixture::new();
    let db = Arc::new(ChipViewDb::open(path).unwrap());
    let world = db.stats().bbox.unwrap();
    let visibility_by_layer = db
        .layer_catalog()
        .into_iter()
        .map(|layer| (layer.layer_id, true))
        .collect();
    let layers = layer_ui_states(&db, &visibility_by_layer, chip_display::ColorTheme::Foundry);
    let mut renderer = renderer();
    let patterns = Arc::new(PatternTextureSet::new(&fixture.ctx));
    let mut reports = Vec::new();
    for zoom in [121.713936, 46.587803, 17.832169, 6.825526, 2.612572, 1.0] {
        let mut request = fixture.request(zoom, 1.0);
        request.db = Arc::clone(&db);
        request.pattern_textures = Arc::clone(&patterns);
        request.data_bounds = Some(world);
        request.layers = LayerRenderIndex::new(&layers);
        request.grid_layers = layers.clone();
        request.zoom_rules = ZoomVisibilityRules::new(&db);
        request.layer_ids = render_query_layer_ids(&layers, request.key.visibility);
        request.key.world = world;
        request.key.grid_bounds = world;
        request.key.screen_size = [2048, 1280];
        request.key.canvas =
            egui::Rect::from_min_max(egui::pos2(320.0, 8.0), egui::pos2(1676.0, 1254.0));
        request.key.viewport = screen_to_world_rect(
            request.key.canvas,
            world,
            request.key.canvas,
            zoom,
            egui::Vec2::ZERO,
        );
        let mut total_times = Vec::new();
        let mut prepare_times = Vec::new();
        let mut raster_times = Vec::new();
        let mut successful = 0;
        let mut last_scene = None;
        for _ in 0..10 {
            let started = Instant::now();
            let seeds = builder::build_initial_scene(&request, &|| true);
            prepare_times.push(started.elapsed().as_secs_f64() * 1000.0);
            if let Some(scene) = seeds {
                let raster_started = Instant::now();
                let output = renderer
                    .rasterize_initial_seeds(&scene, &request, || true)
                    .unwrap();
                raster_times.push(raster_started.elapsed().as_secs_f64() * 1000.0);
                if let Some((pixels, _)) = output {
                    successful += 1;
                    last_scene = Some(serde_json::json!({
                        "shapes":scene.drawn, "commands":scene.primitives, "meshes":scene.meshes.len(),
                        "foreground":pixels.chunks_exact(4).filter(|pixel| *pixel != request.key.background.to_array()).count()
                    }));
                }
            }
            total_times.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let percentiles = |mut samples: Vec<f64>| {
            samples.sort_by(f64::total_cmp);
            if samples.is_empty() {
                return serde_json::Value::Null;
            }
            serde_json::json!({"p50_ms":samples[(samples.len()-1)/2], "p95_ms":samples[(samples.len()*95/100).min(samples.len()-1)]})
        };
        reports.push(serde_json::json!({"zoom":zoom, "successful":successful, "last_scene":last_scene,
            "prepare":percentiles(prepare_times), "gl_raster_readback":percentiles(raster_times), "total":percentiles(total_times)}));
    }
    let report = serde_json::json!({"diagnostic_only": true, "reports": reports});
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_INITIAL_PROGRESS_COST_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_seed_survives_large_layer_zero_prefix_and_resets_for_new_camera() {
    let fixture = Fixture::new();
    let request = layered_request(&fixture, 128);
    let mailbox = progress::ProgressMailbox::default();
    let (sequence, seed_pixels) = initial_pixels(&mut renderer(), &request);
    let seed = mailbox.publish_initial(progress::ProgressFrame::new(
        request.key.clone(),
        7,
        sequence,
        seed_pixels,
    ));
    let grey = vec![128; 128 * 128 * 4];
    for count in [1, sequence, sequence + 1, 1_000_000] {
        assert!(mailbox
            .publish_ordered(progress::ProgressFrame::new(
                request.key.clone(),
                7,
                count,
                grey.clone()
            ))
            .is_none());
        assert!(Arc::ptr_eq(
            &seed,
            &mailbox.current(&request.key, 7).unwrap()
        ));
    }
    let mut next = request.key.clone();
    next.zoom *= 2.0;
    assert!(
        mailbox.current(&next, 7).is_none(),
        "seed must never be scaled into a different camera"
    );
    mailbox.clear();
    assert!(mailbox
        .publish_ordered(progress::ProgressFrame::new(
            next.clone(),
            8,
            1,
            grey.clone()
        ))
        .is_some());
    assert_eq!(mailbox.current(&next, 8).unwrap().pixels.as_slice(), grey);
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_spreads_geometry_and_meets_a_reference_coverage_floor() {
    let fixture = Fixture::new();
    let request = layered_request_with_spread(&fixture, 1024, true);
    let (_, actual) = initial_pixels(&mut renderer(), &request);
    for color in [[237, 61, 47, 255], [41, 211, 117, 255]] {
        let count = actual
            .chunks_exact(4)
            .filter(|pixel| *pixel == color)
            .count();
        // Each colored layer has 64 unique 6x6 rectangles. Duplicates keep
        // large candidate sets in every cell; a clustered low-ID prefix cannot
        // satisfy this floor in all four horizontal parts of the viewport.
        assert!(
            count >= 64 * 36 / 4,
            "layer {color:?}: {count} pixels, below 25% reference"
        );
        for quarter in 0..4 {
            assert!(
                (0..128).any(|row| (quarter * 32..(quarter + 1) * 32).any(|column| {
                    actual[((127 - row) * 128 + column) * 4..((127 - row) * 128 + column) * 4 + 4]
                        == color
                })),
                "layer {color:?} missing from horizontal quarter {quarter}"
            );
        }
    }
}

#[path = "cpu_initial_geometry_tests.rs"]
mod geometry_tests;

#[path = "cpu_initial_presentation_tests.rs"]
mod presentation_tests;

#[path = "cpu_initial_budget_tests.rs"]
mod budget_tests;
