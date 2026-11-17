//! Completion results displayed below the 2D explanation, without a popup.
use super::ReplayApp;
use serde_json::Value;

#[derive(Default)]
pub(super) struct CompletionResults {
    key: Option<(usize, String)>,
    pub metrics: Vec<Value>,
    receiver: Option<std::sync::mpsc::Receiver<Vec<Value>>>,
}
impl ReplayApp {
    pub(super) fn update_completion_results(&mut self, ctx: &egui::Context) {
        if !self.complete {
            self.completion_results = Default::default();
            return;
        }
        let Some(record) = &self.recording else {
            return;
        };
        if self.pending.is_some() || !self.error.is_empty() || record.manifest.diagnostic_only {
            return;
        }
        let step_name = &self.catalog.steps[self.step].name;
        let key = (self.step, record.manifest.attempt_id.clone());
        let state = &mut self.completion_results;
        let changed = state.key.as_ref() != Some(&key);
        state.key = Some(key);
        if changed {
            let source = if record.manifest.results_frozen {
                &record.manifest.result_metrics
            } else {
                &self.catalog.steps[self.step].metrics
            };
            state.metrics = crate::replay::step_metrics::select(step_name, source);
            state.receiver = self.catalog.steps[self.step].manifest.as_ref().map(|path| {
                crate::replay::step_metrics::prepare(&self.catalog.workspace, path, step_name)
            });
        }
        if let Some(receiver) = &state.receiver {
            match receiver.try_recv() {
                Ok(metrics) => {
                    if !metrics.is_empty() {
                        state.metrics = metrics;
                    }
                    state.receiver = None;
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    ctx.request_repaint();
                    return;
                }
                Err(_) => {
                    state.receiver = None;
                }
            }
        }
    }
}
