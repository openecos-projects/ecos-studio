use super::ReplayApp;

impl ReplayApp {
    pub(super) fn clear_animation(&mut self) {
        self.motion.clear();
        self.reveal.clear();
    }
    pub(super) fn advance_playback(&mut self, delta: f64) {
        let end = self.starts[self.step] + self.catalog.steps[self.step].seconds;
        if self.complete {
            self.result_hold += delta;
            if self.result_hold >= 1.0 && self.maps.len() > 0 {
                self.maps
                    .select(((self.result_hold - 1.0) / 2.0) as usize % self.maps.len());
            }
            if self.result_hold >= 1.0 + self.maps.len() as f64 * 2.0 {
                if self.step + 1 < self.catalog.steps.len() {
                    self.select(self.step + 1, end, false);
                } else {
                    self.playing = false;
                }
            }
        } else if self.motion.active() || self.reveal.active() {
            // Hold the recorded cursor while displaying the transition.
            // Do not catch up and skip samples after a slow draw/load.
            self.motion.advance(delta);
            self.reveal.advance(delta);
        } else {
            let mut next = (self.position + delta * self.speed).min(end);
            let mut before = None;
            if self.smooth {
                if let Some(recording) = &self.recording {
                    if let Some(time) = recording.next_frame_seconds() {
                        let time = self.starts[self.step] + time;
                        if time <= next {
                            next = time;
                            before = Some(recording.scene.clone());
                        }
                    }
                }
            }
            self.select(self.step, next, next >= end);
            if !self.complete {
                if let (Some(before), Some(recording)) = (before, &self.recording) {
                    if self.catalog.steps[self.step].name == "place" {
                        self.motion
                            .begin(&before, &recording.scene, &recording.manifest.frames);
                    } else if matches!(
                        self.catalog.steps[self.step].name.as_str(),
                        "preFloorplan" | "macroPlacement" | "postFloorplan"
                    ) {
                        self.reveal
                            .begin(&before, &recording.scene, &recording.manifest.frames);
                    }
                }
            }
        }
    }
}
