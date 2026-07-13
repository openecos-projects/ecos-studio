use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{Duration, Instant, SystemTime};

use chip_display::LayerStyle;
use chip_render::{RenderCacheStats, RenderPlanCache, ViewTilePlaneCache};
use chip_view_db::{ChipViewDb, ChipViewMemoryStats, DeltaStats, ShapeGeometry, SnapshotStats};
use chipgeom_format::{
    GeometryEditCommand, GeometryEditOp, GeometryEditResult, GeometryEditStatus, LayerId, OwnerRef,
    OwnerType, Point32, Rect32, ShapeId, ShapeKind, ShapeRecord, ShapeState,
};
use eframe::egui;

const SNAPSHOT_REFRESH_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const FOCUS_VIEWPORT_FILL: f32 = 0.45;
const MIN_SHAPE_SCREEN_SIZE: f32 = 2.0;

pub struct ChipViewerApp {
    manifest: PathBuf,
    mode: String,
    state: ViewerState,
}

struct LoadedViewer {
    db: ChipViewDb,
    stats: SnapshotStats,
    layers: Vec<LayerUiState>,
    edit_enabled: bool,
    edit_command_dir: Option<PathBuf>,
    edit_result_dir: Option<PathBuf>,
    search_text: String,
    search_mode: SearchMode,
    shape_id_text: String,
    last_query_status: Option<String>,
    highlighted: BTreeSet<ShapeId>,
    selected: Option<ShapeId>,
    pending_focus: Option<PendingFocus>,
    edit_tool: EditTool,
    draft: Option<EditDraft>,
    pending_edit: Option<PendingEdit>,
    last_edit_result: Option<String>,
    snapshot_signature: SnapshotFileSignature,
    next_snapshot_refresh_check: Instant,
    render_cache: RenderPlanCache,
    view_tile_cache: ViewTilePlaneCache,
    next_command_counter: u32,
    zoom: f32,
    pan: egui::Vec2,
    pan_drag: PanDragState,
}

struct LayerUiState {
    layer_id: LayerId,
    shape_count: usize,
    order: u32,
    name: String,
    layer_type: String,
    direction: String,
    width: i32,
    pitch_x: i32,
    pitch_y: i32,
    visible: bool,
    style: LayerStyle,
}

struct EditDraft {
    command_id: u64,
    shape_id: ShapeId,
    expected_version: u32,
    op: GeometryEditOp,
    resize_corner: ResizeCorner,
    original_bbox: Rect32,
    requested_bbox: Rect32,
}

