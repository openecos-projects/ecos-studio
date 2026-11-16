use super::ReplayApp;
use crate::replay_gpu_mesh::{paint, Slot};
use egui::{Color32, Pos2, Rect, Sense, Stroke};

impl ReplayApp {
    pub(super) fn canvas(&mut self, ui: &mut egui::Ui) {
        let (rect, response) = ui.allocate_exact_size(ui.available_size(), Sense::click());
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
        let [lx, ly, hx, hy] = self.focus.unwrap_or(die.bbox);
        let scale = ((rect.width() - 60.0) / (hx - lx).max(1) as f32)
            .min((rect.height() - 60.0) / (hy - ly).max(1) as f32)
            * self.zoom;
        let project = |x: i64, y: i64| {
            Pos2::new(
                rect.center().x + (x as f64 - (lx as f64 + hx as f64) / 2.0) as f32 * scale,
                rect.center().y - (y as f64 - (ly as f64 + hy as f64) / 2.0) as f32 * scale,
            )
        };
        let half_x = (rect.width() as f64 / (2.0 * f64::from(scale))).ceil() as i64;
        let half_y = (rect.height() as f64 / (2.0 * f64::from(scale))).ceil() as i64;
        let center_x = lx + (hx - lx) / 2;
        let center_y = ly + (hy - ly) / 2;
        let viewport = [
            center_x - half_x,
            center_y - half_y,
            center_x + half_x,
            center_y + half_y,
        ];
        if response.clicked() {
            if let Some(pos) = response.interact_pointer_pos() {
                let x = (center_x as f64 + f64::from(pos.x - rect.center().x) / f64::from(scale))
                    .round() as i64;
                let y = (center_y as f64 - f64::from(pos.y - rect.center().y) / f64::from(scale))
                    .round() as i64;
                let hit = self
                    .scene_index
                    .visible([x, y, x, y])
                    .filter(|(id, object)| {
                        let b = self.motion.bounds(id, self.reveal.bounds(id, object));
                        self.reveal.fraction(id) > 0.0
                            && matches!(
                                object.kind.as_str(),
                                "instance" | "macro" | "wire" | "via" | "pin"
                            )
                            && x >= b[0]
                            && x <= b[2]
                            && y >= b[1]
                            && y <= b[3]
                    })
                    .min_by_key(|(_, o)| {
                        (o.bbox[2] as i128 - o.bbox[0] as i128)
                            * (o.bbox[3] as i128 - o.bbox[1] as i128)
                    });
                self.selected_objects.clear();
                if let Some((id, _)) = hit {
                    self.selected_objects.insert(id.to_owned());
                }
                ui.ctx().request_repaint();
            }
        }
        let key = (rect, [lx, ly, hx, hy], self.zoom.to_bits(), scene.revision);
        if self.canvas_cache.key.as_ref() != Some(&key) {
            self.canvas_cache.prepare(
                key,
                scene,
                &self.scene_index,
                &self.motion,
                &self.reveal,
                viewport,
                self.focus.is_some(),
                &project,
                scale,
            );
            if self.gpu_format.is_some() {
                self.canvas_cache.animation = crate::replay_gpu_animation::Animation::build(
                    &self.canvas_cache.dynamic,
                    &self.motion,
                    &self.reveal,
                    &project,
                    scale,
                    Rect::EVERYTHING,
                );
                let animation = &self.canvas_cache.animation;
                let largest = animation
                    .geometry
                    .motion
                    .len()
                    .max(animation.highlights.motion.len());
                self.canvas_cache.gpu_animated = largest
                    * std::mem::size_of::<crate::replay_gpu_animation::VertexMotion>()
                    <= self.gpu_animation_limit;
                if !self.canvas_cache.gpu_animated {
                    self.canvas_cache.animation = Default::default();
                }
            }
        }
        paint(
            &painter,
            self.canvas_cache.ghosts.clone(),
            Slot::Ghosts,
            self.gpu_format,
            self.reveal.ghost_opacity(),
        );
        paint(
            &painter,
            self.canvas_cache.base.clone(),
            Slot::Base,
            self.gpu_format,
            if self.complete {
                1.0
            } else {
                self.route_overlay.context_opacity()
            },
        );
        let mut moving = egui::Mesh::default();
        let mut highlights = egui::Mesh::default();
        let progress = self
            .reveal
            .progress()
            .unwrap_or_else(|| self.motion.progress());
        if let Some(format) = self.gpu_format.filter(|_| self.canvas_cache.gpu_animated) {
            crate::replay_gpu_mesh::paint_animated(
                &painter,
                &self.canvas_cache.animation.geometry,
                Slot::Dynamic,
                format,
                progress,
            );
        }
        for item in &self.canvas_cache.dynamic {
            if self.canvas_cache.gpu_animated
                && crate::replay_gpu_animation::supported(&item.object)
            {
                continue;
            }
            crate::replay_batch::paint_object(
                &mut moving,
                &mut highlights,
                &item.id,
                &item.object,
                item.touched,
                &self.motion,
                &self.reveal,
                &project,
                scale,
                rect,
            );
        }
        painter.add(egui::Shape::mesh(moving));
        if !self.complete {
            self.route_overlay.paint(&painter, &project);
        }
        if self.complete && self.pending.is_none() {
            self.maps.paint(&painter, project);
            self.analysis.paint(&painter, project);
        }
        paint(
            &painter,
            self.canvas_cache.deleted.clone(),
            Slot::Deleted,
            self.gpu_format,
            1.0,
        );
        // Draw highlights last so PDN geometry and heatmaps cannot obscure them.
        paint(
            &painter,
            self.canvas_cache.highlights.clone(),
            Slot::Highlights,
            self.gpu_format,
            1.0,
        );
        if let Some(format) = self.gpu_format.filter(|_| self.canvas_cache.gpu_animated) {
            crate::replay_gpu_mesh::paint_animated(
                &painter,
                &self.canvas_cache.animation.highlights,
                Slot::DynamicHighlights,
                format,
                progress,
            );
        }
        painter.add(egui::Shape::mesh(highlights));
        for (start, end) in self.motion.trails(scene) {
            painter.line_segment(
                [project(start[0], start[1]), project(end[0], end[1])],
                Stroke::new(1.0, Color32::from_rgba_unmultiplied(240, 175, 201, 130)),
            );
        }
        if let Some(progress) = self.clock_progress() {
            self.clock_overlay
                .paint(&painter, |x, y, _| project(x, y), progress);
        }
        for id in &self.selected_objects {
            if let Some(obj) = scene.objects.get(id) {
                let [x1, y1, x2, y2] = self.motion.bounds(id, self.reveal.bounds(id, obj));
                painter.rect_stroke(
                    Rect::from_two_pos(project(x1, y1), project(x2, y2)).expand(2.0),
                    0.0,
                    Stroke::new(2.0, Color32::WHITE),
                    egui::StrokeKind::Outside,
                );
            }
        }
    }
}

