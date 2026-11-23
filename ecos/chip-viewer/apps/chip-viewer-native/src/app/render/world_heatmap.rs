use std::cell::{OnceCell, RefCell};
use std::sync::Arc;

use super::{
    egui, heatmap_core_cell, shape_screen_rect, world_to_screen_rect, ActiveHeatmap, HeatmapData,
    Rect32, MIN_SHAPE_SCREEN_SIZE,
};

#[derive(Default)]
pub(super) struct WorldHeatmap {
    layout: OnceCell<Option<WorldGrid>>,
    texture: OnceCell<egui::TextureHandle>,
    projected: RefCell<Option<(Projection, Arc<egui::Mesh>)>>,
}

impl WorldHeatmap {
    pub(super) fn invalidate_colors(&mut self) {
        self.texture.take();
        self.projected.get_mut().take();
    }
}

struct WorldGrid {
    bbox: Rect32,
    size: [usize; 2],
    // Matrix offsets in world image order. Zero represents a hole.
    cells: Vec<usize>,
}

#[derive(PartialEq)]
struct Projection {
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    alpha: u8,
}

impl WorldGrid {
    fn new(data: &HeatmapData, max_side: usize) -> Option<Self> {
        let pitch = data.core_pitch();
        let core_cells = || {
            data.cells().filter(|&((row, col), rect)| {
                row < data.rows() && col < data.columns() && heatmap_core_cell(rect, pitch)
            })
        };
        let (_, first) = core_cells().next()?;
        let dx = i64::from(first.hx) - i64::from(first.lx);
        let dy = i64::from(first.hy) - i64::from(first.ly);
        let mut bbox = first;
        let mut count = 0usize;
        for (_, rect) in core_cells() {
            if i64::from(rect.hx) - i64::from(rect.lx) != dx
                || i64::from(rect.hy) - i64::from(rect.ly) != dy
                || (i64::from(rect.lx) - i64::from(first.lx)) % dx != 0
                || (i64::from(rect.ly) - i64::from(first.ly)) % dy != 0
            {
                return None;
            }
            count += 1;
            bbox.lx = bbox.lx.min(rect.lx);
            bbox.ly = bbox.ly.min(rect.ly);
            bbox.hx = bbox.hx.max(rect.hx);
            bbox.hy = bbox.hy.max(rect.hy);
        }
        let width = usize::try_from((i64::from(bbox.hx) - i64::from(bbox.lx)) / dx).ok()?;
        let height = usize::try_from((i64::from(bbox.hy) - i64::from(bbox.ly)) / dy).ok()?;
        let area = width.checked_mul(height)?;
        // Sparse, widely separated rectangles must not allocate their whole bounding box.
        if width > max_side || height > max_side || area > count.saturating_mul(8) {
            return None;
        }
        let mut cells = vec![0; area];
        for ((row, col), rect) in core_cells() {
            let x = ((i64::from(rect.lx) - i64::from(bbox.lx)) / dx) as usize;
            let y = ((i64::from(bbox.hy) - i64::from(rect.hy)) / dy) as usize;
            let cell = &mut cells[y * width + x];
            if *cell != 0 {
                // Overlapping cells must blend in their original drawing order.
                return None;
            }
            *cell = row * data.columns() + col + 1;
        }
        Some(Self {
            bbox,
            size: [width, height],
            cells,
        })
    }

    fn image(&self, map: &ActiveHeatmap) -> egui::ColorImage {
        let columns = map.data.columns();
        let mut image = egui::ColorImage::new(self.size, egui::Color32::TRANSPARENT);
        for (&cell, pixel) in self.cells.iter().zip(&mut image.pixels) {
            if let Some(index) = cell.checked_sub(1) {
                *pixel = map
                    .data
                    .cell_color(
                        index / columns,
                        index % columns,
                        map.colormap_mode,
                        map.threshold,
                        map.invert_threshold,
                    )
                    .unwrap_or(egui::Color32::TRANSPARENT);
            }
        }
        image
    }
}

