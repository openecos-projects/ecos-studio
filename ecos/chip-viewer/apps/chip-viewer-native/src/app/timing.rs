use std::collections::{BTreeSet, VecDeque};
use std::path::{Path, PathBuf};

use chip_view_db::ChipViewDb;
use chipgeom_format::{OwnerType, Rect32, ShapeId};
use eframe::egui;

use crate::timing::{TimingAnalysis, TimingAnalysisType, TimingPath, TimingStage};

use super::{
    contextual_map_focus_bbox, ecos_border, ecos_text_primary, ecos_text_secondary, ecos_warning,
    info_panel_label, paint_shape_overlay, section_heading, world_to_screen_point, FocusTransition,
    LoadedViewer, PendingFocus,
};

const MAX_ROUTED_TIMING_SHAPES: usize = 20_000;
const MAX_ROUTED_TIMING_SHAPES_PER_NET: usize = 4_096;
const TIMING_ANCHOR_TOLERANCE_DBU: i32 = 2;
const MAX_START_END_PREVIEW_CHARS: usize = 64;
const TIMELINE_GRAPH_HEIGHT: f32 = 132.0;
const TIMELINE_Y_AXIS_WIDTH: f32 = 58.0;
const TIMELINE_STAGE_SPACING: f32 = 22.0;
const TIMELINE_HORIZONTAL_PADDING: f32 = 28.0;
const TIMELINE_VERTICAL_PADDING: f32 = 12.0;
const TIMELINE_AXIS_LABEL_HEIGHT: f32 = 24.0;
const SIMPLIFIED_TIMING_COLOR: egui::Color32 = egui::Color32::from_rgb(64, 205, 255);
const START_PIN_COLOR: egui::Color32 = egui::Color32::from_rgb(74, 222, 128);
const END_PIN_COLOR: egui::Color32 = egui::Color32::from_rgb(255, 92, 203);
const STAGE_PIN_COLOR: egui::Color32 = egui::Color32::from_rgb(255, 209, 102);
const SELECTED_PIN_COLOR: egui::Color32 = egui::Color32::WHITE;
const SELECTED_PIN_RING_COLOR: egui::Color32 = egui::Color32::from_rgb(255, 224, 102);
const MAX_DELAY_COLOR: egui::Color32 = egui::Color32::from_rgb(255, 224, 102);
const NEGATIVE_DELAY_COLOR: egui::Color32 = egui::Color32::from_rgb(255, 92, 203);
const HIGHLIGHTED_ROUTE_COLOR: egui::Color32 = egui::Color32::from_rgb(183, 148, 255);
const HIGHLIGHTED_CONNECTION_COLOR: egui::Color32 = egui::Color32::from_rgb(255, 176, 72);
const LAUNCH_CLOCK_COLOR: egui::Color32 = egui::Color32::from_rgb(56, 189, 248);
const CAPTURE_CLOCK_COLOR: egui::Color32 = egui::Color32::from_rgb(244, 114, 182);
const TIMING_NET_OWNER_TYPES: [OwnerType; 3] = [
    OwnerType::NetWireSegment,
    OwnerType::SpecialWireSegment,
    OwnerType::Via,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TimingViewFilter {
    All,
    Setup,
    Hold,
}

impl TimingViewFilter {
    fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Setup => "Setup",
            Self::Hold => "Hold",
        }
    }

    fn analysis_type(self) -> Option<TimingAnalysisType> {
        match self {
            Self::All => None,
            Self::Setup => Some(TimingAnalysisType::Setup),
            Self::Hold => Some(TimingAnalysisType::Hold),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TimingOverlayMode {
    Routed,
    Simplified,
    Both,
}

impl TimingOverlayMode {
    fn label(self) -> &'static str {
        match self {
            Self::Routed => "Routed",
            Self::Simplified => "Simplified",
            Self::Both => "Both",
        }
    }
}

#[derive(Clone, Debug, Default)]
struct TimingStageGeometry {
    anchor_bbox: Option<Rect32>,
    wire_shape_ids: Vec<ShapeId>,
    wire_bbox: Option<Rect32>,
}

#[derive(Clone, Debug, Default)]
struct TimingClockEndpointGeometry {
    anchor_bbox: Option<Rect32>,
    pin_label: Option<String>,
    source_bbox: Option<Rect32>,
    source_pin_label: Option<String>,
    virtual_clock: bool,
}

#[derive(Clone, Debug, Default)]
struct TimingClockPathGeometry {
    stages: Vec<TimingStageGeometry>,
    wire_shape_ids: Vec<ShapeId>,
    bbox: Option<Rect32>,
    missing_net_count: usize,
    untrimmed_net_count: usize,
}

#[derive(Clone, Debug, Default)]
struct TimingPathGeometry {
    stages: Vec<TimingStageGeometry>,
    wire_shape_ids: Vec<ShapeId>,
    launch_clock: TimingClockEndpointGeometry,
    capture_clock: TimingClockEndpointGeometry,
    launch_clock_path: TimingClockPathGeometry,
    capture_clock_path: TimingClockPathGeometry,
    bbox: Option<Rect32>,
    missing_anchor_count: usize,
    missing_net_count: usize,
    untrimmed_net_count: usize,
    net_count: usize,
    truncated_routed_shapes: bool,
}

#[derive(Clone, Copy, Debug)]
struct TimingRouteShape {
    shape_id: ShapeId,
    layer_id: u16,
    bbox: Rect32,
    is_via: bool,
}

pub(super) struct TimingPanelState {
    analysis: TimingAnalysis,
    corner: String,
    filter: TimingViewFilter,
    selected_path: Option<usize>,
    selected_stage: Option<usize>,
    overlay_mode: TimingOverlayMode,
    geometry: Option<TimingPathGeometry>,
}

impl TimingPanelState {
    pub(super) fn load(feature_dir: &Path, db: &ChipViewDb) -> Self {
        let analysis = TimingAnalysis::load(feature_dir);
        let corner = analysis
            .paths
            .first()
            .map(|path| path.corner.clone())
            .or_else(|| analysis.corners.first().map(|corner| corner.name.clone()))
            .unwrap_or_default();
        let mut state = Self {
            analysis,
            corner,
            filter: TimingViewFilter::All,
            selected_path: None,
            selected_stage: None,
            overlay_mode: TimingOverlayMode::Both,
            geometry: None,
        };
        state.ensure_selection(db);
        state
    }

    pub(super) fn has_violations(&self) -> bool {
        !self.analysis.paths.is_empty()
    }

    pub(super) fn has_selected_path(&self) -> bool {
        self.selected_path.is_some()
    }

    pub(super) fn selected_bbox(&self) -> Option<Rect32> {
        self.geometry.as_ref().and_then(|geometry| geometry.bbox)
    }

    pub(super) fn sidebar(&mut self, ui: &mut egui::Ui, db: &ChipViewDb) -> Option<Rect32> {
        ui.add_space(6.0);
        section_heading(ui, "STA TIMING VIOLATIONS");

        if self.analysis.corners.is_empty() {
            ui.add_space(6.0);
            ui.label(
                egui::RichText::new("No negative-slack timing paths")
                    .size(13.0)
                    .color(ecos_text_secondary()),
            );
            if let Some(error) = &self.analysis.load_error {
                ui.colored_label(ecos_warning(), error);
            }
            for error in self.analysis.load_errors.iter().take(4) {
                ui.label(
                    egui::RichText::new(error)
                        .small()
                        .color(ecos_text_secondary()),
                );
            }
            info_panel_label(ui, self.analysis.feature_dir.display().to_string());
            return None;
        }

        let mut next_corner = self.corner.clone();
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new("Corner")
                    .small()
                    .color(ecos_text_secondary()),
            );
            egui::ComboBox::from_id_salt("chip_viewer_timing_corner")
                .selected_text(if next_corner.is_empty() {
                    "Select corner"
                } else {
                    next_corner.as_str()
                })
                .width((ui.available_width() - 8.0).max(120.0))
                .show_ui(ui, |ui| {
                    for corner in &self.analysis.corners {
                        ui.selectable_value(
                            &mut next_corner,
                            corner.name.clone(),
                            format!(
                                "{}  ·  {} violations  ·  {:.4} ns",
                                corner.name, corner.violation_count, corner.worst_slack_ns
                            ),
                        );
                    }
                });
        });

        let mut next_filter = self.filter;
        ui.horizontal(|ui| {
            for filter in [
                TimingViewFilter::All,
                TimingViewFilter::Setup,
                TimingViewFilter::Hold,
            ] {
                if ui
                    .selectable_label(next_filter == filter, filter.label())
                    .clicked()
                {
                    next_filter = filter;
                }
            }
        });

        let mut requested_path = None;
        let selected_path = self.selected_path;
        let corner_summary = self
            .analysis
            .corners
            .iter()
            .find(|corner| corner.name == self.corner);
        if let Some(summary) = corner_summary {
            ui.horizontal_wrapped(|ui| {
                ui.label(
                    egui::RichText::new(format!(
                        "{} setup · {} hold · worst {:.4} ns",
                        summary.setup_count, summary.hold_count, summary.worst_slack_ns
                    ))
                    .small()
                    .color(ecos_text_secondary()),
                );
            });
        }

        let visible_paths = self.visible_path_indices();
        if visible_paths.is_empty() {
            ui.add_space(8.0);
            ui.label(
                egui::RichText::new("No violations for this corner/filter")
                    .size(13.0)
                    .color(ecos_text_secondary()),
            );
        } else {
            egui::ScrollArea::vertical()
                .id_salt("chip_viewer_timing_path_scroll")
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    for path_index in visible_paths {
                        if timing_path_card(
                            ui,
                            &self.analysis.paths[path_index],
                            selected_path == Some(path_index),
                        ) {
                            requested_path = Some(path_index);
                        }
                        ui.add_space(6.0);
                    }
                });
        }

        if let Some(error) = &self.analysis.load_error {
            ui.add_space(6.0);
            ui.colored_label(ecos_warning(), error);
        }

        if next_corner != self.corner {
            self.corner = next_corner;
            self.ensure_selection(db);
            return self.selected_bbox();
        }
        if next_filter != self.filter {
            self.filter = next_filter;
            self.ensure_selection(db);
            return self.selected_bbox();
        }
        if let Some(path_index) = requested_path {
            return self.select_path(path_index, db);
        }
        None
    }

    pub(super) fn timeline(&mut self, ui: &mut egui::Ui) -> Option<Rect32> {
        let path_index = self.selected_path?;
        let path = self.analysis.paths.get(path_index)?.clone();
        let geometry = self.geometry.as_ref()?;
        let path_color = timing_path_color(path.analysis_type);
        let mut overlay_mode = self.overlay_mode;
        let mut selected_stage = self.selected_stage;
        let mut fit_requested = false;
        let mut stage_focus = None;

        let max_delay_stage = path
            .stages
            .iter()
            .enumerate()
            .filter_map(|(index, stage)| stage.delay_ns.map(|delay| (index, delay.abs())))
            .max_by(|left, right| left.1.total_cmp(&right.1));

        ui.add_space(4.0);
        ui.horizontal(|ui| {
            section_heading(ui, "TIMING PATH");
            ui.label(
                egui::RichText::new(path.analysis_type.label().to_ascii_uppercase())
                    .small()
                    .strong()
                    .color(path_color),
            );
            ui.label(
                egui::RichText::new(format!("{:+.6} ns", path.slack_ns))
                    .small()
                    .strong()
                    .color(path_color),
            );
            ui.label(
                egui::RichText::new(format!("{} stages", path.stages.len()))
                    .small()
                    .color(ecos_text_secondary()),
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui
                    .add_enabled(self.selected_bbox().is_some(), egui::Button::new("Fit"))
                    .clicked()
                {
                    fit_requested = true;
                }
            });
        });
        ui.horizontal_wrapped(|ui| {
            ui.label(
                egui::RichText::new(format!(
                    "{} · {} → {}",
                    path.path_group,
                    abbreviate_timing_name(&path.start_point, 42),
                    abbreviate_timing_name(&path.end_point, 42)
                ))
                .small()
                .color(ecos_text_secondary()),
            )
            .on_hover_text(format!(
                "Start: {}\nEnd: {}",
                path.start_point, path.end_point
            ));
            if let Some((stage_index, delay_ns)) = max_delay_stage {
                ui.separator();
                ui.label(
                    egui::RichText::new(format!(
                        "max delay #{} {}",
                        stage_index + 1,
                        format_timing_delay(Some(delay_ns))
                    ))
                    .small()
                    .strong()
                    .color(MAX_DELAY_COLOR),
                );
            }
            if let Some(geometry) = &self.geometry {
                ui.separator();
                ui.label(
                    egui::RichText::new(format!(
                        "{} routed shapes · {} nets",
                        geometry.wire_shape_ids.len(),
                        geometry.net_count
                    ))
                    .small()
                    .color(ecos_text_secondary()),
                );
                if geometry.truncated_routed_shapes {
                    ui.colored_label(
                        ecos_warning(),
                        format!("limited to {MAX_ROUTED_TIMING_SHAPES} shapes"),
                    );
                }
                if geometry.missing_anchor_count > 0 {
                    ui.colored_label(
                        ecos_warning(),
                        format!("{} stages without geometry", geometry.missing_anchor_count),
                    );
                }
                if geometry.untrimmed_net_count > 0 {
                    ui.colored_label(
                        ecos_warning(),
                        format!(
                            "{} net routes could not be trimmed",
                            geometry.untrimmed_net_count
                        ),
                    );
                }
                let clock_untrimmed = geometry
                    .launch_clock_path
                    .untrimmed_net_count
                    .saturating_add(geometry.capture_clock_path.untrimmed_net_count);
                if clock_untrimmed > 0 {
                    ui.colored_label(
                        ecos_warning(),
                        format!("{clock_untrimmed} clock routes could not be trimmed"),
                    );
                }
            }
        });
        let launch_clock_path_missing = !path.launch_clock_virtual
            && path
                .launch_clock_path
                .as_ref()
                .is_none_or(|path| path.is_empty());
        let capture_clock_path_missing = !path.capture_clock_virtual
            && path
                .capture_clock_path
                .as_ref()
                .is_none_or(|path| path.is_empty());
        if launch_clock_path_missing || capture_clock_path_missing {
            ui.label(
                egui::RichText::new(
                    "Clock route metadata is absent; rerun STA with this ECC build to export clock paths.",
                )
                .small()
                .color(ecos_warning()),
            );
        }
        if let Some(geometry) = &self.geometry {
            timing_clock_labels(
                ui,
                &geometry.launch_clock,
                LAUNCH_CLOCK_COLOR,
                "Launch clock",
            );
            timing_clock_labels(
                ui,
                &geometry.capture_clock,
                CAPTURE_CLOCK_COLOR,
                "Capture clock",
            );
        }
        ui.horizontal_wrapped(|ui| {
            ui.label(
                egui::RichText::new("Overlay")
                    .small()
                    .color(ecos_text_secondary()),
            );
            for mode in [
                TimingOverlayMode::Routed,
                TimingOverlayMode::Simplified,
                TimingOverlayMode::Both,
            ] {
                if ui
                    .selectable_label(
                        overlay_mode == mode,
                        egui::RichText::new(mode.label()).color(match mode {
                            TimingOverlayMode::Routed => path_color,
                            TimingOverlayMode::Simplified => SIMPLIFIED_TIMING_COLOR,
                            TimingOverlayMode::Both => ecos_text_primary(),
                        }),
                    )
                    .clicked()
                {
                    overlay_mode = mode;
                }
            }
        });
        ui.horizontal_wrapped(|ui| {
            timing_color_legend(ui, path_color, "Routed");
            timing_color_legend(ui, SIMPLIFIED_TIMING_COLOR, "Simplified");
            timing_color_legend(ui, START_PIN_COLOR, "Start");
            timing_color_legend(ui, END_PIN_COLOR, "End");
            timing_color_legend(ui, STAGE_PIN_COLOR, "Stage");
            timing_color_legend(ui, MAX_DELAY_COLOR, "Max delay");
            timing_color_legend(ui, NEGATIVE_DELAY_COLOR, "Negative delay");
            timing_color_legend(ui, HIGHLIGHTED_ROUTE_COLOR, "Selected route");
            timing_color_legend(ui, HIGHLIGHTED_CONNECTION_COLOR, "Selected link");
            timing_color_legend(ui, LAUNCH_CLOCK_COLOR, "Launch clock route");
            timing_color_legend(ui, CAPTURE_CLOCK_COLOR, "Capture clock route");
        });

        let stage_count = path.stages.len();
        if stage_count > 0 {
            let delays = path
                .stages
                .iter()
                .map(|stage| stage.delay_ns)
                .collect::<Vec<_>>();
            let scale = TimelineDelayScale::new(&delays);
            let graph_height = ui
                .available_height()
                .clamp(96.0, TIMELINE_GRAPH_HEIGHT)
                .max(96.0);
            ui.add_space(3.0);
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                let (axis_rect, _) = ui.allocate_exact_size(
                    egui::vec2(TIMELINE_Y_AXIS_WIDTH, graph_height),
                    egui::Sense::hover(),
                );
                let axis_plot_top = axis_rect.top() + TIMELINE_VERTICAL_PADDING + 4.0;
                let axis_plot_bottom =
                    axis_rect.bottom() - TIMELINE_AXIS_LABEL_HEIGHT - TIMELINE_VERTICAL_PADDING;
                paint_timeline_axis(
                    ui.painter_at(axis_rect),
                    axis_rect,
                    &scale,
                    axis_plot_top,
                    axis_plot_bottom,
                );

                egui::ScrollArea::horizontal()
                    .id_salt("chip_viewer_timing_delay_timeline")
                    .auto_shrink([false, false])
                    .max_height(graph_height)
                    .show(ui, |ui| {
                        let minimum_width = ui.available_width().max(640.0);
                        let content_width = (stage_count.saturating_sub(1) as f32
                            * TIMELINE_STAGE_SPACING
                            + TIMELINE_HORIZONTAL_PADDING * 2.0)
                            .max(minimum_width);
                        let (rect, _) = ui.allocate_exact_size(
                            egui::vec2(content_width, graph_height),
                            egui::Sense::hover(),
                        );
                        let painter = ui.painter_at(rect);
                        painter.rect_filled(rect, 6.0, egui::Color32::from_rgb(24, 26, 30));

                        let plot_top = rect.top() + TIMELINE_VERTICAL_PADDING + 4.0;
                        let plot_bottom =
                            rect.bottom() - TIMELINE_AXIS_LABEL_HEIGHT - TIMELINE_VERTICAL_PADDING;
                        paint_timeline_grid(&painter, rect, &scale, plot_top, plot_bottom);
                        let node_pos = |stage_index: usize| {
                            egui::pos2(
                                rect.left()
                                    + TIMELINE_HORIZONTAL_PADDING
                                    + stage_index as f32 * TIMELINE_STAGE_SPACING,
                                scale.y(delays[stage_index], plot_top, plot_bottom),
                            )
                        };

                        let zero_y = scale.y(Some(0.0), plot_top, plot_bottom);
                        for (stage_index, stage) in path.stages.iter().enumerate() {
                            let point = node_pos(stage_index);
                            let selected = selected_stage == Some(stage_index);
                            let is_max =
                                max_delay_stage.is_some_and(|(index, _)| index == stage_index);
                            let bar_color =
                                timing_delay_segment_color(stage.delay_ns, is_max, path_color);
                            let bar_top = point.y.min(zero_y);
                            let bar_bottom = point.y.max(zero_y).max(bar_top + 1.5);
                            painter.rect_filled(
                                egui::Rect::from_min_max(
                                    egui::pos2(point.x - 3.5, bar_top),
                                    egui::pos2(point.x + 3.5, bar_bottom),
                                ),
                                1.5,
                                bar_color,
                            );
                            let marker_color = if selected {
                                SELECTED_PIN_COLOR
                            } else if stage_index == 0 {
                                START_PIN_COLOR
                            } else if stage_index + 1 == stage_count {
                                END_PIN_COLOR
                            } else {
                                STAGE_PIN_COLOR
                            };
                            let radius = if selected { 5.0 } else { 3.2 };
                            painter.circle_filled(
                                point,
                                radius + 1.5,
                                egui::Color32::from_black_alpha(230),
                            );
                            painter.circle_filled(point, radius, marker_color);
                            if selected {
                                painter.circle_stroke(
                                    point,
                                    radius + 2.5,
                                    egui::Stroke::new(2.0_f32, SELECTED_PIN_RING_COLOR),
                                );
                            }
                            let label_color = if selected {
                                egui::Color32::WHITE
                            } else {
                                ecos_text_secondary()
                            };
                            painter.text(
                                egui::pos2(point.x, rect.bottom() - 10.0),
                                egui::Align2::CENTER_CENTER,
                                format!("#{}", stage_index + 1),
                                egui::FontId::monospace(8.0),
                                label_color,
                            );
                            if selected || (is_max && selected_stage.is_none()) {
                                let label_y = if point.y - 13.0 > plot_top {
                                    point.y - 13.0
                                } else {
                                    point.y + 15.0
                                };
                                painter.text(
                                    egui::pos2(point.x, label_y),
                                    egui::Align2::CENTER_CENTER,
                                    format_timing_delay(stage.delay_ns),
                                    egui::FontId::monospace(9.0),
                                    if selected {
                                        HIGHLIGHTED_ROUTE_COLOR
                                    } else {
                                        MAX_DELAY_COLOR
                                    },
                                );
                            }
                            let node_rect = egui::Rect::from_min_max(
                                egui::pos2(point.x - 10.0, plot_top - 4.0),
                                egui::pos2(point.x + 10.0, rect.bottom() - 2.0),
                            );
                            let response = ui
                                .interact(
                                    node_rect,
                                    ui.id().with(("timing_delay_node", stage_index)),
                                    egui::Sense::click(),
                                )
                                .on_hover_text(timing_stage_tooltip(stage_index, stage, is_max));
                            if response.clicked() {
                                selected_stage = Some(stage_index);
                                stage_focus = timing_stage_focus_bbox(&path, geometry, stage_index);
                            }
                        }
                    });
            });
        }

        self.overlay_mode = overlay_mode;
        self.selected_stage = selected_stage;
        if let Some(bbox) = stage_focus {
            return Some(contextual_map_focus_bbox(bbox));
        }
        if fit_requested {
            return self.selected_bbox().map(contextual_map_focus_bbox);
        }
        None
    }

    pub(super) fn paint(
        &self,
        db: &ChipViewDb,
        painter: &egui::Painter,
        world: Rect32,
        viewport: Rect32,
        canvas: egui::Rect,
        zoom: f32,
        pan: egui::Vec2,
    ) -> usize {
        let Some(path_index) = self.selected_path else {
            return 0;
        };
        let Some(path) = self.analysis.paths.get(path_index) else {
            return 0;
        };
        let Some(geometry) = &self.geometry else {
            return 0;
        };
        let color = timing_path_color(path.analysis_type);
        let mut drawn = 0usize;

        if matches!(
            self.overlay_mode,
            TimingOverlayMode::Routed | TimingOverlayMode::Both
        ) {
            for shape_id in &geometry.wire_shape_ids {
                let Some(shape) = db.find_shape(*shape_id) else {
                    continue;
                };
                if !shape.bbox.intersects(viewport) {
                    continue;
                }
                let shape_geometry = db.shape_geometry(shape);
                let outer = egui::Stroke::new(
                    2.2_f32,
                    egui::Color32::from_rgba_unmultiplied(8, 12, 18, 210),
                );
                let inner = egui::Stroke::new(1.25_f32, color);
                if paint_shape_overlay(painter, shape_geometry, world, canvas, zoom, pan, outer) {
                    drawn += 1;
                }
                paint_shape_overlay(painter, shape_geometry, world, canvas, zoom, pan, inner);
            }
            for (clock_path, clock_color) in [
                (&geometry.launch_clock_path, LAUNCH_CLOCK_COLOR),
                (&geometry.capture_clock_path, CAPTURE_CLOCK_COLOR),
            ] {
                for shape_id in &clock_path.wire_shape_ids {
                    let Some(shape) = db.find_shape(*shape_id) else {
                        continue;
                    };
                    if !shape.bbox.intersects(viewport) {
                        continue;
                    }
                    let shape_geometry = db.shape_geometry(shape);
                    let outer = egui::Stroke::new(
                        2.6_f32,
                        egui::Color32::from_rgba_unmultiplied(8, 12, 18, 220),
                    );
                    let inner = egui::Stroke::new(1.5_f32, clock_color);
                    if paint_shape_overlay(painter, shape_geometry, world, canvas, zoom, pan, outer)
                    {
                        drawn += 1;
                    }
                    paint_shape_overlay(painter, shape_geometry, world, canvas, zoom, pan, inner);
                }
            }
        }

        if matches!(
            self.overlay_mode,
            TimingOverlayMode::Simplified | TimingOverlayMode::Both
        ) {
            let centers = geometry
                .stages
                .iter()
                .filter_map(|stage| stage.anchor_bbox)
                .map(|bbox| {
                    world_to_screen_point(
                        chipgeom_format::Point32 {
                            x: bbox.lx.saturating_add(bbox.hx) / 2,
                            y: bbox.ly.saturating_add(bbox.hy) / 2,
                        },
                        world,
                        canvas,
                        zoom,
                        pan,
                    )
                })
                .collect::<Vec<_>>();
            for pair in centers.windows(2) {
                painter.line_segment(
                    [pair[0], pair[1]],
                    egui::Stroke::new(2.4_f32, egui::Color32::from_black_alpha(190)),
                );
                painter.line_segment(
                    [pair[0], pair[1]],
                    egui::Stroke::new(1.4_f32, SIMPLIFIED_TIMING_COLOR),
                );
                drawn += 1;
            }
        }

        if let Some(stage_index) = self.selected_stage.filter(|index| *index > 0) {
            let previous_index = stage_index - 1;
            let previous_anchor = geometry
                .stages
                .get(previous_index)
                .and_then(|stage| stage.anchor_bbox);
            let current_anchor = geometry
                .stages
                .get(stage_index)
                .and_then(|stage| stage.anchor_bbox);

            if let Some(route_geometry) =
                timing_selected_route_stage_index(&path.stages, stage_index)
                    .and_then(|route_index| geometry.stages.get(route_index))
            {
                for shape_id in &route_geometry.wire_shape_ids {
                    let Some(shape) = db.find_shape(*shape_id) else {
                        continue;
                    };
                    if !shape.bbox.intersects(viewport) {
                        continue;
                    }
                    let shape_geometry = db.shape_geometry(shape);
                    paint_shape_overlay(
                        painter,
                        shape_geometry,
                        world,
                        canvas,
                        zoom,
                        pan,
                        egui::Stroke::new(5.0_f32, egui::Color32::from_black_alpha(230)),
                    );
                    if paint_shape_overlay(
                        painter,
                        shape_geometry,
                        world,
                        canvas,
                        zoom,
                        pan,
                        egui::Stroke::new(2.6_f32, HIGHLIGHTED_ROUTE_COLOR),
                    ) {
                        drawn += 1;
                    }
                }
            }

            if let (Some(previous_anchor), Some(current_anchor)) = (previous_anchor, current_anchor)
            {
                let start = world_to_screen_point(
                    chipgeom_format::Point32 {
                        x: previous_anchor.lx.saturating_add(previous_anchor.hx) / 2,
                        y: previous_anchor.ly.saturating_add(previous_anchor.hy) / 2,
                    },
                    world,
                    canvas,
                    zoom,
                    pan,
                );
                let end = world_to_screen_point(
                    chipgeom_format::Point32 {
                        x: current_anchor.lx.saturating_add(current_anchor.hx) / 2,
                        y: current_anchor.ly.saturating_add(current_anchor.hy) / 2,
                    },
                    world,
                    canvas,
                    zoom,
                    pan,
                );
                painter.line_segment(
                    [start, end],
                    egui::Stroke::new(5.0_f32, egui::Color32::from_black_alpha(230)),
                );
                painter.line_segment(
                    [start, end],
                    egui::Stroke::new(2.8_f32, HIGHLIGHTED_CONNECTION_COLOR),
                );
                drawn += 1;
            }
        }

        let stage_count = path.stages.len();
        for (stage_index, stage_geometry) in geometry.stages.iter().enumerate() {
            let Some(bbox) = stage_geometry.anchor_bbox else {
                continue;
            };
            let center = world_to_screen_point(
                chipgeom_format::Point32 {
                    x: bbox.lx.saturating_add(bbox.hx) / 2,
                    y: bbox.ly.saturating_add(bbox.hy) / 2,
                },
                world,
                canvas,
                zoom,
                pan,
            );
            if !canvas.expand(12.0).contains(center) {
                continue;
            }
            let selected = self.selected_stage == Some(stage_index);
            let marker_color = if selected {
                SELECTED_PIN_COLOR
            } else if stage_index == 0 {
                START_PIN_COLOR
            } else if stage_index + 1 == stage_count {
                END_PIN_COLOR
            } else {
                STAGE_PIN_COLOR
            };
            let radius = if selected { 6.4 } else { 4.2 };
            painter.circle_filled(center, radius + 2.0, egui::Color32::from_black_alpha(230));
            painter.circle_filled(center, radius, marker_color);
            if selected {
                painter.circle_stroke(
                    center,
                    radius + 3.2,
                    egui::Stroke::new(2.2_f32, SELECTED_PIN_RING_COLOR),
                );
            }
            drawn += 1;
        }
        for (endpoint, color, is_launch, label) in [
            (&geometry.launch_clock, LAUNCH_CLOCK_COLOR, true, "LCK"),
            (&geometry.capture_clock, CAPTURE_CLOCK_COLOR, false, "CCK"),
        ] {
            for (bbox, suffix) in [
                (endpoint.source_bbox, " src"),
                (endpoint.anchor_bbox, " sink"),
            ] {
                let Some(bbox) = bbox else {
                    continue;
                };
                let center = world_to_screen_point(
                    chipgeom_format::Point32 {
                        x: bbox.lx.saturating_add(bbox.hx) / 2,
                        y: bbox.ly.saturating_add(bbox.hy) / 2,
                    },
                    world,
                    canvas,
                    zoom,
                    pan,
                );
                if !canvas.expand(18.0).contains(center) {
                    continue;
                }
                paint_timing_clock_endpoint_marker(
                    painter,
                    center,
                    color,
                    is_launch,
                    &format!("{label}{suffix}"),
                );
                drawn += 1;
            }
        }
        drawn
    }

    fn ensure_selection(&mut self, db: &ChipViewDb) {
        let visible = self.visible_path_indices();
        if self
            .selected_path
            .is_some_and(|index| visible.contains(&index))
        {
            return;
        }
        self.selected_path = None;
        self.selected_stage = None;
        self.geometry = None;
        if let Some(path_index) = visible.first().copied() {
            self.select_path(path_index, db);
        }
    }

    fn select_path(&mut self, path_index: usize, db: &ChipViewDb) -> Option<Rect32> {
        let path = self.analysis.paths.get(path_index)?;
        self.selected_path = Some(path_index);
        self.selected_stage = None;
        self.geometry = Some(resolve_timing_path_geometry(db, path));
        self.selected_bbox()
    }

    fn visible_path_indices(&self) -> Vec<usize> {
        self.analysis
            .paths_for(&self.corner, self.filter.analysis_type())
    }
}

