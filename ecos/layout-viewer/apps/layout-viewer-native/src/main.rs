mod lod_style;
mod selection;
mod view_state;
mod visibility;

use std::path::PathBuf;

use anyhow::Result;
use clap::Parser;
use eframe::egui;
use layoutpkg_format::{LayoutObjectKind, LayoutRectRecord};
use layoutpkg_reader::{
    GridOverlay, GridOverlaySet, LayoutLayer, LayoutPackage, LoadStats, OverlayDirection, Rect,
};
use lod_style::{draw_style_for_mode, DrawPrimitiveKind, LodMode};
use selection::SelectedObject;
use view_state::ViewState;
use visibility::{all_kinds, VisibilityState};

#[derive(Debug, Parser)]
#[command(name = "layout-viewer-native")]
struct Args {
    package_root: PathBuf,

    #[arg(long, default_value_t = 128)]
    cache_capacity: usize,

    #[arg(long, default_value_t = 200.0)]
    detail_units_per_pixel: f32,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let app = LayoutViewerApp::open(args)?;
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1280.0, 860.0]),
        ..Default::default()
    };
    eframe::run_native(
        "ECOS Layout Viewer",
        native_options,
        Box::new(move |_cc| Ok(Box::new(app))),
    )
    .map_err(|err| anyhow::anyhow!("{err}"))?;
    Ok(())
}

struct LayoutViewerApp {
    package: LayoutPackage,
    view: Option<ViewState>,
    layers: Vec<LayoutLayer>,
    grid_overlays: GridOverlaySet,
    visibility: VisibilityState,
    selected: Option<SelectedObject>,
    cache_capacity: usize,
    detail_units_per_pixel: f32,
    last_stats: LoadStats,
    last_mode: &'static str,
    last_tile_count: usize,
    last_record_count: usize,
    last_large_count: usize,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GridDensity {
    FarView,
    Overview,
    Detail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DisplayMode {
    FarView,
    OverviewDensity,
    Detail,
}

impl LayoutViewerApp {
    fn open(args: Args) -> Result<Self> {
        let package = LayoutPackage::open(&args.package_root)?;
        let layers = package.layers()?;
        let grid_overlays = package.grid_overlays()?;
        let visibility = VisibilityState::new(&layers);
        Ok(Self {
            package,
            view: None,
            layers,
            grid_overlays,
            visibility,
            selected: None,
            cache_capacity: args.cache_capacity,
            detail_units_per_pixel: args.detail_units_per_pixel,
            last_stats: LoadStats::default(),
            last_mode: "overview",
            last_tile_count: 0,
            last_record_count: 0,
            last_large_count: 0,
            last_error: None,
        })
    }

    fn ensure_view(&mut self, size: egui::Vec2) {
        if self.view.is_none() && size.x > 0.0 && size.y > 0.0 {
            self.view = Some(ViewState::fit(self.package.world_bbox(), size.x, size.y));
        }
    }

    fn draw_layout(&mut self, ui: &mut egui::Ui, rect: egui::Rect, response: &egui::Response) {
        self.ensure_view(rect.size());
        let Some(mut view) = self.view else {
            return;
        };

        if response.dragged() {
            let delta = ui.input(|input| input.pointer.delta());
            view.pan_pixels(delta.x, delta.y);
            ui.ctx().request_repaint();
        }

        if response.hovered() {
            let scroll = ui.input(|input| input.raw_scroll_delta.y);
            if scroll.abs() > 0.0 {
                let factor = scroll_zoom_factor(scroll);
                let cursor = ui
                    .input(|input| input.pointer.hover_pos())
                    .unwrap_or(rect.center());
                view.zoom_at_screen(
                    factor,
                    cursor.x - rect.left(),
                    cursor.y - rect.top(),
                    rect.width(),
                    rect.height(),
                );
                ui.ctx().request_repaint();
            }
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
                match self.package.query_point(
                    world_x.round() as i32,
                    world_y.round() as i32,
                    tolerance,
                    self.cache_capacity,
                ) {
                    Ok(Some(hit)) => {
                        let selected = SelectedObject::from_hit(hit, &self.layers);
                        if self.visibility.is_record_visible(&selected.record) {
                            self.selected = Some(selected);
                        } else {
                            self.selected = None;
                        }
                        self.last_error = None;
                    }
                    Ok(None) => {
                        self.selected = None;
                        self.last_error = None;
                    }
                    Err(error) => self.last_error = Some(error.to_string()),
                }
            }
        }

        self.view = Some(view);

        let mode = display_mode(view.units_per_pixel, self.detail_units_per_pixel);
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 0.0, background_color(mode));
        self.draw_grid(&painter, rect, view, grid_density_for_mode(mode));
        self.draw_grid_overlays(&painter, rect, view, mode);

        match mode {
            DisplayMode::FarView => self.draw_far_view(&painter, rect, view),
            DisplayMode::OverviewDensity => self.draw_overview(&painter, rect, view),
            DisplayMode::Detail => self.draw_detail(&painter, rect, view),
        }
        self.draw_selection(&painter, rect, view);
        self.draw_hud(ui, rect, view);
    }

