//! Frame-local router observations, separate from completion-only analysis.
use chipgeom_format::replay::{Object, Scene};
use egui::{Color32, Painter, Pos2, Rect, Stroke};
use std::{collections::BTreeMap, sync::Arc};

#[derive(Default)]
pub struct RouteOverlay {
    layers: BTreeMap<String, Vec<Arc<Object>>>,
    regions: Vec<Arc<Object>>,
    layer: String,
    mode: usize,
    manual_metric: bool,
    visible: bool,
}

impl RouteOverlay {
    pub fn from_scene(scene: &Scene) -> Self {
        let mut layers: BTreeMap<String, Vec<Arc<Object>>> = BTreeMap::new();
        let mut regions = Vec::new();
        for object in scene.objects.values() {
            if object.kind == "route_region" {
                regions.push(object.clone());
            }
            if matches!(object.kind.as_str(), "route_congestion" | "route_violation") {
                layers
                    .entry(object.layer.clone())
                    .or_default()
                    .push(object.clone());
            }
        }
        let layer = ["overflow", "demand", "capacity"]
            .iter()
            .find_map(|field| {
                layers
                    .iter()
                    .find(|(_, objects)| {
                        objects.iter().any(|object| {
                            object
                                .attributes
                                .get(*field)
                                .and_then(|v| v.as_f64())
                                .is_some_and(|v| v > 0.0)
                        })
                    })
                    .map(|(layer, _)| layer.clone())
            })
            .or_else(|| layers.keys().next().cloned())
            .unwrap_or_default();
        let mode = ["overflow", "demand", "capacity"]
            .iter()
            .position(|field| {
                layers.get(&layer).is_some_and(|objects| {
                    objects.iter().any(|object| {
                        object
                            .attributes
                            .get(*field)
                            .and_then(|v| v.as_f64())
                            .is_some_and(|v| v > 0.0)
                    })
                })
            })
            .unwrap_or(0);
        Self {
            layers,
            regions,
            layer,
            mode,
            manual_metric: false,
            visible: true,
        }
    }

    pub fn inherit_selection(&mut self, previous: &Self) {
        if self.layers.contains_key(&previous.layer) {
            self.layer.clone_from(&previous.layer);
        }
        if previous.manual_metric {
            self.mode = previous.mode;
            self.manual_metric = true;
        }
        self.visible =
            previous.visible || (previous.layers.is_empty() && previous.regions.is_empty());
    }

    pub fn context_opacity(&self) -> f32 {
        if self.visible && (!self.layers.is_empty() || !self.regions.is_empty()) {
            0.4
        } else {
            1.0
        }
    }

    pub fn controls(&mut self, ui: &mut egui::Ui) {
        if self.layers.is_empty() && self.regions.is_empty() {
            return;
        }
        ui.separator();
        ui.checkbox(&mut self.visible, "Routing process overlay");
        ui.small("Captured at this frame · router observations, not signoff");
        if !self.regions.is_empty() {
            let active = self
                .regions
                .iter()
                .filter(|r| r.attributes.get("active").and_then(|v| v.as_bool()) == Some(true))
                .count();
            ui.small(format!(
                "Partition: {} boxes · {} active in this batch",
                self.regions.len(),
                active
            ));
        }
        if self.layers.is_empty() {
            return;
        }
        egui::ComboBox::from_id_salt("route_process_layer")
            .selected_text(&self.layer)
            .show_ui(ui, |ui| {
                for layer in self.layers.keys() {
                    ui.selectable_value(&mut self.layer, layer.clone(), layer);
                }
            });
        ui.horizontal(|ui| {
            for (mode, label) in ["Overflow", "Demand", "Capacity"].iter().enumerate() {
                self.manual_metric |= ui.selectable_value(&mut self.mode, mode, *label).changed();
            }
        });
        if let Some(objects) = self.layers.get(&self.layer) {
            let violations = objects
                .iter()
                .filter(|o| o.kind == "route_violation")
                .count();
            ui.small(format!(
                "{} samples · {} violations · gray = zero capacity",
                objects.len(),
                violations
            ));
        }
    }