impl LoadedViewer {
    pub(super) fn attach_timing_feature_dir(&mut self, feature_dir: Option<PathBuf>) {
        let Some(feature_dir) = feature_dir else {
            return;
        };
        let timing = TimingPanelState::load(&feature_dir, &self.db);
        let focus = timing.selected_bbox();
        let has_violations = timing.has_violations();
        self.timing = Some(timing);
        if has_violations {
            self.analysis_tab = super::AnalysisTab::Timing;
            if let Some(bbox) = focus {
                self.pending_focus = Some(PendingFocus {
                    bbox: contextual_map_focus_bbox(bbox),
                    select_shape_id: None,
                    transition: FocusTransition::Immediate,
                });
            }
        }
    }

    pub(super) fn timing_sidebar(&mut self, ui: &mut egui::Ui) {
        let action = self
            .timing
            .as_mut()
            .and_then(|timing| timing.sidebar(ui, &self.db));
        if let Some(bbox) = action {
            self.pending_focus = Some(PendingFocus {
                bbox: contextual_map_focus_bbox(bbox),
                select_shape_id: None,
                transition: FocusTransition::Animated,
            });
        }
    }

    pub(super) fn has_selected_timing_path(&self) -> bool {
        self.timing
            .as_ref()
            .is_some_and(TimingPanelState::has_selected_path)
    }

