use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::{LineWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use chip_display::{FillPattern, LayerRole, LayerStack, LayerStyle};
use chip_render::{RenderCacheStats, RenderPlanCache, ViewTilePlaneCache};
use chip_view_db::{
    ChipViewDb, ChipViewMemoryStats, ConnectivityMetadata, DeltaStats, GridMetadata, LayerSummary,
    NearestShape, OwnerLocalInfo, ShapeGeometry, SnapshotStats, UnroutedNetGuide,
};
use chipgeom_format::{
    GeometryEditCommand, GeometryEditOp, GeometryEditResult, GeometryEditStatus, LayerId, OwnerRef,
    OwnerType, Point32, Rect32, ShapeId, ShapeKind, ShapeRecord, ShapeState,
};
use eframe::egui;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::macro_interaction::{
    apply_selection, MacroCanvasInteraction, MacroGroupDrag, MacroMarquee, SelectionMode,
};
use crate::macro_ops::{
    plan_macro_op_with_snap, planned_move_overlap, AlignAxis, AlignEdge, GridSnap, MacroOp,
    MacroOpBounds, MacroTransform, PlacementStatus, PlannedMacroMove, ShiftDirection,
};
use crate::macro_orient::MacroOrientation;
use crate::macro_staging::{
    clamp_rect_into, instance_names_intersecting, instance_names_intersecting_except,
    rect_fits_inside, MacroStagingState, MacroTarget,
};
use crate::map_data::{ColormapMode, HeatmapData, MapCatalog, MapItem};

#[path = "app/analysis/analysis_loader.rs"]
mod analysis_loader;
#[path = "app/analysis/analysis_overlays.rs"]
mod analysis_overlays;
mod display_data;
#[path = "app/analysis/clock_tree.rs"]
mod clock_tree;
#[cfg(test)]
#[path = "app/tests/coordinate_rulers.rs"]
mod coordinate_rulers_tests;
#[path = "app/cpu/cpu_raster.rs"]
mod cpu_raster;
#[path = "app/cpu/cpu_scene.rs"]
mod cpu_scene;
#[path = "app/render/gpu_overview.rs"]
mod gpu_overview;
#[path = "app/render/gpu_tile_worker.rs"]
mod gpu_tile_worker;
#[path = "app/render/heatmap_composition.rs"]
mod heatmap_composition;
#[path = "app/labels/label_layout.rs"]
mod label_layout;
#[path = "app/analysis/lvs.rs"]
mod lvs;
#[path = "app/render/render_support.rs"]
mod render_support;
#[path = "app/analysis/search_worker.rs"]
mod search_worker;
#[path = "app/session/session_close.rs"]
mod session_close;
#[path = "app/session/snapshot_reload.rs"]
mod snapshot_reload;
#[path = "app/analysis/timing.rs"]
mod timing;
#[path = "app/viewer/mod.rs"]
mod viewer;
#[path = "app/session/viewer_support.rs"]
mod viewer_support;
mod wheel_camera;
#[path = "app/render/world_heatmap.rs"]
mod world_heatmap;
#[cfg(test)]
use analysis_overlays::{parse_antenna_json_text, parse_drc_json_text, parse_drc_statis_csv};
use analysis_overlays::{
    AntennaOverlay, AntennaTypeState, AntennaViolation, DrcOverlay, DrcTypeState, DrcViolation,
};
use gpu_tile_worker::GpuTileWorker;
use label_layout::{
    ResolvedLabels, ShapeLabelCandidate, ShapeLabelCollector, ShapeLabelKey, ShapeLabelKind,
    ShapeLabelOverlay,
};
pub(crate) use render_support::*;
use snapshot_reload::{PendingReload, ReloadCompletion};
use viewer_support::*;

const SNAPSHOT_REFRESH_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const SESSION_ACTION_QUEUE_TIMEOUT: Duration = Duration::from_secs(15);
const FOCUS_VIEWPORT_FILL: f32 = 0.45;
const MIN_SHAPE_SCREEN_SIZE: f32 = 2.0;
const LAYOUT_GEOMETRY_LAYER: LayerId = 0;
const LAYOUT_GEOMETRY_RGB: [u8; 3] = [148, 148, 148];
const LAYOUT_GEOMETRY_MAX_FILL_ALPHA: u8 = 48;
const LAYOUT_GEOMETRY_MAX_FRAME_ALPHA: u8 = 128;
#[cfg(test)]
const PATTERN_MIN_SIZE_PX: f32 = chip_render::geometry2d::PATTERN_MIN_SIZE_PX;
#[cfg(test)]
const PATTERN_FRAME_FADE_SIZE_PX: f32 = chip_render::geometry2d::PATTERN_FRAME_FADE_SIZE_PX;
#[cfg(test)]
const MAX_PATTERN_OPS_PER_SHAPE: usize = 96;
const MAX_SELECTION_ENDPOINT_LINES: usize = 6;
const HOVER_NEAREST_RADIUS_PX: f32 = 8.0;
/// Screen-space slop allowed when clicking an editable instance bbox. At fit
/// zoom one pixel spans many DBU, so a zero-tolerance point-in-rect hit test
/// makes small or far-outside-die macros unselectable until zoomed in.
const EDIT_PICK_TOLERANCE_PX: f32 = 6.0;
const MAX_PARAMETERIZED_GRID_LINES_PER_GRID: usize = 4096;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SIDEBAR_SECTION_RESERVE_HEIGHT: f32 = 34.0;
const CLOCK_TREE_NODE_MARKER_RADIUS_PX: f32 = 7.0;
const CLOCK_TREE_SELECTED_MARKER_RADIUS_PX: f32 = 10.0;
const MAP_HEATMAP_WIDTH_FRACTION: f32 = 0.46;
const MAP_HEATMAP_MAX_WIDTH: f32 = 380.0;
const MAP_HEATMAP_MIN_WIDTH: f32 = 270.0;
const MAP_HEATMAP_MAX_GRID_SIZE: f32 = 300.0;
const MAP_HEATMAP_VERTICAL_OVERHEAD: f32 = 142.0;
const MAP_FOCUS_ANIMATION_DURATION_SECONDS: f64 = 0.22;
const COORDINATE_RULER_THICKNESS: f32 = 20.0;
const COORDINATE_RULER_TARGET_TICK_PX: f32 = 80.0;
const RULER_EDGE_SNAP_RADIUS_PX: f32 = 10.0;
const REDUCED_MOTION_ENV: &str = "ECOS_REDUCED_MOTION";
const RENDER_STATS_ENV: &str = "ECOS_RENDER_STATS";
const RENDER_STATS_LOG_ENV: &str = "ECOS_RENDER_STATS_LOG";
const PERF_ALL_VISIBLE_ENV: &str = "ECOS_PERF_ALL_VISIBLE";
const PERF_BENCHMARK_ENV: &str = "ECOS_PERF_BENCHMARK";
const PERF_BENCHMARK_MS_ENV: &str = "ECOS_PERF_BENCHMARK_MS";
const PERF_INITIAL_ZOOM_ENV: &str = "ECOS_PERF_INITIAL_ZOOM";

static RENDER_STATS_LOGGER: OnceLock<Option<Mutex<LineWriter<std::fs::File>>>> = OnceLock::new();
static LAST_RENDER_STATS_AT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

// Keep the state definitions in a focused file while retaining app-module privacy.
include!("app/state.rs");

impl ChipViewerApp {
    pub fn open(
        manifest: PathBuf,
        mode: String,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
        initial_session_dirty: bool,
        macro_staging_path: Option<PathBuf>,
        drc_data_path: Option<PathBuf>,
        drc_statis_path: Option<PathBuf>,
        antenna_data_path: Option<PathBuf>,
        antenna_statis_path: Option<PathBuf>,
        lvs_data_path: Option<PathBuf>,
        map_root_path: Option<PathBuf>,
        sta_feature_dir: Option<PathBuf>,
        target_format: wgpu::TextureFormat,
        render_mode: crate::RenderMode,
    ) -> Self {
        let edit_enabled = mode == "edit";
        let (sender, receiver) = mpsc::channel();
        let load_manifest = manifest.clone();
        thread::spawn(move || {
            let result = ChipViewDb::open(&load_manifest)
                .map(PreparedViewer::from)
                .map_err(|err| err.to_string());
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
                macro_staging_path,
                drc_data_path,
                drc_statis_path,
                antenna_data_path,
                antenna_statis_path,
                lvs_data_path,
                map_root_path,
                sta_feature_dir,
                target_format,
                render_mode,
            }),
            theme_initialized: false,
            startup_focus_requested: false,
            benchmark_started_at: Instant::now(),
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
                Ok(Ok(prepared)) => {
                    let mut loaded = LoadedViewer::new(
                        chip_display::ColorTheme::Vivid,
                        prepared,
                        loading.edit_enabled,
                        loading.initial_session_dirty,
                        loading.edit_command_dir.clone(),
                        loading.edit_result_dir.clone(),
                        loading.macro_staging_path.clone(),
                        analysis_loader::AnalysisPaths {
                            drc_data: loading.drc_data_path.take(),
                            drc_stats: loading.drc_statis_path.take(),
                            antenna_data: loading.antenna_data_path.take(),
                            antenna_stats: loading.antenna_statis_path.take(),
                            lvs_data: loading.lvs_data_path.take(),
                            map_root: loading.map_root_path.take(),
                            ..Default::default()
                        },
                        loading.target_format,
                        loading.render_mode,
                    );
                    loaded.attach_timing_feature_dir(loading.sta_feature_dir.clone());
                    Some(ViewerState::Loaded(loaded))
                }
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

fn json_string_vec_or_single(value: Option<&serde_json::Value>) -> Vec<String> {
    if let Some(text) = value.and_then(|value| value.as_str()) {
        return vec![text.to_string()];
    }
    json_string_vec(value)
}

#[cfg(test)]
#[path = "app/tests/general.rs"]
mod tests;

#[cfg(all(test, target_os = "linux"))]
#[path = "ir_drop_ui_validation.rs"]
mod ir_drop_ui_validation;
