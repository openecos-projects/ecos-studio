//! GPU 2D overview rendering from view.bin LOD tile records.
//!
//! When the viewport is zoomed out far enough that individual shapes are
//! sub-pixel, both the CPU and GPU canvas paths summarise the layout as one
//! rectangle per view.bin tile record instead of streaming every shape
//! through the per-shape tile worker. This module holds the shared
//! enter/exit predicate, the hysteresis latch, and the GPU instance
//! building so `app.rs` only wires the calls.

use super::*;

/// Edge length of a lod-3 view tile in dbu. view.bin tiles use a
/// `4096 << lod` dbu grid, so lod 3 tiles are 32768 dbu across.
pub(super) const VIEW_TILE_LOD3_SIZE_DBU: f32 = 4096.0 * 8.0;

/// Legacy far-zoom entry point. Dense views can also use pixel-scale tiles
/// when their estimated visible shape count exceeds the physical pixel count.
pub(super) const VIEW_TILE_OVERVIEW_ENTER_ZOOM: f32 = 0.35;
/// Legacy far-zoom exit point; density-driven overview remains active while
/// its estimated shape density is above the lower hysteresis bound.
pub(super) const VIEW_TILE_OVERVIEW_EXIT_ZOOM: f32 = 0.40;

/// Minimum on-screen edge length of a lod-3 tile for the overview summary
/// to be worth showing. Derivation: a 754k dbu die at lod 3 splits into a
/// roughly 23x23 tile grid, so on a ~1000px canvas at the 0.35 enter zoom
/// one tile is `0.35 * 32768 / 754000 * 1000 ~= 15px`. At 8px the
/// per-tile occupancy shading still reads as texture; below that the
/// summary flattens into blobs, and the exact path is cheap enough
/// anyway, so the threshold sits at 8px.
pub(super) const VIEW_TILE_MIN_SCREEN_PX: f32 = 8.0;
const PIXEL_OVERVIEW_ENTER_SHAPES_PER_PIXEL: f64 = 1.0;
const PIXEL_OVERVIEW_EXIT_SHAPES_PER_PIXEL: f64 = 0.5;
const TARGET_OVERVIEW_TILE_SCREEN_PX: f64 = 16.0;
const MAX_TILE_REFERENCES_PER_SHAPE: u64 = 64;

/// `GpuBufferKey::zoom_tier` for overview instance buffers. Exact-path
/// tiles use tiers 0 (label-less) and 1 (label-carrying), so tier 2 keeps
/// overview buffers from ever sharing a cache key with a shape tile.
pub(super) const OVERVIEW_ZOOM_TIER: u8 = 2;

fn lod3_tile_screen_px(zoom: f32, world: Rect32, canvas: egui::Rect) -> f32 {
    VIEW_TILE_LOD3_SIZE_DBU * world_to_screen_scale(world, canvas, zoom)
}

fn overview_tile_rect(tile: &chipgeom_format::GeometryViewTileRecord, lod: u8) -> Rect32 {
    let tile_size = 4096_i64 << lod;
    let span_x = i64::from(tile.bbox.hx).div_euclid(tile_size)
        - i64::from(tile.bbox.lx).div_euclid(tile_size)
        + 1;
    let span_y = i64::from(tile.bbox.hy).div_euclid(tile_size)
        - i64::from(tile.bbox.ly).div_euclid(tile_size)
        + 1;
    if tile.shape_count == 1 && span_x.saturating_mul(span_y) as u64 > MAX_TILE_REFERENCES_PER_SHAPE
    {
        return tile.bbox;
    }
    let lx = i64::from(tile.tile_x) * tile_size;
    let ly = i64::from(tile.tile_y) * tile_size;
    let hx = lx + tile_size;
    let hy = ly + tile_size;
    Rect32 {
        lx: lx.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        ly: ly.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        hx: hx.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        hy: hy.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    }
}

fn estimated_visible_shapes_per_pixel(
    shape_count: usize,
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    pixels_per_point: f32,
) -> f64 {
    let width =
        (i64::from(viewport.hx.min(world.hx)) - i64::from(viewport.lx.max(world.lx))).max(0) as f64;
    let height =
        (i64::from(viewport.hy.min(world.hy)) - i64::from(viewport.ly.max(world.ly))).max(0) as f64;
    let world_width = (i64::from(world.hx) - i64::from(world.lx)).max(1) as f64;
    let world_height = (i64::from(world.hy) - i64::from(world.ly)).max(1) as f64;
    let visible_fraction = (width * height / (world_width * world_height)).clamp(0.0, 1.0);
    let physical_pixels = f64::from(canvas.width().max(0.0))
        * f64::from(canvas.height().max(0.0))
        * f64::from(pixels_per_point.max(0.1)).powi(2);
    if physical_pixels == 0.0 {
        0.0
    } else {
        shape_count as f64 * visible_fraction / physical_pixels
    }
}

