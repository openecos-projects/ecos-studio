use std::collections::BTreeSet;

use super::{focus_target_for_shape_ids, LoadedViewer, PendingFocus};
use crate::clock_tree::LayoutTarget;
use chipgeom_format::{OwnerType, Rect32};

impl LoadedViewer {
    pub(super) fn clock_tree_controls(&mut self, ui: &mut egui::Ui) {
        ui.add_space(4.0);
        let names = self
            .selected
            .and_then(|id| self.db.find_shape(id))
            .map(|shape| {
                let owner = self.db.owner_for_shape(shape);
                let name = owner.and_then(|owner| self.db.owner_name(owner));
                let mut names: Vec<String> = name.map(str::to_string).into_iter().collect();
                for endpoint in super::selection_connectivity_endpoints(&self.db, owner, name) {
                    names.push(endpoint.instance_name.clone());
                    names.push(endpoint.pin_name.clone());
                    names.push(endpoint.net_name.clone());
                    if !endpoint.instance_name.is_empty() {
                        names.push(format!("{}/{}", endpoint.instance_name, endpoint.pin_name));
                    }
                }
                names
            })
            .unwrap_or_default();
        let Some(panel) = &mut self.clock_tree else {
            return;
        };
        let action = panel.sidebar(ui);
        panel.sync_layout_selection(self.selected, &names);
        if let Some(target) = action {
            self.focus_clock_target(target);
        }
    }

    pub(super) fn show_clock_tree_graph(&mut self, ctx: &egui::Context) {
        let open = self
            .clock_tree
            .as_ref()
            .is_some_and(|panel| panel.is_open());
        if !open {
            return;
        }
        let action = egui::TopBottomPanel::bottom("clock_tree_graph")
            .resizable(true)
            .default_height(420.0)
            .min_height(220.0)
            .show(ctx, |ui| {
                self.clock_tree
                    .as_mut()
                    .and_then(|panel| panel.graph_ui(ui))
            })
            .inner;
        if let Some(target) = action {
            self.focus_clock_target(target);
        }
    }

    fn net_layout_shapes(&self, name: &str) -> BTreeSet<u64> {
        let mut shapes = self
            .db
            .query_owner_name_for_owner_types(
                name,
                &[OwnerType::NetWireSegment, OwnerType::SpecialWireSegment],
            )
            .into_iter()
            .collect::<BTreeSet<_>>();
        for endpoint in self.db.connectivity_for_net(name) {
            shapes.extend(
                self.db
                    .query_endpoint_pin_name(&endpoint.instance_name, &endpoint.pin_name),
            );
        }
        shapes
    }

    fn focus_clock_target(&mut self, target: LayoutTarget) {
        let (label, shapes, fallback) = match target {
            LayoutTarget::Node { node, net_names } => {
                let fallback = node.position_valid.then_some(Rect32 {
                    lx: node.x_dbu,
                    ly: node.y_dbu,
                    hx: node.x_dbu,
                    hy: node.y_dbu,
                });
                let mut shapes = self
                    .db
                    .query_endpoint_pin_name(&node.instance_name, &node.pin_name)
                    .into_iter()
                    .collect::<BTreeSet<_>>();
                for net_name in net_names {
                    shapes.extend(self.net_layout_shapes(&net_name));
                }
                (node.name.clone(), shapes, fallback)
            }
            LayoutTarget::Net(name) => {
                let shapes = self.net_layout_shapes(&name);
                (name, shapes, None)
            }
        };
        self.highlighted = shapes;
        let focus = focus_target_for_shape_ids(&self.highlighted, |id| {
            self.db.find_shape(id).map(|shape| shape.bbox)
        });
        let located = focus.is_some() || fallback.is_some();
        if let Some(focus) = focus {
            self.selected = focus.select_shape_id;
            self.pending_focus = Some(focus);
        } else if let Some(bbox) = fallback {
            let margin = self
                .db
                .snapshot()
                .manifest()
                .dbu_per_micron
                .unwrap_or(1000)
                .min(i32::MAX as u32) as i32;
            self.pending_focus = Some(PendingFocus {
                bbox: Rect32 {
                    lx: bbox.lx.saturating_sub(margin),
                    ly: bbox.ly.saturating_sub(margin),
                    hx: bbox.hx.saturating_add(margin),
                    hy: bbox.hy.saturating_add(margin),
                },
                select_shape_id: None,
                transition: super::FocusTransition::Animated,
            });
        }
        if let Some(panel) = &mut self.clock_tree {
            panel.set_location_status((!located).then(|| {
                format!("No visible layout shape for {label}; the logical selection is retained.")
            }));
            panel.last_layout_selection = self.selected;
        }
    }
}
