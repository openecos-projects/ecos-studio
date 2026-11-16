//! Real-data same-scene oracle for a UI-only seed that may never reach the
//! worker's evidence queue. Test-only; no application capture or render policy.
use super::*;
use crate::app::cpu_raster::test_support::Presentation;
use std::hash::{Hash, Hasher};

fn differences(first: &[u8], second: &[u8], crop: [usize; 4]) -> serde_json::Value {
    assert_eq!(first.len(), second.len());
    let [left, top, right, bottom] = crop;
    let mut pixels = 0;
    let mut channels = 0;
    let mut maximum = 0;
    let mut examples = Vec::new();
    for y in top..bottom {
        for x in left..right {
            let offset = ((1279 - y) * 2048 + x) * 4;
            let a = &first[offset..offset + 4];
            let b = &second[offset..offset + 4];
            if a != b {
                pixels += 1;
                if examples.len() < 8 {
                    examples.push(serde_json::json!({"x":x,"y":y,"a":a,"b":b}));
                }
            }
            for (&a, &b) in a.iter().zip(b) {
                channels += usize::from(a != b);
                maximum = maximum.max(a.abs_diff(b));
            }
        }
    }
    serde_json::json!({"crop":crop,"different_pixels":pixels,"different_channels":channels,
        "maximum_channel_difference":maximum,"examples":examples})
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; release real-data UI/worker/original same-seed GL oracle"]
fn real_seed_same_scene_ui_worker_original_byte_exact() {
    assert!(!cfg!(debug_assertions), "run with --release");
    let manifest = std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
    let fixture = Fixture::new();
    let db = Arc::new(ChipViewDb::open(&manifest).unwrap());
    let world = db.stats().bbox.unwrap();
    let visibility = db
        .layer_catalog()
        .into_iter()
        .map(|layer| (layer.layer_id, true))
        .collect();
    let layers = layer_ui_states(&db, &visibility, chip_display::ColorTheme::Foundry);
    let mut request = fixture.request(1.0, 1.0);
    request.db = db;
    request.data_bounds = Some(world);
    request.layers = LayerRenderIndex::new(&layers);
    request.layer_ids = render_query_layer_ids(&layers, request.key.visibility);
    request.grid_layers = layers;
    request.zoom_rules = ZoomVisibilityRules::new(&request.db);
    request.key.world = world;
    request.key.grid_bounds = world;
    request.key.viewport = world;
    request.key.screen_size = [2048, 1280];
    request.key.canvas =
        egui::Rect::from_min_max(egui::pos2(320.0, 8.0), egui::pos2(1676.0, 1254.0));
    request.key.background = color32([16, 18, 22, 255]);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&request.repaint));
    let started = Instant::now();
    // The sole full input pass is the real production filtered command stream.
    let captured = builder::build_command_stream(&request, &|| true, |_| true).unwrap();
    let capture_ms = started.elapsed().as_secs_f64() * 1000.0;
    request.priority = Some(Arc::clone(
        captured
            .priority
            .as_ref()
            .expect("fullfit must capture priority"),
    ));
    let cache_bytes = request.priority.as_ref().unwrap().byte_len();
    drop(captured);
    let zoom = 121.713936;
    request.key.zoom = zoom;
    request.key.pan = (egui::pos2(1024.0, 640.0) - request.key.canvas.center()) * (1.0 - zoom);
    request.key.viewport = screen_to_world_rect(
        request.key.canvas,
        world,
        request.key.canvas,
        zoom,
        request.key.pan,
    );
    let started = Instant::now();
    let mut seed = builder::build_ui_initial_scene(&request).expect("cached actual UI seed");
    let seed_prepare_ms = started.elapsed().as_secs_f64() * 1000.0;
    seed.generation = 7;
    let seed = Arc::new(seed);
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    seed.initial_records.as_ref().unwrap().hash(&mut hash);
    let mut renderer = offscreen::OffscreenRenderer::new("").expect("actual EGL renderer required");
    let profile = renderer.with_context(|gl| {
        use eframe::glow::HasContext;
        unsafe {
            serde_json::json!({"renderer":gl.get_parameter_string(eframe::glow::RENDERER),
            "version":gl.get_parameter_string(eframe::glow::VERSION)})
        }
    });
    // Same Arc and exact mesh order on all three paths. Worker seed uses its
    // real font policy + CompactPainter; original uses the untouched painter.
    let worker = renderer
        .rasterize_initial_seeds(&seed, &request, || true)
        .unwrap()
        .unwrap()
        .0;
    let original = renderer
        .rasterize_updates(&seed, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    let ui = renderer.with_context(|gl| {
        let presentation = Presentation::new(Arc::clone(gl), &request.key, request.repaint.clone());
        let mailbox = Arc::new(progress::ProgressMailbox::default());
        let pixels = presentation.paint_queued(
            |painter| {
                presentation.cache.paint_with_initial(
                    None,
                    Some(&seed),
                    &request.key,
                    Arc::clone(&mailbox),
                    seed.generation,
                    painter,
                    request.key.background,
                );
            },
            || {},
        );
        assert!(presentation.cache.is_partial(&request.key));
        assert!(!presentation.cache.is_preview(&request.key));
        assert!(presentation.cache.scene_for(&request.key).is_none());
        pixels
    });
    let canvas = request.key.canvas;
    let crops = [
        [
            canvas.left().round() as usize,
            canvas.top().round() as usize,
            canvas.right().round() as usize,
            canvas.bottom().round() as usize,
        ],
        [350, 110, 1608, 1190],
    ];
    let mut checks = Vec::new();
    for crop in crops {
        checks.push(serde_json::json!({"ui_vs_worker":differences(&ui,&worker,crop),
            "ui_vs_original":differences(&ui,&original,crop),"worker_vs_original":differences(&worker,&original,crop)}));
    }
    let report = serde_json::json!({"diagnostic_only":true,"same_scene":true,"profile":profile,
        "manifest":std::path::PathBuf::from(manifest),"zoom":zoom,"pan":[request.key.pan.x,request.key.pan.y],
        "viewport":[request.key.viewport.lx,request.key.viewport.ly,request.key.viewport.hx,request.key.viewport.hy],
        "cache_production_capture_ms":capture_ms,"cache_bytes":cache_bytes,"seed_prepare_ms":seed_prepare_ms,
        "seed_records":seed.initial_records.as_ref().unwrap().len(),"record_ids_hash":format!("{:016x}",hash.finish()),
        "seed_meshes":seed.meshes.len(),"seed_drawn":seed.drawn,"checks":checks,
        "limitations":["single camera","same actual mesh set; does not compare different seed subsets",
            "no artifact pan identity proof","readback test, not latency acceptance"]});
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(path) = std::env::var_os("ECOS_SEED_SAME_SCENE_OUTPUT") {
        fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
    for check in checks {
        for name in ["ui_vs_worker", "ui_vs_original", "worker_vs_original"] {
            assert_eq!(
                check[name]["different_channels"], 0,
                "strict same-scene oracle failed: {name}: {}",
                check[name]
            );
        }
    }
}
