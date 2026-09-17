//! Planning and queueing of macro placement operations (rotate, mirror,
//! align, distribute).
//!
//! Planners are pure functions over a snapshot of selected macro placements.
//! Each operation is executed as a sequence of single-instance
//! `place_instance` edit commands, one per macro, emitted by the queue pump
//! in `app.rs` after every snapshot reload.

use std::collections::VecDeque;

use chipgeom_format::Rect32;

use crate::macro_orient::MacroOrientation;

pub(crate) enum MacroOp {
    Rotate90,
    MirrorY,
    AlignLeft,
    AlignRight,
    AlignTop,
    AlignBottom,
    DistributeHorizontal,
    DistributeVertical,
}

impl MacroOp {
    pub(crate) fn label(&self) -> &'static str {
        match self {
            MacroOp::Rotate90 => "rotate 90°",
            MacroOp::MirrorY => "mirror",
            MacroOp::AlignLeft => "align left",
            MacroOp::AlignRight => "align right",
            MacroOp::AlignTop => "align top",
            MacroOp::AlignBottom => "align bottom",
            MacroOp::DistributeHorizontal => "distribute horizontally",
            MacroOp::DistributeVertical => "distribute vertically",
        }
    }
}

/// One intended final placement produced by a planner.
#[derive(Clone, Debug)]
pub(crate) struct PlannedMacroMove {
    pub name: String,
    pub orient: MacroOrientation,
    pub rect: Rect32,
    pub staged: bool,
}

pub(crate) struct MacroOpPlan {
    pub moves: Vec<PlannedMacroMove>,
    /// Instance name and reason for every macro the planner had to skip.
    pub skipped: Vec<(String, String)>,
}

/// Plans `op` over the selected macro placements. Items that would leave the
/// core or violate their master symmetry are skipped with a reason instead of
/// blocking the rest of the selection.
pub(crate) fn plan_macro_op(
    op: &MacroOp,
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
) -> MacroOpPlan {
    match op {
        MacroOp::Rotate90 => orient_op(views, MacroOrientation::rotated_90, "rotation", false),
        MacroOp::MirrorY => orient_op(views, MacroOrientation::mirrored_y, "mirror", true),
        MacroOp::AlignLeft => align_op(views, core, AlignAxis::X, AlignEdge::Min),
        MacroOp::AlignRight => align_op(views, core, AlignAxis::X, AlignEdge::Max),
        MacroOp::AlignTop => align_op(views, core, AlignAxis::Y, AlignEdge::Min),
        MacroOp::AlignBottom => align_op(views, core, AlignAxis::Y, AlignEdge::Max),
        MacroOp::DistributeHorizontal => distribute_op(views, core, AlignAxis::X),
        MacroOp::DistributeVertical => distribute_op(views, core, AlignAxis::Y),
    }
}

fn orient_op(
    views: &[crate::macro_staging::MacroPlacementView],
    transform: fn(MacroOrientation) -> MacroOrientation,
    action: &str,
    mirror: bool,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan {
        moves: Vec::new(),
        skipped: Vec::new(),
    };
    for view in views {
        let allowed = if mirror {
            view.symmetry.mirror_allowed()
        } else {
            view.symmetry.rotation_allowed()
        };
        if !allowed {
            plan.skipped.push((
                view.name.clone(),
                format!("master symmetry forbids {action}"),
            ));
            continue;
        }
        let new_orient = transform(view.orient);
        let (master_w, master_h) = master_dimensions(view);
        let (new_w, new_h) = new_orient.bbox_size(master_w, master_h);
        plan.moves.push(PlannedMacroMove {
            name: view.name.clone(),
            orient: new_orient,
            rect: center_anchored_rect(view.bbox, new_w, new_h),
            staged: view.staged,
        });
    }
    plan
}

