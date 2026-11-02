use chip_view_db::clock_tree::{ClockGraphIndex, ClockNode};

use super::layout::{
    self, LeafDelayAxis, TreeRow, LEAF_HEIGHT, LEAF_ROW_SPACING, LEAF_WIDTH, NODE_HEIGHT,
    NODE_WIDTH,
};
use super::{ClockTreePanel, LayoutTarget, TreeViewMode};

const VIEW_PADDING: f32 = 28.0;
const MIN_ZOOM: f32 = 0.002;
const MAX_ZOOM: f32 = 4.0;
const MIN_INTERNAL_LABEL_ZOOM: f32 = 0.55;
const LEAF_LABEL_ZOOM: f32 = 1.25;
const LEAF_TRIANGLE_MIN_PIXELS: f32 = 4.4;
const MIN_NODE_HIT_SIZE: f32 = 8.0;
const MAX_EDGE_INTERACTIONS: usize = 1200;
const MIN_EDGE_INTERACTION_ZOOM: f32 = 0.4;
const FANOUT_RAIL_OFFSET: f32 = 12.0;
const DELAY_AXIS_WIDTH: f32 = 72.0;
const DELAY_AXIS_TICK_TARGET_PX: f32 = 32.0;

fn delay_tick_decimals(step: f64) -> usize {
    if step >= 0.01 {
        3
    } else if step >= 0.001 {
        4
    } else if step >= 0.0001 {
        5
    } else {
        6
    }
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0).max(f32::EPSILON)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn is_leaf(index: &ClockGraphIndex, row: &TreeRow) -> bool {
    let node = &index.nodes[row.node];
    node.sink || node.kind == chipgeom_format::ClockNodeKind::Sink
}

fn leaf_visual_size(zoom: f32) -> egui::Vec2 {
    let detail = smoothstep(0.24, 0.7, zoom);
    let normal = egui::vec2(
        (LEAF_WIDTH * zoom).clamp(4.0, 24.0),
        (LEAF_HEIGHT * zoom).clamp(4.0, 20.0),
    );
    egui::vec2(2.2, 2.2) * (1.0 - detail) + normal * detail
}

fn leaf_is_dot(size: egui::Vec2) -> bool {
    size.x < LEAF_TRIANGLE_MIN_PIXELS
}

fn internal_visual_size(zoom: f32) -> egui::Vec2 {
    egui::vec2(
        (NODE_WIDTH * zoom).clamp(5.0, NODE_WIDTH * 1.6),
        (NODE_HEIGHT * zoom).clamp(4.0, NODE_HEIGHT * 1.6),
    )
}

fn node_visual_size(index: &ClockGraphIndex, row: &TreeRow, zoom: f32) -> egui::Vec2 {
    if is_leaf(index, row) {
        leaf_visual_size(zoom)
    } else {
        internal_visual_size(zoom)
    }
}

fn node_hit_size(index: &ClockGraphIndex, row: &TreeRow, zoom: f32) -> egui::Vec2 {
    let size = node_visual_size(index, row, zoom);
    egui::vec2(size.x.max(MIN_NODE_HIT_SIZE), size.y.max(MIN_NODE_HIT_SIZE))
}

fn delay_color(value: f64, bounds: (f64, f64)) -> egui::Color32 {
    let range = (bounds.1 - bounds.0).max(0.001);
    let t = ((value - bounds.0) / range).clamp(0.0, 1.0);
    let red = (32.0 + 223.0 * t) as u8;
    let green = (80.0 + 135.0 * (1.0 - (2.0 * t - 1.0).abs())) as u8;
    let blue = (220.0 * (1.0 - t)) as u8;
    egui::Color32::from_rgb(red, green, blue)
}

