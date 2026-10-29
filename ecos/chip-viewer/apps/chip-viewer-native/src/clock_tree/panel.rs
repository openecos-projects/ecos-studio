use std::sync::Arc;

use super::{analysis_label, measurement, stage_label, status_label, ClockTreePanel, LayoutTarget};

impl ClockTreePanel {
    pub(crate) fn sidebar(&mut self, ui: &mut egui::Ui) -> Option<LayoutTarget> {
        self.poll(ui.ctx());
        if let Some(error) = &self.error {
            ui.colored_label(egui::Color32::LIGHT_RED, "Clock tree unavailable");
            ui.label(error);
            ui.label("The physical layout remains available.");
            if ui.button("Retry").clicked() {
                self.started = false;
                self.error = None;
            }
            return None;
        }
        let Some(data) = self.data.as_ref().map(Arc::clone) else {
            ui.spinner();
            ui.label("Loading clock tree…");
            return None;
        };
        ui.label(format!(
            "{} · {} · {}",
            stage_label(data.view.stage),
            status_label(data.view.status),
            analysis_label(data.view.analysis_source)
        ));
        let unavailable = "unavailable";
        let rc_corner = if data.view.rc_corner.is_empty() {
            unavailable
        } else {
            &data.view.rc_corner
        };
        let liberty_corner = if data.view.liberty_corner.is_empty() {
            unavailable
        } else {
            &data.view.liberty_corner
        };
        let model = match data.view.analysis_source {
            Some(chipgeom_format::ClockTreeAnalysisSource::CtsFastSta) => {
                "Committed CTS FastSTA estimate; not signoff timing.".to_string()
            }
            Some(chipgeom_format::ClockTreeAnalysisSource::IstaTypical) => {
                "iSTA propagated clock timing from extracted parasitics.".to_string()
            }
            _ => "Hierarchy only; insertion timing is not available.".to_string(),
        };
        ui.label(model).on_hover_text(&data.view.diagnostics);
        ui.label(format!(
            "Source model: RC {} · Liberty {} · {:.1}°C",
            rc_corner, liberty_corner, data.view.meta.temperature_c
        ));
        if data.view.clocks.is_empty() {
            ui.label("No clocks in this snapshot.");
            return None;
        }
        self.layout_match_picker(ui, &data.view);
        let previous = self.clock.min(data.view.clocks.len() - 1);
        self.clock = previous;
        egui::ComboBox::from_id_salt("clock_tree_clock")
            .selected_text(&data.view.clocks[self.clock].info.name)
            .show_ui(ui, |ui| {
                for (index, clock) in data.view.clocks.iter().enumerate() {
                    ui.selectable_value(&mut self.clock, index, &clock.info.name);
                }
            });
        if previous != self.clock {
            self.reset_clock();
        }
        let index = &data.view.clocks[self.clock];
        ui.label(format!(
            "{} nodes · {} sinks · {} sinks with timing",
            index.nodes.len(),
            index.summary.sink_count,
            index.summary.valid_sink_count
        ));
        ui.label(format!(
            "Insertion spread: {}",
            measurement(index.summary.skew_ns(), "ns")
        ));
        ui.label(format!(
            "Buffer depth: {}–{}",
            index.summary.min_buffers, index.summary.max_buffers
        ));
        if ui.button("Open clock graph").clicked() {
            self.open = true;
        }
        if self.open && ui.button("Close clock graph").clicked() {
            self.open = false;
        }
        let issue_nodes = index
            .issues
            .iter()
            .filter(|issues| !issues.is_empty())
            .count();
        ui.label(format!("{issue_nodes} nodes with diagnostics"));
        let mut action = None;
        if let Some(status) = &self.location_status {
            ui.colored_label(egui::Color32::YELLOW, status);
        }
        egui::ScrollArea::vertical()
            .id_salt("clock_tree_details")
            .show(ui, |ui| {
                for diagnostic in &index.diagnostics {
                    ui.colored_label(egui::Color32::YELLOW, diagnostic);
                }
                if let Some(selected) = self.selected.filter(|value| *value < index.nodes.len()) {
                    let node = &index.nodes[selected];
                    let stats = &index.stats[selected];
                    ui.separator();
                    ui.strong(&node.name);
                    ui.label(format!("{:?} · {}", node.kind, node.master));
                    ui.label(format!("Insertion: {}", measurement(node.arrival_ns, "ns")));
                    ui.label(format!("Slew: {}", measurement(node.slew_ns, "ns")));
                    ui.label(format!(
                        "Subtree: {} sinks · spread {}",
                        stats.sink_count,
                        measurement(stats.skew_ns(), "ns")
                    ));
                    for issue in &index.issues[selected] {
                        ui.colored_label(egui::Color32::LIGHT_RED, issue);
                    }
                    if node.position_valid {
                        if ui.button("Locate in layout").clicked() {
                            action = Some(LayoutTarget::Node(node.clone()));
                        }
                    } else {
                        ui.colored_label(
                            egui::Color32::YELLOW,
                            "No physical position in this snapshot; layout location is unavailable.",
                        );
                    }
                    ui.collapsing("Timing states", |ui| {
                        if node.timing_states.is_empty() {
                            ui.label("Unavailable");
                        }
                        for state in &node.timing_states {
                            ui.label(format!(
                                "{:?} source / {:?} local · arrival {}, slew {} · {}",
                                state.source_edge,
                                state.local_edge,
                                measurement(state.arrival_ns, "ns"),
                                measurement(state.slew_ns, "ns"),
                                state.scenario
                            ));
                        }
                    });
                    ui.collapsing("Clock nets", |ui| {
                        let mut nets = std::collections::HashSet::new();
                        for &edge_index in &index.edges_for_node[selected] {
                            let edge = &index.edges[edge_index];
                            if (edge.from == selected || edge.to == selected)
                                && !edge.net_name.is_empty()
                                && nets.insert(&edge.net_name)
                            {
                                if ui.link(&edge.net_name).clicked() {
                                    action = Some(LayoutTarget::Net(edge.net_name.clone()));
                                }
                            }
                        }
                    });
                }
            });
        action
    }

