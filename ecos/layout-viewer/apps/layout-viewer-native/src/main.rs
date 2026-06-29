mod plane_cache;
mod raster_plane;
mod render_surface;

use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender},
};

use anyhow::Result;
use clap::Parser;
use eframe::egui;
use layout_display::{Color, DisplayModel, LayerStyle, Pattern, ResolvedDisplayLayer};
use layout_render::{
    classify_lod, DrawItem, LodHysteresisState, LodLevel, LodStats, PickHit, PickHitTarget,
    PickRequest, RenderPlan, RenderPlanSource, RenderPlane, RenderPlanner, RenderSettings,
    Viewport,
};
use layoutdb::{
    CellViewState, HierarchyPolicy, InstancePath, LayoutSession, PackageLayoutSource, Rect,
    ShapeKind, ViewportLoadBatch,
};

const TARGET_REPAINT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(16);
const MAX_FPS_SAMPLE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
const FRAME_RATE_SAMPLE_COUNT: usize = 120;
const PLANE_CACHE_TILE_PX: f32 = 256.0;
const PLANE_CACHE_MARGIN_TILES: i32 = 1;
const DETAIL_LOAD_TILE_PX: f32 = 256.0;
const DETAIL_LOAD_MARGIN_TILES: i32 = 1;
const DETAIL_LOAD_MAX_VIEWPORT_WORLD_AREA_RATIO: f64 = 0.15;
const SIDEBAR_DEFAULT_WIDTH: f32 = 320.0;
const SIDEBAR_MIN_WIDTH: f32 = 190.0;
const SIDEBAR_MAX_WIDTH: f32 = 640.0;
const MAX_PATTERN_OPS_PER_RECT: usize = 512;
const MAX_HATCH_OPS_PER_RECT: usize = 256;
const PATTERN_TILE_PX: f32 = 10.0;
const SPARSE_DOT_SPACING_PX: f32 = 9.0;
const NEAR_RASTER_ITEM_THRESHOLD: usize = 10_000;
const NEAR_RASTER_OPS_THRESHOLD: usize = 6_000;
const DIE_BOUNDARY_WIDTH: f32 = 2.0;
const CORE_BOUNDARY_WIDTH: f32 = 1.0;

#[derive(Debug, Parser)]
#[command(name = "layout-viewer-native")]
struct Args {
    package_root: PathBuf,

    #[arg(long, default_value_t = 128)]
    cache_capacity: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let app = LayoutViewerV2App::open(args)?;
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1280.0, 860.0]),
        ..Default::default()
    };
    eframe::run_native(
        window_title(),
        native_options,
        Box::new(move |_cc| Ok(Box::new(app))),
    )
    .map_err(|err| anyhow::anyhow!("{err}"))?;
    Ok(())
}

fn window_title() -> &'static str {
    "ECOS Layout Viewer"
}

struct LayoutViewerV2App {
    loaded: Option<LoadedViewerState>,
    session_load: Option<SessionLoadHandle>,
    view: Option<V2ViewState>,
    hierarchy_policy: HierarchyPolicy,
    lod_tuning: LodTuningState,
    frame_rate: FrameRateState,
    last_interaction_at: Option<std::time::Instant>,
    interaction_settle_ms: u64,
    async_load: AsyncLoadState,
    render_surface: render_surface::RenderSurface,
    render_surface_texture: Option<egui::TextureHandle>,
    render_surface_texture_key: Option<plane_cache::PlaneKey>,
    render_surface_texture_world: Option<Rect>,
    load_generation: u64,
    last_render_plan: Option<layout_render::RenderPlan>,
    last_render_plan_revision: u64,
    last_render_plan_interaction_coarse: bool,
    lod_hysteresis: LodHysteresisState,
    selected: Option<PickHit>,
    last_error: Option<String>,
    last_plan_batches: usize,
    last_plan_items: usize,
    last_plan_truncated: bool,
    last_plan_reused: bool,
    last_candidates_checked: usize,
    last_total_shapes: usize,
    last_hierarchy_candidates_checked: usize,
    last_total_hierarchy_instances: usize,
    last_display_cache_hits: usize,
    last_display_cache_misses: usize,
    last_plane_cache_hits: usize,
    last_plane_cache_misses: usize,
    last_used_plane_renderer: bool,
    last_paint_ops: usize,
    last_lod_stats: LodStats,
    layer_counts_cache: LayerCountsCache,
}

struct LoadedViewerState {
    session: LayoutSession,
    display: DisplayModel,
    cell_view: CellViewState,
    background_load: BackgroundLoadHandle,
}

#[cfg(any(debug_assertions, test))]
#[derive(Debug, Clone, Copy)]
struct DebugPanelSnapshot {
    scale_units_per_pixel: Option<f32>,
    render_source: Option<RenderPlanSource>,
    render_revision: u64,
    interaction_active: bool,
    interaction_coarse: bool,
    plan_reused: bool,
    plan_batches: usize,
    plan_items: usize,
    plan_truncated: bool,
    candidates_checked: usize,
    total_shapes: usize,
    hierarchy_candidates_checked: usize,
    total_hierarchy_instances: usize,
    display_cache_hits: usize,
    display_cache_misses: usize,
    plane_cache_hits: usize,
    plane_cache_misses: usize,
    used_plane_renderer: bool,
    paint_ops: usize,
    lod_stats: LodStats,
}

#[derive(Debug, Default)]
struct LayerCountsCache {
    revision: Option<u64>,
    counts: BTreeMap<u16, usize>,
    hits: usize,
    misses: usize,
}

impl LayerCountsCache {
    fn get_or_build(&mut self, db: &layoutdb::LayoutDb, revision: u64) -> BTreeMap<u16, usize> {
        if self.revision == Some(revision) {
            self.hits += 1;
            return self.counts.clone();
        }
        self.misses += 1;
        self.counts = loaded_physical_layer_counts(db);
        self.revision = Some(revision);
        self.counts.clone()
    }

    fn clear(&mut self) {
        self.revision = None;
        self.counts.clear();
    }
}

#[derive(Debug, Clone, Copy)]
struct FrameRateState {
    last_frame_at: Option<std::time::Instant>,
    fps: f32,
    active_fps: f32,
    last_frame_ms: f32,
    p95_frame_ms: f32,
    samples_ms: [f32; FRAME_RATE_SAMPLE_COUNT],
    sample_count: usize,
    sample_cursor: usize,
}

impl Default for FrameRateState {
    fn default() -> Self {
        Self {
            last_frame_at: None,
            fps: 0.0,
            active_fps: 0.0,
            last_frame_ms: 0.0,
            p95_frame_ms: 0.0,
            samples_ms: [0.0; FRAME_RATE_SAMPLE_COUNT],
            sample_count: 0,
            sample_cursor: 0,
        }
    }
}

impl FrameRateState {
    fn record_frame_delta(&mut self, duration: std::time::Duration) {
        let sample_duration = duration.max(TARGET_REPAINT_INTERVAL);
        let seconds = sample_duration.as_secs_f32();
        if seconds <= f32::EPSILON {
            return;
        }
        let instant_fps = 1.0 / seconds;
        self.fps = if self.fps <= f32::EPSILON {
            instant_fps
        } else {
            self.fps * 0.85 + instant_fps * 0.15
        };
        self.active_fps = instant_fps;
        self.last_frame_ms = seconds * 1_000.0;
        self.samples_ms[self.sample_cursor] = self.last_frame_ms;
        self.sample_cursor = (self.sample_cursor + 1) % FRAME_RATE_SAMPLE_COUNT;
        self.sample_count = (self.sample_count + 1).min(FRAME_RATE_SAMPLE_COUNT);
        self.p95_frame_ms = percentile_frame_ms(&self.samples_ms[..self.sample_count], 0.95);
    }

    fn record_frame_at(&mut self, now: std::time::Instant) {
        if let Some(previous) = self.last_frame_at.replace(now) {
            let duration = now.saturating_duration_since(previous);
            if duration <= MAX_FPS_SAMPLE_INTERVAL {
                self.record_frame_delta(duration);
            }
        }
    }
}

fn percentile_frame_ms(samples: &[f32], percentile: f32) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let index = ((sorted.len() as f32 - 1.0) * percentile.clamp(0.0, 1.0)).ceil() as usize;
    sorted[index.min(sorted.len() - 1)]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LoadRequest {
    viewport: Rect,
    generation: u64,
}

#[derive(Debug)]
struct LoadResult {
    request: LoadRequest,
    result: Result<ViewportLoadBatch, String>,
}

struct BackgroundLoadHandle {
    requests: Sender<LoadRequest>,
    results: Receiver<LoadResult>,
}

struct SessionLoadHandle {
    results: Receiver<Result<LoadedViewerState, String>>,
}

impl SessionLoadHandle {
    fn spawn(package_root: PathBuf, cache_capacity: usize) -> Self {
        let (result_tx, result_rx) = mpsc::channel::<Result<LoadedViewerState, String>>();
        std::thread::spawn(move || {
            let result =
                load_viewer_state(package_root, cache_capacity).map_err(|error| error.to_string());
            let _ = result_tx.send(result);
        });
        Self { results: result_rx }
    }

    fn try_recv(&self) -> Option<Result<LoadedViewerState, String>> {
        self.results.try_recv().ok()
    }
}

fn load_viewer_state(package_root: PathBuf, cache_capacity: usize) -> Result<LoadedViewerState> {
    let source = PackageLayoutSource::open(&package_root, cache_capacity)?;
    let session = LayoutSession::from_source(source)?;
    let display = DisplayModel::from_layout_layers(session.db().layers());
    let cell_view = CellViewState::top(session.db());
    let background_load = BackgroundLoadHandle::spawn(package_root, cache_capacity);
    Ok(LoadedViewerState {
        session,
        display,
        cell_view,
        background_load,
    })
}

impl BackgroundLoadHandle {
    fn spawn(package_root: PathBuf, cache_capacity: usize) -> Self {
        let (request_tx, request_rx) = mpsc::channel::<LoadRequest>();
        let (result_tx, result_rx) = mpsc::channel::<LoadResult>();
        std::thread::spawn(move || {
            let mut source = match PackageLayoutSource::open(package_root, cache_capacity) {
                Ok(source) => source,
                Err(error) => {
                    let _ = result_tx.send(LoadResult {
                        request: LoadRequest {
                            viewport: Rect::new(0, 0, 0, 0),
                            generation: 0,
                        },
                        result: Err(error.to_string()),
                    });
                    return;
                }
            };
            while let Ok(mut request) = request_rx.recv() {
                while let Ok(newer) = request_rx.try_recv() {
                    request = newer;
                }
                let result = source
                    .load_viewport_batch(request.viewport)
                    .map_err(|error| error.to_string());
                if result_tx.send(LoadResult { request, result }).is_err() {
                    break;
                }
            }
        });
        Self {
            requests: request_tx,
            results: result_rx,
        }
    }

    fn request(&self, request: LoadRequest) {
        let _ = self.requests.send(request);
    }

    fn try_recv(&self) -> Option<LoadResult> {
        let mut latest = None;
        while let Ok(result) = self.results.try_recv() {
            latest = Some(result);
        }
        latest
    }
}

#[derive(Debug, Default)]
struct AsyncLoadState {
    pending: Option<LoadRequest>,
    in_flight: Option<LoadRequest>,
    completed: Option<LoadRequest>,
    completed_generation: u64,
}

impl AsyncLoadState {
    fn request(&mut self, viewport: Rect, generation: u64) {
        self.pending = Some(LoadRequest {
            viewport,
            generation,
        });
    }

    #[cfg(test)]
    fn pending_request(&self) -> Option<LoadRequest> {
        self.pending
    }

    fn take_pending(&mut self) -> Option<LoadRequest> {
        let request = self.pending.take();
        if let Some(request) = request {
            self.in_flight = Some(request);
        }
        request
    }

    fn clear_pending(&mut self) {
        self.pending = None;
    }

    fn has_pending_work(&self) -> bool {
        self.pending.is_some() || self.in_flight.is_some()
    }

    fn needs_request(&self, viewport: Rect) -> bool {
        ![self.pending, self.in_flight, self.completed]
            .into_iter()
            .flatten()
            .any(|request| rect_contains_rect(request.viewport, viewport))
    }

    fn mark_completed(&mut self, request: LoadRequest) {
        self.completed_generation = self.completed_generation.max(request.generation);
        self.completed = Some(request);
        if self
            .in_flight
            .map(|in_flight| in_flight.generation <= request.generation)
            .unwrap_or(false)
        {
            self.in_flight = None;
        }
    }

    fn should_apply_result(&self, request: LoadRequest) -> bool {
        request.generation >= self.completed_generation
            && self
                .pending
                .map(|pending| request.generation >= pending.generation)
                .unwrap_or(true)
    }
}

fn should_reuse_render_plan(
    cache_key_matches: bool,
    previous_source: RenderPlanSource,
    expected_source: RenderPlanSource,
) -> bool {
    cache_key_matches && previous_source == expected_source
}

fn plan_source_for_units_per_pixel(
    units_per_pixel: f32,
    settings: RenderSettings,
    hysteresis_state: &mut LodHysteresisState,
    hierarchy_exists: bool,
    overview_available: bool,
    has_visible_layers: bool,
) -> RenderPlanSource {
    if !has_visible_layers {
        return RenderPlanSource::FlatDetail;
    }
    let lod = classify_lod(units_per_pixel, settings, hysteresis_state);
    if matches!(lod, LodLevel::Mid)
        && hierarchy_exists
        && !settings.force_interaction_coarse
        && units_per_pixel <= settings.idle_detail_units_per_pixel
    {
        return RenderPlanSource::HierarchyNear;
    }
    match lod {
        LodLevel::Far if hierarchy_exists => RenderPlanSource::HierarchyFar,
        LodLevel::Mid if hierarchy_exists => RenderPlanSource::HierarchyMid,
        LodLevel::Near if hierarchy_exists => RenderPlanSource::HierarchyNear,
        LodLevel::Far | LodLevel::Mid if overview_available => RenderPlanSource::OverviewDensity,
        _ => RenderPlanSource::FlatDetail,
    }
}

fn overview_error_is_unavailable(error: &anyhow::Error) -> bool {
    let message = error.to_string();
    message.contains("overview pyramid is not available")
        || message.contains("overview pyramid has no levels")
}

fn should_request_smooth_repaint(interaction_active: bool, async_load: &AsyncLoadState) -> bool {
    interaction_active || async_load.has_pending_work()
}

fn canvas_scroll_delta(response_hovered: bool, raw_scroll_delta_y: f32) -> Option<f32> {
    (response_hovered && raw_scroll_delta_y.abs() > 0.0).then_some(raw_scroll_delta_y)
}

fn should_sample_layout_fps(
    layout_active_frame: bool,
    interaction_active: bool,
    async_load: &AsyncLoadState,
) -> bool {
    layout_active_frame || interaction_active || async_load.has_pending_work()
}

fn should_request_detail_tiles(source: RenderPlanSource, viewport: Rect, world_bbox: Rect) -> bool {
    let detail_backed = matches!(
        source,
        RenderPlanSource::FlatDetail | RenderPlanSource::HierarchyNear
    );
    detail_backed && detail_viewport_is_local(viewport, world_bbox)
}

fn detail_viewport_is_local(viewport: Rect, world_bbox: Rect) -> bool {
    let world_area = rect_area(world_bbox);
    if world_area <= 0.0 {
        return true;
    }
    rect_area(viewport) / world_area <= DETAIL_LOAD_MAX_VIEWPORT_WORLD_AREA_RATIO
}

fn rect_area(rect: Rect) -> f64 {
    f64::from(rect.width().max(0)) * f64::from(rect.height().max(0))
}

fn revision_for_render_source(
    source: RenderPlanSource,
    hierarchy_revision: u64,
    overview_revision: u64,
    detail_revision: u64,
) -> u64 {
    match source {
        RenderPlanSource::HierarchyFar | RenderPlanSource::HierarchyMid => hierarchy_revision,
        RenderPlanSource::OverviewDensity => overview_revision,
        RenderPlanSource::HierarchyNear | RenderPlanSource::FlatDetail => detail_revision,
    }
}

fn render_source_revision(session: &LayoutSession, source: RenderPlanSource) -> u64 {
    revision_for_render_source(
        source,
        session.hierarchy_revision(),
        session.overview_revision(),
        session.detail_revision(),
    )
}

fn should_check_overview_density(
    hierarchy_exists: bool,
    is_top_cell_view: bool,
    max_units_per_pixel: f32,
    render_settings: RenderSettings,
) -> bool {
    !hierarchy_exists
        && is_top_cell_view
        && max_units_per_pixel >= render_settings.hierarchy_coarse_units_per_pixel
}