    fn draw_detail(&mut self, painter: &egui::Painter, screen: egui::Rect, view: ViewState) {
        match self.package.load_detail_viewport(
            view.viewport_rect(screen.width(), screen.height()),
            self.cache_capacity,
        ) {
            Ok(batch) => {
                self.last_error = None;
                self.last_mode = "detail";
                self.last_stats = batch.stats;
                self.last_tile_count = batch.tiles.len();
                self.last_record_count = batch.tiles.iter().map(|tile| tile.records.len()).sum();
                self.last_large_count = batch.large_objects.records.len();
                for tile in &batch.tiles {
                    draw_records(
                        painter,
                        screen,
                        view,
                        &tile.records,
                        &self.visibility,
                        LodMode::Detail,
                    );
                }
                draw_records(
                    painter,
                    screen,
                    view,
                    &batch.large_objects.records,
                    &self.visibility,
                    LodMode::Detail,
                );
            }
            Err(error) => self.last_error = Some(error.to_string()),
        }
    }

    fn draw_overview(&mut self, painter: &egui::Painter, screen: egui::Rect, view: ViewState) {
        match self.package.load_overview() {
            Ok(tiles) => {
                self.last_error = None;
                self.last_mode = "overview-density";
                self.last_stats = LoadStats::default();
                self.last_tile_count = tiles.len();
                self.last_record_count = tiles.iter().map(|tile| tile.records.len()).sum();
                self.last_large_count = 0;
                let mut records = tiles
                    .iter()
                    .flat_map(|tile| tile.records.iter().cloned())
                    .collect::<Vec<_>>();
                records.sort_by_key(|record| overview_draw_order(record.kind));
                draw_records(
                    painter,
                    screen,
                    view,
                    &records,
                    &self.visibility,
                    LodMode::Overview,
                );
            }
            Err(error) => self.last_error = Some(error.to_string()),
        }
    }

    fn draw_far_view(&mut self, painter: &egui::Painter, screen: egui::Rect, view: ViewState) {
        let mut record_count = 0;
        match self.package.load_overview() {
            Ok(tiles) => {
                let mut records = tiles
                    .iter()
                    .flat_map(|tile| tile.records.iter().cloned())
                    .collect::<Vec<_>>();
                record_count += records.len();
                records.sort_by_key(|record| far_view_draw_order(record.kind));
                draw_records(
                    painter,
                    screen,
                    view,
                    &records,
                    &self.visibility,
                    LodMode::FarView,
                );
            }
            Err(error) => {
                self.last_error = Some(error.to_string());
                return;
            }
        }
        match self.package.load_large_objects_only() {
            Ok(large) => {
                let mut records = large.records.iter().cloned().collect::<Vec<_>>();
                records.sort_by_key(|record| far_view_draw_order(record.kind));
                record_count += records.len();
                draw_records(
                    painter,
                    screen,
                    view,
                    &records,
                    &self.visibility,
                    LodMode::FarView,
                );
                self.last_large_count = large.records.len();
            }
            Err(error) => {
                self.last_error = Some(error.to_string());
                return;
            }
        }
        self.last_error = None;
        self.last_mode = "far-view";
        self.last_stats = LoadStats::default();
        self.last_tile_count = 0;
        self.last_record_count = record_count;
    }

