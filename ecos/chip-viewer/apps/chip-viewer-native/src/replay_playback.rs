use super::ReplayApp;
use crate::replay_data::Recording;
use crate::replay_maps::ReplayMaps;
use crate::replay_plan::{Kind, MAP_SECONDS, RESULT_SECONDS};
use anyhow::{ensure, Result};

impl ReplayApp {
    pub(super) fn clear_animation(&mut self) {
        self.motion.clear();
        self.reveal.clear();
        self.active_clip = None;
    }

    pub(super) fn select_node(&mut self, step: usize, seconds: f64, source: Option<f64>) {
        self.select(step, seconds, source.is_none());
        if let Some(source) = source {
            // A node inspects an exact recorded state, even when several idle
            // boundaries collapse to one display position.
            self.complete = false;
            self.clear_animation();
            self.maps.clear_selection();
            if let Some(recording) = &mut self.recording {
                if let Some(frame) = self.plans[step].frame_at_source(source) {
                    if let Err(error) = recording.seek_frame(frame) {
                        self.error = error.to_string();
                        self.recording = None;
                    }
                } else {
                    recording.scene = Default::default();
                }
            }
        }
    }

    pub(super) fn select(&mut self, step: usize, seconds: f64, completion_node: bool) {
        self.position = seconds.clamp(
            self.starts[step],
            self.starts[step] + self.plans[step].seconds,
        );
        let local = self.position - self.starts[step];
        self.complete = completion_node || local >= self.plans[step].process_seconds;
        if self.step != step || self.recording.is_none() {
            self.step = step;
            self.clear_animation();
            self.clock_tree = None;
            self.clock_tree_error.clear();
            self.clock_tree_attempted = false;
            self.checklist = None;
            self.maps = ReplayMaps::default();
            self.recording = None;
            self.error.clone_from(&self.plans[step].error);
            if self.error.is_empty() {
                if let Some(path) = &self.catalog.steps[step].manifest {
                    let opened = (|| -> Result<Recording> {
                        self.check_flow()?;
                        let recording = Recording::open(&self.catalog.workspace, path)?;
                        ensure!(
                            self.plans[step].attempt_id.as_deref()
                                == Some(&recording.manifest.attempt_id),
                            "Replay changed during preparation. Reopen after completion."
                        );
                        Ok(recording)
                    })();
                    match opened {
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
        }
        if let Err(error) = self.sample(local) {
            self.error = error.to_string();
            self.recording = None;
            self.clock_tree = None;
            self.playing = false;
            self.clear_animation();
        }
        if !self.error.is_empty() {
            self.playing = false;
        }
        if self.complete && !self.clock_tree_attempted {
            self.clock_tree_attempted = true;
            if let Some(recording) = &self.recording {
                match recording.clock_tree().and_then(|tree| {
                    tree.map(|tree| crate::clock_tree::ClockTreePanel::from_snapshot(&tree))
                        .transpose()
                }) {
                    Ok(tree) => self.clock_tree = tree,
                    Err(error) => self.clock_tree_error = error.to_string(),
                }
            }
        }
        if self.complete && self.error.is_empty() && self.checklist.is_none() {
            self.checklist = Some(
                crate::replay_checklist::load(
                    &self.catalog.workspace,
                    &self.catalog.steps[step].name,
                )
                .map_err(|error| error.to_string()),
            );
        }
        if self.complete {
            let hold = if completion_node {
                0.0
            } else {
                local - self.plans[step].process_seconds
            };
            if hold >= RESULT_SECONDS && self.maps.len() > 0 {
                let index = ((hold - RESULT_SECONDS) / MAP_SECONDS) as usize;
                self.maps.select(index.min(self.maps.len() - 1));
            } else {
                self.maps.clear_selection();
            }
        } else {
            self.maps.clear_selection();
        }
    }

    fn sample(&mut self, local: f64) -> Result<()> {
        let clip_index = if self.complete {
            None
        } else {
            self.plans[self.step].clip_at(local)
        };
        let Some(recording) = &mut self.recording else {
            return Ok(());
        };
        let Some(index) = clip_index else {
            recording.seek_frame(recording.manifest.frames.len() - 1)?;
            self.clear_animation();
            return Ok(());
        };
        let clip = &self.plans[self.step].clips[index];
        if self.active_clip != Some(index) {
            recording.check_current()?;
            self.motion.clear();
            self.reveal.clear();
            if self.smooth && clip.kind != Kind::Hold {
                if let Some(previous) = clip.frame.checked_sub(1) {
                    recording.seek_frame(previous)?;
                } else {
                    recording.scene = Default::default();
                }
                let before = recording.scene.clone();
                // One scene copy per clip, never per interpolated display frame.
                recording
                    .scene
                    .apply(recording.delta(clip.frame)?)
                    .map_err(anyhow::Error::msg)?;
                match clip.kind {
                    Kind::Motion => {
                        self.motion
                            .begin(&before, &recording.scene, &recording.manifest.frames)
                    }
                    Kind::Reveal => {
                        self.reveal
                            .begin(&before, &recording.scene, &recording.manifest.frames)
                    }
                    Kind::Hold => {}
                }
            } else {
                recording.seek_frame(clip.frame)?;
            }
            self.active_clip = Some(index);
        }
        let progress = ((local - clip.start) / (clip.end - clip.start)).clamp(0.0, 1.0);
        self.motion.set_progress(progress);
        self.reveal.set_progress(progress);
        Ok(())
    }

    pub(super) fn advance_playback(&mut self, delta: f64) {
        if !self.playing {
            return;
        }
        // All transitions, result holds and maps use this same display clock.
        let end = self.starts[self.step] + self.plans[self.step].seconds;
        let next = (self.position + delta * self.speed).min(end);
        if self.position >= end {
            if self.step + 1 < self.plans.len() {
                self.select(self.step + 1, end, false);
            } else {
                self.playing = false;
            }
        } else {
            self.select(self.step, next, false);
        }
    }
}

#[cfg(test)]
#[path = "replay_playback_tests.rs"]
mod tests;
