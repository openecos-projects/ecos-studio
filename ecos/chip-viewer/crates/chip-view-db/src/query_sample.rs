use super::*;

const FALLBACK_SAMPLES_PER_CANDIDATE: usize = 128;

/// Bounded spatial sample for previews, never an exact query prefix. IDs are
/// sorted only within the sample so a caller can preserve record paint order.
/// Before the spatial tree is initialized, a stratified directory sample
/// avoids building it on callers such as the UI preview path.
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
        if max_candidates == 0 {
            return result;
        }
        if let Some(tree) = self
            .spatial_by_layer
            .get(&layer)
            .and_then(|tree| tree.get())
        {
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
        } else if let Some(indices) = self.by_layer.get(&layer) {
            let probes = indices.len().min(
                max_candidates
                    .saturating_mul(FALLBACK_SAMPLES_PER_CANDIDATE)
                    .max(max_candidates),
            );
            for probe in 0..probes {
                if result.ids.len() == max_candidates {
                    break;
                }
                let index = (probe as u128 * indices.len() as u128 / probes as u128) as usize;
                result.visited_candidates += 1;
                let shape = &shapes[indices[index]];
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
        assert_eq!(index.initialized_spatial_tree_count(), 0);
    }

    #[test]
    fn uninitialized_preview_sampling_stays_bounded_and_spatially_stratified() {
        let shapes = (0..10_000)
            .map(|index| {
                let x = index % 100 * 10;
                let y = index / 100 * 10;
                ShapeRecord {
                    id: index as u64 + 1,
                    layer_id: 1,
                    state: ShapeState::Alive as u8,
                    bbox: Rect32 {
                        lx: x,
                        ly: y,
                        hx: x + 2,
                        hy: y + 2,
                    },
                    ..Default::default()
                }
            })
            .collect::<Vec<_>>();
        let index = LayerShapeIndex::from_shapes(&shapes);

        for row in 0..10 {
            for column in 0..10 {
                let bbox = Rect32 {
                    lx: column * 100,
                    ly: row * 100,
                    hx: column * 100 + 100,
                    hy: row * 100 + 100,
                };
                let sample = index.query_layer_intersect_sample(&shapes, 1, bbox, 4);
                assert_eq!(sample.ids.len(), 4, "cell {column},{row}");
                assert!(sample.visited_candidates <= 512);
                assert!(sample.ids.windows(2).all(|pair| pair[0] < pair[1]));
                assert!(sample.ids.iter().all(|id| {
                    let shape = &shapes[*id as usize - 1];
                    shape.bbox.intersects(bbox)
                }));
            }
        }
        assert_eq!(index.initialized_spatial_tree_count(), 0);
    }
}
