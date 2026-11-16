use super::*;

/// Bounded spatial sample for previews, never an exact query prefix. IDs are
/// sorted only within the sample so a caller can preserve record paint order.
#[derive(Debug)]
pub struct LayerQuerySample {
    pub ids: Vec<ShapeId>,
    pub visited_candidates: usize,
}

impl LayerShapeIndex {
    pub fn query_layer_intersect_sample(
        &self,
        shapes: &[ShapeRecord],
        layer: u16,
        bbox: Rect32,
        max_candidates: usize,
    ) -> LayerQuerySample {
        let mut result = LayerQuerySample {
            ids: Vec::new(),
            visited_candidates: 0,
        };
        if let Some(tree) = self.spatial_by_layer.get(&layer) {
            for entry in tree
                .locate_in_envelope_intersecting(rect_envelope(bbox))
                .take(max_candidates)
            {
                result.visited_candidates += 1;
                let shape = &shapes[entry.index];
                if shape.bbox.intersects(bbox) {
                    result.ids.push(shape.id);
                }
            }
        }
        result.ids.sort_unstable();
        result
    }
}

impl ChipViewDb {
    /// Visits at most `max_candidates` spatial hits, including whole-layer
    /// views; it does not enumerate or sort the complete layer first.
    pub fn query_layer_intersect_sample(
        &self,
        layer: u16,
        bbox: Rect32,
        max_candidates: usize,
    ) -> LayerQuerySample {
        self.layer_index.query_layer_intersect_sample(
            self.snapshot.shapes(),
            layer,
            bbox,
            max_candidates,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dense_spatial_and_whole_layer_samples_stop_at_the_candidate_budget() {
        let shapes = (0..100_000)
            .map(|index| ShapeRecord {
                id: 100_000 - index,
                layer_id: 1,
                state: ShapeState::Alive as u8,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 100,
                    hy: 100,
                },
                ..Default::default()
            })
            .collect::<Vec<_>>();
        let index = LayerShapeIndex::from_shapes(&shapes);
        for bbox in [
            Rect32 {
                lx: -1,
                ly: -1,
                hx: 101,
                hy: 101,
            },
            Rect32 {
                lx: 10,
                ly: 10,
                hx: 20,
                hy: 20,
            },
        ] {
            for budget in [0, 1, 8, 64] {
                let sample = index.query_layer_intersect_sample(&shapes, 1, bbox, budget);
                assert_eq!(sample.visited_candidates, budget);
                assert_eq!(sample.ids.len(), budget);
                assert!(sample.ids.windows(2).all(|ids| ids[0] < ids[1]));
                assert!(sample.ids.iter().all(|id| (1..=100_000).contains(id)));
            }
        }
    }
}