    fn draw_grid(
        &self,
        painter: &egui::Painter,
        screen: egui::Rect,
        view: ViewState,
        density: GridDensity,
    ) {
        let viewport = view.viewport_rect(screen.width(), screen.height());
        let target_px = grid_target_px(density);
        let target = target_px * view.units_per_pixel;
        let step = nice_step(target.max(1.0));
        let start_x = (viewport.x1 as f32 / step).floor() as i32 - 1;
        let end_x = (viewport.x2 as f32 / step).ceil() as i32 + 1;
        let start_y = (viewport.y1 as f32 / step).floor() as i32 - 1;
        let end_y = (viewport.y2 as f32 / step).ceil() as i32 + 1;
        let stroke = match density {
            GridDensity::FarView => {
                egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(30, 41, 59, 95))
            }
            GridDensity::Overview => {
                egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(30, 41, 59, 72))
            }
            GridDensity::Detail => egui::Stroke::new(1.0, egui::Color32::from_gray(225)),
        };
        for ix in start_x..=end_x {
            let x = ix as f32 * step;
            let (sx, _) =
                view.world_to_screen(x, viewport.y1 as f32, screen.width(), screen.height());
            let sx = screen.left() + sx;
            painter.line_segment(
                [
                    egui::pos2(sx, screen.top()),
                    egui::pos2(sx, screen.bottom()),
                ],
                stroke,
            );
        }
        for iy in start_y..=end_y {
            let y = iy as f32 * step;
            let (_, sy) =
                view.world_to_screen(viewport.x1 as f32, y, screen.width(), screen.height());
            let sy = screen.top() + sy;
            painter.line_segment(
                [
                    egui::pos2(screen.left(), sy),
                    egui::pos2(screen.right(), sy),
                ],
                stroke,
            );
        }
    }

    fn draw_hud(&self, ui: &mut egui::Ui, screen: egui::Rect, view: ViewState) {
        let text = if let Some(error) = &self.last_error {
            format!("{}\\n{}", self.package.design_name(), error)
        } else {
            format!(
                "{}\\nmode={} upp={:.2}\\ntiles={} records={} large={} cache={}\\nreads={} hits={} misses={} evict={} large_reads={}",
                self.package.design_name(),
                self.last_mode,
                view.units_per_pixel,
                self.last_tile_count,
                self.last_record_count,
                self.last_large_count,
                self.package.cache_len(),
                self.last_stats.disk_reads,
                self.last_stats.cache_hits,
                self.last_stats.cache_misses,
                self.last_stats.evictions,
                self.last_stats.large_object_disk_reads,
            )
        };
        let hud_rect = egui::Rect::from_min_size(
            screen.left_top() + egui::vec2(12.0, 12.0),
            egui::vec2(340.0, 112.0),
        );
        ui.painter().rect_filled(
            hud_rect,
            6.0,
            egui::Color32::from_rgba_unmultiplied(255, 255, 255, 235),
        );
        ui.painter().text(
            hud_rect.left_top() + egui::vec2(10.0, 10.0),
            egui::Align2::LEFT_TOP,
            text,
            egui::FontId::monospace(13.0),
            egui::Color32::from_rgb(15, 23, 42),
        );
    }

    fn draw_selection(&self, painter: &egui::Painter, screen: egui::Rect, view: ViewState) {
        let Some(selected) = &self.selected else {
            return;
        };
        if !self.visibility.is_record_visible(&selected.record) {
            return;
        }
        let bbox = selected.bbox();
        let (x1, y1) = view.world_to_screen(
            bbox.x1 as f32,
            bbox.y1 as f32,
            screen.width(),
            screen.height(),
        );
        let (x2, y2) = view.world_to_screen(
            bbox.x2 as f32,
            bbox.y2 as f32,
            screen.width(),
            screen.height(),
        );
        let rect = egui::Rect::from_min_max(
            egui::pos2(screen.left() + x1.min(x2), screen.top() + y1.min(y2)),
            egui::pos2(screen.left() + x1.max(x2), screen.top() + y1.max(y2)),
        );
        if rect.intersects(screen) {
            painter.rect_stroke(
                rect.expand(2.0),
                0.0,
                egui::Stroke::new(2.0, egui::Color32::from_rgb(239, 68, 68)),
                egui::StrokeKind::Outside,
            );
        }
    }

    fn draw_grid_overlays(
        &self,
        painter: &egui::Painter,
        screen: egui::Rect,
        view: ViewState,
        mode: DisplayMode,
    ) {
        let viewport = view.viewport_rect(screen.width(), screen.height());
        if self.visibility.show_gcell_grids {
            for overlay in &self.grid_overlays.gcell_grids {
                draw_overlay_lines(
                    painter,
                    screen,
                    view,
                    viewport,
                    overlay,
                    overlay_stroke(LayoutObjectKind::GCellGrid, mode),
                );
            }
        }
        if self.visibility.show_tracks {
            for overlay in &self.grid_overlays.tracks {
                if let Some(layer_id) = overlay.layer_id {
                    if !self.visibility.is_layer_visible(layer_id) {
                        continue;
                    }
                }
                draw_overlay_lines(
                    painter,
                    screen,
                    view,
                    viewport,
                    overlay,
                    overlay_stroke(LayoutObjectKind::Track, mode),
                );
            }
        }
    }

    fn draw_sidebar(&mut self, ctx: &egui::Context) {
        egui::SidePanel::right("visibility-panel")
            .resizable(true)
            .default_width(220.0)
            .min_width(180.0)
            .show(ctx, |ui| {
                ui.heading("Visibility");
                ui.separator();
                ui.label("Overlays");
                ui.checkbox(&mut self.visibility.show_tracks, "Tracks");
                ui.checkbox(&mut self.visibility.show_gcell_grids, "GCell grids");
                ui.separator();
                ui.label("Kinds");
                for kind in all_kinds() {
                    let mut visible = self.visibility.is_kind_visible(kind);
                    if ui.checkbox(&mut visible, kind_label(kind)).changed() {
                        self.visibility.set_kind_visible(kind, visible);
                    }
                }
                ui.separator();
                ui.label("Selection");
                if let Some(selected) = &self.selected {
                    ui.monospace(format!("kind: {}", kind_label(selected.record.kind)));
                    let layer_text = selected
                        .layer_name
                        .as_ref()
                        .map(|name| format!("{} ({name})", selected.record.layer_id))
                        .unwrap_or_else(|| selected.record.layer_id.to_string());
                    ui.monospace(format!("layer: {layer_text}"));
                    ui.monospace(format!("source_id: {}", selected.record.source_id));
                    ui.monospace(format!(
                        "bbox: {}, {}, {}, {}",
                        selected.record.x1,
                        selected.record.y1,
                        selected.record.x2,
                        selected.record.y2
                    ));
                    ui.monospace(format!("source: {}", selected.source_label()));
                    ui.monospace(format!(
                        "tile: {}",
                        selected.tile_id.as_deref().unwrap_or("-")
                    ));
                } else {
                    ui.label("No object selected");
                }
                ui.separator();
                ui.label("Layers");
                if self.layers.is_empty() {
                    ui.label("No layer dictionary");
                } else {
                    egui::ScrollArea::vertical()
                        .max_height(260.0)
                        .show(ui, |ui| {
                            for layer in &self.layers {
                                let mut visible = self.visibility.is_layer_visible(layer.id);
                                let label = format!("{}  {}", layer.id, layer.name);
                                if ui.checkbox(&mut visible, label).changed() {
                                    self.visibility.set_layer_visible(layer.id, visible);
                                }
                            }
                        });
                }
            });
    }
}

