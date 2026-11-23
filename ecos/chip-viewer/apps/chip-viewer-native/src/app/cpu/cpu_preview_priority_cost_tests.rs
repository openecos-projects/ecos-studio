//! Ignored real-data experiment only. No production preview index or policy.
use super::*;
use crate::app::cpu_raster::target::RasterTarget;
use chip_render::geometry2d::GeometryPass;
use eframe::glow::{self, HasContext};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

const QUOTA: usize = 512;
const TOP: usize = 2048;

fn style(
    request: &SceneRequest,
    id: ShapeId,
    cache: &mut OwnerCategoryCache,
) -> Option<LayerStyle> {
    let shape = request.db.find_shape(id)?;
    if !is_renderable_shape(shape) {
        return None;
    }
    let owner = request.db.owner_for_shape(shape);
    let kind = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
    let category = owner.and_then(|owner| cache.get(request.key.epoch, &request.db, owner));
    if !request.zoom_rules.is_drawn_at_zoom(kind, request.key.zoom)
        || !shape_is_visible_fast(
            shape,
            kind,
            category,
            &request.layers,
            &request.key.visibility,
        )
    {
        return None;
    }
    visible_style_for_shape_fast(shape, owner, kind, &request.layers)
}

fn ordered(request: &SceneRequest, ids: &mut Vec<ShapeId>) {
    ids.sort_unstable_by_key(|id| (request.db.find_shape(*id).unwrap().layer_id, *id));
    ids.dedup();
}

fn spatial(request: &SceneRequest, quota: usize) -> Vec<ShapeId> {
    let active = request
        .layer_ids
        .iter()
        .copied()
        .filter(|id| {
            request
                .grid_layers
                .iter()
                .find(|layer| layer.layer_id == *id)
                .is_none_or(|layer| layer.shape_count > 0)
        })
        .collect::<Vec<_>>();
    let cells = (quota / active.len().max(1)).clamp(1, 16);
    let per_cell = (quota / active.len().max(1) / cells).max(1);
    let v = request.key.viewport;
    let coord = |low: i32, high: i32, index: usize| {
        (i64::from(low) + (i64::from(high) - i64::from(low)) * index as i64 / 4) as i32
    };
    let mut ids = Vec::new();
    for cell in 0..cells {
        let index = cell * 16 / cells;
        let (row, column) = (index / 4, index % 4);
        let bbox = Rect32 {
            lx: coord(v.lx, v.hx, column),
            hx: coord(v.lx, v.hx, column + 1),
            ly: coord(v.ly, v.hy, row),
            hy: coord(v.ly, v.hy, row + 1),
        };
        for &layer in &active {
            ids.extend(
                request
                    .db
                    .query_layer_intersect_sample(layer, bbox, per_cell)
                    .ids,
            );
        }
    }
    ordered(request, &mut ids);
    assert!(ids.len() <= quota);
    ids
}

fn priority(request: &SceneRequest, top: &BTreeMap<LayerId, Vec<ShapeId>>) -> Vec<ShapeId> {
    let pass = GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    let mut cache = OwnerCategoryCache::default();
    let mut ranked = Vec::new();
    for ids in top.values() {
        for &id in ids {
            let shape = request.db.find_shape(id).unwrap();
            if !shape.bbox.intersects(request.key.viewport) {
                continue;
            }
            let Some(style) = style(request, id, &mut cache) else {
                continue;
            };
            // The target gate counts chromatic routing. Gray layout records
            // remain eligible in the spatial quarter, but cannot outrank ink.
            let colored = [style.rgba, style.frame_rgba].iter().any(|rgba| {
                rgba[3] > 0
                    && *rgba[..3].iter().max().unwrap() - *rgba[..3].iter().min().unwrap() > 25
            });
            if !colored {
                continue;
            }
            let rect = pass
                .project(request.db.shape_geometry(shape))
                .bounds()
                .intersect(request.key.canvas);
            if rect.is_positive() {
                ranked.push((rect.width().max(rect.height()), id));
            }
        }
    }
    ranked.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let mut ids = ranked
        .iter()
        .take(QUOTA * 3 / 4)
        .map(|(_, id)| *id)
        .collect::<Vec<_>>();
    let mut seen = ids.iter().copied().collect::<BTreeSet<_>>();
    for id in spatial(request, QUOTA / 4)
        .into_iter()
        .chain(ranked.into_iter().map(|(_, id)| id))
    {
        if ids.len() == QUOTA {
            break;
        }
        if seen.insert(id) {
            ids.push(id);
        }
    }
    ordered(request, &mut ids);
    ids
}

