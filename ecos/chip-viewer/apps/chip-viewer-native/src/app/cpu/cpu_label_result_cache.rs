use super::{labels, CpuScene, LabelCompletion, SceneKey};
use std::sync::Arc;

#[derive(Default)]
pub(super) struct LabelResultCache {
    entry: Option<Entry>,
}

struct Entry {
    key: SceneKey,
    completed: Arc<LabelCompletion>,
}

impl LabelResultCache {
    pub(super) fn remember(&mut self, scene: &CpuScene) {
        if !scene.labels_ready() {
            return;
        }
        let key = label_key(&scene.key);
        let replace = self.entry.as_ref().is_none_or(|current| {
            !current.key.compatible(&key) || current.key.zoom > 1.25 || key.zoom <= 1.25
        });
        if replace {
            self.entry = Some(Entry {
                key,
                completed: Arc::clone(&scene.completed_labels),
            });
        }
    }

    pub(super) fn reusable(
        &self,
        key: &SceneKey,
    ) -> Option<(labels::Candidates, Arc<LabelCompletion>)> {
        let key = label_key(key);
        let entry = self.entry.as_ref().filter(|entry| entry.key == key)?;
        Some((labels::Candidates::default(), Arc::clone(&entry.completed)))
    }
}

fn label_key(key: &SceneKey) -> SceneKey {
    let mut key = key.clone();
    key.cache_overlays = false;
    key
}

#[cfg(test)]
#[path = "cpu_label_result_cache_tests.rs"]
mod tests;