struct PendingEdit {
    shape_id: ShapeId,
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
enum EditTool {
    Move,
    Resize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResizeCorner {
    LowerLeft,
    LowerRight,
    UpperLeft,
    UpperRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SearchMode {
    All,
    Net,
    Instance,
}

impl SearchMode {
    fn label(self) -> &'static str {
        match self {
            SearchMode::All => "All",
            SearchMode::Net => "Net",
            SearchMode::Instance => "Instance",
        }
    }

    fn owner_types(self) -> Option<&'static [OwnerType]> {
        match self {
            SearchMode::All => None,
            SearchMode::Net => Some(&[OwnerType::NetWireSegment, OwnerType::SpecialWireSegment]),
            SearchMode::Instance => Some(&[OwnerType::InstanceBBox, OwnerType::InstanceHalo]),
        }
    }
}

impl EditTool {
    fn op(self) -> GeometryEditOp {
        match self {
            EditTool::Move => GeometryEditOp::MoveShape,
            EditTool::Resize => GeometryEditOp::ResizeRect,
        }
    }
}

enum ViewerState {
    Loaded(LoadedViewer),
    Error(String),
}

impl ChipViewerApp {
    pub fn open(
        manifest: PathBuf,
        mode: String,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
    ) -> Self {
        let edit_enabled = mode == "edit";
        let state = match ChipViewDb::open(&manifest) {
            Ok(db) => ViewerState::Loaded(LoadedViewer::new(
                db,
                edit_enabled,
                edit_command_dir,
                edit_result_dir,
            )),
            Err(err) => ViewerState::Error(err.to_string()),
        };
        Self {
            manifest,
            mode,
            state,
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        ui.heading("Chip Viewer");
        ui.label(format!("mode: {}", self.mode));
        ui.label(self.manifest.display().to_string());
        ui.separator();

        match &mut self.state {
            ViewerState::Loaded(loaded) => loaded.sidebar(ui),
            ViewerState::Error(err) => {
                ui.colored_label(egui::Color32::RED, err);
            }
        }
    }

    fn canvas(&mut self, ui: &mut egui::Ui) {
        match &mut self.state {
            ViewerState::Loaded(loaded) => loaded.canvas(ui),
            ViewerState::Error(_) => {
                ui.centered_and_justified(|ui| {
                    ui.label("No geometry loaded");
                });
            }
        }
    }
}

impl LoadedViewer {
    fn new(
        db: ChipViewDb,
        edit_enabled: bool,
        edit_command_dir: Option<PathBuf>,
        edit_result_dir: Option<PathBuf>,
    ) -> Self {
        let stats = db.stats();
        let snapshot_signature = snapshot_signature_for_db(&db);
        let layers = db
            .layer_summaries()
            .into_iter()
            .map(|summary| LayerUiState {
                layer_id: summary.layer_id,
                shape_count: summary.shape_count,
                order: summary.order,
                name: summary.name,
                layer_type: summary.layer_type,
                direction: summary.direction,
                width: summary.width,
                pitch_x: summary.pitch_x,
                pitch_y: summary.pitch_y,
                visible: true,
                style: LayerStyle::default_for_layer(summary.layer_id),
            })
            .collect();
        Self {
            db,
            stats,
            layers,
            edit_enabled,
            edit_command_dir,
            edit_result_dir,
            search_text: String::new(),
            search_mode: SearchMode::All,
            shape_id_text: String::new(),
            last_query_status: None,
            highlighted: BTreeSet::new(),
            selected: None,
            pending_focus: None,
            edit_tool: EditTool::Move,
            draft: None,
            pending_edit: None,
            last_edit_result: None,
            snapshot_signature,
            next_snapshot_refresh_check: Instant::now() + SNAPSHOT_REFRESH_CHECK_INTERVAL,
            render_cache: RenderPlanCache::default(),
            view_tile_cache: ViewTilePlaneCache::default(),
            next_command_counter: 1,
            zoom: 1.0,
            pan: egui::Vec2::ZERO,
            pan_drag: PanDragState::default(),
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        ui.label(format!("shapes: {}", self.stats.shape_count));
        ui.label(format!("owners: {}", self.stats.owner_count));
        ui.label(format!("names: {}", self.stats.name_count));
        if let Some(bbox) = self.stats.bbox {
            ui.label(format!(
                "bbox: {} {} {} {}",
                bbox.lx, bbox.ly, bbox.hx, bbox.hy
            ));
        }
        egui::CollapsingHeader::new("Diagnostics").show(ui, |ui| {
            for line in design_metadata_lines(self.db.snapshot().manifest()) {
                ui.label(line);
            }
            for line in diagnostics_lines(
                &self.db.memory_stats(),
                &self.db.delta_stats(),
                self.db.view_tile_count(),
                self.render_cache.stats(),
                self.view_tile_cache.stats(),
            ) {
                ui.label(line);
            }
        });

        ui.separator();
        ui.horizontal(|ui| {
            ui.label("Search");
            let response = ui.text_edit_singleline(&mut self.search_text);
            if response.changed() {
                self.refresh_highlight();
            }
        });
        ui.horizontal(|ui| {
            for mode in [SearchMode::All, SearchMode::Net, SearchMode::Instance] {
                if ui
                    .selectable_value(&mut self.search_mode, mode, mode.label())
                    .changed()
                {
                    self.refresh_highlight();
                }
            }
        });
        if !self.search_text.trim().is_empty() {
            ui.horizontal(|ui| {
                ui.label(format!("matches: {}", self.highlighted.len()));
                if !self.highlighted.is_empty() && ui.button("Locate").clicked() {
                    self.pending_focus =
                        focus_target_for_shape_ids(&self.highlighted, |shape_id| {
                            self.db
                                .find_shape(shape_id)
                                .filter(|shape| is_renderable_shape(shape))
                                .map(|shape| shape.bbox)
                        });
                }
                if ui.button("Clear").clicked() {
                    clear_search_state(&mut self.search_text, &mut self.highlighted);
                }
            });
        }

        ui.separator();
        ui.horizontal(|ui| {
            ui.label("ShapeId");
            let response = ui.text_edit_singleline(&mut self.shape_id_text);
            let submit =
                response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
            if ui.button("Select").clicked() || submit {
                self.select_shape_id_from_input();
            }
        });
        if let Some(status) = &self.last_query_status {
            ui.label(status);
        }

        if let Some(shape_id) = self.selected {
            ui.separator();
            ui.label("Selection");
            if let Some(shape) = self.db.find_shape(shape_id) {
                let owner = self.db.owner_for_shape(shape);
                let owner_name = owner.and_then(|owner| self.db.owner_name(owner));
                for line in selection_detail_lines(shape, owner, owner_name) {
                    ui.label(line);
                }
            }
        }

        if self.edit_enabled {
            ui.separator();
            ui.label("Edit");
            ui.horizontal(|ui| {
                ui.selectable_value(&mut self.edit_tool, EditTool::Move, "Move");
                ui.selectable_value(&mut self.edit_tool, EditTool::Resize, "Resize");
            });
            if self.edit_command_dir.is_none() || self.edit_result_dir.is_none() {
                ui.colored_label(egui::Color32::YELLOW, "edit channel is not configured");
            }
            if let Some(pending) = &self.pending_edit {
                ui.label(format!("pending shape: {}", pending.shape_id));
            }
            if let Some(result) = &self.last_edit_result {
                ui.label(result);
            }
        }

        ui.separator();
        ui.horizontal(|ui| {
            if ui.button("Fit").clicked() {
                self.zoom = 1.0;
                self.pan = egui::Vec2::ZERO;
                self.pan_drag.reset();
            }
            let can_reload = self.pending_edit.is_none() && self.draft.is_none();
            if ui
                .add_enabled(can_reload, egui::Button::new("Reload"))
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
        });
        ui.separator();
        ui.label("Layers");
        ui.horizontal(|ui| {
            if ui.small_button("All").clicked() {
                set_layer_visibility(&mut self.layers, true);
            }
            if ui.small_button("None").clicked() {
                set_layer_visibility(&mut self.layers, false);
            }
            if ui.small_button("Invert").clicked() {
                invert_layer_visibility(&mut self.layers);
            }
        });
        ui.label(format!(
            "visible: {}/{}",
            visible_layer_count(&self.layers),
            self.layers.len()
        ));
        egui::ScrollArea::vertical().show(ui, |ui| {
            for layer in &mut self.layers {
                ui.horizontal(|ui| {
                    ui.checkbox(&mut layer.visible, "");
                    let color = color32(layer.style.rgba);
                    ui.colored_label(color, &layer.name)
                        .on_hover_text(layer_hover_text(layer));
                    ui.label(layer.shape_count.to_string());
                });
            }
        });
    }

    fn canvas(&mut self, ui: &mut egui::Ui) {
        let available = ui.available_size();
        let (response, painter) = ui.allocate_painter(available, egui::Sense::drag());
        let canvas = response.rect;
        painter.rect_filled(canvas, 0.0, egui::Color32::from_rgb(12, 14, 18));

        let Some(world) = self.stats.bbox else {
            painter.text(
                canvas.center(),
                egui::Align2::CENTER_CENTER,
                "empty geometry",
                egui::FontId::proportional(14.0),
                egui::Color32::LIGHT_GRAY,
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

        let visible_layers: BTreeMap<LayerId, LayerStyle> = self
            .layers
            .iter()
            .filter(|layer| layer.visible)
            .map(|layer| (layer.layer_id, layer.style))
            .collect();
        let viewport = screen_to_world_rect(canvas, world, canvas, self.zoom, self.pan);

        if response.drag_started() {
            self.pan_drag.reset();
            if self.edit_enabled {
                if let Some(pos) = response.interact_pointer_pos() {
                    self.begin_edit_drag(pos, world, canvas, &visible_layers);
                }
            }
        }
        if response.dragged() {
            if self.draft.is_some() {
                self.update_edit_drag(response.drag_delta(), world, canvas);
                ui.ctx().request_repaint();
            } else {
                self.pan = self.pan_drag.apply(self.pan, response.drag_delta());
                ui.ctx().request_repaint();
            }
        }
        if response.drag_stopped() {
            if self.draft.is_some() {
                self.commit_draft();
            }
            self.pan_drag.reset();
        }

        if response.clicked() {
            self.selected = response
                .interact_pointer_pos()
                .and_then(|pos| self.pick_shape_at(pos, world, canvas, &visible_layers));
        }
        let mut drawn = 0usize;
        let use_view_tiles = self.should_use_view_tiles(viewport, world);
        let view_lod = self.view_lod_level();

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
                    let mut color = color32(style.rgba);
                    color = egui::Color32::from_rgba_premultiplied(
                        color.r(),
                        color.g(),
                        color.b(),
                        (color.a() / 2).max(28),
                    );
                    painter.rect_filled(screen, 0.0, color);
                    drawn += 1;
                }
            }
        } else {
            let layer_ids = visible_layer_ids(&visible_layers);
            for shape_id in self
                .render_cache
                .visible_shape_ids_for_layers(&self.db, &layer_ids, viewport)
            {
                let Some(shape) = self.db.find_shape(shape_id) else {
                    continue;
                };
                if !is_renderable_shape(shape) {
                    continue;
                }
                let Some(style) = visible_style_for_shape(shape, &visible_layers) else {
                    continue;
                };
                let color = color32(style.rgba);
                if paint_shape_geometry(
                    &painter,
                    self.db.shape_geometry(shape),
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                    color,
                ) {
                    drawn += 1;
                }
            }
        }

        for shape_id in overlay_shape_ids(self.selected, &self.highlighted) {
            let Some(shape) = self.db.find_shape(shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) {
                continue;
            }
            let geometry = self.db.shape_geometry(shape);
            if self.highlighted.contains(&shape_id) {
                paint_shape_overlay(
                    &painter,
                    geometry,
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                    egui::Stroke::new(2.0, egui::Color32::YELLOW),
                );
            }
            if self.selected == Some(shape_id) {
                paint_shape_overlay(
                    &painter,
                    geometry,
                    world,
                    canvas,
                    self.zoom,
                    self.pan,
                    egui::Stroke::new(2.0, egui::Color32::from_rgb(80, 220, 255)),
                );
            }
        }

        if let Some(draft) = &self.draft {
            let screen =
                world_to_screen_rect(draft.requested_bbox, world, canvas, self.zoom, self.pan);
            painter.rect_stroke(
                screen.expand(2.0),
                0.0,
                egui::Stroke::new(2.0, egui::Color32::from_rgb(160, 240, 255)),
                egui::StrokeKind::Inside,
            );
        }

        painter.text(
            canvas.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            canvas_status_line(drawn, use_view_tiles, view_lod, self.zoom, viewport),
            egui::FontId::monospace(12.0),
            egui::Color32::from_gray(190),
        );
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
        )
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

