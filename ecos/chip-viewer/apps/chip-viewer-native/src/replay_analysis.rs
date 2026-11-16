//! Resolve frozen reports once against the final scene, then paint bounded overlays.
use crate::replay_data::{read, Recording};
use chipgeom_format::replay::Scene;
use chipgeom_format::replay_analysis::{Analysis, Item};
use egui::{Color32, Pos2, Rect, Stroke};
use std::collections::BTreeMap;

#[derive(Default)]
struct Geometry {
    boxes: Vec<[i64; 4]>,
    points: Vec<Option<[i64; 2]>>,
    missing: usize,
    positions: Vec<[i64; 2]>,
    segments: Vec<[[i64; 2]; 2]>,
}

#[derive(Default)]
pub struct ReplayAnalysis {
    data: Analysis,
    geometry: Vec<Vec<Geometry>>,
    pub selected: Option<usize>,
    item: Option<usize>,
    progress: f32,
    pub error: String,
}

impl ReplayAnalysis {
    pub fn open(recording: &Recording) -> Self {
        let loaded = (|| -> anyhow::Result<Analysis> {
            let Some(path) = &recording.manifest.analysis else {
                return Ok(Analysis::default());
            };
            let data: Analysis = read(&recording.asset(path)?)?;
            anyhow::ensure!(
                data.schema == "ecos.replay.analysis.v1",
                "Unsupported analysis schema"
            );
            anyhow::ensure!(
                data.views.iter().all(|v| v.basis == "final"),
                "Analysis basis mismatch"
            );
            for view in &data.views {
                for item in &view.items {
                    anyhow::ensure!(
                        item.bboxes.iter().all(|b| b[0] <= b[2] && b[1] <= b[3]),
                        "Invalid analysis bounds"
                    );
                    anyhow::ensure!(
                        item.value.is_none_or(f64::is_finite),
                        "Invalid analysis value"
                    );
                }
            }
            Ok(data)
        })();
        match loaded {
            Ok(data) => Self {
                data,
                ..Self::default()
            },
            Err(error) => Self {
                error: error.to_string(),
                ..Self::default()
            },
        }
    }

    pub fn report(&self, ui: &mut egui::Ui) {
        egui::ScrollArea::vertical().show(ui, |ui| {
            for view in &self.data.views {
                ui.heading(&view.label);
                ui.monospace(serde_json::to_string_pretty(&view.summary).unwrap_or_default());
            }
        });
    }

    pub fn len(&self) -> usize {
        self.data.views.len()
    }

    pub fn resolve(&mut self, scene: &Scene) {
        if !self.geometry.is_empty() || self.data.views.is_empty() {
            return;
        }
        let mut instances = BTreeMap::new();
        let mut nets: BTreeMap<&str, Vec<[i64; 4]>> = BTreeMap::new();
        let mut pins = BTreeMap::new();
        for (id, object) in scene.objects.iter() {
            if object
                .attributes
                .get("placed")
                .and_then(serde_json::Value::as_bool)
                == Some(false)
            {
                continue;
            }
            match object.kind.as_str() {
                "instance" | "macro" => {
                    let name = if object.name.is_empty() {
                        id.strip_prefix("inst:").unwrap_or(id)
                    } else {
                        &object.name
                    };
                    instances.insert(name, object.bbox);
                    if let Some(values) = object
                        .attributes
                        .get("pins")
                        .and_then(serde_json::Value::as_object)
                    {
                        for (pin, value) in values {
                            if let (Some(x), Some(y)) =
                                (value["position"][0].as_i64(), value["position"][1].as_i64())
                            {
                                pins.insert(format!("{name}/{pin}"), [x, y]);
                            }
                        }
                    }
                }
                "pin" => {
                    let b = object.bbox;
                    pins.insert(
                        object.name.clone(),
                        [b[0] + (b[2] - b[0]) / 2, b[1] + (b[3] - b[1]) / 2],
                    );
                }
                "wire" | "via" | "route_patch" | "pdn" => {
                    nets.entry(&object.name).or_default().push(object.bbox);
                }
                _ => {}
            }
        }
        self.geometry = self
            .data
            .views
            .iter()
            .map(|view| {
                view.items
                    .iter()
                    .map(|item| resolve(item, &instances, &nets, &pins))
                    .collect()
            })
            .collect();
    }

    pub fn clear(&mut self) {
        self.selected = None;
        self.item = None;
    }

    pub fn auto_select(&mut self, index: usize, progress: f32) {
        self.selected = (index < self.len()).then_some(index);
        self.item = None;
        self.progress = progress.clamp(0.0, 1.0);
    }

