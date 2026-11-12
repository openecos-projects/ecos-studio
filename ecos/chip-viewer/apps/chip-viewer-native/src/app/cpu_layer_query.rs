use super::*;

const FIRST_IDS: usize = 64;
const MAX_IDS: usize = 4096;

pub(super) fn produce(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Vec<ShapeId>,
    emit: &mut dyn FnMut(Vec<ShapeId>) -> bool,
) -> Option<Duration> {
    let mut duration = Duration::ZERO;
    let mut pending = Vec::with_capacity(FIRST_IDS);
    let mut first = true;
    for layer in layers {
        if !is_current() {
            return None;
        }
        let started = Instant::now();
        let ids = query(*layer);
        duration += started.elapsed();
        if !is_current() {
            return None;
        }
        for shape in ids {
            pending.push(shape);
            let limit = if first { FIRST_IDS } else { MAX_IDS };
            if pending.len() == limit {
                if !emit(std::mem::take(&mut pending)) {
                    return None;
                }
                pending = Vec::with_capacity(MAX_IDS);
                first = false;
            }
        }
        if first && !pending.is_empty() {
            if !emit(std::mem::take(&mut pending)) {
                return None;
            }
            pending = Vec::with_capacity(MAX_IDS);
            first = false;
        }
    }
    for ids in pending.chunks(tail_chunk_size(pending.len(), workers)) {
        if !is_current() || !emit(ids.to_vec()) {
            return None;
        }
    }
    is_current().then_some(duration)
}

pub(super) fn tail_chunk_size(count: usize, workers: usize) -> usize {
    (count / workers.max(1)).clamp(1, MAX_IDS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_layer_is_available_before_querying_the_remaining_layers() {
        let emitted = AtomicBool::new(false);
        let mut output = Vec::new();
        assert!(produce(
            &[1, 2],
            4,
            &|| true,
            |layer| {
                if layer == 2 {
                    assert!(emitted.load(Ordering::SeqCst));
                }
                vec![u64::from(layer)]
            },
            &mut |ids| {
                emitted.store(true, Ordering::SeqCst);
                output.extend(ids);
                true
            }
        )
        .is_some());
        assert_eq!(output, [1, 2]);
    }

    #[test]
    fn chunks_preserve_order_duplicates_and_empty_layers_with_bounded_storage() {
        let layers = [1, 0, 2, 1];
        let query = |layer| {
            (0..u64::from(layer) * 5000)
                .map(|index| u64::from(layer) * 10000 + index)
                .collect::<Vec<_>>()
        };
        let expected: Vec<_> = layers.iter().flat_map(|layer| query(*layer)).collect();
        let mut chunks = Vec::new();
        assert!(produce(&layers, 8, &|| true, query, &mut |ids| {
            chunks.push(ids);
            true
        })
        .is_some());
        assert_eq!(chunks[0].len(), FIRST_IDS);
        assert!(chunks
            .iter()
            .all(|ids| !ids.is_empty() && ids.len() <= MAX_IDS));
        assert_eq!(chunks.into_iter().flatten().collect::<Vec<_>>(), expected);
    }

    #[test]
    fn cancellation_stops_before_later_queries_and_does_not_emit_obsolete_results() {
        let queries = AtomicUsize::new(0);
        assert!(produce(
            &[1, 2],
            8,
            &|| true,
            |_| {
                queries.fetch_add(1, Ordering::SeqCst);
                vec![1]
            },
            &mut |_| false
        )
        .is_none());
        assert_eq!(queries.load(Ordering::SeqCst), 1);
        let current = AtomicBool::new(true);
        assert!(produce(
            &[1, 2],
            8,
            &|| current.load(Ordering::SeqCst),
            |_| {
                current.store(false, Ordering::SeqCst);
                vec![1]
            },
            &mut |_| panic!("obsolete query emitted")
        )
        .is_none());
        assert!(produce(
            &[1],
            8,
            &|| false,
            |_| panic!("cancelled source queried"),
            &mut |_| true
        )
        .is_none());
    }
}
