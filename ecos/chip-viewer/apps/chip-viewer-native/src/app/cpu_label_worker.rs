use super::*;
use std::sync::Weak;

pub(in crate::app::cpu_scene) struct LabelWorker {
    inbox: Arc<LabelInbox>,
    geometry: Arc<WorkerInbox>,
    task: Option<thread::JoinHandle<()>>,
}

#[derive(Default)]
struct LabelState {
    pending: Option<LabelJob>,
    last: Option<(u64, Weak<LabelCompletion>)>,
}

#[derive(Default)]
struct LabelInbox {
    state: Mutex<LabelState>,
    wake: Condvar,
    version: AtomicU64,
    stopped: AtomicBool,
}

struct LabelJob {
    generation: u64,
    version: u64,
    input: LabelInput,
    source: Candidates,
    candidates: Arc<ShapeLabelCollector>,
    rebuild: Option<SceneRequest>,
    completed: Arc<LabelCompletion>,
    repaint: egui::Context,
}

impl LabelWorker {
    pub(in crate::app::cpu_scene) fn new(geometry: Arc<WorkerInbox>) -> Self {
        let inbox = Arc::new(LabelInbox::default());
        let (worker, current_geometry) = (Arc::clone(&inbox), Arc::clone(&geometry));
        let task = thread::spawn(move || {
            let mut resolver = LabelResolver::default();
            loop {
                let job = {
                    let mut state = worker.state.lock().unwrap();
                    while state.pending.is_none() && !worker.stopped.load(Ordering::Relaxed) {
                        state = worker.wake.wait(state).unwrap();
                    }
                    if worker.stopped.load(Ordering::Relaxed) {
                        break;
                    }
                    state.pending.take().unwrap()
                };
                let is_current = || {
                    !worker.stopped.load(Ordering::Relaxed)
                        && !current_geometry.stopped.load(Ordering::Relaxed)
                        && current_geometry.generation.load(Ordering::Relaxed) == job.generation
                        && worker.version.load(Ordering::Relaxed) == job.version
                };
                let started = Instant::now();
                let candidates = if let Some(request) = &job.rebuild {
                    let Some(candidates) = builder::collect_labels(request, &is_current) else {
                        continue;
                    };
                    candidates
                } else {
                    Arc::clone(&job.candidates)
                };
                if let Some(labels) = resolver.resolve_input(&job.input, &candidates, is_current) {
                    if is_current() {
                        if job.rebuild.is_some() {
                            job.source.install_rebuilt(&candidates, job.input.canvas);
                        }
                        let retired = job.source.retire(job.input.canvas);
                        drop(job.candidates);
                        drop(candidates);
                        drop(retired);
                        let _ = job.completed.set((Arc::new(labels), started.elapsed()));
                        job.repaint.request_repaint();
                    }
                }
            }
        });
        Self {
            inbox,
            geometry,
            task: Some(task),
        }
    }

    pub(in crate::app::cpu_scene) fn submit(
        &self,
        request: &SceneRequest,
        generation: u64,
        scene: &CpuScene,
    ) {
        if scene.labels_ready()
            || self.geometry.generation.load(Ordering::Relaxed) != generation
            || self.geometry.stopped.load(Ordering::Relaxed)
        {
            return;
        }
        let mut state = self.inbox.state.lock().unwrap();
        let result = Arc::downgrade(&scene.completed_labels);
        if state.last.as_ref().is_some_and(|(previous, completed)| {
            *previous == generation && Weak::ptr_eq(completed, &result)
        }) {
            return;
        }
        let version = self.inbox.version.fetch_add(1, Ordering::Relaxed) + 1;
        state.last = Some((generation, result));
        state.pending = Some(LabelJob {
            generation,
            version,
            input: LabelInput::from_request(request),
            source: scene.labels.clone(),
            candidates: scene
                .labels
                .reusable()
                .unwrap_or_else(|| scene.labels.snapshot()),
            rebuild: scene.labels.needs_rebuild().then(|| request.clone()),
            completed: Arc::clone(&scene.completed_labels),
            repaint: request.repaint.clone(),
        });
        self.inbox.wake.notify_one();
    }
}

impl Drop for LabelWorker {
    fn drop(&mut self) {
        {
            let _state = self.inbox.state.lock().unwrap();
            self.inbox.stopped.store(true, Ordering::Relaxed);
            self.inbox.wake.notify_one();
        }
        if let Some(task) = self.task.take() {
            if task.join().is_err() {
                eprintln!("Background label worker panicked");
            }
        }
    }
}
