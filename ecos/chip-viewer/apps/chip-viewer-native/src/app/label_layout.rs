use std::collections::HashMap;

use eframe::egui;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum ShapeLabelKind {
    IoPin,
    Pin,
    Net,
    Pdn,
    Instance,
}

impl ShapeLabelKind {
    pub(super) fn is_pin(self) -> bool {
        matches!(self, Self::IoPin | Self::Pin)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum ShapeLabelKey {
    Named { kind: ShapeLabelKind, text: String },
    Owner { owner_type: u8, owner_id: u64 },
}

#[derive(Clone, Debug)]
pub(super) struct ShapeLabelCandidate {
    pub(super) key: ShapeLabelKey,
    pub(super) anchor_rect: egui::Rect,
    pub(super) text: String,
    pub(super) kind: ShapeLabelKind,
    pub(super) rank_area: f32,
    pub(super) selected: bool,
    pub(super) highlighted: bool,
}

#[derive(Clone, Debug)]
pub(super) struct ShapeLabelOverlay {
    pub(super) anchor_rect: egui::Rect,
    pub(super) rect: egui::Rect,
    pub(super) text: String,
    pub(super) text_size: egui::Vec2,
    pub(super) kind: ShapeLabelKind,
    pub(super) font_size: f32,
    pub(super) vertical: bool,
    pub(super) selected: bool,
}

#[derive(Clone, Debug, Default)]
pub(super) struct ResolvedLabels {
    pub(super) labels: Vec<ShapeLabelOverlay>,
    pub(super) candidate_count: usize,
    pub(super) collision_suppressed: usize,
}

#[derive(Clone, Debug, Default)]
pub(super) struct ShapeLabelCollector {
    candidates: HashMap<ShapeLabelKey, ShapeLabelCandidate>,
}

impl ShapeLabelCollector {
    pub(super) fn insert(&mut self, candidate: ShapeLabelCandidate) {
        self.candidates
            .entry(candidate.key.clone())
            .and_modify(|current| {
                if candidate_wins(&candidate, current) {
                    *current = candidate.clone();
                }
            })
            .or_insert(candidate);
    }

    pub(super) fn clear(&mut self) {
        self.candidates.clear();
    }

    pub(super) fn resolve<F>(&self, canvas: egui::Rect, measure: F) -> ResolvedLabels
    where
        F: Fn(&str, f32) -> egui::Vec2,
    {
        let mut candidates: Vec<_> = self
            .candidates
            .values()
            .filter_map(|candidate| {
                let visible_rect = candidate.anchor_rect.intersect(canvas);
                candidate_eligible(candidate, visible_rect).then_some(candidate)
            })
            .collect();
        candidates.sort_by(|left, right| {
            label_priority(left)
                .cmp(&label_priority(right))
                .then_with(|| right.rank_area.total_cmp(&left.rank_area))
                .then_with(|| left.key.cmp(&right.key))
        });

        let mut labels = Vec::new();
        let mut accepted_rects = LabelCollisionIndex::default();
        let mut collision_suppressed = 0usize;
        for candidate in candidates {
            let placements = candidate_placements(candidate, canvas, &measure);
            if placements.is_empty() {
                continue;
            }
            let mut placed = false;
            for placement in placements {
                let visible_rect = placement
                    .rect
                    .intersect(candidate.anchor_rect)
                    .intersect(canvas);
                if !visible_rect.is_positive() || accepted_rects.overlaps(visible_rect) {
                    continue;
                }
                accepted_rects.insert(visible_rect);
                labels.push(ShapeLabelOverlay {
                    anchor_rect: candidate.anchor_rect,
                    rect: placement.rect,
                    text: placement.text,
                    text_size: placement.text_size,
                    kind: candidate.kind,
                    font_size: placement.font_size,
                    vertical: placement.vertical,
                    selected: candidate.selected,
                });
                placed = true;
                break;
            }
            if !placed {
                collision_suppressed += 1;
            }
        }
        ResolvedLabels {
            candidate_count: self.candidates.len(),
            labels,
            collision_suppressed,
        }
    }
}

fn candidate_wins(candidate: &ShapeLabelCandidate, current: &ShapeLabelCandidate) -> bool {
    candidate.selected != current.selected && candidate.selected
        || candidate.selected == current.selected
            && candidate.highlighted != current.highlighted
            && candidate.highlighted
        || candidate.selected == current.selected
            && candidate.highlighted == current.highlighted
            && candidate.rank_area > current.rank_area
}

fn label_priority(candidate: &ShapeLabelCandidate) -> u8 {
    if candidate.selected {
        0
    } else if candidate.highlighted {
        1
    } else {
        2 + candidate.kind as u8
    }
}

struct LabelPlacement {
    font_size: f32,
    rect: egui::Rect,
    text: String,
    text_size: egui::Vec2,
    vertical: bool,
}

fn candidate_placements<F>(
    candidate: &ShapeLabelCandidate,
    canvas: egui::Rect,
    measure: &F,
) -> Vec<LabelPlacement>
where
    F: Fn(&str, f32) -> egui::Vec2,
{
    let mut placements = Vec::new();
    let placement = if candidate.kind.is_pin() {
        Some(fixed_pin_placement(candidate, measure))
    } else {
        fit_inside(
            candidate.kind,
            candidate.anchor_rect,
            &candidate.text,
            measure,
        )
        .map(|(font_size, text_size)| LabelPlacement {
            font_size,
            rect: egui::Rect::from_center_size(
                candidate.anchor_rect.center(),
                text_size + egui::vec2(2.0, 1.0),
            ),
            text: candidate.text.clone(),
            text_size,
            vertical: false,
        })
    };
    if let Some(placement) = placement {
        let visible_rect = placement
            .rect
            .intersect(candidate.anchor_rect)
            .intersect(canvas);
        if visible_rect.is_positive() {
            placements.push(placement);
        }
    }
    placements
}

fn fixed_pin_placement<F>(candidate: &ShapeLabelCandidate, measure: &F) -> LabelPlacement
where
    F: Fn(&str, f32) -> egui::Vec2,
{
    let horizontal = fixed_pin_placement_with_orientation(candidate, measure, false);
    let vertical = fixed_pin_placement_with_orientation(candidate, measure, true);
    if vertical.text.chars().count() > horizontal.text.chars().count() {
        vertical
    } else {
        horizontal
    }
}

fn fixed_pin_placement_with_orientation<F>(
    candidate: &ShapeLabelCandidate,
    measure: &F,
    vertical: bool,
) -> LabelPlacement
where
    F: Fn(&str, f32) -> egui::Vec2,
{
    let font_size = 11.0;
    let available_length = if vertical {
        (candidate.anchor_rect.height() - 2.0).max(0.0)
    } else {
        (candidate.anchor_rect.width() - 2.0).max(0.0)
    };
    let text = ellipsize_to_width(&candidate.text, available_length, font_size, measure);
    let text_size = measure(&text, font_size);
    let bounding_size = if vertical {
        egui::vec2(text_size.y + 1.0, text_size.x + 2.0)
    } else {
        text_size + egui::vec2(2.0, 1.0)
    };
    LabelPlacement {
        font_size,
        rect: egui::Rect::from_center_size(candidate.anchor_rect.center(), bounding_size),
        text,
        text_size,
        vertical,
    }
}

fn ellipsize_to_width<F>(text: &str, max_width: f32, font_size: f32, measure: &F) -> String
where
    F: Fn(&str, f32) -> egui::Vec2,
{
    if measure(text, font_size).x <= max_width {
        return text.to_string();
    }

    let ellipsis = '…';
    let mut fitted = String::new();
    for character in text.chars() {
        let mut candidate = fitted.clone();
        candidate.push(character);
        candidate.push(ellipsis);
        if measure(&candidate, font_size).x > max_width {
            break;
        }
        fitted.push(character);
    }
    fitted.push(ellipsis);
    fitted
}

fn rectangles_overlap(left: egui::Rect, right: egui::Rect) -> bool {
    left.left() < right.right()
        && right.left() < left.right()
        && left.top() < right.bottom()
        && right.top() < left.bottom()
}

const IO_PIN_MIN_SHORT_SIDE_PX: f32 = 3.0;
const IO_PIN_MIN_LONG_SIDE_PX: f32 = 10.0;
const INSTANCE_PIN_MIN_SHORT_SIDE_PX: f32 = 10.0;
const INSTANCE_PIN_MIN_LONG_SIDE_PX: f32 = 28.0;
const LABEL_COLLISION_BIN_SIZE: f32 = 32.0;

#[derive(Default)]
struct LabelCollisionIndex {
    bins: HashMap<(i32, i32), Vec<egui::Rect>>,
}

impl LabelCollisionIndex {
    fn overlaps(&self, rect: egui::Rect) -> bool {
        let (min_x, max_x, min_y, max_y) = collision_bins(rect);
        (min_x..=max_x).any(|x| {
            (min_y..=max_y).any(|y| {
                self.bins.get(&(x, y)).is_some_and(|accepted| {
                    accepted
                        .iter()
                        .any(|other| rectangles_overlap(*other, rect))
                })
            })
        })
    }

    fn insert(&mut self, rect: egui::Rect) {
        let (min_x, max_x, min_y, max_y) = collision_bins(rect);
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                self.bins.entry((x, y)).or_default().push(rect);
            }
        }
    }
}

