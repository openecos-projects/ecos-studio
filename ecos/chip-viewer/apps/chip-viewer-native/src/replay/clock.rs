//! Completion-only clock networks. Routing is resolved on the loader thread,
//! against the current attempt's frozen geometry, never against another step.
use crate::{replay::data::Recording, timing_route};
use chipgeom_format::{ClockEdgeKind, ClockNodeRecord, ClockTreeStage, CLOCK_NODE_POSITION_VALID};
use chipgeom_reader::ClockTreeSnapshot;
use egui::{Color32, Painter, Pos2, Stroke};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

#[derive(Default)]
pub struct ClockOverlay {
    branches: Vec<Branch>,
    pub missing: usize,
    pub error: String,
}
struct Branch {
    path: Path,
    clock: u32,
    level: u32,
    levels: u32,
}
enum Path {
    Flyline([i64; 2], [i64; 2]),
    Routed(Arc<timing_route::Route>),
}

impl ClockOverlay {
    pub fn load(record: &Recording, tree: &ClockTreeSnapshot) -> Self {
        let routed = match tree.stage() {
            Some(ClockTreeStage::PostFloorplan | ClockTreeStage::Cts) => false,
            Some(ClockTreeStage::Filler) => true,
            _ => return Self::default(),
        };
        let mut resolver = if routed {
            let opened = (|| -> anyhow::Result<_> {
                let path = record
                    .final_geometry_path()?
                    .ok_or_else(|| anyhow::anyhow!("No frozen geometry for routed clock nets"))?;
                Ok(timing_route::Resolver::new(chip_view_db::ChipViewDb::open(
                    path,
                )?))
            })();
            match opened {
                Ok(resolver) => Some(resolver),
                Err(error) => {
                    return Self {
                        error: error.to_string(),
                        ..Self::default()
                    }
                }
            }
        } else {
            None
        };
        Self::from_tree(tree, |a, b| {
            if let Some(resolver) = &mut resolver {
                let a_instance = tree.node_instance(a)?;
                let b_instance = tree.node_instance(b)?;
                let a_pin = full_pin(a_instance, tree.node_pin(a)?);
                let b_pin = full_pin(b_instance, tree.node_pin(b)?);
                resolver
                    .route((&a_pin, a_instance), (&b_pin, b_instance))
                    .map(Path::Routed)
            } else if a.flags & CLOCK_NODE_POSITION_VALID != 0
                && b.flags & CLOCK_NODE_POSITION_VALID != 0
            {
                Some(Path::Flyline(
                    [a.x.into(), a.y.into()],
                    [b.x.into(), b.y.into()],
                ))
            } else {
                None
            }
        })
    }

    fn from_tree(
        tree: &ClockTreeSnapshot,
        mut path: impl FnMut(&ClockNodeRecord, &ClockNodeRecord) -> Option<Path>,
    ) -> Self {
        let nodes: BTreeMap<_, _> = tree.nodes.iter().map(|n| (n.node_id, n)).collect();
        let levels = levels(tree);
        let mut overlay = Self::default();
        let mut max_level = BTreeMap::<u32, u32>::new();
        for edge in &tree.edges {
            if edge.kind != ClockEdgeKind::Net as u8 {
                continue;
            }
            let resolved = (|| {
                let a = nodes.get(&edge.from_node)?;
                let b = nodes.get(&edge.to_node)?;
                let level = *levels.get(&a.node_id)?;
                let path = path(a, b)?;
                Some(Branch {
                    path,
                    clock: a.clock_id,
                    level,
                    levels: 1,
                })
            })();
            if let Some(branch) = resolved {
                let max = max_level.entry(branch.clock).or_default();
                *max = (*max).max(branch.level + 1);
                overlay.branches.push(branch);
            } else {
                overlay.missing += 1;
            }
        }
        for branch in &mut overlay.branches {
            branch.levels = max_level[&branch.clock];
        }
        overlay
    }