impl eframe::App for LayoutViewerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.draw_sidebar(ctx);
        egui::CentralPanel::default().show(ctx, |ui| {
            let available = ui.available_size();
            let (rect, response) = ui.allocate_exact_size(available, egui::Sense::drag());
            self.draw_layout(ui, rect, &response);
        });
    }
}

fn draw_records(
    painter: &egui::Painter,
    screen: egui::Rect,
    view: ViewState,
    records: &[LayoutRectRecord],
    visibility: &VisibilityState,
    mode: LodMode,
) {
    for record in records {
        if !visibility.is_record_visible(record) {
            continue;
        }
        let (x1, y1) = view.world_to_screen(
            record.x1 as f32,
            record.y1 as f32,
            screen.width(),
            screen.height(),
        );
        let (x2, y2) = view.world_to_screen(
            record.x2 as f32,
            record.y2 as f32,
            screen.width(),
            screen.height(),
        );
        let rect = egui::Rect::from_min_max(
            egui::pos2(screen.left() + x1.min(x2), screen.top() + y1.min(y2)),
            egui::pos2(screen.left() + x1.max(x2), screen.top() + y1.max(y2)),
        );
        if !rect.intersects(screen) {
            continue;
        }
        let style = draw_style_for_mode(record.kind, mode);
        let min_size = 1.0;
        let rect = if rect.width() < min_size || rect.height() < min_size {
            egui::Rect::from_center_size(
                rect.center(),
                egui::vec2(rect.width().max(min_size), rect.height().max(min_size)),
            )
        } else {
            rect
        };
        match style.primitive {
            DrawPrimitiveKind::Fill => {
                painter.rect_filled(rect, 0.0, style.color);
            }
            DrawPrimitiveKind::Stroke => {
                painter.rect_stroke(
                    rect,
                    0.0,
                    egui::Stroke::new(style.stroke_width.max(1) as f32, style.color),
                    egui::StrokeKind::Inside,
                );
            }
            DrawPrimitiveKind::Density => {
                draw_density_record(painter, rect, record.layer_id, style);
            }
            DrawPrimitiveKind::Marker => {
                let max_size = style.max_marker_px.max(1) as f32;
                let size = egui::vec2(rect.width().min(max_size), rect.height().min(max_size));
                painter.rect_filled(
                    egui::Rect::from_center_size(rect.center(), size),
                    0.0,
                    style.color,
                );
            }
        }
    }
}

