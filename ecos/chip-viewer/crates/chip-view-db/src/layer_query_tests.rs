use super::*;

#[test]
fn multi_layer_query_matches_record_order_independent_reference() {
    let shapes: Vec<_> = (0..2048)
        .map(|index| ShapeRecord {
            id: ((index * 997) % 257) as u64,
            layer_id: (index % 7 + 1) as u16,
            state: if index % 11 == 0 {
                ShapeState::Deleted
            } else {
                ShapeState::Alive
            } as u8,
            bbox: Rect32 {
                lx: index % 101 - 50,
                ly: index % 53 - 26,
                hx: index % 101 - 47,
                hy: index % 53 - 22,
            },
            ..Default::default()
        })
        .collect();
    let index = LayerShapeIndex::from_shapes(&shapes);
    for layers in [vec![], vec![7, 1, 3, 2], vec![2, 2, 9, 1]] {
        for viewport in [
            Rect32 {
                lx: -100,
                ly: -100,
                hx: 100,
                hy: 100,
            },
            Rect32 {
                lx: -7,
                ly: -4,
                hx: 0,
                hy: 3,
            },
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 0,
                hy: 0,
            },
            Rect32 {
                lx: 200,
                ly: 200,
                hx: 300,
                hy: 300,
            },
            Rect32 {
                lx: 100,
                ly: 100,
                hx: -100,
                hy: -100,
            },
        ] {
            let mut expected = Vec::new();
            for layer in &layers {
                let mut hits: Vec<_> = shapes
                    .iter()
                    .filter(|shape| {
                        shape.layer_id == *layer
                            && shape.state == ShapeState::Alive as u8
                            && shape.bbox.intersects(viewport)
                    })
                    .map(|shape| shape.id)
                    .collect();
                hits.sort_unstable();
                expected.extend(hits);
            }
            assert_eq!(
                index.query_layers_intersect(&shapes, &layers, viewport),
                expected
            );
        }
    }
}
