use super::*;
use std::sync::atomic::AtomicUsize;

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; label pipeline attribution, not acceptance timing"]
fn real_design_label_preparation_cost() {
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
    for zoom in [121.713936, 17.832169, 6.825526, 2.612572, 1.0] {
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
        let scene = builder::build_command_stream(&request, &|| true, |_| true).unwrap();
        let candidates = scene.labels.snapshot();
        let mut oracle = labels::LabelResolver::default();
        let started = Instant::now();
        let expected = oracle.resolve(&request, &candidates, || true).unwrap();
        let cold_resolve_ms = started.elapsed().as_secs_f64() * 1000.0;
        let started = Instant::now();
        assert_eq!(
            oracle.resolve(&request, &candidates, || true),
            Some(expected.clone())
        );
        let warm_resolve_ms = started.elapsed().as_secs_f64() * 1000.0;
        let started = Instant::now();
        let plan = candidates.plan(request.key.canvas);
        let planning_ms = started.elapsed().as_secs_f64() * 1000.0;
        let workers = plan.worker_count(builder::worker_count());
        let fonts: Vec<_> = (0..workers)
            .map(|_| {
                egui::epaint::Fonts::new(
                    1.0,
                    request.label_texture_side,
                    request.label_fonts.clone(),
                )
            })
            .collect();
        let measurements = AtomicUsize::new(0);
        let characters = AtomicUsize::new(0);
        let measured_ns = AtomicU64::new(0);
        let started = Instant::now();
        let actual = plan
            .resolve(
                workers,
                |worker, text, size| {
                    let started = Instant::now();
                    let result = fonts[worker]
                        .layout_no_wrap(
                            text.to_owned(),
                            egui::FontId::proportional(size),
                            egui::Color32::WHITE,
                        )
                        .size();
                    measured_ns.fetch_add(started.elapsed().as_nanos() as u64, Ordering::Relaxed);
                    measurements.fetch_add(1, Ordering::Relaxed);
                    characters.fetch_add(text.len(), Ordering::Relaxed);
                    result
                },
                || true,
            )
            .unwrap();
        let instrumented_resolve_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(actual, expected);
        reports.push(serde_json::json!({
            "zoom": zoom, "candidates": expected.candidate_count, "labels": expected.labels.len(),
            "workers": workers, "cold_resolve_ms": cold_resolve_ms, "warm_resolve_ms": warm_resolve_ms,
            "planning_ms": planning_ms, "instrumented_resolve_ms": instrumented_resolve_ms,
            "measurement_calls": measurements.load(Ordering::Relaxed), "measured_utf8_bytes": characters.load(Ordering::Relaxed),
            "worker_summed_measurement_ms": measured_ns.load(Ordering::Relaxed) as f64 / 1_000_000.0,
        }));
    }
    let report = serde_json::json!({"diagnostic_only": true, "reports": reports});
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_LABEL_COST_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}