    pub fn len(&self) -> usize {
        self.branches.len()
    }

    /// Both canvases consume exactly the same progress and geometry. None is
    /// a flyline at cell height; routed strokes retain their native layer IDs.
    pub fn paint(
        &self,
        painter: &Painter,
        project: impl Fn(i64, i64, Option<u16>) -> Pos2,
        progress: f64,
    ) {
        const COLORS: [Color32; 4] = [
            Color32::from_rgb(74, 237, 244),
            Color32::from_rgb(255, 210, 98),
            Color32::from_rgb(204, 156, 255),
            Color32::from_rgb(127, 245, 166),
        ];
        for branch in &self.branches {
            let fraction = branch.fraction(progress);
            if fraction <= 0.0 {
                continue;
            }
            let color = COLORS[branch.clock as usize % COLORS.len()];
            let mut tip = None;
            let mut draw = |a: Pos2, b: Pos2, part: f32| {
                let end = a.lerp(b, part);
                painter.line_segment([a, end], Stroke::new(4.0, color.gamma_multiply(0.18)));
                painter.line_segment([a, end], Stroke::new(1.5, color));
                tip = Some(end);
            };
            match &branch.path {
                Path::Flyline(a, b) => draw(
                    project(a[0], a[1], None),
                    project(b[0], b[1], None),
                    fraction as f32,
                ),
                Path::Routed(route) => {
                    let mut remaining = route.length * fraction;
                    for stroke in &route.strokes {
                        if remaining <= 0.0 {
                            break;
                        }
                        let length = stroke.length();
                        draw(
                            project(stroke.a.x, stroke.a.y, Some(stroke.a.layer)),
                            project(stroke.b.x, stroke.b.y, Some(stroke.b.layer)),
                            (remaining / length).min(1.0) as f32,
                        );
                        remaining -= length;
                    }
                }
            }
            if let Some(tip) = tip {
                painter.circle_filled(tip, if fraction < 1.0 { 2.8 } else { 1.7 }, color);
            }
        }
    }
}
impl Branch {
    fn fraction(&self, progress: f64) -> f64 {
        (progress.clamp(0.0, 1.0) * f64::from(self.levels) - f64::from(self.level)).clamp(0.0, 1.0)
    }
}
fn full_pin(instance: &str, pin: &str) -> String {
    if instance.is_empty()
        || pin
            .strip_prefix(instance)
            .is_some_and(|p| p.starts_with('/') || p.starts_with(':'))
    {
        pin.to_owned()
    } else {
        format!("{instance}/{pin}")
    }
}

/// Zero/one breadth-first traversal: cell arcs carry connectivity but do not
/// invent internal routing. Multiple roots and cycles are handled deterministically.
fn levels(tree: &ClockTreeSnapshot) -> BTreeMap<u32, u32> {
    let mut outgoing = BTreeMap::<u32, Vec<(u32, u32)>>::new();
    for edge in &tree.edges {
        let weight = match ClockEdgeKind::from_raw(edge.kind) {
            Some(ClockEdgeKind::Net) => 1,
            Some(ClockEdgeKind::Cell) => 0,
            _ => continue,
        };
        outgoing
            .entry(edge.from_node)
            .or_default()
            .push((edge.to_node, weight));
    }
    let mut queue: VecDeque<_> = tree.roots.iter().copied().collect();
    let mut depths: BTreeMap<_, _> = tree.roots.iter().map(|id| (*id, 0)).collect();
    while let Some(id) = queue.pop_front() {
        for &(next, weight) in outgoing.get(&id).into_iter().flatten() {
            let depth = depths[&id] + weight;
            if depths.get(&next).is_none_or(|old| depth < *old) {
                depths.insert(next, depth);
                if weight == 0 {
                    queue.push_front(next);
                } else {
                    queue.push_back(next);
                }
            }
        }
    }
    depths
}

#[cfg(test)]
#[path = "clock_tests.rs"]
mod tests;
