//! Resolve frozen reports once against the final scene, then paint bounded overlays.
use crate::replay::data::Recording;
use crate::replay::timing::{self, TimingPath};
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
    timing: Option<TimingPath>,
}

#[derive(Default)]
pub struct ReplayAnalysis {
    data: Analysis,
    geometry: Vec<Vec<Geometry>>,
    rcx: crate::replay::rcx::RcxOverlay,
    ir: crate::replay::ir::IrOverlays,
    pub selected: Option<usize>,
    item: Option<usize>,
    progress: f32,
    follow: crate::replay::widgets::SelectionFollow,
    pub error: String,
    pub requested_time: Option<f64>,
}

impl ReplayAnalysis {
    pub fn selected_label(&self) -> Option<&str> {
        self.selected
            .and_then(|i| self.data.views.get(i))
            .map(|v| v.label.as_str())
    }
    pub fn selected_description(&self) -> Option<(&str, &str)> {
        self.selected
            .and_then(|i| self.data.views.get(i))
            .map(|v| (v.kind.as_str(), v.label.as_str()))
    }

    pub fn open(recording: &Recording) -> Self {
        let loaded = (|| -> anyhow::Result<Analysis> {
            let data = crate::replay::analysis_data::load(recording)?;
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
            Ok(mut data) => {
                timing::group_corners(&mut data);
                data.views.sort_by_key(|view| view.kind != "ir");
                let (ir, error) = match crate::replay::ir::IrOverlays::load(&data) {
                    Ok(ir) => (ir, String::new()),
                    Err(error) => (
                        Default::default(),
                        format!("IR heatmap unavailable: {error:#}"),
                    ),
                };
                Self {
                    data,
                    ir,
                    error,
                    ..Self::default()
                }
            }
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
                    .map(|item| {
                        if matches!(view.kind.as_str(), "rcx" | "ir") {
                            Geometry::default()
                        } else {
                            resolve(item, &instances, &nets, &pins)
                        }
                    })
                    .collect()
            })
            .collect();
        // Legacy raw power reports have names but no positions. Resolve first,
        // then order the reveal spatially just like the geometry TSV format.
        for (view, geometry) in self.data.views.iter_mut().zip(&mut self.geometry) {
            if view.kind == "power" {
                let mut paired: Vec<_> = view.items.drain(..).zip(geometry.drain(..)).collect();
                paired.sort_by_key(|(item, g)| {
                    let b = g.boxes.first().copied().unwrap_or([i64::MAX; 4]);
                    (b[1], b[0], item.label.clone())
                });
                for (item, g) in paired {
                    view.items.push(item);
                    geometry.push(g);
                }
            }
        }
    }

    pub fn clear(&mut self) {
        self.selected = None;
        self.item = None;
    }

    fn view_duration(&self, index: usize) -> f64 {
        match self.data.views[index].kind.as_str() {
            "timing" => timing::CORNER_SECONDS,
            "power" | "ir" => 4.0,
            "rcx" => crate::replay::rcx::CORNER_SECONDS,
            _ => crate::replay::plan::MAP_SECONDS,
        }
    }

    pub fn duration(&self) -> f64 {
        (0..self.len()).map(|i| self.view_duration(i)).sum()
    }

    fn offset(&self, index: usize) -> f64 {
        (0..index).map(|i| self.view_duration(i)).sum()
    }

    pub fn auto_select_time(&mut self, mut seconds: f64) {
        self.clear();
        for index in 0..self.len() {
            let duration = self.view_duration(index);
            if seconds < duration || index + 1 == self.len() {
                self.selected = Some(index);
                let reveal =
                    if matches!(self.data.views[index].kind.as_str(), "power" | "rcx" | "ir") {
                        duration - 1.0
                    } else {
                        duration
                    };
                self.progress = (seconds / reveal).clamp(0.0, 1.0) as f32;
                return;
            }
            seconds -= duration;
        }
    }

