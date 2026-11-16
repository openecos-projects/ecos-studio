#[path = "replay_canvas.rs"]
mod canvas;
#[path = "replay_focus.rs"]
mod focus;
#[path = "replay_playback.rs"]
mod playback;
#[path = "replay_sidebar.rs"]
mod sidebar;
#[cfg(all(test, target_os = "linux"))]
#[path = "replay_ui_validation.rs"]
mod ui_validation;
use crate::replay_data::{read, Catalog, Recording};
use crate::replay_maps::ReplayMaps;
use crate::replay_motion::Motion;
use crate::replay_plan::{self, StepPlan};
use crate::replay_reveal::Reveal;
use anyhow::{ensure, Context, Result};
use egui::{Color32, Pos2, Sense, Stroke};
use std::path::Path;
use std::time::Instant;

pub struct ReplayApp {
    catalog: Catalog,
    starts: Vec<f64>,
    total: f64,
    step: usize,
    position: f64,
    complete: bool,
    completion_node_selected: bool,
    recording: Option<Recording>,
    clock_tree: Option<crate::clock_tree::ClockTreePanel>,
    checklist: Option<Result<crate::replay_checklist::Checklist, String>>,
    clock_tree_error: String,
    clock_tree_attempted: bool,
    error: String,
    playing: bool,
    speed: f64,
    tick: Instant,
    zoom: f32,
    plans: Vec<StepPlan>,
    preparation: Option<std::sync::mpsc::Receiver<Vec<StepPlan>>>,
    active_clip: Option<usize>,
    loader: crate::replay_loader::Loader,
    pending: Option<(u64, usize, Option<usize>)>,
    #[cfg(test)]
    prepare_timings_ms: [f64; 4],
    checked: Instant,
    maps: ReplayMaps,
    analysis: crate::replay_analysis::ReplayAnalysis,
    logic: Option<crate::replay_logic::Logic>,
    smooth: bool,
    motion: Motion,
    reveal: Reveal,
    focus: Option<[i64; 4]>,
    scene_index: crate::replay_index::SceneIndex,
    canvas_cache: crate::replay_batch::CanvasCache,
    gpu_format: Option<wgpu::TextureFormat>,
    gpu_animation_limit: usize,
    selected_objects: std::collections::BTreeSet<String>,
}

impl ReplayApp {
    pub fn configure_renderer(&mut self, cc: &eframe::CreationContext<'_>) {
        if let Some(state) = &cc.wgpu_render_state {
            let limits = state.device.limits();
            if limits.max_storage_buffers_per_shader_stage > 0 {
                self.gpu_format = Some(state.target_format);
                self.gpu_animation_limit = limits.max_storage_buffer_binding_size as usize;
            }
        }
    }

    fn check_flow(&self) -> Result<()> {
        let flow: serde_json::Value = read(&self.catalog.workspace.join("home/flow.json"))?;
        let steps = flow["steps"].as_array().context("Missing flow steps")?;
        ensure!(
            !steps
                .iter()
                .any(|s| s["state"] == "Ongoing" || s["state"] == "Running"),
            "Flow is running. Reopen Replay after completion."
        );
        if self.catalog.steps[self.step].manifest.is_some() {
            ensure!(
                steps
                    .iter()
                    .any(|s| s["name"] == self.catalog.steps[self.step].name
                        && (s["state"] == "Success"
                            || (s["state"] == "Incomplete"
                                && self
                                    .recording
                                    .as_ref()
                                    .is_none_or(|r| r.manifest.diagnostic_only)))),
                "This step result is no longer current. Rerun and reopen Replay."
            );
        }
        Ok(())
    }
    pub fn open(path: &Path) -> Result<Self> {
        let catalog: Catalog = read(path)?;
        ensure!(
            catalog.schema == "ecos.replay.catalog.v1" && !catalog.steps.is_empty(),
            "Invalid Replay catalog"
        );
        for step in &catalog.steps {
            ensure!(
                step.seconds.is_finite() && step.seconds >= 0.0,
                "Invalid step duration"
            );
        }
        let preparation = Some(replay_plan::prepare(&catalog));
        let starts = vec![0.0; catalog.steps.len()];
        let total = 0.0;
        let app = Self {
            catalog,
            focus: None,
            scene_index: Default::default(),
            canvas_cache: Default::default(),
            gpu_format: None,
            gpu_animation_limit: 0,
            selected_objects: Default::default(),
            starts,
            total,
            step: 0,
            position: 0.0,
            complete: false,
            completion_node_selected: false,
            recording: None,
            clock_tree: None,
            checklist: None,
            clock_tree_error: String::new(),
            clock_tree_attempted: false,
            error: String::new(),
            playing: false,
            speed: 1.0,
            tick: Instant::now(),
            zoom: 1.0,
            plans: Vec::new(),
            preparation,
            active_clip: None,
            loader: Default::default(),
            pending: None,
            #[cfg(test)]
            prepare_timings_ms: [0.0; 4],
            checked: Instant::now(),
            maps: ReplayMaps::default(),
            analysis: Default::default(),
            logic: None,
            smooth: true,
            motion: Motion::default(),
            reveal: Reveal::default(),
        };
        Ok(app)
    }

