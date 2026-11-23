//! Background snapshot reload state machine.
//!
//! Reopening a snapshot blocks on disk I/O plus several full-dataset scans, so
//! reloads run on a worker thread and only the prepared-result handoff, the
//! atomic database swap, and the trigger-specific follow-up run on the UI
//! thread in [`LoadedViewer::poll_reload`]. While a reload is in flight the
//! previous database keeps rendering unchanged.

use super::*;

/// In-flight background snapshot reload started by a reload trigger.
pub(super) struct PendingReload {
    started_at: Instant,
    receiver: Receiver<Result<PreparedViewer, String>>,
    completion: ReloadCompletion,
}

impl PendingReload {
    /// Opens the snapshot and rebuilds the derived viewer data off the UI
    /// thread, resolving the returned channel with the prepared result.
    pub(super) fn start(manifest_path: PathBuf, completion: ReloadCompletion) -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let result = ChipViewDb::open(&manifest_path)
                .map(PreparedViewer::from)
                .map_err(|err| err.to_string());
            let _ = sender.send(result);
        });
        Self {
            started_at: Instant::now(),
            receiver,
            completion,
        }
    }

    pub(super) fn started_at(&self) -> Instant {
        self.started_at
    }
}

/// What a reload trigger wants to happen after the refreshed geometry is
/// swapped in; success and failure outcomes both run on the UI thread once
/// the background open resolves.
pub(super) enum ReloadCompletion {
    /// Report the outcome through `last_edit_result` (toolbar / external
    /// file-watch refresh).
    Notify {
        success_message: String,
        failure_prefix: &'static str,
    },
    /// Finish the pending layout edit whose result requested the reload.
    EditResult {
        result: GeometryEditResult,
        message: String,
    },
    /// Finish a save/discard session action and optionally close the window.
    SessionAction {
        result: SessionActionResult,
        expected_action: SessionActionKind,
        expected_command_id: u64,
        close_after: bool,
    },
}

impl ReloadCompletion {
    pub(super) fn notify(success_message: &str, failure_prefix: &'static str) -> Self {
        Self::Notify {
            success_message: success_message.to_string(),
            failure_prefix,
        }
    }

    fn apply_success(self, viewer: &mut LoadedViewer) -> bool {
        match self {
            ReloadCompletion::Notify {
                success_message, ..
            } => {
                viewer.last_edit_result = Some(success_message);
                false
            }
            ReloadCompletion::EditResult { result, message } => {
                viewer.finish_macro_edit_result(&result);
                if matches!(
                    result.status,
                    GeometryEditStatus::Accepted | GeometryEditStatus::AdjustedAccepted
                ) {
                    viewer.session_dirty = true;
                }
                viewer.last_edit_result = Some(message);
                viewer.pending_edit = None;
                false
            }
            ReloadCompletion::SessionAction {
                result,
                expected_action,
                expected_command_id,
                close_after,
            } => {
                viewer.session_dirty = false;
                viewer.close_confirmation_visible = false;
                let message = session_action_result_message(&result);
                viewer.last_edit_result = Some(message.clone());
                viewer.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Completed,
                    100,
                    message,
                ));
                close_after
            }
        }
    }

    fn apply_failure(self, viewer: &mut LoadedViewer, err: String) {
        match self {
            ReloadCompletion::Notify { failure_prefix, .. } => {
                viewer.last_edit_result = Some(format!("{failure_prefix}: {err}"));
            }
            ReloadCompletion::EditResult { .. } => {
                viewer.last_edit_result = Some(format!("failed to reload geometry: {err}"));
                viewer.pending_edit = None;
            }
            ReloadCompletion::SessionAction {
                result,
                expected_action,
                expected_command_id,
                ..
            } => {
                let message = format!(
                    "{} completed but geometry reload failed: {err}",
                    result.action.label()
                );
                viewer.last_edit_result = Some(message.clone());
                viewer.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
            }
        }
    }
}

impl LoadedViewer {
    /// Completes an in-flight background reload when the worker has finished:
    /// swaps the prepared snapshot in atomically and runs the follow-up the
    /// trigger requested. Returns true only when a completed save/discard
    /// asked the window to close.
    pub(super) fn poll_reload(&mut self) -> bool {
        let Some(pending) = self.pending_reload.as_ref() else {
            return false;
        };
        let result = match pending.receiver.try_recv() {
            Ok(result) => result,
            Err(mpsc::TryRecvError::Empty) => return false,
            Err(mpsc::TryRecvError::Disconnected) => {
                Err("geometry reload stopped before returning a result".to_string())
            }
        };
        let pending = self
            .pending_reload
            .take()
            .expect("pending reload presence checked above");
        match result {
            Ok(prepared) => {
                self.replace_db(prepared);
                pending.completion.apply_success(self)
            }
            Err(err) => {
                pending.completion.apply_failure(self, err);
                false
            }
        }
    }

    /// Paints a small banner while a background reload is in flight so the
    /// upcoming swap does not look like a frozen viewer.
    pub(super) fn paint_reload_indicator(
        &self,
        ui: &egui::Ui,
        painter: &egui::Painter,
        canvas: egui::Rect,
    ) {
        let Some(reload) = &self.pending_reload else {
            return;
        };
        ui.ctx().request_repaint();
        painter.text(
            egui::pos2(canvas.center().x, canvas.top() + 24.0),
            egui::Align2::CENTER_TOP,
            format!(
                "refreshing snapshot... {:.1}s",
                reload.started_at().elapsed().as_secs_f32()
            ),
            egui::FontId::proportional(13.0),
            ecos_info_text(),
        );
    }
}
