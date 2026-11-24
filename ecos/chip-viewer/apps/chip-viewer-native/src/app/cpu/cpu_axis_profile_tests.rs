use super::*;
use crate::app::*;
use chip_render::geometry2d::{GeometryPass, PaintSink};

#[derive(Default)]
struct Profile {
    counts: BTreeMap<&'static str, usize>,
    canvas: Option<egui::Rect>,
    scratch: egui::Mesh,
}

impl PaintSink for Profile {
    fn paint(&mut self, command: PaintCommand) {
        let raster = PixelRectRasterizer::new(1.0, Default::default()).unwrap();
        let supported = raster.rectangles(command).is_some();
        let rgba = match command {
            PaintCommand::FillRect { rgba, .. }
            | PaintCommand::FrameRect { rgba, .. }
            | PaintCommand::PatternRect { rgba, .. }
            | PaintCommand::Line { rgba, .. }
            | PaintCommand::Disc { rgba, .. } => rgba,
        };
        self.scratch.clear();
        if !supported
            && raster.paint_axis(
                command,
                color32(rgba),
                self.canvas.unwrap(),
                &mut self.scratch,
            )
        {
            *self
                .counts
                .entry("new_feathered_strip_commands")
                .or_default() += 1;
            *self
                .counts
                .entry("new_feathered_strip_vertices")
                .or_default() += self.scratch.vertices.len();
        }
        let key = match command {
            PaintCommand::FillRect { rect, .. } | PaintCommand::FrameRect { rect, .. } => {
                let min = rect.size().min_elem();
                if supported {
                    "rect_supported"
                } else if min < 1.0 {
                    "rect_unsupported_below_1px"
                } else if min < 2.0 {
                    "rect_unsupported_1_to_2px"
                } else if min == 2.0 {
                    "rect_unsupported_exactly_2px"
                } else {
                    "rect_unsupported_above_2px"
                }
            }
            PaintCommand::Line { points, width, .. } => {
                if raster.axis_line_rectangle(points, width).is_some() {
                    "axis_line_candidate"
                } else {
                    "line_other"
                }
            }
            PaintCommand::Disc { .. } => "disc",
            PaintCommand::PatternRect { .. } => "pattern",
        };
        *self.counts.entry(key).or_default() += 1;
    }
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; bounded-memory command classification, not performance acceptance"]
fn axis_raster_real_command_profile() {
    let manifest = std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
    let db = ChipViewDb::open(&manifest).unwrap();
    let world = db.stats().bbox.unwrap();
    let canvas = egui::Rect::from_min_max(egui::pos2(320.0, 8.0), egui::pos2(1676.0, 1254.0));
    let visible = db
        .layer_catalog()
        .into_iter()
        .map(|layer| (layer.layer_id, true))
        .collect();
    let layers = layer_ui_states(&db, &visible, chip_display::ColorTheme::Foundry);
    let layer_index = LayerRenderIndex::new(&layers);
    let mut visibility = ObjectVisibility::default();
    visibility.set_all_visible(true);
    let layer_ids = render_query_layer_ids(&layers, visibility);
    let rules = ZoomVisibilityRules::new(&db);
    let mut reports = Vec::new();
    for zoom in [1.0, 2.612572, 6.825526] {
        let pan = (egui::pos2(1024.0, 640.0) - canvas.center()) * (1.0 - zoom);
        let view = screen_to_world_rect(canvas, world, canvas, zoom, pan);
        let pass = GeometryPass::new(world, canvas, zoom, pan);
        let mut owners = OwnerCategoryCache::default();
        let mut profile = Profile {
            canvas: Some(canvas),
            ..Default::default()
        };
        let mut drawn = 0;
        for id in db.query_layers_intersect(&layer_ids, view) {
            let shape = db.find_shape(id).unwrap();
            if !is_renderable_shape(shape) {
                continue;
            }
            let owner = db.owner_for_shape(shape);
            let kind = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            let category = owner.and_then(|owner| owners.get(1, &db, owner));
            if !rules.is_drawn_at_zoom(kind, zoom)
                || !shape_is_visible_fast(shape, kind, category, &layer_index, &visibility)
            {
                continue;
            }
            let Some(style) = visible_style_for_shape_fast(shape, owner, kind, &layer_index) else {
                continue;
            };
            drawn += usize::from(pass.draw(db.shape_geometry(shape), &style, &mut profile) > 0);
        }
        reports.push(serde_json::json!({"zoom":zoom,"pan":[pan.x,pan.y],"drawn_shapes":drawn,"commands":profile.counts}));
    }
    let report = serde_json::json!({"diagnostic_only":true,"manifest":manifest,"reports":reports});
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    if let Some(output) = std::env::var_os("ECOS_AXIS_PROFILE_OUTPUT") {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}
