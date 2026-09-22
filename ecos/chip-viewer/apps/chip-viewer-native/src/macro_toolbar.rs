//! Left-side toolbar for manual macro placement.

use eframe::egui;

use crate::macro_ops::MacroOp;

/// Selection summary the toolbar is enabled against. Kept as a plain value
/// so the egui code stays free of database borrows.
pub(crate) struct MacroToolbarState {
    pub unplaced_count: usize,
    pub selected_count: usize,
    pub placed_selected_count: usize,
    pub unplaced_stdcell_count: u64,
    pub rotation_allowed: bool,
    pub mirror_horizontal_allowed: bool,
    pub mirror_vertical_allowed: bool,
    pub die_available: bool,
    pub core_available: bool,
    pub queue_busy: bool,
    pub queue_status: String,
}

/// Draws the macro placement toolbar and reports requested operations.
pub(crate) fn show_macro_toolbar(
    ui: &mut egui::Ui,
    state: &MacroToolbarState,
    mut request_op: impl FnMut(MacroOp),
) {
    ui.add_space(8.0);
    ui.label(
        egui::RichText::new("MACRO PLACEMENT")
            .small()
            .strong()
            .color(crate::app::ecos_accent()),
    );
    ui.add_space(6.0);
    ui.label(format!(
        "{} unplaced · {} selected",
        state.unplaced_count, state.selected_count
    ));
    ui.add_space(8.0);

    let has_selection = state.selected_count > 0 && !state.queue_busy;
    let alignable = state.placed_selected_count >= 2 && !state.queue_busy;
    let distributable = state.placed_selected_count >= 3 && !state.queue_busy;
    let centerable = has_selection && state.die_available && state.core_available;

    let card_content_width = macro_toolbar_content_width(ui.available_width());
    egui::Frame::NONE
        .fill(egui::Color32::from_rgba_unmultiplied(255, 255, 255, 7))
        .stroke(egui::Stroke::new(1.0, crate::app::ecos_border()))
        .corner_radius(6)
        .inner_margin(egui::Margin::same(8))
        .show(ui, |ui| {
            ui.set_width(card_content_width);
            centered_ui(ui, ALIGNMENT_PAD_WIDTH, ALIGNMENT_PAD_WIDTH, |ui| {
                egui::Grid::new("macro_alignment_pad")
                    .spacing(egui::vec2(ICON_GAP, ICON_GAP))
                    .show(ui, |ui| {
                        empty_button_cell(ui);
                        if icon_button(
                            ui,
                            alignable,
                            ToolbarIcon::AlignTop,
                            "Align top",
                            selection_requirement(state, 2),
                        ) {
                            request_op(MacroOp::AlignTop);
                        }
                        empty_button_cell(ui);
                        ui.end_row();

                        if icon_button(
                            ui,
                            alignable,
                            ToolbarIcon::AlignLeft,
                            "Align left",
                            selection_requirement(state, 2),
                        ) {
                            request_op(MacroOp::AlignLeft);
                        }
                        if icon_button(
                            ui,
                            centerable,
                            ToolbarIcon::Center,
                            "Center selection on DIE",
                            center_disabled_reason(state),
                        ) {
                            request_op(MacroOp::CenterOnDie);
                        }
                        if icon_button(
                            ui,
                            alignable,
                            ToolbarIcon::AlignRight,
                            "Align right",
                            selection_requirement(state, 2),
                        ) {
                            request_op(MacroOp::AlignRight);
                        }
                        ui.end_row();

                        empty_button_cell(ui);
                        if icon_button(
                            ui,
                            alignable,
                            ToolbarIcon::AlignBottom,
                            "Align bottom",
                            selection_requirement(state, 2),
                        ) {
                            request_op(MacroOp::AlignBottom);
                        }
                        empty_button_cell(ui);
                        ui.end_row();
                    });
            });
            ui.add_space(6.0);
            centered_ui(ui, SECONDARY_ROW_WIDTH, ICON_BUTTON_SIZE, |ui| {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = ICON_GAP;
                    if icon_button(
                        ui,
                        distributable,
                        ToolbarIcon::DistributeHorizontal,
                        "Distribute horizontally",
                        selection_requirement(state, 3),
                    ) {
                        request_op(MacroOp::DistributeHorizontal);
                    }
                    if icon_button(
                        ui,
                        distributable,
                        ToolbarIcon::DistributeVertical,
                        "Distribute vertically",
                        selection_requirement(state, 3),
                    ) {
                        request_op(MacroOp::DistributeVertical);
                    }
                    if icon_button(
                        ui,
                        has_selection && state.rotation_allowed,
                        ToolbarIcon::Rotate90,
                        "Rotate 90° counter-clockwise",
                        transform_disabled_reason(
                            state,
                            state.rotation_allowed,
                            "Master symmetry forbids 90° rotation",
                        ),
                    ) {
                        request_op(MacroOp::Rotate90);
                    }
                    if icon_button(
                        ui,
                        has_selection && state.mirror_horizontal_allowed,
                        ToolbarIcon::MirrorHorizontal,
                        "Mirror horizontally",
                        transform_disabled_reason(
                            state,
                            state.mirror_horizontal_allowed,
                            "Master symmetry forbids horizontal mirroring",
                        ),
                    ) {
                        request_op(MacroOp::MirrorHorizontal);
                    }
                    if icon_button(
                        ui,
                        has_selection && state.mirror_vertical_allowed,
                        ToolbarIcon::MirrorVertical,
                        "Mirror vertically",
                        transform_disabled_reason(
                            state,
                            state.mirror_vertical_allowed,
                            "Master symmetry forbids vertical mirroring",
                        ),
                    ) {
                        request_op(MacroOp::MirrorVertical);
                    }
                });
            });
        });

    ui.add_space(8.0);
    ui.separator();
    ui.label(
        egui::RichText::new(state.queue_status.as_str())
            .small()
            .color(crate::app::ecos_text_secondary()),
    );
    if state.unplaced_count > 0 {
        ui.add_space(4.0);
        ui.label(
            egui::RichText::new("postFloorplan needs every macro placed before saving")
                .small()
                .color(crate::app::ecos_text_secondary()),
        );
    }
    if state.unplaced_stdcell_count > 0 {
        ui.add_space(4.0);
        ui.label(
            egui::RichText::new(format!(
                "{} standard cells unplaced (aggregate blob at die bottom-right)",
                state.unplaced_stdcell_count
            ))
            .small()
            .color(crate::app::ecos_text_secondary()),
        );
    }
}