fn collision_bins(rect: egui::Rect) -> (i32, i32, i32, i32) {
    (
        (rect.left() / LABEL_COLLISION_BIN_SIZE).floor() as i32,
        (rect.right() / LABEL_COLLISION_BIN_SIZE).floor() as i32,
        (rect.top() / LABEL_COLLISION_BIN_SIZE).floor() as i32,
        (rect.bottom() / LABEL_COLLISION_BIN_SIZE).floor() as i32,
    )
}

fn candidate_eligible(candidate: &ShapeLabelCandidate, visible_rect: egui::Rect) -> bool {
    if !visible_rect.is_positive() {
        return false;
    }
    if candidate.kind.is_pin() {
        if candidate.selected {
            return true;
        }
        let short_side = visible_rect.width().min(visible_rect.height());
        let long_side = visible_rect.width().max(visible_rect.height());
        let (min_short_side, min_long_side) = pin_size_threshold(candidate.kind);
        short_side >= min_short_side && long_side >= min_long_side
    } else {
        visible_rect.width() >= 12.0 && visible_rect.height() >= 8.0
    }
}

fn pin_size_threshold(kind: ShapeLabelKind) -> (f32, f32) {
    match kind {
        ShapeLabelKind::IoPin => (IO_PIN_MIN_SHORT_SIDE_PX, IO_PIN_MIN_LONG_SIDE_PX),
        ShapeLabelKind::Pin => (
            INSTANCE_PIN_MIN_SHORT_SIDE_PX,
            INSTANCE_PIN_MIN_LONG_SIDE_PX,
        ),
        _ => unreachable!("non-pin kinds do not use pin thresholds"),
    }
}

