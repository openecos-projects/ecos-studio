//! Centered, independently scrollable summaries of existing signoff reports.
use super::dashboard::SignoffSummary;
use egui::{Align2, Color32, Id, Order, RichText, Stroke, Vec2};
#[path = "signoff_content.rs"]
mod content;
#[path = "signoff_widgets.rs"]
mod widgets;
use widgets::*;

pub fn show(ctx: &egui::Context, summary: &SignoffSummary, bounds: egui::Rect) -> egui::Response {
    let elapsed = animation_elapsed(ctx);
    // The caller supplies the central display rect after reserving playback controls.
    let bounds = bounds.intersect(ctx.screen_rect());
    let available = bounds.shrink2(Vec2::new(24.0, 12.0));
    let width = available.width().clamp(1.0, 1800.0);
    let max_height = available.height().max(1.0);
    ctx.layer_painter(egui::LayerId::new(
        Order::Middle,
        Id::new("replay_signoff_scrim"),
    ))
    .rect_filled(bounds, 0.0, Color32::from_rgba_unmultiplied(5, 12, 22, 100));
    egui::Area::new(Id::new("replay_signoff_cards"))
        .order(Order::Foreground)
        .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
        .constrain_to(available)
        .default_size(Vec2::new(width, max_height))
        .show(ctx, |ui| {
            ui.set_width(width);
            ui.visuals_mut().override_text_color = Some(TEXT);
            ui.spacing_mut().item_spacing = Vec2::new(8.0, 5.0);
            // A short window can scroll the complete overlay as well as each report.
            egui::ScrollArea::vertical()
                .id_salt("signoff_overlay")
                .max_height(max_height)
                .auto_shrink([false, true])
                .show(ui, |ui| {
                    let top = ui.cursor().top();
                    ui.vertical_centered(|ui| {
                        ui.add(
                            egui::Label::new(
                                RichText::new("SIGNOFF READY / HARDEN COMPLETE")
                                    .strong()
                                    .size(25.0)
                                    .color(TEXT),
                            )
                            .wrap(),
                        );
                        text(
                            ui,
                            &format!(
                                "{}   /   {}   /   Recorded signoff results",
                                value(&summary.design.top_module),
                                value(&summary.design.pdk)
                            ),
                            16.0,
                            LABEL,
                        );
                    });
                    ui.add_space(14.0);
                    let height =
                        (max_height - (ui.cursor().top() - top) - 16.0).clamp(280.0, 1100.0);
                    egui::ScrollArea::horizontal()
                        .id_salt("signoff_row")
                        .auto_shrink([false, true])
                        .show(ui, |ui| {
                            ui.horizontal_top(|ui| {
                                ui.spacing_mut().item_spacing.x = 16.0;
                                let card_width = ((width - 32.0) / 3.0).max(240.0);
                                card(
                                    ui,
                                    card_width,
                                    height,
                                    ("01 / DESIGN", reveal_progress(elapsed, 0)),
                                    TEAL,
                                    |ui| {
                                        hero(
                                            ui,
                                            &summary.design.name,
                                            &summary.design.harden_state,
                                        );
                                        text(
                                            ui,
                                            &format!(
                                                "{} / {}",
                                                value(&summary.design.top_module),
                                                value(&summary.design.pdk)
                                            ),
                                            16.0,
                                            LABEL,
                                        );
                                    },
                                    |ui| content::design(ui, summary),
                                );
                                card(
                                    ui,
                                    card_width,
                                    height,
                                    ("02 / QOR", reveal_progress(elapsed, 1)),
                                    AMBER,
                                    |ui| {
                                        hero(
                                            ui,
                                            &summary.qor.score.map_or_else(
                                                || "N/A".into(),
                                                |s| format!("{s:.1} / 100"),
                                            ),
                                            &summary.qor.scalar_status,
                                        );
                                        text(ui, "Quality & diagnostics", 16.0, LABEL);
                                    },
                                    |ui| content::qor(ui, summary),
                                );
                                card(
                                    ui,
                                    card_width,
                                    height,
                                    ("03 / CHECKLIST", reveal_progress(elapsed, 2)),
                                    AMBER,
                                    |ui| {
                                        hero(
                                            ui,
                                            value(&summary.checklist.status),
                                            &format!(
                                                "{} checks",
                                                count(
                                                    [
                                                        summary.checklist.passed,
                                                        summary.checklist.attention,
                                                        summary.checklist.blocked,
                                                        summary.checklist.unavailable
                                                    ]
                                                    .into_iter()
                                                    .try_fold(0usize, |a, b| a.checked_add(b?))
                                                )
                                            ),
                                        );
                                        text(ui, "Signoff coverage & evidence", 16.0, LABEL);
                                    },
                                    |ui| content::checklist(ui, summary),
                                );
                            });
                        });
                });
        })
        .response
}
const REVEAL_SECONDS: f64 = 0.7;
const REVEAL_GAP_SECONDS: f64 = 0.1;
const ENTRANCE_SECONDS: f64 = 3.0 * REVEAL_SECONDS + 2.0 * REVEAL_GAP_SECONDS;