const ICON_BUTTON_SIZE: f32 = 32.0;
const ICON_GAP: f32 = 3.0;
const ALIGNMENT_PAD_WIDTH: f32 = ICON_BUTTON_SIZE * 3.0 + ICON_GAP * 2.0;
const SECONDARY_ROW_WIDTH: f32 = ICON_BUTTON_SIZE * 5.0 + ICON_GAP * 4.0;
const CARD_HORIZONTAL_MARGIN: f32 = 16.0;

fn macro_toolbar_content_width(available_width: f32) -> f32 {
    (available_width - CARD_HORIZONTAL_MARGIN).clamp(ALIGNMENT_PAD_WIDTH, SECONDARY_ROW_WIDTH)
}

#[derive(Clone, Copy)]
enum ToolbarIcon {
    AlignLeft,
    AlignRight,
    AlignTop,
    AlignBottom,
    Center,
    DistributeHorizontal,
    DistributeVertical,
    Rotate90,
    MirrorHorizontal,
    MirrorVertical,
}

fn centered_ui(
    ui: &mut egui::Ui,
    width: f32,
    height: f32,
    add_contents: impl FnOnce(&mut egui::Ui),
) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 0.0;
        ui.add_space(((ui.available_width() - width) * 0.5).max(0.0));
        ui.allocate_ui_with_layout(
            egui::vec2(width, height),
            egui::Layout::left_to_right(egui::Align::Center),
            add_contents,
        );
    });
}