/// Align and distribute operate on placed macros only; staged macros sit
/// outside the core and are skipped with an actionable reason.
fn split_staged<'a>(
    views: &'a [crate::macro_staging::MacroPlacementView],
    plan: &mut MacroOpPlan,
) -> Vec<&'a crate::macro_staging::MacroPlacementView> {
    let mut placed = Vec::new();
    for view in views {
        if view.staged {
            plan.skipped.push((
                view.name.clone(),
                "unplaced; drag it into the core first".to_string(),
            ));
        } else {
            placed.push(view);
        }
    }
    placed
}

fn align_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    axis: AlignAxis,
    edge: AlignEdge,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan {
        moves: Vec::new(),
        skipped: Vec::new(),
    };
    let placed = split_staged(views, &mut plan);
    if placed.len() < 2 {
        return plan;
    }
    let reference = match edge {
        AlignEdge::Min => placed.iter().map(|view| axis.low(view.bbox)).min(),
        AlignEdge::Max => placed.iter().map(|view| axis.high(view.bbox)).max(),
    }
    .expect("len checked");
    for view in placed {
        let rect = align_rect(view.bbox, axis, edge, reference);
        if let Some(core) = core {
            if !crate::macro_staging::rect_fits_inside(rect, core) {
                plan.skipped.push((
                    view.name.clone(),
                    "aligned position leaves the core".to_string(),
                ));
                continue;
            }
        }
        plan.moves.push(PlannedMacroMove {
            name: view.name.clone(),
            orient: view.orient,
            rect,
            staged: false,
        });
    }
    plan
}

fn distribute_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    axis: AlignAxis,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan {
        moves: Vec::new(),
        skipped: Vec::new(),
    };
    let placed = split_staged(views, &mut plan);
    if placed.len() < 3 {
        return plan;
    }
    let mut ordered = placed;
    ordered.sort_by_key(|view| axis.low(view.bbox));
    let first = ordered.first().expect("len checked");
    let last = ordered.last().expect("len checked");
    let span_start = axis.low(first.bbox);
    let span_end = axis.high(last.bbox);
    let extent_sum: i64 = ordered
        .iter()
        .map(|view| axis.high(view.bbox) as i64 - axis.low(view.bbox) as i64)
        .sum();
    let gaps = ordered.len() as i64 - 1;
    let free = (span_end as i64 - span_start as i64) - extent_sum;
    if free < 0 {
        plan.skipped.push((
            "selection".to_string(),
            "macros overlap; distribution needs a positive span".to_string(),
        ));
        return plan;
    }
    let gap = free / gaps;
    let mut cursor = span_start as i64;
    for view in ordered {
        let extent = axis.high(view.bbox) as i64 - axis.low(view.bbox) as i64;
        let rect = axis.with_low(view.bbox, cursor as i32);
        if let Some(core) = core {
            if !crate::macro_staging::rect_fits_inside(rect, core) {
                plan.skipped.push((
                    view.name.clone(),
                    "distributed position leaves the core".to_string(),
                ));
                cursor += extent + gap;
                continue;
            }
        }
        plan.moves.push(PlannedMacroMove {
            name: view.name.clone(),
            orient: view.orient,
            rect,
            staged: false,
        });
        cursor += extent + gap;
    }
    plan
}

#[derive(Clone, Copy)]
enum AlignAxis {
    X,
    Y,
}

impl AlignAxis {
    fn low(self, rect: Rect32) -> i32 {
        match self {
            AlignAxis::X => rect.lx,
            AlignAxis::Y => rect.ly,
        }
    }

    fn high(self, rect: Rect32) -> i32 {
        match self {
            AlignAxis::X => rect.hx,
            AlignAxis::Y => rect.hy,
        }
    }

    fn with_low(self, rect: Rect32, low: i32) -> Rect32 {
        let extent = self.high(rect).saturating_sub(self.low(rect));
        match self {
            AlignAxis::X => Rect32 {
                lx: low,
                hx: low.saturating_add(extent),
                ..rect
            },
            AlignAxis::Y => Rect32 {
                ly: low,
                hy: low.saturating_add(extent),
                ..rect
            },
        }
    }
}