fn use_plane_renderer(source: RenderPlanSource, item_count: usize, estimated_ops: usize) -> bool {
    matches!(
        source,
        RenderPlanSource::HierarchyFar
            | RenderPlanSource::HierarchyMid
            | RenderPlanSource::OverviewDensity
    ) || ((item_count >= NEAR_RASTER_ITEM_THRESHOLD || estimated_ops >= NEAR_RASTER_OPS_THRESHOLD)
        && matches!(
            source,
            RenderPlanSource::HierarchyNear | RenderPlanSource::FlatDetail
        ))
}

fn use_expanded_plane_cache_viewport(source: RenderPlanSource) -> bool {
    matches!(
        source,
        RenderPlanSource::HierarchyFar
            | RenderPlanSource::HierarchyMid
            | RenderPlanSource::OverviewDensity
    )
}

fn plane_cache_tile_units(view: V2ViewState) -> i32 {
    (view.units_per_pixel * PLANE_CACHE_TILE_PX).ceil().max(1.0) as i32
}

fn plane_cache_world_rect(screen_world: Rect, view: V2ViewState, source: RenderPlanSource) -> Rect {
    if !use_expanded_plane_cache_viewport(source) {
        return screen_world;
    }
    let tile_units = plane_cache_tile_units(view);
    let margin = tile_units.saturating_mul(PLANE_CACHE_MARGIN_TILES.max(0));
    Rect::new(
        floor_to_grid(screen_world.x1, tile_units).saturating_sub(margin),
        floor_to_grid(screen_world.y1, tile_units).saturating_sub(margin),
        ceil_to_grid(screen_world.x2, tile_units).saturating_add(margin),
        ceil_to_grid(screen_world.y2, tile_units).saturating_add(margin),
    )
}

fn detail_load_tile_units(view: V2ViewState) -> i32 {
    (view.units_per_pixel * DETAIL_LOAD_TILE_PX).ceil().max(1.0) as i32
}

fn detail_load_world_rect(screen_world: Rect, view: V2ViewState) -> Rect {
    let tile_units = detail_load_tile_units(view);
    let margin = tile_units.saturating_mul(DETAIL_LOAD_MARGIN_TILES.max(0));
    Rect::new(
        floor_to_grid(screen_world.x1, tile_units).saturating_sub(margin),
        floor_to_grid(screen_world.y1, tile_units).saturating_sub(margin),
        ceil_to_grid(screen_world.x2, tile_units).saturating_add(margin),
        ceil_to_grid(screen_world.y2, tile_units).saturating_add(margin),
    )
}

fn viewport_for_world_rect(world: Rect, view: V2ViewState) -> Viewport {
    Viewport::new(
        world,
        (world.width().max(1) as f32 / view.units_per_pixel.max(0.01)).max(1.0),
        (world.height().max(1) as f32 / view.units_per_pixel.max(0.01)).max(1.0),
    )
}

fn rect_contains_rect(outer: Rect, inner: Rect) -> bool {
    outer.x1 <= inner.x1 && outer.y1 <= inner.y1 && outer.x2 >= inner.x2 && outer.y2 >= inner.y2
}

fn floor_to_grid(value: i32, grid: i32) -> i32 {
    let grid = grid.max(1);
    value.div_euclid(grid).saturating_mul(grid)
}

fn ceil_to_grid(value: i32, grid: i32) -> i32 {
    let grid = grid.max(1);
    let floor = floor_to_grid(value, grid);
    if floor == value {
        floor
    } else {
        floor.saturating_add(grid)
    }
}

fn current_cell_has_instances(db: &layoutdb::LayoutDb, cell_view: &CellViewState) -> bool {
    db.cell(cell_view.target_cell())
        .map(|cell| !cell.instances().is_empty())
        .unwrap_or(false)
}

fn is_top_cell_view(db: &layoutdb::LayoutDb, cell_view: &CellViewState) -> bool {
    cell_view.context_cell() == db.top_cell()
        && cell_view.target_cell() == db.top_cell()
        && cell_view.specific_path().is_empty()
}

