use super::*;

#[test]
fn initial_progress_matches_the_first_worker_packet_and_independent_gl_pixels() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    for scale in [1.0, 2.0, 4.0] {
        for zoom in [1.0, 2.612572, 6.825526] {
            let request = fixture.request(zoom, scale);
            let mut commands = Vec::new();
            assert!(builder::build_command_stream(&request, &|| true, |packet| {
                if let builder::PaintPacket::Commands(first) = packet {
                    commands = first;
                }
                false
            })
            .is_none());
            let kernel = sparse_rects::SparseRects::prepare(&commands, &request).unwrap();
            let mut expected = pixels(
                &mut renderer,
                &request,
                meshes(
                    &fixture,
                    &request,
                    &commands,
                    geometry::GeometryOutput::ExactRaster,
                ),
            );
            kernel.merge(&mut expected, &kernel.blank(request.key.background));
            let mut actual_pixels = Vec::new();
            let actual = builder::build_initial_progress(&request, &mut actual_pixels);
            if expected
                .chunks_exact(4)
                .all(|pixel| pixel == request.key.background.to_array())
            {
                assert!(actual.is_none());
            } else {
                let sequence = actual.unwrap();
                assert_eq!(sequence, commands.len());
                assert_eq!(actual_pixels, expected, "zoom {zoom}, DPR {scale}");
                let allocation = actual_pixels.as_ptr();
                actual_pixels.fill(177);
                assert_eq!(
                    builder::build_initial_progress(&request, &mut actual_pixels),
                    Some(sequence)
                );
                assert_eq!(actual_pixels.as_ptr(), allocation);
                assert_eq!(
                    actual_pixels, expected,
                    "reused buffer zoom {zoom}, DPR {scale}"
                );
            }
        }
    }
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [4096, 2160];
    assert!(builder::build_initial_progress(&request, &mut Vec::new()).is_none());
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; initial-packet CPU diagnostic, not acceptance timing"]
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
    let mut reports = Vec::new();
    for zoom in [121.713936, 46.587803, 17.832169, 6.825526, 2.612572, 1.0] {
        let mut request = fixture.request(zoom, 1.0);
        request.db = Arc::clone(&db);
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
        let mut times = Vec::new();
        let mut sequence = None;
        for _ in 0..10 {
            let started = Instant::now();
            let prefix = builder::build_initial_progress(&request, &mut Vec::new());
            times.push(started.elapsed().as_secs_f64() * 1000.0);
            sequence = prefix;
        }
        times.sort_by(f64::total_cmp);
        reports.push(serde_json::json!({"zoom": zoom, "sequence": sequence, "p50_ms": times[4], "p95_ms": times[9]}));
    }
    let report = serde_json::json!({"diagnostic_only": true, "reports": reports});
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_INITIAL_PROGRESS_COST_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}
