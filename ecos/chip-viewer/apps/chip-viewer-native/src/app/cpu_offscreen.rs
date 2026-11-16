use super::*;
use crate::app::cpu_raster::target::{RasterTarget, RasterTargetPool};
use eframe::glow::{self, HasContext};
use glutin::api::egl::{context::PossiblyCurrentContext, device::Device, display::Display};
use glutin::config::{Api, ConfigSurfaceTypes, ConfigTemplateBuilder};
use glutin::context::{ContextApi, ContextAttributesBuilder, Version};
use glutin::prelude::*;
use glutin::surface::{PbufferSurface, SurfaceAttributesBuilder};
use std::ffi::CString;

#[path = "cpu_raster_stream.rs"]
mod stream;

#[path = "cpu_raster_trace.rs"]
mod trace;

#[path = "cpu_compact_mesh.rs"]
mod compact;
pub(in crate::app) use compact::textures::TextureBatch;

#[path = "cpu_raster_font.rs"]
mod font;

pub(super) struct OffscreenRenderer {
    painter: eframe::egui_glow::Painter,
    compact: compact::CompactPainter,
    targets: RasterTargetPool,
    sparse_profile: bool,
    _context: PossiblyCurrentContext,
    _surface: glutin::api::egl::surface::Surface<PbufferSurface>,
}

impl OffscreenRenderer {
    #[cfg(test)]
    pub(super) fn solid_shader_active(&self) -> bool {
        self.compact.solid_shader_active()
    }

    #[cfg(test)]
    pub(super) fn font_texture_pixels(&self, buffer_len: usize) -> Vec<u8> {
        let gl = self.painter.gl();
        let texture = self.painter.texture(egui::TextureId::default()).unwrap();
        let mut pixels = vec![13; buffer_len];
        unsafe {
            gl.bind_texture(glow::TEXTURE_2D, Some(texture));
            gl.get_tex_image(
                glow::TEXTURE_2D,
                0,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(Some(&mut pixels)),
            );
        }
        pixels
    }

    #[cfg(test)]
    pub(super) fn with_context<Output>(
        &self,
        check: impl FnOnce(&Arc<glow::Context>) -> Output,
    ) -> Output {
        check(self.painter.gl())
    }

    pub(super) fn new(expected_renderer: &str) -> Result<Self, String> {
        #[cfg(test)]
        let configured_renderer = std::env::var("ECOS_COVERAGE_GL_RENDERER").ok();
        #[cfg(test)]
        let expected_renderer = if expected_renderer.is_empty() {
            configured_renderer.as_deref().unwrap_or(expected_renderer)
        } else {
            expected_renderer
        };
        let mut errors = Vec::new();
        for device in Device::query_devices().map_err(|error| error.to_string())? {
            match Self::for_device(&device, expected_renderer) {
                Ok(renderer) => return Ok(renderer),
                Err(error) => errors.push(error),
            }
        }
        Err(format!("no offscreen EGL device: {}", errors.join("; ")))
    }

