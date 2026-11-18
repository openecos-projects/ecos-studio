use super::*;

/// Holds one unused presentation target, never a scene or a valid-frame claim.
#[derive(Default)]
pub(in crate::app) struct PresentationTargets {
    spare: target::RasterTargetPool,
    camera: Option<SceneKey>,
    changed_at: Option<Instant>,
}

impl PresentationTargets {
    pub(in crate::app) fn observe(&mut self, key: &SceneKey) {
        if self.camera.as_ref() != Some(key) {
            self.camera = Some(key.clone());
            self.changed_at = Some(Instant::now());
        }
    }

    pub(in crate::app) fn acquire(
        &mut self,
        gl: &glow::Context,
        size: [u32; 2],
    ) -> Result<RasterTarget, String> {
        self.spare.acquire(gl, size)
    }

    pub(in crate::app) fn retire(&mut self, gl: &glow::Context, target: RasterTarget) {
        self.spare.retire(gl, target);
    }

    pub(in crate::app) fn warm_when_idle(
        &mut self,
        gl: &glow::Context,
        size: [u32; 2],
    ) -> Result<bool, String> {
        if self.spare.is_empty()
            && self
                .changed_at
                .is_some_and(|changed| changed.elapsed() >= Duration::from_millis(150))
        {
            let target = self.spare.acquire(gl, size)?;
            self.spare.retire(gl, target);
            return Ok(true);
        }
        Ok(false)
    }

    pub(in crate::app) fn destroy(&mut self, gl: &glow::Context) {
        self.spare.destroy(gl);
        self.camera = None;
        self.changed_at = None;
    }
}
