//! Planar observations projected through the same 3D camera as physical bounds.
use super::{view3d::outline, ReplayApp};
use egui::{Color32, Pos2, Stroke};

impl ReplayApp {
    pub(super) fn overlays3d(
        &self,
        painter: &egui::Painter,
        project: &impl Fn(i64, i64, f32) -> Pos2,
    ) {
        let (Some(record), Some(scene)) = (&self.recording, &self.view3d.scene) else {
            return;
        };
        let meta = &scene.metadata;
        for (id, object) in &scene.boundaries {
            if matches!(object.kind.as_str(), "die" | "core" | "row" | "halo") {
                let fraction = self.reveal.fraction(id);
                if fraction <= 0.0 {
                    continue;
                }
                let color = match object.kind.as_str() {
                    "die" => Color32::from_rgb(131, 193, 234),
                    "core" => Color32::from_rgb(218, 175, 107),
                    _ => Color32::from_rgba_unmultiplied(100, 145, 155, 90),
                }
                .gamma_multiply(fraction);
                outline(
                    painter,
                    project,
                    self.reveal.bounds(id, object),
                    0.0,
                    color,
                    0.7,
                );
            }
        }
        for old in &self.reveal.ghosts {
            let opacity = self.reveal.ghost_opacity();
            if opacity > 0.0 {
                outline(
                    painter,
                    project,
                    old.bbox,
                    meta.band(old).1,
                    Color32::LIGHT_RED.gamma_multiply(opacity),
                    0.7,
                );
            }
        }
        for (start, end) in self.motion.trails(&record.scene) {
            painter.line_segment(
                [
                    project(start[0], start[1], 240.0),
                    project(end[0], end[1], 240.0),
                ],
                Stroke::new(1.0, Color32::from_rgb(237, 179, 198)),
            );
        }
        for id in &self.selected_objects {
            if let Some(object) = record.scene.objects.get(id) {
                let b = self.motion.bounds(id, self.reveal.bounds(id, object));
                if self.reveal.fraction(id) > 0.0 {
                    outline(
                        painter,
                        project,
                        b,
                        meta.band(object).1,
                        Color32::WHITE,
                        2.0,
                    );
                }
            }
        }
        if !self.complete {
            self.route_overlay.visit_3d(|object, color, filled| {
                let z = if object.kind == "route_region" {
                    0.0
                } else {
                    meta.band(object).1
                };
                if filled {
                    quad(painter, project, object.bbox, z, color);
                } else {
                    outline(painter, project, object.bbox, z, color, 1.0);
                }
            });
        }
        if self.complete && self.pending.is_none() {
            if let Some(data) = self.maps.active_data() {
                for row in 0..data.rows() {
                    for col in 0..data.columns() {
                        if let (Some(b), Some(value)) =
                            (data.bbox(row, col), data.normalized_value(row, col))
                        {
                            let [r, g, blue, _] =
                                crate::map_data::ColormapMode::Turbo.sample(value);
                            quad(
                                painter,
                                project,
                                [b.lx.into(), b.ly.into(), b.hx.into(), b.hy.into()],
                                0.0,
                                Color32::from_rgba_unmultiplied(r, g, blue, 155),
                            );
                        }
                    }
                }
            }
            self.analysis.paint(painter, |x, y| project(x, y, 0.0));
        }
    }
}
fn quad(
    painter: &egui::Painter,
    project: &impl Fn(i64, i64, f32) -> Pos2,
    b: [i64; 4],
    z: f32,
    color: Color32,
) {
    let mut mesh = egui::Mesh::default();
    for (x, y) in [(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])] {
        mesh.colored_vertex(project(x, y, z), color);
    }
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(0, 2, 3);
    painter.add(egui::Shape::mesh(mesh));
}
