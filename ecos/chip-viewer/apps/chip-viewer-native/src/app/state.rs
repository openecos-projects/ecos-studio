#[derive(Clone, Debug, Default, Serialize)]
pub struct CanvasRenderStats {
    pub frame_time_ms: f32,
    pub frame_interval_ms: f32,
    pub previous_native_cpu_ms: f32,
    pub previous_ui_update_ms: f32,
    pub query_time_ms: f32,
    pub filter_time_ms: f32,
    pub paint_time_ms: f32,
    pub label_paint_time_ms: f32,
    pub label_resolve_time_ms: f32,
    pub drawn_shapes: usize,
    pub estimated_primitives: usize,
    pub label_count: usize,
    pub selected_shape_id: Option<ShapeId>,
    pub use_view_tiles: bool,
    pub zoom: f32,
    pub lod: u8,
    pub visible_drc_count: usize,
    pub visible_antenna_count: usize,
    pub is_gpu: bool,
    pub cpu_scene_pending: bool,
    pub cpu_scene_visible: bool,
    pub cpu_stats_after_paint: bool,
    pub cpu_scene_preview: bool,
    pub cpu_scene_held: bool,
    pub cpu_scene_partial: bool,
    pub cpu_retained_valid_pixels: usize,
    pub cpu_retained_validation_ms: f32,
    pub cpu_history_bytes: usize,
    pub cpu_scene_cache_hit: bool,
    pub cpu_labels_pending: bool,
    pub cpu_scene_build_ms: f32,
    pub cpu_scene_pipeline_ms: f32,
    pub cpu_rasterizations: usize,
    pub scene_pending: bool,
    pub geometry_drawn_shapes: usize,
    pub cpu_scene_raster_ms: f32,
    pub cpu_label_resolve_ms: f32,
    pub previous_raster_present_ms: f32,
}

struct GpuCachedLabel {
    shape_id: ShapeId,
    key: ShapeLabelKey,
    rect: Rect32,
    text: String,
    kind: ShapeLabelKind,
    category: u8,
    context_only: bool,
}

struct GpuTileData {
    instances: std::sync::Arc<Vec<crate::canvas_gpu::GpuShapeInstance>>,
    labels: Vec<GpuCachedLabel>,
    category_counts: [[usize; 32]; 2],
    byte_size: usize,
}

impl GpuTileData {
    fn estimated_bytes(&self) -> usize {
        self.byte_size
    }

    fn visible_count(&self, visibility_mask: u32, show_context: bool) -> usize {
        (0..32)
            .filter(|&category| {
                category == crate::canvas_gpu::UNCATEGORIZED_DRAWING_CATEGORY
                    || visibility_mask & (1 << category) != 0
            })
            .map(|category| {
                let category = usize::from(category);
                self.category_counts[0][category]
                    + if show_context {
                        self.category_counts[1][category]
                    } else {
                        0
                    }
            })
            .sum()
    }
}

pub struct ChipViewerApp {
    state: ViewerState,
    theme_initialized: bool,
    startup_focus_requested: bool,
    benchmark_started_at: Instant,
}

struct LoadingViewer {
    manifest: PathBuf,
    started_at: Instant,
    receiver: Receiver<Result<PreparedViewer, String>>,
    edit_enabled: bool,
    initial_session_dirty: bool,
    edit_command_dir: Option<PathBuf>,
    edit_result_dir: Option<PathBuf>,
    macro_staging_path: Option<PathBuf>,
    drc_data_path: Option<PathBuf>,
    drc_statis_path: Option<PathBuf>,
    antenna_data_path: Option<PathBuf>,
    antenna_statis_path: Option<PathBuf>,
    lvs_data_path: Option<PathBuf>,
    map_root_path: Option<PathBuf>,
    sta_feature_dir: Option<PathBuf>,
    pub target_format: wgpu::TextureFormat,
    pub render_mode: crate::RenderMode,
}

