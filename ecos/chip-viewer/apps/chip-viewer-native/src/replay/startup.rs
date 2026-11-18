//! Studio keeps one dialog visible until preparation and the first layout finish.
//! Standalone CLI launches retain the native fixed-size progress dialog.
use super::{ReplayApp, StepPlan};
use anyhow::{Context, Result};
use std::{
    path::Path,
    sync::mpsc::RecvTimeoutError,
    time::{Duration, Instant},
};

impl ReplayApp {
    pub(super) fn accept_plans(&mut self, plans: Vec<StepPlan>) {
        self.plans = plans;
        self.preparation = None;
        self.total = 0.0;
        for (i, plan) in self.plans.iter().enumerate() {
            self.starts[i] = self.total;
            self.total += plan.seconds;
        }
        self.select(0, 0.0, false);
        self.tick = Instant::now();
    }

    pub fn prepare_for_launch(&mut self, path: &Path) -> Result<()> {
        // Preparing before creating the native window avoids window-manager
        // focus/maximize changes while Studio is presenting the loading dialog.
        let receiver = self
            .preparation
            .take()
            .context("Missing Replay preparation")?;
        self.loading.publish(path, false)?;
        loop {
            match receiver.recv_timeout(Duration::from_millis(200)) {
                Ok(plans) => {
                    self.loading
                        .step(0, self.catalog.steps.len(), &self.catalog.steps[0].name);
                    self.loading.phase("Loading the first layout");
                    self.loading.publish(path, false)?;
                    self.accept_plans(plans);
                    break;
                }
                Err(RecvTimeoutError::Timeout) => self.loading.publish(path, false)?,
                Err(RecvTimeoutError::Disconnected) => anyhow::bail!("Replay preparation failed"),
            }
        }
        while self.pending.is_some() {
            self.poll_loader();
            self.loading.publish(path, false)?;
            if self.pending.is_some() {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        self.first_layout_loading = false;
        self.loading.phase("Opening the Replay window");
        self.loading.publish(path, false)?;
        self.startup_progress = Some(path.to_path_buf());
        Ok(())
    }

    pub(super) fn finish_startup(&mut self, ctx: &egui::Context) {
        if let Some(path) = &self.startup_progress {
            // Let one complete frame paint before handing off the Studio dialog.
            if self.startup_painted {
                if let Err(error) = self.loading.publish(path, true) {
                    eprintln!("Replay startup progress: {error}");
                    // A visible window with no terminal status would leave the
                    // Studio dialog waiting forever. Exit so its lifecycle
                    // monitor can restore the entry and report the failure.
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
                self.startup_progress = None;
            } else {
                self.startup_painted = true;
                ctx.request_repaint();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::data::{read, tests::Fixture};
    use serde_json::{json, Value};

    #[test]
    fn external_startup_prepares_layout_before_handing_off_after_a_painted_frame() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.0.join("home")).unwrap();
        fixture.write(
            "home/flow.json",
            json!({"steps":[{"name":"place", "state":"Success"}]}),
        );
        fixture.write("catalog.json", json!({
            "schema":"ecos.replay.catalog.v1", "workspace":fixture.0,
            "steps":[{"name":"place", "seconds":100.0,
                "manifest":fixture.0.join("attempts/a/manifest.json"),"reason":"","metrics":[],"nodes":[]}]
        }));
        let path = fixture.0.join("progress.json");
        let mut app = ReplayApp::open(&fixture.0.join("catalog.json")).unwrap();
        app.prepare_for_launch(&path).unwrap();
        assert!(app.preparation.is_none() && app.pending.is_none());
        assert!(!app.first_layout_loading);
        assert!(!app.recording.as_ref().unwrap().scene.objects.is_empty());
        assert_eq!(app.view3d.z_scale, 1.0);
        let progress: Value = read(&path).unwrap();
        assert_eq!(
            progress,
            json!({"state":"loading", "phase":"Opening the Replay window",
            "step":1, "steps":1, "name":"place", "frame":0, "frames":0})
        );
        let ctx = egui::Context::default();
        app.finish_startup(&ctx);
        assert_eq!(read::<Value>(&path).unwrap()["state"], "loading");
        app.finish_startup(&ctx);
        assert_eq!(read::<Value>(&path).unwrap()["state"], "ready");
        assert!(app.startup_progress.is_none());

        // Losing the app-owned status directory must not strand Studio's prompt.
        app.startup_progress = Some(fixture.0.join("missing/progress.json"));
        let output = ctx.run(Default::default(), |ctx| app.finish_startup(ctx));
        assert!(output.viewport_output[&egui::ViewportId::ROOT]
            .commands
            .contains(&egui::ViewportCommand::Close));
    }
}
