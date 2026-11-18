//! Optional UI-frame evidence for diagnostic replays. A worker may cancel a
//! camera after its UI seed was shown, leaving no background copy to compare.
//! Normal presentation performs neither readback nor evidence I/O.
use super::*;
use std::sync::mpsc::{sync_channel, SyncSender};

pub(super) struct SeedEvidence {
    outgoing: Option<SyncSender<ProgressFrame>>,
}

impl Default for SeedEvidence {
    fn default() -> Self {
        let outgoing = std::env::var_os("ECOS_RENDER_PROGRESS_EVIDENCE")
            .filter(|path| !path.is_empty())
            .map(|path| {
                let directory = PathBuf::from(path).join("ui");
                let (sender, frames) = sync_channel::<ProgressFrame>(4);
                thread::spawn(move || {
                    for frame in frames {
                        if let Err(error) = frame.record_evidence(&directory) {
                            eprintln!("UI seed evidence unavailable: {error}");
                        }
                    }
                });
                sender
            });
        Self { outgoing }
    }
}

impl SeedEvidence {
    pub(super) fn record(
        &self,
        gl: &glow::Context,
        target: &RasterTarget,
        key: &SceneKey,
        generation: u64,
    ) {
        let Some(sender) = &self.outgoing else { return };
        let [width, height] = key.screen_size();
        let mut pixels = vec![0; width as usize * height as usize * 4];
        unsafe {
            gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(target.framebuffer));
            gl.read_pixels(
                0,
                0,
                width as i32,
                height as i32,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(Some(&mut pixels)),
            );
            let error = gl.get_error();
            if error != glow::NO_ERROR {
                eprintln!("UI seed evidence unavailable: OpenGL readback error {error}");
                return;
            }
        }
        let frame = ProgressFrame {
            key: key.clone(),
            generation,
            sequence: 0,
            pixels: Arc::new(pixels),
        };
        if let Err(error) = sender.try_send(frame) {
            eprintln!("UI seed evidence unavailable: {error}");
        }
    }
}
