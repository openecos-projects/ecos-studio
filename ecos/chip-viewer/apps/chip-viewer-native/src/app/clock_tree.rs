use super::{focus_target_for_shape_ids, LoadedViewer, PendingFocus};
use crate::clock_tree::LayoutTarget;
use chipgeom_format::{OwnerType, Rect32};

impl LoadedViewer {
    pub(super) fn clock_tree_sidebar(&mut self, ui: &mut egui::Ui) {
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
            .default_height(300.0)
            .min_height(160.0)
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

    fn focus_clock_target(&mut self, target: LayoutTarget) {
        let (label, shapes, fallback) = match target {
            LayoutTarget::Node(node) => {
                let fallback = node.position_valid.then_some(Rect32 {
                    lx: node.x_dbu,
                    ly: node.y_dbu,
                    hx: node.x_dbu,
                    hy: node.y_dbu,
                });
                let mut shapes = self.db.query_pin_name(&node.name);
                if shapes.is_empty() && !node.instance_name.is_empty() {
                    shapes = self.db.query_owner_name_for_owner_types(
                        &node.instance_name,
                        &[OwnerType::InstanceBBox],
                    );
                }
                (node.name.clone(), shapes, fallback)
            }
            LayoutTarget::Net(name) => {
                let mut shapes = self.db.query_owner_name_for_owner_types(
                    &name,
                    &[OwnerType::NetWireSegment, OwnerType::SpecialWireSegment],
                );
                for endpoint in self.db.connectivity_for_net(&name) {
                    let pin = if endpoint.instance_name.is_empty() {
                        endpoint.pin_name.clone()
                    } else {
                        format!("{}/{}", endpoint.instance_name, endpoint.pin_name)
                    };
                    shapes.extend(self.db.query_pin_name(&pin));
                }
                (name, shapes, None)
            }
        };
        self.highlighted = shapes.into_iter().collect();
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
