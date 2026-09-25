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

/// Zoom at or below which the overview latch may engage.
pub(super) const VIEW_TILE_OVERVIEW_ENTER_ZOOM: f32 = 0.35;
/// Zoom above which the overview latch disengages. The gap to the enter
/// zoom keeps a zoom resting on the boundary from flickering between the
/// tile summary and the exact-shape path.
pub(super) const VIEW_TILE_OVERVIEW_EXIT_ZOOM: f32 = 0.40;

/// Minimum on-screen edge length of a lod-3 tile for the overview summary
/// to be worth showing. Derivation: a 754k dbu die at lod 3 splits into a
/// roughly 23x23 tile grid, so on a ~1000px canvas at the 0.35 enter zoom
/// one tile is `0.35 * 32768 / 754000 * 1000 ~= 15px`. At 8px the
/// per-tile occupancy shading still reads as texture; below that the
/// summary flattens into blobs, and the exact path is cheap enough
/// anyway, so the threshold sits at 8px.
pub(super) const VIEW_TILE_MIN_SCREEN_PX: f32 = 8.0;

/// `GpuBufferKey::zoom_tier` for overview instance buffers. Exact-path
/// tiles use tiers 0 (label-less) and 1 (label-carrying), so tier 2 keeps
/// overview buffers from ever sharing a cache key with a shape tile.
pub(super) const OVERVIEW_ZOOM_TIER: u8 = 2;

fn lod3_tile_screen_px(zoom: f32, world: Rect32, canvas: egui::Rect) -> f32 {
    VIEW_TILE_LOD3_SIZE_DBU * world_to_screen_scale(world, canvas, zoom)
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
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
) -> bool {
    if view_tile_count == 0 || has_draft || edit_enabled {
        return false;
    }
    if zoom > VIEW_TILE_OVERVIEW_ENTER_ZOOM {
        return false;
    }
    // Primary signal: lod-3 tiles resolve to visible pixels on this canvas.
    if lod3_tile_screen_px(zoom, world, canvas) >= VIEW_TILE_MIN_SCREEN_PX {
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
        viewport: Rect32,
        world: Rect32,
        canvas: egui::Rect,
    ) -> bool {
        if self.active {
            let preconditions = view_tile_count > 0 && !has_draft && !edit_enabled;
            if !preconditions || zoom > VIEW_TILE_OVERVIEW_EXIT_ZOOM {
                self.active = false;
            }
        } else if should_use_view_tiles_for_state(
            view_tile_count,
            has_draft,
            edit_enabled,
            zoom,
            viewport,
            world,
            canvas,
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
    let occupancy_alpha = 16.0 + (shape_count.max(1) as f32).sqrt() * 4.0;
    let alpha = occupancy_alpha.round().clamp(16.0, 52.0) as u8;
    [style.rgba[0], style.rgba[1], style.rgba[2], alpha]
}

fn overview_tile_instance(
    style: LayerStyle,
    tile: &chipgeom_format::GeometryViewTileRecord,
) -> crate::canvas_gpu::GpuShapeInstance {
    // Pure fill: pattern 1 (solid), shape type 0 (rect), category 31
    // (uncategorized, so the visibility mask never culls it), no context
    // flag, and a zero-alpha frame so the shader's edge stroke stays
    // invisible exactly like the CPU `rect_filled` overview path.
    let pattern_bits = 1 | ((crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY as u32) << 18);
    crate::canvas_gpu::GpuShapeInstance {
        rect_dbu: [tile.bbox.lx, tile.bbox.ly, tile.bbox.hx, tile.bbox.hy],
        fill_rgba: crate::canvas_gpu::pack_rgba_u32(overview_tile_rgba(style, tile.shape_count)),
        frame_rgba: 0,
        pattern_bits,
        line_width_px: 0.0,
    }
}

impl LoadedViewer {
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
            reserved: [0; 2],
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
                    instances.push(overview_tile_instance(*style, tile));
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
            16, false, false, 0.35, viewport, world, canvas,
        ));
        // Fitted at zoom 1.0 the exact path must keep drawing shapes.
        assert!(!should_use_view_tiles_for_state(
            16, false, false, 1.0, viewport, world, canvas,
        ));
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
            16, false, false, 0.05, viewport, world, canvas,
        ));
    }

    #[test]
    fn overview_rejects_missing_tiles_draft_and_edit() {
        let world = test_world();
        let canvas = test_canvas();
        for (count, draft, edit) in [(0, false, false), (16, true, false), (16, false, true)] {
            assert!(!should_use_view_tiles_for_state(
                count, draft, edit, 0.25, world, world, canvas,
            ));
        }
    }

    #[test]
    fn latch_hysteresis_keeps_boundary_zoom_stable() {
        let world = test_world();
        let canvas = test_canvas();
        let mut latch = ViewTileOverviewLatch::default();

        // Enter at the enter zoom.
        assert!(latch.update(16, false, false, 0.35, world, world, canvas));
        // Stay engaged across the enter zoom up to the exit zoom.
        assert!(latch.update(16, false, false, 0.38, world, world, canvas));
        // Disengage past the exit zoom.
        assert!(!latch.update(16, false, false, 0.41, world, world, canvas));
        // And re-entering needs the full predicate again.
        assert!(latch.update(16, false, false, 0.30, world, world, canvas));
        // A draft while engaged disengages immediately.
        assert!(!latch.update(16, true, false, 0.30, world, world, canvas));
        // Reset forces disengagement.
        latch.reset();
        assert!(!latch.update(16, false, false, 0.38, world, world, canvas));
    }

    #[test]
    fn overview_tile_rgba_matches_cpu_shading() {
        let style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
        let [r, g, b, a] = overview_tile_rgba(style, 100);
        assert_eq!([r, g, b], style.rgba[..3]);
        assert!((16..=52).contains(&a));
    }
}
