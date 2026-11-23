use super::*;
use std::ops::Range;

enum Event<Item, Output> {
    Query(usize, Arc<[Item]>, Duration),
    Built(usize, usize, Option<Output>),
    Panicked,
}

struct StopOnDrop<'a>(&'a AtomicBool);
impl Drop for StopOnDrop<'_> {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

struct PanicSignal<'a, Item, Output>(&'a mpsc::Sender<Event<Item, Output>>);
impl<Item, Output> Drop for PanicSignal<'_, Item, Output> {
    fn drop(&mut self) {
        if thread::panicking() {
            let _sent = self.0.send(Event::Panicked);
        }
    }
}

/// Layers query concurrently. Builds prioritize the consumption frontier;
/// spare workers prepare later ready layers in round-robin order while the
/// frontier query is pending or all its chunks have already been dispatched.
/// Consumption remains strictly (requested layer position, chunk position):
/// every progressive output is a valid global source-over prefix. Returned
/// duration is summed query service time, not parallel elapsed time.
///
/// At most 2..4 query workers and 1..8 build workers are live. Query lookahead
/// retains at most twice the query-worker count in full-layer ID vectors;
/// build lookahead retains at most 3*build_workers unconsumed chunks, reserving
/// a whole worker group for a late or dominant frontier layer. A query
/// already executing is not interruptible; cancellation checks stop dispatch
/// and reject its result, then scope teardown waits for active calls to return.
#[cfg(test)]
pub(in crate::app::cpu_scene) fn run<Output: Send>(
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
    mut consume: impl FnMut(Output) -> bool,
) -> Option<Duration> {
    if !is_current() {
        return None;
    }
    if layers.is_empty() {
        return Some(Duration::ZERO);
    }
    let stopped = AtomicBool::new(false);
    thread::scope(|scope| {
        let _stop_on_drop = StopOnDrop(&stopped);
        let (events, completed) = mpsc::channel();
        let (queries, waiting_queries) = mpsc::channel::<usize>();
        let waiting_queries = Arc::new(Mutex::new(waiting_queries));
        let (builds, waiting_builds) = mpsc::channel::<BuildTask<Item>>();
        let waiting_builds = Arc::new(Mutex::new(waiting_builds));
        let mut preparation = Preparation::<Item>::new(layers.len(), workers);
        for _ in 0..preparation.query_workers.min(layers.len()) {
            let (waiting, events, query, stopped) = (
                Arc::clone(&waiting_queries),
                events.clone(),
                &query,
                &stopped,
            );
            scope.spawn(move || {
                let _panic_signal = PanicSignal(&events);
                while !stopped.load(Ordering::Acquire) && is_current() {
                    let Ok(rank) = waiting.lock().unwrap().recv() else {
                        break;
                    };
                    if stopped.load(Ordering::Acquire) || !is_current() {
                        break;
                    }
                    let started = Instant::now();
                    let indices = query(layers[rank]);
                    let duration = started.elapsed();
                    if stopped.load(Ordering::Acquire) || !is_current() {
                        break;
                    }
                    if events.send(Event::Query(rank, indices, duration)).is_err() {
                        break;
                    }
                }
            });
        }
        for _ in 0..preparation.build_workers {
            let (waiting, events, build, stopped) = (
                Arc::clone(&waiting_builds),
                events.clone(),
                &build,
                &stopped,
            );
            scope.spawn(move || {
                let _panic_signal = PanicSignal(&events);
                while !stopped.load(Ordering::Acquire) && is_current() {
                    let Ok(task) = waiting.lock().unwrap().recv() else {
                        break;
                    };
                    if stopped.load(Ordering::Acquire) || !is_current() {
                        break;
                    }
                    let output = build(task.indices, task.range);
                    if events
                        .send(Event::Built(task.rank, task.chunk, output))
                        .is_err()
                    {
                        break;
                    }
                }
            });
        }
        drop(events);
        drop(waiting_queries);
        drop(waiting_builds);
        let mut pending = BTreeMap::new();
        let mut duration = Duration::ZERO;
        let result = loop {
            if !is_current() {
                break None;
            }
            while preparation.frontier < layers.len() {
                let rank = preparation.frontier;
                let layer = &mut preparation.layers[rank];
                if let Some(output) = pending.remove(&(rank, layer.consumed)) {
                    if !is_current() || !consume(output) {
                        stopped.store(true, Ordering::Release);
                        break;
                    }
                    layer.consumed += 1;
                    preparation.outstanding -= 1;
                } else if layer.chunks == Some(layer.consumed) {
                    preparation.frontier += 1;
                } else {
                    break;
                }
            }
            if stopped.load(Ordering::Acquire) || !is_current() {
                break None;
            }
            if preparation.frontier == layers.len() {
                break Some(duration);
            }
            while preparation.next_query < preparation.query_limit() {
                if queries.send(preparation.next_query).is_err() {
                    stopped.store(true, Ordering::Release);
                    break;
                }
                preparation.next_query += 1;
            }
            while let Some(task) = preparation.take_build() {
                if builds.send(task).is_err() {
                    stopped.store(true, Ordering::Release);
                    break;
                }
            }
            if stopped.load(Ordering::Acquire) {
                break None;
            }
            // Poll cancellation even when all outstanding work is in a slow
            // query. No UI thread or graphics context participates here.
            match completed.recv_timeout(Duration::from_millis(10)) {
                Ok(Event::Query(rank, indices, elapsed)) => {
                    preparation.layers[rank].queried(indices, preparation.build_workers);
                    duration += elapsed;
                }
                Ok(Event::Built(rank, chunk, Some(output))) => {
                    preparation.running_builds -= 1;
                    pending.insert((rank, chunk), output);
                }
                Ok(Event::Built(_, _, None) | Event::Panicked) => break None,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break None,
            }
        };
        stopped.store(true, Ordering::Release);
        drop(queries);
        drop(builds);
        drop(completed);
        result.filter(|_| is_current())
    })
}
