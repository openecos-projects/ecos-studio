//! Logical synthesis snapshots, grouped by cell type; never presented as placement.
use crate::replay::data::{read, Recording};
use egui::{Color32, Pos2, Rect, Stroke, Vec2};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Default, Deserialize)]
pub struct Logic {
    cell_count: usize,
    net_count: usize,
    cell_types: BTreeMap<String, usize>,
    connections: Vec<Connection>,
}
#[derive(Deserialize)]
struct Connection {
    source: String,
    target: String,
    count: usize,
}

pub fn load(recording: &Recording) -> anyhow::Result<Option<Logic>> {
    let Some(index) = recording.scene.revision else {
        return Ok(None);
    };
    recording.manifest.frames[..=index]
        .iter()
        .rev()
        .find_map(|f| f.logical.as_ref())
        .map(|path| read(&recording.asset(path)?))
        .transpose()
}

impl Logic {
    pub fn show(&self, ui: &mut egui::Ui) {
        ui.heading("Logical netlist");
        ui.label(format!(
            "{} cells · {} nets · connections grouped by cell type",
            self.cell_count, self.net_count
        ));
        let columns = ((ui.available_width() / 170.0) as usize).max(1);
        let rows = self.cell_types.len().div_ceil(columns).max(1);
        egui::ScrollArea::both().show(ui, |ui| {
            let (rect, _) = ui.allocate_exact_size(
                Vec2::new((columns * 170) as f32, (rows * 80) as f32),
                egui::Sense::hover(),
            );
            let positions: BTreeMap<_, _> = self
                .cell_types
                .keys()
                .enumerate()
                .map(|(i, name)| {
                    (
                        name,
                        Pos2::new(
                            rect.left() + (i % columns) as f32 * 170.0 + 80.0,
                            rect.top() + (i / columns) as f32 * 80.0 + 38.0,
                        ),
                    )
                })
                .collect();
            let painter = ui.painter_at(rect);
            for edge in &self.connections {
                if edge.source == edge.target {
                    continue;
                }
                if let (Some(a), Some(b)) =
                    (positions.get(&edge.source), positions.get(&edge.target))
                {
                    painter.line_segment(
                        [*a, *b],
                        Stroke::new(
                            (edge.count as f32).ln_1p().clamp(0.5, 3.0),
                            Color32::from_rgb(55, 95, 116),
                        ),
                    );
                }
            }
            for (name, count) in &self.cell_types {
                let point = positions[name];
                let bounds = Rect::from_center_size(point, Vec2::new(154.0, 52.0));
                painter.rect_filled(bounds, 6.0, Color32::from_rgb(35, 62, 75));
                painter.rect_stroke(
                    bounds,
                    6.0,
                    Stroke::new(1.0, Color32::from_rgb(100, 190, 201)),
                    egui::StrokeKind::Inside,
                );
                let text = if name.chars().count() > 23 {
                    format!("{}…", name.chars().take(22).collect::<String>())
                } else {
                    name.clone()
                };
                painter.text(
                    point,
                    egui::Align2::CENTER_CENTER,
                    format!("{text}\n{count}"),
                    egui::FontId::proportional(11.0),
                    Color32::WHITE,
                );
            }
        });
    }
}
