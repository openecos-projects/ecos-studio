use std::collections::BTreeSet;

use super::{focus_target_for_shape_ids, LoadedViewer, PendingFocus};
use crate::clock_tree::{ClockTreeSelection, LayoutTarget};
use chip_view_db::clock_tree::ClockNode;
use chipgeom_format::{ClockNodeKind, OwnerType, Point32, Rect32, ShapeId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ClockTreeHighlightRole {
    Parent,
    Child,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ClockTreeNodeMarkerKind {
    Parent,
    Child,
    Selected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ClockTreeNodeMarker {
    pub(super) kind: ClockTreeNodeMarkerKind,
    pub(super) position: Point32,
    pub(super) apex_up: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ClockTreeHighlight {
    pub(super) parent_shapes: BTreeSet<ShapeId>,
    pub(super) child_shapes: BTreeSet<ShapeId>,
    pub(super) markers: Vec<ClockTreeNodeMarker>,
}

impl ClockTreeHighlight {
    pub(super) fn role_for(&self, shape_id: ShapeId) -> Option<ClockTreeHighlightRole> {
        if self.parent_shapes.contains(&shape_id) {
            Some(ClockTreeHighlightRole::Parent)
        } else if self.child_shapes.contains(&shape_id) {
            Some(ClockTreeHighlightRole::Child)
        } else {
            None
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ClockTreeOverlay {
    highlight: Option<ClockTreeHighlight>,
    source: Option<ClockTreeSelection>,
}

impl ClockTreeOverlay {
    pub(super) fn highlight(&self) -> Option<&ClockTreeHighlight> {
        self.highlight.as_ref()
    }

    pub(super) fn set(
        &mut self,
        source: ClockTreeSelection,
        highlight: Option<ClockTreeHighlight>,
    ) {
        self.source = highlight.as_ref().map(|_| source);
        self.highlight = highlight;
    }

    pub(super) fn clear(&mut self) {
        self.source = None;
        self.highlight = None;
    }

    /// Clears an overlay that belongs to a previous clock/node selection.
    /// Returns true when stale interaction state was removed.
    pub(super) fn clear_if_stale(&mut self, current: ClockTreeSelection) -> bool {
        if self.highlight.is_some() && self.source != Some(current) {
            self.clear();
            true
        } else {
            false
        }
    }
}

fn marker_for_node(
    node: &ClockNode,
    kind: ClockTreeNodeMarkerKind,
    apex_up: bool,
) -> Option<ClockTreeNodeMarker> {
    node.position_valid.then_some(ClockTreeNodeMarker {
        kind,
        position: Point32 {
            x: node.x_dbu,
            y: node.y_dbu,
        },
        apex_up,
    })
}

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
        let (action, selection) = {
            let Some(panel) = &mut self.clock_tree else {
                return;
            };
            let action = panel.sidebar(ui);
            panel.sync_layout_selection(self.selected, &names);
            (action, panel.selection_key())
        };
        self.clock_tree_overlay.clear_if_stale(selection);
        if let Some(target) = action {
            self.focus_clock_target(target, selection);
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
        let result = egui::TopBottomPanel::bottom("clock_tree_graph")
            .resizable(true)
            .default_height(420.0)
            .min_height(220.0)
            .show(ctx, |ui| {
                let panel = self.clock_tree.as_mut()?;
                let action = panel.graph_ui(ui);
                Some((action, panel.selection_key()))
            })
            .inner;
        if let Some((Some(target), selection)) = result {
            self.focus_clock_target(target, selection);
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

    fn focus_clock_target(&mut self, target: LayoutTarget, selection: ClockTreeSelection) {
        let (label, shapes, selected_shapes, parent_shapes, child_shapes, markers, fallback) =
            match target {
                LayoutTarget::Node {
                    node,
                    parent_net_names,
                    child_net_names,
                    parent_nodes,
                    child_nodes,
                } => {
                    let fallback = node.position_valid.then_some(Rect32 {
                        lx: node.x_dbu,
                        ly: node.y_dbu,
                        hx: node.x_dbu,
                        hy: node.y_dbu,
                    });
                    let selected_shapes = self
                        .db
                        .query_endpoint_pin_name(&node.instance_name, &node.pin_name)
                        .into_iter()
                        .collect::<BTreeSet<_>>();
                    let mut parent_shapes = BTreeSet::new();
                    for net_name in parent_net_names {
                        parent_shapes.extend(self.net_layout_shapes(&net_name));
                    }
                    let mut child_shapes = BTreeSet::new();
                    for net_name in child_net_names {
                        child_shapes.extend(self.net_layout_shapes(&net_name));
                    }
                    parent_shapes.retain(|shape_id| !selected_shapes.contains(shape_id));
                    child_shapes.retain(|shape_id| {
                        !selected_shapes.contains(shape_id) && !parent_shapes.contains(shape_id)
                    });
                    let mut shapes = selected_shapes.clone();
                    shapes.extend(parent_shapes.iter().copied());
                    shapes.extend(child_shapes.iter().copied());
                    let mut markers = parent_nodes
                        .iter()
                        .filter_map(|node| {
                            marker_for_node(node, ClockTreeNodeMarkerKind::Parent, false)
                        })
                        .collect::<Vec<_>>();
                    markers.extend(child_nodes.iter().filter_map(|node| {
                        marker_for_node(node, ClockTreeNodeMarkerKind::Child, true)
                    }));
                    let selected_apex_up = node.sink || node.kind == ClockNodeKind::Sink;
                    markers.extend(marker_for_node(
                        &node,
                        ClockTreeNodeMarkerKind::Selected,
                        selected_apex_up,
                    ));
                    (
                        node.name.clone(),
                        shapes,
                        selected_shapes,
                        parent_shapes,
                        child_shapes,
                        markers,
                        fallback,
                    )
                }
                LayoutTarget::Net(name) => {
                    let shapes = self.net_layout_shapes(&name);
                    (
                        name,
                        shapes,
                        BTreeSet::new(),
                        BTreeSet::new(),
                        BTreeSet::new(),
                        Vec::new(),
                        None,
                    )
                }
            };
        self.highlighted = shapes;
        let highlight =
            (!parent_shapes.is_empty() || !child_shapes.is_empty() || !markers.is_empty())
                .then_some(ClockTreeHighlight {
                    parent_shapes,
                    child_shapes,
                    markers,
                });
        self.clock_tree_overlay.set(selection, highlight);
        let focus = focus_target_for_shape_ids(&self.highlighted, |id| {
            self.db.find_shape(id).map(|shape| shape.bbox)
        })
        .map(|mut focus| {
            if let Some(shape_id) = selected_shapes
                .iter()
                .copied()
                .find(|shape_id| self.db.find_shape(*shape_id).is_some())
            {
                focus.select_shape_id = Some(shape_id);
            }
            focus
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_tree_highlight_prefers_parent_role_for_overlapping_shapes() {
        let highlight = ClockTreeHighlight {
            parent_shapes: BTreeSet::from([10, 20]),
            child_shapes: BTreeSet::from([20, 30]),
            markers: Vec::new(),
        };

        assert_eq!(highlight.role_for(10), Some(ClockTreeHighlightRole::Parent));
        assert_eq!(highlight.role_for(20), Some(ClockTreeHighlightRole::Parent));
        assert_eq!(highlight.role_for(30), Some(ClockTreeHighlightRole::Child));
        assert_eq!(highlight.role_for(40), None);
    }

    #[test]
    fn clock_tree_overlay_clears_when_clock_or_node_selection_changes() {
        let clock_zero = crate::clock_tree::ClockTreeSelection {
            clock: 0,
            node: Some(3),
        };
        let clock_one = crate::clock_tree::ClockTreeSelection {
            clock: 1,
            node: Some(3),
        };
        let node_four = crate::clock_tree::ClockTreeSelection {
            clock: 0,
            node: Some(4),
        };
        let highlight = ClockTreeHighlight {
            parent_shapes: BTreeSet::from([10]),
            child_shapes: BTreeSet::from([20]),
            markers: Vec::new(),
        };
        let mut overlay = ClockTreeOverlay::default();
        overlay.set(clock_zero, Some(highlight.clone()));

        assert!(overlay.highlight().is_some());
        assert!(!overlay.clear_if_stale(clock_zero));
        assert!(overlay.clear_if_stale(clock_one));
        assert!(overlay.highlight().is_none());

        overlay.set(clock_zero, Some(highlight));
        assert!(overlay.clear_if_stale(node_four));
        assert!(overlay.highlight().is_none());
    }
}
