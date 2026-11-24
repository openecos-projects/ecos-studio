use super::*;

#[path = "cpu_axis_grid_tests.rs"]
mod axis_grid_tests;
use chip_render::geometry2d::{PaintCommand, PaintSink};

#[path = "cpu_coverage_blend_tests.rs"]
mod coverage_blend_tests;

#[path = "cpu_ordered_coverage.rs"]
mod ordered_coverage;

#[path = "cpu_ordered_coverage_tests.rs"]
mod ordered_coverage_tests;

#[path = "cpu_coverage_corpus_tests.rs"]
mod coverage_corpus_tests;

#[path = "cpu_retained_cost_tests.rs"]
mod retained_cost_tests;

#[path = "cpu_retained_regions_tests.rs"]
mod retained_regions_tests;

#[path = "cpu_sparse_rects_tests.rs"]
mod sparse_rects_tests;

#[path = "cpu_sparse_coverage_tests.rs"]
mod sparse_coverage_tests;

#[path = "cpu_initial_progress_tests.rs"]
mod initial_progress_tests;

fn meshes(
    fixture: &Fixture,
    request: &SceneRequest,
    commands: &[PaintCommand],
    output: geometry::GeometryOutput,
) -> Vec<egui::ClippedPrimitive> {
    let options = request.key.tessellation;
    let tessellator = fixture.ctx.fonts(|fonts| {
        let atlas = fonts.texture_atlas();
        let atlas = atlas.lock();
        egui::epaint::Tessellator::new(
            request.key.pixels_per_point,
            options,
            atlas.size(),
            atlas.prepared_discs(),
        )
    });
    let mut sink = match output {
        geometry::GeometryOutput::ExactRaster => geometry::GeometryMeshSink::for_raster(
            tessellator,
            request.key.canvas,
            options,
            request.key.pixels_per_point,
        ),
        geometry::GeometryOutput::Reference => {
            geometry::GeometryMeshSink::new(tessellator, request.key.canvas, options)
        }
    };
    for command in commands {
        sink.paint(*command);
    }
    sink.finish()
}

fn pixels(
    renderer: &mut offscreen::OffscreenRenderer,
    request: &SceneRequest,
    meshes: Vec<egui::ClippedPrimitive>,
) -> Vec<u8> {
    let mut scene = builder::build_with_workers(request, &|| true, 1).unwrap();
    scene.meshes = meshes;
    let expected = renderer
        .rasterize_updates(&scene, request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    let compact = renderer.rasterize_compact(&scene, request).unwrap();
    assert_eq!(compact.len(), expected.len());
    let differences = compact
        .iter()
        .zip(&expected)
        .enumerate()
        .filter(|(_, (actual, expected))| actual != expected)
        .take(16)
        .collect::<Vec<_>>();
    assert!(
        differences.is_empty(),
        "compact RGBA differences: {differences:?}"
    );
    expected
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn exact_pixel_rectangles_match_reference_across_fractional_inputs_dpr_alpha_and_clipping() {
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL exact-rectangle check unavailable");
        return;
    };
    for dpr in [1.0, 1.25, 1.5, 2.0, 3.0, 4.0] {
        let mut request = fixture.request(1.0, dpr);
        request.key.screen_size = [640, 480];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(13.25 / dpr, 17.5 / dpr),
            egui::pos2(612.75 / dpr, 462.25 / dpr),
        );
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        for page in 0..12 {
            let mut commands = Vec::new();
            for index in 0..400 {
                let value = page * 400 + index;
                let origin = egui::pos2(
                    (9.0 + (index % 25) as f32 * 25.0
                        + [0.0, 0.125, 0.25, 0.49, 0.5, 0.75, -0.49][value % 7])
                        / dpr,
                    (12.0 + (index / 25) as f32 * 29.0 + [0.0, 0.25, 0.5, 0.75][value / 7 % 4])
                        / dpr,
                );
                let sizes = [1.0, 1.5, 2.0, 2.0001, 2.5, 3.0, 3.5, 4.0, 7.0, 11.0, 20.0];
                let rect = egui::Rect::from_min_size(
                    origin,
                    egui::vec2(
                        sizes[value / 3 % sizes.len()],
                        sizes[value / 33 % sizes.len()],
                    ) / dpr,
                );
                let rgba = [173, 61, 237, [0, 31, 112, 173, 255][value / 5 % 5]];
                let command = match value % 4 {
                    0 => PaintCommand::FillRect { rect, rgba },
                    _ => PaintCommand::FrameRect {
                        rect,
                        rgba,
                        width: [1.0, 2.0, 3.0][value % 3] / dpr,
                    },
                };
                commands.push(command);
                if value % 5 == 0 {
                    commands.push(PaintCommand::FillRect {
                        rect: rect.translate(egui::vec2(0.25, 0.5) / dpr),
                        rgba: [37, 191, 83, 97],
                    });
                }
            }
            let original = meshes(
                &fixture,
                &request,
                &commands,
                geometry::GeometryOutput::Reference,
            );
            let compact = meshes(
                &fixture,
                &request,
                &commands,
                geometry::GeometryOutput::ExactRaster,
            );
            let original = pixels(&mut renderer, &request, original);
            let compact = pixels(&mut renderer, &request, compact);
            let different = original
                .iter()
                .zip(&compact)
                .filter(|(left, right)| left != right)
                .count();
            assert_eq!(different, 0, "DPR {dpr}, page {page}");
        }
    }
}