// A wall-clock entrance keeps animating after playback stops at the final node.
fn animation_elapsed(ctx: &egui::Context) -> f64 {
    let now = ctx.input(|i| i.time);
    let start = ctx.data_mut(|data| {
        *data.get_temp_mut_or_insert_with(Id::new("signoff_entrance_start"), || now)
    });
    let elapsed = (now - start).max(0.0);
    if elapsed < ENTRANCE_SECONDS {
        ctx.request_repaint();
    }
    elapsed
}
pub fn reset_animation(ctx: &egui::Context) {
    ctx.data_mut(|data| data.remove::<f64>(Id::new("signoff_entrance_start")));
}
fn reveal_progress(elapsed: f64, index: usize) -> f32 {
    let start = index as f64 * (REVEAL_SECONDS + REVEAL_GAP_SECONDS);
    let t = ((elapsed - start) / REVEAL_SECONDS).clamp(0.0, 1.0) as f32;
    t * t * (3.0 - 2.0 * t)
}

fn hero(ui: &mut egui::Ui, title: &str, status: &str) {
    if ui.available_width() < 300.0 {
        ui.add(
            egui::Label::new(RichText::new(value(title)).size(28.0).color(
                if title.eq_ignore_ascii_case("attention") {
                    AMBER
                } else {
                    color(status)
                },
            ))
            .wrap(),
        );
        badge(ui, status);
        return;
    }
    ui.horizontal_wrapped(|ui| {
        ui.add(
            egui::Label::new(RichText::new(value(title)).size(30.0).strong().color(
                if title.eq_ignore_ascii_case("attention") {
                    AMBER
                } else {
                    color(status)
                },
            ))
            .wrap(),
        );
        badge(ui, status);
    });
}
fn card(
    ui: &mut egui::Ui,
    width: f32,
    height: f32,
    (title, progress): (&str, f32),
    accent: Color32,
    header: impl FnOnce(&mut egui::Ui),
    body: impl FnOnce(&mut egui::Ui),
) {
    let frame = egui::Frame::NONE
        .fill(Color32::from_rgba_unmultiplied(12, 29, 45, 238))
        .stroke(Stroke::new(1.0, Color32::from_rgb(75, 116, 137)))
        .corner_radius(12)
        .inner_margin(18);
    let margins = frame.total_margin().sum();
    // Reserve the complete card throughout the animation so text never reflows.
    let rect = egui::Rect::from_min_size(ui.next_widget_position(), Vec2::new(width, height));
    let mut reveal = rect;
    reveal.max.y = rect.top() + height * progress;
    ui.scope(|ui| {
        ui.set_clip_rect(ui.clip_rect().intersect(reveal));
        if progress == 0.0 {
            ui.set_invisible();
        }
        frame.show(ui, |ui| {
            ui.set_width(width - margins.x);
            ui.set_min_height(height - margins.y);
            ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
                let top = ui.cursor().top();
                ui.add(
                    egui::Label::new(RichText::new(title).size(20.0).strong().color(accent)).wrap(),
                );
                ui.separator();
                header(ui);
                let body_height = (height - margins.y - (ui.cursor().top() - top) - 26.0).max(0.0);
                egui::ScrollArea::vertical()
                    .id_salt(title)
                    .auto_shrink([false, false])
                    .max_height(body_height)
                    .min_scrolled_height(0.0)
                    .show(ui, |ui| {
                        ui.set_width(width - margins.x - 12.0);
                        body(ui);
                    });
                text(ui, "Scroll for full report details", 13.0, LABEL);
            });
        });
        if progress > 0.0 && progress < 1.0 {
            let edge = [
                egui::pos2(rect.left() + 12.0, reveal.bottom() - 1.0),
                egui::pos2(rect.right() - 12.0, reveal.bottom() - 1.0),
            ];
            let glow = (std::f32::consts::PI * progress).sin();
            ui.painter()
                .line_segment(edge, Stroke::new(5.0, accent.gamma_multiply(0.08 * glow)));
            ui.painter()
                .line_segment(edge, Stroke::new(1.0, accent.gamma_multiply(0.45 * glow)));
        }
    });
}

#[cfg(test)]
#[path = "signoff_cards_tests.rs"]
mod tests;
#[cfg(all(test, target_os = "linux"))]
#[path = "signoff_visual_test.rs"]
mod visual_test;
