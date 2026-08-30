use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::hash::Hash;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use chip_display::{FillPattern, LayerRole, LayerStack, LayerStyle};
use chip_render::{RenderCacheStats, RenderPlanCache, ViewTilePlaneCache};
use chip_view_db::{
    ChipViewDb, ChipViewMemoryStats, ConnectivityMetadata, DeltaStats, GridMetadata, NearestShape,
    OwnerLocalInfo, ShapeGeometry, SnapshotStats, UnroutedNetGuide,
};
use chipgeom_format::{
    GeometryEditCommand, GeometryEditOp, GeometryEditResult, GeometryEditStatus, LayerId, OwnerRef,
    OwnerType, Point32, Rect32, ShapeId, ShapeKind, ShapeRecord, ShapeState,
};
use eframe::egui;
use serde::{Deserialize, Serialize};

use crate::map_data::{ColormapMode, HeatmapData, MapCatalog, MapItem};

const SNAPSHOT_REFRESH_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const FOCUS_VIEWPORT_FILL: f32 = 0.45;
const MIN_SHAPE_SCREEN_SIZE: f32 = 2.0;
const LAYOUT_GEOMETRY_LAYER: LayerId = 0;
const LAYOUT_GEOMETRY_RGB: [u8; 3] = [148, 148, 148];
const LAYOUT_GEOMETRY_MAX_FILL_ALPHA: u8 = 48;
const LAYOUT_GEOMETRY_MAX_FRAME_ALPHA: u8 = 128;
const PATTERN_MIN_SIZE_PX: f32 = 20.0;
const MAX_PATTERN_OPS_PER_SHAPE: usize = 96;
const MAX_SELECTION_ENDPOINT_LINES: usize = 6;
const HOVER_NEAREST_RADIUS_PX: f32 = 8.0;
const MAX_PARAMETERIZED_GRID_LINES_PER_GRID: usize = 4096;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SIDEBAR_SECTION_RESERVE_HEIGHT: f32 = 34.0;
const MAP_HEATMAP_WIDTH_FRACTION: f32 = 0.46;
const MAP_HEATMAP_MAX_WIDTH: f32 = 380.0;
const MAP_HEATMAP_MIN_WIDTH: f32 = 270.0;
const MAP_HEATMAP_MAX_GRID_SIZE: f32 = 300.0;
const MAP_HEATMAP_VERTICAL_OVERHEAD: f32 = 142.0;
const MAP_FOCUS_ANIMATION_DURATION_SECONDS: f64 = 0.22;
const MAP_THUMBNAIL_WIDTH: u32 = 128;
const MAP_THUMBNAIL_HEIGHT: u32 = 96;
const MAP_THUMBNAIL_MAX_DIMENSION: u32 = 8192;
const MAP_THUMBNAIL_MAX_DECODE_BYTES: u64 = 128 * 1024 * 1024;
const COORDINATE_RULER_THICKNESS: f32 = 20.0;
const COORDINATE_RULER_TARGET_TICK_PX: f32 = 80.0;
const RULER_EDGE_SNAP_RADIUS_PX: f32 = 10.0;
const REDUCED_MOTION_ENV: &str = "ECOS_REDUCED_MOTION";
const RENDER_STATS_ENV: &str = "ECOS_RENDER_STATS";

#[derive(Clone, Debug, Default)]
pub struct CanvasRenderStats {
    pub frame_time_ms: f32,
    pub query_time_ms: f32,
    pub filter_time_ms: f32,
    pub paint_time_ms: f32,
    pub label_paint_time_ms: f32,
    pub drawn_shapes: usize,
    pub estimated_primitives: usize,
    pub label_count: usize,
    pub use_view_tiles: bool,
    pub zoom: f32,
    pub lod: u8,
    pub visible_drc_count: usize,
    pub visible_antenna_count: usize,
    pub is_gpu: bool,
}

struct GpuCachedLabel {
    key: ShapeLabelKey,
    rect: Rect32,
    text: String,
    kind: ShapeLabelKind,
}

struct GpuTileData {
    instances: std::sync::Arc<Vec<crate::canvas_gpu::GpuShapeInstance>>,
    labels: Vec<GpuCachedLabel>,
}

pub struct ChipViewerApp {
    pub color_theme: chip_display::ColorTheme,
    state: ViewerState,
    theme_initialized: bool,
    startup_focus_requested: bool,
}

struct LoadingViewer {
    manifest: PathBuf,
    started_at: Instant,
    receiver: Receiver<Result<ChipViewDb, String>>,
    edit_enabled: bool,
    initial_session_dirty: bool,
    edit_command_dir: Option<PathBuf>,
    edit_result_dir: Option<PathBuf>,
    drc_data_path: Option<PathBuf>,
    drc_statis_path: Option<PathBuf>,
    antenna_data_path: Option<PathBuf>,
    antenna_statis_path: Option<PathBuf>,
    map_root_path: Option<PathBuf>,
    pub target_format: wgpu::TextureFormat,
    pub has_wgpu: bool,
}

struct LoadedViewer {
    color_theme: chip_display::ColorTheme,
    start_time: Instant,
    db: ChipViewDb,
    stats: SnapshotStats,
    grid_bounds: Option<Rect32>,
    drawing_category_counts: BTreeMap<DrawingCategory, usize>,
    layers: Vec<LayerUiState>,
    edit_enabled: bool,
    edit_command_dir: Option<PathBuf>,
    edit_result_dir: Option<PathBuf>,
    query_input_mode: QueryInputMode,
    search_text: String,
    search_mode: SearchMode,
    shape_id_text: String,
    last_query_status: Option<String>,
    highlighted: BTreeSet<ShapeId>,
    selected: Option<ShapeId>,
    pending_focus: Option<PendingFocus>,
    draft: Option<EditDraft>,
    pending_edit: Option<PendingEdit>,
    pending_session_action: Option<PendingSessionAction>,
    session_action_progress: Option<SessionActionProgress>,
    last_edit_result: Option<String>,
    session_dirty: bool,
    close_confirmation_visible: bool,
    close_after_session_action: bool,
    snapshot_signature: SnapshotFileSignature,
    next_snapshot_refresh_check: Instant,
    render_cache: RenderPlanCache,
    view_tile_cache: ViewTilePlaneCache,
    next_command_counter: u32,
    drc_overlay: Option<DrcOverlay>,
    selected_drc: Option<usize>,
    antenna_overlay: Option<AntennaOverlay>,
    selected_antenna: Option<usize>,
    map_catalog: Option<MapCatalog>,
    map_catalog_error: Option<String>,
    analysis_tab: AnalysisTab,
    expanded_map_categories: BTreeSet<String>,
    selected_map_item: Option<PathBuf>,
    previous_map_item: Option<(crate::map_data::MapItem, Option<PathBuf>)>,
    active_heatmap: Option<ActiveHeatmap>,
    map_item_error: Option<String>,
    map_thumbnails: BTreeMap<PathBuf, MapThumbnailState>,
    map_thumbnail_worker: Option<MapThumbnailWorker>,
    selected_map_bbox: Option<Rect32>,
    focus_animation: Option<FocusAnimation>,
    zoom: f32,
    pan: egui::Vec2,
    pan_drag: PanDragState,
    ruler_tool: OrthogonalRuler,
    object_visibility: ObjectVisibility,
    coordinate_unit: CoordinateUnit,
    view_mode: ViewMode,
    camera_ctrl_3d: crate::nav3d::CameraController3d,
    show_3d_grid: bool,
    shading_style_3d: crate::canvas_gpu3d::ShadingStyle,
    lighting_preset_3d: chip_display::LightingPreset,
    z_cut_ratio_3d: f32,
    layer_stack: LayerStack,
    view3d_fitted: bool,
    view3d_bootstrapped: bool,
    sidebar_info_panel: Option<SidebarInfoPanel>,
    geometry_epoch: u64,
    owner_category_cache: OwnerCategoryCache,
    visibility_rules_cache: VisibilityRulesCache,
    gpu_canvas: crate::canvas_gpu::GpuCanvasState,
    gpu_frame_counter: u64,
    gpu_tile_instances:
        std::collections::HashMap<crate::canvas_gpu::GpuBufferKey, std::sync::Arc<GpuTileData>>,
    gpu_3d_instances_cache: Option<(
        u64,
        Rect32,
        std::sync::Arc<Vec<crate::canvas_gpu3d::GpuShapeInstance3d>>,
    )>,
    last_3d_query_rect: Option<Rect32>,
    perf_3d: Perf3dState,
    label_collector: ShapeLabelCollector,
    frame_valid_shapes: Vec<(chip_view_db::ShapeGeometry, chip_display::LayerStyle)>,
    frame_valid_labels: Vec<GpuCachedLabel>,
    status_line_buffer: String,
    shortcuts_overlay_visible: bool,
    loading_3d_start: Option<std::time::Instant>,
}

#[derive(Clone, Copy, Debug)]
pub struct Perf3dState {
    pub render_scale: f32,
    pub target_scale: f32,
    pub settle_at: Option<std::time::Instant>,
    pub last_camera: Option<crate::camera3d::OrbitCamera>,
    pub last_overview_mode: Option<bool>,
}

impl Default for Perf3dState {
    fn default() -> Self {
        Self {
            render_scale: 1.0,
            target_scale: 1.0,
            settle_at: None,
            last_camera: None,
            last_overview_mode: None,
        }
    }
}

struct LayerUiState {
    layer_id: LayerId,
    shape_count: usize,
    order: u32,
    name: String,
    layer_type: String,
    display_role: String,
    direction: String,
    width: i32,
    pitch_x: i32,
    pitch_y: i32,
    min_spacing: i32,
    min_area: i32,
    min_step: i32,
    cut_spacing: i32,
    enclosure_below: String,
    enclosure_above: String,
    lef58_rule_count: u32,
    visible: bool,
    style: LayerStyle,
}

#[derive(Clone, Copy, Debug)]
struct SidebarSectionHeights {
    view: f32,
    interaction: f32,
    physical_layers: f32,
    drawing_data: f32,
}

struct DrcOverlay {
    data_path: Option<PathBuf>,
    statis_path: Option<PathBuf>,
    type_states: Vec<DrcTypeState>,
    violations: Vec<DrcViolation>,
    rtree: rstar::RTree<DrcViolationRTreeNode>,
    load_error: Option<String>,
}

struct AntennaOverlay {
    data_path: Option<PathBuf>,
    statis_path: Option<PathBuf>,
    type_states: Vec<AntennaTypeState>,
    violations: Vec<AntennaViolation>,
    rtree: rstar::RTree<AntennaViolationRTreeNode>,
    load_error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AnalysisTab {
    Antenna,
    Drc,
    Map,
}

struct ActiveHeatmap {
    title: String,
    data: HeatmapData,
    selected_cell: Option<(usize, usize)>,
    colormap_mode: ColormapMode,
    threshold: f32,
    invert_threshold: bool,
    opacity: f32,
    instances: std::sync::Arc<Vec<crate::canvas_gpu::GpuShapeInstance>>,
    cached_hash: u64,
}

fn build_heatmap_instances(
    data: &HeatmapData,
    mode: ColormapMode,
    threshold: f32,
    invert: bool,
) -> std::sync::Arc<Vec<crate::canvas_gpu::GpuShapeInstance>> {
    let pitch = data.core_pitch();
    let mut instances = Vec::new();
    for ((row, col), rect) in data.cells() {
        // Skip the non-uniform boundary ring (cells mapped onto the die
        // border); they are wider/taller than the core grid and visually
        // "stretch" the overlay past the core on all sides.
        if let Some((px, py)) = pitch {
            let w = (rect.hx - rect.lx).abs();
            let h = (rect.hy - rect.ly).abs();
            // Core cells are highly uniform. Boundary cells deviate significantly.
            // A 5% tolerance is enough to absorb 1-DBU rounding differences
            // while safely dropping boundary cells (which deviate by ~25%+).
            if (w - px).abs() * 20 > px || (h - py).abs() * 20 > py {
                continue;
            }
        }
        let Some(norm) = data.normalized_value(row, col) else {
            continue;
        };
        let hidden = if !invert {
            norm < threshold
        } else {
            norm > threshold
        };
        if hidden {
            continue;
        }
        let [r, g, b, _] = mode.sample(norm);
        instances.push(crate::canvas_gpu::GpuShapeInstance {
            rect_dbu: [rect.lx, rect.ly, rect.hx, rect.hy],
            fill_rgba: crate::canvas_gpu::pack_rgba_u32([r, g, b, 255]),
            frame_rgba: 0,               // no outline
            pattern_bits: (0 << 16) | 1, // shape_type=rect, pattern=solid
            line_width_px: 0.0,
        });
    }
    std::sync::Arc::new(instances)
}

impl ActiveHeatmap {
    fn refresh_hash(&mut self) {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        self.colormap_mode.hash(&mut hasher);
        self.threshold.to_bits().hash(&mut hasher);
        self.invert_threshold.hash(&mut hasher);
        self.title.hash(&mut hasher);
        self.instances.len().hash(&mut hasher);
        if let Some(first) = self.instances.first() {
            first.rect_dbu.hash(&mut hasher);
        }
        if let Some(last) = self.instances.last() {
            last.rect_dbu.hash(&mut hasher);
        }
        self.cached_hash = hasher.finish();
    }

    fn new(title: String, data: HeatmapData) -> Self {
        let colormap_mode = ColormapMode::default();
        let threshold = 0.0;
        let invert_threshold = false;
        let instances = build_heatmap_instances(&data, colormap_mode, threshold, invert_threshold);
        let mut self_obj = Self {
            title,
            data,
            selected_cell: None,
            colormap_mode,
            threshold,
            invert_threshold,
            opacity: 0.65,
            instances,
            cached_hash: 0,
        };
        self_obj.refresh_hash();
        self_obj
    }

    fn set_colormap_mode(&mut self, mode: ColormapMode) {
        if self.colormap_mode != mode {
            self.colormap_mode = mode;
            self.instances =
                build_heatmap_instances(&self.data, mode, self.threshold, self.invert_threshold);
            self.refresh_hash();
        }
    }

    fn set_threshold(&mut self, threshold: f32) {
        let clamped = threshold.clamp(0.0, 1.0);
        if (self.threshold - clamped).abs() > 0.001 {
            self.threshold = clamped;
            self.instances = build_heatmap_instances(
                &self.data,
                self.colormap_mode,
                self.threshold,
                self.invert_threshold,
            );
            self.refresh_hash();
        }
    }

    fn set_invert_threshold(&mut self, invert: bool) {
        if self.invert_threshold != invert {
            self.invert_threshold = invert;
            self.instances = build_heatmap_instances(
                &self.data,
                self.colormap_mode,
                self.threshold,
                self.invert_threshold,
            );
            self.refresh_hash();
        }
    }
}

enum MapThumbnailState {
    Loading,
    Ready(egui::TextureHandle),
    Failed,
}

struct MapThumbnailWorker {
    request_sender: Sender<PathBuf>,
    result_receiver: Receiver<MapThumbnailResult>,
}

struct MapThumbnailResult {
    path: PathBuf,
    decoded: Result<DecodedMapThumbnail, String>,
}

struct DecodedMapThumbnail {
    size: [usize; 2],
    rgba: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DrcTypeState {
    name: String,
    total_count: usize,
    layer_counts: BTreeMap<String, usize>,
    visible: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct DrcTypeCounts {
    total_count: usize,
    layer_counts: BTreeMap<String, usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DrcViolation {
    id: usize,
    drc_type: String,
    layer: String,
    bbox: Rect32,
    required_size: Option<i64>,
    nets: Vec<String>,
    insts: Vec<String>,
}

struct DrcViolationRTreeNode {
    bbox: rstar::AABB<[i32; 2]>,
    index: usize,
}

impl rstar::RTreeObject for DrcViolationRTreeNode {
    type Envelope = rstar::AABB<[i32; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.bbox
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AntennaTypeState {
    name: String,
    total_count: usize,
    layer_counts: BTreeMap<String, usize>,
    visible: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct AntennaTypeCounts {
    total_count: usize,
    layer_counts: BTreeMap<String, usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AntennaViolation {
    id: usize,
    antenna_type: String,
    layer: String,
    bbox: Rect32,
    required_size: Option<i64>,
    nets: Vec<String>,
    insts: Vec<String>,
}

struct AntennaViolationRTreeNode {
    bbox: rstar::AABB<[i32; 2]>,
    index: usize,
}

impl rstar::RTreeObject for AntennaViolationRTreeNode {
    type Envelope = rstar::AABB<[i32; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.bbox
    }
}

struct EditDraft {
    command_id: u64,
    shape_id: ShapeId,
    expected_version: u32,
    instance_name: Option<String>,
    original_bbox: Rect32,
    requested_bbox: Rect32,
}

struct PendingEdit {
    result_path: PathBuf,
}

#[derive(Serialize)]
struct ViewerEditCommand<'a> {
    #[serde(flatten)]
    command: &'a GeometryEditCommand,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance_name: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SessionActionKind {
    Save,
    Discard,
}

impl SessionActionKind {
    fn label(self) -> &'static str {
        match self {
            SessionActionKind::Save => "save",
            SessionActionKind::Discard => "discard",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
struct SessionActionCommand {
    command_id: u64,
    action: SessionActionKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
struct SessionActionResult {
    command_id: u64,
    action: SessionActionKind,
    accepted: bool,
    #[serde(default)]
    geometry_manifest_path: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SessionActionProgressPhase {
    Queued,
    Saving,
    Discarding,
    VerifyingArtifacts,
    RefreshingLayoutImage,
    Published,
    ReloadingGeometry,
    Completed,
    Failed,
}

impl SessionActionProgressPhase {
    fn label(self) -> &'static str {
        match self {
            SessionActionProgressPhase::Queued => "Queued",
            SessionActionProgressPhase::Saving => "Saving in ECC",
            SessionActionProgressPhase::Discarding => "Discarding edits",
            SessionActionProgressPhase::VerifyingArtifacts => "Verifying artifacts",
            SessionActionProgressPhase::RefreshingLayoutImage => "Refreshing layout image",
            SessionActionProgressPhase::Published => "Published",
            SessionActionProgressPhase::ReloadingGeometry => "Reloading geometry",
            SessionActionProgressPhase::Completed => "Completed",
            SessionActionProgressPhase::Failed => "Failed",
        }
    }

    fn is_terminal(self) -> bool {
        matches!(
            self,
            SessionActionProgressPhase::Completed | SessionActionProgressPhase::Failed
        )
    }
}

#[derive(Clone, Debug, Deserialize)]
struct SessionActionProgress {
    command_id: u64,
    action: SessionActionKind,
    phase: SessionActionProgressPhase,
    percent: u8,
    message: String,
}

impl SessionActionProgress {
    fn new(
        action: SessionActionKind,
        command_id: u64,
        phase: SessionActionProgressPhase,
        percent: u8,
        message: impl Into<String>,
    ) -> Self {
        Self {
            command_id,
            action,
            phase,
            percent,
            message: message.into(),
        }
    }

    fn fraction(&self) -> f32 {
        f32::from(self.percent.min(100)) / 100.0
    }
}

struct PendingSessionAction {
    action: SessionActionKind,
    command_id: u64,
    progress_path: PathBuf,
    result_path: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingFocus {
    bbox: Rect32,
    select_shape_id: Option<ShapeId>,
    transition: FocusTransition,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FocusTransition {
    Immediate,
    Animated,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct FocusAnimation {
    started_at: f64,
    from_zoom: f32,
    from_pan: egui::Vec2,
    to_zoom: f32,
    to_pan: egui::Vec2,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct FocusAnimationFrame {
    zoom: f32,
    pan: egui::Vec2,
    complete: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct ShapeIdLookupAction {
    pending_focus: Option<PendingFocus>,
    message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SnapshotFileStamp {
    modified: Option<SystemTime>,
    len: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct SnapshotFileSignature {
    files: BTreeMap<PathBuf, Option<SnapshotFileStamp>>,
}

#[derive(Debug, PartialEq, Eq)]
struct EditResultAction {
    reload_snapshot: bool,
    selected_shape_id: Option<ShapeId>,
    message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SearchMode {
    All,
    Net,
    Instance,
    Pin,
    Bus,
    Group,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QueryInputMode {
    Search,
    ShapeId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SidebarInfoPanel {
    Selection,
    Diagnostics,
}

#[derive(Debug, Default)]
struct OrthogonalRuler {
    enabled: bool,
    active: bool,
    points: Vec<Point32>,
}

impl OrthogonalRuler {
    fn toggle(&mut self) {
        self.enabled = !self.enabled;
        self.active = false;
        self.points.clear();
    }

    fn start(&mut self, point: Point32) {
        self.active = true;
        self.points.clear();
        self.points.push(point);
    }

    fn preview(&self, pointer: Point32) -> Option<Point32> {
        if !self.active {
            return None;
        }
        self.points
            .last()
            .copied()
            .map(|anchor| orthogonal_ruler_point(anchor, pointer))
    }

    fn commit(&mut self, pointer: Point32) {
        let Some(point) = self.preview(pointer) else {
            return;
        };
        if self.points.last() != Some(&point) {
            self.points.push(point);
        }
    }

    fn finish(&mut self) {
        self.active = false;
        if self.points.len() < 2 {
            self.points.clear();
        }
    }

    fn clear(&mut self) {
        self.active = false;
        self.points.clear();
    }
}

fn ruler_start_requested(
    input: &egui::InputState,
    enabled: bool,
    pointer_over_layout: bool,
) -> bool {
    enabled && pointer_over_layout && input.pointer.button_pressed(egui::PointerButton::Secondary)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CoordinateUnit {
    Dbu,
    Micron,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ViewMode {
    TwoD,
    ThreeD,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ObjectVisibility {
    instances: bool,
    net_signal: bool,
    net_clock: bool,
    net_other: bool,
    pdn: bool,
    vias: bool,
    io_pin: bool,
    placement: bool,
    tracks: bool,
    gcells: bool,
    obstructions: bool,
    boundaries: bool,
    fill: bool,
    regions: bool,
}

impl ObjectVisibility {
    pub fn bits(&self) -> u32 {
        let mut b = 0;
        if self.instances {
            b |= 1 << 0;
        }
        if self.net_signal {
            b |= 1 << 1;
        }
        if self.net_clock {
            b |= 1 << 2;
        }
        if self.net_other {
            b |= 1 << 3;
        }
        if self.pdn {
            b |= 1 << 4;
        }
        if self.vias {
            b |= 1 << 5;
        }
        if self.io_pin {
            b |= 1 << 6;
        }
        if self.placement {
            b |= 1 << 7;
        }
        if self.tracks {
            b |= 1 << 8;
        }
        if self.gcells {
            b |= 1 << 9;
        }
        if self.obstructions {
            b |= 1 << 10;
        }
        if self.boundaries {
            b |= 1 << 11;
        }
        if self.fill {
            b |= 1 << 12;
        }
        if self.regions {
            b |= 1 << 13;
        }
        b
    }
}

impl Default for ObjectVisibility {
    fn default() -> Self {
        Self {
            instances: true,
            net_signal: false,
            net_clock: false,
            net_other: false,
            pdn: false,
            vias: false,
            io_pin: false,
            placement: true,
            tracks: false,
            gcells: false,
            obstructions: false,
            boundaries: true,
            fill: true,
            regions: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum DrawingCategory {
    Instances,
    NetSignal,
    NetClock,
    NetOther,
    Pdn,
    Vias,
    IoPins,
    Placement,
    Tracks,
    GCells,
    Obstructions,
    Boundaries,
    Fill,
    Regions,
}

impl DrawingCategory {
    const ALL: [Self; 14] = [
        Self::Instances,
        Self::NetSignal,
        Self::NetClock,
        Self::NetOther,
        Self::Pdn,
        Self::Vias,
        Self::IoPins,
        Self::Placement,
        Self::Tracks,
        Self::GCells,
        Self::Obstructions,
        Self::Boundaries,
        Self::Fill,
        Self::Regions,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::Instances => "Instances",
            Self::NetSignal => "Signal Nets",
            Self::NetClock => "Clock Nets",
            Self::NetOther => "Other Nets",
            Self::Pdn => "PDN",
            Self::Vias => "Vias",
            Self::IoPins => "IO Pins",
            Self::Placement => "Rows",
            Self::Tracks => "Tracks",
            Self::GCells => "GCells",
            Self::Obstructions => "Obstructions",
            Self::Boundaries => "Die / Core",
            Self::Fill => "Fill",
            Self::Regions => "Regions / Slots",
        }
    }

    fn tooltip(self) -> &'static str {
        match self {
            Self::NetSignal => "Regular signal net wire segments.",
            Self::NetClock => "Clock net wire segments from DEF net connect type.",
            Self::NetOther => "Non-signal and non-clock regular net wire segments.",
            Self::Vias => "Via owners are drawn on their assigned physical layer.",
            Self::Placement | Self::Tracks | Self::GCells | Self::Obstructions => {
                "Context geometry is shown after zooming in to keep the fitted route view readable."
            }
            _ => "Toggle this geometry category in the layout canvas.",
        }
    }

    fn includes_owner_type(self, owner_type: OwnerType) -> bool {
        match self {
            Self::Instances => matches!(
                owner_type,
                OwnerType::InstanceBBox | OwnerType::InstanceHalo
            ),
            Self::NetSignal | Self::NetClock | Self::NetOther => {
                owner_type == OwnerType::NetWireSegment
            }
            Self::Pdn => owner_type == OwnerType::SpecialWireSegment,
            Self::Vias => owner_type == OwnerType::Via,
            Self::IoPins => matches!(
                owner_type,
                OwnerType::PinPortShape
                    | OwnerType::InstancePinPortShape
                    | OwnerType::IoPinPortShape
            ),
            Self::Placement => owner_type == OwnerType::Row,
            Self::Tracks => owner_type == OwnerType::TrackGrid,
            Self::GCells => owner_type == OwnerType::GCellGrid,
            Self::Obstructions => matches!(owner_type, OwnerType::Blockage | OwnerType::Obs),
            Self::Boundaries => matches!(owner_type, OwnerType::Die | OwnerType::Core),
            Self::Fill => matches!(
                owner_type,
                OwnerType::Fill | OwnerType::InstanceBBox | OwnerType::InstanceHalo
            ),
            Self::Regions => matches!(owner_type, OwnerType::Region | OwnerType::Slot),
        }
    }
}

impl ObjectVisibility {
    fn includes_owner_type(self, owner_type: u8) -> bool {
        if OwnerType::from_raw(owner_type) == Some(OwnerType::NetWireSegment) {
            return self.net_signal || self.net_clock || self.net_other;
        }
        if matches!(
            OwnerType::from_raw(owner_type),
            Some(OwnerType::InstanceBBox | OwnerType::InstanceHalo)
        ) {
            return self.instances || self.fill;
        }
        OwnerType::from_raw(owner_type)
            .and_then(|owner_type| {
                DrawingCategory::ALL
                    .into_iter()
                    .find(|category| category.includes_owner_type(owner_type))
            })
            .is_none_or(|category| self.is_category_visible(category))
    }

    fn is_all_visible(self) -> bool {
        DrawingCategory::ALL
            .into_iter()
            .all(|category| self.is_category_visible(category))
    }

    fn is_category_visible(self, category: DrawingCategory) -> bool {
        match category {
            DrawingCategory::Instances => self.instances,
            DrawingCategory::NetSignal => self.net_signal,
            DrawingCategory::NetClock => self.net_clock,
            DrawingCategory::NetOther => self.net_other,
            DrawingCategory::Pdn => self.pdn,
            DrawingCategory::Vias => self.vias,
            DrawingCategory::IoPins => self.io_pin,
            DrawingCategory::Placement => self.placement,
            DrawingCategory::Tracks => self.tracks,
            DrawingCategory::GCells => self.gcells,
            DrawingCategory::Obstructions => self.obstructions,
            DrawingCategory::Boundaries => self.boundaries,
            DrawingCategory::Fill => self.fill,
            DrawingCategory::Regions => self.regions,
        }
    }

    fn set_category_visible(&mut self, category: DrawingCategory, visible: bool) {
        match category {
            DrawingCategory::Instances => self.instances = visible,
            DrawingCategory::NetSignal => self.net_signal = visible,
            DrawingCategory::NetClock => self.net_clock = visible,
            DrawingCategory::NetOther => self.net_other = visible,
            DrawingCategory::Pdn => self.pdn = visible,
            DrawingCategory::Vias => self.vias = visible,
            DrawingCategory::IoPins => self.io_pin = visible,
            DrawingCategory::Placement => self.placement = visible,
            DrawingCategory::Tracks => self.tracks = visible,
            DrawingCategory::GCells => self.gcells = visible,
            DrawingCategory::Obstructions => self.obstructions = visible,
            DrawingCategory::Boundaries => self.boundaries = visible,
            DrawingCategory::Fill => self.fill = visible,
            DrawingCategory::Regions => self.regions = visible,
        }
    }

    fn set_all_visible(&mut self, visible: bool) {
        for category in DrawingCategory::ALL {
            self.set_category_visible(category, visible);
        }
    }
}

fn drawing_category_counts(db: &ChipViewDb) -> BTreeMap<DrawingCategory, usize> {
    let mut counts = BTreeMap::<DrawingCategory, usize>::new();
    for shape in db.snapshot().shapes() {
        if let Some(category) = drawing_category_for_shape(db, shape) {
            *counts.entry(category).or_insert(0) += 1;
        }
    }
    for guide in db.unrouted_net_guides() {
        let category = net_kind_drawing_category(Some(&guide.net_kind));
        *counts.entry(category).or_insert(0) += guide.pin_centers.len();
    }
    counts
}

fn is_filler_instance(inst_name: Option<&str>, master_name: Option<&str>) -> bool {
    let is_filler_str = |s: &str| -> bool {
        let s = s.trim();
        if s.is_empty() {
            return false;
        }
        let lower = s.to_ascii_lowercase();
        lower.contains("fill")
            || lower.contains("decap")
            || lower.contains("tapcell")
            || lower.contains("welltap")
            || lower.contains("tapvpwr")
            || lower.contains("tapvgnd")
            || lower.contains("endcap")
            || lower.starts_with("tap_")
            || (lower.starts_with("tap") && lower.contains('_'))
            || lower.ends_with("_tap")
            || lower.contains("__tap")
            || lower.starts_with("phy_")
            || lower.starts_with("filler")
    };
    if let Some(master) = master_name {
        if is_filler_str(master) {
            return true;
        }
    }
    if let Some(inst) = inst_name {
        if is_filler_str(inst) {
            return true;
        }
    }
    false
}

fn drawing_category_for_shape(db: &ChipViewDb, shape: &ShapeRecord) -> Option<DrawingCategory> {
    db.owner_for_shape(shape)
        .and_then(|owner| drawing_category_for_owner(db, owner))
}

fn drawing_category_for_owner(db: &ChipViewDb, owner: &OwnerRef) -> Option<DrawingCategory> {
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    Some(match owner_type {
        OwnerType::InstanceBBox | OwnerType::InstanceHalo => {
            let inst_name = db.owner_name(owner);
            let master_name = db.owner_local_name(owner);
            if is_filler_instance(inst_name, master_name) {
                DrawingCategory::Fill
            } else {
                DrawingCategory::Instances
            }
        }
        OwnerType::NetWireSegment => net_kind_drawing_category(
            db.owner_name(owner)
                .and_then(|net_name| db.net_kind_for_name(net_name)),
        ),
        OwnerType::SpecialWireSegment => DrawingCategory::Pdn,
        OwnerType::Via => DrawingCategory::Vias,
        OwnerType::PinPortShape | OwnerType::InstancePinPortShape | OwnerType::IoPinPortShape => {
            DrawingCategory::IoPins
        }
        OwnerType::Row => DrawingCategory::Placement,
        OwnerType::TrackGrid => DrawingCategory::Tracks,
        OwnerType::GCellGrid => DrawingCategory::GCells,
        OwnerType::Blockage | OwnerType::Obs => DrawingCategory::Obstructions,
        OwnerType::Die | OwnerType::Core => DrawingCategory::Boundaries,
        OwnerType::Fill => DrawingCategory::Fill,
        OwnerType::Region | OwnerType::Slot => DrawingCategory::Regions,
        _ => return None,
    })
}

fn net_kind_drawing_category(kind: Option<&str>) -> DrawingCategory {
    match kind
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("signal") => DrawingCategory::NetSignal,
        Some("clock") => DrawingCategory::NetClock,
        _ => DrawingCategory::NetOther,
    }
}

#[derive(Clone, Debug, Default)]
struct OwnerCategoryCache {
    epoch: u64,
    categories: std::collections::HashMap<(u8, u64, u32), Option<DrawingCategory>>,
}

impl OwnerCategoryCache {
    fn get(&mut self, epoch: u64, db: &ChipViewDb, owner: &OwnerRef) -> Option<DrawingCategory> {
        if self.epoch != epoch {
            self.epoch = epoch;
            self.categories.clear();
        }
        let key = (owner.owner_type, owner.owner_id, owner.name_id);
        if let Some(cat) = self.categories.get(&key) {
            return *cat;
        }
        let cat = drawing_category_for_owner(db, owner);
        self.categories.insert(key, cat);
        cat
    }
}

#[derive(Clone, Debug, Default)]
struct ZoomVisibilityRules {
    track_grid_suppressed: bool,
    gcell_grid_suppressed: bool,
}

impl ZoomVisibilityRules {
    fn new(db: &ChipViewDb) -> Self {
        let grid_metadata = db.grid_metadata();
        Self {
            track_grid_suppressed: grid_metadata
                .iter()
                .any(|grid| grid_owner_type(grid) == Some(OwnerType::TrackGrid)),
            gcell_grid_suppressed: grid_metadata
                .iter()
                .any(|grid| grid_owner_type(grid) == Some(OwnerType::GCellGrid)),
        }
    }

    #[inline]
    fn is_drawn_at_zoom(&self, owner_type: Option<OwnerType>, zoom: f32) -> bool {
        let Some(owner_type) = owner_type else {
            return true;
        };
        match owner_type {
            OwnerType::TrackGrid if self.track_grid_suppressed => false,
            OwnerType::GCellGrid if self.gcell_grid_suppressed => false,
            _ => zoom > 1.25 || !is_context_owner_type(owner_type as u8),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct VisibilityRulesCache {
    epoch: u64,
    layer_visibility_hash: u64,
    layer_index: LayerRenderIndex,
    zoom_rules: ZoomVisibilityRules,
}

#[derive(Clone, Debug, Default)]
struct LayerRenderIndex {
    visible_layer_map: BTreeMap<LayerId, bool>,
    style_map: BTreeMap<LayerId, LayerStyle>,
}

impl LayerRenderIndex {
    fn new(layers: &[LayerUiState]) -> Self {
        let mut visible_layer_map = BTreeMap::new();
        let mut style_map = BTreeMap::new();
        for layer in layers {
            visible_layer_map.insert(layer.layer_id, layer.visible);
            style_map.insert(layer.layer_id, layer.style);
        }
        visible_layer_map.insert(LAYOUT_GEOMETRY_LAYER, true);
        style_map.insert(LAYOUT_GEOMETRY_LAYER, layout_geometry_layer_style());
        Self {
            visible_layer_map,
            style_map,
        }
    }

    fn visibility_hash(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for (layer_id, visible) in &self.visible_layer_map {
            layer_id.hash(&mut hasher);
            visible.hash(&mut hasher);
        }
        hasher.finish()
    }

    #[inline]
    fn is_layer_visible(&self, layer_id: LayerId) -> bool {
        self.visible_layer_map
            .get(&layer_id)
            .copied()
            .unwrap_or(false)
    }

    #[inline]
    fn get_style(&self, layer_id: LayerId) -> Option<&LayerStyle> {
        self.style_map.get(&layer_id)
    }
}

#[inline]
fn shape_is_visible_fast(
    shape: &ShapeRecord,
    owner_type: Option<OwnerType>,
    owner_category: Option<DrawingCategory>,
    layer_index: &LayerRenderIndex,
    object_visibility: &ObjectVisibility,
) -> bool {
    let layer_visible = if shape_uses_layer_visibility(shape, owner_type) {
        layer_index.is_layer_visible(shape.layer_id)
    } else {
        true
    };
    let owner_visible =
        owner_category.is_none_or(|category| object_visibility.is_category_visible(category));
    layer_visible && owner_visible
}

#[inline]
fn visible_style_for_shape_fast<'a>(
    shape: &ShapeRecord,
    owner: Option<&'a OwnerRef>,
    owner_type: Option<OwnerType>,
    layer_index: &'a LayerRenderIndex,
) -> Option<LayerStyle> {
    let layer_id = shape.layer_id;
    let base_style = if shape_uses_layer_visibility(shape, owner_type) {
        if layer_index.is_layer_visible(layer_id) {
            layer_index.get_style(layer_id)?
        } else {
            return None;
        }
    } else {
        layer_index.get_style(layer_id)?
    };
    Some(style_for_shape(*base_style, owner))
}

impl SearchMode {
    const ALL: [Self; 6] = [
        Self::All,
        Self::Net,
        Self::Instance,
        Self::Pin,
        Self::Bus,
        Self::Group,
    ];

    fn label(self) -> &'static str {
        match self {
            SearchMode::All => "All",
            SearchMode::Net => "Net",
            SearchMode::Instance => "Instance",
            SearchMode::Pin => "Pin",
            SearchMode::Bus => "Bus",
            SearchMode::Group => "Group",
        }
    }

    fn owner_types(self) -> Option<&'static [OwnerType]> {
        match self {
            SearchMode::All => None,
            SearchMode::Net => Some(&[OwnerType::NetWireSegment, OwnerType::SpecialWireSegment]),
            SearchMode::Instance => Some(&[OwnerType::InstanceBBox, OwnerType::InstanceHalo]),
            SearchMode::Pin | SearchMode::Bus | SearchMode::Group => None,
        }
    }

    fn query_shape_ids(self, db: &ChipViewDb, name: &str) -> Vec<ShapeId> {
        match self {
            SearchMode::All => db.query_owner_name(name),
            SearchMode::Net | SearchMode::Instance => self
                .owner_types()
                .map(|owner_types| db.query_owner_name_for_owner_types(name, owner_types))
                .unwrap_or_default(),
            SearchMode::Pin => db.query_pin_name(name),
            SearchMode::Bus => db.query_bus_name(name),
            SearchMode::Group => db.query_group_name(name),
        }
    }
}

impl SidebarInfoPanel {
    fn label(self) -> &'static str {
        match self {
            SidebarInfoPanel::Selection => "Selection",
            SidebarInfoPanel::Diagnostics => "Diagnostics",
        }
    }

    fn icon(self) -> &'static str {
        match self {
            SidebarInfoPanel::Selection => "⌖",
            SidebarInfoPanel::Diagnostics => "ⓘ",
        }
    }
}

impl CoordinateUnit {
    fn label(self) -> &'static str {
        match self {
            CoordinateUnit::Dbu => "DBU",
            CoordinateUnit::Micron => "um",
        }
    }

    fn is_available(self, dbu_per_micron: Option<u32>) -> bool {
        self == CoordinateUnit::Dbu || dbu_per_micron.is_some_and(|value| value > 0)
    }
}

enum ViewerState {
    Loading(LoadingViewer),
    Loaded(LoadedViewer),
    Error(String),
}

impl ChipViewerApp {
    pub fn open(
        manifest: PathBuf,
        mode: String,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
        initial_session_dirty: bool,
        drc_data_path: Option<PathBuf>,
        drc_statis_path: Option<PathBuf>,
        antenna_data_path: Option<PathBuf>,
        antenna_statis_path: Option<PathBuf>,
        map_root_path: Option<PathBuf>,
        target_format: wgpu::TextureFormat,
        has_wgpu: bool,
    ) -> Self {
        let edit_enabled = mode == "edit";
        let (sender, receiver) = mpsc::channel();
        let load_manifest = manifest.clone();
        thread::spawn(move || {
            let result = ChipViewDb::open(&load_manifest).map_err(|err| err.to_string());
            let _ = sender.send(result);
        });
        Self {
            color_theme: chip_display::ColorTheme::Vivid,
            state: ViewerState::Loading(LoadingViewer {
                manifest,
                started_at: Instant::now(),
                receiver,
                edit_enabled,
                initial_session_dirty,
                edit_command_dir,
                edit_result_dir,
                drc_data_path,
                drc_statis_path,
                antenna_data_path,
                antenna_statis_path,
                map_root_path,
                target_format,
                has_wgpu,
            }),
            theme_initialized: false,
            startup_focus_requested: false,
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        match &mut self.state {
            ViewerState::Loading(loading) => {
                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("CHIP VIEWER")
                        .small()
                        .strong()
                        .color(ecos_accent()),
                );
                ui.heading("Loading geometry");
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(format!(
                        "opening snapshot... {:.1}s",
                        loading.started_at.elapsed().as_secs_f32()
                    ));
                });
                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new(loading.manifest.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            ViewerState::Loaded(loaded) => loaded.sidebar(ui),
            ViewerState::Error(err) => {
                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("CHIP VIEWER")
                        .small()
                        .strong()
                        .color(ecos_accent()),
                );
                ui.heading("Geometry unavailable");
                ui.colored_label(egui::Color32::from_rgb(248, 113, 113), err);
            }
        }
    }

    fn canvas(&mut self, ui: &mut egui::Ui) {
        match &mut self.state {
            ViewerState::Loaded(loaded) => loaded.canvas(ui),
            ViewerState::Loading(loading) => loading_canvas(ui, loading),
            ViewerState::Error(_) => {
                ui.centered_and_justified(|ui| {
                    ui.label("No geometry loaded");
                });
            }
        }
    }

    fn poll_loading(&mut self) {
        let next_state = match &mut self.state {
            ViewerState::Loading(loading) => match loading.receiver.try_recv() {
                Ok(Ok(db)) => Some(ViewerState::Loaded(LoadedViewer::new(
                    chip_display::ColorTheme::Vivid,
                    db,
                    loading.edit_enabled,
                    loading.initial_session_dirty,
                    loading.edit_command_dir.clone(),
                    loading.edit_result_dir.clone(),
                    loading.drc_data_path.clone(),
                    loading.drc_statis_path.clone(),
                    loading.antenna_data_path.clone(),
                    loading.antenna_statis_path.clone(),
                    loading.map_root_path.clone(),
                    loading.target_format,
                    loading.has_wgpu,
                ))),
                Ok(Err(err)) => Some(ViewerState::Error(err)),
                Err(mpsc::TryRecvError::Disconnected) => Some(ViewerState::Error(
                    "geometry loader stopped before returning a result".to_string(),
                )),
                Err(mpsc::TryRecvError::Empty) => None,
            },
            _ => None,
        };
        if let Some(state) = next_state {
            self.state = state;
        }
    }
}

impl DrcOverlay {
    fn load(data_path: Option<PathBuf>, statis_path: Option<PathBuf>) -> Option<Self> {
        if data_path.is_none() && statis_path.is_none() {
            return None;
        }

        let mut load_error = None;
        let mut violations = Vec::new();
        let mut counts = BTreeMap::new();

        if let Some(path) = data_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .and_then(|text| parse_drc_json_text(&text))
            {
                Ok((json_violations, json_counts)) => {
                    violations = json_violations;
                    counts = json_counts;
                }
                Err(err) => {
                    load_error = Some(format!("failed to load DRC data {}: {err}", path.display()));
                }
            }
        }

        if let Some(path) = statis_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .map(|text| parse_drc_statis_csv(&text))
            {
                Ok(csv_counts) => merge_drc_counts(&mut counts, csv_counts),
                Err(err) => {
                    let message =
                        format!("failed to load DRC statistics {}: {err}", path.display());
                    load_error = Some(match load_error {
                        Some(existing) => format!("{existing}; {message}"),
                        None => message,
                    });
                }
            }
        }

        merge_drc_counts(&mut counts, drc_counts_from_violations(&violations));
        let type_states = drc_type_states_from_counts(counts);

        let rtree_nodes: Vec<_> = violations
            .iter()
            .enumerate()
            .map(|(i, v)| DrcViolationRTreeNode {
                bbox: rstar::AABB::from_corners([v.bbox.lx, v.bbox.ly], [v.bbox.hx, v.bbox.hy]),
                index: i,
            })
            .collect();
        let rtree = rstar::RTree::bulk_load(rtree_nodes);

        Some(Self {
            data_path,
            statis_path,
            type_states,
            violations,
            rtree,
            load_error,
        })
    }

    fn total_count(&self) -> usize {
        self.type_states.iter().map(|state| state.total_count).sum()
    }

    fn selected_type_count(&self) -> usize {
        self.type_states
            .iter()
            .filter(|state| state.visible)
            .count()
    }

    fn set_all_visible(&mut self, visible: bool) {
        for state in &mut self.type_states {
            state.visible = visible;
        }
    }

    fn type_is_visible(&self, drc_type: &str) -> bool {
        self.type_states
            .iter()
            .find(|state| state.name == drc_type)
            .is_some_and(|state| state.visible)
    }
}

fn parse_drc_json_text(
    text: &str,
) -> Result<(Vec<DrcViolation>, BTreeMap<String, DrcTypeCounts>), String> {
    let root: serde_json::Value = serde_json::from_str(text).map_err(|err| err.to_string())?;
    let Some(distribution) = root
        .get("drc")
        .and_then(|node| node.get("distribution"))
        .and_then(|node| node.as_object())
    else {
        return Ok((Vec::new(), BTreeMap::new()));
    };

    let mut violations = Vec::new();
    let mut counts = BTreeMap::new();
    for (drc_type, type_node) in distribution {
        let mut type_counts = DrcTypeCounts {
            total_count: json_usize(type_node.get("number")).unwrap_or(0),
            layer_counts: BTreeMap::new(),
        };
        if let Some(layers) = type_node.get("layers").and_then(|node| node.as_object()) {
            for (layer, layer_node) in layers {
                let layer_count = json_usize(layer_node.get("number")).unwrap_or(0);
                if layer_count > 0 {
                    type_counts.layer_counts.insert(layer.clone(), layer_count);
                }
                if let Some(list) = layer_node.get("list").and_then(|node| node.as_array()) {
                    for item in list {
                        if let Some(violation) =
                            parse_drc_violation(item, violations.len(), drc_type, layer)
                        {
                            violations.push(violation);
                        }
                    }
                }
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(drc_type.clone(), type_counts);
    }

    Ok((violations, counts))
}

fn parse_drc_violation(
    node: &serde_json::Value,
    id: usize,
    drc_type: &str,
    layer: &str,
) -> Option<DrcViolation> {
    let llx = json_i32(node.get("llx"))?;
    let lly = json_i32(node.get("lly"))?;
    let urx = json_i32(node.get("urx"))?;
    let ury = json_i32(node.get("ury"))?;
    Some(DrcViolation {
        id,
        drc_type: drc_type.to_string(),
        layer: layer.to_ascii_lowercase(),
        bbox: Rect32 {
            lx: llx.min(urx),
            ly: lly.min(ury),
            hx: llx.max(urx),
            hy: lly.max(ury),
        },
        required_size: json_i64(node.get("required_size")),
        nets: json_string_vec(node.get("net")),
        insts: json_string_vec(node.get("inst")),
    })
}

fn parse_drc_statis_csv(text: &str) -> BTreeMap<String, DrcTypeCounts> {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return BTreeMap::new();
    };
    let headers = split_simple_csv_line(header_line);
    if headers.is_empty() {
        return BTreeMap::new();
    }

    let mut counts = BTreeMap::new();
    for line in lines {
        let fields = split_simple_csv_line(line);
        if fields.is_empty() {
            continue;
        }
        let drc_type = fields[0].trim();
        if drc_type.is_empty() || drc_type.eq_ignore_ascii_case("total") {
            continue;
        }
        let mut type_counts = DrcTypeCounts::default();
        for (index, header) in headers.iter().enumerate().skip(1) {
            let value = fields
                .get(index)
                .and_then(|field| field.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if header.eq_ignore_ascii_case("total") {
                type_counts.total_count = value;
            } else if value > 0 {
                type_counts.layer_counts.insert(header.clone(), value);
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(drc_type.to_string(), type_counts);
    }
    counts
}

fn split_simple_csv_line(line: &str) -> Vec<String> {
    line.split(',')
        .map(|field| field.trim().trim_matches('"').to_string())
        .collect()
}

fn merge_drc_counts(
    target: &mut BTreeMap<String, DrcTypeCounts>,
    source: BTreeMap<String, DrcTypeCounts>,
) {
    for (drc_type, source_counts) in source {
        let target_counts = target.entry(drc_type).or_default();
        if target_counts.total_count == 0 {
            target_counts.total_count = source_counts.total_count;
        }
        for (layer, count) in source_counts.layer_counts {
            target_counts.layer_counts.entry(layer).or_insert(count);
        }
    }
}

fn drc_counts_from_violations(violations: &[DrcViolation]) -> BTreeMap<String, DrcTypeCounts> {
    let mut counts = BTreeMap::<String, DrcTypeCounts>::new();
    for violation in violations {
        let type_counts = counts.entry(violation.drc_type.clone()).or_default();
        type_counts.total_count += 1;
        *type_counts
            .layer_counts
            .entry(violation.layer.clone())
            .or_insert(0) += 1;
    }
    counts
}

fn drc_type_states_from_counts(counts: BTreeMap<String, DrcTypeCounts>) -> Vec<DrcTypeState> {
    counts
        .into_iter()
        .filter(|(_, counts)| counts.total_count > 0 || !counts.layer_counts.is_empty())
        .map(|(name, counts)| DrcTypeState {
            name,
            total_count: counts.total_count,
            layer_counts: counts.layer_counts,
            visible: true,
        })
        .collect()
}

impl AntennaOverlay {
    fn load(data_path: Option<PathBuf>, statis_path: Option<PathBuf>) -> Option<Self> {
        if data_path.is_none() && statis_path.is_none() {
            return None;
        }

        let mut load_error = None;
        let mut violations = Vec::new();
        let mut counts = BTreeMap::new();

        if let Some(path) = data_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .and_then(|text| parse_antenna_json_text(&text))
            {
                Ok((json_violations, json_counts)) => {
                    violations = json_violations;
                    counts = json_counts;
                }
                Err(err) => {
                    load_error = Some(format!(
                        "failed to load Antenna data {}: {err}",
                        path.display()
                    ));
                }
            }
        }

        if let Some(path) = statis_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .map(|text| parse_antenna_statis_csv(&text))
            {
                Ok(csv_counts) => merge_antenna_counts(&mut counts, csv_counts),
                Err(err) => {
                    let message = format!(
                        "failed to load Antenna statistics {}: {err}",
                        path.display()
                    );
                    load_error = Some(match load_error {
                        Some(existing) => format!("{existing}; {message}"),
                        None => message,
                    });
                }
            }
        }

        merge_antenna_counts(&mut counts, antenna_counts_from_violations(&violations));
        let type_states = antenna_type_states_from_counts(counts);

        let rtree_nodes: Vec<_> = violations
            .iter()
            .enumerate()
            .map(|(i, v)| AntennaViolationRTreeNode {
                bbox: rstar::AABB::from_corners([v.bbox.lx, v.bbox.ly], [v.bbox.hx, v.bbox.hy]),
                index: i,
            })
            .collect();
        let rtree = rstar::RTree::bulk_load(rtree_nodes);

        Some(Self {
            data_path,
            statis_path,
            type_states,
            violations,
            rtree,
            load_error,
        })
    }

    fn total_count(&self) -> usize {
        self.type_states.iter().map(|state| state.total_count).sum()
    }

    fn selected_type_count(&self) -> usize {
        self.type_states
            .iter()
            .filter(|state| state.visible)
            .count()
    }

    fn set_all_visible(&mut self, visible: bool) {
        for state in &mut self.type_states {
            state.visible = visible;
        }
    }

    fn type_is_visible(&self, antenna_type: &str) -> bool {
        self.type_states
            .iter()
            .find(|state| state.name == antenna_type)
            .is_some_and(|state| state.visible)
    }
}

fn parse_antenna_json_text(
    text: &str,
) -> Result<(Vec<AntennaViolation>, BTreeMap<String, AntennaTypeCounts>), String> {
    let root: serde_json::Value = serde_json::from_str(text).map_err(|err| err.to_string())?;
    let Some(distribution) = root
        .get("antenna")
        .and_then(|node| node.get("distribution"))
        .and_then(|node| node.as_object())
    else {
        return Ok((Vec::new(), BTreeMap::new()));
    };

    let mut violations = Vec::new();
    let mut counts = BTreeMap::new();
    for (antenna_type, type_node) in distribution {
        let mut type_counts = AntennaTypeCounts {
            total_count: json_usize(type_node.get("number")).unwrap_or(0),
            layer_counts: BTreeMap::new(),
        };
        if let Some(layers) = type_node.get("layers").and_then(|node| node.as_object()) {
            for (layer, layer_node) in layers {
                let layer_count = json_usize(layer_node.get("number")).unwrap_or(0);
                if layer_count > 0 {
                    type_counts.layer_counts.insert(layer.clone(), layer_count);
                }
                if let Some(list) = layer_node.get("list").and_then(|node| node.as_array()) {
                    for item in list {
                        if let Some(violation) =
                            parse_antenna_violation(item, violations.len(), antenna_type, layer)
                        {
                            violations.push(violation);
                        }
                    }
                }
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(antenna_type.clone(), type_counts);
    }

    Ok((violations, counts))
}

fn parse_antenna_violation(
    node: &serde_json::Value,
    id: usize,
    antenna_type: &str,
    layer: &str,
) -> Option<AntennaViolation> {
    let llx = json_i32(node.get("llx"))?;
    let lly = json_i32(node.get("lly"))?;
    let urx = json_i32(node.get("urx"))?;
    let ury = json_i32(node.get("ury"))?;
    Some(AntennaViolation {
        id,
        antenna_type: antenna_type.to_string(),
        layer: layer.to_ascii_lowercase(),
        bbox: Rect32 {
            lx: llx.min(urx),
            ly: lly.min(ury),
            hx: llx.max(urx),
            hy: lly.max(ury),
        },
        required_size: json_i64(node.get("required_size")),
        nets: json_string_vec(node.get("net")),
        insts: json_string_vec(node.get("inst")),
    })
}

fn parse_antenna_statis_csv(text: &str) -> BTreeMap<String, AntennaTypeCounts> {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return BTreeMap::new();
    };
    let headers = split_simple_csv_line(header_line);
    if headers.is_empty() {
        return BTreeMap::new();
    }

    let mut counts = BTreeMap::new();
    for line in lines {
        let fields = split_simple_csv_line(line);
        if fields.is_empty() {
            continue;
        }
        let antenna_type = fields[0].trim();
        if antenna_type.is_empty() || antenna_type.eq_ignore_ascii_case("total") {
            continue;
        }
        let mut type_counts = AntennaTypeCounts::default();
        for (index, header) in headers.iter().enumerate().skip(1) {
            let value = fields
                .get(index)
                .and_then(|field| field.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if header.eq_ignore_ascii_case("total") {
                type_counts.total_count = value;
            } else if value > 0 {
                type_counts.layer_counts.insert(header.clone(), value);
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(antenna_type.to_string(), type_counts);
    }
    counts
}

fn merge_antenna_counts(
    target: &mut BTreeMap<String, AntennaTypeCounts>,
    source: BTreeMap<String, AntennaTypeCounts>,
) {
    for (antenna_type, source_counts) in source {
        let target_counts = target.entry(antenna_type).or_default();
        if target_counts.total_count == 0 {
            target_counts.total_count = source_counts.total_count;
        }
        for (layer, count) in source_counts.layer_counts {
            target_counts.layer_counts.entry(layer).or_insert(count);
        }
    }
}

fn antenna_counts_from_violations(
    violations: &[AntennaViolation],
) -> BTreeMap<String, AntennaTypeCounts> {
    let mut counts = BTreeMap::<String, AntennaTypeCounts>::new();
    for violation in violations {
        let type_counts = counts.entry(violation.antenna_type.clone()).or_default();
        type_counts.total_count += 1;
        *type_counts
            .layer_counts
            .entry(violation.layer.clone())
            .or_insert(0) += 1;
    }
    counts
}

fn antenna_type_states_from_counts(
    counts: BTreeMap<String, AntennaTypeCounts>,
) -> Vec<AntennaTypeState> {
    counts
        .into_iter()
        .filter(|(_, counts)| counts.total_count > 0 || !counts.layer_counts.is_empty())
        .map(|(name, counts)| AntennaTypeState {
            name,
            total_count: counts.total_count,
            layer_counts: counts.layer_counts,
            visible: true,
        })
        .collect()
}

fn json_i32(value: Option<&serde_json::Value>) -> Option<i32> {
    value
        .and_then(|value| value.as_i64())
        .and_then(|value| i32::try_from(value).ok())
}

fn json_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_f64().map(|number| number.round() as i64))
    })
}

fn json_usize(value: Option<&serde_json::Value>) -> Option<usize> {
    value
        .and_then(|value| value.as_u64())
        .and_then(|value| usize::try_from(value).ok())
}

fn json_string_vec(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

impl LoadedViewer {
    fn new(
        color_theme: chip_display::ColorTheme,
        db: ChipViewDb,
        edit_enabled: bool,
        initial_session_dirty: bool,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
        drc_data_path: Option<PathBuf>,
        drc_statis_path: Option<PathBuf>,
        antenna_data_path: Option<PathBuf>,
        antenna_statis_path: Option<PathBuf>,
        map_root_path: Option<PathBuf>,
        target_format: wgpu::TextureFormat,
        has_wgpu: bool,
    ) -> Self {
        let stats = db.stats();
        let grid_bounds = grid_reference_bounds(&db).or(stats.bbox);
        let snapshot_signature = snapshot_signature_for_db(&db);
        let drawing_category_counts = drawing_category_counts(&db);
        let layers = layer_ui_states(&db, &BTreeMap::new(), color_theme);
        let drc_overlay = DrcOverlay::load(drc_data_path, drc_statis_path);
        let antenna_overlay = AntennaOverlay::load(antenna_data_path, antenna_statis_path);
        let (map_catalog, map_catalog_error) = match map_root_path.as_deref() {
            Some(root) => match MapCatalog::discover(root) {
                Ok(catalog) if !catalog.is_empty() => (Some(catalog), None),
                Ok(_) => (None, None),
                Err(err) => (None, Some(err)),
            },
            None => (None, None),
        };
        let analysis_tab = if drc_overlay.is_some() {
            AnalysisTab::Drc
        } else if antenna_overlay.is_some() {
            AnalysisTab::Antenna
        } else {
            AnalysisTab::Map
        };
        let expanded_map_categories = map_catalog
            .as_ref()
            .and_then(|catalog| catalog.categories.first())
            .map(|category| BTreeSet::from([category.id.clone()]))
            .unwrap_or_default();
        let map_thumbnail_worker = map_catalog.as_ref().map(|_| spawn_map_thumbnail_worker());
        if !has_wgpu {
            log::info!("GPU canvas disabled, using CPU software renderer");
        }
        Self {
            color_theme,
            start_time: Instant::now(),
            db,
            stats,
            grid_bounds,
            drawing_category_counts,
            layers,
            edit_enabled,
            edit_command_dir,
            edit_result_dir,
            query_input_mode: QueryInputMode::Search,
            search_text: String::new(),
            search_mode: SearchMode::All,
            shape_id_text: String::new(),
            last_query_status: None,
            highlighted: BTreeSet::new(),
            selected: None,
            pending_focus: None,
            draft: None,
            pending_edit: None,
            pending_session_action: None,
            session_action_progress: None,
            last_edit_result: None,
            session_dirty: initial_session_dirty,
            close_confirmation_visible: false,
            close_after_session_action: false,
            snapshot_signature,
            next_snapshot_refresh_check: Instant::now() + SNAPSHOT_REFRESH_CHECK_INTERVAL,
            render_cache: RenderPlanCache::default(),
            view_tile_cache: ViewTilePlaneCache::default(),
            next_command_counter: 1,
            drc_overlay,
            selected_drc: None,
            antenna_overlay,
            selected_antenna: None,
            map_catalog,
            map_catalog_error,
            analysis_tab,
            expanded_map_categories,
            selected_map_item: None,
            previous_map_item: None,
            active_heatmap: None,
            map_item_error: None,
            map_thumbnails: BTreeMap::new(),
            map_thumbnail_worker,
            selected_map_bbox: None,
            focus_animation: None,
            zoom: 1.0,
            pan: egui::Vec2::ZERO,
            pan_drag: PanDragState::default(),
            ruler_tool: OrthogonalRuler::default(),
            object_visibility: ObjectVisibility::default(),
            coordinate_unit: CoordinateUnit::Dbu,
            view_mode: ViewMode::TwoD,
            camera_ctrl_3d: crate::nav3d::CameraController3d::default(),
            show_3d_grid: true,
            shading_style_3d: crate::canvas_gpu3d::ShadingStyle::Normal,
            lighting_preset_3d: chip_display::LightingPreset::Studio,
            z_cut_ratio_3d: 0.0,
            layer_stack: LayerStack::default(),
            view3d_fitted: false,
            view3d_bootstrapped: false,
            sidebar_info_panel: None,
            geometry_epoch: 1,
            owner_category_cache: OwnerCategoryCache::default(),
            visibility_rules_cache: VisibilityRulesCache::default(),
            gpu_canvas: crate::canvas_gpu::GpuCanvasState::new_with_wgpu(has_wgpu, target_format),
            gpu_tile_instances: std::collections::HashMap::new(),
            gpu_3d_instances_cache: None,
            last_3d_query_rect: None,
            perf_3d: Perf3dState::default(),
            gpu_frame_counter: 0,
            label_collector: ShapeLabelCollector::default(),
            frame_valid_shapes: Vec::new(),
            frame_valid_labels: Vec::new(),
            status_line_buffer: String::with_capacity(128),
            shortcuts_overlay_visible: false,
            loading_3d_start: None,
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        self.sidebar_contents(ui);
    }

    fn has_analysis_panel(&self) -> bool {
        self.drc_overlay.is_some()
            || self.antenna_overlay.is_some()
            || self.map_catalog.is_some()
            || self.map_catalog_error.is_some()
    }

    fn analysis_sidebar(&mut self, ui: &mut egui::Ui) {
        let has_drc = self.drc_overlay.is_some();
        let has_antenna = self.antenna_overlay.is_some();
        let has_maps = self.map_catalog.is_some() || self.map_catalog_error.is_some();
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 2.0;
            if has_drc && analysis_tab_button(ui, "DRC", self.analysis_tab == AnalysisTab::Drc) {
                self.analysis_tab = AnalysisTab::Drc;
            }
            if has_antenna
                && analysis_tab_button(ui, "ANTENNA", self.analysis_tab == AnalysisTab::Antenna)
            {
                self.analysis_tab = AnalysisTab::Antenna;
            }
            if has_maps && analysis_tab_button(ui, "MAP", self.analysis_tab == AnalysisTab::Map) {
                self.analysis_tab = AnalysisTab::Map;
            }
        });
        ui.add_space(4.0);
        ui.separator();

        let show_drc = self.analysis_tab == AnalysisTab::Drc && has_drc;
        let show_antenna = self.analysis_tab == AnalysisTab::Antenna && has_antenna;
        let show_map = self.analysis_tab == AnalysisTab::Map && has_maps;

        if show_drc {
            self.drc_sidebar(ui);
        } else if show_antenna {
            self.antenna_sidebar(ui);
        } else if show_map {
            self.map_sidebar(ui);
        } else if has_drc {
            self.drc_sidebar(ui);
        } else if has_antenna {
            self.antenna_sidebar(ui);
        } else if has_maps {
            self.map_sidebar(ui);
        }
    }

    fn drc_sidebar(&mut self, ui: &mut egui::Ui) {
        let visible_count = self.visible_drc_violation_count(None);
        let Some(overlay) = &mut self.drc_overlay else {
            return;
        };

        ui.horizontal(|ui| {
            section_heading(ui, "VIOLATIONS");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{visible_count}/{}", overlay.total_count()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            });
        });
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                overlay.set_all_visible(true);
            }
            if ui.small_button("None").clicked() {
                overlay.set_all_visible(false);
                self.selected_drc = None;
            }
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} types",
                    overlay.selected_type_count(),
                    overlay.type_states.len()
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });

        if let Some(err) = &overlay.load_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
        }

        ui.add_space(6.0);
        if overlay.type_states.is_empty() {
            ui.label(
                egui::RichText::new("No DRC violations")
                    .color(ecos_text_secondary())
                    .size(13.0),
            );
            if let Some(path) = overlay.data_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            if let Some(path) = overlay.statis_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            return;
        }

        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_drc_type_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for state in &mut overlay.type_states {
                    drc_type_card(ui, state);
                    ui.add_space(8.0);
                }
            });
    }

    fn antenna_sidebar(&mut self, ui: &mut egui::Ui) {
        let visible_count = self.visible_antenna_violation_count(None);
        let Some(overlay) = &mut self.antenna_overlay else {
            return;
        };

        ui.horizontal(|ui| {
            section_heading(ui, "VIOLATIONS");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{visible_count}/{}", overlay.total_count()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            });
        });
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                overlay.set_all_visible(true);
            }
            if ui.small_button("None").clicked() {
                overlay.set_all_visible(false);
                self.selected_drc = None;
            }
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} types",
                    overlay.selected_type_count(),
                    overlay.type_states.len()
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });

        if let Some(err) = &overlay.load_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
        }

        ui.add_space(6.0);
        if overlay.type_states.is_empty() {
            ui.label(
                egui::RichText::new("No Antenna violations")
                    .color(ecos_text_secondary())
                    .size(13.0),
            );
            if let Some(path) = overlay.data_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            if let Some(path) = overlay.statis_path.as_deref() {
                ui.label(
                    egui::RichText::new(path.display().to_string())
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            return;
        }

        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_antenna_type_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for state in &mut overlay.type_states {
                    antenna_type_card(ui, state);
                    ui.add_space(8.0);
                }
            });
    }

    fn map_sidebar(&mut self, ui: &mut egui::Ui) {
        self.poll_map_thumbnail_results(ui.ctx());
        ui.horizontal(|ui| {
            section_heading(ui, "MAP DATA");
            if let Some(catalog) = &self.map_catalog {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(format!(
                            "{} maps / {} groups",
                            catalog.item_count(),
                            catalog.categories.len()
                        ))
                        .small()
                        .color(ecos_text_secondary()),
                    );
                });
            }
        });

        if let Some(err) = &self.map_catalog_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
            return;
        }
        if let Some(err) = &self.map_item_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), err);
        }

        let Some(catalog) = self.map_catalog.as_ref() else {
            ui.add_space(6.0);
            ui.label(
                egui::RichText::new("No map data")
                    .size(13.0)
                    .color(ecos_text_secondary()),
            );
            return;
        };
        let categories = catalog.categories.clone();
        let warnings = catalog.warnings.clone();
        for warning in warnings {
            ui.colored_label(ecos_warning(), warning);
        }

        if let Some(heatmap) = self.active_heatmap.as_mut() {
            ui.add_space(4.0);
            ui.group(|ui| {
                ui.label(
                    egui::RichText::new("HEATMAP OVERLAY")
                        .small()
                        .strong()
                        .color(ecos_accent()),
                );
                ui.horizontal(|ui| {
                    ui.label("Colormap:");
                    let mut current_mode = heatmap.colormap_mode;
                    for mode in [
                        ColormapMode::Turbo,
                        ColormapMode::Viridis,
                        ColormapMode::Plasma,
                    ] {
                        if ui
                            .selectable_label(current_mode == mode, mode.label())
                            .clicked()
                        {
                            current_mode = mode;
                        }
                    }
                    heatmap.set_colormap_mode(current_mode);
                });
                ui.horizontal(|ui| {
                    ui.label("Opacity:");
                    ui.add(egui::Slider::new(&mut heatmap.opacity, 0.05..=1.0).show_value(true));
                });
            });
        }

        ui.add_space(4.0);
        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_map_catalog_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for category in categories {
                    let default_open = self.expanded_map_categories.contains(&category.id);
                    egui::CollapsingHeader::new(format!(
                        "{}  {}",
                        category.label,
                        category.items.len()
                    ))
                    .id_salt(("chip_viewer_map_category", &category.id))
                    .default_open(default_open)
                    .show(ui, |ui| {
                        for item in &category.items {
                            let texture_id = self.map_thumbnail_id(ui.ctx(), &item.png_path);
                            let available =
                                item.csv_path.is_some() && category.layout_path.is_some();
                            let selected = self.selected_map_item.as_ref() == Some(&item.png_path);
                            ui.horizontal(|ui| {
                                if let Some(texture_id) = texture_id {
                                    ui.add(
                                        egui::Image::new((texture_id, egui::vec2(52.0, 40.0)))
                                            .fit_to_exact_size(egui::vec2(52.0, 40.0))
                                            .corner_radius(3.0),
                                    );
                                } else {
                                    let (rect, _) = ui.allocate_exact_size(
                                        egui::vec2(52.0, 40.0),
                                        egui::Sense::hover(),
                                    );
                                    ui.painter().rect_filled(rect, 3.0, ecos_canvas());
                                    ui.painter().text(
                                        rect.center(),
                                        egui::Align2::CENTER_CENTER,
                                        "PNG",
                                        egui::FontId::monospace(10.0),
                                        ecos_text_secondary(),
                                    );
                                }

                                let button_width = ui.available_width().max(80.0);
                                let response = ui.add_enabled(
                                    available,
                                    egui::Button::new(
                                        egui::RichText::new(&item.label)
                                            .size(12.5)
                                            .color(ecos_text_primary()),
                                    )
                                    .selected(selected)
                                    .truncate()
                                    .min_size(egui::vec2(button_width, 40.0)),
                                );
                                let response = if available {
                                    response
                                        .on_hover_text(format!("Open {}", item.png_path.display()))
                                } else if item.csv_path.is_none() {
                                    response.on_disabled_hover_text("Matching CSV file is missing")
                                } else {
                                    response.on_disabled_hover_text("layout.csv is missing")
                                };
                                if response.clicked() {
                                    self.activate_map_item(item, category.layout_path.as_deref());
                                }
                            });
                            ui.add_space(4.0);
                        }
                    });
                    ui.add_space(4.0);
                }
            });
    }

    fn activate_map_item(&mut self, item: &MapItem, layout_path: Option<&Path>) {
        if let Some(current_png) = &self.selected_map_item {
            if current_png != &item.png_path {
                if let Some(catalog) = &self.map_catalog {
                    if let Some((curr_item, curr_layout)) = catalog.find_item_by_png(current_png) {
                        self.previous_map_item =
                            Some((curr_item.clone(), curr_layout.map(|p| p.to_path_buf())));
                    }
                }
            }
        }
        self.selected_map_item = Some(item.png_path.clone());
        self.active_heatmap = None;
        self.map_item_error = None;
        self.selected_map_bbox = None;

        let Some(csv_path) = item.csv_path.as_deref() else {
            self.map_item_error = Some(format!("matching CSV is missing for {}", item.label));
            return;
        };
        let Some(layout_path) = layout_path else {
            self.map_item_error = Some(format!("layout.csv is missing for {}", item.label));
            return;
        };
        match HeatmapData::load(csv_path, layout_path) {
            Ok(data) => {
                self.active_heatmap = Some(ActiveHeatmap::new(item.label.clone(), data));
            }
            Err(err) => self.map_item_error = Some(err),
        }
    }

    fn toggle_previous_map_item(&mut self) {
        let Some((prev_item, prev_layout)) = self.previous_map_item.take() else {
            return;
        };
        self.activate_map_item(&prev_item, prev_layout.as_deref());
    }

    fn map_thumbnail_id(&mut self, ctx: &egui::Context, path: &Path) -> Option<egui::TextureId> {
        if !self.map_thumbnails.contains_key(path) {
            let state = self
                .map_thumbnail_worker
                .as_ref()
                .filter(|worker| worker.request_sender.send(path.to_path_buf()).is_ok())
                .map_or(MapThumbnailState::Failed, |_| MapThumbnailState::Loading);
            self.map_thumbnails.insert(path.to_path_buf(), state);
            ctx.request_repaint_after(Duration::from_millis(32));
        }
        match self.map_thumbnails.get(path) {
            Some(MapThumbnailState::Ready(texture)) => Some(texture.id()),
            Some(MapThumbnailState::Loading | MapThumbnailState::Failed) | None => None,
        }
    }

    fn poll_map_thumbnail_results(&mut self, ctx: &egui::Context) {
        let results = self
            .map_thumbnail_worker
            .as_ref()
            .map(|worker| worker.result_receiver.try_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        for result in results {
            let state = match result.decoded {
                Ok(decoded) => {
                    let image = egui::ColorImage::from_rgba_unmultiplied(
                        decoded.size,
                        decoded.rgba.as_slice(),
                    );
                    MapThumbnailState::Ready(ctx.load_texture(
                        format!("map-preview:{}", result.path.display()),
                        image,
                        egui::TextureOptions::LINEAR,
                    ))
                }
                Err(_) => MapThumbnailState::Failed,
            };
            self.map_thumbnails.insert(result.path, state);
        }
        if self
            .map_thumbnails
            .values()
            .any(|state| matches!(state, MapThumbnailState::Loading))
        {
            ctx.request_repaint_after(Duration::from_millis(32));
        }
    }

    fn sidebar_contents(&mut self, ui: &mut egui::Ui) {
        let section_heights = sidebar_section_heights(ui.available_height());
        let available_width = ui.available_width();

        ui.add_space(4.0);
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.view),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_view_section(ui),
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.physical_layers),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_physical_layers_section(ui, section_heights.physical_layers),
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.drawing_data),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_drawing_data_section(ui, section_heights.drawing_data),
        );
        ui.separator();
        ui.allocate_ui_with_layout(
            egui::vec2(available_width, section_heights.interaction),
            egui::Layout::top_down(egui::Align::Min),
            |ui| self.sidebar_interaction_section(ui, section_heights.interaction),
        );
    }

    fn sidebar_view_section(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            section_heading(ui, "VIEW");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if self.edit_enabled {
                    let action_pending = self.pending_session_action.is_some();
                    let can_manage_session =
                        self.pending_edit.is_none() && self.draft.is_none() && !action_pending;
                    if ui
                        .add_enabled(
                            can_manage_session && self.session_dirty,
                            egui::Button::new(egui::RichText::new("💾").size(16.0))
                                .min_size(egui::vec2(28.0, 26.0))
                                .selected(self.session_dirty),
                        )
                        .on_hover_text("Save uncommitted layout edits")
                        .clicked()
                    {
                        self.request_session_action(SessionActionKind::Save, false);
                    }
                    if ui
                        .add_enabled(
                            can_manage_session && self.session_dirty,
                            egui::Button::new(egui::RichText::new("↶").size(18.0))
                                .min_size(egui::vec2(28.0, 26.0)),
                        )
                        .on_hover_text("Discard uncommitted layout edits")
                        .clicked()
                    {
                        self.request_session_action(SessionActionKind::Discard, false);
                    }
                    ui.separator();
                }
                for panel in [SidebarInfoPanel::Diagnostics, SidebarInfoPanel::Selection] {
                    let active = self.sidebar_info_panel == Some(panel);
                    if ui
                        .add_sized(
                            egui::vec2(28.0, 26.0),
                            egui::Button::new(egui::RichText::new(panel.icon()).size(17.0))
                                .selected(active),
                        )
                        .on_hover_text(panel.label())
                        .clicked()
                    {
                        self.sidebar_info_panel = if active { None } else { Some(panel) };
                    }
                }
            });
        });
        ui.horizontal(|ui| {
            for (mode, label) in [(ViewMode::TwoD, "2D"), (ViewMode::ThreeD, "3D")] {
                let enabled = mode == ViewMode::TwoD || self.gpu_canvas.enabled;
                ui.add_enabled_ui(enabled, |ui| {
                    if ui
                        .selectable_label(self.view_mode == mode, label)
                        .on_hover_text(if !enabled && mode == ViewMode::ThreeD {
                            "3D view requires GPU acceleration (running in CPU fallback)"
                        } else if mode == ViewMode::ThreeD {
                            "Orbit the extruded metal stack"
                        } else {
                            "Plan-view layout canvas"
                        })
                        .clicked()
                    {
                        if self.view_mode != mode {
                            if mode == ViewMode::ThreeD {
                                self.switch_to_3d_mode();
                            } else {
                                self.switch_to_2d_mode();
                            }
                        }
                    }
                });
            }
            ui.separator();
            if ui.button("⛶").on_hover_text("Fit layout to view").clicked() {
                self.focus_animation = None;
                self.pan_drag.reset();
                if self.view_mode == ViewMode::ThreeD {
                    self.view3d_fitted = false;
                } else {
                    self.zoom = 1.0;
                    self.pan = egui::Vec2::ZERO;
                }
            }
            let can_reload = self.pending_edit.is_none() && self.draft.is_none();
            if ui
                .add_enabled(can_reload, egui::Button::new("↻"))
                .on_hover_text("Reload geometry snapshot")
                .clicked()
            {
                match self.reload_snapshot() {
                    Ok(()) => {
                        self.last_edit_result = Some("geometry snapshot reloaded".to_string());
                    }
                    Err(err) => {
                        self.last_edit_result = Some(format!("failed to reload geometry: {err}"));
                    }
                }
            }
            let ruler_response = ui
                .add_sized(
                    egui::vec2(30.0, 26.0),
                    egui::Button::new("").selected(self.ruler_tool.enabled),
                )
                .on_hover_text("Measure");
            paint_ruler_tool_icon(ui.painter(), ruler_response.rect, ecos_text_primary());
            if ruler_response.clicked() {
                self.ruler_tool.toggle();
                self.pan_drag.reset();
            }
            ui.separator();
            let dbu_per_micron = self.db.snapshot().manifest().dbu_per_micron;
            for unit in [CoordinateUnit::Dbu, CoordinateUnit::Micron] {
                ui.add_enabled_ui(unit.is_available(dbu_per_micron), |ui| {
                    ui.selectable_value(&mut self.coordinate_unit, unit, unit.label());
                });
            }
            ui.separator();
            if ui
                .add_sized(
                    egui::vec2(28.0, 26.0),
                    egui::Button::new(
                        egui::RichText::new("?")
                            .strong()
                            .size(13.0)
                            .color(ecos_accent()),
                    )
                    .selected(self.shortcuts_overlay_visible),
                )
                .on_hover_text("Keyboard Shortcuts (?)")
                .clicked()
            {
                self.shortcuts_overlay_visible = !self.shortcuts_overlay_visible;
            }
        });

        if self.view_mode == ViewMode::ThreeD {
            ui.add_space(3.0);
            ui.horizontal(|ui| {
                if ui
                    .small_button("Iso")
                    .on_hover_text("Isometric camera (Key: 2 / I)")
                    .clicked()
                {
                    self.camera_ctrl_3d.set_iso();
                }
                if ui
                    .small_button("Top")
                    .on_hover_text("Look down from +Z (Key: 1 / T)")
                    .clicked()
                {
                    self.camera_ctrl_3d.set_top();
                }
                if ui
                    .small_button("Front")
                    .on_hover_text("Look across the stack (Key: 3)")
                    .clicked()
                {
                    self.camera_ctrl_3d.set_front();
                }
                ui.separator();
                if ui
                    .selectable_label(self.show_3d_grid, "Grid")
                    .on_hover_text("Toggle floor grid (Key: G)")
                    .clicked()
                {
                    self.show_3d_grid = !self.show_3d_grid;
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("Shading:")
                        .small()
                        .color(ecos_text_secondary()),
                );
                let mut shading = self.shading_style_3d;
                egui::ComboBox::from_id_source("shading_style_combo")
                    .selected_text(shading.label())
                    .show_ui(ui, |ui| {
                        for s in crate::canvas_gpu3d::ShadingStyle::ALL {
                            ui.selectable_value(&mut shading, *s, s.label());
                        }
                    });
                if shading != self.shading_style_3d {
                    self.shading_style_3d = shading;
                    ui.ctx().request_repaint();
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("Lighting:")
                        .small()
                        .color(ecos_text_secondary()),
                );
                let mut lighting = self.lighting_preset_3d;
                egui::ComboBox::from_id_source("lighting_preset_combo")
                    .selected_text(lighting.label())
                    .show_ui(ui, |ui| {
                        for l in chip_display::LightingPreset::ALL {
                            ui.selectable_value(&mut lighting, *l, l.label());
                        }
                    });
                if lighting != self.lighting_preset_3d {
                    self.lighting_preset_3d = lighting;
                    ui.ctx().request_repaint();
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("Theme:")
                        .small()
                        .color(ecos_text_secondary()),
                );
                let mut theme = self.color_theme;
                egui::ComboBox::from_id_source("single_app_color_theme")
                    .selected_text(theme.label())
                    .show_ui(ui, |ui| {
                        for t in [
                            chip_display::ColorTheme::Foundry,
                            chip_display::ColorTheme::Classic,
                            chip_display::ColorTheme::Vivid,
                            chip_display::ColorTheme::DieShot,
                            chip_display::ColorTheme::Playful,
                            chip_display::ColorTheme::Cyber,
                        ] {
                            ui.selectable_value(&mut theme, t, t.label());
                        }
                    });
                if theme != self.color_theme {
                    self.color_theme = theme;
                    let visibility = self
                        .layers
                        .iter()
                        .map(|l| (l.layer_id, l.visible))
                        .collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                }
            });

            ui.add_space(2.0);
            ui.horizontal_wrapped(|ui| {
                ui.label(egui::RichText::new("Presets:").small().color(ecos_text_secondary()));
                if ui.small_button("Engineering").on_hover_text("Foundry Palette + PBR Normal + Studio Lighting").clicked() {
                    self.color_theme = chip_display::ColorTheme::Foundry;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Normal;
                    self.lighting_preset_3d = chip_display::LightingPreset::Studio;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("EDA Classic").on_hover_text("Classic Rainbow + PBR Normal + Laboratory Neutral Light").clicked() {
                    self.color_theme = chip_display::ColorTheme::Classic;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Normal;
                    self.lighting_preset_3d = chip_display::LightingPreset::Laboratory;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("Die Shot").on_hover_text("DieShot Realistic Metals + Optical Thin-Film Iridescence + Studio Lighting").clicked() {
                    self.color_theme = chip_display::ColorTheme::DieShot;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Iridescent;
                    self.lighting_preset_3d = chip_display::LightingPreset::Studio;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("Diorama").on_hover_text("Playful Palette + Cartoon Cel-Shading + Softbox Lighting").clicked() {
                    self.color_theme = chip_display::ColorTheme::Playful;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Cartoon;
                    self.lighting_preset_3d = chip_display::LightingPreset::Softbox;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
                if ui.small_button("Cyber").on_hover_text("Cyber Palette + Tech Wireframe + Blueprint Light").clicked() {
                    self.color_theme = chip_display::ColorTheme::Cyber;
                    self.shading_style_3d = crate::canvas_gpu3d::ShadingStyle::Tech;
                    self.lighting_preset_3d = chip_display::LightingPreset::Blueprint;
                    let visibility = self.layers.iter().map(|l| (l.layer_id, l.visible)).collect();
                    self.layers = layer_ui_states(&self.db, &visibility, self.color_theme);
                    self.view_tile_cache.clear();
                    self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
                    ui.ctx().request_repaint();
                }
            });

            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.add(
                    egui::Slider::new(&mut self.camera_ctrl_3d.target.z_scale, 0.05..=6.0)
                        .logarithmic(true)
                        .text("Z-scale"),
                )
                .on_hover_text("Vertical elevation scale (0.05 = flat, 1.0 = standard 3D depth, 6.0 = exaggerated)");
            });
            ui.add_space(2.0);
            ui.horizontal(|ui| {
                ui.add(
                    egui::Slider::new(&mut self.z_cut_ratio_3d, 0.0..=1.0)
                        .custom_formatter(|n, _| format!("{:.0}%", n * 100.0))
                        .text("Z-Cut"),
                )
                .on_hover_text("Top-down cross-section cut (0% = Full Stack, 30-50% = Slice top power roof to see routing, 100% = Base only)");
            });
        }
    }

    fn sidebar_physical_layers_section(&mut self, ui: &mut egui::Ui, max_height: f32) {
        section_heading(ui, "PHYSICAL LAYERS");
        if self.layers.is_empty() {
            ui.label(
                egui::RichText::new("IDB layer metadata is unavailable for this snapshot.")
                    .small()
                    .color(ecos_text_secondary()),
            );
            return;
        }
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                set_layer_visibility(&mut self.layers, true);
                self.apply_object_visibility();
            }
            if ui.small_button("None").clicked() {
                set_layer_visibility(&mut self.layers, false);
                self.apply_object_visibility();
            }
            if ui.small_button("Invert").clicked() {
                invert_layer_visibility(&mut self.layers);
                self.apply_object_visibility();
            }
            ui.label(
                egui::RichText::new(format!(
                    "{}/{}",
                    visible_layer_count(&self.layers),
                    self.layers.len()
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });
        let via_shape_count = self.drawing_category_shape_count(DrawingCategory::Vias);
        if via_shape_count > 0 && !self.has_via_physical_layer() {
            ui.label(
                egui::RichText::new(format!(
                    "Vias {via_shape_count} are controlled above; this snapshot has no VIA cut layer."
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        }
        let mut layer_visibility_changed = false;
        let scroll_height = (max_height - 54.0).max(72.0);
        egui::ScrollArea::vertical()
            .max_height(scroll_height)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for layer in &mut self.layers {
                    ui.horizontal(|ui| {
                        layer_visibility_changed |= ui.checkbox(&mut layer.visible, "").changed();
                        let swatch = color32(layer.style.rgba);
                        let (rect, _) =
                            ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
                        ui.painter().rect_filled(rect, 2.0, swatch);
                        ui.label(&layer.name).on_hover_text(layer_hover_text(layer));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(
                                egui::RichText::new(layer.shape_count.to_string())
                                    .small()
                                    .color(ecos_text_secondary()),
                            );
                        });
                    });
                }
            });
        if layer_visibility_changed {
            self.apply_object_visibility();
        }
    }

    fn sidebar_drawing_data_section(&mut self, ui: &mut egui::Ui, max_height: f32) {
        section_heading(ui, "DRAWING DATA");
        let mut object_visibility_changed = false;
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                self.object_visibility.set_all_visible(true);
                object_visibility_changed = true;
            }
            if ui.small_button("None").clicked() {
                self.object_visibility.set_all_visible(false);
                object_visibility_changed = true;
            }
            ui.label(
                egui::RichText::new(format!(
                    "{} / {} shapes",
                    self.visible_object_shape_count(),
                    self.stats.shape_count
                ))
                .small()
                .color(ecos_text_secondary()),
            );
        });
        let scroll_height = (max_height - 48.0).max(72.0);
        egui::ScrollArea::vertical()
            .id_salt("chip_viewer_drawing_data_scroll")
            .max_height(scroll_height)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for category in DrawingCategory::ALL {
                    let shape_count = self.drawing_category_shape_count(category);
                    let mut visible = self.object_visibility.is_category_visible(category);
                    ui.horizontal(|ui| {
                        ui.checkbox(&mut visible, category.label())
                            .on_hover_text(category.tooltip());
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.label(
                                egui::RichText::new(shape_count.to_string())
                                    .small()
                                    .color(ecos_text_secondary()),
                            );
                        });
                    });
                    if visible != self.object_visibility.is_category_visible(category) {
                        self.object_visibility
                            .set_category_visible(category, visible);
                        object_visibility_changed = true;
                    }
                }
            });
        if object_visibility_changed {
            self.apply_object_visibility();
        }
    }

    fn sidebar_interaction_section(&mut self, ui: &mut egui::Ui, max_height: f32) {
        section_heading(ui, "QUERY");
        self.query_input_ui(ui, (max_height - 22.0).max(112.0));
        if self.edit_enabled {
            if self.edit_command_dir.is_none() || self.edit_result_dir.is_none() {
                ui.colored_label(ecos_warning(), "edit channel is not configured");
            } else if let Some(pending) = &self.pending_session_action {
                ui.label(
                    egui::RichText::new(format!("{} pending", pending.action.label()))
                        .small()
                        .color(ecos_text_secondary()),
                );
            } else if let Some(result) = &self.last_edit_result {
                ui.label(
                    egui::RichText::new(result)
                        .small()
                        .color(ecos_text_secondary()),
                );
            } else if self.session_dirty {
                ui.label(
                    egui::RichText::new("Unsaved changes")
                        .small()
                        .color(ecos_warning()),
                );
            }
        }
    }

    fn query_input_ui(&mut self, ui: &mut egui::Ui, height: f32) {
        egui::Frame::NONE
            .fill(ecos_canvas())
            .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
            .corner_radius(14)
            .inner_margin(egui::Margin::same(12))
            .show(ui, |ui| {
                ui.set_min_height(height);
                ui.set_max_height(height);
                ui.vertical(|ui| {
                    let input_height = (height - 46.0).max(42.0);
                    match self.query_input_mode {
                        QueryInputMode::Search => self.search_input_ui(ui, input_height),
                        QueryInputMode::ShapeId => self.shape_id_input_ui(ui, input_height),
                    }
                    ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
                        ui.horizontal(|ui| {
                            self.query_mode_picker(ui);
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if self.query_send_button(ui).clicked() {
                                        self.submit_query();
                                    }
                                },
                            );
                        });
                    });
                });
            });
    }

    fn query_mode_picker(&mut self, ui: &mut egui::Ui) {
        egui::ComboBox::from_id_salt("chip_viewer_query_input_mode")
            .selected_text(match self.query_input_mode {
                QueryInputMode::Search => format!("⌕ {}", self.search_mode.label()),
                QueryInputMode::ShapeId => "# Shape ID".to_string(),
            })
            .width(98.0)
            .show_ui(ui, |ui| {
                if ui
                    .selectable_value(
                        &mut self.query_input_mode,
                        QueryInputMode::ShapeId,
                        "# Shape ID",
                    )
                    .changed()
                {
                    self.last_query_status = None;
                }
                ui.separator();
                ui.label(
                    egui::RichText::new("Search")
                        .small()
                        .color(ecos_text_secondary()),
                );
                for mode in SearchMode::ALL {
                    let changed = ui
                        .selectable_label(
                            self.query_input_mode == QueryInputMode::Search
                                && self.search_mode == mode,
                            mode.label(),
                        )
                        .clicked();
                    if changed {
                        self.query_input_mode = QueryInputMode::Search;
                        self.search_mode = mode;
                        self.refresh_highlight();
                    }
                }
            });
    }

    fn query_send_button(&self, ui: &mut egui::Ui) -> egui::Response {
        let icon = match self.query_input_mode {
            QueryInputMode::Search => "⌕",
            QueryInputMode::ShapeId => "➤",
        };
        ui.add_sized(
            egui::vec2(34.0, 34.0),
            egui::Button::new(egui::RichText::new(icon).size(19.0).strong()),
        )
        .on_hover_text(match self.query_input_mode {
            QueryInputMode::Search => "Search and locate",
            QueryInputMode::ShapeId => "Select shape id",
        })
    }

    fn submit_query(&mut self) {
        match self.query_input_mode {
            QueryInputMode::Search => {
                self.refresh_highlight();
                self.focus_highlighted_shapes();
            }
            QueryInputMode::ShapeId => self.select_shape_id_from_input(),
        }
    }

    fn search_input_ui(&mut self, ui: &mut egui::Ui, input_height: f32) {
        let response = ui.add_sized(
            egui::vec2(ui.available_width(), input_height),
            egui::TextEdit::multiline(&mut self.search_text)
                .hint_text("Search name, net, instance, pin, bus, group")
                .desired_rows(2)
                .frame(false),
        );
        if response.changed() {
            self.search_text = single_line_query_text(&self.search_text);
            self.refresh_highlight();
        }
        let submit = response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
        if submit {
            self.submit_query();
        }
        if !self.search_text.trim().is_empty() {
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(format!("{} matches", self.highlighted.len()))
                        .small()
                        .color(ecos_text_secondary()),
                );
                if ui.small_button("Locate").clicked() {
                    self.focus_highlighted_shapes();
                }
                if ui.small_button("Clear").clicked() {
                    clear_search_state(&mut self.search_text, &mut self.highlighted);
                }
            });
        }
    }

    fn shape_id_input_ui(&mut self, ui: &mut egui::Ui, input_height: f32) {
        let response = ui.add_sized(
            egui::vec2(ui.available_width(), input_height),
            egui::TextEdit::multiline(&mut self.shape_id_text)
                .hint_text("Input shape id")
                .desired_rows(2)
                .frame(false),
        );
        if response.changed() {
            self.shape_id_text = single_line_query_text(&self.shape_id_text);
        }
        let submit = response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
        if submit {
            self.submit_query();
        }
        if let Some(status) = &self.last_query_status {
            ui.label(
                egui::RichText::new(status)
                    .small()
                    .color(ecos_text_secondary()),
            );
        }
    }

    fn selection_panel(&mut self, ui: &mut egui::Ui) {
        section_heading(ui, "SELECTION");
        let Some(shape_id) = self.selected else {
            info_panel_label(ui, "No shape selected");
            return;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            info_panel_label(ui, "Selected shape is no longer available");
            return;
        };
        let owner = self.db.owner_for_shape(shape);
        let owner_name = owner.and_then(|owner| self.db.owner_name(owner));
        let owner_local_name = owner.and_then(|owner| self.db.owner_local_name(owner));
        for line in selection_detail_lines(shape, owner, owner_name, owner_local_name) {
            info_panel_label(ui, line);
        }
        for line in edit_capability_lines(shape, owner, self.edit_enabled) {
            info_panel_label(ui, line);
        }
        let endpoints = selection_connectivity_endpoints(&self.db, owner, owner_name);
        for line in selection_connectivity_lines(&endpoints) {
            info_panel_label(ui, line);
        }
    }

    fn diagnostics_panel(&mut self, ui: &mut egui::Ui) {
        section_heading(ui, "DIAGNOSTICS");
        for line in design_metadata_lines(self.db.snapshot().manifest()) {
            info_panel_label(ui, line);
        }
        for line in semantic_metadata_lines(
            self.db.site_metadata().len(),
            self.db.master_metadata().len(),
            self.db.via_metadata().len(),
            self.db.grid_metadata().len(),
            self.db.connectivity_metadata().len(),
            self.db.net_metadata().len(),
            self.db.bus_metadata().len(),
            self.db.group_metadata().len(),
        ) {
            info_panel_label(ui, line);
        }
        for line in diagnostics_lines(
            &self.db.memory_stats(),
            &self.db.delta_stats(),
            self.db.view_tile_count(),
            self.render_cache.stats(),
            self.view_tile_cache.stats(),
        ) {
            info_panel_label(ui, line);
        }
    }

    fn ruler_edge_snap(
        &self,
        pointer: Point32,
        world: Rect32,
        canvas: egui::Rect,
        layer_ids: &[LayerId],
        use_view_tiles: bool,
    ) -> Option<Point32> {
        if !self.ruler_tool.active {
            return None;
        }
        let anchor = self.ruler_tool.points.last().copied()?;
        let radius = ruler_edge_snap_radius_dbu(world, canvas, self.zoom);
        let mut rects = Vec::new();
        if !use_view_tiles {
            for shape_id in self.db.query_layers_near_point(layer_ids, pointer, radius) {
                let Some(shape) = self.db.find_shape(shape_id) else {
                    continue;
                };
                if !is_renderable_shape(shape)
                    || !self.shape_is_visible(shape)
                    || !self.shape_is_drawn_at_current_zoom(shape)
                {
                    continue;
                }
                if let ShapeGeometry::Rect(rect) = self.db.shape_geometry(shape) {
                    rects.push(rect);
                }
            }
        }
        if let Some(rect) = self.selected_map_bbox {
            rects.push(rect);
        }
        nearest_orthogonal_edge_snap(anchor, pointer, &rects, radius)
    }

    fn paint_gpu_heatmap_overlay(&self, ui: &mut egui::Ui, canvas: egui::Rect, world: Rect32) {
        if self.analysis_tab != AnalysisTab::Map {
            return;
        }
        let Some(heatmap) = self.active_heatmap.as_ref() else {
            return;
        };
        if heatmap.instances.is_empty() {
            return;
        }

        if !self.gpu_canvas.enabled || self.gpu_canvas.failed {
            let painter = ui.painter();
            for instance in heatmap.instances.iter() {
                let rect = shape_screen_rect(
                    Rect32 {
                        lx: instance.rect_dbu[0],
                        ly: instance.rect_dbu[1],
                        hx: instance.rect_dbu[2],
                        hy: instance.rect_dbu[3],
                    },
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                );
                let visible = rect.intersect(canvas);
                if visible.is_positive() {
                    let rgba_bytes = instance.fill_rgba.to_le_bytes();
                    let alpha = ((rgba_bytes[3] as f32) * heatmap.opacity).round() as u8;
                    let color = egui::Color32::from_rgba_unmultiplied(
                        rgba_bytes[0],
                        rgba_bytes[1],
                        rgba_bytes[2],
                        alpha,
                    );
                    painter.rect_filled(visible, 0.0, color);
                }
            }
            return;
        }

        let scale = world_to_screen_scale(world, canvas, self.zoom);
        let uniform = crate::canvas_gpu::CanvasUniform {
            world_center_dbu: [
                (world.lx + world.hx) as f32 * 0.5,
                (world.ly + world.hy) as f32 * 0.5,
            ],
            canvas_center_px: [
                canvas.width() * 0.5 + self.pan.x,
                canvas.height() * 0.5 + self.pan.y,
            ],
            scale_px_per_dbu: scale,
            pixels_per_point: ui.ctx().pixels_per_point(),
            pattern_min_size_px: crate::canvas_gpu::PATTERN_MIN_SIZE_PX,
            min_shape_screen_size: crate::canvas_gpu::MIN_SHAPE_SCREEN_SIZE,
            screen_size_px: [canvas.width(), canvas.height()],
            is_interacting: 0.0,
            global_alpha: heatmap.opacity,
        };

        // Dedicated cache key so the instance buffer is uploaded once per heatmap edit.
        // opacity changes only modify `global_alpha` in uniform, preserving the cache.
        let buffer_key = crate::canvas_gpu::GpuBufferKey {
            geometry_epoch: self.geometry_epoch,
            tile_x: i32::MIN,
            tile_y: i32::MIN,
            zoom_tier: 0,
            layer_visibility_hash: heatmap.cached_hash,
            object_visibility_bits: 0,
        };

        let callback = crate::canvas_gpu::HeatmapGpuCallback {
            uniform,
            instances: std::sync::Arc::clone(&heatmap.instances),
            buffer_key,
            frame_counter: self.gpu_frame_counter,
            target_format: self.gpu_canvas.target_format,
        };

        ui.painter()
            .add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
    }

    fn canvas(&mut self, ui: &mut egui::Ui) {
        let canvas_start = Instant::now();
        let mut query_duration = Duration::ZERO;
        let mut filter_duration = Duration::ZERO;
        let mut paint_duration = Duration::ZERO;
        let mut estimated_primitives = 0usize;
        let mut visible_drc_count = 0usize;
        let mut visible_antenna_count = 0usize;
        let available = ui.available_size();
        let (response, frame_painter) =
            ui.allocate_painter(available, egui::Sense::click_and_drag());
        let frame = response.rect;
        let bg_rgba = self.color_theme.background_rgba();
        let bg_color = egui::Color32::from_rgba_premultiplied(
            (bg_rgba[0] * 255.0).round() as u8,
            (bg_rgba[1] * 255.0).round() as u8,
            (bg_rgba[2] * 255.0).round() as u8,
            255,
        );
        frame_painter.rect_filled(frame, 0.0, bg_color);
        let canvas = layout_canvas_rect(frame);
        let ruler_painter = frame_painter.clone();
        let painter = frame_painter.with_clip_rect(canvas);
        let heatmap_popup_rect = self.map_heatmap_popup_rect(canvas);
        let pointer_over_heatmap = heatmap_popup_rect.is_some_and(|rect| {
            ui.ctx()
                .input(|input| input.pointer.hover_pos())
                .is_some_and(|pos| rect.contains(pos))
        });
        let pointer_in_canvas = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .is_some_and(|pos| canvas.contains(pos));
        let pointer_over_layout = pointer_in_canvas && !pointer_over_heatmap;
        let drag_started_in_canvas = ui
            .ctx()
            .input(|input| input.pointer.press_origin())
            .is_some_and(|pos| canvas.contains(pos));

        let Some(world) = self.stats.bbox else {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "empty geometry",
                egui::FontId::proportional(14.0),
                ecos_text_secondary(),
            );
            return;
        };

        self.handle_canvas_keyboard_shortcuts(ui, world, canvas);

        if self.view_mode == ViewMode::ThreeD {
            self.canvas_3d(
                ui,
                &response,
                canvas,
                &painter,
                pointer_over_layout,
                pointer_over_heatmap,
                drag_started_in_canvas,
                world,
            );
            return;
        }

        if response.hovered() && !pointer_over_heatmap {
            let raw_scroll_delta_y = ui.ctx().input(|input| input.raw_scroll_delta.y);
            let zoom_delta = ui.ctx().input(|input| input.zoom_delta());
            let zoom_factor = if raw_scroll_delta_y.abs() > 0.0 {
                scroll_zoom_factor(raw_scroll_delta_y)
            } else {
                zoom_delta
            };
            if (zoom_factor - 1.0).abs() > f32::EPSILON {
                self.focus_animation = None;
                let cursor = ui
                    .ctx()
                    .input(|input| input.pointer.hover_pos())
                    .unwrap_or(canvas.center());
                (self.zoom, self.pan) =
                    zoom_at_screen_pos(world, canvas, self.zoom, self.pan, zoom_factor, cursor);
                self.pan_drag.reset();
                ui.ctx().request_repaint();
            }
        }

        self.focus_pending_shape(ui.ctx(), world, canvas);

        self.gpu_frame_counter = self.gpu_frame_counter.wrapping_add(1);

        let collect_stats = env_flag_requested(std::env::var(RENDER_STATS_ENV).ok().as_deref());

        let visible_layers: BTreeMap<LayerId, LayerStyle> = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .map(|layer| (layer.layer_id, layer.style))
            .collect();
        let query_layer_ids = render_query_layer_ids(&self.layers, self.object_visibility);
        let viewport = screen_to_world_rect(canvas, world, canvas, self.zoom, self.pan);
        let use_view_tiles = self.should_use_view_tiles(viewport, world);
        let hover_world_point = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .filter(|_| pointer_over_layout)
            .map(|pos| screen_to_world_point(pos, world, canvas, self.zoom, self.pan));

        if response.drag_started() && drag_started_in_canvas && !pointer_over_heatmap {
            self.focus_animation = None;
            self.pan_drag.reset();
            let mode = if response.drag_started_by(egui::PointerButton::Middle)
                || (!self.ruler_tool.enabled
                    && response.drag_started_by(egui::PointerButton::Secondary))
            {
                Some(CanvasDragMode::Pan)
            } else if response.drag_started_by(egui::PointerButton::Primary) {
                if self.ruler_tool.enabled {
                    None
                } else {
                    let edit_start_pos = ui
                        .ctx()
                        .input(|input| input.pointer.press_origin())
                        .or_else(|| response.interact_pointer_pos());
                    let edit_started = self.edit_enabled
                        && edit_start_pos
                            .is_some_and(|pos| self.begin_edit_drag_at_pointer(pos, world, canvas));
                    Some(if edit_started {
                        CanvasDragMode::Edit
                    } else {
                        CanvasDragMode::Pan
                    })
                }
            } else {
                None
            };
            if let Some(mode) = mode {
                self.pan_drag.start(mode);
            }
        }
        if response.dragged() && !pointer_over_heatmap && self.pan_drag.mode().is_some() {
            let frame_delta = response.drag_delta();
            match self.pan_drag.mode() {
                Some(CanvasDragMode::Edit) if self.draft.is_some() => {
                    let total_delta = self.pan_drag.accumulate(frame_delta);
                    self.update_edit_drag(total_delta, world, canvas);
                    ui.ctx().request_repaint();
                }
                Some(CanvasDragMode::Pan) => {
                    self.pan = self.pan_drag.apply_pan_frame(self.pan, frame_delta);
                    ui.ctx().request_repaint();
                }
                _ => {}
            }
        }
        if response.drag_stopped() {
            if self.pan_drag.mode() == Some(CanvasDragMode::Edit) && self.draft.is_some() {
                self.commit_draft();
            }
            self.pan_drag.reset();
        }

        let interaction_point = response
            .interact_pointer_pos()
            .filter(|pos| canvas.contains(*pos) && !pointer_over_heatmap)
            .map(|pos| screen_to_world_point(pos, world, canvas, self.zoom, self.pan));
        let ruler_pointer = interaction_point.or(hover_world_point);
        let ruler_snap = ruler_pointer.and_then(|pointer| {
            self.ruler_edge_snap(pointer, world, canvas, &query_layer_ids, use_view_tiles)
        });
        let ruler_start_requested = ui.ctx().input(|input| {
            ruler_start_requested(input, self.ruler_tool.enabled, pointer_over_layout)
        });
        if ruler_start_requested {
            if self.ruler_tool.active {
                self.ruler_tool.finish();
            } else if let Some(point) = interaction_point {
                self.ruler_tool.start(point);
            }
        }
        let drc_double_clicked =
            !self.ruler_tool.enabled && response.double_clicked_by(egui::PointerButton::Primary);
        if drc_double_clicked && pointer_over_layout {
            self.selected_drc = response
                .interact_pointer_pos()
                .and_then(|pos| self.pick_drc_violation_at(pos, world, canvas, viewport));
        }
        if response.clicked_by(egui::PointerButton::Primary)
            && !drc_double_clicked
            && pointer_over_layout
        {
            if self.ruler_tool.enabled {
                if let Some(point) = ruler_snap.or(interaction_point) {
                    self.ruler_tool.commit(point);
                }
            } else {
                self.selected = response
                    .interact_pointer_pos()
                    .and_then(|pos| self.pick_shape_at(pos, world, canvas, &query_layer_ids));
            }
        }
        if self.ruler_tool.enabled && pointer_over_layout {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
        } else {
            if let Some(cursor_icon) = canvas_cursor_icon(
                pointer_over_layout,
                self.pan_drag.mode() == Some(CanvasDragMode::Pan)
                    && (response.drag_started() || response.dragged()),
            ) {
                ui.ctx().set_cursor_icon(cursor_icon);
            }
        }
        let mut drawn = 0usize;
        let use_view_tiles = self.should_use_view_tiles(viewport, world);
        let view_lod = self.view_lod_level();
        let hover_nearest = if use_view_tiles {
            None
        } else {
            hover_world_point.and_then(|point| {
                let radius = hover_nearest_radius_dbu(world, canvas, self.zoom);
                self.db
                    .nearest_shape(&query_layer_ids, point, Some(radius))
                    .filter(|nearest| {
                        self.db.find_shape(nearest.shape_id).is_some_and(|shape| {
                            self.shape_is_visible(shape)
                                && self.shape_is_drawn_at_current_zoom(shape)
                        })
                    })
            })
        };
        let overlay_shape_ids = overlay_shape_ids(self.selected, &self.highlighted);
        self.label_collector.clear();

        let is_interacting = (response.dragged()
            || response.drag_started()
            || (ui.ctx().input(|i| i.zoom_delta()) - 1.0).abs() > 1e-5
            || self.focus_animation.is_some())
            && !pointer_over_heatmap;

        if use_view_tiles {
            for (layer_id, style) in &visible_layers {
                for tile in self
                    .view_tile_cache
                    .visible_tiles(&self.db, view_lod, *layer_id, viewport)
                {
                    let screen =
                        world_to_screen_rect(tile.bbox, world, canvas, self.zoom, self.pan);
                    if !screen.is_positive() || !screen.intersects(canvas) {
                        continue;
                    }
                    let color = overview_tile_color(*style, tile.shape_count);
                    painter.rect_filled(screen, 0.0, color);
                    drawn += 1;
                }
            }
        } else {
            let visibility_hash = layers_visibility_hash(&self.layers);
            if self.visibility_rules_cache.epoch != self.geometry_epoch
                || self.visibility_rules_cache.layer_visibility_hash != visibility_hash
            {
                self.visibility_rules_cache = VisibilityRulesCache {
                    epoch: self.geometry_epoch,
                    layer_visibility_hash: visibility_hash,
                    layer_index: LayerRenderIndex::new(&self.layers),
                    zoom_rules: ZoomVisibilityRules::new(&self.db),
                };
            }
            let layer_index = &self.visibility_rules_cache.layer_index;
            let zoom_rules = &self.visibility_rules_cache.zoom_rules;
            let mut visible_ids = Vec::new();
            if !self.gpu_canvas.enabled || self.gpu_canvas.failed {
                let query_start = Instant::now();
                visible_ids = self.render_cache.visible_shape_ids_for_layers(
                    &self.db,
                    &query_layer_ids,
                    viewport,
                );
                query_duration += query_start.elapsed();
            }

            self.paint_gpu_heatmap_overlay(ui, canvas, world);

            if self.gpu_canvas.enabled && !self.gpu_canvas.failed {
                let gpu_start = Instant::now();

                self.gpu_tile_instances.retain(|key, _| {
                    key.geometry_epoch == self.geometry_epoch
                        && key.layer_visibility_hash
                            == self.visibility_rules_cache.layer_visibility_hash
                        && key.object_visibility_bits == self.object_visibility.bits()
                });

                let gpu_scale = world_to_screen_scale(world, canvas, self.zoom);
                let world_cx = (world.lx + world.hx) as f32 * 0.5;
                let world_cy = (world.ly + world.hy) as f32 * 0.5;
                let _gpu_canvas_center = canvas.center() + self.pan;

                let uniform = crate::canvas_gpu::CanvasUniform {
                    world_center_dbu: [world_cx, world_cy],
                    canvas_center_px: [
                        canvas.width() * 0.5 + self.pan.x,
                        canvas.height() * 0.5 + self.pan.y,
                    ],
                    scale_px_per_dbu: gpu_scale,
                    pixels_per_point: ui.ctx().pixels_per_point(),
                    pattern_min_size_px: crate::canvas_gpu::PATTERN_MIN_SIZE_PX,
                    min_shape_screen_size: crate::canvas_gpu::MIN_SHAPE_SCREEN_SIZE,
                    screen_size_px: [canvas.width(), canvas.height()],
                    is_interacting: if is_interacting { 1.0 } else { 0.0 },
                    global_alpha: 1.0,
                };

                let tiles = crate::canvas_gpu::tile_coords_for_bbox(
                    viewport,
                    crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                );

                if self.gpu_tile_instances.len() > crate::canvas_gpu::MAX_CACHED_TILE_BUFFERS {
                    let vx = (viewport.lx as i64 + viewport.hx as i64) / 2;
                    let vy = (viewport.ly as i64 + viewport.hy as i64) / 2;
                    let ts = crate::canvas_gpu::GPU_TILE_SIZE_DBU as i64;

                    let mut cached_keys: Vec<_> = self.gpu_tile_instances.keys().copied().collect();
                    cached_keys.sort_by_key(|k| {
                        let tx = k.tile_x as i64 * ts + ts / 2;
                        let ty = k.tile_y as i64 * ts + ts / 2;
                        let dx = tx - vx;
                        let dy = ty - vy;
                        dx * dx + dy * dy
                    });

                    // Evict down to 96 (3/4 of max) to avoid thrashing every frame
                    let retain_count = crate::canvas_gpu::MAX_CACHED_TILE_BUFFERS * 3 / 4;
                    if cached_keys.len() > retain_count {
                        for key in &cached_keys[retain_count..] {
                            self.gpu_tile_instances.remove(key);
                        }
                    }
                }

                for (tx, ty) in tiles {
                    let tile_bbox = Rect32 {
                        lx: tx * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                        ly: ty * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                        hx: (tx + 1) * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                        hy: (ty + 1) * crate::canvas_gpu::GPU_TILE_SIZE_DBU,
                    };
                    let buffer_key = crate::canvas_gpu::GpuBufferKey {
                        geometry_epoch: self.geometry_epoch,
                        tile_x: tx,
                        tile_y: ty,
                        zoom_tier: crate::canvas_gpu::GpuBufferKey::zoom_tier(self.zoom),
                        layer_visibility_hash: self.visibility_rules_cache.layer_visibility_hash,
                        object_visibility_bits: self.object_visibility.bits(),
                    };

                    let tile_instances = if let Some(cached) =
                        self.gpu_tile_instances.get(&buffer_key)
                    {
                        std::sync::Arc::clone(cached)
                    } else {
                        let query_start_tile = collect_stats.then(Instant::now);
                        let tile_visible_ids = self.render_cache.visible_shape_ids_for_layers(
                            &self.db,
                            &query_layer_ids,
                            tile_bbox,
                        );
                        if let Some(start) = query_start_tile {
                            query_duration += start.elapsed();
                        }

                        // Reuse persistent scratch buffers — no heap allocation per tile.
                        self.frame_valid_shapes.clear();
                        self.frame_valid_labels.clear();
                        for &shape_id in &tile_visible_ids {
                            let filter_start = collect_stats.then(Instant::now);
                            let Some(shape) = self.db.find_shape(shape_id) else {
                                if let Some(start) = filter_start {
                                    filter_duration += start.elapsed();
                                }
                                continue;
                            };
                            if !is_renderable_shape(shape) {
                                if let Some(start) = filter_start {
                                    filter_duration += start.elapsed();
                                }
                                continue;
                            }
                            let owner = self.db.owner_for_shape(shape);
                            let owner_type =
                                owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
                            if !zoom_rules.is_drawn_at_zoom(owner_type, self.zoom) {
                                if let Some(start) = filter_start {
                                    filter_duration += start.elapsed();
                                }
                                continue;
                            }
                            let owner_category = owner.and_then(|owner| {
                                self.owner_category_cache
                                    .get(self.geometry_epoch, &self.db, owner)
                            });
                            if !shape_is_visible_fast(
                                shape,
                                owner_type,
                                owner_category,
                                &layer_index,
                                &self.object_visibility,
                            ) {
                                if let Some(start) = filter_start {
                                    filter_duration += start.elapsed();
                                }
                                continue;
                            }
                            let Some(style) = visible_style_for_shape_fast(
                                shape,
                                owner,
                                owner_type,
                                &layer_index,
                            ) else {
                                if let Some(start) = filter_start {
                                    filter_duration += start.elapsed();
                                }
                                continue;
                            };
                            let geometry = self.db.shape_geometry(shape);
                            if let Some(start) = filter_start {
                                filter_duration += start.elapsed();
                            }

                            if let Some(label_info) = shape_label_info(
                                &geometry,
                                owner,
                                owner.and_then(|owner| self.db.owner_name(owner)),
                            ) {
                                self.frame_valid_labels.push(label_info);
                            }

                            self.frame_valid_shapes.push((geometry, style));
                        }

                        let gpu_instances = crate::canvas_gpu::build_gpu_instances(
                            self.frame_valid_shapes.drain(..),
                        );
                        let built = std::sync::Arc::new(GpuTileData {
                            instances: std::sync::Arc::new(gpu_instances),
                            labels: std::mem::take(&mut self.frame_valid_labels),
                        });
                        self.gpu_tile_instances
                            .insert(buffer_key, std::sync::Arc::clone(&built));
                        built
                    };

                    if !is_interacting {
                        for label in &tile_instances.labels {
                            let screen_rect =
                                shape_screen_rect(label.rect, world, canvas, self.zoom, self.pan);
                            let visible_rect = screen_rect.intersect(canvas);
                            if screen_rect.is_positive()
                                && visible_rect.is_positive()
                                && visible_rect.width() >= 12.0
                                && visible_rect.height() >= 8.0
                            {
                                self.label_collector.insert(ShapeLabelOverlay {
                                    key: label.key.clone(),
                                    rect: screen_rect,
                                    text: label.text.clone(),
                                    kind: label.kind,
                                    rank_area: visible_rect.width() * visible_rect.height(),
                                });
                            }
                        }
                    }

                    drawn += tile_instances.instances.len();

                    let callback = crate::canvas_gpu::CanvasGpuCallback {
                        uniform,
                        instances: std::sync::Arc::clone(&tile_instances.instances),
                        buffer_key,
                        frame_counter: self.gpu_frame_counter,
                        target_format: self.gpu_canvas.target_format,
                    };

                    ui.painter()
                        .add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
                }

                paint_duration += gpu_start.elapsed();
            } else {
                for shape_id in visible_ids {
                    let filter_start = collect_stats.then(Instant::now);
                    let Some(shape) = self.db.find_shape(shape_id) else {
                        if let Some(start) = filter_start {
                            filter_duration += start.elapsed();
                        }
                        continue;
                    };
                    if !is_renderable_shape(shape) {
                        if let Some(start) = filter_start {
                            filter_duration += start.elapsed();
                        }
                        continue;
                    }

                    let owner = self.db.owner_for_shape(shape);
                    let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));

                    if !zoom_rules.is_drawn_at_zoom(owner_type, self.zoom) {
                        if let Some(start) = filter_start {
                            filter_duration += start.elapsed();
                        }
                        continue;
                    }

                    let owner_category = owner.and_then(|owner| {
                        self.owner_category_cache
                            .get(self.geometry_epoch, &self.db, owner)
                    });
                    if !shape_is_visible_fast(
                        shape,
                        owner_type,
                        owner_category,
                        &layer_index,
                        &self.object_visibility,
                    ) {
                        if let Some(start) = filter_start {
                            filter_duration += start.elapsed();
                        }
                        continue;
                    }

                    let Some(style) =
                        visible_style_for_shape_fast(shape, owner, owner_type, &layer_index)
                    else {
                        if let Some(start) = filter_start {
                            filter_duration += start.elapsed();
                        }
                        continue;
                    };
                    let geometry = self.db.shape_geometry(shape);
                    if let Some(start) = filter_start {
                        filter_duration += start.elapsed();
                    }

                    let paint_start = Instant::now();
                    let prim_count = paint_styled_shape_geometry(
                        &painter, geometry, world, canvas, self.zoom, self.pan, &style,
                    );
                    paint_duration += paint_start.elapsed();

                    if prim_count > 0 {
                        drawn += 1;
                        estimated_primitives += prim_count;
                        if !is_interacting {
                            if let Some(label) = shape_label_overlay(
                                geometry,
                                owner,
                                owner.and_then(|owner| self.db.owner_name(owner)),
                                world,
                                canvas,
                                self.zoom,
                                self.pan,
                            ) {
                                self.label_collector.insert(label);
                            }
                        }
                    }
                }
            }
        }
        drawn += paint_parameterized_grid_overlay(
            &painter,
            self.db.grid_metadata(),
            &self.layers,
            self.object_visibility,
            viewport,
            self.grid_bounds.unwrap_or(world),
            world,
            canvas,
            self.zoom,
            self.pan,
        );
        drawn += paint_unrouted_net_guides(
            &painter,
            self.db.unrouted_net_guides(),
            self.object_visibility,
            viewport,
            world,
            canvas,
            self.zoom,
            self.pan,
        );

        let mut label_paint_duration = Duration::ZERO;
        if !is_interacting {
            let label_paint_start = collect_stats.then(Instant::now);
            for overlay in self.label_collector.binned_overlays() {
                paint_shape_label_overlay(&painter, overlay, canvas);
            }
            if let Some(start) = label_paint_start {
                label_paint_duration = start.elapsed();
            }
        }

        let hidden_drc_layer_names: std::collections::HashSet<String> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.to_ascii_lowercase())
            .collect();

        let visible_drc_types: std::collections::HashSet<&str> = self
            .drc_overlay
            .as_ref()
            .map(|o| {
                o.type_states
                    .iter()
                    .filter(|s| s.visible)
                    .map(|s| s.name.as_str())
                    .collect()
            })
            .unwrap_or_default();

        let visible_antenna_types: std::collections::HashSet<&str> = self
            .antenna_overlay
            .as_ref()
            .map(|o| {
                o.type_states
                    .iter()
                    .filter(|s| s.visible)
                    .map(|s| s.name.as_str())
                    .collect()
            })
            .unwrap_or_default();

        let viewport_aabb =
            rstar::AABB::from_corners([viewport.lx, viewport.ly], [viewport.hx, viewport.hy]);

        if let Some(overlay) = &self.drc_overlay {
            for node in overlay.rtree.locate_in_envelope_intersecting(viewport_aabb) {
                let violation = &overlay.violations[node.index];
                if !hidden_drc_layer_names.contains(&violation.layer)
                    && visible_drc_types.contains(violation.drc_type.as_str())
                {
                    visible_drc_count += 1;
                    if paint_drc_violation_overlay(
                        &painter,
                        violation,
                        world,
                        canvas,
                        self.zoom,
                        self.pan,
                        self.selected_drc == Some(violation.id),
                    ) {
                        drawn += 1;
                    }
                }
            }
        }

        if let Some(overlay) = &self.antenna_overlay {
            for node in overlay.rtree.locate_in_envelope_intersecting(viewport_aabb) {
                let violation = &overlay.violations[node.index];
                if !hidden_drc_layer_names.contains(&violation.layer)
                    && visible_antenna_types.contains(violation.antenna_type.as_str())
                {
                    visible_antenna_count += 1;
                    if paint_antenna_violation_overlay(
                        &painter,
                        violation,
                        world,
                        canvas,
                        self.zoom,
                        self.pan,
                        self.selected_antenna == Some(violation.id),
                    ) {
                        drawn += 1;
                    }
                }
            }
        }

        if self.analysis_tab == AnalysisTab::Map {
            if let Some(bbox) = self.selected_map_bbox {
                paint_map_selection_overlay(&painter, bbox, world, canvas, self.zoom, self.pan);
            }
        }

        for shape_id in &overlay_shape_ids {
            let Some(shape) = self.db.find_shape(*shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) {
                continue;
            }
            if !self.shape_is_visible(shape) {
                continue;
            }
            if !self.shape_is_drawn_at_current_zoom(shape) {
                continue;
            }
            let geometry = self.db.shape_geometry(shape);
            if self.highlighted.contains(shape_id) {
                paint_search_highlight_overlay(
                    &painter, geometry, world, canvas, self.zoom, self.pan,
                );
            }
            if self.selected == Some(*shape_id) {
                paint_shape_overlay(
                    &painter,
                    geometry,
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                    egui::Stroke::new(2.0_f32, ecos_accent()),
                );
            }
        }

        if let Some(draft) = &self.draft {
            let screen =
                world_to_screen_rect(draft.requested_bbox, world, canvas, self.zoom, self.pan);
            painter.rect_stroke(
                screen.expand(2.0),
                0.0,
                egui::Stroke::new(2.0_f32, ecos_accent()),
                egui::StrokeKind::Inside,
            );
        }

        paint_scale_ruler(
            &painter,
            world,
            canvas,
            self.zoom,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        );

        let ruler_preview = ruler_snap
            .or(hover_world_point)
            .and_then(|point| self.ruler_tool.preview(point));
        paint_orthogonal_ruler(
            &painter,
            &self.ruler_tool.points,
            ruler_preview,
            ruler_snap,
            world,
            canvas,
            self.zoom,
            self.pan,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        );

        self.status_line_buffer.clear();
        canvas_status_line_into(
            &mut self.status_line_buffer,
            drawn,
            overlay_shape_ids.len(),
            use_view_tiles,
            view_lod,
            self.zoom,
            viewport,
        );
        painter.text(
            canvas.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            self.status_line_buffer.as_str(),
            egui::FontId::proportional(13.0),
            ecos_text_secondary(),
        );

        if env_flag_requested(std::env::var(RENDER_STATS_ENV).ok().as_deref()) {
            let stats = CanvasRenderStats {
                frame_time_ms: canvas_start.elapsed().as_secs_f32() * 1000.0,
                query_time_ms: query_duration.as_secs_f32() * 1000.0,
                filter_time_ms: filter_duration.as_secs_f32() * 1000.0,
                paint_time_ms: paint_duration.as_secs_f32() * 1000.0,
                label_paint_time_ms: label_paint_duration.as_secs_f32() * 1000.0,
                drawn_shapes: drawn,
                estimated_primitives,
                label_count: self.label_collector.len(),
                use_view_tiles,
                zoom: self.zoom,
                lod: view_lod,
                visible_drc_count,
                visible_antenna_count,
                is_gpu: self.gpu_canvas.enabled && !self.gpu_canvas.failed,
            };
            paint_render_stats_overlay(&painter, canvas, &stats);
        }

        if let Some(point) = hover_world_point {
            self.status_line_buffer.clear();
            hover_status_line_into(
                &mut self.status_line_buffer,
                point,
                self.coordinate_unit,
                self.db.snapshot().manifest().dbu_per_micron,
                hover_nearest,
            );
            if self.analysis_tab == AnalysisTab::Map {
                if let Some(heatmap) = &self.active_heatmap {
                    if let Some((row, col)) = heatmap.data.cell_at_world_point(point) {
                        if let Some(val) = heatmap.data.value(row, col) {
                            let _ = std::fmt::Write::write_fmt(
                                &mut self.status_line_buffer,
                                format_args!(
                                    " | Heatmap: {} (Row {row}, Col {col})",
                                    format_map_value(val)
                                ),
                            );
                        }
                    }
                }
            }
            painter.text(
                canvas.left_top() + egui::vec2(10.0, 28.0),
                egui::Align2::LEFT_TOP,
                self.status_line_buffer.as_str(),
                egui::FontId::monospace(12.0),
                ecos_text_secondary(),
            );
        }
        if let Some(status) = ruler_status_line(
            &self.ruler_tool.points,
            ruler_preview,
            self.ruler_tool.active,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        ) {
            painter.text(
                canvas.left_top() + egui::vec2(10.0, 46.0),
                egui::Align2::LEFT_TOP,
                status,
                egui::FontId::monospace(12.0),
                ecos_info_text(),
            );
        }
        paint_coordinate_rulers(
            &ruler_painter,
            frame,
            canvas,
            world,
            self.zoom,
            self.pan,
            self.coordinate_unit,
            self.db.snapshot().manifest().dbu_per_micron,
        );
        self.canvas_info_overlay(ui, canvas);
        self.drc_detail_overlay(ui, canvas);
        self.antenna_detail_overlay(ui, canvas);
        self.map_heatmap_overlay(ui, canvas);
    }

    fn map_heatmap_popup_rect(&self, canvas: egui::Rect) -> Option<egui::Rect> {
        if self.analysis_tab != AnalysisTab::Map {
            return None;
        }
        let heatmap = self.active_heatmap.as_ref()?;
        let (popup_size, _) =
            map_heatmap_layout(canvas, heatmap.data.rows(), heatmap.data.columns());
        let min = egui::pos2(
            (canvas.right() - popup_size.x - 12.0).max(canvas.left() + 12.0),
            (canvas.bottom() - popup_size.y - 12.0).max(canvas.top() + 12.0),
        );
        Some(egui::Rect::from_min_size(min, popup_size))
    }

    fn map_heatmap_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(popup_rect) = self.map_heatmap_popup_rect(canvas) else {
            return;
        };
        let Some(heatmap) = self.active_heatmap.as_ref() else {
            return;
        };
        let title = heatmap.title.clone();
        let rows = heatmap.data.rows();
        let columns = heatmap.data.columns();
        let selected_cell = heatmap.selected_cell;
        let (_, grid_size) = map_heatmap_layout(canvas, rows, columns);
        let mut close_requested = false;
        let mut focus_peak_requested = false;
        let mut clicked_cell = None;
        let mut updated_threshold = None;
        let mut updated_invert = None;
        let ctx = ui.ctx().clone();

        egui::Area::new(egui::Id::new("chip_viewer_map_heatmap_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_rect.min)
            .show(&ctx, |ui| {
                ui.set_width(popup_rect.width());
                egui::Frame::NONE
                    .fill(egui::Color32::from_rgb(29, 30, 34))
                    .stroke(egui::Stroke::new(1.0_f32, ecos_accent()))
                    .corner_radius(8)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(popup_rect.size() - egui::vec2(20.0, 20.0));
                        ui.horizontal(|ui| {
                            ui.add(
                                egui::Label::new(
                                    egui::RichText::new(&title)
                                        .strong()
                                        .size(13.0)
                                        .color(ecos_text_primary()),
                                )
                                .truncate(),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui
                                        .small_button("×")
                                        .on_hover_text("Close heatmap")
                                        .clicked()
                                    {
                                        close_requested = true;
                                    }
                                },
                            );
                        });
                        ui.label(
                            egui::RichText::new(format!("{rows} rows × {columns} columns"))
                                .small()
                                .color(ecos_text_secondary()),
                        );
                        ui.add_space(2.0);

                        ui.horizontal(|ui| {
                            let side_padding =
                                ((ui.available_width() - grid_size.x) * 0.5).max(0.0);
                            ui.add_space(side_padding);
                            let (grid_rect, response) =
                                ui.allocate_exact_size(grid_size, egui::Sense::click());
                            let painter = ui.painter_at(grid_rect);
                            paint_heatmap_grid(
                                &painter,
                                grid_rect,
                                &heatmap.data,
                                selected_cell,
                                heatmap.colormap_mode,
                                heatmap.threshold,
                                heatmap.invert_threshold,
                            );
                            let hovered_cell = response.hover_pos().and_then(|pos| {
                                interactive_heatmap_cell_at(pos, grid_rect, &heatmap.data)
                            });
                            if let Some((row, column)) = hovered_cell {
                                paint_heatmap_cell_outline(
                                    &painter,
                                    grid_rect,
                                    rows,
                                    columns,
                                    row,
                                    column,
                                    egui::Stroke::new(1.5_f32, egui::Color32::WHITE),
                                );
                                if let Some(value) = heatmap.data.value(row, column) {
                                    response.clone().on_hover_text(format!(
                                        "row {row}, column {column}\nvalue {}",
                                        format_map_value(value)
                                    ));
                                }
                            }
                            if response.clicked() {
                                clicked_cell = hovered_cell;
                            }
                        });

                        if let Some((row, column)) = selected_cell {
                            let detail = heatmap.data.value(row, column).map_or_else(
                                || format!("row {row} · column {column}"),
                                |value| {
                                    format!(
                                        "row {row} · column {column} · {}",
                                        format_map_value(value)
                                    )
                                },
                            );
                            ui.label(
                                egui::RichText::new(detail)
                                    .monospace()
                                    .size(11.0)
                                    .color(ecos_info_text()),
                            );
                        } else {
                            ui.label(
                                egui::RichText::new("Select a cell to focus the layout")
                                    .size(11.0)
                                    .color(ecos_text_secondary()),
                            );
                        }
                        let mut new_threshold = heatmap.threshold;
                        let mut new_invert = heatmap.invert_threshold;
                        let (thresh_chg, inv_chg, peak_req) = paint_heatmap_legend(
                            ui,
                            heatmap.data.min(),
                            heatmap.data.max(),
                            heatmap.colormap_mode,
                            &mut new_threshold,
                            &mut new_invert,
                        );
                        if thresh_chg {
                            updated_threshold = Some(new_threshold);
                        }
                        if inv_chg {
                            updated_invert = Some(new_invert);
                        }
                        if peak_req {
                            focus_peak_requested = true;
                        }
                    });
            });

        if let Some(threshold) = updated_threshold {
            if let Some(heatmap) = self.active_heatmap.as_mut() {
                heatmap.set_threshold(threshold);
            }
        }
        if let Some(invert) = updated_invert {
            if let Some(heatmap) = self.active_heatmap.as_mut() {
                heatmap.set_invert_threshold(invert);
            }
        }
        if focus_peak_requested {
            if let Some(heatmap) = self.active_heatmap.as_ref() {
                clicked_cell = heatmap
                    .data
                    .next_peak_cell(heatmap.selected_cell, heatmap.invert_threshold);
            }
        }

        if close_requested {
            self.active_heatmap = None;
            self.selected_map_bbox = None;
            return;
        }
        let Some((row, column)) = clicked_cell else {
            return;
        };
        let bbox = self
            .active_heatmap
            .as_ref()
            .and_then(|heatmap| heatmap.data.bbox(row, column));
        if let Some(heatmap) = self.active_heatmap.as_mut() {
            heatmap.selected_cell = Some((row, column));
        }
        if let Some(bbox) = bbox {
            self.selected_map_bbox = Some(bbox);
            self.pending_focus = Some(PendingFocus {
                bbox: contextual_map_focus_bbox(bbox),
                select_shape_id: None,
                transition: FocusTransition::Animated,
            });
            self.selected = None;
            self.pan_drag.reset();
            ui.ctx().request_repaint();
        } else {
            self.map_item_error = Some(format!(
                "layout.csv has no coordinate mapping for row {row}, column {column}"
            ));
        }
    }

    fn canvas_info_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(panel) = self.sidebar_info_panel else {
            return;
        };

        let ctx = ui.ctx().clone();
        let popup_width = (canvas.width() * 0.32)
            .clamp(320.0, 430.0)
            .min((canvas.width() - 24.0).max(180.0));
        let popup_height = (canvas.height() * 0.34)
            .clamp(220.0, 310.0)
            .min((canvas.height() - 24.0).max(160.0));
        let popup_y = if self.analysis_tab == AnalysisTab::Map && self.active_heatmap.is_some() {
            canvas.top() + 12.0
        } else {
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0)
        };
        let popup_pos = egui::pos2(
            (canvas.right() - popup_width - 12.0).max(canvas.left() + 12.0),
            popup_y,
        );

        egui::Area::new(egui::Id::new("chip_viewer_canvas_info_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
                    .corner_radius(12)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(egui::vec2(popup_width - 20.0, popup_height - 20.0));
                        ui.horizontal(|ui| {
                            section_heading(ui, panel.label());
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui.small_button("×").on_hover_text("Hide panel").clicked() {
                                        self.sidebar_info_panel = None;
                                    }
                                },
                            );
                        });
                        egui::ScrollArea::vertical()
                            .id_salt("chip_viewer_canvas_info_popup_scroll")
                            .max_height(popup_height - 56.0)
                            .auto_shrink([false, false])
                            .show(ui, |ui| match panel {
                                SidebarInfoPanel::Selection => self.selection_panel(ui),
                                SidebarInfoPanel::Diagnostics => self.diagnostics_panel(ui),
                            });
                    });
            });
    }

    fn canvas_3d(
        &mut self,
        ui: &mut egui::Ui,
        response: &egui::Response,
        canvas: egui::Rect,
        painter: &egui::Painter,
        pointer_over_layout: bool,
        pointer_over_heatmap: bool,
        drag_started_in_canvas: bool,
        world: Rect32,
    ) {
        if !self.gpu_canvas.enabled || self.gpu_canvas.failed {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "3D view requires GPU acceleration.\nRunning in CPU fallback mode — switch to 2D view.",
                egui::FontId::proportional(14.0),
                ecos_text_secondary(),
            );
            return;
        }

        self.ensure_3d_view(world, canvas);

        let dt = ui.input(|i| i.stable_dt);
        let animating_3d = self.camera_ctrl_3d.update(dt);
        if animating_3d {
            ui.ctx().request_repaint();
        }

        let current_camera = self.camera_ctrl_3d.current;

        if let Some(focus) = self.pending_focus.take() {
            let span = ((focus.bbox.hx - focus.bbox.lx).max(focus.bbox.hy - focus.bbox.ly) as f32)
                .max(1.0);
            self.camera_ctrl_3d.focus_xy(
                (focus.bbox.lx + focus.bbox.hx) as f32 * 0.5,
                (focus.bbox.ly + focus.bbox.hy) as f32 * 0.5,
                span,
                self.layer_stack.height(),
            );
            self.selected = focus.select_shape_id;
            self.pan_drag.reset();
        }

        let pointer_over_zoom_target = !pointer_over_heatmap
            && ui.ctx().input(|input| {
                input
                    .pointer
                    .hover_pos()
                    .is_some_and(|pos| canvas.contains(pos) || response.rect.contains(pos))
            });
        if pointer_over_zoom_target {
            let (scroll_y, pinch_zoom) = ui.ctx().input(|input| {
                let scroll_y = if input.raw_scroll_delta.y.abs() > f32::EPSILON {
                    input.raw_scroll_delta.y
                } else {
                    input.smooth_scroll_delta.y
                };
                (scroll_y, input.zoom_delta())
            });
            if scroll_y.abs() > f32::EPSILON || (pinch_zoom - 1.0).abs() > f32::EPSILON {
                let pivot = ui
                    .ctx()
                    .input(|input| input.pointer.hover_pos())
                    .and_then(|pos| {
                        current_camera.cursor_pivot(
                            [pos.x, pos.y],
                            [canvas.left(), canvas.top()],
                            [canvas.width(), canvas.height()],
                            world,
                            self.layer_stack.height(),
                        )
                    });
                let steps = if scroll_y.abs() > f32::EPSILON {
                    scroll_y / 50.0
                } else {
                    (pinch_zoom - 1.0) * 10.0
                };
                let fine = ui.input(|i| i.modifiers.ctrl || i.modifiers.command);
                self.camera_ctrl_3d.dolly_steps(steps, pivot, fine);
                ui.ctx().input_mut(|input| {
                    input.raw_scroll_delta.y = 0.0;
                    input.smooth_scroll_delta.y = 0.0;
                });
                self.pan_drag.reset();
                ui.ctx().request_repaint();
            }
        }

        let modifier_scale = if ui.input(|i| i.modifiers.shift) {
            0.25
        } else if ui.input(|i| i.modifiers.ctrl || i.modifiers.command) {
            4.0
        } else {
            1.0
        };

        if response.drag_started() && drag_started_in_canvas && !pointer_over_heatmap {
            let mode = if response.drag_started_by(egui::PointerButton::Middle)
                || response.drag_started_by(egui::PointerButton::Secondary)
            {
                Some(CanvasDragMode::Pan)
            } else if response.drag_started_by(egui::PointerButton::Primary) {
                Some(CanvasDragMode::Edit)
            } else {
                None
            };
            if let Some(mode) = mode {
                self.camera_ctrl_3d.start_drag();
                self.pan_drag.start(mode);
            }
        }
        if response.dragged() && !pointer_over_heatmap {
            let delta = response.drag_delta();
            match self.pan_drag.mode() {
                Some(CanvasDragMode::Edit) => {
                    self.camera_ctrl_3d.orbit(delta.x, delta.y, modifier_scale);
                    ui.ctx().request_repaint();
                }
                Some(CanvasDragMode::Pan) => {
                    self.camera_ctrl_3d.pan(delta.x, delta.y, modifier_scale);
                    ui.ctx().request_repaint();
                }
                _ => {}
            }
        }
        if response.drag_stopped() {
            self.camera_ctrl_3d.stop_drag();
            self.pan_drag.reset();
        }

        if response.double_clicked_by(egui::PointerButton::Primary) && pointer_over_layout {
            if let Some(pos) = response.interact_pointer_pos() {
                if let Some(point) = self.hover_world_point_3d(pos, canvas) {
                    let span = (current_camera.distance * 0.35).max(100.0);
                    self.camera_ctrl_3d.focus_xy(
                        point.x as f32,
                        point.y as f32,
                        span,
                        self.layer_stack.height(),
                    );
                    ui.ctx().request_repaint();
                }
            }
        }

        let query_layer_ids = render_query_layer_ids(&self.layers, self.object_visibility);
        if response.clicked_by(egui::PointerButton::Primary) && pointer_over_layout {
            self.selected = response
                .interact_pointer_pos()
                .and_then(|pos| self.pick_shape_at_3d(pos, canvas, world, &query_layer_ids));
        }

        if pointer_over_layout {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
        }

        let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
        let die_diag = crate::canvas_gpu3d::die_diagonal(world);
        let is_zoomed_out = current_camera.distance >= die_diag * 0.7;
        let ground_viewport =
            current_camera.visible_ground_rect(aspect, self.layer_stack.height(), world);
        let covers_majority = (ground_viewport.hx - ground_viewport.lx)
            >= (world.hx - world.lx) * 2 / 3
            || (ground_viewport.hy - ground_viewport.ly) >= (world.hy - world.ly) * 2 / 3;
        let stable_viewport = if is_zoomed_out || covers_majority {
            world
        } else {
            ground_viewport
        };

        let visibility_hash = layers_visibility_hash(&self.layers);
        let using_overview_tiles = false;
        let overview_lod = 0;
        let pixels_per_point = ui.ctx().pixels_per_point();

        // Base key for cached 3D instance buffer (state that invalidates the whole cache)
        let base_key = {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            self.geometry_epoch.hash(&mut hasher);
            visibility_hash.hash(&mut hasher);
            self.color_theme.hash(&mut hasher);
            self.layer_stack.height().to_bits().hash(&mut hasher);
            self.object_visibility.bits().hash(&mut hasher);
            using_overview_tiles.hash(&mut hasher);
            overview_lod.hash(&mut hasher);
            self.selected.hash(&mut hasher);
            self.highlighted.len().hash(&mut hasher);
            for id in &self.highlighted {
                id.hash(&mut hasher);
            }
            hasher.finish()
        };

        let is_dragging = self.pan_drag.mode().is_some() || animating_3d;

        let instances = if let Some((cached_key, cached_envelope, cached_instances)) =
            &self.gpu_3d_instances_cache
        {
            let is_contained = using_overview_tiles
                || (cached_envelope.lx == world.lx
                    && cached_envelope.ly == world.ly
                    && cached_envelope.hx == world.hx
                    && cached_envelope.hy == world.hy
                    && (is_zoomed_out || covers_majority))
                || (cached_envelope.lx <= stable_viewport.lx
                    && cached_envelope.ly <= stable_viewport.ly
                    && cached_envelope.hx >= stable_viewport.hx
                    && cached_envelope.hy >= stable_viewport.hy);

            let needs_expansion = (is_zoomed_out || covers_majority) && *cached_envelope != world;
            if *cached_key == base_key && is_contained && (!needs_expansion || is_dragging) {
                cached_instances.clone()
            } else {
                let vp_w = (stable_viewport.hx - stable_viewport.lx).max(1);
                let vp_h = (stable_viewport.hy - stable_viewport.ly).max(1);
                let pad_x = (vp_w as f32 * 0.80) as i32;
                let pad_y = (vp_h as f32 * 0.80) as i32;
                let envelope = if using_overview_tiles || is_zoomed_out || covers_majority {
                    world
                } else {
                    Rect32 {
                        lx: (stable_viewport.lx - pad_x).max(world.lx),
                        ly: (stable_viewport.ly - pad_y).max(world.ly),
                        hx: (stable_viewport.hx + pad_x).min(world.hx),
                        hy: (stable_viewport.hy + pad_y).min(world.hy),
                    }
                };

                let new_instances = std::sync::Arc::new(self.build_3d_instances(
                    world,
                    envelope,
                    &query_layer_ids,
                    using_overview_tiles,
                ));
                self.gpu_3d_instances_cache = Some((base_key, envelope, new_instances.clone()));
                new_instances
            }
        } else {
            let vp_w = (stable_viewport.hx - stable_viewport.lx).max(1);
            let vp_h = (stable_viewport.hy - stable_viewport.ly).max(1);
            let pad_x = (vp_w as f32 * 0.80) as i32;
            let pad_y = (vp_h as f32 * 0.80) as i32;
            let envelope = if using_overview_tiles || is_zoomed_out || covers_majority {
                world
            } else {
                Rect32 {
                    lx: (stable_viewport.lx - pad_x).max(world.lx),
                    ly: (stable_viewport.ly - pad_y).max(world.ly),
                    hx: (stable_viewport.hx + pad_x).min(world.hx),
                    hy: (stable_viewport.hy + pad_y).min(world.hy),
                }
            };

            let new_instances = std::sync::Arc::new(self.build_3d_instances(
                world,
                envelope,
                &query_layer_ids,
                using_overview_tiles,
            ));
            self.gpu_3d_instances_cache = Some((base_key, envelope, new_instances.clone()));
            new_instances
        };
        let drawn = instances.len();

        // Moving vs settled state tracking
        let is_camera_moving = animating_3d
            || self.pan_drag.mode().is_some()
            || self.perf_3d.last_camera.is_some_and(|last| {
                (last.yaw - current_camera.yaw).abs() > 1e-4
                    || (last.pitch - current_camera.pitch).abs() > 1e-4
                    || (last.distance - current_camera.distance).abs() > 1e-2
                    || (last.target.x - current_camera.target.x).abs() > 1e-2
                    || (last.target.y - current_camera.target.y).abs() > 1e-2
            });
        self.perf_3d.last_camera = Some(current_camera);

        if is_camera_moving {
            ui.ctx().request_repaint();
        }

        if !self.gpu_canvas.enabled || self.gpu_canvas.failed {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "3D view requires hardware acceleration or GPU canvas (running in CPU fallback mode)",
                egui::FontId::proportional(14.0),
                ecos_text_secondary(),
            );
        } else {
            let target_w = ((canvas.width() * pixels_per_point).round() as u32).max(1);
            let target_h = ((canvas.height() * pixels_per_point).round() as u32).max(1);
            let bg = self.color_theme.background_rgba();
            let z_cut_dbu = if self.z_cut_ratio_3d > 0.001 {
                (self.layer_stack.height() * (1.0 - self.z_cut_ratio_3d)).max(1.0)
            } else {
                1.0e9
            };
            let elapsed_time = self.start_time.elapsed().as_secs_f32();
            if is_camera_moving {
                ui.ctx().request_repaint();
            }
            let instances_key = {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                base_key.hash(&mut hasher);
                (instances.as_ptr() as usize).hash(&mut hasher);
                instances.len().hash(&mut hasher);
                hasher.finish()
            };
            let callback = crate::canvas_gpu3d::CanvasGpu3dCallback {
                uniform: crate::canvas_gpu3d::CanvasUniform3d::from_camera(
                    current_camera,
                    aspect,
                    bg,
                    self.show_3d_grid,
                    true,
                    z_cut_dbu,
                    self.shading_style_3d,
                    self.lighting_preset_3d,
                    elapsed_time,
                ),
                instances,
                instances_key,
                target_pixels: [target_w, target_h],
                target_format: self.gpu_canvas.target_format,
            };
            ui.painter()
                .add(egui_wgpu::Callback::new_paint_callback(canvas, callback));
        }

        self.status_line_buffer.clear();
        use std::fmt::Write as _;
        let _ = write!(
            self.status_line_buffer,
            "3D  {}/{} {}  yaw {:.0}°  pitch {:.0}°  z×{:.1}",
            drawn,
            crate::canvas_gpu3d::MAX_3D_INSTANCES,
            if using_overview_tiles {
                "tiles"
            } else {
                "shapes"
            },
            current_camera.yaw.to_degrees(),
            current_camera.pitch.to_degrees(),
            current_camera.z_scale
        );
        painter.text(
            canvas.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            self.status_line_buffer.as_str(),
            egui::FontId::proportional(13.0),
            ecos_text_secondary(),
        );

        if let Some(pos) = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .filter(|_| pointer_over_layout)
        {
            if let Some(point) = self.hover_world_point_3d(pos, canvas) {
                self.status_line_buffer.clear();
                hover_status_line_into(
                    &mut self.status_line_buffer,
                    point,
                    self.coordinate_unit,
                    self.db.snapshot().manifest().dbu_per_micron,
                    None,
                );
                painter.text(
                    canvas.left_top() + egui::vec2(10.0, 28.0),
                    egui::Align2::LEFT_TOP,
                    self.status_line_buffer.as_str(),
                    egui::FontId::monospace(12.0),
                    ecos_text_secondary(),
                );
            }
        }

        if let Some(start) = self.loading_3d_start {
            let elapsed = start.elapsed().as_secs_f32();
            const ANIM_DURATION: f32 = 0.70;
            if elapsed < ANIM_DURATION {
                ui.ctx().request_repaint();
                let alpha = if elapsed < 0.12 {
                    elapsed / 0.12
                } else if elapsed > 0.48 {
                    ((ANIM_DURATION - elapsed) / 0.22).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let pill_w = 236.0;
                let pill_h = 36.0;
                let center = egui::pos2(canvas.center().x, canvas.top() + 38.0);
                let pill_rect = egui::Rect::from_center_size(center, egui::vec2(pill_w, pill_h));

                let bg_color =
                    egui::Color32::from_rgba_unmultiplied(18, 22, 28, (235.0 * alpha) as u8);
                let stroke_color =
                    egui::Color32::from_rgba_unmultiplied(0, 180, 255, (220.0 * alpha) as u8);
                painter.rect_filled(pill_rect, 18.0_f32, bg_color);
                painter.rect_stroke(
                    pill_rect,
                    18.0_f32,
                    egui::Stroke::new(1.5_f32, stroke_color),
                    egui::StrokeKind::Inside,
                );

                let spinner_center = egui::pos2(pill_rect.left() + 22.0, pill_rect.center().y);
                let spin_angle = elapsed * 9.0;
                let radius = 7.5;
                let num_segments = 16;
                let points: Vec<egui::Pos2> = (0..=num_segments)
                    .map(|i| {
                        let a = spin_angle
                            + (i as f32 / num_segments as f32) * std::f32::consts::PI * 1.5;
                        egui::pos2(
                            spinner_center.x + radius * a.cos(),
                            spinner_center.y + radius * a.sin(),
                        )
                    })
                    .collect();
                painter.add(egui::Shape::line(
                    points,
                    egui::Stroke::new(
                        2.0_f32,
                        egui::Color32::from_rgba_unmultiplied(0, 220, 255, (255.0 * alpha) as u8),
                    ),
                ));

                let text_color =
                    egui::Color32::from_rgba_unmultiplied(240, 245, 255, (240.0 * alpha) as u8);
                painter.text(
                    egui::pos2(pill_rect.left() + 38.0, pill_rect.center().y),
                    egui::Align2::LEFT_CENTER,
                    "Pre-rendering Full 3D Stack...",
                    egui::FontId::proportional(13.0),
                    text_color,
                );
            } else {
                self.loading_3d_start = None;
            }
        }

        self.canvas_info_overlay(ui, canvas);
        self.drc_detail_overlay(ui, canvas);
        self.antenna_detail_overlay(ui, canvas);
        self.map_heatmap_overlay(ui, canvas);
        self.direction_cube_3d_overlay(ui, canvas, painter);
    }

    fn direction_cube_3d_overlay(
        &mut self,
        ui: &mut egui::Ui,
        canvas: egui::Rect,
        painter: &egui::Painter,
    ) {
        let center = egui::pos2(canvas.right() - 56.0, canvas.top() + 56.0);
        let radius = 22.0_f32;

        let yaw = self.camera_ctrl_3d.current.yaw;
        let pitch = self.camera_ctrl_3d.current.pitch;
        let cos_y = yaw.cos();
        let sin_y = yaw.sin();
        let cos_p = pitch.cos();
        let sin_p = pitch.sin();

        // Camera basis vectors
        let forward = [-cos_p * cos_y, -cos_p * sin_y, -sin_p];
        let right = [-sin_y, cos_y, 0.0];
        let up = [-sin_p * cos_y, -sin_p * sin_y, cos_p];

        let project = |v: [f32; 3]| -> (egui::Pos2, f32) {
            let dot_r = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
            let dot_u = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
            let dot_f = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2];
            (
                egui::pos2(center.x + radius * dot_r, center.y - radius * dot_u),
                -dot_f,
            )
        };

        // Draw backdrop circle
        painter.circle_filled(
            center,
            radius * 1.75,
            egui::Color32::from_rgba_unmultiplied(16, 20, 26, 180),
        );
        painter.circle_stroke(
            center,
            radius * 1.75,
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(60, 80, 110, 140)),
        );

        struct CubeFaceDef {
            normal: [f32; 3],
            label: &'static str,
            accent: egui::Color32,
            target_yaw: f32,
            target_pitch: f32,
            verts: [[f32; 3]; 4],
        }

        let faces = [
            CubeFaceDef {
                normal: [0.0, 0.0, 1.0],
                label: "TOP",
                accent: egui::Color32::from_rgb(0, 220, 255),
                target_yaw: -std::f32::consts::FRAC_PI_2,
                target_pitch: std::f32::consts::FRAC_PI_2 * 0.98,
                verts: [
                    [-1.0, -1.0, 1.0],
                    [1.0, -1.0, 1.0],
                    [1.0, 1.0, 1.0],
                    [-1.0, 1.0, 1.0],
                ],
            },
            CubeFaceDef {
                normal: [0.0, -1.0, 0.0],
                label: "FRONT",
                accent: egui::Color32::from_rgb(80, 220, 140),
                target_yaw: -std::f32::consts::FRAC_PI_2,
                target_pitch: 0.08,
                verts: [
                    [-1.0, -1.0, -1.0],
                    [1.0, -1.0, -1.0],
                    [1.0, -1.0, 1.0],
                    [-1.0, -1.0, 1.0],
                ],
            },
            CubeFaceDef {
                normal: [1.0, 0.0, 0.0],
                label: "RIGHT",
                accent: egui::Color32::from_rgb(255, 180, 60),
                target_yaw: std::f32::consts::PI,
                target_pitch: 0.08,
                verts: [
                    [1.0, -1.0, -1.0],
                    [1.0, 1.0, -1.0],
                    [1.0, 1.0, 1.0],
                    [1.0, -1.0, 1.0],
                ],
            },
            CubeFaceDef {
                normal: [0.0, 1.0, 0.0],
                label: "BACK",
                accent: egui::Color32::from_rgb(170, 130, 240),
                target_yaw: std::f32::consts::FRAC_PI_2,
                target_pitch: 0.08,
                verts: [
                    [-1.0, 1.0, -1.0],
                    [-1.0, 1.0, 1.0],
                    [1.0, 1.0, 1.0],
                    [1.0, 1.0, -1.0],
                ],
            },
            CubeFaceDef {
                normal: [-1.0, 0.0, 0.0],
                label: "LEFT",
                accent: egui::Color32::from_rgb(255, 100, 140),
                target_yaw: 0.0,
                target_pitch: 0.08,
                verts: [
                    [-1.0, -1.0, -1.0],
                    [-1.0, -1.0, 1.0],
                    [-1.0, 1.0, 1.0],
                    [-1.0, 1.0, -1.0],
                ],
            },
            CubeFaceDef {
                normal: [0.0, 0.0, -1.0],
                label: "BOT",
                accent: egui::Color32::from_rgb(120, 140, 160),
                target_yaw: -std::f32::consts::FRAC_PI_2,
                target_pitch: 0.08,
                verts: [
                    [-1.0, -1.0, -1.0],
                    [-1.0, 1.0, -1.0],
                    [1.0, 1.0, -1.0],
                    [1.0, -1.0, -1.0],
                ],
            },
        ];

        let pointer_pos = ui.ctx().input(|input| input.pointer.hover_pos());
        let pointer_clicked = ui.ctx().input(|input| input.pointer.primary_clicked());

        let point_in_quad = |p: egui::Pos2, quad: &[egui::Pos2; 4]| -> bool {
            let mut signs = [false, false];
            for i in 0..4 {
                let p1 = quad[i];
                let p2 = quad[(i + 1) % 4];
                let cross = (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
                if cross.abs() > 1e-4 {
                    if cross > 0.0 {
                        signs[0] = true;
                    } else {
                        signs[1] = true;
                    }
                }
            }
            !(signs[0] && signs[1])
        };

        // Gather and sort visible faces
        let mut visible_faces = Vec::new();
        for face in &faces {
            let n_dot_v = -(face.normal[0] * forward[0]
                + face.normal[1] * forward[1]
                + face.normal[2] * forward[2]);
            if n_dot_v > 0.01 {
                let pts: [egui::Pos2; 4] = [
                    project(face.verts[0]).0,
                    project(face.verts[1]).0,
                    project(face.verts[2]).0,
                    project(face.verts[3]).0,
                ];
                let depths = [
                    project(face.verts[0]).1,
                    project(face.verts[1]).1,
                    project(face.verts[2]).1,
                    project(face.verts[3]).1,
                ];
                let avg_depth = (depths[0] + depths[1] + depths[2] + depths[3]) * 0.25;
                visible_faces.push((avg_depth, face, pts));
            }
        }
        visible_faces.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        let mut face_action_taken = false;
        // Check hover / click on the closest front-most faces first
        for (_, face, pts) in visible_faces.iter().rev() {
            if !face_action_taken && pointer_pos.is_some_and(|pos| point_in_quad(pos, pts)) {
                if pointer_clicked {
                    self.camera_ctrl_3d.target.yaw = face.target_yaw;
                    self.camera_ctrl_3d.target.pitch = face.target_pitch;
                    self.camera_ctrl_3d.cancel_inertia();
                    face_action_taken = true;
                }
            }
        }

        // Draw visible faces back to front
        for (_, face, pts) in &visible_faces {
            let is_hovered = pointer_pos.is_some_and(|pos| point_in_quad(pos, pts));
            let fill_color = if is_hovered {
                egui::Color32::from_rgba_unmultiplied(35, 65, 95, 245)
            } else {
                egui::Color32::from_rgba_unmultiplied(22, 28, 38, 230)
            };
            let stroke_color = if is_hovered {
                face.accent
            } else {
                egui::Color32::from_rgba_unmultiplied(85, 115, 150, 200)
            };
            painter.add(egui::Shape::convex_polygon(
                pts.to_vec(),
                fill_color,
                egui::Stroke::new(if is_hovered { 1.6 } else { 1.1 }, stroke_color),
            ));

            let face_center = egui::pos2(
                (pts[0].x + pts[1].x + pts[2].x + pts[3].x) * 0.25,
                (pts[0].y + pts[1].y + pts[2].y + pts[3].y) * 0.25,
            );
            painter.text(
                face_center,
                egui::Align2::CENTER_CENTER,
                face.label,
                egui::FontId::proportional(9.0),
                if is_hovered {
                    egui::Color32::WHITE
                } else {
                    egui::Color32::from_rgb(210, 225, 245)
                },
            );
        }

        // Draw XYZ coordinate axis indicators
        let axis_len = 1.45_f32;
        let axes = [
            (
                [axis_len, 0.0, 0.0],
                "X",
                egui::Color32::from_rgb(255, 80, 80),
            ),
            (
                [0.0, axis_len, 0.0],
                "Y",
                egui::Color32::from_rgb(80, 230, 110),
            ),
            (
                [0.0, 0.0, axis_len],
                "Z",
                egui::Color32::from_rgb(0, 210, 255),
            ),
        ];
        for (axis_pos, label, color) in axes {
            let (screen_pos, depth) = project(axis_pos);
            if depth > -0.2 {
                painter.line_segment(
                    [center, screen_pos],
                    egui::Stroke::new(1.3, color.gamma_multiply(0.85)),
                );
                painter.circle_filled(screen_pos, 4.5, color);
                painter.text(
                    screen_pos,
                    egui::Align2::CENTER_CENTER,
                    label,
                    egui::FontId::proportional(7.5),
                    egui::Color32::BLACK,
                );
            }
        }
    }

    fn handle_canvas_keyboard_shortcuts(
        &mut self,
        ui: &mut egui::Ui,
        world: Rect32,
        canvas: egui::Rect,
    ) {
        if !ui.ctx().wants_keyboard_input() {
            if ui.input(|input| input.key_pressed(egui::Key::Escape)) {
                if self.shortcuts_overlay_visible {
                    self.shortcuts_overlay_visible = false;
                } else if self.ruler_tool.enabled {
                    self.ruler_tool.clear();
                } else if self.selected.is_some()
                    || !self.highlighted.is_empty()
                    || self.selected_drc.is_some()
                    || self.selected_antenna.is_some()
                    || self.selected_map_bbox.is_some()
                {
                    self.selected = None;
                    self.highlighted.clear();
                    self.selected_drc = None;
                    self.selected_antenna = None;
                    self.selected_map_bbox = None;
                }
                self.pan_drag.reset();
            }
            if ui.input(|input| input.key_pressed(egui::Key::Q)) {
                if self.view_mode == ViewMode::TwoD {
                    self.switch_to_3d_mode();
                } else {
                    self.switch_to_2d_mode();
                }
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::F) || input.key_pressed(egui::Key::Home)
            }) {
                self.focus_animation = None;
                if self.view_mode == ViewMode::ThreeD {
                    let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
                    self.camera_ctrl_3d.fit_world_with_aspect(
                        crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
                        crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
                        self.layer_stack.height(),
                        aspect,
                    );
                    self.camera_ctrl_3d.snap_to_target();
                    self.view3d_fitted = true;
                } else {
                    self.zoom = 1.0;
                    self.pan = egui::Vec2::ZERO;
                }
                self.pan_drag.reset();
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Num1) || input.key_pressed(egui::Key::T)
            }) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.set_top();
                }
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Num2) || input.key_pressed(egui::Key::I)
            }) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.set_iso();
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::Num3)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.set_front();
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::G)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.show_3d_grid = !self.show_3d_grid;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::H)) {
                if self.active_heatmap.is_some() {
                    self.active_heatmap = None;
                    self.selected_map_bbox = None;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::N)) {
                let shift = ui.input(|input| input.modifiers.shift);
                if let Some(heatmap) = self.active_heatmap.as_ref() {
                    let clicked_cell = if shift {
                        let peaks = heatmap.data.top_peaks(heatmap.invert_threshold);
                        if !peaks.is_empty() {
                            let curr = heatmap.selected_cell.unwrap_or(peaks[0]);
                            if let Some(idx) = peaks.iter().position(|&p| p == curr) {
                                let prev_idx = if idx == 0 { peaks.len() - 1 } else { idx - 1 };
                                Some(peaks[prev_idx])
                            } else {
                                Some(peaks[0])
                            }
                        } else {
                            None
                        }
                    } else {
                        heatmap
                            .data
                            .next_peak_cell(heatmap.selected_cell, heatmap.invert_threshold)
                    };
                    if let Some((row, column)) = clicked_cell {
                        let bbox = heatmap.data.bbox(row, column);
                        if let Some(heatmap) = self.active_heatmap.as_mut() {
                            heatmap.selected_cell = Some((row, column));
                        }
                        if let Some(bbox) = bbox {
                            let contextual = contextual_map_focus_bbox(bbox);
                            self.selected_map_bbox = Some(bbox);
                            if self.view_mode == ViewMode::ThreeD {
                                let span =
                                    ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                                self.camera_ctrl_3d.focus_xy(
                                    (bbox.lx + bbox.hx) as f32 * 0.5,
                                    (bbox.ly + bbox.hy) as f32 * 0.5,
                                    span,
                                    self.layer_stack.height(),
                                );
                            } else {
                                self.pending_focus = Some(PendingFocus {
                                    bbox: contextual,
                                    select_shape_id: None,
                                    transition: FocusTransition::Animated,
                                });
                            }
                        }
                    }
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::OpenBracket)) {
                if let Some(heatmap) = self.active_heatmap.as_mut() {
                    heatmap.opacity = (heatmap.opacity - 0.05).max(0.05);
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::CloseBracket)) {
                if let Some(heatmap) = self.active_heatmap.as_mut() {
                    heatmap.opacity = (heatmap.opacity + 0.05).min(1.0);
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::ArrowLeft)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(-1.0, 0.0);
                } else {
                    self.pan.x += canvas.width() * 0.10;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::ArrowRight)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(1.0, 0.0);
                } else {
                    self.pan.x -= canvas.width() * 0.10;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::ArrowUp)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(0.0, 1.0);
                } else {
                    self.pan.y += canvas.height() * 0.10;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::ArrowDown)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.move_pivot(0.0, -1.0);
                } else {
                    self.pan.y -= canvas.height() * 0.10;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::Z)) {
                if let Some(shape_id) = self.selected {
                    if let Some(shape) = self.db.find_shape(shape_id) {
                        if self.view_mode == ViewMode::ThreeD {
                            let bbox = shape.bbox;
                            let span = ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                            self.camera_ctrl_3d.focus_xy(
                                (bbox.lx + bbox.hx) as f32 * 0.5,
                                (bbox.ly + bbox.hy) as f32 * 0.5,
                                span * 3.0,
                                self.layer_stack.height(),
                            );
                        } else {
                            self.pending_focus = Some(PendingFocus {
                                bbox: shape.bbox,
                                select_shape_id: Some(shape_id),
                                transition: FocusTransition::Animated,
                            });
                        }
                    }
                } else if let Some(bbox) = self.selected_map_bbox {
                    if self.view_mode == ViewMode::ThreeD {
                        let span = ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                        self.camera_ctrl_3d.focus_xy(
                            (bbox.lx + bbox.hx) as f32 * 0.5,
                            (bbox.ly + bbox.hy) as f32 * 0.5,
                            span * 2.0,
                            self.layer_stack.height(),
                        );
                    } else {
                        self.pending_focus = Some(PendingFocus {
                            bbox: contextual_map_focus_bbox(bbox),
                            select_shape_id: None,
                            transition: FocusTransition::Animated,
                        });
                    }
                } else if let Some(drc_id) = self.selected_drc {
                    if let Some(overlay) = &self.drc_overlay {
                        if let Some(v) = overlay.violations.iter().find(|v| v.id == drc_id) {
                            if self.view_mode == ViewMode::ThreeD {
                                let bbox = v.bbox;
                                let span =
                                    ((bbox.hx - bbox.lx).max(bbox.hy - bbox.ly) as f32).max(1.0);
                                self.camera_ctrl_3d.focus_xy(
                                    (bbox.lx + bbox.hx) as f32 * 0.5,
                                    (bbox.ly + bbox.hy) as f32 * 0.5,
                                    span * 3.0,
                                    self.layer_stack.height(),
                                );
                            } else {
                                self.pending_focus = Some(PendingFocus {
                                    bbox: contextual_map_focus_bbox(v.bbox),
                                    select_shape_id: None,
                                    transition: FocusTransition::Animated,
                                });
                            }
                        }
                    }
                } else if !self.highlighted.is_empty() {
                    self.focus_highlighted_shapes();
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::K) || input.key_pressed(egui::Key::R))
            {
                self.ruler_tool.toggle();
                self.pan_drag.reset();
            }
            if ui.input(|input| input.key_pressed(egui::Key::Space)) {
                if self.analysis_tab == AnalysisTab::Map || self.active_heatmap.is_some() {
                    self.toggle_previous_map_item();
                }
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Questionmark) || input.key_pressed(egui::Key::F1)
            }) {
                self.shortcuts_overlay_visible = !self.shortcuts_overlay_visible;
            }
            if ui.input(|input| {
                (input.modifiers.command || input.modifiers.ctrl) && input.key_pressed(egui::Key::F)
            }) || ui.input(|input| input.key_pressed(egui::Key::Slash))
            {
                self.sidebar_info_panel = None;
                self.query_input_mode = QueryInputMode::Search;
            }
            if ui.input(|input| {
                input.key_pressed(egui::Key::Plus) || input.key_pressed(egui::Key::Equals)
            }) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.dolly_steps(1.0, None, false);
                } else {
                    let center = canvas.center();
                    let (new_zoom, new_pan) =
                        zoom_at_screen_pos(world, canvas, self.zoom, self.pan, 1.25, center);
                    self.zoom = new_zoom;
                    self.pan = new_pan;
                }
            }
            if ui.input(|input| input.key_pressed(egui::Key::Minus)) {
                if self.view_mode == ViewMode::ThreeD {
                    self.camera_ctrl_3d.dolly_steps(-1.0, None, false);
                } else {
                    let center = canvas.center();
                    let (new_zoom, new_pan) =
                        zoom_at_screen_pos(world, canvas, self.zoom, self.pan, 0.8, center);
                    self.zoom = new_zoom;
                    self.pan = new_pan;
                }
            }
        }
    }

    fn switch_to_3d_mode(&mut self) {
        if self.view_mode != ViewMode::ThreeD {
            self.view_mode = ViewMode::ThreeD;
            self.pan_drag.reset();
            self.focus_animation = None;
            self.view3d_fitted = false;
            self.object_visibility.set_all_visible(true);
            self.apply_object_visibility();
            set_layer_visibility(&mut self.layers, true);
            self.gpu_3d_instances_cache = None;
            self.loading_3d_start = Some(std::time::Instant::now());
        }
    }

    fn switch_to_2d_mode(&mut self) {
        if self.view_mode != ViewMode::TwoD {
            self.view_mode = ViewMode::TwoD;
            self.pan_drag.reset();
            self.focus_animation = None;
            self.loading_3d_start = None;
        }
    }

    fn ensure_3d_view(&mut self, world: Rect32, canvas: egui::Rect) {
        self.rebuild_layer_stack();
        if !self.view3d_bootstrapped {
            self.view3d_bootstrapped = true;
            if visible_layer_count(&self.layers) == 0 {
                set_layer_visibility(&mut self.layers, true);
            }
            self.object_visibility.set_all_visible(true);
            self.apply_object_visibility();
        }
        if !self.view3d_fitted {
            let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
            self.camera_ctrl_3d.fit_world_with_aspect(
                crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
                crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
                self.layer_stack.height(),
                aspect,
            );
            self.camera_ctrl_3d.snap_to_target();
            self.view3d_fitted = true;
        }
    }

    fn rebuild_layer_stack(&mut self) {
        let mut entries: Vec<(LayerId, LayerRole, u32)> = self
            .layers
            .iter()
            .map(|layer| {
                (
                    layer.layer_id,
                    LayerRole::from_metadata(&layer.name, &layer.layer_type),
                    layer.order,
                )
            })
            .collect();
        if !entries
            .iter()
            .any(|(layer_id, _, _)| *layer_id == LAYOUT_GEOMETRY_LAYER)
        {
            entries.push((LAYOUT_GEOMETRY_LAYER, LayerRole::Overlap, 0));
        }
        self.layer_stack = chip_display::heuristic_layer_stack(entries);
    }

    fn build_3d_instances(
        &self,
        world: Rect32,
        viewport: Rect32,
        query_layer_ids: &[LayerId],
        using_overview_tiles: bool,
    ) -> Vec<crate::canvas_gpu3d::GpuShapeInstance3d> {
        if using_overview_tiles && self.db.view_tile_count() > 0 {
            let overview = self.build_3d_overview_instances(world, viewport);
            if !overview.is_empty() {
                return overview;
            }
        }

        let visibility_hash = layers_visibility_hash(&self.layers);
        let layer_index = if self.visibility_rules_cache.epoch == self.geometry_epoch
            && self.visibility_rules_cache.layer_visibility_hash == visibility_hash
        {
            Some(&self.visibility_rules_cache.layer_index)
        } else {
            None
        };
        let fallback_index = layer_index
            .is_none()
            .then(|| LayerRenderIndex::new(&self.layers));
        let layer_index = layer_index.unwrap_or_else(|| fallback_index.as_ref().unwrap());
        let total_budget = crate::canvas_gpu3d::MAX_3D_INSTANCES.saturating_sub(100);
        let mut prepared = Vec::new();

        for shape_id in overlay_shape_ids(self.selected, &self.highlighted) {
            let Some(shape) = self.db.find_shape(shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) {
                continue;
            }
            let owner = self.db.owner_for_shape(shape);
            let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            if matches!(
                owner_type,
                Some(
                    OwnerType::TrackGrid
                        | OwnerType::GCellGrid
                        | OwnerType::Die
                        | OwnerType::Core
                        | OwnerType::Row
                        | OwnerType::InstanceHalo
                        | OwnerType::Region
                        | OwnerType::Slot
                )
            ) {
                continue;
            }
            let owner_category =
                owner.and_then(|owner| drawing_category_for_owner(&self.db, owner));
            if !shape_is_visible_fast(
                shape,
                owner_type,
                owner_category,
                layer_index,
                &self.object_visibility,
            ) {
                continue;
            }
            let Some(mut style) =
                visible_style_for_shape_fast(shape, owner, owner_type, layer_index)
            else {
                continue;
            };
            let mut extra_flags = 0u32;
            if self.selected == Some(shape_id) {
                style.rgba = [76, 196, 255, 230];
                style.fill_alpha = 230;
                extra_flags |= crate::canvas_gpu3d::FLAG_SELECTED;
            } else if self.highlighted.contains(&shape_id) {
                style.rgba = [255, 214, 90, 210];
                style.fill_alpha = 210;
                extra_flags |= crate::canvas_gpu3d::FLAG_HIGHLIGHTED;
            }
            let band =
                self.layer_stack
                    .band(shape.layer_id)
                    .unwrap_or(chip_display::LayerStackBand {
                        layer_id: shape.layer_id,
                        z0: 0.0,
                        z1: 400.0,
                    });
            let layer_info = self.layers.iter().find(|l| l.layer_id == shape.layer_id);
            let role = layer_info
                .map(|l| chip_display::LayerRole::from_metadata(&l.name, &l.layer_type))
                .unwrap_or(chip_display::LayerRole::Metal { level: 1 });
            let material = chip_display::MaterialKind::from_role(role);
            prepared.push((
                self.db.shape_geometry(shape),
                style,
                role,
                material,
                band.z0,
                band.z1,
                extra_flags,
            ));
        }

        let mut layers_with_bands: Vec<(LayerId, f32, f32)> = query_layer_ids
            .iter()
            .copied()
            .map(|layer_id| {
                let band =
                    self.layer_stack
                        .band(layer_id)
                        .unwrap_or(chip_display::LayerStackBand {
                            layer_id,
                            z0: 0.0,
                            z1: 400.0,
                        });
                (layer_id, band.z0, band.z1)
            })
            .collect();
        layers_with_bands.sort_by(|a, b| a.1.total_cmp(&b.1));

        let mut layer_queries: Vec<(LayerId, f32, f32, Vec<ShapeId>)> =
            Vec::with_capacity(layers_with_bands.len());
        let mut total_query_shapes = 0usize;
        for &(layer_id, z0, z1) in &layers_with_bands {
            let shape_ids = self.db.query_layer_intersect(layer_id, viewport);
            total_query_shapes += shape_ids.len();
            layer_queries.push((layer_id, z0, z1, shape_ids));
        }

        let remaining_budget = total_budget.saturating_sub(prepared.len());
        let global_stride_needed = total_query_shapes > remaining_budget;

        for (layer_id, z0, z1, shape_ids) in layer_queries {
            if prepared.len() >= total_budget || shape_ids.is_empty() {
                continue;
            }

            let stride = if global_stride_needed {
                ((total_query_shapes + remaining_budget - 1) / remaining_budget).max(1)
            } else {
                1
            };

            let layer_info = self.layers.iter().find(|l| l.layer_id == layer_id);
            let role = layer_info
                .map(|l| chip_display::LayerRole::from_metadata(&l.name, &l.layer_type))
                .unwrap_or(chip_display::LayerRole::Metal { level: 1 });
            let material = chip_display::MaterialKind::from_role(role);

            for &shape_id in shape_ids.iter().step_by(stride) {
                if prepared.len() >= total_budget {
                    break;
                }
                let Some(shape) = self.db.find_shape(shape_id) else {
                    continue;
                };
                if !is_renderable_shape(shape) {
                    continue;
                }
                let owner = self.db.owner_for_shape(shape);
                let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
                if matches!(
                    owner_type,
                    Some(
                        OwnerType::TrackGrid
                            | OwnerType::GCellGrid
                            | OwnerType::Die
                            | OwnerType::Core
                            | OwnerType::Row
                            | OwnerType::InstanceHalo
                            | OwnerType::Region
                            | OwnerType::Slot
                    )
                ) {
                    continue;
                }
                let owner_category =
                    owner.and_then(|owner| drawing_category_for_owner(&self.db, owner));
                if !shape_is_visible_fast(
                    shape,
                    owner_type,
                    owner_category,
                    layer_index,
                    &self.object_visibility,
                ) {
                    continue;
                }
                let Some(style) =
                    visible_style_for_shape_fast(shape, owner, owner_type, layer_index)
                else {
                    continue;
                };

                prepared.push((
                    self.db.shape_geometry(shape),
                    style,
                    role,
                    material,
                    z0,
                    z1,
                    0,
                ));
            }
        }

        let mut instances =
            crate::canvas_gpu3d::build_gpu_instances_3d_with_flags(prepared.into_iter());
        instances.push(crate::canvas_gpu3d::ground_grid_instance(world));
        instances
    }

    fn build_3d_overview_instances(
        &self,
        world: Rect32,
        viewport: Rect32,
    ) -> Vec<crate::canvas_gpu3d::GpuShapeInstance3d> {
        let mut layers: Vec<(&LayerUiState, chip_display::LayerStackBand)> = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .filter_map(|layer| {
                self.layer_stack
                    .band(layer.layer_id)
                    .map(|band| (layer, band))
            })
            .collect();
        layers.sort_by(|lhs, rhs| lhs.1.z0.total_cmp(&rhs.1.z0));
        let layer_ids: Vec<LayerId> = layers.iter().map(|(layer, _)| layer.layer_id).collect();
        let preferred_lod = select_overview_lod(&self.db, &layer_ids, viewport, world)
            .unwrap_or_else(|| {
                crate::canvas_gpu3d::overview_lod_level(self.camera_ctrl_3d.current, world)
            });

        let mut instances = Vec::new();
        instances.push(crate::canvas_gpu3d::ground_grid_instance(world));
        for layer in layers {
            let role = chip_display::LayerRole::from_metadata(&layer.0.name, &layer.0.layer_type);
            for tile in
                overview_tiles_for_layer(&self.db, preferred_lod, layer.0.layer_id, viewport, world)
            {
                crate::canvas_gpu3d::push_overview_tile_instance(
                    &mut instances,
                    tile.bbox,
                    tile.shape_count,
                    layer.1.z0,
                    layer.1.z1,
                    &layer.0.style,
                    role,
                );
                if instances.len() >= crate::canvas_gpu3d::MAX_3D_INSTANCES {
                    return instances;
                }
            }
        }
        instances
    }

    fn hover_world_point_3d(&self, pos: egui::Pos2, canvas: egui::Rect) -> Option<Point32> {
        let ray = self.camera_ctrl_3d.current.ray_from_screen(
            [pos.x, pos.y],
            [canvas.left(), canvas.top()],
            [canvas.width(), canvas.height()],
        )?;
        let hit = ray.intersect_z_plane(0.0)?;
        Some(Point32 {
            x: hit.x.round() as i32,
            y: hit.y.round() as i32,
        })
    }

    fn pick_shape_at_3d(
        &self,
        pos: egui::Pos2,
        canvas: egui::Rect,
        world: Rect32,
        query_layer_ids: &[LayerId],
    ) -> Option<ShapeId> {
        let ray = self.camera_ctrl_3d.current.ray_from_screen(
            [pos.x, pos.y],
            [canvas.left(), canvas.top()],
            [canvas.width(), canvas.height()],
        )?;
        let aspect = (canvas.width() / canvas.height().max(1.0)).max(0.2);
        let viewport =
            crate::canvas_gpu3d::query_rect_for_camera(self.camera_ctrl_3d.current, world, aspect);
        let mut best: Option<(f32, ShapeId)> = None;
        for shape_id in self.db.query_layers_intersect(query_layer_ids, viewport) {
            let Some(shape) = self.db.find_shape(shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) || !self.shape_is_visible(shape) {
                continue;
            }
            let Some(rect) = shape_xy_rect(self.db.shape_geometry(shape)) else {
                continue;
            };
            let band =
                self.layer_stack
                    .band(shape.layer_id)
                    .unwrap_or(chip_display::LayerStackBand {
                        layer_id: shape.layer_id,
                        z0: 0.0,
                        z1: 400.0,
                    });
            let min = crate::camera3d::Vec3::new(
                rect.lx as f32,
                rect.ly as f32,
                band.z0 * self.camera_ctrl_3d.current.z_scale,
            );
            let max = crate::camera3d::Vec3::new(
                rect.hx as f32,
                rect.hy as f32,
                band.z1 * self.camera_ctrl_3d.current.z_scale,
            );
            if let Some(t) = ray.intersect_aabb(min, max) {
                if best.is_none_or(|(best_t, _)| t < best_t) {
                    best = Some((t, shape_id));
                }
            }
        }
        best.map(|(_, shape_id)| shape_id)
    }

    fn should_use_view_tiles(&self, viewport: Rect32, world: Rect32) -> bool {
        if self.gpu_canvas.enabled {
            return false;
        }
        should_use_view_tiles_for_state(
            self.db.view_tile_count(),
            !self.highlighted.is_empty(),
            self.selected.is_some(),
            self.draft.is_some(),
            self.edit_enabled,
            self.zoom,
            viewport,
            world,
        ) && self.object_visibility.is_all_visible()
    }

    fn view_lod_level(&self) -> u8 {
        if self.zoom <= 0.35 {
            3
        } else if self.zoom <= 1.0 {
            2
        } else {
            1
        }
    }

    fn focus_pending_shape(&mut self, ctx: &egui::Context, world: Rect32, canvas: egui::Rect) {
        let now = ctx.input(|input| input.time);
        if let Some(focus) = self.pending_focus.take() {
            let (zoom, pan) = focus_view_on_bbox(world, focus.bbox, canvas);
            self.pan_drag.reset();
            self.selected = focus.select_shape_id;

            if focus.transition == FocusTransition::Animated && focus_animation_enabled(ctx) {
                self.focus_animation =
                    Some(FocusAnimation::new(now, self.zoom, self.pan, zoom, pan));
            } else {
                self.focus_animation = None;
                self.zoom = zoom;
                self.pan = pan;
            }
        }

        let Some(animation) = self.focus_animation else {
            return;
        };
        let frame = animation.sample(now);
        self.zoom = frame.zoom;
        self.pan = frame.pan;
        if frame.complete {
            self.focus_animation = None;
        } else {
            ctx.request_repaint();
        }
    }

    fn begin_edit_drag(&mut self, pos: egui::Pos2, world: Rect32, canvas: egui::Rect) -> bool {
        if !can_start_edit_command(
            self.draft.is_some(),
            self.pending_edit.is_some(),
            self.pending_session_action.is_some(),
        ) {
            self.last_edit_result = Some("wait for the current edit to finish".to_string());
            return false;
        }
        let Some(shape_id) = self.selected else {
            return false;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            return false;
        };
        if shape.state != ShapeState::Alive as u8
            || shape.kind != ShapeKind::Rect as u8
            || !self.shape_is_visible(shape)
        {
            return false;
        }
        let Some(owner) = self.db.owner_for_shape(shape) else {
            return false;
        };
        if !instance_move_is_allowed(owner.owner_type) {
            self.last_edit_result = Some(format!(
                "instance move is not supported for {}",
                ChipViewDb::owner_type_label(owner.owner_type)
            ));
            return false;
        }
        let screen = world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
        if !screen.contains(pos) {
            return false;
        }

        let expected_version = shape.version;
        let original_bbox = shape.bbox;
        let instance_name = matches!(
            OwnerType::from_raw(owner.owner_type),
            Some(OwnerType::InstanceBBox)
        )
        .then(|| self.db.owner_name(owner).map(str::to_owned))
        .flatten();
        self.draft = Some(EditDraft {
            command_id: self.allocate_command_id(),
            shape_id,
            expected_version,
            instance_name,
            original_bbox,
            requested_bbox: original_bbox,
        });
        true
    }

    fn begin_edit_drag_at_pointer(
        &mut self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
    ) -> bool {
        let point = screen_to_world_point(pos, world, canvas, self.zoom, self.pan);
        if let Some(shape_id) = self.pick_editable_instance_bbox_at(point) {
            self.selected = Some(shape_id);
        }
        self.begin_edit_drag(pos, world, canvas)
    }

    fn update_edit_drag(&mut self, screen_delta: egui::Vec2, world: Rect32, canvas: egui::Rect) {
        let Some(draft) = self.draft.as_mut() else {
            return;
        };
        let (dx, dy) = screen_to_world_delta(screen_delta, world, canvas, self.zoom);
        draft.requested_bbox = translate_rect(draft.original_bbox, dx, dy);
    }

    fn commit_draft(&mut self) {
        let Some(draft) = self.draft.take() else {
            return;
        };
        let Some(command_dir) = self.edit_command_dir.clone() else {
            self.last_edit_result = Some("edit command directory is missing".to_string());
            return;
        };
        let Some(result_dir) = self.edit_result_dir.clone() else {
            self.last_edit_result = Some("edit result directory is missing".to_string());
            return;
        };

        let command = GeometryEditCommand {
            command_id: draft.command_id,
            shape_id: draft.shape_id,
            expected_version: draft.expected_version,
            op: GeometryEditOp::MoveShape,
            requested_bbox: draft.requested_bbox,
        };
        let command_path = command_dir.join(format!("command-{}.json", command.command_id));
        let result_path = result_dir.join(format!("result-{}.json", command.command_id));

        match write_edit_command(&command_path, &command, draft.instance_name.as_deref()) {
            Ok(()) => {
                self.pending_edit = Some(PendingEdit { result_path });
                self.last_edit_result = Some(format!("command {} pending", command.command_id));
            }
            Err(err) => {
                self.last_edit_result = Some(format!("failed to write edit command: {err}"));
            }
        }
    }

    fn poll_edit_result(&mut self) {
        let Some(pending) = &self.pending_edit else {
            return;
        };
        if !pending.result_path.exists() {
            return;
        }

        let result = match fs::read_to_string(&pending.result_path)
            .ok()
            .and_then(|content| serde_json::from_str::<GeometryEditResult>(&content).ok())
        {
            Some(result) => result,
            None => {
                self.last_edit_result = Some("failed to read edit result".to_string());
                self.pending_edit = None;
                return;
            }
        };

        let action = edit_result_action(&result);
        self.selected = action.selected_shape_id;
        if action.reload_snapshot {
            match self.reload_snapshot_at(result.geometry_manifest_path.as_deref()) {
                Ok(()) => {}
                Err(err) => {
                    self.last_edit_result = Some(format!("failed to reload geometry: {err}"));
                    self.pending_edit = None;
                    return;
                }
            }
        }

        if matches!(
            result.status,
            GeometryEditStatus::Accepted | GeometryEditStatus::AdjustedAccepted
        ) {
            self.session_dirty = true;
        }

        self.last_edit_result = Some(action.message);
        self.pending_edit = None;
    }

    fn request_session_action(&mut self, action: SessionActionKind, close_after: bool) {
        if !self.session_dirty {
            self.last_edit_result = Some("there are no uncommitted layout edits".to_string());
            return;
        }
        if self.pending_edit.is_some()
            || self.draft.is_some()
            || self.pending_session_action.is_some()
        {
            self.last_edit_result = Some("wait for the current edit to finish".to_string());
            return;
        }
        let Some(command_dir) = self.edit_command_dir.clone() else {
            self.last_edit_result = Some("edit command directory is missing".to_string());
            return;
        };
        let Some(result_dir) = self.edit_result_dir.clone() else {
            self.last_edit_result = Some("edit result directory is missing".to_string());
            return;
        };

        let command = SessionActionCommand {
            command_id: self.allocate_command_id(),
            action,
        };
        let command_path = command_dir.join(format!(
            "control-{}-{}.json",
            action.label(),
            command.command_id
        ));
        let result_path = result_dir.join(format!(
            "control-result-{}-{}.json",
            action.label(),
            command.command_id
        ));
        let progress_path = result_dir.join(format!(
            "control-progress-{}-{}.json",
            action.label(),
            command.command_id
        ));

        match write_session_action_command(&command_path, &command) {
            Ok(()) => {
                self.pending_session_action = Some(PendingSessionAction {
                    action,
                    command_id: command.command_id,
                    progress_path,
                    result_path,
                });
                self.session_action_progress = Some(SessionActionProgress::new(
                    action,
                    command.command_id,
                    SessionActionProgressPhase::Queued,
                    0,
                    format!("{} request queued", action.label()),
                ));
                self.close_after_session_action = close_after;
                self.last_edit_result = Some(format!("{} pending", action.label()));
            }
            Err(err) => {
                let message = format!("failed to request {}: {err}", action.label());
                self.session_action_progress = Some(SessionActionProgress::new(
                    action,
                    command.command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message.clone(),
                ));
                self.last_edit_result = Some(message);
            }
        }
    }

    fn poll_session_action_progress(&mut self) {
        let Some(pending) = self.pending_session_action.as_ref() else {
            return;
        };
        let expected_action = pending.action;
        let expected_command_id = pending.command_id;
        let progress_path = pending.progress_path.clone();
        let progress = fs::read_to_string(progress_path)
            .ok()
            .and_then(|content| serde_json::from_str::<SessionActionProgress>(&content).ok());
        let Some(progress) = progress else {
            return;
        };
        if progress.action == expected_action
            && progress.command_id == expected_command_id
            && progress.percent <= 100
        {
            self.session_action_progress = Some(progress);
        }
    }

    /// Returns true when a successful Save or Discard was requested by the
    /// close confirmation and the native window may now exit.
    fn poll_session_action_result(&mut self) -> bool {
        let Some(pending) = &self.pending_session_action else {
            return false;
        };
        if !pending.result_path.exists() {
            return false;
        }

        let expected_action = pending.action;
        let expected_command_id = pending.command_id;
        let result = match fs::read_to_string(&pending.result_path)
            .ok()
            .and_then(|content| serde_json::from_str::<SessionActionResult>(&content).ok())
        {
            Some(result)
                if result.action == expected_action && result.command_id == expected_command_id =>
            {
                result
            }
            Some(_) => {
                let message = "received a mismatched session action result".to_string();
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                self.pending_session_action = None;
                self.close_after_session_action = false;
                return false;
            }
            None => {
                let message = "failed to read session action result".to_string();
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                self.pending_session_action = None;
                self.close_after_session_action = false;
                return false;
            }
        };

        let close_after = self.close_after_session_action;
        self.close_after_session_action = false;
        self.pending_session_action = None;
        if !result.accepted {
            let message = session_action_result_message(&result);
            self.last_edit_result = Some(message.clone());
            self.session_action_progress = Some(SessionActionProgress::new(
                expected_action,
                expected_command_id,
                SessionActionProgressPhase::Failed,
                100,
                message,
            ));
            return false;
        }

        self.session_action_progress = Some(SessionActionProgress::new(
            expected_action,
            expected_command_id,
            SessionActionProgressPhase::ReloadingGeometry,
            95,
            "Reloading published geometry",
        ));
        match self.reload_snapshot_at(result.geometry_manifest_path.as_deref()) {
            Ok(()) => {
                self.session_dirty = false;
                self.close_confirmation_visible = false;
                let message = session_action_result_message(&result);
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Completed,
                    100,
                    message,
                ));
                close_after
            }
            Err(err) => {
                let message = format!(
                    "{} completed but geometry reload failed: {err}",
                    result.action.label()
                );
                self.last_edit_result = Some(message.clone());
                self.session_action_progress = Some(SessionActionProgress::new(
                    expected_action,
                    expected_command_id,
                    SessionActionProgressPhase::Failed,
                    100,
                    message,
                ));
                false
            }
        }
    }

    fn show_close_confirmation(&mut self, ctx: &egui::Context) {
        if !self.close_confirmation_visible || self.pending_session_action.is_some() {
            return;
        }

        egui::Window::new("Unsaved layout edits")
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(310.0);
                ui.label("Save or discard the pending layout edits before closing.");
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Keep editing").clicked() {
                        self.close_confirmation_visible = false;
                    }
                    if ui.button("Discard").clicked() {
                        self.request_session_action(SessionActionKind::Discard, true);
                    }
                    if ui.button("Save").clicked() {
                        self.request_session_action(SessionActionKind::Save, true);
                    }
                });
            });
    }

    fn show_session_action_progress(&mut self, ctx: &egui::Context) {
        let Some(progress) = self.session_action_progress.clone() else {
            return;
        };
        let title = match progress.action {
            SessionActionKind::Save => "Saving layout",
            SessionActionKind::Discard => "Discarding layout edits",
        };
        let mut dismiss = false;
        egui::Window::new(title)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(360.0);
                ui.label(egui::RichText::new(progress.phase.label()).strong());
                ui.add_space(8.0);
                ui.add(
                    egui::ProgressBar::new(progress.fraction())
                        .show_percentage()
                        .animate(!progress.phase.is_terminal()),
                );
                ui.add_space(6.0);
                ui.label(&progress.message);
                if !progress.phase.is_terminal() {
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        ui.spinner();
                        ui.label("This window updates until the operation finishes.");
                    });
                } else {
                    ui.add_space(8.0);
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("×").on_hover_text("Close status").clicked() {
                            dismiss = true;
                        }
                    });
                }
            });
        if dismiss {
            self.session_action_progress = None;
        }
    }

    fn show_shortcuts_overlay(&mut self, ctx: &egui::Context) {
        if !self.shortcuts_overlay_visible {
            return;
        }
        let mut open = true;
        egui::Window::new("Keyboard Shortcuts")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.set_min_width(420.0);
                ui.add_space(2.0);

                let render_shortcut_row = |ui: &mut egui::Ui, key: &str, desc: &str| {
                    ui.horizontal(|ui| {
                        ui.set_min_height(22.0);
                        egui::Frame::NONE
                            .fill(egui::Color32::from_rgb(38, 40, 48))
                            .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
                            .corner_radius(4)
                            .inner_margin(egui::Margin::symmetric(6, 2))
                            .show(ui, |ui| {
                                ui.label(
                                    egui::RichText::new(key)
                                        .monospace()
                                        .size(11.0)
                                        .strong()
                                        .color(ecos_accent()),
                                );
                            });
                        ui.add_space(8.0);
                        ui.label(
                            egui::RichText::new(desc)
                                .size(12.0)
                                .color(ecos_text_primary()),
                        );
                    });
                };

                ui.label(
                    egui::RichText::new("2D / 3D NAVIGATION")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(ui, "Q", "Toggle 2D / 3D Layer Stack View");
                render_shortcut_row(ui, "F  or  Home", "Fit entire design to viewport");
                render_shortcut_row(ui, "Z", "Zoom / focus to selected object");
                render_shortcut_row(ui, "+  /  -", "Zoom in / Zoom out (Dolly in 3D)");
                render_shortcut_row(ui, "Scroll Wheel", "Distance-proportional Zoom / Dolly");
                render_shortcut_row(ui, "Shift + Drag", "Fine speed control (0.25×)");
                render_shortcut_row(ui, "Ctrl + Drag", "Fast speed boost (4.0×)");
                render_shortcut_row(ui, "Middle / Right Drag", "Pan viewport (2D & 3D)");
                render_shortcut_row(ui, "Left Drag (3D)", "Orbit / Turntable rotate in 3D");
                render_shortcut_row(ui, "Arrow Keys", "Pan 10% (2D) / Shift Pivot (3D)");

                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("3D VIEW PRESETS")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(ui, "1  or  T", "Top View (+Z look-down)");
                render_shortcut_row(ui, "2  or  I", "Isometric View");
                render_shortcut_row(ui, "3", "Front View (stack cross-section)");
                render_shortcut_row(ui, "G", "Toggle Ground Grid floor plane");

                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("TOOLS & INSPECTION")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(ui, "K  or  R", "Toggle Ruler / Measurement tool");
                render_shortcut_row(ui, "Esc", "Clear ruler, selection, or close popup");
                render_shortcut_row(ui, "Ctrl + F  or  /", "Focus search query");
                render_shortcut_row(ui, "?  or  F1", "Toggle Keyboard Shortcuts overlay");

                ui.add_space(8.0);
                ui.label(
                    egui::RichText::new("HEATMAP & MAP ANALYSIS")
                        .small()
                        .strong()
                        .color(ecos_text_secondary()),
                );
                render_shortcut_row(
                    ui,
                    "Space",
                    "A/B Map Quick-Toggle (switch with previous map)",
                );
                render_shortcut_row(ui, "N  /  Shift + N", "Focus Next / Prev Peak hotspot");
                render_shortcut_row(ui, "H", "Toggle active heatmap visibility");
                render_shortcut_row(ui, "[  /  ]", "Decrease / Increase heatmap opacity");
                render_shortcut_row(ui, "Drag on Legend", "Slide threshold cutoff in minimap");
                ui.add_space(4.0);
            });
        if !open {
            self.shortcuts_overlay_visible = false;
        }
    }

    fn poll_external_snapshot_refresh(&mut self) {
        if self.pending_edit.is_some()
            || self.pending_session_action.is_some()
            || self.draft.is_some()
        {
            return;
        }

        let now = Instant::now();
        if now < self.next_snapshot_refresh_check {
            return;
        }
        self.next_snapshot_refresh_check = now + SNAPSHOT_REFRESH_CHECK_INTERVAL;

        let current_signature = snapshot_signature_for_db(&self.db);
        if !snapshot_file_signature_changed(&self.snapshot_signature, &current_signature) {
            return;
        }

        match self.reload_snapshot() {
            Ok(()) => {
                self.last_edit_result = Some("geometry snapshot refreshed".to_string());
            }
            Err(err) => {
                self.last_edit_result = Some(format!("failed to refresh geometry: {err}"));
            }
        }
    }

    fn reload_snapshot(&mut self) -> Result<(), String> {
        let manifest_path = self.db.snapshot().manifest().path.clone();
        self.reload_snapshot_from(&manifest_path)
    }

    fn reload_snapshot_at(&mut self, manifest_path: Option<&str>) -> Result<(), String> {
        let manifest_path = manifest_path
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.db.snapshot().manifest().path.clone());
        self.reload_snapshot_from(&manifest_path)
    }

    fn reload_snapshot_from(&mut self, manifest_path: &Path) -> Result<(), String> {
        let db = ChipViewDb::open(manifest_path).map_err(|err| err.to_string())?;
        let snapshot_signature = snapshot_signature_for_db(&db);
        self.replace_db(db);
        self.snapshot_signature = snapshot_signature;
        Ok(())
    }

    fn replace_db(&mut self, db: ChipViewDb) {
        let visibility: BTreeMap<LayerId, bool> = self
            .layers
            .iter()
            .map(|layer| (layer.layer_id, layer.visible))
            .collect();
        let stats = db.stats();
        self.grid_bounds = grid_reference_bounds(&db).or(stats.bbox);
        self.stats = stats;
        self.drawing_category_counts = drawing_category_counts(&db);
        self.layers = layer_ui_states(&db, &visibility, self.color_theme);
        self.db = db;
        self.geometry_epoch = self.geometry_epoch.wrapping_add(1);
        self.render_cache.clear();
        self.view_tile_cache.clear();
        self.refresh_highlight();
        let db = &self.db;
        self.selected =
            retain_existing_shape_id(self.selected, |shape_id| db.find_shape(shape_id).is_some());
        let db = &self.db;
        retain_existing_shape_ids(&mut self.highlighted, |shape_id| {
            db.find_shape(shape_id).is_some()
        });
        self.rebuild_layer_stack();
        self.view3d_fitted = false;
    }

    fn allocate_command_id(&mut self) -> u64 {
        next_native_command_id(&mut self.next_command_counter)
    }

    fn refresh_highlight(&mut self) {
        let name = self.search_text.trim();
        self.highlighted = if name.is_empty() {
            BTreeSet::new()
        } else {
            self.search_mode
                .query_shape_ids(&self.db, name)
                .into_iter()
                .filter(|shape_id| {
                    self.db
                        .find_shape(*shape_id)
                        .is_some_and(|shape| self.shape_is_visible(shape))
                })
                .collect()
        };
    }

    fn focus_highlighted_shapes(&mut self) {
        if self.highlighted.is_empty() {
            return;
        }
        self.pending_focus = focus_target_for_shape_ids(&self.highlighted, |shape_id| {
            self.db
                .find_shape(shape_id)
                .filter(|shape| self.shape_is_visible(shape))
                .map(|shape| shape.bbox)
        });
    }

    fn select_shape_id_from_input(&mut self) {
        let action = shape_id_lookup_action(&self.shape_id_text, |shape_id| {
            self.db
                .find_shape(shape_id)
                .filter(|shape| is_renderable_shape(shape) && self.shape_is_visible(shape))
                .map(|shape| shape.bbox)
        });
        self.pending_focus = action.pending_focus;
        self.last_query_status = Some(action.message);
    }

    fn drawing_category_shape_count(&self, category: DrawingCategory) -> usize {
        self.drawing_category_counts
            .get(&category)
            .copied()
            .unwrap_or(0)
    }

    fn visible_object_shape_count(&self) -> usize {
        DrawingCategory::ALL
            .into_iter()
            .filter(|category| self.object_visibility.is_category_visible(*category))
            .map(|category| self.drawing_category_shape_count(category))
            .sum()
    }

    fn has_via_physical_layer(&self) -> bool {
        self.layers
            .iter()
            .any(|layer| layer.name.trim().to_ascii_uppercase().starts_with("VIA"))
    }

    fn shape_is_visible(&self, shape: &ShapeRecord) -> bool {
        let owner_type = self
            .db
            .owner_for_shape(shape)
            .and_then(|owner| OwnerType::from_raw(owner.owner_type));
        let layer_visible = if shape_uses_layer_visibility(shape, owner_type) {
            self.layers
                .iter()
                .find(|layer| layer.layer_id == shape.layer_id)
                .is_some_and(|layer| layer.visible)
        } else {
            true
        };
        let owner_visible = self
            .db
            .owner_for_shape(shape)
            .and_then(|owner| drawing_category_for_owner(&self.db, owner))
            .is_none_or(|category| self.object_visibility.is_category_visible(category));
        layer_visible && owner_visible
    }

    fn visible_drc_violation_count(&self, viewport: Option<Rect32>) -> usize {
        let Some(overlay) = &self.drc_overlay else {
            return 0;
        };
        let hidden_layers: std::collections::HashSet<&str> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.as_str())
            .collect();
        let visible_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|s| s.visible)
            .map(|s| s.name.as_str())
            .collect();

        let is_visible = |v: &DrcViolation| {
            !hidden_layers.contains(v.layer.as_str()) && visible_types.contains(v.drc_type.as_str())
        };

        if let Some(vp) = viewport {
            let vp_aabb = rstar::AABB::from_corners([vp.lx, vp.ly], [vp.hx, vp.hy]);
            overlay
                .rtree
                .locate_in_envelope_intersecting(vp_aabb)
                .filter(|node| is_visible(&overlay.violations[node.index]))
                .count()
        } else {
            overlay.violations.iter().filter(|v| is_visible(v)).count()
        }
    }

    fn visible_antenna_violation_count(&self, viewport: Option<Rect32>) -> usize {
        let Some(overlay) = &self.antenna_overlay else {
            return 0;
        };
        let hidden_layers: std::collections::HashSet<&str> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.as_str())
            .collect();
        let visible_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|s| s.visible)
            .map(|s| s.name.as_str())
            .collect();

        let is_visible = |v: &AntennaViolation| {
            !hidden_layers.contains(v.layer.as_str())
                && visible_types.contains(v.antenna_type.as_str())
        };

        if let Some(vp) = viewport {
            let vp_aabb = rstar::AABB::from_corners([vp.lx, vp.ly], [vp.hx, vp.hy]);
            overlay
                .rtree
                .locate_in_envelope_intersecting(vp_aabb)
                .filter(|node| is_visible(&overlay.violations[node.index]))
                .count()
        } else {
            overlay.violations.iter().filter(|v| is_visible(v)).count()
        }
    }

    // drc_violation_is_visible and antenna_violation_is_visible were removed for performance reasons.

    fn shape_is_drawn_at_current_zoom(&self, shape: &ShapeRecord) -> bool {
        let owner_type = self.db.owner_for_shape(shape).and_then(|owner| {
            let owner_type = OwnerType::from_raw(owner.owner_type)?;
            Some(owner_type)
        });
        if owner_type.is_some_and(|owner_type| {
            matches!(owner_type, OwnerType::TrackGrid | OwnerType::GCellGrid)
                && self.has_parameterized_grid_metadata(owner_type)
        }) {
            return false;
        }
        self.zoom > 1.25
            || owner_type
                .map(|owner_type| !is_context_owner_type(owner_type as u8))
                .unwrap_or(true)
    }

    fn has_parameterized_grid_metadata(&self, owner_type: OwnerType) -> bool {
        self.db
            .grid_metadata()
            .iter()
            .any(|grid| grid_owner_type(grid) == Some(owner_type))
    }

    fn apply_object_visibility(&mut self) {
        self.selected = retain_existing_shape_id(self.selected, |shape_id| {
            self.db
                .find_shape(shape_id)
                .is_some_and(|shape| self.shape_is_visible(shape))
        });
        self.refresh_highlight();
    }

    fn pick_shape_at(
        &self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        query_layer_ids: &[LayerId],
    ) -> Option<ShapeId> {
        let hit = screen_to_world_rect(
            egui::Rect::from_min_max(pos, pos),
            world,
            canvas,
            self.zoom,
            self.pan,
        );
        let point = chipgeom_format::Point32 {
            x: hit.lx,
            y: hit.ly,
        };
        if self.edit_enabled {
            if let Some(shape_id) = self.pick_editable_instance_bbox_at(point) {
                return Some(shape_id);
            }
        }
        self.db
            .pick_top_shape(query_layer_ids, point)
            .filter(|shape_id| {
                self.db.find_shape(*shape_id).is_some_and(|shape| {
                    self.shape_is_visible(shape) && self.shape_is_drawn_at_current_zoom(shape)
                })
            })
    }

    fn pick_editable_instance_bbox_at(&self, point: Point32) -> Option<ShapeId> {
        let point_bbox = Rect32 {
            lx: point.x,
            ly: point.y,
            hx: point.x,
            hy: point.y,
        };
        pick_top_editable_instance_bbox(
            self.db
                .query_layer_intersect_records(LAYOUT_GEOMETRY_LAYER, point_bbox)
                .into_iter()
                .filter_map(|shape| {
                    let owner = self.db.owner_for_shape(shape)?;
                    (self.shape_is_visible(shape) && self.shape_is_drawn_at_current_zoom(shape))
                        .then_some((shape, owner))
                }),
            point,
        )
    }

    fn pick_drc_violation_at(
        &self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        viewport: Rect32,
    ) -> Option<usize> {
        let overlay = self.drc_overlay.as_ref()?;

        let hidden_drc_layer_names: std::collections::HashSet<&str> = self
            .layers
            .iter()
            .filter(|l| !l.visible)
            .map(|l| l.name.as_str())
            .collect();

        let visible_drc_types: std::collections::HashSet<&str> = overlay
            .type_states
            .iter()
            .filter(|s| s.visible)
            .map(|s| s.name.as_str())
            .collect();

        let vp_aabb =
            rstar::AABB::from_corners([viewport.lx, viewport.ly], [viewport.hx, viewport.hy]);

        let mut best_match: Option<usize> = None;
        for node in overlay.rtree.locate_in_envelope_intersecting(vp_aabb) {
            let violation = &overlay.violations[node.index];
            if !hidden_drc_layer_names.contains(violation.layer.as_str())
                && visible_drc_types.contains(violation.drc_type.as_str())
            {
                let screen =
                    drc_violation_screen_rect(violation, world, canvas, self.zoom, self.pan);
                if screen.expand(5.0).contains(pos) {
                    if let Some(current_best) = best_match {
                        if violation.id > current_best {
                            best_match = Some(violation.id);
                        }
                    } else {
                        best_match = Some(violation.id);
                    }
                }
            }
        }
        best_match
    }

    fn drc_detail_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(selected_id) = self.selected_drc else {
            return;
        };
        let Some(violation) = self.drc_overlay.as_ref().and_then(|overlay| {
            overlay
                .violations
                .iter()
                .find(|item| item.id == selected_id)
        }) else {
            self.selected_drc = None;
            return;
        };
        let title = format!("{} / {}", violation.drc_type, violation.layer);
        let lines = drc_detail_lines(violation);

        let ctx = ui.ctx().clone();
        let popup_width = (canvas.width() * 0.34)
            .clamp(340.0, 480.0)
            .min((canvas.width() - 24.0).max(220.0));
        let popup_height = (canvas.height() * 0.3)
            .clamp(190.0, 280.0)
            .min((canvas.height() - 24.0).max(150.0));
        let popup_pos = egui::pos2(
            canvas.left() + 12.0,
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0),
        );

        egui::Area::new(egui::Id::new("chip_viewer_drc_detail_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0_f32, drc_overlay_primary_color()))
                    .corner_radius(12)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(egui::vec2(popup_width - 20.0, popup_height - 20.0));
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new(title)
                                    .strong()
                                    .size(14.0)
                                    .color(ecos_text_primary()),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui
                                        .small_button("×")
                                        .on_hover_text("Hide DRC detail")
                                        .clicked()
                                    {
                                        self.selected_drc = None;
                                    }
                                },
                            );
                        });
                        egui::ScrollArea::vertical()
                            .id_salt("chip_viewer_drc_detail_scroll")
                            .max_height(popup_height - 52.0)
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                for line in lines {
                                    info_panel_label(ui, line);
                                }
                            });
                    });
            });
    }

    fn antenna_detail_overlay(&mut self, ui: &mut egui::Ui, canvas: egui::Rect) {
        let Some(selected_id) = self.selected_drc else {
            return;
        };
        let Some(violation) = self.antenna_overlay.as_ref().and_then(|overlay| {
            overlay
                .violations
                .iter()
                .find(|item| item.id == selected_id)
        }) else {
            self.selected_drc = None;
            return;
        };
        let title = format!("{} / {}", violation.antenna_type, violation.layer);
        let lines = antenna_detail_lines(violation);

        let ctx = ui.ctx().clone();
        let popup_width = (canvas.width() * 0.34)
            .clamp(340.0, 480.0)
            .min((canvas.width() - 24.0).max(220.0));
        let popup_height = (canvas.height() * 0.3)
            .clamp(190.0, 280.0)
            .min((canvas.height() - 24.0).max(150.0));
        let popup_pos = egui::pos2(
            canvas.left() + 12.0,
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0),
        );

        egui::Area::new(egui::Id::new("chip_viewer_antenna_detail_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0_f32, antenna_overlay_primary_color()))
                    .corner_radius(12)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        ui.set_min_size(egui::vec2(popup_width - 20.0, popup_height - 20.0));
                        ui.horizontal(|ui| {
                            ui.label(
                                egui::RichText::new(title)
                                    .strong()
                                    .size(14.0)
                                    .color(ecos_text_primary()),
                            );
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui
                                        .small_button("×")
                                        .on_hover_text("Hide Antenna detail")
                                        .clicked()
                                    {
                                        self.selected_drc = None;
                                    }
                                },
                            );
                        });
                        egui::ScrollArea::vertical()
                            .id_salt("chip_viewer_antenna_detail_scroll")
                            .max_height(popup_height - 52.0)
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                for line in lines {
                                    info_panel_label(ui, line);
                                }
                            });
                    });
            });
    }
}

impl eframe::App for ChipViewerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.theme_initialized {
            apply_ecos_theme(ctx);
            self.theme_initialized = true;
        }
        if !self.startup_focus_requested {
            ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
            self.startup_focus_requested = true;
        }
        self.poll_loading();
        let close_requested = ctx.input(|input| input.viewport().close_requested());
        let mut close_after_session_action = false;
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.poll_edit_result();
            loaded.poll_session_action_progress();
            close_after_session_action = loaded.poll_session_action_result();
            loaded.poll_external_snapshot_refresh();
            if close_requested && loaded.session_dirty {
                loaded.close_confirmation_visible = true;
                ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            }
            if let Some(interval) = edit_poll_repaint_interval(
                loaded.pending_edit.is_some() || loaded.pending_session_action.is_some(),
            ) {
                ctx.request_repaint_after(interval);
            } else {
                ctx.request_repaint_after(SNAPSHOT_REFRESH_CHECK_INTERVAL);
            }
        } else if matches!(self.state, ViewerState::Loading(_)) {
            ctx.request_repaint_after(Duration::from_millis(50));
        }
        if let ViewerState::Loaded(loaded) = &mut self.state {
            if loaded.has_analysis_panel() {
                egui::SidePanel::left("chip_viewer_analysis")
                    .resizable(true)
                    .min_width(240.0)
                    .max_width(380.0)
                    .default_width(292.0)
                    .show(ctx, |ui| loaded.analysis_sidebar(ui));
            }
        }
        egui::SidePanel::right("chip_viewer_operations")
            .resizable(true)
            .min_width(280.0)
            .max_width(460.0)
            .default_width(320.0)
            .show(ctx, |ui| self.sidebar(ui));
        egui::CentralPanel::default().show(ctx, |ui| {
            self.canvas(ui);
        });
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.show_close_confirmation(ctx);
            loaded.show_session_action_progress(ctx);
            loaded.show_shortcuts_overlay(ctx);
        }
        if close_after_session_action {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
}

fn loading_canvas(ui: &mut egui::Ui, loading: &LoadingViewer) {
    let available = ui.available_size();
    let (rect, _) = ui.allocate_exact_size(available, egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 0.0, ecos_canvas());

    let center = rect.center();
    painter.text(
        center + egui::vec2(0.0, -18.0),
        egui::Align2::CENTER_CENTER,
        "Loading geometry snapshot",
        egui::FontId::proportional(18.0),
        ecos_text_primary(),
    );
    painter.text(
        center + egui::vec2(0.0, 12.0),
        egui::Align2::CENTER_CENTER,
        format!("{:.1}s", loading.started_at.elapsed().as_secs_f32()),
        egui::FontId::proportional(13.0),
        ecos_text_secondary(),
    );
}

fn color32(rgba: [u8; 4]) -> egui::Color32 {
    egui::Color32::from_rgba_unmultiplied(rgba[0], rgba[1], rgba[2], rgba[3])
}

fn ecos_canvas() -> egui::Color32 {
    egui::Color32::from_rgb(24, 24, 28)
}

fn ecos_panel() -> egui::Color32 {
    egui::Color32::from_rgb(34, 34, 38)
}

fn ecos_border() -> egui::Color32 {
    egui::Color32::from_rgb(54, 54, 58)
}

fn ecos_text_primary() -> egui::Color32 {
    egui::Color32::from_rgb(227, 227, 232)
}

fn ecos_text_secondary() -> egui::Color32 {
    egui::Color32::from_rgb(161, 161, 170)
}

fn ecos_info_text() -> egui::Color32 {
    egui::Color32::from_rgb(216, 216, 224)
}

fn ecos_accent() -> egui::Color32 {
    egui::Color32::from_rgb(0, 191, 165)
}

fn ecos_warning() -> egui::Color32 {
    egui::Color32::from_rgb(251, 191, 36)
}

fn apply_ecos_theme(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.override_text_color = Some(ecos_text_primary());
    visuals.panel_fill = ecos_panel();
    visuals.window_fill = ecos_panel();
    visuals.extreme_bg_color = ecos_canvas();
    visuals.faint_bg_color = egui::Color32::from_rgb(40, 40, 45);
    visuals.window_stroke = egui::Stroke::new(1.0_f32, ecos_border());
    visuals.selection.bg_fill = egui::Color32::from_rgba_unmultiplied(0, 191, 165, 48);
    visuals.selection.stroke = egui::Stroke::new(1.0_f32, ecos_accent());
    visuals.widgets.noninteractive.bg_fill = ecos_panel();
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0_f32, ecos_border());
    visuals.widgets.inactive.bg_fill = ecos_canvas();
    visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0_f32, ecos_border());
    visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(39, 57, 57);
    visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0_f32, ecos_accent());
    visuals.widgets.active.bg_fill = egui::Color32::from_rgb(35, 72, 66);
    visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0_f32, ecos_accent());
    ctx.set_visuals(visuals);

    let mut style = (*ctx.style()).clone();
    style.spacing.button_padding = egui::vec2(8.0, 4.0);
    style.spacing.interact_size.y = 28.0;
    style.spacing.item_spacing = egui::vec2(8.0, 6.0);
    ctx.set_style(style);
}

fn section_heading(ui: &mut egui::Ui, label: &str) {
    ui.label(
        egui::RichText::new(label)
            .small()
            .strong()
            .color(ecos_accent()),
    );
}

fn analysis_tab_button(ui: &mut egui::Ui, label: &str, selected: bool) -> bool {
    let response = ui.add_sized(
        egui::vec2(52.0, 28.0),
        egui::Button::new(
            egui::RichText::new(label)
                .strong()
                .size(12.5)
                .color(if selected {
                    ecos_text_primary()
                } else {
                    ecos_text_secondary()
                }),
        )
        .frame(false),
    );
    if selected {
        ui.painter().line_segment(
            [
                egui::pos2(response.rect.left() + 8.0, response.rect.bottom()),
                egui::pos2(response.rect.right() - 8.0, response.rect.bottom()),
            ],
            egui::Stroke::new(2.0_f32, ecos_accent()),
        );
    }
    response.clicked()
}

fn spawn_map_thumbnail_worker() -> MapThumbnailWorker {
    let (request_sender, request_receiver) = mpsc::channel::<PathBuf>();
    let (result_sender, result_receiver) = mpsc::channel::<MapThumbnailResult>();
    thread::spawn(move || {
        while let Ok(path) = request_receiver.recv() {
            let decoded = decode_map_thumbnail(&path);
            if result_sender
                .send(MapThumbnailResult { path, decoded })
                .is_err()
            {
                break;
            }
        }
    });
    MapThumbnailWorker {
        request_sender,
        result_receiver,
    }
}

fn decode_map_thumbnail(path: &Path) -> Result<DecodedMapThumbnail, String> {
    let mut reader = image::ImageReader::open(path)
        .and_then(image::ImageReader::with_guessed_format)
        .map_err(|err| format!("failed to open map preview {}: {err}", path.display()))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAP_THUMBNAIL_MAX_DIMENSION);
    limits.max_image_height = Some(MAP_THUMBNAIL_MAX_DIMENSION);
    limits.max_alloc = Some(MAP_THUMBNAIL_MAX_DECODE_BYTES);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|err| format!("failed to decode map preview {}: {err}", path.display()))?
        .thumbnail(MAP_THUMBNAIL_WIDTH, MAP_THUMBNAIL_HEIGHT)
        .to_rgba8();
    Ok(DecodedMapThumbnail {
        size: [image.width() as usize, image.height() as usize],
        rgba: image.into_raw(),
    })
}

fn map_heatmap_layout(canvas: egui::Rect, rows: usize, columns: usize) -> (egui::Vec2, egui::Vec2) {
    let popup_width = (canvas.width() * MAP_HEATMAP_WIDTH_FRACTION)
        .clamp(MAP_HEATMAP_MIN_WIDTH, MAP_HEATMAP_MAX_WIDTH)
        .min((canvas.width() - 24.0).max(160.0));
    let content_width = (popup_width - 20.0).max(120.0);
    let mut grid_width = content_width.min(MAP_HEATMAP_MAX_GRID_SIZE);
    let mut grid_height = grid_width * rows.max(1) as f32 / columns.max(1) as f32;
    let max_grid_height = (canvas.height() - 118.0).clamp(60.0, MAP_HEATMAP_MAX_GRID_SIZE);
    if grid_height > max_grid_height {
        let scale = max_grid_height / grid_height;
        grid_width *= scale;
        grid_height = max_grid_height;
    }
    let popup_height =
        (grid_height + MAP_HEATMAP_VERTICAL_OVERHEAD).min((canvas.height() - 24.0).max(150.0));
    (
        egui::vec2(popup_width, popup_height),
        egui::vec2(grid_width, grid_height),
    )
}

fn paint_heatmap_grid(
    painter: &egui::Painter,
    rect: egui::Rect,
    data: &HeatmapData,
    selected_cell: Option<(usize, usize)>,
    colormap_mode: ColormapMode,
    threshold: f32,
    invert_threshold: bool,
) {
    let rows = data.rows().max(1);
    let columns = data.columns().max(1);
    let cell_width = rect.width() / columns as f32;
    let cell_height = rect.height() / rows as f32;
    painter.rect_filled(rect, 2.0, ecos_canvas());
    for row in 0..rows {
        for column in 0..columns {
            let Some(normalized) = data.normalized_value(row, column) else {
                continue;
            };
            let hidden = if !invert_threshold {
                normalized < threshold
            } else {
                normalized > threshold
            };
            if hidden {
                continue;
            }
            let cell = heatmap_cell_rect(rect, rows, columns, row, column);
            let [r, g, b, _] = colormap_mode.sample(normalized);
            painter.rect_filled(cell, 0.0, egui::Color32::from_rgb(r, g, b));
        }
    }
    painter.rect_stroke(
        rect,
        2.0,
        egui::Stroke::new(1.0_f32, ecos_border()),
        egui::StrokeKind::Inside,
    );
    if let Some((row, column)) = selected_cell {
        if row < rows && column < columns {
            paint_heatmap_cell_outline(
                painter,
                rect,
                rows,
                columns,
                row,
                column,
                egui::Stroke::new(2.0_f32, egui::Color32::WHITE),
            );
        }
    }

    if cell_width >= 8.0 && cell_height >= 8.0 {
        let stroke = egui::Stroke::new(0.5_f32, egui::Color32::from_black_alpha(48));
        for column in 1..columns {
            let x = rect.left() + column as f32 * cell_width;
            painter.line_segment(
                [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                stroke,
            );
        }
        for row in 1..rows {
            let y = rect.top() + row as f32 * cell_height;
            painter.line_segment(
                [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
                stroke,
            );
        }
    }
}

fn paint_heatmap_legend(
    ui: &mut egui::Ui,
    min: f64,
    max: f64,
    colormap_mode: ColormapMode,
    threshold: &mut f32,
    invert_threshold: &mut bool,
) -> (bool, bool, bool) {
    let mut threshold_changed = false;
    let mut invert_changed = false;
    let mut peak_clicked = false;
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), 10.0),
        egui::Sense::click_and_drag(),
    );

    if response.clicked() || response.dragged() {
        if let Some(pos) = response.interact_pointer_pos() {
            let t = ((pos.x - rect.left()) / rect.width()).clamp(0.0, 1.0);
            if (*threshold - t).abs() > 0.001 {
                *threshold = t;
                threshold_changed = true;
            }
        }
    }

    let painter = ui.painter_at(rect);
    let segments = 64;
    for segment in 0..segments {
        let t0 = segment as f32 / segments as f32;
        let t1 = (segment + 1) as f32 / segments as f32;
        let mid = (t0 + t1) * 0.5;
        let [r, g, b, _] = colormap_mode.sample(mid);
        let is_sub = if !*invert_threshold {
            mid < *threshold
        } else {
            mid > *threshold
        };
        let color = if is_sub {
            // Defocused / dimmed representation for inactive portion
            egui::Color32::from_rgba_unmultiplied(r / 4 + 15, g / 4 + 15, b / 4 + 15, 120)
        } else {
            egui::Color32::from_rgb(r, g, b)
        };
        painter.rect_filled(
            egui::Rect::from_min_max(
                egui::pos2(egui::lerp(rect.x_range(), t0), rect.top()),
                egui::pos2(egui::lerp(rect.x_range(), t1), rect.bottom()),
            ),
            0.0,
            color,
        );
    }

    // Border around legend
    painter.rect_stroke(
        rect,
        0.0,
        egui::Stroke::new(1.0_f32, ecos_border()),
        egui::StrokeKind::Inside,
    );

    // Indicator line at threshold cutoff position
    if *threshold > 0.001 {
        let handle_x = egui::lerp(rect.x_range(), *threshold);
        painter.line_segment(
            [
                egui::pos2(handle_x, rect.top() - 2.0),
                egui::pos2(handle_x, rect.bottom() + 2.0),
            ],
            egui::Stroke::new(2.0_f32, egui::Color32::WHITE),
        );
    }

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(format_map_value(min))
                .monospace()
                .size(10.0)
                .color(ecos_text_secondary()),
        );
        if ui
            .small_button("Peak")
            .on_hover_text("Focus camera on the maximum hotspot cell")
            .clicked()
        {
            peak_clicked = true;
        }
        let invert_label = if *invert_threshold {
            "Coldspots"
        } else {
            "Hotspots"
        };
        if ui
            .small_button(invert_label)
            .on_hover_text("Toggle between filtering hotspots (normal) and coldspots (inverted)")
            .clicked()
        {
            *invert_threshold = !*invert_threshold;
            invert_changed = true;
        }

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(
                egui::RichText::new(format_map_value(max))
                    .monospace()
                    .size(10.0)
                    .color(ecos_text_secondary()),
            );
            if *threshold > 0.001 && *threshold < 0.999 {
                let thresh_val = min + (*threshold as f64) * (max - min);
                let label_str = if !*invert_threshold {
                    format!("cutoff: ≥ {}", format_map_value(thresh_val))
                } else {
                    format!("cutoff: ≤ {}", format_map_value(thresh_val))
                };
                ui.label(
                    egui::RichText::new(label_str)
                        .monospace()
                        .size(10.0)
                        .color(ecos_accent()),
                );
            }
        });
    });

    (threshold_changed, invert_changed, peak_clicked)
}

fn heatmap_cell_at(
    pos: egui::Pos2,
    rect: egui::Rect,
    rows: usize,
    columns: usize,
) -> Option<(usize, usize)> {
    if !rect.contains(pos) || rows == 0 || columns == 0 {
        return None;
    }
    let column = (((pos.x - rect.left()) / rect.width()) * columns as f32)
        .floor()
        .clamp(0.0, (columns - 1) as f32) as usize;
    let row = (((pos.y - rect.top()) / rect.height()) * rows as f32)
        .floor()
        .clamp(0.0, (rows - 1) as f32) as usize;
    Some((row, column))
}

fn interactive_heatmap_cell_at(
    pos: egui::Pos2,
    rect: egui::Rect,
    data: &HeatmapData,
) -> Option<(usize, usize)> {
    heatmap_cell_at(pos, rect, data.rows(), data.columns())
        .filter(|(row, column)| data.value(*row, *column).is_some())
}

fn heatmap_cell_rect(
    rect: egui::Rect,
    rows: usize,
    columns: usize,
    row: usize,
    column: usize,
) -> egui::Rect {
    let cell_width = rect.width() / columns.max(1) as f32;
    let cell_height = rect.height() / rows.max(1) as f32;
    egui::Rect::from_min_max(
        egui::pos2(
            rect.left() + column as f32 * cell_width,
            rect.top() + row as f32 * cell_height,
        ),
        egui::pos2(
            rect.left() + (column + 1) as f32 * cell_width,
            rect.top() + (row + 1) as f32 * cell_height,
        ),
    )
}

fn paint_heatmap_cell_outline(
    painter: &egui::Painter,
    rect: egui::Rect,
    rows: usize,
    columns: usize,
    row: usize,
    column: usize,
    stroke: egui::Stroke,
) {
    painter.rect_stroke(
        heatmap_cell_rect(rect, rows, columns, row, column).expand(1.0),
        0.0,
        stroke,
        egui::StrokeKind::Inside,
    );
}

fn format_map_value(value: f64) -> String {
    let magnitude = value.abs();
    if magnitude == 0.0 {
        "0".to_string()
    } else if magnitude >= 1000.0 || magnitude < 0.001 {
        format!("{value:.3e}")
    } else if magnitude >= 1.0 {
        format!("{value:.3}")
    } else {
        format!("{value:.5}")
    }
}

fn contextual_map_focus_bbox(bbox: Rect32) -> Rect32 {
    let width = i64::from(bbox.hx) - i64::from(bbox.lx);
    let height = i64::from(bbox.hy) - i64::from(bbox.ly);
    let half_extent = width.max(height).max(1);
    let center_x = (i64::from(bbox.lx) + i64::from(bbox.hx)) / 2;
    let center_y = (i64::from(bbox.ly) + i64::from(bbox.hy)) / 2;
    Rect32 {
        lx: clamp_i64_to_i32(center_x - half_extent),
        ly: clamp_i64_to_i32(center_y - half_extent),
        hx: clamp_i64_to_i32(center_x + half_extent),
        hy: clamp_i64_to_i32(center_y + half_extent),
    }
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn paint_map_selection_overlay(
    painter: &egui::Painter,
    bbox: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) {
    let rect = world_to_screen_rect(bbox, world, canvas, zoom, pan);
    painter.rect_filled(
        rect,
        0.0,
        egui::Color32::from_rgba_unmultiplied(0, 191, 165, 36),
    );
    painter.rect_stroke(
        rect.expand(1.5),
        0.0,
        egui::Stroke::new(2.0_f32, ecos_accent()),
        egui::StrokeKind::Inside,
    );
}

fn info_panel_label(ui: &mut egui::Ui, text: impl Into<String>) {
    ui.label(egui::RichText::new(text).size(12.5).color(ecos_info_text()));
}

fn drc_type_card(ui: &mut egui::Ui, state: &mut DrcTypeState) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgb(30, 30, 34))
        .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
        .corner_radius(8)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.checkbox(&mut state.visible, "");
                ui.label(
                    egui::RichText::new(&state.name)
                        .strong()
                        .size(13.5)
                        .color(ecos_text_primary()),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(state.total_count.to_string())
                            .size(12.5)
                            .color(ecos_info_text()),
                    );
                });
            });
            let layer_summary = drc_layer_counts_summary(&state.layer_counts);
            if !layer_summary.is_empty() {
                ui.add_space(2.0);
                ui.label(
                    egui::RichText::new(layer_summary)
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
        });
}

fn antenna_type_card(ui: &mut egui::Ui, state: &mut AntennaTypeState) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgb(30, 30, 34))
        .stroke(egui::Stroke::new(1.0_f32, ecos_border()))
        .corner_radius(8)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.checkbox(&mut state.visible, "");
                ui.label(
                    egui::RichText::new(&state.name)
                        .strong()
                        .size(13.5)
                        .color(ecos_text_primary()),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(state.total_count.to_string())
                            .size(12.5)
                            .color(ecos_info_text()),
                    );
                });
            });
            let layer_summary = antenna_layer_counts_summary(&state.layer_counts);
            if !layer_summary.is_empty() {
                ui.add_space(2.0);
                ui.label(
                    egui::RichText::new(layer_summary)
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
        });
}

fn drc_layer_counts_summary(layer_counts: &BTreeMap<String, usize>) -> String {
    const MAX_LAYER_SUMMARY_ITEMS: usize = 6;
    let mut parts = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .take(MAX_LAYER_SUMMARY_ITEMS)
        .map(|(layer, count)| format!("{layer}: {count}"))
        .collect::<Vec<_>>();
    let omitted = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .count()
        .saturating_sub(MAX_LAYER_SUMMARY_ITEMS);
    if omitted > 0 {
        parts.push(format!("+{omitted} layers"));
    }
    parts.join("  ")
}

fn antenna_layer_counts_summary(layer_counts: &BTreeMap<String, usize>) -> String {
    const MAX_LAYER_SUMMARY_ITEMS: usize = 6;
    let mut parts = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .take(MAX_LAYER_SUMMARY_ITEMS)
        .map(|(layer, count)| format!("{layer}: {count}"))
        .collect::<Vec<_>>();
    let omitted = layer_counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .count()
        .saturating_sub(MAX_LAYER_SUMMARY_ITEMS);
    if omitted > 0 {
        parts.push(format!("+{omitted} layers"));
    }
    parts.join("  ")
}

fn single_line_query_text(text: &str) -> String {
    text.chars()
        .map(|value| {
            if value == '\n' || value == '\r' {
                ' '
            } else {
                value
            }
        })
        .collect()
}

fn overview_tile_color(style: LayerStyle, shape_count: u32) -> egui::Color32 {
    let occupancy_alpha = 16.0 + (shape_count.max(1) as f32).sqrt() * 4.0;
    let alpha = occupancy_alpha.round().clamp(16.0, 52.0) as u8;
    egui::Color32::from_rgba_unmultiplied(style.rgba[0], style.rgba[1], style.rgba[2], alpha)
}

fn style_for_shape(style: LayerStyle, owner: Option<&OwnerRef>) -> LayerStyle {
    let style = match owner.and_then(|owner| OwnerType::from_raw(owner.owner_type)) {
        Some(OwnerType::Die | OwnerType::Core) => context_style(style, 170, 2),
        Some(OwnerType::Row) => context_style(style, 46, 1),
        Some(OwnerType::TrackGrid) => context_style(style, 82, 1),
        Some(OwnerType::GCellGrid) => context_style(style, 104, 2),
        Some(OwnerType::Obs) => owner_texture_style(style, 52, 190, FillPattern::CrossHatch, 1),
        Some(OwnerType::Via) => owner_texture_style(style, 48, 220, FillPattern::XMark, 1),
        Some(OwnerType::PinPortShape | OwnerType::InstancePinPortShape) => {
            owner_texture_style(style, 64, 215, FillPattern::Grid, 2)
        }
        Some(OwnerType::IoPinPortShape) => io_pin_texture_style(style),
        Some(OwnerType::NetWireSegment) => {
            let fill_alpha = style.fill_alpha.max(56);
            let frame_alpha = style.frame_alpha.max(210);
            let line_width_px = style.line_width_px;
            owner_texture_style(
                style,
                fill_alpha,
                frame_alpha,
                FillPattern::DiagonalHatch,
                line_width_px,
            )
        }
        Some(OwnerType::SpecialWireSegment) => {
            owner_texture_style(style, 76, 235, FillPattern::Grid, 2)
        }
        Some(OwnerType::InstanceBBox) => solid_owner_texture_style(style, 64, 172, 1),
        Some(OwnerType::InstanceHalo) => {
            owner_texture_style(style, 38, 156, FillPattern::HorizontalHatch, 1)
        }
        Some(OwnerType::Blockage) => {
            owner_texture_style(style, 66, 220, FillPattern::CrossHatch, 1)
        }
        Some(OwnerType::Fill) => owner_texture_style(style, 42, 150, FillPattern::SparseDots, 1),
        Some(OwnerType::Region) => {
            owner_texture_style(style, 36, 180, FillPattern::VerticalHatch, 1)
        }
        Some(OwnerType::Slot) => {
            owner_texture_style(style, 48, 190, FillPattern::HorizontalHatch, 1)
        }
        _ => style,
    };

    if style.layer_id == LAYOUT_GEOMETRY_LAYER {
        transparent_gray_layout_style(style)
    } else {
        style
    }
}

fn layout_geometry_layer_style() -> LayerStyle {
    LayerStyle {
        layer_id: LAYOUT_GEOMETRY_LAYER,
        visible: true,
        rgba: [
            LAYOUT_GEOMETRY_RGB[0],
            LAYOUT_GEOMETRY_RGB[1],
            LAYOUT_GEOMETRY_RGB[2],
            LAYOUT_GEOMETRY_MAX_FILL_ALPHA,
        ],
        frame_rgba: [
            LAYOUT_GEOMETRY_RGB[0],
            LAYOUT_GEOMETRY_RGB[1],
            LAYOUT_GEOMETRY_RGB[2],
            LAYOUT_GEOMETRY_MAX_FRAME_ALPHA,
        ],
        fill_alpha: LAYOUT_GEOMETRY_MAX_FILL_ALPHA,
        frame_alpha: LAYOUT_GEOMETRY_MAX_FRAME_ALPHA,
        fill_pattern: FillPattern::Hollow,
        line_width_px: 1,
    }
}

fn transparent_gray_layout_style(mut style: LayerStyle) -> LayerStyle {
    style.rgba = [
        LAYOUT_GEOMETRY_RGB[0],
        LAYOUT_GEOMETRY_RGB[1],
        LAYOUT_GEOMETRY_RGB[2],
        style.fill_alpha.min(LAYOUT_GEOMETRY_MAX_FILL_ALPHA),
    ];
    style.frame_rgba = [
        LAYOUT_GEOMETRY_RGB[0],
        LAYOUT_GEOMETRY_RGB[1],
        LAYOUT_GEOMETRY_RGB[2],
        style.frame_alpha.min(LAYOUT_GEOMETRY_MAX_FRAME_ALPHA),
    ];
    style.fill_alpha = style.rgba[3];
    style.frame_alpha = style.frame_rgba[3];
    style
}

fn io_pin_texture_style(mut style: LayerStyle) -> LayerStyle {
    style.rgba = [245, 190, 32, 104];
    style.frame_rgba = [255, 222, 89, 232];
    style.fill_alpha = style.rgba[3];
    style.frame_alpha = style.frame_rgba[3];
    style.fill_pattern = FillPattern::CrossHatch;
    style.line_width_px = 2;
    style
}

fn owner_texture_style(
    mut style: LayerStyle,
    fill_alpha: u8,
    frame_alpha: u8,
    fill_pattern: FillPattern,
    line_width_px: u8,
) -> LayerStyle {
    let rgb = layer_style_rgb(style);
    style.rgba = [rgb[0], rgb[1], rgb[2], fill_alpha];
    style.frame_rgba = [rgb[0], rgb[1], rgb[2], frame_alpha];
    style.fill_alpha = fill_alpha;
    style.frame_alpha = frame_alpha;
    style.fill_pattern = fill_pattern;
    style.line_width_px = line_width_px;
    style
}

fn solid_owner_texture_style(
    mut style: LayerStyle,
    fill_alpha: u8,
    frame_alpha: u8,
    line_width_px: u8,
) -> LayerStyle {
    let rgb = layer_style_rgb(style);
    style.rgba = [rgb[0], rgb[1], rgb[2], fill_alpha];
    style.frame_rgba = [rgb[0], rgb[1], rgb[2], frame_alpha];
    style.fill_alpha = fill_alpha;
    style.frame_alpha = frame_alpha;
    style.fill_pattern = FillPattern::Solid;
    style.line_width_px = line_width_px;
    style
}

fn layer_style_rgb(style: LayerStyle) -> [u8; 3] {
    [style.rgba[0], style.rgba[1], style.rgba[2]]
}

fn context_style(mut style: LayerStyle, frame_alpha: u8, line_width_px: u8) -> LayerStyle {
    let rgb = layer_style_rgb(style);
    style.rgba[3] = 0;
    style.fill_alpha = 0;
    style.fill_pattern = FillPattern::Hollow;
    style.frame_rgba = [rgb[0], rgb[1], rgb[2], frame_alpha];
    style.frame_alpha = frame_alpha;
    style.line_width_px = line_width_px;
    style
}

fn layer_ui_states(
    db: &ChipViewDb,
    visibility: &BTreeMap<LayerId, bool>,
    color_theme: chip_display::ColorTheme,
) -> Vec<LayerUiState> {
    db.layer_catalog()
        .into_iter()
        .enumerate()
        .map(|(index, summary)| {
            let style = LayerStyle::default_for_metadata_with_type(
                summary.layer_id,
                &summary.name,
                &summary.layer_type,
                index,
                color_theme,
            );
            let display_role = LayerRole::from_metadata(&summary.name, &summary.layer_type)
                .label()
                .to_string();
            LayerUiState {
                layer_id: summary.layer_id,
                shape_count: summary.shape_count,
                order: summary.order,
                name: summary.name,
                layer_type: summary.layer_type,
                display_role,
                direction: summary.direction,
                width: summary.width,
                pitch_x: summary.pitch_x,
                pitch_y: summary.pitch_y,
                min_spacing: summary.min_spacing,
                min_area: summary.min_area,
                min_step: summary.min_step,
                cut_spacing: summary.cut_spacing,
                enclosure_below: summary.enclosure_below,
                enclosure_above: summary.enclosure_above,
                lef58_rule_count: summary.lef58_rule_count,
                visible: visibility.get(&summary.layer_id).copied().unwrap_or(false),
                style,
            }
        })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum ScreenShapePrimitive {
    Rect(egui::Rect),
    Line {
        begin: egui::Pos2,
        end: egui::Pos2,
        width: f32,
    },
    Point {
        center: egui::Pos2,
        radius: f32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum ShapeLabelKind {
    IoPin,
    Pin,
    Net,
    Pdn,
    Instance,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum ShapeLabelKey {
    Named { kind: ShapeLabelKind, text: String },
    Owner { owner_type: u8, owner_id: u64 },
}

#[derive(Clone, Debug, PartialEq)]
struct ShapeLabelOverlay {
    key: ShapeLabelKey,
    rect: egui::Rect,
    text: String,
    kind: ShapeLabelKind,
    rank_area: f32,
}

#[derive(Clone, Debug, Default)]
struct ShapeLabelCollector {
    overlays: std::collections::HashMap<ShapeLabelKey, ShapeLabelOverlay>,
}

impl ShapeLabelCollector {
    fn insert(&mut self, overlay: ShapeLabelOverlay) {
        self.overlays
            .entry(overlay.key.clone())
            .and_modify(|current| {
                if overlay.rank_area > current.rank_area {
                    *current = overlay.clone();
                }
            })
            .or_insert(overlay);
    }

    fn len(&self) -> usize {
        self.overlays.len()
    }

    fn clear(&mut self) {
        self.overlays.clear();
    }

    fn binned_overlays(&self) -> Vec<&ShapeLabelOverlay> {
        // Bin labels into 32x32 screen-space grid to prevent overlapping
        let mut bins: std::collections::HashMap<(i32, i32), &ShapeLabelOverlay> =
            std::collections::HashMap::with_capacity(self.overlays.len());
        for overlay in self.overlays.values() {
            let cx = overlay.rect.center().x;
            let cy = overlay.rect.center().y;
            let bx = (cx / 32.0).floor() as i32;
            let by = (cy / 32.0).floor() as i32;

            bins.entry((bx, by))
                .and_modify(|current| {
                    if overlay.rank_area > current.rank_area {
                        *current = overlay;
                    }
                })
                .or_insert(overlay);
        }
        bins.into_values().collect()
    }

    fn overlays(&self) -> impl Iterator<Item = &ShapeLabelOverlay> {
        self.overlays.values()
    }
}

fn paint_styled_shape_geometry(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    style: &LayerStyle,
) -> usize {
    let primitive = shape_screen_primitive(geometry, world, canvas, zoom, pan);
    if !screen_primitive_bounds(primitive).intersects(canvas) {
        return 0;
    }

    match primitive {
        ScreenShapePrimitive::Rect(rect) => paint_styled_rect(painter, rect, canvas, *style),
        ScreenShapePrimitive::Line { begin, end, width } => {
            painter.line_segment(
                [begin, end],
                egui::Stroke::new(
                    width.max(style.line_width_px as f32),
                    color32(style.frame_rgba),
                ),
            );
            1
        }
        ScreenShapePrimitive::Point { center, radius } => {
            painter.circle_filled(center, radius, color32(style.frame_rgba));
            1
        }
    }
}

fn paint_styled_rect(
    painter: &egui::Painter,
    rect: egui::Rect,
    canvas: egui::Rect,
    style: LayerStyle,
) -> usize {
    let visible_rect = rect.intersect(canvas);
    if !visible_rect.is_positive() {
        return 0;
    }
    let mut primitives = 0usize;
    let can_pattern =
        visible_rect.width() >= PATTERN_MIN_SIZE_PX && visible_rect.height() >= PATTERN_MIN_SIZE_PX;
    let fill_color = color32(style.rgba);
    match style.fill_pattern {
        FillPattern::Hollow => {}
        FillPattern::Solid => {
            painter.rect_filled(visible_rect, 0.0, fill_color);
            primitives += 1;
        }
        FillPattern::SparseDots if can_pattern => {
            primitives += draw_pattern_dots(painter, visible_rect, fill_color, 9.0);
        }
        FillPattern::DenseDots if can_pattern => {
            primitives += draw_pattern_dots(painter, visible_rect, fill_color, 5.0);
        }
        FillPattern::DiagonalHatch if can_pattern => {
            primitives += draw_hatch(painter, visible_rect, fill_color, false);
        }
        FillPattern::CrossHatch if can_pattern => {
            primitives += draw_hatch(painter, visible_rect, fill_color, true);
        }
        FillPattern::HorizontalHatch if can_pattern => {
            primitives += draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Horizontal);
        }
        FillPattern::VerticalHatch if can_pattern => {
            primitives += draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Vertical);
        }
        FillPattern::Grid if can_pattern => {
            primitives += draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Horizontal);
            primitives += draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Vertical);
        }
        FillPattern::XMark => {
            painter.rect_filled(visible_rect, 0.0, fill_color);
            primitives += 1;
            if visible_rect.width() >= 6.0 && visible_rect.height() >= 6.0 {
                primitives += draw_x_mark(
                    painter,
                    visible_rect,
                    color32(style.frame_rgba),
                    style.line_width_px.max(1) as f32,
                );
            }
        }
        _ => {}
    }

    if rect.width() >= MIN_SHAPE_SCREEN_SIZE || rect.height() >= MIN_SHAPE_SCREEN_SIZE {
        let mut frame_rgba = style.frame_rgba;
        if rect.width() < PATTERN_MIN_SIZE_PX || rect.height() < PATTERN_MIN_SIZE_PX {
            frame_rgba[3] = frame_rgba[3].min(112);
        }
        painter.rect_stroke(
            rect,
            0.0,
            egui::Stroke::new(style.line_width_px.max(1) as f32, color32(frame_rgba)),
            egui::StrokeKind::Inside,
        );
        primitives += 1;
    }
    primitives
}

fn draw_pattern_dots(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    spacing: f32,
) -> usize {
    let mut count = 0usize;
    let mut y = rect.top() + 2.0;
    while y < rect.bottom() && count < MAX_PATTERN_OPS_PER_SHAPE {
        let mut x = rect.left() + 2.0;
        while x < rect.right() && count < MAX_PATTERN_OPS_PER_SHAPE {
            painter.circle_filled(egui::pos2(x, y), 0.8, color);
            count += 1;
            x += spacing;
        }
        y += spacing;
    }
    count
}

fn draw_hatch(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    cross: bool,
) -> usize {
    let mut count = draw_hatch_direction(painter, rect, color, false);
    if cross && count < MAX_PATTERN_OPS_PER_SHAPE {
        count += draw_hatch_direction(painter, rect, color, true);
    }
    count
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HatchAxis {
    Horizontal,
    Vertical,
}

fn draw_axis_hatch(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    axis: HatchAxis,
) -> usize {
    let mut count = 0usize;
    let mut offset = 4.0;
    while offset <= rect.width().max(rect.height()) && count < MAX_PATTERN_OPS_PER_SHAPE {
        match axis {
            HatchAxis::Horizontal => {
                let y = rect.top() + offset;
                if y <= rect.bottom() {
                    painter.line_segment(
                        [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
                        egui::Stroke::new(1.0_f32, color),
                    );
                    count += 1;
                }
            }
            HatchAxis::Vertical => {
                let x = rect.left() + offset;
                if x <= rect.right() {
                    painter.line_segment(
                        [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                        egui::Stroke::new(1.0_f32, color),
                    );
                    count += 1;
                }
            }
        }
        offset += 10.0;
    }
    count
}

fn draw_x_mark(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    width: f32,
) -> usize {
    let inset = 1.5_f32.min(rect.width() * 0.2).min(rect.height() * 0.2);
    let rect = rect.shrink(inset);
    if !rect.is_positive() {
        return 0;
    }
    let stroke = egui::Stroke::new(width, color);
    painter.line_segment([rect.left_top(), rect.right_bottom()], stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], stroke);
    2
}

fn paint_render_stats_overlay(
    painter: &egui::Painter,
    canvas: egui::Rect,
    stats: &CanvasRenderStats,
) {
    let margin = 10.0;
    let overlay_width = 320.0;
    let overlay_height = 110.0;
    let top_right = egui::pos2(
        canvas.right() - margin - overlay_width,
        canvas.top() + margin,
    );
    let rect = egui::Rect::from_min_size(top_right, egui::vec2(overlay_width, overlay_height));

    painter.rect_filled(rect, 6.0, egui::Color32::from_black_alpha(200));
    painter.rect_stroke(
        rect,
        6.0,
        egui::Stroke::new(1.0_f32, ecos_border()),
        egui::StrokeKind::Outside,
    );

    let lines = [
        format!(
            "Frame: {:.2} ms | Paint: {:.2} ms | Labels: {:.2} ms",
            stats.frame_time_ms, stats.paint_time_ms, stats.label_paint_time_ms
        ),
        format!(
            "Query: {:.2} ms | Filter: {:.2} ms",
            stats.query_time_ms, stats.filter_time_ms
        ),
        format!(
            "Engine: {} | Mode: {} | Zoom: {:.2}",
            if stats.is_gpu { "GPU" } else { "CPU Fallback" },
            if stats.use_view_tiles {
                "Tiles"
            } else {
                "Exact"
            },
            stats.zoom
        ),
        format!(
            "Shapes: {} | Est Primitives: {}",
            stats.drawn_shapes, stats.estimated_primitives
        ),
        format!(
            "Labels: {} | DRC: {} | Antenna: {}",
            stats.label_count, stats.visible_drc_count, stats.visible_antenna_count
        ),
    ];

    let font_id = egui::FontId::monospace(11.0);
    let text_color = egui::Color32::from_rgb(220, 225, 230);
    let mut y = rect.top() + 8.0;
    for line in lines {
        painter.text(
            egui::pos2(rect.left() + 10.0, y),
            egui::Align2::LEFT_TOP,
            line,
            font_id.clone(),
            text_color,
        );
        y += 18.0;
    }
}

fn shape_label_info(
    geometry: &ShapeGeometry,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
) -> Option<GpuCachedLabel> {
    let ShapeGeometry::Rect(rect) = geometry else {
        return None;
    };
    let owner = owner?;
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    let owner_name = owner_name?.trim();

    let kind = match owner_type {
        OwnerType::IoPinPortShape => ShapeLabelKind::IoPin,
        OwnerType::PinPortShape if owner.path0 == 0 => ShapeLabelKind::IoPin,
        OwnerType::PinPortShape | OwnerType::InstancePinPortShape => ShapeLabelKind::Pin,
        OwnerType::NetWireSegment => ShapeLabelKind::Net,
        OwnerType::SpecialWireSegment => ShapeLabelKind::Pdn,
        OwnerType::InstanceBBox => ShapeLabelKind::Instance,
        _ => return None,
    };
    let text = shape_label_text(kind, owner_type, owner, owner_name)?;
    let key = shape_label_key(kind, owner, owner_name);

    Some(GpuCachedLabel {
        key,
        rect: *rect,
        text,
        kind,
    })
}

fn shape_label_overlay(
    geometry: ShapeGeometry,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Option<ShapeLabelOverlay> {
    let ShapeGeometry::Rect(rect) = geometry else {
        return None;
    };
    let screen_rect = shape_screen_rect(rect, world, canvas, zoom, pan);
    let visible_rect = screen_rect.intersect(canvas);
    if !screen_rect.is_positive() || !visible_rect.is_positive() {
        return None;
    }
    if visible_rect.width() < 12.0 || visible_rect.height() < 8.0 {
        return None;
    }

    let owner = owner?;
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    let owner_name = owner_name?.trim();

    let kind = match owner_type {
        OwnerType::IoPinPortShape => ShapeLabelKind::IoPin,
        OwnerType::PinPortShape if owner.path0 == 0 => ShapeLabelKind::IoPin,
        OwnerType::PinPortShape | OwnerType::InstancePinPortShape => ShapeLabelKind::Pin,
        OwnerType::NetWireSegment => ShapeLabelKind::Net,
        OwnerType::SpecialWireSegment => ShapeLabelKind::Pdn,
        OwnerType::InstanceBBox => ShapeLabelKind::Instance,
        _ => return None,
    };
    let text = shape_label_text(kind, owner_type, owner, owner_name)?;
    let key = shape_label_key(kind, owner, owner_name);

    Some(ShapeLabelOverlay {
        key,
        rect: screen_rect,
        text,
        kind,
        rank_area: visible_rect.width() * visible_rect.height(),
    })
}

fn shape_label_text(
    kind: ShapeLabelKind,
    owner_type: OwnerType,
    owner: &OwnerRef,
    owner_name: &str,
) -> Option<String> {
    let text = match kind {
        ShapeLabelKind::Pin
            if matches!(
                owner_type,
                OwnerType::PinPortShape | OwnerType::InstancePinPortShape
            ) && owner.path0 != 0 =>
        {
            local_shape_label_name(owner_name)
        }
        _ => owner_name,
    }
    .trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn local_shape_label_name(name: &str) -> &str {
    name.rsplit_once('/')
        .map(|(_, local_name)| local_name)
        .unwrap_or(name)
}

fn shape_label_key(kind: ShapeLabelKind, owner: &OwnerRef, owner_name: &str) -> ShapeLabelKey {
    match kind {
        ShapeLabelKind::IoPin | ShapeLabelKind::Net | ShapeLabelKind::Pdn => ShapeLabelKey::Named {
            kind,
            text: owner_name.trim().to_string(),
        },
        ShapeLabelKind::Pin | ShapeLabelKind::Instance => ShapeLabelKey::Owner {
            owner_type: owner.owner_type,
            owner_id: owner.owner_id,
        },
    }
}

fn paint_shape_label_overlay(
    painter: &egui::Painter,
    overlay: &ShapeLabelOverlay,
    canvas: egui::Rect,
) -> bool {
    let rect = overlay.rect.intersect(canvas);
    if !rect.is_positive() {
        return false;
    }

    let (min_size, max_size, color) = match overlay.kind {
        ShapeLabelKind::IoPin => (
            7.0,
            12.0,
            egui::Color32::from_rgba_unmultiplied(42, 32, 8, 210),
        ),
        ShapeLabelKind::Pin => (
            6.0,
            10.0,
            egui::Color32::from_rgba_unmultiplied(245, 249, 255, 210),
        ),
        ShapeLabelKind::Net => (
            6.0,
            11.0,
            egui::Color32::from_rgba_unmultiplied(232, 250, 255, 190),
        ),
        ShapeLabelKind::Pdn => (
            6.0,
            11.0,
            egui::Color32::from_rgba_unmultiplied(255, 239, 170, 215),
        ),
        ShapeLabelKind::Instance => (
            8.0,
            18.0,
            egui::Color32::from_rgba_unmultiplied(235, 238, 242, 110),
        ),
    };

    let Some(font_size) = centered_label_font_size(rect, &overlay.text, min_size, max_size) else {
        return false;
    };

    let clipped = painter.with_clip_rect(rect.shrink(1.0));
    clipped.text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        &overlay.text,
        egui::FontId::proportional(font_size),
        color,
    );
    true
}

fn centered_label_font_size(
    rect: egui::Rect,
    text: &str,
    min_size: f32,
    max_size: f32,
) -> Option<f32> {
    if text.trim().is_empty() || !rect.is_positive() {
        return None;
    }
    let available_width = (rect.width() - 4.0).max(0.0);
    let available_height = (rect.height() - 2.0).max(0.0);
    if available_width < min_size * 2.0 || available_height < min_size {
        return None;
    }

    let char_count = text.chars().count().max(1) as f32;
    let width_fit = available_width / (char_count * 0.58);
    let height_fit = available_height * 0.58;
    let size = width_fit.min(height_fit).min(max_size);
    (size >= min_size).then_some(size)
}

fn draw_hatch_direction(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    reverse: bool,
) -> usize {
    let width = rect.width().floor() as i32;
    let height = rect.height().floor() as i32;
    let mut count = 0usize;
    let mut offset = -height;
    while offset <= width && count < MAX_PATTERN_OPS_PER_SHAPE {
        let begin = (-offset).max(0).min(height);
        let end = (width - offset).min(height);
        if end - begin >= 3 {
            let x0 = rect.left() + (offset + begin) as f32;
            let x1 = rect.left() + (offset + end) as f32;
            let (y0, y1) = if reverse {
                (rect.bottom() - begin as f32, rect.bottom() - end as f32)
            } else {
                (rect.top() + begin as f32, rect.top() + end as f32)
            };
            painter.line_segment(
                [egui::pos2(x0, y0), egui::pos2(x1, y1)],
                egui::Stroke::new(1.0_f32, color),
            );
            count += 1;
        }
        offset += 8;
    }
    count
}

fn shape_screen_primitive(
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> ScreenShapePrimitive {
    match geometry {
        ShapeGeometry::Rect(rect) => {
            ScreenShapePrimitive::Rect(shape_screen_rect(rect, world, canvas, zoom, pan))
        }
        ShapeGeometry::Line(line) => {
            let scale = world_to_screen_scale(world, canvas, zoom);
            ScreenShapePrimitive::Line {
                begin: world_to_screen_point(line.begin, world, canvas, zoom, pan),
                end: world_to_screen_point(line.end, world, canvas, zoom, pan),
                width: ((line.width.abs().max(1)) as f32 * scale).max(MIN_SHAPE_SCREEN_SIZE),
            }
        }
        ShapeGeometry::Point(point) => ScreenShapePrimitive::Point {
            center: world_to_screen_point(point.point, world, canvas, zoom, pan),
            radius: MIN_SHAPE_SCREEN_SIZE,
        },
    }
}

fn shape_overlay_primitive(
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> ScreenShapePrimitive {
    shape_screen_primitive(geometry, world, canvas, zoom, pan)
}

fn paint_shape_overlay(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    stroke: egui::Stroke,
) -> bool {
    let primitive = shape_overlay_primitive(geometry, world, canvas, zoom, pan);
    if !screen_primitive_bounds(primitive).intersects(canvas) {
        return false;
    }

    match primitive {
        ScreenShapePrimitive::Rect(rect) => {
            painter.rect_stroke(rect.expand(1.5), 0.0, stroke, egui::StrokeKind::Inside);
        }
        ScreenShapePrimitive::Line { begin, end, .. } => {
            painter.line_segment([begin, end], stroke);
        }
        ScreenShapePrimitive::Point { center, radius } => {
            painter.circle_stroke(center, radius + 1.5, stroke);
        }
    }
    true
}

fn search_highlight_outer_stroke() -> egui::Stroke {
    egui::Stroke::new(4.0_f32, egui::Color32::from_rgb(255, 64, 192))
}

fn search_highlight_inner_stroke() -> egui::Stroke {
    egui::Stroke::new(1.5_f32, egui::Color32::from_rgb(255, 248, 210))
}

fn paint_search_highlight_overlay(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> bool {
    let outer = paint_shape_overlay(
        painter,
        geometry,
        world,
        canvas,
        zoom,
        pan,
        search_highlight_outer_stroke(),
    );
    let inner = paint_shape_overlay(
        painter,
        geometry,
        world,
        canvas,
        zoom,
        pan,
        search_highlight_inner_stroke(),
    );
    outer || inner
}

fn drc_overlay_primary_color() -> egui::Color32 {
    egui::Color32::from_rgb(250, 250, 255)
}

fn antenna_overlay_primary_color() -> egui::Color32 {
    egui::Color32::from_rgb(250, 250, 255)
}

fn drc_overlay_secondary_color() -> egui::Color32 {
    egui::Color32::from_rgb(0, 191, 165)
}

fn antenna_overlay_secondary_color() -> egui::Color32 {
    egui::Color32::from_rgb(0, 191, 165)
}

fn drc_violation_screen_rect(
    violation: &DrcViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    expand_screen_rect_to_min_size(
        world_to_screen_rect(violation.bbox, world, canvas, zoom, pan),
        8.0,
    )
}

fn antenna_violation_screen_rect(
    violation: &AntennaViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    expand_screen_rect_to_min_size(
        world_to_screen_rect(violation.bbox, world, canvas, zoom, pan),
        8.0,
    )
}

fn paint_drc_violation_overlay(
    painter: &egui::Painter,
    violation: &DrcViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    selected: bool,
) -> bool {
    let rect = drc_violation_screen_rect(violation, world, canvas, zoom, pan);
    if !rect.intersects(canvas) {
        return false;
    }

    let stroke = egui::Stroke::new(
        if selected { 4.0_f32 } else { 3.0_f32 },
        if selected {
            drc_overlay_secondary_color()
        } else {
            drc_overlay_primary_color()
        },
    );
    let inner_stroke = egui::Stroke::new(1.5_f32, drc_overlay_primary_color());
    let rect = rect.expand(1.5);
    painter.rect_stroke(rect, 0.0, stroke, egui::StrokeKind::Inside);
    painter.line_segment([rect.left_top(), rect.right_bottom()], inner_stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], inner_stroke);
    true
}

fn paint_antenna_violation_overlay(
    painter: &egui::Painter,
    violation: &AntennaViolation,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    selected: bool,
) -> bool {
    let rect = antenna_violation_screen_rect(violation, world, canvas, zoom, pan);
    if !rect.intersects(canvas) {
        return false;
    }

    let stroke = egui::Stroke::new(
        if selected { 4.0_f32 } else { 3.0_f32 },
        if selected {
            antenna_overlay_secondary_color()
        } else {
            antenna_overlay_primary_color()
        },
    );
    let inner_stroke = egui::Stroke::new(1.5_f32, antenna_overlay_primary_color());
    let rect = rect.expand(1.5);
    painter.rect_stroke(rect, 0.0, stroke, egui::StrokeKind::Inside);
    painter.line_segment([rect.left_top(), rect.right_bottom()], inner_stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], inner_stroke);
    true
}

fn drc_detail_lines(violation: &DrcViolation) -> Vec<String> {
    let mut lines = vec![
        format!("type: {}", violation.drc_type),
        format!("layer: {}", violation.layer),
        format!(
            "bbox: ({}, {}) - ({}, {})",
            violation.bbox.lx, violation.bbox.ly, violation.bbox.hx, violation.bbox.hy
        ),
    ];
    if let Some(required_size) = violation.required_size {
        lines.push(format!("required size: {required_size}"));
    }
    if !violation.nets.is_empty() {
        lines.push(format!("nets: {}", violation.nets.join(", ")));
    }
    if !violation.insts.is_empty() {
        lines.push(format!("instances: {}", violation.insts.join(", ")));
    }
    lines
}

fn antenna_detail_lines(violation: &AntennaViolation) -> Vec<String> {
    let mut lines = vec![
        format!("type: {}", violation.antenna_type),
        format!("layer: {}", violation.layer),
        format!(
            "bbox: ({}, {}) - ({}, {})",
            violation.bbox.lx, violation.bbox.ly, violation.bbox.hx, violation.bbox.hy
        ),
    ];
    if let Some(required_size) = violation.required_size {
        lines.push(format!("required size: {required_size}"));
    }
    if !violation.nets.is_empty() {
        lines.push(format!("nets: {}", violation.nets.join(", ")));
    }
    if !violation.insts.is_empty() {
        lines.push(format!("instances: {}", violation.insts.join(", ")));
    }
    lines
}

fn paint_parameterized_grid_overlay(
    painter: &egui::Painter,
    grids: &[GridMetadata],
    layers: &[LayerUiState],
    visibility: ObjectVisibility,
    viewport: Rect32,
    grid_bounds: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> usize {
    let mut drawn = 0usize;
    for grid in grids {
        if !parameterized_grid_is_visible(grid, layers, visibility, zoom) {
            continue;
        }
        let Some(owner_type) = grid_owner_type(grid) else {
            continue;
        };
        let stroke = parameterized_grid_stroke(grid, layers, owner_type);
        let Some(grid_viewport) = intersect_rect(viewport, grid_bounds) else {
            continue;
        };
        for index in grid_visible_indices(grid, grid_viewport) {
            let coordinate = saturating_i64_to_i32(grid_coordinate_at_index(grid, index));
            let Some((begin, end)) =
                parameterized_grid_line_endpoints(grid, coordinate, grid_viewport, grid_bounds)
            else {
                continue;
            };
            painter.line_segment(
                [
                    world_to_screen_point(begin, world, canvas, zoom, pan),
                    world_to_screen_point(end, world, canvas, zoom, pan),
                ],
                stroke,
            );
            drawn += 1;
        }
    }
    drawn
}

fn paint_unrouted_net_guides(
    painter: &egui::Painter,
    guides: &[UnroutedNetGuide],
    visibility: ObjectVisibility,
    viewport: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> usize {
    let mut drawn = 0usize;
    for guide in guides {
        if !unrouted_net_guide_is_visible(guide, visibility, viewport) {
            continue;
        }
        let category = net_kind_drawing_category(Some(&guide.net_kind));
        let stroke = unrouted_net_guide_stroke(category);
        let hub = world_to_screen_point(guide.hub, world, canvas, zoom, pan);
        if canvas.contains(hub) {
            painter.circle_filled(hub, 2.5, stroke.color);
        }
        for pin_center in &guide.pin_centers {
            let endpoint = world_to_screen_point(*pin_center, world, canvas, zoom, pan);
            if !screen_line_bounds(hub, endpoint).intersects(canvas) {
                continue;
            }
            if paint_dashed_line(painter, hub, endpoint, stroke, 8.0, 5.0) {
                drawn += 1;
            }
        }
    }
    drawn
}

fn unrouted_net_guide_is_visible(
    guide: &UnroutedNetGuide,
    visibility: ObjectVisibility,
    viewport: Rect32,
) -> bool {
    guide.bbox.intersects(viewport)
        && visibility.is_category_visible(net_kind_drawing_category(Some(&guide.net_kind)))
}

fn unrouted_net_guide_stroke(category: DrawingCategory) -> egui::Stroke {
    let color = match category {
        DrawingCategory::NetClock => egui::Color32::from_rgba_unmultiplied(255, 114, 216, 146),
        DrawingCategory::NetSignal => egui::Color32::from_rgba_unmultiplied(0, 191, 165, 132),
        DrawingCategory::NetOther => egui::Color32::from_rgba_unmultiplied(228, 176, 72, 132),
        _ => egui::Color32::from_rgba_unmultiplied(180, 190, 204, 120),
    };
    egui::Stroke::new(1.25_f32, color)
}

fn paint_dashed_line(
    painter: &egui::Painter,
    begin: egui::Pos2,
    end: egui::Pos2,
    stroke: egui::Stroke,
    dash_length: f32,
    gap_length: f32,
) -> bool {
    let segments = dashed_line_segments(begin, end, dash_length, gap_length);
    let painted = !segments.is_empty();
    for (dash_begin, dash_end) in segments {
        painter.line_segment([dash_begin, dash_end], stroke);
    }
    painted
}

fn dashed_line_segments(
    begin: egui::Pos2,
    end: egui::Pos2,
    dash_length: f32,
    gap_length: f32,
) -> Vec<(egui::Pos2, egui::Pos2)> {
    let delta = end - begin;
    let length = delta.length();
    if length <= 0.5 {
        return Vec::new();
    }

    let dash_length = dash_length.max(1.0);
    let step = (dash_length + gap_length.max(1.0)).max(2.0);
    let direction = delta / length;
    let mut segments = Vec::new();
    let mut offset = 0.0f32;
    while offset < length && segments.len() < 256 {
        let dash_end = (offset + dash_length).min(length);
        segments.push((begin + direction * offset, begin + direction * dash_end));
        offset += step;
    }
    segments
}

fn screen_line_bounds(begin: egui::Pos2, end: egui::Pos2) -> egui::Rect {
    egui::Rect::from_min_max(
        egui::pos2(begin.x.min(end.x), begin.y.min(end.y)),
        egui::pos2(begin.x.max(end.x), begin.y.max(end.y)),
    )
}

fn parameterized_grid_is_visible(
    grid: &GridMetadata,
    layers: &[LayerUiState],
    visibility: ObjectVisibility,
    zoom: f32,
) -> bool {
    let Some(owner_type) = grid_owner_type(grid) else {
        return false;
    };
    zoom > 1.25
        && visibility.includes_owner_type(owner_type as u8)
        && grid_layer_filter_is_visible(grid, layers)
        && grid.step > 0
        && grid.count > 0
}

fn grid_owner_type(grid: &GridMetadata) -> Option<OwnerType> {
    match grid.grid_type.trim().to_ascii_lowercase().as_str() {
        "track" => Some(OwnerType::TrackGrid),
        "gcell" => Some(OwnerType::GCellGrid),
        _ => None,
    }
}

fn grid_layer_filter_is_visible(grid: &GridMetadata, layers: &[LayerUiState]) -> bool {
    if grid.layer_names.is_empty() {
        return true;
    }
    grid.layer_names.iter().any(|name| {
        layers
            .iter()
            .any(|layer| layer.visible && layer.name.as_str() == name.as_str())
    })
}

fn parameterized_grid_stroke(
    grid: &GridMetadata,
    layers: &[LayerUiState],
    owner_type: OwnerType,
) -> egui::Stroke {
    if let Some(style) = grid_layer_style(grid, layers) {
        let (width, alpha) = match owner_type {
            OwnerType::TrackGrid => (1.0_f32, 82),
            OwnerType::GCellGrid => (2.0_f32, 104),
            _ => (1.0_f32, style.frame_alpha),
        };
        return egui::Stroke::new(
            width,
            egui::Color32::from_rgba_unmultiplied(
                style.rgba[0],
                style.rgba[1],
                style.rgba[2],
                alpha,
            ),
        );
    }

    match owner_type {
        OwnerType::TrackGrid => egui::Stroke::new(
            1.0_f32,
            egui::Color32::from_rgba_unmultiplied(
                LAYOUT_GEOMETRY_RGB[0],
                LAYOUT_GEOMETRY_RGB[1],
                LAYOUT_GEOMETRY_RGB[2],
                82,
            ),
        ),
        OwnerType::GCellGrid => egui::Stroke::new(
            2.0_f32,
            egui::Color32::from_rgba_unmultiplied(
                LAYOUT_GEOMETRY_RGB[0],
                LAYOUT_GEOMETRY_RGB[1],
                LAYOUT_GEOMETRY_RGB[2],
                104,
            ),
        ),
        _ => egui::Stroke::new(1.0_f32, ecos_text_secondary()),
    }
}

fn grid_layer_style<'a>(grid: &GridMetadata, layers: &'a [LayerUiState]) -> Option<&'a LayerStyle> {
    grid.layer_names.iter().find_map(|name| {
        layers
            .iter()
            .find(|layer| layer.visible && layer.name.as_str() == name.as_str())
            .map(|layer| &layer.style)
    })
}

fn parameterized_grid_line_endpoints(
    grid: &GridMetadata,
    coordinate: i32,
    viewport: Rect32,
    grid_bounds: Rect32,
) -> Option<(Point32, Point32)> {
    let bounds = intersect_rect(viewport, grid_bounds)?;
    match grid.direction.trim().to_ascii_lowercase().as_str() {
        "x" if coordinate >= bounds.lx && coordinate <= bounds.hx => Some((
            Point32 {
                x: coordinate,
                y: bounds.ly,
            },
            Point32 {
                x: coordinate,
                y: bounds.hy,
            },
        )),
        "y" if coordinate >= bounds.ly && coordinate <= bounds.hy => Some((
            Point32 {
                x: bounds.lx,
                y: coordinate,
            },
            Point32 {
                x: bounds.hx,
                y: coordinate,
            },
        )),
        _ => None,
    }
}

fn intersect_rect(lhs: Rect32, rhs: Rect32) -> Option<Rect32> {
    let intersection = Rect32 {
        lx: lhs.lx.max(rhs.lx),
        ly: lhs.ly.max(rhs.ly),
        hx: lhs.hx.min(rhs.hx),
        hy: lhs.hy.min(rhs.hy),
    };
    (intersection.lx <= intersection.hx && intersection.ly <= intersection.hy)
        .then_some(intersection)
}

fn grid_reference_bounds(db: &ChipViewDb) -> Option<Rect32> {
    grid_reference_bounds_from_records(db.snapshot().shapes(), db.snapshot().owners())
}

fn grid_reference_bounds_from_records(
    shapes: &[ShapeRecord],
    owners: &[OwnerRef],
) -> Option<Rect32> {
    shapes
        .iter()
        .filter(|shape| shape.state == ShapeState::Alive as u8)
        .filter_map(|shape| {
            owners
                .get(shape.owner_index as usize)
                .filter(|owner| owner.owner_type == OwnerType::Die as u8)
                .map(|_| shape.bbox)
        })
        .reduce(union_rect)
}

fn grid_visible_indices(grid: &GridMetadata, viewport: Rect32) -> Vec<u32> {
    let Some((first, last)) = grid_visible_index_range(grid, viewport) else {
        return Vec::new();
    };
    let total = (last - first + 1) as usize;
    let stride = total.div_ceil(MAX_PARAMETERIZED_GRID_LINES_PER_GRID).max(1);
    (first..=last).step_by(stride).collect()
}

fn grid_visible_index_range(grid: &GridMetadata, viewport: Rect32) -> Option<(u32, u32)> {
    if grid.step <= 0 || grid.count == 0 {
        return None;
    }
    let (min, max) = match grid.direction.trim().to_ascii_lowercase().as_str() {
        "x" => (viewport.lx as i64, viewport.hx as i64),
        "y" => (viewport.ly as i64, viewport.hy as i64),
        _ => return None,
    };
    let first = ceil_div_i64(min.saturating_sub(grid.start), grid.step).max(0);
    let last = floor_div_i64(max.saturating_sub(grid.start), grid.step)
        .min(grid.count.saturating_sub(1) as i64);
    if first > last {
        return None;
    }
    Some((first as u32, last as u32))
}

fn grid_coordinate_at_index(grid: &GridMetadata, index: u32) -> i64 {
    grid.start
        .saturating_add(grid.step.saturating_mul(index as i64))
}

fn floor_div_i64(numerator: i64, denominator: i64) -> i64 {
    numerator.div_euclid(denominator)
}

fn ceil_div_i64(numerator: i64, denominator: i64) -> i64 {
    let quotient = numerator.div_euclid(denominator);
    if numerator.rem_euclid(denominator) == 0 {
        quotient
    } else {
        quotient + 1
    }
}

fn saturating_i64_to_i32(value: i64) -> i32 {
    value.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

fn paint_scale_ruler(
    painter: &egui::Painter,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 || canvas.width() < 80.0 {
        return;
    }

    let target_px = (canvas.width() * 0.24).clamp(56.0, 120.0);
    let distance_dbu = nice_ruler_distance_dbu(target_px / scale);
    let length_px = distance_dbu as f32 * scale;
    if !length_px.is_finite() || length_px < 8.0 {
        return;
    }

    let start = egui::pos2(canvas.left() + 12.0, canvas.bottom() - 18.0);
    let end = egui::pos2((start.x + length_px).min(canvas.right() - 12.0), start.y);
    if end.x <= start.x + 4.0 {
        return;
    }

    let color = ecos_text_secondary();
    let stroke = egui::Stroke::new(1.0_f32, color);
    painter.line_segment([start, end], stroke);
    painter.line_segment(
        [start + egui::vec2(0.0, -4.0), start + egui::vec2(0.0, 4.0)],
        stroke,
    );
    painter.line_segment(
        [end + egui::vec2(0.0, -4.0), end + egui::vec2(0.0, 4.0)],
        stroke,
    );
    painter.text(
        start + egui::vec2(0.0, -18.0),
        egui::Align2::LEFT_BOTTOM,
        format_distance(distance_dbu, unit, dbu_per_micron),
        egui::FontId::monospace(11.0),
        color,
    );
}

fn layout_canvas_rect(frame: egui::Rect) -> egui::Rect {
    egui::Rect::from_min_max(
        egui::pos2(
            (frame.left() + COORDINATE_RULER_THICKNESS).min(frame.right()),
            frame.top(),
        ),
        egui::pos2(
            frame.right(),
            (frame.bottom() - COORDINATE_RULER_THICKNESS).max(frame.top()),
        ),
    )
}

fn paint_coordinate_rulers(
    painter: &egui::Painter,
    frame: egui::Rect,
    canvas: egui::Rect,
    world: Rect32,
    zoom: f32,
    pan: egui::Vec2,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 || !canvas.is_positive() {
        return;
    }

    let horizontal = egui::Rect::from_min_max(
        egui::pos2(canvas.left(), canvas.bottom()),
        frame.right_bottom(),
    );
    let vertical = egui::Rect::from_min_max(frame.left_top(), canvas.left_bottom());
    let background = egui::Color32::from_rgb(34, 35, 39);
    let tick_color = egui::Color32::from_rgb(91, 94, 101);
    let text_color = ecos_text_secondary();
    painter.rect_filled(horizontal, 0.0, background);
    painter.rect_filled(vertical, 0.0, background);
    painter.rect_filled(
        egui::Rect::from_min_max(
            egui::pos2(frame.left(), canvas.bottom()),
            egui::pos2(canvas.left(), frame.bottom()),
        ),
        0.0,
        background,
    );
    painter.line_segment(
        [canvas.left_top(), canvas.left_bottom()],
        egui::Stroke::new(1.0, tick_color),
    );
    painter.line_segment(
        [canvas.left_bottom(), canvas.right_bottom()],
        egui::Stroke::new(1.0, tick_color),
    );

    let viewport = screen_to_world_rect(canvas, world, canvas, zoom, pan);
    let major_interval = coordinate_ruler_interval_dbu(scale, unit, dbu_per_micron);
    let minor_interval = if major_interval >= 10 {
        major_interval / 10
    } else {
        major_interval
    }
    .max(1);
    let font = egui::FontId::monospace(9.0);
    let tick_stroke = egui::Stroke::new(1.0, tick_color);

    let mut x = floor_div_i64(i64::from(viewport.lx), minor_interval) * minor_interval;
    let mut last_label_right = f32::NEG_INFINITY;
    let mut tick_count = 0usize;
    while x <= i64::from(viewport.hx) && tick_count < MAX_PARAMETERIZED_GRID_LINES_PER_GRID {
        let point = Point32 {
            x: saturating_i64_to_i32(x),
            y: viewport.ly,
        };
        let screen_x = world_to_screen_point(point, world, canvas, zoom, pan).x;
        if screen_x < canvas.left() || screen_x > canvas.right() {
            x = x.saturating_add(minor_interval);
            tick_count += 1;
            continue;
        }
        let major = x.rem_euclid(major_interval) == 0;
        let height = if major {
            COORDINATE_RULER_THICKNESS * 0.6
        } else {
            COORDINATE_RULER_THICKNESS * 0.3
        };
        painter.line_segment(
            [
                egui::pos2(screen_x, frame.bottom() - height),
                egui::pos2(screen_x, frame.bottom()),
            ],
            tick_stroke,
        );
        if major && screen_x >= canvas.left() && screen_x >= last_label_right + 12.0 {
            let label = format_axis_coordinate(x, unit, dbu_per_micron);
            let rect = painter.text(
                egui::pos2(screen_x + 2.0, horizontal.top() + 2.0),
                egui::Align2::LEFT_TOP,
                label,
                font.clone(),
                text_color,
            );
            last_label_right = rect.right();
        }
        x = x.saturating_add(minor_interval);
        tick_count += 1;
    }

    let mut y = floor_div_i64(i64::from(viewport.ly), minor_interval) * minor_interval;
    let mut last_label_y = f32::NEG_INFINITY;
    let mut tick_count = 0usize;
    while y <= i64::from(viewport.hy) && tick_count < MAX_PARAMETERIZED_GRID_LINES_PER_GRID {
        let point = Point32 {
            x: viewport.lx,
            y: saturating_i64_to_i32(y),
        };
        let screen_y = world_to_screen_point(point, world, canvas, zoom, pan).y;
        if screen_y < canvas.top() || screen_y > canvas.bottom() {
            y = y.saturating_add(minor_interval);
            tick_count += 1;
            continue;
        }
        let major = y.rem_euclid(major_interval) == 0;
        let width = if major {
            COORDINATE_RULER_THICKNESS * 0.6
        } else {
            COORDINATE_RULER_THICKNESS * 0.3
        };
        painter.line_segment(
            [
                egui::pos2(canvas.left() - width, screen_y),
                egui::pos2(canvas.left(), screen_y),
            ],
            tick_stroke,
        );
        if major && screen_y < canvas.bottom() && (screen_y - last_label_y).abs() >= 40.0 {
            let label = format_axis_coordinate(y, unit, dbu_per_micron);
            let galley = painter.layout_no_wrap(label, font.clone(), text_color);
            let position = egui::pos2(vertical.left() + 2.0, screen_y + galley.size().x * 0.5);
            painter.add(
                egui::epaint::TextShape::new(position, galley, text_color)
                    .with_angle(-std::f32::consts::FRAC_PI_2),
            );
            last_label_y = screen_y;
        }
        y = y.saturating_add(minor_interval);
        tick_count += 1;
    }
}

fn coordinate_ruler_interval_dbu(
    scale: f32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> i64 {
    let target_dbu = f64::from(COORDINATE_RULER_TARGET_TICK_PX / scale.max(0.001));
    let interval = match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => nice_ruler_interval(target_dbu),
        CoordinateUnit::Micron => {
            let dbu_per_micron = dbu_per_micron.filter(|value| *value > 0).unwrap_or(1);
            nice_ruler_interval(target_dbu / f64::from(dbu_per_micron)) * f64::from(dbu_per_micron)
        }
    };
    interval.round().clamp(1.0, i32::MAX as f64) as i64
}

fn format_axis_coordinate(
    value_dbu: i64,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> String {
    let value = match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => value_dbu as f64,
        CoordinateUnit::Micron => {
            value_dbu as f64 / f64::from(dbu_per_micron.filter(|value| *value > 0).unwrap_or(1))
        }
    };
    let magnitude = value.abs();
    if magnitude >= 1_000_000.0 {
        format_compact_number(value / 1_000_000.0, "M")
    } else if magnitude >= 10_000.0 {
        format_compact_number(value / 1_000.0, "K")
    } else {
        format_compact_number(value, "")
    }
}

fn format_compact_number(value: f64, suffix: &str) -> String {
    let text = if (value - value.round()).abs() <= 0.000_5 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    };
    format!("{text}{suffix}")
}

fn orthogonal_ruler_point(anchor: Point32, pointer: Point32) -> Point32 {
    let dx = (i64::from(pointer.x) - i64::from(anchor.x)).abs();
    let dy = (i64::from(pointer.y) - i64::from(anchor.y)).abs();
    if dx >= dy {
        Point32 {
            x: pointer.x,
            y: anchor.y,
        }
    } else {
        Point32 {
            x: anchor.x,
            y: pointer.y,
        }
    }
}

fn nearest_orthogonal_edge_snap(
    anchor: Point32,
    pointer: Point32,
    rects: &[Rect32],
    radius: i32,
) -> Option<Point32> {
    let locked = orthogonal_ruler_point(anchor, pointer);
    let horizontal = locked.y == anchor.y;
    let max_distance_squared = i128::from(radius.max(0)).pow(2);
    let mut nearest: Option<(i128, Point32)> = None;
    let mut consider = |point: Point32| {
        let dx = i128::from(point.x) - i128::from(pointer.x);
        let dy = i128::from(point.y) - i128::from(pointer.y);
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= max_distance_squared
            && nearest.is_none_or(|(best, _)| distance_squared < best)
        {
            nearest = Some((distance_squared, point));
        }
    };

    for rect in rects {
        if horizontal && (rect.ly..=rect.hy).contains(&anchor.y) {
            consider(Point32 {
                x: rect.lx,
                y: anchor.y,
            });
            consider(Point32 {
                x: rect.hx,
                y: anchor.y,
            });
        } else if !horizontal && (rect.lx..=rect.hx).contains(&anchor.x) {
            consider(Point32 {
                x: anchor.x,
                y: rect.ly,
            });
            consider(Point32 {
                x: anchor.x,
                y: rect.hy,
            });
        }
    }
    nearest.map(|(_, point)| point)
}

fn ruler_distances(points: &[Point32], preview: Option<Point32>) -> (i64, i64) {
    let mut x_distance = 0i64;
    let mut y_distance = 0i64;
    let mut add_segment = |begin: Point32, end: Point32| {
        x_distance += (i64::from(end.x) - i64::from(begin.x)).abs();
        y_distance += (i64::from(end.y) - i64::from(begin.y)).abs();
    };
    for pair in points.windows(2) {
        add_segment(pair[0], pair[1]);
    }
    if let (Some(begin), Some(end)) = (points.last().copied(), preview) {
        add_segment(begin, end);
    }
    (x_distance, y_distance)
}

fn ruler_status_line(
    points: &[Point32],
    preview: Option<Point32>,
    active: bool,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> Option<String> {
    (!points.is_empty()).then(|| {
        let (x_distance, y_distance) = ruler_distances(points, preview);
        format!(
            "ruler{}: X {}, Y {}",
            if active { "" } else { " done" },
            format_distance_i64(x_distance, unit, dbu_per_micron),
            format_distance_i64(y_distance, unit, dbu_per_micron)
        )
    })
}

fn paint_orthogonal_ruler(
    painter: &egui::Painter,
    points: &[Point32],
    preview: Option<Point32>,
    snap_point: Option<Point32>,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) {
    if points.is_empty() {
        return;
    }
    let color = egui::Color32::from_rgb(240, 197, 78);
    let stroke = egui::Stroke::new(1.75, color);
    let paint_segment = |begin: Point32, end: Point32, pending: bool| {
        let begin_screen = world_to_screen_point(begin, world, canvas, zoom, pan);
        let end_screen = world_to_screen_point(end, world, canvas, zoom, pan);
        if pending {
            paint_dashed_line(painter, begin_screen, end_screen, stroke, 6.0, 4.0);
        } else {
            painter.line_segment([begin_screen, end_screen], stroke);
        }
        if begin == end {
            return;
        }
        let horizontal = begin.y == end.y;
        let distance = if horizontal {
            (i64::from(end.x) - i64::from(begin.x)).abs()
        } else {
            (i64::from(end.y) - i64::from(begin.y)).abs()
        };
        let label = format!(
            "{} {}",
            if horizontal { "X" } else { "Y" },
            format_distance_i64(distance, unit, dbu_per_micron)
        );
        let midpoint = begin_screen + (end_screen - begin_screen) * 0.5;
        let (position, align) = if horizontal {
            (
                midpoint + egui::vec2(0.0, -5.0),
                egui::Align2::CENTER_BOTTOM,
            )
        } else {
            (midpoint + egui::vec2(5.0, 0.0), egui::Align2::LEFT_CENTER)
        };
        painter.text(
            position + egui::vec2(1.0, 1.0),
            align,
            &label,
            egui::FontId::monospace(11.0),
            egui::Color32::from_black_alpha(220),
        );
        painter.text(position, align, label, egui::FontId::monospace(11.0), color);
    };

    for pair in points.windows(2) {
        paint_segment(pair[0], pair[1], false);
    }
    if let (Some(begin), Some(end)) = (points.last().copied(), preview) {
        paint_segment(begin, end, true);
    }
    for point in points {
        let screen = world_to_screen_point(*point, world, canvas, zoom, pan);
        painter.circle_filled(screen, 3.25, color);
        painter.circle_stroke(screen, 4.25, egui::Stroke::new(1.0, ecos_canvas()));
    }
    if let Some(point) = preview {
        let screen = world_to_screen_point(point, world, canvas, zoom, pan);
        painter.circle_stroke(screen, 3.5, egui::Stroke::new(1.5, color));
    }
    if let Some(point) = snap_point {
        let screen = world_to_screen_point(point, world, canvas, zoom, pan);
        painter.circle_stroke(screen, 6.5, egui::Stroke::new(1.5, color));
    }
}

fn paint_ruler_tool_icon(painter: &egui::Painter, rect: egui::Rect, color: egui::Color32) {
    let center = rect.center();
    let left = center.x - 8.0;
    let right = center.x + 8.0;
    let top = center.y - 4.0;
    let bottom = center.y + 4.0;
    let stroke = egui::Stroke::new(1.5, color);
    painter.line_segment(
        [egui::pos2(left, bottom), egui::pos2(right, bottom)],
        stroke,
    );
    for (x, height) in [
        (left, 8.0),
        (center.x - 4.0, 4.0),
        (center.x, 6.0),
        (center.x + 4.0, 4.0),
        (right, 8.0),
    ] {
        painter.line_segment(
            [egui::pos2(x, bottom - height), egui::pos2(x, bottom)],
            stroke,
        );
    }
    painter.line_segment(
        [egui::pos2(left, top), egui::pos2(left + 2.5, top + 2.5)],
        stroke,
    );
    painter.line_segment(
        [egui::pos2(right, top), egui::pos2(right - 2.5, top + 2.5)],
        stroke,
    );
}

fn screen_primitive_bounds(primitive: ScreenShapePrimitive) -> egui::Rect {
    match primitive {
        ScreenShapePrimitive::Rect(rect) => rect,
        ScreenShapePrimitive::Line { begin, end, width } => {
            egui::Rect::from_two_pos(begin, end).expand(width * 0.5)
        }
        ScreenShapePrimitive::Point { center, radius } => {
            egui::Rect::from_center_size(center, egui::vec2(radius * 2.0, radius * 2.0))
        }
    }
}

fn world_to_screen_scale(world: Rect32, canvas: egui::Rect, zoom: f32) -> f32 {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width).min(canvas.height() / world_height);
    base_scale * zoom.max(0.001)
}

fn world_to_screen_point(
    point: Point32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Pos2 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let center = canvas.center() + pan;
    egui::pos2(
        center.x + (point.x as f32 - world_cx) * scale,
        center.y - (point.y as f32 - world_cy) * scale,
    )
}

fn world_to_screen_rect(
    rect: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    egui::Rect::from_min_max(
        world_to_screen_point(
            Point32 {
                x: rect.lx,
                y: rect.hy,
            },
            world,
            canvas,
            zoom,
            pan,
        ),
        world_to_screen_point(
            Point32 {
                x: rect.hx,
                y: rect.ly,
            },
            world,
            canvas,
            zoom,
            pan,
        ),
    )
}

fn shape_screen_rect(
    rect: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    expand_screen_rect_to_min_size(
        world_to_screen_rect(rect, world, canvas, zoom, pan),
        MIN_SHAPE_SCREEN_SIZE,
    )
}

fn expand_screen_rect_to_min_size(rect: egui::Rect, min_size: f32) -> egui::Rect {
    let center = rect.center();
    let width = rect.width().max(min_size);
    let height = rect.height().max(min_size);
    egui::Rect::from_center_size(center, egui::vec2(width, height))
}

fn screen_to_world_rect(
    rect: egui::Rect,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Rect32 {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width).min(canvas.height() / world_height);
    let scale = (base_scale * zoom.max(0.001)).max(0.001);
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let center = canvas.center() + pan;
    let to_world = |pos: egui::Pos2| -> (i32, i32) {
        (
            (world_cx + (pos.x - center.x) / scale).round() as i32,
            (world_cy - (pos.y - center.y) / scale).round() as i32,
        )
    };
    let (x0, y0) = to_world(rect.left_bottom());
    let (x1, y1) = to_world(rect.right_top());
    Rect32 {
        lx: x0.min(x1),
        ly: y0.min(y1),
        hx: x0.max(x1),
        hy: y0.max(y1),
    }
}

fn screen_to_world_point(
    pos: egui::Pos2,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> Point32 {
    let rect = screen_to_world_rect(egui::Rect::from_min_max(pos, pos), world, canvas, zoom, pan);
    Point32 {
        x: rect.lx,
        y: rect.ly,
    }
}

fn screen_to_world_delta(
    delta: egui::Vec2,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
) -> (i32, i32) {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width).min(canvas.height() / world_height);
    let scale = (base_scale * zoom.max(0.001)).max(0.001);
    (
        (delta.x / scale).round() as i32,
        (-delta.y / scale).round() as i32,
    )
}

fn effective_coordinate_unit(unit: CoordinateUnit, dbu_per_micron: Option<u32>) -> CoordinateUnit {
    if unit.is_available(dbu_per_micron) {
        unit
    } else {
        CoordinateUnit::Dbu
    }
}

fn cursor_status_line(point: Point32, unit: CoordinateUnit, dbu_per_micron: Option<u32>) -> String {
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => format!("cursor: {} {} DBU", point.x, point.y),
        CoordinateUnit::Micron => format!(
            "cursor: {} {} um",
            format_micron(point.x, dbu_per_micron),
            format_micron(point.y, dbu_per_micron)
        ),
    }
}

/// Zero-allocation version: writes the hover status line into `buf` using fmt::Write.
fn hover_status_line_into(
    buf: &mut String,
    point: Point32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
    nearest: Option<NearestShape>,
) {
    use std::fmt::Write as _;
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => {
            let _ = write!(buf, "cursor: {} {} DBU", point.x, point.y);
        }
        CoordinateUnit::Micron => {
            let _ = write!(
                buf,
                "cursor: {} {} um",
                format_micron(point.x, dbu_per_micron),
                format_micron(point.y, dbu_per_micron)
            );
        }
    }
    if let Some(nearest) = nearest {
        let _ = write!(
            buf,
            ", nearest: shape {} d2 {}",
            nearest.shape_id, nearest.distance_squared
        );
    }
}

fn hover_status_line(
    point: Point32,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
    nearest: Option<NearestShape>,
) -> String {
    let cursor = cursor_status_line(point, unit, dbu_per_micron);
    match nearest {
        Some(nearest) => format!(
            "{cursor}, nearest: shape {} d2 {}",
            nearest.shape_id, nearest.distance_squared
        ),
        None => cursor,
    }
}

fn hover_nearest_radius_dbu(world: Rect32, canvas: egui::Rect, zoom: f32) -> i32 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 {
        return 0;
    }
    (HOVER_NEAREST_RADIUS_PX / scale).ceil().max(1.0) as i32
}

fn ruler_edge_snap_radius_dbu(world: Rect32, canvas: egui::Rect, zoom: f32) -> i32 {
    let scale = world_to_screen_scale(world, canvas, zoom);
    if !scale.is_finite() || scale <= 0.0 {
        return 0;
    }
    (RULER_EDGE_SNAP_RADIUS_PX / scale).ceil().max(1.0) as i32
}

fn format_distance(distance_dbu: i32, unit: CoordinateUnit, dbu_per_micron: Option<u32>) -> String {
    format_distance_i64(i64::from(distance_dbu), unit, dbu_per_micron)
}

fn format_distance_i64(
    distance_dbu: i64,
    unit: CoordinateUnit,
    dbu_per_micron: Option<u32>,
) -> String {
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => format!("{distance_dbu} DBU"),
        CoordinateUnit::Micron => {
            format!("{} um", format_micron_i64(distance_dbu, dbu_per_micron))
        }
    }
}

fn format_micron(value_dbu: i32, dbu_per_micron: Option<u32>) -> String {
    format_micron_i64(i64::from(value_dbu), dbu_per_micron)
}

fn format_micron_i64(value_dbu: i64, dbu_per_micron: Option<u32>) -> String {
    let dbu_per_micron = dbu_per_micron.filter(|value| *value > 0).unwrap_or(1);
    format!("{:.3}", value_dbu as f64 / dbu_per_micron as f64)
}

fn nice_ruler_distance_dbu(target_dbu: f32) -> i32 {
    nice_ruler_interval(f64::from(target_dbu))
        .round()
        .clamp(1.0, i32::MAX as f64) as i32
}

fn nice_ruler_interval(target: f64) -> f64 {
    if !target.is_finite() || target <= 0.0 {
        return 1.0;
    }
    let magnitude = 10_f64.powf(target.log10().floor());
    let normalized = target / magnitude;
    let nice = if normalized <= 1.0 {
        1.0
    } else if normalized <= 2.0 {
        2.0
    } else if normalized <= 5.0 {
        5.0
    } else {
        10.0
    };
    nice * magnitude
}

fn scroll_zoom_factor(scroll: f32) -> f32 {
    if scroll.abs() < f32::EPSILON {
        return 1.0;
    }
    let steps = if scroll.abs() <= 5.0 {
        scroll
    } else {
        scroll / 25.0
    };
    let base: f32 = 1.35;
    base.powf(steps).clamp(0.05, 20.0)
}

fn zoom_at_screen_pos(
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    zoom_factor: f32,
    cursor: egui::Pos2,
) -> (f32, egui::Vec2) {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width)
        .min(canvas.height() / world_height)
        .max(0.001);
    let old_zoom = zoom.max(0.001);
    let new_zoom = (zoom * zoom_factor).clamp(0.05, 50_000.0);
    let old_scale = base_scale * old_zoom;
    let new_scale = base_scale * new_zoom;
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let old_center = canvas.center() + pan;
    let cursor_world_x = world_cx + (cursor.x - old_center.x) / old_scale;
    let cursor_world_y = world_cy - (cursor.y - old_center.y) / old_scale;
    let new_pan = egui::vec2(
        cursor.x - canvas.center().x - (cursor_world_x - world_cx) * new_scale,
        cursor.y - canvas.center().y + (cursor_world_y - world_cy) * new_scale,
    );

    (new_zoom, new_pan)
}

fn translate_rect(rect: Rect32, dx: i32, dy: i32) -> Rect32 {
    Rect32 {
        lx: rect.lx.saturating_add(dx),
        ly: rect.ly.saturating_add(dy),
        hx: rect.hx.saturating_add(dx),
        hy: rect.hy.saturating_add(dy),
    }
}

fn rect_contains_with_margin(outer: Rect32, inner: Rect32, margin: f32) -> bool {
    let w = (outer.hx.saturating_sub(outer.lx)) as f32;
    let h = (outer.hy.saturating_sub(outer.ly)) as f32;
    let pad_x = (w * margin) as i32;
    let pad_y = (h * margin) as i32;
    inner.lx >= outer.lx.saturating_add(pad_x)
        && inner.hx <= outer.hx.saturating_sub(pad_x)
        && inner.ly >= outer.ly.saturating_add(pad_y)
        && inner.hy <= outer.hy.saturating_sub(pad_y)
}

fn expand_rect(rect: Rect32, factor: f32, world: Rect32) -> Rect32 {
    let cx = (rect.lx as f64 + rect.hx as f64) * 0.5;
    let cy = (rect.ly as f64 + rect.hy as f64) * 0.5;
    let half_w = ((rect.hx.saturating_sub(rect.lx)) as f64 * factor as f64 * 0.5).max(100.0);
    let half_h = ((rect.hy.saturating_sub(rect.ly)) as f64 * factor as f64 * 0.5).max(100.0);
    Rect32 {
        lx: ((cx - half_w).floor() as i32).max(world.lx),
        ly: ((cy - half_h).floor() as i32).max(world.ly),
        hx: ((cx + half_w).ceil() as i32)
            .min(world.hx)
            .max(world.lx + 1),
        hy: ((cy + half_h).ceil() as i32)
            .min(world.hy)
            .max(world.ly + 1),
    }
}

fn overview_lod_candidates(preferred_lod: u8) -> [u8; 4] {
    match preferred_lod {
        3 => [3, 2, 1, 0],
        2 => [2, 1, 0, 3],
        1 => [1, 0, 2, 3],
        _ => [0, 1, 2, 3],
    }
}

fn tile_is_useful_overview(tile: &chipgeom_format::GeometryViewTileRecord, world: Rect32) -> bool {
    tile.shape_count > 0 && !crate::canvas_gpu3d::tile_is_full_die(tile.bbox, world)
}

fn select_overview_lod(
    db: &ChipViewDb,
    layer_ids: &[LayerId],
    viewport: Rect32,
    world: Rect32,
) -> Option<u8> {
    crate::canvas_gpu3d::choose_overview_lod(
        [0_u8, 1, 2, 3].into_iter().map(|lod| {
            let mut total = 0usize;
            let mut useful = 0usize;
            for layer_id in layer_ids {
                for tile in db.query_view_tiles(lod, *layer_id, viewport) {
                    total += 1;
                    if tile_is_useful_overview(tile, world) {
                        useful += 1;
                    }
                }
            }
            (lod, total, useful)
        }),
        crate::canvas_gpu3d::OVERVIEW_INSTANCE_BUDGET,
    )
}

fn overview_tiles_for_layer<'a>(
    db: &'a ChipViewDb,
    preferred_lod: u8,
    layer_id: LayerId,
    viewport: Rect32,
    world: Rect32,
) -> Vec<&'a chipgeom_format::GeometryViewTileRecord> {
    for lod in overview_lod_candidates(preferred_lod) {
        let tiles: Vec<_> = db
            .query_view_tiles(lod, layer_id, viewport)
            .into_iter()
            .filter(|tile| tile_is_useful_overview(tile, world))
            .collect();
        if !tiles.is_empty() {
            return tiles;
        }
    }
    Vec::new()
}

fn should_use_view_tiles_for_state(
    view_tile_count: usize,
    _has_highlight: bool,
    _has_selection: bool,
    has_draft: bool,
    edit_enabled: bool,
    zoom: f32,
    viewport: Rect32,
    world: Rect32,
) -> bool {
    if view_tile_count == 0 {
        return false;
    }
    if has_draft || edit_enabled {
        return false;
    }

    let viewport_width = (viewport.hx - viewport.lx).max(1) as i64;
    let viewport_height = (viewport.hy - viewport.ly).max(1) as i64;
    let world_width = (world.hx - world.lx).max(1) as i64;
    let world_height = (world.hy - world.ly).max(1) as i64;
    let viewport_area = viewport_width.saturating_mul(viewport_height);
    let world_area = world_width.saturating_mul(world_height).max(1);

    // Highlights and selection are rendered as exact overlays on top of the
    // tile summary. Draft/edit mode still needs the exact base geometry.
    zoom <= 0.35 && viewport_area >= world_area.saturating_mul(6)
}

fn can_start_edit_command(
    has_draft: bool,
    has_pending_edit: bool,
    has_pending_session_action: bool,
) -> bool {
    !has_draft && !has_pending_edit && !has_pending_session_action
}

fn edit_poll_repaint_interval(has_pending_command: bool) -> Option<Duration> {
    has_pending_command.then_some(Duration::from_millis(100))
}

fn snapshot_signature_for_db(db: &ChipViewDb) -> SnapshotFileSignature {
    let manifest = db.snapshot().manifest();
    let mut paths = vec![
        manifest.path.clone(),
        manifest.meta.clone(),
        manifest.shapes.clone(),
        manifest.owners.clone(),
        manifest.payload.clone(),
        manifest.names.clone(),
        manifest.name_index.clone(),
        manifest.sidmap.clone(),
        manifest.view.clone(),
    ];
    if let Some(layers) = &manifest.layers {
        paths.push(layers.clone());
    }
    if let Some(sites) = &manifest.sites {
        paths.push(sites.clone());
    }
    if let Some(masters) = &manifest.masters {
        paths.push(masters.clone());
    }
    if let Some(vias) = &manifest.vias {
        paths.push(vias.clone());
    }
    if let Some(grids) = &manifest.grids {
        paths.push(grids.clone());
    }
    if let Some(connectivity) = &manifest.connectivity {
        paths.push(connectivity.clone());
    }
    if let Some(buses) = &manifest.buses {
        paths.push(buses.clone());
    }
    if let Some(groups) = &manifest.groups {
        paths.push(groups.clone());
    }
    if let Some(delta) = &manifest.delta {
        paths.push(delta.clone());
    }
    snapshot_file_signature(paths)
}

fn snapshot_file_signature(paths: impl IntoIterator<Item = PathBuf>) -> SnapshotFileSignature {
    SnapshotFileSignature {
        files: paths
            .into_iter()
            .map(|path| {
                let stamp = snapshot_file_stamp(&path);
                (path, stamp)
            })
            .collect(),
    }
}

fn snapshot_file_stamp(path: &Path) -> Option<SnapshotFileStamp> {
    fs::metadata(path).ok().map(|metadata| SnapshotFileStamp {
        modified: metadata.modified().ok(),
        len: metadata.len(),
    })
}

fn snapshot_file_signature_changed(
    previous: &SnapshotFileSignature,
    current: &SnapshotFileSignature,
) -> bool {
    previous != current
}

fn edit_result_action(result: &GeometryEditResult) -> EditResultAction {
    let (reload_snapshot, message) = match result.status {
        GeometryEditStatus::Accepted => (
            true,
            format!(
                "edit accepted: shape {} version {}",
                result.shape_id, result.new_version
            ),
        ),
        GeometryEditStatus::AdjustedAccepted => (
            true,
            format!(
                "edit adjusted: shape {} version {} bbox {} {} {} {}",
                result.shape_id,
                result.new_version,
                result.committed_bbox.lx,
                result.committed_bbox.ly,
                result.committed_bbox.hx,
                result.committed_bbox.hy
            ),
        ),
        GeometryEditStatus::Rejected => (
            false,
            format!(
                "edit rejected: shape {} restored to original geometry",
                result.shape_id
            ),
        ),
        GeometryEditStatus::Conflict => (
            true,
            format!(
                "edit conflict: shape {} refreshed; retry the edit",
                result.shape_id
            ),
        ),
    };

    EditResultAction {
        reload_snapshot,
        selected_shape_id: Some(result.shape_id),
        message: append_edit_diagnostic(message, result),
    }
}

fn append_edit_diagnostic(mut message: String, result: &GeometryEditResult) -> String {
    let Some(diagnostic) = result.message.as_deref().map(str::trim) else {
        return message;
    };
    if diagnostic.is_empty() {
        return message;
    }

    message.push_str(": ");
    message.push_str(diagnostic);
    message
}

fn diagnostics_lines(
    memory: &ChipViewMemoryStats,
    delta: &DeltaStats,
    view_tile_count: usize,
    exact_cache: RenderCacheStats,
    tile_cache: RenderCacheStats,
) -> Vec<String> {
    let mut lines = vec![
        format!("mmap bytes: {}", memory.mapped_bytes.total()),
        format!("index bytes: {}", memory.index_bytes.total_bytes),
        format!("total memory: {}", memory.mapped_plus_index_bytes),
        format!("view tiles: {view_tile_count}"),
        cache_stats_line("exact cache", exact_cache),
        cache_stats_line("tile cache", tile_cache),
        format!("delta records: {}", delta.record_count),
    ];

    lines.push(match (
        delta.latest_sequence_id,
        delta.latest_command_id,
        delta.latest_shape_id,
        delta.latest_old_version,
        delta.latest_new_version,
    ) {
        (Some(sequence_id), Some(command_id), Some(shape_id), Some(old_version), Some(new_version)) => {
            format!("latest delta: seq {sequence_id} cmd {command_id} shape {shape_id} v{old_version}->{new_version}")
        }
        _ => "latest delta: none".to_string(),
    });

    lines
}

fn design_metadata_lines(manifest: &chip_view_db::GeometryManifest) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(name) = manifest.design_name.as_deref() {
        lines.push(format!("design: {name}"));
    }
    if let Some(version) = manifest.design_version.as_deref() {
        lines.push(format!("design version: {version}"));
    }
    if let Some(dbu_per_micron) = manifest.dbu_per_micron {
        lines.push(format!("dbu per micron: {dbu_per_micron}"));
    }
    if let Some(manufacture_grid) = manifest.manufacture_grid {
        lines.push(format!("manufacture grid: {manufacture_grid}"));
    }
    if let Some(dirty_lod_tile_count) = manifest.dirty_lod_tile_count {
        lines.push(format!("dirty LOD tiles: {dirty_lod_tile_count}"));
    }
    if let Some(dirty_lod_rebuild_candidate_count) = manifest.dirty_lod_rebuild_candidate_count {
        lines.push(format!(
            "dirty LOD candidates: {dirty_lod_rebuild_candidate_count}"
        ));
    }
    if let Some(written_side_file_count) = manifest.written_side_file_count {
        lines.push(format!("written side files: {written_side_file_count}"));
    }
    if let Some(reused_side_file_count) = manifest.reused_side_file_count {
        lines.push(format!("reused side files: {reused_side_file_count}"));
    }
    lines
}

fn semantic_metadata_lines(
    site_count: usize,
    master_count: usize,
    via_count: usize,
    grid_count: usize,
    connectivity_count: usize,
    net_count: usize,
    bus_count: usize,
    group_count: usize,
) -> Vec<String> {
    vec![
        format!("sites: {site_count}"),
        format!("masters: {master_count}"),
        format!("via definitions: {via_count}"),
        format!("grid definitions: {grid_count}"),
        format!("connectivity endpoints: {connectivity_count}"),
        format!("net definitions: {net_count}"),
        format!("buses: {bus_count}"),
        format!("groups: {group_count}"),
    ]
}

fn cache_stats_line(label: &str, stats: RenderCacheStats) -> String {
    format!(
        "{label}: {} entries, {} hits, {} misses",
        stats.entries, stats.hits, stats.misses
    )
}

fn canvas_status_line(
    drawn: usize,
    overlay_count: usize,
    use_view_tiles: bool,
    view_lod: u8,
    zoom: f32,
    viewport: Rect32,
) -> String {
    let mut buf = String::new();
    canvas_status_line_into(
        &mut buf,
        drawn,
        overlay_count,
        use_view_tiles,
        view_lod,
        zoom,
        viewport,
    );
    buf
}

/// Zero-allocation version: writes canvas status into `buf` using fmt::Write.
fn canvas_status_line_into(
    buf: &mut String,
    drawn: usize,
    overlay_count: usize,
    use_view_tiles: bool,
    view_lod: u8,
    zoom: f32,
    viewport: Rect32,
) {
    use std::fmt::Write as _;
    if use_view_tiles {
        let _ = write!(
            buf,
            "drawn: {drawn} view tiles, lod: {view_lod}, zoom: {zoom:.2}x, viewport: {} {} {} {}",
            viewport.lx, viewport.ly, viewport.hx, viewport.hy
        );
    } else {
        let _ = write!(
            buf,
            "drawn: {drawn} exact, zoom: {zoom:.2}x, viewport: {} {} {} {}",
            viewport.lx, viewport.ly, viewport.hx, viewport.hy
        );
    }
    if overlay_count > 0 {
        let _ = write!(buf, ", overlays: {overlay_count}");
    }
}

fn canvas_cursor_icon(hovered: bool, pan_active: bool) -> Option<egui::CursorIcon> {
    if pan_active {
        Some(egui::CursorIcon::Move)
    } else if hovered {
        Some(egui::CursorIcon::Grab)
    } else {
        None
    }
}

fn instance_move_is_allowed(owner_type: u8) -> bool {
    OwnerType::from_raw(owner_type) == Some(OwnerType::InstanceBBox)
}

fn pick_top_editable_instance_bbox<'a>(
    candidates: impl IntoIterator<Item = (&'a ShapeRecord, &'a OwnerRef)>,
    point: Point32,
) -> Option<ShapeId> {
    candidates
        .into_iter()
        .filter(|(shape, owner)| {
            shape.state == ShapeState::Alive as u8
                && shape.kind == ShapeKind::Rect as u8
                && OwnerType::from_raw(owner.owner_type) == Some(OwnerType::InstanceBBox)
                && point.x >= shape.bbox.lx
                && point.x <= shape.bbox.hx
                && point.y >= shape.bbox.ly
                && point.y <= shape.bbox.hy
        })
        .last()
        .map(|(shape, _)| shape.id)
}

fn edit_capability_lines(
    shape: &ShapeRecord,
    owner: Option<&OwnerRef>,
    edit_enabled: bool,
) -> Vec<String> {
    if !edit_enabled {
        return vec!["edit: view-only session".to_string()];
    }
    if shape.state != ShapeState::Alive as u8 {
        return vec!["edit: read-only, shape is not alive".to_string()];
    }
    if shape.kind != ShapeKind::Rect as u8 {
        return vec!["edit: read-only, only rect shapes are editable".to_string()];
    }

    let Some(owner) = owner else {
        return vec!["edit: read-only, owner unavailable".to_string()];
    };

    if !instance_move_is_allowed(owner.owner_type) {
        return vec![format!(
            "edit: read-only, {} is not editable",
            ChipViewDb::owner_type_label(owner.owner_type)
        )];
    }

    vec![
        "edit: move".to_string(),
        "edit note: instance resize is rejected; move preserves master size".to_string(),
    ]
}

fn is_context_owner_type(owner_type: u8) -> bool {
    matches!(
        OwnerType::from_raw(owner_type),
        Some(OwnerType::Row | OwnerType::TrackGrid | OwnerType::GCellGrid | OwnerType::Obs)
    )
}

fn owner_uses_layer_visibility(owner_type: Option<OwnerType>) -> bool {
    !matches!(
        owner_type,
        Some(
            OwnerType::Die
                | OwnerType::Core
                | OwnerType::Row
                | OwnerType::InstanceBBox
                | OwnerType::InstanceHalo
                | OwnerType::Region
        )
    )
}

fn shape_uses_layer_visibility(shape: &ShapeRecord, owner_type: Option<OwnerType>) -> bool {
    shape.layer_id != LAYOUT_GEOMETRY_LAYER && owner_uses_layer_visibility(owner_type)
}

fn object_visibility_needs_layout_layer(visibility: ObjectVisibility) -> bool {
    visibility.instances
        || visibility.fill
        || visibility.boundaries
        || visibility.placement
        || visibility.tracks
        || visibility.gcells
        || visibility.obstructions
        || visibility.regions
}

fn is_renderable_shape(shape: &chipgeom_format::ShapeRecord) -> bool {
    shape.state == ShapeState::Alive as u8 && is_renderable_shape_kind(shape.kind)
}

fn is_renderable_shape_kind(kind: u8) -> bool {
    kind == ShapeKind::Rect as u8 || kind == ShapeKind::Line as u8 || kind == ShapeKind::Point as u8
}

fn overlay_shape_ids(
    selected: Option<ShapeId>,
    highlighted: &BTreeSet<ShapeId>,
) -> BTreeSet<ShapeId> {
    let mut overlay = highlighted.clone();
    if let Some(shape_id) = selected {
        overlay.insert(shape_id);
    }
    overlay
}

fn shape_xy_rect(geometry: ShapeGeometry) -> Option<Rect32> {
    match geometry {
        ShapeGeometry::Rect(rect) => Some(rect),
        ShapeGeometry::Line(line) => {
            let width = line.width.abs().max(80);
            let half = (width / 2).max(40);
            if line.begin.y == line.end.y {
                Some(Rect32 {
                    lx: line.begin.x.min(line.end.x),
                    ly: line.begin.y.saturating_sub(half),
                    hx: line.begin.x.max(line.end.x),
                    hy: line.begin.y.saturating_add(half),
                })
            } else if line.begin.x == line.end.x {
                Some(Rect32 {
                    lx: line.begin.x.saturating_sub(half),
                    ly: line.begin.y.min(line.end.y),
                    hx: line.begin.x.saturating_add(half),
                    hy: line.begin.y.max(line.end.y),
                })
            } else {
                Some(Rect32 {
                    lx: line.begin.x.min(line.end.x).saturating_sub(half),
                    ly: line.begin.y.min(line.end.y).saturating_sub(half),
                    hx: line.begin.x.max(line.end.x).saturating_add(half),
                    hy: line.begin.y.max(line.end.y).saturating_add(half),
                })
            }
        }
        ShapeGeometry::Point(point) => Some(Rect32 {
            lx: point.point.x.saturating_sub(80),
            ly: point.point.y.saturating_sub(80),
            hx: point.point.x.saturating_add(80),
            hy: point.point.y.saturating_add(80),
        }),
    }
}

fn clear_search_state(search_text: &mut String, highlighted: &mut BTreeSet<ShapeId>) {
    search_text.clear();
    highlighted.clear();
}

fn selection_detail_lines(
    shape: &ShapeRecord,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
    owner_local_name: Option<&str>,
) -> Vec<String> {
    let mut lines = vec![
        format!("shape: {}", shape.id),
        format!("kind: {}", shape_kind_label(shape.kind)),
        format!("state: {}", shape_state_label(shape.state)),
        format!("version: {}", shape.version),
        format!("layer: {}", shape.layer_id),
        format!("flags: 0x{:04x}", shape.flags),
        format!(
            "bbox: {} {} {} {}",
            shape.bbox.lx, shape.bbox.ly, shape.bbox.hx, shape.bbox.hy
        ),
    ];

    if let Some(owner) = owner {
        lines.push(format!(
            "owner: {} {}",
            ChipViewDb::owner_type_label(owner.owner_type),
            owner.owner_id
        ));
        lines.push(format!("owner flags: 0x{:04x}", owner.flags));
        if let Some(name) = owner_name {
            lines.push(format!("name: {name}"));
        }
        if let Some(local_name) = owner_local_name {
            lines.push(format!("local name: {local_name}"));
            if let Some(local_info) = OwnerLocalInfo::parse(local_name) {
                lines.extend(owner_local_info_lines(&local_info));
            }
        }
        lines.push(format!(
            "path: {} {} {} {}",
            owner.path0, owner.path1, owner.path2, owner.path3
        ));
    } else {
        lines.push("owner: unavailable".to_string());
    }

    lines
}

fn owner_local_info_lines(local_info: &OwnerLocalInfo) -> Vec<String> {
    if local_info.kind == "via" {
        return via_local_info_lines(local_info);
    }

    let mut lines = Vec::new();
    if let Some(master) = local_info.field("master") {
        lines.push(format!("master: {master}"));
    }
    if let Some(site) = local_info.field("site") {
        lines.push(format!("site: {site}"));
    }
    lines
}

fn via_local_info_lines(local_info: &OwnerLocalInfo) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(via) = local_info.field("via") {
        lines.push(format!("via: {via}"));
    }
    if let Some(master) = local_info.field("master") {
        lines.push(format!("via master: {master}"));
    }
    if let Some(via_type) = local_info.field("type") {
        lines.push(format!("via type: {via_type}"));
    }
    if let Some(rule) = local_info.field("rule") {
        lines.push(format!("via rule: {rule}"));
    }

    let bottom = local_info.field("bottom");
    let cut = local_info.field("cut");
    let top = local_info.field("top");
    if bottom.is_some() || cut.is_some() || top.is_some() {
        lines.push(format!(
            "via layers: {} / {} / {}",
            bottom.unwrap_or("?"),
            cut.unwrap_or("?"),
            top.unwrap_or("?")
        ));
    }

    let cut_size = local_info.field("cut_size");
    let cut_spacing = local_info.field("cut_spacing");
    if cut_size.is_some() || cut_spacing.is_some() {
        lines.push(format!(
            "via cut: size {} spacing {}",
            cut_size.unwrap_or("?"),
            cut_spacing.unwrap_or("?")
        ));
    }

    let enclosure_bottom = local_info.field("enclosure_bottom");
    let enclosure_top = local_info.field("enclosure_top");
    if enclosure_bottom.is_some() || enclosure_top.is_some() {
        lines.push(format!(
            "via enclosure: bottom {} top {}",
            enclosure_bottom.unwrap_or("?"),
            enclosure_top.unwrap_or("?")
        ));
    }

    if let Some(rowcol) = local_info.field("rowcol") {
        lines.push(format!("via row/col: {rowcol}"));
    }
    if local_info.field("default") == Some("true") {
        lines.push("via default: true".to_string());
    }
    lines
}

fn selection_connectivity_lines(endpoints: &[&ConnectivityMetadata]) -> Vec<String> {
    let mut lines = selection_connectivity_header_lines(endpoints);
    for endpoint in endpoints.iter().take(MAX_SELECTION_ENDPOINT_LINES) {
        lines.push(selection_connectivity_endpoint_line(endpoint));
    }
    if let Some(line) = selection_connectivity_omitted_line(endpoints) {
        lines.push(line);
    }
    lines
}

fn selection_connectivity_header_lines(endpoints: &[&ConnectivityMetadata]) -> Vec<String> {
    if endpoints.is_empty() {
        return Vec::new();
    }

    vec![format!("connectivity endpoints: {}", endpoints.len())]
}

fn selection_connectivity_endpoint_line(endpoint: &ConnectivityMetadata) -> String {
    format!(
        "endpoint: {} {} {} master:{}",
        empty_label(&endpoint.endpoint_type),
        empty_label(&endpoint.instance_name),
        empty_label(&endpoint.pin_name),
        empty_label(&endpoint.master_name)
    )
}

fn selection_connectivity_omitted_line(endpoints: &[&ConnectivityMetadata]) -> Option<String> {
    (endpoints.len() > MAX_SELECTION_ENDPOINT_LINES).then(|| {
        format!(
            "endpoints omitted: {}",
            endpoints.len() - MAX_SELECTION_ENDPOINT_LINES
        )
    })
}

fn selection_connectivity_endpoints<'a>(
    db: &'a ChipViewDb,
    owner: Option<&OwnerRef>,
    owner_name: Option<&str>,
) -> Vec<&'a ConnectivityMetadata> {
    let Some(owner_name) = owner_name else {
        return Vec::new();
    };
    match owner.and_then(|owner| OwnerType::from_raw(owner.owner_type)) {
        Some(OwnerType::InstanceBBox | OwnerType::InstanceHalo) => {
            db.connectivity_for_instance(owner_name)
        }
        Some(
            OwnerType::PinPortShape | OwnerType::InstancePinPortShape | OwnerType::IoPinPortShape,
        ) => db.connectivity_for_pin(owner_name),
        _ => db.connectivity_for_net(owner_name),
    }
}

fn empty_label(value: &str) -> &str {
    if value.is_empty() {
        "-"
    } else {
        value
    }
}

fn shape_kind_label(kind: u8) -> &'static str {
    match kind {
        value if value == ShapeKind::Point as u8 => "point",
        value if value == ShapeKind::Line as u8 => "line",
        value if value == ShapeKind::Rect as u8 => "rect",
        _ => "other",
    }
}

fn shape_state_label(state: u8) -> &'static str {
    match state {
        value if value == ShapeState::Alive as u8 => "alive",
        value if value == ShapeState::Deleted as u8 => "deleted",
        _ => "other",
    }
}

fn first_existing_shape_id<F>(shape_ids: &BTreeSet<ShapeId>, mut exists: F) -> Option<ShapeId>
where
    F: FnMut(ShapeId) -> bool,
{
    shape_ids.iter().copied().find(|shape_id| exists(*shape_id))
}

fn focus_target_for_shape_ids<F>(
    shape_ids: &BTreeSet<ShapeId>,
    mut bbox_for_shape: F,
) -> Option<PendingFocus>
where
    F: FnMut(ShapeId) -> Option<Rect32>,
{
    let mut shape_bboxes = BTreeMap::new();
    for shape_id in shape_ids.iter().copied() {
        let Some(shape_bbox) = bbox_for_shape(shape_id) else {
            continue;
        };
        shape_bboxes.insert(shape_id, shape_bbox);
    }

    let bbox = shape_bboxes.values().copied().reduce(union_rect)?;
    let select_shape_id =
        first_existing_shape_id(shape_ids, |shape_id| shape_bboxes.contains_key(&shape_id));
    Some(PendingFocus {
        bbox,
        select_shape_id,
        transition: FocusTransition::Immediate,
    })
}

fn shape_id_lookup_action<F>(input: &str, mut bbox_for_shape: F) -> ShapeIdLookupAction
where
    F: FnMut(ShapeId) -> Option<Rect32>,
{
    let value = input.trim();
    if value.is_empty() {
        return ShapeIdLookupAction {
            pending_focus: None,
            message: "enter a ShapeId".to_string(),
        };
    }
    let Ok(shape_id) = value.parse::<ShapeId>() else {
        return ShapeIdLookupAction {
            pending_focus: None,
            message: format!("invalid ShapeId: {value}"),
        };
    };
    let Some(bbox) = bbox_for_shape(shape_id) else {
        return ShapeIdLookupAction {
            pending_focus: None,
            message: format!("shape {shape_id} not found"),
        };
    };

    ShapeIdLookupAction {
        pending_focus: Some(PendingFocus {
            bbox,
            select_shape_id: Some(shape_id),
            transition: FocusTransition::Immediate,
        }),
        message: format!("shape {shape_id} selected"),
    }
}

fn union_rect(lhs: Rect32, rhs: Rect32) -> Rect32 {
    Rect32 {
        lx: lhs.lx.min(rhs.lx),
        ly: lhs.ly.min(rhs.ly),
        hx: lhs.hx.max(rhs.hx),
        hy: lhs.hy.max(rhs.hy),
    }
}

fn focus_view_on_bbox(world: Rect32, target: Rect32, canvas: egui::Rect) -> (f32, egui::Vec2) {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let canvas_width = canvas.width().max(1.0);
    let canvas_height = canvas.height().max(1.0);
    let base_scale = (canvas_width / world_width)
        .min(canvas_height / world_height)
        .max(0.001);
    let target_width = (target.hx - target.lx).max(1) as f32;
    let target_height = (target.hy - target.ly).max(1) as f32;
    let target_scale =
        (canvas_width / target_width).min(canvas_height / target_height) * FOCUS_VIEWPORT_FILL;
    let zoom = (target_scale / base_scale).clamp(1.0, 50_000.0);
    let scale = base_scale * zoom;
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let target_cx = (target.lx + target.hx) as f32 * 0.5;
    let target_cy = (target.ly + target.hy) as f32 * 0.5;

    (
        zoom,
        egui::vec2(
            (world_cx - target_cx) * scale,
            (target_cy - world_cy) * scale,
        ),
    )
}

impl FocusAnimation {
    fn new(
        started_at: f64,
        from_zoom: f32,
        from_pan: egui::Vec2,
        to_zoom: f32,
        to_pan: egui::Vec2,
    ) -> Self {
        Self {
            started_at,
            from_zoom,
            from_pan,
            to_zoom,
            to_pan,
        }
    }

    fn sample(self, now: f64) -> FocusAnimationFrame {
        let progress =
            ((now - self.started_at) / MAP_FOCUS_ANIMATION_DURATION_SECONDS).clamp(0.0, 1.0) as f32;
        let eased = ease_out_quint(progress);
        let zoom = egui::lerp(self.from_zoom..=self.to_zoom, eased);
        FocusAnimationFrame {
            zoom: if progress >= 1.0 { self.to_zoom } else { zoom },
            pan: if progress >= 1.0 {
                self.to_pan
            } else {
                self.from_pan + (self.to_pan - self.from_pan) * eased
            },
            complete: progress >= 1.0,
        }
    }
}

fn ease_out_quint(progress: f32) -> f32 {
    1.0 - (1.0 - progress.clamp(0.0, 1.0)).powi(5)
}

fn focus_animation_enabled(ctx: &egui::Context) -> bool {
    ctx.style().animation_time > 0.0
        && !reduced_motion_requested(std::env::var(REDUCED_MOTION_ENV).ok().as_deref())
}

fn env_flag_requested(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        ["1", "true", "yes", "on"]
            .iter()
            .any(|enabled| value.trim().eq_ignore_ascii_case(enabled))
    })
}

fn reduced_motion_requested(value: Option<&str>) -> bool {
    env_flag_requested(value)
}

fn retain_existing_shape_id<F>(shape_id: Option<ShapeId>, mut exists: F) -> Option<ShapeId>
where
    F: FnMut(ShapeId) -> bool,
{
    shape_id.filter(|shape_id| exists(*shape_id))
}

fn retain_existing_shape_ids<F>(shape_ids: &mut BTreeSet<ShapeId>, mut exists: F)
where
    F: FnMut(ShapeId) -> bool,
{
    shape_ids.retain(|shape_id| exists(*shape_id));
}

fn sidebar_section_heights(available_height: f32) -> SidebarSectionHeights {
    let available_height = available_height.max(360.0);
    let view = (available_height / 13.0).clamp(54.0, 78.0);
    let interaction = (available_height * 2.0 / 13.0).clamp(136.0, 180.0);
    let list_total =
        (available_height - view - interaction - SIDEBAR_SECTION_RESERVE_HEIGHT).max(220.0);
    let physical_layers = (list_total * 0.5).clamp(120.0, 420.0);
    let drawing_data = (list_total - physical_layers).clamp(120.0, 420.0);

    SidebarSectionHeights {
        view,
        interaction,
        physical_layers,
        drawing_data,
    }
}

fn next_native_command_id(counter: &mut u32) -> u64 {
    let command_id = u64::from(*counter);
    assert!(
        command_id <= MAX_JAVASCRIPT_SAFE_INTEGER,
        "native edit command ID exceeds the JavaScript safe integer range"
    );
    *counter = counter.saturating_add(1);
    command_id
}

fn set_layer_visibility(layers: &mut [LayerUiState], visible: bool) {
    for layer in layers {
        layer.visible = visible;
    }
}

fn invert_layer_visibility(layers: &mut [LayerUiState]) {
    for layer in layers {
        layer.visible = !layer.visible;
    }
}

fn visible_layer_count(layers: &[LayerUiState]) -> usize {
    layers.iter().filter(|layer| layer.visible).count()
}

fn layers_visibility_hash(layers: &[LayerUiState]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for l in layers {
        l.layer_id.hash(&mut hasher);
        l.visible.hash(&mut hasher);
    }
    LAYOUT_GEOMETRY_LAYER.hash(&mut hasher);
    true.hash(&mut hasher);
    hasher.finish()
}

fn drc_layer_is_visible(layers: &[LayerUiState], layer_name: &str) -> bool {
    layers
        .iter()
        .find(|layer| layer.name.eq_ignore_ascii_case(layer_name))
        .map(|layer| layer.visible)
        .unwrap_or(true)
}

fn antenna_layer_is_visible(layers: &[LayerUiState], layer_name: &str) -> bool {
    layers
        .iter()
        .find(|layer| layer.name.eq_ignore_ascii_case(layer_name))
        .map(|layer| layer.visible)
        .unwrap_or(true)
}

#[cfg(test)]
fn visible_layer_ids(visible_layers: &BTreeMap<LayerId, LayerStyle>) -> Vec<LayerId> {
    visible_layers.keys().copied().collect()
}

fn render_query_layer_ids(layers: &[LayerUiState], visibility: ObjectVisibility) -> Vec<LayerId> {
    let mut ids: BTreeSet<LayerId> = layers
        .iter()
        .filter(|layer| layer.visible)
        .map(|layer| layer.layer_id)
        .collect();
    if object_visibility_needs_layout_layer(visibility) {
        ids.insert(LAYOUT_GEOMETRY_LAYER);
    }
    ids.into_iter().collect()
}

fn visible_style_for_shape<'a>(
    shape: &ShapeRecord,
    owner: Option<&OwnerRef>,
    visible_layers: &'a BTreeMap<LayerId, LayerStyle>,
    all_layers: &'a BTreeMap<LayerId, LayerStyle>,
) -> Option<&'a LayerStyle> {
    let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
    if shape_uses_layer_visibility(shape, owner_type) {
        visible_layers.get(&shape.layer_id)
    } else {
        all_layers
            .get(&shape.layer_id)
            .or_else(|| visible_layers.get(&shape.layer_id))
    }
}

fn layer_hover_text(layer: &LayerUiState) -> String {
    let mut text = format!(
        "id: {}\norder: {}\ntype: {}\nstyle role: {}\ndirection: {}\nwidth: {}\npitch: {} {}",
        layer.layer_id,
        layer.order,
        layer.layer_type,
        layer.display_role,
        layer.direction,
        layer.width,
        layer.pitch_x,
        layer.pitch_y
    );
    append_positive_layer_rule(&mut text, "min spacing", layer.min_spacing);
    append_positive_layer_rule(&mut text, "min area", layer.min_area);
    append_positive_layer_rule(&mut text, "min step", layer.min_step);
    append_positive_layer_rule(&mut text, "cut spacing", layer.cut_spacing);
    if !layer.enclosure_below.is_empty() {
        text.push_str("\nenclosure below: ");
        text.push_str(&layer.enclosure_below);
    }
    if !layer.enclosure_above.is_empty() {
        text.push_str("\nenclosure above: ");
        text.push_str(&layer.enclosure_above);
    }
    if layer.lef58_rule_count > 0 {
        text.push_str(&format!("\nLEF58 rules: {}", layer.lef58_rule_count));
    }
    text
}

fn append_positive_layer_rule(text: &mut String, label: &str, value: i32) {
    if value > 0 {
        text.push_str(&format!("\n{label}: {value}"));
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CanvasDragMode {
    Pan,
    Edit,
}

#[derive(Clone, Copy, Debug)]
struct PanDragState {
    mode: Option<CanvasDragMode>,
    accumulated_delta: egui::Vec2,
}

impl Default for PanDragState {
    fn default() -> Self {
        Self {
            mode: None,
            accumulated_delta: egui::Vec2::ZERO,
        }
    }
}

impl PanDragState {
    fn start(&mut self, mode: CanvasDragMode) {
        self.mode = Some(mode);
        self.accumulated_delta = egui::Vec2::ZERO;
    }

    fn mode(&self) -> Option<CanvasDragMode> {
        self.mode
    }

    fn apply_pan_frame(&self, pan: egui::Vec2, frame_delta: egui::Vec2) -> egui::Vec2 {
        pan + frame_delta
    }

    fn accumulate(&mut self, frame_delta: egui::Vec2) -> egui::Vec2 {
        self.accumulated_delta += frame_delta;
        self.accumulated_delta
    }

    fn reset(&mut self) {
        self.mode = None;
        self.accumulated_delta = egui::Vec2::ZERO;
    }
}

fn write_edit_command(
    path: &Path,
    command: &GeometryEditCommand,
    instance_name: Option<&str>,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_vec_pretty(&ViewerEditCommand {
        command,
        instance_name,
    })
    .map_err(std::io::Error::other)?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)?;
    fs::rename(temp_path, path)
}

fn write_session_action_command(
    path: &Path,
    command: &SessionActionCommand,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_vec_pretty(command).map_err(std::io::Error::other)?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)?;
    fs::rename(temp_path, path)
}

fn session_action_result_message(result: &SessionActionResult) -> String {
    let detail = result.message.as_deref().map(str::trim).unwrap_or_default();
    let outcome = if result.accepted {
        "completed"
    } else {
        "rejected"
    };
    if detail.is_empty() {
        format!("{} {}", result.action.label(), outcome)
    } else {
        format!("{} {}: {detail}", result.action.label(), outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn world_to_screen_rect_flips_y_and_fits_canvas() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 50,
        };
        let shape = chipgeom_format::Rect32 {
            lx: 10,
            ly: 10,
            hx: 30,
            hy: 20,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

        let screen = world_to_screen_rect(shape, world, canvas, 1.0, egui::Vec2::ZERO);

        assert_eq!(screen.left(), 20.0);
        assert_eq!(screen.right(), 60.0);
        assert_eq!(screen.top(), 60.0);
        assert_eq!(screen.bottom(), 80.0);
    }

    #[test]
    fn shape_screen_primitive_for_line_uses_payload_endpoints_not_bbox() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
        let line = chipgeom_format::LinePayload {
            begin: Point32 { x: 10, y: 20 },
            end: Point32 { x: 80, y: 90 },
            width: 3,
            flags: 0,
        };

        let primitive = shape_screen_primitive(
            ShapeGeometry::Line(line),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        );

        let ScreenShapePrimitive::Line { begin, end, width } = primitive else {
            panic!("expected line primitive");
        };
        assert_eq!(
            begin,
            world_to_screen_point(line.begin, world, canvas, 1.0, egui::Vec2::ZERO)
        );
        assert_eq!(
            end,
            world_to_screen_point(line.end, world, canvas, 1.0, egui::Vec2::ZERO)
        );
        assert_eq!(width, 6.0);
    }

    #[test]
    fn drc_json_parser_extracts_violations_and_counts() {
        let json = r#"
        {
          "drc": {
            "number": 2,
            "distribution": {
              "MetalShort": {
                "number": 2,
                "layers": {
                  "MET1": {
                    "number": 2,
                    "list": [
                      {
                        "llx": 10,
                        "lly": 20,
                        "urx": 30,
                        "ury": 40,
                        "required_size": 12,
                        "net": ["clk"],
                        "inst": ["u0"]
                      },
                      {
                        "llx": 50,
                        "lly": 60,
                        "urx": 70,
                        "ury": 80,
                        "required_size": 4,
                        "net": ["rst"],
                        "inst": []
                      }
                    ]
                  }
                }
              }
            }
          }
        }
        "#;

        let (violations, counts) = parse_drc_json_text(json).unwrap();

        assert_eq!(violations.len(), 2);
        assert_eq!(violations[0].drc_type, "MetalShort");
        assert_eq!(violations[0].layer, "met1");
        assert_eq!(
            violations[0].bbox,
            Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            }
        );
        assert_eq!(violations[0].required_size, Some(12));
        assert_eq!(violations[0].nets, vec!["clk"]);
        assert_eq!(violations[0].insts, vec!["u0"]);
        assert_eq!(counts["MetalShort"].total_count, 2);
        assert_eq!(counts["MetalShort"].layer_counts["MET1"], 2);
    }

    #[test]
    fn drc_statis_csv_parser_extracts_type_layer_counts() {
        let counts = parse_drc_statis_csv(
            "Type,MET1,VIA1,MET2,total\nMetalShort,2,0,3,5\nSpacing,0,1,0,1\ntotal,2,1,3,6\n",
        );

        assert_eq!(counts["MetalShort"].total_count, 5);
        assert_eq!(counts["MetalShort"].layer_counts["MET1"], 2);
        assert_eq!(counts["MetalShort"].layer_counts["MET2"], 3);
        assert_eq!(counts["Spacing"].total_count, 1);
        assert_eq!(counts["Spacing"].layer_counts["VIA1"], 1);
        assert!(!counts.contains_key("total"));
    }

    #[test]
    fn drc_layer_visibility_uses_matching_physical_layer() {
        let mut met1 = layer_state(1, false);
        met1.name = "MET1".to_string();
        let mut met2 = layer_state(2, true);
        met2.name = "MET2".to_string();
        let layers = vec![met1, met2];

        assert!(!drc_layer_is_visible(&layers, "met1"));
        assert!(drc_layer_is_visible(&layers, "MET2"));
        assert!(drc_layer_is_visible(&layers, "UNKNOWN"));
    }

    #[test]
    fn drc_detail_lines_include_core_violation_context() {
        let violation = DrcViolation {
            id: 0,
            drc_type: "Spacing".to_string(),
            layer: "MET2".to_string(),
            bbox: Rect32 {
                lx: 1,
                ly: 2,
                hx: 3,
                hy: 4,
            },
            required_size: Some(7),
            nets: vec!["net0".to_string(), "VDD".to_string()],
            insts: vec!["u0".to_string()],
        };

        let lines = drc_detail_lines(&violation);

        assert!(lines.contains(&"type: Spacing".to_string()));
        assert!(lines.contains(&"layer: MET2".to_string()));
        assert!(lines.contains(&"bbox: (1, 2) - (3, 4)".to_string()));
        assert!(lines.contains(&"required size: 7".to_string()));
        assert!(lines.contains(&"nets: net0, VDD".to_string()));
        assert!(lines.contains(&"instances: u0".to_string()));
    }

    #[test]
    fn shape_screen_primitive_for_point_uses_payload_point() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
        let point = chipgeom_format::PointPayload {
            point: Point32 { x: 25, y: 75 },
            symbol_id: 0,
            flags: 0,
        };

        let primitive = shape_screen_primitive(
            ShapeGeometry::Point(point),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        );

        let ScreenShapePrimitive::Point { center, radius } = primitive else {
            panic!("expected point primitive");
        };
        assert_eq!(
            center,
            world_to_screen_point(point.point, world, canvas, 1.0, egui::Vec2::ZERO)
        );
        assert_eq!(radius, MIN_SHAPE_SCREEN_SIZE);
    }

    #[test]
    fn shape_overlay_primitive_uses_line_payload_geometry() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
        let line = chipgeom_format::LinePayload {
            begin: Point32 { x: 10, y: 20 },
            end: Point32 { x: 80, y: 90 },
            width: 1,
            flags: 0,
        };

        let primitive = shape_overlay_primitive(
            ShapeGeometry::Line(line),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        );

        assert!(matches!(primitive, ScreenShapePrimitive::Line { .. }));
    }

    #[test]
    fn screen_to_world_delta_flips_y() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 50,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

        assert_eq!(
            screen_to_world_delta(egui::vec2(20.0, -10.0), world, canvas, 1.0),
            (10, 5)
        );
    }

    #[test]
    fn orthogonal_ruler_commits_points_and_calculates_distances() {
        let mut ruler = OrthogonalRuler::default();
        ruler.start(Point32 { x: 100, y: 200 });
        ruler.commit(Point32 { x: 400, y: 200 });
        ruler.finish();

        let (dx, dy) = ruler_distances(&ruler.points, None);
        assert_eq!(dx, 300);
        assert_eq!(dy, 0);
    }

    #[test]
    fn format_distance_i64_handles_dbu_and_microns() {
        assert_eq!(
            format_distance_i64(2500, CoordinateUnit::Dbu, Some(2000)),
            "2500 DBU"
        );
        assert_eq!(
            format_distance_i64(2500, CoordinateUnit::Micron, Some(2000)),
            "1.250 um"
        );
    }

    #[test]
    fn screen_to_world_rect_inverts_canvas_transform() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 50,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

        assert_eq!(
            screen_to_world_rect(canvas, world, canvas, 1.0, egui::Vec2::ZERO),
            world
        );
    }

    #[test]
    fn screen_to_world_point_inverts_canvas_transform() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));

        assert_eq!(
            screen_to_world_point(
                egui::pos2(150.0, 50.0),
                world,
                canvas,
                1.0,
                egui::Vec2::ZERO
            ),
            Point32 { x: 75, y: 75 }
        );
    }

    #[test]
    fn cursor_status_line_uses_selected_coordinate_unit() {
        let point = Point32 { x: 3000, y: -500 };

        assert_eq!(
            cursor_status_line(point, CoordinateUnit::Dbu, Some(2000)),
            "cursor: 3000 -500 DBU"
        );
        assert_eq!(
            cursor_status_line(point, CoordinateUnit::Micron, Some(2000)),
            "cursor: 1.500 -0.250 um"
        );
    }

    #[test]
    fn hover_status_line_appends_nearest_shape_when_available() {
        let point = Point32 { x: 3000, y: -500 };

        assert_eq!(
            hover_status_line(
                point,
                CoordinateUnit::Dbu,
                Some(2000),
                Some(NearestShape {
                    shape_id: 42,
                    distance_squared: 25,
                }),
            ),
            "cursor: 3000 -500 DBU, nearest: shape 42 d2 25"
        );
        assert_eq!(
            hover_status_line(point, CoordinateUnit::Micron, Some(2000), None),
            "cursor: 1.500 -0.250 um"
        );
    }

    #[test]
    fn hover_nearest_radius_uses_screen_pixel_distance() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(100.0, 100.0));

        assert_eq!(hover_nearest_radius_dbu(world, canvas, 1.0), 80);
        assert_eq!(hover_nearest_radius_dbu(world, canvas, 2.0), 40);
    }

    #[test]
    fn micron_coordinate_unit_falls_back_to_dbu_without_manifest_scale() {
        assert_eq!(
            effective_coordinate_unit(CoordinateUnit::Micron, None),
            CoordinateUnit::Dbu
        );
        assert_eq!(
            format_distance(2000, CoordinateUnit::Micron, None),
            "2000 DBU"
        );
    }

    #[test]
    fn nice_ruler_distance_uses_one_two_five_steps() {
        assert_eq!(nice_ruler_distance_dbu(0.2), 1);
        assert_eq!(nice_ruler_distance_dbu(1.2), 2);
        assert_eq!(nice_ruler_distance_dbu(3.1), 5);
        assert_eq!(nice_ruler_distance_dbu(7.0), 10);
        assert_eq!(nice_ruler_distance_dbu(1200.0), 2000);
    }

    #[test]
    fn scroll_zoom_factor_keeps_directional_zoom() {
        assert_eq!(scroll_zoom_factor(0.0), 1.0);
        assert!((scroll_zoom_factor(1.0) - 1.35).abs() < 1e-4);
        assert!((scroll_zoom_factor(-1.0) - (1.0 / 1.35)).abs() < 1e-4);
        assert!(scroll_zoom_factor(2.0) > scroll_zoom_factor(1.0));
        assert!(scroll_zoom_factor(-2.0) < scroll_zoom_factor(-1.0));
        assert!(scroll_zoom_factor(50.0) > scroll_zoom_factor(25.0));
        assert!(scroll_zoom_factor(-50.0) < scroll_zoom_factor(-25.0));
    }

    #[test]
    fn zoom_at_screen_pos_keeps_cursor_world_position_fixed() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 200.0));
        let cursor = egui::pos2(150.0, 50.0);
        let marker = chipgeom_format::Rect32 {
            lx: 75,
            ly: 75,
            hx: 75,
            hy: 75,
        };
        let (zoom, pan) = zoom_at_screen_pos(world, canvas, 1.0, egui::Vec2::ZERO, 2.0, cursor);

        let screen = world_to_screen_rect(marker, world, canvas, zoom, pan);

        assert!((screen.center().x - cursor.x).abs() <= 0.5);
        assert!((screen.center().y - cursor.y).abs() <= 0.5);
    }

    #[test]
    fn translate_rect_moves_all_edges() {
        let rect = chipgeom_format::Rect32 {
            lx: 1,
            ly: 2,
            hx: 3,
            hy: 4,
        };

        assert_eq!(
            translate_rect(rect, 10, -2),
            chipgeom_format::Rect32 {
                lx: 11,
                ly: 0,
                hx: 13,
                hy: 2,
            }
        );
    }

    #[test]
    fn fitted_view_uses_exact_shapes() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };

        assert!(!should_use_view_tiles_for_state(
            16, false, false, false, false, 1.0, world, world,
        ));
    }

    #[test]
    fn canvas_status_line_reports_exact_draw_count_zoom_and_viewport() {
        assert_eq!(
            canvas_status_line(
                42,
                0,
                false,
                2,
                3.25,
                Rect32 {
                    lx: 10,
                    ly: 20,
                    hx: 30,
                    hy: 40,
                },
            ),
            "drawn: 42 exact, zoom: 3.25x, viewport: 10 20 30 40"
        );
    }

    #[test]
    fn canvas_status_line_reports_tile_lod_when_using_view_tiles() {
        assert_eq!(
            canvas_status_line(
                7,
                0,
                true,
                3,
                0.5,
                Rect32 {
                    lx: -10,
                    ly: -20,
                    hx: 30,
                    hy: 40,
                },
            ),
            "drawn: 7 view tiles, lod: 3, zoom: 0.50x, viewport: -10 -20 30 40"
        );
    }

    #[test]
    fn canvas_status_line_reports_exact_overlay_count() {
        assert_eq!(
            canvas_status_line(
                7,
                3,
                true,
                3,
                0.5,
                Rect32 {
                    lx: -10,
                    ly: -20,
                    hx: 30,
                    hy: 40,
                },
            ),
            "drawn: 7 view tiles, lod: 3, zoom: 0.50x, viewport: -10 -20 30 40, overlays: 3"
        );
    }

    #[test]
    fn canvas_cursor_icon_uses_hand_at_rest_and_move_while_panning() {
        assert_eq!(canvas_cursor_icon(false, false), None);
        assert_eq!(
            canvas_cursor_icon(true, false),
            Some(egui::CursorIcon::Grab)
        );
        assert_eq!(canvas_cursor_icon(true, true), Some(egui::CursorIcon::Move));
        assert_eq!(
            canvas_cursor_icon(false, true),
            Some(egui::CursorIcon::Move)
        );
    }

    #[test]
    fn edit_mode_keeps_precise_shapes_at_far_zoom() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        let overview_viewport = chipgeom_format::Rect32 {
            lx: -1000,
            ly: -1000,
            hx: 2000,
            hy: 2000,
        };

        assert!(!should_use_view_tiles_for_state(
            16,
            false,
            false,
            false,
            true,
            0.25,
            overview_viewport,
            world,
        ));
        assert!(!should_use_view_tiles_for_state(
            16,
            false,
            false,
            true,
            false,
            0.25,
            overview_viewport,
            world,
        ));
    }

    #[test]
    fn overview_uses_view_tiles_when_far_even_with_exact_overlay() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        let overview_viewport = chipgeom_format::Rect32 {
            lx: -1000,
            ly: -1000,
            hx: 2000,
            hy: 2000,
        };

        assert!(should_use_view_tiles_for_state(
            16,
            false,
            false,
            false,
            false,
            0.25,
            overview_viewport,
            world,
        ));
        assert!(should_use_view_tiles_for_state(
            16,
            true,
            false,
            false,
            false,
            0.25,
            overview_viewport,
            world,
        ));
        assert!(should_use_view_tiles_for_state(
            16,
            false,
            true,
            false,
            false,
            0.25,
            overview_viewport,
            world,
        ));
    }

    #[test]
    fn overview_tile_query_falls_back_when_preferred_lod_is_missing() {
        let dir = temp_snapshot_dir("3d-overview-lod-fallback");
        write_empty_snapshot(&dir, false);
        let tile = chipgeom_format::GeometryViewTileRecord {
            lod_level: 2,
            layer_id: 4,
            shape_count: 12,
            bbox: Rect32 {
                lx: 10,
                ly: 20,
                hx: 110,
                hy: 220,
            },
            ..chipgeom_format::GeometryViewTileRecord::default()
        };
        write_empty_geometry_file(
            &dir.join("geometry.view.bin"),
            chipgeom_format::GeometryFileKind::View,
            core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
            any_as_bytes(&tile),
        );
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let viewport = Rect32 {
            lx: 0,
            ly: 0,
            hx: 1_000,
            hy: 1_000,
        };
        let tiles = overview_tiles_for_layer(&db, 3, 4, viewport, viewport);
        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].lod_level, 2);
        assert_eq!(tiles[0].bbox.lx, 10);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn three_d_overview_extrudes_snapshot_tiles_instead_of_full_die_slabs() {
        let dir = temp_snapshot_dir("3d-overview-tiles");
        write_empty_snapshot(&dir, false);
        let tile = chipgeom_format::GeometryViewTileRecord {
            lod_level: 3,
            layer_id: 1,
            shape_count: 32,
            bbox: Rect32 {
                lx: 100,
                ly: 200,
                hx: 1_400,
                hy: 1_800,
            },
            ..chipgeom_format::GeometryViewTileRecord::default()
        };
        write_empty_geometry_file(
            &dir.join("geometry.view.bin"),
            chipgeom_format::GeometryFileKind::View,
            core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
            any_as_bytes(&tile),
        );
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let mut loaded = LoadedViewer::new(
            chip_display::ColorTheme::Vivid,
            db,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            wgpu::TextureFormat::Bgra8Unorm,
            true,
        );
        loaded.layers = vec![layer_state(1, true)];
        loaded.rebuild_layer_stack();
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 10_000,
            hy: 8_000,
        };
        loaded.camera_ctrl_3d.fit_world(
            crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
            crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
            loaded.layer_stack.height(),
        );
        loaded.camera_ctrl_3d.snap_to_target();
        let instances = loaded.build_3d_instances(world, world, &[1], true);
        let tile_inst = instances
            .iter()
            .find(|i| (i.flags & crate::canvas_gpu3d::FLAG_GROUND_GRID) == 0)
            .unwrap();
        assert_eq!(
            tile_inst.rect_dbu,
            [tile.bbox.lx, tile.bbox.ly, tile.bbox.hx, tile.bbox.hy]
        );
        assert_ne!(tile_inst.rect_dbu, [world.lx, world.ly, world.hx, world.hy]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn three_d_fit_prefers_detailed_tiles_over_full_die_panels() {
        let dir = temp_snapshot_dir("3d-fit-detailed-tiles");
        write_empty_snapshot(&dir, false);
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 10_000,
            hy: 8_000,
        };
        let coarse = chipgeom_format::GeometryViewTileRecord {
            lod_level: 3,
            layer_id: 1,
            shape_count: 80,
            bbox: world,
            ..chipgeom_format::GeometryViewTileRecord::default()
        };
        let fine = chipgeom_format::GeometryViewTileRecord {
            lod_level: 0,
            layer_id: 1,
            shape_count: 6,
            bbox: Rect32 {
                lx: 200,
                ly: 300,
                hx: 900,
                hy: 1_100,
            },
            ..chipgeom_format::GeometryViewTileRecord::default()
        };
        let mut payload = Vec::new();
        payload.extend_from_slice(any_as_bytes(&coarse));
        payload.extend_from_slice(any_as_bytes(&fine));
        write_empty_geometry_file(
            &dir.join("geometry.view.bin"),
            chipgeom_format::GeometryFileKind::View,
            core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
            &payload,
        );
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let mut loaded = LoadedViewer::new(
            chip_display::ColorTheme::Vivid,
            db,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            wgpu::TextureFormat::Bgra8Unorm,
            true,
        );
        loaded.layers = vec![layer_state(1, true)];
        loaded.rebuild_layer_stack();
        loaded.camera_ctrl_3d.fit_world_with_aspect(
            crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
            crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
            loaded.layer_stack.height(),
            1.2,
        );
        loaded.camera_ctrl_3d.snap_to_target();
        let instances = loaded.build_3d_instances(world, world, &[1], true);
        let tile_inst = instances
            .iter()
            .find(|i| (i.flags & crate::canvas_gpu3d::FLAG_GROUND_GRID) == 0)
            .unwrap();
        assert_eq!(tile_inst.rect_dbu, [200, 300, 900, 1_100]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overlay_shape_ids_include_highlight_and_selection() {
        let highlighted = BTreeSet::from([10, 20]);

        assert_eq!(
            overlay_shape_ids(Some(30), &highlighted),
            BTreeSet::from([10, 20, 30])
        );
    }

    #[test]
    fn search_highlight_uses_distinct_double_border() {
        let outer = search_highlight_outer_stroke();
        let inner = search_highlight_inner_stroke();

        assert!(outer.width > inner.width);
        assert_eq!(outer.color, egui::Color32::from_rgb(255, 64, 192));
        assert_eq!(inner.color, egui::Color32::from_rgb(255, 248, 210));
        assert_ne!(outer.color, ecos_warning());
        assert_ne!(outer.color, ecos_accent());
    }

    #[test]
    fn clear_search_state_resets_search_text_and_highlights() {
        let mut search_text = "clk".to_string();
        let mut highlighted = BTreeSet::from([10, 20]);

        clear_search_state(&mut search_text, &mut highlighted);

        assert!(search_text.is_empty());
        assert!(highlighted.is_empty());
    }

    #[test]
    fn selection_detail_lines_include_shape_bbox_and_owner_context() {
        let shape = chipgeom_format::ShapeRecord {
            id: 42,
            version: 3,
            layer_id: 7,
            kind: ShapeKind::Line as u8,
            state: ShapeState::Alive as u8,
            flags: 0x0010,
            reserved_padding0: 0,
            owner_index: 1,
            payload_offset: 99,
            payload_size: 12,
            style_class: 2,
            bbox: Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            },
        };
        let owner = chipgeom_format::OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            flags: 0x0020,
            owner_id: 123,
            path0: 1,
            path1: 2,
            path2: 3,
            path3: 4,
            name_id: 8,
            ..chipgeom_format::OwnerRef::default()
        };

        assert_eq!(
            selection_detail_lines(&shape, Some(&owner), Some("clk"), Some("via:VIA1")),
            vec![
                "shape: 42",
                "kind: line",
                "state: alive",
                "version: 3",
                "layer: 7",
                "flags: 0x0010",
                "bbox: 10 20 30 40",
                "owner: net_wire_segment 123",
                "owner flags: 0x0020",
                "name: clk",
                "local name: via:VIA1",
                "via: VIA1",
                "path: 1 2 3 4",
            ]
        );
    }

    #[test]
    fn selection_detail_lines_expand_rich_via_local_info() {
        let shape = chipgeom_format::ShapeRecord {
            id: 42,
            version: 3,
            layer_id: 7,
            kind: chipgeom_format::ShapeKind::Rect as u8,
            state: chipgeom_format::ShapeState::Alive as u8,
            flags: 0x0010,
            bbox: chipgeom_format::Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            },
            ..chipgeom_format::ShapeRecord::default()
        };
        let owner = chipgeom_format::OwnerRef {
            owner_type: OwnerType::Via as u8,
            flags: 0x0020,
            owner_id: 123,
            path0: 1,
            path1: 2,
            path2: 3,
            path3: 4,
            name_id: 8,
            ..chipgeom_format::OwnerRef::default()
        };
        let lines = selection_detail_lines(
            &shape,
            Some(&owner),
            Some("clk"),
            Some(
                "via:VIA12 master:VIA12 type:generated rule:VIA12RULE bottom:M1 cut:VIA12 top:M2 cut_size:4x4 \
                 cut_spacing:8,8 enclosure_bottom:1,2 enclosure_top:3,4 rowcol:1x2 default:true",
            ),
        );

        assert!(lines.contains(&"via: VIA12".to_string()));
        assert!(lines.contains(&"via master: VIA12".to_string()));
        assert!(lines.contains(&"via type: generated".to_string()));
        assert!(lines.contains(&"via rule: VIA12RULE".to_string()));
        assert!(lines.contains(&"via layers: M1 / VIA12 / M2".to_string()));
        assert!(lines.contains(&"via cut: size 4x4 spacing 8,8".to_string()));
        assert!(lines.contains(&"via enclosure: bottom 1,2 top 3,4".to_string()));
        assert!(lines.contains(&"via row/col: 1x2".to_string()));
        assert!(lines.contains(&"via default: true".to_string()));
    }

    #[test]
    fn diagnostics_lines_include_memory_cache_tile_and_delta_context() {
        let memory = chip_view_db::ChipViewMemoryStats {
            mapped_bytes: chip_view_db::GeometryMappedBytes {
                meta: 10,
                shapes: 20,
                owners: 30,
                payload: 40,
                names: 50,
                name_index: 60,
                sidmap: 70,
                delta: 80,
                view: 90,
            },
            index_bytes: chip_view_db::ChipViewIndexMemoryStats {
                layer_index_bytes: 100,
                shape_index_bytes: 200,
                view_index_bytes: 300,
                name_index_bytes: 400,
                net_index_bytes: 0,
                connectivity_index_bytes: 0,
                total_bytes: 1000,
            },
            mapped_plus_index_bytes: 1450,
        };
        let delta = chip_view_db::DeltaStats {
            record_count: 3,
            latest_sequence_id: Some(11),
            latest_command_id: Some(22),
            latest_shape_id: Some(33),
            latest_old_version: Some(4),
            latest_new_version: Some(5),
        };
        let exact_cache = chip_render::RenderCacheStats {
            entries: 2,
            hits: 7,
            misses: 8,
        };
        let tile_cache = chip_render::RenderCacheStats {
            entries: 4,
            hits: 9,
            misses: 10,
        };

        assert_eq!(
            diagnostics_lines(&memory, &delta, 12, exact_cache, tile_cache),
            vec![
                "mmap bytes: 450",
                "index bytes: 1000",
                "total memory: 1450",
                "view tiles: 12",
                "exact cache: 2 entries, 7 hits, 8 misses",
                "tile cache: 4 entries, 9 hits, 10 misses",
                "delta records: 3",
                "latest delta: seq 11 cmd 22 shape 33 v4->5",
            ]
        );
    }

    #[test]
    fn diagnostics_lines_report_empty_delta_log_without_latest_record() {
        let memory = chip_view_db::ChipViewMemoryStats::default();
        let delta = chip_view_db::DeltaStats::default();

        assert_eq!(
            diagnostics_lines(
                &memory,
                &delta,
                0,
                chip_render::RenderCacheStats::default(),
                chip_render::RenderCacheStats::default(),
            ),
            vec![
                "mmap bytes: 0",
                "index bytes: 0",
                "total memory: 0",
                "view tiles: 0",
                "exact cache: 0 entries, 0 hits, 0 misses",
                "tile cache: 0 entries, 0 hits, 0 misses",
                "delta records: 0",
                "latest delta: none",
            ]
        );
    }

    #[test]
    fn design_metadata_lines_report_manifest_context_when_available() {
        let manifest = chip_view_db::GeometryManifest {
            design_name: Some("uart_top".to_string()),
            design_version: Some("5.8".to_string()),
            dbu_per_micron: Some(2000),
            manufacture_grid: Some(5),
            dirty_lod_tile_count: Some(7),
            dirty_lod_rebuild_candidate_count: Some(11),
            written_side_file_count: Some(13),
            reused_side_file_count: Some(5),
            ..chip_view_db::GeometryManifest::default()
        };

        assert_eq!(
            design_metadata_lines(&manifest),
            vec![
                "design: uart_top",
                "design version: 5.8",
                "dbu per micron: 2000",
                "manufacture grid: 5",
                "dirty LOD tiles: 7",
                "dirty LOD candidates: 11",
                "written side files: 13",
                "reused side files: 5",
            ]
        );
        assert!(design_metadata_lines(&chip_view_db::GeometryManifest::default()).is_empty());
    }

    #[test]
    fn semantic_metadata_lines_report_site_and_master_counts() {
        assert_eq!(
            semantic_metadata_lines(2, 3, 4, 5, 6, 7, 8, 9),
            vec![
                "sites: 2".to_string(),
                "masters: 3".to_string(),
                "via definitions: 4".to_string(),
                "grid definitions: 5".to_string(),
                "connectivity endpoints: 6".to_string(),
                "net definitions: 7".to_string(),
                "buses: 8".to_string(),
                "groups: 9".to_string(),
            ]
        );
    }

    #[test]
    fn selection_connectivity_lines_report_endpoint_context() {
        let endpoints = [
            chip_view_db::ConnectivityMetadata {
                net_name: "clk".to_string(),
                net_kind: "clock".to_string(),
                endpoint_type: "instance".to_string(),
                instance_name: "u0".to_string(),
                pin_name: "A".to_string(),
                master_name: "INVX1".to_string(),
            },
            chip_view_db::ConnectivityMetadata {
                net_name: "clk".to_string(),
                net_kind: "clock".to_string(),
                endpoint_type: "io".to_string(),
                pin_name: "CLK".to_string(),
                ..chip_view_db::ConnectivityMetadata::default()
            },
        ];
        let endpoint_refs = endpoints.iter().collect::<Vec<_>>();

        assert_eq!(
            selection_connectivity_lines(&endpoint_refs),
            vec![
                "connectivity endpoints: 2".to_string(),
                "endpoint: instance u0 A master:INVX1".to_string(),
                "endpoint: io - CLK master:-".to_string(),
            ]
        );
        assert!(selection_connectivity_lines(&[]).is_empty());
    }

    #[test]
    fn selection_connectivity_lines_limit_verbose_endpoint_lists() {
        let endpoints = (0..8)
            .map(|index| chip_view_db::ConnectivityMetadata {
                net_name: "data".to_string(),
                net_kind: "signal".to_string(),
                endpoint_type: "instance".to_string(),
                instance_name: format!("u{index}"),
                pin_name: "A".to_string(),
                master_name: "INVX1".to_string(),
            })
            .collect::<Vec<_>>();
        let endpoint_refs = endpoints.iter().collect::<Vec<_>>();
        let lines = selection_connectivity_lines(&endpoint_refs);

        assert_eq!(lines.len(), 8);
        assert_eq!(lines[0], "connectivity endpoints: 8");
        assert_eq!(lines[7], "endpoints omitted: 2");
    }

    #[test]
    fn shape_kind_rendering_includes_bbox_safe_line_and_point_shapes() {
        assert!(is_renderable_shape_kind(ShapeKind::Rect as u8));
        assert!(is_renderable_shape_kind(ShapeKind::Line as u8));
        assert!(is_renderable_shape_kind(ShapeKind::Point as u8));
        assert!(!is_renderable_shape_kind(0));
    }

    #[test]
    fn shape_screen_rect_expands_zero_extent_bbox() {
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let point_bbox = Rect32 {
            lx: 50,
            ly: 50,
            hx: 50,
            hy: 50,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(100.0, 100.0));

        let screen = shape_screen_rect(point_bbox, world, canvas, 1.0, egui::Vec2::ZERO);

        assert!(screen.is_positive());
        assert!(screen.width() >= MIN_SHAPE_SCREEN_SIZE);
        assert!(screen.height() >= MIN_SHAPE_SCREEN_SIZE);
        assert!((screen.center().x - canvas.center().x).abs() <= 0.5);
        assert!((screen.center().y - canvas.center().y).abs() <= 0.5);
    }

    #[test]
    fn first_existing_shape_id_returns_lowest_live_highlight() {
        let highlighted = BTreeSet::from([30, 10, 20]);

        assert_eq!(
            first_existing_shape_id(&highlighted, |shape_id| shape_id != 10),
            Some(20)
        );
        assert_eq!(first_existing_shape_id(&highlighted, |_| false), None);
    }

    #[test]
    fn focus_target_for_shape_ids_uses_union_bbox_and_lowest_live_shape() {
        let highlighted = BTreeSet::from([30, 10, 20]);

        let focus = focus_target_for_shape_ids(&highlighted, |shape_id| match shape_id {
            20 => Some(Rect32 {
                lx: 100,
                ly: 100,
                hx: 120,
                hy: 130,
            }),
            30 => Some(Rect32 {
                lx: -10,
                ly: 5,
                hx: 15,
                hy: 25,
            }),
            _ => None,
        })
        .unwrap();

        assert_eq!(focus.select_shape_id, Some(20));
        assert_eq!(
            focus.bbox,
            Rect32 {
                lx: -10,
                ly: 5,
                hx: 120,
                hy: 130,
            }
        );
    }

    #[test]
    fn shape_id_lookup_action_focuses_existing_shape() {
        let action = shape_id_lookup_action(" 42 ", |shape_id| {
            (shape_id == 42).then_some(Rect32 {
                lx: 10,
                ly: 20,
                hx: 30,
                hy: 40,
            })
        });

        assert_eq!(
            action.pending_focus,
            Some(PendingFocus {
                bbox: Rect32 {
                    lx: 10,
                    ly: 20,
                    hx: 30,
                    hy: 40,
                },
                select_shape_id: Some(42),
                transition: FocusTransition::Immediate,
            })
        );
        assert_eq!(action.message, "shape 42 selected");
    }

    #[test]
    fn shape_id_lookup_action_reports_invalid_or_missing_shape() {
        let invalid = shape_id_lookup_action("shape-42", |_| None);
        assert_eq!(invalid.pending_focus, None);
        assert_eq!(invalid.message, "invalid ShapeId: shape-42");

        let missing = shape_id_lookup_action("99", |_| None);
        assert_eq!(missing.pending_focus, None);
        assert_eq!(missing.message, "shape 99 not found");
    }

    #[test]
    fn focus_view_on_bbox_centers_target_bbox() {
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let target = Rect32 {
            lx: 70,
            ly: 10,
            hx: 80,
            hy: 20,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0));

        let (zoom, pan) = focus_view_on_bbox(world, target, canvas);
        let screen = world_to_screen_rect(target, world, canvas, zoom, pan);

        assert!((screen.center().x - canvas.center().x).abs() <= 0.5);
        assert!((screen.center().y - canvas.center().y).abs() <= 0.5);
        assert!(zoom >= 1.0);
    }

    #[test]
    fn focus_animation_eases_out_and_finishes_on_the_exact_target() {
        let animation =
            FocusAnimation::new(10.0, 1.0, egui::Vec2::ZERO, 16.0, egui::vec2(80.0, -40.0));

        let start = animation.sample(10.0);
        let middle = animation.sample(10.0 + MAP_FOCUS_ANIMATION_DURATION_SECONDS * 0.5);
        let end = animation.sample(10.0 + MAP_FOCUS_ANIMATION_DURATION_SECONDS);

        assert_eq!(start.zoom, 1.0);
        assert_eq!(start.pan, egui::Vec2::ZERO);
        assert!(!start.complete);
        assert!(middle.zoom > 4.0 && middle.zoom < 16.0);
        assert!(middle.pan.x > 40.0 && middle.pan.x < 80.0);
        assert!(middle.pan.y < -20.0 && middle.pan.y > -40.0);
        assert!(!middle.complete);
        assert_eq!(end.zoom, 16.0);
        assert_eq!(end.pan, egui::vec2(80.0, -40.0));
        assert!(end.complete);
    }

    #[test]
    fn focus_animation_moves_target_monotonically_to_viewport_center() {
        let target_from_world_center = egui::vec2(10.0, -5.0);
        let animation = FocusAnimation::new(
            10.0,
            1.0,
            egui::Vec2::ZERO,
            16.0,
            -target_from_world_center * 16.0,
        );
        let mut previous_distance = f32::INFINITY;

        for progress in [0.0, 0.1, 0.25, 0.5, 0.75, 1.0] {
            let frame = animation.sample(10.0 + MAP_FOCUS_ANIMATION_DURATION_SECONDS * progress);
            let target_offset = target_from_world_center * frame.zoom + frame.pan;
            let distance = target_offset.length();
            assert!(
                distance <= previous_distance + f32::EPSILON,
                "target moved away from center at progress {progress}: {distance} > {previous_distance}"
            );
            assert!(target_offset.x >= -f32::EPSILON);
            assert!(target_offset.y <= f32::EPSILON);
            previous_distance = distance;
        }
        assert!(previous_distance <= f32::EPSILON);
    }

    #[test]
    fn reduced_motion_environment_values_disable_focus_animation() {
        for value in ["1", "true", "TRUE", "yes", "on"] {
            assert!(reduced_motion_requested(Some(value)));
        }
        for value in ["0", "false", "off", ""] {
            assert!(!reduced_motion_requested(Some(value)));
        }
        assert!(!reduced_motion_requested(None));
    }

    #[test]
    fn render_stats_environment_values_enable_stats_overlay() {
        for value in ["1", "true", "TRUE", "yes", "on"] {
            assert!(env_flag_requested(Some(value)));
        }
        for value in ["0", "false", "off", ""] {
            assert!(!env_flag_requested(Some(value)));
        }
        assert!(!env_flag_requested(None));
        assert_eq!(RENDER_STATS_ENV, "ECOS_RENDER_STATS");
    }

    #[test]
    fn map_focus_keeps_context_around_the_selected_cell() {
        let target = contextual_map_focus_bbox(Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 20,
        });

        assert_eq!(
            target,
            Rect32 {
                lx: -50,
                ly: -90,
                hx: 150,
                hy: 110,
            }
        );
    }

    #[test]
    fn heatmap_pointer_maps_to_matrix_coordinates() {
        let rect = egui::Rect::from_min_size(egui::pos2(10.0, 20.0), egui::vec2(100.0, 80.0));

        assert_eq!(
            heatmap_cell_at(egui::pos2(10.0, 20.0), rect, 4, 5),
            Some((0, 0))
        );
        assert_eq!(
            heatmap_cell_at(egui::pos2(109.9, 99.9), rect, 4, 5),
            Some((3, 4))
        );
        assert_eq!(heatmap_cell_at(egui::pos2(110.1, 100.1), rect, 4, 5), None);
    }

    #[test]
    fn heatmap_pointer_ignores_cells_without_finite_data() {
        let directory = temp_snapshot_dir("heatmap-interactive-cells");
        let values_path = directory.join("values.csv");
        let layout_path = directory.join("layout.csv");
        fs::write(&values_path, "1,NaN\n3,4\n").unwrap();
        fs::write(
            &layout_path,
            "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,0,10,10\n0,1,10,0,20,10\n",
        )
        .unwrap();
        let data = HeatmapData::load(&values_path, &layout_path).unwrap();
        let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(100.0, 100.0));

        assert_eq!(
            interactive_heatmap_cell_at(egui::pos2(25.0, 25.0), rect, &data),
            Some((0, 0))
        );
        assert_eq!(
            interactive_heatmap_cell_at(egui::pos2(75.0, 25.0), rect, &data),
            None
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn heatmap_threshold_omits_sub_threshold_cells_for_transparency() {
        let directory = temp_snapshot_dir("heatmap-threshold-instances");
        let values_path = directory.join("values.csv");
        let layout_path = directory.join("layout.csv");
        fs::write(&values_path, "0.0,0.5\n0.8,1.0\n").unwrap();
        fs::write(
            &layout_path,
            "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,10,10,20\n0,1,10,10,20,20\n1,0,0,0,10,10\n1,1,10,0,20,10\n",
        )
        .unwrap();
        let data = HeatmapData::load(&values_path, &layout_path).unwrap();

        let all_instances = build_heatmap_instances(&data, ColormapMode::Turbo, 0.0, false);
        assert_eq!(all_instances.len(), 4);

        let half_instances = build_heatmap_instances(&data, ColormapMode::Turbo, 0.6, false);
        assert_eq!(half_instances.len(), 2);

        // Inverted: norm <= 0.6 => keeps 0.0 and 0.5 (2 instances)
        let inverted_instances = build_heatmap_instances(&data, ColormapMode::Turbo, 0.6, true);
        assert_eq!(inverted_instances.len(), 2);

        assert_eq!(data.peak_cell(false), Some((1, 1)));
        assert_eq!(data.peak_cell(true), Some((0, 0)));

        let mut active = ActiveHeatmap::new("Test".to_string(), data);
        let hash_before = active.cached_hash;
        active.set_threshold(0.7);
        assert_ne!(active.cached_hash, hash_before);
        assert_eq!(active.instances.len(), 2);

        let hash_before_inv = active.cached_hash;
        active.set_invert_threshold(true);
        assert_ne!(active.cached_hash, hash_before_inv);
        assert_eq!(active.instances.len(), 2);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn map_catalog_find_item_by_png_locates_matching_item_and_layout() {
        let catalog = MapCatalog {
            categories: vec![crate::map_data::MapCategory {
                id: "cat1".to_string(),
                label: "Category 1".to_string(),
                layout_path: Some(PathBuf::from("/tmp/layout.csv")),
                items: vec![crate::map_data::MapItem {
                    label: "Item 1".to_string(),
                    png_path: PathBuf::from("/tmp/item1.png"),
                    csv_path: Some(PathBuf::from("/tmp/item1.csv")),
                }],
            }],
            warnings: Vec::new(),
        };

        let found = catalog.find_item_by_png(Path::new("/tmp/item1.png"));
        assert!(found.is_some());
        let (item, layout) = found.unwrap();
        assert_eq!(item.label, "Item 1");
        assert_eq!(layout, Some(Path::new("/tmp/layout.csv")));

        assert!(catalog
            .find_item_by_png(Path::new("/tmp/missing.png"))
            .is_none());
    }

    #[test]
    fn map_thumbnail_decoder_downsizes_and_enforces_dimension_limit() {
        let directory = temp_snapshot_dir("map-thumbnail-limits");
        let preview_path = directory.join("preview.png");
        image::RgbaImage::new(256, 192).save(&preview_path).unwrap();

        let preview = decode_map_thumbnail(&preview_path).unwrap();
        assert_eq!(preview.size, [128, 96]);
        assert_eq!(preview.rgba.len(), 128 * 96 * 4);

        let oversized_path = directory.join("oversized.png");
        image::RgbaImage::new(MAP_THUMBNAIL_MAX_DIMENSION + 1, 1)
            .save(&oversized_path)
            .unwrap();
        assert!(decode_map_thumbnail(&oversized_path).is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn heatmap_layout_uses_a_larger_contextual_grid() {
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(674.0, 650.0));

        let (popup, grid) = map_heatmap_layout(canvas, 43, 43);

        assert!((popup.x - 310.04).abs() < 0.1);
        assert!((grid.x - 290.04).abs() < 0.1);
        assert_eq!(grid.x, grid.y);
        assert!((popup.y - (grid.y + MAP_HEATMAP_VERTICAL_OVERHEAD)).abs() < 0.1);
    }

    #[test]
    fn heatmap_layout_stays_inside_a_small_canvas() {
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(220.0, 180.0));

        let (popup, grid) = map_heatmap_layout(canvas, 43, 43);

        assert!(popup.x <= canvas.width() - 24.0);
        assert!(popup.y <= canvas.height() - 24.0);
        assert!(grid.x <= popup.x - 20.0);
        assert!(grid.y <= canvas.height() - 118.0);
    }

    #[test]
    fn retain_existing_shape_id_clears_stale_selection() {
        assert_eq!(
            retain_existing_shape_id(Some(10), |shape_id| shape_id == 10),
            Some(10)
        );
        assert_eq!(
            retain_existing_shape_id(Some(20), |shape_id| shape_id == 10),
            None
        );
        assert_eq!(
            retain_existing_shape_id(None, |shape_id| shape_id == 10),
            None
        );
    }

    #[test]
    fn retain_existing_shape_ids_filters_stale_highlights() {
        let mut shape_ids = BTreeSet::from([10, 20, 30]);

        retain_existing_shape_ids(&mut shape_ids, |shape_id| shape_id != 20);

        assert_eq!(shape_ids, BTreeSet::from([10, 30]));
    }

    #[test]
    fn search_mode_filters_net_and_instance_owner_types() {
        assert_eq!(SearchMode::All.owner_types(), None);
        assert_eq!(
            SearchMode::Net.owner_types(),
            Some(
                &[
                    chipgeom_format::OwnerType::NetWireSegment,
                    chipgeom_format::OwnerType::SpecialWireSegment,
                ][..]
            )
        );
        assert_eq!(
            SearchMode::Instance.owner_types(),
            Some(
                &[
                    chipgeom_format::OwnerType::InstanceBBox,
                    chipgeom_format::OwnerType::InstanceHalo,
                ][..]
            )
        );
        assert_eq!(SearchMode::Bus.owner_types(), None);
        assert_eq!(SearchMode::Group.owner_types(), None);
        assert_eq!(SearchMode::Pin.owner_types(), None);
        assert_eq!(SearchMode::Pin.label(), "Pin");
        assert_eq!(SearchMode::Bus.label(), "Bus");
        assert_eq!(SearchMode::Group.label(), "Group");
    }

    #[test]
    fn object_visibility_default_matches_startup_drawing_data() {
        let visibility = ObjectVisibility::default();
        let enabled = DrawingCategory::ALL
            .into_iter()
            .filter(|category| visibility.is_category_visible(*category))
            .collect::<Vec<_>>();

        assert_eq!(
            enabled,
            vec![
                DrawingCategory::Instances,
                DrawingCategory::Placement,
                DrawingCategory::Boundaries,
                DrawingCategory::Fill,
            ]
        );
        assert!(!visibility.is_all_visible());
    }

    #[test]
    fn object_visibility_hides_only_the_requested_owner_categories() {
        let visibility = ObjectVisibility {
            instances: false,
            fill: false,
            io_pin: true,
            net_signal: false,
            net_clock: false,
            net_other: false,
            pdn: true,
            tracks: true,
            ..ObjectVisibility::default()
        };

        assert!(!visibility.includes_owner_type(OwnerType::InstanceBBox as u8));
        assert!(!visibility.includes_owner_type(OwnerType::InstanceHalo as u8));
        assert!(!visibility.includes_owner_type(OwnerType::NetWireSegment as u8));
        assert!(visibility.includes_owner_type(OwnerType::SpecialWireSegment as u8));
        assert!(visibility.includes_owner_type(OwnerType::PinPortShape as u8));
        assert!(visibility.includes_owner_type(OwnerType::InstancePinPortShape as u8));
        assert!(visibility.includes_owner_type(OwnerType::IoPinPortShape as u8));
        assert!(visibility.includes_owner_type(OwnerType::TrackGrid as u8));
        assert!(!visibility.is_all_visible());
    }

    #[test]
    fn net_kind_maps_to_drawing_net_categories() {
        assert_eq!(
            net_kind_drawing_category(Some("signal")),
            DrawingCategory::NetSignal
        );
        assert_eq!(
            net_kind_drawing_category(Some("CLOCK")),
            DrawingCategory::NetClock
        );
        assert_eq!(
            net_kind_drawing_category(Some("power")),
            DrawingCategory::NetOther
        );
        assert_eq!(net_kind_drawing_category(None), DrawingCategory::NetOther);
    }

    #[test]
    fn extended_drawing_categories_control_vias_and_context_geometry() {
        let mut visibility = ObjectVisibility::default();
        visibility.set_all_visible(true);
        visibility.set_category_visible(DrawingCategory::Vias, false);
        visibility.set_category_visible(DrawingCategory::Tracks, false);
        visibility.set_category_visible(DrawingCategory::GCells, false);
        visibility.set_category_visible(DrawingCategory::Obstructions, false);

        assert!(!visibility.includes_owner_type(OwnerType::Via as u8));
        assert!(!visibility.includes_owner_type(OwnerType::TrackGrid as u8));
        assert!(!visibility.includes_owner_type(OwnerType::GCellGrid as u8));
        assert!(!visibility.includes_owner_type(OwnerType::Blockage as u8));
        assert!(!visibility.includes_owner_type(OwnerType::Obs as u8));
        assert!(visibility.includes_owner_type(OwnerType::Fill as u8));
    }

    #[test]
    fn drawing_categories_cover_every_mapped_owner_type() {
        for owner_type in [
            OwnerType::InstanceBBox,
            OwnerType::InstanceHalo,
            OwnerType::NetWireSegment,
            OwnerType::SpecialWireSegment,
            OwnerType::Via,
            OwnerType::PinPortShape,
            OwnerType::InstancePinPortShape,
            OwnerType::IoPinPortShape,
            OwnerType::Row,
            OwnerType::TrackGrid,
            OwnerType::GCellGrid,
            OwnerType::Blockage,
            OwnerType::Obs,
            OwnerType::Die,
            OwnerType::Core,
            OwnerType::Fill,
            OwnerType::Region,
            OwnerType::Slot,
        ] {
            assert!(DrawingCategory::ALL
                .into_iter()
                .any(|category| category.includes_owner_type(owner_type)));
        }
    }

    #[test]
    fn owner_styles_preserve_layer_color_and_use_distinct_textures() {
        let base = LayerStyle::default_for_metadata(7, "MET1", 0, chip_display::ColorTheme::Vivid);
        let assert_layer_color = |style: LayerStyle| {
            assert_eq!(&style.rgba[..3], &base.rgba[..3]);
            assert_eq!(&style.frame_rgba[..3], &base.rgba[..3]);
        };
        let track = OwnerRef {
            owner_type: OwnerType::TrackGrid as u8,
            ..OwnerRef::default()
        };
        let gcell = OwnerRef {
            owner_type: OwnerType::GCellGrid as u8,
            ..OwnerRef::default()
        };
        let instance = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };
        let net = OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            ..OwnerRef::default()
        };
        let pdn = OwnerRef {
            owner_type: OwnerType::SpecialWireSegment as u8,
            ..OwnerRef::default()
        };
        let pin = OwnerRef {
            owner_type: OwnerType::PinPortShape as u8,
            ..OwnerRef::default()
        };
        let instance_pin = OwnerRef {
            owner_type: OwnerType::InstancePinPortShape as u8,
            ..OwnerRef::default()
        };
        let io_pin = OwnerRef {
            owner_type: OwnerType::IoPinPortShape as u8,
            ..OwnerRef::default()
        };

        let track_style = style_for_shape(base, Some(&track));
        assert_layer_color(track_style);
        assert_eq!(track_style.fill_pattern, FillPattern::Hollow);
        assert_eq!(track_style.fill_alpha, 0);
        assert_eq!(track_style.frame_alpha, 82);
        assert_eq!(track_style.line_width_px, 1);

        let gcell_style = style_for_shape(base, Some(&gcell));
        assert_layer_color(gcell_style);
        assert_eq!(gcell_style.fill_pattern, FillPattern::Hollow);
        assert_eq!(gcell_style.line_width_px, 2);

        let instance_style = style_for_shape(base, Some(&instance));
        assert_layer_color(instance_style);
        assert_eq!(instance_style.fill_pattern, FillPattern::Solid);
        assert_eq!(instance_style.fill_alpha, 64);
        assert_eq!(instance_style.frame_alpha, 172);
        assert_eq!(instance_style.line_width_px, 1);

        let net_style = style_for_shape(base, Some(&net));
        assert_layer_color(net_style);
        assert_eq!(net_style.fill_pattern, FillPattern::DiagonalHatch);
        assert!(net_style.fill_alpha >= 56);

        let pdn_style = style_for_shape(base, Some(&pdn));
        assert_layer_color(pdn_style);
        assert_eq!(pdn_style.fill_pattern, FillPattern::Grid);
        assert_eq!(pdn_style.line_width_px, 2);

        let pin_style = style_for_shape(base, Some(&pin));
        assert_layer_color(pin_style);
        assert_eq!(pin_style.fill_pattern, FillPattern::Grid);
        assert_eq!(pin_style.line_width_px, 2);

        let instance_pin_style = style_for_shape(base, Some(&instance_pin));
        assert_layer_color(instance_pin_style);
        assert_eq!(instance_pin_style.fill_pattern, FillPattern::Grid);
        assert_eq!(instance_pin_style.line_width_px, 2);

        let io_pin_style = style_for_shape(base, Some(&io_pin));
        assert_eq!(&io_pin_style.rgba[..3], &[245, 190, 32]);
        assert_eq!(&io_pin_style.frame_rgba[..3], &[255, 222, 89]);
        assert_eq!(io_pin_style.fill_pattern, FillPattern::CrossHatch);
        assert_eq!(io_pin_style.line_width_px, 2);

        let via = OwnerRef {
            owner_type: OwnerType::Via as u8,
            ..OwnerRef::default()
        };
        let via_style = style_for_shape(base, Some(&via));
        assert_layer_color(via_style);
        assert_eq!(via_style.fill_pattern, FillPattern::XMark);
        assert_eq!(via_style.line_width_px, 1);
    }

    #[test]
    fn layout_geometry_layer_uses_transparent_gray_styles() {
        let layout = layout_geometry_layer_style();
        assert_eq!(layout.rgba, [148, 148, 148, 48]);
        assert_eq!(layout.frame_rgba, [148, 148, 148, 128]);

        let instance = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };
        let instance_style = style_for_shape(layout, Some(&instance));
        assert_eq!(instance_style.rgba, [148, 148, 148, 48]);
        assert_eq!(instance_style.frame_rgba, [148, 148, 148, 128]);
        assert_eq!(instance_style.fill_pattern, FillPattern::Solid);

        let die = OwnerRef {
            owner_type: OwnerType::Die as u8,
            ..OwnerRef::default()
        };
        let die_style = style_for_shape(layout, Some(&die));
        assert_eq!(die_style.rgba, [148, 148, 148, 0]);
        assert_eq!(die_style.frame_rgba, [148, 148, 148, 128]);
        assert_eq!(die_style.fill_pattern, FillPattern::Hollow);
    }

    #[test]
    fn shape_label_overlays_fit_centered_names_inside_rectangles() {
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1000.0, 1000.0));
        let geometry = ShapeGeometry::Rect(Rect32 {
            lx: 100,
            ly: 100,
            hx: 300,
            hy: 220,
        });

        let io_owner = OwnerRef {
            owner_type: OwnerType::IoPinPortShape as u8,
            ..OwnerRef::default()
        };
        let io_overlay = shape_label_overlay(
            geometry,
            Some(&io_owner),
            Some("IO_PAD"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("io pin label overlay");
        assert_eq!(io_overlay.kind, ShapeLabelKind::IoPin);
        assert!(centered_label_font_size(io_overlay.rect, &io_overlay.text, 7.0, 12.0).is_some());

        let instance_owner = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };
        let instance_overlay = shape_label_overlay(
            geometry,
            Some(&instance_owner),
            Some("macro_pad_0"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("instance label overlay");
        assert_eq!(instance_overlay.kind, ShapeLabelKind::Instance);

        let instance_pin_owner = OwnerRef {
            owner_type: OwnerType::InstancePinPortShape as u8,
            owner_id: 31,
            path0: 7,
            ..OwnerRef::default()
        };
        let instance_pin_overlay = shape_label_overlay(
            geometry,
            Some(&instance_pin_owner),
            Some("u0/A"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("instance pin label overlay");
        assert_eq!(instance_pin_overlay.kind, ShapeLabelKind::Pin);
        assert_eq!(instance_pin_overlay.text, "A");

        let net_owner = OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 41,
            ..OwnerRef::default()
        };
        let net_overlay = shape_label_overlay(
            geometry,
            Some(&net_owner),
            Some("clk"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("net label overlay");
        assert_eq!(net_overlay.kind, ShapeLabelKind::Net);
        assert_eq!(net_overlay.text, "clk");

        let pdn_owner = OwnerRef {
            owner_type: OwnerType::SpecialWireSegment as u8,
            owner_id: 42,
            ..OwnerRef::default()
        };
        let pdn_overlay = shape_label_overlay(
            geometry,
            Some(&pdn_owner),
            Some("VDD"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("pdn label overlay");
        assert_eq!(pdn_overlay.kind, ShapeLabelKind::Pdn);
        assert_eq!(pdn_overlay.text, "VDD");

        let small_net = shape_label_overlay(
            ShapeGeometry::Rect(Rect32 {
                lx: 100,
                ly: 100,
                hx: 140,
                hy: 120,
            }),
            Some(&net_owner),
            Some("data"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("small net label overlay");
        let larger_same_net_owner = OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: 99,
            ..OwnerRef::default()
        };
        let large_net = shape_label_overlay(
            ShapeGeometry::Rect(Rect32 {
                lx: 100,
                ly: 100,
                hx: 360,
                hy: 180,
            }),
            Some(&larger_same_net_owner),
            Some("data"),
            world,
            canvas,
            1.0,
            egui::Vec2::ZERO,
        )
        .expect("large net label overlay");
        let large_area = large_net.rank_area;
        let mut collector = ShapeLabelCollector::default();
        collector.insert(small_net);
        collector.insert(large_net);
        let collected = collector.overlays().collect::<Vec<_>>();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].text, "data");
        assert_eq!(collected[0].rank_area, large_area);

        let tiny = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(10.0, 5.0));
        assert!(centered_label_font_size(tiny, "too_long", 8.0, 18.0).is_none());
    }

    #[test]
    fn context_owner_types_are_deferred_until_zoomed_in() {
        assert!(is_context_owner_type(OwnerType::TrackGrid as u8));
        assert!(is_context_owner_type(OwnerType::GCellGrid as u8));
        assert!(is_context_owner_type(OwnerType::Row as u8));
        assert!(is_context_owner_type(OwnerType::Obs as u8));
        assert!(!is_context_owner_type(OwnerType::NetWireSegment as u8));
        assert!(!is_context_owner_type(OwnerType::InstanceBBox as u8));
    }

    #[test]
    fn layout_level_owner_styles_do_not_require_layer_visibility() {
        assert!(!owner_uses_layer_visibility(Some(OwnerType::InstanceBBox)));
        assert!(!owner_uses_layer_visibility(Some(OwnerType::InstanceHalo)));
        assert!(!owner_uses_layer_visibility(Some(OwnerType::Die)));
        assert!(!owner_uses_layer_visibility(Some(OwnerType::Core)));
        assert!(!owner_uses_layer_visibility(Some(OwnerType::Row)));
        assert!(!owner_uses_layer_visibility(Some(OwnerType::Region)));

        assert!(owner_uses_layer_visibility(Some(OwnerType::NetWireSegment)));
        assert!(owner_uses_layer_visibility(Some(
            OwnerType::SpecialWireSegment
        )));
        assert!(owner_uses_layer_visibility(Some(OwnerType::PinPortShape)));
        assert!(owner_uses_layer_visibility(Some(
            OwnerType::InstancePinPortShape
        )));
        assert!(owner_uses_layer_visibility(Some(OwnerType::IoPinPortShape)));
        assert!(owner_uses_layer_visibility(Some(OwnerType::Via)));
        assert!(owner_uses_layer_visibility(None));

        let layout_shape = ShapeRecord {
            layer_id: LAYOUT_GEOMETRY_LAYER,
            ..ShapeRecord::default()
        };
        assert!(!shape_uses_layer_visibility(
            &layout_shape,
            Some(OwnerType::GCellGrid)
        ));
        assert!(!shape_uses_layer_visibility(
            &layout_shape,
            Some(OwnerType::TrackGrid)
        ));
        assert!(!shape_uses_layer_visibility(
            &layout_shape,
            Some(OwnerType::Blockage)
        ));

        let physical_shape = ShapeRecord {
            layer_id: 7,
            ..ShapeRecord::default()
        };
        assert!(shape_uses_layer_visibility(
            &physical_shape,
            Some(OwnerType::TrackGrid)
        ));
    }

    #[test]
    fn parameterized_grid_visible_indices_clip_to_viewport_by_direction() {
        let grid = GridMetadata {
            grid_type: "track".to_string(),
            direction: "x".to_string(),
            start: 100,
            step: 200,
            count: 4,
            ..GridMetadata::default()
        };
        assert_eq!(
            grid_visible_indices(
                &grid,
                Rect32 {
                    lx: 50,
                    ly: -1000,
                    hx: 550,
                    hy: 1000,
                },
            ),
            vec![0, 1, 2]
        );
        assert_eq!(
            grid_visible_indices(
                &grid,
                Rect32 {
                    lx: 101,
                    ly: -1000,
                    hx: 499,
                    hy: 1000,
                },
            ),
            vec![1]
        );

        let y_grid = GridMetadata {
            direction: "y".to_string(),
            ..grid
        };
        assert_eq!(
            grid_visible_indices(
                &y_grid,
                Rect32 {
                    lx: -1000,
                    ly: 50,
                    hx: 1000,
                    hy: 550,
                },
            ),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn parameterized_grid_lines_clip_to_design_bounds() {
        let viewport = Rect32 {
            lx: -40,
            ly: 20,
            hx: 60,
            hy: 140,
        };
        let design_bounds = Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let x_grid = GridMetadata {
            direction: "x".to_string(),
            ..GridMetadata::default()
        };
        assert_eq!(
            parameterized_grid_line_endpoints(&x_grid, 50, viewport, design_bounds),
            Some((Point32 { x: 50, y: 20 }, Point32 { x: 50, y: 100 }))
        );

        let y_grid = GridMetadata {
            direction: "y".to_string(),
            ..GridMetadata::default()
        };
        assert_eq!(
            parameterized_grid_line_endpoints(&y_grid, 40, viewport, design_bounds),
            Some((Point32 { x: 0, y: 40 }, Point32 { x: 60, y: 40 }))
        );
        assert_eq!(
            parameterized_grid_line_endpoints(
                &x_grid,
                50,
                Rect32 {
                    lx: 120,
                    ly: 120,
                    hx: 160,
                    hy: 160,
                },
                design_bounds,
            ),
            None
        );

        let drc_viewport = Rect32 {
            lx: -20_405,
            ly: 23_796,
            hx: 35_574,
            hy: 68_467,
        };
        let drc_die = Rect32 {
            lx: 0,
            ly: 0,
            hx: 59_076,
            hy: 59_076,
        };
        assert_eq!(
            parameterized_grid_line_endpoints(&x_grid, 20_300, drc_viewport, drc_die),
            Some((
                Point32 {
                    x: 20_300,
                    y: 23_796,
                },
                Point32 {
                    x: 20_300,
                    y: 59_076,
                },
            ))
        );
        assert_eq!(
            parameterized_grid_line_endpoints(&y_grid, 23_900, drc_viewport, drc_die),
            Some((
                Point32 { x: 0, y: 23_900 },
                Point32 {
                    x: 35_574,
                    y: 23_900,
                },
            ))
        );
    }

    #[test]
    fn grid_reference_bounds_use_only_alive_die_shapes() {
        let owners = [
            OwnerRef {
                owner_type: OwnerType::Die as u8,
                ..OwnerRef::default()
            },
            OwnerRef {
                owner_type: OwnerType::InstanceBBox as u8,
                ..OwnerRef::default()
            },
        ];
        let shapes = [
            ShapeRecord {
                owner_index: 0,
                state: ShapeState::Alive as u8,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 100,
                    hy: 100,
                },
                ..ShapeRecord::default()
            },
            ShapeRecord {
                owner_index: 1,
                state: ShapeState::Alive as u8,
                bbox: Rect32 {
                    lx: -50,
                    ly: -50,
                    hx: 150,
                    hy: 150,
                },
                ..ShapeRecord::default()
            },
            ShapeRecord {
                owner_index: 0,
                state: ShapeState::Deleted as u8,
                bbox: Rect32 {
                    lx: -100,
                    ly: -100,
                    hx: 200,
                    hy: 200,
                },
                ..ShapeRecord::default()
            },
        ];

        assert_eq!(
            grid_reference_bounds_from_records(&shapes, &owners),
            Some(Rect32 {
                lx: 0,
                ly: 0,
                hx: 100,
                hy: 100,
            })
        );
    }

    #[test]
    fn parameterized_grid_indices_are_sampled_when_viewport_contains_many_lines() {
        let grid = GridMetadata {
            grid_type: "gcell".to_string(),
            direction: "x".to_string(),
            start: 0,
            step: 1,
            count: 10000,
            ..GridMetadata::default()
        };
        let indices = grid_visible_indices(
            &grid,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 9999,
                hy: 10,
            },
        );

        assert!(indices.len() <= MAX_PARAMETERIZED_GRID_LINES_PER_GRID);
        assert_eq!(indices.first(), Some(&0));
        assert!(indices.last().is_some_and(|index| *index <= 9999));
    }

    #[test]
    fn parameterized_grid_visibility_respects_zoom_category_and_layers() {
        let mut layers = vec![layer_state(1, false), layer_state(2, true)];
        layers[0].name = "M1".to_string();
        layers[1].name = "M2".to_string();
        let mut grid_visibility = ObjectVisibility::default();
        grid_visibility.set_category_visible(DrawingCategory::Tracks, true);
        let grid = GridMetadata {
            grid_type: "track".to_string(),
            direction: "x".to_string(),
            start: 0,
            step: 100,
            count: 4,
            layer_names: vec!["M1".to_string()],
            ..GridMetadata::default()
        };

        assert!(!parameterized_grid_is_visible(
            &grid,
            &layers,
            grid_visibility,
            2.0
        ));
        layers[0].visible = true;
        assert!(parameterized_grid_is_visible(
            &grid,
            &layers,
            grid_visibility,
            2.0
        ));
        assert!(!parameterized_grid_is_visible(
            &grid,
            &layers,
            grid_visibility,
            1.0
        ));

        let mut hidden_guides = grid_visibility;
        hidden_guides.set_category_visible(DrawingCategory::Tracks, false);
        assert!(!parameterized_grid_is_visible(
            &grid,
            &layers,
            hidden_guides,
            2.0
        ));
    }

    #[test]
    fn unrouted_net_guides_reuse_net_category_visibility_without_layer_filters() {
        let guide = UnroutedNetGuide {
            net_name: "clk".to_string(),
            net_kind: "clock".to_string(),
            hub: Point32 { x: 50, y: 50 },
            pin_centers: vec![Point32 { x: 10, y: 10 }, Point32 { x: 90, y: 90 }],
            bbox: Rect32 {
                lx: 10,
                ly: 10,
                hx: 90,
                hy: 90,
            },
        };
        let viewport = Rect32 {
            lx: 0,
            ly: 0,
            hx: 100,
            hy: 100,
        };
        let mut visibility = ObjectVisibility::default();

        assert!(!unrouted_net_guide_is_visible(&guide, visibility, viewport));

        visibility.set_category_visible(DrawingCategory::NetClock, true);

        assert!(unrouted_net_guide_is_visible(&guide, visibility, viewport));
    }

    #[test]
    fn drawing_category_counts_includes_unrouted_net_guides() {
        let dir = temp_snapshot_dir("drawing-counts-unrouted");
        write_empty_snapshot(&dir, false);
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let counts = drawing_category_counts(&db);
        assert_eq!(
            counts
                .get(&DrawingCategory::NetSignal)
                .copied()
                .unwrap_or(0),
            0
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn filler_instance_detection_matches_standard_asic_filler_cells() {
        // icsprout55-pdk standard cell fillers & caps
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER1H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER2H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER4H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER8H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER16H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER32H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER64H7H")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER1H7L")));
        assert!(is_filler_instance(Some("inst_fill"), Some("FILLER16H7R")));
        assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP4H7H")));
        assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP8H7H")));
        assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP16H7H")));
        assert!(is_filler_instance(Some("inst_cap"), Some("FILLCAP32H7H")));
        assert!(is_filler_instance(Some("inst_tap"), Some("FILLTAPH7H")));
        assert!(is_filler_instance(Some("inst_tap"), Some("FILLTAPH7L")));
        assert!(is_filler_instance(Some("inst_tap"), Some("FILLTAPH7R")));

        // icsprout55-pdk IO fillers
        assert!(is_filler_instance(
            Some("io_fill"),
            Some("P65_1233_FILLER0005")
        ));
        assert!(is_filler_instance(
            Some("io_fill"),
            Some("P65_1233_FILLER001")
        ));
        assert!(is_filler_instance(
            Some("io_fill"),
            Some("P65_1233_FILLER01")
        ));
        assert!(is_filler_instance(
            Some("io_fill"),
            Some("P65_1233_FILLER1")
        ));
        assert!(is_filler_instance(
            Some("io_fill"),
            Some("P65_1233_FILLER10")
        ));
        assert!(is_filler_instance(
            Some("io_fill"),
            Some("P65_1233_FILLER50")
        ));

        // Instance name matches
        assert!(is_filler_instance(Some("FILLER_0_0"), None));
        assert!(is_filler_instance(Some("fill_123"), None));
        assert!(is_filler_instance(Some("PHY_EDGE_0"), None));
        assert!(is_filler_instance(Some("PHY_TAP_1"), None));

        // Logic instances should NOT match
        assert!(!is_filler_instance(Some("_042_"), Some("AND2X1H7H")));
        assert!(!is_filler_instance(Some("u_dff"), Some("SDFFQX1H7H")));
        assert!(!is_filler_instance(Some("clk_buf"), Some("BUFX4H7H")));
        assert!(!is_filler_instance(Some("inv_1"), Some("INVX1H7H")));
        assert!(!is_filler_instance(Some("core_inst"), Some("alu_top")));
    }

    #[test]
    fn dashed_line_segments_split_screen_line_into_dashes() {
        let segments = dashed_line_segments(egui::pos2(0.0, 0.0), egui::pos2(30.0, 0.0), 8.0, 4.0);

        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0], (egui::pos2(0.0, 0.0), egui::pos2(8.0, 0.0)));
        assert_eq!(segments[2], (egui::pos2(24.0, 0.0), egui::pos2(30.0, 0.0)));
        assert!(
            dashed_line_segments(egui::pos2(1.0, 1.0), egui::pos2(1.0, 1.0), 8.0, 4.0).is_empty()
        );
    }

    #[test]
    fn parameterized_grid_stroke_uses_linked_layer_color() {
        let mut layers = vec![layer_state(1, true), layer_state(2, true)];
        layers[0].name = "M1".to_string();
        layers[0].style.rgba = [17, 34, 51, 44];
        layers[1].name = "M2".to_string();
        layers[1].style.rgba = [90, 80, 70, 44];
        let grid = GridMetadata {
            grid_type: "track".to_string(),
            layer_names: vec!["M2".to_string()],
            ..GridMetadata::default()
        };

        let track_stroke = parameterized_grid_stroke(&grid, &layers, OwnerType::TrackGrid);
        assert_eq!(track_stroke.width, 1.0);
        assert_eq!(
            track_stroke.color,
            egui::Color32::from_rgba_unmultiplied(90, 80, 70, 82)
        );

        let gcell_stroke = parameterized_grid_stroke(&grid, &layers, OwnerType::GCellGrid);
        assert_eq!(gcell_stroke.width, 2.0);
        assert_eq!(
            gcell_stroke.color,
            egui::Color32::from_rgba_unmultiplied(90, 80, 70, 104)
        );
    }

    #[test]
    fn unbound_parameterized_grids_use_transparent_gray_layout_color() {
        let grid = GridMetadata::default();

        let track_stroke = parameterized_grid_stroke(&grid, &[], OwnerType::TrackGrid);
        assert_eq!(track_stroke.width, 1.0);
        assert_eq!(
            track_stroke.color,
            egui::Color32::from_rgba_unmultiplied(148, 148, 148, 82)
        );

        let gcell_stroke = parameterized_grid_stroke(&grid, &[], OwnerType::GCellGrid);
        assert_eq!(gcell_stroke.width, 2.0);
        assert_eq!(
            gcell_stroke.color,
            egui::Color32::from_rgba_unmultiplied(148, 148, 148, 104)
        );
    }

    #[test]
    fn layer_visibility_helpers_show_hide_and_invert_layers() {
        let mut layers = vec![
            layer_state(1, true),
            layer_state(2, false),
            layer_state(3, true),
        ];

        set_layer_visibility(&mut layers, false);
        assert_eq!(layer_visibility(&layers), vec![false, false, false]);

        set_layer_visibility(&mut layers, true);
        assert_eq!(layer_visibility(&layers), vec![true, true, true]);

        invert_layer_visibility(&mut layers);
        assert_eq!(layer_visibility(&layers), vec![false, false, false]);
    }

    #[test]
    fn visible_layer_count_counts_only_enabled_layers() {
        let layers = vec![
            layer_state(1, true),
            layer_state(2, false),
            layer_state(3, true),
        ];

        assert_eq!(visible_layer_count(&layers), 2);
    }

    #[test]
    fn layer_hover_text_includes_rule_metadata_when_available() {
        let mut layer = layer_state(4, true);
        layer.name = "M4".to_string();
        layer.layer_type = "routing".to_string();
        layer.display_role = "metal".to_string();
        layer.direction = "vertical".to_string();
        layer.width = 100;
        layer.pitch_x = 200;
        layer.pitch_y = 300;
        layer.min_spacing = 70;
        layer.min_area = 400;
        layer.min_step = 50;
        layer.cut_spacing = 80;
        layer.enclosure_below = "1,2".to_string();
        layer.enclosure_above = "3,4".to_string();
        layer.lef58_rule_count = 5;

        assert_eq!(
            layer_hover_text(&layer),
            "id: 4\norder: 4\ntype: routing\nstyle role: metal\ndirection: vertical\nwidth: 100\npitch: 200 300\nmin spacing: 70\nmin area: 400\nmin step: 50\ncut spacing: 80\nenclosure below: 1,2\nenclosure above: 3,4\nLEF58 rules: 5"
        );
    }

    #[test]
    fn visible_layer_ids_for_render_query_are_sorted_from_visible_layer_map() {
        let visible_layers = BTreeMap::from([
            (
                7,
                LayerStyle::default_for_layer(7, chip_display::ColorTheme::Vivid),
            ),
            (
                3,
                LayerStyle::default_for_layer(3, chip_display::ColorTheme::Vivid),
            ),
        ]);

        assert_eq!(visible_layer_ids(&visible_layers), vec![3, 7]);
    }

    #[test]
    fn visible_style_for_shape_skips_shapes_from_invisible_layers() {
        let visible_layers = BTreeMap::from([(
            3,
            LayerStyle::default_for_layer(3, chip_display::ColorTheme::Vivid),
        )]);
        let all_layers = BTreeMap::from([
            (
                3,
                LayerStyle::default_for_layer(3, chip_display::ColorTheme::Vivid),
            ),
            (
                4,
                LayerStyle::default_for_layer(4, chip_display::ColorTheme::Vivid),
            ),
        ]);
        let visible_shape = chipgeom_format::ShapeRecord {
            layer_id: 3,
            ..chipgeom_format::ShapeRecord::default()
        };
        let hidden_shape = chipgeom_format::ShapeRecord {
            layer_id: 4,
            ..chipgeom_format::ShapeRecord::default()
        };
        let hidden_instance = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };

        assert!(
            visible_style_for_shape(&visible_shape, None, &visible_layers, &all_layers).is_some()
        );
        assert!(
            visible_style_for_shape(&hidden_shape, None, &visible_layers, &all_layers).is_none()
        );
        assert!(visible_style_for_shape(
            &hidden_shape,
            Some(&hidden_instance),
            &visible_layers,
            &all_layers
        )
        .is_some());
    }

    #[test]
    fn render_query_layers_keep_layout_layer_for_layout_level_owner_categories() {
        let mut layers = vec![
            layer_state(0, false),
            layer_state(7, true),
            layer_state(8, false),
        ];

        assert_eq!(
            render_query_layer_ids(&layers, ObjectVisibility::default()),
            vec![0, 7]
        );

        let mut visibility = ObjectVisibility::default();
        visibility.set_category_visible(DrawingCategory::Instances, false);
        visibility.set_category_visible(DrawingCategory::Boundaries, false);
        visibility.set_category_visible(DrawingCategory::Placement, false);
        visibility.set_category_visible(DrawingCategory::Regions, false);
        visibility.set_category_visible(DrawingCategory::Fill, false);
        assert_eq!(render_query_layer_ids(&layers, visibility), vec![7]);

        layers[0].visible = true;
        assert_eq!(render_query_layer_ids(&layers, visibility), vec![0, 7]);

        let idb_only_layers = vec![layer_state(7, true), layer_state(8, false)];
        assert_eq!(
            render_query_layer_ids(&idb_only_layers, ObjectVisibility::default()),
            vec![0, 7]
        );

        for category in [
            DrawingCategory::Tracks,
            DrawingCategory::GCells,
            DrawingCategory::Obstructions,
            DrawingCategory::Regions,
        ] {
            let mut visibility = ObjectVisibility::default();
            visibility.set_all_visible(false);
            visibility.set_category_visible(category, true);
            assert_eq!(
                render_query_layer_ids(&idb_only_layers, visibility),
                vec![0, 7]
            );
        }
    }

    #[test]
    fn pan_drag_applies_frame_delta() {
        let mut drag = PanDragState::default();
        drag.start(CanvasDragMode::Pan);
        let pan = drag.apply_pan_frame(egui::Vec2::ZERO, egui::vec2(10.0, 2.0));
        assert_eq!(pan, egui::vec2(10.0, 2.0));

        let pan = drag.apply_pan_frame(pan, egui::vec2(8.0, -3.0));

        assert_eq!(pan, egui::vec2(18.0, -1.0));
    }

    #[test]
    fn edit_drag_accumulates_frame_deltas() {
        let mut drag = PanDragState::default();
        drag.start(CanvasDragMode::Edit);

        assert_eq!(
            drag.accumulate(egui::vec2(10.0, 2.0)),
            egui::vec2(10.0, 2.0)
        );
        assert_eq!(
            drag.accumulate(egui::vec2(8.0, -3.0)),
            egui::vec2(18.0, -1.0)
        );
    }

    #[test]
    fn pan_drag_state_resets_between_gestures() {
        let mut drag = PanDragState::default();
        drag.start(CanvasDragMode::Edit);
        assert_eq!(
            drag.accumulate(egui::vec2(10.0, 0.0)),
            egui::vec2(10.0, 0.0)
        );
        drag.reset();

        assert_eq!(drag.mode(), None);
        drag.start(CanvasDragMode::Edit);
        assert_eq!(drag.accumulate(egui::vec2(4.0, 0.0)), egui::vec2(4.0, 0.0));
    }

    #[test]
    fn pending_edit_polling_requests_periodic_repaint() {
        assert_eq!(
            edit_poll_repaint_interval(true),
            Some(std::time::Duration::from_millis(100))
        );
        assert_eq!(edit_poll_repaint_interval(false), None);
    }

    #[test]
    fn pending_edit_or_session_action_blocks_a_new_edit_command() {
        assert!(can_start_edit_command(false, false, false));
        assert!(!can_start_edit_command(true, false, false));
        assert!(!can_start_edit_command(false, true, false));
        assert!(!can_start_edit_command(false, false, true));
    }

    #[test]
    fn snapshot_file_signature_does_not_change_for_identical_file_state() {
        let dir = std::env::temp_dir().join(format!(
            "chip-viewer-native-signature-same-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("geometry.manifest");

        fs::write(&path, b"manifest").unwrap();
        let previous = snapshot_file_signature(vec![path.clone()]);
        let current = snapshot_file_signature(vec![path.clone()]);

        assert!(!snapshot_file_signature_changed(&previous, &current));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_file_signature_detects_binary_file_size_changes() {
        let dir = std::env::temp_dir().join(format!(
            "chip-viewer-native-signature-size-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("geometry.shapes.bin");

        fs::write(&path, b"a").unwrap();
        let previous = snapshot_file_signature(vec![path.clone()]);
        fs::write(&path, b"abcdef").unwrap();
        let current = snapshot_file_signature(vec![path.clone()]);

        assert!(snapshot_file_signature_changed(&previous, &current));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_file_signature_detects_missing_file_becoming_available() {
        let dir = std::env::temp_dir().join(format!(
            "chip-viewer-native-signature-missing-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("geometry.delta.bin");

        let previous = snapshot_file_signature(vec![path.clone()]);
        fs::write(&path, b"delta").unwrap();
        let current = snapshot_file_signature(vec![path.clone()]);

        assert!(snapshot_file_signature_changed(&previous, &current));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn external_snapshot_refresh_records_reopened_manifest_file_set() {
        let dir = temp_snapshot_dir("external-refresh-new-delta");
        write_empty_snapshot(&dir, false);
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let mut loaded = LoadedViewer::new(
            chip_display::ColorTheme::Vivid,
            db,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            wgpu::TextureFormat::Bgra8Unorm,
            true,
        );
        let delta_path = dir.join("geometry.delta.bin");

        assert!(!loaded.snapshot_signature.files.contains_key(&delta_path));

        write_empty_geometry_file(
            &delta_path,
            chipgeom_format::GeometryFileKind::Delta,
            core::mem::size_of::<chipgeom_format::GeometryDeltaRecord>() as u32,
            &[],
        );
        write_manifest(&dir, true);
        loaded.next_snapshot_refresh_check = Instant::now() - Duration::from_secs(1);

        loaded.poll_external_snapshot_refresh();

        assert!(loaded.db.snapshot().manifest().delta.is_some());
        assert!(loaded.snapshot_signature.files.contains_key(&delta_path));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restored_edit_session_starts_dirty() {
        let dir = temp_snapshot_dir("restored-edit-session-dirty");
        write_empty_snapshot(&dir, false);
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let loaded = LoadedViewer::new(
            chip_display::ColorTheme::Vivid,
            db,
            true,
            true,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            wgpu::TextureFormat::Bgra8Unorm,
            true,
        );

        assert!(loaded.session_dirty);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn loaded_viewer_falls_back_to_cpu_when_wgpu_unavailable() {
        let dir = temp_snapshot_dir("cpu-fallback-test");
        write_empty_snapshot(&dir, false);
        let db = ChipViewDb::open(dir.join("geometry.manifest")).unwrap();
        let loaded = LoadedViewer::new(
            chip_display::ColorTheme::Vivid,
            db,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            wgpu::TextureFormat::Bgra8Unorm,
            false,
        );

        assert!(!loaded.gpu_canvas.enabled);
        assert!(!loaded.gpu_canvas.failed);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn instance_move_allows_only_instance_bounding_boxes() {
        assert!(instance_move_is_allowed(
            chipgeom_format::OwnerType::InstanceBBox as u8
        ));
        assert!(!instance_move_is_allowed(
            chipgeom_format::OwnerType::NetWireSegment as u8
        ));
        assert!(!instance_move_is_allowed(
            chipgeom_format::OwnerType::PinPortShape as u8
        ));
    }

    #[test]
    fn editable_instance_hit_ignores_overlapping_non_instance_shapes() {
        let point = Point32 { x: 15, y: 15 };
        let instance = ShapeRecord {
            id: 10,
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Alive as u8,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 30,
                hy: 30,
            },
            ..ShapeRecord::default()
        };
        let wire = ShapeRecord {
            id: 99,
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Alive as u8,
            bbox: instance.bbox,
            ..ShapeRecord::default()
        };
        let instance_owner = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };
        let wire_owner = OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            ..OwnerRef::default()
        };

        assert_eq!(
            pick_top_editable_instance_bbox(
                [(&instance, &instance_owner), (&wire, &wire_owner)],
                point,
            ),
            Some(instance.id)
        );
    }

    #[test]
    fn editable_instance_hit_uses_topmost_overlapping_instance_bbox() {
        let point = Point32 { x: 15, y: 15 };
        let lower_instance = ShapeRecord {
            id: 20,
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Alive as u8,
            bbox: Rect32 {
                lx: 0,
                ly: 0,
                hx: 30,
                hy: 30,
            },
            ..ShapeRecord::default()
        };
        let upper_instance = ShapeRecord {
            id: 10,
            bbox: lower_instance.bbox,
            ..lower_instance
        };
        let instance_owner = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };

        assert_eq!(
            pick_top_editable_instance_bbox(
                [
                    (&lower_instance, &instance_owner),
                    (&upper_instance, &instance_owner)
                ],
                point,
            ),
            Some(upper_instance.id)
        );
    }

    #[test]
    fn edit_capability_lines_report_supported_tools_and_read_only_reasons() {
        let shape = chipgeom_format::ShapeRecord {
            kind: ShapeKind::Rect as u8,
            state: ShapeState::Alive as u8,
            ..chipgeom_format::ShapeRecord::default()
        };
        let instance_owner = OwnerRef {
            owner_type: OwnerType::InstanceBBox as u8,
            ..OwnerRef::default()
        };
        let net_owner = OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            ..OwnerRef::default()
        };
        let pin_owner = OwnerRef {
            owner_type: OwnerType::PinPortShape as u8,
            ..OwnerRef::default()
        };

        assert_eq!(
            edit_capability_lines(&shape, Some(&instance_owner), false),
            vec!["edit: view-only session".to_string()]
        );
        assert_eq!(
            edit_capability_lines(&shape, Some(&instance_owner), true),
            vec![
                "edit: move".to_string(),
                "edit note: instance resize is rejected; move preserves master size".to_string(),
            ]
        );
        assert_eq!(
            edit_capability_lines(&shape, Some(&net_owner), true),
            vec!["edit: read-only, net_wire_segment is not editable".to_string()]
        );
        assert_eq!(
            edit_capability_lines(&shape, Some(&pin_owner), true),
            vec!["edit: read-only, pin_port_shape is not editable".to_string()]
        );
    }

    #[test]
    fn edit_result_action_reloads_for_accepted_adjusted_and_conflict() {
        let accepted = edit_result_action(&edit_result(GeometryEditStatus::Accepted));
        let adjusted = edit_result_action(&edit_result(GeometryEditStatus::AdjustedAccepted));
        let conflict = edit_result_action(&edit_result(GeometryEditStatus::Conflict));

        assert!(accepted.reload_snapshot);
        assert!(adjusted.reload_snapshot);
        assert!(conflict.reload_snapshot);
        assert!(conflict.message.contains("retry"));
        assert_eq!(conflict.selected_shape_id, Some(7));
    }

    #[test]
    fn edit_result_action_does_not_reload_for_rejected() {
        let rejected = edit_result_action(&edit_result(GeometryEditStatus::Rejected));

        assert!(!rejected.reload_snapshot);
        assert!(rejected.message.contains("rejected"));
        assert!(rejected.message.contains("restored"));
        assert_eq!(rejected.selected_shape_id, Some(7));
    }

    #[test]
    fn edit_result_action_includes_diagnostic_message() {
        let mut result = edit_result(GeometryEditStatus::Rejected);
        result.message = Some("apply-edit failed".to_string());

        let rejected = edit_result_action(&result);

        assert!(rejected.message.contains("apply-edit failed"));
    }

    fn edit_result(status: GeometryEditStatus) -> GeometryEditResult {
        GeometryEditResult {
            command_id: 1,
            shape_id: 7,
            new_version: 3,
            status,
            committed_bbox: chipgeom_format::Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
            message: None,
            geometry_manifest_path: None,
        }
    }

    fn layer_state(layer_id: LayerId, visible: bool) -> LayerUiState {
        LayerUiState {
            layer_id,
            shape_count: 1,
            order: u32::from(layer_id),
            name: format!("L{layer_id}"),
            layer_type: "unknown".to_string(),
            display_role: "unknown".to_string(),
            direction: "unknown".to_string(),
            width: 0,
            pitch_x: 0,
            pitch_y: 0,
            min_spacing: 0,
            min_area: 0,
            min_step: 0,
            cut_spacing: 0,
            enclosure_below: String::new(),
            enclosure_above: String::new(),
            lef58_rule_count: 0,
            visible,
            style: LayerStyle::default_for_layer(layer_id, chip_display::ColorTheme::Vivid),
        }
    }

    fn temp_snapshot_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "chip-viewer-native-{test_name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_empty_snapshot(path: &Path, include_delta: bool) {
        let meta = chipgeom_format::GeometryMetaRecord {
            next_shape_id: 1,
            ..chipgeom_format::GeometryMetaRecord::default()
        };
        write_empty_geometry_file(
            &path.join("geometry.meta.bin"),
            chipgeom_format::GeometryFileKind::Meta,
            core::mem::size_of::<chipgeom_format::GeometryMetaRecord>() as u32,
            any_as_bytes(&meta),
        );
        write_empty_geometry_file(
            &path.join("geometry.shapes.bin"),
            chipgeom_format::GeometryFileKind::Shapes,
            core::mem::size_of::<ShapeRecord>() as u32,
            &[],
        );
        write_empty_geometry_file(
            &path.join("geometry.owners.bin"),
            chipgeom_format::GeometryFileKind::Owners,
            core::mem::size_of::<OwnerRef>() as u32,
            &[],
        );
        write_empty_geometry_file(
            &path.join("geometry.payload.bin"),
            chipgeom_format::GeometryFileKind::Payload,
            1,
            &[],
        );
        write_empty_geometry_file(
            &path.join("geometry.names.bin"),
            chipgeom_format::GeometryFileKind::Names,
            1,
            &[],
        );
        write_empty_geometry_file(
            &path.join("geometry.name_index.bin"),
            chipgeom_format::GeometryFileKind::NameIndex,
            core::mem::size_of::<chipgeom_format::GeometryNameRecord>() as u32,
            &[],
        );
        write_empty_geometry_file(
            &path.join("geometry.sidmap.bin"),
            chipgeom_format::GeometryFileKind::SidMap,
            core::mem::size_of::<chipgeom_format::GeometrySidMapRecord>() as u32,
            &[],
        );
        write_empty_geometry_file(
            &path.join("geometry.view.bin"),
            chipgeom_format::GeometryFileKind::View,
            core::mem::size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
            &[],
        );
        fs::write(
            path.join("geometry.sites.txt"),
            "name\tclass\tsymmetry\torient\twidth\theight\tis_overlap\n",
        )
        .unwrap();
        fs::write(
            path.join("geometry.masters.txt"),
            "name\ttype\tsite\tsymmetry\torigin_x\torigin_y\twidth\theight\tterm_count\tobs_count\n",
        )
        .unwrap();
        fs::write(
            path.join("geometry.vias.txt"),
            "name\tmaster\ttype\trule\tbottom\tcut\ttop\tcut_width\tcut_height\tcut_spacing_x\tcut_spacing_y\tenclosure_bottom_x\tenclosure_bottom_y\tenclosure_top_x\tenclosure_top_y\trows\tcols\tdefault\n",
        )
        .unwrap();
        fs::write(
            path.join("geometry.grids.txt"),
            "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\n",
        )
        .unwrap();
        fs::write(
            path.join("geometry.connectivity.txt"),
            "net\tkind\tendpoint_type\tinstance\tpin\tmaster\n",
        )
        .unwrap();
        fs::write(
            path.join("geometry.buses.txt"),
            "name\ttype\tleft\tright\tnet_count\tpin_count\n",
        )
        .unwrap();
        fs::write(
            path.join("geometry.groups.txt"),
            "name\tregion\tinstance_count\n",
        )
        .unwrap();
        if include_delta {
            write_empty_geometry_file(
                &path.join("geometry.delta.bin"),
                chipgeom_format::GeometryFileKind::Delta,
                core::mem::size_of::<chipgeom_format::GeometryDeltaRecord>() as u32,
                &[],
            );
        }
        write_manifest(path, include_delta);
    }

    fn write_manifest(path: &Path, include_delta: bool) {
        let delta = if include_delta {
            "delta=geometry.delta.bin\n"
        } else {
            ""
        };
        fs::write(
            path.join("geometry.manifest"),
            format!(
                "schema_version=1\n\
                 shape_count=0\n\
                 owner_count=0\n\
                 payload_size=0\n\
                 meta=geometry.meta.bin\n\
                 shapes=geometry.shapes.bin\n\
                 owners=geometry.owners.bin\n\
                 payload=geometry.payload.bin\n\
                 names=geometry.names.bin\n\
                 name_index=geometry.name_index.bin\n\
                 sidmap=geometry.sidmap.bin\n\
                 {delta}\
                 view=geometry.view.bin\n\
                 sites=geometry.sites.txt\n\
                 masters=geometry.masters.txt\n\
                 vias=geometry.vias.txt\n\
                 grids=geometry.grids.txt\n\
                 connectivity=geometry.connectivity.txt\n\
                 buses=geometry.buses.txt\n\
                 groups=geometry.groups.txt\n"
            ),
        )
        .unwrap();
    }

    fn write_empty_geometry_file(
        path: &Path,
        file_kind: chipgeom_format::GeometryFileKind,
        record_size: u32,
        payload: &[u8],
    ) {
        let record_count = if record_size == 0 {
            0
        } else {
            payload.len() as u64 / record_size as u64
        };
        let header = chipgeom_format::GeometryFileHeader {
            magic: chipgeom_format::GEOMETRY_FILE_MAGIC,
            schema_version: chipgeom_format::GEOMETRY_SCHEMA_VERSION,
            header_size: chipgeom_format::GEOMETRY_FILE_HEADER_SIZE as u32,
            file_kind: file_kind as u16,
            record_size,
            record_count,
            payload_size: payload.len() as u64,
            ..chipgeom_format::GeometryFileHeader::default()
        };
        let mut file = fs::File::create(path).unwrap();
        file.write_all(any_as_bytes(&header)).unwrap();
        file.write_all(payload).unwrap();
    }

    fn any_as_bytes<T: Sized>(value: &T) -> &[u8] {
        unsafe {
            std::slice::from_raw_parts(
                std::ptr::from_ref(value).cast::<u8>(),
                core::mem::size_of::<T>(),
            )
        }
    }

    #[test]
    fn session_action_command_is_written_atomically_with_action_and_id() {
        let directory = temp_snapshot_dir("session-action-command");
        let path = directory.join("control-save-42.json");
        let command = SessionActionCommand {
            action: SessionActionKind::Save,
            command_id: 42,
        };

        write_session_action_command(&path, &command).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(content["action"], "save");
        assert_eq!(content["command_id"], 42);
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_command_ids_are_javascript_safe_and_monotonic() {
        let mut counter = 1;
        assert_eq!(next_native_command_id(&mut counter), 1);
        assert_eq!(next_native_command_id(&mut counter), 2);

        let mut last_counter = u32::MAX;
        let last_id = next_native_command_id(&mut last_counter);
        assert_eq!(last_id, u64::from(u32::MAX));
        assert!(last_id <= MAX_JAVASCRIPT_SAFE_INTEGER);
    }

    #[test]
    fn sidebar_keeps_query_section_at_the_original_bottom_height() {
        let heights = sidebar_section_heights(640.0);
        let used_height = heights.view
            + heights.interaction
            + heights.physical_layers
            + heights.drawing_data
            + SIDEBAR_SECTION_RESERVE_HEIGHT;

        assert!((136.0..=180.0).contains(&heights.interaction));
        assert!(used_height <= 640.0);
    }

    #[test]
    fn viewer_edit_command_preserves_geometry_fields_and_instance_name() {
        let directory = temp_snapshot_dir("viewer-edit-command");
        let path = directory.join("command-42.json");
        let command = GeometryEditCommand {
            command_id: 42,
            shape_id: 11,
            expected_version: 3,
            op: GeometryEditOp::MoveShape,
            requested_bbox: Rect32 {
                lx: 100,
                ly: 200,
                hx: 120,
                hy: 240,
            },
        };

        write_edit_command(&path, &command, Some("u_sram_0")).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(content["command_id"], 42);
        assert_eq!(content["shape_id"], 11);
        assert_eq!(content["instance_name"], "u_sram_0");
        assert_eq!(content["requested_bbox"]["lx"], 100);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn session_action_result_message_includes_status_and_diagnostic() {
        let result = SessionActionResult {
            action: SessionActionKind::Discard,
            accepted: false,
            command_id: 17,
            geometry_manifest_path: None,
            message: Some("source changed".to_string()),
        };

        assert_eq!(
            session_action_result_message(&result),
            "discard rejected: source changed"
        );
    }

    #[test]
    fn session_action_progress_deserializes_the_cross_process_save_protocol() {
        let progress: SessionActionProgress = serde_json::from_str(
            r#"{
                "action": "save",
                "command_id": 42,
                "phase": "verifying_artifacts",
                "percent": 50,
                "message": "Verifying published artifacts"
            }"#,
        )
        .unwrap();

        assert_eq!(progress.action, SessionActionKind::Save);
        assert_eq!(progress.command_id, 42);
        assert_eq!(
            progress.phase,
            SessionActionProgressPhase::VerifyingArtifacts
        );
        assert_eq!(progress.percent, 50);
        assert_eq!(progress.fraction(), 0.5);
        assert!(!progress.phase.is_terminal());
    }

    fn layer_visibility(layers: &[LayerUiState]) -> Vec<bool> {
        layers.iter().map(|layer| layer.visible).collect()
    }
}
