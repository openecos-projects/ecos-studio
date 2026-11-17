//! Small replay widgets shared by the dock, analysis window and results column.
use crate::replay::checklist::Item;
use egui::{Color32, Id, Stroke};
use std::{collections::HashMap, hash::Hash};

/// Each presentation follows selection changes independently, without overriding
/// manual scrolling on subsequent frames. Reset when a new recording is loaded.
#[derive(Default)]
pub struct SelectionFollow {
    seen: HashMap<Id, Id>,
}

impl SelectionFollow {
    pub fn changed(&mut self, surface: Id, selection: impl Hash) -> bool {
        let selection = Id::new(selection);
        self.seen.insert(surface, selection) != Some(selection)
    }
}

#[derive(Debug, PartialEq)]
pub enum CheckMark {
    Pending,
    Pass,
    Failed,
    Ignored,
    Advisory,
}

impl CheckMark {
    pub fn for_item(item: &Item, ready: bool) -> Self {
        if !ready {
            return Self::Pending;
        }
        if item.is_blocked() {
            return Self::Failed;
        }
        match item.state.trim().to_ascii_lowercase().as_str() {
            "pass" | "passed" | "success" => Self::Pass,
            "fail" | "failed" | "failure" | "error" => Self::Failed,
            "ignore" | "ignored" | "skip" | "skipped" => Self::Ignored,
            "warning" | "attention" => Self::Advisory,
            _ => Self::Pending,
        }
    }

    pub fn color(&self) -> Color32 {
        match self {
            Self::Pass | Self::Advisory => Color32::from_rgb(93, 207, 143),
            Self::Failed => Color32::from_rgb(244, 104, 104),
            Self::Pending | Self::Ignored => Color32::from_gray(135),
        }
    }

    /// Use strokes rather than font glyphs, which can render as missing boxes.
    pub fn paint(&self, ui: &mut egui::Ui) {
        let (rect, _) = ui.allocate_exact_size(egui::vec2(14.0, 18.0), egui::Sense::hover());
        let center = rect.center();
        let point = |x, y| center + egui::vec2(x, y);
        let stroke = Stroke::new(1.8, self.color());
        match self {
            Self::Pass => {
                ui.painter()
                    .line_segment([point(-5.0, 0.0), point(-1.5, 3.5)], stroke);
                ui.painter()
                    .line_segment([point(-1.5, 3.5), point(5.0, -4.0)], stroke);
            }
            Self::Failed => {
                ui.painter()
                    .line_segment([point(-4.0, -4.0), point(4.0, 4.0)], stroke);
                ui.painter()
                    .line_segment([point(-4.0, 4.0), point(4.0, -4.0)], stroke);
            }
            Self::Ignored => {
                ui.painter().circle_filled(center, 2.5, self.color());
            }
            Self::Pending | Self::Advisory => {
                ui.painter().circle_stroke(center, 3.0, stroke);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_changes_rewinds_and_each_surface_but_not_repeated_frames() {
        let mut follow = SelectionFollow::default();
        let dock = Id::new("dock");
        let window = Id::new("window");
        assert!(follow.changed(dock, Some(20)));
        assert!(!follow.changed(dock, Some(20)));
        assert!(follow.changed(window, Some(20)));
        assert!(follow.changed(dock, Some(2)));
        assert!(!follow.changed(dock, Some(2)));
        assert!(follow.changed(window, Some(2)));
    }

    #[test]
    fn check_marks_preserve_ignored_and_unrevealed_states() {
        for (state, blocked, ready, expected) in [
            ("pass", false, true, CheckMark::Pass),
            ("FAILED", false, true, CheckMark::Failed),
            ("blocked", false, true, CheckMark::Failed),
            ("ignore", false, true, CheckMark::Ignored),
            ("ignored", false, true, CheckMark::Ignored),
            ("pass", true, true, CheckMark::Failed),
            ("ignore", true, true, CheckMark::Failed),
            ("blocked", true, false, CheckMark::Pending),
            ("pass", false, false, CheckMark::Pending),
            ("warning", false, true, CheckMark::Advisory),
            ("unavailable", false, true, CheckMark::Pending),
        ] {
            let item = serde_json::from_value(serde_json::json!({"state":state,"blocked":blocked}))
                .unwrap();
            assert_eq!(CheckMark::for_item(&item, ready), expected, "{state}");
        }
    }
}
