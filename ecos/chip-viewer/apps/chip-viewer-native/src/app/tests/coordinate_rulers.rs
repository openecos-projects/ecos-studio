use super::*;

#[test]
fn coordinate_rulers_cover_full_viewport_when_zoomed_out() {
    assert_full_viewport_ticks(550_000, egui::vec2(1000.0, 800.0), 0.15, egui::Vec2::ZERO);
}

#[test]
fn coordinate_rulers_follow_resize_pan_and_units_for_large_layouts() {
    for extent in [550_000, 10_000_000] {
        for size in [egui::vec2(1000.0, 800.0), egui::vec2(500.0, 1100.0)] {
            for zoom in [0.05, 0.15, 1.0, 4.0] {
                for pan in [egui::Vec2::ZERO, egui::vec2(1200.0, -900.0)] {
                    assert_full_viewport_ticks(extent, size, zoom, pan);
                }
            }
        }
    }
}

fn assert_full_viewport_ticks(extent: i32, size: egui::Vec2, zoom: f32, pan: egui::Vec2) {
    for unit in [CoordinateUnit::Dbu, CoordinateUnit::Micron] {
        let frame = egui::Rect::from_min_size(egui::pos2(30.0, 40.0), size);
        let canvas = layout_canvas_rect(frame);
        let [horizontal_ticks, vertical_ticks] = paint_ticks(frame, extent, zoom, pan, unit);
        for (axis, mut ticks, min, max) in [
            (
                "horizontal",
                horizontal_ticks,
                canvas.left(),
                canvas.right(),
            ),
            ("vertical", vertical_ticks, canvas.top(), canvas.bottom()),
        ] {
            ticks.sort_by(|a, b| a.0.total_cmp(&b.0));
            assert!(ticks.len() >= 2, "{axis}: missing ticks");
            let first = ticks[0].0;
            let last = ticks[ticks.len() - 1].0;
            assert!(
                first - min < 24.0 && max - last < 24.0,
                "{axis}: ticks cover {first}..{last}, expected full viewport {min}..{max}; \
                 extent={extent}, size={size:?}, zoom={zoom}, pan={pan:?}, unit={unit:?}"
            );
        }
    }
}

#[test]
fn coordinate_rulers_keep_major_ticks_readable_at_small_scales() {
    let frame = egui::Rect::from_min_size(egui::pos2(30.0, 40.0), egui::vec2(1000.0, 800.0));
    for unit in [CoordinateUnit::Dbu, CoordinateUnit::Micron] {
        let ticks = paint_ticks(frame, 550_000, 0.15, egui::Vec2::ZERO, unit);
        for axis in ticks {
            let major_ticks = axis
                .into_iter()
                .filter_map(|(position, major)| major.then_some(position))
                .collect::<Vec<_>>();
            assert!(major_ticks.len() >= 2);
            for pair in major_ticks.windows(2) {
                let gap = (pair[1] - pair[0]).abs();
                assert!(
                    (80.0..=200.0).contains(&gap),
                    "major ticks are {gap} pixels apart with unit {unit:?}"
                );
            }
        }
    }
}

#[test]
fn coordinate_rulers_share_the_layout_coordinate_transform() {
    let frame = egui::Rect::from_min_size(egui::pos2(30.0, 40.0), egui::vec2(1000.0, 800.0));
    let canvas = layout_canvas_rect(frame);
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 550_000,
        hy: 550_000,
    };
    let pan = egui::vec2(123.0, -45.0);
    let zoom = 0.15;
    let point = Point32 {
        x: -100_000,
        y: 700_000,
    };
    let moved_point = Point32 {
        x: 100_000,
        y: 400_000,
    };
    let screen = world_to_screen_point(point, world, canvas, zoom, pan);
    let moved_screen = world_to_screen_point(moved_point, world, canvas, zoom, pan);
    assert_eq!(
        screen_to_world_point(screen, world, canvas, zoom, pan),
        point
    );
    assert_eq!(
        screen_to_world_delta(moved_screen - screen, world, canvas, zoom),
        (200_000, -300_000)
    );
}

fn paint_ticks(
    frame: egui::Rect,
    extent: i32,
    zoom: f32,
    pan: egui::Vec2,
    unit: CoordinateUnit,
) -> [Vec<(f32, bool)>; 2] {
    let canvas = layout_canvas_rect(frame);
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: extent,
        hy: extent,
    };
    let ctx = egui::Context::default();
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(frame),
            ..Default::default()
        },
        |ctx| {
            paint_coordinate_rulers(
                &ctx.layer_painter(egui::LayerId::background()),
                frame,
                canvas,
                world,
                zoom,
                pan,
                unit,
                Some(1000),
            );
        },
    );
    let mut horizontal_ticks = Vec::new();
    let mut vertical_ticks = Vec::new();
    for shape in output.shapes {
        if let egui::Shape::LineSegment { points: [a, b], .. } = shape.shape {
            if a.x == b.x && b.y == frame.bottom() && a.y > canvas.bottom() {
                horizontal_ticks.push((a.x, b.y - a.y > COORDINATE_RULER_THICKNESS * 0.5));
            }
            if a.y == b.y && b.x == canvas.left() && a.x < canvas.left() {
                vertical_ticks.push((a.y, b.x - a.x > COORDINATE_RULER_THICKNESS * 0.5));
            }
        }
    }
    [horizontal_ticks, vertical_ticks]
}