fn is_layers_panel_layer(layer: &layout_display::DisplayLayer) -> bool {
    matches!(
        layer.source,
        layout_display::SourceSelector::PhysicalLayer(_)
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ObjectVisibilityRow {
    label: &'static str,
    kind: ShapeKind,
}

fn object_visibility_rows() -> [ObjectVisibilityRow; 3] {
    [
        ObjectVisibilityRow {
            label: "Instances",
            kind: ShapeKind::Instance,
        },
        ObjectVisibilityRow {
            label: "PDN",
            kind: ShapeKind::SpecialWire,
        },
        ObjectVisibilityRow {
            label: "Net",
            kind: ShapeKind::RegularWire,
        },
    ]
}

fn die_core_boundaries(db: &layoutdb::LayoutDb) -> (Option<Rect>, Option<Rect>) {
    let mut die = None;
    let mut core = None;
    for shape in db.query_shapes(db.top_cell(), db.world_bbox()) {
        match shape.kind {
            ShapeKind::Die if die.is_none() => die = Some(shape.bbox),
            ShapeKind::Core if core.is_none() => core = Some(shape.bbox),
            _ => {}
        }
        if die.is_some() && core.is_some() {
            break;
        }
    }
    if die.is_none() {
        die = Some(db.world_bbox());
    }
    (die, core)
}

fn stroke_world_bbox(
    painter: &egui::Painter,
    canvas: egui::Rect,
    view: V2ViewState,
    bbox: Rect,
    color: egui::Color32,
    width: f32,
) {
    let screen = world_rect_to_screen(bbox, view, canvas);
    if screen.intersects(canvas) {
        painter.rect_stroke(
            screen,
            0.0,
            egui::Stroke::new(width.max(1.0), color),
            egui::StrokeKind::Inside,
        );
    }
}

fn draw_die_core_boundaries(
    painter: &egui::Painter,
    canvas: egui::Rect,
    view: V2ViewState,
    die: Option<Rect>,
    core: Option<Rect>,
) {
    if let Some(bbox) = die {
        stroke_world_bbox(
            painter,
            canvas,
            view,
            bbox,
            egui::Color32::from_rgb(96, 196, 255),
            DIE_BOUNDARY_WIDTH,
        );
    }
    if let Some(bbox) = core {
        stroke_world_bbox(
            painter,
            canvas,
            view,
            bbox,
            egui::Color32::from_rgb(128, 232, 196),
            CORE_BOUNDARY_WIDTH,
        );
    }
}

fn hierarchy_policy_from_tuning(tuning: LodTuningState) -> HierarchyPolicy {
    let mut policy = HierarchyPolicy::default();
    policy.max_depth = tuning.hierarchy_expand_depth.max(1);
    policy
}

fn sync_hierarchy_policy_from_tuning(policy: &mut HierarchyPolicy, tuning: LodTuningState) {
    policy.max_depth = tuning.hierarchy_expand_depth.max(1);
}

fn enter_path_for_hit(hit: &PickHit) -> Option<InstancePath> {
    if hit.instance_path.is_empty() {
        return None;
    }
    match hit.target {
        PickHitTarget::Shape | PickHitTarget::Instance { .. } => Some(hit.instance_path.clone()),
    }
}

#[cfg(test)]
fn selection_summary_text(hit: &PickHit) -> String {
    selection_inspector_rows(hit)
        .into_iter()
        .map(|(label, value)| format!("{}: {value}", label.to_ascii_lowercase()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn selection_inspector_rows(hit: &PickHit) -> Vec<(&'static str, String)> {
    let target = match hit.target {
        PickHitTarget::Shape => "shape".to_owned(),
        PickHitTarget::Instance {
            parent_cell,
            child_cell,
            instance_id,
            array_column,
            array_row,
        } => format!(
            "instance id={} parent={} child={} array={},{}",
            instance_id,
            parent_cell.raw(),
            child_cell.raw(),
            array_column,
            array_row
        ),
    };
    let (source_kind, source_file) = source_trace_for_hit(hit);
    vec![
        ("Target", target),
        ("Source Kind", source_kind.to_owned()),
        ("Source File", source_file.to_owned()),
        ("Source ID", hit.source_id.to_string()),
        ("Display Layer", hit.display_layer_id.clone()),
        ("Layer", hit.layer_id.to_string()),
        ("Shape Kind", shape_kind_label(hit.kind).to_owned()),
        ("Cell", hit.cell.raw().to_string()),
        ("Depth", hit.depth.to_string()),
        (
            "BBox",
            format!(
                "{}, {}, {}, {}",
                hit.bbox.x1, hit.bbox.y1, hit.bbox.x2, hit.bbox.y2
            ),
        ),
        ("Instance Path", instance_path_summary(&hit.instance_path)),
        ("Object Path", object_path_summary(&hit.object_path)),
    ]
}

fn source_trace_for_hit(hit: &PickHit) -> (&'static str, &'static str) {
    match hit.kind {
        ShapeKind::Die => ("die", "design/die.json"),
        ShapeKind::Core => ("core", "design/die.json"),
        ShapeKind::Instance => ("instance", "design/instances.json"),
        ShapeKind::RegularWire => ("regular_wire", "design/regular_wires.json"),
        ShapeKind::SpecialWire => ("special_wire", "design/special_wires.json"),
        ShapeKind::Via => (
            "via",
            "design/regular_wires.json | design/special_wires.json | design/io_pins.json",
        ),
        ShapeKind::IoPin => ("io_pin", "design/io_pins.json"),
        ShapeKind::Blockage => ("blockage", "design/blockages.json"),
        ShapeKind::Fill => ("fill", "design/fills.json"),
        ShapeKind::Region => ("region", "design/regions.json"),
        ShapeKind::Row => ("row", "design/rows.json"),
        ShapeKind::Track => ("track", "design/tracks.json"),
        ShapeKind::GCellGrid => ("gcell_grid", "design/gcell_grids.json"),
    }
}

fn shape_kind_label(kind: ShapeKind) -> &'static str {
    match kind {
        ShapeKind::Die => "die",
        ShapeKind::Core => "core",
        ShapeKind::Instance => "instance",
        ShapeKind::RegularWire => "regular_wire",
        ShapeKind::SpecialWire => "special_wire",
        ShapeKind::Via => "via",
        ShapeKind::IoPin => "io_pin",
        ShapeKind::Blockage => "blockage",
        ShapeKind::Fill => "fill",
        ShapeKind::Region => "region",
        ShapeKind::Row => "row",
        ShapeKind::Track => "track",
        ShapeKind::GCellGrid => "gcell_grid",
    }
}

fn instance_path_summary(path: &InstancePath) -> String {
    if path.is_empty() {
        return "top".to_owned();
    }
    path.elements()
        .iter()
        .map(|element| {
            format!(
                "{}:{}->{}[{},{}]",
                element.instance_id,
                element.parent_cell.raw(),
                element.child_cell.raw(),
                element.array_column,
                element.array_row
            )
        })
        .collect::<Vec<_>>()
        .join(" / ")
}

fn object_path_summary(path: &layoutdb::ObjectPath) -> String {
    match &path.target {
        layoutdb::ObjectPathTarget::Shape(shape) => {
            format!(
                "shape cell={} index={} source={}",
                shape.cell.raw(),
                shape.shape_index,
                shape.source_id
            )
        }
        layoutdb::ObjectPathTarget::Instance {
            parent_cell,
            instance_id,
            source_id,
            child_cell,
            array_column,
            array_row,
        } => format!(
            "instance id={} source={} parent={} child={} array={},{}",
            instance_id,
            source_id,
            parent_cell.raw(),
            child_cell.raw(),
            array_column,
            array_row
        ),
    }
}

fn canvas_interaction_sense() -> egui::Sense {
    egui::Sense::click_and_drag()
}

fn layer_swatch_size() -> egui::Vec2 {
    egui::vec2(12.0, 12.0)
}

fn layer_swatch_slot_size(row_height: f32) -> egui::Vec2 {
    egui::vec2(16.0, row_height.max(layer_swatch_size().y))
}

fn layer_swatch_rect(slot: egui::Rect, swatch_size: egui::Vec2) -> egui::Rect {
    egui::Rect::from_center_size(slot.center(), swatch_size)
}

#[cfg(any(debug_assertions, test))]
fn debug_panel_rows(snapshot: DebugPanelSnapshot) -> Vec<(&'static str, String)> {
    vec![
        (
            "Scale",
            snapshot
                .scale_units_per_pixel
                .map(|scale| format!("{scale:.3} units/px"))
                .unwrap_or_else(|| "n/a".to_string()),
        ),
        (
            "LOD Source",
            snapshot
                .render_source
                .map(|source| format!("{source:?}"))
                .unwrap_or_else(|| "none".to_string()),
        ),
        (
            "Interaction",
            if snapshot.interaction_active {
                "active".to_string()
            } else {
                "idle".to_string()
            },
        ),
        (
            "Coarse LOD",
            yes_no(snapshot.interaction_coarse).to_string(),
        ),
        ("Plan Reused", yes_no(snapshot.plan_reused).to_string()),
        ("Revision", snapshot.render_revision.to_string()),
        (
            "Plan",
            format!(
                "{} batches / {} items",
                snapshot.plan_batches, snapshot.plan_items
            ),
        ),
        ("Truncated", yes_no(snapshot.plan_truncated).to_string()),
        (
            "Query",
            format!(
                "{}/{} shapes",
                snapshot.candidates_checked, snapshot.total_shapes
            ),
        ),
        (
            "Hierarchy Query",
            format!(
                "{}/{} instances",
                snapshot.hierarchy_candidates_checked, snapshot.total_hierarchy_instances
            ),
        ),
        (
            "Display Cache",
            format!(
                "{} hits / {} misses",
                snapshot.display_cache_hits, snapshot.display_cache_misses
            ),
        ),
        (
            "Plane Cache",
            format!(
                "{} hits / {} misses",
                snapshot.plane_cache_hits, snapshot.plane_cache_misses
            ),
        ),
        (
            "Renderer",
            if snapshot.used_plane_renderer {
                "raster plane".to_string()
            } else {
                "egui vectors".to_string()
            },
        ),
        ("Paint Ops", snapshot.paint_ops.to_string()),
        ("LOD Exact", snapshot.lod_stats.exact.to_string()),
        ("LOD Frame", snapshot.lod_stats.frame_only.to_string()),
        ("LOD Marker", snapshot.lod_stats.marker.to_string()),
        (
            "LOD Hierarchy BBox",
            snapshot.lod_stats.hierarchy_bbox.to_string(),
        ),
        ("LOD Array BBox", snapshot.lod_stats.array_bbox.to_string()),
        ("LOD Array Grid", snapshot.lod_stats.array_grid.to_string()),
        ("LOD Coarse", snapshot.lod_stats.coarse.to_string()),
        ("LOD Suppress", snapshot.lod_stats.suppress.to_string()),
    ]
}

#[cfg(any(debug_assertions, test))]
fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

#[cfg(any(debug_assertions, test))]
fn should_show_debug_panel() -> bool {
    cfg!(debug_assertions)
}

#[cfg(test)]
fn sidebar_title_text() -> Option<&'static str> {
    None
}

fn draw_layer_visibility_row(
    ui: &mut egui::Ui,
    visible: &mut bool,
    label: String,
    color: Color,
) -> egui::Response {
    ui.horizontal(|ui| {
        let swatch_size = layer_swatch_size();
        let slot_size = layer_swatch_slot_size(ui.spacing().interact_size.y);
        let (slot, _) = ui.allocate_exact_size(slot_size, egui::Sense::hover());
        let rect = layer_swatch_rect(slot, swatch_size);
        ui.painter()
            .rect_filled(rect, 2.0, color_to_egui(color, 230));
        ui.checkbox(visible, label)
    })
    .inner
}

fn object_visibility_color(kind: ShapeKind) -> Color {
    match kind {
        ShapeKind::Instance => Color::rgb(176, 155, 255),
        ShapeKind::SpecialWire => Color::rgb(255, 214, 118),
        ShapeKind::RegularWire => Color::rgb(160, 218, 255),
        _ => Color::rgb(132, 146, 156),
    }
}

fn focus_view_on_cell_bbox(
    view: &mut Option<V2ViewState>,
    db: &layoutdb::LayoutDb,
    cell_view: &CellViewState,
) {
    let Some(target) = db.cell(cell_view.target_cell()) else {
        return;
    };
    let bbox = target.bbox();
    if let Some(current_view) = view.as_mut() {
        *current_view =
            V2ViewState::fit(bbox, current_view.screen_width, current_view.screen_height);
    } else {
        *view = Some(V2ViewState::fit(bbox, 1.0, 1.0));
    }
}

fn overview_density_usable(
    db: &layoutdb::LayoutDb,
    display: &DisplayModel,
    viewport: Viewport,
) -> bool {
    let layers = display.resolved_layers();
    if layers.is_empty() {
        return false;
    }
    db.overview_bins(viewport.world).any(|bin| {
        layers
            .iter()
            .any(|layer| layer_matches_overview_bin(layer, bin))
    })
}

fn layer_matches_overview_bin(
    layer: &ResolvedDisplayLayer,
    bin: &layoutdb::OverviewDensityBin,
) -> bool {
    match layer.source {
        layout_display::SourceSelector::PhysicalLayer(layer_id) => {
            bin.layer_id == layer_id && overview_kind_matches_physical_layer(bin.kind)
        }
        layout_display::SourceSelector::ShapeKind(kind) => bin.kind == kind,
        layout_display::SourceSelector::CellFrame
        | layout_display::SourceSelector::SelectionOverlay => false,
    }
}

fn overview_kind_matches_physical_layer(kind: ShapeKind) -> bool {
    matches!(
        kind,
        ShapeKind::RegularWire
            | ShapeKind::SpecialWire
            | ShapeKind::Via
            | ShapeKind::IoPin
            | ShapeKind::Blockage
            | ShapeKind::Fill
    )
}

#[derive(Debug, Clone, Copy)]
struct LodTuningState {
    small_shape_px: f32,
    frame_only_px: f32,
    fill_px: f32,
    fill_units_per_pixel: f32,
    long_shape_px: f32,
    occupancy_bin_px: f32,
    max_low_priority_quads_per_bin: usize,
    max_frames_per_bin: usize,
    max_markers_per_bin: usize,
    hierarchy_bbox_units_per_pixel: f32,
    hierarchy_coarse_units_per_pixel: f32,
    idle_detail_units_per_pixel: f32,
    array_bbox_units_per_pixel: f32,
    array_grid_units_per_pixel: f32,
    hierarchy_expand_depth: usize,
}

impl Default for LodTuningState {
    fn default() -> Self {
        Self::from_settings(RenderSettings::default())
    }
}

impl LodTuningState {
    fn from_settings(settings: RenderSettings) -> Self {
        Self {
            small_shape_px: settings.small_shape_px,
            frame_only_px: settings.frame_only_px,
            fill_px: settings.fill_px,
            fill_units_per_pixel: settings.fill_units_per_pixel,
            long_shape_px: settings.long_shape_px,
            occupancy_bin_px: settings.occupancy_bin_px,
            max_low_priority_quads_per_bin: settings.max_low_priority_quads_per_bin,
            max_frames_per_bin: settings.max_frames_per_bin,
            max_markers_per_bin: settings.max_markers_per_bin,
            hierarchy_bbox_units_per_pixel: settings.hierarchy_bbox_units_per_pixel,
            hierarchy_coarse_units_per_pixel: settings.hierarchy_coarse_units_per_pixel,
            idle_detail_units_per_pixel: settings.idle_detail_units_per_pixel,
            array_bbox_units_per_pixel: settings.array_bbox_units_per_pixel,
            array_grid_units_per_pixel: settings.array_grid_units_per_pixel,
            hierarchy_expand_depth: settings.hierarchy_expand_depth.min(64),
        }
    }

    fn render_settings(self, force_interaction_coarse: bool) -> RenderSettings {
        let frame_only_px = self.frame_only_px.max(self.small_shape_px);
        let mut settings = RenderSettings {
            small_shape_px: self.small_shape_px,
            frame_only_px,
            fill_px: self.fill_px.max(frame_only_px),
            fill_units_per_pixel: self.fill_units_per_pixel.max(0.01),
            long_shape_px: self.long_shape_px,
            occupancy_bin_px: self.occupancy_bin_px,
            max_low_priority_quads_per_bin: self.max_low_priority_quads_per_bin.max(1),
            max_frames_per_bin: self.max_frames_per_bin.max(1),
            max_markers_per_bin: self.max_markers_per_bin.max(1),
            hierarchy_bbox_units_per_pixel: self.hierarchy_bbox_units_per_pixel.max(1.0),
            hierarchy_coarse_units_per_pixel: self.hierarchy_coarse_units_per_pixel.max(1.0),
            idle_detail_units_per_pixel: self.idle_detail_units_per_pixel.max(1.0),
            array_bbox_units_per_pixel: self.array_bbox_units_per_pixel.max(1.0),
            array_grid_units_per_pixel: self.array_grid_units_per_pixel.max(1.0),
            hierarchy_expand_depth: self.hierarchy_expand_depth.max(1),
            ..Default::default()
        };
        settings.force_interaction_coarse = force_interaction_coarse;
        if force_interaction_coarse {
            settings.max_low_priority_quads_per_bin =
                settings.max_low_priority_quads_per_bin.min(8);
            settings.max_frames_per_bin = settings.max_frames_per_bin.min(6);
            settings.max_markers_per_bin = settings.max_markers_per_bin.min(1);
        }
        settings
    }
}

impl LayoutViewerV2App {
    fn open(args: Args) -> Result<Self> {
        Ok(Self {
            loaded: None,
            session_load: Some(SessionLoadHandle::spawn(
                args.package_root,
                args.cache_capacity,
            )),
            view: None,
            hierarchy_policy: hierarchy_policy_from_tuning(LodTuningState::default()),
            lod_tuning: LodTuningState::default(),
            frame_rate: FrameRateState::default(),
            last_interaction_at: None,
            interaction_settle_ms: 120,
            async_load: AsyncLoadState::default(),
            render_surface: render_surface::RenderSurface::new(32),
            render_surface_texture: None,
            render_surface_texture_key: None,
            render_surface_texture_world: None,
            load_generation: 0,
            last_render_plan: None,
            last_render_plan_revision: 0,
            last_render_plan_interaction_coarse: false,
            lod_hysteresis: LodHysteresisState::default(),
            selected: None,
            last_error: None,
            last_plan_batches: 0,
            last_plan_items: 0,
            last_plan_truncated: false,
            last_plan_reused: false,
            last_candidates_checked: 0,
            last_total_shapes: 0,
            last_hierarchy_candidates_checked: 0,
            last_total_hierarchy_instances: 0,
            last_display_cache_hits: 0,
            last_display_cache_misses: 0,
            last_plane_cache_hits: 0,
            last_plane_cache_misses: 0,
            last_used_plane_renderer: false,
            last_paint_ops: 0,
            last_lod_stats: LodStats::default(),
            layer_counts_cache: LayerCountsCache::default(),
        })
    }

    fn poll_session_load(&mut self, ctx: &egui::Context) {
        let Some(load) = self.session_load.as_ref() else {
            return;
        };
        match load.try_recv() {
            Some(Ok(loaded)) => {
                self.loaded = Some(loaded);
                self.session_load = None;
                self.last_error = None;
                self.clear_render_history();
                ctx.request_repaint();
            }
            Some(Err(error)) => {
                self.session_load = None;
                self.last_error = Some(error);
                ctx.request_repaint();
            }
            None => {
                ctx.request_repaint_after(TARGET_REPAINT_INTERVAL);
            }
        }
    }

    fn draw_loading_canvas(&self, ui: &mut egui::Ui, rect: egui::Rect) {
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(18, 24, 32));
        let text = self
            .last_error
            .as_ref()
            .map(|error| format!("Failed to load layout\n{error}"))
            .unwrap_or_else(|| "Loading layout...".to_owned());
        painter.text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            text,
            egui::FontId::monospace(14.0),
            egui::Color32::from_rgb(190, 198, 208),
        );
    }

    fn ensure_view(&mut self, world_bbox: Rect, size: egui::Vec2) {
        if self.view.is_none() && size.x > 0.0 && size.y > 0.0 {
            self.view = Some(V2ViewState::fit(world_bbox, size.x, size.y));
        }
    }

    fn interaction_active(&self) -> bool {
        self.last_interaction_at
            .map(|instant| instant.elapsed().as_millis() < u128::from(self.interaction_settle_ms))
            .unwrap_or(false)
    }

    fn draw_canvas(
        &mut self,
        ui: &mut egui::Ui,
        rect: egui::Rect,
        response: &egui::Response,
    ) -> bool {
        let Some(world_bbox) = self
            .loaded
            .as_ref()
            .map(|loaded| loaded.session.db().world_bbox())
        else {
            self.draw_loading_canvas(ui, rect);
            return false;
        };
        self.ensure_view(world_bbox, rect.size());
        let Some(loaded) = self.loaded.as_mut() else {
            return false;
        };
        let Some(mut view) = self.view else {
            return false;
        };
        view = view.with_screen_size(rect.width(), rect.height());
        let mut layout_active_frame = false;

        if response.dragged() {
            let delta = ui.input(|input| input.pointer.delta());
            view.pan_pixels(delta.x, delta.y);
            self.last_interaction_at = Some(std::time::Instant::now());
            layout_active_frame = true;
            ui.ctx().request_repaint();
        }

        let scroll = ui.input(|input| input.raw_scroll_delta.y);
        if let Some(scroll) = canvas_scroll_delta(response.hovered(), scroll) {
            let cursor = ui
                .input(|input| input.pointer.hover_pos())
                .unwrap_or(rect.center());
            view.zoom_at_screen(
                scroll_zoom_factor(scroll),
                cursor.x - rect.left(),
                cursor.y - rect.top(),
                rect.width(),
                rect.height(),
            );
            self.last_interaction_at = Some(std::time::Instant::now());
            layout_active_frame = true;
            ui.ctx().request_repaint();
        }

        if response.clicked_by(egui::PointerButton::Primary) {
            if let Some(cursor) = response.interact_pointer_pos() {
                let (world_x, world_y) = view.screen_to_world(
                    cursor.x - rect.left(),
                    cursor.y - rect.top(),
                    rect.width(),
                    rect.height(),
                );
                let tolerance = (view.units_per_pixel * 4.0).ceil().max(1.0) as i32;
                self.selected = RenderPlanner::new(self.lod_tuning.render_settings(false))
                    .pick_for_cell_view(
                        loaded.session.db(),
                        &loaded.display,
                        PickRequest::new(world_x.round() as i32, world_y.round() as i32, tolerance),
                        &loaded.cell_view,
                        &self.hierarchy_policy,
                    );
            }
        }

        self.view = Some(view);

        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(18, 24, 32));

        let viewport = Viewport::new(
            view.viewport_rect(rect.width(), rect.height()),
            rect.width(),
            rect.height(),
        );
        let interaction_active = self
            .last_interaction_at
            .map(|instant| instant.elapsed().as_millis() < u128::from(self.interaction_settle_ms))
            .unwrap_or(false);
        let render_settings = self.lod_tuning.render_settings(interaction_active);
        let max_units_per_pixel = viewport
            .units_per_pixel_x()
            .max(viewport.units_per_pixel_y());
        let hierarchy_exists = current_cell_has_instances(loaded.session.db(), &loaded.cell_view);
        if !hierarchy_exists
            && max_units_per_pixel >= render_settings.hierarchy_coarse_units_per_pixel
        {
            match loaded
                .session
                .ensure_overview_for_units_per_pixel(max_units_per_pixel)
            {
                Ok(true) => {
                    layout_active_frame = true;
                    ui.ctx().request_repaint();
                    self.last_error = None;
                }
                Ok(false) => {}
                Err(error) => {
                    if !overview_error_is_unavailable(&error) {
                        self.last_error = Some(error.to_string());
                    }
                }
            }
        }
        let planner = RenderPlanner::new(render_settings);
        sync_hierarchy_policy_from_tuning(&mut self.hierarchy_policy, self.lod_tuning);
        let mut preview_lod_hysteresis = self.lod_hysteresis;
        let has_visible_layers = !loaded.display.resolved_layers().is_empty();
        let overview_available =
            should_check_overview_density(
                hierarchy_exists,
                is_top_cell_view(loaded.session.db(), &loaded.cell_view),
                max_units_per_pixel,
                render_settings,
            ) && overview_density_usable(loaded.session.db(), &loaded.display, viewport);
        let expected_source = plan_source_for_units_per_pixel(
            max_units_per_pixel,
            render_settings,
            &mut preview_lod_hysteresis,
            hierarchy_exists,
            overview_available,
            has_visible_layers,
        );
        if let Some(result) = loaded.background_load.try_recv() {
            if self.async_load.should_apply_result(result.request) {
                match result.result {
                    Ok(batch) => match loaded.session.apply_viewport_batch(batch) {
                        Ok(_stats) => {
                            self.async_load.mark_completed(result.request);
                            layout_active_frame = true;
                            self.last_error = None;
                            ui.ctx().request_repaint();
                        }
                        Err(error) => {
                            self.last_error = Some(error.to_string());
                        }
                    },
                    Err(error) => {
                        self.last_error = Some(error);
                    }
                }
            }
        }
        if should_request_detail_tiles(
            expected_source,
            viewport.world,
            loaded.session.db().world_bbox(),
        ) {
            let detail_load_viewport = detail_load_world_rect(viewport.world, view);
            if interaction_active {
                self.load_generation += 1;
                self.async_load
                    .request(detail_load_viewport, self.load_generation);
                self.last_error = None;
            } else {
                if self.async_load.needs_request(detail_load_viewport) {
                    self.load_generation += 1;
                    self.async_load
                        .request(detail_load_viewport, self.load_generation);
                }
                if let Some(request) = self.async_load.take_pending() {
                    loaded.background_load.request(request);
                }
            }
        } else {
            self.async_load.clear_pending();
        }

        let screen_world = viewport.world;
        let cache_world = plane_cache_world_rect(screen_world, view, expected_source);
        let plan_viewport = viewport_for_world_rect(cache_world, view);
        let expected_cache_key = planner.cache_key_for_cell_view(
            &loaded.display,
            plan_viewport,
            expected_source,
            &loaded.cell_view,
            &self.hierarchy_policy,
        );
        let current_revision = render_source_revision(&loaded.session, expected_source);
        let cache_key_matches = self
            .last_render_plan
            .as_ref()
            .map(|plan| plan.cache_key == expected_cache_key)
            .unwrap_or(false)
            && self.last_render_plan_revision == current_revision;
        let last_source = self
            .last_render_plan
            .as_ref()
            .map(|plan| plan.source)
            .unwrap_or_default();
        let skip_planning =
            should_reuse_render_plan(cache_key_matches, last_source, expected_source);
        if skip_planning {
            self.lod_hysteresis = preview_lod_hysteresis;
        } else {
            let plan = planner.plan_for_cell_view(
                loaded.session.db(),
                &loaded.display,
                plan_viewport,
                &loaded.cell_view,
                &self.hierarchy_policy,
                &mut self.lod_hysteresis,
            );
            self.last_render_plan = Some(plan);
            self.last_render_plan_revision = current_revision;
            self.last_render_plan_interaction_coarse = interaction_active;
        }
        let paint_plan = self.last_render_plan.as_ref().unwrap();
        let plan_truncated = paint_plan.truncated;
        let reuse_last_plan = skip_planning;

        self.last_plan_batches = paint_plan.batches.len();
        self.last_plan_items = render_plan_item_count(&paint_plan);
        self.last_plan_truncated = plan_truncated;
        self.last_plan_reused = reuse_last_plan;
        self.last_candidates_checked = paint_plan.query_stats.candidates_checked;
        self.last_total_shapes = paint_plan.query_stats.total_shapes_in_cell;
        self.last_hierarchy_candidates_checked =
            paint_plan.query_stats.hierarchy_instance_candidates_checked;
        self.last_total_hierarchy_instances = paint_plan.query_stats.total_hierarchy_instances;
        self.last_display_cache_hits = paint_plan.query_stats.display_cache_hits;
        self.last_display_cache_misses = paint_plan.query_stats.display_cache_misses;
        self.last_lod_stats = paint_plan.lod_stats;
        let estimated_paint_ops = estimated_vector_paint_ops(paint_plan);

        let mut paint_ops = 1;
        self.last_used_plane_renderer =
            use_plane_renderer(paint_plan.source, self.last_plan_items, estimated_paint_ops);
        if self.last_used_plane_renderer {
            let before = self.render_surface.cache.stats();
            paint_ops += draw_cached_plane(
                &mut self.render_surface,
                &mut self.render_surface_texture,
                &mut self.render_surface_texture_key,
                &mut self.render_surface_texture_world,
                ui.ctx(),
                &painter,
                rect,
                view,
                paint_plan,
                screen_world,
                cache_world,
                interaction_active,
                current_revision,
            );
            let after = self.render_surface.cache.stats();
            self.last_plane_cache_hits = after.hits.saturating_sub(before.hits);
            self.last_plane_cache_misses = after.misses.saturating_sub(before.misses);
        } else {
            self.last_plane_cache_hits = 0;
            self.last_plane_cache_misses = 0;
            paint_ops += draw_plan_vectors(&painter, rect, view, paint_plan, interaction_active);
        }
        self.last_paint_ops = if self.last_used_plane_renderer {
            estimated_paint_ops
        } else {
            paint_ops
        };

        if let Some(view) = self.view {
            if is_top_cell_view(loaded.session.db(), &loaded.cell_view) {
                let (die, core) = die_core_boundaries(loaded.session.db());
                draw_die_core_boundaries(&painter, rect, view, die, core);
            }
        }

        if let Some(selected) = &self.selected {
            let selected_rect = world_rect_to_screen(selected.bbox, view, rect);
            if selected_rect.intersects(rect) {
                painter.rect_stroke(
                    selected_rect.expand(2.0),
                    0.0,
                    egui::Stroke::new(2.0, egui::Color32::from_rgb(255, 228, 94)),
                    egui::StrokeKind::Outside,
                );
            }
        }

        layout_active_frame
    }

    fn draw_sidebar(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("v2-display-panel-default-320")
            .resizable(true)
            .default_width(SIDEBAR_DEFAULT_WIDTH)
            .min_width(SIDEBAR_MIN_WIDTH)
            .max_width(SIDEBAR_MAX_WIDTH)
            .show(ctx, |ui| {
                egui::ScrollArea::vertical()
                    .id_salt("v2-display-panel-scroll")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        if let Some(mut loaded) = self.loaded.take() {
                            self.draw_layers_panel(ui, &mut loaded);
                            ui.separator();
                            self.draw_objects_panel(ui, &mut loaded);
                            #[cfg(debug_assertions)]
                            if should_show_debug_panel() {
                                ui.separator();
                                self.draw_debug_panel(ui);
                            }
                            ui.separator();
                            ui.label("Selection");
                            if let Some(hit) = self.selected.clone() {
                                egui::Grid::new("selection-inspector-grid")
                                    .num_columns(2)
                                    .striped(true)
                                    .show(ui, |ui| {
                                        for (label, value) in selection_inspector_rows(&hit) {
                                            ui.label(label);
                                            ui.monospace(value);
                                            ui.end_row();
                                        }
                                    });
                                let enter_path = enter_path_for_hit(&hit);
                                if ui
                                    .add_enabled(enter_path.is_some(), egui::Button::new("Enter"))
                                    .clicked()
                                {
                                    if let Some(path) = enter_path {
                                        self.enter_instance_path(&mut loaded, path);
                                    }
                                }
                            } else {
                                ui.label("No object selected");
                            }
                            self.loaded = Some(loaded);
                        } else {
                            ui.label(self.last_error.as_deref().unwrap_or("Loading layout..."));
                        }
                    });
            });
    }

    #[cfg(debug_assertions)]
    fn debug_panel_snapshot(&self) -> DebugPanelSnapshot {
        DebugPanelSnapshot {
            scale_units_per_pixel: self.view.as_ref().map(|view| view.units_per_pixel),
            render_source: self.last_render_plan.as_ref().map(|plan| plan.source),
            render_revision: self.last_render_plan_revision,
            interaction_active: self.interaction_active(),
            interaction_coarse: self.last_render_plan_interaction_coarse,
            plan_reused: self.last_plan_reused,
            plan_batches: self.last_plan_batches,
            plan_items: self.last_plan_items,
            plan_truncated: self.last_plan_truncated,
            candidates_checked: self.last_candidates_checked,
            total_shapes: self.last_total_shapes,
            hierarchy_candidates_checked: self.last_hierarchy_candidates_checked,
            total_hierarchy_instances: self.last_total_hierarchy_instances,
            display_cache_hits: self.last_display_cache_hits,
            display_cache_misses: self.last_display_cache_misses,
            plane_cache_hits: self.last_plane_cache_hits,
            plane_cache_misses: self.last_plane_cache_misses,
            used_plane_renderer: self.last_used_plane_renderer,
            paint_ops: self.last_paint_ops,
            lod_stats: self.last_lod_stats,
        }
    }

    #[cfg(debug_assertions)]
    fn draw_debug_panel(&self, ui: &mut egui::Ui) {
        ui.label("Debug");
        egui::Grid::new("debug-inspector-grid")
            .num_columns(2)
            .striped(true)
            .show(ui, |ui| {
                for (label, value) in debug_panel_rows(self.debug_panel_snapshot()) {
                    ui.label(label);
                    let value_width =
                        (ui.available_width() - ui.spacing().item_spacing.x).max(80.0);
                    ui.add_sized(
                        egui::vec2(value_width, 0.0),
                        egui::Label::new(egui::RichText::new(value).monospace()).wrap(),
                    );
                    ui.end_row();
                }
            });
    }

    fn draw_layers_panel(&mut self, ui: &mut egui::Ui, loaded: &mut LoadedViewerState) {
        ui.label("Layers");
        let layer_counts = self
            .layer_counts_cache
            .get_or_build(loaded.session.db(), loaded.session.revision());
        egui::ScrollArea::vertical()
            .id_salt("v2-display-panel-layers-scroll")
            .max_height(360.0)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for layer in loaded.display.layers_mut() {
                    if !is_layers_panel_layer(layer) {
                        continue;
                    }
                    let count = match layer.source {
                        layout_display::SourceSelector::PhysicalLayer(layer_id) => {
                            layer_counts.get(&layer_id).copied().unwrap_or(0)
                        }
                        _ => 0,
                    };
                    let label = format!("{} ({count})", layer.name);
                    draw_layer_visibility_row(
                        ui,
                        &mut layer.visible,
                        label,
                        layer.style.frame_color,
                    );
                }
            });
    }

    fn draw_objects_panel(&mut self, ui: &mut egui::Ui, loaded: &mut LoadedViewerState) {
        ui.label("Objects");
        let visibility = loaded.display.object_visibility_mut();
        for row in object_visibility_rows() {
            let visible = match row.kind {
                ShapeKind::Instance => &mut visibility.instances,
                ShapeKind::SpecialWire => &mut visibility.pdn,
                ShapeKind::RegularWire => &mut visibility.net,
                _ => unreachable!("object visibility row uses supported kinds"),
            };
            draw_layer_visibility_row(
                ui,
                visible,
                row.label.to_string(),
                object_visibility_color(row.kind),
            );
        }
    }

    fn clear_render_history(&mut self) {
        self.last_render_plan = None;
        self.lod_hysteresis = LodHysteresisState::default();
        self.last_render_plan_revision = 0;
        self.last_render_plan_interaction_coarse = false;
        self.last_plan_reused = false;
        self.layer_counts_cache.clear();
    }

    fn enter_instance_path(&mut self, loaded: &mut LoadedViewerState, path: InstancePath) {
        loaded.cell_view = CellViewState::from_path(loaded.cell_view.context_cell(), path);
        self.selected = None;
        self.clear_render_history();
        focus_view_on_cell_bbox(&mut self.view, loaded.session.db(), &loaded.cell_view);
    }
}

