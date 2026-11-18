use super::*;
use crate::app::cpu_scene::{builder, offscreen::OffscreenRenderer, tests::Fixture, SceneRequest};

fn render(renderer: &mut OffscreenRenderer, request: &SceneRequest, mesh: egui::Mesh) -> Vec<u8> {
    let mut scene = builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    scene.meshes.push(egui::ClippedPrimitive {
        clip_rect: request.key.canvas,
        primitive: egui::epaint::Primitive::Mesh(mesh),
    });
    renderer
        .rasterize_updates(&scene, request, || true, |_, _| {}, None)
        .expect("axis pixel oracle requires real GL rendering")
        .expect("axis pixel oracle must not be cancelled")
        .0
}

#[test]
fn axis_raster_integer_strokes_match_original_gl_at_fractional_positions_and_clips() {
    let mut renderer = OffscreenRenderer::new("").expect("axis pixel oracle requires EGL; no skip");
    let fixture = Fixture::new();
    let mut compared = 0;
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.key.screen_size = [257, 251];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(3.25, 5.75) / scale,
            egui::pos2(254.75, 248.5) / scale,
        );
        let raster = PixelRectRasterizer::new(scale, request.key.tessellation).unwrap();
        for background in [
            egui::Color32::from_rgb(13, 29, 51),
            egui::Color32::from_rgba_premultiplied(13, 29, 51, 83),
        ] {
            request.key.background = background;
            for width_px in [1.0] {
                let mut original = egui::Mesh::default();
                let mut candidate = egui::Mesh::default();
                let mut tessellator = request.tessellator.clone();
                tessellator.set_clip_rect(request.key.canvas);
                for index in 0..144 {
                    let phase = [0.0, 0.125, 0.25, 0.49, 0.5, 0.75, -0.49, -0.75][index % 8];
                    let axis = (-4.0 + index as f32 * 1.85 + phase) / scale;
                    let start = [-3.75, 0.0, 3.25, 17.5, 29.75, 44.99][index / 8 % 6] / scale;
                    let end =
                        [259.25, 248.0, 223.25, 179.5, 217.75, 202.01][index / 24 % 6] / scale;
                    let mut points = if index % 2 == 0 {
                        [egui::pos2(axis, start), egui::pos2(axis, end)]
                    } else {
                        [egui::pos2(start, axis), egui::pos2(end, axis)]
                    };
                    if index % 3 == 0 {
                        points.swap(0, 1);
                    }
                    let rgba = [
                        (index * 37) as u8,
                        (index * 71) as u8,
                        (index * 137) as u8,
                        [0, 1, 31, 82, 112, 173, 254, 255][index / 2 % 8],
                    ];
                    let color = crate::app::color32(rgba);
                    tessellator.tessellate_line_segment(
                        points,
                        egui::Stroke::new(width_px / scale, color),
                        &mut original,
                    );
                    let rect = raster
                        .axis_line_rectangle(points, width_px / scale)
                        .expect("supported integer physical width");
                    if color != egui::Color32::TRANSPARENT {
                        candidate.add_colored_rect(rect, color);
                    }
                }
                assert!(
                    candidate.indices.len() < original.indices.len(),
                    "no geometry reduction"
                );
                let expected = render(&mut renderer, &request, original);
                let actual = render(&mut renderer, &request, candidate);
                let differences = actual
                    .iter()
                    .zip(&expected)
                    .enumerate()
                    .filter(|(_, (actual, expected))| actual != expected)
                    .take(8)
                    .map(|(offset, (actual, expected))| {
                        (
                            offset / 4 % 257,
                            250 - offset / 4 / 257,
                            offset % 4,
                            *actual,
                            *expected,
                        )
                    })
                    .collect::<Vec<_>>();
                assert!(
                    differences.is_empty(),
                    "DPR {scale}, width {width_px}, background {background:?}: {differences:?}"
                );
                compared += actual.len();
            }
        }
    }
    eprintln!("axis integer GL oracle compared {compared} RGBA bytes without tolerance");
}

