use eframe::egui;
use layoutpkg_format::LayoutObjectKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LodMode {
    FarView,
    Overview,
    Detail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrawPrimitiveKind {
    Fill,
    Stroke,
    Density,
    Marker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrawStyle {
    pub primitive: DrawPrimitiveKind,
    pub color: egui::Color32,
    pub stroke_width: u8,
    pub max_marker_px: u8,
}

pub fn draw_style_for_mode(kind: LayoutObjectKind, mode: LodMode) -> DrawStyle {
    match mode {
        LodMode::FarView => far_view_style(kind),
        LodMode::Overview => overview_style(kind),
        LodMode::Detail => detail_style(kind),
    }
}

fn far_view_style(kind: LayoutObjectKind) -> DrawStyle {
    match kind {
        LayoutObjectKind::Die => {
            stroke(egui::Color32::from_rgba_unmultiplied(199, 242, 255, 230), 2)
        }
        LayoutObjectKind::Core => {
            stroke(egui::Color32::from_rgba_unmultiplied(45, 212, 191, 190), 2)
        }
        LayoutObjectKind::Instance => {
            fill(egui::Color32::from_rgba_unmultiplied(148, 163, 184, 22))
        }
        LayoutObjectKind::RegularWire => {
            fill(egui::Color32::from_rgba_unmultiplied(234, 179, 8, 26))
        }
        LayoutObjectKind::SpecialWire => {
            fill(egui::Color32::from_rgba_unmultiplied(34, 197, 94, 52))
        }
        LayoutObjectKind::Via => {
            marker(egui::Color32::from_rgba_unmultiplied(248, 113, 113, 36), 2)
        }
        LayoutObjectKind::IoPin => {
            marker(egui::Color32::from_rgba_unmultiplied(56, 189, 248, 150), 5)
        }
        LayoutObjectKind::Blockage => {
            stroke(egui::Color32::from_rgba_unmultiplied(203, 213, 225, 110), 1)
        }
        LayoutObjectKind::Fill => fill(egui::Color32::from_rgba_unmultiplied(100, 116, 139, 10)),
        LayoutObjectKind::Region => {
            stroke(egui::Color32::from_rgba_unmultiplied(244, 114, 182, 120), 1)
        }
        LayoutObjectKind::Row => {
            stroke(egui::Color32::from_rgba_unmultiplied(148, 163, 184, 35), 1)
        }
        LayoutObjectKind::Track => {
            stroke(egui::Color32::from_rgba_unmultiplied(20, 184, 166, 34), 1)
        }
        LayoutObjectKind::GCellGrid => {
            stroke(egui::Color32::from_rgba_unmultiplied(51, 65, 85, 48), 1)
        }
    }
}

fn overview_style(kind: LayoutObjectKind) -> DrawStyle {
    match kind {
        LayoutObjectKind::Die => stroke(egui::Color32::from_rgba_unmultiplied(15, 23, 42, 150), 2),
        LayoutObjectKind::Core => {
            stroke(egui::Color32::from_rgba_unmultiplied(20, 184, 166, 120), 1)
        }
        LayoutObjectKind::Instance => {
            stroke(egui::Color32::from_rgba_unmultiplied(148, 163, 184, 92), 1)
        }
        LayoutObjectKind::RegularWire => {
            density(egui::Color32::from_rgba_unmultiplied(245, 158, 11, 42), 1)
        }
        LayoutObjectKind::SpecialWire => {
            density(egui::Color32::from_rgba_unmultiplied(34, 197, 94, 58), 2)
        }
        LayoutObjectKind::Via => marker(egui::Color32::from_rgba_unmultiplied(185, 28, 28, 76), 3),
        LayoutObjectKind::IoPin => {
            marker(egui::Color32::from_rgba_unmultiplied(13, 148, 136, 96), 4)
        }
        LayoutObjectKind::Blockage => {
            stroke(egui::Color32::from_rgba_unmultiplied(168, 85, 247, 94), 1)
        }
        LayoutObjectKind::Fill => fill(egui::Color32::from_rgba_unmultiplied(100, 116, 139, 18)),
        LayoutObjectKind::Region => {
            stroke(egui::Color32::from_rgba_unmultiplied(244, 114, 182, 96), 1)
        }
        LayoutObjectKind::Row => stroke(egui::Color32::from_rgba_unmultiplied(71, 85, 105, 50), 1),
        LayoutObjectKind::Track => {
            stroke(egui::Color32::from_rgba_unmultiplied(100, 116, 139, 42), 1)
        }
        LayoutObjectKind::GCellGrid => {
            stroke(egui::Color32::from_rgba_unmultiplied(51, 65, 85, 40), 1)
        }
    }
}

fn detail_style(kind: LayoutObjectKind) -> DrawStyle {
    match kind {
        LayoutObjectKind::Die => fill(egui::Color32::from_rgba_unmultiplied(15, 23, 42, 30)),
        LayoutObjectKind::Core => fill(egui::Color32::from_rgba_unmultiplied(20, 184, 166, 35)),
        LayoutObjectKind::Instance => {
            fill(egui::Color32::from_rgba_unmultiplied(100, 116, 139, 70))
        }
        LayoutObjectKind::RegularWire => {
            fill(egui::Color32::from_rgba_unmultiplied(37, 99, 235, 92))
        }
        LayoutObjectKind::SpecialWire => {
            fill(egui::Color32::from_rgba_unmultiplied(217, 119, 6, 110))
        }
        LayoutObjectKind::Via => fill(egui::Color32::from_rgba_unmultiplied(220, 38, 38, 120)),
        LayoutObjectKind::IoPin => fill(egui::Color32::from_rgba_unmultiplied(13, 148, 136, 130)),
        LayoutObjectKind::Blockage => fill(egui::Color32::from_rgba_unmultiplied(124, 58, 237, 90)),
        LayoutObjectKind::Fill => fill(egui::Color32::from_rgba_unmultiplied(148, 163, 184, 70)),
        LayoutObjectKind::Region => fill(egui::Color32::from_rgba_unmultiplied(236, 72, 153, 80)),
        LayoutObjectKind::Row => fill(egui::Color32::from_rgba_unmultiplied(71, 85, 105, 35)),
        LayoutObjectKind::Track => fill(egui::Color32::from_rgba_unmultiplied(100, 116, 139, 40)),
        LayoutObjectKind::GCellGrid => fill(egui::Color32::from_rgba_unmultiplied(51, 65, 85, 40)),
    }
}

fn fill(color: egui::Color32) -> DrawStyle {
    DrawStyle {
        primitive: DrawPrimitiveKind::Fill,
        color,
        stroke_width: 0,
        max_marker_px: 0,
    }
}

fn stroke(color: egui::Color32, stroke_width: u8) -> DrawStyle {
    DrawStyle {
        primitive: DrawPrimitiveKind::Stroke,
        color,
        stroke_width,
        max_marker_px: 0,
    }
}

fn density(color: egui::Color32, stroke_width: u8) -> DrawStyle {
    DrawStyle {
        primitive: DrawPrimitiveKind::Density,
        color,
        stroke_width,
        max_marker_px: 0,
    }
}

fn marker(color: egui::Color32, max_marker_px: u8) -> DrawStyle {
    DrawStyle {
        primitive: DrawPrimitiveKind::Marker,
        color,
        stroke_width: 0,
        max_marker_px,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overview_draws_die_and_core_as_outlines() {
        assert_eq!(
            draw_style_for_mode(LayoutObjectKind::Die, LodMode::Overview).primitive,
            DrawPrimitiveKind::Stroke
        );
        assert_eq!(
            draw_style_for_mode(LayoutObjectKind::Core, LodMode::Overview).primitive,
            DrawPrimitiveKind::Stroke
        );
    }

    #[test]
    fn far_view_draws_chip_boundary_as_bright_outline() {
        let die = draw_style_for_mode(LayoutObjectKind::Die, LodMode::FarView);
        let wire = draw_style_for_mode(LayoutObjectKind::RegularWire, LodMode::FarView);

        assert_eq!(die.primitive, DrawPrimitiveKind::Stroke);
        assert!(die.color.a() > wire.color.a());
        assert!(die.stroke_width >= 2);
    }

    #[test]
    fn overview_draws_routing_as_low_alpha_density() {
        let style = draw_style_for_mode(LayoutObjectKind::RegularWire, LodMode::Overview);

        assert_ne!(style.primitive, DrawPrimitiveKind::Fill);
        assert!(style.color.a() <= 48);
    }

    #[test]
    fn overview_draws_special_routing_as_density_not_solid_fill() {
        let style = draw_style_for_mode(LayoutObjectKind::SpecialWire, LodMode::Overview);

        assert_ne!(style.primitive, DrawPrimitiveKind::Fill);
        assert!(style.color.a() <= 64);
    }

    #[test]
    fn overview_draws_structural_context_without_large_filled_blocks() {
        for kind in [
            LayoutObjectKind::Instance,
            LayoutObjectKind::Blockage,
            LayoutObjectKind::Region,
        ] {
            assert_eq!(
                draw_style_for_mode(kind, LodMode::Overview).primitive,
                DrawPrimitiveKind::Stroke
            );
        }
    }

    #[test]
    fn overview_draws_vias_and_pins_as_small_markers() {
        let via = draw_style_for_mode(LayoutObjectKind::Via, LodMode::Overview);
        let pin = draw_style_for_mode(LayoutObjectKind::IoPin, LodMode::Overview);

        assert_eq!(via.primitive, DrawPrimitiveKind::Marker);
        assert!(via.max_marker_px <= 4);
        assert_eq!(pin.primitive, DrawPrimitiveKind::Marker);
        assert!(pin.max_marker_px <= 5);
    }

    #[test]
    fn detail_keeps_regular_wires_visibly_stronger_than_overview() {
        let overview = draw_style_for_mode(LayoutObjectKind::RegularWire, LodMode::Overview);
        let detail = draw_style_for_mode(LayoutObjectKind::RegularWire, LodMode::Detail);

        assert_eq!(detail.primitive, DrawPrimitiveKind::Fill);
        assert!(detail.color.a() > overview.color.a());
    }
}
