use super::*;

impl RasterResources {
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