fn node_color(
    index: &ClockGraphIndex,
    node: &ClockNode,
    view_mode: TreeViewMode,
    delay_bounds: (f64, f64),
) -> egui::Color32 {
    if !index.issues[node.index].is_empty() {
        egui::Color32::from_rgb(163, 66, 62)
    } else if node.arrival_ns.is_none() && index.summary.valid_sink_count > 0 {
        egui::Color32::from_gray(65)
    } else if view_mode == TreeViewMode::Delay {
        node.arrival_ns
            .map_or(egui::Color32::from_gray(65), |arrival| {
                delay_color(arrival, delay_bounds)
            })
    } else {
        egui::Color32::from_rgb(41, 94, 120)
    }
}

fn row_at_position(
    index: &ClockGraphIndex,
    rows: &[TreeRow],
    render_rows: &[usize],
    y_bands: &[layout::YBand],
    pointer: egui::Pos2,
    origin: egui::Pos2,
    rect: egui::Rect,
    zoom: f32,
) -> Option<usize> {
    if !rect.contains(pointer) || y_bands.is_empty() {
        return None;
    }
    let world = (pointer - origin) / zoom;
    let y_margin = NODE_HEIGHT.max(LEAF_ROW_SPACING) * 0.5 + 2.0;
    let first_band = y_bands.partition_point(|band| band.y < f64::from(world.y - y_margin));
    let end_band = y_bands.partition_point(|band| band.y <= f64::from(world.y + y_margin));
    for band in &y_bands[first_band..end_band] {
        let order = &render_rows[band.rows.clone()];
        let first =
            order.partition_point(|&ordinal| rows[ordinal].x < f64::from(world.x - NODE_WIDTH));
        let end =
            order.partition_point(|&ordinal| rows[ordinal].x <= f64::from(world.x + NODE_WIDTH));
        for &ordinal in &order[first..end] {
            let row = &rows[ordinal];
            let point = origin + egui::vec2(row.x as f32, row.y as f32) * zoom;
            let hit = egui::Rect::from_center_size(point, node_hit_size(index, row, zoom));
            if hit.contains(pointer) {
                return Some(ordinal);
            }
        }
    }
    None
}

impl ClockTreePanel {
    fn tree_bounds(&self) -> Option<egui::Rect> {
        let mut bounds: Option<egui::Rect> = None;
        for row in &self.rows {
            let half_width = if row.leaf_fan {
                LEAF_WIDTH * 0.5
            } else {
                NODE_WIDTH * 0.5
            };
            let half_height = if row.leaf_fan {
                LEAF_HEIGHT * 0.5
            } else {
                NODE_HEIGHT * 0.5
            };
            let node_rect = egui::Rect::from_min_max(
                egui::pos2(row.x as f32 - half_width, row.y as f32 - half_height),
                egui::pos2(row.x as f32 + half_width, row.y as f32 + half_height),
            );
            bounds = Some(bounds.map_or(node_rect, |current| current.union(node_rect)));
        }
        bounds
    }

    fn center_tree_on_root(&mut self, rect: egui::Rect) {
        self.zoom = 0.8;
        let (root_x, root_y) = self
            .rows
            .iter()
            .find(|row| row.parent.is_none())
            .map_or((0.0, 0.0), |row| (row.x as f32, row.y as f32));
        self.pan = egui::vec2(
            rect.width() * 0.5 - root_x * self.zoom,
            VIEW_PADDING + NODE_HEIGHT * 0.5 * self.zoom - root_y * self.zoom,
        );
    }

    fn fit_tree_to_rect(&mut self, rect: egui::Rect) {
        let Some(bounds) = self.tree_bounds() else {
            return;
        };
        let available_width = (rect.width() - 2.0 * VIEW_PADDING).max(1.0);
        let available_height = (rect.height() - 2.0 * VIEW_PADDING).max(1.0);
        self.zoom = (available_width / bounds.width().max(1.0))
            .min(available_height / bounds.height().max(1.0))
            .min(1.0)
            .max(MIN_ZOOM);
        self.pan = rect.size() * 0.5 - bounds.center().to_vec2() * self.zoom;
    }