impl eframe::App for LayoutViewerV2App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_session_load(ctx);
        self.draw_sidebar(ctx);
        let mut layout_active_frame = false;
        egui::CentralPanel::default().show(ctx, |ui| {
            let available = ui.available_size();
            let (rect, response) = ui.allocate_exact_size(available, canvas_interaction_sense());
            layout_active_frame = self.draw_canvas(ui, rect, &response);
        });
        if should_sample_layout_fps(
            layout_active_frame,
            self.interaction_active(),
            &self.async_load,
        ) {
            self.frame_rate.record_frame_at(std::time::Instant::now());
        }
        if should_request_smooth_repaint(self.interaction_active(), &self.async_load) {
            ctx.request_repaint_after(TARGET_REPAINT_INTERVAL);
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct V2ViewState {
    center_x: f32,
    center_y: f32,
    units_per_pixel: f32,
    screen_width: f32,
    screen_height: f32,
}

impl V2ViewState {
    fn fit(world: Rect, screen_width: f32, screen_height: f32) -> Self {
        let width_upp = world.width().max(1) as f32 / screen_width.max(1.0);
        let height_upp = world.height().max(1) as f32 / screen_height.max(1.0);
        Self {
            center_x: (world.x1 as f32 + world.x2 as f32) * 0.5,
            center_y: (world.y1 as f32 + world.y2 as f32) * 0.5,
            units_per_pixel: width_upp.max(height_upp),
            screen_width: screen_width.max(1.0),
            screen_height: screen_height.max(1.0),
        }
    }

    fn with_screen_size(mut self, screen_width: f32, screen_height: f32) -> Self {
        self.screen_width = screen_width.max(1.0);
        self.screen_height = screen_height.max(1.0);
        self
    }

    fn viewport_rect(&self, screen_width: f32, screen_height: f32) -> Rect {
        let half_w = self.units_per_pixel * screen_width * 0.5;
        let half_h = self.units_per_pixel * screen_height * 0.5;
        Rect::new(
            (self.center_x - half_w).floor() as i32,
            (self.center_y - half_h).floor() as i32,
            (self.center_x + half_w).ceil() as i32,
            (self.center_y + half_h).ceil() as i32,
        )
    }

    fn pan_pixels(&mut self, dx: f32, dy: f32) {
        // World/EDA space is Y-up while the screen is Y-down, so dragging the
        // canvas down (dy > 0) must increase the EDA y at the screen center.
        self.center_x -= dx * self.units_per_pixel;
        self.center_y += dy * self.units_per_pixel;
    }

    fn zoom_at_screen(
        &mut self,
        factor: f32,
        sx: f32,
        sy: f32,
        screen_width: f32,
        screen_height: f32,
    ) {
        let before = self.screen_to_world(sx, sy, screen_width, screen_height);
        self.units_per_pixel = (self.units_per_pixel / factor).max(0.01);
        let after = self.screen_to_world(sx, sy, screen_width, screen_height);
        self.center_x += before.0 - after.0;
        self.center_y += before.1 - after.1;
    }

    fn screen_to_world(
        &self,
        sx: f32,
        sy: f32,
        screen_width: f32,
        screen_height: f32,
    ) -> (f32, f32) {
        // EDA/world coordinates are Y-up; the screen is Y-down. The Y axis is
        // flipped here so the rest of the pipeline can stay in raw EDA space.
        let world_x = self.center_x + (sx - screen_width * 0.5) * self.units_per_pixel;
        let world_y = self.center_y - (sy - screen_height * 0.5) * self.units_per_pixel;
        (world_x, world_y)
    }

    fn world_to_screen(&self, x: f32, y: f32, screen_width: f32, screen_height: f32) -> (f32, f32) {
        (
            (x - self.center_x) / self.units_per_pixel + screen_width * 0.5,
            (self.center_y - y) / self.units_per_pixel + screen_height * 0.5,
        )
    }
}

fn world_rect_to_screen(world: Rect, view: V2ViewState, screen: egui::Rect) -> egui::Rect {
    let (x1, y1) = view.world_to_screen(
        world.x1 as f32,
        world.y1 as f32,
        screen.width(),
        screen.height(),
    );
    let (x2, y2) = view.world_to_screen(
        world.x2 as f32,
        world.y2 as f32,
        screen.width(),
        screen.height(),
    );
    egui::Rect::from_min_max(
        egui::pos2(screen.left() + x1.min(x2), screen.top() + y1.min(y2)),
        egui::pos2(screen.left() + x1.max(x2), screen.top() + y1.max(y2)),
    )
}

fn world_rect_to_canvas_pixels(
    world: Rect,
    view: V2ViewState,
    screen_width: f32,
    screen_height: f32,
) -> [i32; 4] {
    let (x1, y1) = view.world_to_screen(
        world.x1 as f32,
        world.y1 as f32,
        screen_width,
        screen_height,
    );
    let (x2, y2) = view.world_to_screen(
        world.x2 as f32,
        world.y2 as f32,
        screen_width,
        screen_height,
    );
    [
        x1.min(x2).floor() as i32,
        y1.min(y2).floor() as i32,
        x1.max(x2).ceil() as i32,
        y1.max(y2).ceil() as i32,
    ]
}

fn world_point_to_screen(world: (i32, i32), view: V2ViewState, screen: egui::Rect) -> egui::Pos2 {
    let (x, y) = view.world_to_screen(
        world.0 as f32,
        world.1 as f32,
        screen.width(),
        screen.height(),
    );
    egui::pos2(screen.left() + x, screen.top() + y)
}

fn draw_plan_vectors(
    painter: &egui::Painter,
    rect: egui::Rect,
    view: V2ViewState,
    paint_plan: &RenderPlan,
    interaction_active: bool,
) -> usize {
    let mut paint_ops = 0;
    for batch in &paint_plan.batches {
        for item in &batch.items {
            match (batch.plane, item) {
                (RenderPlane::Fill, DrawItem::Rect(item)) => {
                    let draw_rect = world_rect_to_screen(item.world, view, rect);
                    if let Some(fill_rect) = clipped_screen_rect(draw_rect, rect) {
                        paint_ops +=
                            draw_fill_rect(painter, fill_rect, &batch.style, interaction_active);
                    }
                }
                (RenderPlane::Hierarchy, DrawItem::Rect(item)) => {
                    let draw_rect = world_rect_to_screen(item.world, view, rect);
                    if draw_rect.intersects(rect) {
                        painter.rect_stroke(
                            draw_rect,
                            0.0,
                            egui::Stroke::new(1.0, color_to_egui(item.color, 190)),
                            egui::StrokeKind::Inside,
                        );
                        paint_ops += 1;
                    }
                }
                (RenderPlane::Hierarchy, DrawItem::Line(item)) => {
                    let from = world_point_to_screen(item.from, view, rect);
                    let to = world_point_to_screen(item.to, view, rect);
                    painter.line_segment(
                        [from, to],
                        egui::Stroke::new(1.0, color_to_egui(item.color, 150)),
                    );
                    paint_ops += 1;
                }
                (RenderPlane::Hierarchy, DrawItem::Marker(item)) => {
                    let draw_rect = world_rect_to_screen(item.world, view, rect);
                    if draw_rect.intersects(rect) {
                        let marker = egui::Rect::from_center_size(
                            draw_rect.center(),
                            egui::vec2(draw_rect.width().max(3.0), draw_rect.height().max(3.0)),
                        );
                        painter.rect_filled(marker, 0.0, color_to_egui(item.color, 220));
                        paint_ops += 1;
                    }
                }
                (RenderPlane::Frame, DrawItem::Rect(item)) => {
                    let draw_rect = world_rect_to_screen(item.world, view, rect);
                    if draw_rect.intersects(rect) {
                        if let Some(fill_rect) = clipped_screen_rect(draw_rect, rect) {
                            paint_ops += draw_fill_rect(
                                painter,
                                fill_rect,
                                &batch.style,
                                interaction_active,
                            );
                        }
                        painter.rect_stroke(
                            draw_rect,
                            0.0,
                            egui::Stroke::new(
                                f32::from(batch.style.line_width_px.max(1)),
                                color_to_egui(item.color, batch.style.frame_alpha),
                            ),
                            egui::StrokeKind::Inside,
                        );
                        paint_ops += 1;
                    }
                }
                (RenderPlane::Marker, DrawItem::Marker(item)) => {
                    let draw_rect = world_rect_to_screen(item.world, view, rect);
                    if draw_rect.intersects(rect) {
                        let marker = egui::Rect::from_center_size(
                            draw_rect.center(),
                            egui::vec2(draw_rect.width().max(3.0), draw_rect.height().max(3.0)),
                        );
                        painter.rect_filled(
                            marker,
                            0.0,
                            color_to_egui(item.color, batch.style.marker_alpha),
                        );
                        paint_ops += 1;
                    }
                }
                _ => {}
            }
        }
    }
    paint_ops
}

fn clipped_screen_rect(draw_rect: egui::Rect, clip_rect: egui::Rect) -> Option<egui::Rect> {
    let clipped = egui::Rect::from_min_max(
        egui::pos2(
            draw_rect.left().max(clip_rect.left()),
            draw_rect.top().max(clip_rect.top()),
        ),
        egui::pos2(
            draw_rect.right().min(clip_rect.right()),
            draw_rect.bottom().min(clip_rect.bottom()),
        ),
    );
    (clipped.width() > 0.0 && clipped.height() > 0.0).then_some(clipped)
}

fn plane_cache_key_for_render_surface(
    viewport: [i32; 4],
    tile_units: i32,
    plan: &RenderPlan,
    current_revision: u64,
    cache_width: usize,
    cache_height: usize,
    _interaction_active: bool,
) -> plane_cache::PlaneKey {
    render_surface::build_plan_plane_key(
        viewport,
        tile_units,
        "surface",
        plan,
        current_revision,
        &format!("RenderSurface:{cache_width}x{cache_height}"),
    )
}

fn draw_cached_plane(
    render_surface: &mut render_surface::RenderSurface,
    texture: &mut Option<egui::TextureHandle>,
    texture_key: &mut Option<plane_cache::PlaneKey>,
    texture_world: &mut Option<Rect>,
    ctx: &egui::Context,
    painter: &egui::Painter,
    screen_rect: egui::Rect,
    view: V2ViewState,
    plan: &RenderPlan,
    screen_world: Rect,
    cache_world: Rect,
    interaction_active: bool,
    current_revision: u64,
) -> usize {
    let cache_width = (cache_world.width().max(1) as f32 / view.units_per_pixel.max(0.01))
        .ceil()
        .max(1.0) as usize;
    let cache_height = (cache_world.height().max(1) as f32 / view.units_per_pixel.max(0.01))
        .ceil()
        .max(1.0) as usize;
    let cache_view = V2ViewState::fit(cache_world, cache_width as f32, cache_height as f32);
    let tile_units = plane_cache_tile_units(view);
    let key = plane_cache_key_for_render_surface(
        [
            cache_world.x1,
            cache_world.y1,
            cache_world.x2,
            cache_world.y2,
        ],
        tile_units,
        plan,
        current_revision,
        cache_width,
        cache_height,
        interaction_active,
    );
    let has_cached_texture = texture.is_some();
    match cached_plane_texture_action(
        texture_key.as_ref(),
        &key,
        has_cached_texture,
        interaction_active,
    ) {
        CachedPlaneTextureAction::UploadTexture => {
            let cached = if let Some(cached) = render_surface.cache.get(&key) {
                cached.clone()
            } else {
                let rasterized =
                    render_surface::rasterize_plan(plan, cache_width, cache_height, |world| {
                        world_rect_to_canvas_pixels(
                            world,
                            cache_view,
                            cache_width as f32,
                            cache_height as f32,
                        )
                    });
                render_surface.cache.insert(key.clone(), rasterized.clone());
                rasterized
            };
            let image = egui::ColorImage::from_rgba_unmultiplied(
                [cached.width, cached.height],
                &cached.pixels,
            );
            if let Some(texture) = texture {
                texture.set(image, egui::TextureOptions::NEAREST);
            } else {
                *texture = Some(ctx.load_texture(
                    "layout-viewer-render-surface",
                    image,
                    egui::TextureOptions::NEAREST,
                ));
            }
            *texture_key = Some(key);
            *texture_world = Some(cache_world);
        }
        CachedPlaneTextureAction::ReuseTexture => {
            let _ = render_surface.cache.get(&key);
            *texture_world = Some(cache_world);
        }
        CachedPlaneTextureAction::DeferUpload => {
            ui_deferred_plane_repaint(ctx);
        }
    }
    if let Some(texture) = texture {
        let image_world = texture_world.unwrap_or(cache_world);
        let image_width = (image_world.width().max(1) as f32 / view.units_per_pixel.max(0.01))
            .ceil()
            .max(1.0) as usize;
        let image_height = (image_world.height().max(1) as f32 / view.units_per_pixel.max(0.01))
            .ceil()
            .max(1.0) as usize;
        let image_view = V2ViewState::fit(image_world, image_width as f32, image_height as f32);
        let visible_world = if rect_contains_rect(cache_world, screen_world) {
            screen_world
        } else if !cache_world.intersects(screen_world) {
            return 0;
        } else {
            Rect::new(
                cache_world.x1.max(screen_world.x1),
                cache_world.y1.max(screen_world.y1),
                cache_world.x2.min(screen_world.x2),
                cache_world.y2.min(screen_world.y2),
            )
        };
        let visible_world = if rect_contains_rect(image_world, visible_world) {
            visible_world
        } else if !image_world.intersects(visible_world) {
            return 0;
        } else {
            Rect::new(
                image_world.x1.max(visible_world.x1),
                image_world.y1.max(visible_world.y1),
                image_world.x2.min(visible_world.x2),
                image_world.y2.min(visible_world.y2),
            )
        };
        let image_rect = world_rect_to_screen(visible_world, view, screen_rect);
        let [u0, v0, u1, v1] = world_rect_to_canvas_pixels(
            visible_world,
            image_view,
            image_width as f32,
            image_height as f32,
        );
        let uv = egui::Rect::from_min_max(
            egui::pos2(
                (u0 as f32 / image_width as f32).clamp(0.0, 1.0),
                (v0 as f32 / image_height as f32).clamp(0.0, 1.0),
            ),
            egui::pos2(
                (u1 as f32 / image_width as f32).clamp(0.0, 1.0),
                (v1 as f32 / image_height as f32).clamp(0.0, 1.0),
            ),
        );
        painter.image(texture.id(), image_rect, uv, egui::Color32::WHITE);
        1
    } else {
        0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CachedPlaneTextureAction {
    UploadTexture,
    ReuseTexture,
    DeferUpload,
}

fn cached_plane_texture_action(
    texture_key: Option<&plane_cache::PlaneKey>,
    current_key: &plane_cache::PlaneKey,
    has_texture: bool,
    interaction_active: bool,
) -> CachedPlaneTextureAction {
    if has_texture && texture_key == Some(current_key) {
        CachedPlaneTextureAction::ReuseTexture
    } else if interaction_active && has_texture {
        CachedPlaneTextureAction::DeferUpload
    } else {
        CachedPlaneTextureAction::UploadTexture
    }
}

fn ui_deferred_plane_repaint(ctx: &egui::Context) {
    ctx.request_repaint_after(TARGET_REPAINT_INTERVAL);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FillDrawMode {
    None,
    Solid,
    SparseDots,
    DiagonalHatch,
    CrossHatch,
}

fn fill_draw_mode(pattern: Pattern, interaction_active: bool) -> FillDrawMode {
    match pattern {
        Pattern::Hollow => FillDrawMode::None,
        Pattern::Solid => FillDrawMode::Solid,
        Pattern::SparseDots | Pattern::DiagonalHatch | Pattern::CrossHatch
            if interaction_active =>
        {
            FillDrawMode::Solid
        }
        Pattern::SparseDots => FillDrawMode::SparseDots,
        Pattern::DiagonalHatch => FillDrawMode::DiagonalHatch,
        Pattern::CrossHatch => FillDrawMode::CrossHatch,
    }
}

fn draw_fill_rect(
    painter: &egui::Painter,
    rect: egui::Rect,
    style: &LayerStyle,
    interaction_active: bool,
) -> usize {
    match fill_draw_mode(style.fill_pattern, interaction_active) {
        FillDrawMode::None => 0,
        FillDrawMode::Solid => {
            painter.rect_filled(
                rect,
                0.0,
                color_to_egui(
                    style.fill_color,
                    interaction_fill_alpha(
                        style.fill_pattern,
                        style.fill_alpha,
                        interaction_active,
                    ),
                ),
            );
            1
        }
        FillDrawMode::SparseDots => draw_sparse_dots(painter, rect, style),
        FillDrawMode::DiagonalHatch => draw_diagonal_hatch(painter, rect, style, false),
        FillDrawMode::CrossHatch => draw_diagonal_hatch(painter, rect, style, true),
    }
}

fn interaction_fill_alpha(pattern: Pattern, alpha: u8, interaction_active: bool) -> u8 {
    if interaction_active && !matches!(pattern, Pattern::Solid | Pattern::Hollow) {
        alpha.min(40)
    } else {
        alpha
    }
}

fn draw_sparse_dots(painter: &egui::Painter, rect: egui::Rect, style: &LayerStyle) -> usize {
    let color = color_to_egui(style.fill_color, style.fill_alpha);
    let spacing = dot_spacing_for_rect(rect, SPARSE_DOT_SPACING_PX);
    let mut ops = 0;
    let mut y = snap_to_grid(rect.top(), spacing);
    while y <= rect.bottom() {
        let mut x = snap_to_grid(rect.left(), spacing);
        while x <= rect.right() {
            if ops >= MAX_PATTERN_OPS_PER_RECT {
                return ops;
            }
            painter.rect_filled(
                egui::Rect::from_center_size(egui::pos2(x, y), egui::vec2(1.2, 1.2)),
                0.0,
                color,
            );
            ops += 1;
            x += spacing;
        }
        y += spacing;
    }
    ops
}

fn draw_diagonal_hatch(
    painter: &egui::Painter,
    rect: egui::Rect,
    style: &LayerStyle,
    cross: bool,
) -> usize {
    let color = color_to_egui(style.fill_color, style.fill_alpha);
    let stroke = egui::Stroke::new(1.0, color);
    let mut ops = 0;
    for segment in hatch_segments(rect, cross) {
        painter.line_segment(segment, stroke);
        ops += 1;
    }
    ops
}

fn hatch_segments(rect: egui::Rect, cross: bool) -> Vec<[egui::Pos2; 2]> {
    let rect = rect.shrink(2.0);
    if rect.width() < 3.0 || rect.height() < 3.0 {
        return Vec::new();
    }
    let spacing = hatch_spacing_for_rect(rect, PATTERN_TILE_PX, cross);
    let mut segments = Vec::new();
    append_hatch_segments(&mut segments, rect, spacing, false);
    if cross {
        append_hatch_segments(&mut segments, rect, spacing, true);
    }
    segments
}

fn append_hatch_segments(
    segments: &mut Vec<[egui::Pos2; 2]>,
    rect: egui::Rect,
    spacing: f32,
    backslash: bool,
) {
    let (min_c, max_c) = if backslash {
        (rect.top() - rect.right(), rect.bottom() - rect.left())
    } else {
        (rect.left() + rect.top(), rect.right() + rect.bottom())
    };
    let mut c = snap_to_grid(min_c, spacing);
    while c <= max_c {
        if segments.len() >= MAX_HATCH_OPS_PER_RECT {
            return;
        }
        let segment = if backslash {
            backslash_hatch_segment(rect, c)
        } else {
            slash_hatch_segment(rect, c)
        };
        if let Some(segment) = segment {
            segments.push(segment);
        }
        c += spacing;
    }
}

fn slash_hatch_segment(rect: egui::Rect, c: f32) -> Option<[egui::Pos2; 2]> {
    let mut points = Vec::with_capacity(4);
    push_unique_point_if_inside(&mut points, rect, egui::pos2(rect.left(), c - rect.left()));
    push_unique_point_if_inside(
        &mut points,
        rect,
        egui::pos2(rect.right(), c - rect.right()),
    );
    push_unique_point_if_inside(&mut points, rect, egui::pos2(c - rect.top(), rect.top()));
    push_unique_point_if_inside(
        &mut points,
        rect,
        egui::pos2(c - rect.bottom(), rect.bottom()),
    );
    longest_segment(points)
}

fn backslash_hatch_segment(rect: egui::Rect, c: f32) -> Option<[egui::Pos2; 2]> {
    let mut points = Vec::with_capacity(4);
    push_unique_point_if_inside(&mut points, rect, egui::pos2(rect.left(), c + rect.left()));
    push_unique_point_if_inside(
        &mut points,
        rect,
        egui::pos2(rect.right(), c + rect.right()),
    );
    push_unique_point_if_inside(&mut points, rect, egui::pos2(rect.top() - c, rect.top()));
    push_unique_point_if_inside(
        &mut points,
        rect,
        egui::pos2(rect.bottom() - c, rect.bottom()),
    );
    longest_segment(points)
}

fn push_unique_point_if_inside(points: &mut Vec<egui::Pos2>, rect: egui::Rect, point: egui::Pos2) {
    let epsilon = 0.05;
    if point.x < rect.left() - epsilon
        || point.x > rect.right() + epsilon
        || point.y < rect.top() - epsilon
        || point.y > rect.bottom() + epsilon
    {
        return;
    }
    let point = egui::pos2(
        point.x.clamp(rect.left(), rect.right()),
        point.y.clamp(rect.top(), rect.bottom()),
    );
    if points.iter().any(|existing| {
        (existing.x - point.x).abs() < epsilon && (existing.y - point.y).abs() < epsilon
    }) {
        return;
    }
    points.push(point);
}

fn longest_segment(points: Vec<egui::Pos2>) -> Option<[egui::Pos2; 2]> {
    if points.len() < 2 {
        return None;
    }
    let mut best = [points[0], points[1]];
    let mut best_distance = points[0].distance_sq(points[1]);
    for (index, first) in points.iter().enumerate() {
        for second in points.iter().skip(index + 1) {
            let distance = first.distance_sq(*second);
            if distance > best_distance {
                best = [*first, *second];
                best_distance = distance;
            }
        }
    }
    (best_distance >= 9.0).then_some(best)
}

fn hatch_spacing_for_rect(rect: egui::Rect, base_spacing: f32, cross: bool) -> f32 {
    let perimeter_span = rect.width().max(1.0) + rect.height().max(1.0);
    let multiplier = if cross { 2.0 } else { 1.0 };
    let estimated_ops = perimeter_span / base_spacing * multiplier;
    if estimated_ops <= MAX_HATCH_OPS_PER_RECT as f32 {
        base_spacing
    } else {
        let spacing = perimeter_span * multiplier / MAX_HATCH_OPS_PER_RECT as f32;
        spacing.ceil().max(base_spacing)
    }
}

fn dot_spacing_for_rect(rect: egui::Rect, base_spacing: f32) -> f32 {
    let area = rect.width().max(1.0) * rect.height().max(1.0);
    let estimated_ops = area / (base_spacing * base_spacing);
    if estimated_ops <= MAX_PATTERN_OPS_PER_RECT as f32 {
        base_spacing
    } else {
        let scale = (estimated_ops / MAX_PATTERN_OPS_PER_RECT as f32).sqrt();
        (base_spacing * scale).ceil().max(base_spacing)
    }
}

fn snap_to_grid(value: f32, spacing: f32) -> f32 {
    (value / spacing).floor() * spacing
}

fn color_to_egui(color: Color, alpha: u8) -> egui::Color32 {
    egui::Color32::from_rgba_unmultiplied(color.r, color.g, color.b, alpha)
}

fn loaded_physical_layer_counts(db: &layoutdb::LayoutDb) -> BTreeMap<u16, usize> {
    if !db.package_layer_counts().is_empty() {
        return db.package_layer_counts().clone();
    }
    let mut counts = BTreeMap::new();
    if let Some(cell) = db.cell(db.top_cell()) {
        for shape in cell.shapes() {
            *counts.entry(shape.layer_id).or_insert(0) += 1;
        }
    }
    counts
}

fn render_plan_item_count(plan: &layout_render::RenderPlan) -> usize {
    plan.batches.iter().map(|batch| batch.items.len()).sum()
}

fn estimated_vector_paint_ops(plan: &layout_render::RenderPlan) -> usize {
    plan.batches
        .iter()
        .map(|batch| {
            let item_cost = match (batch.plane, batch.style.fill_pattern) {
                (RenderPlane::Fill | RenderPlane::Frame, Pattern::CrossHatch) => 4,
                (RenderPlane::Fill | RenderPlane::Frame, Pattern::DiagonalHatch) => 3,
                (RenderPlane::Fill | RenderPlane::Frame, Pattern::SparseDots) => 2,
                (RenderPlane::Frame, _) => 2,
                _ => 1,
            };
            batch.items.len().saturating_mul(item_cost)
        })
        .sum()
}

fn scroll_zoom_factor(scroll: f32) -> f32 {
    if scroll > 0.0 {
        1.15
    } else {
        1.0 / 1.15
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cached_plane_texture_action, canvas_scroll_delta, fill_draw_mode, overview_density_usable,
        overview_error_is_unavailable, plan_source_for_units_per_pixel, plane_cache_world_rect,
        scroll_zoom_factor, selection_inspector_rows, should_check_overview_density,
        should_request_detail_tiles, should_request_smooth_repaint, should_reuse_render_plan,
        should_sample_layout_fps, use_plane_renderer, viewport_for_world_rect, Args,
        AsyncLoadState, CachedPlaneTextureAction, FillDrawMode, FrameRateState, LayoutViewerV2App,
        LoadRequest, LodTuningState,
    };
    use crate::plane_cache::PlaneKey;
    use layout_display::{Color, DisplayLayer, DisplayModel, LayerStyle, Pattern};
    use layout_render::{
        DrawBatch, DrawItem, DrawRect, LodHysteresisState, LodStats, PickHit, PickHitTarget,
        RenderPlan, RenderPlanSource, RenderPlane, RenderSettings,
    };
    use layoutdb::{
        CellViewState, HierarchyPolicy, InstancePath, InstancePathElement, LayerInfo, LayoutDb,
        ObjectPath, ObjectPathTarget, OverviewDensityBin, Rect, ShapeId, ShapeKind, ShapeRecord,
    };
    use std::{
        collections::BTreeMap,
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    static HIERARCHY_TEST_PACKAGE_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn app_open_returns_before_package_io() {
        let path = std::env::temp_dir().join(format!(
            "missing-layoutpkg-{}",
            HIERARCHY_TEST_PACKAGE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        assert!(!path.exists());

        let app = LayoutViewerV2App::open(Args {
            package_root: path,
            cache_capacity: 1,
        });

        assert!(
            app.is_ok(),
            "opening the app should not block on package IO"
        );
    }

    #[test]
    fn canvas_interaction_sense_supports_click_selection_and_drag_pan() {
        let sense = super::canvas_interaction_sense();

        assert!(sense.senses_click());
        assert!(sense.senses_drag());
    }

    fn projection_test_view() -> super::V2ViewState {
        super::V2ViewState {
            center_x: 500.0,
            center_y: 500.0,
            units_per_pixel: 4.0,
            screen_width: 100.0,
            screen_height: 80.0,
        }
    }

    #[test]
    fn screen_world_projection_round_trips() {
        let view = projection_test_view();
        for (sx, sy) in [(0.0, 0.0), (30.0, 70.0), (100.0, 80.0), (12.5, 64.0)] {
            let (wx, wy) = view.screen_to_world(sx, sy, view.screen_width, view.screen_height);
            let (rx, ry) = view.world_to_screen(wx, wy, view.screen_width, view.screen_height);
            assert!((rx - sx).abs() < 1e-3, "x round trip {sx} -> {rx}");
            assert!((ry - sy).abs() < 1e-3, "y round trip {sy} -> {ry}");
        }
    }

    #[test]
    fn higher_eda_y_projects_higher_on_screen() {
        let view = projection_test_view();
        let upper = view.world_to_screen(500.0, 600.0, view.screen_width, view.screen_height);
        let lower = view.world_to_screen(500.0, 400.0, view.screen_width, view.screen_height);
        // EDA Y-up: larger eda y must map to a smaller (higher) screen y.
        assert!(
            upper.1 < lower.1,
            "expected larger eda y to map higher on screen: {} vs {}",
            upper.1,
            lower.1
        );
        // X axis keeps its direction.
        let right = view.world_to_screen(700.0, 500.0, view.screen_width, view.screen_height);
        let left = view.world_to_screen(300.0, 500.0, view.screen_width, view.screen_height);
        assert!(right.0 > left.0);
    }

    #[test]
    fn fit_anchors_die_corners_with_y_up_orientation() {
        let view = super::V2ViewState::fit(Rect::new(0, 0, 1_000, 1_000), 100.0, 100.0);
        let bottom_left = view.world_to_screen(0.0, 0.0, 100.0, 100.0);
        let top_left = view.world_to_screen(0.0, 1_000.0, 100.0, 100.0);
        let bottom_right = view.world_to_screen(1_000.0, 0.0, 100.0, 100.0);
        // EDA bottom-left sits at the bottom of the screen (large screen y),
        // the die top edge sits near the top (small screen y).
        assert!(bottom_left.1 > top_left.1);
        assert!(bottom_right.0 > bottom_left.0);
    }

    #[test]
    fn pan_down_increases_center_eda_y() {
        let mut view = projection_test_view();
        let before = view.center_y;
        view.pan_pixels(0.0, 10.0);
        assert!(
            view.center_y > before,
            "dragging the canvas down should raise the EDA y at screen center"
        );
        // Horizontal pan keeps the existing direction.
        let mut horizontal = projection_test_view();
        let before_x = horizontal.center_x;
        horizontal.pan_pixels(10.0, 0.0);
        assert!(horizontal.center_x < before_x);
    }

    #[test]
    fn selection_inspector_rows_expose_json_trace_metadata() {
        let (_db, leaf_view) = hierarchy_test_db_and_leaf_view();
        let hit = sample_pick_hit(PickHitTarget::Shape, leaf_view.specific_path().clone());

        let rows = selection_inspector_rows(&hit);

        assert!(rows
            .iter()
            .any(|(label, value)| *label == "Source Kind" && value == "regular_wire"));
        assert!(rows.iter().any(|(label, value)| {
            *label == "Source File" && value == "design/regular_wires.json"
        }));
        assert!(rows
            .iter()
            .any(|(label, value)| *label == "Source ID" && value == "9"));
        assert!(rows
            .iter()
            .any(|(label, value)| *label == "Layer" && value == "1"));
        assert!(rows
            .iter()
            .any(|(label, value)| *label == "BBox" && value == "2, 2, 8, 8"));
        assert!(rows.iter().any(|(label, value)| {
            *label == "Instance Path" && value.contains("10") && value.contains("20")
        }));
        assert!(rows.iter().any(|(label, value)| {
            *label == "Object Path" && value.contains("shape") && value.contains("source=9")
        }));
    }

    #[test]
    fn selection_inspector_marks_via_source_as_ambiguous() {
        let (_db, leaf_view) = hierarchy_test_db_and_leaf_view();
        let mut hit = sample_pick_hit(PickHitTarget::Shape, leaf_view.specific_path().clone());
        hit.kind = ShapeKind::Via;

        let rows = selection_inspector_rows(&hit);

        let source_file = rows
            .iter()
            .find(|(label, _value)| *label == "Source File")
            .map(|(_label, value)| value.as_str())
            .expect("source file row should exist");
        assert!(source_file.contains("design/regular_wires.json"));
        assert!(source_file.contains("design/special_wires.json"));
        assert!(source_file.contains("design/io_pins.json"));
    }

    #[test]
    fn native_viewer_does_not_expose_load_timing_debug_output() {
        let source = include_str!("main.rs");

        assert!(!source.contains(&["Load", " Timing"].concat()));
        assert!(!source.contains(&["[layout-viewer] ", "load"].concat()));
        assert!(!source.contains(&["draw_", "load_timing_panel"].concat()));
    }

    #[test]
    fn frame_rate_state_tracks_smoothed_fps() {
        let mut frame_rate = FrameRateState::default();

        frame_rate.record_frame_delta(std::time::Duration::from_micros(16_667));
        assert!((frame_rate.fps - 60.0).abs() < 0.1);

        frame_rate.record_frame_delta(std::time::Duration::from_millis(100));
        assert!(frame_rate.fps < 60.0);
        assert!(frame_rate.fps > 10.0);
    }

    #[test]
    fn frame_rate_state_reports_active_fps_and_frame_percentiles() {
        let mut frame_rate = FrameRateState::default();

        frame_rate.record_frame_delta(std::time::Duration::from_millis(16));
        frame_rate.record_frame_delta(std::time::Duration::from_millis(20));
        frame_rate.record_frame_delta(std::time::Duration::from_millis(40));

        assert!((frame_rate.active_fps - 25.0).abs() < 0.1);
        assert!((frame_rate.last_frame_ms - 40.0).abs() < 0.1);
        assert!((frame_rate.p95_frame_ms - 40.0).abs() < 0.1);
    }

    #[test]
    fn frame_rate_state_caps_repaint_bursts_to_viewer_cadence() {
        let mut frame_rate = FrameRateState::default();

        frame_rate.record_frame_delta(std::time::Duration::from_millis(4));
        assert!(frame_rate.fps <= 63.0);

        frame_rate.record_frame_delta(std::time::Duration::from_millis(4));
        assert!(frame_rate.fps <= 63.0);
    }

    #[test]
    fn frame_rate_state_ignores_idle_gaps() {
        let mut frame_rate = FrameRateState::default();
        let t0 = std::time::Instant::now();

        frame_rate.record_frame_at(t0);
        frame_rate.record_frame_at(t0 + std::time::Duration::from_micros(16_667));
        let active_fps = frame_rate.fps;
        frame_rate.record_frame_at(t0 + std::time::Duration::from_secs(2));

        assert!((active_fps - 60.0).abs() < 0.1);
        assert!((frame_rate.fps - active_fps).abs() < 0.1);
    }

    #[test]
    fn async_load_state_keeps_only_latest_pending_request() {
        let mut state = AsyncLoadState::default();
        state.request(Rect::new(0, 0, 10, 10), 1);
        state.request(Rect::new(10, 10, 20, 20), 2);

        assert_eq!(state.pending_request().unwrap().generation, 2);
        assert_eq!(
            state.pending_request().unwrap().viewport,
            Rect::new(10, 10, 20, 20)
        );
    }

    #[test]
    fn async_load_state_rejects_stale_completed_results() {
        let mut state = AsyncLoadState::default();
        state.request(Rect::new(0, 0, 10, 10), 1);
        state.request(Rect::new(10, 10, 20, 20), 2);

        assert!(!state.should_apply_result(LoadRequest {
            viewport: Rect::new(0, 0, 10, 10),
            generation: 1,
        }));
        let latest = LoadRequest {
            viewport: Rect::new(10, 10, 20, 20),
            generation: 2,
        };
        assert!(state.should_apply_result(latest));

        state.mark_completed(latest);
        assert!(!state.should_apply_result(LoadRequest {
            viewport: Rect::new(0, 0, 10, 10),
            generation: 1,
        }));
    }

    #[test]
    fn async_load_state_does_not_request_loaded_or_in_flight_viewports() {
        let mut state = AsyncLoadState::default();
        let viewport = Rect::new(0, 0, 10, 10);
        state.request(viewport, 1);

        assert!(!state.needs_request(viewport));
        let request = state.take_pending().unwrap();
        assert!(!state.needs_request(viewport));

        state.mark_completed(request);
        assert!(!state.needs_request(viewport));
        assert!(state.needs_request(Rect::new(10, 10, 20, 20)));
    }

    #[test]
    fn async_load_state_reuses_covering_pending_in_flight_and_completed_viewports() {
        let mut state = AsyncLoadState::default();
        let requested = Rect::new(-256, -256, 768, 768);
        let covered = Rect::new(0, 0, 500, 500);
        let outside = Rect::new(760, 760, 900, 900);

        state.request(requested, 1);
        assert!(!state.needs_request(covered));

        let request = state.take_pending().unwrap();
        assert!(!state.needs_request(covered));

        state.mark_completed(request);
        assert!(!state.needs_request(covered));
        assert!(state.needs_request(outside));
    }

    #[test]
    fn async_load_state_reports_pending_work() {
        let mut state = AsyncLoadState::default();
        assert!(!state.has_pending_work());

        state.request(Rect::new(0, 0, 10, 10), 1);
        assert!(state.has_pending_work());

        let request = state.take_pending().unwrap();
        assert!(state.has_pending_work());

        state.mark_completed(request);
        assert!(!state.has_pending_work());
    }

    #[test]
    fn async_load_state_can_drop_pending_detail_request_when_lod_does_not_need_detail() {
        let mut state = AsyncLoadState::default();
        state.request(Rect::new(0, 0, 10, 10), 1);

        state.clear_pending();

        assert!(state.pending_request().is_none());
        assert!(!state.has_pending_work());
    }

    #[test]
    fn smooth_repaint_is_requested_during_interaction_or_loading() {
        let mut state = AsyncLoadState::default();
        assert!(!should_request_smooth_repaint(false, &state));
        assert!(should_request_smooth_repaint(true, &state));

        state.request(Rect::new(0, 0, 10, 10), 1);
        assert!(should_request_smooth_repaint(false, &state));
    }

    #[test]
    fn layout_fps_sampling_ignores_idle_hover_repaints() {
        let mut state = AsyncLoadState::default();

        assert!(!should_sample_layout_fps(false, false, &state));
        assert!(should_sample_layout_fps(true, false, &state));
        assert!(should_sample_layout_fps(false, true, &state));

        state.request(Rect::new(0, 0, 10, 10), 1);
        assert!(should_sample_layout_fps(false, false, &state));
    }

    #[test]
    fn render_plan_is_reused_only_for_matching_cache_keys() {
        assert!(should_reuse_render_plan(
            true,
            RenderPlanSource::HierarchyFar,
            RenderPlanSource::HierarchyFar
        ));
        assert!(!should_reuse_render_plan(
            false,
            RenderPlanSource::HierarchyFar,
            RenderPlanSource::HierarchyFar
        ));
        assert!(!should_reuse_render_plan(
            true,
            RenderPlanSource::HierarchyFar,
            RenderPlanSource::HierarchyMid
        ));
    }

    #[test]
    fn plane_renderer_is_used_for_cached_lod_sources_and_dense_detail_plans() {
        assert!(use_plane_renderer(RenderPlanSource::HierarchyFar, 0, 0));
        assert!(use_plane_renderer(RenderPlanSource::HierarchyMid, 0, 0));
        assert!(use_plane_renderer(RenderPlanSource::OverviewDensity, 0, 0));
        assert!(use_plane_renderer(
            RenderPlanSource::HierarchyNear,
            20_000,
            20_000
        ));
        assert!(use_plane_renderer(
            RenderPlanSource::FlatDetail,
            20_000,
            20_000
        ));
        assert!(!use_plane_renderer(
            RenderPlanSource::HierarchyNear,
            128,
            128
        ));
        assert!(!use_plane_renderer(RenderPlanSource::FlatDetail, 128, 128));
    }

    #[test]
    fn plane_renderer_is_used_for_hatch_heavy_near_plans() {
        assert!(use_plane_renderer(
            RenderPlanSource::HierarchyNear,
            3_000,
            8_000
        ));
        assert!(use_plane_renderer(
            RenderPlanSource::FlatDetail,
            3_000,
            8_000
        ));
    }

    #[test]
    fn vector_paint_ops_estimate_counts_hatched_fills_as_expensive() {
        let mut style = LayerStyle::new(Color::rgb(1, 2, 3), Color::rgb(4, 5, 6));
        style.fill_pattern = Pattern::CrossHatch;
        let plan = RenderPlan {
            source: RenderPlanSource::HierarchyNear,
            batches: vec![DrawBatch {
                plane: RenderPlane::Fill,
                display_layer_id: "m1".to_string(),
                style,
                items: vec![DrawItem::Rect(DrawRect {
                    world: Rect::new(0, 0, 100, 100),
                    color: Color::rgb(1, 2, 3),
                    source_id: 1,
                    layer_id: 1,
                    composition: layout_display::CompositionMode::Copy,
                })],
            }],
            ..Default::default()
        };

        assert!(super::estimated_vector_paint_ops(&plan) > super::render_plan_item_count(&plan));
    }

    #[test]
    fn layer_counts_cache_reuses_counts_for_matching_revision() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));
        db.add_layer(LayerInfo::new(1, "M1"));
        db.add_shape(
            db.top_cell(),
            ShapeRecord::new(Rect::new(0, 0, 10, 10), 1, ShapeKind::RegularWire, 1),
        );
        let mut cache = super::LayerCountsCache::default();

        let first = cache.get_or_build(&db, 7);
        let second = cache.get_or_build(&db, 7);
        let third = cache.get_or_build(&db, 8);

        assert_eq!(first.get(&1), Some(&1));
        assert_eq!(first, second);
        assert_eq!(third.get(&1), Some(&1));
        assert_eq!(cache.hits, 1);
        assert_eq!(cache.misses, 2);
    }

    #[test]
    fn far_plane_cache_viewport_is_expanded_and_grid_aligned() {
        let view = super::V2ViewState {
            center_x: 500.0,
            center_y: 500.0,
            units_per_pixel: 4.0,
            screen_width: 100.0,
            screen_height: 100.0,
        };
        let screen_world = Rect::new(300, 300, 700, 700);

        let cache_world =
            plane_cache_world_rect(screen_world, view, RenderPlanSource::HierarchyFar);

        assert_eq!(cache_world, Rect::new(-1024, -1024, 2048, 2048));
    }

    #[test]
    fn near_plane_cache_viewport_stays_exact() {
        let view = super::V2ViewState {
            center_x: 500.0,
            center_y: 500.0,
            units_per_pixel: 4.0,
            screen_width: 100.0,
            screen_height: 100.0,
        };
        let screen_world = Rect::new(300, 300, 700, 700);

        let cache_world =
            plane_cache_world_rect(screen_world, view, RenderPlanSource::HierarchyNear);

        assert_eq!(cache_world, screen_world);
    }

    #[test]
    fn detail_load_viewport_is_expanded_and_grid_aligned() {
        let view = super::V2ViewState {
            center_x: 500.0,
            center_y: 500.0,
            units_per_pixel: 4.0,
            screen_width: 100.0,
            screen_height: 100.0,
        };
        let screen_world = Rect::new(300, 300, 700, 700);

        let load_world = super::detail_load_world_rect(screen_world, view);

        assert_eq!(load_world, Rect::new(-1024, -1024, 2048, 2048));
    }

    #[test]
    fn small_detail_pan_reuses_load_viewport() {
        let view = super::V2ViewState {
            center_x: 500.0,
            center_y: 500.0,
            units_per_pixel: 4.0,
            screen_width: 100.0,
            screen_height: 100.0,
        };
        let mut panned = view;
        panned.pan_pixels(20.0, 0.0);

        let first_world = super::detail_load_world_rect(view.viewport_rect(100.0, 100.0), view);
        let panned_world =
            super::detail_load_world_rect(panned.viewport_rect(100.0, 100.0), panned);

        assert_eq!(first_world, panned_world);
    }

    #[test]
    fn small_far_pan_reuses_cache_viewport_and_plan_key() {
        let view = super::V2ViewState {
            center_x: 500.0,
            center_y: 500.0,
            units_per_pixel: 4.0,
            screen_width: 100.0,
            screen_height: 100.0,
        };
        let mut panned = view;
        panned.pan_pixels(20.0, 0.0);
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 3.0,
            hierarchy_coarse_units_per_pixel: 1.0,
            ..Default::default()
        };
        let planner = layout_render::RenderPlanner::new(settings);
        let model = DisplayModel::new();
        let db = LayoutDb::new("top", Rect::new(0, 0, 1_000, 1_000));
        let cell_view = CellViewState::top(&db);
        let policy = HierarchyPolicy::default();
        let source = RenderPlanSource::HierarchyFar;
        let first_world = plane_cache_world_rect(view.viewport_rect(100.0, 100.0), view, source);
        let panned_world =
            plane_cache_world_rect(panned.viewport_rect(100.0, 100.0), panned, source);

        assert_eq!(first_world, panned_world);
        assert_eq!(
            planner.cache_key_for_cell_view(
                &model,
                viewport_for_world_rect(first_world, view),
                source,
                &cell_view,
                &policy
            ),
            planner.cache_key_for_cell_view(
                &model,
                viewport_for_world_rect(panned_world, panned),
                source,
                &cell_view,
                &policy
            )
        );
    }

    #[test]
    fn plane_cache_key_is_stable_across_interaction_state_for_same_plan_pixels() {
        let plan = layout_render::RenderPlan {
            source: RenderPlanSource::HierarchyFar,
            cache_key: layout_render::RenderCacheKey::default(),
            ..Default::default()
        };
        let viewport = [0, 0, 2048, 2048];

        let interaction =
            super::plane_cache_key_for_render_surface(viewport, 1024, &plan, 1, 768, 768, true);
        let steady =
            super::plane_cache_key_for_render_surface(viewport, 1024, &plan, 1, 768, 768, false);

        assert_eq!(interaction, steady);
    }

    #[test]
    fn detail_tiles_are_requested_only_for_detail_backed_plan_sources() {
        let world = Rect::new(0, 0, 10_000, 10_000);
        let local = Rect::new(1_000, 1_000, 2_000, 2_000);

        assert!(!should_request_detail_tiles(
            RenderPlanSource::HierarchyFar,
            local,
            world
        ));
        assert!(!should_request_detail_tiles(
            RenderPlanSource::HierarchyMid,
            local,
            world
        ));
        assert!(!should_request_detail_tiles(
            RenderPlanSource::OverviewDensity,
            local,
            world
        ));
        assert!(should_request_detail_tiles(
            RenderPlanSource::HierarchyNear,
            local,
            world
        ));
        assert!(should_request_detail_tiles(
            RenderPlanSource::FlatDetail,
            local,
            world
        ));
    }

    #[test]
    fn detail_tiles_are_not_requested_for_large_viewports() {
        let world = Rect::new(0, 0, 1_000_000, 1_000_000);
        let nearly_global = Rect::new(0, 0, 900_000, 900_000);

        assert!(!should_request_detail_tiles(
            RenderPlanSource::HierarchyNear,
            nearly_global,
            world
        ));
        assert!(!should_request_detail_tiles(
            RenderPlanSource::FlatDetail,
            nearly_global,
            world
        ));
    }

    #[test]
    fn revision_for_render_source_follows_plan_data_dependencies() {
        assert_eq!(
            super::revision_for_render_source(RenderPlanSource::HierarchyFar, 11, 22, 33),
            11
        );
        assert_eq!(
            super::revision_for_render_source(RenderPlanSource::HierarchyMid, 11, 22, 33),
            11
        );
        assert_eq!(
            super::revision_for_render_source(RenderPlanSource::OverviewDensity, 11, 22, 33),
            22
        );
        assert_eq!(
            super::revision_for_render_source(RenderPlanSource::HierarchyNear, 11, 22, 33),
            33
        );
        assert_eq!(
            super::revision_for_render_source(RenderPlanSource::FlatDetail, 11, 22, 33),
            33
        );
    }

    #[test]
    fn hierarchy_policy_from_tuning_sets_max_depth_and_expands_arrays() {
        let tuning = LodTuningState {
            hierarchy_expand_depth: 0,
            ..Default::default()
        };

        let policy = super::hierarchy_policy_from_tuning(tuning);

        assert_eq!(policy.min_depth, 0);
        assert_eq!(policy.max_depth, 1);
        assert!(policy.expand_arrays);
    }

    #[test]
    fn current_cell_has_instances_uses_target_cell_not_top() {
        let (db, leaf_view) = hierarchy_test_db_and_leaf_view();

        assert!(!super::current_cell_has_instances(&db, &leaf_view));
        assert!(super::current_cell_has_instances(
            &db,
            &CellViewState::top(&db)
        ));
    }

    #[test]
    fn top_cell_view_helper_rejects_focused_child_views() {
        let (db, leaf_view) = hierarchy_test_db_and_leaf_view();

        assert!(super::is_top_cell_view(&db, &CellViewState::top(&db)));
        assert!(!super::is_top_cell_view(&db, &leaf_view));
    }

    #[test]
    fn die_core_boundaries_reads_top_cell_shapes() {
        let mut db = layoutdb::LayoutDb::new("unit", Rect::new(0, 0, 1000, 1000));
        db.add_shape(
            db.top_cell(),
            layoutdb::ShapeRecord::new(Rect::new(0, 0, 1000, 1000), 0, ShapeKind::Die, 0),
        );
        db.add_shape(
            db.top_cell(),
            layoutdb::ShapeRecord::new(Rect::new(100, 100, 900, 900), 0, ShapeKind::Core, 0),
        );

        let (die, core) = super::die_core_boundaries(&db);
        assert_eq!(die, Some(Rect::new(0, 0, 1000, 1000)));
        assert_eq!(core, Some(Rect::new(100, 100, 900, 900)));
    }

    #[test]
    fn focused_cell_view_pick_uses_child_local_coordinates() {
        let (db, leaf_view) = hierarchy_test_db_and_leaf_view();
        let mut model = DisplayModel::new();
        model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));

        let hit = layout_render::RenderPlanner::new(RenderSettings::default())
            .pick_for_cell_view(
                &db,
                &model,
                layout_render::PickRequest::new(4, 4, 1),
                &leaf_view,
                &HierarchyPolicy::default(),
            )
            .expect("focused leaf-local shape should be pickable");

        assert_eq!(hit.source_id, 9);
        assert_eq!(hit.bbox, Rect::new(2, 2, 8, 8));
    }

    #[test]
    fn enter_path_for_shape_hit_uses_shape_instance_path() {
        let (_db, leaf_view) = hierarchy_test_db_and_leaf_view();
        let hit = sample_pick_hit(PickHitTarget::Shape, leaf_view.specific_path().clone());

        let enter_path = super::enter_path_for_hit(&hit).expect("shape path should be enterable");

        assert_eq!(enter_path, leaf_view.specific_path().clone());
    }

    #[test]
    fn selection_summary_includes_target_and_path_depth() {
        let (db, leaf_view) = hierarchy_test_db_and_leaf_view();
        let hit = sample_pick_hit(PickHitTarget::Shape, leaf_view.specific_path().clone());

        let text = super::selection_summary_text(&hit);

        assert!(text.contains("target: shape"));
        assert!(text.contains("depth: 2"));
        assert!(text.contains(&format!("cell: {}", db.cell_by_name("leaf").unwrap().raw())));
        assert!(text.contains("layer: 1"));
        assert!(text.contains("bbox: 2, 2, 8, 8"));
    }

    #[test]
    fn sidebar_default_width_stays_compact_while_max_width_allows_expansion() {
        assert_eq!(super::SIDEBAR_DEFAULT_WIDTH, 320.0);
        assert!(super::SIDEBAR_MAX_WIDTH > super::SIDEBAR_DEFAULT_WIDTH);
    }

    #[test]
    fn sidebar_omits_redundant_display_title() {
        assert_eq!(super::sidebar_title_text(), None);
    }

    #[test]
    fn sidebar_layers_panel_accepts_only_physical_layers() {
        let physical = DisplayLayer::physical_layer(1, "M1", LayerStyle::default_for_index(0));
        let instance = DisplayLayer::shape_kind(
            ShapeKind::Instance,
            "Instances",
            LayerStyle::default_for_index(1),
        );
        let net = DisplayLayer::shape_kind(
            ShapeKind::RegularWire,
            "Net",
            LayerStyle::default_for_index(2),
        );

        assert!(super::is_layers_panel_layer(&physical));
        assert!(!super::is_layers_panel_layer(&instance));
        assert!(!super::is_layers_panel_layer(&net));
    }

    #[test]
    fn sidebar_objects_panel_lists_instances_pdn_and_net() {
        let rows = super::object_visibility_rows();

        assert_eq!(
            rows.iter().map(|row| row.label).collect::<Vec<_>>(),
            vec!["Instances", "PDN", "Net"]
        );
        assert_eq!(
            rows.iter().map(|row| row.kind).collect::<Vec<_>>(),
            vec![
                ShapeKind::Instance,
                ShapeKind::SpecialWire,
                ShapeKind::RegularWire,
            ]
        );
    }

    #[test]
    fn debug_panel_rows_include_scale_and_lod_source() {
        let rows = super::debug_panel_rows(super::DebugPanelSnapshot {
            scale_units_per_pixel: Some(12.5),
            render_source: Some(RenderPlanSource::HierarchyMid),
            render_revision: 7,
            interaction_active: true,
            interaction_coarse: true,
            plan_reused: false,
            plan_batches: 3,
            plan_items: 42,
            plan_truncated: false,
            candidates_checked: 9,
            total_shapes: 100,
            hierarchy_candidates_checked: 2,
            total_hierarchy_instances: 6,
            display_cache_hits: 4,
            display_cache_misses: 1,
            plane_cache_hits: 5,
            plane_cache_misses: 0,
            used_plane_renderer: true,
            paint_ops: 123,
            lod_stats: LodStats {
                exact: 1,
                frame_only: 2,
                marker: 3,
                hierarchy_bbox: 4,
                array_bbox: 5,
                array_grid: 6,
                coarse: 7,
                suppress: 8,
            },
        });

        assert!(rows.contains(&("Scale", "12.500 units/px".to_string())));
        assert!(rows.contains(&("LOD Source", "HierarchyMid".to_string())));
        assert!(rows.contains(&("Coarse LOD", "yes".to_string())));
        assert!(rows.contains(&("LOD Exact", "1".to_string())));
        assert!(rows.contains(&("LOD Suppress", "8".to_string())));
    }

    #[test]
    fn debug_panel_rows_keep_values_compact_for_sidebar_width() {
        let rows = super::debug_panel_rows(super::DebugPanelSnapshot {
            scale_units_per_pixel: Some(85.232),
            render_source: Some(RenderPlanSource::HierarchyNear),
            render_revision: 0,
            interaction_active: false,
            interaction_coarse: false,
            plan_reused: true,
            plan_batches: 4,
            plan_items: 6799,
            plan_truncated: false,
            candidates_checked: 2,
            total_shapes: 2,
            hierarchy_candidates_checked: 607,
            total_hierarchy_instances: 775,
            display_cache_hits: 0,
            display_cache_misses: 0,
            plane_cache_hits: 1,
            plane_cache_misses: 0,
            used_plane_renderer: true,
            paint_ops: 7577,
            lod_stats: LodStats {
                exact: 0,
                frame_only: 389,
                marker: 6410,
                hierarchy_bbox: 0,
                array_bbox: 0,
                array_grid: 0,
                coarse: 0,
                suppress: 0,
            },
        });

        assert!(
            rows.iter().all(|(_label, value)| value.len() <= 32),
            "debug values should stay compact enough for the default sidebar: {rows:?}"
        );
    }

    #[test]
    fn debug_panel_is_visible_only_in_debug_builds() {
        assert_eq!(super::should_show_debug_panel(), cfg!(debug_assertions));
    }

    #[test]
    fn sidebar_does_not_render_hierarchy_module() {
        let source = include_str!("main.rs");

        assert!(!source.contains(&["self.", "draw_", "hierarchy_panel"].concat()));
        assert!(!source.contains(&["CollapsingHeader::new(", "\"Hier", "archy\"", ")",].concat()));
    }

    #[test]
    fn window_title_omits_version_suffix() {
        assert_eq!(super::window_title(), "ECOS Layout Viewer");
    }

    #[test]
    fn layer_swatch_uses_compact_fixed_size() {
        let size = super::layer_swatch_size();

        assert_eq!(size.x, 12.0);
        assert_eq!(size.y, 12.0);
    }

    #[test]
    fn layer_swatch_is_centered_inside_row_slot() {
        let slot = egui::Rect::from_min_size(egui::pos2(2.0, 4.0), egui::vec2(16.0, 24.0));
        let rect = super::layer_swatch_rect(slot, super::layer_swatch_size());

        assert_eq!(super::layer_swatch_slot_size(24.0).x, 16.0);
        assert_eq!(rect.center(), slot.center());
        assert_eq!(rect.size(), super::layer_swatch_size());
    }

    #[test]
    fn focus_view_on_cell_bbox_uses_existing_canvas_size() {
        let (db, leaf_view) = hierarchy_test_db_and_leaf_view();
        let mut view = Some(super::V2ViewState::fit(
            Rect::new(0, 0, 1000, 1000),
            500.0,
            250.0,
        ));

        super::focus_view_on_cell_bbox(&mut view, &db, &leaf_view);

        let focused = view.expect("focus should keep a view");
        assert_eq!(focused.center_x, 10.0);
        assert_eq!(focused.center_y, 10.0);
        assert!((focused.units_per_pixel - 0.08).abs() < 0.001);
    }

    #[test]
    fn native_lod_hysteresis_helper_preserves_state_between_plans() {
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };
        let mut state = LodHysteresisState::default();

        assert_eq!(
            plan_source_for_units_per_pixel(170.0, settings, &mut state, true, false, true),
            RenderPlanSource::HierarchyFar
        );
        assert_eq!(
            plan_source_for_units_per_pixel(155.0, settings, &mut state, true, false, true),
            RenderPlanSource::HierarchyFar
        );
        assert_eq!(
            plan_source_for_units_per_pixel(120.0, settings, &mut state, true, false, true),
            RenderPlanSource::HierarchyMid
        );
    }

    #[test]
    fn overview_density_check_is_skipped_when_hierarchy_already_drives_lod() {
        let settings = RenderSettings {
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };

        assert!(!should_check_overview_density(true, true, 768.0, settings));
        assert!(should_check_overview_density(false, true, 768.0, settings));
        assert!(!should_check_overview_density(
            false, false, 768.0, settings
        ));
        assert!(!should_check_overview_density(false, true, 16.0, settings));
    }

    #[test]
    fn native_lod_prediction_uses_overview_density_when_bins_are_available() {
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };
        let mut state = LodHysteresisState::default();

        assert_eq!(
            plan_source_for_units_per_pixel(170.0, settings, &mut state, true, true, true),
            RenderPlanSource::HierarchyFar
        );

        let mut flat_state = LodHysteresisState::default();
        assert_eq!(
            plan_source_for_units_per_pixel(170.0, settings, &mut flat_state, false, true, true),
            RenderPlanSource::OverviewDensity
        );

        let mut near_state = LodHysteresisState::default();
        assert_eq!(
            plan_source_for_units_per_pixel(8.0, settings, &mut near_state, true, true, true),
            RenderPlanSource::HierarchyNear
        );

        let mut unavailable_state = LodHysteresisState::default();
        assert_eq!(
            plan_source_for_units_per_pixel(
                170.0,
                settings,
                &mut unavailable_state,
                true,
                false,
                true,
            ),
            RenderPlanSource::HierarchyFar
        );
    }

    #[test]
    fn native_lod_prediction_prefers_hierarchy_when_hierarchy_and_overview_are_available() {
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };
        let mut state = LodHysteresisState::default();

        assert_eq!(
            plan_source_for_units_per_pixel(170.0, settings, &mut state, true, true, true),
            RenderPlanSource::HierarchyFar
        );
    }

    #[test]
    fn native_interaction_settings_do_not_shift_lod_thresholds() {
        let tuning = LodTuningState::default();

        let steady = tuning.render_settings(false);
        let interactive = tuning.render_settings(true);

        assert_eq!(
            interactive.hierarchy_bbox_units_per_pixel,
            steady.hierarchy_bbox_units_per_pixel
        );
        assert_eq!(
            interactive.hierarchy_coarse_units_per_pixel,
            steady.hierarchy_coarse_units_per_pixel
        );
        assert_eq!(
            interactive.idle_detail_units_per_pixel,
            steady.idle_detail_units_per_pixel
        );
        assert_eq!(
            interactive.array_bbox_units_per_pixel,
            steady.array_bbox_units_per_pixel
        );
        assert_eq!(
            interactive.array_grid_units_per_pixel,
            steady.array_grid_units_per_pixel
        );
        assert!(interactive.force_interaction_coarse);
        assert_eq!(interactive.max_render_items, steady.max_render_items);
    }

    #[test]
    fn native_lod_prediction_keeps_detail_source_during_interaction_at_same_zoom() {
        let tuning = LodTuningState::default();
        let steady_settings = tuning.render_settings(false);
        let interactive_settings = tuning.render_settings(true);
        let mut steady_state = LodHysteresisState::default();
        let mut interactive_state = LodHysteresisState::default();

        let steady_source = plan_source_for_units_per_pixel(
            30.0,
            steady_settings,
            &mut steady_state,
            true,
            true,
            true,
        );
        let interactive_source = plan_source_for_units_per_pixel(
            30.0,
            interactive_settings,
            &mut interactive_state,
            true,
            true,
            true,
        );

        assert_eq!(steady_source, RenderPlanSource::HierarchyNear);
        assert_eq!(interactive_source, steady_source);
    }

    #[test]
    fn native_lod_prediction_uses_idle_detail_boost_only_when_steady() {
        let tuning = LodTuningState::default();
        let steady_settings = tuning.render_settings(false);
        let interactive_settings = tuning.render_settings(true);
        let mut steady_state = LodHysteresisState::default();
        let mut interactive_state = LodHysteresisState::default();

        let steady_source = plan_source_for_units_per_pixel(
            71.0,
            steady_settings,
            &mut steady_state,
            true,
            true,
            true,
        );
        let interactive_source = plan_source_for_units_per_pixel(
            71.0,
            interactive_settings,
            &mut interactive_state,
            true,
            true,
            true,
        );

        assert_eq!(steady_source, RenderPlanSource::HierarchyNear);
        assert_eq!(interactive_source, RenderPlanSource::HierarchyMid);
    }

    #[test]
    fn native_interaction_settings_do_not_cap_global_render_items() {
        let tuning = LodTuningState::default();

        let steady = tuning.render_settings(false);
        let interactive = tuning.render_settings(true);

        assert_eq!(interactive.max_render_items, steady.max_render_items);
    }

    #[test]
    fn native_lod_prediction_returns_flat_when_no_layers_are_visible() {
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };
        let mut state = LodHysteresisState::default();

        assert_eq!(
            plan_source_for_units_per_pixel(170.0, settings, &mut state, true, true, false),
            RenderPlanSource::FlatDetail
        );
    }

    #[test]
    fn native_lod_prediction_ignores_unusable_overview_bins() {
        let settings = RenderSettings {
            hierarchy_bbox_units_per_pixel: 160.0,
            hierarchy_coarse_units_per_pixel: 32.0,
            ..Default::default()
        };
        let viewport = layout_render::Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let mut hidden_model = DisplayModel::new();
        hidden_model.add_layer(
            DisplayLayer::physical_layer(1, "M1", LayerStyle::default_for_index(0)).hidden(),
        );
        let mut unmatched_model = DisplayModel::new();
        unmatched_model.add_layer(DisplayLayer::physical_layer(
            2,
            "M2",
            LayerStyle::default_for_index(1),
        ));

        let mut hidden_state = LodHysteresisState::default();
        assert_eq!(
            plan_source_for_units_per_pixel(
                170.0,
                settings,
                &mut hidden_state,
                true,
                overview_density_usable(&db, &hidden_model, viewport),
                true,
            ),
            RenderPlanSource::HierarchyFar
        );

        let mut unmatched_state = LodHysteresisState::default();
        assert_eq!(
            plan_source_for_units_per_pixel(
                170.0,
                settings,
                &mut unmatched_state,
                false,
                overview_density_usable(&db, &unmatched_model, viewport),
                true,
            ),
            RenderPlanSource::FlatDetail
        );
    }

    #[test]
    fn native_overview_unavailable_errors_are_non_fatal() {
        let missing = anyhow::anyhow!("overview pyramid is not available");
        let empty = anyhow::anyhow!("overview pyramid has no levels");
        let corrupt = anyhow::anyhow!("failed to read overview/pyramid.bin");

        assert!(overview_error_is_unavailable(&missing));
        assert!(overview_error_is_unavailable(&empty));
        assert!(!overview_error_is_unavailable(&corrupt));
    }

    #[test]
    fn native_overview_usability_matches_physical_and_shape_kind_sources() {
        let viewport = layout_render::Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let mut physical_model = DisplayModel::new();
        physical_model.add_layer(DisplayLayer::physical_layer(
            1,
            "M1",
            LayerStyle::default_for_index(0),
        ));
        let mut kind_model = DisplayModel::new();
        kind_model.add_layer(DisplayLayer::shape_kind(
            ShapeKind::RegularWire,
            "regular wires",
            LayerStyle::default_for_index(1),
        ));

        assert!(overview_density_usable(&db, &physical_model, viewport));
        assert!(overview_density_usable(&db, &kind_model, viewport));
    }

    #[test]
    fn native_overview_usability_ignores_semantic_bins_for_physical_layers() {
        let viewport = layout_render::Viewport::new(Rect::new(0, 0, 10_000, 10_000), 100.0, 100.0);
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 10_000, 10_000));
        db.set_overview_bins(vec![OverviewDensityBin {
            bbox: Rect::new(0, 0, 10_000, 10_000),
            layer_id: 0,
            kind: ShapeKind::Instance,
            count: 100,
            coverage_area: 1_000_000,
        }]);
        let mut physical_model = DisplayModel::new();
        physical_model.add_layer(DisplayLayer::physical_layer(
            0,
            "OVERLAP",
            LayerStyle::default_for_index(0),
        ));

        assert!(!overview_density_usable(&db, &physical_model, viewport));
    }

    #[test]
    fn lod_tuning_state_clamps_frame_threshold_to_tiny_threshold() {
        let tuning = LodTuningState {
            small_shape_px: 12.0,
            frame_only_px: 4.0,
            fill_px: 6.0,
            ..Default::default()
        };

        let settings = tuning.render_settings(false);

        assert_eq!(settings.small_shape_px, 12.0);
        assert_eq!(settings.frame_only_px, 12.0);
        assert_eq!(settings.fill_px, 12.0);
    }

    #[test]
    fn lod_tuning_uses_aggressive_interaction_settings() {
        let tuning = LodTuningState::default();

        let steady = tuning.render_settings(false);
        let interactive = tuning.render_settings(true);

        assert!(interactive.force_interaction_coarse);
        assert_eq!(
            interactive.hierarchy_bbox_units_per_pixel,
            steady.hierarchy_bbox_units_per_pixel
        );
        assert_eq!(
            interactive.hierarchy_coarse_units_per_pixel,
            steady.hierarchy_coarse_units_per_pixel
        );
        assert_eq!(
            interactive.array_bbox_units_per_pixel,
            steady.array_bbox_units_per_pixel
        );
        assert_eq!(
            interactive.array_grid_units_per_pixel,
            steady.array_grid_units_per_pixel
        );
        assert_eq!(interactive.max_render_items, steady.max_render_items);
        assert!(interactive.max_frames_per_bin < steady.max_frames_per_bin);
        assert!(interactive.max_markers_per_bin < steady.max_markers_per_bin);
    }

    #[test]
    fn scroll_zoom_factor_keeps_directional_zoom() {
        assert!(scroll_zoom_factor(1.0) > 1.0);
        assert!(scroll_zoom_factor(-1.0) < 1.0);
    }

    #[test]
    fn canvas_scroll_delta_only_applies_when_canvas_is_hovered() {
        assert_eq!(canvas_scroll_delta(true, 12.0), Some(12.0));
        assert_eq!(canvas_scroll_delta(false, 12.0), None);
        assert_eq!(canvas_scroll_delta(true, 0.0), None);
    }

    #[test]
    fn hatch_pattern_uses_continuous_visible_segments() {
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(120.0, 90.0));

        let segments = super::hatch_segments(rect, true);

        assert!(!segments.is_empty());
        assert!(segments.iter().any(|segment| {
            let dx = (segment[1].x - segment[0].x).abs();
            let dy = (segment[1].y - segment[0].y).abs();
            dx >= 40.0 && dy >= 40.0
        }));
    }

    #[test]
    fn hatch_pattern_segments_scale_with_perimeter_not_area() {
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(500.0, 300.0));

        let segments = super::hatch_segments(rect, true);

        assert!(segments.len() <= 180);
    }

    #[test]
    fn hatch_pattern_keeps_viewport_sized_rects_under_budget() {
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1000.0, 1000.0));

        let segments = super::hatch_segments(rect, true);

        assert!(segments.len() <= 300);
    }

    #[test]
    fn hatch_pattern_caps_large_screen_rect_segments() {
        let rect = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(2400.0, 1600.0));

        let segments = super::hatch_segments(rect, true);

        assert!(segments.len() <= 512);
        assert!(!segments.is_empty());
    }

    #[test]
    fn patterned_fills_degrade_to_solid_during_interaction() {
        assert_eq!(
            fill_draw_mode(Pattern::SparseDots, true),
            FillDrawMode::Solid
        );
        assert_eq!(
            fill_draw_mode(Pattern::DiagonalHatch, true),
            FillDrawMode::Solid
        );
        assert_eq!(
            fill_draw_mode(Pattern::CrossHatch, true),
            FillDrawMode::Solid
        );
        assert_eq!(fill_draw_mode(Pattern::Hollow, true), FillDrawMode::None);

        assert_eq!(
            fill_draw_mode(Pattern::DiagonalHatch, false),
            FillDrawMode::DiagonalHatch
        );
    }

    #[test]
    fn patterned_interaction_fill_uses_low_alpha_placeholder() {
        assert_eq!(
            super::interaction_fill_alpha(Pattern::SparseDots, 90, true),
            40
        );
        assert_eq!(
            super::interaction_fill_alpha(Pattern::DiagonalHatch, 76, true),
            40
        );
        assert_eq!(super::interaction_fill_alpha(Pattern::Solid, 90, true), 90);
        assert_eq!(
            super::interaction_fill_alpha(Pattern::SparseDots, 90, false),
            90
        );
    }

    #[test]
    fn loaded_physical_layer_counts_report_current_db_shapes() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));
        db.add_layer(LayerInfo::new(1, "ACT"));
        db.add_layer(LayerInfo::new(2, "VIA1"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::RegularWire, 1),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(30, 30, 40, 40), 1, ShapeKind::RegularWire, 2),
        );
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(50, 50, 60, 60), 2, ShapeKind::Via, 3),
        );

        let counts = super::loaded_physical_layer_counts(&db);

        assert_eq!(counts.get(&1), Some(&2));
        assert_eq!(counts.get(&2), Some(&1));
        assert_eq!(counts.get(&3), None);
    }

    #[test]
    fn loaded_physical_layer_counts_prefer_package_layer_totals() {
        let mut db = LayoutDb::new("unit", Rect::new(0, 0, 100, 100));
        db.add_layer(LayerInfo::new(1, "ACT"));
        let top = db.top_cell();
        db.add_shape(
            top,
            ShapeRecord::new(Rect::new(10, 10, 20, 20), 1, ShapeKind::RegularWire, 1),
        );
        db.set_package_layer_counts(BTreeMap::from([(1, 42), (2, 7)]));

        let counts = super::loaded_physical_layer_counts(&db);

        assert_eq!(counts.get(&1), Some(&42));
        assert_eq!(counts.get(&2), Some(&7));
    }

    #[test]
    fn cached_plane_texture_upload_is_skipped_when_key_and_texture_are_current() {
        let key = PlaneKey::for_test("hierarchy");
        let other_key = PlaneKey::for_test("other");

        assert_eq!(
            cached_plane_texture_action(Some(&key), &key, true, false),
            CachedPlaneTextureAction::ReuseTexture
        );
        assert_eq!(
            cached_plane_texture_action(None, &key, true, false),
            CachedPlaneTextureAction::UploadTexture
        );
        assert_eq!(
            cached_plane_texture_action(Some(&key), &key, false, false),
            CachedPlaneTextureAction::UploadTexture
        );
        assert_eq!(
            cached_plane_texture_action(Some(&other_key), &key, true, false),
            CachedPlaneTextureAction::UploadTexture
        );
        assert_eq!(
            cached_plane_texture_action(Some(&other_key), &key, true, true),
            CachedPlaneTextureAction::DeferUpload
        );
        assert_eq!(
            cached_plane_texture_action(None, &key, false, true),
            CachedPlaneTextureAction::UploadTexture
        );
    }

    fn hierarchy_test_db_and_leaf_view() -> (LayoutDb, CellViewState) {
        let package_root = std::env::temp_dir().join(format!(
            "layout_viewer_native_hierarchy_test_{}_{}",
            std::process::id(),
            HIERARCHY_TEST_PACKAGE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&package_root);
        fs::create_dir_all(package_root.join("detail")).unwrap();
        fs::create_dir_all(package_root.join("hierarchy")).unwrap();
        fs::write(
            &package_root.join("manifest.json"),
            r#"{
                "schema": "ecos.layoutpkg.v1",
                "design_name": "unit",
                "world_bbox": [0, 0, 1000, 1000],
                "tilesets": { "detail": "detail/index.json" },
                "hierarchy": { "cells": "hierarchy/cells.json" }
            }"#,
        )
        .unwrap();
        fs::write(
            &package_root.join("detail/index.json"),
            r#"{ "tiles": [] }"#,
        )
        .unwrap();
        fs::write(
            &package_root.join("hierarchy/cells.json"),
            r#"{
                "schema": "ecos.layoutpkg.hierarchy.v2",
                "version": 2,
                "top_cell": 1,
                "cells": [
                    {
                        "id": 1,
                        "name": "top",
                        "bbox": [0, 0, 1000, 1000],
                        "instances": [
                            {
                                "id": 10,
                                "name": "mid0",
                                "child_cell": 2,
                                "transform": { "dx": 100, "dy": 200, "orient": "R0" },
                                "array": { "columns": 1, "rows": 1, "step_x": 0, "step_y": 0 },
                                "bbox": [100, 200, 300, 400],
                                "source_id": 10
                            }
                        ],
                        "hierarchy_summary": {
                            "direct_instance_count": 1,
                            "direct_array_count": 0,
                            "expanded_array_element_count": 1
                        }
                    },
                    {
                        "id": 2,
                        "name": "mid",
                        "bbox": [0, 0, 200, 200],
                        "instances": [
                            {
                                "id": 20,
                                "name": "leaf0",
                                "child_cell": 3,
                                "transform": { "dx": 5, "dy": 7, "orient": "R0" },
                                "array": { "columns": 1, "rows": 1, "step_x": 0, "step_y": 0 },
                                "bbox": [5, 7, 25, 27],
                                "source_id": 20
                            }
                        ],
                        "hierarchy_summary": {
                            "direct_instance_count": 1,
                            "direct_array_count": 0,
                            "expanded_array_element_count": 1
                        }
                    },
                    {
                        "id": 3,
                        "name": "leaf",
                        "bbox": [0, 0, 20, 20]
                    }
                ]
            }"#,
        )
        .unwrap();

        let mut package = layoutpkg_reader::LayoutPackage::open(&package_root).unwrap();
        let hierarchy = package.load_hierarchy().unwrap().unwrap();
        let _ = fs::remove_dir_all(&package_root);
        let mut db =
            LayoutDb::from_hierarchy_document("unit", Rect::new(0, 0, 1_000, 1_000), hierarchy);
        db.add_layer(LayerInfo::new(1, "M1"));
        let mid = db.cell_by_name("mid").unwrap();
        let leaf = db.cell_by_name("leaf").unwrap();
        db.add_shape(
            leaf,
            ShapeRecord::new(Rect::new(2, 2, 8, 8), 1, ShapeKind::RegularWire, 9),
        );

        let view = CellViewState::from_path(
            db.top_cell(),
            InstancePath::from_elements(vec![
                InstancePathElement {
                    parent_cell: db.top_cell(),
                    instance_id: 10,
                    source_id: 10,
                    child_cell: mid,
                    array_column: 0,
                    array_row: 0,
                    bbox: Rect::new(100, 200, 300, 400),
                },
                InstancePathElement {
                    parent_cell: mid,
                    instance_id: 20,
                    source_id: 20,
                    child_cell: leaf,
                    array_column: 0,
                    array_row: 0,
                    bbox: Rect::new(5, 7, 25, 27),
                },
            ]),
        );

        (db, view)
    }

    fn sample_pick_hit(target: PickHitTarget, instance_path: InstancePath) -> PickHit {
        let leaf = instance_path
            .target_cell()
            .expect("sample pick hit requires a non-empty instance path");
        let object_path = match target {
            PickHitTarget::Shape => ObjectPath {
                instance_path: instance_path.clone(),
                target: ObjectPathTarget::Shape(ShapeId {
                    cell: leaf,
                    shape_index: 0,
                    source_id: 9,
                }),
            },
            PickHitTarget::Instance {
                parent_cell,
                child_cell,
                instance_id,
                array_column,
                array_row,
            } => ObjectPath {
                instance_path: instance_path.clone(),
                target: ObjectPathTarget::Instance {
                    parent_cell,
                    instance_id,
                    source_id: instance_id,
                    child_cell,
                    array_column,
                    array_row,
                },
            },
        };
        PickHit {
            display_layer_id: "M1".to_string(),
            source_id: 9,
            layer_id: 1,
            kind: ShapeKind::RegularWire,
            bbox: Rect::new(2, 2, 8, 8),
            cell: leaf,
            depth: instance_path.depth(),
            instance_path,
            object_path,
            target,
        }
    }
}