pub(super) fn pixel_overview_lod(
    zoom: f32,
    world: Rect32,
    canvas: egui::Rect,
    pixels_per_point: f32,
) -> u8 {
    let tile_zero_screen_px = 4096.0_f64
        * f64::from(world_to_screen_scale(world, canvas, zoom))
        * f64::from(pixels_per_point.max(0.1));
    if tile_zero_screen_px <= 0.0 {
        return 0;
    }
    (TARGET_OVERVIEW_TILE_SCREEN_PX / tile_zero_screen_px)
        .log2()
        .ceil()
        .clamp(0.0, 3.0) as u8
}

pub(super) fn overview_lod_for_renderer(lod: u8, is_gpu: bool) -> u8 {
    if is_gpu {
        lod
    } else {
        lod.saturating_add(1).min(3)
    }
}

/// Shared 2D CPU/GPU predicate for the overview tile summary. Highlights
/// and selection still render as exact overlays on top of the tile
/// summary, so they do not factor into the predicate; draft/edit mode
/// needs the exact base geometry and disables it.
pub(super) fn should_use_view_tiles_for_state(
    view_tile_count: usize,
    has_draft: bool,
    edit_enabled: bool,
    zoom: f32,
    shape_count: usize,
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    pixels_per_point: f32,
) -> bool {
    if view_tile_count == 0 || has_draft || edit_enabled {
        return false;
    }
    if zoom > VIEW_TILE_OVERVIEW_ENTER_ZOOM {
        return estimated_visible_shapes_per_pixel(
            shape_count,
            viewport,
            world,
            canvas,
            pixels_per_point,
        ) >= PIXEL_OVERVIEW_ENTER_SHAPES_PER_PIXEL;
    }
    // Primary signal: lod-3 tiles resolve to visible pixels on this canvas.
    if lod3_tile_screen_px(zoom, world, canvas) >= VIEW_TILE_MIN_SCREEN_PX {
        return true;
    }
    if estimated_visible_shapes_per_pixel(shape_count, viewport, world, canvas, pixels_per_point)
        >= PIXEL_OVERVIEW_ENTER_SHAPES_PER_PIXEL
    {
        return true;
    }
    // Legacy fallback of the old area heuristic: when the die is a tiny
    // speck the tiles drop below the pixel threshold, but painting a
    // handful of summary rectangles still beats streaming every shape.
    let viewport_width = (viewport.hx - viewport.lx).max(1) as i64;
    let viewport_height = (viewport.hy - viewport.ly).max(1) as i64;
    let world_width = (world.hx - world.lx).max(1) as i64;
    let world_height = (world.hy - world.ly).max(1) as i64;
    let viewport_area = viewport_width.saturating_mul(viewport_height);
    let world_area = world_width.saturating_mul(world_height).max(1);
    viewport_area >= world_area.saturating_mul(6)
}

/// Hysteresis latch for the 2D overview predicate. Entering requires the
/// full [`should_use_view_tiles_for_state`] test; once active the latch
/// stays engaged until the zoom rises past the exit zoom or a
/// precondition (draft/edit/tile availability) breaks, so zooming back
/// and forth across a single boundary does not thrash the two render
/// paths.
#[derive(Default)]
pub(super) struct ViewTileOverviewLatch {
    active: bool,
}

impl ViewTileOverviewLatch {
    pub(super) fn reset(&mut self) {
        self.active = false;
    }

    pub(super) fn update(
        &mut self,
        view_tile_count: usize,
        has_draft: bool,
        edit_enabled: bool,
        zoom: f32,
        shape_count: usize,
        viewport: Rect32,
        world: Rect32,
        canvas: egui::Rect,
        pixels_per_point: f32,
    ) -> bool {
        if self.active {
            let preconditions = view_tile_count > 0 && !has_draft && !edit_enabled;
            let dense = estimated_visible_shapes_per_pixel(
                shape_count,
                viewport,
                world,
                canvas,
                pixels_per_point,
            ) >= PIXEL_OVERVIEW_EXIT_SHAPES_PER_PIXEL;
            if !preconditions || (zoom > VIEW_TILE_OVERVIEW_EXIT_ZOOM && !dense) {
                self.active = false;
            }
        } else if should_use_view_tiles_for_state(
            view_tile_count,
            has_draft,
            edit_enabled,
            zoom,
            shape_count,
            viewport,
            world,
            canvas,
            pixels_per_point,
        ) {
            self.active = true;
        }
        self.active
    }
}

