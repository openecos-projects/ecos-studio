use super::ReplayApp;
use crate::replay_data::Recording;
use crate::replay_maps::ReplayMaps;
use crate::replay_plan::{Kind, MAP_SECONDS, RESULT_SECONDS};
use anyhow::{ensure, Result};

impl ReplayApp {
    pub(super) fn clear_animation(&mut self) {
        self.canvas_cache = Default::default();
        self.view3d.scene = None;
        self.loader.cancel();
        self.pending = None;
        self.motion.clear();
        self.reveal.clear();
        self.active_clip = None;
    }

    #[cfg(test)]
    pub(super) fn select_node(&mut self, step: usize, seconds: f64, source: Option<f64>) {
        self.select_node_frame(step, seconds, source.map(|time| (time, None)));
    }

    pub(super) fn select_node_frame(
        &mut self,
        step: usize,
        seconds: f64,
        source: Option<(f64, Option<usize>)>,
    ) {
        if source.is_none()
            && matches!(
                self.catalog.steps[step].name.as_str(),
                "sta" | "powerAnalysis"
            )
        {
            self.playing = true;
            self.select_at(
                step,
                self.starts[step] + self.plans[step].process_seconds + RESULT_SECONDS,
                false,
                None,
                None,
            );
            return;
        }
        self.select_at(
            step,
            seconds,
            source.is_none(),
            source.map(|s| s.0),
            source.and_then(|s| s.1),
        );
    }

    pub(super) fn clock_progress(&self) -> Option<f64> {
        if !self.complete || self.pending.is_some() || !self.error.is_empty() {
            return None;
        }
        Some(if self.completion_node_selected {
            1.0
        } else {
            ((self.position - self.starts[self.step] - self.plans[self.step].process_seconds) / 1.4)
                .clamp(0.0, 1.0)
        })
    }

    pub(super) fn select(&mut self, step: usize, seconds: f64, completion_node: bool) {
        self.select_at(step, seconds, completion_node, None, None);
    }

