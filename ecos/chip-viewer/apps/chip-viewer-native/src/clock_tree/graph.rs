use std::collections::VecDeque;

use chip_view_db::clock_tree::ClockGraphIndex;

use super::{ClockTreePanel, LayoutTarget, TreeAxis, TreeRow};

const ROW_HEIGHT: f32 = 48.0;
const MAX_ROWS: usize = 20_000;

fn visible_rows(
    index: &ClockGraphIndex,
    expanded: &std::collections::HashSet<usize>,
    search: &str,
    only_issues: bool,
) -> (Vec<TreeRow>, bool) {
    let query = search.trim().to_lowercase();
    let filtering = !query.is_empty() || only_issues;
    let mut keep = vec![!filtering; index.nodes.len()];
    let mut pending = VecDeque::new();
    if filtering {
        for (node_index, node) in index.nodes.iter().enumerate() {
            let matches = query.is_empty()
                || node.name.to_lowercase().contains(&query)
                || node.instance_name.to_lowercase().contains(&query);
            if matches && (!only_issues || !index.issues[node_index].is_empty()) {
                keep[node_index] = true;
                pending.push_back(node_index);
            }
        }
        while let Some(node) = pending.pop_front() {
            for &parent in &index.parents[node] {
                if !keep[parent] {
                    keep[parent] = true;
                    pending.push_back(parent);
                }
            }
        }
    }
    let mut rows = Vec::new();
    let mut visited = vec![false; index.nodes.len()];
    let mut roots = index.roots.clone();
    if !index.diagnostics.is_empty() {
        let mut reachable = vec![false; index.nodes.len()];
        let mut queue = roots.clone();
        while let Some(node) = queue.pop() {
            if reachable[node] {
                continue;
            }
            reachable[node] = true;
            queue.extend(&index.children[node]);
        }
        for node in 0..index.nodes.len() {
            if !reachable[node] {
                roots.push(node);
                queue.push(node);
                while let Some(current) = queue.pop() {
                    if reachable[current] {
                        continue;
                    }
                    reachable[current] = true;
                    queue.extend(&index.children[current]);
                }
            }
        }
    }
    let mut stack: Vec<(usize, usize, Option<usize>)> = roots
        .into_iter()
        .rev()
        .map(|node| (node, 0, None))
        .collect();
    while let Some((node, depth, parent)) = stack.pop() {
        if !keep[node] {
            continue;
        }
        if rows.len() == MAX_ROWS {
            return (rows, true);
        }
        let reference = visited[node];
        visited[node] = true;
        let row = rows.len();
        rows.push(TreeRow {
            node,
            depth,
            parent,
            reference,
        });
        if !reference && (expanded.contains(&node) || filtering) {
            stack.extend(
                index.children[node]
                    .iter()
                    .rev()
                    .map(|&child| (child, depth + 1, Some(row))),
            );
        }
    }
    (rows, false)
}