    pub(super) fn timing_timeline(&mut self, ui: &mut egui::Ui) {
        let action = self.timing.as_mut().and_then(|timing| timing.timeline(ui));
        if let Some(bbox) = action {
            self.pending_focus = Some(PendingFocus {
                bbox,
                select_shape_id: None,
                transition: FocusTransition::Animated,
            });
        }
    }
}

fn resolve_timing_path_geometry(db: &ChipViewDb, path: &TimingPath) -> TimingPathGeometry {
    let requests = path
        .stages
        .iter()
        .map(|stage| (stage.instance.as_str(), stage.local_pin_name()))
        .collect::<Vec<_>>();
    let endpoints = db.resolve_endpoint_pins(&requests);
    let mut geometry = TimingPathGeometry {
        stages: vec![TimingStageGeometry::default(); path.stages.len()],
        ..TimingPathGeometry::default()
    };
    let mut net_names = BTreeSet::<String>::new();
    let mut net_shapes = std::collections::BTreeMap::<String, Vec<ShapeId>>::new();
    let mut stage_net_names = Vec::with_capacity(path.stages.len());

    for (stage_index, stage) in path.stages.iter().enumerate() {
        let endpoint = endpoints.get(stage_index).copied().unwrap_or_default();
        let mut anchor_bbox = endpoint.pin_bbox.or(endpoint.instance_bbox);
        let net_name = timing_stage_net_name(db, stage);
        if let Some(net_name) = &net_name {
            net_names.insert(net_name.clone());
            let shape_ids = net_shapes.entry(net_name.clone()).or_insert_with(|| {
                db.query_owner_name_for_owner_types(net_name, &TIMING_NET_OWNER_TYPES)
                    .into_iter()
                    .take(MAX_ROUTED_TIMING_SHAPES_PER_NET)
                    .collect()
            });
            if anchor_bbox.is_none() {
                anchor_bbox = shape_ids
                    .first()
                    .and_then(|shape_id| db.find_shape(*shape_id))
                    .map(|shape| shape.bbox);
            }
        }
        if net_name.is_none() && timing_stage_has_routed_incoming_connection(stage) {
            geometry.missing_net_count += 1;
        }
        if let Some(bbox) = anchor_bbox {
            expand_bbox(&mut geometry.bbox, bbox);
        } else {
            geometry.missing_anchor_count += 1;
        }
        geometry.stages[stage_index] = TimingStageGeometry {
            anchor_bbox,
            ..TimingStageGeometry::default()
        };
        stage_net_names.push(net_name);
    }

    let mut routed_shapes = BTreeSet::<ShapeId>::new();
    for (stage_index, stage) in path.stages.iter().enumerate() {
        if stage_index == 0 || !timing_stage_has_routed_incoming_connection(stage) {
            continue;
        }
        let Some(net_name) = stage_net_names[stage_index].as_deref() else {
            continue;
        };
        let Some(candidates) = net_shapes.get(net_name) else {
            continue;
        };
        let source_bbox = geometry.stages[stage_index - 1].anchor_bbox;
        let sink_bbox = geometry.stages[stage_index].anchor_bbox;
        let trimmed = source_bbox
            .zip(sink_bbox)
            .and_then(|(source, sink)| trim_net_route_shapes(db, candidates, source, sink));
        let stage_shape_ids = match trimmed {
            Some(shape_ids) => shape_ids,
            None => {
                geometry.untrimmed_net_count += 1;
                candidates.clone()
            }
        };

        let mut stage_wire_shape_ids = Vec::new();
        let mut stage_wire_bbox = None;
        for shape_id in stage_shape_ids {
            if routed_shapes.len() >= MAX_ROUTED_TIMING_SHAPES {
                geometry.truncated_routed_shapes = true;
                break;
            }
            if routed_shapes.insert(shape_id) {
                geometry.wire_shape_ids.push(shape_id);
            }
            stage_wire_shape_ids.push(shape_id);
            if let Some(shape) = db.find_shape(shape_id) {
                expand_bbox(&mut geometry.bbox, shape.bbox);
                expand_bbox(&mut stage_wire_bbox, shape.bbox);
            }
        }
        geometry.stages[stage_index].wire_shape_ids = stage_wire_shape_ids;
        geometry.stages[stage_index].wire_bbox = stage_wire_bbox;
    }

    let (launch_clock, launch_clock_path) = resolve_timing_clock_geometry(
        db,
        &path.start_point,
        &path.launch_clock,
        geometry.stages.first().and_then(|stage| stage.anchor_bbox),
        path.launch_clock_path.as_deref(),
        path.launch_clock_source_pin.as_deref(),
        path.launch_clock_endpoint_pin.as_deref(),
        path.launch_clock_virtual,
    );
    let (capture_clock, capture_clock_path) = resolve_timing_clock_geometry(
        db,
        &path.end_point,
        &path.capture_clock,
        geometry.stages.last().and_then(|stage| stage.anchor_bbox),
        path.capture_clock_path.as_deref(),
        path.capture_clock_source_pin.as_deref(),
        path.capture_clock_endpoint_pin.as_deref(),
        path.capture_clock_virtual,
    );
    geometry.launch_clock_path = launch_clock_path;
    geometry.capture_clock_path = capture_clock_path;
    geometry.launch_clock = launch_clock;
    geometry.capture_clock = capture_clock;
    for endpoint in [&geometry.launch_clock, &geometry.capture_clock] {
        for bbox in [endpoint.source_bbox, endpoint.anchor_bbox]
            .into_iter()
            .flatten()
        {
            expand_bbox(&mut geometry.bbox, bbox);
        }
    }
    for clock_path in [&geometry.launch_clock_path, &geometry.capture_clock_path] {
        if let Some(bbox) = clock_path.bbox {
            expand_bbox(&mut geometry.bbox, bbox);
        }
    }
    geometry.net_count = net_names.len();
    geometry
}

