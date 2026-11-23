use super::*;

enum Event<Output, Metadata> {
    Chunk(usize, Option<Output>, mpsc::Sender<()>),
    Finished(usize, Option<Metadata>),
    Aborted,
}

struct PanicSignal<'a, Output, Metadata>(&'a mpsc::Sender<Event<Output, Metadata>>);

impl<Output, Metadata> Drop for PanicSignal<'_, Output, Metadata> {
    fn drop(&mut self) {
        if thread::panicking() {
            let _sent = self.0.send(Event::Aborted);
        }
    }
}

pub(super) fn run<Work: Send, Output: Send, Metadata: Send>(
    workers: usize,
    is_current: &(impl Fn() -> bool + Sync),
    produce: impl FnOnce(&mut dyn FnMut(Work) -> bool) -> Option<Metadata> + Send,
    build: impl Fn(Work) -> Option<Output> + Sync,
    mut consume: impl FnMut(Output) -> bool,
) -> Option<Metadata> {
    if !is_current() {
        return None;
    }
    let stopped = AtomicBool::new(false);
    thread::scope(|scope| {
        let workers = workers.max(1);
        let (jobs, waiting) = mpsc::sync_channel(workers);
        let waiting = Arc::new(Mutex::new(waiting));
        let (sender, receiver) = mpsc::channel();
        let source_events = sender.clone();
        let source_stopped = &stopped;
        scope.spawn(move || {
            let _panic_signal = PanicSignal(&source_events);
            let mut count = 0;
            let metadata = produce(&mut |work| {
                if source_stopped.load(Ordering::Relaxed)
                    || !is_current()
                    || jobs.send((count, work)).is_err()
                {
                    return false;
                }
                count += 1;
                true
            });
            drop(jobs);
            let _sent = source_events.send(Event::Finished(count, metadata));
        });
        for _ in 0..workers {
            let (waiting, sender, build, stopped) =
                (Arc::clone(&waiting), sender.clone(), &build, &stopped);
            scope.spawn(move || {
                let _panic_signal = PanicSignal(&sender);
                while !stopped.load(Ordering::Relaxed) && is_current() {
                    let Ok((index, work)) = waiting.lock().unwrap().recv() else {
                        break;
                    };
                    if stopped.load(Ordering::Relaxed) || !is_current() {
                        break;
                    }
                    let output = build(work);
                    let (acknowledge, consumed) = mpsc::channel();
                    if sender
                        .send(Event::Chunk(index, output, acknowledge))
                        .is_err()
                        || consumed.recv().is_err()
                    {
                        break;
                    }
                }
            });
        }
        drop(waiting);
        drop(sender);
        let mut pending = BTreeMap::new();
        let mut expected = 0;
        let mut finished = None;
        let result = loop {
            if !is_current() {
                break None;
            }
            let Ok(event) = receiver.recv() else {
                break None;
            };
            match event {
                Event::Finished(count, Some(metadata)) => finished = Some((count, metadata)),
                Event::Finished(_, None) | Event::Chunk(_, None, _) | Event::Aborted => break None,
                Event::Chunk(index, Some(chunk), acknowledge) => {
                    pending.insert(index, (chunk, acknowledge));
                    let mut current = true;
                    while let Some((chunk, acknowledge)) = pending.remove(&expected) {
                        if !is_current() || !consume(chunk) {
                            current = false;
                            break;
                        }
                        expected += 1;
                        let _acknowledged = acknowledge.send(());
                    }
                    if !current {
                        break None;
                    }
                }
            }
            if finished
                .as_ref()
                .is_some_and(|(count, _)| expected == *count)
            {
                break finished.take().map(|(_, metadata)| metadata);
            }
        };
        stopped.store(true, Ordering::Relaxed);
        result.filter(|_| is_current())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn producer_and_worker_panics_release_scoped_threads_before_unwinding() {
        use std::panic::{catch_unwind, AssertUnwindSafe};
        let source = catch_unwind(AssertUnwindSafe(|| {
            run(
                4,
                &|| true,
                |emit| -> Option<()> {
                    emit(0);
                    panic!("query failure");
                },
                Some::<usize>,
                |_| true,
            )
        }));
        assert!(source.is_err());
        let worker = catch_unwind(AssertUnwindSafe(|| {
            run(
                4,
                &|| true,
                |emit| {
                    for index in 0..100 {
                        if !emit(index) {
                            return None;
                        }
                    }
                    Some(())
                },
                |index| {
                    assert_ne!(index, 0, "geometry failure");
                    Some(index)
                },
                |_| true,
            )
        }));
        assert!(worker.is_err());
    }

    #[test]
    fn consumes_the_first_result_before_the_source_has_finished_querying() {
        let (release, waiting) = mpsc::channel();
        let mut consumed = Vec::new();
        let metadata = run(
            4,
            &|| true,
            move |emit| {
                if !emit(0) {
                    return None;
                }
                waiting.recv_timeout(Duration::from_secs(2)).unwrap();
                for index in 1..40 {
                    if !emit(index) {
                        return None;
                    }
                }
                Some(17)
            },
            Some,
            |index| {
                consumed.push(index);
                if index == 0 {
                    release.send(()).unwrap();
                }
                true
            },
        );
        assert_eq!(metadata, Some(17));
        assert_eq!(consumed, (0..40).collect::<Vec<_>>());
    }

    #[test]
    fn cancellation_and_failed_source_release_full_queues_and_waiting_workers() {
        for workers in [1, 2, 8] {
            for failure in [0, 3, 19] {
                assert!(run(
                    workers,
                    &|| true,
                    |emit| {
                        for index in 0..100 {
                            if !emit(index) {
                                return None;
                            }
                        }
                        Some(())
                    },
                    |index| (index != failure).then_some(index),
                    |_| true
                )
                .is_none());
                assert!(run(
                    workers,
                    &|| true,
                    |emit| {
                        for index in 0..100 {
                            if !emit(index) {
                                return None;
                            }
                        }
                        Some(())
                    },
                    Some,
                    |index| index != failure
                )
                .is_none());
            }
            assert!(run(
                workers,
                &|| true,
                |emit| {
                    emit(1);
                    None::<()>
                },
                Some,
                |_| true
            )
            .is_none());
            assert_eq!(
                run(workers, &|| true, |_| Some(13), Some::<usize>, |_| true),
                Some(13)
            );
        }
    }

    #[test]
    fn produced_results_stay_bounded_and_are_consumed_in_order() {
        let outstanding = AtomicUsize::new(0);
        let maximum = AtomicUsize::new(0);
        let mut received = Vec::new();
        assert_eq!(
            run(
                4,
                &|| true,
                |emit| {
                    for index in 0..100 {
                        if !emit(index) {
                            return None;
                        }
                    }
                    Some(())
                },
                |index| {
                    if index % 4 == 0 {
                        thread::sleep(Duration::from_millis(1));
                    }
                    let count = outstanding.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(count, Ordering::SeqCst);
                    Some(index)
                },
                |index| {
                    received.push(index);
                    outstanding.fetch_sub(1, Ordering::SeqCst);
                    true
                }
            ),
            Some(())
        );
        assert_eq!(received, (0..100).collect::<Vec<_>>());
        assert!(maximum.load(Ordering::SeqCst) <= 4);
    }
}
