use super::*;

pub(in crate::app) struct Presentation {
    pub(in crate::app) cache: Arc<CpuRasterCache>,
    output: Option<RasterTarget>,
    info: egui::PaintCallbackInfo,
    context: egui::Context,
}

impl Presentation {
    pub(in crate::app) fn new(
        gl: Arc<glow::Context>,
        key: &SceneKey,
        context: egui::Context,
    ) -> Self {
        let resources = RasterResources::new(Arc::clone(&gl)).unwrap();
        Self {
            cache: Arc::new(CpuRasterCache {
                resources: Mutex::new(Some(resources)),
                sparse_prefix: AtomicBool::new(
                    super::super::cpu_scene::sparse_rects::certified_profile(&gl),
                ),
                ..Default::default()
            }),
            output: Some(RasterTarget::new(&gl, key.screen_size()).unwrap()),
            info: egui::PaintCallbackInfo {
                viewport: key.canvas(),
                clip_rect: key.canvas(),
                pixels_per_point: context.pixels_per_point(),
                screen_size_px: key.screen_size(),
            },
            context,
        }
    }

    pub(in crate::app) fn paint(
        &self,
        scene: Option<&Arc<CpuScene>>,
        key: &SceneKey,
        progress: Option<&Arc<ProgressFrame>>,
    ) -> Vec<u8> {
        let mut guard = self.cache.resources.lock().unwrap();
        let resources = guard.as_mut().unwrap();
        resources.prepare_retained(key);
        let gl = Arc::clone(resources.painter.gl());
        let output = self.output.as_ref().unwrap();
        output.clear(&gl, egui::Color32::BLACK);
        resources
            .paint(
                &self.info,
                scene,
                key,
                progress,
                &self.context,
                egui::Color32::BLACK,
                &mut PresentTrace::enabled(),
            )
            .unwrap();
        let size = key.screen_size();
        let mut pixels = vec![0; size[0] as usize * size[1] as usize * 4];
        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(output.framebuffer));
            gl.read_pixels(
                0,
                0,
                size[0] as i32,
                size[1] as i32,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(Some(&mut pixels)),
            );
            assert_eq!(gl.get_error(), glow::NO_ERROR);
        }
        pixels
    }

    pub(in crate::app) fn resize(&mut self, key: &SceneKey) {
        let resources = self.cache.resources.lock().unwrap();
        let gl = resources.as_ref().unwrap().painter.gl();
        let output = RasterTarget::new(gl, key.screen_size()).unwrap();
        self.output.replace(output).unwrap().destroy(gl);
        self.info.screen_size_px = key.screen_size();
        self.info.clip_rect = key.canvas();
        self.info.viewport = key.canvas();
    }

    pub(in crate::app) fn paint_queued(
        &self,
        prepare: impl FnOnce(&egui::Painter),
        after_prepare: impl FnOnce(),
    ) -> Vec<u8> {
        let gl = Arc::clone(
            self.cache
                .resources
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .painter
                .gl(),
        );
        let output = self.output.as_ref().unwrap();
        let mut parent = eframe::egui_glow::Painter::new(Arc::clone(&gl), "", None, true).unwrap();
        self.context.begin_pass(egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(
                    self.info.screen_size_px[0] as f32,
                    self.info.screen_size_px[1] as f32,
                ) / self.context.pixels_per_point(),
            )),
            ..Default::default()
        });
        let painter = self
            .context
            .layer_painter(egui::LayerId::background())
            .with_clip_rect(self.info.clip_rect);
        prepare(&painter);
        let frame = self.context.end_pass();
        let primitives = self
            .context
            .tessellate(frame.shapes, frame.pixels_per_point);
        parent.set_texture(
            egui::TextureId::default(),
            &egui::epaint::ImageDelta::full(
                self.context.fonts(egui::epaint::Fonts::image),
                egui::TextureOptions::LINEAR,
            ),
        );
        after_prepare();
        output.clear(&gl, egui::Color32::BLACK);
        parent.paint_primitives(
            self.info.screen_size_px,
            frame.pixels_per_point,
            &primitives,
        );
        let mut pixels =
            vec![
                0;
                self.info.screen_size_px[0] as usize * self.info.screen_size_px[1] as usize * 4
            ];
        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(output.framebuffer));
            gl.read_pixels(
                0,
                0,
                self.info.screen_size_px[0] as i32,
                self.info.screen_size_px[1] as i32,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(Some(&mut pixels)),
            );
            assert_eq!(gl.get_error(), glow::NO_ERROR);
        }
        parent.destroy();
        pixels
    }
}

impl Drop for Presentation {
    fn drop(&mut self) {
        let mut resources = self.cache.resources.lock().unwrap().take().unwrap();
        let gl = Arc::clone(resources.painter.gl());
        resources.destroy();
        self.output.take().unwrap().destroy(&gl);
    }
}
