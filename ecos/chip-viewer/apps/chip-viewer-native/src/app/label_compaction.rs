use super::*;

impl ShapeLabelCollector {
    /// Keep drawable anchors and a shared key/rank directory for dormant ones.
    /// Selection can promote a tiny anchor without copying names or scanning
    /// geometry again. The directory preserves deduplication and diagnostics.
    pub(in crate::app) fn compact(&self, canvas: egui::Rect) -> Self {
        if !self.dormant.is_empty() {
            return self.clone();
        }
        let mut candidates = HashMap::new();
        let mut dormant = Vec::new();
        for candidate in self.candidates.values() {
            if candidate_eligible(candidate, candidate.anchor_rect.intersect(canvas)) {
                candidates.insert(candidate.key.clone(), candidate.clone());
            } else {
                dormant.push((candidate.key.clone(), candidate.rank_area));
            }
        }
        dormant.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        Self {
            candidates,
            dormant: dormant.into(),
        }
    }

    pub(in crate::app) fn from_compact_parts(
        labels: Self,
        mut directory: Vec<(ShapeLabelKey, f32)>,
    ) -> Self {
        directory.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        Self {
            candidates: labels.candidates,
            dormant: directory.into(),
        }
    }

    pub(in crate::app) fn merge_compact_sources(sources: Vec<Self>) -> Self {
        let mut winners = Vec::new();
        for (rank, source) in sources.iter().enumerate() {
            winners.extend(
                source
                    .dormant
                    .iter()
                    .map(|(key, area)| (key.clone(), *area, rank)),
            );
        }
        // Stable ordering retains the first source on equal-area candidates,
        // including when that first anchor cannot display a label.
        winners.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.total_cmp(&a.1)));
        winners.dedup_by(|later, first| later.0 == first.0);
        let mut labels = Self::default();
        for (rank, source) in sources.into_iter().enumerate() {
            for (key, candidate) in source.candidates {
                let index = winners
                    .binary_search_by(|(other, _, _)| other.cmp(&key))
                    .unwrap();
                if winners[index].2 == rank {
                    labels.insert(candidate);
                }
            }
        }
        Self::from_compact_parts(
            labels,
            winners
                .into_iter()
                .map(|(key, area, _)| (key, area))
                .collect(),
        )
    }

    pub(super) fn candidate_count(&self) -> usize {
        self.dormant.len()
            + self
                .candidates
                .keys()
                .filter(|key| {
                    self.dormant
                        .binary_search_by(|(other, _)| other.cmp(key))
                        .is_err()
                })
                .count()
    }

    pub(in crate::app) fn retained_bytes(&self) -> usize {
        self.byte_len()
            + self.dormant.len() * std::mem::size_of::<(ShapeLabelKey, f32)>()
            + self
                .dormant
                .iter()
                .map(|(key, _)| match key {
                    ShapeLabelKey::Named { text, .. } => text.capacity(),
                    ShapeLabelKey::Owner { .. } => 0,
                })
                .sum::<usize>()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_chunk_merge_preserves_first_equal_area_anchor_even_when_it_is_ineligible() {
        let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(500.0, 100.0));
        let key = ShapeLabelKey::Owner {
            owner_type: 4,
            owner_id: 9,
        };
        let eligible = ShapeLabelCandidate {
            key: key.clone(),
            anchor_rect: egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(100.0, 8.0)),
            text: "label".into(),
            kind: ShapeLabelKind::Instance,
            rank_area: 800.0,
            selected: false,
            highlighted: false,
        };
        let mut ineligible = eligible.clone();
        ineligible.anchor_rect =
            egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(400.0, 2.0));
        let measure = |text: &str, size| egui::vec2(text.len() as f32 * size * 0.5, size);
        for candidates in [
            [ineligible.clone(), eligible.clone()],
            [eligible, ineligible],
        ] {
            let mut original = ShapeLabelCollector::default();
            let sources = candidates
                .into_iter()
                .map(|candidate| {
                    original.insert(candidate.clone());
                    let mut labels = ShapeLabelCollector::default();
                    if candidate
                        .kind
                        .eligible_in(false, candidate.anchor_rect.intersect(canvas))
                    {
                        labels.insert(candidate);
                    }
                    ShapeLabelCollector::from_compact_parts(labels, vec![(key.clone(), 800.0)])
                })
                .collect();
            let compact = ShapeLabelCollector::merge_compact_sources(sources);
            assert_eq!(
                compact.resolve(canvas, measure),
                original.resolve(canvas, measure)
            );
            assert_eq!(
                compact.compact(canvas).resolve(canvas, measure),
                original.resolve(canvas, measure)
            );
        }
    }

    #[test]
    fn compact_source_matches_full_source_when_tiny_anchor_is_promoted() {
        let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(200.0, 100.0));
        let key = ShapeLabelKey::Owner {
            owner_type: 1,
            owner_id: 7,
        };
        let candidate = ShapeLabelCandidate {
            key,
            anchor_rect: egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(3.0, 8.0)),
            text: "tiny_pin".into(),
            kind: ShapeLabelKind::Pin,
            rank_area: 24.0,
            selected: false,
            highlighted: false,
        };
        let mut full = ShapeLabelCollector::default();
        full.insert(candidate.clone());
        let mut compact = full.compact(canvas);
        let measure = |text: &str, size| egui::vec2(text.len() as f32 * size * 0.5, size);
        assert_eq!(
            compact.resolve(canvas, measure),
            full.resolve(canvas, measure)
        );
        let mut selected = candidate;
        selected.selected = true;
        full.insert(selected.clone());
        compact.insert(selected);
        assert_eq!(
            compact.resolve(canvas, measure),
            full.resolve(canvas, measure)
        );
        assert_eq!(compact.candidate_count(), 1);
    }

    #[test]
    fn shared_directory_preserves_clipped_winners_overlay_dedup_and_selection_reset() {
        let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(200.0, 100.0));
        let make = |id, rect, kind| ShapeLabelCandidate {
            key: ShapeLabelKey::Owner {
                owner_type: kind as u8,
                owner_id: id,
            },
            anchor_rect: rect,
            text: format!("label-{id}"),
            kind,
            rank_area: rect.intersect(canvas).area(),
            selected: false,
            highlighted: false,
        };
        let mut full = ShapeLabelCollector::default();
        for id in 0..1024 {
            full.insert(make(
                id,
                egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(3.0, 8.0)),
                ShapeLabelKind::Pin,
            ));
        }
        full.insert(make(2000, canvas, ShapeLabelKind::Instance));
        let compact = full.compact(canvas);
        assert!(compact.retained_bytes() < full.byte_len());
        let measure = |text: &str, size| egui::vec2(text.len() as f32 * size * 0.5, size);
        for status in [0, 1, 2, 0] {
            let mut extra = ShapeLabelCollector::default();
            let mut promoted = make(
                4,
                egui::Rect::from_min_size(egui::pos2(10.0, 10.0), egui::vec2(2.0, 7.0)),
                ShapeLabelKind::Pin,
            );
            promoted.selected = status == 1;
            promoted.highlighted = status == 2;
            extra.insert(promoted);
            assert_eq!(
                compact.resolve_with(&extra, canvas, measure),
                full.resolve_with(&extra, canvas, measure)
            );
        }
        assert_eq!(
            compact.resolve(canvas, measure),
            full.resolve(canvas, measure)
        );
    }
}
