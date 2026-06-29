use layout_display::{Color, LayerStyle, Pattern};
use layout_render::{
    DrawItem, DrawLine, RenderCacheKey, RenderPlan, RenderPlanSource, RenderPlane,
};
use layoutdb::Rect;

pub fn viewport_bucket(viewport: [i32; 4], bucket_units: i32) -> [i32; 4] {
    let bucket_units = bucket_units.max(1);
    viewport.map(|coordinate| coordinate.div_euclid(bucket_units))
}

pub fn build_plane_key(
    viewport: [i32; 4],
    bucket_units: i32,
    source: RenderPlanSource,
    mode: &str,
    render_cache_key: RenderCacheKey,
    data_revision: u64,
    plane_name: &str,
) -> crate::plane_cache::PlaneKey {
    crate::plane_cache::PlaneKey {
        viewport_bucket: viewport_bucket(viewport, bucket_units),
        lod_level: format!("{source:?}:{mode}"),
        display_hash: render_cache_key.value(),
        data_revision,
        layer_mask_hash: render_cache_key.value(),
        plane: plane_name.to_owned(),
    }
}

pub fn build_plan_plane_key(
    viewport: [i32; 4],
    bucket_units: i32,
    mode: &str,
    plan: &RenderPlan,
    data_revision: u64,
    plane_name: &str,
) -> crate::plane_cache::PlaneKey {
    build_plane_key(
        viewport,
        bucket_units,
        plan.source,
        mode,
        plan.cache_key,
        data_revision,
        plane_name,
    )
}

pub fn rasterize_plan(
    plan: &RenderPlan,
    width: usize,
    height: usize,
    world_to_screen: impl Fn(Rect) -> [i32; 4],
) -> crate::plane_cache::CachedPlane {
    let mut plane = crate::raster_plane::RasterPlane::new(width, height);
    for batch in &plan.batches {
        for item in &batch.items {
            match (batch.plane, item) {
                (RenderPlane::Fill, DrawItem::Rect(rect)) => {
                    rasterize_fill_rect(&mut plane, world_to_screen(rect.world), &batch.style);
                }
                (RenderPlane::Frame | RenderPlane::Hierarchy, DrawItem::Rect(rect)) => {
                    rasterize_fill_rect(&mut plane, world_to_screen(rect.world), &batch.style);
                    plane.stroke_rect(
                        world_to_screen(rect.world),
                        rgba(rect.color, batch.style.frame_alpha),
                    );
                }
                (RenderPlane::Hierarchy, DrawItem::Line(line)) => {
                    rasterize_line(&mut plane, line, batch.style.frame_alpha, &world_to_screen);
                }
                (RenderPlane::Hierarchy | RenderPlane::Marker, DrawItem::Marker(marker)) => {
                    let [x0, y0, x1, y1] = world_to_screen(marker.world);
                    let cx = (x0 + x1) / 2;
                    let cy = (y0 + y1) / 2;
                    plane.fill_rect(
                        [cx - 1, cy - 1, cx + 2, cy + 2],
                        rgba(marker.color, batch.style.marker_alpha),
                    );
                }
                _ => {
                    // Initial raster path intentionally ignores markers and non-hierarchy lines.
                }
            }
        }
    }

    crate::plane_cache::CachedPlane {
        width,
        height,
        pixels: plane.into_pixels(),
    }
}

fn rgba(color: Color, alpha: u8) -> [u8; 4] {
    [color.r, color.g, color.b, alpha]
}

const PATTERN_TILE_PX: i32 = 10;
const PATTERN_INSET_PX: i32 = 2;
const SPARSE_DOT_SPACING_PX: i32 = 9;

fn rasterize_fill_rect(
    plane: &mut crate::raster_plane::RasterPlane,
    rect: [i32; 4],
    style: &LayerStyle,
) {
    let color = rgba(style.fill_color, style.fill_alpha);
    if color[3] == 0 {
        return;
    }

    match style.fill_pattern {
        Pattern::Hollow => {}
        Pattern::Solid => plane.fill_rect(rect, color),
        Pattern::SparseDots => rasterize_sparse_dots(plane, rect, color),
        Pattern::DiagonalHatch => rasterize_hatch(plane, rect, color, false),
        Pattern::CrossHatch => rasterize_hatch(plane, rect, color, true),
    }
}

