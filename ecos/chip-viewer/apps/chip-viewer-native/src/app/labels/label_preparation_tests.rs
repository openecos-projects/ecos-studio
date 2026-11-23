use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn measure(text: &str, size: f32) -> egui::Vec2 {
    egui::vec2(text.chars().count() as f32 * size * 0.6, size)
}

fn dense_collector() -> ShapeLabelCollector {
    let mut collector = ShapeLabelCollector::default();
    for index in 0..400 {
        let kind = [
            ShapeLabelKind::IoPin,
            ShapeLabelKind::Pin,
            ShapeLabelKind::Net,
            ShapeLabelKind::Pdn,
            ShapeLabelKind::Instance,
        ][index % 5];
        let anchor_rect = egui::Rect::from_min_size(
            egui::pos2((index % 19) as f32 * 7.25, (index / 19) as f32 * 11.5),
            egui::vec2(80.0, 32.0),
        );
        collector.insert(ShapeLabelCandidate {
            key: ShapeLabelKey::Owner {
                owner_type: kind as u8,
                owner_id: index as u64,
            },
            kind,
            anchor_rect,
            text: format!("label_α_{index}"),
            rank_area: anchor_rect.area(),
            selected: index % 31 == 0,
            highlighted: index % 17 == 0,
        });
    }
    collector
}

#[test]
fn parallel_measurement_preserves_complete_ordered_serial_result() {
    let collector = dense_collector();
    for canvas in [
        egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400.0, 400.0)),
        egui::Rect::from_min_size(egui::pos2(80.0, 140.0), egui::vec2(140.0, 80.0)),
    ] {
        let expected = collector.resolve(canvas, measure);
        for workers in [1, 2, 4, 8] {
            let seen = AtomicUsize::new(0);
            let actual = collector
                .plan(canvas)
                .resolve(
                    workers,
                    |worker, text, size| {
                        seen.fetch_or(1 << worker, Ordering::Relaxed);
                        measure(text, size)
                    },
                    || true,
                )
                .unwrap();
            assert_eq!(actual, expected);
            assert_eq!(seen.load(Ordering::Relaxed), (1 << workers) - 1);
        }
    }
}

#[test]
fn measurement_cancellation_discards_the_entire_label_result() {
    let collector = dense_collector();
    let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400.0, 400.0));
    let calls = AtomicUsize::new(0);
    let result = collector.plan(canvas).resolve(
        4,
        |_, text, size| {
            calls.fetch_add(1, Ordering::Relaxed);
            measure(text, size)
        },
        || calls.load(Ordering::Relaxed) < 10,
    );
    assert!(result.is_none());
    assert!(collector
        .plan(canvas)
        .resolve(
            4,
            |_, _, _| panic!("cancelled plan measured text"),
            || false
        )
        .is_none());
    assert_eq!(
        collector
            .plan(canvas)
            .resolve(4, |_, text, size| measure(text, size), || true)
            .unwrap(),
        collector.resolve(canvas, measure)
    );
}

#[test]
fn stable_assignment_does_not_depend_on_candidate_rank_or_camera() {
    let collector = dense_collector();
    let first = collector.plan(egui::Rect::EVERYTHING);
    let assignments: HashMap<_, _> = first
        .candidates
        .iter()
        .map(|candidate| (candidate.key.clone(), stable_worker(&candidate.key, 4)))
        .collect();
    let next = collector.plan(egui::Rect::from_min_size(
        egui::pos2(40.0, 80.0),
        egui::vec2(100.0, 100.0),
    ));
    for candidate in next.candidates {
        assert_eq!(
            stable_worker(&candidate.key, 4),
            assignments[&candidate.key]
        );
    }
    let empty = ShapeLabelCollector::default();
    let plan = empty.plan(egui::Rect::EVERYTHING);
    assert_eq!(plan.worker_count(4), 0);
    assert_eq!(
        plan.resolve(0, |_, _, _| panic!("empty plan measured text"), || true)
            .unwrap(),
        ResolvedLabels::default()
    );
}
