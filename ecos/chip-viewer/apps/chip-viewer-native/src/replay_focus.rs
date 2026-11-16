//! Resolve tree selections against this recording's exact object names.
use super::ReplayApp;
use crate::clock_tree::LayoutTarget;

impl ReplayApp {
    pub(super) fn focus_bounds(&mut self, [lx, ly, hx, hy]: [i64; 4]) {
        let margin = ((hx - lx).max(hy - ly) / 4).max(1000);
        self.focus = Some([lx - margin, ly - margin, hx + margin, hy + margin]);
        self.zoom = 1.0;
        self.playing = false;
    }

    pub(super) fn focus_clock_target(&mut self, target: LayoutTarget) {
        let Some(recording) = &self.recording else {
            return;
        };
        let (instance, nets, point) = match target {
            LayoutTarget::Node {
                node,
                parent_net_names,
                child_net_names,
                ..
            } => {
                let nets = parent_net_names
                    .into_iter()
                    .chain(child_net_names)
                    .collect::<Vec<_>>();
                let point = node
                    .position_valid
                    .then_some([i64::from(node.x_dbu), i64::from(node.y_dbu)]);
                (Some(node.instance_name), nets, point)
            }
            LayoutTarget::Net(net) => (None, vec![net], None),
        };
        self.selected_objects.clear();
        let mut bounds: Option<[i64; 4]> = None;
        for (id, object) in recording.scene.objects.iter() {
            let instance_match = instance.as_ref().is_some_and(|name| {
                !name.is_empty() && (id == &format!("inst:{name}") || object.name == *name)
            });
            let net_match = matches!(object.kind.as_str(), "wire" | "via")
                && nets
                    .iter()
                    .any(|name| !name.is_empty() && object.name == *name);
            if instance_match || net_match {
                self.selected_objects.insert(id.clone());
                bounds = Some(match bounds {
                    None => object.bbox,
                    Some([lx, ly, hx, hy]) => [
                        lx.min(object.bbox[0]),
                        ly.min(object.bbox[1]),
                        hx.max(object.bbox[2]),
                        hy.max(object.bbox[3]),
                    ],
                });
            }
        }
        if let Some([lx, ly, hx, hy]) = bounds.or_else(|| point.map(|[x, y]| [x, y, x, y])) {
            let margin = ((hx - lx).max(hy - ly) / 4).max(1000);
            self.focus = Some([lx - margin, ly - margin, hx + margin, hy + margin]);
            self.zoom = 1.0;
            self.playing = false;
        }
    }
}
