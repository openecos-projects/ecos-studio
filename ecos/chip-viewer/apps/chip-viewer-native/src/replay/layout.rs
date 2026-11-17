//! Layout composition independent of geometry preparation and playback.
use super::ReplayApp;
use egui::Color32;

impl ReplayApp {
    pub(super) fn main_views(&mut self, ui: &mut egui::Ui) {
        if self.view3d.enabled {
            ui.columns(2, |columns| {
                self.layout2d(&mut columns[0]);
                self.layout3d(&mut columns[1]);
            });
        } else {
            self.layout2d(ui);
        }
    }
    fn layout2d(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.strong("2D LAYOUT");
            ui.weak(if self.view3d.enabled {
                "Synchronized"
            } else {
                "2D"
            });
            if ui.small_button("Fit").clicked() {
                self.zoom = 1.0;
                self.focus = None;
                self.selected_objects.clear();
            }
        });
        ui.separator();
        let rect = ui.available_rect_before_wrap();
        if self
            .recording
            .as_ref()
            .is_some_and(|r| r.manifest.geometry_detail.as_deref() == Some("report_only"))
        {
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
        self.paint_caption(ui, rect);
    }
    fn layout3d(&mut self, ui: &mut egui::Ui) {
        let completed = self.complete && self.pending.is_none() && self.error.is_empty();
        let tree = completed && (self.clock_tree.is_some() || !self.clock_tree_error.is_empty());
        let analysis = completed
            && (self.maps.len() > 0 || self.analysis.len() > 0 || !self.analysis.error.is_empty());
        if tree || analysis {
            // Reserve only a compact header when collapsed. The canvas reclaims
            // the rest immediately, without changing the display clock.
            let title = if tree { "Clock tree" } else { "Analysis views" };
            let height = (ui.available_height() * 0.32).clamp(180.0, 285.0);
            egui::TopBottomPanel::bottom("replay_auxiliary")
                .resizable(self.auxiliary_open)
                .default_height(if self.auxiliary_open { height } else { 30.0 })
                .height_range(if self.auxiliary_open {
                    170.0..=350.0
                } else {
                    30.0..=30.0
                })
                .show_inside(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.strong(title);
                        if ui
                            .small_button(if self.auxiliary_open {
                                "Collapse"
                            } else {
                                "Expand"
                            })
                            .clicked()
                        {
                            self.auxiliary_open = !self.auxiliary_open;
                        }
                    });
                    if !self.auxiliary_open {
                        return;
                    }
                    if tree {
                        self.clock_dock(ui);
                    } else {
                        egui::ScrollArea::vertical()
                            .id_salt("replay_dock_analysis")
                            .show(ui, |ui| self.analysis_controls(ui));
                    }
                });
        }
        self.canvas3d(ui);
    }
    pub(super) fn clock_dock(&mut self, ui: &mut egui::Ui) {
        if !self.clock_tree_error.is_empty() {
            ui.small(&self.clock_tree_error);
        }
        if !self.clock_overlay.error.is_empty() {
            ui.colored_label(Color32::LIGHT_YELLOW, &self.clock_overlay.error);
        }
        if self.clock_overlay.missing > 0 {
            ui.colored_label(
                Color32::LIGHT_YELLOW,
                format!(
                    "{} branches have no verified geometry",
                    self.clock_overlay.missing
                ),
            );
        }
        if let Some(tree) = &mut self.clock_tree {
            if let Some(target) = tree.embedded_ui(ui) {
                self.focus_clock_target(target);
            }
        }
    }
    pub(super) fn live_information(&mut self, ui: &mut egui::Ui) {
        let time = self
            .recording
            .as_ref()
            .and_then(|r| {
                r.scene.revision.map(|i| {
                    let end = r.manifest.frames[i].elapsed_ns;
                    if (self.motion.active() || self.reveal.active()) && i > 0 {
                        let start = r.manifest.frames[i - 1].elapsed_ns;
                        let fraction = self
                            .reveal
                            .progress()
                            .unwrap_or_else(|| self.motion.progress());
                        start + ((end - start) as f64 * f64::from(fraction)) as u64
                    } else {
                        end
                    }
                })
            })
            .unwrap_or(0);
        self.log.show(
            ui,
            &self.catalog.steps[self.step].name,
            time,
            self.complete && self.pending.is_none(),
            &mut self.analysis_open,
        );
    }
}