#[test]
fn axis_raster_rejects_noncanonical_lines_and_keeps_rectangle_api_line_free() {
    let options = egui::epaint::TessellationOptions::default();
    for scale in [1.0, 2.0, 4.0] {
        let raster = PixelRectRasterizer::new(scale, options).unwrap();
        let points = [
            egui::pos2(17.25, 7.5) / scale,
            egui::pos2(17.25, 217.25) / scale,
        ];
        for width_px in [
            0.0,
            -1.0,
            0.5,
            0.9,
            1.5,
            2.0,
            2.25,
            16.5,
            17.0,
            f32::NAN,
            f32::INFINITY,
        ] {
            assert!(raster
                .axis_line_rectangle(points, width_px / scale)
                .is_none());
        }
        for bad in [
            [points[0], points[0]],
            [points[0], points[0] + egui::vec2(0.0, 1.75 / scale)],
            [points[0], points[1] + egui::vec2(0.25 / scale, 0.0)],
            [egui::pos2(f32::NAN, 0.0), points[1]],
            [
                egui::pos2(17000.0 / scale, 0.0),
                egui::pos2(17000.0 / scale, 20.0),
            ],
        ] {
            assert!(raster.axis_line_rectangle(bad, 2.0 / scale).is_none());
        }
        assert!(
            raster
                .rectangles(PaintCommand::Line {
                    points,
                    width: 2.0 / scale,
                    rgba: [255; 4]
                })
                .is_none(),
            "existing rectangle consumers must not reach their unreachable color branch"
        );
        let clip = egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(100.0, 100.0));
        let mut mesh = egui::Mesh::default();
        mesh.add_colored_rect(clip, egui::Color32::WHITE);
        for command in [
            PaintCommand::Line {
                points: [egui::pos2(1.0, 2.0), egui::pos2(3.0, 4.0)],
                width: 1.0,
                rgba: [255; 4],
            },
            PaintCommand::Line {
                points,
                width: f32::NAN,
                rgba: [255; 4],
            },
            PaintCommand::Line {
                points,
                width: 17.0 / scale,
                rgba: [255; 4],
            },
            PaintCommand::FillRect {
                rect: clip,
                rgba: [255; 4],
            },
            PaintCommand::FrameRect {
                rect: clip,
                width: 1.0 / scale,
                rgba: [255; 4],
            },
            PaintCommand::Disc {
                center: clip.center(),
                radius: 2.0,
                rgba: [255; 4],
            },
        ] {
            let before = mesh.clone();
            assert!(!raster.paint_axis(command, egui::Color32::WHITE, clip, &mut mesh));
            assert_eq!(
                mesh, before,
                "unsupported specialization must leave output untouched"
            );
        }
    }
    for scale in [1.25, 1.5, 3.0] {
        assert!(PixelRectRasterizer::new(scale, options).is_none());
    }
    for mutate in [
        |o: &mut egui::epaint::TessellationOptions| o.feathering = false,
        |o: &mut egui::epaint::TessellationOptions| o.feathering_size_in_pixels = 2.0,
        |o: &mut egui::epaint::TessellationOptions| o.round_rects_to_pixels = false,
        |o: &mut egui::epaint::TessellationOptions| o.round_line_segments_to_pixels = false,
        |o: &mut egui::epaint::TessellationOptions| o.debug_paint_clip_rects = true,
        |o: &mut egui::epaint::TessellationOptions| o.debug_ignore_clip_rects = true,
    ] {
        let mut custom = options;
        mutate(&mut custom);
        assert!(PixelRectRasterizer::new(1.0, custom).is_none());
    }
}

