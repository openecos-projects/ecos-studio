use super::*;
use chip_display::ColorTheme;
use chipgeom_format::{LinePayload, PointPayload};

#[derive(Default)]
struct RecordingSink(Vec<PaintCommand>);

impl PaintSink for RecordingSink {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

fn pass() -> GeometryPass {
    GeometryPass::new(
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        },
        Rect::from_min_max(pos2(10.0, 20.0), pos2(110.0, 120.0)),
        1.0,
        Vec2::ZERO,
    )
}

fn style(pattern: FillPattern) -> LayerStyle {
    LayerStyle {
        fill_pattern: pattern,
        rgba: [70, 130, 200, 91],
        frame_rgba: [200, 40, 50, 173],
        ..LayerStyle::default_for_layer(1, ColorTheme::default())
    }
}

#[test]
fn clipped_fill_and_unclipped_inside_frame_keep_their_order() {
    let mut sink = RecordingSink::default();
    let style = style(FillPattern::Solid);
    let geometry = ShapeGeometry::Rect(Rect32 {
        lx: -20,
        ly: 10,
        hx: 80,
        hy: 120,
    });
    assert_eq!(pass().draw(geometry, &style, &mut sink), 2);
    assert_eq!(
        sink.0,
        vec![
            PaintCommand::FillRect {
                rect: Rect::from_min_max(pos2(10.0, 20.0), pos2(90.0, 110.0)),
                rgba: style.rgba,
            },
            PaintCommand::FrameRect {
                rect: Rect::from_min_max(pos2(-10.0, 0.0), pos2(90.0, 110.0)),
                width: style.line_width_px.max(1) as f32,
                rgba: style.frame_rgba,
            },
        ]
    );
}

#[test]
fn repeated_translucent_shapes_are_not_unioned() {
    let mut sink = RecordingSink::default();
    let geometry = ShapeGeometry::Rect(Rect32 {
        lx: 10,
        ly: 10,
        hx: 50,
        hy: 50,
    });
    for _ in 0..2 {
        assert_eq!(
            pass().draw(geometry, &style(FillPattern::Solid), &mut sink),
            2
        );
    }
    assert_eq!(sink.0.len(), 4);
    assert_eq!(&sink.0[..2], &sink.0[2..]);
}

#[test]
fn pattern_phase_comes_from_clipped_visible_bounds() {
    let mut sink = RecordingSink::default();
    let geometry = ShapeGeometry::Rect(Rect32 {
        lx: -20,
        ly: 10,
        hx: 80,
        hy: 120,
    });
    pass().draw(geometry, &style(FillPattern::SparseDots), &mut sink);
    assert_eq!(
        sink.0[0],
        PaintCommand::Disc {
            center: pos2(12.0, 22.0),
            radius: 0.8,
            rgba: style(FillPattern::SparseDots).rgba,
        }
    );
    let shifted = GeometryPass::new(
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        },
        pass().canvas,
        1.0,
        vec2(1.0, 0.0),
    );
    let mut shifted_sink = RecordingSink::default();
    shifted.draw(geometry, &style(FillPattern::SparseDots), &mut shifted_sink);
    assert_eq!(sink.0[0], shifted_sink.0[0]);
}

#[test]
fn tiny_patterned_shapes_keep_the_legacy_frame_policy() {
    let mut sink = RecordingSink::default();
    let geometry = ShapeGeometry::Rect(Rect32 {
        lx: 50,
        ly: 50,
        hx: 50,
        hy: 50,
    });
    assert_eq!(
        pass().draw(geometry, &style(FillPattern::Grid), &mut sink),
        1
    );
    assert_eq!(
        sink.0,
        vec![PaintCommand::FrameRect {
            rect: Rect::from_center_size(pos2(60.0, 70.0), vec2(2.0, 2.0)),
            width: style(FillPattern::Grid).line_width_px.max(1) as f32,
            rgba: [200, 40, 50, 112],
        }]
    );
}

#[test]
fn projection_handles_lines_points_and_the_full_integer_domain() {
    let pass = pass();
    assert_eq!(
        pass.project(ShapeGeometry::Line(LinePayload {
            begin: Point32 { x: 10, y: 20 },
            end: Point32 { x: 80, y: 90 },
            width: -3,
            ..Default::default()
        })),
        ScreenPrimitive::Line {
            points: [pos2(20.0, 100.0), pos2(90.0, 30.0)],
            width: 3.0
        }
    );
    assert_eq!(
        pass.project(ShapeGeometry::Point(PointPayload {
            point: Point32 { x: 10, y: 20 },
            ..Default::default()
        })),
        ScreenPrimitive::Point {
            center: pos2(20.0, 100.0),
            radius: 2.0
        }
    );
    let extreme = GeometryPass::new(
        Rect32 {
            lx: i32::MIN,
            ly: i32::MIN,
            hx: i32::MAX,
            hy: i32::MAX,
        },
        pass.canvas,
        1.0,
        Vec2::ZERO,
    );
    assert!(extreme
        .project(ShapeGeometry::Line(LinePayload {
            begin: Point32 {
                x: i32::MIN,
                y: i32::MIN
            },
            end: Point32 {
                x: i32::MAX,
                y: i32::MAX
            },
            width: i32::MIN,
            ..Default::default()
        }))
        .bounds()
        .is_finite());
}

#[test]
fn offscreen_shapes_emit_no_commands() {
    let mut sink = RecordingSink::default();
    assert_eq!(
        pass().draw(
            ShapeGeometry::Rect(Rect32 {
                lx: 200,
                ly: 200,
                hx: 300,
                hy: 300
            }),
            &style(FillPattern::Grid),
            &mut sink,
        ),
        0
    );
    assert!(sink.0.is_empty());
}
