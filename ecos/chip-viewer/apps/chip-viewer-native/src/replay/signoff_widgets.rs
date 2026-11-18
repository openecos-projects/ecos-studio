//! Shared typography and bounded rows for the signoff cards.
use egui::{Color32, RichText};

pub const TEXT: Color32 = Color32::from_rgb(243, 248, 255);
pub const LABEL: Color32 = Color32::from_rgb(192, 212, 231);
pub const CYAN: Color32 = Color32::from_rgb(160, 230, 255);
pub const TEAL: Color32 = Color32::from_rgb(127, 245, 223);
pub const AMBER: Color32 = Color32::from_rgb(255, 206, 130);
pub const RED: Color32 = Color32::from_rgb(255, 154, 171);

pub fn color(state: &str) -> Color32 {
    match state.to_ascii_lowercase().as_str() {
        "pass" | "passed" | "ready" | "success" | "green" | "high" => TEAL,
        "attention" | "warning" | "warn" | "orange" | "watch" | "yellow" => AMBER,
        "blocked" | "failed" | "fail" | "red" => RED,
        "opportunity" => Color32::from_rgb(140, 188, 255),
        _ => LABEL,
    }
}
pub fn value(s: &str) -> &str {
    if s.trim().is_empty() {
        "N/A"
    } else {
        s
    }
}
pub fn count(n: Option<usize>) -> String {
    n.map_or_else(|| "N/A".into(), |n| n.to_string())
}
pub fn text(ui: &mut egui::Ui, s: &str, size: f32, color: Color32) -> egui::Response {
    ui.add(egui::Label::new(RichText::new(value(s)).size(size).color(color)).wrap())
}
pub fn heading(ui: &mut egui::Ui, title: &str) {
    ui.add_space(16.0);
    ui.add(egui::Label::new(RichText::new(title).size(17.0).strong().color(CYAN)).wrap());
    ui.separator();
    ui.add_space(4.0);
}
pub fn badge(ui: &mut egui::Ui, s: &str) {
    let color = color(s);
    egui::Frame::NONE
        .fill(color.gamma_multiply(0.12))
        .corner_radius(4)
        .inner_margin(5)
        .show(ui, |ui| {
            ui.add(
                egui::Label::new(
                    RichText::new(value(s).to_uppercase())
                        .size(14.0)
                        .strong()
                        .color(color),
                )
                .extend(),
            );
        });
}
pub fn row(ui: &mut egui::Ui, label: &str, value: &str, color: Color32) {
    let gap = 12.0;
    let width = ui.available_width();
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = gap;
        ui.allocate_ui_with_layout(
            egui::vec2((width - gap) * 0.49, 0.0),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                ui.set_width((width - gap) * 0.49);
                text(ui, label, 16.0, LABEL);
            },
        );
        ui.allocate_ui_with_layout(
            egui::vec2((width - gap) * 0.51, 0.0),
            egui::Layout::top_down(egui::Align::Max),
            |ui| {
                ui.set_width((width - gap) * 0.51);
                ui.add(
                    egui::Label::new(
                        RichText::new(super::widgets::value(value))
                            .size(17.0)
                            .strong()
                            .color(color),
                    )
                    .wrap(),
                );
            },
        );
    });
}
pub fn notice(ui: &mut egui::Ui, title: &str, description: &str, state: &str) {
    let accent = color(state);
    let frame = egui::Frame::NONE
        .fill(accent.gamma_multiply(0.09))
        .stroke(egui::Stroke::new(1.0, accent.gamma_multiply(0.4)))
        .corner_radius(6)
        .inner_margin(12);
    let width = ui.available_width() - frame.total_margin().sum().x;
    frame.show(ui, |ui| {
        ui.set_width(width);
        ui.horizontal_wrapped(|ui| {
            badge(ui, state);
            ui.add(egui::Label::new(RichText::new(title).size(17.0).strong().color(TEXT)).wrap());
        });
        text(ui, description, 16.0, TEXT);
    });
    ui.add_space(7.0);
}