    /// Loaded only by the worker, from this attempt's verified final snapshot.
    pub fn resolve_routes(&mut self, recording: &Recording) {
        match crate::replay::rcx::RcxOverlay::load(recording, &self.data) {
            Ok(overlay) => self.rcx = overlay,
            Err(error) => self.error = format!("RCX geometry unavailable: {error}"),
        }
        if !self.data.views.iter().any(|v| v.kind == "timing") {
            return;
        }
        let result = (|| -> anyhow::Result<()> {
            let file = recording.final_geometry_path()?.ok_or_else(|| {
                anyhow::anyhow!("No frozen routed snapshot; rerun STA with Replay enabled")
            })?;
            let mut resolver =
                crate::timing_route::Resolver::new(chip_view_db::ChipViewDb::open(file)?);
            for (view, geometry) in self.data.views.iter().zip(&mut self.geometry) {
                if view.kind != "timing" {
                    continue;
                }
                for (item, g) in view.items.iter().zip(geometry) {
                    let path = TimingPath::resolve(item, &mut resolver);
                    g.missing = path.unresolved;
                    g.timing = Some(path);
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.error = format!("Routed timing unavailable: {error}");
        }
    }

    /// Timing and power selections request a seek; diagnostic items request layout focus.
    pub fn controls(&mut self, ui: &mut egui::Ui) -> (bool, Option<[i64; 4]>) {
        if self.len() == 0 && self.error.is_empty() && self.data.unavailable.is_empty() {
            return (false, None);
        }
        ui.strong("Result views");
        let follow = self.follow.changed(ui.id(), self.selected);
        let mut selected = self.selected;
        let list = egui::ScrollArea::vertical()
            .id_salt("replay_analysis_views")
            .max_height(130.0)
            .show(ui, |ui| {
                ui.selectable_value(&mut selected, None, "Layout");
                for (i, view) in self.data.views.iter().enumerate() {
                    let response = ui.selectable_value(&mut selected, Some(i), &view.label);
                    if follow && self.selected == Some(i) {
                        response.scroll_to_me(None);
                    }
                }
            });
        if follow && self.selected.is_some() {
            ui.scroll_to_rect(list.inner_rect, None);
        }
        let mut changed = selected != self.selected;
        if changed {
            self.selected = selected;
            self.item = None;
            self.progress = 1.0;
            if let Some(index) = selected {
                if matches!(
                    self.data.views[index].kind.as_str(),
                    "timing" | "power" | "rcx" | "ir"
                ) {
                    self.requested_time = Some(self.offset(index));
                }
            }
        }
        let mut focus = None;
        if let Some(index) = self.selected {
            let view = &self.data.views[index];
            if view.kind == "ir" {
                if self.ir.controls(ui, index) {
                    self.progress = 1.0;
                    changed = true;
                }
                if !self.error.is_empty() {
                    ui.small(&self.error);
                }
                return (changed, None);
            }
            ui.small(if view.kind == "power" {
                "Power heatmap · completed result"
            } else if view.kind == "timing" {
                "Timing path replay · completed result"
            } else {
                "Completed analysis · recorded result"
            });
            if view.kind == "power" {
                let maximum = view
                    .items
                    .iter()
                    .filter_map(|i| i.value)
                    .fold(0.0_f64, f64::max);
                let (rect, _) = ui.allocate_exact_size(
                    egui::vec2(ui.available_width(), 8.0),
                    egui::Sense::hover(),
                );
                for i in 0..64 {
                    let [r, g, b, _] = crate::map_data::ColormapMode::Turbo.sample(i as f32 / 63.0);
                    ui.painter().rect_filled(
                        Rect::from_min_max(
                            egui::pos2(rect.left() + rect.width() * i as f32 / 64.0, rect.top()),
                            egui::pos2(
                                rect.left() + rect.width() * (i + 1) as f32 / 64.0,
                                rect.bottom(),
                            ),
                        ),
                        0.0,
                        Color32::from_rgb(r, g, b),
                    );
                }
                ui.small(format!("0 — {maximum:.3e} W · power per instance"));
            }
            if view.kind == "timing" {
                ui.small("All paths in this corner · 6 s");
                ui.small("Routed wires and vias · click a path to inspect");
                ui.horizontal(|ui| {
                    ui.colored_label(Color32::from_rgb(255, 177, 92), "Setup");
                    ui.colored_label(Color32::from_rgb(90, 210, 240), "Hold");
                });
                if self.item.is_some() && ui.small_button("Show all paths").clicked() {
                    self.item = None;
                    self.progress = 1.0;
                    changed = true;
                }
            }
            if view.kind == "rcx" {
                let shown = (view.items.len() as f32 * self.progress).ceil() as usize;
                ui.small(format!(
                    "SPEF result replay · {shown} / {} nets",
                    view.items.len()
                ));
                ui.small("Native routed wires/vias · color = net capacitance");
            }
            let missing: usize = self
                .geometry
                .get(index)
                .into_iter()
                .flatten()
                .map(|g| g.missing)
                .sum::<usize>()
                + self.rcx.missing(index);
            ui.small(format!(
                "{} items · {} unresolved references / route arcs",
                view.items.len(),
                missing
            ));
            ui.collapsing("Report summary", |ui| {
                ui.monospace(serde_json::to_string_pretty(&view.summary).unwrap_or_default());
            });
            let active_item = self.item.or_else(|| {
                (view.kind == "rcx" && self.progress > 0.0 && !view.items.is_empty()).then(|| {
                    ((view.items.len() as f32 * self.progress).ceil() as usize)
                        .saturating_sub(1)
                        .min(view.items.len() - 1)
                })
            });
            let follow_item = self
                .follow
                .changed(ui.id().with("items"), (index, active_item));
            let mut items = egui::ScrollArea::vertical()
                .id_salt("replay_analysis_items")
                .max_height(150.0);
            if follow_item {
                if let Some(item) = active_item {
                    items = items
                        .vertical_scroll_offset(item as f32 * (20.0 + ui.spacing().item_spacing.y));
                }
            }
            items.show_rows(ui, 20.0, view.items.len(), |ui, range| {
                for i in range {
                    let item = &view.items[i];
                    let label = item.value.map_or_else(
                        || item.label.clone(),
                        |v| {
                            if view.kind == "power" {
                                format!("{} · {v:.3e} W", item.label)
                            } else {
                                format!("{} · {v:.4} {}", item.label, view.unit)
                            }
                        },
                    );
                    let label = if view.kind == "timing" {
                        format!(
                            "#{:02} {} · slack {} ns · {}",
                            i + 1,
                            item.details["analysis_type"].as_str().unwrap_or(""),
                            item.value
                                .map_or_else(|| "N/A".into(), |v| format!("{v:+.3}")),
                            item.label.replace('→', "->")
                        )
                    } else {
                        label
                    };
                    if ui
                        .add(
                            egui::Button::new(&label)
                                .selected(active_item == Some(i))
                                .truncate(),
                        )
                        .on_hover_text(&label)
                        .clicked()
                    {
                        self.item = Some(i);
                        self.progress = 1.0;
                        changed = true;
                        focus = self.rcx.bounds(index, i).or_else(|| {
                            self.geometry
                                .get(index)
                                .and_then(|items| items.get(i))
                                .and_then(bounds)
                        });
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
        self.paint_layers(painter, |x, y, _| project(x, y));
    }

    pub fn paint_layers(
        &self,
        painter: &egui::Painter,
        project_layer: impl Fn(i64, i64, Option<u16>) -> Pos2,
    ) {
        let project = |x, y| project_layer(x, y, None);
        let Some(index) = self.selected else {
            return;
        };
        let view = &self.data.views[index];
        if view.kind == "ir" {
            painter.rect_filled(painter.clip_rect(), 0.0, Color32::from_black_alpha(155));
            self.ir.paint(painter, project, index, self.progress);
            return;
        }
        let Some(geometry) = self.geometry.get(index) else {
            return;
        };
        if view.kind == "rcx" {
            self.rcx.paint(
                painter,
                project_layer,
                index,
                &view.items,
                self.progress,
                self.item,
            );
            return;
        }
        if matches!(view.kind.as_str(), "timing" | "power") {
            painter.rect_filled(painter.clip_rect(), 0.0, Color32::from_black_alpha(135));
        }
        let maximum = view
            .items
            .iter()
            .filter_map(|item| item.value)
            .fold(0.0_f64, f64::max)
            .max(f64::EPSILON);
        if view.kind == "timing" {
            let mut occupied = timing::Labels::default();
            for (i, g) in geometry.iter().enumerate() {
                if self.item.is_some_and(|selected| selected != i) {
                    continue;
                }
                if let Some(path) = &g.timing {
                    path.paint(
                        painter,
                        &project_layer,
                        &view.items[i],
                        self.progress,
                        &mut occupied,
                        self.item == Some(i),
                    );
                }
            }
            return;
        }
        let mut power_mesh = egui::Mesh::default();
        for (i, geometry) in geometry.iter().enumerate() {
            if self.item.is_some_and(|selected| selected != i) {
                continue;
            }
            let fade = if view.kind == "power" && self.item.is_none() {
                // Overlapping smooth fades form a spatial sweep, not a sequence
                // of sudden static snapshots. Keep values and scale fixed.
                let t = (self.progress * 1.2 - i as f32 / self.geometry[index].len().max(1) as f32)
                    / 0.2;
                let t = t.clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t)
            } else {
                if i as f32 >= self.geometry[index].len() as f32 * self.progress
                    && self.item.is_none()
                {
                    continue;
                }
                1.0
            };
            if fade <= 0.0 {
                continue;
            }
            let color = if view.items[i].value.is_none()
                && matches!(view.kind.as_str(), "power" | "ir" | "em" | "rcx")
            {
                Color32::GRAY
            } else if view.kind == "power" {
                let value = (view.items[i].value.unwrap_or(0.0) / maximum).clamp(0.0, 1.0) as f32;
                let [r, g, b, _] = crate::map_data::ColormapMode::Turbo.sample(value);
                Color32::from_rgba_unmultiplied(r, g, b, 210)
            } else if matches!(view.kind.as_str(), "ir" | "em" | "rcx") {
                let value = (view.items[i].value.unwrap_or(0.0) / maximum).clamp(0.0, 1.0) as f32;
                Color32::from_rgba_unmultiplied(
                    (80.0 + value * 175.0) as u8,
                    (190.0 - value * 140.0) as u8,
                    90,
                    180,
                )
            } else {
                Color32::from_rgba_unmultiplied(255, 102, 129, 180)
            }
            .gamma_multiply(fade);
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
                if view.kind == "power" {
                    let start = power_mesh.vertices.len() as u32;
                    for point in points {
                        power_mesh.vertices.push(egui::epaint::Vertex {
                            pos: point,
                            uv: egui::epaint::WHITE_UV,
                            color,
                        });
                    }
                    power_mesh.indices.extend_from_slice(&[
                        start,
                        start + 1,
                        start + 2,
                        start,
                        start + 2,
                        start + 3,
                    ]);
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
        if !power_mesh.is_empty() {
            painter.add(power_mesh);
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
    if item.details["stages"].is_array() {
        // Routed paths are prepared separately from the verified native snapshot.
        return result;
    }
    for name in &item.instances {
        if let Some(b) = instances.get(name.as_str()) {
            if item.bboxes.is_empty() {
                result.boxes.push(*b);
            }
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
        if let Some(point) = timing::lookup_pin(name, pins) {
            result.points.push(Some(point));
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
                .timing
                .iter()
                .flat_map(|t| t.points.iter().flatten())
                .map(|p| [p[0], p[1], p[0], p[1]]),
        )
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
        for kind in ["em", "sta"] {
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
                    crate::replay::camera_plan::Preset { pitch: 38.0, yaw }
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
    fn corner_clock_is_independent_of_path_count_and_seeking_is_deterministic() {
        let mut analysis=ReplayAnalysis {
            data:serde_json::from_value(serde_json::json!({"schema":"ecos.replay.analysis.v1","views":[
                {"label":"slow","kind":"timing","basis":"final","items":[{"label":"a"},{"label":"b"}]},
                {"label":"fast","kind":"timing","basis":"final","items":[{"label":"c"}]},
                {"label":"total","kind":"power","basis":"final","items":[{"label":"u"}]}
            ]})).unwrap(),..Default::default()
        };
        assert_eq!(analysis.duration(), 16.0);
        analysis.auto_select_time(3.0);
        assert_eq!(
            (analysis.selected, analysis.item, analysis.progress),
            (Some(0), None, 0.5)
        );
        analysis.auto_select_time(6.0);
        assert_eq!(
            (analysis.selected, analysis.item, analysis.progress),
            (Some(1), None, 0.0)
        );
        analysis.auto_select_time(13.5);
        assert_eq!(
            (analysis.selected, analysis.item, analysis.progress),
            (Some(2), None, 0.5)
        );
        analysis.auto_select_time(3.0);
        assert_eq!(
            (analysis.selected, analysis.item, analysis.progress),
            (Some(0), None, 0.5)
        );
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

#[cfg(test)]
#[path = "timing_validation.rs"]
mod routed_validation;
