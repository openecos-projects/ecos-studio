//! Close handling for layout-edit sessions whose Electron host may have exited.
//!
//! Save and discard commands travel through a filesystem bridge consumed by
//! ECOS Studio. A detached Chip Viewer can outlive that consumer, so a close
//! request must never become an indefinitely pending operation. The viewer
//! therefore keeps unsaved edits protected by default while exposing explicit
//! wait-cancellation and close-without-saving recovery actions.

use super::*;

/// Controls shown while a save/discard request is pending or has failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SessionActionRecoveryActions {
    pub(super) can_stop_waiting: bool,
    pub(super) can_close_without_saving: bool,
}

pub(super) fn session_action_recovery_actions(
    phase: SessionActionProgressPhase,
    close_confirmation_visible: bool,
) -> SessionActionRecoveryActions {
    SessionActionRecoveryActions {
        can_stop_waiting: !phase.is_terminal() && close_confirmation_visible,
        can_close_without_saving: phase == SessionActionProgressPhase::Failed
            && close_confirmation_visible,
    }
}

impl LoadedViewer {
    /// Returns true when a close event still needs the unsaved-edit dialog.
    pub(super) fn should_intercept_unsaved_close(&self) -> bool {
        self.session_dirty && !self.close_without_session_action
    }

    /// Abandons the pending host request but keeps the local edits untouched.
    pub(super) fn stop_waiting_for_session_action(&mut self) {
        self.pending_session_action = None;
        self.session_action_progress = None;
        self.close_after_session_action = false;
        self.close_confirmation_visible = true;
        self.last_edit_result = Some(
            "Stopped waiting for ECOS Studio. Save is unavailable while it is closed.".to_string(),
        );
    }

    /// Allows the next native close event to bypass the unavailable host.
    ///
    /// This intentionally leaves `session_dirty` unchanged because it only
    /// drops the in-memory edit session when the native window exits.
    pub(super) fn prepare_close_without_session_action(&mut self) {
        self.pending_session_action = None;
        self.pending_reload = None;
        self.session_action_progress = None;
        self.close_confirmation_visible = false;
        self.close_after_session_action = false;
        self.close_without_session_action = true;
    }

    pub(super) fn show_close_confirmation(&mut self, ctx: &egui::Context) {
        if !self.close_confirmation_visible || self.pending_session_action.is_some() {
            return;
        }
        let save_blocker = macro_save_blocker(self.macro_staging.as_ref());

        egui::Window::new("Unsaved layout edits")
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(360.0);
                ui.label("Save or discard the pending layout edits before closing.");
                if let Some(blocker) = &save_blocker {
                    ui.add_space(6.0);
                    ui.add(
                        egui::Label::new(
                            egui::RichText::new(blocker).small().color(ecos_warning()),
                        )
                        .wrap(),
                    );
                }
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Keep editing").clicked() {
                        self.close_confirmation_visible = false;
                    }
                    if ui.button("Discard").clicked() {
                        self.request_session_action(SessionActionKind::Discard, true);
                    }
                    let save = ui
                        .add_enabled(save_blocker.is_none(), egui::Button::new("Save"))
                        .on_disabled_hover_text(
                            save_blocker.as_deref().unwrap_or("Save is unavailable"),
                        );
                    if save.clicked() {
                        self.request_session_action(SessionActionKind::Save, true);
                    }
                });
                ui.add_space(8.0);
                ui.separator();
                ui.add_space(4.0);
                ui.label(
                    egui::RichText::new(
                        "If ECOS Studio is no longer running, close this window without applying the edits. Local changes will be lost.",
                    )
                    .small()
                    .color(ecos_text_secondary()),
                );
                if ui
                    .button(
                        egui::RichText::new("Close without saving")
                            .color(ecos_warning()),
                    )
                    .clicked()
                {
                    self.prepare_close_without_session_action();
                }
            });
    }

    pub(super) fn show_session_action_progress(&mut self, ctx: &egui::Context) {
        let Some(progress) = self.session_action_progress.clone() else {
            return;
        };
        let title = session_action_progress_title(progress.action, progress.phase);
        let mut dismiss = false;
        let mut stop_waiting = false;
        let mut close_without_saving = false;
        let recovery =
            session_action_recovery_actions(progress.phase, self.close_confirmation_visible);
        egui::Window::new(title)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(360.0);
                ui.set_max_width(460.0);
                ui.label(egui::RichText::new(progress.phase.label()).strong());
                ui.add_space(8.0);
                let progress_bar = egui::ProgressBar::new(progress.fraction())
                    .show_percentage()
                    .animate(!progress.phase.is_terminal());
                ui.add(if progress.phase == SessionActionProgressPhase::Failed {
                    progress_bar.fill(egui::Color32::from_rgb(220, 80, 80))
                } else {
                    progress_bar
                });
                ui.add_space(6.0);
                ui.label(&progress.message);
                if !progress.phase.is_terminal() {
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        ui.spinner();
                        ui.label("This window updates until the operation finishes.");
                    });
                    if recovery.can_stop_waiting {
                        ui.add_space(8.0);
                        ui.separator();
                        ui.add_space(4.0);
                        ui.label(
                            egui::RichText::new(
                                "ECOS Studio is not responding. Stop waiting if it was closed.",
                            )
                            .small()
                            .color(ecos_warning()),
                        );
                        if ui.button("Stop waiting").clicked() {
                            stop_waiting = true;
                        }
                    }
                } else {
                    ui.add_space(8.0);
                    // A bare right-to-left layout consumes all remaining
                    // height in a vertically laid-out window. Keep the action
                    // row compact so the completed dialog remains auto-sized.
                    ui.horizontal(|ui| {
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.button("Close").clicked() {
                                dismiss = true;
                            }
                            if recovery.can_close_without_saving
                                && ui
                                    .button(
                                        egui::RichText::new("Close without saving")
                                            .color(ecos_warning()),
                                    )
                                    .clicked()
                            {
                                close_without_saving = true;
                            }
                        });
                    });
                }
            });
        if close_without_saving {
            self.prepare_close_without_session_action();
        } else if stop_waiting {
            self.stop_waiting_for_session_action();
        } else if dismiss {
            self.session_action_progress = None;
        }
    }
}
