use super::*;
use chip_display::FillPattern;
use egui::epaint::{ColorImage, ImageDelta, Primitive, TextureHandle, TextureId};
use egui::TextureOptions;
use std::sync::OnceLock;

struct PatternTexture {
    handle: TextureHandle,
    image: ColorImage,
}

pub struct PatternTextureSet {
    sparse_dots: Option<PatternTexture>,
    dense_dots: Option<PatternTexture>,
    diagonal_hatch: Option<PatternTexture>,
    cross_hatch: Option<PatternTexture>,
    horizontal_hatch: Option<PatternTexture>,
    vertical_hatch: Option<PatternTexture>,
    grid: Option<PatternTexture>,
}

impl Default for PatternTextureSet {
    fn default() -> Self {
        Self {
            sparse_dots: None,
            dense_dots: None,
            diagonal_hatch: None,
            cross_hatch: None,
            horizontal_hatch: None,
            vertical_hatch: None,
            grid: None,
        }
    }
}

impl PatternTextureSet {
    pub(super) fn new(ctx: &egui::Context) -> Self {
        Self {
            sparse_dots: Some(load_mask(
                ctx,
                "chip-viewer/pattern/sparse-dots",
                9,
                |x, y| dot_alpha(x, y, 1.25),
            )),
            dense_dots: Some(load_mask(
                ctx,
                "chip-viewer/pattern/dense-dots",
                5,
                |x, y| dot_alpha(x, y, 1.1),
            )),
            diagonal_hatch: Some(load_mask(
                ctx,
                "chip-viewer/pattern/diagonal-hatch",
                8,
                |x, y| line_alpha((x as f32 - y as f32).abs()),
            )),
            cross_hatch: Some(load_mask(
                ctx,
                "chip-viewer/pattern/cross-hatch",
                8,
                |x, y| {
                    line_alpha((x as f32 - y as f32).abs())
                        .max(line_alpha((x as f32 + y as f32 - 7.0).abs()))
                },
            )),
            horizontal_hatch: Some(load_mask(
                ctx,
                "chip-viewer/pattern/horizontal-hatch",
                10,
                |_, y| line_alpha((y as f32 - 4.0).abs()),
            )),
            vertical_hatch: Some(load_mask(
                ctx,
                "chip-viewer/pattern/vertical-hatch",
                10,
                |x, _| line_alpha((x as f32 - 4.0).abs()),
            )),
            grid: Some(load_mask(ctx, "chip-viewer/pattern/grid", 10, |x, y| {
                line_alpha((x as f32 - 4.0).abs()).max(line_alpha((y as f32 - 4.0).abs()))
            })),
        }
    }

    pub(super) fn spec(&self, pattern: FillPattern) -> Option<(TextureId, [f32; 2])> {
        let (texture, size) = match pattern {
            FillPattern::SparseDots => (self.sparse_dots.as_ref(), 9.0),
            FillPattern::DenseDots => (self.dense_dots.as_ref(), 5.0),
            FillPattern::DiagonalHatch => (self.diagonal_hatch.as_ref(), 8.0),
            FillPattern::CrossHatch => (self.cross_hatch.as_ref(), 8.0),
            FillPattern::HorizontalHatch => (self.horizontal_hatch.as_ref(), 10.0),
            FillPattern::VerticalHatch => (self.vertical_hatch.as_ref(), 10.0),
            FillPattern::Grid => (self.grid.as_ref(), 10.0),
            FillPattern::Hollow | FillPattern::Solid | FillPattern::XMark => (None, 0.0),
        };
        texture.map(|texture| (texture.handle.id(), [size, size]))
    }

    pub(super) fn sample(&self, pattern: FillPattern, uv: [f32; 2]) -> Option<[u8; 4]> {
        let texture = match pattern {
            FillPattern::SparseDots => self.sparse_dots.as_ref(),
            FillPattern::DenseDots => self.dense_dots.as_ref(),
            FillPattern::DiagonalHatch => self.diagonal_hatch.as_ref(),
            FillPattern::CrossHatch => self.cross_hatch.as_ref(),
            FillPattern::HorizontalHatch => self.horizontal_hatch.as_ref(),
            FillPattern::VerticalHatch => self.vertical_hatch.as_ref(),
            FillPattern::Grid => self.grid.as_ref(),
            FillPattern::Hollow | FillPattern::Solid | FillPattern::XMark => None,
        }?;
        Some(linear_repeat_sample(&texture.image, uv))
    }

    pub(super) fn contains(&self, texture_id: TextureId) -> bool {
        self.texture(texture_id).is_some()
    }

    pub(in crate::app) fn upload_for(
        &self,
        painter: &mut eframe::egui_glow::Painter,
        meshes: &[egui::ClippedPrimitive],
    ) {
        let mut seen = Vec::with_capacity(7);
        for primitive in meshes {
            let Primitive::Mesh(mesh) = &primitive.primitive else {
                continue;
            };
            let texture_id = mesh.texture_id;
            if seen.contains(&texture_id) {
                continue;
            }
            seen.push(texture_id);
            if painter.texture(texture_id).is_some() {
                continue;
            }
            let Some(image) = self.texture(texture_id) else {
                continue;
            };
            painter.set_texture(
                texture_id,
                &ImageDelta::full(image.clone(), TextureOptions::LINEAR_REPEAT),
            );
        }
    }

