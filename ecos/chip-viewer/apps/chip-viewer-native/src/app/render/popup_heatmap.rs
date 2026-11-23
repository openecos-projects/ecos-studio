use std::cell::OnceCell;

use super::{egui, ActiveHeatmap};

#[derive(Default)]
pub(in crate::app) struct PopupHeatmap {
    tiles: OnceCell<Vec<PreviewTile>>,
}

struct PreviewTile {
    bounds: egui::Rect,
    texture: egui::TextureHandle,
}

impl PopupHeatmap {
    pub(in crate::app) fn invalidate_colors(&mut self) {
        self.tiles.take();
    }
}

impl ActiveHeatmap {
    fn preview_tiles(&self, ctx: &egui::Context, max_side: usize) -> Vec<PreviewTile> {
        let columns = self.data.columns();
        let rows = self.data.rows();
        let mut tiles = Vec::new();
        for row in (0..rows).step_by(max_side) {
            let height = (rows - row).min(max_side);
            for column in (0..columns).step_by(max_side) {
                let width = (columns - column).min(max_side);
                let mut image = egui::ColorImage::new([width, height], egui::Color32::TRANSPARENT);
                for (dy, pixels) in image.pixels.chunks_exact_mut(width).enumerate() {
                    for (dx, pixel) in pixels.iter_mut().enumerate() {
                        if let Some(color) = self.data.cell_color(
                            row + dy,
                            column + dx,
                            self.colormap_mode,
                            self.threshold,
                            self.invert_threshold,
                        ) {
                            *pixel = color;
                        }
                    }
                }
                let point = |x: usize, y: usize| {
                    egui::pos2(x as f32 / columns as f32, y as f32 / rows as f32)
                };
                tiles.push(PreviewTile {
                    bounds: egui::Rect::from_min_max(
                        point(column, row),
                        point(column + width, row + height),
                    ),
                    texture: ctx.load_texture(
                        "Heatmap preview",
                        image,
                        egui::TextureOptions::NEAREST,
                    ),
                });
            }
        }
        tiles
    }

    pub(super) fn paint_preview_cells(&self, painter: &egui::Painter, rect: egui::Rect) {
        let tiles = self.popup.tiles.get_or_init(|| {
            let ctx = painter.ctx();
            self.preview_tiles(ctx, ctx.input(|input| input.max_texture_side).max(1))
        });
        let uv = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0));
        for tile in tiles {
            let dest = egui::Rect::from_min_max(
                rect.lerp_inside(tile.bounds.min.to_vec2()),
                rect.lerp_inside(tile.bounds.max.to_vec2()),
            );
            painter.image(tile.texture.id(), dest, uv, egui::Color32::WHITE);
        }
    }
}