#[cfg(test)]
mod benchmarks {
    use super::*;
    use crate::replay_data::Recording;
    use std::{path::Path, time::Instant};

    #[test]
    #[ignore = "set ECOS_REPLAY_TEST_CATALOG to a real workspace catalog"]
    fn real_layout_animation_cpu_frame_time() {
        let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap();
        let mut app = ReplayApp::open(Path::new(&path)).unwrap();
        // Let the independent planner finish before measuring canvas work.
        let _ = app.preparation.take().unwrap().recv().unwrap();
        let step = app
            .catalog
            .steps
            .iter()
            .find(|s| s.name == "place")
            .unwrap();
        let mut record =
            Recording::open(&app.catalog.workspace, step.manifest.as_ref().unwrap()).unwrap();
        let target = record
            .manifest
            .frames
            .windows(2)
            .position(|frames| crate::replay_motion::compatible_frames(&frames[0], &frames[1]))
            .unwrap()
            + 1;
        record.seek_frame(target - 1).unwrap();
        let before = record.scene.clone();
        record.seek_frame(target).unwrap();
        app.motion
            .begin(&before, &record.scene, &record.manifest.frames);
        app.scene_index = crate::replay_index::SceneIndex::build(&record.scene, &app.motion);
        app.recording = Some(record);
        let ctx = egui::Context::default();
        let mut times = Vec::new();
        for frame in 0..120 {
            app.motion.set_progress((frame % 60) as f64 / 59.0);
            let start = Instant::now();
            let output = ctx.run(
                egui::RawInput {
                    screen_rect: Some(Rect::from_min_size(Pos2::ZERO, egui::vec2(1000.0, 800.0))),
                    ..Default::default()
                },
                |ctx| {
                    egui::CentralPanel::default().show(ctx, |ui| app.canvas(ui));
                },
            );
            let _ = ctx.tessellate(output.shapes, output.pixels_per_point);
            if frame > 0 {
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
        }
        times.sort_by(f64::total_cmp);
        println!(
            "Replay CPU canvas+tessellation P95: {:.1}ms (1000x800, no GPU submission)",
            times[112]
        );
    }
}
