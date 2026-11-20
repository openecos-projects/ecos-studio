use super::*;

/// Shares unpublished label candidates with cancellable jobs, then retires the
/// raw collector on the completing label worker before full-ready publication.
#[derive(Clone, Default)]
pub(in crate::app::cpu_scene) struct Candidates(
    Arc<Mutex<Arc<ShapeLabelCollector>>>,
    Arc<OnceLock<Option<(Arc<ShapeLabelCollector>, usize)>>>,
    Arc<AtomicBool>,
);

impl Candidates {
    pub(in crate::app::cpu_scene) fn snapshot(&self) -> Arc<ShapeLabelCollector> {
        Arc::clone(&self.0.lock().unwrap())
    }

    pub(in crate::app::cpu_scene) fn retire(&self, canvas: egui::Rect) -> Arc<ShapeLabelCollector> {
        let raw = self.snapshot();
        self.1.get_or_init(|| {
            let compact = raw.compact(canvas);
            let bytes = compact.retained_bytes();
            (bytes <= 64 * 1024 * 1024).then(|| (Arc::new(compact), bytes))
        });
        // Install the reusable source before clearing raw candidates. Another
        // completing label job must never win initialization with an empty
        // collector while this job is compacting the actual source.
        drop(std::mem::take(&mut *self.0.lock().unwrap()));
        raw
    }

    pub(in crate::app::cpu_scene) fn reusable(&self) -> Option<Arc<ShapeLabelCollector>> {
        self.1
            .get()
            .and_then(|cached| cached.as_ref().map(|(labels, _)| Arc::clone(labels)))
            .or_else(|| {
                let raw = self.snapshot();
                (!raw.is_empty()).then_some(raw)
            })
    }

    pub(in crate::app::cpu_scene) fn byte_len(&self) -> usize {
        self.1
            .get()
            .and_then(Option::as_ref)
            .map_or(0, |(_, bytes)| *bytes)
    }

    pub(in crate::app::cpu_scene) fn needs_rebuild(&self) -> bool {
        self.2.load(Ordering::Acquire) || self.1.get().is_some_and(Option::is_none)
    }

    pub(in crate::app::cpu_scene) fn require_rebuild(&self) {
        self.2.store(true, Ordering::Release);
    }

    pub(in crate::app::cpu_scene) fn install_rebuilt(
        &self,
        candidates: &ShapeLabelCollector,
        canvas: egui::Rect,
    ) {
        self.1.get_or_init(|| {
            let compact = candidates.compact(canvas);
            let bytes = compact.retained_bytes();
            (bytes <= 64 * 1024 * 1024).then(|| (Arc::new(compact), bytes))
        });
        self.2.store(false, Ordering::Release);
    }

    pub(in crate::app::cpu_scene) fn insert(&mut self, candidate: ShapeLabelCandidate) {
        Arc::make_mut(self.unpublished()).insert(candidate);
    }

    pub(in crate::app::cpu_scene) fn append(&mut self, other: Self) {
        let candidates = match Arc::try_unwrap(other.0) {
            Ok(candidates) => candidates.into_inner().unwrap(),
            Err(candidates) => Arc::clone(&candidates.lock().unwrap()),
        };
        Arc::make_mut(self.unpublished()).append(Arc::unwrap_or_clone(candidates));
    }

    fn unpublished(&mut self) -> &mut Arc<ShapeLabelCollector> {
        Arc::get_mut(&mut self.0)
            .expect("published label candidates are immutable")
            .get_mut()
            .unwrap()
    }
}
