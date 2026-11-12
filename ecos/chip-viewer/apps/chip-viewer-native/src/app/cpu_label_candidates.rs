use super::*;

/// Shares unpublished label candidates with cancellable jobs, then retires the
/// raw collector on the completing label worker before full-ready publication.
#[derive(Clone, Default)]
pub(in crate::app::cpu_scene) struct Candidates(Arc<Mutex<Arc<ShapeLabelCollector>>>);

impl Candidates {
    pub(in crate::app::cpu_scene) fn snapshot(&self) -> Arc<ShapeLabelCollector> {
        Arc::clone(&self.0.lock().unwrap())
    }

    pub(in crate::app::cpu_scene) fn retire(&self) -> Arc<ShapeLabelCollector> {
        std::mem::take(&mut *self.0.lock().unwrap())
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
