use super::*;

pub(in crate::app) struct Presentation {
    pub(in crate::app) cache: CpuRasterCache,
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
            cache: CpuRasterCache {
                resources: Mutex::new(Some(resources)),
                ..Default::default()
            },
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
}

impl Drop for Presentation {
    fn drop(&mut self) {
        let mut resources = self.cache.resources.lock().unwrap().take().unwrap();
        let gl = Arc::clone(resources.painter.gl());
        resources.destroy();
        self.output.take().unwrap().destroy(&gl);
    }
}
