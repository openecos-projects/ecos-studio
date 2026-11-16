//! One background CSV decoder. Superseded selections never reach the canvas.
use crate::map_data::HeatmapData;
use crate::replay_data::within;
use std::path::PathBuf;
use std::sync::{mpsc, Arc};

type Selection = (u64, PathBuf, PathBuf, PathBuf);
type Reply = (u64, Result<Arc<HeatmapData>, String>);

pub struct MapLoader {
    sender: mpsc::Sender<Selection>,
    receiver: mpsc::Receiver<Reply>,
    generation: u64,
    pub pending: bool,
}

impl Default for MapLoader {
    fn default() -> Self {
        let (sender, requests) = mpsc::channel::<Selection>();
        let (replies, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            while let Ok(mut request) = requests.recv() {
                while let Ok(newer) = requests.try_recv() {
                    request = newer;
                }
                let (token, root, csv, layout) = request;
                let loaded = (|| {
                    let csv = within(&root, &csv).map_err(|e| e.to_string())?;
                    let layout = within(&root, &layout).map_err(|e| e.to_string())?;
                    HeatmapData::load(&csv, &layout).map(Arc::new)
                })();
                if replies.send((token, loaded)).is_err() {
                    break;
                }
            }
        });
        Self {
            sender,
            receiver,
            generation: 0,
            pending: false,
        }
    }
}

impl MapLoader {
    pub fn select(&mut self, root: PathBuf, csv: PathBuf, layout: PathBuf) {
        self.cancel();
        self.pending = self
            .sender
            .send((self.generation, root, csv, layout))
            .is_ok();
    }
    pub fn cancel(&mut self) {
        self.generation += 1;
        self.pending = false;
    }
    pub fn poll(&mut self) -> Option<Result<Arc<HeatmapData>, String>> {
        while let Ok((token, result)) = self.receiver.try_recv() {
            if self.pending && token == self.generation {
                self.pending = false;
                return Some(result);
            }
        }
        None
    }
}
