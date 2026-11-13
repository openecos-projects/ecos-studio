use super::*;
use chip_display::FillPattern;
use chip_render::geometry2d::{PaintCommand, PaintSink};

#[test]
fn sparse_pattern_pixels_match_gl_for_every_texture_and_pixel_scale() {
    let mut renderer = match offscreen::OffscreenRenderer::new("") {
        Ok(renderer) => renderer,
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_COVERAGE_EGL").is_none(),
                "required pattern EGL unavailable: {error}"
            );
            return;
        }
    };
    let fixture = Fixture::new();
    let patterns = Arc::new(PatternTextureSet::new(&fixture.ctx));
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.pattern_textures = Arc::clone(&patterns);
        request.key.screen_size = [(256.0 * scale) as u32; 2];
        request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(256.0, 256.0));
        request.key.background = egui::Color32::from_rgb(19, 27, 43);
        let commands = [
            PaintCommand::FillRect {
                rect: egui::Rect::from_min_max(egui::pos2(28.0, 31.0), egui::pos2(205.0, 196.0)),
                rgba: [71, 129, 239, 255],
            },
            PaintCommand::PatternRect {
                rect: egui::Rect::from_min_max(egui::pos2(52.25, 47.5), egui::pos2(156.75, 132.25)),
                pattern: FillPattern::Grid,
                rgba: [201, 85, 33, 171],
            },
            PaintCommand::FillRect {
                rect: egui::Rect::from_min_max(egui::pos2(100.0, 92.0), egui::pos2(141.0, 120.0)),
                rgba: [41, 211, 117, 255],
            },
            PaintCommand::Line {
                points: [egui::pos2(44.25, 143.5), egui::pos2(178.75, 73.25)],
                width: 1.25,
                rgba: [237, 181, 47, 191],
            },
        ];
        let commands = commands.map(|command| match command {
            PaintCommand::FillRect { rect, rgba } => PaintCommand::FillRect {
                rect: rect / scale,
                rgba,
            },
            PaintCommand::PatternRect {
                rect,
                pattern,
                rgba,
            } => PaintCommand::PatternRect {
                rect: rect / scale,
                pattern,
                rgba,
            },
            PaintCommand::Line {
                points,
                width,
                rgba,
            } => PaintCommand::Line {
                points: [points[0] / scale, points[1] / scale],
                width: width / scale,
                rgba,
            },
            command => command,
        });
        for pattern in [
            FillPattern::SparseDots,
            FillPattern::DenseDots,
            FillPattern::DiagonalHatch,
            FillPattern::CrossHatch,
            FillPattern::HorizontalHatch,
            FillPattern::VerticalHatch,
            FillPattern::Grid,
        ] {
            let commands = commands.map(|command| match command {
                PaintCommand::PatternRect { rect, rgba, .. } => PaintCommand::PatternRect {
                    rect,
                    pattern,
                    rgba,
                },
                command => command,
            });
            let prepared =
                sparse_rects::SparseRects::prepare(&commands, &request).unwrap_or_else(|| {
                    panic!("sparse preparation failed for {pattern:?}, DPR {scale}")
                });
            assert!(!prepared.prefers_meshes(), "{pattern:?}, DPR {scale}");
            let mut actual = prepared.render(request.key.background);
            let repair = prepared.residual_meshes(request.key.canvas);
            let repair = renderer
                .rasterize_updates(
                    &{
                        let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
                        scene.meshes = repair;
                        scene
                    },
                    &request,
                    || true,
                    |_, _| {},
                    None,
                )
                .unwrap()
                .unwrap()
                .0;
            prepared.merge(&mut actual, &repair);

            let mut sink = geometry::GeometryMeshSink::for_raster_with_patterns(
                request.tessellator.clone(),
                request.key.canvas,
                request.key.tessellation,
                scale,
                Arc::clone(&patterns),
            );
            for command in commands {
                sink.paint(command);
            }
            let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
            scene.meshes = builder::prepare_meshes(sink.finish());
            let expected = renderer
                .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
                .unwrap()
                .unwrap()
                .0;
            let max_difference = actual
                .iter()
                .zip(&expected)
                .map(|(actual, expected)| actual.abs_diff(*expected))
                .max()
                .unwrap_or(0);
            assert!(
                max_difference <= 2,
                "{pattern:?}, DPR {scale}: max channel error {max_difference}"
            );
        }
    }
}
