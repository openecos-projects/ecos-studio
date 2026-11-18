//! One CPU-only retained-pan worker. Repaints poll a result; changed cameras
//! replace pending work and cancel active preparation without waiting for it.
use super::*;
use std::sync::atomic::AtomicU64;
use std::sync::Condvar;

pub(in crate::app) struct Request {
    pub(in crate::app) key: SceneKey,
    pub(in crate::app) generation: u64,
    pub(in crate::app) scene: Arc<CpuScene>,
    pub(in crate::app) cpu_style: bool,
    pub(in crate::app) repaint: egui::Context,
}

pub(in crate::app) struct Prepared {
    pub(in crate::app) key: SceneKey,
    pub(in crate::app) source: SceneKey,
    pub(in crate::app) generation: u64,
    pub(in crate::app) bitmap: Vec<u8>,
    pub(in crate::app) repairs: Vec<egui::ClippedPrimitive>,
    pub(in crate::app) textures: Arc<PatternTextureSet>,
    pub(in crate::app) pixels: usize,
    pub(in crate::app) duration: Duration,
}

struct Attempt {
    key: SceneKey,
    generation: u64,
    scene: Arc<CpuScene>,
    cpu_style: bool,
}

impl Attempt {
    fn matches(&self, request: &Request) -> bool {
        self.key == request.key
            && self.generation == request.generation
            && self.cpu_style == request.cpu_style
            && self.scene.generation == request.scene.generation
            && self.scene.key() == request.scene.key()
            && matches!((&self.scene.retained, &request.scene.retained),
                (Some(a), Some(b)) if Arc::ptr_eq(a, b))
            && matches!((&self.scene.bitmap, &request.scene.bitmap),
                (Some(a), Some(b)) if Arc::ptr_eq(a, b))
    }
}

#[derive(Default)]
struct State {
    pending: Option<(u64, Request)>,
    ready: Option<(u64, Prepared)>,
    finished: Option<u64>,
}

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    revision: AtomicU64,
    stopped: AtomicBool,
}

pub(in crate::app) struct RetainedWorker {
    shared: Arc<Shared>,
    attempt: Option<Attempt>,
}

impl Default for RetainedWorker {
    fn default() -> Self {
        Self::spawn(prepare)
    }
}

impl RetainedWorker {
    fn spawn(
        process: impl Fn(Request, &dyn Fn() -> bool) -> Option<Prepared> + Send + 'static,
    ) -> Self {
        let shared = Arc::new(Shared::default());
        let inbox = Arc::clone(&shared);
        thread::spawn(move || loop {
            let (revision, request) = {
                let mut state = inbox.state.lock().unwrap();
                while state.pending.is_none() && !inbox.stopped.load(Ordering::Acquire) {
                    state = inbox.wake.wait(state).unwrap();
                }
                if inbox.stopped.load(Ordering::Acquire) {
                    return;
                }
                state.pending.take().unwrap()
            };
            let is_current = || {
                !inbox.stopped.load(Ordering::Acquire)
                    && inbox.revision.load(Ordering::Acquire) == revision
            };
            let repaint = request.repaint.clone();
            let prepared = process(request, &is_current);
            let mut state = inbox.state.lock().unwrap();
            if is_current() {
                state.finished = Some(revision);
                state.ready = prepared.map(|prepared| (revision, prepared));
                let ready = state.ready.is_some();
                drop(state);
                if ready {
                    repaint.request_repaint();
                }
            }
        });
        Self {
            shared,
            attempt: None,
        }
    }

    /// Identical pending, ready, and failed attempts are not restarted by paint.
    pub(in crate::app) fn request(&mut self, request: Request) -> Option<Prepared> {
        if !self
            .attempt
            .as_ref()
            .is_some_and(|attempt| attempt.matches(&request))
        {
            let revision = self.shared.revision.fetch_add(1, Ordering::AcqRel) + 1;
            self.attempt = Some(Attempt {
                key: request.key.clone(),
                generation: request.generation,
                scene: Arc::clone(&request.scene),
                cpu_style: request.cpu_style,
            });
            let mut state = self.shared.state.lock().unwrap();
            state.ready = None;
            state.finished = None;
            state.pending = Some((revision, request));
            drop(state);
            self.shared.wake.notify_one();
        }
        let revision = self.shared.revision.load(Ordering::Acquire);
        self.shared
            .state
            .lock()
            .unwrap()
            .ready
            .take()
            .filter(|(version, _)| *version == revision)
            .map(|(_, prepared)| prepared)
    }

    pub(in crate::app) fn cancel(&mut self) {
        if self.attempt.take().is_some() {
            self.shared.revision.fetch_add(1, Ordering::AcqRel);
            let mut state = self.shared.state.lock().unwrap();
            state.pending = None;
            state.ready = None;
            state.finished = None;
        }
    }

    #[cfg(test)]
    pub(in crate::app) fn finished(&self) -> bool {
        self.shared.state.lock().unwrap().finished
            == Some(self.shared.revision.load(Ordering::Acquire))
    }

    #[cfg(test)]
    pub(in crate::app) fn failed(&self) -> bool {
        let state = self.shared.state.lock().unwrap();
        state.finished == Some(self.shared.revision.load(Ordering::Acquire))
            && state.ready.is_none()
    }
}

impl Drop for RetainedWorker {
    fn drop(&mut self) {
        // Cancellation is cooperative; joining here would block the UI again.
        let mut state = self.shared.state.lock().unwrap();
        self.shared.stopped.store(true, Ordering::Release);
        self.shared.revision.fetch_add(1, Ordering::AcqRel);
        state.pending = None;
        state.ready = None;
        drop(state);
        self.shared.wake.notify_one();
    }
}

fn prepare(request: Request, is_current: &dyn Fn() -> bool) -> Option<Prepared> {
    let started = Instant::now();
    let current = || is_current();
    let model = request.scene.retained.as_ref()?;
    let source = request.scene.bitmap.as_ref()?;
    let regions = model.prepare_current(&request.key, request.cpu_style, &current)?;
    let bitmap = model.compose_current(&request.key, &regions, source, &current)?;
    let repairs = regions.repair_meshes_current(&request.key, &current)?;
    let pixels = regions.pixel_count();
    current().then_some(Prepared {
        key: request.key,
        source: request.scene.key().clone(),
        generation: request.generation,
        bitmap,
        repairs,
        textures: Arc::clone(&request.scene.pattern_textures),
        pixels,
        duration: started.elapsed(),
    })
}

#[cfg(all(test, target_os = "linux"))]
#[path = "cpu_retained_worker_tests.rs"]
mod tests;