fn resolve_timing_clock_geometry(
    db: &ChipViewDb,
    path_point: &str,
    clock_name: &str,
    fallback_bbox: Option<Rect32>,
    exported_path: Option<&[TimingStage]>,
    source_pin: Option<&str>,
    endpoint_pin: Option<&str>,
    virtual_clock: bool,
) -> (TimingClockEndpointGeometry, TimingClockPathGeometry) {
    match exported_path {
        Some([]) if virtual_clock => return virtual_timing_clock_geometry(clock_name),
        Some([]) => {
            return (
                TimingClockEndpointGeometry::default(),
                TimingClockPathGeometry::default(),
            );
        }
        None if virtual_clock => return virtual_timing_clock_geometry(clock_name),
        _ => {}
    }
    if let Some(clock_path) = exported_path {
        let geometry = resolve_timing_clock_path_geometry(db, clock_path);
        let source_pin = source_pin
            .map(str::to_owned)
            .or_else(|| clock_path.first().map(|stage| stage.pin.clone()));
        let endpoint_pin = endpoint_pin
            .map(str::to_owned)
            .or_else(|| clock_path.last().map(|stage| stage.pin.clone()));
        let source_bbox = source_pin
            .as_deref()
            .and_then(|pin| resolve_timing_pin_bbox(db, pin))
            .or_else(|| geometry.stages.first().and_then(|stage| stage.anchor_bbox));
        let anchor_bbox = endpoint_pin
            .as_deref()
            .and_then(|pin| resolve_timing_pin_bbox(db, pin))
            .or_else(|| geometry.stages.last().and_then(|stage| stage.anchor_bbox))
            .or(fallback_bbox);
        let endpoint = TimingClockEndpointGeometry {
            anchor_bbox,
            pin_label: endpoint_pin.or_else(|| {
                (virtual_clock && !clock_name.trim().is_empty()).then(|| clock_name.to_string())
            }),
            source_bbox,
            source_pin_label: source_pin,
            virtual_clock,
        };
        return (endpoint, geometry);
    }

    let endpoint = resolve_legacy_timing_clock_endpoint(db, path_point, clock_name, fallback_bbox);
    (endpoint, TimingClockPathGeometry::default())
}

