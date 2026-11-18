use super::*;

fn review() -> DrcReview {
    DrcReview {
        layers: vec![
            RoutingLayer {
                id: 12,
                name: "M1".into(),
                z0: 500.0,
                z1: 600.0,
            },
            RoutingLayer {
                id: 3,
                name: "M2".into(),
                z0: 900.0,
                z1: 1000.0,
            },
            RoutingLayer {
                id: 20,
                name: "M10".into(),
                z0: 1300.0,
                z1: 1400.0,
            },
        ],
        ..DrcReview::default()
    }
}

#[test]
fn review_follows_physical_order_and_seeks_deterministically() {
    let review = review();
    for (seconds, index) in [(0.4, 0), (1.3, 1), (2.2, 2), (1.3, 1)] {
        let progress = (seconds / duration(3)) as f32;
        let scan = review.scan(progress).unwrap();
        assert_eq!(scan.layer, index);
        assert_eq!(scan.transition, review.scan(progress).unwrap().transition);
        assert_eq!(scan.transition.to.coverage(2, 1600.0), 0.0);
        assert_eq!(scan.transition.to.coverage(2, review.layers[index].z1), 1.0);
        if index > 0 {
            assert_eq!(scan.transition.to.coverage(2, 550.0), 0.18);
        }
    }
    let scan = review
        .scan(((duration(3) - 0.2) / duration(3)) as f32)
        .unwrap();
    assert!(scan.restoring);
    assert_eq!(
        (scan.transition.to, scan.transition.fraction),
        (Style::default(), 1.0)
    );
    assert!(review.scan(1.0).is_none());
    assert!(DrcReview::default().scan(0.5).is_none());
}

#[test]
fn markers_use_recorded_layers_and_do_not_invent_missing_associations() {
    let review = review();
    for (details, expected) in [
        (serde_json::json!({"layer": "M2"}), Some(1)),
        (serde_json::json!({"layer_id": 20}), Some(2)),
        (serde_json::json!({"layer": "M99"}), None),
        (serde_json::json!({}), None),
    ] {
        assert_eq!(
            review.layer_for_item(&Item {
                details,
                ..Item::default()
            }),
            expected
        );
    }
}