    fn timeline(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if ui
                .button(if self.playing { "Pause" } else { "Play" })
                .clicked()
            {
                if self.position >= self.total {
                    self.select(0, 0.0, false);
                }
                self.playing = !self.playing;
                self.tick = Instant::now();
            }
            let (rect, response) = ui.allocate_exact_size(
                egui::vec2((ui.available_width() - 100.0).max(40.0), 40.0),
                Sense::click_and_drag(),
            );
            let y = rect.center().y;
            let total = self.total;
            let x = |t: f64| rect.left() + (t / total.max(0.001)) as f32 * rect.width();
            ui.painter().line_segment(
                [Pos2::new(rect.left(), y), Pos2::new(rect.right(), y)],
                Stroke::new(4.0, Color32::from_gray(65)),
            );
            ui.painter().line_segment(
                [Pos2::new(rect.left(), y), Pos2::new(x(self.position), y)],
                Stroke::new(4.0, Color32::from_rgb(251, 114, 153)),
            );
            let mut nodes = Vec::new();
            for (i, step) in self.catalog.steps.iter().enumerate() {
                nodes.push((
                    self.starts[i] + self.plans[i].seconds,
                    i,
                    None,
                    format!(
                        "{} · completed · display {:.1}s · execution {:.3}s",
                        step.name, self.plans[i].seconds, step.seconds
                    ),
                ));
                for node in &step.nodes {
                    nodes.push((
                        self.starts[i] + self.plans[i].display_at_source(node.seconds),
                        i,
                        Some(node.seconds),
                        format!("{} · {}", step.name, node.label),
                    ));
                }
                if x(self.starts[i] + self.plans[i].seconds) - x(self.starts[i]) > 70.0 {
                    ui.painter().text(
                        Pos2::new(x(self.starts[i] + self.plans[i].seconds / 2.0), y + 16.0),
                        egui::Align2::CENTER_CENTER,
                        &step.name,
                        egui::FontId::proportional(10.0),
                        Color32::LIGHT_GRAY,
                    );
                }
            }
            for (time, _, source, _) in &nodes {
                let center = Pos2::new(x(*time), y);
                ui.painter().circle_filled(
                    center,
                    if source.is_none() { 5.5 } else { 2.5 },
                    Color32::from_rgb(237, 179, 198),
                );
            }
            ui.painter()
                .circle_filled(Pos2::new(x(self.position), y), 4.0, Color32::WHITE);
            // Overlapping zero-duration nodes remain individually reachable.
            response.context_menu(|ui| {
                for (time, step, source, label) in &nodes {
                    if ui.button(label).clicked() {
                        self.playing = false;
                        self.select_node(*step, *time, *source);
                        ui.close_menu();
                    }
                }
            });
            if response.dragged() || response.clicked() {
                if let Some(pos) = response.interact_pointer_pos() {
                    if let Some((time, step, source, _)) = nodes
                        .iter()
                        .filter(|(t, _, _, _)| (x(*t) - pos.x).abs() <= 6.0)
                        .min_by(|a, b| (x(a.0) - pos.x).abs().total_cmp(&(x(b.0) - pos.x).abs()))
                    {
                        self.playing = false;
                        self.select_node(*step, *time, *source);
                    } else {
                        let t = ((pos.x - rect.left()) / rect.width()).clamp(0.0, 1.0) as f64
                            * self.total;
                        let i = self
                            .starts
                            .iter()
                            .rposition(|start| *start <= t)
                            .unwrap_or(0);
                        self.playing = false;
                        self.select(i, t, t >= self.total);
                    }
                }
            }
            if let Some(pos) = response.hover_pos() {
                if let Some((_, _, _, label)) = nodes
                    .iter()
                    .min_by(|a, b| (x(a.0) - pos.x).abs().total_cmp(&(x(b.0) - pos.x).abs()))
                {
                    response.on_hover_text(label);
                }
            }
            egui::ComboBox::from_id_salt("speed")
                .selected_text(format!("{}×", self.speed))
                .show_ui(ui, |ui| {
                    for speed in [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 32.0, 64.0] {
                        ui.selectable_value(&mut self.speed, speed, format!("{speed}×"));
                    }
                });
        });
        ui.label(format!(
            "{} · {}   Display {:.1}s / {:.1}s · Step execution {:.3}s · Right-click for nodes",
            self.catalog.steps[self.step].name,
            if self.complete {
                "Completed result"
            } else {
                "Captured process"
            },
            self.position,
            self.total,
            self.catalog.steps[self.step].seconds
        ));
    }
}

