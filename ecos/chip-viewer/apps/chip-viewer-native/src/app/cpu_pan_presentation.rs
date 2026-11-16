use super::*;

pub(super) use super::retained_worker::Prepared as RetainedPan;

pub(super) struct RetainedTarget {
    key: Option<SceneKey>,
    pub(super) target: RasterTarget,
}

impl RasterResources {
    pub(super) fn prepare_retained(
        &mut self,
        key: &SceneKey,
        generation: u64,
        ctx: &egui::Context,
    ) {
        if self
            .retained_pan
            .as_ref()
            .is_some_and(|pan| pan.key == *key && pan.generation == generation)
        {
            return;
        }
        self.retained_pan = None;
        if self
            .frames()
            .any(|frame| frame.scene.key().same_geometry(key))
        {
            self.retained_worker.cancel();
            return;
        }
        let scene = self
            .frames()
            .filter(|frame| frame.scene.retained.is_some() && frame.scene.bitmap.is_some())
            .filter(|frame| {
                frame.scene.key().compatible(key) && key.same_raster_scale(frame.scene.key())
            })
            .max_by(|first, second| {
                let coverage = |frame: &RasterFrame| {
                    key.destination(frame.scene.key())
                        .intersect(key.canvas())
                        .area()
                        .max(0.0)
                };
                coverage(first).total_cmp(&coverage(second))
            })
            .map(|frame| Arc::clone(&frame.scene));
        let Some(scene) = scene else {
            self.retained_worker.cancel();
            return;
        };
        // This runs only inside the GL callback, with the actual context current.
        #[cfg(target_os = "linux")]
        let cpu_style = super::super::cpu_scene::sparse_rects::certified_profile(self.painter.gl());
        #[cfg(not(target_os = "linux"))]
        let cpu_style = false;
        if let Some(prepared) = self
            .retained_worker
            .request(super::retained_worker::Request {
                key: key.clone(),
                generation,
                scene,
                cpu_style,
                repaint: ctx.clone(),
            })
        {
            if let Some(target) = &mut self.retained_target {
                target.key = None;
            }
            self.retained_pan = Some(prepared);
        };
    }

    pub(super) fn upload_retained(
        &mut self,
        key: &SceneKey,
        ctx: &egui::Context,
    ) -> Result<(), String> {
        if self
            .presentation_source(key)
            .is_none_or(|source| self.retained_for(key, source.key()).is_none())
        {
            return Ok(());
        }
        if self
            .retained_target
            .as_ref()
            .is_some_and(|target| target.key.as_ref() == Some(key))
        {
            return Ok(());
        }
        let gl = Arc::clone(self.painter.gl());
        if self
            .retained_target
            .as_ref()
            .is_some_and(|target| target.target.size != key.screen_size())
        {
            self.targets
                .retire(&gl, self.retained_target.take().unwrap().target);
        }
        if self.retained_target.is_none() {
            self.retained_target = Some(RetainedTarget {
                key: None,
                target: self.targets.acquire(&gl, key.screen_size())?,
            });
        }
        let target = self.retained_target.as_mut().unwrap();
        let retained = self.retained_pan.as_ref().unwrap();
        target.target.upload(&gl, &retained.bitmap);
        if !retained.repairs.is_empty() {
            self.painter.set_texture(
                egui::TextureId::default(),
                &egui::epaint::ImageDelta::full(
                    ctx.fonts(egui::epaint::Fonts::image),
                    egui::TextureOptions::LINEAR,
                ),
            );
            retained
                .textures
                .upload_for(&mut self.painter, &retained.repairs);
            unsafe { gl.bind_framebuffer(glow::FRAMEBUFFER, Some(target.target.framebuffer)) };
            self.painter.paint_primitives(
                key.screen_size(),
                ctx.pixels_per_point(),
                &retained.repairs,
            );
        }
        target.key = Some(key.clone());
        Ok(())
    }

    pub(super) fn retained_stats(&self, key: &SceneKey) -> (usize, f32) {
        self.presentation_source(key)
            .filter(|source| self.retained_for(key, source.key()).is_some())
            .and(self.retained_pan.as_ref())
            .map_or((0, 0.0), |pan| {
                (pan.pixels, pan.duration.as_secs_f32() * 1000.0)
            })
    }

    pub(super) fn retained_for(&self, key: &SceneKey, source: &SceneKey) -> Option<&RetainedPan> {
        self.retained_pan
            .as_ref()
            .filter(|pan| pan.key == *key && pan.source == *source)
    }

    #[cfg(test)]
    pub(super) fn retained_ready(&self, key: &SceneKey) -> bool {
        self.retained_pan
            .as_ref()
            .is_some_and(|pan| pan.key == *key)
            && self
                .retained_target
                .as_ref()
                .is_some_and(|target| target.key.as_ref() == Some(key))
    }

    pub(super) fn present(
        &self,
        gl: &glow::Context,
        info: &egui::PaintCallbackInfo,
        draw: Option<glow::Framebuffer>,
        key: &SceneKey,
    ) {
        let Some(source) = self.presentation_source(key) else {
            return;
        };
        if self.retained_for(key, source.key()).is_some() {
            if let Some(target) = self
                .retained_target
                .as_ref()
                .filter(|target| target.key.as_ref() == Some(key))
            {
                target.target.blit(gl, info, draw, key, key);
            }
            // The model covers the complete layout and the ordered repairs
            // have filled all damage. An unfinished prefix must not erase it.
            return;
        }
        source.target().blit(gl, info, draw, key, source.key());
        let RasterSource::Complete(completed) = source else {
            return;
        };
        if completed.scene.key().same_geometry(key) {
            return;
        }
        let Some(progress) = self
            .progress
            .as_ref()
            .filter(|frame| frame.frame.key == *key)
        else {
            return;
        };
        let retained = key
            .destination(completed.scene.key())
            .intersect(info.clip_rect);
        if !retained.is_positive() {
            progress
                .target
                .blit(gl, info, draw, key, &progress.frame.key);
            return;
        }
        for clip_rect in exposed(info.clip_rect, retained) {
            if clip_rect.is_positive() {
                let clipped = egui::PaintCallbackInfo { clip_rect, ..*info };
                progress
                    .target
                    .blit(gl, &clipped, draw, key, &progress.frame.key);
            }
        }
    }
}

fn exposed(canvas: egui::Rect, retained: egui::Rect) -> [egui::Rect; 4] {
    [
        egui::Rect::from_min_max(canvas.min, egui::pos2(canvas.max.x, retained.min.y)),
        egui::Rect::from_min_max(egui::pos2(canvas.min.x, retained.max.y), canvas.max),
        egui::Rect::from_min_max(
            egui::pos2(canvas.min.x, retained.min.y),
            egui::pos2(retained.min.x, retained.max.y),
        ),
        egui::Rect::from_min_max(
            egui::pos2(retained.max.x, retained.min.y),
            egui::pos2(canvas.max.x, retained.max.y),
        ),
    ]
}
