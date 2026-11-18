//! Offline flow replay: capture loading, playback, rendering and analysis.
mod analysis;
pub(crate) mod analysis_data;
mod batch;
mod cache;
mod camera_plan;
mod canvas;
mod caption;
mod checklist;
mod clock;
mod dashboard;
pub(crate) mod data;
mod events;
mod focus;
mod geometry_analysis;
mod gpu_animation;
mod gpu_mesh;
mod index;
pub(crate) mod integrity;
mod ir;
#[cfg(all(test, target_os = "linux"))]
mod ir_validation;
mod layout;
mod loader;
mod log;
mod log_scroll;
mod logic;
mod map_loader;
mod maps;
mod metrics;
mod motion;
mod navigation;
mod overlays3d;
mod plan;
mod playback;
mod rcx;
mod reveal;
mod route;
mod scene3d;
mod sidebar;
mod signoff_cards;
mod step_metrics;
mod timing;
#[cfg(all(test, target_os = "linux"))]
mod ui_validation;
#[cfg(test)]
mod validation_tests;
#[path = "canvas3d.rs"]
mod view3d;
mod widgets;
use crate::replay::data::{read, Catalog, Recording};
use crate::replay::maps::ReplayMaps;
use crate::replay::motion::Motion;
use crate::replay::plan::StepPlan;
use crate::replay::reveal::Reveal;
use anyhow::{ensure, Context, Result};
use egui::{Color32, Pos2, Sense, Stroke};
use std::path::Path;
use std::time::Instant;

mod completion_results;

pub struct ReplayApp {
    catalog: Catalog,
    dashboard: Option<crate::replay::dashboard::Dashboard>,
    dashboard_loading: Option<std::sync::mpsc::Receiver<crate::replay::dashboard::Dashboard>>,
    completion_results: completion_results::CompletionResults,
    log: crate::replay::log::ReplayLog,
    maximize_on_open: bool,
    analysis_open: bool,
    auxiliary_open: bool,
    starts: Vec<f64>,
    total: f64,
    step: usize,
    position: f64,
    navigation_node: Option<(usize, usize)>,
    complete: bool,
    completion_node_selected: bool,
    recording: Option<Recording>,
    clock_overlay: crate::replay::clock::ClockOverlay,
    clock_tree: Option<crate::clock_tree::ClockTreePanel>,
    checklist: Option<Result<crate::replay::checklist::Checklist, String>>,
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
    loader: crate::replay::loader::Loader,
    pending: Option<(u64, usize, Option<usize>)>,
    #[cfg(test)]
    prepare_timings_ms: [f64; 4],
    checked: Instant,
    maps: ReplayMaps,
    analysis: crate::replay::analysis::ReplayAnalysis,
    route_overlay: crate::replay::route::RouteOverlay,
    logic: Option<crate::replay::logic::Logic>,
    smooth: bool,
    motion: Motion,
    reveal: Reveal,
    focus: Option<[i64; 4]>,
    scene_index: crate::replay::index::SceneIndex,
    canvas_cache: crate::replay::batch::CanvasCache,
    gpu_format: Option<wgpu::TextureFormat>,
    gpu_animation_limit: usize,
    view3d: view3d::View3d,
    camera_exact: bool,
    selected_objects: std::collections::BTreeSet<String>,
}

impl ReplayApp {
    fn harden_replay_complete(&self) -> bool {
        self.complete
            && self.pending.is_none()
            && self.error.is_empty()
            && self.catalog.steps[self.step]
                .name
                .eq_ignore_ascii_case("harden")
    }

    fn show_harden_signoff(&self) -> bool {
        self.harden_replay_complete() && self.dashboard.as_ref().is_some_and(|data| !data.stale)
    }

