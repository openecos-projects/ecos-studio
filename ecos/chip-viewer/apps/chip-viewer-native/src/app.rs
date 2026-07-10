use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

use chip_display::LayerStyle;
use chip_view_db::{ChipViewDb, SnapshotStats};
use chipgeom_format::{
    GeometryEditCommand, GeometryEditOp, GeometryEditResult, GeometryEditStatus, LayerId, Rect32,
    ShapeId, ShapeKind, ShapeState,
};
use eframe::egui;

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
    highlighted: BTreeSet<ShapeId>,
    selected: Option<ShapeId>,
    draft: Option<EditDraft>,
    pending_edit: Option<PendingEdit>,
    last_edit_result: Option<String>,
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
    original_bbox: Rect32,
    requested_bbox: Rect32,
}

struct PendingEdit {
    shape_id: ShapeId,
    result_path: PathBuf,
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
            highlighted: BTreeSet::new(),
            selected: None,
            draft: None,
            pending_edit: None,
            last_edit_result: None,
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
        if !self.search_text.trim().is_empty() {
            ui.label(format!("matches: {}", self.highlighted.len()));
        }

        if let Some(shape_id) = self.selected {
            ui.separator();
            ui.label("Selection");
            if let Some(shape) = self.db.find_shape(shape_id) {
                ui.label(format!("shape: {}", shape.id));
                ui.label(format!("version: {}", shape.version));
                ui.label(format!("layer: {}", shape.layer_id));
                if let Some(owner) = self.db.owner_for_shape(shape) {
                    ui.label(format!(
                        "owner: {} {}",
                        ChipViewDb::owner_type_label(owner.owner_type),
                        owner.owner_id
                    ));
                    if let Some(name) = self.db.owner_name(owner) {
                        ui.label(format!("name: {name}"));
                    }
                    ui.label(format!(
                        "path: {} {} {} {}",
                        owner.path0, owner.path1, owner.path2, owner.path3
                    ));
                }
            }
        }

        if self.edit_enabled {
            ui.separator();
            ui.label("Edit");
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
        if ui.button("Fit").clicked() {
            self.zoom = 1.0;
            self.pan = egui::Vec2::ZERO;
            self.pan_drag.reset();
        }
        ui.separator();
        ui.label("Layers");
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
                for tile in self.db.query_view_tiles(view_lod, *layer_id, viewport) {
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

            for shape in self.db.query_layer_intersect_records(*layer_id, viewport) {
                if shape.kind != ShapeKind::Rect as u8 {
                    continue;
                }
                let screen = world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
                if !screen.is_positive() || !screen.intersects(canvas) {
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
            if shape.state != ShapeState::Alive as u8 || shape.kind != ShapeKind::Rect as u8 {
                continue;
            }
            let screen = world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan);
            if !screen.is_positive() || !screen.intersects(canvas) {
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
            original_bbox,
            requested_bbox: original_bbox,
        });
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
            op: GeometryEditOp::MoveShape,
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

        self.selected = Some(result.shape_id);
        if matches!(
            result.status,
            GeometryEditStatus::Accepted
                | GeometryEditStatus::AdjustedAccepted
                | GeometryEditStatus::Conflict
        ) {
            match ChipViewDb::open(&self.db.snapshot().manifest().path) {
                Ok(db) => self.replace_db(db),
                Err(err) => {
                    self.last_edit_result = Some(format!("failed to reload geometry: {err}"));
                    self.pending_edit = None;
                    return;
                }
            }
        }

        self.last_edit_result = Some(format!(
            "edit {:?}: shape {} version {}",
            result.status, result.shape_id, result.new_version
        ));
        self.pending_edit = None;
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
        self.refresh_highlight();
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
        self.db.snapshot().shapes().iter().rev().find_map(|shape| {
            if shape.state != ShapeState::Alive as u8
                || shape.kind != ShapeKind::Rect as u8
                || !visible_layers.contains_key(&shape.layer_id)
            {
                return None;
            }
            world_to_screen_rect(shape.bbox, world, canvas, self.zoom, self.pan)
                .contains(pos)
                .then_some(shape.id)
        })
    }
}

impl eframe::App for ChipViewerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.poll_edit_result();
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

fn should_use_view_tiles_for_state(
    view_tile_count: usize,
    has_highlight: bool,
    has_selection: bool,
    has_draft: bool,
    edit_enabled: bool,
    zoom: f32,
    viewport: Rect32,
    world: Rect32,
) -> bool {
    if view_tile_count == 0 || has_highlight || has_selection || has_draft || edit_enabled {
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
}