fn rasterize_sparse_dots(
    plane: &mut crate::raster_plane::RasterPlane,
    rect: [i32; 4],
    color: [u8; 4],
) {
    let Some([x0, y0, x1, y1]) = clipped_screen_rect(plane, rect) else {
        return;
    };
    let mut y = snap_down_to_grid(y0, SPARSE_DOT_SPACING_PX);
    while y < y1 {
        let mut x = snap_down_to_grid(x0, SPARSE_DOT_SPACING_PX);
        while x < x1 {
            if x >= x0 && y >= y0 {
                plane.fill_rect([x, y, x + 1, y + 1], color);
            }
            x += SPARSE_DOT_SPACING_PX;
        }
        y += SPARSE_DOT_SPACING_PX;
    }
}

fn rasterize_hatch(
    plane: &mut crate::raster_plane::RasterPlane,
    rect: [i32; 4],
    color: [u8; 4],
    cross: bool,
) {
    let Some([x0, y0, x1, y1]) = clipped_screen_rect(plane, rect) else {
        return;
    };
    let mut y = snap_down_to_grid(y0, PATTERN_TILE_PX);
    while y < y1 {
        let mut x = snap_down_to_grid(x0, PATTERN_TILE_PX);
        while x < x1 {
            let left = x.max(x0);
            let top = y.max(y0);
            let right = (x + PATTERN_TILE_PX).min(x1);
            let bottom = (y + PATTERN_TILE_PX).min(y1);
            if right - left >= 3 && bottom - top >= 3 {
                rasterize_screen_line(
                    plane,
                    (left + PATTERN_INSET_PX, bottom - PATTERN_INSET_PX),
                    (right - PATTERN_INSET_PX, top + PATTERN_INSET_PX),
                    color,
                );
                if cross {
                    rasterize_screen_line(
                        plane,
                        (left + PATTERN_INSET_PX, top + PATTERN_INSET_PX),
                        (right - PATTERN_INSET_PX, bottom - PATTERN_INSET_PX),
                        color,
                    );
                }
            }
            x += PATTERN_TILE_PX;
        }
        y += PATTERN_TILE_PX;
    }
}

fn clipped_screen_rect(
    plane: &crate::raster_plane::RasterPlane,
    rect: [i32; 4],
) -> Option<[i32; 4]> {
    let [x0, y0, x1, y1] = rect;
    if x0 >= x1 || y0 >= y1 {
        return None;
    }
    let width = i32::try_from(plane.width).unwrap_or(i32::MAX);
    let height = i32::try_from(plane.height).unwrap_or(i32::MAX);
    let clipped = [
        x0.clamp(0, width),
        y0.clamp(0, height),
        x1.clamp(0, width),
        y1.clamp(0, height),
    ];
    (clipped[0] < clipped[2] && clipped[1] < clipped[3]).then_some(clipped)
}

fn snap_down_to_grid(value: i32, spacing: i32) -> i32 {
    value.div_euclid(spacing.max(1)) * spacing.max(1)
}

fn rasterize_line(
    plane: &mut crate::raster_plane::RasterPlane,
    line: &DrawLine,
    alpha: u8,
    world_to_screen: &impl Fn(Rect) -> [i32; 4],
) {
    let [x0, y0, _, _] = world_to_screen(point_rect(line.from));
    let [x1, y1, _, _] = world_to_screen(point_rect(line.to));
    rasterize_screen_line(plane, (x0, y0), (x1, y1), rgba(line.color, alpha));
}

fn rasterize_screen_line(
    plane: &mut crate::raster_plane::RasterPlane,
    from: (i32, i32),
    to: (i32, i32),
    color: [u8; 4],
) {
    let Some(((x0, y0), (x1, y1))) = clip_line_to_plane(from, to, plane.width, plane.height) else {
        return;
    };
    let mut x = x0;
    let mut y = y0;
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;

    loop {
        plane.fill_rect([x, y, x + 1, y + 1], color);
        if x == x1 && y == y1 {
            break;
        }
        let doubled_error = err * 2;
        if doubled_error >= dy {
            if x == x1 {
                break;
            }
            err += dy;
            x += sx;
        }
        if doubled_error <= dx {
            if y == y1 {
                break;
            }
            err += dx;
            y += sy;
        }
    }
}

fn point_rect(point: (i32, i32)) -> Rect {
    Rect::new(point.0, point.1, point.0, point.1)
}

