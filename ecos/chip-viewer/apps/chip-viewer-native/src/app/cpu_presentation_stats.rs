use super::*;

impl CpuRasterCache {
    pub(in crate::app) fn queue_stats(
        self: &Arc<Self>,
        painter: &egui::Painter,
        key: &SceneKey,
        stats: CanvasRenderStats,
        record: impl Fn(&CanvasRenderStats) + Send + Sync + 'static,
    ) {
        let cache = Arc::clone(self);
        let key = key.clone();
        painter.add(egui::PaintCallback {
            rect: painter.clip_rect(),
            callback: Arc::new(eframe::egui_glow::CallbackFn::new(move |_, _| {
                let mut stats = stats.clone();
                cache.update_presentation_stats(&key, &mut stats);
                record(&stats);
            })),
        });
    }

    fn update_presentation_stats(&self, key: &SceneKey, stats: &mut CanvasRenderStats) {
        stats.cpu_stats_after_paint = true;
        stats.cpu_scene_visible = false;
        stats.cpu_scene_preview = false;
        stats.cpu_scene_partial = false;
        stats.cpu_retained_valid_pixels = 0;
        stats.cpu_retained_validation_ms = 0.0;
        stats.cpu_rasterizations = self.rasterizations();
        if !self.failed() {
            let guard = self.resources.lock().unwrap();
            if let Some(resources) = guard.as_ref() {
                if let Some(source) = resources.presentation_source(key) {
                    let visible = key.destination(source.key()).intersects(key.canvas());
                    let retained = resources.retained_for(key, source.key()).is_some();
                    stats.cpu_scene_visible = visible;
                    stats.cpu_scene_partial = visible
                        && (retained
                            || matches!(source, RasterSource::Partial(frame) if frame.frame.key == *key));
                    stats.cpu_scene_preview =
                        visible && !retained && !source.key().same_geometry(key);
                }
                (
                    stats.cpu_retained_valid_pixels,
                    stats.cpu_retained_validation_ms,
                ) = resources.retained_stats(key);
            }
        }
        if !stats.cpu_scene_visible || stats.cpu_scene_preview || stats.cpu_scene_partial {
            stats.geometry_drawn_shapes = 0;
            stats.cpu_scene_pending = true;
            stats.scene_pending = true;
        }
    }
}
