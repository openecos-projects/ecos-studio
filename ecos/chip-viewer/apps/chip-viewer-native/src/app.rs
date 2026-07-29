use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use chip_display::{FillPattern, LayerRole, LayerStyle};
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

const SNAPSHOT_REFRESH_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const FOCUS_VIEWPORT_FILL: f32 = 0.45;
const MIN_SHAPE_SCREEN_SIZE: f32 = 2.0;
const LAYOUT_GEOMETRY_LAYER: LayerId = 0;
const PATTERN_MIN_SIZE_PX: f32 = 20.0;
const MAX_PATTERN_OPS_PER_SHAPE: usize = 96;
const MAX_SELECTION_ENDPOINT_LINES: usize = 6;
const HOVER_NEAREST_RADIUS_PX: f32 = 8.0;
const MAX_PARAMETERIZED_GRID_LINES_PER_GRID: usize = 4096;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SIDEBAR_SECTION_RESERVE_HEIGHT: f32 = 34.0;

pub struct ChipViewerApp {
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
}

struct LoadedViewer {
    db: ChipViewDb,
    stats: SnapshotStats,
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
    zoom: f32,
    pan: egui::Vec2,
    pan_drag: PanDragState,
    object_visibility: ObjectVisibility,
    coordinate_unit: CoordinateUnit,
    sidebar_info_panel: Option<SidebarInfoPanel>,
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
    load_error: Option<String>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CoordinateUnit {
    Dbu,
    Micron,
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
            fill: false,
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
            Self::Fill => owner_type == OwnerType::Fill,
            Self::Regions => matches!(owner_type, OwnerType::Region | OwnerType::Slot),
        }
    }
}