    fn texture(&self, texture_id: TextureId) -> Option<&ColorImage> {
        [
            self.sparse_dots.as_ref(),
            self.dense_dots.as_ref(),
            self.diagonal_hatch.as_ref(),
            self.cross_hatch.as_ref(),
            self.horizontal_hatch.as_ref(),
            self.vertical_hatch.as_ref(),
            self.grid.as_ref(),
        ]
        .into_iter()
        .flatten()
        .find(|texture| texture.handle.id() == texture_id)
        .map(|texture| &texture.image)
    }
}

fn load_mask(
    ctx: &egui::Context,
    name: &'static str,
    size: usize,
    alpha: impl Fn(usize, usize) -> u8,
) -> PatternTexture {
    let mut pixels = vec![0; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let offset = (y * size + x) * 4;
            pixels[offset..offset + 4].copy_from_slice(&[255, 255, 255, alpha(x, y)]);
        }
    }
    let image = ColorImage::from_rgba_unmultiplied([size, size], &pixels);
    let handle = ctx.load_texture(name, image.clone(), TextureOptions::LINEAR_REPEAT);
    PatternTexture { handle, image }
}

fn dot_alpha(x: usize, y: usize, radius: f32) -> u8 {
    let center = 2.0;
    let distance = ((x as f32 - center).powi(2) + (y as f32 - center).powi(2)).sqrt();
    if distance <= radius {
        255
    } else if distance <= radius + 0.75 {
        128
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_masks_keep_the_legacy_two_pixel_pattern_inset() {
        assert_eq!(dot_alpha(2, 2, 1.25), 255);
        assert_eq!(dot_alpha(4, 4, 1.25), 0);
        assert_eq!(dot_alpha(2, 2, 1.1), 255);
    }

    #[test]
    fn hatch_masks_use_a_single_pixel_core() {
        assert_eq!(line_alpha(0.0), 255);
        assert_eq!(line_alpha(0.5), 255);
        assert_eq!(line_alpha(1.0), 0);
    }
}

fn line_alpha(distance: f32) -> u8 {
    if distance <= 0.5 {
        255
    } else {
        0
    }
}

fn linear_repeat_sample(image: &ColorImage, uv: [f32; 2]) -> [u8; 4] {
    let width = image.size[0] as i32;
    let height = image.size[1] as i32;
    let sample = |coordinate: f32, size: i32| {
        let position = coordinate * size as f32 - 0.5;
        let lower = position.floor() as i32;
        let fraction = position - lower as f32;
        (lower, fraction)
    };
    let (x0, fx) = sample(uv[0], width);
    let (y0, fy) = sample(uv[1], height);
    let pixel = |x: i32, y: i32| {
        let x = x.rem_euclid(width) as usize;
        let y = y.rem_euclid(height) as usize;
        let pixel = image.pixels[y * width as usize + x].to_array();
        (pixel[0], pixel[3])
    };
    let top_left = pixel(x0, y0);
    let top_right = pixel(x0 + 1, y0);
    let bottom_left = pixel(x0, y0 + 1);
    let bottom_right = pixel(x0 + 1, y0 + 1);
    let interpolate_rgb = |top_left: u8, top_right: u8, bottom_left: u8, bottom_right: u8| {
        let lookup = linear_from_gamma_lookup();
        let top_left = lookup[top_left as usize];
        let top_right = lookup[top_right as usize];
        let bottom_left = lookup[bottom_left as usize];
        let bottom_right = lookup[bottom_right as usize];
        let top = top_left + (top_right - top_left) * fx;
        let bottom = bottom_left + (bottom_right - bottom_left) * fx;
        gamma_u8_from_linear(top + (bottom - top) * fy)
    };
    let interpolate_alpha = || {
        let top = top_left.1 as f32 + (top_right.1 as f32 - top_left.1 as f32) * fx;
        let bottom = bottom_left.1 as f32 + (bottom_right.1 as f32 - bottom_left.1 as f32) * fx;
        (top + (bottom - top) * fy).round().clamp(0.0, 255.0) as u8
    };
    let rgb = interpolate_rgb(top_left.0, top_right.0, bottom_left.0, bottom_right.0);
    [rgb, rgb, rgb, interpolate_alpha()]
}

fn linear_from_gamma_lookup() -> &'static [f32; 256] {
    static LOOKUP: OnceLock<[f32; 256]> = OnceLock::new();
    LOOKUP.get_or_init(|| {
        std::array::from_fn(|value| egui::epaint::ecolor::linear_f32_from_gamma_u8(value as u8))
    })
}

fn gamma_u8_from_linear(linear: f32) -> u8 {
    static LOOKUP: OnceLock<Box<[u8]>> = OnceLock::new();
    let lookup = LOOKUP.get_or_init(|| {
        (0..=65_536)
            .map(|value| egui::epaint::ecolor::gamma_u8_from_linear_f32(value as f32 / 65_536.0))
            .collect()
    });
    lookup[(linear.clamp(0.0, 1.0) * 65_536.0).round() as usize]
}
