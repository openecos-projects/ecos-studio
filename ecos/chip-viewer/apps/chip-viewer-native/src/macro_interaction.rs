//! Multi-selection, marquee, and group-drag state for macro placement.

use std::collections::BTreeSet;

use chipgeom_format::{Point32, Rect32};

use crate::macro_ops::PlannedMacroMove;
use crate::macro_staging::{rect_fits_inside, MacroPlacementView, MacroTarget};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SelectionMode {
    Replace,
    Add,
    Toggle,
}

impl SelectionMode {
    pub(crate) fn for_click(shift: bool, command_or_ctrl: bool) -> Self {
        if shift || command_or_ctrl {
            Self::Toggle
        } else {
            Self::Replace
        }
    }

    pub(crate) fn for_marquee(shift: bool, command_or_ctrl: bool) -> Self {
        if command_or_ctrl {
            Self::Toggle
        } else if shift {
            Self::Add
        } else {
            Self::Replace
        }
    }
}

pub(crate) fn apply_selection(
    selection: &mut BTreeSet<MacroTarget>,
    hits: impl IntoIterator<Item = MacroTarget>,
    mode: SelectionMode,
) {
    let hits = hits.into_iter().collect::<BTreeSet<_>>();
    match mode {
        SelectionMode::Replace => *selection = hits,
        SelectionMode::Add => selection.extend(hits),
        SelectionMode::Toggle => {
            for target in hits {
                if !selection.insert(target.clone()) {
                    selection.remove(&target);
                }
            }
        }
    }
}

pub(crate) struct MacroMarquee {
    start: Point32,
    current: Point32,
    pub mode: SelectionMode,
}

impl MacroMarquee {
    pub(crate) fn new(start: Point32, mode: SelectionMode) -> Self {
        Self {
            start,
            current: start,
            mode,
        }
    }

    pub(crate) fn update(&mut self, current: Point32) {
        self.current = current;
    }

    pub(crate) fn rect(&self) -> Rect32 {
        Rect32 {
            lx: self.start.x.min(self.current.x),
            ly: self.start.y.min(self.current.y),
            hx: self.start.x.max(self.current.x),
            hy: self.start.y.max(self.current.y),
        }
    }
}

pub(crate) struct MacroGroupDrag {
    originals: Vec<MacroPlacementView>,
    preview: Vec<PlannedMacroMove>,
    contains_staged: bool,
    valid: bool,
    error: Option<String>,
}

impl MacroGroupDrag {
    pub(crate) fn new(originals: Vec<MacroPlacementView>) -> Self {
        let contains_staged = originals.iter().any(|view| view.staged);
        let preview = originals
            .iter()
            .map(|view| PlannedMacroMove {
                name: view.name.clone(),
                orient: view.orient,
                rect: view.bbox,
                staged: false,
            })
            .collect();
        Self {
            originals,
            preview,
            contains_staged,
            valid: false,
            error: None,
        }
    }

    pub(crate) fn update(&mut self, dx: i32, dy: i32, core: Option<Rect32>) {
        let mut dx = i64::from(dx);
        let mut dy = i64::from(dy);
        self.error = None;

        if !self.contains_staged {
            if let (Some(core), Some(bounds)) = (core, placement_bounds(&self.originals)) {
                let Some(translated) = translate_rect(bounds, dx, dy) else {
                    self.invalidate("group move exceeds the supported coordinate range");
                    return;
                };
                let clamped = crate::macro_staging::clamp_rect_into(translated, core);
                dx += i64::from(clamped.lx) - i64::from(translated.lx);
                dy += i64::from(clamped.ly) - i64::from(translated.ly);
            }
        }

        let preview = self
            .originals
            .iter()
            .map(|view| {
                translate_rect(view.bbox, dx, dy).map(|rect| PlannedMacroMove {
                    name: view.name.clone(),
                    orient: view.orient,
                    rect,
                    staged: false,
                })
            })
            .collect::<Option<Vec<_>>>();
        let Some(preview) = preview else {
            self.invalidate("group move exceeds the supported coordinate range");
            return;
        };
        self.preview = preview;
        self.valid = match core {
            Some(core) => self
                .preview
                .iter()
                .all(|item| rect_fits_inside(item.rect, core)),
            None => false,
        };
        if !self.valid {
            self.error = Some("group move must finish inside the core".to_string());
        }
    }

