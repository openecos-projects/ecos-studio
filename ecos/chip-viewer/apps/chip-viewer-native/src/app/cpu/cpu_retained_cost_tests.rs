use super::*;
use chip_display::LayerStyle;
use chip_view_db::ShapeGeometry;
use std::ops::Range;

struct RetainedShape {
    bbox: Rect32,
    geometry: ShapeGeometry,
    style: LayerStyle,
    source: Range<usize>,
    supported: bool,
}

struct Footprints {
    raster: geometry::PixelRectRasterizer,
    rectangles: Vec<(egui::Rect, [u8; 4])>,
    supported: bool,
}

impl Footprints {
    fn new() -> Self {
        Self {
            raster: geometry::PixelRectRasterizer::new(1.0, Default::default()).unwrap(),
            rectangles: Vec::new(),
            supported: true,
        }
    }

    fn reset(&mut self) {
        self.rectangles.clear();
        self.supported = true;
    }
}

impl PaintSink for Footprints {
    fn paint(&mut self, command: PaintCommand) {
        if let Some(rectangles) = self.raster.rectangles(command) {
            let rgba = match command {
                PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => rgba,
                _ => unreachable!(),
            };
            self.rectangles.extend(rectangles.map(|rect| (rect, rgba)));
        } else {
            self.supported = false;
        }
    }
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; retained validation lower-bound diagnostic"]
fn retained_camera_reprojection_cost() {
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
    for zoom in [1.0, 2.612572, 6.825526, 16.0] {
        let viewport = screen_to_world_rect(canvas, world, canvas, zoom, egui::Vec2::ZERO);
        let pass =
            chip_render::geometry2d::GeometryPass::new(world, canvas, zoom, egui::Vec2::ZERO);
        let mut owner_cache = OwnerCategoryCache::default();
        let mut source = Footprints::new();
        let mut shapes = Vec::new();
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
            let geometry = db.shape_geometry(shape);
            let start = source.rectangles.len();
            source.supported = true;
            pass.draw(geometry, &style, &mut source);
            shapes.push(RetainedShape {
                bbox: shape.bbox,
                geometry,
                style,
                source: start..source.rectangles.len(),
                supported: source.supported,
            });
        }
        let mut current = Footprints::new();
        if zoom == 1.0 {
            check_regions(&shapes, world, canvas, zoom, &mut reports);
        }
        for pan in [egui::vec2(4.0, 3.0), egui::vec2(127.0, -61.0)] {
            let target = screen_to_world_rect(canvas, world, canvas, zoom, pan);
            let pass = chip_render::geometry2d::GeometryPass::new(world, canvas, zoom, pan);
            let mut times = Vec::new();
            let mut unchanged = 0;
            for _ in 0..20 {
                let started = Instant::now();
                unchanged = 0;
                for shape in &shapes {
                    current.reset();
                    if shape.bbox.intersects(target) {
                        pass.draw(shape.geometry, &shape.style, &mut current);
                    }
                    let old = &source.rectangles[shape.source.clone()];
                    unchanged += usize::from(
                        shape.supported
                            && current.supported
                            && old.len() == current.rectangles.len()
                            && old
                                .iter()
                                .zip(&current.rectangles)
                                .all(|(old, new)| old.0.translate(pan) == new.0 && old.1 == new.1),
                    );
                }
                std::hint::black_box(unchanged);
                times.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_unstable_by(f64::total_cmp);
            reports.push(serde_json::json!({
                "zoom": zoom, "pan": [pan.x, pan.y], "shapes": shapes.len(),
                "source_operations": source.rectangles.len(), "unchanged_shapes": unchanged,
                "iterations": times.len(), "p50_ms": times[9], "p95_ms": times[18],
            }));
        }
    }
    let report = serde_json::json!({
        "diagnostic_only": true,
        "excludes": ["region mask", "unsupported mesh bounds", "query completeness", "presentation"],
        "reports": reports,
    });
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_RETAINED_COST_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}

#[derive(Default)]
struct Commands(Vec<PaintCommand>);

impl PaintSink for Commands {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

fn check_regions(
    shapes: &[RetainedShape],
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    reports: &mut Vec<serde_json::Value>,
) {
    let fixture = Fixture::new();
    let mut request = fixture.request(zoom, 1.0);
    request.key.world = world;
    request.data_bounds = Some(world);
    request.key.viewport = world;
    request.key.canvas = canvas;
    request.key.screen_size = [2048, 1280];
    request.key.background = color32([16, 18, 22, 255]);
    let mut model = retained_regions::RegionModel::new(&request).unwrap();
    let pass = chip_render::geometry2d::GeometryPass::new(world, canvas, zoom, egui::Vec2::ZERO);
    let mut commands = Commands::default();
    for shape in shapes {
        commands.0.clear();
        pass.draw(shape.geometry, &shape.style, &mut commands);
        assert!(model.push(shape.bbox, shape.geometry, shape.style, &commands.0));
    }
    let mut renderer = std::env::var_os("ECOS_RETAINED_PIXEL_ORACLE")
        .map(|_| coverage_blend_tests::renderer().expect("required llvmpipe context"));
    let source = renderer.as_mut().map(|renderer| {
        commands.0.clear();
        for shape in shapes {
            pass.draw(shape.geometry, &shape.style, &mut commands);
        }
        let source_meshes = meshes(
            &fixture,
            &request,
            &commands.0,
            geometry::GeometryOutput::ExactRaster,
        );
        let reference = pixels(renderer, &request, source_meshes);
        let sparse = sparse_rects::SparseRects::prepare(&commands.0, &request).unwrap();
        assert!(
            !sparse.prefers_meshes(),
            "retained source requires certified sparse completion"
        );
        let mut source = sparse.render(request.key.background);
        let repair = pixels(
            renderer,
            &request,
            sparse.residual_meshes(request.key.canvas),
        );
        sparse.merge(&mut source, &repair);
        assert_eq!(
            source
                .iter()
                .zip(&reference)
                .position(|(actual, expected)| actual != expected),
            None,
            "actual sparse source matches independent GL before reuse"
        );
        source
    });
    for pan in [egui::vec2(4.0, 3.0), egui::vec2(127.0, -61.0)] {
        let mut key = request.key.clone();
        key.pan = pan;
        key.viewport = screen_to_world_rect(canvas, world, canvas, zoom, pan);
        for workers in [1, 4, 8] {
            let mut times = Vec::new();
            for _ in 0..20 {
                let started = Instant::now();
                std::hint::black_box(model.validate(&key, workers).unwrap());
                times.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_unstable_by(f64::total_cmp);
            let clips = model.validate(&key, workers).unwrap().clips();
            let valid_pixels: f32 = clips.iter().map(|rect| rect.area()).sum();
            let mut compared = 0;
            if let Some(renderer) = &mut renderer {
                commands.0.clear();
                let pass = chip_render::geometry2d::GeometryPass::new(world, canvas, zoom, pan);
                for shape in shapes {
                    if shape.bbox.intersects(key.viewport) {
                        pass.draw(shape.geometry, &shape.style, &mut commands);
                    }
                }
                let mut current = fixture.request(zoom, 1.0);
                current.key = key.clone();
                let target_meshes = meshes(
                    &fixture,
                    &current,
                    &commands.0,
                    geometry::GeometryOutput::ExactRaster,
                );
                let target = pixels(renderer, &current, target_meshes);
                let source = source.as_ref().unwrap();
                for clip in &clips {
                    for row in clip.top() as usize..clip.bottom() as usize {
                        for column in clip.left() as usize..clip.right() as usize {
                            let source_row = (row as i32 - pan.y as i32) as usize;
                            let source_column = (column as i32 - pan.x as i32) as usize;
                            let old = ((1279 - source_row) * 2048 + source_column) * 4;
                            let new = ((1279 - row) * 2048 + column) * 4;
                            assert_eq!(
                                &source[old..old + 4],
                                &target[new..new + 4],
                                "pan {pan:?}, pixel {column},{row}"
                            );
                            compared += 1;
                        }
                    }
                }
                assert!(compared > 100_000, "vacuous validity: {compared}");
            }
            reports.push(serde_json::json!({
                "diagnostic": "region_mask", "zoom": zoom, "pan": [pan.x, pan.y],
                "model_bytes": model.byte_len(), "valid_pixels": valid_pixels,
                "valid_fraction": valid_pixels / canvas.area(), "oracle_pixels": compared,
                "workers": workers, "iterations": times.len(), "p50_ms": times[9], "p95_ms": times[18],
            }));
        }
    }
}