struct PreparedViewer {
    db: std::sync::Arc<ChipViewDb>,
    stats: SnapshotStats,
    grid_bounds: Option<Rect32>,
    drawing_category_counts: BTreeMap<DrawingCategory, usize>,
    snapshot_signature: SnapshotFileSignature,
    layer_catalog: Vec<LayerSummary>,
}

type DrawingCategoryCounts = Arc<OnceLock<BTreeMap<DrawingCategory, usize>>>;
type UnroutedGuides = Arc<OnceLock<Vec<UnroutedNetGuide>>>;

fn start_drawing_category_data(
    db: Arc<ChipViewDb>,
    counts: DrawingCategoryCounts,
    guides: UnroutedGuides,
) {
    thread::spawn(move || {
        let prepared_guides = db.unrouted_net_guides().to_vec();
        let _ = guides.set(prepared_guides.clone());
        let _ = counts.set(drawing_category_counts(&db, &prepared_guides));
    });
}

impl From<ChipViewDb> for PreparedViewer {
    fn from(db: ChipViewDb) -> Self {
        // Stats are cached; category counts and guides prepare off the UI thread.
        let stats = db.stats();
        let grid_bounds = stats.die_bbox.or(stats.bbox);
        let drawing_category_counts = BTreeMap::new();
        let snapshot_signature = snapshot_signature_for_db(&db);
        let layer_catalog = db.layer_catalog();
        Self {
            db: std::sync::Arc::new(db),
            stats,
            grid_bounds,
            drawing_category_counts,
            snapshot_signature,
            layer_catalog,
        }
    }
}

