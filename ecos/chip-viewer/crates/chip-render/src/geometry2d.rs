//! Ordered 2D geometry and display policy, independent of a UI or raster backend.

use chip_display::{FillPattern, LayerStyle};
use chip_view_db::ShapeGeometry;
use chipgeom_format::{Point32, Rect32};
use emath::{pos2, vec2, Pos2, Rect, Vec2};

#[path = "geometry2d_patterns.rs"]
mod patterns;

#[cfg(test)]
#[path = "geometry2d_tests.rs"]
mod tests;

pub const MIN_SHAPE_SCREEN_SIZE: f32 = 2.0;
pub const PATTERN_MIN_SIZE_PX: f32 = 20.0;
pub const MAX_PATTERN_OPS_PER_SHAPE: usize = 96;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ScreenPrimitive {
    Rect(Rect),
    Line { points: [Pos2; 2], width: f32 },
    Point { center: Pos2, radius: f32 },
}

impl ScreenPrimitive {
    pub fn bounds(self) -> Rect {
        match self {
            Self::Rect(rect) => rect,
            Self::Line { points, width } => {
                Rect::from_two_pos(points[0], points[1]).expand(width * 0.5)
            }
            Self::Point { center, radius } => {
                Rect::from_center_size(center, Vec2::splat(radius * 2.0))
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PaintCommand {
    FillRect {
        rect: Rect,
        rgba: [u8; 4],
    },
    FrameRect {
        rect: Rect,
        width: f32,
        rgba: [u8; 4],
    },
    Line {
        points: [Pos2; 2],
        width: f32,
        rgba: [u8; 4],
    },
    Disc {
        center: Pos2,
        radius: f32,
        rgba: [u8; 4],
    },
}

/// Consumes commands in source-over order without merging overlapping shapes.
/// Implementations must preserve inside rectangle strokes and per-command AA,
/// alpha, clipping and quantization; commands are not binary layer coverage.
/// Coordinates are logical pixels; the sink must clip to its pass's canvas.
pub trait PaintSink {
    fn paint(&mut self, command: PaintCommand);
}

#[derive(Clone, Copy, Debug)]
pub struct GeometryPass {
    canvas: Rect,
    scale: f32,
    world_center: Pos2,
    screen_center: Pos2,
}

impl GeometryPass {
    pub fn new(world: Rect32, canvas: Rect, zoom: f32, pan: Vec2) -> Self {
        let world_width = (i64::from(world.hx) - i64::from(world.lx)).max(1) as f32;
        let world_height = (i64::from(world.hy) - i64::from(world.ly)).max(1) as f32;
        Self {
            canvas,
            scale: (canvas.width() / world_width).min(canvas.height() / world_height)
                * zoom.max(0.001),
            world_center: pos2(
                (i64::from(world.lx) + i64::from(world.hx)) as f32 * 0.5,
                (i64::from(world.ly) + i64::from(world.hy)) as f32 * 0.5,
            ),
            screen_center: canvas.center() + pan,
        }
    }

    fn point(&self, point: Point32) -> Pos2 {
        pos2(
            self.screen_center.x + (point.x as f32 - self.world_center.x) * self.scale,
            self.screen_center.y - (point.y as f32 - self.world_center.y) * self.scale,
        )
    }

    pub fn project(&self, geometry: ShapeGeometry) -> ScreenPrimitive {
        match geometry {
            ShapeGeometry::Rect(rect) => {
                let rect = Rect::from_min_max(
                    self.point(Point32 {
                        x: rect.lx,
                        y: rect.hy,
                    }),
                    self.point(Point32 {
                        x: rect.hx,
                        y: rect.ly,
                    }),
                );
                ScreenPrimitive::Rect(Rect::from_center_size(
                    rect.center(),
                    vec2(
                        rect.width().max(MIN_SHAPE_SCREEN_SIZE),
                        rect.height().max(MIN_SHAPE_SCREEN_SIZE),
                    ),
                ))
            }
            ShapeGeometry::Line(line) => ScreenPrimitive::Line {
                points: [self.point(line.begin), self.point(line.end)],
                width: (line.width.unsigned_abs().max(1) as f32 * self.scale)
                    .max(MIN_SHAPE_SCREEN_SIZE),
            },
            ShapeGeometry::Point(point) => ScreenPrimitive::Point {
                center: self.point(point.point),
                radius: MIN_SHAPE_SCREEN_SIZE,
            },
        }
    }

    pub fn draw(
        &self,
        geometry: ShapeGeometry,
        style: &LayerStyle,
        sink: &mut impl PaintSink,
    ) -> usize {
        let primitive = self.project(geometry);
        if !primitive.bounds().intersects(self.canvas) {
            return 0;
        }
        match primitive {
            ScreenPrimitive::Rect(rect) => draw_rect(rect, self.canvas, style, sink),
            ScreenPrimitive::Line { points, width } => {
                sink.paint(PaintCommand::Line {
                    points,
                    width: width.max(style.line_width_px as f32),
                    rgba: style.frame_rgba,
                });
                1
            }
            ScreenPrimitive::Point { center, radius } => {
                sink.paint(PaintCommand::Disc {
                    center,
                    radius,
                    rgba: style.frame_rgba,
                });
                1
            }
        }
    }
}

fn draw_rect(rect: Rect, canvas: Rect, style: &LayerStyle, sink: &mut impl PaintSink) -> usize {
    let visible = rect.intersect(canvas);
    if !visible.is_positive() {
        return 0;
    }
    let can_pattern =
        visible.width() >= PATTERN_MIN_SIZE_PX && visible.height() >= PATTERN_MIN_SIZE_PX;
    let mut count = match style.fill_pattern {
        FillPattern::Hollow => 0,
        FillPattern::Solid => {
            sink.paint(PaintCommand::FillRect {
                rect: visible,
                rgba: style.rgba,
            });
            1
        }
        FillPattern::SparseDots if can_pattern => patterns::dots(sink, visible, style.rgba, 9.0),
        FillPattern::DenseDots if can_pattern => patterns::dots(sink, visible, style.rgba, 5.0),
        FillPattern::DiagonalHatch if can_pattern => patterns::diagonal(
            sink,
            visible,
            style.rgba,
            patterns::DiagonalDirection::Forward,
        ),
        FillPattern::CrossHatch if can_pattern => {
            let first = patterns::diagonal(
                sink,
                visible,
                style.rgba,
                patterns::DiagonalDirection::Forward,
            );
            first
                + if first < MAX_PATTERN_OPS_PER_SHAPE {
                    patterns::diagonal(
                        sink,
                        visible,
                        style.rgba,
                        patterns::DiagonalDirection::Reverse,
                    )
                } else {
                    0
                }
        }
        FillPattern::HorizontalHatch if can_pattern => {
            patterns::axis(sink, visible, style.rgba, patterns::Axis::Horizontal)
        }
        FillPattern::VerticalHatch if can_pattern => {
            patterns::axis(sink, visible, style.rgba, patterns::Axis::Vertical)
        }
        FillPattern::Grid if can_pattern => {
            patterns::axis(sink, visible, style.rgba, patterns::Axis::Horizontal)
                + patterns::axis(sink, visible, style.rgba, patterns::Axis::Vertical)
        }
        FillPattern::XMark => {
            sink.paint(PaintCommand::FillRect {
                rect: visible,
                rgba: style.rgba,
            });
            1 + if visible.width() >= 6.0 && visible.height() >= 6.0 {
                patterns::x_mark(
                    sink,
                    visible,
                    style.frame_rgba,
                    style.line_width_px.max(1) as f32,
                )
            } else {
                0
            }
        }
        _ => 0,
    };
    if rect.width() >= MIN_SHAPE_SCREEN_SIZE || rect.height() >= MIN_SHAPE_SCREEN_SIZE {
        let mut rgba = style.frame_rgba;
        if rect.width() < PATTERN_MIN_SIZE_PX || rect.height() < PATTERN_MIN_SIZE_PX {
            rgba[3] = rgba[3].min(112);
        }
        sink.paint(PaintCommand::FrameRect {
            rect,
            width: style.line_width_px.max(1) as f32,
            rgba,
        });
        count += 1;
    }
    count
}