    pub(crate) fn preview(&self) -> &[PlannedMacroMove] {
        &self.preview
    }

    pub(crate) fn valid(&self) -> bool {
        self.valid
    }

    pub(crate) fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub(crate) fn planned_moves(&self) -> Vec<PlannedMacroMove> {
        self.preview.clone()
    }

    fn invalidate(&mut self, message: &str) {
        self.valid = false;
        self.error = Some(message.to_string());
    }
}

pub(crate) enum MacroCanvasInteraction {
    Marquee(MacroMarquee),
    GroupDrag(MacroGroupDrag),
}

fn placement_bounds(views: &[MacroPlacementView]) -> Option<Rect32> {
    views
        .iter()
        .map(|view| view.bbox)
        .reduce(|mut bounds, rect| {
            bounds.include(rect);
            bounds
        })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::macro_orient::{MacroOrientation, MasterSymmetry};

    fn target(name: &str) -> MacroTarget {
        MacroTarget::Placed(name.to_string())
    }

    fn view(name: &str, bbox: Rect32, staged: bool) -> MacroPlacementView {
        MacroPlacementView {
            name: name.to_string(),
            orient: MacroOrientation::R0,
            bbox,
            symmetry: MasterSymmetry::parse("X,Y,R90"),
            staged,
        }
    }

    fn rect(lx: i32, ly: i32, hx: i32, hy: i32) -> Rect32 {
        Rect32 { lx, ly, hx, hy }
    }

    #[test]
    fn selection_modes_replace_add_and_toggle() {
        let mut selection = BTreeSet::from([target("a")]);
        apply_selection(&mut selection, [target("b")], SelectionMode::Add);
        assert_eq!(selection, BTreeSet::from([target("a"), target("b")]));

        apply_selection(&mut selection, [target("a")], SelectionMode::Toggle);
        assert_eq!(selection, BTreeSet::from([target("b")]));

        apply_selection(&mut selection, [target("c")], SelectionMode::Replace);
        assert_eq!(selection, BTreeSet::from([target("c")]));
    }

    #[test]
    fn marquee_normalizes_drag_direction() {
        let mut marquee = MacroMarquee::new(Point32 { x: 30, y: 40 }, SelectionMode::Replace);
        marquee.update(Point32 { x: 10, y: 5 });
        assert_eq!(marquee.rect(), rect(10, 5, 30, 40));
    }

    #[test]
    fn placed_group_drag_clamps_as_one_unit_and_preserves_offsets() {
        let mut drag = MacroGroupDrag::new(vec![
            view("a", rect(10, 10, 20, 20), false),
            view("b", rect(30, 20, 40, 30), false),
        ]);
        drag.update(80, 80, Some(rect(0, 0, 100, 100)));

        assert!(drag.valid());
        assert_eq!(drag.preview()[0].rect, rect(70, 80, 80, 90));
        assert_eq!(drag.preview()[1].rect, rect(90, 90, 100, 100));
    }

    #[test]
    fn staged_group_drag_is_invalid_until_every_macro_enters_core() {
        let mut drag = MacroGroupDrag::new(vec![view("a", rect(-30, 0, -10, 20), true)]);
        let core = rect(0, 0, 100, 100);

        drag.update(10, 0, Some(core));
        assert!(!drag.valid());
        assert_eq!(drag.error(), Some("group move must finish inside the core"));

        drag.update(30, 0, Some(core));
        assert!(drag.valid());
        assert_eq!(drag.preview()[0].rect, rect(0, 0, 20, 20));
        assert!(!drag.planned_moves()[0].staged);
    }
}