    fn begin_edit_drag(
        &mut self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        visible_layers: &BTreeMap<LayerId, LayerStyle>,
    ) {
        let Some(shape_id) = self.selected else {
            return;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            return;
        };
        if shape.state != ShapeState::Alive as u8
            || shape.kind != ShapeKind::Rect as u8
            || !visible_layers.contains_key(&shape.layer_id)
        {
            return;
        }
        let Some(owner) = self.db.owner_for_shape(shape) else {
            return;
        };
        if !edit_tool_is_allowed(owner.owner_type, self.edit_tool) {
            self.last_edit_result = Some(format!(
                "{:?} is not supported for {}",
                self.edit_tool,
                ChipViewDb::owner_type_label(owner.owner_type)
            ));
            return;
        }
        let screen = world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
        if !screen.contains(pos) {
            return;
        }

        let expected_version = shape.version;
        let original_bbox = shape.bbox;
        let resize_corner = resize_corner_from_screen_pos(pos, screen);
        self.draft = Some(EditDraft {
            command_id: self.allocate_command_id(),
            shape_id,
            expected_version,
            op: self.edit_tool.op(),
            resize_corner,
            original_bbox,
            requested_bbox: original_bbox,
        });
    }

    fn update_edit_drag(&mut self, screen_delta: egui::Vec2, world: Rect32, canvas: egui::Rect) {
        let Some(draft) = self.draft.as_mut() else {
            return;
        };
        let (dx, dy) = screen_to_world_delta(screen_delta, world, canvas, self.zoom);
        draft.requested_bbox = match draft.op {
            GeometryEditOp::MoveShape => translate_rect(draft.original_bbox, dx, dy),
            GeometryEditOp::ResizeRect => {
                resize_rect_from_delta(draft.original_bbox, dx, dy, draft.resize_corner)
            }
            GeometryEditOp::ReplaceLine => draft.original_bbox,
        };
    }

