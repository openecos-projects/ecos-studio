use super::*;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub(in crate::app) struct LabelPlan<'a> {
    canvas: egui::Rect,
    candidate_count: usize,
    candidates: Vec<&'a ShapeLabelCandidate>,
}

struct PreparedCandidate<'a> {
    order: usize,
    candidate: &'a ShapeLabelCandidate,
    placements: Vec<LabelPlacement>,
}

impl ShapeLabelCollector {
    pub(in crate::app) fn plan(&self, canvas: egui::Rect) -> LabelPlan<'_> {
        let mut candidates: Vec<_> = self
            .candidates
            .values()
            .filter(|candidate| {
                candidate_eligible(candidate, candidate.anchor_rect.intersect(canvas))
            })
            .collect();
        candidates.sort_by(|left, right| {
            label_priority(left)
                .cmp(&label_priority(right))
                .then_with(|| right.rank_area.total_cmp(&left.rank_area))
                .then_with(|| left.key.cmp(&right.key))
        });
        LabelPlan {
            canvas,
            candidate_count: self.candidate_count(),
            candidates,
        }
    }
}

impl<'a> LabelPlan<'a> {
    pub(in crate::app) fn worker_count(&self, maximum: usize) -> usize {
        match self.candidates.len() {
            0 => 0,
            1..=127 => 1,
            count => maximum.max(1).min(count),
        }
    }

    /// Measures independently on equivalent worker-private font contexts, then
    /// applies visibility and collision decisions in the original stable order.
    #[cfg(test)]
    pub(in crate::app) fn resolve(
        self,
        workers: usize,
        measure: impl Fn(usize, &str, f32) -> egui::Vec2 + Sync,
        is_current: impl Fn() -> bool + Sync,
    ) -> Option<ResolvedLabels> {
        self.resolve_measured(
            workers,
            |worker| {
                let measure = &measure;
                move |text: &str, size| measure(worker, text, size)
            },
            is_current,
        )
    }

    pub(in crate::app) fn resolve_measured<Measurement: LabelMeasurement>(
        self,
        workers: usize,
        measurement: impl Fn(usize) -> Measurement + Sync,
        is_current: impl Fn() -> bool + Sync,
    ) -> Option<ResolvedLabels> {
        if !is_current() {
            return None;
        }
        if self.candidates.is_empty() {
            return Some(ResolvedLabels {
                candidate_count: self.candidate_count,
                ..Default::default()
            });
        }
        assert!(
            workers > 0,
            "nonempty label plan requires a measurement worker"
        );
        let mut groups: Vec<Vec<_>> = (0..workers).map(|_| Vec::new()).collect();
        for (order, candidate) in self.candidates.iter().copied().enumerate() {
            let worker = stable_worker(&candidate.key, workers);
            groups[worker].push((order, candidate));
        }
        let prepare = |worker, group: Vec<(usize, &'a ShapeLabelCandidate)>| {
            let measure = measurement(worker);
            group
                .into_iter()
                .map(|(order, candidate)| {
                    if !is_current() {
                        return None;
                    }
                    let placements = candidate_placements(candidate, self.canvas, &measure);
                    Some(PreparedCandidate {
                        order,
                        candidate,
                        placements,
                    })
                })
                .collect::<Option<Vec<_>>>()
        };
        let mut prepared = if workers == 1 {
            prepare(0, groups.pop().unwrap())?
        } else {
            std::thread::scope(|scope| {
                let tasks: Vec<_> = groups
                    .into_iter()
                    .enumerate()
                    .map(|(worker, group)| {
                        let prepare = &prepare;
                        scope.spawn(move || prepare(worker, group))
                    })
                    .collect();
                tasks
                    .into_iter()
                    .map(|task| task.join().expect("label measurement worker panicked"))
                    .collect::<Option<Vec<_>>>()
            })?
            .into_iter()
            .flatten()
            .collect()
        };
        prepared.sort_unstable_by_key(|candidate| candidate.order);
        let mut labels = Vec::new();
        let mut accepted_rects = LabelCollisionIndex::default();
        let mut collision_suppressed = 0;
        for PreparedCandidate {
            candidate,
            placements,
            ..
        } in prepared
        {
            if !is_current() {
                return None;
            }
            if placements.is_empty() {
                continue;
            }
            let mut placed = false;
            for placement in placements {
                let visible_rect = placement
                    .rect
                    .intersect(candidate.anchor_rect)
                    .intersect(self.canvas);
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
        is_current().then_some(ResolvedLabels {
            labels,
            candidate_count: self.candidate_count,
            collision_suppressed,
        })
    }
}

fn stable_worker(key: &ShapeLabelKey, workers: usize) -> usize {
    let mut hash = DefaultHasher::new();
    key.hash(&mut hash);
    (hash.finish() % workers as u64) as usize
}

#[cfg(test)]
#[path = "label_preparation_tests.rs"]
mod tests;