impl ActiveHeatmap {
    pub(super) fn paint_world_grid(
        &self,
        painter: &egui::Painter,
        world: Rect32,
        canvas: egui::Rect,
        zoom: f32,
        pan: egui::Vec2,
    ) {
        let grid = self.world.layout.get_or_init(|| {
            WorldGrid::new(
                &self.data,
                painter.ctx().input(|input| input.max_texture_side),
            )
        });
        let alpha = (255.0 * self.opacity).round() as u8;
        let painter = painter.with_clip_rect(canvas);
        let projected_grid = grid.as_ref().map(|grid| {
            (
                grid,
                world_to_screen_rect(grid.bbox, world, canvas, zoom, pan),
            )
        });
        // Below the shape size floor the original cells overlap on screen.
        // A single texture cannot reproduce their ordered alpha blending.
        let Some((grid, dst)) = projected_grid.filter(|(grid, dst)| {
            dst.width() >= grid.size[0] as f32 * MIN_SHAPE_SCREEN_SIZE
                && dst.height() >= grid.size[1] as f32 * MIN_SHAPE_SCREEN_SIZE
        }) else {
            self.paint_layout_rects(
                &painter,
                Projection {
                    world,
                    canvas,
                    zoom,
                    pan,
                    alpha,
                },
            );
            return;
        };
        if dst.intersects(canvas) {
            let texture = self.world.texture.get_or_init(|| {
                painter.ctx().load_texture(
                    "World heatmap",
                    grid.image(self),
                    egui::TextureOptions::NEAREST,
                )
            });
            painter.image(
                texture.id(),
                dst,
                egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0)),
                egui::Color32::from_white_alpha(alpha),
            );
        }
    }

    fn paint_layout_rects(&self, painter: &egui::Painter, view: Projection) {
        let mut cache = self.world.projected.borrow_mut();
        if let Some((key, mesh)) = cache.as_ref() {
            if *key == view {
                painter.add(egui::Shape::mesh(Arc::clone(mesh)));
                return;
            }
        }
        let mut mesh = egui::Mesh::default();
        for instance in self.instances().iter() {
            let [lx, ly, hx, hy] = instance.rect_dbu;
            let rect = shape_screen_rect(
                Rect32 { lx, ly, hx, hy },
                view.world,
                view.canvas,
                view.zoom,
                view.pan,
            )
            .intersect(view.canvas);
            if rect.is_positive() {
                let [r, g, b, _] = instance.fill_rgba.to_le_bytes();
                mesh.add_colored_rect(
                    rect,
                    egui::Color32::from_rgba_unmultiplied(r, g, b, view.alpha),
                );
            }
        }
        let mesh = Arc::new(mesh);
        painter.add(egui::Shape::mesh(Arc::clone(&mesh)));
        *cache = Some((view, mesh));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::tests::temp_snapshot_dir;
    use std::fs;

    fn map(name: &str, values: &str, layout: &str) -> ActiveHeatmap {
        let dir = temp_snapshot_dir(name);
        let values_path = dir.join("values.csv");
        let layout_path = dir.join("layout.csv");
        fs::write(&values_path, values).unwrap();
        fs::write(
            &layout_path,
            format!("pixel_row,pixel_col,lx,ly,ux,uy\n{layout}"),
        )
        .unwrap();
        let data = HeatmapData::load(&values_path, &layout_path).unwrap();
        fs::remove_dir_all(dir).unwrap();
        ActiveHeatmap::new("map".into(), data)
    }

    #[test]
    fn transposed_world_image_preserves_holes_and_skips_boundary_cells() {
        let mut layout = String::new();
        for row in 0..4 {
            let x = [0, 3, 13, 23, 33];
            for col in 0..4 {
                if (row, col) == (3, 0) {
                    continue;
                }
                let y = 30 - col * 10;
                layout.push_str(&format!(
                    "{row},{col},{},{y},{},{}\n",
                    x[row],
                    x[row + 1],
                    y + 10
                ));
            }
        }
        let map = map(
            "world-heatmap-transpose",
            "0,1,2,3\n4,5,6,7\n8,9,NaN,11\n12,13,14,15\n",
            &layout,
        );
        let grid = WorldGrid::new(&map.data, 1024).unwrap();
        assert_eq!(
            grid.bbox,
            Rect32 {
                lx: 3,
                ly: 0,
                hx: 33,
                hy: 40
            }
        );
        let image = grid.image(&map);
        assert_eq!(image.size, [3, 4]);
        assert_eq!(image[(1, 2)], egui::Color32::TRANSPARENT);
        assert_eq!(image[(2, 0)], egui::Color32::TRANSPARENT);
        assert_eq!(
            image[(0, 0)],
            map.data
                .cell_color(1, 0, map.colormap_mode, 0.0, false)
                .unwrap()
        );
        assert_eq!(
            image[(2, 3)],
            map.data
                .cell_color(3, 3, map.colormap_mode, 0.0, false)
                .unwrap()
        );
        assert!(WorldGrid::new(&map.data, 3).is_none());
    }

    fn draw(ctx: &egui::Context, map: &ActiveHeatmap, zoom: f32, pan_x: f32) -> egui::FullOutput {
        ctx.run(egui::RawInput::default(), |ctx| {
            let painter = ctx.layer_painter(egui::LayerId::background());
            map.paint_world_grid(
                &painter,
                Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 20,
                    hy: 10,
                },
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(200.0, 100.0)),
                zoom,
                egui::vec2(pan_x, 0.0),
            );
        })
    }

    fn mesh(output: &egui::FullOutput) -> &Arc<egui::Mesh> {
        output
            .shapes
            .iter()
            .find_map(|shape| match &shape.shape {
                egui::Shape::Mesh(mesh) => Some(mesh),
                _ => None,
            })
            .expect("the world overlay is submitted as one mesh")
    }

    #[test]
    fn camera_and_opacity_reuse_texture_but_threshold_recolors() {
        let mut map = map(
            "world-heatmap-camera",
            "0,1\n",
            "0,0,0,0,10,10\n0,1,10,0,20,10\n",
        );
        let ctx = egui::Context::default();
        let first = draw(&ctx, &map, 1.0, 0.0);
        let id = mesh(&first).texture_id;
        assert!(first
            .textures_delta
            .set
            .iter()
            .any(|(texture, _)| *texture == id));
        map.opacity = 0.25;
        let pan = draw(&ctx, &map, 1.5, 4.0);
        assert_eq!(mesh(&pan).texture_id, id);
        assert!(pan.textures_delta.set.is_empty());
        assert_ne!(mesh(&first).vertices, mesh(&pan).vertices);
        map.set_threshold(0.5);
        let filtered = draw(&ctx, &map, 1.5, 4.0);
        assert_ne!(mesh(&filtered).texture_id, id);
        let image = map
            .world
            .layout
            .get()
            .unwrap()
            .as_ref()
            .unwrap()
            .image(&map);
        assert_eq!(image[(0, 0)], egui::Color32::TRANSPARENT);
        assert_ne!(image[(1, 0)], egui::Color32::TRANSPARENT);
        assert!(map.instances.get().is_none());
    }

    #[test]
    fn overlapping_rects_keep_draw_order_and_reuse_the_projected_mesh() {
        let map = map(
            "world-heatmap-irregular",
            "0,1\n",
            "0,0,0,0,10,10\n0,1,0,0,10,10\n",
        );
        let ctx = egui::Context::default();
        let first = draw(&ctx, &map, 1.0, 0.0);
        let next = draw(&ctx, &map, 1.0, 0.0);
        assert!(Arc::ptr_eq(mesh(&first), mesh(&next)));
        assert_eq!(mesh(&first).vertices.len(), 8);
        assert_ne!(
            mesh(&first).vertices[0].color,
            mesh(&first).vertices[4].color
        );
        let panned = draw(&ctx, &map, 1.0, 3.0);
        assert!(!Arc::ptr_eq(mesh(&first), mesh(&panned)));
    }

    #[test]
    fn subpixel_grid_keeps_the_original_minimum_screen_size() {
        let map = map(
            "world-heatmap-subpixel",
            "0,1\n",
            "0,0,0,0,10,10\n0,1,10,0,20,10\n",
        );
        let ctx = egui::Context::default();
        let tiny = draw(&ctx, &map, 0.005, 0.0);
        assert_eq!(mesh(&tiny).vertices.len(), 8);
        let x = mesh(&tiny).vertices[0].pos.x;
        assert_eq!(mesh(&tiny).vertices[1].pos.x - x, MIN_SHAPE_SCREEN_SIZE);
        assert!(mesh(&tiny).vertices[4].pos.x < x + MIN_SHAPE_SCREEN_SIZE);
    }
}
