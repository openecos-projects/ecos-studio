use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Publication {
    Complete,
    Progressive,
}

pub(in crate::app) struct ProgressFrame {
    pub(in crate::app) key: SceneKey,
    pub(in crate::app) generation: u64,
    pub(in crate::app) sequence: usize,
    pub(in crate::app) pixels: Arc<[u8]>,
}

impl ProgressFrame {
    pub(super) fn record_evidence(&self, directory: &Path) -> std::io::Result<()> {
        fs::create_dir_all(directory)?;
        let stem = format!("{}-{}", self.generation, self.sequence);
        fs::write(directory.join(format!("{stem}.rgba")), &self.pixels)?;
        fs::write(
            directory.join(format!("{stem}.json")),
            serde_json::to_vec(&serde_json::json!({
                "zoom": self.key.zoom, "width": self.key.screen_size[0], "height": self.key.screen_size[1],
                "generation": self.generation, "sequence": self.sequence,
            }))?,
        )
    }
}

#[derive(Default)]
pub(super) struct ProgressMailbox {
    frame: Mutex<Option<Arc<ProgressFrame>>>,
}

impl ProgressMailbox {
    pub(super) fn publish(&self, frame: ProgressFrame) {
        *self.frame.lock().unwrap() = Some(Arc::new(frame));
    }

    pub(super) fn current(&self, key: &SceneKey, generation: u64) -> Option<Arc<ProgressFrame>> {
        self.frame
            .lock()
            .unwrap()
            .as_ref()
            .filter(|frame| frame.key == *key && frame.generation == generation)
            .map(Arc::clone)
    }

    pub(super) fn clear(&self) {
        *self.frame.lock().unwrap() = None;
    }
}