    pub fn configure_renderer(&mut self, cc: &eframe::CreationContext<'_>) {
        self.view3d.configure(cc);
        if let Some(state) = &cc.wgpu_render_state {
            let limits = state.device.limits();
            if limits.max_storage_buffers_per_shader_stage > 0 {
                self.gpu_format = Some(state.target_format);
                self.gpu_animation_limit = limits.max_storage_buffer_binding_size as usize;
                self.view3d.enabled = true;
                self.view3d.automatic = false;
                self.view3d.auto_spin = true;
                self.view3d.spin_yaw = Some(45.0_f32.to_radians());
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
        let preparation = Some(plan::prepare(&catalog));
        let starts = vec![0.0; catalog.steps.len()];
        let total = 0.0;
        let dashboard_loading = Some(crate::replay::dashboard::prepare(&catalog));
        let app = Self {
            dashboard_loading,
            dashboard: None,
            completion_results: Default::default(),
            log: Default::default(),
            maximize_on_open: true,
            analysis_open: false,
            auxiliary_open: true,
            catalog,
            focus: None,
            scene_index: Default::default(),
            canvas_cache: Default::default(),
            gpu_format: None,
            gpu_animation_limit: 0,
            selected_objects: Default::default(),
            view3d: Default::default(),
            camera_exact: false,
            starts,
            total,
            step: 0,
            position: 0.0,
            navigation_node: None,
            complete: false,
            completion_node_selected: false,
            recording: None,
            clock_overlay: Default::default(),
            clock_tree: None,
            checklist: None,
            clock_tree_error: String::new(),
            clock_tree_attempted: false,
            error: String::new(),
            playing: false,
            speed: 1.0,
            tick: Instant::now(),
            zoom: 0.82,
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
            route_overlay: Default::default(),
            logic: None,
            smooth: true,
            motion: Motion::default(),
            reveal: Reveal::default(),
        };
        Ok(app)
    }

    fn timeline(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            let (rect, response) = ui.allocate_exact_size(
                egui::vec2(ui.available_width().max(40.0), 40.0),
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
                        self.starts[i]
                            + node
                                .sequence
                                .and_then(|frame| self.plans[i].display_at_frame(frame))
                                .unwrap_or_else(|| self.plans[i].display_at_source(node.seconds)),
                        i,
                        Some((node.seconds, node.sequence)),
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
                        self.select_node_frame(*step, *time, *source);
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
                        self.select_node_frame(*step, *time, *source);
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
        });
        self.playback_controls(ui);
    }
}

impl eframe::App for ReplayApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Some X11 window managers ignore the builder's pre-map maximize hint.
        // Apply once after opening; subsequent manual window resizing is respected.
        if self.maximize_on_open {
            ctx.send_viewport_cmd(egui::ViewportCommand::Maximized(true));
            self.maximize_on_open = false;
        }
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
        if let Some(receiver) = &self.dashboard_loading {
            match receiver.try_recv() {
                Ok(data) => {
                    self.dashboard = Some(data);
                    self.dashboard_loading = None;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    let mut data = crate::replay::dashboard::Dashboard::default();
                    data.errors
                        .push("Result loading failed; reopen Replay".into());
                    self.dashboard = Some(data);
                    self.dashboard_loading = None;
                }
                _ => {
                    ctx.request_repaint_after(std::time::Duration::from_millis(50));
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
            if let Some(data) = &mut self.dashboard {
                data.check_current();
            }
            if let Err(error) = self.check_flow() {
                self.error = error.to_string();
                self.recording = None;
                self.clock_tree = None;
                self.clock_overlay = Default::default();
                self.clock_tree_attempted = false;
                self.playing = false;
                self.clear_animation();
            }
            if let Some(recording) = &self.recording {
                if let Err(error) = recording.check_current() {
                    self.error = error.to_string();
                    self.recording = None;
                    self.clock_tree = None;
                    self.clock_overlay = Default::default();
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
                let mut enabled = self.view3d.enabled;
                if ui.checkbox(&mut enabled, "Sync 3D").changed() {
                    self.set_three_d(enabled);
                }
                if ui.button("Fit").clicked() {
                    self.zoom = 1.0;
                }
                if !self.view3d.enabled && !self.view3d.error.is_empty() {
                    ui.small(&self.view3d.error);
                }
                if self.recording.is_some() {
                    if ui
                        .checkbox(&mut self.smooth, "Animate captured changes")
                        .changed()
                    {
                        self.active_clip = None;
                        self.select(self.step, self.position, false);
                    }
                }
                if self.recording.is_some() && ui.button("Play from step start").clicked() {
                    self.select(self.step, self.starts[self.step], false);
                    self.playing = true;
                    self.tick = Instant::now();
                }
            });
        });
        egui::TopBottomPanel::bottom("replay_time")
            .exact_height(160.0)
            .resizable(false)
            .show(ctx, |ui| {
                egui::ScrollArea::vertical()
                    .id_salt("replay_live_information")
                    .min_scrolled_height(0.0)
                    .max_height(68.0)
                    .auto_shrink([false, false])
                    .show(ui, |ui| self.live_information(ui));
                ui.separator();
                self.timeline(ui);
            });
        self.update_completion_results(ctx);
        self.result_sidebar(ctx);
        egui::CentralPanel::default().show(ctx, |ui| self.main_views(ui));
        if self.show_harden_signoff() {
            if let Some(data) = &self.dashboard {
                data.show_signoff_cards(ctx);
            }
        }
        self.analysis_window(ctx);
    }
}
