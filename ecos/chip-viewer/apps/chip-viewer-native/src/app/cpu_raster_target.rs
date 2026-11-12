use super::*;

#[derive(Default)]
pub(in crate::app) struct RasterTargetPool {
    spare: Option<RasterTarget>,
}

impl RasterTargetPool {
    pub(in crate::app) fn is_empty(&self) -> bool {
        self.spare.is_none()
    }

    pub(in crate::app) fn acquire(
        &mut self,
        gl: &glow::Context,
        size: [u32; 2],
    ) -> Result<RasterTarget, String> {
        if let Some(target) = self.spare.take() {
            if target.size == size {
                return Ok(target);
            }
            target.destroy(gl);
        }
        RasterTarget::new(gl, size)
    }

    pub(in crate::app) fn retire(&mut self, gl: &glow::Context, target: RasterTarget) {
        if self.spare.is_none() {
            self.spare = Some(target);
        } else {
            target.destroy(gl);
        }
    }

    pub(in crate::app) fn destroy(&mut self, gl: &glow::Context) {
        if let Some(target) = self.spare.take() {
            target.destroy(gl);
        }
    }
}

pub(in crate::app) struct RasterTarget {
    pub(in crate::app) framebuffer: glow::Framebuffer,
    texture: glow::Texture,
    pub(in crate::app) size: [u32; 2],
}

impl RasterTarget {
    pub(in crate::app) fn new(gl: &glow::Context, size: [u32; 2]) -> Result<Self, String> {
        let maximum = unsafe { gl.get_parameter_i32(glow::MAX_TEXTURE_SIZE) };
        if size.contains(&0)
            || size
                .iter()
                .any(|side| i64::from(*side) > i64::from(maximum))
        {
            return Err("framebuffer dimensions exceed texture limits".to_string());
        }
        let texture = unsafe { gl.create_texture()? };
        let framebuffer = match unsafe { gl.create_framebuffer() } {
            Ok(framebuffer) => framebuffer,
            Err(error) => {
                unsafe { gl.delete_texture(texture) };
                return Err(error);
            }
        };
        let target = Self {
            framebuffer,
            texture,
            size,
        };
        let status = unsafe {
            gl.bind_texture(glow::TEXTURE_2D, Some(texture));
            gl.tex_parameter_i32(
                glow::TEXTURE_2D,
                glow::TEXTURE_MIN_FILTER,
                glow::NEAREST as i32,
            );
            gl.tex_parameter_i32(
                glow::TEXTURE_2D,
                glow::TEXTURE_MAG_FILTER,
                glow::NEAREST as i32,
            );
            gl.tex_image_2d(
                glow::TEXTURE_2D,
                0,
                glow::RGBA8 as i32,
                size[0] as i32,
                size[1] as i32,
                0,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelUnpackData::Slice(None),
            );
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));
            gl.framebuffer_texture_2d(
                glow::FRAMEBUFFER,
                glow::COLOR_ATTACHMENT0,
                glow::TEXTURE_2D,
                Some(texture),
                0,
            );
            gl.check_framebuffer_status(glow::FRAMEBUFFER)
        };
        if status != glow::FRAMEBUFFER_COMPLETE {
            target.destroy(gl);
            return Err(format!("incomplete exact-scene framebuffer: {status}"));
        }
        Ok(target)
    }

    pub(in crate::app) fn clear(&self, gl: &glow::Context, background: egui::Color32) {
        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(self.framebuffer));
            gl.disable(glow::SCISSOR_TEST);
            let [red, green, blue, alpha] = background
                .to_array()
                .map(|channel| f32::from(channel) / 255.0);
            gl.clear_color(red, green, blue, alpha);
            gl.clear(glow::COLOR_BUFFER_BIT);
        }
    }

    pub(super) fn blit(
        &self,
        gl: &glow::Context,
        info: &egui::PaintCallbackInfo,
        draw: Option<glow::Framebuffer>,
        current: &SceneKey,
        source: &SceneKey,
    ) {
        let clip = info.clip_rect_in_pixels();
        let Some(destination) = current.raster_destination(source) else {
            return;
        };
        let visible = destination.intersect(info.clip_rect);
        if !visible.is_positive() {
            return;
        }
        let source_rect = egui::emath::RectTransform::from_to(destination, source.canvas())
            .transform_rect(visible);
        let pixels = |rect: egui::Rect, height: u32| {
            let scale = info.pixels_per_point;
            [
                (rect.left() * scale).round() as i32,
                height as i32 - (rect.bottom() * scale).round() as i32,
                (rect.right() * scale).round() as i32,
                height as i32 - (rect.top() * scale).round() as i32,
            ]
        };
        let [source_left, source_bottom, source_right, source_top] =
            pixels(source_rect, self.size[1]);
        let [left, bottom, right, top] = pixels(visible, info.screen_size_px[1]);
        unsafe {
            gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(self.framebuffer));
            gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, draw);
            gl.enable(glow::SCISSOR_TEST);
            gl.scissor(
                clip.left_px,
                clip.from_bottom_px,
                clip.width_px,
                clip.height_px,
            );
            gl.blit_framebuffer(
                source_left,
                source_bottom,
                source_right,
                source_top,
                left,
                bottom,
                right,
                top,
                glow::COLOR_BUFFER_BIT,
                glow::NEAREST,
            );
        }
    }

    pub(in crate::app) fn destroy(self, gl: &glow::Context) {
        unsafe {
            gl.delete_framebuffer(self.framebuffer);
            gl.delete_texture(self.texture);
        }
    }

    pub(in crate::app) fn upload(&self, gl: &glow::Context, pixels: &[u8]) {
        unsafe {
            gl.bind_texture(glow::TEXTURE_2D, Some(self.texture));
            gl.tex_sub_image_2d(
                glow::TEXTURE_2D,
                0,
                0,
                0,
                self.size[0] as i32,
                self.size[1] as i32,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelUnpackData::Slice(Some(pixels)),
            );
        }
    }
}