impl ClockTreePanel {
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
        let timed_nodes = index
            .nodes
            .iter()
            .filter(|node| node.arrival_ns.is_some())
            .count();
        let has_timing = timed_nodes > 0;
        let complete_timing = timed_nodes == index.nodes.len();
        if !has_timing {
            self.axis = TreeAxis::Level;
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
            ui.selectable_value(&mut self.axis, TreeAxis::Level, "Levels");
            ui.add_enabled_ui(has_timing, |ui| {
                ui.selectable_value(&mut self.axis, TreeAxis::Delay, "Delay (ns)");
            });
            if ui.button("Close").clicked() {
                self.open = false;
            }
        });
        if !has_timing {
            ui.colored_label(
                egui::Color32::YELLOW,
                "Hierarchy axis · insertion timing is unavailable for this clock.",
            );
        } else if self.axis == TreeAxis::Delay && !complete_timing {
            ui.colored_label(
                egui::Color32::YELLOW,
                format!(
                    "Partial timing: {timed_nodes}/{} nodes have an arrival; nodes without timing keep their topology level.",
                    index.nodes.len()
                ),
            );
        }
        ui.horizontal(|ui| {
            if ui.small_button("Collapse").clicked() {
                self.expanded.clear();
                self.expanded.extend(index.roots.iter().copied());
                self.rows_dirty = true;
            }
            if ui.small_button("Expand level").clicked() {
                self.expanded.extend(self.rows.iter().map(|row| row.node));
                self.rows_dirty = true;
            }
            if ui.small_button("Reset view").clicked() {
                self.zoom = 1.0;
                self.pan = egui::Vec2::ZERO;
            }
            ui.label("Scroll: zoom · Drag: pan · Double-click: fold · Click: locate");
        });
        if self.rows_dirty {
            (self.rows, self.truncated) =
                visible_rows(index, &self.expanded, &self.search, self.only_issues);
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
        if self.truncated {
            ui.colored_label(
                egui::Color32::YELLOW,
                "Visible tree limited to 20,000 rows. Collapse branches or refine the search.",
            );
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
        if response.dragged() {
            self.pan += ui.input(|input| input.pointer.delta());
        }
        if response.hovered() {
            let scroll = ui.input(|input| input.smooth_scroll_delta.y);
            if scroll != 0.0 {
                let old_zoom = self.zoom;
                self.zoom = (self.zoom * (scroll * 0.002).exp()).clamp(0.15, 3.0);
                let anchor = response.hover_pos().unwrap_or(rect.center()) - rect.min;
                self.pan = anchor - (anchor - self.pan) * (self.zoom / old_zoom);
            }
        }
        if self.focus_selected {
            if let Some(row) = self
                .rows
                .iter()
                .position(|row| Some(row.node) == self.selected)
            {
                self.pan.y = rect.height() * 0.45 - (row as f32 * ROW_HEIGHT + 28.0) * self.zoom;
            }
            self.focus_selected = false;
        }
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 4.0, egui::Color32::from_rgb(22, 27, 35));
        let origin = rect.min + self.pan;
        let row_position = |row: &TreeRow, ordinal: usize| {
            let horizontal = match self.axis {
                TreeAxis::Level => row.depth as f32 * 185.0,
                TreeAxis::Delay => {
                    index.nodes[row.node]
                        .arrival_ns
                        .map_or(row.depth as f32 * 185.0, |value| {
                            ((value - self.delay_bounds.0)
                                / (self.delay_bounds.1 - self.delay_bounds.0).max(0.001))
                                as f32
                                * 1100.0
                        })
                }
            };
            origin + egui::vec2(horizontal + 85.0, ordinal as f32 * ROW_HEIGHT + 28.0) * self.zoom
        };
        let first = (((rect.top() - origin.y) / (ROW_HEIGHT * self.zoom)).floor() as isize - 2)
            .max(0) as usize;
        let last = ((((rect.bottom() - origin.y) / (ROW_HEIGHT * self.zoom)).ceil() as isize + 2)
            .max(0) as usize)
            .min(self.rows.len());
        let mut clicked = None;
        let mut toggled = None;
        let mut net_clicked = None;
        for ordinal in first.min(last)..last {
            let row = &self.rows[ordinal];
            let node = &index.nodes[row.node];
            let point = row_position(row, ordinal);
            if let Some(parent) = row.parent {
                let parent_point = row_position(&self.rows[parent], parent);
                let middle = egui::pos2((parent_point.x + point.x) * 0.5, parent_point.y);
                painter.add(egui::Shape::line(
                    vec![parent_point, middle, egui::pos2(middle.x, point.y), point],
                    egui::Stroke::new(1.0, egui::Color32::from_gray(95)),
                ));
                let edge_index = index
                    .edge_by_pair
                    .get(&(self.rows[parent].node, row.node))
                    .copied();
                if let Some(edge) = edge_index.and_then(|edge| index.edges.get(edge)) {
                    let anchor = egui::pos2(
                        (parent_point.x + point.x) * 0.5,
                        (parent_point.y + point.y) * 0.5,
                    );
                    let edge_hit = ui
                        .interact(
                            egui::Rect::from_center_size(anchor, egui::vec2(22.0, 22.0)),
                            egui::Id::new(("clock_tree_edge", ordinal)),
                            egui::Sense::click(),
                        )
                        .on_hover_text(format!(
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
                    if edge_hit.clicked() && !edge.net_name.is_empty() {
                        net_clicked = edge_index;
                    }
                }
            }
            let node_rect =
                egui::Rect::from_center_size(point, egui::vec2(160.0, 34.0) * self.zoom);
            if !node_rect.intersects(rect) {
                continue;
            }
            let own_issue = !index.issues[row.node].is_empty();
            let color = if own_issue {
                egui::Color32::from_rgb(163, 66, 62)
            } else if node.arrival_ns.is_none() && index.summary.valid_sink_count > 0 {
                egui::Color32::from_gray(65)
            } else {
                egui::Color32::from_rgb(41, 94, 120)
            };
            painter.rect_filled(node_rect, 4.0, color);
            if self.selected == Some(row.node) {
                painter.rect_stroke(
                    node_rect,
                    4.0,
                    egui::Stroke::new(2.0, egui::Color32::WHITE),
                    egui::StrokeKind::Inside,
                );
            }
            let prefix = if row.reference {
                "↪ "
            } else if !index.children[row.node].is_empty() && !self.expanded.contains(&row.node) {
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
                egui::FontId::proportional((11.0 * self.zoom).max(6.0)),
                egui::Color32::WHITE,
            );
            let hit = ui
                .interact(
                    node_rect.intersect(rect),
                    egui::Id::new(("clock_tree_node", ordinal)),
                    egui::Sense::click(),
                )
                .on_hover_text(format!(
                    "{}\ninstance {} · pin {}\nmaster {} · kind {:?}\narrival {} · slew {}\nfanout {} · subtree {} sinks · spread {}\n{}",
                    node.name,
                    if node.instance_name.is_empty() {
                        "top-level"
                    } else {
                        &node.instance_name
                    },
                    node.pin_name,
                    if node.master.is_empty() {
                        "n/a"
                    } else {
                        &node.master
                    },
                    node.kind,
                    super::measurement(node.arrival_ns, "ns"),
                    super::measurement(node.slew_ns, "ns"),
                    index.children[row.node].len(),
                    index.stats[row.node].sink_count,
                    super::measurement(index.stats[row.node].skew_ns(), "ns"),
                    index.issues[row.node].join("\n")
                ));
            if hit.clicked() {
                clicked = Some(row.node);
            }
            if hit.double_clicked() && !row.reference {
                toggled = Some(row.node);
            }
        }
        if let Some(node) = clicked {
            self.selected = Some(node);
            action = Some(LayoutTarget::Node(index.nodes[node].clone()));
        }
        if let Some(edge_index) = net_clicked {
            let edge = &index.edges[edge_index];
            action = Some(LayoutTarget::Net(edge.net_name.clone()));
        }
        if let Some(node) = toggled {
            if !self.expanded.remove(&node) {
                self.expanded.insert(node);
            }
            self.rows_dirty = true;
        }
        action
    }
}