fn clip_line_to_plane(
    from: (i32, i32),
    to: (i32, i32),
    width: usize,
    height: usize,
) -> Option<((i32, i32), (i32, i32))> {
    if width == 0 || height == 0 {
        return None;
    }

    let min_x = 0;
    let min_y = 0;
    let max_x = i32::try_from(width.saturating_sub(1)).unwrap_or(i32::MAX);
    let max_y = i32::try_from(height.saturating_sub(1)).unwrap_or(i32::MAX);
    let (mut x0, mut y0) = from;
    let (mut x1, mut y1) = to;
    let mut out0 = line_out_code(x0, y0, min_x, min_y, max_x, max_y);
    let mut out1 = line_out_code(x1, y1, min_x, min_y, max_x, max_y);

    loop {
        if out0 | out1 == 0 {
            return Some(((x0, y0), (x1, y1)));
        }
        if out0 & out1 != 0 {
            return None;
        }

        let out = if out0 != 0 { out0 } else { out1 };
        let (x, y) = clip_line_endpoint((x0, y0), (x1, y1), out, min_x, min_y, max_x, max_y);
        if out == out0 {
            x0 = x;
            y0 = y;
            out0 = line_out_code(x0, y0, min_x, min_y, max_x, max_y);
        } else {
            x1 = x;
            y1 = y;
            out1 = line_out_code(x1, y1, min_x, min_y, max_x, max_y);
        }
    }
}

fn clip_line_endpoint(
    from: (i32, i32),
    to: (i32, i32),
    out_code: u8,
    min_x: i32,
    min_y: i32,
    max_x: i32,
    max_y: i32,
) -> (i32, i32) {
    let (x0, y0) = (i64::from(from.0), i64::from(from.1));
    let (x1, y1) = (i64::from(to.0), i64::from(to.1));
    let dx = x1 - x0;
    let dy = y1 - y0;

    if out_code & LINE_TOP != 0 {
        let y = i64::from(min_y);
        let x = if dy == 0 { x0 } else { x0 + dx * (y - y0) / dy };
        (clamp_i64_to_i32(x), min_y)
    } else if out_code & LINE_BOTTOM != 0 {
        let y = i64::from(max_y);
        let x = if dy == 0 { x0 } else { x0 + dx * (y - y0) / dy };
        (clamp_i64_to_i32(x), max_y)
    } else if out_code & LINE_RIGHT != 0 {
        let x = i64::from(max_x);
        let y = if dx == 0 { y0 } else { y0 + dy * (x - x0) / dx };
        (max_x, clamp_i64_to_i32(y))
    } else {
        let x = i64::from(min_x);
        let y = if dx == 0 { y0 } else { y0 + dy * (x - x0) / dx };
        (min_x, clamp_i64_to_i32(y))
    }
}

const LINE_LEFT: u8 = 1;
const LINE_RIGHT: u8 = 2;
const LINE_TOP: u8 = 4;
const LINE_BOTTOM: u8 = 8;