fn draw_density_record(
    painter: &egui::Painter,
    rect: egui::Rect,
    layer_id: u16,
    style: lod_style::DrawStyle,
) {
    let stroke = egui::Stroke::new(style.stroke_width.max(1) as f32, style.color);
    if rect.width() <= 2.0 || rect.height() <= 2.0 {
        painter.line_segment([rect.left_center(), rect.right_center()], stroke);
        return;
    }

    let inset = rect.width().min(rect.height()).min(2.0) * 0.5;
    if layer_id % 2 == 0 {
        let x = rect.center().x;
        painter.line_segment(
            [
                egui::pos2(x, rect.top() + inset),
                egui::pos2(x, rect.bottom() - inset),
            ],
            stroke,
        );
    } else {
        let y = rect.center().y;
        painter.line_segment(
            [
                egui::pos2(rect.left() + inset, y),
                egui::pos2(rect.right() - inset, y),
            ],
            stroke,
        );
    }
}

fn draw_overlay_lines(
    painter: &egui::Painter,
    screen: egui::Rect,
    view: ViewState,
    viewport: Rect,
    overlay: &GridOverlay,
    stroke: egui::Stroke,
) {
    if overlay.count == 0 || overlay.step <= 0 {
        return;
    }
    let Some((start_index, end_index)) =
        visible_overlay_indices(overlay, viewport, view.units_per_pixel)
    else {
        return;
    };
    for index in start_index..=end_index {
        let coord = overlay.start + overlay.step * index as i32;
        match overlay.direction {
            OverlayDirection::X => {
                let (_, sy) = view.world_to_screen(
                    viewport.x1 as f32,
                    coord as f32,
                    screen.width(),
                    screen.height(),
                );
                let sy = screen.top() + sy;
                painter.line_segment(
                    [
                        egui::pos2(screen.left(), sy),
                        egui::pos2(screen.right(), sy),
                    ],
                    stroke,
                );
            }
            OverlayDirection::Y => {
                let (sx, _) = view.world_to_screen(
                    coord as f32,
                    viewport.y1 as f32,
                    screen.width(),
                    screen.height(),
                );
                let sx = screen.left() + sx;
                painter.line_segment(
                    [
                        egui::pos2(sx, screen.top()),
                        egui::pos2(sx, screen.bottom()),
                    ],
                    stroke,
                );
            }
        }
    }
}

fn visible_overlay_indices(
    overlay: &GridOverlay,
    viewport: Rect,
    units_per_pixel: f32,
) -> Option<(u32, u32)> {
    if overlay.count == 0 || overlay.step <= 0 {
        return None;
    }
    let spacing_px = overlay.step as f32 / units_per_pixel;
    if spacing_px < 4.0 {
        return None;
    }
    let start_index = match overlay.direction {
        OverlayDirection::X => {
            ((viewport.y1 - overlay.start) as f32 / overlay.step as f32).floor() as i32
        }
        OverlayDirection::Y => {
            ((viewport.x1 - overlay.start) as f32 / overlay.step as f32).floor() as i32
        }
    }
    .max(0) as u32;
    let end_index = match overlay.direction {
        OverlayDirection::X => {
            ((viewport.y2 - overlay.start) as f32 / overlay.step as f32).ceil() as i32
        }
        OverlayDirection::Y => {
            ((viewport.x2 - overlay.start) as f32 / overlay.step as f32).ceil() as i32
        }
    }
    .max(0) as u32;
    let end_index = end_index.min(overlay.count.saturating_sub(1));
    if start_index > end_index {
        return None;
    }
    Some((start_index, end_index))
}

