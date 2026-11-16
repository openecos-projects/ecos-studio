//! Original serial layer producer, retained for same-binary measurements.
use super::*;

pub(super) fn run<Output: Send>(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Vec<ShapeId> + Sync,
    build: impl Fn(Vec<ShapeId>) -> Option<Output> + Sync,
    consume: impl FnMut(Output) -> bool,
) -> Option<Duration> {
    super::super::ordered::run(
        workers,
        is_current,
        |emit| produce(layers, workers, is_current, &query, emit),
        build,
        consume,
    )
}

fn produce(
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