    fn for_device(device: &Device, expected_renderer: &str) -> Result<Self, String> {
        let display =
            unsafe { Display::with_device(device, None) }.map_err(|error| error.to_string())?;
        let template = ConfigTemplateBuilder::new()
            .with_surface_type(ConfigSurfaceTypes::PBUFFER)
            .with_api(Api::OPENGL)
            .with_alpha_size(8)
            .build();
        let config = unsafe { display.find_configs(template) }
            .map_err(|error| error.to_string())?
            .next()
            .ok_or("no offscreen OpenGL configuration")?;
        let attributes = ContextAttributesBuilder::new()
            .with_context_api(ContextApi::OpenGl(Some(Version::new(3, 3))))
            .build(None);
        let context = unsafe { display.create_context(&config, &attributes) }
            .map_err(|error| error.to_string())?;
        let attributes = SurfaceAttributesBuilder::<PbufferSurface>::new()
            .build(1.try_into().unwrap(), 1.try_into().unwrap());
        let surface = unsafe { display.create_pbuffer_surface(&config, &attributes) }
            .map_err(|error| error.to_string())?;
        let context = context
            .make_current(&surface)
            .map_err(|error| error.to_string())?;
        let gl = unsafe {
            glow::Context::from_loader_function(|name| {
                display.get_proc_address(&CString::new(name).unwrap())
            })
        };
        let renderer = unsafe { gl.get_parameter_string(glow::RENDERER) };
        let sparse_profile = sparse_rects::certified_profile(&gl);
        if renderer != expected_renderer && (!cfg!(test) || !expected_renderer.is_empty()) {
            return Err(format!(
                "offscreen renderer {renderer} differs from {expected_renderer}"
            ));
        }
        let painter = eframe::egui_glow::Painter::new(Arc::new(gl), "", None, true)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            painter,
            compact: Default::default(),
            targets: Default::default(),
            sparse_profile,
            _context: context,
            _surface: surface,
        })
    }

    #[cfg(test)]
    pub(super) fn rasterize_compact(
        &mut self,
        scene: &CpuScene,
        request: &SceneRequest,
    ) -> Result<Vec<u8>, String> {
        let key = &request.key;
        let image = request.repaint.fonts(egui::epaint::Fonts::image);
        if image.size != key.font_texture_size {
            return Err("font image changed before compact oracle".to_string());
        }
        let gl = Arc::clone(self.painter.gl());
        let target = RasterTarget::new(&gl, key.screen_size)?;
        scene
            .pattern_textures
            .upload_for(&mut self.painter, &scene.meshes);
        self.painter.set_texture(
            egui::TextureId::default(),
            &egui::epaint::ImageDelta::full(image, egui::TextureOptions::LINEAR),
        );
        target.clear(&gl, key.background);
        let packed = geometry::pack_meshes(&scene.meshes);
        self.compact.paint(
            &mut self.painter,
            key,
            &scene.pattern_textures,
            &scene.meshes,
            &packed,
        );
        let result = read_pixels(&gl, key.screen_size);
        target.destroy(&gl);
        result
    }

    #[cfg(test)]
    pub(super) fn rasterize(
        &mut self,
        scene: &CpuScene,
        request: &SceneRequest,
        is_current: impl Fn() -> bool,
        publish: impl FnMut(Vec<u8>, usize),
    ) -> Result<Option<(Vec<u8>, Duration)>, String> {
        self.rasterize_updates(
            scene,
            request,
            is_current,
            publish,
            match request.publication {
                progress::Publication::Complete => None,
                progress::Publication::Progressive => {
                    Some([Duration::from_millis(25), Duration::from_millis(500)])
                }
            },
        )
    }

    #[cfg(test)]
    pub(super) fn rasterize_updates(
        &mut self,
        scene: &CpuScene,
        request: &SceneRequest,
        is_current: impl Fn() -> bool,
        mut publish: impl FnMut(Vec<u8>, usize),
        intervals: Option<[Duration; 2]>,
    ) -> Result<Option<(Vec<u8>, Duration)>, String> {
        let started = Instant::now();
        let key = &request.key;
        let font_image = request.repaint.fonts(egui::epaint::Fonts::image);
        if font_image.size != key.font_texture_size || !is_current() {
            return Ok(None);
        }
        let gl = Arc::clone(self.painter.gl());
        let target = RasterTarget::new(&gl, key.screen_size)?;
        let result = (|| {
            scene
                .pattern_textures
                .upload_for(&mut self.painter, &scene.meshes);
            self.painter.set_texture(
                egui::TextureId::default(),
                &egui::epaint::ImageDelta::full(font_image, egui::TextureOptions::LINEAR),
            );
            target.clear(&gl, key.background);
            let mut snapshot_at = intervals.map(|intervals| started + intervals[0]);
            for (batch, meshes) in scene.meshes.chunks(16).enumerate() {
                if !is_current() {
                    return Ok(None);
                }
                self.painter
                    .paint_primitives(key.screen_size, key.pixels_per_point, meshes);
                let sequence = batch * 16 + meshes.len();
                if sequence < scene.meshes.len()
                    && snapshot_at.is_some_and(|at| Instant::now() >= at)
                    && is_current()
                {
                    let pixels = read_pixels(&gl, key.screen_size)?;
                    if !is_current() {
                        return Ok(None);
                    }
                    publish(pixels, sequence);
                    snapshot_at = intervals.map(|intervals| Instant::now() + intervals[1]);
                }
            }
            if !is_current() {
                return Ok(None);
            }
            let pixels = read_pixels(&gl, key.screen_size)?;
            let error = unsafe { gl.get_error() };
            if error != glow::NO_ERROR {
                return Err(format!("offscreen raster OpenGL error: {error}"));
            }
            Ok(is_current().then_some((pixels, started.elapsed())))
        })();
        target.destroy(&gl);
        result
    }
}

fn read_pixels(gl: &glow::Context, size: [u32; 2]) -> Result<Vec<u8>, String> {
    let length = size
        .into_iter()
        .try_fold(4usize, |length, side| length.checked_mul(side as usize))
        .ok_or("offscreen bitmap size overflow")?;
    let mut pixels = vec![0; length];
    unsafe {
        gl.read_pixels(
            0,
            0,
            size[0] as i32,
            size[1] as i32,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        );
    }
    let error = unsafe { gl.get_error() };
    if error != glow::NO_ERROR {
        return Err(format!("offscreen snapshot OpenGL error: {error}"));
    }
    Ok(pixels)
}

impl Drop for OffscreenRenderer {
    fn drop(&mut self) {
        self.targets.destroy(self.painter.gl());
        self.compact.destroy(self.painter.gl());
        self.painter.destroy();
    }
}