impl eframe::App for ReplayApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let Some(receiver) = &self.preparation {
            match receiver.try_recv() {
                Ok(plans) => {
                    self.plans = plans;
                    self.preparation = None;
                    self.total = 0.0;
                    for (i, plan) in self.plans.iter().enumerate() {
                        self.starts[i] = self.total;
                        self.total += plan.seconds;
                    }
                    self.select(0, 0.0, false);
                    self.tick = Instant::now();
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    egui::CentralPanel::default().show(ctx, |ui| {
                        ui.heading("Preparing Layout Replay");
                        ui.spinner();
                        ui.label("Finding layout changes and arranging playback…");
                    });
                    ctx.request_repaint_after(std::time::Duration::from_millis(50));
                    return;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    egui::CentralPanel::default().show(ctx, |ui| {
                        ui.label("Replay preparation failed. Close and reopen Replay.");
                    });
                    return;
                }
            }
        }
        self.poll_loader();
        self.maps.poll();
        if self.pending.is_some() || self.maps.loading() {
            ctx.request_repaint_after(std::time::Duration::from_millis(16));
        }
        let now = Instant::now();
        let delta = (now - self.tick).as_secs_f64().min(0.2);
        self.tick = now;
        if now.duration_since(self.checked).as_secs_f64() >= 1.0 {
            self.checked = now;
            if let Err(error) = self.check_flow() {
                self.error = error.to_string();
                self.recording = None;
                self.clock_tree = None;
                self.clock_tree_attempted = false;
                self.playing = false;
                self.clear_animation();
            }
            if let Some(recording) = &self.recording {
                if let Err(error) = recording.check_current() {
                    self.error = error.to_string();
                    self.recording = None;
                    self.clock_tree = None;
                    self.clock_tree_error.clear();
                    self.clock_tree_attempted = false;
                    self.playing = false;
                    self.clear_animation();
                }
            }
        }
        ctx.request_repaint_after(std::time::Duration::from_secs(1));
        if self.playing {
            self.advance_playback(delta);
            ctx.request_repaint();
        }
        egui::TopBottomPanel::top("replay_title").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Layout Replay");
                if self.pending.is_some() {
                    ui.spinner();
                    ui.label("Loading captured changes…");
                }
                let detail = self
                    .recording
                    .as_ref()
                    .and_then(|recording| recording.manifest.geometry_detail.as_deref())
                    .unwrap_or("physical_bounds");
                ui.label(if detail == "report_only" {
                    "Recorded reports · no physical geometry"
                } else {
                    "Recorded data · physical bounds"
                });
                if ui.button("Fit").clicked() {
                    self.zoom = 1.0;
                }
                if self.recording.is_some() {
                    if ui
                        .checkbox(&mut self.smooth, "Animate captured changes")
                        .changed()
                    {
                        self.active_clip = None;
                        self.select(self.step, self.position, false);
                    }
                    if self.motion.active() {
                        ui.label("Interpolated movement between captured positions");
                    } else if self.reveal.active() {
                        ui.label(format!("{} · sampled batch animation", self.reveal.label()));
                    }
                }
                if self.recording.is_some() && ui.button("Play from step start").clicked() {
                    self.select(self.step, self.starts[self.step], false);
                    self.playing = true;
                    self.tick = Instant::now();
                }
            });
        });
        egui::TopBottomPanel::bottom("replay_time").show(ctx, |ui| self.timeline(ui));
        self.result_sidebar(ctx);
        egui::CentralPanel::default().show(ctx, |ui| {
            if self.recording.as_ref().is_some_and(|recording| {
                recording.manifest.geometry_detail.as_deref() == Some("report_only")
            }) {
                if let Some(logic) = &self.logic {
                    logic.show(ui);
                } else if self.complete {
                    self.analysis.report(ui);
                } else {
                    ui.centered_and_justified(|ui| {
                        ui.label("Recorded logical/report progress");
                    });
                }
            } else {
                self.canvas(ui);
            }
        });
    }
}
