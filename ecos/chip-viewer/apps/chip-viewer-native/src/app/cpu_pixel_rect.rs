//! Exact single-sample rectangle coverage with ordered, nonoverlapping quads.
//! Unsupported DPI, rounding, feathering or stroke cases use the tessellator.

use super::*;
use egui::emath::GuiRounding as _;

#[derive(Clone, Copy)]
pub(in crate::app::cpu_scene) struct PixelRectRasterizer {
    pixels_per_point: f32,
}

enum RectPacket {
    Fill(egui::Rect),
    Frame { rect: egui::Rect, width: f32 },
}

impl PixelRectRasterizer {
    pub(in crate::app::cpu_scene) fn new(
        pixels_per_point: f32,
        options: egui::epaint::TessellationOptions,
    ) -> Option<Self> {
        (matches!(pixels_per_point, 1.0 | 2.0 | 4.0)
            && options.feathering
            && options.feathering_size_in_pixels == 1.0
            && options.round_rects_to_pixels
            && options.round_line_segments_to_pixels
            && !options.debug_paint_clip_rects
            && !options.debug_ignore_clip_rects)
            .then_some(Self { pixels_per_point })
    }

    pub(super) fn paint(
        self,
        command: PaintCommand,
        color: egui::Color32,
        mesh: &mut egui::Mesh,
    ) -> bool {
        let Some(rectangles) = self.rectangles(command) else {
            return false;
        };
        if color == egui::Color32::TRANSPARENT {
            return true;
        }
        for rect in rectangles {
            mesh.add_colored_rect(rect, color);
        }
        true
    }

    pub(in crate::app::cpu_scene) fn rectangles(
        self,
        command: PaintCommand,
    ) -> Option<impl Iterator<Item = egui::Rect>> {
        let (rectangles, count) = match self.packet(command)? {
            RectPacket::Fill(rect) => ([rect; 4], 1),
            RectPacket::Frame { rect, width } => {
                let rectangles = [
                    egui::Rect::from_min_max(
                        rect.min,
                        egui::pos2(rect.right(), rect.top() + width),
                    ),
                    egui::Rect::from_min_max(
                        egui::pos2(rect.left(), rect.bottom() - width),
                        rect.max,
                    ),
                    egui::Rect::from_min_max(
                        egui::pos2(rect.left(), rect.top() + width),
                        egui::pos2(rect.left() + width, rect.bottom() - width),
                    ),
                    egui::Rect::from_min_max(
                        egui::pos2(rect.right() - width, rect.top() + width),
                        egui::pos2(rect.right(), rect.bottom() - width),
                    ),
                ];
                (rectangles, 4)
            }
        };
        Some(rectangles.into_iter().take(count))
    }

    fn packet(self, command: PaintCommand) -> Option<RectPacket> {
        let (rect, width) = match command {
            PaintCommand::FillRect { rect, .. } => (rect, 0.0),
            PaintCommand::FrameRect { rect, width, .. } if width > 0.0 => (rect, width),
            PaintCommand::FrameRect { .. } => return None,
            PaintCommand::Line { .. } | PaintCommand::Disc { .. } => return None,
        };
        let scale = self.pixels_per_point;
        if !rect.is_positive()
            || !rect.min.is_finite()
            || !rect.max.is_finite()
            || rect.min.to_vec2().abs().max_elem() * scale > 16384.0
            || rect.max.to_vec2().abs().max_elem() * scale > 16384.0
            || !width.is_finite()
            || width < 0.0
        {
            return None;
        }
        if width == 0.0 || rect.size().min_elem() <= 2.0 * width + 0.5 / scale {
            return self.fill(rect).map(RectPacket::Fill);
        }
        let width_px = width * scale;
        let rect = rect.round_to_pixels(scale);
        if width_px.fract() != 0.0 || width_px < 1.0 || rect.size().min_elem() <= 2.0 * width {
            return None;
        }
        Some(RectPacket::Frame { rect, width })
    }

    fn fill(self, rect: egui::Rect) -> Option<egui::Rect> {
        let scale = self.pixels_per_point;
        let pixel = 1.0 / scale;
        let rect = if rect.width() <= 2.0 * pixel {
            if rect.width() != 2.0 * pixel {
                return None;
            }
            let center = rect.center().x.round_to_pixels(scale);
            egui::Rect::from_min_max(
                egui::pos2(
                    center - pixel,
                    (rect.top() + 0.25 * pixel).round_to_pixel_center(scale) - 0.5 * pixel,
                ),
                egui::pos2(
                    center + pixel,
                    (rect.bottom() - 0.25 * pixel).round_to_pixel_center(scale) + 0.5 * pixel,
                ),
            )
        } else if rect.height() <= 2.0 * pixel {
            if rect.height() != 2.0 * pixel {
                return None;
            }
            let center = rect.center().y.round_to_pixels(scale);
            egui::Rect::from_min_max(
                egui::pos2(
                    (rect.left() + 0.25 * pixel).round_to_pixel_center(scale) - 0.5 * pixel,
                    center - pixel,
                ),
                egui::pos2(
                    (rect.right() - 0.25 * pixel).round_to_pixel_center(scale) + 0.5 * pixel,
                    center + pixel,
                ),
            )
        } else {
            rect.round_to_pixels(scale)
        };
        (rect.size().min_elem() * scale >= 2.0).then_some(rect)
    }
}