    fn paint_delay_axis(
        &self,
        painter: &egui::Painter,
        rect: egui::Rect,
        origin: egui::Pos2,
        zoom: f32,
        axis: LeafDelayAxis,
    ) {
        let top_y = origin.y + axis.top_y as f32 * zoom;
        let bottom_y = origin.y + axis.bottom_y as f32 * zoom;
        if bottom_y < rect.top() || top_y > rect.bottom() {
            return;
        }

        let gutter = egui::Rect::from_min_max(
            rect.min,
            egui::pos2(rect.left() + DELAY_AXIS_WIDTH, rect.bottom()),
        );
        painter.rect_filled(
            gutter,
            0.0,
            egui::Color32::from_rgba_unmultiplied(15, 20, 27, 230),
        );
        painter.text(
            egui::pos2(rect.left() + 8.0, rect.top() + 8.0),
            egui::Align2::LEFT_TOP,
            "DELAY (ns)",
            egui::FontId::proportional(10.0),
            egui::Color32::from_gray(185),
        );

        let axis_x = rect.left() + DELAY_AXIS_WIDTH - 10.0;
        let line_top = top_y.max(rect.top() + 2.0);
        let line_bottom = bottom_y.min(rect.bottom() - 8.0);
        if line_bottom <= line_top {
            return;
        }
        let intervals = ((line_bottom - line_top) / DELAY_AXIS_TICK_TARGET_PX)
            .round()
            .clamp(2.0, 8.0) as usize;
        let range = axis.maximum_ns - axis.minimum_ns;
        let decimals = delay_tick_decimals(range / intervals as f64);
        let axis_color = egui::Color32::from_rgb(117, 139, 158);
        let guide_color = egui::Color32::from_rgba_unmultiplied(117, 139, 158, 64);

        painter.line_segment(
            [
                egui::pos2(axis_x, line_top),
                egui::pos2(axis_x, line_bottom),
            ],
            egui::Stroke::new(1.0, axis_color),
        );
        for interval in 0..=intervals {
            let fraction = interval as f32 / intervals as f32;
            let y = top_y + (bottom_y - top_y) * fraction;
            if y < line_top - 0.5 || y > line_bottom + 0.5 {
                continue;
            }
            let delay = axis.minimum_ns + range * f64::from(fraction);
            painter.line_segment(
                [egui::pos2(axis_x - 5.0, y), egui::pos2(axis_x, y)],
                egui::Stroke::new(1.0, axis_color),
            );
            painter.extend(egui::Shape::dotted_line(
                &[
                    egui::pos2(axis_x + 2.0, y),
                    egui::pos2(rect.right() - 8.0, y),
                ],
                guide_color,
                6.0,
                0.8,
            ));
            painter.text(
                egui::pos2(axis_x - 8.0, y),
                egui::Align2::RIGHT_CENTER,
                format!("{delay:.decimals$}"),
                egui::FontId::proportional(9.0),
                egui::Color32::from_gray(182),
            );
        }
    }