#[derive(Clone, Copy)]
enum AlignEdge {
    Min,
    Max,
}

fn align_rect(rect: Rect32, axis: AlignAxis, edge: AlignEdge, reference: i32) -> Rect32 {
    let extent = axis.high(rect).saturating_sub(axis.low(rect));
    let new_low = match edge {
        AlignEdge::Min => reference,
        AlignEdge::Max => reference.saturating_sub(extent),
    };
    axis.with_low(rect, new_low)
}

/// Master dimensions at R0 derived from a placed bounding box.
fn master_dimensions(view: &crate::macro_staging::MacroPlacementView) -> (i64, i64) {
    let width = view.bbox.hx as i64 - view.bbox.lx as i64;
    let height = view.bbox.hy as i64 - view.bbox.ly as i64;
    if view.orient.swaps_bbox() {
        (height, width)
    } else {
        (width, height)
    }
}

fn center_anchored_rect(bbox: Rect32, width: i64, height: i64) -> Rect32 {
    let center_x = (bbox.lx as i64 + bbox.hx as i64) / 2;
    let center_y = (bbox.ly as i64 + bbox.hy as i64) / 2;
    Rect32 {
        lx: (center_x - width / 2).clamp(i32::MIN as i64, i32::MAX as i64) as i32,
        ly: (center_y - height / 2).clamp(i32::MIN as i64, i32::MAX as i64) as i32,
        hx: (center_x + width / 2).clamp(i32::MIN as i64, i32::MAX as i64) as i32,
        hy: (center_y + height / 2).clamp(i32::MIN as i64, i32::MAX as i64) as i32,
    }
}

/// The command currently awaiting a bridge result, if any.
pub(crate) struct ActiveMacroCommand {
    pub command_id: u64,
    pub name: String,
    pub orient: MacroOrientation,
}

#[derive(Default)]
pub(crate) struct MacroOpQueue {
    pub pending: VecDeque<PlannedMacroMove>,
    pub total: usize,
    pub active: Option<ActiveMacroCommand>,
    pub failure: Option<String>,
}

impl MacroOpQueue {
    pub(crate) fn enqueue(&mut self, moves: Vec<PlannedMacroMove>) {
        self.total = moves.len();
        self.failure = None;
        self.pending = moves.into();
    }

    pub(crate) fn pop_head(&mut self) -> Option<PlannedMacroMove> {
        self.pending.pop_front()
    }

    pub(crate) fn abort(&mut self, reason: impl Into<String>) {
        self.pending.clear();
        self.active = None;
        self.failure = Some(reason.into());
    }

    pub(crate) fn is_busy(&self) -> bool {
        self.active.is_some() || !self.pending.is_empty()
    }

