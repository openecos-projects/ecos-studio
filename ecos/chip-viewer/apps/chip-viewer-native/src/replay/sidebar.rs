//! The right column is reserved for final QoR and the complete checklist.
use super::ReplayApp;

impl ReplayApp {
    pub(super) fn result_sidebar(&mut self, ctx: &egui::Context) {
        if self.show_harden_signoff() {
            return;
        }
        let width = ctx.screen_rect().width();
        egui::SidePanel::right("replay_dashboard")
            .default_width((width * 0.20).max(210.0))
            .width_range(190.0..=(width * 0.30).max(210.0))
            .resizable(true)
            .show(ctx, |ui| {
                if let Some(data) = &mut self.dashboard {
                    data.show(
                        ui,
                        self.step,
                        self.complete && self.pending.is_none() && self.error.is_empty(),
                        self.step + 1 == self.catalog.steps.len(),
                    );
                } else {
                    ui.heading("QoR / Checklist");
                    ui.spinner();
                    ui.label("Loading recorded results…");
                }
            });
    }

    pub(super) fn analysis_window(&mut self, ctx: &egui::Context) {
        if !self.analysis_open {
            return;
        }
        let mut open = self.analysis_open;
        egui::Window::new("Replay analysis")
            .open(&mut open)
            .default_width(390.0)
            .default_height(450.0)
            .resizable(true)
            .vscroll(true)
            .show(ctx, |ui| {
                if !self.complete || self.pending.is_some() || !self.error.is_empty() {
                    ui.label("Process observations");
                    if let Some(record) = &self.recording {
                        if let Some(index) = record.scene.revision {
                            crate::replay::events::show(ui, &record.manifest.frames[index].metrics);
                        }
                    }
                    if self.pending.is_none() {
                        self.route_overlay.controls(ui);
                    }
                    return;
                }
                if !self.view3d.enabled && self.clock_tree.is_some() {
                    ui.collapsing("Clock tree", |ui| {
                        ui.allocate_ui(egui::vec2(ui.available_width(), 350.0), |ui| {
                            self.clock_dock(ui)
                        });
                    });
                }
                self.analysis_controls(ui);
                ui.separator();
                if self.focus.is_some() && ui.button("Show full layout").clicked() {
                    self.focus = None;
                    self.zoom = 1.0;
                    self.selected_objects.clear();
                }
                ui.strong("Performance metrics");
                self.result_metrics(ui);
            });
        self.analysis_open = open;
    }

    pub(super) fn analysis_controls(&mut self, ui: &mut egui::Ui) {
        if self.maps.controls(ui) {
            self.playing = false;
        }
        let (changed, focus) = self.analysis.controls(ui);
        if changed {
            self.playing = false;
            self.maps.clear_selection();
        }
        if let Some(time) = self.analysis.requested_time.take() {
            let position = self.starts[self.step]
                + self.plans[self.step].process_seconds
                + crate::replay::plan::RESULT_SECONDS
                + self.maps.len() as f64 * crate::replay::plan::MAP_SECONDS
                + time;
            self.select(self.step, position, false);
            self.playing = true;
        }
        if let Some(bounds) = focus {
            self.focus_bounds(bounds);
        }
    }

    fn result_metrics(&self, ui: &mut egui::Ui) {
        let metrics = self
            .recording
            .as_ref()
            .filter(|r| r.manifest.results_frozen)
            .map(|r| &r.manifest.result_metrics)
            .unwrap_or(&self.catalog.steps[self.step].metrics);
        for metric in metrics {
            ui.label(format!(
                "{}: {} {}",
                metric["display_name"]
                    .as_str()
                    .or(metric["id"].as_str())
                    .unwrap_or("metric"),
                metric["value"],
                metric["unit"].as_str().unwrap_or("")
            ));
            if let Some((delta, name)) = crate::replay::metrics::comparison(metric) {
                ui.small(format!("Δ {delta:+.3} vs {name}"));
            }
        }
    }
}