#[test]
fn axis_raster_feathered_strips_preserve_original_vertices_indices_and_gl_bytes() {
    let mut renderer = OffscreenRenderer::new("").expect("strip oracle requires EGL; no skip");
    let fixture = Fixture::new();
    let mut accepted = 0;
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.key.screen_size = [257, 251];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(3.25, 5.75) / scale,
            egui::pos2(254.75, 248.5) / scale,
        );
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        for coarse in [true, false] {
            let mut options = request.key.tessellation;
            options.coarse_tessellation_culling = coarse;
            let raster = PixelRectRasterizer::new(scale, options).unwrap();
            for width_px in [
                0.0001, 0.0625, 0.1, 0.25, 0.49, 0.5, 0.75, 0.875, 0.9, 0.95, 1.0, 1.5, 1.9999,
                2.0, 3.0, 7.5, 16.0,
            ] {
                let mut original = egui::Mesh::default();
                let mut candidate = egui::Mesh::default();
                let mut tessellator = egui::epaint::Tessellator::new(
                    scale,
                    options,
                    request.key.font_texture_size,
                    Vec::new(),
                );
                tessellator.set_clip_rect(request.key.canvas);
                for index in 0..144 {
                    let phase = [0.0, 0.125, 0.25, 0.49, 0.5, 0.75, -0.49, -0.75][index % 8];
                    let axis = -4.0 + index as f32 * 1.85 + phase;
                    let start = [-1.75, 0.0, 3.25, 17.5, 29.75, 44.99][index / 8 % 6];
                    let length =
                        [0.0625, 0.5, 1.0, 1.5, 2.0, 2.25, 3.0, 20.5, 250.25][index / 16 % 9];
                    let rect = if index % 2 == 0 {
                        egui::Rect::from_min_size(
                            egui::pos2(axis, start),
                            egui::vec2(width_px, length),
                        )
                    } else {
                        egui::Rect::from_min_size(
                            egui::pos2(start, axis),
                            egui::vec2(length, width_px),
                        )
                    } / scale;
                    let rgba = [173, 61, 237, [0, 1, 31, 112, 173, 255][index / 2 % 6]];
                    let color = crate::app::color32(rgba);
                    let (command, shape) = if width_px > 2.0 || index % 3 == 0 {
                        let mut points = if index % 2 == 0 {
                            [rect.center_top(), rect.center_bottom()]
                        } else {
                            [rect.left_center(), rect.right_center()]
                        };
                        if index % 4 == 0 {
                            points.swap(0, 1);
                        }
                        (
                            PaintCommand::Line {
                                points,
                                width: width_px / scale,
                                rgba,
                            },
                            egui::Shape::line_segment(
                                points,
                                egui::Stroke::new(width_px / scale, color),
                            ),
                        )
                    } else if index % 3 == 1 {
                        (
                            PaintCommand::FillRect { rect, rgba },
                            egui::Shape::rect_filled(rect, 0.0, color),
                        )
                    } else {
                        (
                            PaintCommand::FrameRect {
                                rect,
                                width: 1.0 / scale,
                                rgba,
                            },
                            egui::Shape::rect_stroke(
                                rect,
                                0.0,
                                egui::Stroke::new(1.0 / scale, color),
                                egui::StrokeKind::Inside,
                            ),
                        )
                    };
                    tessellator.tessellate_shape(shape.clone(), &mut original);
                    if raster.paint_axis(command, color, request.key.canvas, &mut candidate) {
                        accepted += 1;
                    } else {
                        tessellator.tessellate_shape(shape, &mut candidate);
                    }
                }
                assert_eq!(
                    candidate.vertices, original.vertices,
                    "vertices DPR {scale}, width {width_px}, coarse {coarse}"
                );
                assert_eq!(
                    candidate.indices, original.indices,
                    "indices DPR {scale}, width {width_px}, coarse {coarse}"
                );
                let expected = render(&mut renderer, &request, original);
                let actual = render(&mut renderer, &request, candidate);
                assert_eq!(
                    actual.iter().zip(&expected).position(|(a, b)| a != b),
                    None,
                    "GL bytes DPR {scale}, width {width_px}, coarse {coarse}"
                );
            }
        }
    }
    assert!(
        accepted > 10_000,
        "vacuous strip specialization: {accepted}"
    );
    eprintln!("axis strips accepted {accepted} commands with identical original vertices, indices, and GL RGBA bytes");
}