struct LoadedViewer {
    color_theme: chip_display::ColorTheme,
    start_time: Instant,
    db: std::sync::Arc<ChipViewDb>,
    stats: SnapshotStats,
    grid_bounds: Option<Rect32>,
    drawing_category_counts: DrawingCategoryCounts,
    unrouted_net_guides: UnroutedGuides,
    spatial_index_prewarm_started: bool,
    layers: Vec<LayerUiState>,
    edit_enabled: bool,
    edit_command_dir: Option<PathBuf>,
    edit_result_dir: Option<PathBuf>,
    macro_staging: Option<MacroStagingState>,
    macro_toolbox_preferences: crate::macro_toolbar::MacroToolboxPreferences,
    query_input_mode: QueryInputMode,
    search_text: String,
    search_mode: SearchMode,
    search_highlighted: BTreeSet<ShapeId>,
    search_worker: search_worker::SearchWorker,
    search_truncated: bool,
    focus_search_results: bool,
    shape_id_text: String,
    last_query_status: Option<String>,
    highlighted: BTreeSet<ShapeId>,
    clock_tree_overlay: clock_tree::ClockTreeOverlay,
    selected: Option<ShapeId>,
    pending_focus: Option<PendingFocus>,
    macro_interaction: Option<MacroCanvasInteraction>,
    draft: Option<EditDraft>,
    pending_edit: Option<PendingEdit>,
    pending_session_action: Option<PendingSessionAction>,
    pending_reload: Option<PendingReload>,
    session_action_progress: Option<SessionActionProgress>,
    last_edit_result: Option<String>,
    session_dirty: bool,
    close_confirmation_visible: bool,
    close_after_session_action: bool,
    /// Set after the user explicitly chooses to close without Save/Discard.
    /// This bypasses the unsaved-edit interception on the following close
    /// event, so an unavailable host cannot trap the native window.
    close_without_session_action: bool,
    snapshot_signature: SnapshotFileSignature,
    next_snapshot_refresh_check: Instant,
    render_cache: RenderPlanCache,
    cpu_scene_cache: cpu_scene::CpuSceneCache,
    pattern_textures: OnceLock<Arc<cpu_scene::PatternTextureSet>>,
    glow_rendering: bool,
    glow_renderer: Option<String>,
    previous_native_cpu_ms: f32,
    previous_ui_update_ms: f32,
    view_tile_cache: ViewTilePlaneCache,
    view_tiles_latch: gpu_overview::ViewTileOverviewLatch,
    next_command_counter: u32,
    drc_overlay: Option<DrcOverlay>,
    selected_drc: Option<usize>,
    antenna_overlay: Option<AntennaOverlay>,
    selected_antenna: Option<usize>,
    lvs_analysis: Option<lvs::LvsAnalysis>,
    selected_lvs_group: Option<usize>,
    show_all_lvs: bool,
    timing: Option<timing::TimingPanelState>,
    timing_loading: Option<Receiver<timing::TimingPanelState>>,
    clock_tree: Option<crate::clock_tree::ClockTreePanel>,
    map_catalog: Option<MapCatalog>,
    map_catalog_error: Option<String>,
    analysis_tab: AnalysisTab,
    expanded_map_categories: BTreeSet<String>,
    selected_map_item: Option<crate::map_source::MapKey>,
    previous_map_item: Option<(crate::map_data::MapItem, Option<PathBuf>)>,
    active_heatmap: Option<ActiveHeatmap>,
    heatmap_composition: heatmap_composition::HeatmapComposition,
    map_item_error: Option<String>,
    analysis_loader: Option<analysis_loader::AnalysisLoader>,
    analysis_paths: analysis_loader::AnalysisPaths,
    map_loading: Option<Receiver<Result<ActiveHeatmap, String>>>,
    map_requests: Option<mpsc::Sender<display_data::MapRequest>>,
    analysis_load_error: Option<String>,
    analysis_tab_user_selected: bool,
    selected_map_bbox: Option<Rect32>,
    focus_animation: Option<FocusAnimation>,
    zoom: f32,
    pan: egui::Vec2,
    pan_drag: PanDragState,
    wheel_camera: wheel_camera::WheelCamera,
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
    visibility_rules_cache: VisibilityRulesCache,
    pub gpu_canvas: Option<crate::canvas_gpu::GpuCanvasState>,
    gpu_frame_counter: u64,
    gpu_tile_instances:
        std::collections::HashMap<crate::canvas_gpu::GpuBufferKey, std::sync::Arc<GpuTileData>>,
    gpu_tile_worker: GpuTileWorker,
    gpu_3d_instances_cache: Option<(
        u64,
        Rect32,
        std::sync::Arc<Vec<crate::canvas_gpu3d::GpuShapeInstance3d>>,
    )>,
    perf_3d: Perf3dState,
    label_collector: ShapeLabelCollector,
    status_line_buffer: String,
    shortcuts_overlay_visible: bool,
    loading_3d_start: Option<std::time::Instant>,
}

#[derive(Clone, Copy, Debug, Default)]
struct Perf3dState {
    last_camera: Option<crate::camera3d::OrbitCamera>,
}

impl LoadedViewer {
    #[inline]
    pub fn is_gpu_active(&self) -> bool {
        self.gpu_canvas
            .as_ref()
            .is_some_and(|g| g.enabled && !g.failed)
    }
}

#[derive(Clone)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AnalysisTab {
    Antenna,
    ClockTree,
    Drc,
    Lvs,
    Map,
    Timing,
}

struct ActiveHeatmap {
    title: String,
    data: HeatmapData,
    selected_cell: Option<(usize, usize)>,
    colormap_mode: ColormapMode,
    threshold: f32,
    invert_threshold: bool,
    opacity: f32,
    popup: render_support::PopupHeatmap,
    world: world_heatmap::WorldHeatmap,
    colors_revision: Arc<()>,
    instances: std::cell::OnceCell<std::sync::Arc<Vec<crate::canvas_gpu::GpuShapeInstance>>>,
}

