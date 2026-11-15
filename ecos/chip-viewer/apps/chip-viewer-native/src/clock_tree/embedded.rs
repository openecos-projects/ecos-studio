//! Embed the native hierarchical graph without opening a second graph window.
use super::{graph::GraphHost, ClockData, ClockTreePanel};
use chip_view_db::clock_tree::ClockTreeView;
use chipgeom_reader::ClockTreeSnapshot;
use std::sync::Arc;

impl ClockTreePanel {
    pub(crate) fn from_snapshot(snapshot: &ClockTreeSnapshot) -> anyhow::Result<Self> {
        let mut panel = Self::empty(None);
        panel.data = Some(Arc::new(ClockData {
            view: ClockTreeView::build(snapshot)?,
        }));
        panel.started = true;
        panel.open = true;
        panel.reset_clock();
        Ok(panel)
    }

    pub(crate) fn embedded_ui(&mut self, ui: &mut egui::Ui) {
        let Some(data) = self.data.clone() else {
            return;
        };
        if data.view.clocks.is_empty() {
            ui.label("No clocks in this snapshot.");
            return;
        }
        let previous = self.clock;
        egui::ComboBox::from_id_salt("replay_clock_selection")
            .selected_text(&data.view.clocks[self.clock].info.name)
            .show_ui(ui, |ui| {
                for (index, clock) in data.view.clocks.iter().enumerate() {
                    ui.selectable_value(&mut self.clock, index, &clock.info.name);
                }
            });
        if previous != self.clock {
            self.reset_clock();
        }
        let clock = &data.view.clocks[self.clock];
        ui.small(format!(
            "{} nodes · {} sinks · {}",
            clock.nodes.len(),
            clock.summary.sink_count,
            super::status_label(data.view.status)
        ));
        let _ = self.draw_graph(ui, GraphHost::Embedded);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock_tree::TreeViewMode;
    use chipgeom_format::{
        ClockEdgeRecord, ClockNodeKind, ClockNodeRecord, ClockRecord, ClockTimingRecord,
        ClockTreeStage, CLOCK_NODE_ROOT, CLOCK_NODE_SINK, CLOCK_TIMING_ARRIVAL_VALID,
    };

    fn snapshot(stage: ClockTreeStage, timed: bool) -> ClockTreeSnapshot {
        let mut snapshot = ClockTreeSnapshot::default();
        snapshot.meta.stage = stage as u16;
        snapshot.clocks = vec![ClockRecord {
            clock_id: 0,
            node_count: 2,
            edge_count: 1,
            root_node_count: 1,
            ..Default::default()
        }];
        snapshot.nodes = vec![
            ClockNodeRecord {
                node_id: 0,
                clock_id: 0,
                kind: ClockNodeKind::RootPort as u8,
                flags: CLOCK_NODE_ROOT,
                ..Default::default()
            },
            ClockNodeRecord {
                node_id: 1,
                clock_id: 0,
                kind: ClockNodeKind::Sink as u8,
                flags: CLOCK_NODE_SINK,
                ..Default::default()
            },
        ];
        snapshot.edges = vec![ClockEdgeRecord {
            from_node: 0,
            to_node: 1,
            ..Default::default()
        }];
        snapshot.roots = vec![0];
        if timed {
            snapshot.timing = vec![
                ClockTimingRecord {
                    node_id: 0,
                    flags: CLOCK_TIMING_ARRIVAL_VALID,
                    ..Default::default()
                },
                ClockTimingRecord {
                    node_id: 1,
                    flags: CLOCK_TIMING_ARRIVAL_VALID,
                    arrival_ns: 0.2,
                    ..Default::default()
                },
            ];
        }
        snapshot
    }

    #[test]
    fn replay_clock_graph_uses_stage_appropriate_axis_and_native_layout() {
        for (stage, timed, expected) in [
            (ClockTreeStage::PostFloorplan, true, TreeViewMode::UnitDelay),
            (ClockTreeStage::Cts, true, TreeViewMode::RealDelay),
            (ClockTreeStage::Filler, true, TreeViewMode::RealDelay),
            (ClockTreeStage::Cts, false, TreeViewMode::UnitDelay),
        ] {
            let mut panel = ClockTreePanel::from_snapshot(&snapshot(stage, timed)).unwrap();
            assert_eq!(panel.view_mode, expected);
            let ctx = egui::Context::default();
            let output = ctx.run(
                egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(420.0, 440.0),
                    )),
                    ..Default::default()
                },
                |ctx| {
                    egui::CentralPanel::default().show(ctx, |ui| panel.embedded_ui(ui));
                },
            );
            assert_eq!(panel.rows.len(), 2);
            assert!(panel.rows[0].y < panel.rows[1].y);
            assert!(!output.shapes.is_empty());
            assert!(panel.is_open());
        }
    }
}