    fn commit_draft(&mut self) {
        let Some(draft) = self.draft.take() else {
            return;
        };
        let Some(command_dir) = &self.edit_command_dir else {
            self.last_edit_result = Some("edit command directory is missing".to_string());
            return;
        };
        let Some(result_dir) = &self.edit_result_dir else {
            self.last_edit_result = Some("edit result directory is missing".to_string());
            return;
        };

        let command = GeometryEditCommand {
            command_id: draft.command_id,
            shape_id: draft.shape_id,
            expected_version: draft.expected_version,
            op: draft.op,
            requested_bbox: draft.requested_bbox,
        };
        let command_path = command_dir.join(format!("command-{}.json", command.command_id));
        let result_path = result_dir.join(format!("result-{}.json", command.command_id));

        match write_edit_command(&command_path, &command) {
            Ok(()) => {
                self.pending_edit = Some(PendingEdit {
                    shape_id: command.shape_id,
                    result_path,
                });
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
            match self.reload_snapshot() {
                Ok(()) => {}
                Err(err) => {
                    self.last_edit_result = Some(format!("failed to reload geometry: {err}"));
                    self.pending_edit = None;
                    return;
                }
            }
        }

        self.last_edit_result = Some(action.message);
        self.pending_edit = None;
    }

    fn poll_external_snapshot_refresh(&mut self) {
        if self.pending_edit.is_some() || self.draft.is_some() {
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
        let db = ChipViewDb::open(&manifest_path).map_err(|err| err.to_string())?;
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
        self.layers = db
            .layer_summaries()
            .into_iter()
            .map(|summary| LayerUiState {
                layer_id: summary.layer_id,
                shape_count: summary.shape_count,
                order: summary.order,
                name: summary.name,
                layer_type: summary.layer_type,
                direction: summary.direction,
                width: summary.width,
                pitch_x: summary.pitch_x,
                pitch_y: summary.pitch_y,
                visible: visibility.get(&summary.layer_id).copied().unwrap_or(true),
                style: LayerStyle::default_for_layer(summary.layer_id),
            })
            .collect();
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
        let counter = self.next_command_counter;
        self.next_command_counter = self.next_command_counter.saturating_add(1);
        ((process::id() as u64) << 32) | counter as u64
    }

    fn refresh_highlight(&mut self) {
        let name = self.search_text.trim();
        self.highlighted = if name.is_empty() {
            BTreeSet::new()
        } else if let Some(owner_types) = self.search_mode.owner_types() {
            self.db
                .query_owner_name_for_owner_types(name, owner_types)
                .into_iter()
                .collect()
        } else {
            self.db.query_owner_name(name).into_iter().collect()
        };
    }

    fn select_shape_id_from_input(&mut self) {
        let action = shape_id_lookup_action(&self.shape_id_text, |shape_id| {
            self.db
                .find_shape(shape_id)
                .filter(|shape| is_renderable_shape(shape))
                .map(|shape| shape.bbox)
        });
        self.pending_focus = action.pending_focus;
        self.last_query_status = Some(action.message);
    }

    fn pick_shape_at(
        &self,
        pos: egui::Pos2,
        world: Rect32,
        canvas: egui::Rect,
        visible_layers: &BTreeMap<LayerId, LayerStyle>,
    ) -> Option<ShapeId> {
        let hit = screen_to_world_rect(
            egui::Rect::from_min_max(pos, pos),
            world,
            canvas,
            self.zoom,
            self.pan,
        );
        let layer_ids: Vec<LayerId> = visible_layers.keys().copied().collect();
        self.db.pick_top_shape(
            &layer_ids,
            chipgeom_format::Point32 {
                x: hit.lx,
                y: hit.ly,
            },
        )
    }
}

impl eframe::App for ChipViewerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.poll_edit_result();
            loaded.poll_external_snapshot_refresh();
            if let Some(interval) = edit_poll_repaint_interval(loaded.pending_edit.is_some()) {
                ctx.request_repaint_after(interval);
            } else {
                ctx.request_repaint_after(SNAPSHOT_REFRESH_CHECK_INTERVAL);
            }
        }
        egui::SidePanel::left("chip_viewer_layers")
            .resizable(true)
            .default_width(260.0)
            .show(ctx, |ui| self.sidebar(ui));
        egui::CentralPanel::default().show(ctx, |ui| {
            self.canvas(ui);
        });
    }
}

fn color32(rgba: [u8; 4]) -> egui::Color32 {
    egui::Color32::from_rgba_premultiplied(rgba[0], rgba[1], rgba[2], rgba[3])
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

fn paint_shape_geometry(
    painter: &egui::Painter,
    geometry: ShapeGeometry,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    color: egui::Color32,
) -> bool {
    let primitive = shape_screen_primitive(geometry, world, canvas, zoom, pan);
    if !screen_primitive_bounds(primitive).intersects(canvas) {
        return false;
    }

    match primitive {
        ScreenShapePrimitive::Rect(rect) => {
            painter.rect_filled(rect, 0.0, color);
        }
        ScreenShapePrimitive::Line { begin, end, width } => {
            painter.line_segment([begin, end], egui::Stroke::new(width, color));
        }
        ScreenShapePrimitive::Point { center, radius } => {
            painter.circle_filled(center, radius, color);
        }
    }
    true
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

fn resize_corner_from_screen_pos(pos: egui::Pos2, rect: egui::Rect) -> ResizeCorner {
    [
        (ResizeCorner::LowerLeft, rect.left_bottom()),
        (ResizeCorner::LowerRight, rect.right_bottom()),
        (ResizeCorner::UpperLeft, rect.left_top()),
        (ResizeCorner::UpperRight, rect.right_top()),
    ]
    .into_iter()
    .min_by(|(_, lhs), (_, rhs)| {
        squared_distance(pos, *lhs).total_cmp(&squared_distance(pos, *rhs))
    })
    .map(|(corner, _)| corner)
    .unwrap_or(ResizeCorner::UpperRight)
}

fn squared_distance(lhs: egui::Pos2, rhs: egui::Pos2) -> f32 {
    let dx = lhs.x - rhs.x;
    let dy = lhs.y - rhs.y;
    dx * dx + dy * dy
}

fn resize_rect_from_delta(rect: Rect32, dx: i32, dy: i32, corner: ResizeCorner) -> Rect32 {
    let dragged_lx = rect.lx.saturating_add(dx).min(rect.hx.saturating_sub(1));
    let dragged_ly = rect.ly.saturating_add(dy).min(rect.hy.saturating_sub(1));
    let dragged_hx = rect.hx.saturating_add(dx).max(rect.lx.saturating_add(1));
    let dragged_hy = rect.hy.saturating_add(dy).max(rect.ly.saturating_add(1));

    match corner {
        ResizeCorner::LowerLeft => Rect32 {
            lx: dragged_lx,
            ly: dragged_ly,
            hx: rect.hx,
            hy: rect.hy,
        },
        ResizeCorner::LowerRight => Rect32 {
            lx: rect.lx,
            ly: dragged_ly,
            hx: dragged_hx,
            hy: rect.hy,
        },
        ResizeCorner::UpperLeft => Rect32 {
            lx: dragged_lx,
            ly: rect.ly,
            hx: rect.hx,
            hy: dragged_hy,
        },
        ResizeCorner::UpperRight => Rect32 {
            lx: rect.lx,
            ly: rect.ly,
            hx: dragged_hx,
            hy: dragged_hy,
        },
    }
}

fn should_use_view_tiles_for_state(
    view_tile_count: usize,
    _has_highlight: bool,
    _has_selection: bool,
    _has_draft: bool,
    _edit_enabled: bool,
    zoom: f32,
    viewport: Rect32,
    world: Rect32,
) -> bool {
    if view_tile_count == 0 {
        return false;
    }

    let viewport_width = (viewport.hx - viewport.lx).max(1) as i64;
    let viewport_height = (viewport.hy - viewport.ly).max(1) as i64;
    let world_width = (world.hx - world.lx).max(1) as i64;
    let world_height = (world.hy - world.ly).max(1) as i64;
    let viewport_area = viewport_width.saturating_mul(viewport_height);
    let world_area = world_width.saturating_mul(world_height).max(1);

    zoom <= 1.0 || viewport_area.saturating_mul(4) >= world_area
}

fn edit_poll_repaint_interval(has_pending_edit: bool) -> Option<Duration> {
    has_pending_edit.then_some(Duration::from_millis(100))
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
    lines
}

fn cache_stats_line(label: &str, stats: RenderCacheStats) -> String {
    format!(
        "{label}: {} entries, {} hits, {} misses",
        stats.entries, stats.hits, stats.misses
    )
}

fn canvas_status_line(
    drawn: usize,
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
    format!(
        "drawn: {drawn} {draw_source}, zoom: {zoom:.2}x, viewport: {} {} {} {}",
        viewport.lx, viewport.ly, viewport.hx, viewport.hy
    )
}

fn edit_tool_is_allowed(owner_type: u8, tool: EditTool) -> bool {
    match tool {
        EditTool::Move => matches!(
            OwnerType::from_raw(owner_type),
            Some(
                OwnerType::InstanceBBox
                    | OwnerType::NetWireSegment
                    | OwnerType::SpecialWireSegment
                    | OwnerType::Blockage
                    | OwnerType::Fill
                    | OwnerType::Region
                    | OwnerType::Slot
            )
        ),
        EditTool::Resize => matches!(
            OwnerType::from_raw(owner_type),
            Some(
                OwnerType::NetWireSegment
                    | OwnerType::SpecialWireSegment
                    | OwnerType::Blockage
                    | OwnerType::Fill
                    | OwnerType::Region
                    | OwnerType::Slot
            )
        ),
    }
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
        lines.push(format!(
            "path: {} {} {} {}",
            owner.path0, owner.path1, owner.path2, owner.path3
        ));
    } else {
        lines.push("owner: unavailable".to_string());
    }

    lines
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

fn visible_layer_ids(visible_layers: &BTreeMap<LayerId, LayerStyle>) -> Vec<LayerId> {
    visible_layers.keys().copied().collect()
}

fn visible_style_for_shape<'a>(
    shape: &ShapeRecord,
    visible_layers: &'a BTreeMap<LayerId, LayerStyle>,
) -> Option<&'a LayerStyle> {
    visible_layers.get(&shape.layer_id)
}

fn layer_hover_text(layer: &LayerUiState) -> String {
    format!(
        "id: {}\norder: {}\ntype: {}\ndirection: {}\nwidth: {}\npitch: {} {}",
        layer.layer_id,
        layer.order,
        layer.layer_type,
        layer.direction,
        layer.width,
        layer.pitch_x,
        layer.pitch_y
    )
}

#[derive(Clone, Copy, Debug)]
struct PanDragState {
    previous_drag_delta: egui::Vec2,
}

impl Default for PanDragState {
    fn default() -> Self {
        Self {
            previous_drag_delta: egui::Vec2::ZERO,
        }
    }
}

impl PanDragState {
    fn apply(&mut self, pan: egui::Vec2, current_drag_delta: egui::Vec2) -> egui::Vec2 {
        let incremental_delta = current_drag_delta - self.previous_drag_delta;
        self.previous_drag_delta = current_drag_delta;
        pan + incremental_delta
    }