fn kind_label(kind: LayoutObjectKind) -> &'static str {
    match kind {
        LayoutObjectKind::Die => "Die",
        LayoutObjectKind::Core => "Core",
        LayoutObjectKind::Instance => "Instances",
        LayoutObjectKind::RegularWire => "Regular wires",
        LayoutObjectKind::SpecialWire => "Special wires",
        LayoutObjectKind::Via => "Vias",
        LayoutObjectKind::IoPin => "IO pins",
        LayoutObjectKind::Blockage => "Blockages",
        LayoutObjectKind::Fill => "Fills",
        LayoutObjectKind::Region => "Regions",
        LayoutObjectKind::Row => "Rows",
        LayoutObjectKind::Track => "Tracks",
        LayoutObjectKind::GCellGrid => "GCell grids",
    }
}

fn display_mode(units_per_pixel: f32, detail_units_per_pixel: f32) -> DisplayMode {
    if units_per_pixel <= detail_units_per_pixel {
        DisplayMode::Detail
    } else if units_per_pixel <= far_view_units_per_pixel(detail_units_per_pixel) {
        DisplayMode::OverviewDensity
    } else {
        DisplayMode::FarView
    }
}

fn far_view_units_per_pixel(detail_units_per_pixel: f32) -> f32 {
    detail_units_per_pixel * 3.0
}

fn grid_density_for_mode(mode: DisplayMode) -> GridDensity {
    match mode {
        DisplayMode::FarView => GridDensity::FarView,
        DisplayMode::OverviewDensity => GridDensity::Overview,
        DisplayMode::Detail => GridDensity::Detail,
    }
}

fn background_color(mode: DisplayMode) -> egui::Color32 {
    match mode {
        DisplayMode::FarView => egui::Color32::from_rgb(3, 7, 18),
        DisplayMode::OverviewDensity => egui::Color32::from_rgb(8, 13, 26),
        DisplayMode::Detail => egui::Color32::from_rgb(248, 250, 252),
    }
}

fn overview_draw_order(kind: LayoutObjectKind) -> u8 {
    match kind {
        LayoutObjectKind::Die => 0,
        LayoutObjectKind::Core => 1,
        LayoutObjectKind::Row => 2,
        LayoutObjectKind::Instance => 3,
        LayoutObjectKind::RegularWire | LayoutObjectKind::SpecialWire => 4,
        LayoutObjectKind::Blockage | LayoutObjectKind::Fill | LayoutObjectKind::Region => 5,
        LayoutObjectKind::Via | LayoutObjectKind::IoPin => 6,
        LayoutObjectKind::Track | LayoutObjectKind::GCellGrid => 7,
    }
}

fn far_view_draw_order(kind: LayoutObjectKind) -> u8 {
    match kind {
        LayoutObjectKind::Die => 0,
        LayoutObjectKind::Core => 1,
        LayoutObjectKind::Row | LayoutObjectKind::Track | LayoutObjectKind::GCellGrid => 2,
        LayoutObjectKind::Instance => 3,
        LayoutObjectKind::RegularWire => 4,
        LayoutObjectKind::SpecialWire => 5,
        LayoutObjectKind::Blockage | LayoutObjectKind::Fill | LayoutObjectKind::Region => 6,
        LayoutObjectKind::Via => 7,
        LayoutObjectKind::IoPin => 8,
    }
}

fn nice_step(target: f32) -> f32 {
    let power = 10.0_f32.powf(target.log10().floor());
    let normalized = target / power;
    let multiplier = if normalized <= 1.0 {
        1.0
    } else if normalized <= 2.0 {
        2.0
    } else if normalized <= 5.0 {
        5.0
    } else {
        10.0
    };
    power * multiplier
}

fn grid_target_px(density: GridDensity) -> f32 {
    match density {
        GridDensity::FarView => 220.0,
        GridDensity::Overview => 160.0,
        GridDensity::Detail => 80.0,
    }
}