fn virtual_timing_clock_geometry(
    clock_name: &str,
) -> (TimingClockEndpointGeometry, TimingClockPathGeometry) {
    let endpoint = TimingClockEndpointGeometry {
        pin_label: (!clock_name.trim().is_empty()).then(|| clock_name.to_string()),
        virtual_clock: true,
        ..TimingClockEndpointGeometry::default()
    };
    (endpoint, TimingClockPathGeometry::default())
}

fn resolve_timing_clock_path_geometry(
    db: &ChipViewDb,
    stages: &[TimingStage],
) -> TimingClockPathGeometry {
    let requests = stages
        .iter()
        .map(|stage| (stage.instance.as_str(), stage.local_pin_name()))
        .collect::<Vec<_>>();
    let endpoints = db.resolve_endpoint_pins(&requests);
    let mut geometry = TimingClockPathGeometry {
        stages: vec![TimingStageGeometry::default(); stages.len()],
        ..TimingClockPathGeometry::default()
    };
    let mut net_shapes = std::collections::BTreeMap::<String, Vec<ShapeId>>::new();
    let mut stage_net_names = Vec::with_capacity(stages.len());
    for (stage_index, stage) in stages.iter().enumerate() {
        let endpoint = endpoints.get(stage_index).copied().unwrap_or_default();
        let mut anchor_bbox = endpoint.pin_bbox.or(endpoint.instance_bbox);
        let net_name = timing_stage_net_name(db, stage);
        if let Some(net_name) = &net_name {
            let shape_ids = net_shapes.entry(net_name.clone()).or_insert_with(|| {
                db.query_owner_name_for_owner_types(net_name, &TIMING_NET_OWNER_TYPES)
                    .into_iter()
                    .take(MAX_ROUTED_TIMING_SHAPES_PER_NET)
                    .collect()
            });
            if anchor_bbox.is_none() {
                anchor_bbox = shape_ids
                    .first()
                    .and_then(|shape_id| db.find_shape(*shape_id))
                    .map(|shape| shape.bbox);
            }
        } else if stage_index > 0 {
            geometry.missing_net_count += 1;
        }
        if let Some(bbox) = anchor_bbox {
            expand_bbox(&mut geometry.bbox, bbox);
        }
        geometry.stages[stage_index].anchor_bbox = anchor_bbox;
        stage_net_names.push(net_name);
    }

    let mut routed_shapes = BTreeSet::<ShapeId>::new();
    for stage_index in 1..stages.len() {
        let Some(previous_net) = stage_net_names[stage_index - 1].as_deref() else {
            continue;
        };
        let Some(current_net) = stage_net_names[stage_index].as_deref() else {
            continue;
        };
        if previous_net != current_net {
            continue;
        }
        let Some(candidates) = net_shapes.get(current_net) else {
            continue;
        };
        let source_bbox = geometry.stages[stage_index - 1].anchor_bbox;
        let sink_bbox = geometry.stages[stage_index].anchor_bbox;
        let trimmed = source_bbox
            .zip(sink_bbox)
            .and_then(|(source, sink)| trim_net_route_shapes(db, candidates, source, sink));
        let stage_shape_ids = match trimmed {
            Some(shape_ids) => shape_ids,
            None => {
                geometry.untrimmed_net_count += 1;
                candidates.clone()
            }
        };
        let mut stage_wire_shape_ids = Vec::new();
        let mut stage_wire_bbox = None;
        for shape_id in stage_shape_ids {
            if routed_shapes.len() >= MAX_ROUTED_TIMING_SHAPES {
                break;
            }
            if routed_shapes.insert(shape_id) {
                geometry.wire_shape_ids.push(shape_id);
            }
            stage_wire_shape_ids.push(shape_id);
            if let Some(shape) = db.find_shape(shape_id) {
                expand_bbox(&mut geometry.bbox, shape.bbox);
                expand_bbox(&mut stage_wire_bbox, shape.bbox);
            }
        }
        geometry.stages[stage_index].wire_shape_ids = stage_wire_shape_ids;
        geometry.stages[stage_index].wire_bbox = stage_wire_bbox;
    }
    geometry
}