fn empty_button_cell(ui: &mut egui::Ui) {
    ui.allocate_space(egui::vec2(ICON_BUTTON_SIZE, ICON_BUTTON_SIZE));
}

fn icon_button(
    ui: &mut egui::Ui,
    enabled: bool,
    icon: ToolbarIcon,
    tooltip: &'static str,
    disabled_tooltip: &'static str,
) -> bool {
    let response = ui.add_enabled(
        enabled,
        egui::Button::new("").min_size(egui::vec2(ICON_BUTTON_SIZE, ICON_BUTTON_SIZE)),
    );
    response.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, enabled, tooltip));
    let color = ui.style().interact(&response).fg_stroke.color;
    paint_icon(ui.painter(), response.rect.shrink(7.0), icon, color);
    let clicked = response.clicked();
    if enabled {
        response.on_hover_text(tooltip);
    } else {
        response.on_disabled_hover_text(disabled_tooltip);
    }
    clicked
}

fn selection_requirement(state: &MacroToolbarState, minimum: usize) -> &'static str {
    if state.queue_busy {
        "A macro operation is already in progress"
    } else if minimum == 2 {
        "Select at least two placed macros"
    } else {
        "Select at least three placed macros"
    }
}

fn center_disabled_reason(state: &MacroToolbarState) -> &'static str {
    if state.queue_busy {
        "A macro operation is already in progress"
    } else if state.selected_count == 0 {
        "Select one or more macros"
    } else if !state.die_available {
        "DIE boundary is unavailable"
    } else {
        "Core boundary is unavailable"
    }
}

fn transform_disabled_reason(
    state: &MacroToolbarState,
    symmetry_allowed: bool,
    symmetry_reason: &'static str,
) -> &'static str {
    if state.queue_busy {
        "A macro operation is already in progress"
    } else if state.selected_count == 0 {
        "Select one or more macros"
    } else if !symmetry_allowed {
        symmetry_reason
    } else {
        "Operation unavailable"
    }
}

fn paint_icon(painter: &egui::Painter, rect: egui::Rect, icon: ToolbarIcon, color: egui::Color32) {
    let stroke = egui::Stroke::new(1.6, color);
    match icon {
        ToolbarIcon::AlignLeft => paint_triangle(painter, rect, egui::vec2(-1.0, 0.0), color),
        ToolbarIcon::AlignRight => paint_triangle(painter, rect, egui::vec2(1.0, 0.0), color),
        ToolbarIcon::AlignTop => paint_triangle(painter, rect, egui::vec2(0.0, -1.0), color),
        ToolbarIcon::AlignBottom => paint_triangle(painter, rect, egui::vec2(0.0, 1.0), color),
        ToolbarIcon::Center => {
            let die = rect.shrink2(egui::vec2(1.0, 3.0));
            painter.rect_stroke(die, 1.0, stroke, egui::StrokeKind::Inside);
            painter.circle_stroke(die.center(), 3.2, stroke);
        }
        ToolbarIcon::DistributeHorizontal => {
            painter.line_segment([rect.left_top(), rect.left_bottom()], stroke);
            painter.line_segment([rect.right_top(), rect.right_bottom()], stroke);
            let center = rect.center();
            painter.arrow(
                center,
                egui::vec2(rect.left() - center.x + 3.0, 0.0),
                stroke,
            );
            painter.arrow(
                center,
                egui::vec2(rect.right() - center.x - 3.0, 0.0),
                stroke,
            );
        }
        ToolbarIcon::DistributeVertical => {
            painter.line_segment([rect.left_top(), rect.right_top()], stroke);
            painter.line_segment([rect.left_bottom(), rect.right_bottom()], stroke);
            let center = rect.center();
            painter.arrow(center, egui::vec2(0.0, rect.top() - center.y + 3.0), stroke);
            painter.arrow(
                center,
                egui::vec2(0.0, rect.bottom() - center.y - 3.0),
                stroke,
            );
        }
        ToolbarIcon::Rotate90 => paint_rotate_icon(painter, rect, stroke, color),
        ToolbarIcon::MirrorHorizontal => paint_mirror_icon(painter, rect, stroke, true),
        ToolbarIcon::MirrorVertical => paint_mirror_icon(painter, rect, stroke, false),
    }
}

