use super::*;
use egui::emath::GuiRounding as _;

pub(in crate::app::cpu_scene) fn rectangle(
    points: [egui::Pos2; 2],
    stroke: egui::Stroke,
    key: &SceneKey,
) -> Option<egui::Rect> {
    if key.pixels_per_point != 1.0
        || key.tessellation != egui::epaint::TessellationOptions::default()
        || !matches!(stroke.width, 1.0 | 2.0)
        || points
            .iter()
            .any(|point| !point.is_finite() || point.x.abs().max(point.y.abs()) > 16384.0)
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
    if end - start < 2.0 {
        return None;
    }
    let axis = if stroke.width == 1.0 {
        axis.round_to_pixel_center(1.0)
    } else {
        axis.round()
    };
    let start = (start + 0.25).round_to_pixel_center(1.0) - 0.5;
    let end = (end - 0.25).round_to_pixel_center(1.0) + 0.5;
    let low = axis - stroke.width * 0.5;
    let high = axis + stroke.width * 0.5;
    Some(if vertical {
        egui::Rect::from_min_max(egui::pos2(low, start), egui::pos2(high, end))
    } else {
        egui::Rect::from_min_max(egui::pos2(start, low), egui::pos2(end, high))
    })
}
