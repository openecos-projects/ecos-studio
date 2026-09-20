//! Per-class visibility for layout instances (macro, standard cell, filler).
//!
//! The drawing-data sidebar exposes an "Instances" tri-state node whose
//! children toggle each class independently. Classification is viewer-side:
//! fillers are recognized by instance/master naming heuristics, macros by
//! their block masters, and everything else is a standard cell.

use chip_view_db::{ChipViewDb, OwnerLocalInfo};
use chipgeom_format::OwnerRef;

use crate::macro_staging::is_block_master;

/// Instance classes controlled under the "Instances" drawing-data node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum InstanceClass {
    Macro,
    StdCell,
    Filler,
}

impl InstanceClass {
    pub(crate) const ALL: [Self; 3] = [Self::Macro, Self::StdCell, Self::Filler];

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Macro => "Macro",
            Self::StdCell => "StdCell",
            Self::Filler => "Filler",
        }
    }

    pub(crate) fn tooltip(self) -> &'static str {
        match self {
            Self::Macro => "Block macro instances.",
            Self::StdCell => "Standard cell instances.",
            Self::Filler => "Filler, decap, and tap cell instances.",
        }
    }
}

/// Classifies an instance owner into macro / standard cell / filler. Filler
/// naming heuristics win first; block masters mark macros; the rest are
/// standard cells.
pub(crate) fn classify_instance(db: &ChipViewDb, owner: &OwnerRef) -> InstanceClass {
    let inst_name = db.owner_name(owner);
    let local = db.owner_local_name(owner);
    if is_filler_instance(inst_name, local) {
        return InstanceClass::Filler;
    }
    let master = local
        .and_then(OwnerLocalInfo::parse)
        .and_then(|info| info.field("master").map(str::to_owned));
    match master {
        Some(master) if db.master_by_name(&master).is_some_and(is_block_master) => {
            InstanceClass::Macro
        }
        _ => InstanceClass::StdCell,
    }
}

/// True when the instance name or master local info matches filler/decap/tap
/// naming conventions.
pub(crate) fn is_filler_instance(inst_name: Option<&str>, master_name: Option<&str>) -> bool {
    let is_filler_str = |s: &str| -> bool {
        let s = s.trim();
        if s.is_empty() {
            return false;
        }
        let lower = s.to_ascii_lowercase();
        lower.contains("fill")
            || lower.contains("decap")
            || lower.contains("tapcell")
            || lower.contains("welltap")
            || lower.contains("tapvpwr")
            || lower.contains("tapvgnd")
            || lower.contains("endcap")
            || lower.starts_with("tap_")
            || (lower.starts_with("tap") && lower.contains('_'))
            || lower.ends_with("_tap")
            || lower.contains("__tap")
            || lower.starts_with("phy_")
            || lower.starts_with("filler")
    };
    inst_name.is_some_and(is_filler_str) || master_name.is_some_and(is_filler_str)
}

/// Independent visibility switch per instance class; all visible by default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct InstanceClassVisibility {
    pub macro_: bool,
    pub stdcell: bool,
    pub filler: bool,
}

impl Default for InstanceClassVisibility {
    fn default() -> Self {
        Self {
            macro_: true,
            stdcell: true,
            filler: true,
        }
    }
}

/// Tri-state of the "Instances" parent node derived from its children.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TriState {
    All,
    None,
    Partial,
}

impl InstanceClassVisibility {
    pub(crate) fn is_visible(self, class: InstanceClass) -> bool {
        match class {
            InstanceClass::Macro => self.macro_,
            InstanceClass::StdCell => self.stdcell,
            InstanceClass::Filler => self.filler,
        }
    }

    pub(crate) fn set_visible(&mut self, class: InstanceClass, visible: bool) {
        match class {
            InstanceClass::Macro => self.macro_ = visible,
            InstanceClass::StdCell => self.stdcell = visible,
            InstanceClass::Filler => self.filler = visible,
        }
    }

    pub(crate) fn set_all(&mut self, visible: bool) {
        self.macro_ = visible;
        self.stdcell = visible;
        self.filler = visible;
    }

    pub(crate) fn any_visible(self) -> bool {
        self.macro_ || self.stdcell || self.filler
    }

