use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{Duration, Instant, SystemTime};

use chip_display::LayerStyle;
use chip_render::{RenderPlanCache, ViewTilePlaneCache};
use chip_view_db::{ChipViewDb, SnapshotStats};
use chipgeom_format::{
    GeometryEditCommand, GeometryEditOp, GeometryEditResult, GeometryEditStatus, LayerId, OwnerRef,
    OwnerType, Rect32, ShapeId, ShapeKind, ShapeRecord, ShapeState,
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
    highlighted: BTreeSet<ShapeId>,
    selected: Option<ShapeId>,
    pending_focus: Option<ShapeId>,
    edit_tool: EditTool,
    draft: Option<EditDraft>,
    pending_edit: Option<PendingEdit>,
    last_edit_result: Option<String>,
    snapshot_manifest_mtime: Option<SystemTime>,
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
    visible: bool,
    style: LayerStyle,
}

struct EditDraft {
    command_id: u64,
    shape_id: ShapeId,
    expected_version: u32,
    op: GeometryEditOp,
    original_bbox: Rect32,
    requested_bbox: Rect32,
}

struct PendingEdit {
    shape_id: ShapeId,
    result_path: PathBuf,
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
        let snapshot_manifest_mtime = manifest_modified_time(&db.snapshot().manifest().path);
        let layers = db
            .layer_summaries()
            .into_iter()
            .map(|summary| LayerUiState {
                layer_id: summary.layer_id,
                shape_count: summary.shape_count,
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
            highlighted: BTreeSet::new(),
            selected: None,
            pending_focus: None,
            edit_tool: EditTool::Move,
            draft: None,
            pending_edit: None,
            last_edit_result: None,
            snapshot_manifest_mtime,
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
                    self.pending_focus = first_existing_shape_id(&self.highlighted, |shape_id| {
                        self.db.find_shape(shape_id).is_some()
                    });
                }
            });
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
                match self.reload_snapshot(None) {
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
                    ui.colored_label(color, format!("L{}", layer.layer_id));
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

        if response.hovered() {
            let zoom_delta = ui.ctx().input(|input| input.zoom_delta());
            if (zoom_delta - 1.0).abs() > f32::EPSILON {
                self.zoom = (self.zoom * zoom_delta).clamp(0.05, 200.0);
                ui.ctx().request_repaint();
            }
        }

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

        for (layer_id, style) in &visible_layers {
            if use_view_tiles {
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
                continue;
            }

            for shape_id in self
                .render_cache
                .visible_shape_ids(&self.db, *layer_id, viewport)
            {
                let Some(shape) = self.db.find_shape(shape_id) else {
                    continue;
                };
                if !is_renderable_shape(shape) {
                    continue;
                }
                let screen = shape_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
                if !screen.intersects(canvas) {
                    continue;
                }
                let color = color32(style.rgba);
                painter.rect_filled(screen, 0.0, color);
                drawn += 1;
            }
        }

        for shape_id in overlay_shape_ids(self.selected, &self.highlighted) {
            let Some(shape) = self.db.find_shape(shape_id) else {
                continue;
            };
            if !is_renderable_shape(shape) {
                continue;
            }
            let screen = shape_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
            if !screen.intersects(canvas) {
                continue;
            }
            if self.highlighted.contains(&shape_id) {
                painter.rect_stroke(
                    screen.expand(1.5),
                    0.0,
                    egui::Stroke::new(2.0, egui::Color32::YELLOW),
                    egui::StrokeKind::Inside,
                );
            }
            if self.selected == Some(shape_id) {
                painter.rect_stroke(
                    screen.expand(2.0),
                    0.0,
                    egui::Stroke::new(2.0, egui::Color32::from_rgb(80, 220, 255)),
                    egui::StrokeKind::Inside,
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
            if use_view_tiles {
                format!("drawn: {drawn} view tiles")
            } else {
                format!("drawn: {drawn}")
            },
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
        let Some(shape_id) = self.pending_focus.take() else {
            return;
        };
        let Some(shape) = self.db.find_shape(shape_id) else {
            return;
        };
        if !is_renderable_shape(shape) {
            return;
        }

        let (zoom, pan) = focus_view_on_bbox(world, shape.bbox, canvas);
        self.zoom = zoom;
        self.pan = pan;
        self.pan_drag.reset();
        self.selected = Some(shape_id);
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
        self.draft = Some(EditDraft {
            command_id: self.allocate_command_id(),
            shape_id,
            expected_version,
            op: self.edit_tool.op(),
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
            GeometryEditOp::ResizeRect => resize_rect_from_delta(draft.original_bbox, dx, dy),
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
            match self.reload_snapshot(None) {
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

        let manifest_path = self.db.snapshot().manifest().path.clone();
        let current_mtime = manifest_modified_time(&manifest_path);
        if !snapshot_manifest_mtime_changed(self.snapshot_manifest_mtime, current_mtime) {
            if self.snapshot_manifest_mtime.is_none() {
                self.snapshot_manifest_mtime = current_mtime;
            }
            return;
        }

        match self.reload_snapshot(current_mtime) {
            Ok(()) => {
                self.last_edit_result = Some("geometry snapshot refreshed".to_string());
            }
            Err(err) => {
                self.last_edit_result = Some(format!("failed to refresh geometry: {err}"));
            }
        }
    }

    fn reload_snapshot(&mut self, current_mtime: Option<SystemTime>) -> Result<(), String> {
        let manifest_path = self.db.snapshot().manifest().path.clone();
        let snapshot_mtime = current_mtime.or_else(|| manifest_modified_time(&manifest_path));
        let db = ChipViewDb::open(&manifest_path).map_err(|err| err.to_string())?;
        self.replace_db(db);
        self.snapshot_manifest_mtime = snapshot_mtime;
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

fn world_to_screen_rect(
    rect: Rect32,
    world: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
) -> egui::Rect {
    let world_width = (world.hx - world.lx).max(1) as f32;
    let world_height = (world.hy - world.ly).max(1) as f32;
    let base_scale = (canvas.width() / world_width).min(canvas.height() / world_height);
    let scale = base_scale * zoom.max(0.001);
    let world_cx = (world.lx + world.hx) as f32 * 0.5;
    let world_cy = (world.ly + world.hy) as f32 * 0.5;
    let center = canvas.center() + pan;
    let to_screen = |x: i32, y: i32| -> egui::Pos2 {
        egui::pos2(
            center.x + (x as f32 - world_cx) * scale,
            center.y - (y as f32 - world_cy) * scale,
        )
    };

    egui::Rect::from_min_max(to_screen(rect.lx, rect.hy), to_screen(rect.hx, rect.ly))
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

fn translate_rect(rect: Rect32, dx: i32, dy: i32) -> Rect32 {
    Rect32 {
        lx: rect.lx.saturating_add(dx),
        ly: rect.ly.saturating_add(dy),
        hx: rect.hx.saturating_add(dx),
        hy: rect.hy.saturating_add(dy),
    }
}

fn resize_rect_from_delta(rect: Rect32, dx: i32, dy: i32) -> Rect32 {
    let min_hx = rect.lx.saturating_add(1);
    let min_hy = rect.ly.saturating_add(1);
    Rect32 {
        lx: rect.lx,
        ly: rect.ly,
        hx: rect.hx.saturating_add(dx).max(min_hx),
        hy: rect.hy.saturating_add(dy).max(min_hy),
    }
}

fn should_use_view_tiles_for_state(
    view_tile_count: usize,
    has_highlight: bool,
    has_selection: bool,
    has_draft: bool,
    _edit_enabled: bool,
    zoom: f32,
    viewport: Rect32,
    world: Rect32,
) -> bool {
    if view_tile_count == 0 || has_highlight || has_selection || has_draft {
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

fn manifest_modified_time(path: &Path) -> Option<SystemTime> {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
}

fn snapshot_manifest_mtime_changed(
    previous: Option<SystemTime>,
    current: Option<SystemTime>,
) -> bool {
    matches!((previous, current), (Some(previous), Some(current)) if current > previous)
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

fn edit_tool_is_allowed(owner_type: u8, tool: EditTool) -> bool {
    match tool {
        EditTool::Move => matches!(
            OwnerType::from_raw(owner_type),
            Some(
                OwnerType::InstanceBBox
                    | OwnerType::NetWireSegment
                    | OwnerType::SpecialWireSegment
                    | OwnerType::Blockage
            )
        ),
        EditTool::Resize => matches!(
            OwnerType::from_raw(owner_type),
            Some(OwnerType::NetWireSegment | OwnerType::SpecialWireSegment | OwnerType::Blockage)
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
            resize_rect_from_delta(rect, 5, -8),
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
            resize_rect_from_delta(rect, -100, -100),
            chipgeom_format::Rect32 {
                lx: 10,
                ly: 20,
                hx: 11,
                hy: 21,
            }
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
    fn edit_mode_overview_still_uses_view_tiles_until_an_exact_overlay_is_active() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };

        assert!(should_use_view_tiles_for_state(
            16, false, false, false, true, 1.0, world, world,
        ));
        assert!(!should_use_view_tiles_for_state(
            16, false, true, false, true, 1.0, world, world,
        ));
        assert!(!should_use_view_tiles_for_state(
            16, false, false, true, true, 1.0, world, world,
        ));
    }

    #[test]
    fn highlight_disables_view_tiles_so_exact_shapes_can_be_stroked() {
        let world = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };

        assert!(!should_use_view_tiles_for_state(
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
    fn snapshot_refresh_detects_newer_manifest_mtime() {
        let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(10);
        let same = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(10);
        let newer = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(11);

        assert!(!snapshot_manifest_mtime_changed(Some(old), Some(same)));
        assert!(snapshot_manifest_mtime_changed(Some(old), Some(newer)));
        assert!(!snapshot_manifest_mtime_changed(None, Some(newer)));
        assert!(!snapshot_manifest_mtime_changed(Some(old), None));
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
        assert!(!edit_tool_is_allowed(
            chipgeom_format::OwnerType::InstanceBBox as u8,
            EditTool::Resize
        ));
        assert!(!edit_tool_is_allowed(
            chipgeom_format::OwnerType::Fill as u8,
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
            visible,
            style: LayerStyle::default_for_layer(layer_id),
        }
    }

    fn layer_visibility(layers: &[LayerUiState]) -> Vec<bool> {
        layers.iter().map(|layer| layer.visible).collect()
    }
}