    fn layout_match_picker(
        &mut self,
        ui: &mut egui::Ui,
        view: &chip_view_db::clock_tree::ClockTreeView,
    ) {
        if self.pending_layout_matches.is_empty() {
            if let Some(status) = &self.layout_sync_status {
                ui.colored_label(egui::Color32::YELLOW, status);
            }
            return;
        }
        ui.separator();
        ui.colored_label(
            egui::Color32::YELLOW,
            format!(
                "{} clock-tree nodes match the layout selection.",
                self.pending_layout_matches.len()
            ),
        );
        ui.label("Choose the node to synchronize.");
        let labels: Vec<String> = self
            .pending_layout_matches
            .iter()
            .filter_map(|matched| {
                let clock = view.clocks.get(matched.clock)?;
                let node = clock.nodes.get(matched.node)?;
                Some(format!(
                    "{} · {} · {:?}",
                    clock.info.name, node.name, node.kind
                ))
            })
            .collect();
        if labels.is_empty() {
            self.pending_layout_matches.clear();
            self.layout_sync_status = None;
            return;
        }
        let choice = self.pending_layout_choice.min(labels.len() - 1);
        self.pending_layout_choice = choice;
        egui::ComboBox::from_id_salt("clock_tree_layout_match")
            .selected_text(&labels[choice])
            .show_ui(ui, |ui| {
                for (index, label) in labels.iter().enumerate() {
                    ui.selectable_value(&mut self.pending_layout_choice, index, label);
                }
            });
        let chosen = self
            .pending_layout_matches
            .get(self.pending_layout_choice)
            .copied();
        ui.horizontal(|ui| {
            if ui.button("Open match").clicked() {
                if let Some(matched) = chosen {
                    self.apply_layout_match(matched);
                }
            }
            if ui.button("Dismiss").clicked() {
                self.pending_layout_matches.clear();
                self.pending_layout_choice = 0;
                self.layout_sync_status = None;
            }
        });
        if let Some(status) = &self.layout_sync_status {
            ui.label(status);
        }
    }
}