    /// Manual selection pauses playback; an item additionally requests layout focus.
    pub fn controls(&mut self, ui: &mut egui::Ui) -> (bool, Option<[i64; 4]>) {
        if self.len() == 0 && self.error.is_empty() && self.data.unavailable.is_empty() {
            return (false, None);
        }
        ui.strong("Result views");
        let mut selected = self.selected;
        egui::ScrollArea::vertical()
            .id_salt("replay_analysis_views")
            .max_height(130.0)
            .show(ui, |ui| {
                ui.selectable_value(&mut selected, None, "Layout");
                for (i, view) in self.data.views.iter().enumerate() {
                    ui.selectable_value(&mut selected, Some(i), &view.label);
                }
            });
        let mut changed = selected != self.selected;
        if changed {
            self.selected = selected;
            self.item = None;
            self.progress = 1.0;
        }
        let mut focus = None;
        if let Some(index) = self.selected {
            let view = &self.data.views[index];
            ui.small("Completed analysis · recorded result");
            let missing: usize = self
                .geometry
                .get(index)
                .into_iter()
                .flatten()
                .map(|g| g.missing)
                .sum();
            ui.small(format!(
                "{} items · {} unresolved references",
                view.items.len(),
                missing
            ));
            ui.collapsing("Report summary", |ui| {
                ui.monospace(serde_json::to_string_pretty(&view.summary).unwrap_or_default());
            });
            egui::ScrollArea::vertical()
                .id_salt("replay_analysis_items")
                .max_height(150.0)
                .show_rows(ui, 20.0, view.items.len(), |ui, range| {
                    for i in range {
                        let item = &view.items[i];
                        let label = item.value.map_or_else(
                            || item.label.clone(),
                            |v| format!("{} · {:.4} {}", item.label, v, view.unit),
                        );
                        if ui.selectable_label(self.item == Some(i), label).clicked() {
                            self.item = Some(i);
                            self.progress = 1.0;
                            changed = true;
                            focus = self
                                .geometry
                                .get(index)
                                .and_then(|items| items.get(i))
                                .and_then(bounds);
                        }
                    }
                });
            if let Some(item) = self.item.and_then(|i| view.items.get(i)) {
                ui.collapsing("Item details", |ui| {
                    ui.monospace(serde_json::to_string_pretty(&item.details).unwrap_or_default());
                });
            }
        }
        if !self.error.is_empty() {
            ui.small(&self.error);
        }
        for message in &self.data.unavailable {
            ui.small(message);
        }
        (changed, focus)
    }

    pub fn paint(&self, painter: &egui::Painter, project: impl Fn(i64, i64) -> Pos2) {
        let Some(index) = self.selected else {
            return;
        };
        let Some(geometry) = self.geometry.get(index) else {
            return;
        };
        let view = &self.data.views[index];
        let maximum = view
            .items
            .iter()
            .filter_map(|item| item.value)
            .fold(0.0_f64, f64::max)
            .max(f64::EPSILON);
        let visible = ((geometry.len() as f32 * self.progress).ceil() as usize).min(geometry.len());
        for (i, geometry) in geometry.iter().enumerate().take(visible) {
            if self.item.is_some_and(|selected| selected != i) {
                continue;
            }
            let color = if view.items[i].value.is_none()
                && matches!(view.kind.as_str(), "power" | "ir" | "em" | "rcx")
            {
                Color32::GRAY
            } else if matches!(view.kind.as_str(), "power" | "ir" | "em" | "rcx") {
                let value = (view.items[i].value.unwrap_or(0.0) / maximum).clamp(0.0, 1.0) as f32;
                Color32::from_rgba_unmultiplied(
                    (80.0 + value * 175.0) as u8,
                    (190.0 - value * 140.0) as u8,
                    90,
                    180,
                )
            } else {
                Color32::from_rgba_unmultiplied(255, 102, 129, 180)
            };
            for b in &geometry.boxes {
                // Preserve the layout plane in either projection. Two projected
                // corners only describe a screen-aligned bounding rectangle.
                let points = vec![
                    project(b[0], b[1]),
                    project(b[2], b[1]),
                    project(b[2], b[3]),
                    project(b[0], b[3]),
                ];
                if !Rect::from_points(&points)
                    .expand(1.0)
                    .intersects(painter.clip_rect())
                {
                    continue;
                }
                painter.add(egui::Shape::convex_polygon(
                    points,
                    color.gamma_multiply(0.35),
                    Stroke::new(1.5, color),
                ));
            }
            for pair in geometry.points.windows(2) {
                if let (Some(a), Some(b)) = (pair[0], pair[1]) {
                    painter.line_segment(
                        [project(a[0], a[1]), project(b[0], b[1])],
                        Stroke::new(2.0, color),
                    );
                }
            }
            for [a, b] in &geometry.segments {
                painter.line_segment(
                    [project(a[0], a[1]), project(b[0], b[1])],
                    Stroke::new(1.5, color),
                );
            }
            for point in &geometry.positions {
                painter.circle_filled(project(point[0], point[1]), 2.0, color);
            }
        }
    }
}