impl ObjectVisibility {
    fn includes_owner_type(self, owner_type: u8) -> bool {
        if OwnerType::from_raw(owner_type) == Some(OwnerType::NetWireSegment) {
            return self.net_signal || self.net_clock || self.net_other;
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
    counts
}

fn drawing_category_for_shape(db: &ChipViewDb, shape: &ShapeRecord) -> Option<DrawingCategory> {
    db.owner_for_shape(shape)
        .and_then(|owner| drawing_category_for_owner(db, owner))
}

fn drawing_category_for_owner(db: &ChipViewDb, owner: &OwnerRef) -> Option<DrawingCategory> {
    let owner_type = OwnerType::from_raw(owner.owner_type)?;
    Some(match owner_type {
        OwnerType::InstanceBBox | OwnerType::InstanceHalo => DrawingCategory::Instances,
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
    ) -> Self {
        let edit_enabled = mode == "edit";
        let (sender, receiver) = mpsc::channel();
        let load_manifest = manifest.clone();
        thread::spawn(move || {
            let result = ChipViewDb::open(&load_manifest).map_err(|err| err.to_string());
            let _ = sender.send(result);
        });
        Self {
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
                    db,
                    loading.edit_enabled,
                    loading.initial_session_dirty,
                    loading.edit_command_dir.clone(),
                    loading.edit_result_dir.clone(),
                    loading.drc_data_path.clone(),
                    loading.drc_statis_path.clone(),
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

        Some(Self {
            data_path,
            statis_path,
            type_states,
            violations,
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
        layer: layer.to_string(),
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
        db: ChipViewDb,
        edit_enabled: bool,
        initial_session_dirty: bool,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
        drc_data_path: Option<PathBuf>,
        drc_statis_path: Option<PathBuf>,
    ) -> Self {
        let stats = db.stats();
        let snapshot_signature = snapshot_signature_for_db(&db);
        let drawing_category_counts = drawing_category_counts(&db);
        let layers = layer_ui_states(&db, &BTreeMap::new());
        Self {
            db,
            stats,
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
            drc_overlay: DrcOverlay::load(drc_data_path, drc_statis_path),
            selected_drc: None,
            zoom: 1.0,
            pan: egui::Vec2::ZERO,
            pan_drag: PanDragState::default(),
            object_visibility: ObjectVisibility::default(),
            coordinate_unit: CoordinateUnit::Dbu,
            sidebar_info_panel: None,
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        self.sidebar_contents(ui);
    }

    fn has_drc_panel(&self) -> bool {
        self.drc_overlay.is_some()
    }

    fn drc_sidebar(&mut self, ui: &mut egui::Ui) {
        let visible_count = self.visible_drc_violation_count(None);
        let Some(overlay) = &mut self.drc_overlay else {
            return;
        };

        ui.add_space(8.0);
        ui.horizontal(|ui| {
            section_heading(ui, "DRC");
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
            if ui.button("⛶").on_hover_text("Fit layout to view").clicked() {
                self.zoom = 1.0;
                self.pan = egui::Vec2::ZERO;
                self.pan_drag.reset();
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
            ui.separator();
            let dbu_per_micron = self.db.snapshot().manifest().dbu_per_micron;
            for unit in [CoordinateUnit::Dbu, CoordinateUnit::Micron] {
                ui.add_enabled_ui(unit.is_available(dbu_per_micron), |ui| {
                    ui.selectable_value(&mut self.coordinate_unit, unit, unit.label());
                });
            }
        });
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
            .stroke(egui::Stroke::new(1.0, ecos_border()))
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

    fn canvas(&mut self, ui: &mut egui::Ui) {
        let available = ui.available_size();
        let (response, painter) = ui.allocate_painter(available, egui::Sense::click_and_drag());
        let canvas = response.rect;
        painter.rect_filled(canvas, 0.0, ecos_canvas());

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

        if response.hovered() {
            let raw_scroll_delta_y = ui.ctx().input(|input| input.raw_scroll_delta.y);
            let zoom_delta = ui.ctx().input(|input| input.zoom_delta());
            let zoom_factor = if raw_scroll_delta_y.abs() > 0.0 {
                scroll_zoom_factor(raw_scroll_delta_y)
            } else {
                zoom_delta
            };
            if (zoom_factor - 1.0).abs() > f32::EPSILON {
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

        self.focus_pending_shape(world, canvas);

        let all_layers: BTreeMap<LayerId, LayerStyle> = self
            .layers
            .iter()
            .map(|layer| (layer.layer_id, layer.style))
            .collect();
        let mut all_layers = all_layers;
        all_layers.entry(LAYOUT_GEOMETRY_LAYER).or_insert_with(|| {
            LayerStyle::default_for_metadata_with_type(
                LAYOUT_GEOMETRY_LAYER,
                "LAYOUT",
                "layout",
                self.layers.len(),
            )
        });
        let visible_layers: BTreeMap<LayerId, LayerStyle> = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .map(|layer| (layer.layer_id, layer.style))
            .collect();
        let query_layer_ids = render_query_layer_ids(&self.layers, self.object_visibility);
        let viewport = screen_to_world_rect(canvas, world, canvas, self.zoom, self.pan);
        let hover_world_point = ui
            .ctx()
            .input(|input| input.pointer.hover_pos())
            .filter(|pos| response.hovered() && canvas.contains(*pos))
            .map(|pos| screen_to_world_point(pos, world, canvas, self.zoom, self.pan));

        if response.drag_started() {
            self.pan_drag.reset();
            let mode = if response.drag_started_by(egui::PointerButton::Middle)
                || response.drag_started_by(egui::PointerButton::Secondary)
            {
                Some(CanvasDragMode::Pan)
            } else if response.drag_started_by(egui::PointerButton::Primary) {
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
            } else {
                None
            };
            if let Some(mode) = mode {
                self.pan_drag.start(mode);
            }
        }
        if response.dragged() {
            let frame_delta = response.drag_delta();
            match self.pan_drag.mode() {
                Some(CanvasDragMode::Edit) if self.draft.is_some() => {
                    let total_delta = self.pan_drag.accumulate(frame_delta);
                    self.update_edit_drag(total_delta, world, canvas);
                    ui.ctx().request_repaint();
                }
                _ => {
                    if self.pan_drag.mode().is_none() {
                        self.pan_drag.start(CanvasDragMode::Pan);
                    }
                    self.pan = self.pan_drag.apply_pan_frame(self.pan, frame_delta);
                    ui.ctx().request_repaint();
                }
            }
        }
        if response.drag_stopped() {
            if self.pan_drag.mode() == Some(CanvasDragMode::Edit) && self.draft.is_some() {
                self.commit_draft();
            }
            self.pan_drag.reset();
        }

        let drc_double_clicked = response.double_clicked_by(egui::PointerButton::Primary);
        if drc_double_clicked {
            self.selected_drc = response
                .interact_pointer_pos()
                .and_then(|pos| self.pick_drc_violation_at(pos, world, canvas, viewport));
        }
        if response.clicked_by(egui::PointerButton::Primary) && !drc_double_clicked {
            self.selected = response
                .interact_pointer_pos()
                .and_then(|pos| self.pick_shape_at(pos, world, canvas, &query_layer_ids));
        }
        if let Some(cursor_icon) = canvas_cursor_icon(
            response.hovered(),
            self.pan_drag.mode() == Some(CanvasDragMode::Pan)
                && (response.drag_started() || response.dragged()),
        ) {
            ui.ctx().set_cursor_icon(cursor_icon);
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
        let mut label_overlays = ShapeLabelCollector::default();

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
            for shape_id in
                self.render_cache
                    .visible_shape_ids_for_layers(&self.db, &query_layer_ids, viewport)
            {
                let Some(shape) = self.db.find_shape(shape_id) else {
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
                let owner = self.db.owner_for_shape(shape);
                let Some(style) =
                    visible_style_for_shape(shape, owner, &visible_layers, &all_layers)
                else {
                    continue;
                };
                let style = style_for_shape(*style, owner);
                let geometry = self.db.shape_geometry(shape);
                if paint_styled_shape_geometry(
                    &painter, geometry, world, canvas, self.zoom, self.pan, &style,
                ) {
                    drawn += 1;
                    if let Some(label) = shape_label_overlay(
                        geometry,
                        owner,
                        owner.and_then(|owner| self.db.owner_name(owner)),
                        world,
                        canvas,
                        self.zoom,
                        self.pan,
                    ) {
                        label_overlays.insert(label);
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

        for label in label_overlays.overlays() {
            paint_shape_label_overlay(&painter, label, canvas);
        }

        if let Some(overlay) = &self.drc_overlay {
            for violation in &overlay.violations {
                if self.drc_violation_is_visible(violation, Some(viewport)) {
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
                    egui::Stroke::new(2.0, ecos_accent()),
                );
            }
        }

        if let Some(draft) = &self.draft {
            let screen =
                world_to_screen_rect(draft.requested_bbox, world, canvas, self.zoom, self.pan);
            painter.rect_stroke(
                screen.expand(2.0),
                0.0,
                egui::Stroke::new(2.0, ecos_accent()),
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

        painter.text(
            canvas.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            canvas_status_line(
                drawn,
                overlay_shape_ids.len(),
                use_view_tiles,
                view_lod,
                self.zoom,
                viewport,
            ),
            egui::FontId::monospace(12.0),
            ecos_text_secondary(),
        );
        if let Some(point) = hover_world_point {
            painter.text(
                canvas.left_top() + egui::vec2(10.0, 28.0),
                egui::Align2::LEFT_TOP,
                hover_status_line(
                    point,
                    self.coordinate_unit,
                    self.db.snapshot().manifest().dbu_per_micron,
                    hover_nearest,
                ),
                egui::FontId::monospace(12.0),
                ecos_text_secondary(),
            );
        }
        self.canvas_info_overlay(ui, canvas);
        self.drc_detail_overlay(ui, canvas);
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
        let popup_pos = egui::pos2(
            (canvas.right() - popup_width - 12.0).max(canvas.left() + 12.0),
            (canvas.bottom() - popup_height - 12.0).max(canvas.top() + 12.0),
        );

        egui::Area::new(egui::Id::new("chip_viewer_canvas_info_popup"))
            .order(egui::Order::Foreground)
            .fixed_pos(popup_pos)
            .show(&ctx, |ui| {
                ui.set_width(popup_width);
                egui::Frame::NONE
                    .fill(ecos_panel())
                    .stroke(egui::Stroke::new(1.0, ecos_border()))
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

    fn should_use_view_tiles(&self, viewport: Rect32, world: Rect32) -> bool {
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

    fn focus_pending_shape(&mut self, world: Rect32, canvas: egui::Rect) {
        let Some(focus) = self.pending_focus.take() else {
            return;
        };

        let (zoom, pan) = focus_view_on_bbox(world, focus.bbox, canvas);
        self.zoom = zoom;
        self.pan = pan;
        self.pan_drag.reset();
        self.selected = focus.select_shape_id;
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
        self.stats = db.stats();
        self.drawing_category_counts = drawing_category_counts(&db);
        self.layers = layer_ui_states(&db, &visibility);
        self.db = db;
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
        let layer_visible = if owner_uses_layer_visibility(owner_type) {
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
        self.drc_overlay
            .as_ref()
            .map(|overlay| {
                overlay
                    .violations
                    .iter()
                    .filter(|violation| self.drc_violation_is_visible(violation, viewport))
                    .count()
            })
            .unwrap_or(0)
    }

    fn drc_violation_is_visible(&self, violation: &DrcViolation, viewport: Option<Rect32>) -> bool {
        self.drc_overlay.as_ref().is_some_and(|overlay| {
            overlay.type_is_visible(&violation.drc_type)
                && self.drc_layer_is_visible(&violation.layer)
                && viewport.is_none_or(|viewport| violation.bbox.intersects(viewport))
        })
    }

    fn drc_layer_is_visible(&self, layer_name: &str) -> bool {
        drc_layer_is_visible(&self.layers, layer_name)
    }

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
        self.drc_overlay.as_ref().and_then(|overlay| {
            overlay.violations.iter().rev().find_map(|violation| {
                if !self.drc_violation_is_visible(violation, Some(viewport)) {
                    return None;
                }
                let screen =
                    drc_violation_screen_rect(violation, world, canvas, self.zoom, self.pan);
                screen.expand(5.0).contains(pos).then_some(violation.id)
            })
        })
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
                    .stroke(egui::Stroke::new(1.0, drc_overlay_primary_color()))
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
            if loaded.has_drc_panel() {
                egui::SidePanel::left("chip_viewer_drc")
                    .resizable(true)
                    .min_width(240.0)
                    .max_width(380.0)
                    .default_width(292.0)
                    .show(ctx, |ui| loaded.drc_sidebar(ui));
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
    visuals.window_stroke = egui::Stroke::new(1.0, ecos_border());
    visuals.selection.bg_fill = egui::Color32::from_rgba_unmultiplied(0, 191, 165, 48);
    visuals.selection.stroke = egui::Stroke::new(1.0, ecos_accent());
    visuals.widgets.noninteractive.bg_fill = ecos_panel();
    visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, ecos_border());
    visuals.widgets.inactive.bg_fill = ecos_canvas();
    visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, ecos_border());
    visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(39, 57, 57);
    visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, ecos_accent());
    visuals.widgets.active.bg_fill = egui::Color32::from_rgb(35, 72, 66);
    visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0, ecos_accent());
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

fn info_panel_label(ui: &mut egui::Ui, text: impl Into<String>) {
    ui.label(egui::RichText::new(text).size(12.5).color(ecos_info_text()));
}

fn drc_type_card(ui: &mut egui::Ui, state: &mut DrcTypeState) {
    egui::Frame::NONE
        .fill(egui::Color32::from_rgb(30, 30, 34))
        .stroke(egui::Stroke::new(1.0, ecos_border()))
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
    match owner.and_then(|owner| OwnerType::from_raw(owner.owner_type)) {
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
    }
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

fn layer_ui_states(db: &ChipViewDb, visibility: &BTreeMap<LayerId, bool>) -> Vec<LayerUiState> {
    db.layer_catalog()
        .into_iter()
        .enumerate()
        .map(|(index, summary)| {
            let style = LayerStyle::default_for_metadata_with_type(
                summary.layer_id,
                &summary.name,
                &summary.layer_type,
                index,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum ShapeLabelKind {
    IoPin,
    Pin,
    Net,
    Pdn,
    Instance,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
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
    overlays: BTreeMap<ShapeLabelKey, ShapeLabelOverlay>,
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
) -> bool {
    let primitive = shape_screen_primitive(geometry, world, canvas, zoom, pan);
    if !screen_primitive_bounds(primitive).intersects(canvas) {
        return false;
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
        }
        ScreenShapePrimitive::Point { center, radius } => {
            painter.circle_filled(center, radius, color32(style.frame_rgba));
        }
    }
    true
}

fn paint_styled_rect(
    painter: &egui::Painter,
    rect: egui::Rect,
    canvas: egui::Rect,
    style: LayerStyle,
) {
    let visible_rect = rect.intersect(canvas);
    if !visible_rect.is_positive() {
        return;
    }
    let can_pattern =
        visible_rect.width() >= PATTERN_MIN_SIZE_PX && visible_rect.height() >= PATTERN_MIN_SIZE_PX;
    let fill_color = color32(style.rgba);
    match style.fill_pattern {
        FillPattern::Hollow => {}
        FillPattern::Solid => {
            painter.rect_filled(visible_rect, 0.0, fill_color);
        }
        FillPattern::SparseDots if can_pattern => {
            draw_pattern_dots(painter, visible_rect, fill_color, 9.0);
        }
        FillPattern::DenseDots if can_pattern => {
            draw_pattern_dots(painter, visible_rect, fill_color, 5.0);
        }
        FillPattern::DiagonalHatch if can_pattern => {
            draw_hatch(painter, visible_rect, fill_color, false);
        }
        FillPattern::CrossHatch if can_pattern => {
            draw_hatch(painter, visible_rect, fill_color, true);
        }
        FillPattern::HorizontalHatch if can_pattern => {
            draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Horizontal);
        }
        FillPattern::VerticalHatch if can_pattern => {
            draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Vertical);
        }
        FillPattern::Grid if can_pattern => {
            draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Horizontal);
            draw_axis_hatch(painter, visible_rect, fill_color, HatchAxis::Vertical);
        }
        FillPattern::XMark => {
            painter.rect_filled(visible_rect, 0.0, fill_color);
            if visible_rect.width() >= 6.0 && visible_rect.height() >= 6.0 {
                draw_x_mark(
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
    }
}

fn draw_pattern_dots(
    painter: &egui::Painter,
    rect: egui::Rect,
    color: egui::Color32,
    spacing: f32,
) {
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
}

fn draw_hatch(painter: &egui::Painter, rect: egui::Rect, color: egui::Color32, cross: bool) {
    let mut count = draw_hatch_direction(painter, rect, color, false);
    if cross && count < MAX_PATTERN_OPS_PER_SHAPE {
        count += draw_hatch_direction(painter, rect, color, true);
    }
    let _ = count;
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
                        egui::Stroke::new(1.0, color),
                    );
                    count += 1;
                }
            }
            HatchAxis::Vertical => {
                let x = rect.left() + offset;
                if x <= rect.right() {
                    painter.line_segment(
                        [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                        egui::Stroke::new(1.0, color),
                    );
                    count += 1;
                }
            }
        }
        offset += 10.0;
    }
    count
}

fn draw_x_mark(painter: &egui::Painter, rect: egui::Rect, color: egui::Color32, width: f32) {
    let inset = 1.5_f32.min(rect.width() * 0.2).min(rect.height() * 0.2);
    let rect = rect.shrink(inset);
    if !rect.is_positive() {
        return;
    }
    let stroke = egui::Stroke::new(width, color);
    painter.line_segment([rect.left_top(), rect.right_bottom()], stroke);
    painter.line_segment([rect.left_bottom(), rect.right_top()], stroke);
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

    let ShapeGeometry::Rect(rect) = geometry else {
        return None;
    };
    let screen_rect = shape_screen_rect(rect, world, canvas, zoom, pan);
    let visible_rect = screen_rect.intersect(canvas);
    if !screen_rect.is_positive() || !visible_rect.is_positive() {
        return None;
    }
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
                egui::Stroke::new(1.0, color),
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
    egui::Stroke::new(4.0, egui::Color32::from_rgb(255, 64, 192))
}

fn search_highlight_inner_stroke() -> egui::Stroke {
    egui::Stroke::new(1.5, egui::Color32::from_rgb(255, 248, 210))
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

fn drc_overlay_secondary_color() -> egui::Color32 {
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
        if selected { 4.0 } else { 3.0 },
        if selected {
            drc_overlay_secondary_color()
        } else {
            drc_overlay_primary_color()
        },
    );
    let inner_stroke = egui::Stroke::new(1.5, drc_overlay_primary_color());
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

fn paint_parameterized_grid_overlay(
    painter: &egui::Painter,
    grids: &[GridMetadata],
    layers: &[LayerUiState],
    visibility: ObjectVisibility,
    viewport: Rect32,
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
        for index in grid_visible_indices(grid, viewport) {
            let coordinate = saturating_i64_to_i32(grid_coordinate_at_index(grid, index));
            let (begin, end) = match grid.direction.trim().to_ascii_lowercase().as_str() {
                "x" => (
                    Point32 {
                        x: coordinate,
                        y: viewport.ly,
                    },
                    Point32 {
                        x: coordinate,
                        y: viewport.hy,
                    },
                ),
                "y" => (
                    Point32 {
                        x: viewport.lx,
                        y: coordinate,
                    },
                    Point32 {
                        x: viewport.hx,
                        y: coordinate,
                    },
                ),
                _ => continue,
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
    egui::Stroke::new(1.25, color)
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
            OwnerType::TrackGrid => (1.0, 82),
            OwnerType::GCellGrid => (2.0, 104),
            _ => (1.0, style.frame_alpha),
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
        OwnerType::TrackGrid => {
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(64, 196, 184, 82))
        }
        OwnerType::GCellGrid => egui::Stroke::new(
            2.0,
            egui::Color32::from_rgba_unmultiplied(228, 176, 72, 104),
        ),
        _ => egui::Stroke::new(1.0, ecos_text_secondary()),
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
    let stroke = egui::Stroke::new(1.0, color);
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

fn format_distance(distance_dbu: i32, unit: CoordinateUnit, dbu_per_micron: Option<u32>) -> String {
    match effective_coordinate_unit(unit, dbu_per_micron) {
        CoordinateUnit::Dbu => format!("{distance_dbu} DBU"),
        CoordinateUnit::Micron => format!("{} um", format_micron(distance_dbu, dbu_per_micron)),
    }
}

fn format_micron(value_dbu: i32, dbu_per_micron: Option<u32>) -> String {
    let dbu_per_micron = dbu_per_micron.filter(|value| *value > 0).unwrap_or(1);
    format!("{:.3}", value_dbu as f64 / dbu_per_micron as f64)
}

fn nice_ruler_distance_dbu(target_dbu: f32) -> i32 {
    if !target_dbu.is_finite() || target_dbu <= 1.0 {
        return 1;
    }

    let magnitude = 10_f32.powf(target_dbu.log10().floor());
    let normalized = target_dbu / magnitude;
    let nice = if normalized <= 1.0 {
        1.0
    } else if normalized <= 2.0 {
        2.0
    } else if normalized <= 5.0 {
        5.0
    } else {
        10.0
    };

    (nice * magnitude).round().clamp(1.0, i32::MAX as f32) as i32
}

fn scroll_zoom_factor(scroll: f32) -> f32 {
    if scroll > 0.0 {
        1.15
    } else {
        1.0 / 1.15
    }
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
    let new_zoom = (zoom * zoom_factor).clamp(0.05, 200.0);
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
    let draw_source = if use_view_tiles {
        format!("view tiles, lod: {view_lod}")
    } else {
        "exact".to_string()
    };
    let mut line = format!(
        "drawn: {drawn} {draw_source}, zoom: {zoom:.2}x, viewport: {} {} {} {}",
        viewport.lx, viewport.ly, viewport.hx, viewport.hy
    );
    if overlay_count > 0 {
        line.push_str(&format!(", overlays: {overlay_count}"));
    }
    line
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

fn object_visibility_needs_layout_layer(visibility: ObjectVisibility) -> bool {
    visibility.instances || visibility.boundaries || visibility.placement || visibility.regions
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
    let zoom = (target_scale / base_scale).clamp(1.0, 200.0);
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

fn drc_layer_is_visible(layers: &[LayerUiState], layer_name: &str) -> bool {
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
        ids.extend(
            layers
                .iter()
                .filter(|layer| layer.layer_id == 0)
                .map(|layer| layer.layer_id),
        );
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
    if owner_uses_layer_visibility(owner_type) {
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
        assert_eq!(violations[0].layer, "MET1");
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
        assert!(scroll_zoom_factor(1.0) > 1.0);
        assert!(scroll_zoom_factor(-1.0) < 1.0);
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
            ]
        );
        assert!(!visibility.is_all_visible());
    }

    #[test]
    fn object_visibility_hides_only_the_requested_owner_categories() {
        let visibility = ObjectVisibility {
            instances: false,
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
        let base = LayerStyle::default_for_metadata(7, "MET1", 0);
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
            (7, LayerStyle::default_for_layer(7)),
            (3, LayerStyle::default_for_layer(3)),
        ]);

        assert_eq!(visible_layer_ids(&visible_layers), vec![3, 7]);
    }

    #[test]
    fn visible_style_for_shape_skips_shapes_from_invisible_layers() {
        let visible_layers = BTreeMap::from([(3, LayerStyle::default_for_layer(3))]);
        let all_layers = BTreeMap::from([
            (3, LayerStyle::default_for_layer(3)),
            (4, LayerStyle::default_for_layer(4)),
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
        assert_eq!(render_query_layer_ids(&layers, visibility), vec![7]);

        layers[0].visible = true;
        assert_eq!(render_query_layer_ids(&layers, visibility), vec![0, 7]);
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
        let mut loaded = LoadedViewer::new(db, false, false, None, None, None, None);
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
        let loaded = LoadedViewer::new(db, true, true, None, None, None, None);

        assert!(loaded.session_dirty);

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
            style: LayerStyle::default_for_layer(layer_id),
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