/// RGBA fill for an overview tile rectangle. Mirrors the CPU
/// `overview_tile_color` shading exactly so both render paths look the
/// same.
pub(super) fn overview_tile_rgba(style: LayerStyle, shape_count: u32) -> [u8; 4] {
    let occupancy = (shape_count.max(1) as f32).sqrt();
    let alpha = (96.0 + occupancy * 8.0).round().clamp(96.0, 224.0) as u8;
    [
        (f32::from(style.rgba[0]) * 0.72).round() as u8,
        (f32::from(style.rgba[1]) * 0.72).round() as u8,
        (f32::from(style.rgba[2]) * 0.72).round() as u8,
        alpha,
    ]
}

fn overview_tile_instance(
    style: LayerStyle,
    tile: &chipgeom_format::GeometryViewTileRecord,
    lod: u8,
) -> crate::canvas_gpu::GpuShapeInstance {
    // Pure fill: pattern 1 (solid), shape type 0 (rect), category 31
    // (uncategorized, so the visibility mask never culls it), no context
    // flag, and a zero-alpha frame so the shader's edge stroke stays
    // invisible exactly like the CPU `rect_filled` overview path.
    let pattern_bits = 1 | ((crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY as u32) << 18);
    crate::canvas_gpu::GpuShapeInstance {
        rect_dbu: {
            let rect = overview_tile_rect(tile, lod);
            [rect.lx, rect.ly, rect.hx, rect.hy]
        },
        fill_rgba: crate::canvas_gpu::pack_rgba_u32(overview_tile_rgba(style, tile.shape_count)),
        frame_rgba: 0,
        pattern_bits,
        line_width_px: 0.0,
    }
}

impl LoadedViewer {
    pub(super) fn paint_cpu_2d_overview(
        &mut self,
        painter: &egui::Painter,
        viewport: Rect32,
        world: Rect32,
        canvas: egui::Rect,
        view_lod: u8,
        visible_layers: &BTreeMap<LayerId, LayerStyle>,
    ) -> usize {
        let mut mesh = egui::Mesh::default();
        let mut drawn = 0;
        for (layer_id, style) in visible_layers {
            for tile in self
                .view_tile_cache
                .visible_tiles(&self.db, view_lod, *layer_id, viewport)
                .iter()
            {
                let screen = world_to_screen_rect(
                    overview_tile_rect(tile, view_lod),
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                );
                if !screen.is_positive() || !screen.intersects(canvas) {
                    continue;
                }
                mesh.add_colored_rect(screen, overview_tile_color(*style, tile.shape_count));
                drawn += 1;
            }
        }
        if !mesh.indices.is_empty() {
            painter.add(egui::Shape::mesh(Arc::new(mesh)));
        }
        drawn
    }

    /// Uniform shared by the GPU overview and exact-shape canvas paths.
    pub(super) fn gpu_canvas_uniform(
        &self,
        world: Rect32,
        canvas: egui::Rect,
        pixels_per_point: f32,
        is_interacting: bool,
    ) -> crate::canvas_gpu::CanvasUniform {
        let gpu_scale = world_to_screen_scale(world, canvas, self.zoom);
        let world_cx = (world.lx + world.hx) as f32 * 0.5;
        let world_cy = (world.ly + world.hy) as f32 * 0.5;
        crate::canvas_gpu::CanvasUniform {
            world_center_dbu: [world_cx, world_cy],
            canvas_center_px: [
                canvas.width() * 0.5 + self.pan.x,
                canvas.height() * 0.5 + self.pan.y,
            ],
            scale_px_per_dbu: gpu_scale,
            pixels_per_point,
            pattern_min_size_px: crate::canvas_gpu::PATTERN_MIN_SIZE_PX,
            min_shape_screen_size: crate::canvas_gpu::MIN_SHAPE_SCREEN_SIZE,
            screen_size_px: [canvas.width(), canvas.height()],
            is_interacting: if is_interacting { 1.0 } else { 0.0 },
            global_alpha: 1.0,
            visibility_mask: self.object_visibility.gpu_visibility_mask(),
            show_context: u32::from(self.zoom > 1.25),
            pattern_frame_fade_size_px: crate::canvas_gpu::PATTERN_FRAME_FADE_SIZE_PX,
            reserved: 0,
        }
    }

