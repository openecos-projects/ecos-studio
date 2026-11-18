//! Small progress snapshots; geometry and validation stay on the worker thread.
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
pub struct Progress {
    state: Arc<Mutex<State>>,
    started: Instant,
}
#[derive(Default, Clone)]
struct State {
    step: usize,
    steps: usize,
    name: String,
    phase: String,
    frame: usize,
    frames: usize,
}
impl Default for Progress {
    fn default() -> Self {
        Self {
            state: Default::default(),
            started: Instant::now(),
        }
    }
}
impl Progress {
    pub fn step(&self, step: usize, steps: usize, name: &str) {
        *self.state.lock().unwrap() = State {
            step,
            steps,
            name: name.into(),
            phase: "Opening recording".into(),
            ..Default::default()
        };
    }
    pub fn phase(&self, phase: &str) {
        let mut state = self.state.lock().unwrap();
        state.phase = phase.into();
        state.frame = 0;
        state.frames = 0;
    }
    pub fn frame(&self, frame: usize, frames: usize) {
        let mut state = self.state.lock().unwrap();
        if state.frames == 0 {
            state.phase = "Finding layout changes".into();
        }
        state.frame = frame;
        state.frames = frames;
    }
    pub fn show(&self, ctx: &egui::Context, phase: Option<&str>) -> egui::Rect {
        let state = self.state.lock().unwrap().clone();
        egui::Modal::new(egui::Id::new("replay_loading"))
            .show(ctx, |ui| {
                ui.set_width((ctx.screen_rect().width() - 64.0).clamp(200.0, 420.0));
                ui.set_height(228.0);
                ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Truncate);
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.heading("Preparing Layout Replay");
                });
                ui.add_space(16.0);
                ui.label(if state.steps > 0 {
                    format!(
                        "{}  ·  Step {} of {}",
                        state.name,
                        state.step + 1,
                        state.steps
                    )
                } else {
                    "Preparing your workspace".into()
                });
                ui.add(
                    egui::ProgressBar::new(state.step as f32 / state.steps.max(1) as f32)
                        .text(format!("{} / {} steps prepared", state.step, state.steps)),
                );
                ui.add_space(8.0);
                ui.label(phase.unwrap_or(&state.phase));
                ui.small(if phase.is_none() && state.frames > 0 {
                    format!("{} / {} frames inspected", state.frame, state.frames)
                } else {
                    "Frames: —".into()
                });
                ui.separator();
                ui.small(format!(
                    "Elapsed {:.0}s · large designs may take longer",
                    self.started.elapsed().as_secs_f64()
                ));
                ui.small("Preparing recorded changes, layers and analysis views.");
                ui.add_space(10.0);
            })
            .response
            .rect
    }

    /// Atomic, compact status for the Studio-owned loading dialog.
    pub fn publish(&self, path: &Path, ready: bool) -> anyhow::Result<()> {
        let state = self.state.lock().unwrap().clone();
        let json = serde_json::json!({
            "state": if ready { "ready" } else { "loading" },
            "phase": state.phase, "name": state.name,
            "step": if state.steps > 0 { state.step + 1 } else { 0 },
            "steps": state.steps, "frame": state.frame, "frames": state.frames,
        });
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, serde_json::to_vec(&json)?)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn progress_tracks_frames_and_resets_for_the_next_stage() {
        let progress = Progress::default();
        let worker = progress.clone();
        worker.step(2, 5, "place");
        worker.frame(4, 10);
        {
            let s = progress.state.lock().unwrap();
            assert_eq!((s.step, s.steps, s.frame, s.frames), (2, 5, 4, 10));
        }
        worker.phase("Preparing result views");
        assert_eq!(progress.state.lock().unwrap().frames, 0);
        worker.step(3, 5, "route");
        let s = progress.state.lock().unwrap();
        assert_eq!((s.name.as_str(), s.frame, s.frames), ("route", 0, 0));
    }

    #[test]
    fn loading_dialog_bounds_do_not_change_with_phase_or_counts() {
        let ctx = egui::Context::default();
        let progress = Progress::default();
        let mut bounds = egui::Rect::NOTHING;
        let mut draw = || {
            for _ in 0..3 {
                let _ = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(egui::Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(1280.0, 720.0),
                        )),
                        ..Default::default()
                    },
                    |ctx| {
                        bounds = progress.show(ctx, None);
                    },
                );
            }
            bounds
        };
        let initial = draw();
        progress.step(
            11,
            22,
            "route with a very long step name that must not resize the dialog",
        );
        progress.frame(12345, 99999);
        assert_eq!(draw(), initial);
        progress.phase("Loading the first layout");
        assert_eq!(draw(), initial);
    }
}