fn resolve_timing_pin_bbox(db: &ChipViewDb, pin_name: &str) -> Option<Rect32> {
    let (instance_name, local_pin) = pin_name
        .rsplit_once(':')
        .map_or(("", pin_name), |(instance, pin)| (instance, pin));
    db.resolve_endpoint_pins(&[(instance_name, local_pin)])
        .first()
        .and_then(|endpoint| endpoint.pin_bbox.or(endpoint.instance_bbox))
}

fn resolve_legacy_timing_clock_endpoint(
    db: &ChipViewDb,
    path_point: &str,
    clock_name: &str,
    fallback_bbox: Option<Rect32>,
) -> TimingClockEndpointGeometry {
    if clock_name.trim().is_empty() {
        return TimingClockEndpointGeometry::default();
    }
    let Some((instance_name, data_pin_name)) = path_point.rsplit_once(':') else {
        return TimingClockEndpointGeometry::default();
    };
    if instance_name.trim().is_empty() {
        return TimingClockEndpointGeometry::default();
    }

    let best_clock_pin = db
        .connectivity_for_instance(instance_name)
        .into_iter()
        .filter_map(|endpoint| {
            let score = timing_clock_pin_score(
                &endpoint.pin_name,
                &endpoint.net_name,
                clock_name,
                data_pin_name,
            );
            (score > 0).then_some((score, endpoint.pin_name.clone()))
        })
        .max_by(|left, right| left.0.cmp(&right.0).then_with(|| right.1.cmp(&left.1)));

    let Some((_, pin_name)) = best_clock_pin else {
        return TimingClockEndpointGeometry {
            anchor_bbox: fallback_bbox,
            pin_label: Some(path_point.to_string()),
            ..TimingClockEndpointGeometry::default()
        };
    };
    let anchor_bbox = db
        .resolve_endpoint_pins(&[(instance_name, pin_name.as_str())])
        .first()
        .and_then(|endpoint| endpoint.pin_bbox.or(endpoint.instance_bbox))
        .or(fallback_bbox);
    TimingClockEndpointGeometry {
        anchor_bbox,
        pin_label: Some(format!("{instance_name}/{pin_name}")),
        ..TimingClockEndpointGeometry::default()
    }
}

fn timing_clock_pin_score(
    pin_name: &str,
    net_name: &str,
    clock_name: &str,
    data_pin_name: &str,
) -> i32 {
    let local_pin = pin_name.rsplit_once('/').map_or(pin_name, |(_, pin)| pin);
    if local_pin.eq_ignore_ascii_case(data_pin_name) {
        return 0;
    }
    let pin_upper = local_pin.to_ascii_uppercase();
    let net_lower = net_name.to_ascii_lowercase();
    let clock_lower = clock_name.to_ascii_lowercase();
    let mut score = 0;
    if matches!(
        pin_upper.as_str(),
        "CK" | "CKB" | "CLK" | "CLKB" | "CLKN" | "CLKP" | "CP" | "GCLK" | "GCK"
    ) {
        score += 100;
    } else if pin_upper.contains("CLK") || pin_upper.ends_with("CK") {
        score += 80;
    }
    if net_lower.contains("clk") || net_lower.contains("clock") {
        score += 60;
    }
    if !clock_lower.is_empty()
        && (net_lower.contains(&clock_lower)
            || clock_lower
                .split(['_', '/', ':'])
                .filter(|token| token.len() >= 3)
                .any(|token| net_lower.contains(token)))
    {
        score += 40;
    }
    score
}

fn trim_net_route_shapes(
    db: &ChipViewDb,
    shape_ids: &[ShapeId],
    source_bbox: Rect32,
    sink_bbox: Rect32,
) -> Option<Vec<ShapeId>> {
    let nodes = shape_ids
        .iter()
        .filter_map(|shape_id| {
            let shape = db.find_shape(*shape_id)?;
            let owner = db.owner_for_shape(shape)?;
            let is_via = OwnerType::from_raw(owner.owner_type) == Some(OwnerType::Via);
            Some(TimingRouteShape {
                shape_id: *shape_id,
                layer_id: shape.layer_id,
                bbox: shape.bbox,
                is_via,
            })
        })
        .collect::<Vec<_>>();
    if nodes.len() < 2 {
        return None;
    }
    let starts = timing_route_seed_indices(&nodes, source_bbox);
    let sinks = timing_route_seed_indices(&nodes, sink_bbox);
    if starts.is_empty() || sinks.is_empty() {
        return None;
    }
    shortest_timing_route_shape_ids(&nodes, &starts, &sinks)
}

fn timing_route_seed_indices(nodes: &[TimingRouteShape], anchor: Rect32) -> Vec<usize> {
    let anchor = Rect32 {
        lx: anchor.lx.saturating_sub(TIMING_ANCHOR_TOLERANCE_DBU),
        ly: anchor.ly.saturating_sub(TIMING_ANCHOR_TOLERANCE_DBU),
        hx: anchor.hx.saturating_add(TIMING_ANCHOR_TOLERANCE_DBU),
        hy: anchor.hy.saturating_add(TIMING_ANCHOR_TOLERANCE_DBU),
    };
    nodes
        .iter()
        .enumerate()
        .filter_map(|(index, node)| node.bbox.intersects(anchor).then_some(index))
        .collect()
}

fn shortest_timing_route_shape_ids(
    nodes: &[TimingRouteShape],
    starts: &[usize],
    sinks: &[usize],
) -> Option<Vec<ShapeId>> {
    let sinks = sinks.iter().copied().collect::<BTreeSet<_>>();
    let mut visited = vec![false; nodes.len()];
    let mut previous = vec![None; nodes.len()];
    let mut queue = VecDeque::new();
    for start in starts {
        if !visited[*start] {
            visited[*start] = true;
            queue.push_back(*start);
        }
    }

    while let Some(current) = queue.pop_front() {
        if sinks.contains(&current) {
            let mut route = Vec::new();
            let mut cursor = Some(current);
            while let Some(index) = cursor {
                route.push(nodes[index].shape_id);
                cursor = previous[index];
            }
            route.reverse();
            return Some(route);
        }
        for (next, node) in nodes.iter().enumerate() {
            if visited[next] || !timing_route_shapes_connect(&nodes[current], node) {
                continue;
            }
            visited[next] = true;
            previous[next] = Some(current);
            queue.push_back(next);
        }
    }
    None
}

fn timing_route_shapes_connect(left: &TimingRouteShape, right: &TimingRouteShape) -> bool {
    if !left.bbox.intersects(right.bbox) {
        return false;
    }
    left.is_via || right.is_via || left.layer_id == right.layer_id
}

fn timing_stage_net_name(db: &ChipViewDb, stage: &TimingStage) -> Option<String> {
    let local_pin = stage.local_pin_name();
    let endpoints = if stage.instance.trim().is_empty() {
        db.connectivity_for_pin(local_pin)
    } else {
        db.connectivity_for_instance(&stage.instance)
    };
    endpoints
        .into_iter()
        .find(|endpoint| timing_pin_matches(local_pin, &endpoint.pin_name))
        .map(|endpoint| endpoint.net_name.clone())
        .filter(|net_name| !net_name.trim().is_empty())
}

