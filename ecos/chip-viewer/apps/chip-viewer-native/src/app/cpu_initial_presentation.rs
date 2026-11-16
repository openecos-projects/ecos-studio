//! Current-camera seed geometry drawn in the first UI GL callback. It owns a
//! partial target and never enters the completed scene/history caches.
use super::*;

pub(super) struct SeedTarget {
    pub(super) scene: Arc<CpuScene>,
    pub(super) target: RasterTarget,
}

impl RasterResources {
    pub(super) fn prepare_initial(
        &mut self,
        info: &egui::PaintCallbackInfo,
        scene: Option<&Arc<CpuScene>>,
        key: &SceneKey,
        generation: u64,
        ctx: &egui::Context,
        background: egui::Color32,
        trace: &mut PresentTrace,
    ) -> Result<(), String> {
        let Some(scene) =
            scene.filter(|scene| scene.key() == key && scene.generation == generation)
        else {
            return Ok(());
        };
        if self
            .frames()
            .any(|frame| frame.scene.key().same_geometry(key))
            || self
                .progress
                .as_ref()
                .is_some_and(|frame| frame.frame.key.same_geometry(key))
            || self
                .initial
                .as_ref()
                .is_some_and(|seed| Arc::ptr_eq(&seed.scene, scene))
        {
            return Ok(());
        }
        trace.mark("seed_prepare_begin");
        let gl = Arc::clone(self.painter.gl());
        if let Some(seed) = self.initial.take() {
            self.targets.retire(&gl, seed.target);
        }
        trace.mark("seed_target_retire");
        let target = self.targets.acquire(&gl, info.screen_size_px)?;
        trace.mark("seed_allocation");
        let image = ctx.fonts(egui::epaint::Fonts::image);
        trace.mark("seed_font_copy");
        self.painter.set_texture(
            egui::TextureId::default(),
            &egui::epaint::ImageDelta::full(image, egui::TextureOptions::LINEAR),
        );
        trace.mark("seed_font_upload");
        scene
            .pattern_textures
            .upload_for(&mut self.painter, &scene.meshes);
        trace.mark("seed_pattern_upload");
        target.clear(&gl, background);
        trace.mark("seed_target_clear");
        // The input has a strict geometry quota; no query, readback, or waiting
        // on a worker happens inside the UI callback.
        #[cfg(target_os = "linux")]
        let batched = self
            .seed_batch
            .paint(
                &mut self.painter,
                key,
                &scene.pattern_textures,
                &scene.meshes,
            )
            .is_some();
        #[cfg(not(target_os = "linux"))]
        let batched = false;
        trace.mark(if batched {
            "seed_draw"
        } else {
            "seed_batch_fallback"
        });
        if !batched {
            self.painter.paint_primitives(
                info.screen_size_px,
                info.pixels_per_point,
                &scene.meshes,
            );
            trace.mark("seed_draw");
        }
        self.seed_evidence.record(&gl, &target, key, generation);
        trace.mark("seed_evidence");
        self.initial = Some(SeedTarget {
            scene: Arc::clone(scene),
            target,
        });
        trace.mark("seed_prepare_ready");
        Ok(())
    }
}
