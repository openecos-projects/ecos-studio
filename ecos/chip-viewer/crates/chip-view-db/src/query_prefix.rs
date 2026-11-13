use super::*;

/// Bounds both returned IDs and spatial candidates visited by a prefix query.
#[derive(Clone, Copy, Debug)]
pub struct QueryPrefixLimits {
    pub max_results: usize,
    pub max_candidates: usize,
}

impl LayerShapeIndex {
    /// Returns the exact sorted layer-query prefix, or `None` when the candidate
    /// budget is exhausted. Exhaustion never returns an approximate prefix.
    pub fn try_query_layer_intersect_prefix(
        &self,
        shapes: &[ShapeRecord],
        layer_id: u16,
        bbox: Rect32,
        limits: QueryPrefixLimits,
    ) -> Option<Vec<ShapeId>> {
        if limits.max_results == 0 {
            return Some(Vec::new());
        }
        let whole_layer = self.layer_bboxes.iter().any(|entry| {
            entry.layer_id == layer_id
                && bbox.lx <= entry.envelope.lower()[0]
                && bbox.ly <= entry.envelope.lower()[1]
                && bbox.hx >= entry.envelope.upper()[0]
                && bbox.hy >= entry.envelope.upper()[1]
        });
        let mut ids = Vec::new();
        if whole_layer {
            let Some(indices) = self.by_layer.get(&layer_id) else {
                return Some(ids);
            };
            if indices.len() > limits.max_candidates {
                return None;
            }
            ids.extend(indices.iter().map(|index| shapes[*index].id));
        } else if let Some(tree) = self.spatial_by_layer.get(&layer_id) {
            for (visited, entry) in tree
                .locate_in_envelope_intersecting(rect_envelope(bbox))
                .enumerate()
            {
                if visited == limits.max_candidates {
                    return None;
                }
                let shape = &shapes[entry.index];
                if shape.bbox.intersects(bbox) {
                    ids.push(shape.id);
                }
            }
        }
        ids.sort_unstable();
        ids.truncate(limits.max_results);
        Some(ids)
    }
}

impl ChipViewDb {
    /// Bounded counterpart of `query_layers_intersect(&[layer_id], bbox)`.
    pub fn try_query_layer_intersect_prefix(
        &self,
        layer_id: u16,
        bbox: Rect32,
        limits: QueryPrefixLimits,
    ) -> Option<Vec<ShapeId>> {
        self.layer_index.try_query_layer_intersect_prefix(
            self.snapshot.shapes(),
            layer_id,
            bbox,
            limits,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_prefix_matches_complete_query_order_for_spatial_and_whole_layer_views() {
        let shapes: Vec<_> = (0..128)
            .map(|index| ShapeRecord {
                id: (128 - index) / 2,
                layer_id: (index % 3) as u16,
                state: if index % 7 == 0 {
                    ShapeState::Deleted
                } else {
                    ShapeState::Alive
                } as u8,
                bbox: Rect32 {
                    lx: index as i32 * 3,
                    ly: 0,
                    hx: index as i32 * 3 + 10,
                    hy: 20,
                },
                ..Default::default()
            })
            .collect();
        let index = LayerShapeIndex::from_shapes(&shapes);
        for layer in [0, 1, 2, 9] {
            for bbox in [
                Rect32 {
                    lx: -100,
                    ly: -100,
                    hx: 1000,
                    hy: 1000,
                },
                Rect32 {
                    lx: 60,
                    ly: 10,
                    hx: 200,
                    hy: 10,
                },
                Rect32 {
                    lx: 500,
                    ly: 0,
                    hx: 501,
                    hy: 1,
                },
                Rect32 {
                    lx: 200,
                    ly: 20,
                    hx: 100,
                    hy: 0,
                },
            ] {
                for max_results in [0, 1, 16, 64, 200] {
                    let mut expected = index.query_layers_intersect(&shapes, &[layer], bbox);
                    expected.truncate(max_results);
                    assert_eq!(
                        index.try_query_layer_intersect_prefix(
                            &shapes,
                            layer,
                            bbox,
                            QueryPrefixLimits {
                                max_results,
                                max_candidates: 128
                            },
                        ),
                        Some(expected)
                    );
                }
            }
        }
    }

    #[test]
    fn exhaustion_returns_no_prefix_even_when_early_candidates_fill_the_output() {
        let shapes: Vec<_> = (0..100)
            .map(|id| ShapeRecord {
                id: 100 - id,
                layer_id: 1,
                state: ShapeState::Alive as u8,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 10,
                    hy: 10,
                },
                ..Default::default()
            })
            .collect();
        let index = LayerShapeIndex::from_shapes(&shapes);
        for bbox in [
            Rect32 {
                lx: -1,
                ly: -1,
                hx: 11,
                hy: 11,
            },
            Rect32 {
                lx: 2,
                ly: 2,
                hx: 3,
                hy: 3,
            },
        ] {
            assert!(index
                .try_query_layer_intersect_prefix(
                    &shapes,
                    1,
                    bbox,
                    QueryPrefixLimits {
                        max_results: 1,
                        max_candidates: 99
                    }
                )
                .is_none());
            assert_eq!(
                index.try_query_layer_intersect_prefix(
                    &shapes,
                    1,
                    bbox,
                    QueryPrefixLimits {
                        max_results: 1,
                        max_candidates: 100
                    }
                ),
                Some(vec![1])
            );
        }
    }
}