fn line_out_code(x: i32, y: i32, min_x: i32, min_y: i32, max_x: i32, max_y: i32) -> u8 {
    let mut code = 0;
    if x < min_x {
        code |= LINE_LEFT;
    } else if x > max_x {
        code |= LINE_RIGHT;
    }
    if y < min_y {
        code |= LINE_TOP;
    } else if y > max_y {
        code |= LINE_BOTTOM;
    }
    code
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

pub struct RenderSurface {
    pub cache: crate::plane_cache::PlaneCache,
}

impl RenderSurface {
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: crate::plane_cache::PlaneCache::new(capacity),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use layout_display::{Color, LayerStyle, Pattern};
    use layout_render::{
        DrawBatch, DrawItem, DrawLine, DrawMarker, DrawRect, RenderCacheKey, RenderPlan,
        RenderPlanSource, RenderPlane, RenderPlanner, RenderSettings, Viewport,
    };
    use layoutdb::{LayoutDb, Rect};

    #[test]
    fn viewport_bucket_is_stable_for_small_pan_inside_bucket() {
        assert_eq!(
            viewport_bucket([0, 0, 1000, 1000], 256),
            viewport_bucket([10, 10, 1010, 1010], 256)
        );
    }

    #[test]
    fn viewport_bucket_changes_after_large_pan() {
        assert_ne!(
            viewport_bucket([0, 0, 1000, 1000], 256),
            viewport_bucket([300, 0, 1300, 1000], 256)
        );
    }

    #[test]
    fn viewport_bucket_clamps_non_positive_bucket_units() {
        assert_eq!(
            viewport_bucket([0, 0, 1000, 1000], 0),
            viewport_bucket([0, 0, 1000, 1000], -256)
        );
    }

    #[test]
    fn render_surface_constructs_plane_cache() {
        let mut surface = RenderSurface::new(1);
        let key = crate::plane_cache::PlaneKey::for_test("surface");

        assert!(surface.cache.get(&key).is_none());
    }

    #[test]
    fn build_plane_key_changes_with_data_revision() {
        let first = build_plane_key(
            [0, 0, 1024, 1024],
            256,
            RenderPlanSource::HierarchyFar,
            "steady",
            RenderCacheKey::default(),
            1,
            "Hierarchy",
        );
        let second = build_plane_key(
            [0, 0, 1024, 1024],
            256,
            RenderPlanSource::HierarchyFar,
            "steady",
            RenderCacheKey::default(),
            2,
            "Hierarchy",
        );

        assert_ne!(first, second);
    }

    #[test]
    fn build_plane_key_changes_with_viewport_bucket() {
        let first = build_plane_key(
            [0, 0, 1024, 1024],
            256,
            RenderPlanSource::HierarchyFar,
            "steady",
            RenderCacheKey::default(),
            1,
            "Hierarchy",
        );
        let second = build_plane_key(
            [300, 0, 1324, 1024],
            256,
            RenderPlanSource::HierarchyFar,
            "steady",
            RenderCacheKey::default(),
            1,
            "Hierarchy",
        );

        assert_ne!(first, second);
    }

    #[test]
    fn build_plane_key_includes_source_mode_and_plane() {
        let plan = render_plan_with_actual_cache_key(RenderPlanSource::HierarchyFar);
        let steady_fill = build_plan_plane_key([0, 0, 1024, 1024], 256, "steady", &plan, 1, "Fill");
        let interaction_fill =
            build_plan_plane_key([0, 0, 1024, 1024], 256, "interaction", &plan, 1, "Fill");
        let mid_plan = render_plan_with_actual_cache_key(RenderPlanSource::HierarchyMid);
        let steady_frame =
            build_plan_plane_key([0, 0, 1024, 1024], 256, "steady", &mid_plan, 1, "Frame");

        assert_ne!(steady_fill, interaction_fill);
        assert_ne!(steady_fill, steady_frame);
        assert!(steady_fill.lod_level.contains("HierarchyFar"));
        assert!(steady_fill.lod_level.contains("steady"));
        assert_eq!(steady_fill.plane, "Fill");
    }

    #[test]
    fn rasterize_plan_fills_fill_plane_rects() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.fill_alpha = 123;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Fill,
                display_layer_id: "m1".to_owned(),
                style,
                items: vec![DrawItem::Rect(DrawRect {
                    world: Rect::new(1, 1, 4, 3),
                    color: Color::rgb(200, 210, 220),
                    source_id: 1,
                    layer_id: 1,
                    composition: layout_display::CompositionMode::MaskPattern,
                })],
            }],
            source: RenderPlanSource::HierarchyMid,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 6, 5, rect_to_screen);

        assert_eq!(pixel(&plane, 1, 1), [10, 20, 30, 123]);
        assert_eq!(pixel(&plane, 3, 2), [10, 20, 30, 123]);
        assert_eq!(pixel(&plane, 4, 2), [0, 0, 0, 0]);
    }

    #[test]
    fn rasterize_plan_applies_fill_hatch_patterns() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.fill_alpha = 123;
        style.fill_pattern = Pattern::DiagonalHatch;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Fill,
                display_layer_id: "m1".to_owned(),
                style,
                items: vec![DrawItem::Rect(DrawRect {
                    world: Rect::new(0, 0, 12, 12),
                    color: Color::rgb(200, 210, 220),
                    source_id: 1,
                    layer_id: 1,
                    composition: layout_display::CompositionMode::MaskPattern,
                })],
            }],
            source: RenderPlanSource::HierarchyMid,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 12, 12, rect_to_screen);

        assert_eq!(pixel(&plane, 3, 7), [10, 20, 30, 123]);
        assert_eq!(pixel(&plane, 3, 8), [0, 0, 0, 0]);
    }

    #[test]
    fn rasterize_plan_applies_sparse_dot_patterns() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.fill_alpha = 123;
        style.fill_pattern = Pattern::SparseDots;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Fill,
                display_layer_id: "act".to_owned(),
                style,
                items: vec![DrawItem::Rect(DrawRect {
                    world: Rect::new(0, 0, 12, 12),
                    color: Color::rgb(200, 210, 220),
                    source_id: 1,
                    layer_id: 1,
                    composition: layout_display::CompositionMode::MaskPattern,
                })],
            }],
            source: RenderPlanSource::HierarchyMid,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 12, 12, rect_to_screen);

        assert_eq!(pixel(&plane, 0, 0), [10, 20, 30, 123]);
        assert_eq!(pixel(&plane, 1, 1), [0, 0, 0, 0]);
        assert_eq!(pixel(&plane, 9, 9), [10, 20, 30, 123]);
    }

    #[test]
    fn rasterize_plan_applies_texture_to_frame_rects() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.fill_alpha = 123;
        style.frame_alpha = 211;
        style.fill_pattern = Pattern::DiagonalHatch;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Frame,
                display_layer_id: "m1".to_owned(),
                style,
                items: vec![DrawItem::Rect(DrawRect {
                    world: Rect::new(0, 0, 12, 12),
                    color: Color::rgb(77, 88, 99),
                    source_id: 1,
                    layer_id: 1,
                    composition: layout_display::CompositionMode::MaskPattern,
                })],
            }],
            source: RenderPlanSource::HierarchyMid,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 12, 12, rect_to_screen);

        assert_eq!(pixel(&plane, 0, 0), [77, 88, 99, 211]);
        assert_eq!(pixel(&plane, 3, 7), [10, 20, 30, 123]);
        assert_eq!(pixel(&plane, 3, 8), [0, 0, 0, 0]);
    }

    #[test]
    fn rasterize_plan_strokes_frame_and_hierarchy_rects() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.fill_alpha = 0;
        style.frame_alpha = 211;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Hierarchy,
                display_layer_id: "cell".to_owned(),
                style,
                items: vec![DrawItem::Rect(DrawRect {
                    world: Rect::new(1, 1, 5, 5),
                    color: Color::rgb(77, 88, 99),
                    source_id: 1,
                    layer_id: 1,
                    composition: layout_display::CompositionMode::MaskPattern,
                })],
            }],
            source: RenderPlanSource::HierarchyFar,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 7, 7, rect_to_screen);

        assert_eq!(pixel(&plane, 1, 1), [77, 88, 99, 211]);
        assert_eq!(pixel(&plane, 4, 4), [77, 88, 99, 211]);
        assert_eq!(pixel(&plane, 3, 3), [0, 0, 0, 0]);
    }

    #[test]
    fn rasterize_plan_draws_hierarchy_lines() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.frame_alpha = 180;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Hierarchy,
                display_layer_id: "cell".to_owned(),
                style,
                items: vec![DrawItem::Line(DrawLine {
                    from: (0, 0),
                    to: (5, 5),
                    color: Color::rgb(77, 88, 99),
                    source_id: 1,
                    layer_id: 1,
                })],
            }],
            source: RenderPlanSource::HierarchyFar,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 6, 6, rect_to_screen);

        assert_eq!(pixel(&plane, 0, 0), [77, 88, 99, 180]);
        assert_eq!(pixel(&plane, 3, 3), [77, 88, 99, 180]);
        assert_eq!(pixel(&plane, 5, 5), [77, 88, 99, 180]);
    }

    #[test]
    fn rasterize_plan_draws_hierarchy_markers() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.marker_alpha = 190;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Hierarchy,
                display_layer_id: "cell".to_owned(),
                style,
                items: vec![DrawItem::Marker(DrawMarker {
                    world: Rect::new(2, 2, 3, 3),
                    color: Color::rgb(77, 88, 99),
                    source_id: 1,
                    layer_id: 1,
                })],
            }],
            source: RenderPlanSource::HierarchyFar,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 6, 6, rect_to_screen);

        assert_eq!(pixel(&plane, 1, 1), [77, 88, 99, 190]);
        assert_eq!(pixel(&plane, 2, 2), [77, 88, 99, 190]);
        assert_eq!(pixel(&plane, 3, 3), [77, 88, 99, 190]);
        assert_eq!(pixel(&plane, 4, 4), [0, 0, 0, 0]);
    }

    #[test]
    fn rasterize_plan_skips_fully_offscreen_lines() {
        let plan = hierarchy_line_plan((-1_000_000, -20), (-500_000, -20));

        let plane = rasterize_plan(&plan, 6, 6, rect_to_screen);

        assert!(plane
            .pixels
            .chunks_exact(4)
            .all(|pixel| pixel == [0, 0, 0, 0]));
    }

    #[test]
    fn rasterize_plan_draws_only_visible_segment_for_partially_clipped_lines() {
        let plan = hierarchy_line_plan((-1_000_000, 2), (3, 2));

        let plane = rasterize_plan(&plan, 6, 6, rect_to_screen);

        assert_eq!(pixel(&plane, 0, 2), [77, 88, 99, 180]);
        assert_eq!(pixel(&plane, 1, 2), [77, 88, 99, 180]);
        assert_eq!(pixel(&plane, 2, 2), [77, 88, 99, 180]);
        assert_eq!(pixel(&plane, 3, 2), [77, 88, 99, 180]);
        assert_eq!(pixel(&plane, 4, 2), [0, 0, 0, 0]);
    }

    #[test]
    fn clip_line_to_plane_rejects_fully_offscreen_segments() {
        assert_eq!(
            clip_line_to_plane((-1_000_000, -20), (-500_000, -20), 6, 6),
            None
        );
    }

    #[test]
    fn clip_line_to_plane_trims_partially_visible_segments() {
        assert_eq!(
            clip_line_to_plane((-1_000_000, 2), (3, 2), 6, 6),
            Some(((0, 2), (3, 2)))
        );
    }

    #[test]
    fn rasterize_plan_draws_marker_plane_markers() {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.marker_alpha = 180;
        let plan = RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Marker,
                display_layer_id: "marker".to_owned(),
                style,
                items: vec![DrawItem::Marker(DrawMarker {
                    world: Rect::new(1, 1, 3, 3),
                    color: Color::rgb(111, 122, 133),
                    source_id: 2,
                    layer_id: 1,
                })],
            }],
            source: RenderPlanSource::HierarchyFar,
            ..Default::default()
        };

        let plane = rasterize_plan(&plan, 6, 6, rect_to_screen);

        assert_eq!(pixel(&plane, 1, 1), [111, 122, 133, 180]);
        assert_eq!(pixel(&plane, 2, 2), [111, 122, 133, 180]);
        assert_eq!(pixel(&plane, 3, 3), [111, 122, 133, 180]);
        assert_eq!(pixel(&plane, 4, 4), [0, 0, 0, 0]);
    }

    fn rect_to_screen(rect: Rect) -> [i32; 4] {
        [rect.x1, rect.y1, rect.x2, rect.y2]
    }

    fn render_plan_with_actual_cache_key(source: RenderPlanSource) -> RenderPlan {
        let db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));
        let display = layout_display::DisplayModel::from_layout_layers(db.layers());
        let viewport = Viewport::new(Rect::new(0, 0, 100, 100), 10.0, 10.0);
        let planner = RenderPlanner::new(RenderSettings::default());
        RenderPlan {
            source,
            cache_key: planner.cache_key_with_source(&display, viewport, source),
            ..Default::default()
        }
    }

    fn hierarchy_line_plan(from: (i32, i32), to: (i32, i32)) -> RenderPlan {
        let mut style = LayerStyle::new(Color::rgb(10, 20, 30), Color::rgb(200, 210, 220));
        style.frame_alpha = 180;
        RenderPlan {
            batches: vec![DrawBatch {
                plane: RenderPlane::Hierarchy,
                display_layer_id: "cell".to_owned(),
                style,
                items: vec![DrawItem::Line(DrawLine {
                    from,
                    to,
                    color: Color::rgb(77, 88, 99),
                    source_id: 1,
                    layer_id: 1,
                })],
            }],
            source: RenderPlanSource::HierarchyFar,
            ..Default::default()
        }
    }

    fn pixel(plane: &crate::plane_cache::CachedPlane, x: usize, y: usize) -> [u8; 4] {
        let offset = (y * plane.width + x) * 4;
        plane.pixels[offset..offset + 4].try_into().unwrap()
    }
}
