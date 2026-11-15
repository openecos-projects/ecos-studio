#[path = "replay_canvas.rs"]
mod canvas;
#[path = "replay_playback.rs"]
mod playback;
use crate::replay_data::{read, Catalog, Recording};
use crate::replay_maps::ReplayMaps;
use crate::replay_motion::Motion;
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
    recording: Option<Recording>,
    error: String,
    playing: bool,
    speed: f64,
    tick: Instant,
    zoom: f32,
    result_hold: f64,
    checked: Instant,
    maps: ReplayMaps,
    smooth: bool,
    motion: Motion,
    reveal: Reveal,
}

impl ReplayApp {
    fn check_flow(&self) -> Result<()> {
        let flow: serde_json::Value = read(&self.catalog.workspace.join("home/flow.json"))?;
        let steps = flow["steps"].as_array().context("Missing flow steps")?;
        ensure!(
            !steps.iter().any(|s| s["state"] == "Ongoing"),
            "Flow is running. Reopen Replay after completion."
        );
        if self.recording.is_some() {
            ensure!(
                steps
                    .iter()
                    .any(|s| s["name"] == self.catalog.steps[self.step].name
                        && s["state"] == "Success"),
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
        let mut total = 0.0;
        let mut starts = Vec::new();
        for step in &catalog.steps {
            ensure!(
                step.seconds.is_finite() && step.seconds >= 0.0,
                "Invalid step duration"
            );
            starts.push(total);
            total += step.seconds;
        }
        let mut app = Self {
            catalog,
            starts,
            total,
            step: 0,
            position: 0.0,
            complete: false,
            recording: None,
            error: String::new(),
            playing: false,
            speed: 1.0,
            tick: Instant::now(),
            zoom: 1.0,
            result_hold: 0.0,
            checked: Instant::now(),
            maps: ReplayMaps::default(),
            smooth: true,
            motion: Motion::default(),
            reveal: Reveal::default(),
        };
        app.select(0, 0.0, false);
        Ok(app)
    }

    fn select(&mut self, step: usize, seconds: f64, complete: bool) {
        self.clear_animation();
        if self.step != step || self.complete != complete {
            self.result_hold = 0.0;
        }
        self.position = seconds.clamp(0.0, self.total);
        self.complete = complete;
        self.error.clear();
        if step != self.step || self.recording.is_none() {
            self.step = step;
            self.recording = None;
            self.maps = ReplayMaps::default();
            if let Some(path) = &self.catalog.steps[step].manifest {
                match Recording::open(&self.catalog.workspace, path) {
                    Ok(recording) => {
                        match recording.map_root() {
                            Ok(Some(root)) => self.maps = ReplayMaps::open(&root),
                            Err(error) => self.maps.error = error.to_string(),
                            _ => {}
                        }
                        self.recording = Some(recording);
                    }
                    Err(error) => self.error = error.to_string(),
                }
            }
        }
        if let Some(recording) = &mut self.recording {
            if let Err(error) = recording.seek(self.position - self.starts[step], complete) {
                self.error = error.to_string();
                self.recording = None;
                self.playing = false;
            }
        }
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
                self.clear_animation();
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
                    self.starts[i] + step.seconds,
                    i,
                    true,
                    format!("{} · completed", step.name),
                ));
                for node in &step.nodes {
                    nodes.push((
                        self.starts[i] + node.seconds,
                        i,
                        false,
                        format!("{} · {}", step.name, node.label),
                    ));
                }
                if x(self.starts[i] + step.seconds) - x(self.starts[i]) > 70.0 {
                    ui.painter().text(
                        Pos2::new(x(self.starts[i] + step.seconds / 2.0), y + 16.0),
                        egui::Align2::CENTER_CENTER,
                        &step.name,
                        egui::FontId::proportional(10.0),
                        Color32::LIGHT_GRAY,
                    );
                }
            }
            for (time, _, complete, _) in &nodes {
                let center = Pos2::new(x(*time), y);
                ui.painter().circle_filled(
                    center,
                    if *complete { 5.5 } else { 2.5 },
                    Color32::from_rgb(237, 179, 198),
                );
            }
            ui.painter()
                .circle_filled(Pos2::new(x(self.position), y), 4.0, Color32::WHITE);
            // Overlapping zero-duration nodes remain individually reachable.
            response.context_menu(|ui| {
                for (time, step, complete, label) in &nodes {
                    if ui.button(label).clicked() {
                        self.playing = false;
                        self.select(*step, *time, *complete);
                        ui.close_menu();
                    }
                }
            });
            if response.dragged() || response.clicked() {
                if let Some(pos) = response.interact_pointer_pos() {
                    if let Some((time, step, complete, _)) = nodes
                        .iter()
                        .filter(|(t, _, _, _)| (x(*t) - pos.x).abs() <= 6.0)
                        .min_by(|a, b| (x(a.0) - pos.x).abs().total_cmp(&(x(b.0) - pos.x).abs()))
                    {
                        self.playing = false;
                        self.select(*step, *time, *complete);
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
            "{} · {}   {:.1}s / {:.1}s · Right-click the bar to locate overlapping nodes",
            self.catalog.steps[self.step].name,
            if self.complete {
                "Completed result"
            } else {
                "Captured process"
            },
            self.position,
            self.total
        ));
    }
}