fn timing_stage_has_routed_incoming_connection(stage: &TimingStage) -> bool {
    stage.kind.eq_ignore_ascii_case("net_arc")
}

fn timing_selected_route_stage_index(stages: &[TimingStage], stage_index: usize) -> Option<usize> {
    if stages
        .get(stage_index)
        .is_some_and(timing_stage_has_routed_incoming_connection)
    {
        return Some(stage_index);
    }
    let previous_index = stage_index.checked_sub(1)?;
    stages
        .get(previous_index)
        .is_some_and(timing_stage_has_routed_incoming_connection)
        .then_some(previous_index)
}

fn timing_stage_focus_bbox(
    path: &TimingPath,
    geometry: &TimingPathGeometry,
    stage_index: usize,
) -> Option<Rect32> {
    let current = geometry.stages.get(stage_index)?.anchor_bbox?;
    let mut bbox = current;
    if stage_index == 0 {
        return Some(bbox);
    }
    if let Some(previous) = geometry
        .stages
        .get(stage_index - 1)
        .and_then(|stage| stage.anchor_bbox)
    {
        bbox.lx = bbox.lx.min(previous.lx);
        bbox.ly = bbox.ly.min(previous.ly);
        bbox.hx = bbox.hx.max(previous.hx);
        bbox.hy = bbox.hy.max(previous.hy);
    }
    if let Some(shape_bbox) = timing_selected_route_stage_index(&path.stages, stage_index)
        .and_then(|route_index| geometry.stages.get(route_index))
        .and_then(|stage_geometry| stage_geometry.wire_bbox)
    {
        bbox.lx = bbox.lx.min(shape_bbox.lx);
        bbox.ly = bbox.ly.min(shape_bbox.ly);
        bbox.hx = bbox.hx.max(shape_bbox.hx);
        bbox.hy = bbox.hy.max(shape_bbox.hy);
    }
    Some(bbox)
}

fn timing_pin_matches(requested: &str, endpoint: &str) -> bool {
    let requested = requested.trim();
    let endpoint = endpoint.trim();
    requested.eq_ignore_ascii_case(endpoint)
        || requested
            .rsplit_once('/')
            .is_some_and(|(_, local)| local.eq_ignore_ascii_case(endpoint))
}

fn expand_bbox(bbox: &mut Option<Rect32>, value: Rect32) {
    *bbox = Some(match *bbox {
        Some(current) => Rect32 {
            lx: current.lx.min(value.lx),
            ly: current.ly.min(value.ly),
            hx: current.hx.max(value.hx),
            hy: current.hy.max(value.hy),
        },
        None => value,
    });
}

fn timing_path_color(analysis_type: TimingAnalysisType) -> egui::Color32 {
    match analysis_type {
        TimingAnalysisType::Setup => egui::Color32::from_rgb(255, 92, 110),
        TimingAnalysisType::Hold => egui::Color32::from_rgb(255, 190, 64),
    }
}

fn paint_timing_clock_endpoint_marker(
    painter: &egui::Painter,
    center: egui::Pos2,
    color: egui::Color32,
    is_launch: bool,
    label: &str,
) {
    let radius = 9.0;
    painter.circle_filled(
        center,
        radius + 6.0,
        egui::Color32::from_rgba_unmultiplied(5, 8, 12, 225),
    );
    painter.circle_stroke(center, radius + 5.0, egui::Stroke::new(1.6_f32, color));
    let points = if is_launch {
        vec![
            egui::pos2(center.x, center.y - radius),
            egui::pos2(center.x + radius, center.y + radius * 0.8),
            egui::pos2(center.x - radius, center.y + radius * 0.8),
        ]
    } else {
        vec![
            egui::pos2(center.x - radius, center.y - radius * 0.8),
            egui::pos2(center.x + radius, center.y - radius * 0.8),
            egui::pos2(center.x, center.y + radius),
        ]
    };
    painter.add(egui::Shape::convex_polygon(
        points,
        color,
        egui::Stroke::new(1.4_f32, egui::Color32::WHITE),
    ));
    painter.text(
        center,
        egui::Align2::CENTER_CENTER,
        if is_launch { "L" } else { "C" },
        egui::FontId::monospace(9.0),
        egui::Color32::from_rgb(8, 12, 18),
    );
    painter.text(
        center + egui::vec2(13.0, -11.0),
        egui::Align2::LEFT_CENTER,
        label,
        egui::FontId::monospace(9.0),
        color,
    );
}

fn timing_path_card(ui: &mut egui::Ui, path: &TimingPath, selected: bool) -> bool {
    let color = timing_path_color(path.analysis_type);
    let response = egui::Frame::NONE
        .fill(egui::Color32::from_rgb(30, 30, 34))
        .stroke(if selected {
            egui::Stroke::new(1.5_f32, egui::Color32::WHITE)
        } else {
            egui::Stroke::new(1.0_f32, ecos_border())
        })
        .corner_radius(8)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(path.analysis_type.label().to_ascii_uppercase())
                        .small()
                        .strong()
                        .color(color),
                );
                ui.label(
                    egui::RichText::new(format!("{:+.4} ns", path.slack_ns))
                        .strong()
                        .color(color),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(format!("{} stages", path.stages.len()))
                            .small()
                            .color(ecos_text_secondary()),
                    );
                });
            });
            ui.label(
                egui::RichText::new(&path.path_group)
                    .small()
                    .color(ecos_text_primary()),
            );
            ui.label(
                egui::RichText::new(format!(
                    "{} → {}",
                    abbreviate_timing_name(&path.start_point, MAX_START_END_PREVIEW_CHARS),
                    abbreviate_timing_name(&path.end_point, MAX_START_END_PREVIEW_CHARS)
                ))
                .small()
                .color(ecos_text_secondary()),
            )
            .on_hover_text(format!(
                "Start: {}\nEnd: {}",
                path.start_point, path.end_point
            ));
        })
        .response
        .interact(egui::Sense::click());
    response.clicked()
}

fn timing_color_legend(ui: &mut egui::Ui, color: egui::Color32, label: &str) {
    ui.label(
        egui::RichText::new(format!("● {label}"))
            .small()
            .color(color),
    );
}

fn timing_clock_endpoint_label(
    ui: &mut egui::Ui,
    color: egui::Color32,
    role: &str,
    pin_label: &str,
) {
    ui.horizontal_wrapped(|ui| {
        ui.label(
            egui::RichText::new(format!("◆ {role} endpoint"))
                .small()
                .strong()
                .color(color),
        );
        ui.label(
            egui::RichText::new(abbreviate_timing_name(pin_label, 56))
                .small()
                .color(ecos_text_secondary()),
        )
        .on_hover_text(pin_label);
    });
}

fn timing_clock_labels(
    ui: &mut egui::Ui,
    endpoint: &TimingClockEndpointGeometry,
    color: egui::Color32,
    role: &str,
) {
    if endpoint.virtual_clock {
        let label = endpoint.pin_label.as_deref().unwrap_or("virtual clock");
        timing_clock_endpoint_label(ui, color, &format!("{role} (virtual)"), label);
        return;
    }
    if let Some(label) = &endpoint.source_pin_label {
        timing_clock_endpoint_label(ui, color, &format!("{role} source"), label);
    }
    if let Some(label) = &endpoint.pin_label {
        timing_clock_endpoint_label(ui, color, &format!("{role} endpoint"), label);
    }
}

#[derive(Clone, Copy, Debug)]
struct TimelineDelayScale {
    min_ns: f64,
    max_ns: f64,
}

impl TimelineDelayScale {
    fn new(delays: &[Option<f64>]) -> Self {
        let mut min_ns = 0.0_f64;
        let mut max_ns = 0.0_f64;
        for delay_ns in delays.iter().flatten() {
            min_ns = min_ns.min(*delay_ns);
            max_ns = max_ns.max(*delay_ns);
        }
        if max_ns <= min_ns {
            max_ns = min_ns + 1.0e-3;
        }
        Self { min_ns, max_ns }
    }

    fn y(self, delay_ns: Option<f64>, plot_top: f32, plot_bottom: f32) -> f32 {
        let fraction = ((delay_ns.unwrap_or(0.0) - self.min_ns) / (self.max_ns - self.min_ns))
            .clamp(0.0, 1.0) as f32;
        plot_bottom - fraction * (plot_bottom - plot_top)
    }
}

