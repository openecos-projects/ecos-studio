use super::*;

#[derive(Default)]
struct CommandProfile {
    counts: BTreeMap<String, usize>,
    rectangles: usize,
    commands: usize,
    rectangle_area: f64,
    fallback_examples: Vec<(usize, String)>,
    paint: Vec<PaintCommand>,
}

impl PaintSink for CommandProfile {
    fn paint(&mut self, command: PaintCommand) {
        self.paint.push(command);
        let options = egui::epaint::TessellationOptions::default();
        let raster = geometry::PixelRectRasterizer::new(1.0, options).unwrap();
        self.commands += 1;
        let category =
            match ordered_coverage::OrderedCoverage::try_commands(&[command], 1.0, options) {
                Ok(_) => "certified_domain".to_string(),
                Err(reason) => format!("{reason:?}"),
            };
        *self.counts.entry(category).or_default() += 1;
        if let Some(rectangles) = raster.rectangles(command) {
            for rectangle in rectangles {
                self.rectangles += 1;
                self.rectangle_area += f64::from(rectangle.width() * rectangle.height());
            }
            *self
                .counts
                .entry("incumbent_rect_commands".to_string())
                .or_default() += 1;
        } else if self.fallback_examples.len() < 64 {
            self.fallback_examples
                .push((self.commands, format!("{command:?}")));
        }
    }
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; diagnostic projection, not acceptance timing"]
fn coverage_real_design_command_domain_profile() {
    let manifest = std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
    let db = ChipViewDb::open(manifest).unwrap();
    let world = db.stats().bbox.unwrap();
    let canvas = egui::Rect::from_min_max(egui::pos2(320.0, 8.0), egui::pos2(1676.0, 1254.0));
    let visibility_by_layer = db
        .layer_catalog()
        .into_iter()
        .map(|layer| (layer.layer_id, true))
        .collect();
    let layers = layer_ui_states(&db, &visibility_by_layer, chip_display::ColorTheme::Foundry);
    let layer_index = LayerRenderIndex::new(&layers);
    let mut visibility = ObjectVisibility::default();
    visibility.set_all_visible(true);
    let ids = render_query_layer_ids(&layers, visibility);
    let zoom_rules = ZoomVisibilityRules::new(&db);
    let mut reports = Vec::new();
    for zoom in [1.0, 2.612572, 16.0, 121.713936] {
        let viewport = screen_to_world_rect(canvas, world, canvas, zoom, egui::Vec2::ZERO);
        let pass =
            chip_render::geometry2d::GeometryPass::new(world, canvas, zoom, egui::Vec2::ZERO);
        let mut owner_cache = OwnerCategoryCache::default();
        let mut profile = CommandProfile::default();
        let mut drawn = 0;
        for id in db.query_layers_intersect(&ids, viewport) {
            let shape = db.find_shape(id).unwrap();
            if !is_renderable_shape(shape) {
                continue;
            }
            let owner = db.owner_for_shape(shape);
            let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            let category = owner.and_then(|owner| owner_cache.get(1, &db, owner));
            if !zoom_rules.is_drawn_at_zoom(owner_type, zoom)
                || !shape_is_visible_fast(shape, owner_type, category, &layer_index, &visibility)
            {
                continue;
            }
            let Some(style) = visible_style_for_shape_fast(shape, owner, owner_type, &layer_index)
            else {
                continue;
            };
            drawn += usize::from(pass.draw(db.shape_geometry(shape), &style, &mut profile) > 0);
        }
        reports.push(serde_json::json!({
            "zoom": zoom, "drawn_shapes": drawn, "commands": profile.commands,
            "canonical_rectangles": profile.rectangles, "categories": profile.counts,
            "rectangle_area": profile.rectangle_area, "fallback_examples": profile.fallback_examples,
        }));
        if std::env::var_os("ECOS_COVERAGE_SPARSE_CHECK").is_some() {
            check_sparse(&profile.paint, world, canvas, zoom);
        }
    }
    let report = serde_json::json!({
        "diagnostic_only": true, "screen_size": [2048, 1280],
        "canvas": [320, 8, 1676, 1254], "reports": reports,
    });
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_COVERAGE_PROFILE_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}

fn check_sparse(commands: &[PaintCommand], world: Rect32, canvas: egui::Rect, zoom: f32) {
    let mut renderer = coverage_blend_tests::renderer().expect("required llvmpipe context");
    let fixture = Fixture::new();
    let mut request = fixture.request(zoom, 1.0);
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    request.key.world = world;
    request.key.canvas = canvas;
    request.key.screen_size = [2048, 1280];
    request.key.background = color32([16, 18, 22, 255]);
    let started = Instant::now();
    let prepared = sparse_rects::SparseRects::prepare(commands, &request).unwrap();
    let prepare_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let mut candidate = prepared.render(request.key.background);
    let cpu_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    scene.meshes = prepared.residual_meshes(canvas);
    let residual_meshes = scene.meshes.len();
    let residual_prepare_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let (residual, _) = renderer
        .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap();
    prepared.merge(&mut candidate, &residual);
    let repair_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    scene.meshes = meshes(
        &fixture,
        &request,
        commands,
        geometry::GeometryOutput::ExactRaster,
    );
    let reference_prepare_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let (reference, _) = renderer
        .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap();
    let reference_raster_ms = started.elapsed().as_secs_f64() * 1000.0;
    let differences: Vec<_> = candidate
        .iter()
        .zip(&reference)
        .enumerate()
        .filter_map(|(index, (left, right))| (left != right).then_some(index))
        .take(20)
        .collect();
    eprintln!(
        "SPARSE {}",
        serde_json::json!({
            "zoom": zoom, "prepare_ms": prepare_ms, "cpu_ms": cpu_ms,
            "residual_prepare_ms": residual_prepare_ms, "repair_ms": repair_ms,
            "residual_meshes": residual_meshes, "reference_prepare_ms": reference_prepare_ms,
            "reference_raster_ms": reference_raster_ms, "first_differences": differences,
        })
    );
    assert!(
        differences.is_empty(),
        "sparse full-byte oracle zoom {zoom}: {differences:?}"
    );
}