fn paint_mirror_icon(
    painter: &egui::Painter,
    rect: egui::Rect,
    stroke: egui::Stroke,
    horizontal: bool,
) {
    let center = rect.center();
    if horizontal {
        painter.line_segment(
            [
                egui::pos2(center.x, rect.top()),
                egui::pos2(center.x, rect.bottom()),
            ],
            egui::Stroke::new(1.0, stroke.color),
        );
        let offset = rect.width() * 0.25;
        let size = egui::vec2(offset, rect.height() * 0.72);
        for x in [center.x - offset, center.x + offset] {
            painter.rect_stroke(
                egui::Rect::from_center_size(egui::pos2(x, center.y), size),
                0.0,
                stroke,
                egui::StrokeKind::Inside,
            );
        }
    } else {
        painter.line_segment(
            [
                egui::pos2(rect.left(), center.y),
                egui::pos2(rect.right(), center.y),
            ],
            egui::Stroke::new(1.0, stroke.color),
        );
        let offset = rect.height() * 0.25;
        let size = egui::vec2(rect.width() * 0.72, offset);
        for y in [center.y - offset, center.y + offset] {
            painter.rect_stroke(
                egui::Rect::from_center_size(egui::pos2(center.x, y), size),
                0.0,
                stroke,
                egui::StrokeKind::Inside,
            );
        }
    }
}

fn paint_triangle(
    painter: &egui::Painter,
    rect: egui::Rect,
    direction: egui::Vec2,
    color: egui::Color32,
) {
    let center = rect.center();
    let forward = direction * rect.width().min(rect.height()) * 0.42;
    let side = egui::vec2(-direction.y, direction.x) * rect.width().min(rect.height()) * 0.34;
    painter.add(egui::Shape::convex_polygon(
        vec![
            center + forward,
            center - forward * 0.72 + side,
            center - forward * 0.72 - side,
        ],
        color,
        egui::Stroke::NONE,
    ));
}

fn paint_rotate_icon(
    painter: &egui::Painter,
    rect: egui::Rect,
    stroke: egui::Stroke,
    color: egui::Color32,
) {
    let center = rect.center();
    let radius = rect.width().min(rect.height()) * 0.38;
    let start = -std::f32::consts::PI * 0.8;
    let end = std::f32::consts::PI * 0.65;
    let points = (0..=12)
        .map(|step| {
            let angle = start + (end - start) * step as f32 / 12.0;
            center + egui::vec2(angle.cos(), angle.sin()) * radius
        })
        .collect();
    painter.add(egui::Shape::line(points, stroke));
    let tip = center + egui::vec2(end.cos(), end.sin()) * radius;
    let tangent = egui::vec2(-end.sin(), end.cos());
    let inward = (center - tip).normalized();
    painter.add(egui::Shape::convex_polygon(
        vec![tip + tangent * 3.5, tip - tangent * 3.5, tip + inward * 6.0],
        color,
        egui::Stroke::NONE,
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolbar_content_width_stays_bounded_by_its_controls() {
        assert_eq!(macro_toolbar_content_width(80.0), ALIGNMENT_PAD_WIDTH);
        assert_eq!(macro_toolbar_content_width(150.0), 134.0);
        assert_eq!(macro_toolbar_content_width(220.0), SECONDARY_ROW_WIDTH);
        assert_eq!(macro_toolbar_content_width(10_000.0), SECONDARY_ROW_WIDTH);
    }
}
