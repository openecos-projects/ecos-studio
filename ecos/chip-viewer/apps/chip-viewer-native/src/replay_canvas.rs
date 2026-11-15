use super::ReplayApp;
use egui::{Color32, Pos2, Rect, Sense, Stroke};

impl ReplayApp {
    pub(super) fn canvas(&mut self, ui: &mut egui::Ui) {
        let (rect, response) = ui.allocate_exact_size(ui.available_size(), Sense::hover());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, Color32::from_rgb(12, 18, 24));
        let Some(recording) = &self.recording else {
            painter.text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                if self.error.is_empty() {
                    &self.catalog.steps[self.step].reason
                } else {
                    &self.error
                },
                egui::FontId::proportional(15.0),
                Color32::LIGHT_GRAY,
            );
            return;
        };
        let scene = &recording.scene;
        let Some(die) = scene.objects.get("die") else {
            painter.text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                "Waiting for the first captured layout",
                egui::FontId::proportional(15.0),
                Color32::LIGHT_GRAY,
            );
            return;
        };
        if response.hovered() {
            self.zoom = (self.zoom * ui.input(|i| i.zoom_delta())).clamp(0.2, 8.0);
        }
        let [lx, ly, hx, hy] = die.bbox;
        let scale = ((rect.width() - 60.0) / (hx - lx).max(1) as f32)
            .min((rect.height() - 60.0) / (hy - ly).max(1) as f32)
            * self.zoom;
        let project = |x: i64, y: i64| {
            Pos2::new(
                rect.center().x + (x as f64 - (lx as f64 + hx as f64) / 2.0) as f32 * scale,
                rect.center().y - (y as f64 - (ly as f64 + hy as f64) / 2.0) as f32 * scale,
            )
        };
        for (id, obj) in &scene.objects {
            let fraction = self.reveal.fraction(id);
            if fraction <= 0.0 {
                continue;
            }
            let [x1, y1, x2, y2] = self.motion.bounds(id, self.reveal.bounds(id, obj));
            let bounds = Rect::from_two_pos(project(x1, y1), project(x2, y2));
            let color = match obj.kind.as_str() {
                "macro" => Color32::from_rgb(124, 151, 214),
                "pdn" => Color32::from_rgb(177, 143, 88),
                "wire" => route_layer_color(&obj.layer),
                "via" => Color32::from_rgb(255, 211, 112),
                "pin" => Color32::from_rgb(112, 219, 198),
                "row" => Color32::from_rgb(36, 64, 54),
                "track_grid" => Color32::from_rgb(75, 89, 105),
                "die" => Color32::from_rgb(131, 193, 234),
                "core" => Color32::from_rgb(218, 175, 107),
                _ => Color32::from_rgb(70, 147, 129),
            }
            .gamma_multiply(fraction);
            if matches!(obj.kind.as_str(), "die" | "core") {
                outline(&painter, bounds, Stroke::new(1.5, color), fraction);
                continue;
            }
            if !matches!(obj.kind.as_str(), "die" | "core" | "row" | "halo") {
                painter.rect_filled(bounds, 0.0, color);
            }
            let changed =
                scene.touched.contains(id) && matches!(obj.kind.as_str(), "macro" | "instance");
            painter.rect_stroke(
                bounds,
                0.0,
                Stroke::new(
                    if changed { 1.2 } else { 0.5 },
                    if changed {
                        Color32::from_rgb(255, 157, 185).gamma_multiply(fraction)
                    } else {
                        color
                    },
                ),
                egui::StrokeKind::Inside,
            );
        }
        if self.complete {
            self.maps.paint(&painter, project);
        }
        // Draw highlights last so PDN geometry and heatmaps cannot obscure them.
        for id in &scene.touched {
            if let Some(obj) = scene.objects.get(id) {
                let fraction = self.reveal.fraction(id);
                if fraction <= 0.0 {
                    continue;
                }
                let [x1, y1, x2, y2] = self.motion.bounds(id, self.reveal.bounds(id, obj));
                painter.rect_stroke(
                    Rect::from_two_pos(project(x1, y1), project(x2, y2)),
                    0.0,
                    Stroke::new(
                        1.2,
                        Color32::from_rgb(255, 157, 185).gamma_multiply(fraction),
                    ),
                    egui::StrokeKind::Inside,
                );
            }
        }
    }
}

fn route_layer_color(layer: &str) -> Color32 {
    const PALETTE: [Color32; 6] = [
        Color32::from_rgb(73, 183, 217),
        Color32::from_rgb(239, 126, 101),
        Color32::from_rgb(144, 194, 104),
        Color32::from_rgb(204, 144, 220),
        Color32::from_rgb(232, 192, 93),
        Color32::from_rgb(93, 145, 232),
    ];
    let index = layer.parse::<usize>().map_or_else(
        |_| layer.bytes().fold(0usize, |sum, byte| sum + byte as usize),
        |id| id,
    ) % PALETTE.len();
    PALETTE[index]
}

fn outline(painter: &egui::Painter, rect: Rect, stroke: Stroke, fraction: f32) {
    let corners = [
        rect.left_top(),
        rect.right_top(),
        rect.right_bottom(),
        rect.left_bottom(),
        rect.left_top(),
    ];
    let mut length = 2.0 * (rect.width() + rect.height()) * fraction;
    for pair in corners.windows(2) {
        let edge = pair[1] - pair[0];
        let size = edge.length();
        if length <= 0.0 {
            break;
        }
        painter.line_segment(
            [
                pair[0],
                pair[0] + edge * (length / size.max(0.001)).min(1.0),
            ],
            stroke,
        );
        length -= size;
    }
}
