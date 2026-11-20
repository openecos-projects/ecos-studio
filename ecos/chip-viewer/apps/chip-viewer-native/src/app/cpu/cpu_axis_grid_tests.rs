use super::*;

#[test]
fn axis_grid_rectangles_match_original_line_pixels_at_fractional_endpoints() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(2.6125708, 1.0);
    request.key.screen_size = [257, 251];
    request.key.canvas =
        egui::Rect::from_min_max(egui::pos2(3.25, 5.75), egui::pos2(254.75, 248.5));
    request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
    for width in [1.0, 2.0] {
        for page in 0..6 {
            let mut originals = Vec::new();
            let mut quads = egui::Mesh::default();
            let mut tessellator = request.tessellator.clone();
            for index in 0..100 {
                let number = page * 100 + index;
                let coordinate = -3.25 + index as f32 * 2.73;
                let length_start = [-2.5, 7.0, 13.25, 23.5, 30.75, 47.99][number % 6];
                let length_end = [259.25, 189.0, 170.25, 199.5, 240.75, 202.01][number / 6 % 6];
                let mut points = if index % 2 == 0 {
                    [
                        egui::pos2(coordinate, length_start),
                        egui::pos2(coordinate, length_end),
                    ]
                } else {
                    [
                        egui::pos2(length_start, coordinate),
                        egui::pos2(length_end, coordinate),
                    ]
                };
                if number % 3 == 0 {
                    points.swap(0, 1);
                }
                let stroke = egui::Stroke::new(
                    width,
                    egui::Color32::from_rgba_unmultiplied(
                        (number * 37) as u8,
                        (number * 71) as u8,
                        (number * 137) as u8,
                        [1, 31, 82, 104, 173, 255][number % 6],
                    ),
                );
                originals.push(egui::epaint::ClippedShape {
                    clip_rect: request.key.canvas,
                    shape: egui::Shape::line_segment(points, stroke),
                });
                let rect = axis_grid::rectangle(points, stroke, &request.key)
                    .expect("supported grid line");
                quads.add_colored_rect(rect, stroke.color);
            }
            let mut kernel = sparse_rects::SparseRects::new(&request).unwrap();
            assert!(kernel.append_axis_overlays(&originals, &request, &|| true));
            let software = kernel.render(request.key.background);
            let expected = pixels(
                &mut renderer,
                &request,
                tessellator.tessellate_shapes(originals),
            );
            let actual = pixels(
                &mut renderer,
                &request,
                vec![egui::ClippedPrimitive {
                    clip_rect: request.key.canvas,
                    primitive: egui::epaint::Primitive::Mesh(quads),
                }],
            );
            let differences = actual
                .iter()
                .zip(&expected)
                .enumerate()
                .filter(|(_, (actual, expected))| actual != expected)
                .take(16)
                .collect::<Vec<_>>();
            assert!(
                differences.is_empty(),
                "width {width} page {page}: {differences:?}"
            );
            assert_eq!(
                software
                    .iter()
                    .zip(&expected)
                    .position(|(actual, expected)| actual != expected),
                None,
                "software width {width} page {page}"
            );
        }
    }
}

#[test]
fn axis_grid_admission_preserves_reference_fallback_and_atomic_cancellation() {
    let fixture = Fixture::new();
    let mut request = fixture.request(2.0, 1.0);
    let points = [egui::pos2(17.25, 7.5), egui::pos2(17.25, 317.25)];
    let stroke = egui::Stroke::new(1.0, egui::Color32::from_black_alpha(82));
    let shape = egui::epaint::ClippedShape {
        clip_rect: request.key.canvas,
        shape: egui::Shape::line_segment(points, stroke),
    };
    let mut kernel = sparse_rects::SparseRects::new(&request).unwrap();
    for unsupported in [
        egui::epaint::ClippedShape {
            clip_rect: request.key.canvas,
            shape: egui::Shape::circle_filled(egui::pos2(23.0, 33.0), 2.0, egui::Color32::WHITE),
        },
        egui::epaint::ClippedShape {
            clip_rect: request.key.canvas.shrink(1.0),
            ..shape.clone()
        },
    ] {
        assert!(!kernel.append_axis_overlays(&[shape.clone(), unsupported], &request, &|| true));
        assert_eq!(kernel.len(), 0);
    }
    assert!(!kernel.append_axis_overlays(std::slice::from_ref(&shape), &request, &|| false));
    assert_eq!(kernel.len(), 0);
    for scale in [1.25, 2.0, 4.0] {
        request.key.pixels_per_point = scale;
        assert!(axis_grid::rectangle(points, stroke, &request.key).is_none());
    }
    request.key.pixels_per_point = 1.0;
    for width in [0.0, 0.5, 1.5, 3.0] {
        assert!(
            axis_grid::rectangle(points, egui::Stroke::new(width, stroke.color), &request.key)
                .is_none()
        );
    }
    for points in [
        [points[0], points[0] + egui::vec2(1.0, 1.0)],
        [points[0], points[0] + egui::vec2(0.0, 0.5)],
        [egui::pos2(f32::INFINITY, 0.0), points[1]],
        [egui::pos2(20000.0, 0.0), egui::pos2(20000.0, 20.0)],
    ] {
        assert!(axis_grid::rectangle(points, stroke, &request.key).is_none());
    }
    request.key.tessellation.round_line_segments_to_pixels = false;
    assert!(axis_grid::rectangle(points, stroke, &request.key).is_none());
}