    pub fn visit_3d(&self, mut emit: impl FnMut(&Object, Color32, bool)) {
        if !self.visible {
            return;
        }
        for object in &self.regions {
            let active = object.attributes.get("active").and_then(|v| v.as_bool()) == Some(true);
            emit(
                object,
                if active {
                    Color32::from_rgb(90, 220, 245)
                } else {
                    Color32::from_rgba_unmultiplied(160, 190, 210, 90)
                },
                false,
            );
        }
        let Some(objects) = self.layers.get(&self.layer) else {
            return;
        };
        let field = ["overflow", "demand", "capacity"][self.mode];
        let max = objects
            .iter()
            .filter_map(|o| o.attributes.get(field)?.as_f64())
            .fold(1.0, f64::max);
        for object in objects {
            if object.kind == "route_violation" {
                emit(object, Color32::LIGHT_RED, false);
            } else if object.attributes.get("blocked").and_then(|v| v.as_bool()) == Some(true) {
                emit(
                    object,
                    Color32::from_rgba_unmultiplied(140, 140, 140, 40),
                    true,
                );
            } else {
                let ratio = (object
                    .attributes
                    .get(field)
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)
                    / max)
                    .clamp(0.0, 1.0) as f32;
                if ratio > 0.0 {
                    emit(
                        object,
                        Color32::from_rgba_unmultiplied(
                            (70.0 + 185.0 * ratio) as u8,
                            (190.0 - 110.0 * ratio) as u8,
                            80,
                            85,
                        ),
                        true,
                    );
                }
            }
        }
    }

    pub fn paint(&self, painter: &Painter, project: &impl Fn(i64, i64) -> Pos2) {
        if !self.visible {
            return;
        }
        for region in &self.regions {
            let [lx, ly, hx, hy] = region.bbox;
            let rect = Rect::from_two_pos(project(lx, ly), project(hx, hy));
            if !rect.intersects(painter.clip_rect()) {
                continue;
            }
            let active = region.attributes.get("active").and_then(|v| v.as_bool()) == Some(true);
            if active {
                painter.rect_filled(rect, 0.0, Color32::from_rgba_unmultiplied(70, 205, 240, 22));
            }
            painter.rect_stroke(
                rect,
                0.0,
                Stroke::new(
                    if active { 1.7 } else { 0.6 },
                    if active {
                        Color32::from_rgb(90, 220, 245)
                    } else {
                        Color32::from_rgba_unmultiplied(160, 190, 210, 90)
                    },
                ),
                egui::StrokeKind::Inside,
            );
        }
        let Some(objects) = self.layers.get(&self.layer) else {
            return;
        };
        let field = ["overflow", "demand", "capacity"][self.mode];
        let max = objects
            .iter()
            .filter_map(|o| o.attributes.get(field)?.as_f64())
            .fold(1.0, f64::max);
        for object in objects {
            let [lx, ly, hx, hy] = object.bbox;
            let rect = Rect::from_two_pos(project(lx, ly), project(hx, hy));
            if !rect.intersects(painter.clip_rect()) {
                continue;
            }
            if object.kind == "route_congestion" && rect.width() >= 4.0 && rect.height() >= 4.0 {
                painter.rect_stroke(
                    rect,
                    0.0,
                    Stroke::new(0.5, Color32::from_rgba_unmultiplied(140, 170, 195, 65)),
                    egui::StrokeKind::Inside,
                );
            }
            if object.kind == "route_violation" {
                painter.rect_stroke(
                    rect.expand(1.0),
                    0.0,
                    Stroke::new(1.5, Color32::LIGHT_RED),
                    egui::StrokeKind::Outside,
                );
            } else if object.attributes.get("blocked").and_then(|v| v.as_bool()) == Some(true) {
                painter.rect_filled(
                    rect,
                    0.0,
                    Color32::from_rgba_unmultiplied(140, 140, 140, 40),
                );
            } else {
                let value = object
                    .attributes
                    .get(field)
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let ratio = (value / max).clamp(0.0, 1.0) as f32;
                if ratio > 0.0 {
                    painter.rect_filled(
                        rect,
                        0.0,
                        Color32::from_rgba_unmultiplied(
                            (70.0 + 185.0 * ratio) as u8,
                            (190.0 - 110.0 * ratio) as u8,
                            80,
                            85,
                        ),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn process_layers_are_reconstructed_from_current_scene_only() {
        let scene = Scene { objects: serde_json::from_value(serde_json::json!({
            "wire":{"kind":"wire","layer":"M1","bbox":[0,0,10,2]},
            "a":{"kind":"route_congestion","layer":"M2","bbox":[0,0,10,10],"capacity":0,"blocked":true},
            "b":{"kind":"route_violation","layer":"V1","bbox":[1,1,2,2]}
        })).unwrap(), ..Default::default() };
        let overlay = RouteOverlay::from_scene(&scene);
        assert_eq!(
            overlay
                .layers
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["M2", "V1"]
        );
        assert!(RouteOverlay::from_scene(&Scene::default())
            .layers
            .is_empty());
    }
    #[test]
    fn partition_and_supply_are_visible_before_any_routing_demand() {
        let scene = Scene { objects: serde_json::from_value(serde_json::json!({
            "box":{"kind":"route_region","bbox":[0,0,10,10],"active":true},
            "edge":{"kind":"route_congestion","layer":"M2","bbox":[0,0,10,10],"demand":0,"capacity":12,"overflow":0}
        })).unwrap(), ..Default::default() };
        let overlay = RouteOverlay::from_scene(&scene);
        assert_eq!(
            (overlay.regions.len(), overlay.layer.as_str(), overlay.mode),
            (1, "M2", 2)
        );
    }
}
