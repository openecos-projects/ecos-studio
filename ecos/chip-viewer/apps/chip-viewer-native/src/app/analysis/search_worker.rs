use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Condvar;

const SEARCH_DEBOUNCE: Duration = Duration::from_millis(180);
pub(super) const SEARCH_RESULT_LIMIT: usize = 1_000;

pub(super) struct SearchResult {
    pub(super) shape_ids: BTreeSet<ShapeId>,
    pub(super) truncated: bool,
    pub(super) error: Option<String>,
}

struct ScheduledSearch {
    query: String,
    mode: SearchMode,
    ready_at: Instant,
}

struct SearchRequest {
    generation: u64,
    query: String,
    mode: SearchMode,
    db: Arc<ChipViewDb>,
}

#[derive(Default)]
struct Mailbox {
    request: Option<SearchRequest>,
    result: Option<SearchResult>,
    stopped: bool,
}

#[derive(Default)]
struct Shared {
    generation: AtomicU64,
    mailbox: Mutex<Mailbox>,
    wake: Condvar,
}

pub(super) struct SearchWorker {
    shared: Arc<Shared>,
    thread: std::io::Result<thread::JoinHandle<()>>,
    scheduled: Option<ScheduledSearch>,
    awaiting_result: bool,
}

impl SearchWorker {
    pub(super) fn new() -> Self {
        Self::spawn(run_search)
    }

    fn spawn(
        search: impl Fn(&SearchRequest, &(dyn Fn() -> bool + Sync)) -> Option<SearchResult>
            + Send
            + 'static,
    ) -> Self {
        let shared = Arc::new(Shared::default());
        let worker = Arc::clone(&shared);
        let thread = thread::Builder::new()
            .name("chip-viewer-search".into())
            .spawn(move || loop {
                let request = {
                    let mailbox = worker.mailbox.lock().unwrap();
                    let mut mailbox = worker
                        .wake
                        .wait_while(mailbox, |mailbox| {
                            mailbox.request.is_none() && !mailbox.stopped
                        })
                        .unwrap();
                    if mailbox.stopped {
                        return;
                    }
                    mailbox.request.take().unwrap()
                };
                let generation = request.generation;
                let is_current = || worker.generation.load(Ordering::Acquire) == generation;
                if !is_current() {
                    continue;
                }
                let result = search(&request, &is_current);
                drop(request);
                let mut mailbox = worker.mailbox.lock().unwrap();
                if is_current() {
                    mailbox.result = result;
                }
            });
        Self {
            shared,
            thread,
            scheduled: None,
            awaiting_result: false,
        }
    }

    pub(super) fn schedule(&mut self, query: String, mode: SearchMode) {
        self.cancel();
        if !query.trim().is_empty() {
            self.scheduled = Some(ScheduledSearch {
                query,
                mode,
                ready_at: Instant::now() + SEARCH_DEBOUNCE,
            });
        }
    }

    pub(super) fn cancel(&mut self) {
        self.scheduled = None;
        self.awaiting_result = false;
        let mut mailbox = self.shared.mailbox.lock().unwrap();
        self.shared.generation.fetch_add(1, Ordering::AcqRel);
        let request = mailbox.request.take();
        let result = mailbox.result.take();
        drop(mailbox);
        drop((request, result));
    }

    pub(super) fn start_now(&mut self, db: &Arc<ChipViewDb>) {
        let Some(ScheduledSearch { query, mode, .. }) = self.scheduled.take() else {
            return;
        };
        let request = SearchRequest {
            generation: self.shared.generation.load(Ordering::Acquire),
            query,
            mode,
            db: Arc::clone(db),
        };
        self.shared.mailbox.lock().unwrap().request = Some(request);
        self.awaiting_result = true;
        self.shared.wake.notify_one();
    }

    pub(super) fn poll_start(&mut self, db: &Arc<ChipViewDb>) {
        if self
            .scheduled
            .as_ref()
            .is_some_and(|search| Instant::now() >= search.ready_at)
        {
            self.start_now(db);
        }
    }

    pub(super) fn is_pending(&self) -> bool {
        self.scheduled.is_some() || self.awaiting_result
    }

