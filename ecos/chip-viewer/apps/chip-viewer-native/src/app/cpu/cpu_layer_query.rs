//! Per-layer query/build preparation with deterministic ordered consumption.
//! Query results are bounded by a layer lookahead window; built results have
//! their own credit limit and a reserved worker group for the presentation frontier.
use super::*;
use std::ops::Range;

#[path = "cpu_layer_schedule.rs"]
mod schedule;

#[path = "cpu_layer_baseline.rs"]
mod baseline;

pub(super) fn run_records<Output: Send>(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Arc<[usize]> + Sync,
    build: impl Fn(Arc<[usize]>, Range<usize>) -> Option<Output> + Sync,
    consume: impl FnMut(Output) -> bool,
) -> Option<Duration> {
    run_shared(layers, workers, is_current, query, build, consume)
}

fn run_shared<Item: Send + Sync, Output: Send>(
    layers: &[LayerId],
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    query: impl Fn(LayerId) -> Arc<[Item]> + Sync,
    build: impl Fn(Arc<[Item]>, Range<usize>) -> Option<Output> + Sync,
    consume: impl FnMut(Output) -> bool,
) -> Option<Duration> {
    if std::env::var_os("ECOS_DISABLE_LAYER_SCHEDULER").is_some() {
        baseline::run_shared(layers, workers, is_current, query, build, consume)
    } else {
        schedule::run_shared(layers, workers, is_current, query, build, consume)
    }
}

const FIRST_IDS: usize = 64;
const MAX_IDS: usize = 4096;

pub(super) fn tail_chunk_size(count: usize, workers: usize) -> usize {
    (count / workers.max(1)).clamp(1, MAX_IDS)
}

struct Layer<Item> {
    indices: Option<Arc<[Item]>>,
    offset: usize,
    submitted: usize,
    consumed: usize,
    chunks: Option<usize>,
    chunk_size: usize,
}

impl<Item> Default for Layer<Item> {
    fn default() -> Self {
        Self {
            indices: None,
            offset: 0,
            submitted: 0,
            consumed: 0,
            chunks: None,
            chunk_size: 0,
        }
    }
}

impl<Item> Layer<Item> {
    fn queried(&mut self, indices: Arc<[Item]>, workers: usize) {
        self.chunk_size = tail_chunk_size(indices.len().saturating_sub(FIRST_IDS), workers);
        let tail = indices.len().saturating_sub(FIRST_IDS);
        self.chunks = Some(usize::from(!indices.is_empty()) + tail.div_ceil(self.chunk_size));
        if !indices.is_empty() {
            self.indices = Some(indices);
        }
    }

    fn available(&self) -> bool {
        self.indices.is_some()
    }

    fn take(&mut self, rank: usize) -> BuildTask<Item> {
        let indices = Arc::clone(self.indices.as_ref().unwrap());
        let length = if self.submitted == 0 {
            FIRST_IDS
        } else {
            self.chunk_size
        };
        let end = (self.offset + length).min(indices.len());
        let task = BuildTask {
            rank,
            chunk: self.submitted,
            indices,
            range: self.offset..end,
        };
        self.offset = end;
        self.submitted += 1;
        if end == task.indices.len() {
            self.indices = None;
        }
        task
    }
}

struct BuildTask<Item> {
    rank: usize,
    chunk: usize,
    indices: Arc<[Item]>,
    range: Range<usize>,
}

struct Preparation<Item> {
    layers: Vec<Layer<Item>>,
    frontier: usize,
    next_query: usize,
    round_robin: usize,
    running_builds: usize,
    outstanding: usize,
    build_workers: usize,
    query_workers: usize,
}

impl<Item> Preparation<Item> {
    fn new(layers: usize, workers: usize) -> Self {
        Self {
            layers: (0..layers).map(|_| Layer::default()).collect(),
            frontier: 0,
            next_query: 0,
            round_robin: 0,
            running_builds: 0,
            outstanding: 0,
            build_workers: workers.clamp(1, 8),
            query_workers: workers.clamp(2, 4),
        }
    }

    fn query_limit(&self) -> usize {
        (self.frontier + self.query_workers * 2).min(self.layers.len())
    }

    fn take_build(&mut self) -> Option<BuildTask<Item>> {
        if self.running_builds == self.build_workers || self.frontier == self.layers.len() {
            return None;
        }
        let first = &self.layers[self.frontier];
        let saturated = self.outstanding >= self.build_workers * 2;
        let rank = if first.available() {
            // Only the frontier can become visible. Give it the worker group
            // before preparing later layers, including when lookahead is full.
            if saturated && first.submitted - first.consumed >= self.build_workers {
                return None;
            }
            self.frontier
        } else {
            if saturated {
                return None;
            }
            // Query prefetch remains independent. Use idle workers for later
            // ready layers while the frontier query or its last builds finish.
            let mut selected = None;
            let limit = self.query_limit();
            for step in 0..limit {
                let rank = (self.round_robin + step) % limit;
                if rank > self.frontier && self.layers[rank].available() {
                    selected = Some(rank);
                    break;
                }
            }
            selected?
        };
        self.round_robin = rank + 1;
        self.running_builds += 1;
        self.outstanding += 1;
        Some(self.layers[rank].take(rank))
    }
}

#[cfg(test)]
#[path = "cpu_layer_schedule_tests.rs"]
mod tests;