    fn select_at(
        &mut self,
        step: usize,
        seconds: f64,
        completion_node: bool,
        source: Option<f64>,
        sequence: Option<usize>,
    ) {
        self.completion_node_selected = completion_node;
        self.camera_exact = source.is_some() || completion_node;
        self.position = seconds.clamp(
            self.starts[step],
            self.starts[step] + self.plans[step].seconds,
        );
        let local = self.position - self.starts[step];
        self.complete =
            source.is_none() && (completion_node || local >= self.plans[step].process_seconds);
        if self.step != step || self.recording.is_none() {
            self.loader.cancel();
            self.pending = None;
            self.step = step;
            self.focus = None;
            self.selected_objects.clear();
            self.clear_animation();
            self.clock_tree = None;
            self.clock_overlay = Default::default();
            self.clock_tree_error.clear();
            self.clock_tree_attempted = false;
            self.checklist = None;
            self.maps = ReplayMaps::default();
            self.analysis = Default::default();
            self.route_overlay = Default::default();
            self.logic = None;
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
                        let flow: serde_json::Value = crate::replay_data::read(
                            &self.catalog.workspace.join("home/flow.json"),
                        )?;
                        let expected = if recording.manifest.diagnostic_only {
                            "Incomplete"
                        } else {
                            "Success"
                        };
                        ensure!(
                            flow["steps"].as_array().is_some_and(|steps| steps
                                .iter()
                                .any(|item| item["name"] == self.catalog.steps[step].name
                                    && item["state"] == expected)),
                            "Replay result and flow state disagree"
                        );
                        Ok(recording)
                    })();
                    match opened {
                        Ok(recording) => {
                            self.recording = Some(recording);
                        }
                        Err(error) => self.error = error.to_string(),
                    }
                }
            }
        }
        let sample = if let Some(source) = source {
            // Exact nodes submit only their own sample, never a speculative
            // animated request that would immediately be canceled.
            // Keep the previous rendered frame while the exact target loads.
            // Clearing its mesh here would rebuild it only to discard it again
            // when the worker returns the requested scene.
            self.loader.cancel();
            self.pending = None;
            if let Some(frame) = sequence.or_else(|| self.plans[step].frame_at_source(source)) {
                self.request_frame(frame, None, true)
            } else {
                self.clear_animation();
                if let Some(recording) = &mut self.recording {
                    recording.scene = Default::default();
                }
                Ok(())
            }
        } else {
            self.sample(local)
        };
        if let Err(error) = sample {
            self.error = error.to_string();
            self.recording = None;
            self.clock_tree = None;
            self.clock_overlay = Default::default();
            self.playing = false;
            self.clear_animation();
        }
        if !self.error.is_empty() {
            self.playing = false;
        }
        if !self.complete {
            self.maps.clear_selection();
            self.analysis.clear();
        }
        if self.pending.is_some() {
            return;
        }
        if self.complete && self.error.is_empty() && self.checklist.is_none() {
            self.checklist = self.recording.as_ref().map(|recording| {
                crate::replay_checklist::Checklist::from_recording(
                    recording,
                    &self.catalog.workspace,
                    &self.catalog.steps[step].name,
                )
                .map_err(|error| error.to_string())
            });
        }
        if self.complete {
            let hold = if completion_node {
                0.0
            } else {
                local - self.plans[step].process_seconds
            };
            if let Some(recording) = &self.recording {
                self.analysis.resolve(&recording.scene);
            }
            self.analysis.clear();
            if hold >= RESULT_SECONDS && self.maps.len() + self.analysis.len() > 0 {
                let index = ((hold - RESULT_SECONDS) / MAP_SECONDS) as usize;
                if index < self.maps.len() {
                    self.maps.select(index);
                } else {
                    self.maps.clear_selection();
                    self.analysis.auto_select_time(
                        hold - RESULT_SECONDS - self.maps.len() as f64 * MAP_SECONDS,
                    );
                }
            } else {
                self.maps.clear_selection();
            }
        } else {
            self.maps.clear_selection();
            self.analysis.clear();
        }
    }

    fn sample(&mut self, local: f64) -> Result<()> {
        let clip_index = if self.complete {
            None
        } else {
            self.plans[self.step].clip_at(local)
        };
        let Some(recording) = &self.recording else {
            return Ok(());
        };
        let frame = clip_index.map_or(recording.manifest.frames.len() - 1, |index| {
            self.plans[self.step].clips[index].frame
        });
        self.request_frame(frame, clip_index, false)?;
        self.update_progress(local);
        Ok(())
    }

    pub(super) fn request_frame(
        &mut self,
        frame: usize,
        clip: Option<usize>,
        exact: bool,
    ) -> Result<()> {
        let Some(recording) = &self.recording else {
            return Ok(());
        };
        if self
            .pending
            .as_ref()
            .is_some_and(|(_, target, pending_clip)| *target == frame && *pending_clip == clip)
        {
            return Ok(());
        }
        if self.pending.is_none()
            && !self.view3d.needs_prepare
            && !exact
            && !(self.complete && !self.clock_tree_attempted)
            && recording.scene.revision == Some(frame)
            && self.active_clip == clip
        {
            return Ok(());
        }
        let kind = clip.map_or(Kind::Hold, |index| self.plans[self.step].clips[index].kind);
        let token = self.loader.submit(crate::replay_loader::Request {
            workspace: self.catalog.workspace.clone(),
            manifest: self.catalog.steps[self.step].manifest.clone().unwrap(),
            attempt: recording.manifest.attempt_id.clone(),
            frame,
            kind,
            animate: self.smooth && !exact && clip.is_some(),
            results: self.complete && !self.clock_tree_attempted,
            three_d_budget: self.view3d.enabled.then_some(self.view3d.budget),
        })?;
        self.pending = Some((token, frame, clip));
        Ok(())
    }

    fn update_progress(&mut self, local: f64) {
        if let Some(index) = self.active_clip {
            let clip = &self.plans[self.step].clips[index];
            let progress = ((local - clip.start) / (clip.end - clip.start)).clamp(0.0, 1.0);
            self.motion.set_progress(progress);
            self.reveal.set_progress(progress);
        }
    }

    pub(super) fn poll_loader(&mut self) {
        while let Some(reply) = self.loader.poll() {
            let Some((token, _, clip)) = self.pending else {
                continue;
            };
            if token != reply.generation {
                continue;
            }
            self.pending = None;
            match reply.result {
                Ok(prepared) => {
                    self.canvas_cache = Default::default();
                    let crate::replay_loader::Prepared {
                        scene,
                        three_d,
                        mut route_overlay,
                        motion,
                        reveal,
                        index,
                        logic,
                        results,
                        #[cfg(test)]
                        timings_ms,
                    } = prepared;
                    #[cfg(test)]
                    {
                        self.prepare_timings_ms = timings_ms;
                    }
                    self.view3d.accept(three_d);
                    route_overlay.inherit_selection(&self.route_overlay);
                    self.route_overlay = route_overlay;
                    self.logic = logic;
                    if let Some(results) = results {
                        self.clock_overlay = results.clock_overlay;
                        self.maps = results.maps;
                        self.analysis = results.analysis;
                        self.clock_tree_attempted = true;
                        match results.tree {
                            Ok(tree) => self.clock_tree = tree,
                            Err(error) => self.clock_tree_error = error,
                        }
                    }
                    if let Some(recording) = &mut self.recording {
                        recording.scene = scene;
                    }
                    self.scene_index = index;
                    self.motion = motion;
                    self.reveal = reveal;
                    self.active_clip = clip;
                    self.update_progress(self.position - self.starts[self.step]);
                    if self.complete {
                        self.select(self.step, self.position, self.completion_node_selected);
                    }
                }
                Err(error) => {
                    self.recording = None;
                    self.clock_tree = None;
                    self.clock_overlay = Default::default();
                    self.error = error;
                    self.playing = false;
                    self.clear_animation();
                }
            }
        }
    }

    #[cfg(test)]
    fn finish_loading_for_test(&mut self) {
        let started = std::time::Instant::now();
        while self.pending.is_some() || self.maps.loading() {
            self.poll_loader();
            self.maps.poll();
            assert!(started.elapsed().as_secs() < 5, "Replay seek timed out");
            std::thread::yield_now();
        }
    }

    pub(super) fn advance_playback(&mut self, delta: f64) {
        if !self.playing || self.pending.is_some() || self.maps.loading() {
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