    pub(crate) fn status(&self) -> String {
        if let Some(failure) = &self.failure {
            return format!("macro ops: {failure}");
        }
        if self.total == 0 {
            return "macro ops: idle".to_string();
        }
        let applied = self.total - self.pending.len();
        if !self.pending.is_empty() || self.active.is_some() {
            return format!("macro ops: {applied} / {} applied", self.total);
        }
        format!("macro ops: {} applied", self.total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macro_orient::MasterSymmetry;

    fn view(
        name: &str,
        rect: Rect32,
        orient: MacroOrientation,
    ) -> crate::macro_staging::MacroPlacementView {
        crate::macro_staging::MacroPlacementView {
            name: name.to_string(),
            orient,
            bbox: rect,
            symmetry: MasterSymmetry::parse("X,Y,R90"),
            staged: false,
        }
    }

    fn rect(lx: i32, ly: i32, hx: i32, hy: i32) -> Rect32 {
        Rect32 { lx, ly, hx, hy }
    }

    #[test]
    fn rotate_anchors_the_center_and_swaps_dimensions() {
        let plan = plan_macro_op(
            &MacroOp::Rotate90,
            &[view("u_a", rect(0, 0, 40, 20), MacroOrientation::R0)],
            None,
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves.len(), 1);
        assert_eq!(plan.moves[0].orient, MacroOrientation::R90);
        assert_eq!(plan.moves[0].rect, rect(10, -10, 30, 30));
    }

    #[test]
    fn rotate_is_skipped_when_symmetry_forbids_it() {
        let mut restricted = view("u_b", rect(0, 0, 40, 20), MacroOrientation::R0);
        restricted.symmetry = MasterSymmetry::parse("X,Y");
        let plan = plan_macro_op(&MacroOp::Rotate90, &[restricted], None);

        assert!(plan.moves.is_empty());
        assert_eq!(plan.skipped.len(), 1);
        assert!(plan.skipped[0].1.contains("symmetry"));
    }

    #[test]
    fn align_left_moves_every_selection_to_the_envelope_edge() {
        let plan = plan_macro_op(
            &MacroOp::AlignLeft,
            &[
                view("u_a", rect(100, 0, 140, 20), MacroOrientation::R0),
                view("u_b", rect(200, 50, 240, 70), MacroOrientation::R0),
            ],
            None,
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves[0].rect, rect(100, 0, 140, 20));
        assert_eq!(plan.moves[1].rect, rect(100, 50, 140, 70));
    }

    #[test]
    fn align_skips_staged_and_drops_items_that_would_leave_the_core() {
        let core = rect(0, 0, 200, 200);
        let mut staged = view("u_staged", rect(-1000, 0, -960, 20), MacroOrientation::R0);
        staged.staged = true;
        let plan = plan_macro_op(
            &MacroOp::AlignLeft,
            &[
                staged,
                view("u_a", rect(0, 0, 40, 20), MacroOrientation::R0),
                view("u_b", rect(100, 50, 140, 70), MacroOrientation::R0),
            ],
            Some(core),
        );

        assert_eq!(plan.moves.len(), 2);
        assert_eq!(plan.moves[0].rect, rect(0, 0, 40, 20));
        assert_eq!(plan.moves[1].rect, rect(0, 50, 40, 70));
        assert_eq!(
            plan.skipped,
            vec![(
                "u_staged".to_string(),
                "unplaced; drag it into the core first".to_string()
            )]
        );
    }

    #[test]
    fn distribute_equalizes_gaps_between_sorted_items() {
        let plan = plan_macro_op(
            &MacroOp::DistributeHorizontal,
            &[
                view("u_a", rect(0, 0, 40, 20), MacroOrientation::R0),
                view("u_b", rect(50, 0, 70, 20), MacroOrientation::R0),
                view("u_c", rect(110, 0, 150, 20), MacroOrientation::R0),
            ],
            None,
        );

        assert!(plan.skipped.is_empty());
        let positions: Vec<i32> = plan.moves.iter().map(|item| item.rect.lx).collect();
        assert_eq!(positions, vec![0, 65, 110]);
        assert_eq!(plan.moves[1].rect, rect(65, 0, 85, 20));
    }

    #[test]
    fn queue_tracks_progress_and_failures() {
        let mut queue = MacroOpQueue::default();
        queue.enqueue(vec![
            PlannedMacroMove {
                name: "u_a".to_string(),
                orient: MacroOrientation::R0,
                rect: rect(0, 0, 10, 10),
                staged: false,
            },
            PlannedMacroMove {
                name: "u_b".to_string(),
                orient: MacroOrientation::R0,
                rect: rect(20, 0, 30, 10),
                staged: false,
            },
        ]);
        assert!(queue.is_busy());
        assert!(queue.pop_head().is_some());
        assert_eq!(queue.status(), "macro ops: 1 / 2 applied");
        queue.abort("rejected");
        assert!(!queue.is_busy());
        assert_eq!(queue.status(), "macro ops: rejected");
    }
}