    pub(crate) fn graph_ui(&mut self, ui: &mut egui::Ui) -> Option<LayoutTarget> {
        if !self.open {
            return None;
        }
        self.poll(ui.ctx());
        let Some(data) = self.data.clone() else {
            ui.spinner();
            ui.label("Loading clock tree…");
            return None;
        };
        let Some(index) = data.view.clocks.get(self.clock) else {
            ui.label("No clock graph is available.");
            return None;
        };
        let timed_nodes = index.timed_node_count;
        let has_timing = timed_nodes > 0;
        let complete_timing = timed_nodes == index.nodes.len();
        if !has_timing && self.view_mode != TreeViewMode::Hierarchy {
            self.view_mode = TreeViewMode::Hierarchy;
            self.rows_dirty = true;
        }
        let mut action = None;
        ui.horizontal(|ui| {
            self.rows_dirty |= ui
                .text_edit_singleline(&mut self.search)
                .on_hover_text("Search instance or qualified pin name")
                .changed();
            self.rows_dirty |= ui
                .checkbox(&mut self.only_issues, "Attention paths")
                .changed();
            self.rows_dirty |= ui
                .selectable_value(&mut self.view_mode, TreeViewMode::Hierarchy, "Hierarchy")
                .changed();
            ui.add_enabled_ui(has_timing, |ui| {
                self.rows_dirty |= ui
                    .selectable_value(&mut self.view_mode, TreeViewMode::Delay, "Delay")
                    .changed();
            });
            if ui.button("Close").clicked() {
                self.open = false;
            }
        });
        if !has_timing {
            ui.colored_label(
                egui::Color32::YELLOW,
                "Hierarchy view · insertion timing is unavailable for this clock.",
            );
        } else if self.view_mode == TreeViewMode::Delay && !complete_timing {
            ui.colored_label(
                egui::Color32::YELLOW,
                format!(
                    "Partial timing: {timed_nodes}/{} nodes have an arrival; grey nodes keep their hierarchy position.",
                    index.nodes.len()
                ),
            );
        }
        if self.view_mode == TreeViewMode::Hierarchy {
            ui.label(
                egui::RichText::new("Hierarchy view · node height follows topology depth")
                    .small()
                    .color(egui::Color32::from_gray(170)),
            );
        } else if let Some(axis) = self.leaf_delay_axis {
            ui.label(
                egui::RichText::new(format!(
                    "Node Y = insertion delay from root (0 → late ↓) · {:.4}–{:.4} ns",
                    axis.minimum_ns, axis.maximum_ns
                ))
                .small()
                .color(egui::Color32::from_gray(170)),
            );
        }
        ui.horizontal(|ui| {
            if ui.small_button("Collapse").clicked() {
                self.collapsed.clear();
                for (node, children) in index.children.iter().enumerate() {
                    if !children.is_empty() {
                        self.collapsed.insert(node);
                    }
                }
                for &root in &index.roots {
                    self.collapsed.remove(&root);
                }
                self.rows_dirty = true;
            }
            if ui.small_button("Expand level").clicked() {
                for row in &self.rows {
                    self.collapsed.remove(&row.node);
                }
                self.rows_dirty = true;
            }
            if ui.small_button("Expand all").clicked() {
                self.collapsed.clear();
                self.rows_dirty = true;
            }
            if ui.small_button("-").on_hover_text("Zoom out").clicked() {
                self.zoom_step -= 1;
            }
            if ui.small_button("+").on_hover_text("Zoom in").clicked() {
                self.zoom_step += 1;
            }
            if ui.small_button("Center root").clicked() {
                self.center_root_view = true;
                self.fit_tree_view = false;
            }
            if ui.small_button("Fit tree").clicked() {
                self.fit_tree_view = true;
                self.center_root_view = false;
            }
            ui.label("Scroll: zoom · Drag: pan · Double-click: fold · Click: locate");
        });
        if self.rows_dirty {
            let layout_mode = match self.view_mode {
                TreeViewMode::Hierarchy => layout::TreeLayoutMode::Hierarchy,
                TreeViewMode::Delay => layout::TreeLayoutMode::Delay,
            };
            let layout = layout::visible_rows(
                index,
                &self.collapsed,
                &self.search,
                self.only_issues,
                layout_mode,
            );
            self.rows = layout.rows;
            self.render_rows = layout.render_rows;
            self.y_bands = layout.y_bands;
            self.leaf_delay_axis = layout.leaf_delay_axis;
            let arrivals = index.nodes.iter().filter_map(|node| node.arrival_ns);
            self.delay_bounds = arrivals
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), value| {
                    (min.min(value), max.max(value))
                });
            if !self.delay_bounds.0.is_finite() {
                self.delay_bounds = (0.0, 1.0);
            }
            self.rows_dirty = false;
        }
        if self.rows.is_empty() {
            ui.label("No matching clock nodes.");
            return None;
        }
        if !index.diagnostics.is_empty() {
            ui.colored_label(egui::Color32::YELLOW, index.diagnostics.join(" · "));
        }
        let (rect, response) = ui.allocate_exact_size(
            ui.available_size().max(egui::vec2(100.0, 100.0)),
            egui::Sense::click_and_drag(),
        );
        if self.fit_tree_view {
            self.fit_tree_to_rect(rect);
            self.fit_tree_view = false;
        } else if self.center_root_view {
            self.center_tree_on_root(rect);
            self.center_root_view = false;
        }
        if self.zoom_step != 0 {
            let old_zoom = self.zoom;
            self.zoom = (self.zoom * 1.25_f32.powi(self.zoom_step)).clamp(MIN_ZOOM, MAX_ZOOM);
            let anchor = rect.center() - rect.min;
            self.pan = anchor - (anchor - self.pan) * (self.zoom / old_zoom);
            self.zoom_step = 0;
        }
        if response.dragged() {
            self.pan += ui.input(|input| input.pointer.delta());
        }
        if response.hovered() {
            let scroll = ui.input(|input| input.smooth_scroll_delta.y);
            if scroll != 0.0 {
                let old_zoom = self.zoom;
                self.zoom = (self.zoom * (scroll * 0.002).exp()).clamp(MIN_ZOOM, MAX_ZOOM);
                let anchor = response.hover_pos().unwrap_or(rect.center()) - rect.min;
                self.pan = anchor - (anchor - self.pan) * (self.zoom / old_zoom);
            }
        }
        if self.focus_selected {
            if let Some(row) = self.rows.iter().find(|row| Some(row.node) == self.selected) {
                self.pan.x = rect.width() * 0.5 - row.x as f32 * self.zoom;
                self.pan.y = rect.height() * 0.45 - row.y as f32 * self.zoom;
            }
            self.focus_selected = false;
        }

        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 4.0, egui::Color32::from_rgb(22, 27, 35));
        let origin = rect.min + self.pan;
        let zoom = self.zoom;
        let node_point = |row: &TreeRow| origin + egui::vec2(row.x as f32, row.y as f32) * zoom;

        let top = f64::from((rect.top() - origin.y) / zoom - NODE_HEIGHT);
        let bottom = f64::from((rect.bottom() - origin.y) / zoom + NODE_HEIGHT);
        let left = f64::from((rect.left() - origin.x) / zoom - NODE_WIDTH);
        let right = f64::from((rect.right() - origin.x) / zoom + NODE_WIDTH);
        let first_band = self.y_bands.partition_point(|band| band.y < top);
        let end_band = self.y_bands.partition_point(|band| band.y <= bottom);
        let mut visible_ranges = Vec::new();
        for band in &self.y_bands[first_band..end_band] {
            let order = &self.render_rows[band.rows.clone()];
            let start = order.partition_point(|&ordinal| self.rows[ordinal].x < left);
            let end = order.partition_point(|&ordinal| self.rows[ordinal].x <= right);
            if start < end {
                visible_ranges.push(band.rows.start + start..band.rows.start + end);
            }
        }
        let visible_count = visible_ranges
            .iter()
            .map(|range| range.len())
            .sum::<usize>();
        let interact_with_edges =
            visible_count <= MAX_EDGE_INTERACTIONS && zoom >= MIN_EDGE_INTERACTION_ZOOM;
        let mut net_clicked = None;
        for visible in &visible_ranges {
            for &ordinal in &self.render_rows[visible.clone()] {
                let row = &self.rows[ordinal];
                let node = &index.nodes[row.node];
                let point = node_point(row);
                let child_size = node_visual_size(index, row, zoom);
                if let Some(parent) = row.parent {
                    let parent_row = &self.rows[parent];
                    let parent_point = node_point(parent_row);
                    let parent_size = node_visual_size(index, parent_row, zoom);
                    let start = egui::pos2(parent_point.x, parent_point.y + parent_size.y * 0.5);
                    let end = egui::pos2(point.x, point.y - child_size.y * 0.5);
                    let rail_y = (start.y + FANOUT_RAIL_OFFSET).min(end.y);
                    let points = vec![
                        start,
                        egui::pos2(start.x, rail_y),
                        egui::pos2(end.x, rail_y),
                        end,
                    ];
                    painter.add(egui::Shape::line(
                        points,
                        egui::Stroke::new(
                            (zoom * 1.1).clamp(0.55, 1.4),
                            egui::Color32::from_gray(95),
                        ),
                    ));
                    if interact_with_edges {
                        if let Some(edge_index) = index
                            .edge_by_pair
                            .get(&(parent_row.node, row.node))
                            .copied()
                        {
                            if let Some(edge) = index.edges.get(edge_index) {
                                let anchor = egui::pos2(end.x, (rail_y + end.y) * 0.5);
                                let hit = ui
                                    .interact(
                                        egui::Rect::from_center_size(
                                            anchor,
                                            egui::vec2(18.0, 18.0),
                                        ),
                                        egui::Id::new(("clock_tree_edge", ordinal)),
                                        egui::Sense::click(),
                                    )
                                    .on_hover_ui(|ui| {
                                        ui.label(format!(
                                            "net {} · cell {} · {:?} edge · {:?} polarity",
                                            if edge.net_name.is_empty() {
                                                "unavailable"
                                            } else {
                                                &edge.net_name
                                            },
                                            if edge.cell_name.is_empty() {
                                                "unavailable"
                                            } else {
                                                &edge.cell_name
                                            },
                                            edge.kind,
                                            edge.polarity
                                        ));
                                    });
                                if hit.clicked() && !edge.net_name.is_empty() {
                                    net_clicked = Some(edge_index);
                                }
                            }
                        }
                    }
                }

                let color = node_color(index, node, self.view_mode, self.delay_bounds);
                if is_leaf(index, row) {
                    if leaf_is_dot(child_size) {
                        painter.circle_filled(point, child_size.x.max(1.0) * 0.5, color);
                        if self.selected == Some(row.node) {
                            painter.circle_stroke(
                                point,
                                child_size.x.max(1.0) * 0.5 + 1.0,
                                egui::Stroke::new(1.0, egui::Color32::WHITE),
                            );
                        }
                    } else {
                        let triangle = vec![
                            egui::pos2(point.x, point.y - child_size.y * 0.5),
                            egui::pos2(point.x + child_size.x * 0.5, point.y + child_size.y * 0.5),
                            egui::pos2(point.x - child_size.x * 0.5, point.y + child_size.y * 0.5),
                        ];
                        let stroke = if self.selected == Some(row.node) {
                            egui::Stroke::new(1.5, egui::Color32::WHITE)
                        } else {
                            egui::Stroke::NONE
                        };
                        painter.add(egui::Shape::convex_polygon(triangle, color, stroke));
                    }
                    if zoom >= LEAF_LABEL_ZOOM || self.selected == Some(row.node) {
                        let label: String = node.name.chars().take(20).collect();
                        let label = node
                            .arrival_ns
                            .map_or(label.clone(), |arrival| format!("{label}\n{arrival:.4} ns"));
                        painter.text(
                            egui::pos2(point.x, point.y + child_size.y * 0.5 + 2.0),
                            egui::Align2::CENTER_TOP,
                            label,
                            egui::FontId::proportional((10.0 * zoom).clamp(7.0, 13.0)),
                            egui::Color32::from_gray(205),
                        );
                    }
                } else {
                    let node_rect = egui::Rect::from_center_size(point, child_size);
                    painter.rect_filled(node_rect, (4.0 * zoom).clamp(1.0, 6.0), color);
                    if self.selected == Some(row.node) {
                        painter.rect_stroke(
                            node_rect,
                            (4.0 * zoom).clamp(1.0, 6.0),
                            egui::Stroke::new((1.5 * zoom).clamp(1.0, 2.0), egui::Color32::WHITE),
                            egui::StrokeKind::Inside,
                        );
                    }
                    if zoom >= MIN_INTERNAL_LABEL_ZOOM {
                        let prefix = if row.reference {
                            "↪ "
                        } else if !index.children[row.node].is_empty()
                            && self.collapsed.contains(&row.node)
                        {
                            "+ "
                        } else {
                            ""
                        };
                        let label: String = node.name.chars().take(23).collect();
                        let arrival = node
                            .arrival_ns
                            .map_or_else(|| "?".to_string(), |value| format!("{value:.4} ns"));
                        painter.text(
                            node_rect.center(),
                            egui::Align2::CENTER_CENTER,
                            format!("{prefix}{label}\n{arrival}"),
                            egui::FontId::proportional((11.0 * zoom).clamp(6.0, 18.0)),
                            egui::Color32::WHITE,
                        );
                    }
                }
            }
        }

        if let Some(axis) = self.leaf_delay_axis {
            self.paint_delay_axis(&painter, rect, origin, zoom, axis);
        }

        let pointer = response
            .hover_pos()
            .or_else(|| response.interact_pointer_pos())
            .filter(|pointer| {
                self.leaf_delay_axis.is_none() || pointer.x >= rect.left() + DELAY_AXIS_WIDTH
            });
        let hovered = pointer.and_then(|pointer| {
            row_at_position(
                index,
                &self.rows,
                &self.render_rows,
                &self.y_bands,
                pointer,
                origin,
                rect,
                zoom,
            )
        });
        if let Some(ordinal) = hovered {
            let row = &self.rows[ordinal];
            let node = &index.nodes[row.node];
            let _ = response.clone().on_hover_ui(|ui| {
                ui.label(format!(
                    "{}\ninstance {} · pin {}\nmaster {} · kind {:?}\narrival {} · slew {}\nfanout {} · subtree {} sinks · spread {}\n{}",
                    node.name,
                    if node.instance_name.is_empty() {
                        "top-level"
                    } else {
                        &node.instance_name
                    },
                    node.pin_name,
                    if node.master.is_empty() { "n/a" } else { &node.master },
                    node.kind,
                    super::measurement(node.arrival_ns, "ns"),
                    super::measurement(node.slew_ns, "ns"),
                    index.children[row.node].len(),
                    index.stats[row.node].sink_count,
                    super::measurement(index.stats[row.node].skew_ns(), "ns"),
                    index.issues[row.node].join("\n")
                ));
            });
            if response.clicked() {
                self.selected = Some(row.node);
                action = Some(LayoutTarget::Node(index.nodes[row.node].clone()));
            }
            if response.double_clicked() && !row.reference {
                let node = row.node;
                if !self.collapsed.remove(&node) {
                    self.collapsed.insert(node);
                }
                self.rows_dirty = true;
            }
        }
        if let Some(edge_index) = net_clicked {
            let edge = &index.edges[edge_index];
            action = Some(LayoutTarget::Net(edge.net_name.clone()));
        }
        action
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaf_lod_grows_from_dot_to_triangle() {
        let panorama = leaf_visual_size(0.1);
        let detail = leaf_visual_size(1.0);

        assert!(leaf_is_dot(panorama));
        assert!(!leaf_is_dot(detail));
        assert!(detail.x > panorama.x * 3.0);
        assert!(detail.y > panorama.y * 3.0);
    }

    #[test]
    fn internal_nodes_keep_a_visible_minimum() {
        let size = internal_visual_size(0.01);

        assert!(size.x >= 5.0);
        assert!(size.y >= 4.0);
    }

    #[test]
    fn delay_axis_precision_tracks_tick_step() {
        assert_eq!(delay_tick_decimals(0.02), 3);
        assert_eq!(delay_tick_decimals(0.002), 4);
        assert_eq!(delay_tick_decimals(0.0002), 5);
        assert_eq!(delay_tick_decimals(0.00002), 6);
    }
}
