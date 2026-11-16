//! Compact legend for instance rectangles; a matrix thumbnail would imply a false grid.
use crate::map_data::{ColormapMode, HeatmapData};
use egui::{Color32, Rect};

pub fn legend_rect(canvas: Rect) -> Rect {
    let size = egui::vec2(250.0_f32.min(canvas.width() - 24.0).max(100.0), 100.0);
    Rect::from_min_size(canvas.max - size - egui::vec2(12.0, 12.0), size)
}

pub fn legend(
    ctx: &egui::Context,
    canvas: Rect,
    title: &str,
    data: &HeatmapData,
    colors: ColormapMode,
) -> bool {
    let mut close = false;
    let rect = legend_rect(canvas);
    egui::Area::new(egui::Id::new("power_map_legend"))
        .order(egui::Order::Foreground)
        .fixed_pos(rect.min)
        .show(ctx, |ui| {
            egui::Frame::NONE
                .fill(Color32::from_rgb(25, 30, 36))
                .corner_radius(8)
                .inner_margin(10)
                .show(ui, |ui| {
                    ui.set_width(rect.width() - 20.0);
                    ui.horizontal(|ui| {
                        ui.strong(title);
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            close = ui.small_button("×").clicked();
                        });
                    });
                    ui.small(format!("{} instances · power per instance", data.rows()));
                    let (bar, _) = ui.allocate_exact_size(
                        egui::vec2(ui.available_width(), 8.0),
                        egui::Sense::hover(),
                    );
                    for i in 0..64 {
                        let [r, g, b, _] = colors.sample(i as f32 / 63.0);
                        ui.painter().rect_filled(
                            Rect::from_min_max(
                                egui::pos2(bar.left() + bar.width() * i as f32 / 64.0, bar.top()),
                                egui::pos2(
                                    bar.left() + bar.width() * (i + 1) as f32 / 64.0,
                                    bar.bottom(),
                                ),
                            ),
                            0.0,
                            Color32::from_rgb(r, g, b),
                        );
                    }
                    ui.small(format!("{:.3e} — {:.3e} W", data.min(), data.max()));
                });
        });
    close
}