fn resolve(
    item: &Item,
    instances: &BTreeMap<&str, [i64; 4]>,
    nets: &BTreeMap<&str, Vec<[i64; 4]>>,
    pins: &BTreeMap<String, [i64; 2]>,
) -> Geometry {
    let mut result = Geometry {
        boxes: item.bboxes.clone(),
        positions: item.positions.clone(),
        segments: item.segments.clone(),
        ..Geometry::default()
    };
    for name in &item.instances {
        if let Some(b) = instances.get(name.as_str()) {
            result.boxes.push(*b);
        } else {
            result.missing += 1;
        }
    }
    // Diagnostic rectangles already precisely identify the faulty shape. Do not
    // replace a local violation with every shape on its named net.
    if item.bboxes.is_empty() && item.positions.is_empty() && item.segments.is_empty() {
        for name in &item.nets {
            if let Some(boxes) = nets.get(name.as_str()) {
                result.boxes.extend(boxes);
            } else {
                result.missing += 1;
            }
        }
    }
    for name in &item.pins {
        if let Some(point) = pins.get(name) {
            result.points.push(Some(*point));
        } else {
            result.points.push(None);
            result.missing += 1;
        }
    }
    result
}

fn bounds(geometry: &Geometry) -> Option<[i64; 4]> {
    geometry
        .boxes
        .iter()
        .copied()
        .chain(geometry.positions.iter().map(|p| [p[0], p[1], p[0], p[1]]))
        .chain(
            geometry
                .segments
                .iter()
                .flatten()
                .map(|p| [p[0], p[1], p[0], p[1]]),
        )
        .chain(
            geometry
                .points
                .iter()
                .flatten()
                .map(|p| [p[0], p[1], p[0], p[1]]),
        )
        .reduce(|a, b| {
            [
                a[0].min(b[0]),
                a[1].min(b[1]),
                a[2].max(b[2]),
                a[3].max(b[3]),
            ]
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analysis_boxes_follow_all_four_projected_corners_in_2d_and_rotated_3d() {
        let screen = Rect::from_min_size(Pos2::ZERO, egui::vec2(800.0, 600.0));
        for kind in ["rcx", "sta"] {
            for yaw in [None, Some(45.0), Some(-30.0)] {
                let analysis = ReplayAnalysis {
                    data: serde_json::from_value(serde_json::json!({
                        "schema": "ecos.replay.analysis.v1",
                        "views": [{"label": kind, "kind": kind, "basis": "final",
                            "items": [{"label": "region", "value": 1.0}]}]
                    }))
                    .unwrap(),
                    geometry: vec![vec![Geometry {
                        boxes: vec![[100, 100, 400, 300]],
                        ..Default::default()
                    }]],
                    selected: Some(0),
                    progress: 1.0,
                    ..Default::default()
                };
                let matrix = yaw.map(|yaw| {
                    crate::replay_camera_plan::Preset { pitch: 38.0, yaw }
                        .camera(
                            chipgeom_format::Rect32 {
                                lx: 0,
                                ly: 0,
                                hx: 1000,
                                hy: 1000,
                            },
                            200.0,
                            4.0 / 3.0,
                        )
                        .view_proj(4.0 / 3.0)
                });
                let project = |x: i64, y: i64| {
                    matrix.as_ref().map_or(Pos2::new(x as f32, y as f32), |m| {
                        let p = m.transform_point([x as f32, y as f32, 0.0, 1.0]);
                        Pos2::new(400.0 + 400.0 * p[0] / p[3], 300.0 - 300.0 * p[1] / p[3])
                    })
                };
                let ctx = egui::Context::default();
                let output = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(screen),
                        ..Default::default()
                    },
                    |ctx| analysis.paint(&ctx.layer_painter(egui::LayerId::background()), project),
                );
                assert_eq!(output.shapes.len(), 1);
                let egui::Shape::Path(path) = &output.shapes[0].shape else {
                    panic!("Analysis bounds must be a projected polygon, not a screen rectangle");
                };
                assert_eq!(
                    path.points,
                    vec![
                        project(100, 100),
                        project(400, 100),
                        project(400, 300),
                        project(100, 300)
                    ]
                );
                assert!(path.closed);
                assert_ne!(path.fill, Color32::TRANSPARENT);
                if yaw.is_some() {
                    assert!((path.points[0].y - path.points[1].y).abs() > 1.0);
                    assert!((path.points[1].x - path.points[2].x).abs() > 1.0);
                }
            }
        }
    }

    #[test]
    fn diagnostic_rectangles_stay_local_and_missing_objects_are_reported() {
        let item: Item = serde_json::from_value(serde_json::json!({"label":"short","bboxes":[[1,2,3,4]],"nets":["whole_net"],"instances":["missing"]})).unwrap();
        let geometry = resolve(
            &item,
            &BTreeMap::new(),
            &BTreeMap::from([("whole_net", vec![[0, 0, 100, 100]])]),
            &BTreeMap::new(),
        );
        assert_eq!(geometry.boxes, vec![[1, 2, 3, 4]]);
        assert_eq!(geometry.missing, 1);
        assert_eq!(bounds(&geometry), Some([1, 2, 3, 4]));
    }
}