fn paint_timeline_axis(
    painter: egui::Painter,
    rect: egui::Rect,
    scale: &TimelineDelayScale,
    plot_top: f32,
    plot_bottom: f32,
) {
    painter.rect_filled(rect, 6.0, egui::Color32::from_rgb(24, 26, 30));
    painter.text(
        egui::pos2(rect.left() + 4.0, rect.top() + 3.0),
        egui::Align2::LEFT_TOP,
        "delay",
        egui::FontId::monospace(9.0),
        ecos_text_secondary(),
    );

    let mut previous_value = f64::NAN;
    for (value, color) in [
        (scale.max_ns, MAX_DELAY_COLOR),
        (0.0, ecos_text_secondary()),
        (scale.min_ns, NEGATIVE_DELAY_COLOR),
    ] {
        if value.is_nan() || (value - previous_value).abs() < f64::EPSILON {
            continue;
        }
        previous_value = value;
        let y = scale.y(Some(value), plot_top, plot_bottom);
        painter.text(
            egui::pos2(rect.right() - 6.0, y),
            egui::Align2::RIGHT_CENTER,
            format_timeline_axis_delay(value),
            egui::FontId::monospace(8.5),
            color,
        );
        painter.line_segment(
            [
                egui::pos2(rect.right() - 4.0, y),
                egui::pos2(rect.right(), y),
            ],
            egui::Stroke::new(1.0_f32, color),
        );
    }
}

fn paint_timeline_grid(
    painter: &egui::Painter,
    rect: egui::Rect,
    scale: &TimelineDelayScale,
    plot_top: f32,
    plot_bottom: f32,
) {
    let mut previous_value = f64::NAN;
    for (value, color, width) in [
        (scale.max_ns, egui::Color32::from_white_alpha(24), 1.0),
        (0.0, egui::Color32::from_white_alpha(64), 1.2),
        (scale.min_ns, egui::Color32::from_white_alpha(24), 1.0),
    ] {
        if (value - previous_value).abs() < f64::EPSILON {
            continue;
        }
        previous_value = value;
        let y = scale.y(Some(value), plot_top, plot_bottom);
        painter.line_segment(
            [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
            egui::Stroke::new(width, color),
        );
    }
}

fn format_timeline_axis_delay(value: f64) -> String {
    if value.abs() < f64::EPSILON {
        "0".to_string()
    } else if value.abs() < 1.0 {
        format!("{:.1}ps", value * 1000.0)
    } else {
        format!("{value:.2}ns")
    }
}

fn timing_delay_segment_color(
    delay_ns: Option<f64>,
    is_max: bool,
    path_color: egui::Color32,
) -> egui::Color32 {
    if delay_ns.is_some_and(|delay| delay < 0.0) {
        NEGATIVE_DELAY_COLOR
    } else if is_max {
        MAX_DELAY_COLOR
    } else {
        path_color
    }
}

fn timing_stage_tooltip(stage_index: usize, stage: &TimingStage, is_max: bool) -> String {
    let full_pin = timing_stage_full_pin(stage);
    format!(
        "Stage #{}\nKind: {}\nPin: {}\nCell: {}\nDelay: {}\nArrival: {}\nTransition: {}{}",
        stage_index + 1,
        if stage.kind.trim().is_empty() {
            "stage"
        } else {
            stage.kind.as_str()
        },
        full_pin,
        if stage.cell.trim().is_empty() {
            "—"
        } else {
            stage.cell.as_str()
        },
        format_timing_delay(stage.delay_ns),
        format_timing_ns(stage.arrival_ns),
        if stage.transition.trim().is_empty() {
            "—"
        } else {
            stage.transition.as_str()
        },
        if is_max { "\n\nLargest delay node" } else { "" }
    )
}

fn timing_stage_full_pin(stage: &TimingStage) -> String {
    if stage.instance.trim().is_empty() {
        stage.pin.clone()
    } else {
        format!("{}:{}", stage.instance, stage.local_pin_name())
    }
}

fn format_timing_delay(value: Option<f64>) -> String {
    value.map_or_else(
        || "—".to_string(),
        |value| {
            if value.abs() < 1.0 {
                format!("{:+.2}ps", value * 1000.0)
            } else {
                format!("{value:+.3}ns")
            }
        },
    )
}

fn format_timing_ns(value: Option<f64>) -> String {
    value.map_or_else(|| "—".to_string(), |value| format!("{value:.6} ns"))
}

fn abbreviate_timing_name(name: &str, max_chars: usize) -> String {
    if name.chars().count() <= max_chars {
        return name.to_string();
    }
    let suffix = name
        .chars()
        .rev()
        .take(max_chars.saturating_sub(2))
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("…{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_scale_maps_delay_to_vertical_axis() {
        let scale = TimelineDelayScale::new(&[Some(-0.2), Some(0.6), None]);

        assert!((scale.y(Some(-0.2), 10.0, 110.0) - 110.0).abs() < 1.0e-6);
        assert!((scale.y(Some(0.6), 10.0, 110.0) - 10.0).abs() < 1.0e-6);
        assert!((scale.y(Some(0.0), 10.0, 110.0) - 85.0).abs() < 1.0e-6);
    }

    #[test]
    fn timeline_scale_handles_all_zero_delays() {
        let scale = TimelineDelayScale::new(&[Some(0.0), Some(0.0)]);

        assert!(scale.max_ns > scale.min_ns);
        assert!((scale.y(Some(0.0), 10.0, 110.0) - 110.0).abs() < 1.0e-6);
    }

    fn timing_stage(kind: &str) -> TimingStage {
        TimingStage {
            kind: kind.to_string(),
            pin: "u0:A".to_string(),
            instance: "u0".to_string(),
            cell: "BUF".to_string(),
            delay_ns: Some(0.1),
            arrival_ns: Some(0.1),
            transition: "rise".to_string(),
        }
    }

    #[test]
    fn selected_net_stage_uses_its_own_routed_net() {
        let stages = [timing_stage("net_arc"), timing_stage("cell_arc")];

        assert_eq!(timing_selected_route_stage_index(&stages, 0), Some(0));
    }

    #[test]
    fn selected_cell_stage_uses_previous_routed_net() {
        let stages = [
            timing_stage("point"),
            timing_stage("net_arc"),
            timing_stage("cell_arc"),
        ];

        assert_eq!(timing_selected_route_stage_index(&stages, 2), Some(1));
    }

    #[test]
    fn selected_start_stage_has_no_incoming_routed_net() {
        let stages = [timing_stage("point"), timing_stage("net_arc")];

        assert_eq!(timing_selected_route_stage_index(&stages, 0), None);
    }

    fn route_shape(
        shape_id: u64,
        layer_id: u16,
        lx: i32,
        ly: i32,
        hx: i32,
        hy: i32,
    ) -> TimingRouteShape {
        TimingRouteShape {
            shape_id,
            layer_id,
            bbox: Rect32 { lx, ly, hx, hy },
            is_via: false,
        }
    }

    #[test]
    fn shortest_route_excludes_branches_that_do_not_reach_the_sink() {
        let nodes = vec![
            route_shape(1, 1, 0, 0, 20, 10),
            route_shape(2, 1, 20, 0, 60, 10),
            route_shape(3, 1, 25, -30, 45, 0),
            route_shape(4, 1, 60, 0, 100, 10),
            route_shape(5, 1, 100, 0, 120, 10),
        ];

        let route = shortest_timing_route_shape_ids(&nodes, &[0], &[4]).unwrap();

        assert_eq!(route, vec![1, 2, 4, 5]);
    }

    #[test]
    fn shortest_route_crosses_layers_only_through_a_via() {
        let mut via = route_shape(2, 2, 8, -2, 12, 12);
        via.is_via = true;
        let nodes = vec![
            route_shape(1, 1, 0, 0, 10, 10),
            via,
            route_shape(3, 3, 10, 0, 20, 10),
        ];

        let route = shortest_timing_route_shape_ids(&nodes, &[0], &[2]).unwrap();

        assert_eq!(route, vec![1, 2, 3]);
    }

    #[test]
    fn shortest_route_returns_none_when_source_and_sink_are_disconnected() {
        let nodes = vec![
            route_shape(1, 1, 0, 0, 10, 10),
            route_shape(2, 1, 20, 0, 30, 10),
        ];

        assert_eq!(shortest_timing_route_shape_ids(&nodes, &[0], &[1]), None);
    }

    #[test]
    fn clock_pin_scoring_prefers_clock_connectivity_over_the_data_pin() {
        assert_eq!(timing_clock_pin_score("D", "data", "CLK_clk", "D"), 0);
        assert!(timing_clock_pin_score("CK", "cts_flow_CLK_clk", "CLK_clk", "D") > 100);
    }

    #[test]
    fn virtual_clock_without_a_route_has_no_physical_anchor() {
        let (endpoint, route) = virtual_timing_clock_geometry("VCLK_clk");

        assert!(endpoint.virtual_clock);
        assert_eq!(endpoint.pin_label.as_deref(), Some("VCLK_clk"));
        assert_eq!(endpoint.source_bbox, None);
        assert_eq!(endpoint.anchor_bbox, None);
        assert!(route.stages.is_empty());
        assert!(route.wire_shape_ids.is_empty());
    }
}