fn heatmap_core_cell(rect: Rect32, pitch: Option<(i32, i32)>) -> bool {
    let Some((px, py)) = pitch else { return true };
    // The irregular boundary ring extends beyond the core. Allow the grid
    // writer's rounding of interior cells within the existing 5% tolerance.
    let within_pitch = |lo: i32, hi: i32, step: i32| {
        let width = (i64::from(hi) - i64::from(lo)).abs();
        (width - i64::from(step)).abs() * 20 <= i64::from(step)
    };
    within_pitch(rect.lx, rect.hx, px) && within_pitch(rect.ly, rect.hy, py)
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
        if !heatmap_core_cell(rect, pitch) {
            continue;
        }
        let Some(color) = data.cell_color(row, col, mode, threshold, invert) else {
            continue;
        };
        instances.push(crate::canvas_gpu::GpuShapeInstance {
            rect_dbu: [rect.lx, rect.ly, rect.hx, rect.hy],
            fill_rgba: crate::canvas_gpu::pack_rgba_u32(color.to_array()),
            frame_rgba: 0,               // no outline
            pattern_bits: (0 << 16) | 1, // shape_type=rect, pattern=solid
            line_width_px: 0.0,
        });
    }
    std::sync::Arc::new(instances)
}

impl ActiveHeatmap {
    fn invalidate_colors(&mut self) {
        self.colors_revision = Arc::new(());
        self.instances.take();
        self.popup.invalidate_colors();
        self.world.invalidate_colors();
    }

    fn instances(&self) -> &std::sync::Arc<Vec<crate::canvas_gpu::GpuShapeInstance>> {
        self.instances.get_or_init(|| {
            build_heatmap_instances(&self.data, self.colormap_mode, self.threshold, self.invert_threshold)
        })
    }

    fn new(title: String, data: HeatmapData) -> Self {
        let colormap_mode = data.default_colormap();
        let threshold = 0.0;
        let invert_threshold = false;
        Self {
            title,
            data,
            selected_cell: None,
            colormap_mode,
            threshold,
            invert_threshold,
            opacity: 0.65,
            world: Default::default(),
            colors_revision: Arc::new(()),
            popup: Default::default(),
            instances: Default::default(),
        }
    }

    fn set_colormap_mode(&mut self, mode: ColormapMode) {
        if self.colormap_mode != mode {
            self.colormap_mode = mode;
            self.invalidate_colors();
        }
    }

    fn set_threshold(&mut self, threshold: f32) {
        let clamped = threshold.clamp(0.0, 1.0);
        if (self.threshold - clamped).abs() > 0.001 {
            self.threshold = clamped;
            self.invalidate_colors();
        }
    }

    fn set_invert_threshold(&mut self, invert: bool) {
        if self.invert_threshold != invert {
            self.invert_threshold = invert;
            self.invalidate_colors();
        }
    }
}

struct EditDraft {
    command_id: u64,
    shape_id: ShapeId,
    expected_version: u32,
    instance_name: Option<String>,
    original_bbox: Rect32,
    requested_bbox: Rect32,
    /// Explicit R-notation orientation for macro placements; `None` keeps
    /// the preserve-orientation behavior of plain instance moves.
    orient: Option<MacroOrientation>,
    /// Explicit placement status for macro placements (e.g. "fixed").
    placement_status: Option<String>,
}

struct PendingEdit {
    result_path: PathBuf,
    /// Set for a manual drag from the unplaced macro staging row. These
    /// instances have no snapshot shape (shape_id 0), so the accepted result
    /// must update the local staging rectangle explicitly.
    staged_macro: Option<StagedMacroCommit>,
}

#[derive(Clone)]
struct StagedMacroCommit {
    name: String,
    orient: MacroOrientation,
    placement_status: Option<String>,
}

#[derive(Serialize)]
struct ViewerEditCommand<'a> {
    #[serde(flatten)]
    command: &'a GeometryEditCommand,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    orient: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    placement_status: Option<&'a str>,
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
    RecordingMacroPlacements,
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
            SessionActionProgressPhase::RecordingMacroPlacements => "Recording macro placements",
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
    queued_at: Instant,
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

