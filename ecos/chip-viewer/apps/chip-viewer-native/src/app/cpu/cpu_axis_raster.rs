//! Axis strokes and tiny rectangles with epaint 0.31's exact feathered mesh.
//! Keep the original interpolated edges, caps, gamma colors and triangle order;
//! these meshes do not authorize flat CPU coverage for subpixel shapes.
use super::*;

impl PixelRectRasterizer {
    /// Separate from `rectangles`: existing consumers only extract rectangle
    /// command colors. They must explicitly handle Line before using this seam.
    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn axis_line_rectangle(
        self,
        points: [egui::Pos2; 2],
        width: f32,
    ) -> Option<egui::Rect> {
        let scale = self.pixels_per_point;
        let width_px = width * scale;
        if !width_px.is_finite()
            || width_px.fract() != 0.0
            || width_px != 1.0
            || points.iter().any(|point| {
                !point.is_finite() || point.to_vec2().abs().max_elem() * scale > 16384.0
            })
        {
            return None;
        }
        let vertical = points[0].x == points[1].x;
        if !vertical && points[0].y != points[1].y {
            return None;
        }
        let (axis, mut start, mut end) = if vertical {
            (points[0].x, points[0].y, points[1].y)
        } else {
            (points[0].y, points[0].x, points[1].x)
        };
        if start > end {
            std::mem::swap(&mut start, &mut end);
        }
        if (end - start) * scale < 2.0 {
            return None;
        }
        let pixel = 1.0 / scale;
        let axis = if width_px as u32 % 2 == 1 {
            axis.round_to_pixel_center(scale)
        } else {
            axis.round_to_pixels(scale)
        };
        let start = (start + 0.25 * pixel).round_to_pixel_center(scale) - 0.5 * pixel;
        let end = (end - 0.25 * pixel).round_to_pixel_center(scale) + 0.5 * pixel;
        let low = axis - width * 0.5;
        let high = axis + width * 0.5;
        Some(if vertical {
            egui::Rect::from_min_max(egui::pos2(low, start), egui::pos2(high, end))
        } else {
            egui::Rect::from_min_max(egui::pos2(start, low), egui::pos2(end, high))
        })
    }

    /// Emit the incumbent feathered strip without the generic Path scratchpad.
    /// Successful output preserves the original vertices and triangles exactly;
    /// it does not authorize flat-color CPU coverage or combine commands.
    pub(in crate::app::cpu_scene) fn paint_axis(
        self,
        command: PaintCommand,
        color: egui::Color32,
        clip: egui::Rect,
        output: &mut egui::Mesh,
    ) -> bool {
        if output.texture_id != egui::TextureId::default() {
            return false;
        }
        let pixel = 1.0 / self.pixels_per_point;
        let (mut points, width) = match command {
            PaintCommand::Line { points, width, .. } => (points, width),
            PaintCommand::FillRect { rect, .. } | PaintCommand::FrameRect { rect, .. } => {
                if !rect.is_positive() || !rect.is_finite() {
                    return false;
                }
                if let PaintCommand::FrameRect { width, .. } = command {
                    if !width.is_finite()
                        || width <= 0.0
                        || rect.size().min_elem() > 2.0 * width + 0.5 * pixel
                    {
                        return false;
                    }
                }
                if self.coarse_culling && !rect.intersects(clip) {
                    return true;
                }
                if rect.width() <= 2.0 * pixel {
                    ([rect.center_top(), rect.center_bottom()], rect.width())
                } else if rect.height() <= 2.0 * pixel {
                    ([rect.left_center(), rect.right_center()], rect.height())
                } else {
                    return false;
                }
            }
            PaintCommand::PatternRect { .. } | PaintCommand::Disc { .. } => return false,
        };
        if !width.is_finite()
            || width <= 0.0
            || width * self.pixels_per_point > 16.0
            || points.iter().any(|p| {
                !p.is_finite() || p.to_vec2().abs().max_elem() * self.pixels_per_point > 16384.0
            })
            || (points[0].x != points[1].x && points[0].y != points[1].y)
        {
            return false;
        }
        if color == egui::Color32::TRANSPARENT {
            return true;
        }
        if self.coarse_culling
            && !egui::Rect::from_two_pos(points[0], points[1])
                .expand(width)
                .intersects(clip)
        {
            return true;
        }
        let round_axis = |coordinate: f32| {
            if width <= pixel || ((self.pixels_per_point * width) * 0.5 + 0.25).fract() > 0.5 {
                coordinate.round_to_pixel_center(self.pixels_per_point)
            } else {
                coordinate.round_to_pixels(self.pixels_per_point)
            }
        };
        let [a, b] = &mut points;
        if a.x == b.x {
            a.x = round_axis(a.x);
            b.x = a.x;
            if a.y < b.y {
                a.y = (a.y + 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
                b.y = (b.y - 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
            } else {
                a.y = (a.y - 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
                b.y = (b.y + 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
            }
        }
        if a.y == b.y {
            a.y = round_axis(a.y);
            b.y = a.y;
            if a.x < b.x {
                a.x = (a.x + 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
                b.x = (b.x - 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
            } else {
                a.x = (a.x - 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
                b.x = (b.x + 0.25 * pixel).round_to_pixel_center(self.pixels_per_point);
            }
        }
        let normal = (points[1] - points[0]).normalized().rot90();
        let base = output.vertices.len() as u32;
        if width <= 0.9 * pixel {
            let middle = color.gamma_multiply(width / pixel);
            for p in points {
                output.colored_vertex(p + normal * pixel, egui::Color32::TRANSPARENT);
                output.colored_vertex(p, middle);
                output.colored_vertex(p - normal * pixel, egui::Color32::TRANSPARENT);
            }
            output
                .indices
                .extend([0, 1, 3, 1, 3, 4, 1, 2, 4, 2, 4, 5].map(|i| base + i));
        } else {
            let inner = 0.5 * (width - pixel);
            let outer = 0.5 * (width + pixel);
            for (index, p) in points.into_iter().enumerate() {
                let back = if index == 0 {
                    normal.rot90() * pixel
                } else {
                    -normal.rot90() * pixel
                };
                output.colored_vertex(p + normal * outer + back, egui::Color32::TRANSPARENT);
                output.colored_vertex(p + normal * inner, color);
                output.colored_vertex(p - normal * inner, color);
                output.colored_vertex(p - normal * outer + back, egui::Color32::TRANSPARENT);
            }
            output.indices.extend(
                [
                    0, 1, 2, 0, 2, 3, 0, 1, 4, 1, 4, 5, 1, 2, 5, 2, 5, 6, 2, 3, 6, 3, 6, 7, 4, 5,
                    6, 4, 6, 7,
                ]
                .map(|i| base + i),
            );
        }
        true
    }
}
