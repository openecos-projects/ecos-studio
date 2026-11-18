use super::*;
use egui::emath::GuiRounding as _;

impl CpuRasterCache {
    pub(in crate::app) fn central_frame(&self, context: &egui::Context) -> egui::Frame {
        let mut frame = egui::Frame::central_panel(&context.style());
        let rect = context.available_rect().round_ui();
        let painter = context
            .layer_painter(egui::LayerId::background())
            .with_clip_rect(rect);
        if self.paint_background(&painter, rect, frame.fill) {
            frame.fill = egui::Color32::TRANSPARENT;
        }
        frame
    }
}

pub(in crate::app) fn queue(
    painter: &egui::Painter,
    frame: egui::Rect,
    color: egui::Color32,
) -> bool {
    let scale = painter.ctx().pixels_per_point();
    if color.a() != 255
        || !matches!(scale, 1.0 | 2.0 | 4.0)
        || painter.ctx().tessellation_options(|options| *options)
            != egui::epaint::TessellationOptions::default()
        || !frame.min.is_finite()
        || !frame.max.is_finite()
        || frame.size().min_elem() * scale <= 2.0
        || [frame.left(), frame.top(), frame.right(), frame.bottom()]
            .into_iter()
            .any(|coordinate| (coordinate * scale).fract() != 0.0)
    {
        return false;
    }
    painter.add(egui::PaintCallback {
        rect: frame,
        callback: Arc::new(eframe::egui_glow::CallbackFn::new(move |info, parent| {
            let clip = egui::PaintCallbackInfo {
                clip_rect: info.clip_rect.intersect(info.viewport),
                ..info
            }
            .clip_rect_in_pixels();
            if clip.width_px <= 0 || clip.height_px <= 0 {
                return;
            }
            let gl = parent.gl();
            unsafe {
                let mut previous_color = [0.0; 4];
                let mut previous_scissor = [0; 4];
                gl.get_parameter_f32_slice(glow::COLOR_CLEAR_VALUE, &mut previous_color);
                gl.get_parameter_i32_slice(glow::SCISSOR_BOX, &mut previous_scissor);
                let scissor_enabled = gl.is_enabled(glow::SCISSOR_TEST);
                let srgb_enabled = gl.is_enabled(glow::FRAMEBUFFER_SRGB);
                gl.enable(glow::SCISSOR_TEST);
                gl.disable(glow::FRAMEBUFFER_SRGB);
                gl.scissor(
                    clip.left_px,
                    clip.from_bottom_px,
                    clip.width_px,
                    clip.height_px,
                );
                let [red, green, blue, alpha] =
                    color.to_array().map(|channel| f32::from(channel) / 255.0);
                gl.clear_color(red, green, blue, alpha);
                gl.clear(glow::COLOR_BUFFER_BIT);
                gl.clear_color(
                    previous_color[0],
                    previous_color[1],
                    previous_color[2],
                    previous_color[3],
                );
                gl.scissor(
                    previous_scissor[0],
                    previous_scissor[1],
                    previous_scissor[2],
                    previous_scissor[3],
                );
                if !scissor_enabled {
                    gl.disable(glow::SCISSOR_TEST);
                }
                if srgb_enabled {
                    gl.enable(glow::FRAMEBUFFER_SRGB);
                }
            }
        })),
    });
    true
}