fn font_range(kind: ShapeLabelKind) -> (f32, f32) {
    match kind {
        ShapeLabelKind::IoPin | ShapeLabelKind::Pin => (11.0, 11.0),
        ShapeLabelKind::Net | ShapeLabelKind::Pdn => (6.0, 11.0),
        ShapeLabelKind::Instance => (8.0, 18.0),
    }
}

fn fit_inside<F>(
    kind: ShapeLabelKind,
    anchor: egui::Rect,
    text: &str,
    measure: &F,
) -> Option<(f32, egui::Vec2)>
where
    F: Fn(&str, f32) -> egui::Vec2,
{
    let (min_size, max_size) = font_range(kind);
    let available = (anchor.size() - egui::vec2(2.0, 1.0)).max(egui::Vec2::ZERO);
    if available.x < min_size * 2.0 || available.y < min_size {
        return None;
    }
    let mut size = max_size;
    while size >= min_size {
        let measured = measure(text, size);
        if measured.x <= available.x && measured.y <= available.y {
            return Some((size, measured));
        }
        size -= 0.5;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn measure(text: &str, font_size: f32) -> egui::Vec2 {
        egui::vec2(text.chars().count() as f32 * font_size * 0.6, font_size)
    }

    fn candidate(kind: ShapeLabelKind, rect: egui::Rect, text: &str) -> ShapeLabelCandidate {
        ShapeLabelCandidate {
            key: ShapeLabelKey::Owner {
                owner_type: kind as u8,
                owner_id: 1,
            },
            anchor_rect: rect,
            text: text.to_string(),
            kind,
            rank_area: rect.width() * rect.height(),
            selected: false,
            highlighted: false,
        }
    }

    #[test]
    fn large_pin_label_is_centered_inside_anchor() {
        let anchor = egui::Rect::from_min_max(egui::pos2(100.0, 100.0), egui::pos2(300.0, 220.0));
        let mut collector = ShapeLabelCollector::default();
        collector.insert(candidate(ShapeLabelKind::Pin, anchor, "VSS"));

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1000.0, 1000.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        let label = &resolved.labels[0];
        assert!(anchor.contains_rect(label.rect));
        assert_eq!(label.font_size, 11.0);
        assert!(!label.vertical);
    }

    #[test]
    fn narrow_pin_label_rotates_inside_the_anchor() {
        let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(12.0, 100.0));
        let mut collector = ShapeLabelCollector::default();
        collector.insert(candidate(ShapeLabelKind::Pin, anchor, "VSS"));

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(500.0, 500.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        let label = &resolved.labels[0];
        assert_eq!(label.text, "VSS");
        assert_eq!(label.font_size, 11.0);
        assert!(label.vertical);
        assert!(label
            .anchor_rect
            .contains_rect(label.rect.intersect(label.anchor_rect)));
    }

    #[test]
    fn pin_label_is_ellipsized_instead_of_shrinking() {
        let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(15.0, 15.0));
        let mut collector = ShapeLabelCollector::default();
        let mut selected = candidate(ShapeLabelKind::Pin, anchor, "VSS");
        selected.selected = true;
        collector.insert(selected);

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(500.0, 500.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        let label = &resolved.labels[0];
        assert_ne!(label.text, "VSS");
        assert!(label.text.ends_with('…'));
        assert_eq!(label.font_size, 11.0);
    }

    #[test]
    fn tall_pin_label_rotates_to_show_the_full_name() {
        let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(20.0, 120.0));
        let mut collector = ShapeLabelCollector::default();
        collector.insert(candidate(ShapeLabelKind::Pin, anchor, "WELLTAP_54"));

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(500.0, 500.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        let label = &resolved.labels[0];
        assert_eq!(label.text, "WELLTAP_54");
        assert_eq!(label.font_size, 11.0);
        assert!(label.vertical);
        assert!(label
            .anchor_rect
            .contains_rect(label.rect.intersect(label.anchor_rect)));
    }

    fn assert_pin_threshold(kind: ShapeLabelKind, sizes: [(egui::Vec2, bool); 3]) {
        for (size, expected) in sizes {
            let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), size);
            let item = candidate(kind, anchor, "VSS");
            assert_eq!(candidate_eligible(&item, anchor), expected, "size {size:?}");
        }
    }

    #[test]
    fn io_pin_label_threshold_is_3_by_10_pixels() {
        assert_pin_threshold(
            ShapeLabelKind::IoPin,
            [
                (egui::vec2(3.0, 10.0), true),
                (egui::vec2(2.9, 10.0), false),
                (egui::vec2(3.0, 9.9), false),
            ],
        );
    }

    #[test]
    fn instance_pin_label_threshold_is_10_by_28_pixels() {
        assert_pin_threshold(
            ShapeLabelKind::Pin,
            [
                (egui::vec2(10.0, 28.0), true),
                (egui::vec2(9.9, 28.0), false),
                (egui::vec2(10.0, 27.9), false),
            ],
        );
    }

    #[test]
    fn selected_tiny_pin_label_is_clipped_to_the_anchor() {
        let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(2.0, 9.0));
        let mut collector = ShapeLabelCollector::default();
        let mut selected = candidate(ShapeLabelKind::Pin, anchor, "VSS");
        selected.selected = true;
        collector.insert(selected);

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(500.0, 500.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        let label = &resolved.labels[0];
        let clip_rect = label.rect.intersect(label.anchor_rect);
        assert!(clip_rect.is_positive());
        assert!(label.anchor_rect.contains_rect(clip_rect));
        assert_eq!(clip_rect.size(), anchor.size());
    }

    #[test]
    fn pin_label_wins_a_collision_with_an_instance_label() {
        let anchor = egui::Rect::from_min_max(egui::pos2(100.0, 100.0), egui::pos2(300.0, 220.0));
        let mut collector = ShapeLabelCollector::default();
        collector.insert(candidate(ShapeLabelKind::Instance, anchor, "macro_0"));
        collector.insert(candidate(ShapeLabelKind::Pin, anchor, "VSS"));

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(500.0, 500.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        assert_eq!(resolved.labels[0].kind, ShapeLabelKind::Pin);
        assert_eq!(resolved.collision_suppressed, 1);
    }

    #[test]
    fn long_pin_name_is_ellipsized_inside_the_anchor() {
        let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(12.0, 100.0));
        let mut collector = ShapeLabelCollector::default();
        collector.insert(candidate(
            ShapeLabelKind::Pin,
            anchor,
            "prefix_very_long_pin_name_suffix",
        ));

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(400.0, 500.0)),
            measure,
        );

        assert_eq!(resolved.labels.len(), 1);
        let label = &resolved.labels[0];
        assert!(label.text.ends_with('…'));
        assert_eq!(label.font_size, 11.0);
        assert!(label
            .anchor_rect
            .contains_rect(label.rect.intersect(label.anchor_rect)));
    }

    #[test]
    fn collector_keeps_selected_candidate_for_the_same_owner() {
        let large = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(200.0, 100.0));
        let small = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(12.0, 20.0));
        let key = ShapeLabelKey::Owner {
            owner_type: ShapeLabelKind::Pin as u8,
            owner_id: 7,
        };
        let mut normal = candidate(ShapeLabelKind::Pin, large, "VSS");
        normal.key = key.clone();
        let mut selected = candidate(ShapeLabelKind::Pin, small, "VSS");
        selected.key = key.clone();
        selected.selected = true;
        let mut collector = ShapeLabelCollector::default();
        collector.insert(normal.clone());
        collector.insert(selected);
        collector.insert(normal);

        assert_eq!(collector.candidates.len(), 1);
        let kept = collector.candidates.get(&key).expect("selected candidate");
        assert!(kept.selected);
        assert_eq!(kept.anchor_rect, small);
    }

    #[test]
    fn selected_label_reserves_space_and_suppresses_collisions() {
        let anchor = egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(200.0, 80.0));
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(240.0, 120.0));
        let mut selected = candidate(ShapeLabelKind::Pin, anchor, "VSS");
        selected.selected = true;
        let mut ordinary = candidate(ShapeLabelKind::Pin, anchor, "VDD");
        ordinary.key = ShapeLabelKey::Owner {
            owner_type: ShapeLabelKind::Pin as u8,
            owner_id: 2,
        };
        let mut collector = ShapeLabelCollector::default();
        collector.insert(ordinary);
        collector.insert(selected);

        let resolved = collector.resolve(canvas, measure);

        assert_eq!(resolved.candidate_count, 2);
        assert_eq!(resolved.labels.len(), 1);
        assert!(resolved.labels[0].selected);
        assert_eq!(resolved.collision_suppressed, 1);
    }

    #[test]
    fn highlighted_pin_still_respects_the_size_threshold() {
        let anchor = egui::Rect::from_min_size(egui::pos2(100.0, 100.0), egui::vec2(5.0, 15.0));
        let mut highlighted = candidate(ShapeLabelKind::Pin, anchor, "VSS");
        highlighted.highlighted = true;

        assert!(!candidate_eligible(&highlighted, anchor));
    }

    #[test]
    fn equal_priority_uses_the_stable_key_order() {
        let anchor = egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(200.0, 80.0));
        let canvas = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(240.0, 120.0));
        let mut first = candidate(ShapeLabelKind::Pin, anchor, "A");
        first.key = ShapeLabelKey::Named {
            kind: ShapeLabelKind::Pin,
            text: "A".to_string(),
        };
        let mut second = candidate(ShapeLabelKind::Pin, anchor, "B");
        second.key = ShapeLabelKey::Named {
            kind: ShapeLabelKind::Pin,
            text: "B".to_string(),
        };
        let mut collector = ShapeLabelCollector::default();
        collector.insert(second);
        collector.insert(first);

        let resolved = collector.resolve(canvas, measure);

        assert_eq!(resolved.labels.len(), 1);
        assert_eq!(resolved.labels[0].text, "A");
        assert_eq!(resolved.collision_suppressed, 1);
    }

    #[test]
    fn collision_order_is_selected_highlighted_then_kind_priority() {
        let mut collector = ShapeLabelCollector::default();
        for (index, kind) in [
            ShapeLabelKind::Instance,
            ShapeLabelKind::Pdn,
            ShapeLabelKind::Net,
            ShapeLabelKind::Pin,
            ShapeLabelKind::IoPin,
        ]
        .into_iter()
        .enumerate()
        {
            let anchor = egui::Rect::from_min_size(
                egui::pos2(50.0 + index as f32 * 150.0, 100.0),
                egui::vec2(120.0, 80.0),
            );
            let mut item = candidate(kind, anchor, "name");
            item.highlighted = kind == ShapeLabelKind::Net;
            item.selected = kind == ShapeLabelKind::Pin;
            if item.selected {
                item.key = ShapeLabelKey::Owner {
                    owner_type: ShapeLabelKind::Pin as u8,
                    owner_id: 99,
                };
            }
            if item.highlighted {
                item.key = ShapeLabelKey::Named {
                    kind,
                    text: "highlighted_net".to_string(),
                };
            }
            collector.insert(item);
        }
        collector.insert(candidate(
            ShapeLabelKind::Pin,
            egui::Rect::from_min_size(egui::pos2(800.0, 100.0), egui::vec2(120.0, 80.0)),
            "normal_pin",
        ));
        collector.insert(candidate(
            ShapeLabelKind::Net,
            egui::Rect::from_min_size(egui::pos2(950.0, 100.0), egui::vec2(120.0, 80.0)),
            "normal_net",
        ));

        let resolved = collector.resolve(
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1200.0, 500.0)),
            measure,
        );
        let order = resolved
            .labels
            .iter()
            .map(|label| label.kind)
            .collect::<Vec<_>>();

        assert_eq!(
            order,
            vec![
                ShapeLabelKind::Pin,
                ShapeLabelKind::Net,
                ShapeLabelKind::IoPin,
                ShapeLabelKind::Pin,
                ShapeLabelKind::Net,
                ShapeLabelKind::Pdn,
                ShapeLabelKind::Instance,
            ]
        );
    }
}