fn meshes(request: &SceneRequest, ids: &[ShapeId]) -> Vec<egui::ClippedPrimitive> {
    let mut sink = geometry::GeometryMeshSink::for_raster_with_patterns(
        request.tessellator.clone(),
        request.key.canvas,
        request.key.tessellation,
        request.key.pixels_per_point,
        Arc::clone(&request.pattern_textures),
    );
    let pass = GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    let mut cache = OwnerCategoryCache::default();
    for &id in ids {
        if let Some(style) = style(request, id, &mut cache) {
            pass.draw(
                request
                    .db
                    .shape_geometry(request.db.find_shape(id).unwrap()),
                &style,
                &mut sink,
            );
        }
    }
    sink.finish()
}

fn draw(
    painter: &mut eframe::egui_glow::Painter,
    target: &RasterTarget,
    request: &SceneRequest,
    meshes: &[egui::ClippedPrimitive],
) -> usize {
    request.pattern_textures.upload_for(painter, meshes);
    target.clear(painter.gl(), request.key.background);
    painter.paint_primitives(
        request.key.screen_size,
        request.key.pixels_per_point,
        meshes,
    );
    let mut pixels = vec![0; 2048 * 1280 * 4];
    unsafe {
        painter.gl().read_pixels(
            0,
            0,
            2048,
            1280,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        );
        assert_eq!(painter.gl().get_error(), glow::NO_ERROR);
    }
    // Same layout crop and chroma >25 as render_zoom_content.py. Readback is
    // bottom-up; count only the screen-space crop, independent of native flags.
    (110..1190)
        .map(|y| {
            (350..1608)
                .filter(|&x| {
                    let i = ((1279 - y) * 2048 + x) * 4;
                    let rgb = &pixels[i..i + 3];
                    *rgb.iter().max().unwrap() - *rgb.iter().min().unwrap() > 25
                })
                .count()
        })
        .sum()
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; release-only real-data preview priority diagnostic"]
fn preview_priority_real_design_cost() {
    assert!(
        !cfg!(debug_assertions),
        "run this diagnostic with --release"
    );
    let path = std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
    let fixture = Fixture::new();
    let db = Arc::new(ChipViewDb::open(&path).unwrap());
    let world = db.stats().bbox.unwrap();
    let visibility = db
        .layer_catalog()
        .into_iter()
        .map(|layer| (layer.layer_id, true))
        .collect();
    let layers = layer_ui_states(&db, &visibility, chip_display::ColorTheme::Foundry);
    let mut request = fixture.request(2.612572, 1.0);
    request.db = db;
    request.data_bounds = Some(world);
    request.key.world = world;
    request.key.grid_bounds = world;
    request.key.screen_size = [2048, 1280];
    request.key.canvas =
        egui::Rect::from_min_max(egui::pos2(320.0, 8.0), egui::pos2(1676.0, 1254.0));
    request.key.background = color32([16, 18, 22, 255]);
    request.layers = LayerRenderIndex::new(&layers);
    request.layer_ids = render_query_layer_ids(&layers, request.key.visibility);
    request.grid_layers = layers;
    request.zoom_rules = ZoomVisibilityRules::new(&request.db);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&request.repaint));
    let started = Instant::now();
    let fit = request.db.query_layers_intersect(&request.layer_ids, world);
    let mut heaps = BTreeMap::<LayerId, BinaryHeap<Reverse<(i64, i64, ShapeId)>>>::new();
    let mut owner_cache = OwnerCategoryCache::default();
    for &id in &fit {
        if style(&request, id, &mut owner_cache).is_none() {
            continue;
        }
        let shape = request.db.find_shape(id).unwrap();
        let w = i64::from(shape.bbox.hx) - i64::from(shape.bbox.lx);
        let h = i64::from(shape.bbox.hy) - i64::from(shape.bbox.ly);
        let heap = heaps.entry(shape.layer_id).or_default();
        heap.push(Reverse((w.max(h), w + h, id)));
        if heap.len() > TOP {
            heap.pop();
        }
    }
    let top = heaps
        .into_iter()
        .map(|(layer, heap)| {
            (
                layer,
                heap.into_iter()
                    .map(|Reverse((_, _, id))| id)
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let build_ms = started.elapsed().as_secs_f64() * 1000.0;
    let cached = top.values().map(Vec::len).sum::<usize>();
    drop(fit);
    let renderer =
        offscreen::OffscreenRenderer::new("").expect("strict original GL renderer required");
    let reports = renderer.with_context(|gl| {
        let mut painter = eframe::egui_glow::Painter::new(Arc::clone(gl),"",None,true).unwrap();
        painter.set_texture(egui::TextureId::default(), &egui::epaint::ImageDelta::full(
            request.repaint.fonts(egui::epaint::Fonts::image),egui::TextureOptions::LINEAR));
        let target = RasterTarget::new(gl,[2048,1280]).unwrap();
        let mut reports = Vec::new();
        for zoom in [2.612572,6.825526] {
            request.key.zoom = zoom;
            request.key.pan = (egui::pos2(1024.0,640.0) - request.key.canvas.center()) * (1.0-zoom);
            request.key.viewport = screen_to_world_rect(request.key.canvas,world,request.key.canvas,zoom,request.key.pan);
            let all = request.db.query_layers_intersect(&request.layer_ids,request.key.viewport);
            let full = meshes(&request,&all);
            let complete = draw(&mut painter,&target,&request,&full);
            assert!(complete > 0);
            let start = Instant::now();
            let ui = builder::build_ui_initial_scene(&request).expect("current UI seed must exist");
            let ui_ms = start.elapsed().as_secs_f64()*1000.0;
            let ui_pixels = draw(&mut painter,&target,&request,&ui.meshes);
            for variant in ["spatial512","priority2048-mix512"] {
                let mut times = Vec::new();
                let mut prepared = Vec::new();
                let mut ids = Vec::new();
                for _ in 0..5 {
                    let start = Instant::now();
                    ids = if variant == "spatial512" { spatial(&request,QUOTA) } else { priority(&request,&top) };
                    prepared = meshes(&request,&ids);
                    times.push(start.elapsed().as_secs_f64()*1000.0);
                }
                times.sort_by(f64::total_cmp);
                let colored = draw(&mut painter,&target,&request,&prepared);
                let report = serde_json::json!({"zoom":zoom,"variant":variant,"quota":QUOTA,"selected_records":ids.len(),
                    "complete_colored_pixels":complete,"seed_colored_pixels":colored,"fraction":colored as f64/complete as f64,
                    "passes_25_percent":colored*4>=complete,"ui_prepare_p50_ms":times[2],"ui_prepare_max_ms":times[4],
                    "current_ui256_pixels":ui_pixels,"current_ui256_fraction":ui_pixels as f64/complete as f64,"current_ui256_prepare_ms":ui_ms});
                eprintln!("{report}"); reports.push(report);
            }
        }
        painter.destroy(); target.destroy(gl); reports
    });
    let report = serde_json::json!({"diagnostic_only":true,"manifest":path,"theme":"Foundry","top_per_layer":TOP,
        "cache_build_ms":build_ms,"cached_ids":cached,"cache_id_payload_bytes":cached*size_of::<ShapeId>(),
        "camera":"existing cost-test canvas; zoom anchored at window center","score":"visible projected longest bbox edge; chromatic styles prioritized; 75% priority +25% spatial",
        "excludes":["UI GL upload/draw cost","window scheduling","full recovery timing","performance acceptance"],"reports":reports});
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_PREVIEW_PRIORITY_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}