impl eframe::App for ReplayApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let now = Instant::now();
        let delta = (now - self.tick).as_secs_f64().min(0.2);
        self.tick = now;
        if now.duration_since(self.checked).as_secs_f64() >= 1.0 {
            self.checked = now;
            if let Err(error) = self.check_flow() {
                self.error = error.to_string();
                self.recording = None;
                self.playing = false;
                self.clear_animation();
            }
            if let Some(recording) = &self.recording {
                if let Err(error) = recording.check_current() {
                    self.error = error.to_string();
                    self.recording = None;
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
                ui.label("Recorded data · physical bounds");
                if ui.button("Fit").clicked() {
                    self.zoom = 1.0;
                }
                let name = self.catalog.steps[self.step].name.as_str();
                if matches!(
                    name,
                    "place" | "preFloorplan" | "macroPlacement" | "postFloorplan"
                ) {
                    let label = if name == "place" {
                        "Smooth movement"
                    } else {
                        "Animate generation"
                    };
                    if ui.checkbox(&mut self.smooth, label).changed() {
                        self.clear_animation();
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
        egui::SidePanel::right("replay_results")
            .default_width(250.0)
            .show(ctx, |ui| {
                ui.heading(&self.catalog.steps[self.step].name);
                if let Some(r) = &self.recording {
                    if let Some(index) = r.scene.revision {
                        let f = &r.manifest.frames[index];
                        ui.label(&f.phase);
                        ui.small(&f.state_domain);
                        ui.label(format!("Frame {} / {}", index + 1, r.manifest.frames.len()));
                        ui.label(format!("Touched objects: {}", r.scene.touched.len()));
                        for (k, v) in &f.metrics {
                            ui.label(format!("{k}: {v}"));
                        }
                    }
                    ui.small(format!(
                        "Capture {:.2}s",
                        r.manifest.duration_ns as f64 / 1e9
                    ));
                }
                ui.separator();
                if self.complete && self.error.is_empty() {
                    self.maps.controls(ui);
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        for metric in &self.catalog.steps[self.step].metrics {
                            ui.label(format!(
                                "{}: {} {}",
                                metric["display_name"]
                                    .as_str()
                                    .or(metric["id"].as_str())
                                    .unwrap_or("metric"),
                                metric["value"],
                                metric["unit"].as_str().unwrap_or("")
                            ));
                            if let Some(value) = metric["value"].as_f64() {
                                if let Some((name, previous)) = self.catalog.steps[..self.step]
                                    .iter()
                                    .rev()
                                    .find_map(|step| {
                                        step.metrics
                                            .iter()
                                            .find(|m| {
                                                m["id"] == metric["id"]
                                                    && m["unit"] == metric["unit"]
                                            })
                                            .and_then(|m| m["value"].as_f64())
                                            .map(|v| (&step.name, v))
                                    })
                                {
                                    ui.small(format!("Δ {:+.3} vs {name}", value - previous));
                                }
                            }
                        }
                    });
                } else {
                    ui.label("Final reports become visible at the completion node.");
                }
            });
        egui::CentralPanel::default().show(ctx, |ui| self.canvas(ui));
    }
}
