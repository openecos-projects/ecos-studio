//! Compact completion metrics attached to the existing 2D explanation.
use egui::{Align2, Color32, FontId, Pos2, Rect, Stroke};
use serde_json::Value;

pub fn height(metrics: &[Value]) -> f32 {
    if metrics.is_empty() {
        46.0
    } else {
        25.0 + metrics.len().div_ceil(3) as f32 * 44.0
    }
}
pub fn paint(ui: &egui::Ui, rect: Rect, metrics: &[Value]) {
    let painter = ui.painter().with_clip_rect(rect);
    let accent = Color32::from_rgb(111, 223, 209);
    painter.line_segment(
        [rect.left_top(), rect.right_top()],
        Stroke::new(1.0, Color32::from_rgba_unmultiplied(111, 223, 209, 85)),
    );
    painter.text(
        rect.min + egui::vec2(0.0, 7.0),
        Align2::LEFT_TOP,
        "STEP RESULTS",
        FontId::proportional(10.0),
        accent,
    );
    if metrics.is_empty() {
        painter.text(
            rect.min + egui::vec2(0.0, 24.0),
            Align2::LEFT_TOP,
            "No key metrics recorded",
            FontId::proportional(11.0),
            Color32::GRAY,
        );
        return;
    }
    let width = rect.width() / 3.0;
    for (i, metric) in metrics.iter().enumerate() {
        let at = rect.min + egui::vec2((i % 3) as f32 * width, 24.0 + (i / 3) as f32 * 44.0);
        let region = Rect::from_min_size(at, egui::vec2(width - 8.0, 40.0));
        let painter = painter.with_clip_rect(region);
        let name = metric["display_name"]
            .as_str()
            .or(metric["id"].as_str())
            .unwrap_or("Metric");
        let text = |pos: Pos2, label: &str, size: f32, color: Color32| {
            let mut job = egui::text::LayoutJob::simple(
                label.into(),
                FontId::proportional(size),
                color,
                width - 8.0,
            );
            job.wrap.max_rows = 1;
            let galley = ui.fonts(|f| f.layout_job(job));
            painter.galley(pos, galley, color);
        };
        text(at, name, 10.0, Color32::from_rgb(165, 184, 199));
        text(
            at + egui::vec2(0.0, 13.0),
            &value(metric),
            13.0,
            Color32::from_rgb(235, 243, 248),
        );
        if let Some((delta, _)) = crate::replay::metrics::comparison(metric) {
            text(
                at + egui::vec2(0.0, 29.0),
                &format!("Δ {delta:+.3}"),
                10.0,
                accent,
            );
        }
        ui.interact(
            region,
            ui.id().with(("completion_metric", i)),
            egui::Sense::hover(),
        )
        .on_hover_text(serde_json::to_string_pretty(metric).unwrap_or_default());
    }
}
fn value(metric: &Value) -> String {
    let mut unit = metric["unit"].as_str().unwrap_or("").to_string();
    let value = if let Some(n) = metric["value"].as_f64() {
        if unit == "ratio" {
            unit = "%".into();
            format!("{:.2}", n * 100.0)
        } else if n != 0.0 && (n.abs() < 0.001 || n.abs() >= 1e7) {
            format!("{n:.2e}")
        } else if n.fract() == 0.0 {
            format!("{n:.0}")
        } else {
            format!("{n:.3}")
        }
    } else if let Some(value) = metric["value"].as_bool() {
        if value { "Yes" } else { "No" }.into()
    } else {
        metric["value"].as_str().unwrap_or("N/A").into()
    };
    if unit == "count" {
        unit.clear();
    }
    format!("{value} {unit}").trim().into()
}