    /// Renders the 2D overview summary on the GPU canvas: one solid
    /// rectangle instance per view.bin tile record, coloured exactly like
    /// the CPU overview path. Returns the drawn instance count.
    ///
    /// The instance set is queried over the whole die rather than the
    /// per-frame viewport: at overview zoom the viewport spans the die
    /// anyway, and the fixed query bounds keep the buffer key stable
    /// while panning, so the instance upload happens only when the lod,
    /// layer visibility, or geometry epoch changes. Off-screen instances
    /// are culled by the paint scissor.
    pub(super) fn paint_gpu_2d_overview(
        &mut self,
        ui: &egui::Ui,
        canvas: egui::Rect,
        world: Rect32,
        view_lod: u8,
        visible_layers: &BTreeMap<LayerId, LayerStyle>,
        is_interacting: bool,
    ) -> usize {
        let visibility_hash = layers_visibility_hash(&self.layers);
        self.gpu_tile_instances.retain(|key, _| {
            key.geometry_epoch == self.geometry_epoch
                && key.layer_visibility_hash == visibility_hash
        });

        let buffer_key = crate::canvas_gpu::GpuBufferKey {
            geometry_epoch: self.geometry_epoch,
            tile_x: i32::MIN,
            // The sentinel tile coordinate marks this as an overview
            // buffer; the lod rides in `tile_y` so a lod switch uploads a
            // fresh buffer instead of reusing the previous lod's tiles.
            tile_y: i32::MIN + i32::from(view_lod),
            zoom_tier: OVERVIEW_ZOOM_TIER,
            layer_visibility_hash: visibility_hash,
            object_visibility_bits: 0,
        };

        if !self.gpu_tile_instances.contains_key(&buffer_key) {
            let mut instances = Vec::new();
            for (layer_id, style) in visible_layers {
                for tile in self
                    .view_tile_cache
                    .visible_tiles(&self.db, view_lod, *layer_id, world)
                    .iter()
                {
                    instances.push(overview_tile_instance(*style, tile, view_lod));
                }
            }
            let mut category_counts = [[0usize; 32]; 2];
            category_counts[0][crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY as usize] =
                instances.len();
            let byte_size =
                instances.len() * std::mem::size_of::<crate::canvas_gpu::GpuShapeInstance>();
            self.gpu_tile_instances.insert(
                buffer_key,
                std::sync::Arc::new(GpuTileData {
                    instances: std::sync::Arc::new(instances),
                    labels: Vec::new(),
                    category_counts,
                    byte_size,
                }),
            );
        }
        let tile_instances = &self.gpu_tile_instances[&buffer_key];
        let uniform =
            self.gpu_canvas_uniform(world, canvas, ui.ctx().pixels_per_point(), is_interacting);
        let drawn = tile_instances.visible_count(uniform.visibility_mask, true);
        let target_format = self
            .gpu_canvas
            .as_ref()
            .map(|g| g.target_format)
            .unwrap_or(wgpu::TextureFormat::Bgra8UnormSrgb);
        let callback = crate::canvas_gpu::CanvasGpuCallback {
            uniform,
            instances: std::sync::Arc::clone(&tile_instances.instances),
            buffer_key,
            frame_counter: self.gpu_frame_counter,
            target_format,
        };
        ui.painter()
            .add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
        drawn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_world() -> Rect32 {
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 754_000,
            hy: 754_000,
        }
    }