    pub(super) fn try_take(&mut self) -> Result<Option<SearchResult>, String> {
        if !self.awaiting_result {
            return Ok(None);
        }
        let error = match &self.thread {
            Err(error) => Some(format!("Failed to start search worker: {error}")),
            Ok(thread) if thread.is_finished() => Some("Search worker stopped unexpectedly".into()),
            Ok(_) => None,
        };
        if let Some(error) = error {
            self.cancel();
            return Err(error);
        }
        let result = self.shared.mailbox.lock().unwrap().result.take();
        if result.is_some() {
            self.awaiting_result = false;
        }
        Ok(result)
    }
}

impl Drop for SearchWorker {
    fn drop(&mut self) {
        self.cancel();
        self.shared.mailbox.lock().unwrap().stopped = true;
        self.shared.wake.notify_one();
    }
}

fn run_search(
    request: &SearchRequest,
    is_current: &(dyn Fn() -> bool + Sync),
) -> Option<SearchResult> {
    match Regex::new(&request.query) {
        Ok(pattern) => request
            .mode
            .query_shape_ids_bounded(&request.db, &pattern, &is_current)
            .map(|bounded| SearchResult {
                shape_ids: bounded.shape_ids.into_iter().collect(),
                truncated: bounded.truncated,
                error: None,
            }),
        Err(error) => Some(SearchResult {
            shape_ids: BTreeSet::new(),
            truncated: false,
            error: Some(format!("Invalid search pattern: {error}")),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take_result(worker: &mut SearchWorker) -> SearchResult {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(result) = worker.try_take().unwrap() {
                return result;
            }
            assert!(Instant::now() < deadline, "search result timed out");
            thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn debounce_only_starts_latest_query_after_deadline() {
        let dir = crate::app::tests::temp_snapshot_dir("search-debounce");
        crate::app::tests::write_empty_snapshot(&dir, false);
        let db = Arc::new(ChipViewDb::open(dir.join("geometry.manifest")).unwrap());
        let (sender, started) = mpsc::channel();
        let mut worker = SearchWorker::spawn(move |request, _| {
            sender.send(request.query.clone()).unwrap();
            Some(SearchResult {
                shape_ids: BTreeSet::new(),
                truncated: false,
                error: None,
            })
        });

        worker.schedule("old".into(), SearchMode::All);
        worker.schedule("latest".into(), SearchMode::All);
        let scheduled = worker.scheduled.as_mut().unwrap();
        scheduled.ready_at = Instant::now() + Duration::from_secs(60);
        worker.poll_start(&db);
        assert!(worker.scheduled.is_some());
        assert!(worker.shared.mailbox.lock().unwrap().request.is_none());

        worker.scheduled.as_mut().unwrap().ready_at = Instant::now();
        worker.poll_start(&db);
        assert_eq!(
            started.recv_timeout(Duration::from_secs(5)).unwrap(),
            "latest"
        );
        take_result(&mut worker);

        drop(worker);
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn latest_query_replaces_waiting_work_and_discards_active_result() {
        let dir = crate::app::tests::temp_snapshot_dir("search-replace");
        crate::app::tests::write_empty_snapshot(&dir, false);
        let db = Arc::new(ChipViewDb::open(dir.join("geometry.manifest")).unwrap());
        let (started_sender, started) = mpsc::channel();
        let (released, release) = mpsc::channel();
        let mut worker = SearchWorker::spawn(move |request, is_current| {
            started_sender.send(request.query.clone()).unwrap();
            let id = match request.query.as_str() {
                "active" => {
                    release.recv_timeout(Duration::from_secs(5)).unwrap();
                    assert!(!is_current());
                    1
                }
                "latest" => 3,
                _ => panic!("replaced search reached worker"),
            };
            Some(SearchResult {
                shape_ids: BTreeSet::from([id]),
                truncated: false,
                error: None,
            })
        });

        worker.schedule("active".into(), SearchMode::All);
        worker.start_now(&db);
        assert_eq!(
            started.recv_timeout(Duration::from_secs(5)).unwrap(),
            "active"
        );
        for query in ["replaced", "latest"] {
            worker.schedule(query.into(), SearchMode::All);
            worker.start_now(&db);
        }
        assert!(worker.is_pending());
        assert!(worker.try_take().unwrap().is_none());
        released.send(()).unwrap();
        assert_eq!(
            started.recv_timeout(Duration::from_secs(5)).unwrap(),
            "latest"
        );
        let result = take_result(&mut worker);
        assert_eq!(result.shape_ids, BTreeSet::from([3]));
        assert!(!worker.is_pending());

        drop(worker);
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }
}
