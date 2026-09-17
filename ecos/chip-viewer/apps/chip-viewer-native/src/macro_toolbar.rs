//! Left-side toolbar for manual macro placement.

use eframe::egui;

use crate::macro_ops::MacroOp;

/// Selection summary the toolbar is enabled against. Kept as a plain value
/// so the egui code stays free of database borrows.
pub(crate) struct MacroToolbarState {
    pub unplaced_count: usize,
    pub selected_count: usize,
    pub rotation_allowed: bool,
    pub mirror_allowed: bool,
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
    let alignable = state.selected_count >= 2 && !state.queue_busy;
    let distributable = state.selected_count >= 3 && !state.queue_busy;

    ui.horizontal(|ui| {
        let rotate = egui::Button::new("Rotate 90°");
        if ui
            .add_enabled(has_selection && state.rotation_allowed, rotate)
            .on_disabled_hover_text("master symmetry forbids rotation")
            .clicked()
        {
            request_op(MacroOp::Rotate90);
        }
        let mirror = egui::Button::new("Mirror");
        if ui
            .add_enabled(has_selection && state.mirror_allowed, mirror)
            .on_disabled_hover_text("master symmetry forbids mirroring")
            .clicked()
        {
            request_op(MacroOp::MirrorY);
        }
    });
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        if ui
            .add_enabled(alignable, egui::Button::new("Align L"))
            .clicked()
        {
            request_op(MacroOp::AlignLeft);
        }
        if ui
            .add_enabled(alignable, egui::Button::new("Align R"))
            .clicked()
        {
            request_op(MacroOp::AlignRight);
        }
        if ui
            .add_enabled(alignable, egui::Button::new("Align T"))
            .clicked()
        {
            request_op(MacroOp::AlignTop);
        }
        if ui
            .add_enabled(alignable, egui::Button::new("Align B"))
            .clicked()
        {
            request_op(MacroOp::AlignBottom);
        }
    });
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        if ui
            .add_enabled(distributable, egui::Button::new("Distribute H"))
            .clicked()
        {
            request_op(MacroOp::DistributeHorizontal);
        }
        if ui
            .add_enabled(distributable, egui::Button::new("Distribute V"))
            .clicked()
        {
            request_op(MacroOp::DistributeVertical);
        }
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
}
