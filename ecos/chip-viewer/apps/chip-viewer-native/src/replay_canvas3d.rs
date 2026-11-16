//! A second projection of the Replay sample, sharing its clock and loader.
use crate::{
    camera3d::Vec3,
    canvas_gpu3d::{CanvasGpu3dCallback, CanvasUniform3d, ShadingStyle},
    nav3d::CameraController3d,
    replay_camera_plan::{blend, Preset},
    replay_scene3d::Scene3d,
};
use egui::{Color32, Pos2, Sense, Stroke};

const AUTO_SPIN_RADIANS_PER_SECOND: f32 = 4.0_f32.to_radians();

pub struct View3d {
    pub enabled: bool,
    pub budget: usize,
    pub scene: Option<Scene3d>,
    pub error: String,
    pub needs_prepare: bool,
    pub automatic: bool,
    pub auto_spin: bool,
    pub spin_yaw: Option<f32>,
    pub camera: CameraController3d,
    pub state: Option<egui_wgpu::RenderState>,
    pub z_cut: f32,
    pub z_scale: f32,
    pub reports: bool,
    pub hidden_layers: std::collections::BTreeSet<u16>,
    pub filtered: Option<std::sync::Arc<Vec<crate::canvas_gpu3d::GpuShapeInstance3d>>>,
    pub epoch: u64,
}
impl Default for View3d {
    fn default() -> Self {
        Self {
            enabled: false,
            budget: 250_000,
            scene: None,
            error: String::new(),
            needs_prepare: false,
            automatic: true,
            auto_spin: false,
            spin_yaw: None,
            camera: Default::default(),
            state: None,
            z_cut: 1.0,
            z_scale: 1.0,
            reports: true,
            hidden_layers: Default::default(),
            filtered: None,
            epoch: 0,
        }
    }
}
impl View3d {
    pub fn configure(&mut self, cc: &eframe::CreationContext<'_>) {
        self.state = cc.wgpu_render_state.clone();
        if let Some(state) = &self.state {
            self.budget = ((state.device.limits().max_storage_buffer_binding_size as usize)
                / std::mem::size_of::<crate::canvas_gpu3d::GpuShapeInstance3d>())
            .min(500_000);
        }
    }
    pub fn accept(&mut self, value: Option<Result<Scene3d, String>>) {
        self.needs_prepare = false;
        self.epoch = self.epoch.wrapping_add(1);
        self.filtered = None;
        self.scene = None;
        self.error.clear();
        if !self.enabled {
            return;
        }
        match value {
            Some(Ok(scene)) => self.scene = Some(scene),
            Some(Err(error)) => self.error = error,
            None => {}
        }
    }
}
impl crate::replay::ReplayApp {
    pub(super) fn set_three_d(&mut self, enabled: bool) {
        if enabled
            && self
                .view3d
                .state
                .as_ref()
                .is_none_or(|s| s.device.limits().max_storage_buffers_per_shader_stage == 0)
        {
            self.view3d.error = "3D needs a GPU with storage-buffer support".into();
            return;
        }
        let exact_frame = (self.camera_exact && !self.completion_node_selected)
            .then(|| {
                self.pending
                    .map(|(_, frame, _)| frame)
                    .or_else(|| self.recording.as_ref().and_then(|r| r.scene.revision))
            })
            .flatten();
        self.view3d.enabled = enabled;
        self.view3d.auto_spin = enabled;
        self.view3d.spin_yaw = enabled.then_some(45.0_f32.to_radians());
        self.view3d.automatic = false;
        self.view3d.scene = None;
        self.view3d.filtered = None;
        self.view3d.error.clear();
        if !enabled {
            if let Some(state) = &self.view3d.state {
                crate::canvas_gpu3d::release_replay_resources(
                    &mut state.renderer.write().callback_resources,
                );
            }
        }
        self.view3d.needs_prepare = true;
        self.loader.cancel();
        self.pending = None;
        self.active_clip = None;
        if let Some(frame) = exact_frame {
            self.select_node_frame(self.step, self.position, Some((0.0, Some(frame))));
        } else {
            self.select(self.step, self.position, self.completion_node_selected);
        }
    }
    pub(super) fn camera_preset(&self) -> Preset {
        let name = &self.catalog.steps[self.step].name;
        let Some(record) = &self.recording else {
            return Preset::for_phase(name, "", false);
        };
        let revision = record.scene.revision.unwrap_or(0);
        let frames = &record.manifest.frames;
        let map = self.complete && self.maps.selected.is_some();
        let current = Preset::for_phase(name, &frames[revision].phase, map);
        if self.camera_exact {
            return current;
        }
        let local = self.position - self.starts[self.step];
        if map {
            return blend(
                Preset::for_phase(name, &frames[revision].phase, false),
                current,
                ((local
                    - self.plans[self.step].process_seconds
                    - crate::replay_plan::RESULT_SECONDS)
                    / 0.4) as f32,
            );
        }
        let mut previous = Preset::for_phase(name, &frames[0].phase, false);
        let mut from = previous;
        let mut start = 0.0;
        let mut duration = 0.0;
        for clip in &self.plans[self.step].clips {
            if clip.frame > revision {
                break;
            }
            let next = Preset::for_phase(name, &frames[clip.frame].phase, false);
            if next != previous {
                from = previous;
                previous = next;
                start = clip.start;
                duration = ((clip.end - clip.start) * 0.25).min(0.5);
            }
        }
        if duration > 0.0 {
            blend(from, current, ((local - start) / duration) as f32)
        } else {
            current
        }
    }
    pub(super) fn canvas3d(&mut self, ui: &mut egui::Ui) {
        let preset = self.camera_preset();
        let mut locate = false;
        ui.horizontal_wrapped(|ui| {
            ui.strong("3D");
            if ui
                .selectable_label(self.view3d.automatic, "Stage camera")
                .clicked()
            {
                self.view3d.automatic = true;
                self.view3d.auto_spin = false;
                self.view3d.spin_yaw = None;
            }
            for (name, pitch, yaw) in [
                ("Iso", 38.0, 45.0),
                ("Top", 88.0, -90.0),
                ("Front", 12.0, -90.0),
            ] {
                if ui.button(name).clicked() {
                    self.view3d.automatic = false;
                    self.view3d.auto_spin = false;
                    self.view3d.spin_yaw = None;
                    self.view3d.camera.current.pitch = f32::to_radians(pitch);
                    self.view3d.camera.current.yaw = f32::to_radians(yaw);
                    self.view3d.camera.target = self.view3d.camera.current;
                }
            }
            if ui.button("Fit").clicked() {
                self.view3d.automatic = true;
                self.view3d.auto_spin = false;
                self.view3d.spin_yaw = None;
                self.view3d.z_scale = 1.0;
            }
            locate = ui.button("2D region").clicked();
            ui.checkbox(&mut self.view3d.reports, "Reports");
            ui.menu_button("Layers", |ui| {
                if let Some(scene) = &self.view3d.scene {
                    for (name, (id, _, _)) in &scene.metadata.layers {
                        let mut visible = !self.view3d.hidden_layers.contains(id);
                        if ui.checkbox(&mut visible, name).changed() {
                            if visible {
                                self.view3d.hidden_layers.remove(id);
                            } else {
                                self.view3d.hidden_layers.insert(*id);
                            }
                            self.view3d.filtered = None;
                            self.view3d.epoch = self.view3d.epoch.wrapping_add(1);
                        }
                    }
                }
            });
        });
        ui.horizontal(|ui| {
            ui.add(egui::Slider::new(&mut self.view3d.z_scale, 0.2..=4.0).text("Z"));
            ui.add(egui::Slider::new(&mut self.view3d.z_cut, 0.0..=1.0).text("Layers"));
        });
        ui.small(if self.view3d.automatic {
            "Stage camera · schematic layer heights"
        } else if self.view3d.auto_spin {
            "Iso camera · slow rotation · click or drag to control"
        } else {
            "Manual camera · click Stage camera to resume"
        });
        let (rect, response) = ui.allocate_exact_size(
            ui.available_size().max(egui::vec2(1.0, 1.0)),
            Sense::click_and_drag(),
        );
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, Color32::from_rgb(12, 18, 24));
        let Some(scene) = &self.view3d.scene else {
            painter.text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                if !self.view3d.error.is_empty() {
                    &self.view3d.error
                } else {
                    "Preparing synchronized 3D…"
                },
                egui::FontId::proportional(13.0),
                Color32::LIGHT_GRAY,
            );
            return;
        };
        let Some(record) = &self.recording else {
            return;
        };
        if record.manifest.geometry_detail.as_deref() == Some("report_only")
            || !record.scene.objects.contains_key("die")
        {
            painter.text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                "No physical layout in this stage",
                egui::FontId::proportional(14.0),
                Color32::GRAY,
            );
            return;
        }
        let unit = scene
            .metadata
            .units
            .map_or("DBU".to_owned(), |u| format!("{u} DBU/µm"));
        painter.text(
            rect.left_bottom() - egui::vec2(-6.0, 6.0),
            egui::Align2::LEFT_BOTTOM,
            unit,
            egui::FontId::proportional(10.0),
            Color32::GRAY,
        );
        let aspect = (rect.width() / rect.height().max(1.0)).max(0.1);
        if self.view3d.auto_spin {
            let mut camera = Preset {
                pitch: 38.0,
                yaw: 45.0,
            }
            .camera(scene.world, scene.metadata.height(), aspect);
            let yaw = self.view3d.spin_yaw.get_or_insert(camera.yaw);
            *yaw +=
                ui.input(|input| input.stable_dt).clamp(0.0, 0.1) * AUTO_SPIN_RADIANS_PER_SECOND;
            camera.yaw = *yaw;
            self.view3d.camera.current = camera;
            self.view3d.camera.target = camera;
            ui.ctx().request_repaint();
        } else if self.view3d.automatic {
            self.view3d.camera.current =
                preset.camera(scene.world, scene.metadata.height(), aspect);
            self.view3d.camera.target = self.view3d.camera.current;
        }
        if locate {
            let bounds = self.focus.unwrap_or(record.scene.objects["die"].bbox);
            if let Ok(world) = scene.metadata.rect(bounds) {
                let old = self.view3d.camera.current;
                let mut camera = Preset {
                    pitch: old.pitch.to_degrees(),
                    yaw: old.yaw.to_degrees(),
                }
                .camera(world, scene.metadata.height(), aspect);
                camera.distance /= self.zoom.max(0.2);
                self.view3d.camera.current = camera;
                self.view3d.automatic = false;
                self.view3d.auto_spin = false;
                self.view3d.spin_yaw = None;
            }
        }
        if response.dragged() {
            self.view3d.automatic = false;
            self.view3d.auto_spin = false;
            self.view3d.spin_yaw = None;
            let delta = ui.input(|i| i.pointer.delta());
            if response.dragged_by(egui::PointerButton::Secondary)
                || ui.input(|i| i.modifiers.shift)
            {
                self.view3d.camera.current.pan(delta.x, delta.y);
            } else {
                self.view3d
                    .camera
                    .current
                    .orbit(delta.x * 0.006, -delta.y * 0.006);
            }
        }
        if response.hovered() {
            let zoom = ui.input(|i| i.zoom_delta() * (i.smooth_scroll_delta.y * 0.002).exp());
            if (zoom - 1.0).abs() > 0.0001 {
                self.view3d.automatic = false;
                self.view3d.auto_spin = false;
                self.view3d.spin_yaw = None;
                self.view3d.camera.current.distance /= zoom;
            }
        }
        let mut camera = self.view3d.camera.current;
        camera.z_scale *= self.view3d.z_scale;
        let progress = self
            .reveal
            .progress()
            .unwrap_or_else(|| self.motion.progress());
        let Some(state) = &self.view3d.state else {
            return;
        };
        let uniform = CanvasUniform3d::from_camera(
            camera,
            aspect,
            [0.047, 0.07, 0.094, 1.0],
            false,
            false,
            scene.metadata.height() * self.view3d.z_cut,
            ShadingStyle::Normal,
            chip_display::LightingPreset::Studio,
            progress,
        );
        if self.view3d.filtered.is_none() && !self.view3d.hidden_layers.is_empty() {
            self.view3d.filtered = Some(std::sync::Arc::new(
                scene
                    .instances
                    .iter()
                    .filter(|i| !self.view3d.hidden_layers.contains(&(i._pad[0] as u16)))
                    .copied()
                    .collect(),
            ));
        }
        painter.add(egui_wgpu::Callback::new_paint_callback(
            rect,
            CanvasGpu3dCallback::<true> {
                uniform,
                instances: self
                    .view3d
                    .filtered
                    .clone()
                    .unwrap_or_else(|| scene.instances.clone()),
                instances_key: self.view3d.epoch,
                target_pixels: [
                    (rect.width() * ui.ctx().pixels_per_point()).max(1.0) as u32,
                    (rect.height() * ui.ctx().pixels_per_point()).max(1.0) as u32,
                ],
                target_format: state.target_format,
            },
        ));
        let project = |x: i64, y: i64, z: f32| -> Pos2 {
            let Ok(b) = scene.metadata.rect([x, y, x, y]) else {
                return Pos2::ZERO;
            };
            let p = camera.view_proj(aspect).transform_point([
                b.lx as f32,
                b.ly as f32,
                z * camera.z_scale,
                1.0,
            ]);
            Pos2::new(
                rect.center().x + p[0] / p[3] * rect.width() * 0.5,
                rect.center().y - p[1] / p[3] * rect.height() * 0.5,
            )
        };
        self.overlays3d(&painter, &project);
        if response.clicked() {
            self.view3d.automatic = false;
            self.view3d.auto_spin = false;
            self.view3d.spin_yaw = None;
            if let Some(pos) = response.interact_pointer_pos() {
                if let Some(ray) = camera.ray_from_screen(
                    [pos.x, pos.y],
                    [rect.left(), rect.top()],
                    [rect.width(), rect.height()],
                ) {
                    let picked = scene
                        .instances
                        .iter()
                        .zip(&scene.ids)
                        .filter_map(|(inst, id)| {
                            let id = id.as_ref()?;
                            if self.view3d.hidden_layers.contains(&(inst._pad[0] as u16))
                                || inst.z0 > uniform.z_cut
                                || (inst.animation[2] == 1.0 && progress <= inst.animation[0])
                            {
                                return None;
                            }
                            let b = crate::replay_scene3d::bounds_at(inst, progress);
                            ray.intersect_aabb(
                                Vec3::new(b[0], b[1], inst.z0 * camera.z_scale),
                                Vec3::new(b[2], b[3], inst.z1 * camera.z_scale),
                            )
                            .map(|d| (d, id))
                        })
                        .min_by(|a, b| a.0.total_cmp(&b.0));
                    self.selected_objects.clear();
                    if let Some((_, id)) = picked {
                        self.selected_objects.insert(id.clone());
                    }
                }
            }
        }
        if scene.simplified {
            painter.text(
                rect.left_top() + egui::vec2(8.0, 8.0),
                egui::Align2::LEFT_TOP,
                "Simplified background · zoom 2D to inspect",
                egui::FontId::proportional(12.0),
                Color32::LIGHT_YELLOW,
            );
        }
    }
}
pub fn outline(
    painter: &egui::Painter,
    project: &impl Fn(i64, i64, f32) -> Pos2,
    b: [i64; 4],
    z: f32,
    color: Color32,
    width: f32,
) {
    let points = vec![
        project(b[0], b[1], z),
        project(b[2], b[1], z),
        project(b[2], b[3], z),
        project(b[0], b[3], z),
    ];
    painter.add(egui::Shape::closed_line(points, Stroke::new(width, color)));
}
