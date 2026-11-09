//! Planning and queueing of macro placement operations.
//!
//! Planners are pure functions over a snapshot of selected macro placements.
//! Each operation is executed as a sequence of single-instance
//! `place_instance` edit commands, one per macro, emitted by the queue pump
//! in `app.rs` after every snapshot reload.

use std::collections::{BTreeSet, VecDeque};

use chipgeom_format::Rect32;
use serde::{Deserialize, Serialize};

use crate::macro_orient::MacroOrientation;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShiftDirection {
    Up,
    Down,
    Left,
    Right,
}

impl ShiftDirection {
    fn delta(self, distance: i64) -> (i64, i64) {
        match self {
            Self::Up => (0, distance),
            Self::Down => (0, -distance),
            Self::Left => (-distance, 0),
            Self::Right => (distance, 0),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Up => "up",
            Self::Down => "down",
            Self::Left => "left",
            Self::Right => "right",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum BoundaryTarget {
    Core,
    Die,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BoundaryEdge {
    Top,
    Right,
    Bottom,
    Left,
}

impl BoundaryEdge {
    fn label(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Right => "right",
            Self::Bottom => "bottom",
            Self::Left => "left",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AlignAxis {
    X,
    Y,
}

impl AlignAxis {
    fn low(self, rect: Rect32) -> i32 {
        match self {
            Self::X => rect.lx,
            Self::Y => rect.ly,
        }
    }

    fn high(self, rect: Rect32) -> i32 {
        match self {
            Self::X => rect.hx,
            Self::Y => rect.hy,
        }
    }

    fn center2(self, rect: Rect32) -> i64 {
        i64::from(self.low(rect)) + i64::from(self.high(rect))
    }

    fn extent(self, rect: Rect32) -> i64 {
        i64::from(self.high(rect)) - i64::from(self.low(rect))
    }

    fn with_low(self, rect: Rect32, low: i32) -> Rect32 {
        let extent = self.high(rect).saturating_sub(self.low(rect));
        match self {
            Self::X => Rect32 {
                lx: low,
                hx: low.saturating_add(extent),
                ..rect
            },
            Self::Y => Rect32 {
                ly: low,
                hy: low.saturating_add(extent),
                ..rect
            },
        }
    }

    fn with_center2(self, rect: Rect32, center2: i64) -> Rect32 {
        let extent = self.extent(rect);
        let low = (center2 - extent).div_euclid(2);
        self.with_low(rect, clamp_i64_to_i32(low))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AlignEdge {
    Min,
    Center,
    Max,
}

impl AlignEdge {
    fn label(self) -> &'static str {
        match self {
            Self::Min => "min",
            Self::Center => "center",
            Self::Max => "max",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum AlignReference {
    SelectionBounds,
    FirstSelected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    fn label(self) -> &'static str {
        match self {
            Self::TopLeft => "top-left",
            Self::TopRight => "top-right",
            Self::BottomLeft => "bottom-left",
            Self::BottomRight => "bottom-right",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MacroTransform {
    RotateCounterClockwise,
    RotateClockwise,
    Rotate180,
    FlipHorizontal,
    FlipVertical,
}

impl MacroTransform {
    fn label(self) -> &'static str {
        match self {
            Self::RotateCounterClockwise => "rotate counter-clockwise",
            Self::RotateClockwise => "rotate clockwise",
            Self::Rotate180 => "rotate 180°",
            Self::FlipHorizontal => "flip horizontally",
            Self::FlipVertical => "flip vertically",
        }
    }

    fn apply(self, orient: MacroOrientation) -> MacroOrientation {
        match self {
            Self::RotateCounterClockwise => orient.rotated_90(),
            Self::RotateClockwise => orient.rotated_90().rotated_90().rotated_90(),
            Self::Rotate180 => orient.rotated_90().rotated_90(),
            Self::FlipHorizontal => orient.mirrored_y(),
            Self::FlipVertical => orient.mirrored_x(),
        }
    }

    fn transform_center2(self, center2: (i64, i64), group_center2: (i64, i64)) -> (i64, i64) {
        let dx = center2.0 - group_center2.0;
        let dy = center2.1 - group_center2.1;
        match self {
            Self::RotateCounterClockwise => (group_center2.0 - dy, group_center2.1 + dx),
            Self::RotateClockwise => (group_center2.0 + dy, group_center2.1 - dx),
            Self::Rotate180 => (group_center2.0 - dx, group_center2.1 - dy),
            Self::FlipHorizontal => (group_center2.0 - dx, group_center2.1 + dy),
            Self::FlipVertical => (group_center2.0 + dx, group_center2.1 - dy),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PackDirection {
    Left,
    Right,
    Bottom,
    Top,
}

impl PackDirection {
    fn axis(self) -> AlignAxis {
        match self {
            Self::Left | Self::Right => AlignAxis::X,
            Self::Bottom | Self::Top => AlignAxis::Y,
        }
    }

    fn toward_high(self) -> bool {
        matches!(self, Self::Right | Self::Top)
    }

    fn label(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Bottom => "bottom",
            Self::Top => "top",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PlacementStatus {
    Placed,
    Fixed,
    Unplaced,
}

impl PlacementStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Placed => "placed",
            Self::Fixed => "fixed",
            Self::Unplaced => "unplaced",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Placed => "Placed",
            Self::Fixed => "Fixed",
            Self::Unplaced => "Unplaced",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "placed" => Some(Self::Placed),
            "fixed" => Some(Self::Fixed),
            "unplaced" => Some(Self::Unplaced),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GridSnap {
    pub origin_x: i32,
    pub origin_y: i32,
    pub step_x: i64,
    pub step_y: i64,
}

impl GridSnap {
    pub(crate) fn snap_rect(self, rect: Rect32) -> Rect32 {
        let width = i64::from(rect.hx) - i64::from(rect.lx);
        let height = i64::from(rect.hy) - i64::from(rect.ly);
        let lx = snap_coordinate(self.origin_x, self.step_x, rect.lx);
        let ly = snap_coordinate(self.origin_y, self.step_y, rect.ly);
        Rect32 {
            lx: clamp_i64_to_i32(lx),
            ly: clamp_i64_to_i32(ly),
            hx: clamp_i64_to_i32(lx + width),
            hy: clamp_i64_to_i32(ly + height),
        }
    }
}

fn snap_coordinate(origin: i32, step: i64, value: i32) -> i64 {
    if step <= 0 {
        return i64::from(value);
    }
    let delta = i64::from(value) - i64::from(origin);
    let quotient = delta.div_euclid(step);
    let remainder = delta.rem_euclid(step);
    let snapped = if remainder.saturating_mul(2) >= step {
        quotient + 1
    } else {
        quotient
    };
    i64::from(origin) + snapped * step
}

pub(crate) enum MacroOp {
    #[cfg(test)]
    Rotate90,
    #[cfg(test)]
    MirrorHorizontal,
    #[cfg(test)]
    MirrorVertical,
    CenterOnDie,
    #[cfg(test)]
    AlignLeft,
    #[cfg(test)]
    AlignRight,
    #[cfg(test)]
    AlignTop,
    #[cfg(test)]
    AlignBottom,
    #[cfg(test)]
    DistributeHorizontal,
    #[cfg(test)]
    DistributeVertical,
    Shift {
        direction: ShiftDirection,
        distance_dbu: i64,
        per_item: bool,
    },
    ShiftToBoundary {
        edge: BoundaryEdge,
        target: BoundaryTarget,
        per_item: bool,
    },
    SpaceToBoundary {
        edge: BoundaryEdge,
        target: BoundaryTarget,
        gap_dbu: i64,
        per_item: bool,
    },
    SpaceFromCenter {
        axis: AlignAxis,
        target: BoundaryTarget,
        gap_dbu: i64,
    },
    SpaceBetween {
        axis: AlignAxis,
        gap_dbu: i64,
    },
    Distribute {
        axis: AlignAxis,
        gap_dbu: Option<i64>,
    },
    Align {
        axis: AlignAxis,
        edge: AlignEdge,
        reference: AlignReference,
    },
    AlignCorner {
        corner: Corner,
        gap_x_dbu: i64,
        gap_y_dbu: i64,
    },
    Transform {
        transform: MacroTransform,
        keep_relative: bool,
    },
    Swap,
    Pack {
        direction: PackDirection,
        gap_dbu: i64,
    },
    Refine {
        gap_dbu: i64,
    },
    Array {
        rows: usize,
        columns: usize,
        gap_x_dbu: i64,
        gap_y_dbu: i64,
    },
    SetPlacementStatus {
        status: PlacementStatus,
    },
}

impl MacroOp {
    pub(crate) fn label(&self) -> String {
        match self {
            #[cfg(test)]
            Self::Rotate90 => "rotate 90° counter-clockwise".to_string(),
            #[cfg(test)]
            Self::MirrorHorizontal => "flip horizontally".to_string(),
            #[cfg(test)]
            Self::MirrorVertical => "flip vertically".to_string(),
            Self::CenterOnDie => "center selection on DIE".to_string(),
            #[cfg(test)]
            Self::AlignLeft => "align left".to_string(),
            #[cfg(test)]
            Self::AlignRight => "align right".to_string(),
            #[cfg(test)]
            Self::AlignTop => "align top".to_string(),
            #[cfg(test)]
            Self::AlignBottom => "align bottom".to_string(),
            #[cfg(test)]
            Self::DistributeHorizontal => "distribute horizontally".to_string(),
            #[cfg(test)]
            Self::DistributeVertical => "distribute vertically".to_string(),
            Self::Shift {
                direction,
                distance_dbu,
                ..
            } => format!("shift {} by {distance_dbu} DBU", direction.label()),
            Self::ShiftToBoundary { edge, target, .. } => {
                format!("shift to {} {}", target_label(*target), edge.label())
            }
            Self::SpaceToBoundary {
                edge,
                target,
                gap_dbu,
                ..
            } => format!(
                "space {gap_dbu} DBU from {} {}",
                target_label(*target),
                edge.label()
            ),
            Self::SpaceFromCenter {
                axis,
                target,
                gap_dbu,
            } => format!(
                "space {gap_dbu} DBU from {} {} center",
                target_label(*target),
                axis_label(*axis)
            ),
            Self::SpaceBetween { axis, gap_dbu } => {
                format!("space {} by {gap_dbu} DBU", axis_label(*axis))
            }
            Self::Distribute { axis, gap_dbu } => match gap_dbu {
                Some(gap) => format!("spread {} with {gap} DBU gap", axis_label(*axis)),
                None => format!("distribute {}", axis_label(*axis)),
            },
            Self::Align { axis, edge, .. } => {
                format!("align {} {}", axis_label(*axis), edge.label())
            }
            Self::AlignCorner { corner, .. } => {
                format!("align selection to {}", corner.label())
            }
            Self::Transform { transform, .. } => transform.label().to_string(),
            Self::Swap => "swap instances".to_string(),
            Self::Pack { direction, gap_dbu } => {
                format!("pack {} with {gap_dbu} DBU gap", direction.label())
            }
            Self::Refine { gap_dbu } => format!("refine placement with {gap_dbu} DBU gap"),
            Self::Array {
                rows,
                columns,
                gap_x_dbu,
                gap_y_dbu,
            } => format!("array {rows}x{columns} with gaps {gap_x_dbu} x {gap_y_dbu} DBU"),
            Self::SetPlacementStatus { status } => {
                format!("set placement status to {}", status.label())
            }
        }
    }

    fn changes_geometry(&self) -> bool {
        !matches!(self, Self::SetPlacementStatus { .. })
    }
}

fn target_label(target: BoundaryTarget) -> &'static str {
    match target {
        BoundaryTarget::Core => "core",
        BoundaryTarget::Die => "die",
    }
}

fn axis_label(axis: AlignAxis) -> &'static str {
    match axis {
        AlignAxis::X => "X",
        AlignAxis::Y => "Y",
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
    pub placement_status: Option<PlacementStatus>,
}

pub(crate) struct MacroOpPlan {
    pub moves: Vec<PlannedMacroMove>,
    /// Instance name and reason for every macro the planner had to skip.
    pub skipped: Vec<(String, String)>,
}

impl MacroOpPlan {
    fn empty() -> Self {
        Self {
            moves: Vec::new(),
            skipped: Vec::new(),
        }
    }

    fn skip_selection(&mut self, reason: impl Into<String>) {
        self.skipped.push(("selection".to_string(), reason.into()));
    }
}

/// Plans `op` over the selected macro placements.
#[cfg(test)]
pub(crate) fn plan_macro_op(
    op: &MacroOp,
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
) -> MacroOpPlan {
    plan_macro_op_with_snap(op, views, bounds, None)
}

/// Plans `op` and applies an optional placement-grid snap to all geometry
/// changes. Status-only changes never alter coordinates.
pub(crate) fn plan_macro_op_with_snap(
    op: &MacroOp,
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
    snap: Option<GridSnap>,
) -> MacroOpPlan {
    let mut plan = match op {
        #[cfg(test)]
        MacroOp::Rotate90 => transform_op(views, MacroTransform::RotateCounterClockwise, false),
        #[cfg(test)]
        MacroOp::MirrorHorizontal => transform_op(views, MacroTransform::FlipHorizontal, false),
        #[cfg(test)]
        MacroOp::MirrorVertical => transform_op(views, MacroTransform::FlipVertical, false),
        MacroOp::CenterOnDie => center_on_die_op(views, bounds),
        #[cfg(test)]
        MacroOp::AlignLeft => align_op(
            views,
            bounds.core,
            AlignAxis::X,
            AlignEdge::Min,
            AlignReference::SelectionBounds,
        ),
        #[cfg(test)]
        MacroOp::AlignRight => align_op(
            views,
            bounds.core,
            AlignAxis::X,
            AlignEdge::Max,
            AlignReference::SelectionBounds,
        ),
        #[cfg(test)]
        MacroOp::AlignTop => align_op(
            views,
            bounds.core,
            AlignAxis::Y,
            AlignEdge::Max,
            AlignReference::SelectionBounds,
        ),
        #[cfg(test)]
        MacroOp::AlignBottom => align_op(
            views,
            bounds.core,
            AlignAxis::Y,
            AlignEdge::Min,
            AlignReference::SelectionBounds,
        ),
        #[cfg(test)]
        MacroOp::DistributeHorizontal => distribute_op_new(views, bounds.core, AlignAxis::X, None),
        #[cfg(test)]
        MacroOp::DistributeVertical => distribute_op_new(views, bounds.core, AlignAxis::Y, None),
        MacroOp::Shift {
            direction,
            distance_dbu,
            per_item,
        } => shift_op(views, *direction, *distance_dbu, *per_item),
        MacroOp::ShiftToBoundary {
            edge,
            target,
            per_item,
        } => shift_to_boundary_op(views, bounds, *edge, *target, *per_item),
        MacroOp::SpaceToBoundary {
            edge,
            target,
            gap_dbu,
            per_item,
        } => space_to_boundary_op(views, bounds, *edge, *target, *gap_dbu, *per_item),
        MacroOp::SpaceFromCenter {
            axis,
            target,
            gap_dbu,
        } => space_from_center_op(views, bounds, *axis, *target, *gap_dbu),
        MacroOp::SpaceBetween { axis, gap_dbu } => {
            space_between_op(views, bounds.core, *axis, *gap_dbu)
        }
        MacroOp::Distribute { axis, gap_dbu } => {
            distribute_op_new(views, bounds.core, *axis, *gap_dbu)
        }
        MacroOp::Align {
            axis,
            edge,
            reference,
        } => align_op(views, bounds.core, *axis, *edge, *reference),
        MacroOp::AlignCorner {
            corner,
            gap_x_dbu,
            gap_y_dbu,
        } => align_corner_op(views, bounds.core, *corner, *gap_x_dbu, *gap_y_dbu),
        MacroOp::Transform {
            transform,
            keep_relative,
        } => transform_op(views, *transform, *keep_relative),
        MacroOp::Swap => swap_op(views, bounds.core),
        MacroOp::Pack { direction, gap_dbu } => pack_op(views, bounds.core, *direction, *gap_dbu),
        MacroOp::Refine { gap_dbu } => refine_op(views, bounds.core, *gap_dbu),
        MacroOp::Array {
            rows,
            columns,
            gap_x_dbu,
            gap_y_dbu,
        } => array_op(views, bounds.core, *rows, *columns, *gap_x_dbu, *gap_y_dbu),
        MacroOp::SetPlacementStatus { status } => set_status_op(views, *status),
    };

    if op.changes_geometry() {
        if let Some(snap) = snap {
            for planned in &mut plan.moves {
                planned.rect = snap.snap_rect(planned.rect);
            }
        }
    }
    plan
}

fn macro_move(
    view: &crate::macro_staging::MacroPlacementView,
    rect: Rect32,
    placement_status: Option<PlacementStatus>,
) -> PlannedMacroMove {
    PlannedMacroMove {
        name: view.name.clone(),
        orient: view.orient,
        rect,
        // Every accepted operation must reach the bridge so that staged
        // placements become part of the uncommitted session and can be saved.
        staged: false,
        placement_status,
    }
}

fn center_on_die_op(
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    if views.is_empty() {
        return plan;
    }
    let Some(die) = bounds.die else {
        plan.skip_selection("DIE boundary is unavailable");
        return plan;
    };
    let Some(core) = bounds.core else {
        plan.skip_selection("core boundary is unavailable");
        return plan;
    };
    let selection = selection_bounds(views).expect("non-empty");
    let dx = center_delta(die.lx, die.hx, selection.lx, selection.hx);
    let dy = center_delta(die.ly, die.hy, selection.ly, selection.hy);
    let Some(translated) = translate_views(views, dx, dy) else {
        plan.skip_selection("centered position exceeds the supported coordinate range");
        return plan;
    };
    if translated
        .iter()
        .any(|(_, rect)| !crate::macro_staging::rect_fits_inside(*rect, core))
    {
        plan.skip_selection("centered selection does not fit inside the core");
        return plan;
    }
    plan.moves = translated
        .into_iter()
        .map(|(view, rect)| macro_move(view, rect, None))
        .collect();
    plan
}

fn shift_op(
    views: &[crate::macro_staging::MacroPlacementView],
    direction: ShiftDirection,
    distance_dbu: i64,
    _per_item: bool,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    if views.is_empty() {
        return plan;
    }
    let distance = distance_dbu.max(0);
    let (dx, dy) = direction.delta(distance);
    let Some(translated) = translate_views(views, dx, dy) else {
        plan.skip_selection("shift exceeds the supported coordinate range");
        return plan;
    };
    plan.moves = translated
        .into_iter()
        .map(|(view, rect)| macro_move(view, rect, None))
        .collect();
    plan
}

fn shift_to_boundary_op(
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
    edge: BoundaryEdge,
    target: BoundaryTarget,
    per_item: bool,
) -> MacroOpPlan {
    space_to_boundary_op(views, bounds, edge, target, 0, per_item)
}

fn space_to_boundary_op(
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
    edge: BoundaryEdge,
    target: BoundaryTarget,
    gap_dbu: i64,
    per_item: bool,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    if views.is_empty() {
        return plan;
    }
    let target_rect = match target {
        BoundaryTarget::Core => bounds.core,
        BoundaryTarget::Die => bounds.die,
    };
    let Some(target_rect) = target_rect else {
        plan.skip_selection(format!("{} boundary is unavailable", target_label(target)));
        return plan;
    };
    let gap = gap_dbu.max(0);
    if per_item {
        for view in views {
            let (dx, dy) = boundary_delta(view.bbox, target_rect, edge, gap);
            let Some(rect) = translate_rect(view.bbox, dx, dy) else {
                plan.skipped.push((
                    view.name.clone(),
                    "boundary position exceeds the supported coordinate range".to_string(),
                ));
                continue;
            };
            plan.moves.push(macro_move(view, rect, None));
        }
        return plan;
    }

    let selection = selection_bounds(views).expect("non-empty");
    if selection_is_too_large(selection, target_rect, edge, gap) {
        plan.skip_selection("selection does not fit inside the requested boundary");
        return plan;
    }
    let (dx, dy) = boundary_delta(selection, target_rect, edge, gap);
    let Some(translated) = translate_views(views, dx, dy) else {
        plan.skip_selection("boundary position exceeds the supported coordinate range");
        return plan;
    };
    plan.moves = translated
        .into_iter()
        .map(|(view, rect)| macro_move(view, rect, None))
        .collect();
    plan
}

fn boundary_delta(rect: Rect32, target: Rect32, edge: BoundaryEdge, gap: i64) -> (i64, i64) {
    match edge {
        BoundaryEdge::Top => (
            0,
            i64::from(target.hy) - i64::from(gap) - i64::from(rect.hy),
        ),
        BoundaryEdge::Right => (
            i64::from(target.hx) - i64::from(gap) - i64::from(rect.hx),
            0,
        ),
        BoundaryEdge::Bottom => (0, i64::from(target.ly) + gap - i64::from(rect.ly)),
        BoundaryEdge::Left => (i64::from(target.lx) + gap - i64::from(rect.lx), 0),
    }
}

fn selection_is_too_large(rect: Rect32, target: Rect32, edge: BoundaryEdge, gap: i64) -> bool {
    match edge {
        BoundaryEdge::Top | BoundaryEdge::Bottom => {
            i64::from(rect.hy - rect.ly) + gap * 2 > i64::from(target.hy - target.ly)
        }
        BoundaryEdge::Right | BoundaryEdge::Left => {
            i64::from(rect.hx - rect.lx) + gap * 2 > i64::from(target.hx - target.lx)
        }
    }
}

fn align_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    axis: AlignAxis,
    edge: AlignEdge,
    reference: AlignReference,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let placed = operable_views(views, core, &mut plan);
    if placed.len() < 2 {
        return plan;
    }
    let reference_rect = match reference {
        AlignReference::FirstSelected => placed.first().expect("len checked").bbox,
        AlignReference::SelectionBounds => selection_bounds_refs(&placed).expect("non-empty"),
    };
    for view in placed {
        let rect = match edge {
            AlignEdge::Min => axis.with_low(view.bbox, axis.low(reference_rect)),
            AlignEdge::Max => axis.with_low(
                view.bbox,
                axis.high(reference_rect)
                    .saturating_sub(axis.extent(view.bbox) as i32),
            ),
            AlignEdge::Center => axis.with_center2(view.bbox, axis.center2(reference_rect)),
        };
        if let Some(core) = core {
            if !crate::macro_staging::rect_fits_inside(rect, core) {
                plan.skipped.push((
                    view.name.clone(),
                    "aligned position leaves the core".to_string(),
                ));
                continue;
            }
        }
        plan.moves.push(macro_move(view, rect, None));
    }
    plan
}

fn align_corner_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    corner: Corner,
    gap_x_dbu: i64,
    gap_y_dbu: i64,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let placed = operable_views(views, core, &mut plan);
    if placed.is_empty() {
        return plan;
    }
    let Some(core) = core else {
        plan.skip_selection("core boundary is unavailable");
        return plan;
    };
    let selection = selection_bounds_refs(&placed).expect("non-empty");
    let width = i64::from(selection.hx) - i64::from(selection.lx);
    let height = i64::from(selection.hy) - i64::from(selection.ly);
    let gap_x = gap_x_dbu.max(0);
    let gap_y = gap_y_dbu.max(0);
    if width + gap_x * 2 > i64::from(core.hx - core.lx)
        || height + gap_y * 2 > i64::from(core.hy - core.ly)
    {
        plan.skip_selection("selection and corner spacing do not fit inside the core");
        return plan;
    }
    let (dx, dy) = match corner {
        Corner::TopLeft => (
            i64::from(core.lx) + gap_x - i64::from(selection.lx),
            i64::from(core.hy) - gap_y - i64::from(selection.hy),
        ),
        Corner::TopRight => (
            i64::from(core.hx) - gap_x - i64::from(selection.hx),
            i64::from(core.hy) - gap_y - i64::from(selection.hy),
        ),
        Corner::BottomLeft => (
            i64::from(core.lx) + gap_x - i64::from(selection.lx),
            i64::from(core.ly) + gap_y - i64::from(selection.ly),
        ),
        Corner::BottomRight => (
            i64::from(core.hx) - gap_x - i64::from(selection.hx),
            i64::from(core.ly) + gap_y - i64::from(selection.ly),
        ),
    };
    let Some(translated) = translate_views(views, dx, dy) else {
        plan.skip_selection("corner position exceeds the supported coordinate range");
        return plan;
    };
    plan.moves = translated
        .into_iter()
        .map(|(view, rect)| macro_move(view, rect, None))
        .collect();
    plan
}

fn space_between_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    axis: AlignAxis,
    gap_dbu: i64,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let placed = operable_views(views, core, &mut plan);
    if placed.len() != 2 || views.len() != 2 {
        plan.skip_selection("space between requires exactly two placed macros");
        return plan;
    }
    let first = placed[0];
    let second = placed[1];
    let gap = gap_dbu.max(0);
    let first_center = axis.center2(first.bbox);
    let second_center = axis.center2(second.bbox);
    let rect = if second_center >= first_center {
        let new_low = i64::from(axis.high(first.bbox)) + gap;
        axis.with_low(second.bbox, clamp_i64_to_i32(new_low))
    } else {
        let new_high = i64::from(axis.low(first.bbox)) - gap;
        axis.with_low(
            second.bbox,
            clamp_i64_to_i32(new_high - axis.extent(second.bbox)),
        )
    };
    if let Some(core) = core {
        if !crate::macro_staging::rect_fits_inside(rect, core) {
            plan.skip_selection("requested spacing leaves the core");
            return plan;
        }
    }
    plan.moves.push(macro_move(second, rect, None));
    // Keep the first item in the plan so queue progress and status handling
    // still describe the complete two-instance operation.
    plan.moves.insert(0, macro_move(first, first.bbox, None));
    plan
}

fn space_from_center_op(
    views: &[crate::macro_staging::MacroPlacementView],
    bounds: MacroOpBounds,
    axis: AlignAxis,
    target: BoundaryTarget,
    gap_dbu: i64,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let target_rect = match target {
        BoundaryTarget::Core => bounds.core,
        BoundaryTarget::Die => bounds.die,
    };
    let Some(target_rect) = target_rect else {
        plan.skip_selection(format!("{} boundary is unavailable", target_label(target)));
        return plan;
    };
    let placed = operable_views(views, bounds.core, &mut plan);
    if placed.len() != 2 || views.len() != 2 {
        plan.skip_selection("space from center requires exactly two placed macros");
        return plan;
    }
    let mut ordered = placed;
    ordered.sort_by_key(|view| axis.center2(view.bbox));
    let center2 = axis.center2(target_rect);
    let gap2 = gap_dbu.max(0) * 2;
    let low_extent = axis.extent(ordered[0].bbox);
    let high_extent = axis.extent(ordered[1].bbox);
    let low = axis.with_center2(ordered[0].bbox, center2 - gap2 - low_extent);
    let high = axis.with_center2(ordered[1].bbox, center2 + gap2 + high_extent);
    plan.moves.push(macro_move(ordered[0], low, None));
    plan.moves.push(macro_move(ordered[1], high, None));
    plan
}

fn distribute_op_new(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    axis: AlignAxis,
    gap_dbu: Option<i64>,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let placed = operable_views(views, core, &mut plan);
    if placed.len() < 3 {
        return plan;
    }
    let mut ordered = placed;
    ordered.sort_by_key(|view| axis.low(view.bbox));
    let span_start = axis.low(ordered[0].bbox);
    let span_end = axis.high(ordered.last().expect("non-empty").bbox);
    let extent_sum: i64 = ordered.iter().map(|view| axis.extent(view.bbox)).sum();
    let gaps = ordered.len() as i64 - 1;
    let free = i64::from(span_end) - i64::from(span_start) - extent_sum;
    let gap = match gap_dbu {
        Some(gap) => gap.max(0),
        None if free < 0 => {
            plan.skip_selection("macros overlap; distribution needs a positive span");
            return plan;
        }
        None => free / gaps,
    };
    if gap_dbu.is_some() && i64::from(span_start) + extent_sum + gap * gaps > i64::from(span_end) {
        // Fixed-gap spread may intentionally extend beyond the original span;
        // only Core containment is a hard failure.
    }
    let mut cursor = i64::from(span_start);
    for view in ordered {
        let extent = axis.extent(view.bbox);
        let rect = axis.with_low(view.bbox, clamp_i64_to_i32(cursor));
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
        plan.moves.push(macro_move(view, rect, None));
        cursor += extent + gap;
    }
    plan
}

fn transform_op(
    views: &[crate::macro_staging::MacroPlacementView],
    transform: MacroTransform,
    keep_relative: bool,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let group_center2 = selection_bounds(views).map(|bounds| {
        (
            i64::from(bounds.lx) + i64::from(bounds.hx),
            i64::from(bounds.ly) + i64::from(bounds.hy),
        )
    });
    for view in views {
        let new_orient = transform.apply(view.orient);
        if !view.symmetry.allows_orientation(new_orient) {
            plan.skipped.push((
                view.name.clone(),
                format!("master symmetry forbids {}", transform.label()),
            ));
            continue;
        }
        let (master_w, master_h) = master_dimensions(view);
        let (new_w, new_h) = new_orient.bbox_size(master_w, master_h);
        let rect = if keep_relative && views.len() > 1 {
            let group_center2 = group_center2.expect("non-empty");
            let center2 = (
                i64::from(view.bbox.lx) + i64::from(view.bbox.hx),
                i64::from(view.bbox.ly) + i64::from(view.bbox.hy),
            );
            let transformed = transform.transform_center2(center2, group_center2);
            rect_from_center2(transformed.0, transformed.1, new_w, new_h)
        } else {
            center_anchored_rect(view.bbox, new_w, new_h)
        };
        let mut moved = macro_move(view, rect, None);
        moved.orient = new_orient;
        plan.moves.push(moved);
    }
    plan
}

fn swap_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let placed = operable_views(views, core, &mut plan);
    if placed.len() != 2 || views.len() != 2 {
        plan.skip_selection("swap requires exactly two placed macros");
        return plan;
    }
    let first = placed[0];
    let second = placed[1];
    let first_center = bbox_center2(first.bbox);
    let second_center = bbox_center2(second.bbox);
    let (first_w, first_h) = master_dimensions(first);
    let (second_w, second_h) = master_dimensions(second);
    let first_rect = rect_from_center2(second_center.0, second_center.1, first_w, first_h);
    let second_rect = rect_from_center2(first_center.0, first_center.1, second_w, second_h);
    plan.moves.push(macro_move(first, first_rect, None));
    plan.moves.push(macro_move(second, second_rect, None));
    plan
}

fn pack_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    direction: PackDirection,
    gap_dbu: i64,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let placed = operable_views(views, core, &mut plan);
    if placed.len() < 2 {
        return plan;
    }
    let axis = direction.axis();
    let envelope = selection_bounds_refs(&placed).expect("non-empty");
    let gap = gap_dbu.max(0);
    let mut ordered = placed;
    ordered.sort_by_key(|view| {
        if direction.toward_high() {
            -i64::from(axis.high(view.bbox))
        } else {
            i64::from(axis.low(view.bbox))
        }
    });
    let mut cursor = if direction.toward_high() {
        i64::from(axis.high(envelope))
    } else {
        i64::from(axis.low(envelope))
    };
    for view in ordered {
        let extent = axis.extent(view.bbox);
        let rect = if direction.toward_high() {
            let high = cursor;
            let low = high - extent;
            cursor = low - gap;
            axis.with_low(view.bbox, clamp_i64_to_i32(low))
        } else {
            let low = cursor;
            cursor = low + extent + gap;
            axis.with_low(view.bbox, clamp_i64_to_i32(low))
        };
        plan.moves.push(macro_move(view, rect, None));
    }
    plan
}

fn refine_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    gap_dbu: i64,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    let Some(core) = core else {
        plan.skip_selection("core boundary is unavailable");
        return plan;
    };
    let placed = operable_views(views, Some(core), &mut plan);
    if placed.len() < 2 {
        return plan;
    }
    let gap = gap_dbu.max(0);
    let mut ordered = placed;
    ordered.sort_by_key(|view| (view.bbox.ly, view.bbox.lx));
    let mut resolved: Vec<Rect32> = Vec::new();
    for view in ordered {
        let mut base = if crate::macro_staging::rect_fits_inside(view.bbox, core) {
            view.bbox
        } else {
            crate::macro_staging::clamp_rect_into(view.bbox, core)
        };
        if resolved
            .iter()
            .any(|other| rects_conflict(base, *other, gap))
        {
            let mut candidates = Vec::new();
            for other in &resolved {
                candidates.extend(candidate_positions(base, *other, gap));
            }
            candidates.push(base);
            let original_center = bbox_center2(view.bbox);
            let best = candidates
                .into_iter()
                .filter(|candidate| crate::macro_staging::rect_fits_inside(*candidate, core))
                .filter(|candidate| {
                    !resolved
                        .iter()
                        .any(|other| rects_conflict(*candidate, *other, gap))
                })
                .min_by_key(|candidate| center_distance_squared(*candidate, original_center));
            let Some(best) = best else {
                plan.skipped.push((
                    view.name.clone(),
                    "no legal position found during refinement".to_string(),
                ));
                continue;
            };
            base = best;
        }
        resolved.push(base);
        plan.moves.push(macro_move(view, base, None));
    }
    plan
}

fn candidate_positions(rect: Rect32, obstacle: Rect32, gap: i64) -> [Rect32; 4] {
    let width = i32::from(rect.hx.saturating_sub(rect.lx));
    let height = i32::from(rect.hy.saturating_sub(rect.ly));
    [
        Rect32 {
            lx: clamp_i64_to_i32(i64::from(obstacle.hx) + gap),
            ly: rect.ly,
            hx: clamp_i64_to_i32(i64::from(obstacle.hx) + gap + i64::from(width)),
            hy: rect.hy,
        },
        Rect32 {
            lx: clamp_i64_to_i32(i64::from(obstacle.lx) - gap - i64::from(width)),
            ly: rect.ly,
            hx: clamp_i64_to_i32(i64::from(obstacle.lx) - gap),
            hy: rect.hy,
        },
        Rect32 {
            lx: rect.lx,
            ly: clamp_i64_to_i32(i64::from(obstacle.hy) + gap),
            hx: rect.hx,
            hy: clamp_i64_to_i32(i64::from(obstacle.hy) + gap + i64::from(height)),
        },
        Rect32 {
            lx: rect.lx,
            ly: clamp_i64_to_i32(i64::from(obstacle.ly) - gap - i64::from(height)),
            hx: rect.hx,
            hy: clamp_i64_to_i32(i64::from(obstacle.ly) - gap),
        },
    ]
}

fn rects_conflict(first: Rect32, second: Rect32, gap: i64) -> bool {
    first.lx < second.hx.saturating_add(clamp_i64_to_i32(gap))
        && second.lx < first.hx.saturating_add(clamp_i64_to_i32(gap))
        && first.ly < second.hy.saturating_add(clamp_i64_to_i32(gap))
        && second.ly < first.hy.saturating_add(clamp_i64_to_i32(gap))
}

fn array_op(
    views: &[crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    rows: usize,
    columns: usize,
    gap_x_dbu: i64,
    gap_y_dbu: i64,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    if rows == 0 || columns == 0 {
        plan.skip_selection("array rows and columns must be greater than zero");
        return plan;
    }
    let capacity = rows.saturating_mul(columns);
    let placed = operable_views(views, core, &mut plan);
    if placed.len() < capacity {
        plan.skip_selection(format!(
            "array requires {capacity} selected macros; found {}",
            placed.len()
        ));
        return plan;
    }
    if placed.len() > capacity {
        for view in &placed[capacity..] {
            plan.skipped.push((
                view.name.clone(),
                "not used because the array is already full".to_string(),
            ));
        }
    }
    let use_views = &placed[..capacity];
    let envelope = selection_bounds_refs(use_views).expect("capacity checked");
    let mut column_widths = vec![0i64; columns];
    let mut row_heights = vec![0i64; rows];
    for (index, view) in use_views.iter().enumerate() {
        let row = index / columns;
        let column = index % columns;
        column_widths[column] = column_widths[column].max(AlignAxis::X.extent(view.bbox));
        row_heights[row] = row_heights[row].max(AlignAxis::Y.extent(view.bbox));
    }
    let gap_x = gap_x_dbu.max(0);
    let gap_y = gap_y_dbu.max(0);
    let mut column_x = Vec::with_capacity(columns);
    let mut x = i64::from(envelope.lx);
    for width in &column_widths {
        column_x.push(x);
        x += width + gap_x;
    }
    let mut row_y = Vec::with_capacity(rows);
    let mut y = i64::from(envelope.ly);
    for height in &row_heights {
        row_y.push(y);
        y += height + gap_y;
    }
    for (index, view) in use_views.iter().enumerate() {
        let row = index / columns;
        let column = index % columns;
        let rect = Rect32 {
            lx: clamp_i64_to_i32(column_x[column]),
            ly: clamp_i64_to_i32(row_y[row]),
            hx: clamp_i64_to_i32(column_x[column] + AlignAxis::X.extent(view.bbox)),
            hy: clamp_i64_to_i32(row_y[row] + AlignAxis::Y.extent(view.bbox)),
        };
        plan.moves.push(macro_move(view, rect, None));
    }
    plan
}

fn set_status_op(
    views: &[crate::macro_staging::MacroPlacementView],
    status: PlacementStatus,
) -> MacroOpPlan {
    let mut plan = MacroOpPlan::empty();
    plan.moves = views
        .iter()
        .map(|view| macro_move(view, view.bbox, Some(status)))
        .collect();
    plan
}

fn operable_views<'a>(
    views: &'a [crate::macro_staging::MacroPlacementView],
    core: Option<Rect32>,
    plan: &mut MacroOpPlan,
) -> Vec<&'a crate::macro_staging::MacroPlacementView> {
    let mut operable = Vec::new();
    for view in views {
        if view.staged
            && core.is_some_and(|core| !crate::macro_staging::rect_fits_inside(view.bbox, core))
        {
            plan.skipped.push((
                view.name.clone(),
                "unplaced; drag it into the core first".to_string(),
            ));
        } else {
            operable.push(view);
        }
    }
    operable
}

fn selection_bounds(views: &[crate::macro_staging::MacroPlacementView]) -> Option<Rect32> {
    views
        .iter()
        .map(|view| view.bbox)
        .reduce(|mut bounds, rect| {
            bounds.include(rect);
            bounds
        })
}

fn selection_bounds_refs(views: &[&crate::macro_staging::MacroPlacementView]) -> Option<Rect32> {
    views
        .iter()
        .map(|view| view.bbox)
        .reduce(|mut bounds, rect| {
            bounds.include(rect);
            bounds
        })
}

fn center_delta(target_low: i32, target_high: i32, source_low: i32, source_high: i32) -> i64 {
    let target_sum = i64::from(target_low) + i64::from(target_high);
    let source_sum = i64::from(source_low) + i64::from(source_high);
    (target_sum - source_sum) / 2
}

fn translate_views(
    views: &[crate::macro_staging::MacroPlacementView],
    dx: i64,
    dy: i64,
) -> Option<Vec<(&crate::macro_staging::MacroPlacementView, Rect32)>> {
    views
        .iter()
        .map(|view| translate_rect(view.bbox, dx, dy).map(|rect| (view, rect)))
        .collect()
}

fn translate_rect(rect: Rect32, dx: i64, dy: i64) -> Option<Rect32> {
    let coordinate = |value: i32, delta: i64| i32::try_from(i64::from(value) + delta).ok();
    Some(Rect32 {
        lx: coordinate(rect.lx, dx)?,
        ly: coordinate(rect.ly, dy)?,
        hx: coordinate(rect.hx, dx)?,
        hy: coordinate(rect.hy, dy)?,
    })
}

fn master_dimensions(view: &crate::macro_staging::MacroPlacementView) -> (i64, i64) {
    let width = i64::from(view.bbox.hx) - i64::from(view.bbox.lx);
    let height = i64::from(view.bbox.hy) - i64::from(view.bbox.ly);
    if view.orient.swaps_bbox() {
        (height, width)
    } else {
        (width, height)
    }
}

fn center_anchored_rect(bbox: Rect32, width: i64, height: i64) -> Rect32 {
    rect_from_center2(
        i64::from(bbox.lx) + i64::from(bbox.hx),
        i64::from(bbox.ly) + i64::from(bbox.hy),
        width,
        height,
    )
}

fn rect_from_center2(center2_x: i64, center2_y: i64, width: i64, height: i64) -> Rect32 {
    let lx = (center2_x - width).div_euclid(2);
    let ly = (center2_y - height).div_euclid(2);
    Rect32 {
        lx: clamp_i64_to_i32(lx),
        ly: clamp_i64_to_i32(ly),
        hx: clamp_i64_to_i32(lx + width),
        hy: clamp_i64_to_i32(ly + height),
    }
}

fn bbox_center2(rect: Rect32) -> (i64, i64) {
    (
        i64::from(rect.lx) + i64::from(rect.hx),
        i64::from(rect.ly) + i64::from(rect.hy),
    )
}

fn center_distance_squared(rect: Rect32, original_center2: (i64, i64)) -> i128 {
    let center = bbox_center2(rect);
    let dx = i128::from(center.0 - original_center2.0);
    let dy = i128::from(center.1 - original_center2.1);
    dx * dx + dy * dy
}

fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
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

/// The command currently awaiting a bridge result, if any.
pub(crate) struct ActiveMacroCommand {
    pub command_id: u64,
    pub name: String,
    pub orient: MacroOrientation,
    pub placement_status: Option<PlacementStatus>,
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

    #[cfg(test)]
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
    fn keep_relative_rotation_orbits_the_group_center() {
        let plan = plan_macro_op(
            &MacroOp::Transform {
                transform: MacroTransform::RotateCounterClockwise,
                keep_relative: true,
            },
            &[
                view("u_a", rect(0, 0, 20, 10), MacroOrientation::R0),
                view("u_b", rect(40, 0, 60, 10), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert!(plan.skipped.is_empty());
        assert_eq!(plan.moves[0].rect, rect(25, -25, 35, -5));
        assert_eq!(plan.moves[1].rect, rect(25, 15, 35, 35));
    }

    #[test]
    fn align_center_uses_first_selected_reference() {
        let plan = plan_macro_op(
            &MacroOp::Align {
                axis: AlignAxis::X,
                edge: AlignEdge::Center,
                reference: AlignReference::FirstSelected,
            },
            &[
                view("first", rect(0, 0, 20, 10), MacroOrientation::R0),
                view("second", rect(100, 20, 140, 30), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(0, 0, 20, 10));
        assert_eq!(plan.moves[1].rect, rect(-10, 20, 30, 30));
    }

    #[test]
    fn shift_moves_a_group_without_changing_offsets() {
        let plan = plan_macro_op(
            &MacroOp::Shift {
                direction: ShiftDirection::Right,
                distance_dbu: 25,
                per_item: false,
            },
            &[
                view("u_a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("u_b", rect(20, 5, 30, 15), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(25, 0, 35, 10));
        assert_eq!(plan.moves[1].rect, rect(45, 5, 55, 15));
    }

    #[test]
    fn shift_to_core_right_edge_uses_the_group_envelope() {
        let plan = plan_macro_op(
            &MacroOp::ShiftToBoundary {
                edge: BoundaryEdge::Right,
                target: BoundaryTarget::Core,
                per_item: false,
            },
            &[
                view("u_a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("u_b", rect(20, 5, 30, 15), MacroOrientation::R0),
            ],
            MacroOpBounds {
                core: Some(rect(0, 0, 100, 100)),
                die: Some(rect(0, 0, 120, 120)),
            },
        );
        assert_eq!(plan.moves[0].rect, rect(70, 0, 80, 10));
        assert_eq!(plan.moves[1].rect, rect(90, 5, 100, 15));
    }

    #[test]
    fn space_between_keeps_the_first_selected_macro_fixed() {
        let plan = plan_macro_op(
            &MacroOp::SpaceBetween {
                axis: AlignAxis::X,
                gap_dbu: 15,
            },
            &[
                view("first", rect(0, 0, 20, 20), MacroOrientation::R0),
                view("second", rect(40, 0, 60, 20), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(0, 0, 20, 20));
        assert_eq!(plan.moves[1].rect, rect(35, 0, 55, 20));
    }

    #[test]
    fn fixed_gap_distribution_preserves_the_leading_edge() {
        let plan = plan_macro_op(
            &MacroOp::Distribute {
                axis: AlignAxis::X,
                gap_dbu: Some(5),
            },
            &[
                view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("b", rect(30, 0, 50, 10), MacroOrientation::R0),
                view("c", rect(100, 0, 120, 10), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(0, 0, 10, 10));
        assert_eq!(plan.moves[1].rect, rect(15, 0, 35, 10));
        assert_eq!(plan.moves[2].rect, rect(40, 0, 60, 10));
    }

    #[test]
    fn equal_distribution_preserves_the_outer_span() {
        let plan = plan_macro_op(
            &MacroOp::Distribute {
                axis: AlignAxis::X,
                gap_dbu: None,
            },
            &[
                view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("b", rect(30, 0, 50, 10), MacroOrientation::R0),
                view("c", rect(100, 0, 120, 10), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(0, 0, 10, 10));
        assert_eq!(plan.moves[1].rect, rect(45, 0, 65, 10));
        assert_eq!(plan.moves[2].rect, rect(100, 0, 120, 10));
    }

    #[test]
    fn space_from_center_places_two_macros_symmetrically() {
        let bounds = MacroOpBounds {
            core: Some(rect(0, 0, 1_000, 1_000)),
            die: Some(rect(0, 0, 1_200, 1_200)),
        };
        let horizontal = plan_macro_op(
            &MacroOp::SpaceFromCenter {
                axis: AlignAxis::X,
                target: BoundaryTarget::Core,
                gap_dbu: 10,
            },
            &[
                view("left", rect(100, 0, 200, 20), MacroOrientation::R0),
                view("right", rect(700, 0, 800, 20), MacroOrientation::R0),
            ],
            bounds,
        );
        assert_eq!(horizontal.moves[0].rect, rect(390, 0, 490, 20));
        assert_eq!(horizontal.moves[1].rect, rect(510, 0, 610, 20));

        let vertical = plan_macro_op(
            &MacroOp::SpaceFromCenter {
                axis: AlignAxis::Y,
                target: BoundaryTarget::Core,
                gap_dbu: 20,
            },
            &[
                view("bottom", rect(0, 100, 20, 200), MacroOrientation::R0),
                view("top", rect(0, 700, 20, 800), MacroOrientation::R0),
            ],
            bounds,
        );
        assert_eq!(vertical.moves[0].rect, rect(0, 380, 20, 480));
        assert_eq!(vertical.moves[1].rect, rect(0, 520, 20, 620));
    }

    #[test]
    fn corner_alignment_uses_core_and_xy_spacing() {
        let plan = plan_macro_op(
            &MacroOp::AlignCorner {
                corner: Corner::BottomRight,
                gap_x_dbu: 7,
                gap_y_dbu: 11,
            },
            &[view("a", rect(0, 0, 40, 20), MacroOrientation::R0)],
            MacroOpBounds {
                core: Some(rect(0, 0, 100, 100)),
                die: Some(rect(0, 0, 120, 120)),
            },
        );
        assert_eq!(plan.moves[0].rect, rect(53, 11, 93, 31));
    }

    #[test]
    fn space_to_core_top_applies_the_requested_gap_to_the_group() {
        let core = rect(0, 0, 200, 200);
        let plan = plan_macro_op(
            &MacroOp::SpaceToBoundary {
                edge: BoundaryEdge::Top,
                target: BoundaryTarget::Core,
                gap_dbu: 10,
                per_item: false,
            },
            &[
                view("a", rect(10, 20, 30, 40), MacroOrientation::R0),
                view("b", rect(50, 60, 90, 100), MacroOrientation::R0),
            ],
            MacroOpBounds {
                core: Some(core),
                die: Some(rect(0, 0, 220, 220)),
            },
        );
        assert_eq!(plan.moves[0].rect, rect(10, 110, 30, 130));
        assert_eq!(plan.moves[1].rect, rect(50, 150, 90, 190));
    }

    #[test]
    fn clockwise_and_180_transforms_map_orientations() {
        let original = view("a", rect(0, 0, 40, 20), MacroOrientation::R0);
        let clockwise = plan_macro_op(
            &MacroOp::Transform {
                transform: MacroTransform::RotateClockwise,
                keep_relative: false,
            },
            std::slice::from_ref(&original),
            MacroOpBounds::default(),
        );
        let half_turn = plan_macro_op(
            &MacroOp::Transform {
                transform: MacroTransform::Rotate180,
                keep_relative: false,
            },
            &[original],
            MacroOpBounds::default(),
        );
        assert_eq!(clockwise.moves[0].orient, MacroOrientation::R270);
        assert_eq!(clockwise.moves[0].rect, rect(10, -10, 30, 30));
        assert_eq!(half_turn.moves[0].orient, MacroOrientation::R180);
        assert_eq!(half_turn.moves[0].rect, rect(0, 0, 40, 20));
    }

    #[test]
    fn pack_bottom_orders_by_vertical_position() {
        let plan = plan_macro_op(
            &MacroOp::Pack {
                direction: PackDirection::Bottom,
                gap_dbu: 2,
            },
            &[
                view("high", rect(40, 100, 60, 120), MacroOrientation::R0),
                view("low", rect(0, 10, 20, 30), MacroOrientation::R0),
                view("middle", rect(80, 50, 100, 70), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        let by_name = |name: &str| {
            plan.moves
                .iter()
                .find(|item| item.name == name)
                .expect("move")
                .rect
        };
        assert_eq!(by_name("low"), rect(0, 10, 20, 30));
        assert_eq!(by_name("middle"), rect(80, 32, 100, 52));
        assert_eq!(by_name("high"), rect(40, 54, 60, 74));
    }

    #[test]
    fn swap_requires_exactly_two_operable_macros() {
        let plan = plan_macro_op(
            &MacroOp::Swap,
            &[view("a", rect(0, 0, 10, 10), MacroOrientation::R0)],
            MacroOpBounds::default(),
        );
        assert!(plan.moves.is_empty());
        assert_eq!(plan.skipped[0].0, "selection");
    }

    #[test]
    fn swap_exchanges_centers_for_different_sizes() {
        let plan = plan_macro_op(
            &MacroOp::Swap,
            &[
                view("a", rect(0, 0, 20, 10), MacroOrientation::R0),
                view("b", rect(100, 100, 140, 130), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(110, 110, 130, 120));
        assert_eq!(plan.moves[1].rect, rect(-10, -10, 30, 20));
    }

    #[test]
    fn pack_right_collapses_gaps_toward_the_selection_high_edge() {
        let plan = plan_macro_op(
            &MacroOp::Pack {
                direction: PackDirection::Right,
                gap_dbu: 5,
            },
            &[
                view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("b", rect(30, 20, 50, 30), MacroOrientation::R0),
                view("c", rect(100, 40, 130, 50), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        let by_name = |name: &str| {
            plan.moves
                .iter()
                .find(|item| item.name == name)
                .expect("move")
                .rect
        };
        assert_eq!(by_name("c"), rect(100, 40, 130, 50));
        assert_eq!(by_name("b"), rect(75, 20, 95, 30));
        assert_eq!(by_name("a"), rect(60, 0, 70, 10));
    }

    #[test]
    fn refine_resolves_overlap_without_leaving_the_core() {
        let core = rect(0, 0, 100, 100);
        let plan = plan_macro_op(
            &MacroOp::Refine { gap_dbu: 5 },
            &[
                view("a", rect(0, 0, 20, 20), MacroOrientation::R0),
                view("b", rect(10, 0, 30, 20), MacroOrientation::R0),
            ],
            MacroOpBounds {
                core: Some(core),
                die: Some(core),
            },
        );
        assert!(plan.skipped.is_empty());
        assert!(!rects_conflict(plan.moves[0].rect, plan.moves[1].rect, 5));
        assert!(plan
            .moves
            .iter()
            .all(|item| crate::macro_staging::rect_fits_inside(item.rect, core)));
    }

    #[test]
    fn array_places_selected_macros_row_major() {
        let plan = plan_macro_op(
            &MacroOp::Array {
                rows: 2,
                columns: 2,
                gap_x_dbu: 5,
                gap_y_dbu: 7,
            },
            &[
                view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("b", rect(50, 0, 70, 10), MacroOrientation::R0),
                view("c", rect(100, 0, 110, 20), MacroOrientation::R0),
                view("d", rect(150, 0, 170, 20), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(plan.moves[0].rect, rect(0, 0, 10, 10));
        assert_eq!(plan.moves[1].rect, rect(15, 0, 35, 10));
        assert_eq!(plan.moves[2].rect, rect(0, 17, 10, 37));
        assert_eq!(plan.moves[3].rect, rect(15, 17, 35, 37));
    }

    #[test]
    fn grid_snap_rounds_planned_origins_to_the_requested_step() {
        let plan = plan_macro_op_with_snap(
            &MacroOp::Shift {
                direction: ShiftDirection::Right,
                distance_dbu: 13,
                per_item: false,
            },
            &[view("a", rect(0, 0, 10, 10), MacroOrientation::R0)],
            MacroOpBounds::default(),
            Some(GridSnap {
                origin_x: 0,
                origin_y: 0,
                step_x: 10,
                step_y: 10,
            }),
        );
        assert_eq!(plan.moves[0].rect, rect(10, 0, 20, 10));
    }

    #[test]
    fn status_change_does_not_alter_geometry_or_snap_it() {
        let original = rect(3, 4, 13, 14);
        let plan = plan_macro_op_with_snap(
            &MacroOp::SetPlacementStatus {
                status: PlacementStatus::Fixed,
            },
            &[view("a", original, MacroOrientation::R0)],
            MacroOpBounds::default(),
            Some(GridSnap {
                origin_x: 0,
                origin_y: 0,
                step_x: 10,
                step_y: 10,
            }),
        );
        assert_eq!(plan.moves[0].rect, original);
        assert_eq!(plan.moves[0].placement_status, Some(PlacementStatus::Fixed));
    }

    #[test]
    fn staged_macro_outside_core_is_skipped() {
        let mut staged = view("staged", rect(-50, 0, -30, 10), MacroOrientation::R0);
        staged.staged = true;
        let plan = plan_macro_op(
            &MacroOp::AlignLeft,
            &[
                staged,
                view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("b", rect(20, 0, 30, 10), MacroOrientation::R0),
            ],
            MacroOpBounds {
                core: Some(rect(0, 0, 100, 100)),
                die: None,
            },
        );
        assert_eq!(plan.moves.len(), 2);
        assert_eq!(plan.skipped[0].0, "staged");
    }

    #[test]
    fn planned_move_overlap_reports_the_conflicting_pair() {
        let moves = vec![
            PlannedMacroMove {
                name: "u_a".to_string(),
                orient: MacroOrientation::R0,
                rect: rect(0, 0, 20, 20),
                staged: false,
                placement_status: None,
            },
            PlannedMacroMove {
                name: "u_b".to_string(),
                orient: MacroOrientation::R0,
                rect: rect(10, 10, 30, 30),
                staged: false,
                placement_status: None,
            },
        ];
        let (first, second) = planned_move_overlap(&moves).expect("overlap");
        assert_eq!(
            (&first.name, &second.name),
            (&moves[0].name, &moves[1].name)
        );
    }

    #[test]
    fn shift_supports_all_directions_and_per_item_mode() {
        for (direction, dx, dy) in [
            (ShiftDirection::Left, -5, 0),
            (ShiftDirection::Up, 0, 5),
            (ShiftDirection::Down, 0, -5),
            (ShiftDirection::Right, 5, 0),
        ] {
            let plan = plan_macro_op(
                &MacroOp::Shift {
                    direction,
                    distance_dbu: 5,
                    per_item: true,
                },
                &[
                    view("a", rect(10, 10, 20, 20), MacroOrientation::R0),
                    view("b", rect(40, 50, 60, 70), MacroOrientation::R0),
                ],
                MacroOpBounds::default(),
            );
            assert_eq!(plan.moves[0].rect, rect(10 + dx, 10 + dy, 20 + dx, 20 + dy));
            assert_eq!(plan.moves[1].rect, rect(40 + dx, 50 + dy, 60 + dx, 70 + dy));
        }
    }

    #[test]
    fn die_boundary_push_and_space_cover_opposite_edges() {
        let pushed = plan_macro_op(
            &MacroOp::ShiftToBoundary {
                edge: BoundaryEdge::Bottom,
                target: BoundaryTarget::Die,
                per_item: false,
            },
            &[
                view("a", rect(0, 20, 10, 30), MacroOrientation::R0),
                view("b", rect(20, 60, 30, 70), MacroOrientation::R0),
            ],
            MacroOpBounds {
                core: Some(rect(10, 10, 110, 110)),
                die: Some(rect(0, 0, 120, 120)),
            },
        );
        assert_eq!(pushed.moves[0].rect, rect(0, 0, 10, 10));
        assert_eq!(pushed.moves[1].rect, rect(20, 40, 30, 50));

        let spaced = plan_macro_op(
            &MacroOp::SpaceToBoundary {
                edge: BoundaryEdge::Right,
                target: BoundaryTarget::Die,
                gap_dbu: 7,
                per_item: false,
            },
            &[
                view("a", rect(10, 0, 20, 10), MacroOrientation::R0),
                view("b", rect(40, 0, 60, 10), MacroOrientation::R0),
            ],
            MacroOpBounds {
                core: Some(rect(0, 0, 120, 100)),
                die: Some(rect(0, 0, 120, 100)),
            },
        );
        assert_eq!(spaced.moves[0].rect, rect(63, 0, 73, 10));
        assert_eq!(spaced.moves[1].rect, rect(93, 0, 113, 10));
    }

    #[test]
    fn all_six_alignment_edges_use_first_selected_reference() {
        let cases = [
            (AlignAxis::X, AlignEdge::Min, rect(0, 20, 40, 30)),
            (AlignAxis::X, AlignEdge::Center, rect(-10, 20, 30, 30)),
            (AlignAxis::X, AlignEdge::Max, rect(-20, 20, 20, 30)),
            (AlignAxis::Y, AlignEdge::Min, rect(100, 0, 140, 10)),
            (AlignAxis::Y, AlignEdge::Center, rect(100, 0, 140, 10)),
            (AlignAxis::Y, AlignEdge::Max, rect(100, 0, 140, 10)),
        ];
        for (axis, edge, expected_second) in cases {
            let plan = plan_macro_op(
                &MacroOp::Align {
                    axis,
                    edge,
                    reference: AlignReference::FirstSelected,
                },
                &[
                    view("first", rect(0, 0, 20, 10), MacroOrientation::R0),
                    view("second", rect(100, 20, 140, 30), MacroOrientation::R0),
                ],
                MacroOpBounds::default(),
            );
            assert_eq!(plan.moves[0].rect, rect(0, 0, 20, 10));
            assert_eq!(plan.moves[1].rect, expected_second);
        }
    }

    #[test]
    fn all_four_corner_alignments_apply_xy_insets() {
        let core = rect(0, 0, 100, 100);
        let cases = [
            (Corner::TopLeft, rect(7, 69, 47, 89)),
            (Corner::TopRight, rect(53, 69, 93, 89)),
            (Corner::BottomLeft, rect(7, 11, 47, 31)),
            (Corner::BottomRight, rect(53, 11, 93, 31)),
        ];
        for (corner, expected) in cases {
            let plan = plan_macro_op(
                &MacroOp::AlignCorner {
                    corner,
                    gap_x_dbu: 7,
                    gap_y_dbu: 11,
                },
                &[view("a", rect(20, 20, 60, 40), MacroOrientation::R0)],
                MacroOpBounds {
                    core: Some(core),
                    die: Some(core),
                },
            );
            assert_eq!(plan.moves[0].rect, expected);
        }
    }

    #[test]
    fn flip_transforms_cover_single_and_relative_group_modes() {
        let horizontal = plan_macro_op(
            &MacroOp::Transform {
                transform: MacroTransform::FlipHorizontal,
                keep_relative: false,
            },
            &[view("a", rect(0, 0, 40, 20), MacroOrientation::R0)],
            MacroOpBounds::default(),
        );
        assert_eq!(horizontal.moves[0].rect, rect(0, 0, 40, 20));
        assert_eq!(horizontal.moves[0].orient, MacroOrientation::My);

        let vertical = plan_macro_op(
            &MacroOp::Transform {
                transform: MacroTransform::FlipVertical,
                keep_relative: false,
            },
            &[view("a", rect(0, 0, 40, 20), MacroOrientation::R0)],
            MacroOpBounds::default(),
        );
        assert_eq!(vertical.moves[0].rect, rect(0, 0, 40, 20));
        assert_eq!(vertical.moves[0].orient, MacroOrientation::Mx);

        let relative = plan_macro_op(
            &MacroOp::Transform {
                transform: MacroTransform::FlipHorizontal,
                keep_relative: true,
            },
            &[
                view("a", rect(0, 0, 20, 10), MacroOrientation::R0),
                view("b", rect(40, 0, 60, 10), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(relative.moves[0].rect, rect(40, 0, 60, 10));
        assert_eq!(relative.moves[1].rect, rect(0, 0, 20, 10));
    }

    #[test]
    fn pack_supports_all_directions_with_fixed_gap() {
        let views = [
            view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
            view("b", rect(30, 0, 50, 10), MacroOrientation::R0),
            view("c", rect(15, 30, 35, 40), MacroOrientation::R0),
        ];
        let cases = [
            (PackDirection::Left, AlignAxis::X, 0, true, 0),
            (PackDirection::Right, AlignAxis::X, 50, false, 50),
            (PackDirection::Bottom, AlignAxis::Y, 0, true, 0),
            (PackDirection::Top, AlignAxis::Y, 40, false, 40),
        ];
        for (direction, axis, boundary, toward_low, _) in cases {
            let plan = plan_macro_op(
                &MacroOp::Pack {
                    direction,
                    gap_dbu: 5,
                },
                &views,
                MacroOpBounds {
                    core: Some(rect(-100, -100, 200, 200)),
                    die: None,
                },
            );
            assert_eq!(plan.moves.len(), 3);
            if toward_low {
                let actual = plan
                    .moves
                    .iter()
                    .map(|item| match axis {
                        AlignAxis::X => item.rect.lx,
                        AlignAxis::Y => item.rect.ly,
                    })
                    .min()
                    .expect("moves");
                assert_eq!(actual, boundary);
            } else {
                let actual = plan
                    .moves
                    .iter()
                    .map(|item| match axis {
                        AlignAxis::X => item.rect.hx,
                        AlignAxis::Y => item.rect.hy,
                    })
                    .max()
                    .expect("moves");
                assert_eq!(actual, boundary);
            }
            let mut sorted = plan
                .moves
                .iter()
                .map(|item| match axis {
                    AlignAxis::X => (item.rect.lx, item.rect.hx),
                    AlignAxis::Y => (item.rect.ly, item.rect.hy),
                })
                .collect::<Vec<_>>();
            sorted.sort_by_key(|interval| interval.0);
            for pair in sorted.windows(2) {
                assert_eq!(pair[1].0 - pair[0].1, 5);
            }
        }
    }

    #[test]
    fn space_and_distribute_cover_the_vertical_axis() {
        let spaced = plan_macro_op(
            &MacroOp::SpaceBetween {
                axis: AlignAxis::Y,
                gap_dbu: 15,
            },
            &[
                view("first", rect(0, 0, 20, 20), MacroOrientation::R0),
                view("second", rect(0, 40, 20, 60), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(spaced.moves[0].rect, rect(0, 0, 20, 20));
        assert_eq!(spaced.moves[1].rect, rect(0, 35, 20, 55));

        let distributed = plan_macro_op(
            &MacroOp::Distribute {
                axis: AlignAxis::Y,
                gap_dbu: Some(5),
            },
            &[
                view("a", rect(0, 0, 10, 10), MacroOrientation::R0),
                view("b", rect(0, 30, 10, 50), MacroOrientation::R0),
                view("c", rect(0, 100, 10, 120), MacroOrientation::R0),
            ],
            MacroOpBounds::default(),
        );
        assert_eq!(distributed.moves[0].rect, rect(0, 0, 10, 10));
        assert_eq!(distributed.moves[1].rect, rect(0, 15, 10, 35));
        assert_eq!(distributed.moves[2].rect, rect(0, 40, 10, 60));
    }

    #[test]
    fn grid_snap_respects_origin_and_both_axes() {
        let plan = plan_macro_op_with_snap(
            &MacroOp::Shift {
                direction: ShiftDirection::Up,
                distance_dbu: 13,
                per_item: false,
            },
            &[view("a", rect(3, 4, 13, 14), MacroOrientation::R0)],
            MacroOpBounds::default(),
            Some(GridSnap {
                origin_x: 3,
                origin_y: 4,
                step_x: 10,
                step_y: 10,
            }),
        );
        assert_eq!(plan.moves[0].rect, rect(3, 14, 13, 24));
    }

    #[test]
    fn queue_tracks_progress_and_failures() {
        let mut queue = MacroOpQueue::default();
        queue.enqueue(vec![PlannedMacroMove {
            name: "u_a".to_string(),
            orient: MacroOrientation::R0,
            rect: rect(0, 0, 10, 10),
            staged: false,
            placement_status: None,
        }]);
        assert!(queue.is_busy());
        assert!(queue.pop_head().is_some());
        assert_eq!(queue.status(), "macro ops: 1 applied");
        queue.abort("rejected");
        assert!(!queue.is_busy());
        assert_eq!(queue.status(), "macro ops: rejected");

        queue.enqueue(vec![PlannedMacroMove {
            name: "u_a".to_string(),
            orient: MacroOrientation::R0,
            rect: rect(10, 0, 20, 10),
            staged: false,
            placement_status: None,
        }]);
        assert!(queue.failure.is_none());
        assert_eq!(queue.status(), "macro ops: 0 / 1 applied");
    }
}
