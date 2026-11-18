use super::*;

#[cfg(target_os = "linux")]
#[path = "cpu_progress_evidence.rs"]
mod evidence;
#[cfg(target_os = "linux")]
pub(super) use evidence::{InitialEvidence, InitialEvidenceWrite};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Publication {
    #[cfg(test)]
    Complete,
    Progressive,
}

pub(in crate::app) struct ProgressFrame {
    pub(in crate::app) key: SceneKey,
    pub(in crate::app) generation: u64,
    pub(in crate::app) sequence: usize,
    pub(in crate::app) pixels: Arc<Vec<u8>>,
}

impl ProgressFrame {
    pub(super) fn new(key: SceneKey, generation: u64, sequence: usize, pixels: Vec<u8>) -> Self {
        Self {
            key,
            generation,
            sequence,
            pixels: Arc::new(pixels),
        }
    }

    pub(in crate::app) fn record_evidence(&self, directory: &Path) -> std::io::Result<()> {
        fs::create_dir_all(directory)?;
        for revision in 0_u64.. {
            let stem = if revision == 0 {
                format!("{}-{}", self.generation, self.sequence)
            } else {
                format!("{}-{}-{revision}", self.generation, self.sequence)
            };
            let mut output = match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(directory.join(format!("{stem}.rgba")))
            {
                Ok(output) => output,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            };
            output.write_all(&self.pixels)?;
            let metadata = directory.join(format!("{stem}.json.pending"));
            fs::write(
                &metadata,
                serde_json::to_vec(&serde_json::json!({
                    "zoom": self.key.zoom, "width": self.key.screen_size[0], "height": self.key.screen_size[1],
                    "generation": self.generation, "sequence": self.sequence,
                    "pan": [self.key.pan.x, self.key.pan.y],
                    "canvas": [self.key.canvas.left(), self.key.canvas.top(), self.key.canvas.right(), self.key.canvas.bottom()],
                    "viewport": [self.key.viewport.lx, self.key.viewport.ly, self.key.viewport.hx, self.key.viewport.hy],
                }))?,
            )?;
            return fs::rename(metadata, directory.join(format!("{stem}.json")));
        }
        unreachable!()
    }
}

#[derive(Default)]
pub(in crate::app) struct ProgressMailbox {
    frame: Mutex<Option<Arc<ProgressFrame>>>,
    seed: Mutex<Option<(SceneKey, u64)>>,
}

impl ProgressMailbox {
    pub(super) fn contains(
        &self,
        key: &SceneKey,
        generation: u64,
        sequence: usize,
        pixels: &[u8],
    ) -> bool {
        self.current(key, generation)
            .is_some_and(|frame| frame.sequence == sequence && frame.pixels.as_slice() == pixels)
    }

    pub(super) fn publish(&self, frame: ProgressFrame) -> Arc<ProgressFrame> {
        let frame = Arc::new(frame);
        *self.frame.lock().unwrap() = Some(Arc::clone(&frame));
        frame
    }

    /// A layer sample is not an ordered command prefix. Keep it until exact
    /// completion; command counts cannot prove that all sampled shapes exist.
    pub(super) fn protect_initial(&self, key: &SceneKey, generation: u64) {
        *self.seed.lock().unwrap() = Some((key.clone(), generation));
    }

    pub(super) fn publish_initial(&self, mut frame: ProgressFrame) -> Arc<ProgressFrame> {
        self.protect_initial(&frame.key, frame.generation);
        let mut current = self.frame.lock().unwrap();
        if let Some(previous) = current
            .as_ref()
            .filter(|previous| previous.key == frame.key && previous.generation == frame.generation)
        {
            // Different sampled record sets can emit the same primitive count.
            // Presentation identity is a revision, not the size of the sample.
            frame.sequence = previous.sequence.wrapping_add(1);
        }
        let frame = Arc::new(frame);
        *current = Some(Arc::clone(&frame));
        frame
    }

    pub(super) fn publish_ordered(&self, frame: ProgressFrame) -> Option<Arc<ProgressFrame>> {
        let seed = self.seed.lock().unwrap();
        if seed
            .as_ref()
            .is_some_and(|(key, generation)| *key == frame.key && *generation == frame.generation)
        {
            return None;
        }
        Some(self.publish(frame))
    }

    pub(in crate::app) fn current(
        &self,
        key: &SceneKey,
        generation: u64,
    ) -> Option<Arc<ProgressFrame>> {
        self.frame
            .lock()
            .unwrap()
            .as_ref()
            .filter(|frame| frame.key == *key && frame.generation == generation)
            .map(Arc::clone)
    }

    pub(super) fn clear(&self) {
        *self.seed.lock().unwrap() = None;
        *self.frame.lock().unwrap() = None;
    }
}
