use super::ReplayApp;

impl ReplayApp {
    pub(super) fn result_sidebar(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("replay_results")
            .default_width(420.0)
            .width_range(320.0..=700.0)
            .show(ctx, |ui| {
                // Reserve a separate bottom area so long maps/metrics cannot
                // push the checklist off screen.
                egui::TopBottomPanel::bottom("replay_checklist")
                    .resizable(true)
                    .default_height(165.0)
                    .height_range(100.0..=280.0)
                    .show_inside(ui, |ui| {
                        ui.strong("Step checklist");
                        if self.complete && self.pending.is_none() && self.error.is_empty() {
                            match &self.checklist {
                                Some(Ok(checklist)) => checklist.show(ui),
                                Some(Err(error)) => {
                                    ui.label(format!("Checklist unavailable: {error}"));
                                }
                                None => {
                                    ui.label("No checklist recorded for this step.");
                                }
                            }
                        } else {
                            ui.small("Available at the step completion node.");
                        }
                    });
                ui.heading(&self.catalog.steps[self.step].name);
                if let Some(recording) = &self.recording {
                    if recording.manifest.diagnostic_only {
                        ui.colored_label(
                            egui::Color32::LIGHT_RED,
                            "Diagnostic only · step did not complete successfully",
                        );
                    }
                    if let Some(capability) = recording.manifest.capabilities["geometry"].as_str() {
                        ui.small(match capability {
                            "sampled_process" => "Captured process samples",
                            "final_diff" => "Captured input/output changes",
                            _ => "Captured analysis results",
                        });
                    }
                    if let Some(index) = recording.scene.revision {
                        let frame = &recording.manifest.frames[index];
                        ui.label(&frame.phase);
                        ui.small(format!(
                            "Frame {} / {} · {} touched objects",
                            index + 1,
                            recording.manifest.frames.len(),
                            recording.scene.touched.len()
                        ));
                        if !self.complete {
                            crate::replay_events::show(ui, &frame.metrics);
                        }
                    }
                    ui.small(format!(
                        "Execution {:.2}s",
                        recording.manifest.duration_ns as f64 / 1e9
                    ));
                }
                ui.separator();
                if !self.complete || self.pending.is_some() || !self.error.is_empty() {
                    ui.label("Final reports become visible at the completion node.");
                    return;
                }
                if self.maps.controls(ui) {
                    self.playing = false;
                }
                let (changed, focus) = self.analysis.controls(ui);
                if changed {
                    self.playing = false;
                    self.maps.clear_selection();
                }
                if let Some(bounds) = focus {
                    self.focus_bounds(bounds);
                }
                if let Some(tree) = &mut self.clock_tree {
                    ui.strong("Clock tree");
                    let height = (ui.available_height() * 0.72)
                        .max(260.0)
                        .min(ui.available_height());
                    let action = ui
                        .allocate_ui(egui::vec2(ui.available_width(), height), |ui| {
                            tree.embedded_ui(ui)
                        })
                        .inner;
                    if let Some(target) = action {
                        self.focus_clock_target(target);
                    }
                } else if !self.clock_tree_error.is_empty() {
                    ui.label(format!("Clock tree unavailable: {}", self.clock_tree_error));
                }
                ui.separator();
                if let Some(recording) = &self.recording {
                    ui.small(format!(
                        "{} touched · {} deleted · {} restored",
                        recording.scene.touched.len(),
                        recording.scene.deleted.len(),
                        recording.scene.restored.len()
                    ));
                }
                if self.focus.is_some() && ui.button("Show full layout").clicked() {
                    self.focus = None;
                    self.zoom = 1.0;
                    self.selected_objects.clear();
                }
                ui.strong("Performance metrics");
                egui::ScrollArea::vertical()
                    .id_salt("replay_result_metrics")
                    .auto_shrink([false, false])
                    .show(ui, |ui| self.result_metrics(ui));
            });
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
            if let Some((delta, name)) = crate::replay_metrics::comparison(metric) {
                ui.small(format!("Δ {delta:+.3} vs {name}"));
            }
        }
    }
}
