use super::*;

pub(super) struct RetainedPan {
    key: SceneKey,
    source: SceneKey,
    bitmap: Vec<u8>,
    pixels: usize,
    duration: Duration,
}

pub(super) struct RetainedTarget {
    key: SceneKey,
    pub(super) target: RasterTarget,
}

impl RasterResources {
    pub(super) fn prepare_retained(&mut self, key: &SceneKey) {
        if self
            .retained_pan
            .as_ref()
            .is_some_and(|pan| pan.key == *key)
        {
            return;
        }
        self.retained_pan = None;
        if self
            .frames()
            .any(|frame| frame.scene.key().same_geometry(key))
        {
            return;
        }
        let frame = self
            .frames()
            .filter(|frame| frame.scene.retained.is_some())
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
            });
        let Some(frame) = frame else { return };
        let started = Instant::now();
        let Some(regions) = frame.scene.retained.as_ref().unwrap().validate(
            key,
            thread::available_parallelism()
                .map_or(1, usize::from)
                .div_ceil(2)
                .clamp(1, 8),
        ) else {
            return;
        };
        let pixels = regions.pixel_count();
        if pixels > 0 {
            let Some(bitmap) = frame.scene.bitmap.as_ref().and_then(|source| {
                frame
                    .scene
                    .retained
                    .as_ref()
                    .unwrap()
                    .compose(key, &regions, source)
            }) else {
                return;
            };
            self.retained_pan = Some(RetainedPan {
                key: key.clone(),
                source: frame.scene.key().clone(),
                bitmap,
                pixels,
                duration: started.elapsed(),
            });
        }
    }

    pub(super) fn upload_retained(&mut self, key: &SceneKey) -> Result<(), String> {
        if self
            .presentation_source(key)
            .is_none_or(|source| self.retained_for(key, source.key()).is_none())
        {
            return Ok(());
        }
        if self
            .retained_target
            .as_ref()
            .is_some_and(|target| target.key == *key)
        {
            return Ok(());
        }
        let gl = self.painter.gl();
        if self
            .retained_target
            .as_ref()
            .is_some_and(|target| target.target.size != key.screen_size())
        {
            self.targets
                .retire(gl, self.retained_target.take().unwrap().target);
        }
        if self.retained_target.is_none() {
            self.retained_target = Some(RetainedTarget {
                key: key.clone(),
                target: self.targets.acquire(gl, key.screen_size())?,
            });
        }
        let target = self.retained_target.as_mut().unwrap();
        target
            .target
            .upload(gl, &self.retained_pan.as_ref().unwrap().bitmap);
        target.key = key.clone();
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
                .filter(|target| target.key == *key)
            {
                target.target.blit(gl, info, draw, key, key);
            }
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
