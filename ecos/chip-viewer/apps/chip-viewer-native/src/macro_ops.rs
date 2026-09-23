//! Planning and queueing of macro placement operations (rotate, mirror,
//! align, distribute).
//!
//! Planners are pure functions over a snapshot of selected macro placements.
//! Each operation is executed as a sequence of single-instance
//! `place_instance` edit commands, one per macro, emitted by the queue pump
//! in `app.rs` after every snapshot reload.

use std::collections::{BTreeSet, VecDeque};

use chipgeom_format::Rect32;

use crate::macro_orient::MacroOrientation;

pub(crate) enum MacroOp {
    Rotate90,
    MirrorHorizontal,
    MirrorVertical,
    CenterOnDie,
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
            MacroOp::MirrorHorizontal => "mirror horizontally",
            MacroOp::MirrorVertical => "mirror vertically",
            MacroOp::CenterOnDie => "center on DIE",
            MacroOp::AlignLeft => "align left",
            MacroOp::AlignRight => "align right",
            MacroOp::AlignTop => "align top",
            MacroOp::AlignBottom => "align bottom",
            MacroOp::DistributeHorizontal => "distribute horizontally",
            MacroOp::DistributeVertical => "distribute vertically",
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct MacroOpBounds {
    pub core: Option<Rect32>,
    pub die: Option<Rect32>,
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
    bounds: MacroOpBounds,
) -> MacroOpPlan {
    match op {
        MacroOp::Rotate90 => orient_op(views, OrientationTransform::Rotate90),
        MacroOp::MirrorHorizontal => orient_op(views, OrientationTransform::MirrorHorizontal),
        MacroOp::MirrorVertical => orient_op(views, OrientationTransform::MirrorVertical),
        MacroOp::CenterOnDie => center_on_die_op(views, bounds),
        MacroOp::AlignLeft => align_op(views, bounds.core, AlignAxis::X, AlignEdge::Min),
        MacroOp::AlignRight => align_op(views, bounds.core, AlignAxis::X, AlignEdge::Max),
        MacroOp::AlignTop => align_op(views, bounds.core, AlignAxis::Y, AlignEdge::Max),
        MacroOp::AlignBottom => align_op(views, bounds.core, AlignAxis::Y, AlignEdge::Min),
        MacroOp::DistributeHorizontal => distribute_op(views, bounds.core, AlignAxis::X),
        MacroOp::DistributeVertical => distribute_op(views, bounds.core, AlignAxis::Y),
    }
}

fn center_on_die_op(
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan {
        moves: Vec::new(),
        skipped: Vec::new(),
    };
    if views.is_empty() {
        return plan;
    }
    let Some(die) = bounds.die else {
        plan.skipped.push((
            "selection".to_string(),
            "DIE boundary is unavailable".to_string(),
        ));
        return plan;
    };
    let Some(core) = bounds.core else {
        plan.skipped.push((
            "selection".to_string(),
            "core boundary is unavailable".to_string(),
        ));
        return plan;
    };

    let selection = views.iter().fold(views[0].bbox, |bounds, view| Rect32 {
        lx: bounds.lx.min(view.bbox.lx),
        ly: bounds.ly.min(view.bbox.ly),
        hx: bounds.hx.max(view.bbox.hx),
        hy: bounds.hy.max(view.bbox.hy),
    });
    let dx = center_delta(die.lx, die.hx, selection.lx, selection.hx);
    let dy = center_delta(die.ly, die.hy, selection.ly, selection.hy);
    let translated = views
        .iter()
        .map(|view| translate_rect(view.bbox, dx, dy).map(|rect| (view, rect)))
        .collect::<Option<Vec<_>>>();
    let Some(translated) = translated else {
        plan.skipped.push((
            "selection".to_string(),
            "centered position exceeds the supported coordinate range".to_string(),
        ));
        return plan;
    };
    if translated
        .iter()
        .any(|(_, rect)| !crate::macro_staging::rect_fits_inside(*rect, core))
    {
        plan.skipped.push((
            "selection".to_string(),
            "centered selection does not fit inside the core".to_string(),
        ));
        return plan;
    }

    plan.moves = translated
        .into_iter()
        .map(|(view, rect)| PlannedMacroMove {
            name: view.name.clone(),
            orient: view.orient,
            rect,
            staged: false,
        })
        .collect();
    plan
}

fn center_delta(target_low: i32, target_high: i32, source_low: i32, source_high: i32) -> i64 {
    let target_sum = target_low as i64 + target_high as i64;
    let source_sum = source_low as i64 + source_high as i64;
    (target_sum - source_sum) / 2
}

fn translate_rect(rect: Rect32, dx: i64, dy: i64) -> Option<Rect32> {
    let coordinate = |value: i32, delta: i64| i32::try_from(value as i64 + delta).ok();
    Some(Rect32 {
        lx: coordinate(rect.lx, dx)?,
        ly: coordinate(rect.ly, dy)?,
        hx: coordinate(rect.hx, dx)?,
        hy: coordinate(rect.hy, dy)?,
    })
}

fn orient_op(
    views: &[crate::macro_staging::MacroPlacementView],
    transform: OrientationTransform,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan {
        moves: Vec::new(),
        skipped: Vec::new(),
    };
    for view in views {
        if !transform.allowed(view.symmetry, view.orient) {
            plan.skipped.push((
                view.name.clone(),
                format!("master symmetry forbids {}", transform.label()),
            ));
            continue;
        }
        let new_orient = transform.apply(view.orient);
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

#[derive(Clone, Copy)]
enum OrientationTransform {
    Rotate90,
    MirrorHorizontal,
    MirrorVertical,
}

impl OrientationTransform {
    fn apply(self, orient: MacroOrientation) -> MacroOrientation {
        match self {
            Self::Rotate90 => orient.rotated_90(),
            Self::MirrorHorizontal => orient.mirrored_y(),
            Self::MirrorVertical => orient.mirrored_x(),
        }
    }

    fn allowed(
        self,
        symmetry: crate::macro_orient::MasterSymmetry,
        orient: MacroOrientation,
    ) -> bool {
        match self {
            Self::Rotate90 => symmetry.rotate_90_allowed(orient),
            Self::MirrorHorizontal => symmetry.mirror_horizontal_allowed(orient),
            Self::MirrorVertical => symmetry.mirror_vertical_allowed(orient),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Rotate90 => "rotation",
            Self::MirrorHorizontal => "horizontal mirroring",
            Self::MirrorVertical => "vertical mirroring",
        }
    }
}

/// First pair of final placements that overlap. Plans are checked as a whole
/// before any local staging mutation or edit command is emitted.
pub(crate) fn planned_move_overlap(
    moves: &[PlannedMacroMove],
) -> Option<(&PlannedMacroMove, &PlannedMacroMove)> {
    for (index, first) in moves.iter().enumerate() {
        for second in &moves[index + 1..] {
            if first.name != second.name
                && crate::macro_staging::rects_overlap(first.rect, second.rect)
            {
                return Some((first, second));
            }
        }
    }
    None
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
    let (lx, hx) = centered_axis(bbox.lx, bbox.hx, width);
    let (ly, hy) = centered_axis(bbox.ly, bbox.hy, height);
    Rect32 { lx, ly, hx, hy }
}

fn centered_axis(low: i32, high: i32, extent: i64) -> (i32, i32) {
    let low = (i64::from(low) + i64::from(high) - extent).div_euclid(2);
    let high = low + extent;
    (
        low.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        high.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    )
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
    pub moving_names: BTreeSet<String>,
}

impl MacroOpQueue {
    pub(crate) fn enqueue(&mut self, moves: Vec<PlannedMacroMove>) {
        self.total = moves.len();
        self.failure = None;
        self.moving_names = moves.iter().map(|item| item.name.clone()).collect();
        self.pending = moves.into();
    }

    pub(crate) fn record_completed(&mut self, total: usize) {
        self.total = total;
        self.pending.clear();
        self.active = None;
        self.failure = None;
        self.moving_names.clear();
    }

    pub(crate) fn pop_head(&mut self) -> Option<PlannedMacroMove> {
        self.pending.pop_front()
    }

    pub(crate) fn abort(&mut self, reason: impl Into<String>) {
        self.pending.clear();
        self.active = None;
        self.moving_names.clear();
        self.failure = Some(reason.into());
    }

    pub(crate) fn finish_if_idle(&mut self) {
        if !self.is_busy() {
            self.moving_names.clear();
        }
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
            MacroOpBounds::default(),
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves.len(), 1);
        assert_eq!(plan.moves[0].orient, MacroOrientation::R90);
        assert_eq!(plan.moves[0].rect, rect(10, -10, 30, 30));
    }

    #[test]
    fn rotate_preserves_odd_master_dimensions() {
        let plan = plan_macro_op(
            &MacroOp::Rotate90,
            &[view("u_a", rect(0, 0, 5, 2), MacroOrientation::R0)],
            MacroOpBounds::default(),
        );

        let rotated = plan.moves[0].rect;
        assert_eq!(rotated.hx - rotated.lx, 2);
        assert_eq!(rotated.hy - rotated.ly, 5);
    }

    #[test]
    fn rotate_is_skipped_when_symmetry_forbids_it() {
        let mut restricted = view("u_b", rect(0, 0, 40, 20), MacroOrientation::R0);
        restricted.symmetry = MasterSymmetry::parse("X,Y");
        let plan = plan_macro_op(&MacroOp::Rotate90, &[restricted], MacroOpBounds::default());

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
            MacroOpBounds::default(),
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves[0].rect, rect(100, 0, 140, 20));
        assert_eq!(plan.moves[1].rect, rect(100, 50, 140, 70));
    }

    #[test]
    fn align_right_top_and_bottom_use_the_matching_physical_edges() {
        let views = [
            view("u_a", rect(10, 20, 30, 40), MacroOrientation::R0),
            view("u_b", rect(50, 60, 80, 90), MacroOrientation::R0),
        ];

        let right = plan_macro_op(&MacroOp::AlignRight, &views, MacroOpBounds::default());
        assert_eq!(right.moves[0].rect, rect(60, 20, 80, 40));
        assert_eq!(right.moves[1].rect, rect(50, 60, 80, 90));

        let top = plan_macro_op(&MacroOp::AlignTop, &views, MacroOpBounds::default());
        assert_eq!(top.moves[0].rect, rect(10, 70, 30, 90));
        assert_eq!(top.moves[1].rect, rect(50, 60, 80, 90));

        let bottom = plan_macro_op(&MacroOp::AlignBottom, &views, MacroOpBounds::default());
        assert_eq!(bottom.moves[0].rect, rect(10, 20, 30, 40));
        assert_eq!(bottom.moves[1].rect, rect(50, 20, 80, 50));
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
            MacroOpBounds {
                core: Some(core),
                die: None,
            },
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
            MacroOpBounds::default(),
        );

        assert!(plan.skipped.is_empty());
        let positions: Vec<i32> = plan.moves.iter().map(|item| item.rect.lx).collect();
        assert_eq!(positions, vec![0, 65, 110]);
        assert_eq!(plan.moves[1].rect, rect(65, 0, 85, 20));
    }