    pub(crate) fn tri_state(self) -> TriState {
        match (self.macro_, self.stdcell, self.filler) {
            (true, true, true) => TriState::All,
            (false, false, false) => TriState::None,
            _ => TriState::Partial,
        }
    }
}

/// Paints a tri-state checkbox (check / dash / empty) and returns the click
/// response. The caller maps a click to the desired child state.
pub(crate) fn tri_state_checkbox(
    ui: &mut egui::Ui,
    state: TriState,
    label: &str,
) -> egui::Response {
    let box_side = ui.spacing().interact_size.y - 4.0;
    let galley = ui.painter().layout_no_wrap(
        label.to_string(),
        egui::FontId::proportional(14.0),
        egui::Color32::PLACEHOLDER,
    );
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(
            box_side + 8.0 + galley.size().x,
            box_side.max(galley.size().y),
        ),
        egui::Sense::click(),
    );
    response.widget_info(|| {
        egui::WidgetInfo::selected(
            egui::WidgetType::Checkbox,
            true,
            state == TriState::All,
            galley.text(),
        )
    });
    let visuals = ui
        .style()
        .interact_selectable(&response, state == TriState::All);
    if ui.is_rect_visible(rect) {
        let box_rect = egui::Rect::from_min_size(rect.min, egui::vec2(box_side, box_side));
        ui.painter().rect_filled(box_rect, 2.0, visuals.bg_fill);
        ui.painter().rect_stroke(
            box_rect,
            2.0,
            egui::Stroke::new(1.5, visuals.fg_stroke.color),
            egui::StrokeKind::Inside,
        );
        let mark_color = visuals.fg_stroke.color;
        match state {
            TriState::All => {
                let p = box_rect.shrink(box_side * 0.25);
                ui.painter().line_segment(
                    [
                        egui::pos2(p.left(), p.center().y),
                        egui::pos2(p.left_center().x, p.bottom()),
                    ],
                    egui::Stroke::new(2.0, mark_color),
                );
                ui.painter().line_segment(
                    [
                        egui::pos2(p.left_center().x, p.bottom()),
                        egui::pos2(p.right(), p.top()),
                    ],
                    egui::Stroke::new(2.0, mark_color),
                );
            }
            TriState::Partial => {
                ui.painter().line_segment(
                    [
                        egui::pos2(box_rect.left() + 3.0, box_rect.center().y),
                        egui::pos2(box_rect.right() - 3.0, box_rect.center().y),
                    ],
                    egui::Stroke::new(2.0, mark_color),
                );
            }
            TriState::None => {}
        }
        let text_pos = egui::pos2(
            box_rect.right() + 8.0,
            rect.center().y - galley.size().y * 0.5,
        );
        ui.painter().galley(text_pos, galley, visuals.text_color());
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filler_naming_heuristics_cover_common_families() {
        assert!(is_filler_instance(Some("u_fill01"), None));
        assert!(is_filler_instance(None, Some("master: FILL1W")));
        assert!(is_filler_instance(Some("u_decap"), None));
        assert!(is_filler_instance(Some("tap_0"), None));
        assert!(is_filler_instance(Some("u_endcap"), None));
        assert!(!is_filler_instance(Some("u_logic0"), None));
        assert!(!is_filler_instance(
            Some("u_sram0"),
            Some("master: SRAM_64x32")
        ));
        assert!(!is_filler_instance(None, None));
        assert!(!is_filler_instance(Some(""), Some("")));
    }

    #[test]
    fn class_visibility_defaults_all_visible_and_reports_tri_state() {
        let visibility = InstanceClassVisibility::default();
        assert!(visibility.any_visible());
        assert_eq!(visibility.tri_state(), TriState::All);

        let mut partial = visibility;
        partial.set_visible(InstanceClass::StdCell, false);
        assert_eq!(partial.tri_state(), TriState::Partial);
        assert!(!partial.is_visible(InstanceClass::StdCell));
        assert!(partial.is_visible(InstanceClass::Macro));

        let mut none = visibility;
        none.set_all(false);
        assert_eq!(none.tri_state(), TriState::None);
        assert!(!none.any_visible());
    }
}
