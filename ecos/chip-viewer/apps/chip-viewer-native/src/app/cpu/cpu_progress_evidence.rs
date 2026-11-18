use super::*;
use std::collections::VecDeque;

#[derive(Default)]
struct Pending {
    bytes: usize,
    frames: VecDeque<Arc<ProgressFrame>>,
}

pub(in crate::app::cpu_scene) struct InitialEvidence {
    directory: Option<PathBuf>,
    limit: usize,
    pending: Mutex<Pending>,
    wake: std::sync::Condvar,
}

pub(in crate::app::cpu_scene) struct InitialEvidenceWrite {
    job: Option<thread::JoinHandle<std::io::Result<Duration>>>,
    stopping: Arc<AtomicBool>,
    inbox: Arc<WorkerInbox>,
}

impl InitialEvidenceWrite {
    pub(in crate::app::cpu_scene) fn start(inbox: Arc<WorkerInbox>) -> Self {
        let enabled = inbox.initial_evidence.directory.is_some();
        let stopping = Arc::new(AtomicBool::new(false));
        let writer_inbox = Arc::clone(&inbox);
        let writer_stopping = Arc::clone(&stopping);
        Self {
            job: enabled.then(|| {
                thread::spawn(move || {
                    writer_inbox
                        .initial_evidence
                        .write_until_stopped(&writer_stopping)
                })
            }),
            stopping,
            inbox,
        }
    }

    pub(in crate::app::cpu_scene) fn finish(&mut self) -> std::io::Result<Duration> {
        self.job.take().map_or(Ok(Duration::ZERO), |job| {
            {
                let _pending = self.inbox.initial_evidence.pending.lock().unwrap();
                self.stopping.store(true, Ordering::Relaxed);
                self.inbox.initial_evidence.wake.notify_one();
            }
            job.join()
                .map_err(|_| std::io::Error::other("initial evidence writer panicked"))?
        })
    }
}

impl Drop for InitialEvidenceWrite {
    fn drop(&mut self) {
        if let Err(error) = self.finish() {
            eprintln!("Initial progress evidence unavailable: {error}");
        }
    }
}

impl InitialEvidence {
    pub(in crate::app::cpu_scene) fn new(directory: Option<PathBuf>) -> Self {
        Self {
            directory,
            limit: 64 * 1024 * 1024,
            pending: Mutex::default(),
            wake: std::sync::Condvar::new(),
        }
    }

    pub(in crate::app::cpu_scene) fn enqueue(
        &self,
        frame: Arc<ProgressFrame>,
    ) -> std::io::Result<()> {
        let Some(directory) = &self.directory else {
            return Ok(());
        };
        let mut pending = self.pending.lock().unwrap();
        let bytes = frame.pixels.len();
        if bytes > self.limit.saturating_sub(pending.bytes) {
            drop(pending);
            return frame.record_evidence(directory);
        }
        pending.bytes += bytes;
        pending.frames.push_back(frame);
        self.wake.notify_one();
        Ok(())
    }

    fn write_until_stopped(&self, stopping: &AtomicBool) -> std::io::Result<Duration> {
        let mut duration = Duration::ZERO;
        let mut result = Ok(());
        loop {
            let frame = {
                let mut pending = self.pending.lock().unwrap();
                while pending.frames.is_empty() && !stopping.load(Ordering::Relaxed) {
                    pending = self.wake.wait(pending).unwrap();
                }
                if stopping.load(Ordering::Relaxed) {
                    break;
                }
                let frame = pending.frames.pop_front().unwrap();
                pending.bytes -= frame.pixels.len();
                frame
            };
            let started = Instant::now();
            let written = frame.record_evidence(self.directory.as_ref().unwrap());
            duration += started.elapsed();
            if result.is_ok() {
                result = written;
            }
        }
        let started = Instant::now();
        let written = self.flush();
        duration += started.elapsed();
        result.and(written).map(|()| duration)
    }