    #[test]
    fn distribute_vertical_equalizes_gaps_between_sorted_items() {
        let plan = plan_macro_op(
            &MacroOp::DistributeVertical,
            &[
                view("u_a", rect(0, 0, 20, 40), MacroOrientation::R0),
                view("u_b", rect(0, 50, 20, 70), MacroOrientation::R0),
                view("u_c", rect(0, 110, 20, 150), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );

        assert!(plan.skipped.is_empty());
        let positions: Vec<i32> = plan.moves.iter().map(|item| item.rect.ly).collect();
        assert_eq!(positions, vec![0, 65, 110]);
    }

    #[test]
    fn horizontal_and_vertical_mirror_apply_distinct_orientations() {
        let mut staged = view("u_a", rect(-40, 0, 0, 20), MacroOrientation::R0);
        staged.staged = true;
        let horizontal = plan_macro_op(
            &MacroOp::MirrorHorizontal,
            &[staged.clone()],
            MacroOpBounds::default(),
        );
        let vertical = plan_macro_op(
            &MacroOp::MirrorVertical,
            &[staged],
            MacroOpBounds::default(),
        );

        assert_eq!(horizontal.moves[0].orient, MacroOrientation::My);
        assert_eq!(vertical.moves[0].orient, MacroOrientation::Mx);
        assert!(horizontal.moves[0].staged && vertical.moves[0].staged);
        assert_eq!(horizontal.moves[0].rect, rect(-40, 0, 0, 20));
        assert_eq!(vertical.moves[0].rect, rect(-40, 0, 0, 20));
    }

    #[test]
    fn mirror_direction_respects_master_symmetry() {
        let mut x_only = view("u_a", rect(0, 0, 40, 20), MacroOrientation::R0);
        x_only.symmetry = MasterSymmetry::parse("X");
        let horizontal = plan_macro_op(
            &MacroOp::MirrorHorizontal,
            &[x_only.clone()],
            MacroOpBounds::default(),
        );
        let vertical = plan_macro_op(
            &MacroOp::MirrorVertical,
            &[x_only],
            MacroOpBounds::default(),
        );

        assert!(horizontal.moves.is_empty());
        assert_eq!(horizontal.skipped.len(), 1);
        assert_eq!(vertical.moves.len(), 1);
    }

    #[test]
    fn center_places_one_macro_at_the_die_center() {
        let die = rect(100, 200, 500, 600);
        let plan = plan_macro_op(
            &MacroOp::CenterOnDie,
            &[view("u_a", rect(0, 0, 40, 20), MacroOrientation::R0)],
            MacroOpBounds {
                core: Some(die),
                die: Some(die),
            },
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves[0].rect, rect(280, 390, 320, 410));
        assert!(!plan.moves[0].staged);
        assert_eq!(MacroOp::CenterOnDie.label(), "center on DIE");
    }

    #[test]
    fn center_handles_negative_half_grid_centers_without_rounding_drift() {
        let die = rect(0, 0, 101, 101);
        let plan = plan_macro_op(
            &MacroOp::CenterOnDie,
            &[view("u_a", rect(-1, -1, 0, 0), MacroOrientation::R0)],
            MacroOpBounds {
                core: Some(die),
                die: Some(die),
            },
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves[0].rect, rect(50, 50, 51, 51));
    }

    #[test]
    fn center_translates_a_staged_group_without_changing_relative_offsets() {
        let die = rect(0, 0, 1000, 1000);
        let mut first = view("u_a", rect(-200, 0, -100, 100), MacroOrientation::R0);
        first.staged = true;
        let mut second = view("u_b", rect(-50, 50, 50, 150), MacroOrientation::R90);
        second.staged = true;
        let plan = plan_macro_op(
            &MacroOp::CenterOnDie,
            &[first, second],
            MacroOpBounds {
                core: Some(die),
                die: Some(die),
            },
        );

        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves[0].rect, rect(375, 425, 475, 525));
        assert_eq!(plan.moves[1].rect, rect(525, 475, 625, 575));
        assert_eq!(plan.moves[1].orient, MacroOrientation::R90);
        assert!(plan.moves.iter().all(|item| !item.staged));
    }

    #[test]
    fn center_rejects_the_whole_group_when_it_does_not_fit_the_core() {
        let plan = plan_macro_op(
            &MacroOp::CenterOnDie,
            &[view("u_a", rect(0, 0, 80, 20), MacroOrientation::R0)],
            MacroOpBounds {
                core: Some(rect(20, 20, 80, 80)),
                die: Some(rect(0, 0, 100, 100)),
            },
        );

        assert!(plan.moves.is_empty());
        assert_eq!(
            plan.skipped,
            vec![(
                "selection".to_string(),
                "centered selection does not fit inside the core".to_string()
            )]
        );
    }

    #[test]
    fn center_requires_die_and_core_boundaries() {
        let selection = [view("u_a", rect(0, 0, 40, 20), MacroOrientation::R0)];
        let without_die = plan_macro_op(
            &MacroOp::CenterOnDie,
            &selection,
            MacroOpBounds {
                core: Some(rect(0, 0, 100, 100)),
                die: None,
            },
        );
        let without_core = plan_macro_op(
            &MacroOp::CenterOnDie,
            &selection,
            MacroOpBounds {
                core: None,
                die: Some(rect(0, 0, 100, 100)),
            },
        );

        assert!(without_die.moves.is_empty());
        assert_eq!(without_die.skipped[0].1, "DIE boundary is unavailable");
        assert!(without_core.moves.is_empty());
        assert_eq!(without_core.skipped[0].1, "core boundary is unavailable");
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
        assert_eq!(
            queue.moving_names,
            BTreeSet::from(["u_a".to_string(), "u_b".to_string()])
        );
        assert!(queue.pop_head().is_some());
        assert_eq!(queue.status(), "macro ops: 1 / 2 applied");
        queue.abort("rejected");
        assert!(!queue.is_busy());
        assert_eq!(queue.status(), "macro ops: rejected");
        assert!(queue.moving_names.is_empty());
    }

    #[test]
    fn final_plan_overlap_reports_the_conflicting_pair() {
        let moves = vec![
            PlannedMacroMove {
                name: "u_a".to_string(),
                orient: MacroOrientation::R0,
                rect: rect(0, 0, 20, 20),
                staged: false,
            },
            PlannedMacroMove {
                name: "u_b".to_string(),
                orient: MacroOrientation::R0,
                rect: rect(10, 10, 30, 30),
                staged: false,
            },
        ];

        let (first, second) = planned_move_overlap(&moves).expect("overlap");
        assert_eq!(
            (&first.name, &second.name),
            (&moves[0].name, &moves[1].name)
        );
    }
}