#[test]
fn exact_pixel_rectangles_reduce_index_work_without_merging_translucent_commands() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let commands = vec![
        PaintCommand::FillRect {
            rect: egui::Rect::from_min_max(egui::pos2(30.0, 50.0), egui::pos2(44.0, 75.0)),
            rgba: [173, 61, 237, 112],
        };
        100
    ];
    let counts = |meshes: &[egui::ClippedPrimitive]| {
        meshes
            .iter()
            .map(|primitive| {
                let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                    unreachable!()
                };
                mesh.indices.len()
            })
            .sum::<usize>()
    };
    let original = meshes(
        &fixture,
        &request,
        &commands,
        geometry::GeometryOutput::Reference,
    );
    let compact = meshes(
        &fixture,
        &request,
        &commands,
        geometry::GeometryOutput::ExactRaster,
    );
    assert_eq!(counts(&compact), 600);
    assert!(counts(&original) > counts(&compact));
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn exact_pixel_rectangles_preserve_every_pattern_and_fall_back_for_custom_tessellation() {
    struct Commands(Vec<PaintCommand>);
    impl PaintSink for Commands {
        fn paint(&mut self, command: PaintCommand) {
            self.0.push(command);
        }
    }
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL exact-pattern check unavailable");
        return;
    };
    let patterns = [
        FillPattern::Hollow,
        FillPattern::Solid,
        FillPattern::SparseDots,
        FillPattern::DenseDots,
        FillPattern::DiagonalHatch,
        FillPattern::CrossHatch,
        FillPattern::HorizontalHatch,
        FillPattern::VerticalHatch,
        FillPattern::Grid,
        FillPattern::XMark,
    ];
    for dpr in [1.0, 1.5, 2.0] {
        for mode in 0..7 {
            let mut request = fixture.request(1.0, dpr);
            match mode {
                0 => {}
                1 => request.key.tessellation.feathering = false,
                2 => request.key.tessellation.feathering_size_in_pixels = 2.0,
                3 => request.key.tessellation.round_rects_to_pixels = false,
                4 => request.key.tessellation.round_line_segments_to_pixels = false,
                5 => request.key.tessellation.debug_paint_clip_rects = true,
                6 => request.key.tessellation.debug_ignore_clip_rects = true,
                _ => unreachable!(),
            }
            let mut commands = Commands(Vec::new());
            let pass = chip_render::geometry2d::GeometryPass::new(
                request.key.world,
                request.key.canvas,
                1.0,
                egui::vec2(-0.25, 0.375),
            );
            for (index, pattern) in patterns.into_iter().enumerate() {
                let mut style =
                    LayerStyle::default_for_layer(index as u16, chip_display::ColorTheme::Vivid);
                style.fill_pattern = pattern;
                style.rgba = [173, 61, 237, 112];
                style.frame_rgba = [37, 191, 83, 173];
                for width in [1, 2, 3] {
                    style.line_width_px = width;
                    pass.draw(
                        ShapeGeometry::Rect(Rect32 {
                            lx: -50 + index as i32 * 35,
                            ly: 40 + index as i32 * 25,
                            hx: 500 + index as i32 * 30,
                            hy: 900 - index as i32 * 20,
                        }),
                        &style,
                        &mut commands,
                    );
                }
            }
            commands.0.push(PaintCommand::FrameRect {
                rect: request.key.canvas.shrink(5.0),
                width: 0.0,
                rgba: [173, 61, 237, 112],
            });
            let original = meshes(
                &fixture,
                &request,
                &commands.0,
                geometry::GeometryOutput::Reference,
            );
            let compact = meshes(
                &fixture,
                &request,
                &commands.0,
                geometry::GeometryOutput::ExactRaster,
            );
            let original = pixels(&mut renderer, &request, original);
            let compact = pixels(&mut renderer, &request, compact);
            assert_eq!(original, compact, "DPR {dpr}, custom options {mode}");
        }
    }
}