    pub(in crate::app::cpu_scene) fn flush(&self) -> std::io::Result<()> {
        let Some(directory) = &self.directory else {
            return Ok(());
        };
        let mut result = Ok(());
        let count = self.pending.lock().unwrap().frames.len();
        for _ in 0..count {
            let frame = {
                let mut pending = self.pending.lock().unwrap();
                let Some(frame) = pending.frames.pop_front() else {
                    break;
                };
                pending.bytes -= frame.pixels.len();
                frame
            };
            let written = frame.record_evidence(directory);
            if result.is_ok() {
                result = written;
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::cpu_scene::tests::Fixture;

    #[test]
    fn evidence_guard_joins_later_publications_on_cancellation_and_handles_an_idle_writer() {
        let fixture = Fixture::new();
        let directory = fixture.path.join("guard-evidence");
        let inbox = Arc::new(WorkerInbox {
            request: Mutex::new(None),
            wake: Condvar::new(),
            generation: AtomicU64::new(4),
            stopped: AtomicBool::new(false),
            initial_evidence: InitialEvidence::new(Some(directory.clone())),
        });
        {
            let _guard = InitialEvidenceWrite::start(Arc::clone(&inbox));
            for sequence in 1..=8 {
                inbox
                    .initial_evidence
                    .enqueue(Arc::new(ProgressFrame::new(
                        fixture.request(1.0, 1.0).key,
                        4,
                        sequence,
                        vec![sequence as u8; 1024],
                    )))
                    .unwrap();
            }
        }
        for sequence in 1..=8 {
            assert_eq!(
                fs::read(directory.join(format!("4-{sequence}.rgba"))).unwrap(),
                vec![sequence as u8; 1024],
            );
            assert!(directory.join(format!("4-{sequence}.json")).exists());
        }
        assert!(inbox
            .initial_evidence
            .pending
            .lock()
            .unwrap()
            .frames
            .is_empty());
        let mut idle = InitialEvidenceWrite::start(Arc::clone(&inbox));
        idle.finish().unwrap();
        assert_eq!(idle.finish().unwrap(), Duration::ZERO);
        assert_eq!(Arc::strong_count(&inbox), 2);
    }

    #[test]
    fn concurrent_progress_evidence_keeps_distinct_pixels_at_the_same_camera_and_sequence() {
        let fixture = Fixture::new();
        let directory = fixture.path.join("concurrent-evidence");
        let first = ProgressFrame::new(fixture.request(1.0, 1.0).key, 4, 64, vec![1, 2, 3, 4]);
        let second = ProgressFrame::new(fixture.request(1.0, 1.0).key, 4, 64, vec![5, 6, 7, 8]);
        thread::scope(|scope| {
            let first_write = scope.spawn(|| first.record_evidence(&directory));
            let second_write = scope.spawn(|| second.record_evidence(&directory));
            first_write.join().unwrap().unwrap();
            second_write.join().unwrap().unwrap();
        });
        first.record_evidence(&directory).unwrap();
        let mut pixels = Vec::new();
        let mut paths = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        paths.sort();
        assert_eq!(paths.len(), 6);
        for path in paths
            .iter()
            .filter(|path| path.extension().unwrap() == "json")
        {
            let metadata: serde_json::Value =
                serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            assert_eq!(
                metadata,
                serde_json::json!({"zoom": 1.0, "width": 640, "height": 480,
                    "generation": 4, "sequence": 64,
                    "pan": [0.0, 0.0],
                    "canvas": [10.0, 20.0, 510.0, 420.0],
                    "viewport": [0, 0, 1000, 1000]}),
            );
            pixels.push(fs::read(path.with_extension("rgba")).unwrap());
        }
        pixels.sort();
        assert_eq!(
            pixels,
            [vec![1, 2, 3, 4], vec![1, 2, 3, 4], vec![5, 6, 7, 8]]
        );
    }

    #[test]
    fn initial_evidence_keeps_every_cancelled_generation_and_overflow_without_pixel_copies() {
        let fixture = Fixture::new();
        let directory = fixture.path.join("initial-evidence");
        let mut queue = InitialEvidence::new(Some(directory.clone()));
        queue.limit = 4;
        let first = Arc::new(ProgressFrame::new(
            fixture.request(1.0, 1.0).key,
            4,
            64,
            vec![1, 2, 3, 4],
        ));
        let weak = Arc::downgrade(&first);
        queue.enqueue(first).unwrap();
        assert_eq!(queue.pending.lock().unwrap().bytes, 4);
        assert_eq!(Arc::strong_count(&weak.upgrade().unwrap()), 2);
        assert!(!directory.exists());
        queue
            .enqueue(Arc::new(ProgressFrame::new(
                fixture.request(2.0, 1.0).key,
                5,
                64,
                vec![5, 6, 7, 8],
            )))
            .unwrap();
        assert_eq!(queue.pending.lock().unwrap().bytes, 4);
        assert_eq!(fs::read(directory.join("5-64.rgba")).unwrap(), [5, 6, 7, 8]);
        queue.flush().unwrap();
        assert_eq!(fs::read(directory.join("4-64.rgba")).unwrap(), [1, 2, 3, 4]);
        assert!(directory.join("4-64.json").exists());
        assert!(directory.join("5-64.json").exists());
        assert_eq!(queue.pending.lock().unwrap().bytes, 0);
        assert!(weak.upgrade().is_none());
    }

    #[test]
    fn evidence_write_errors_are_reported_and_disabled_recording_does_not_retain_frames() {
        let fixture = Fixture::new();
        let path = fixture.path.join("not-a-directory");
        fs::write(&path, b"existing file").unwrap();
        let queue = InitialEvidence::new(Some(path));
        queue
            .enqueue(Arc::new(ProgressFrame::new(
                fixture.request(1.0, 1.0).key,
                4,
                1,
                vec![1; 4],
            )))
            .unwrap();
        assert!(queue.flush().is_err());
        assert!(queue.pending.lock().unwrap().frames.is_empty());
        let disabled = InitialEvidence::new(None);
        disabled
            .enqueue(Arc::new(ProgressFrame::new(
                fixture.request(1.0, 1.0).key,
                4,
                1,
                vec![1; 4],
            )))
            .unwrap();
        assert!(disabled.pending.lock().unwrap().frames.is_empty());
    }
}