    fn test_canvas() -> egui::Rect {
        egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1000.0, 800.0))
    }

    #[test]
    fn overview_enters_when_lod3_tiles_resolve_to_pixels() {
        let world = test_world();
        let canvas = test_canvas();
        let viewport = world;
        // At zoom 0.35 one lod-3 tile is ~15px on a 1000px canvas.
        assert!(should_use_view_tiles_for_state(
            16, false, false, 0.35, 500_000, viewport, world, canvas, 1.0,
        ));
        // A sparse fitted view stays exact.
        assert!(!should_use_view_tiles_for_state(
            16, false, false, 1.0, 0, viewport, world, canvas, 1.0,
        ));
        assert!(should_use_view_tiles_for_state(
            16, false, false, 1.0, 1_000_000, viewport, world, canvas, 1.0,
        ));
        assert!(!should_use_view_tiles_for_state(
            16, false, false, 1.0, 100_000, viewport, world, canvas, 1.0,
        ));
    }

    #[test]
    fn pixel_overview_lod_tracks_physical_tile_size() {
        let world = test_world();
        let canvas = test_canvas();
        assert_eq!(pixel_overview_lod(1.0, world, canvas, 1.0), 2);
        assert_eq!(pixel_overview_lod(0.25, world, canvas, 1.0), 3);
        assert_eq!(pixel_overview_lod(0.05, world, canvas, 1.0), 3);
    }

    #[test]
    fn cpu_overview_uses_one_coarser_lod_and_gpu_keeps_requested_lod() {
        assert_eq!(overview_lod_for_renderer(1, false), 2);
        assert_eq!(overview_lod_for_renderer(3, false), 3);
        assert_eq!(overview_lod_for_renderer(1, true), 1);
    }

    #[test]
    fn regular_tile_uses_its_grid_cell_while_a_large_shape_keeps_its_bounds() {
        let regular = chipgeom_format::GeometryViewTileRecord {
            tile_x: -1,
            tile_y: 2,
            shape_count: 20,
            bbox: Rect32 {
                lx: -10_000,
                ly: 8_192,
                hx: 30_000,
                hy: 9_000,
            },
            ..Default::default()
        };
        assert_eq!(
            overview_tile_rect(&regular, 0),
            Rect32 {
                lx: -4_096,
                ly: 8_192,
                hx: 0,
                hy: 12_288,
            }
        );

        let large = chipgeom_format::GeometryViewTileRecord {
            shape_count: 1,
            bbox: Rect32 {
                hx: 500_000,
                ..regular.bbox
            },
            ..regular
        };
        assert_eq!(overview_tile_rect(&large, 0), large.bbox);
    }

    #[test]
    fn overview_stays_available_when_die_is_a_speck() {
        let world = test_world();
        let canvas = test_canvas();
        // Zoomed far out the tiles drop below the pixel threshold, but the
        // legacy area fallback keeps the summary instead of streaming
        // every shape.
        let viewport = Rect32 {
            lx: -2_000_000,
            ly: -2_000_000,
            hx: 3_000_000,
            hy: 3_000_000,
        };
        assert!(should_use_view_tiles_for_state(
            16, false, false, 0.05, 0, viewport, world, canvas, 1.0,
        ));
    }

    #[test]
    fn overview_rejects_missing_tiles_draft_and_edit() {
        let world = test_world();
        let canvas = test_canvas();
        for (count, draft, edit) in [(0, false, false), (16, true, false), (16, false, true)] {
            assert!(!should_use_view_tiles_for_state(
                count, draft, edit, 0.25, 0, world, world, canvas, 1.0,
            ));
        }
    }

    #[test]
    fn latch_hysteresis_keeps_boundary_zoom_stable() {
        let world = test_world();
        let canvas = test_canvas();
        let mut latch = ViewTileOverviewLatch::default();

        // Enter at the enter zoom.
        assert!(latch.update(16, false, false, 0.35, 0, world, world, canvas, 1.0));
        // Stay engaged across the enter zoom up to the exit zoom.
        assert!(latch.update(16, false, false, 0.38, 0, world, world, canvas, 1.0));
        // Disengage past the exit zoom.
        assert!(!latch.update(16, false, false, 0.41, 0, world, world, canvas, 1.0));
        // And re-entering needs the full predicate again.
        assert!(latch.update(16, false, false, 0.30, 0, world, world, canvas, 1.0));
        // A draft while engaged disengages immediately.
        assert!(!latch.update(16, true, false, 0.30, 0, world, world, canvas, 1.0));
        // Reset forces disengagement.
        latch.reset();
        assert!(!latch.update(16, false, false, 0.38, 0, world, world, canvas, 1.0));
    }

    #[test]
    fn pixel_overview_latch_uses_density_hysteresis_at_fit_zoom() {
        let world = test_world();
        let canvas = test_canvas();
        let mut latch = ViewTileOverviewLatch::default();

        assert!(latch.update(16, false, false, 1.0, 1_000_000, world, world, canvas, 1.0));
        assert!(latch.update(16, false, false, 1.0, 700_000, world, world, canvas, 1.0));
        assert!(!latch.update(16, false, false, 1.0, 300_000, world, world, canvas, 1.0));
    }

    #[test]
    fn overview_tile_rgba_matches_cpu_shading() {
        let style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
        let [r, g, b, a] = overview_tile_rgba(style, 100);
        assert_eq!(
            [r, g, b],
            [
                (f32::from(style.rgba[0]) * 0.72).round() as u8,
                (f32::from(style.rgba[1]) * 0.72).round() as u8,
                (f32::from(style.rgba[2]) * 0.72).round() as u8,
            ]
        );
        assert!((96..=224).contains(&a));
    }
}
