//! Centered signoff summaries shown after Harden replay completes.
use super::dashboard::{ChecklistSummary, DesignSummary, QorSummary, SignoffSummary};
use egui::{Align2, Color32, FontId, Id, Order, RichText, Stroke, Vec2};

const ACCENT: Color32 = Color32::from_rgb(111, 223, 209);
const TEXT: Color32 = Color32::from_rgb(235, 243, 248);
const MUTED: Color32 = Color32::from_rgb(165, 184, 199);

pub fn show(ctx: &egui::Context, summary: &SignoffSummary) -> egui::Response {
    let screen = ctx.screen_rect();
    let width = (screen.width() - 56.0).clamp(1.0, 1180.0);
    let layer = egui::LayerId::new(Order::Foreground, Id::new("replay_signoff_scrim"));
    ctx.layer_painter(layer).rect_filled(
        screen,
        0.0,
        Color32::from_rgba_unmultiplied(5, 12, 22, 72),
    );

    egui::Area::new(Id::new("replay_signoff_cards"))
        .order(Order::Foreground)
        .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
        .constrain_to(screen)
        .show(ctx, |ui| {
            ui.set_width(width);
            ui.vertical_centered(|ui| {
                ui.label(
                    RichText::new("SIGNOFF / HARDEN COMPLETE")
                        .strong()
                        .size(14.0)
                        .color(ACCENT),
                );
            });
            ui.add_space(14.0);
            egui::ScrollArea::horizontal()
                .id_salt("replay_signoff_card_row")
                .auto_shrink([false, true])
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        let gap = 16.0;
                        ui.spacing_mut().item_spacing.x = gap;
                        let card_width = ((width - gap * 2.0) / 3.0).clamp(160.0, 360.0);
                        card(
                            ui,
                            card_width,
                            "01 / DESIGN",
                            status_color(&summary.design.harden_state),
                            design_lines(&summary.design),
                        );
                        card(
                            ui,
                            card_width,
                            "02 / QOR",
                            status_color(&summary.qor.scalar_status),
                            qor_lines(&summary.qor),
                        );
                        card(
                            ui,
                            card_width,
                            "03 / CHECKLIST",
                            status_color(&summary.checklist.status),
                            checklist_lines(&summary.checklist),
                        );
                    });
                });
        })
        .response
}

fn card(ui: &mut egui::Ui, width: f32, title: &str, accent: Color32, lines: Vec<(String, String)>) {
    let frame = egui::Frame::NONE
        .fill(Color32::from_rgba_unmultiplied(12, 28, 44, 210))
        .stroke(Stroke::new(
            1.0,
            Color32::from_rgba_unmultiplied(111, 223, 209, 120),
        ))
        .corner_radius(10)
        .inner_margin(18);
    let content_width = width - frame.total_margin().sum().x;
    frame.show(ui, |ui| {
        ui.set_width(content_width);
        ui.set_min_height(240.0);
        ui.horizontal(|ui| {
            ui.painter().rect_filled(
                egui::Rect::from_min_size(ui.cursor().min, Vec2::new(3.0, 17.0)),
                1.0,
                accent,
            );
            ui.add_space(9.0);
            ui.label(RichText::new(title).strong().size(12.0).color(TEXT));
        });
        ui.add_space(14.0);
        for (index, (label, value)) in lines.into_iter().enumerate() {
            if index > 0 {
                ui.add_space(8.0);
            }
            ui.label(RichText::new(label).small().color(MUTED));
            ui.add(
                egui::Label::new(
                    RichText::new(&value)
                        .font(FontId::proportional(if index == 0 { 26.0 } else { 13.0 }))
                        .color(if index == 0 { accent } else { TEXT }),
                )
                .truncate(),
            )
            .on_hover_text(value);
        }
    });
}

fn status_color(status: &str) -> Color32 {
    match status.to_ascii_lowercase().as_str() {
        "pass" | "passed" | "ready" | "success" | "green" => ACCENT,
        "attention" | "warning" | "orange" | "yellow" => Color32::from_rgb(247, 191, 105),
        "blocked" | "failed" | "fail" | "red" => Color32::from_rgb(247, 125, 139),
        _ => MUTED,
    }
}

fn design_lines(summary: &DesignSummary) -> Vec<(String, String)> {
    vec![
        ("Design".into(), value_or_na(&summary.name)),
        ("Top module".into(), value_or_na(&summary.top_module)),
        ("PDK".into(), value_or_na(&summary.pdk)),
        ("Harden".into(), value_or_unavailable(&summary.harden_state)),
    ]
}

fn qor_lines(summary: &QorSummary) -> Vec<(String, String)> {
    vec![
        (
            "Final score".into(),
            summary
                .score
                .map_or_else(|| "N/A".into(), |score| format!("{score:.1} / 100")),
        ),
        (
            "Scalar status".into(),
            value_or_unavailable(&summary.scalar_status),
        ),
        (
            "Feasibility".into(),
            value_or_unavailable(&summary.feasibility_status),
        ),
        ("Gates".into(), value_or_na(&summary.gate_summary)),
    ]
}

fn checklist_lines(summary: &ChecklistSummary) -> Vec<(String, String)> {
    vec![
        ("Status".into(), value_or_unavailable(&summary.status)),
        (
            "Passed".into(),
            format!(
                "{}   ·   attention {}",
                count_or_na(summary.passed),
                count_or_na(summary.attention)
            ),
        ),
        (
            "Blocked".into(),
            format!(
                "{}   ·   unavailable {}",
                count_or_na(summary.blocked),
                count_or_na(summary.unavailable)
            ),
        ),
        (
            "Total checks".into(),
            count_or_na(
                [
                    summary.passed,
                    summary.attention,
                    summary.blocked,
                    summary.unavailable,
                ]
                .into_iter()
                .try_fold(0usize, |total, count| total.checked_add(count?)),
            ),
        ),
    ]
}

fn count_or_na(value: Option<usize>) -> String {
    value.map_or_else(|| "N/A".into(), |count| count.to_string())
}

fn value_or_na(value: &str) -> String {
    if value.trim().is_empty() {
        "N/A".into()
    } else {
        value.into()
    }
}

fn value_or_unavailable(value: &str) -> String {
    if value.trim().is_empty() {
        "Unavailable".into()
    } else {
        value.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cards_stay_centered_in_the_full_window_at_desktop_and_small_sizes() {
        for size in [Vec2::new(1440.0, 900.0), Vec2::new(640.0, 480.0)] {
            let content_width = (size.x - 56.0).clamp(1.0, 1180.0);
            let card_width = ((content_width - 32.0) / 3.0).clamp(160.0, 360.0);
            assert!(3.0 * card_width + 32.0 <= content_width);
            let ctx = egui::Context::default();
            let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, size);
            let mut bounds = egui::Rect::NOTHING;
            // Areas measure themselves on the first frame and use that size for
            // anchoring. Include panels to catch centering against leftover space.
            for _ in 0..3 {
                let _ = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(screen),
                        ..Default::default()
                    },
                    |ctx| {
                        egui::TopBottomPanel::bottom("timeline")
                            .exact_height(160.0)
                            .show(ctx, |_| {});
                        bounds = show(ctx, &SignoffSummary::default()).rect;
                    },
                );
            }
            assert!(screen.contains_rect(bounds), "{screen:?}: {bounds:?}");
            assert!(
                bounds.center().distance(screen.center()) < 1.0,
                "{screen:?}: {bounds:?}"
            );
        }
    }
}
