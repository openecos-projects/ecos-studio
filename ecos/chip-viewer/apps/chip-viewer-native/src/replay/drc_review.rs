//! A layer-ordered review of frozen DRC results, not simulated tool timestamps.
use super::{
    data::Recording,
    index::SceneIndex,
    layer_focus::{self, RoutingLayer, Style, Transition},
};
use chipgeom_format::replay_analysis::Item;
use egui::{Color32, Pos2, Rect, Stroke};
use std::{cell::RefCell, sync::Arc};

#[derive(Clone, Copy, Debug)]
pub struct Scan {
    pub layer: usize,
    pub height: f32,
    pub transition: Transition,
    pub restoring: bool,
}

#[derive(Default)]
pub struct DrcReview {
    pub layers: Vec<RoutingLayer>,
    mesh: RefCell<Option<LayerMesh>>,
}
struct LayerMesh {
    key: (usize, Rect, [i64; 4]),
    mesh: Arc<egui::Mesh>,
    limited: bool,
}

pub fn duration(layer_count: usize) -> f64 {
    if layer_count == 0 {
        return super::plan::MAP_SECONDS;
    }
    (layer_count as f64 * 0.9).clamp(2.0, 10.0) + 1.0
}

impl DrcReview {
    pub fn open(record: &Recording) -> anyhow::Result<Self> {
        Ok(Self {
            layers: layer_focus::routing_layers(record)?,
            ..Self::default()
        })
    }
    pub fn scan(&self, progress: f32) -> Option<Scan> {
        if self.layers.is_empty() || progress >= 1.0 {
            return None;
        }
        let seconds = f64::from(progress.max(0.0)) * duration(self.layers.len());
        let sweep = duration(self.layers.len()) - 1.0;
        let slot = sweep / self.layers.len() as f64;
        let index = ((seconds / slot) as usize).min(self.layers.len() - 1);
        let layer = &self.layers[index];
        // Include the connecting cut interval, without exposing the next metal.
        let lower = if index == 0 {
            layer.z0
        } else {
            self.layers[index - 1].z1 + 0.01
        };
        let focused = Style {
            classes: [0.3, 0.15, 1.0, 1.0],
            band: [lower, layer.z1, 0.18, 0.0],
        };
        if seconds >= sweep {
            return Some(Scan {
                layer: index,
                height: layer.z1,
                transition: Transition::between(
                    focused,
                    Style::default(),
                    ((seconds - sweep) / 0.5) as f32,
                ),
                restoring: true,
            });
        }
        let previous = if index == 0 {
            Style::default()
        } else {
            let prior = &self.layers[index - 1];
            Style {
                classes: focused.classes,
                band: [
                    if index < 2 {
                        prior.z0
                    } else {
                        self.layers[index - 2].z1 + 0.01
                    },
                    prior.z1,
                    0.18,
                    0.0,
                ],
            }
        };
        let fraction = ((seconds - index as f64 * slot) / (slot * 0.4).min(0.3)) as f32;
        let start_z = if index == 0 {
            layer.z0
        } else {
            self.layers[index - 1].z1
        };
        Some(Scan {
            layer: index,
            height: start_z + (layer.z1 - start_z) * layer_focus::smooth(fraction),
            transition: Transition::between(previous, focused, fraction),
            restoring: false,
        })
    }

    pub fn layer_for_item(&self, item: &Item) -> Option<usize> {
        let value = item
            .details
            .get("layer")
            .or_else(|| item.details.get("layer_name"))
            .or_else(|| item.details.get("layer_id"))?;
        self.layers.iter().position(|layer| match value {
            serde_json::Value::String(name) => name == &layer.name,
            serde_json::Value::Number(id) => id.as_u64() == Some(u64::from(layer.id)),
            _ => false,
        })
    }

    pub fn paint_items(
        &self,
        painter: &egui::Painter,
        project: &impl Fn(i64, i64, Option<u16>) -> Pos2,
        items: &[Item],
        progress: f32,
        selected: Option<usize>,
    ) {
        let scan = self.scan(progress);
        for (i, item) in items.iter().enumerate() {
            if selected.is_some_and(|s| s != i) {
                continue;
            }
            let layer = self.layer_for_item(item);
            if scan.is_some_and(|s| !s.restoring && layer != Some(s.layer)) {
                continue;
            }
            // Unassigned markers remain in 2D/report, never guessed onto a metal.
            for b in &item.bboxes {
                let id = layer.map(|i| self.layers[i].id);
                let p = [
                    project(b[0], b[1], id),
                    project(b[2], b[1], id),
                    project(b[2], b[3], id),
                    project(b[0], b[3], id),
                    project(b[0], b[1], id),
                ];
                painter.add(egui::Shape::line(
                    p.to_vec(),
                    Stroke::new(1.8, Color32::from_rgb(255, 100, 113)),
                ));
            }
        }
    }

    pub fn paint_2d(
        &self,
        painter: &egui::Painter,
        project: &impl Fn(i64, i64) -> Pos2,
        scene: &SceneIndex,
        viewport: [i64; 4],
        scan: Scan,
    ) {
        if scan.restoring {
            return;
        }
        let layer = &self.layers[scan.layer];
        let key = (scan.layer, painter.clip_rect(), viewport);
        let mut cached = self.mesh.borrow_mut();
        if cached.as_ref().is_none_or(|m| m.key != key) {
            let mut mesh = egui::Mesh::default();
            let mut count = 0;
            let numeric = layer.id.to_string();
            for (_, object) in scene.visible(viewport).filter(|(_, o)| {
                (o.layer == layer.name || o.layer == numeric)
                    && matches!(layer_focus::class(o), 2 | 3)
            }) {
                if count == 80_000 {
                    break;
                }
                let b = object.bbox;
                let r = Rect::from_two_pos(project(b[0], b[1]), project(b[2], b[3]));
                mesh.add_colored_rect(r.expand(0.35), Color32::from_rgb(89, 204, 232));
                count += 1;
            }
            *cached = Some(LayerMesh {
                key,
                mesh: Arc::new(mesh),
                limited: count == 80_000,
            });
        }
        let mesh = cached.as_ref().unwrap();
        painter.add(egui::Shape::Mesh(mesh.mesh.clone()));
        if mesh.limited {
            painter.text(
                painter.clip_rect().left_bottom() + egui::vec2(8.0, -8.0),
                egui::Align2::LEFT_BOTTOM,
                "Layer overview · zoom to inspect",
                egui::FontId::proportional(11.0),
                Color32::GRAY,
            );
        }
    }

    pub fn caption(&self, scan: Scan) -> String {
        if scan.restoring {
            "DRC result review · restoring all layers".into()
        } else {
            format!(
                "DRC layer review · {} · {}/{}",
                self.layers[scan.layer].name,
                scan.layer + 1,
                self.layers.len()
            )
        }
    }
}

#[cfg(test)]
#[path = "drc_review_tests.rs"]
mod tests;