    fn reset(&mut self) {
        self.previous_drag_delta = egui::Vec2::ZERO;
    }
}

fn write_edit_command(path: &Path, command: &GeometryEditCommand) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_vec_pretty(command).map_err(std::io::Error::other)?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)?;
    fs::rename(temp_path, path)
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
    fn resize_rect_anchors_lower_left_corner() {
        let rect = chipgeom_format::Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        };

        assert_eq!(
            resize_rect_from_delta(rect, 5, -8, ResizeCorner::UpperRight),
            chipgeom_format::Rect32 {
                lx: 10,
                ly: 20,
                hx: 35,
                hy: 32,
            }
        );
    }

    #[test]
    fn resize_rect_keeps_a_positive_extent() {
        let rect = chipgeom_format::Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        };

        assert_eq!(
            resize_rect_from_delta(rect, -100, -100, ResizeCorner::UpperRight),
            chipgeom_format::Rect32 {
                lx: 10,
                ly: 20,
                hx: 11,
                hy: 21,
            }
        );
    }

    #[test]
    fn resize_rect_drags_the_selected_corner_and_keeps_the_opposite_corner_fixed() {
        let rect = chipgeom_format::Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        };

        assert_eq!(
            resize_rect_from_delta(rect, -3, 4, ResizeCorner::LowerLeft),
            chipgeom_format::Rect32 {
                lx: 7,
                ly: 24,
                hx: 30,
                hy: 40,
            }
        );
        assert_eq!(
            resize_rect_from_delta(rect, 5, -6, ResizeCorner::LowerRight),
            chipgeom_format::Rect32 {
                lx: 10,
                ly: 14,
                hx: 35,
                hy: 40,
            }
        );
        assert_eq!(
            resize_rect_from_delta(rect, 8, 3, ResizeCorner::UpperLeft),
            chipgeom_format::Rect32 {
                lx: 18,
                ly: 20,
                hx: 30,
                hy: 43,
            }
        );
    }

    #[test]
    fn resize_rect_clamps_dragged_corner_before_it_crosses_the_opposite_corner() {
        let rect = chipgeom_format::Rect32 {
            lx: 10,
            ly: 20,
            hx: 30,
            hy: 40,
        };

        assert_eq!(
            resize_rect_from_delta(rect, 100, 100, ResizeCorner::LowerLeft),
            chipgeom_format::Rect32 {
                lx: 29,
                ly: 39,
                hx: 30,
                hy: 40,
            }
        );
        assert_eq!(
            resize_rect_from_delta(rect, -100, -100, ResizeCorner::UpperRight),
            chipgeom_format::Rect32 {
                lx: 10,
                ly: 20,
                hx: 11,
                hy: 21,
            }
        );
    }

    #[test]
    fn resize_corner_from_screen_pos_selects_nearest_corner() {
        let screen = egui::Rect::from_min_max(egui::pos2(10.0, 20.0), egui::pos2(50.0, 80.0));

        assert_eq!(
            resize_corner_from_screen_pos(egui::pos2(12.0, 78.0), screen),
            ResizeCorner::LowerLeft
        );
        assert_eq!(
            resize_corner_from_screen_pos(egui::pos2(48.0, 79.0), screen),
            ResizeCorner::LowerRight
        );
        assert_eq!(
            resize_corner_from_screen_pos(egui::pos2(11.0, 21.0), screen),
            ResizeCorner::UpperLeft
        );
        assert_eq!(
            resize_corner_from_screen_pos(egui::pos2(49.0, 22.0), screen),
            ResizeCorner::UpperRight
        );
    }

    #[test]
    fn overview_uses_view_tiles_when_no_exact_overlay_is_active() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };

        assert!(should_use_view_tiles_for_state(
            16, false, false, false, false, 1.0, world, world,
        ));
    }

    #[test]
    fn canvas_status_line_reports_exact_draw_count_zoom_and_viewport() {
        assert_eq!(
            canvas_status_line(
                42,
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
    fn edit_mode_overview_keeps_view_tiles_with_exact_overlays() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };

        assert!(should_use_view_tiles_for_state(
            16, false, false, false, true, 1.0, world, world,
        ));
        assert!(should_use_view_tiles_for_state(
            16, false, true, false, true, 1.0, world, world,
        ));
        assert!(should_use_view_tiles_for_state(
            16, false, false, true, true, 1.0, world, world,
        ));
    }

    #[test]
    fn highlight_keeps_view_tiles_for_base_plane_at_overview() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };

        assert!(should_use_view_tiles_for_state(
            16, true, false, false, false, 0.25, world, world,
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
            selection_detail_lines(&shape, Some(&owner), Some("clk")),
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
                "path: 1 2 3 4",
            ]
        );
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
            ..chip_view_db::GeometryManifest::default()
        };

        assert_eq!(
            design_metadata_lines(&manifest),
            vec![
                "design: uart_top",
                "design version: 5.8",
                "dbu per micron: 2000",
                "manufacture grid: 5",
            ]
        );
        assert!(design_metadata_lines(&chip_view_db::GeometryManifest::default()).is_empty());
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
        let visible_shape = chipgeom_format::ShapeRecord {
            layer_id: 3,
            ..chipgeom_format::ShapeRecord::default()
        };
        let hidden_shape = chipgeom_format::ShapeRecord {
            layer_id: 4,
            ..chipgeom_format::ShapeRecord::default()
        };

        assert!(visible_style_for_shape(&visible_shape, &visible_layers).is_some());
        assert!(visible_style_for_shape(&hidden_shape, &visible_layers).is_none());
    }

    #[test]
    fn pan_drag_uses_incremental_delta() {
        let mut drag = PanDragState::default();
        let pan = drag.apply(egui::Vec2::ZERO, egui::vec2(10.0, 2.0));
        assert_eq!(pan, egui::vec2(10.0, 2.0));

        let pan = drag.apply(pan, egui::vec2(18.0, -1.0));

        assert_eq!(pan, egui::vec2(18.0, -1.0));
    }

    #[test]
    fn pan_drag_state_resets_between_gestures() {
        let mut drag = PanDragState::default();
        let pan = drag.apply(egui::Vec2::ZERO, egui::vec2(10.0, 0.0));
        let pan = drag.apply(pan, egui::vec2(20.0, 0.0));
        assert_eq!(pan, egui::vec2(20.0, 0.0));

        drag.reset();
        let pan = drag.apply(pan, egui::vec2(4.0, 0.0));

        assert_eq!(pan, egui::vec2(24.0, 0.0));
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
        let mut loaded = LoadedViewer::new(db, false, None, None);
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
    fn edit_tool_allows_only_supported_owner_operations() {
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::InstanceBBox as u8,
            EditTool::Move
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::NetWireSegment as u8,
            EditTool::Move
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::NetWireSegment as u8,
            EditTool::Resize
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::SpecialWireSegment as u8,
            EditTool::Resize
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::Blockage as u8,
            EditTool::Resize
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::Fill as u8,
            EditTool::Move
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::Fill as u8,
            EditTool::Resize
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::Region as u8,
            EditTool::Resize
        ));
        assert!(edit_tool_is_allowed(
            chipgeom_format::OwnerType::Slot as u8,
            EditTool::Move
        ));
        assert!(!edit_tool_is_allowed(
            chipgeom_format::OwnerType::InstanceBBox as u8,
            EditTool::Resize
        ));
        assert!(!edit_tool_is_allowed(
            chipgeom_format::OwnerType::PinPortShape as u8,
            EditTool::Move
        ));
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
        }
    }

    fn layer_state(layer_id: LayerId, visible: bool) -> LayerUiState {
        LayerUiState {
            layer_id,
            shape_count: 1,
            order: u32::from(layer_id),
            name: format!("L{layer_id}"),
            layer_type: "unknown".to_string(),
            direction: "unknown".to_string(),
            width: 0,
            pitch_x: 0,
            pitch_y: 0,
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
                 view=geometry.view.bin\n"
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

    fn layer_visibility(layers: &[LayerUiState]) -> Vec<bool> {
        layers.iter().map(|layer| layer.visible).collect()
    }
}
