//! Original serial layer producer, retained for same-binary measurements.
use super::*;
use std::ops::Range;

#[cfg(test)]
pub(super) fn run<Output: Send>(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Vec<ShapeId> + Sync,
    build: impl Fn(Vec<ShapeId>) -> Option<Output> + Sync,
    consume: impl FnMut(Output) -> bool,
) -> Option<Duration> {
    run_shared(
        layers,
        workers,
        is_current,
        |layer| Arc::from(query(layer)),
        |ids, range| build(ids[range].to_vec()),
        consume,
    )
}

pub(super) fn run_shared<Item: Send + Sync, Output: Send>(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Arc<[Item]> + Sync,
    build: impl Fn(Arc<[Item]>, Range<usize>) -> Option<Output> + Sync,
    consume: impl FnMut(Output) -> bool,
) -> Option<Duration> {
    super::super::ordered::run(
        workers,
        is_current,
        |emit| {
            produce(
                layers,
                workers,
                is_current,
                &query,
                &mut |indices, range| emit((indices, range)),
            )
        },
        |(indices, range)| build(indices, range),
        consume,
    )
}

fn produce<Item: Send + Sync>(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Arc<[Item]>,
    emit: &mut dyn FnMut(Arc<[Item]>, Range<usize>) -> bool,
) -> Option<Duration> {
    let mut duration = Duration::ZERO;
    let mut first = true;
    for layer in layers {
        if !is_current() {
            return None;
        }
        let started = Instant::now();
        let indices = query(*layer);
        duration += started.elapsed();
        if !is_current() {
            return None;
        }
        let mut offset = 0;
        while offset < indices.len() {
            let chunk_size = if first {
                FIRST_IDS
            } else {
                tail_chunk_size(indices.len() - offset, workers)
            };
            let end = (offset + chunk_size).min(indices.len());
            if !emit(Arc::clone(&indices), offset..end) {
                return None;
            }
            first = false;
            offset = end;
        }
    }
    is_current().then_some(duration)
}