#[cfg(test)]
fn search_pattern(query: &str) -> Result<Regex, regex::Error> {
    Regex::new(query)
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
    instances: crate::instance_visibility::InstanceClassVisibility,
    net_signal: bool,
    net_clock: bool,
    net_other: bool,
    pdn_power: bool,
    pdn_ground: bool,
    vias: bool,
    io_pin: bool,
    placement: bool,
    tracks: bool,
    gcells: bool,
    obstructions: bool,
    boundaries: bool,
    fill: bool,
    regions: bool,
    halo: bool,
}

impl ObjectVisibility {
    pub fn bits(&self) -> u32 {
        let mut b = 0;
        // Bit 0 mirrors "any instance class visible" so tile-cache keys keep
        // their coarse instance granularity; bits 14..16 hold the classes.
        if self.instances.any_visible() {
            b |= 1 << 0;
        }
        if self.instances.macro_ {
            b |= 1 << 14;
        }
        if self.instances.stdcell {
            b |= 1 << 15;
        }
        if self.instances.filler {
            b |= 1 << 16;
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
        if self.pdn_power {
            b |= 1 << 4;
        }
        if self.pdn_ground {
            b |= 1 << 17;
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
        if self.halo {
            b |= 1 << 18;
        }
        b
    }
}

impl Default for ObjectVisibility {
    fn default() -> Self {
        Self {
            instances: crate::instance_visibility::InstanceClassVisibility::default(),
            net_signal: false,
            net_clock: false,
            net_other: false,
            pdn_power: false,
            pdn_ground: false,
            vias: false,
            io_pin: false,
            placement: true,
            tracks: false,
            gcells: false,
            obstructions: false,
            boundaries: true,
            fill: true,
            regions: false,
            halo: true,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum DrawingCategory {
    InstanceMacro,
    InstanceStdCell,
    InstanceFiller,
    Halo,
    NetSignal,
    NetClock,
    NetOther,
    Vias,
    IoPins,
    Placement,
    Tracks,
    GCells,
    Obstructions,
    Boundaries,
    Fill,
    Regions,
    PdnPower,
    PdnGround,
}

impl DrawingCategory {
    /// Categories rendered flat in the drawing-data sidebar. Instance
    /// classes, net kinds, and the PDN power/ground split are grouped under
    /// tri-state parent nodes instead.
    const SIDEBAR_FLAT: [Self; 9] = [
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

    const ALL: [Self; 18] = [
        Self::InstanceMacro,
        Self::InstanceStdCell,
        Self::InstanceFiller,
        Self::Halo,
        Self::NetSignal,
        Self::NetClock,
        Self::NetOther,
        Self::Vias,
        Self::IoPins,
        Self::Placement,
        Self::Tracks,
        Self::GCells,
        Self::Obstructions,
        Self::Boundaries,
        Self::Fill,
        Self::Regions,
        Self::PdnPower,
        Self::PdnGround,
    ];

    fn instance_class(self) -> Option<crate::instance_visibility::InstanceClass> {
        match self {
            Self::InstanceMacro => Some(crate::instance_visibility::InstanceClass::Macro),
            Self::InstanceStdCell => Some(crate::instance_visibility::InstanceClass::StdCell),
            Self::InstanceFiller => Some(crate::instance_visibility::InstanceClass::Filler),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::InstanceMacro => "Macro",
            Self::InstanceStdCell => "StdCell",
            Self::InstanceFiller => "Filler",
            Self::Halo => "Halo",
            Self::NetSignal => "Signal Nets",
            Self::NetClock => "Clock Nets",
            Self::NetOther => "Other Nets",
            Self::PdnPower => "Power",
            Self::PdnGround => "Ground",
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
            Self::InstanceMacro | Self::InstanceStdCell | Self::InstanceFiller => {
                "Toggle this instance class in the layout canvas."
            }
            Self::Halo => "Instance halo keep-out rectangles.",
            Self::NetSignal => "Regular signal net wire segments.",
            Self::NetClock => "Clock net wire segments from DEF net connect type.",
            Self::NetOther => "Non-signal and non-clock regular net wire segments.",
            Self::PdnPower => "Power net special wire segments (e.g. VDD, VCC).",
            Self::PdnGround => "Ground net special wire segments (e.g. VSS, GND).",
            Self::Vias => "Via owners are drawn on their assigned physical layer.",
            Self::Placement | Self::Tracks | Self::GCells | Self::Obstructions => {
                "Context geometry is shown after zooming in to keep the fitted route view readable."
            }
            _ => "Toggle this geometry category in the layout canvas.",
        }
    }

    fn includes_owner_type(self, owner_type: OwnerType) -> bool {
        match self {
            Self::InstanceMacro | Self::InstanceStdCell | Self::InstanceFiller => {
                owner_type == OwnerType::InstanceBBox
            }
            Self::Halo => owner_type == OwnerType::InstanceHalo,
            Self::NetSignal | Self::NetClock | Self::NetOther => {
                owner_type == OwnerType::NetWireSegment
            }
            Self::PdnPower | Self::PdnGround => owner_type == OwnerType::SpecialWireSegment,
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
            Self::Fill => owner_type == OwnerType::Fill,
            Self::Regions => matches!(owner_type, OwnerType::Region | OwnerType::Slot),
        }
    }
}

impl ObjectVisibility {
    fn gpu_visibility_mask(&self) -> u32 {
        DrawingCategory::ALL.into_iter().fold(0, |mask, category| {
            mask | (u32::from(self.is_category_visible(category)) << (category as u8))
        })
    }

    fn includes_owner_type(self, owner_type: u8) -> bool {
        if OwnerType::from_raw(owner_type) == Some(OwnerType::NetWireSegment) {
            return self.net_signal || self.net_clock || self.net_other;
        }
        if OwnerType::from_raw(owner_type) == Some(OwnerType::InstanceBBox) {
            return self.instances.any_visible();
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
        if let Some(class) = category.instance_class() {
            return self.instances.is_visible(class);
        }
        match category {
            DrawingCategory::NetSignal => self.net_signal,
            DrawingCategory::NetClock => self.net_clock,
            DrawingCategory::NetOther => self.net_other,
            DrawingCategory::PdnPower => self.pdn_power,
            DrawingCategory::PdnGround => self.pdn_ground,
            DrawingCategory::Vias => self.vias,
            DrawingCategory::IoPins => self.io_pin,
            DrawingCategory::Placement => self.placement,
            DrawingCategory::Tracks => self.tracks,
            DrawingCategory::GCells => self.gcells,
            DrawingCategory::Obstructions => self.obstructions,
            DrawingCategory::Boundaries => self.boundaries,
            DrawingCategory::Fill => self.fill,
            DrawingCategory::Regions => self.regions,
            DrawingCategory::Halo => self.halo,
            _ => unreachable!("instance categories handled above"),
        }
    }

    fn set_category_visible(&mut self, category: DrawingCategory, visible: bool) {
        if let Some(class) = category.instance_class() {
            self.instances.set_visible(class, visible);
            return;
        }
        match category {
            DrawingCategory::NetSignal => self.net_signal = visible,
            DrawingCategory::NetClock => self.net_clock = visible,
            DrawingCategory::NetOther => self.net_other = visible,
            DrawingCategory::PdnPower => self.pdn_power = visible,
            DrawingCategory::PdnGround => self.pdn_ground = visible,
            DrawingCategory::Vias => self.vias = visible,
            DrawingCategory::IoPins => self.io_pin = visible,
            DrawingCategory::Placement => self.placement = visible,
            DrawingCategory::Tracks => self.tracks = visible,
            DrawingCategory::GCells => self.gcells = visible,
            DrawingCategory::Obstructions => self.obstructions = visible,
            DrawingCategory::Boundaries => self.boundaries = visible,
            DrawingCategory::Fill => self.fill = visible,
            DrawingCategory::Regions => self.regions = visible,
            DrawingCategory::Halo => self.halo = visible,
            _ => unreachable!("instance categories handled above"),
        }
    }

    fn set_all_visible(&mut self, visible: bool) {
        for category in DrawingCategory::ALL {
            self.set_category_visible(category, visible);
        }
    }
}

fn drawing_shape_category_counts(db: &ChipViewDb) -> BTreeMap<DrawingCategory, usize> {
    let mut counts = [0usize; DrawingCategory::ALL.len()];
    for shape in db.snapshot().shapes() {
        if let Some(category) = drawing_category_for_shape(db, shape) {
            counts[category as usize] += 1;
        }
    }
    counts
        .into_iter()
        .zip(DrawingCategory::ALL)
        .filter(|(count, _)| *count > 0)
        .map(|(count, category)| (category, count))
        .collect()
}

fn add_unrouted_net_guide_counts(
    counts: &mut BTreeMap<DrawingCategory, usize>,
    guides: &[UnroutedNetGuide],
) {
    for guide in guides {
        let category = net_kind_drawing_category(Some(&guide.net_kind));
        *counts.entry(category).or_insert(0) += guide.pin_centers.len();
    }
}

fn drawing_category_counts(
    db: &ChipViewDb,
    guides: &[UnroutedNetGuide],
) -> BTreeMap<DrawingCategory, usize> {
    let mut counts = drawing_shape_category_counts(db);
    add_unrouted_net_guide_counts(&mut counts, guides);
    counts
}

fn drawing_category_for_shape(db: &ChipViewDb, shape: &ShapeRecord) -> Option<DrawingCategory> {
    db.owner_for_shape(shape)
        .and_then(|owner| drawing_category_for_owner(db, owner))
}

/// Maps an owner to its drawing category; instance owners are classified into
/// the macro / standard-cell / filler classes (see `instance_visibility`).
fn drawing_category_for_owner(db: &ChipViewDb, owner: &OwnerRef) -> Option<DrawingCategory> {
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    Some(match owner_type {
        OwnerType::InstanceHalo => DrawingCategory::Halo,
        OwnerType::InstanceBBox => match crate::instance_visibility::classify_instance(db, owner) {
            crate::instance_visibility::InstanceClass::Macro => DrawingCategory::InstanceMacro,
            crate::instance_visibility::InstanceClass::StdCell => DrawingCategory::InstanceStdCell,
            crate::instance_visibility::InstanceClass::Filler => DrawingCategory::InstanceFiller,
        },
        OwnerType::NetWireSegment => net_kind_drawing_category(
            db.owner_name(owner)
                .and_then(|net_name| db.net_kind_for_name(net_name)),
        ),
        OwnerType::SpecialWireSegment => pdn_category_for_name(db.owner_name(owner)),
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
    match kind.map(str::trim) {
        Some(kind) if kind.eq_ignore_ascii_case("signal") => DrawingCategory::NetSignal,
        Some(kind) if kind.eq_ignore_ascii_case("clock") => DrawingCategory::NetClock,
        _ => DrawingCategory::NetOther,
    }
}

/// True when a special-net name denotes ground (VSS / GND / GROUND...); the
/// check is case-insensitive and matches substrings so stacked names like
/// `VSS_DIG` are recognized. Everything else (VDD, VCC, ...) is power.
fn is_ground_net(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    lower.contains("vss") || lower.contains("gnd") || lower.contains("ground")
}

/// Maps a special-net name to its power / ground drawing category. Names
/// without metadata default to power.
fn pdn_category_for_name(name: Option<&str>) -> DrawingCategory {
    match name {
        Some(name) if is_ground_net(name) => DrawingCategory::PdnGround,
        _ => DrawingCategory::PdnPower,
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

    fn query_shape_ids_bounded(
        self,
        db: &ChipViewDb,
        pattern: &Regex,
        is_current: &(impl Fn() -> bool + Sync),
    ) -> Option<chip_view_db::BoundedShapeSearch> {
        match self {
            SearchMode::All | SearchMode::Net | SearchMode::Instance => {
                db.query_owner_name_pattern_bounded(
                    pattern,
                    self.owner_types(),
                    search_worker::SEARCH_RESULT_LIMIT,
                    is_current,
                )
            }
            SearchMode::Pin => bounded_metadata_search(
                db.connectivity_metadata()
                    .iter()
                    .map(|endpoint| endpoint.pin_name.as_str()),
                pattern,
                is_current,
                |name| db.query_pin_name_bounded(name, search_worker::SEARCH_RESULT_LIMIT, is_current),
            ),
            SearchMode::Bus => bounded_metadata_search(
                db.bus_metadata().iter().map(|bus| bus.name.as_str()),
                pattern,
                is_current,
                |name| db.query_bus_name_bounded(name, search_worker::SEARCH_RESULT_LIMIT, is_current),
            ),
            SearchMode::Group => bounded_metadata_search(
                db.group_metadata().iter().map(|group| group.name.as_str()),
                pattern,
                is_current,
                |name| {
                    db.query_group_name_bounded(name, search_worker::SEARCH_RESULT_LIMIT, is_current)
                },
            ),
        }
    }
}

fn bounded_metadata_search<'a>(
    names: impl Iterator<Item = &'a str>,
    pattern: &Regex,
    is_current: &(impl Fn() -> bool + Sync),
    mut query: impl FnMut(&str) -> Option<chip_view_db::BoundedShapeSearch>,
) -> Option<chip_view_db::BoundedShapeSearch> {
    let mut shape_ids = BTreeSet::new();
    let mut searched_names = std::collections::HashSet::new();
    let mut truncated = false;
    for (index, name) in names.enumerate() {
        if index % 64 == 0 && !is_current() {
            return None;
        }
        if pattern.is_match(name) && searched_names.insert(name) {
            let result = query(name)?;
            truncated |= result.truncated;
            for shape_id in result.shape_ids {
                shape_ids.insert(shape_id);
                if shape_ids.len() > search_worker::SEARCH_RESULT_LIMIT {
                    truncated = true;
                    break;
                }
            }
            if shape_ids.len() > search_worker::SEARCH_RESULT_LIMIT {
                shape_ids.pop_last();
                break;
            }
            if result.truncated {
                break;
            }
        }
    }
    is_current().then_some(chip_view_db::BoundedShapeSearch {
        shape_ids: shape_ids.into_iter().collect(),
        truncated,
    })
}

#[cfg(test)]
mod bounded_metadata_search_tests {
    use super::*;

    #[test]
    fn metadata_search_merges_and_deduplicates_matching_names() {
        let names = ["pin_a", "pin_a", "pin_b", "other"];
        let pattern = Regex::new("^pin").expect("valid metadata regex");
        let mut queried = Vec::new();
        let result = bounded_metadata_search(names.into_iter(), &pattern, &|| true, |name| {
            queried.push(name.to_owned());
            Some(chip_view_db::BoundedShapeSearch {
                shape_ids: match name {
                    "pin_a" => vec![1, 2],
                    "pin_b" => vec![2, 3],
                    _ => Vec::new(),
                },
                truncated: false,
            })
        })
        .expect("current metadata search");

        assert_eq!(result.shape_ids, vec![1, 2, 3]);
        assert!(!result.truncated);
        assert_eq!(queried, ["pin_a", "pin_b"]);
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