fn overlay_stroke(kind: LayoutObjectKind, mode: DisplayMode) -> egui::Stroke {
    match (kind, mode) {
        (LayoutObjectKind::GCellGrid, DisplayMode::FarView) => {
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(51, 65, 85, 45))
        }
        (LayoutObjectKind::Track, DisplayMode::FarView) => {
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(20, 184, 166, 34))
        }
        (LayoutObjectKind::GCellGrid, _) => {
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(51, 65, 85, 38))
        }
        (LayoutObjectKind::Track, _) => {
            egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(15, 118, 110, 60))
        }
        _ => egui::Stroke::new(1.0, egui::Color32::TRANSPARENT),
    }
}

fn scroll_zoom_factor(scroll_y: f32) -> f32 {
    if scroll_y == 0.0 {
        return 1.0;
    }
    let factor = (1.0_f32 + scroll_y.abs() / 240.0).clamp(1.05, 2.0);
    if scroll_y > 0.0 {
        factor
    } else {
        1.0 / factor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overlay(direction: OverlayDirection) -> GridOverlay {
        GridOverlay {
            id: 1,
            direction,
            start: 100,
            count: 10,
            step: 20,
            width: Some(0),
            layer_id: Some(1),
            layer_ids: Vec::new(),
        }
    }

    #[test]
    fn scroll_zoom_factor_zooms_in_for_positive_scroll_and_out_for_negative_scroll() {
        assert!(scroll_zoom_factor(120.0) > 1.0);
        assert!(scroll_zoom_factor(-120.0) < 1.0);
        assert_eq!(scroll_zoom_factor(0.0), 1.0);
    }

    #[test]
    fn nice_step_uses_one_two_five_decades() {
        assert_eq!(nice_step(1.1), 2.0);
        assert_eq!(nice_step(2.1), 5.0);
        assert_eq!(nice_step(5.1), 10.0);
        assert_eq!(nice_step(120.0), 200.0);
    }

    #[test]
    fn overview_grid_is_less_dense_than_detail_grid() {
        assert!(grid_target_px(GridDensity::Overview) > grid_target_px(GridDensity::Detail));
    }

    #[test]
    fn far_view_grid_is_less_dense_than_overview_grid() {
        assert!(grid_target_px(GridDensity::FarView) > grid_target_px(GridDensity::Overview));
    }

    #[test]
    fn display_mode_uses_far_overview_and_detail_thresholds() {
        assert_eq!(display_mode(199.0, 200.0), DisplayMode::Detail);
        assert_eq!(display_mode(201.0, 200.0), DisplayMode::OverviewDensity);
        assert_eq!(display_mode(601.0, 200.0), DisplayMode::FarView);
    }

    #[test]
    fn far_view_uses_dark_background() {
        let far = background_color(DisplayMode::FarView);
        let detail = background_color(DisplayMode::Detail);

        assert!(far.r() < detail.r());
        assert!(far.g() < detail.g());
        assert!(far.b() < detail.b());
    }

    #[test]
    fn overview_density_uses_dark_background() {
        let overview = background_color(DisplayMode::OverviewDensity);
        let detail = background_color(DisplayMode::Detail);

        assert!(overview.r() < detail.r());
        assert!(overview.g() < detail.g());
        assert!(overview.b() < detail.b());
    }

    #[test]
    fn visible_overlay_indices_use_viewport_axis_for_horizontal_lines() {
        let indices = visible_overlay_indices(
            &overlay(OverlayDirection::X),
            Rect::new(0, 135, 500, 166),
            2.0,
        );

        assert_eq!(indices, Some((1, 4)));
    }

    #[test]
    fn visible_overlay_indices_use_viewport_axis_for_vertical_lines() {
        let indices = visible_overlay_indices(
            &overlay(OverlayDirection::Y),
            Rect::new(135, 0, 166, 500),
            2.0,
        );

        assert_eq!(indices, Some((1, 4)));
    }

    #[test]
    fn visible_overlay_indices_skip_dense_or_out_of_range_overlays() {
        assert_eq!(
            visible_overlay_indices(
                &overlay(OverlayDirection::X),
                Rect::new(0, 135, 500, 166),
                10.0
            ),
            None
        );
        assert_eq!(
            visible_overlay_indices(
                &overlay(OverlayDirection::X),
                Rect::new(0, 500, 500, 600),
                2.0
            ),
            None
        );
    }
}
