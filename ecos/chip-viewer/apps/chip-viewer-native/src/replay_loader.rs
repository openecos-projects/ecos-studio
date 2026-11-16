//! Latest-request-wins reconstruction outside the egui thread.
use crate::replay_data::Recording;
use crate::replay_index::SceneIndex;
use crate::replay_motion::Motion;
use crate::replay_plan::Kind;
use crate::replay_reveal::Reveal;
use chipgeom_format::replay::Scene;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Arc,
};

pub struct Request {
    pub workspace: PathBuf,
    pub manifest: PathBuf,
    pub attempt: String,
    pub frame: usize,
    pub kind: Kind,
    pub animate: bool,
    pub results: bool,
}

pub struct ResultAssets {
    pub maps: crate::replay_maps::ReplayMaps,
    pub analysis: crate::replay_analysis::ReplayAnalysis,
    pub tree: Result<Option<crate::clock_tree::ClockTreePanel>, String>,
}

pub struct Prepared {
    pub scene: Scene,
    pub route_overlay: crate::replay_route::RouteOverlay,
    pub motion: Motion,
    pub reveal: Reveal,
    pub index: SceneIndex,
    pub logic: Option<crate::replay_logic::Logic>,
    pub results: Option<ResultAssets>,
    #[cfg(test)]
    pub timings_ms: [f64; 4],
}

pub struct Loaded {
    pub generation: u64,
    pub result: Result<Prepared, String>,
}

pub struct Loader {
    sender: mpsc::Sender<(u64, Request)>,
    receiver: mpsc::Receiver<Loaded>,
    generation: Arc<AtomicU64>,
}

impl Default for Loader {
    fn default() -> Self {
        let (sender, requests) = mpsc::channel::<(u64, Request)>();
        let (replies, receiver) = mpsc::channel();
        let generation = Arc::new(AtomicU64::new(0));
        let current = generation.clone();
        std::thread::spawn(move || {
            let mut recording: Option<(PathBuf, Recording)> = None;
            let mut prefetched: Option<(PathBuf, String, usize, Prepared)> = None;
            while let Ok((mut token, mut request)) = requests.recv() {
                while let Ok((new_token, new_request)) = requests.try_recv() {
                    token = new_token;
                    request = new_request;
                }
                let alive = || current.load(Ordering::Acquire) == token;
                if !alive() {
                    continue;
                }
                let result = (|| -> anyhow::Result<Prepared> {
                    if !recording.as_ref().is_some_and(|(path, record)| {
                        path == &request.manifest && record.manifest.attempt_id == request.attempt
                    }) {
                        let record = Recording::open(&request.workspace, &request.manifest)?;
                        anyhow::ensure!(
                            record.manifest.attempt_id == request.attempt,
                            "Replay attempt changed"
                        );
                        recording = Some((request.manifest.clone(), record));
                    }
                    let record = &mut recording.as_mut().unwrap().1;
                    record.check_current()?;
                    if let Some((path, attempt, frame, prepared)) = prefetched.take() {
                        if path == request.manifest
                            && attempt == request.attempt
                            && frame == request.frame
                            && request.animate
                            && request.kind == Kind::Motion
                            && !request.results
                        {
                            return Ok(prepared);
                        }
                    }
                    prepare(record, &request, &alive)
                })()
                .map_err(|error| error.to_string());
                let loaded = result.is_ok();
                if alive()
                    && replies
                        .send(Loaded {
                            generation: token,
                            result,
                        })
                        .is_err()
                {
                    break;
                }
                // Warm only the next compatible movement. One predicted scene
                // overlaps the current animation; a user seek always takes priority.
                if loaded
                    && request.animate
                    && request.kind == Kind::Motion
                    && !request.results
                    && alive()
                {
                    if let Some((path, record)) = &mut recording {
                        let next = request.frame + 1;
                        if record.manifest.frames.get(next).is_some_and(|frame| {
                            crate::replay_motion::compatible_frames(
                                &record.manifest.frames[request.frame],
                                frame,
                            )
                        }) {
                            let next_request = Request {
                                frame: next,
                                ..request
                            };
                            if let Ok(prepared) = prepare(record, &next_request, &alive) {
                                if alive() {
                                    prefetched =
                                        Some((path.clone(), next_request.attempt, next, prepared));
                                }
                            }
                        }
                    }
                }
            }
        });
        Self {
            sender,
            receiver,
            generation,
        }
    }
}

fn prepare(
    record: &mut Recording,
    request: &Request,
    alive: &impl Fn() -> bool,
) -> anyhow::Result<Prepared> {
    #[cfg(test)]
    let started = std::time::Instant::now();
    let mut motion = Motion::default();
    let mut reveal = Reveal::default();
    if request.animate && request.kind != Kind::Hold {
        let first = match request.kind {
            Kind::Filler { first } => first,
            _ => request.frame,
        };
        if let Some(previous) = first.checked_sub(1) {
            record.seek_frame_if(previous, alive)?;
        } else {
            record.scene = Scene::default();
        }
        anyhow::ensure!(alive(), "Seek superseded");
        let before = record.scene.clone();
        record.seek_frame_if(request.frame, alive)?;
        match request.kind {
            Kind::Motion => motion.begin(&before, &record.scene, &record.manifest.frames),
            Kind::Reveal => reveal.begin(&before, &record.scene, &record.manifest.frames),
            Kind::Filler { .. } => {
                reveal.begin_filler(&before, &record.scene, &record.manifest.frames)
            }
            Kind::Hold => {}
        }
    } else {
        record.seek_frame_if(request.frame, alive)?;
    }
    anyhow::ensure!(alive(), "Seek superseded");
    #[cfg(test)]
    let reconstructed = std::time::Instant::now();
    let index = SceneIndex::build(&record.scene, &motion);
    #[cfg(test)]
    let indexed = std::time::Instant::now();
    let logic = crate::replay_logic::load(record)?;
    let results = request.results.then(|| {
        let mut maps = crate::replay_maps::ReplayMaps::default();
        match record.map_root() {
            Ok(Some(root)) => maps = crate::replay_maps::ReplayMaps::open(&root),
            Err(error) => maps.error = error.to_string(),
            _ => {}
        }
        let mut analysis = crate::replay_analysis::ReplayAnalysis::open(record);
        analysis.resolve(&record.scene);
        let tree = record
            .clock_tree()
            .and_then(|tree| {
                tree.map(|tree| crate::clock_tree::ClockTreePanel::from_snapshot(&tree))
                    .transpose()
            })
            .map_err(|error| error.to_string());
        ResultAssets {
            maps,
            analysis,
            tree,
        }
    });
    #[cfg(test)]
    let assets = std::time::Instant::now();
    let scene = record.scene.clone();
    let route_overlay = crate::replay_route::RouteOverlay::from_scene(&scene);
    Ok(Prepared {
        route_overlay,
        scene,
        motion,
        reveal,
        index,
        logic,
        results,
        #[cfg(test)]
        timings_ms: [
            (reconstructed - started).as_secs_f64() * 1000.0,
            (indexed - reconstructed).as_secs_f64() * 1000.0,
            (assets - indexed).as_secs_f64() * 1000.0,
            assets.elapsed().as_secs_f64() * 1000.0,
        ],
    })
}

impl Loader {
    pub fn submit(&self, request: Request) -> anyhow::Result<u64> {
        let token = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.sender
            .send((token, request))
            .map_err(|_| anyhow::anyhow!("Replay loader stopped"))?;
        Ok(token)
    }
    pub fn poll(&self) -> Option<Loaded> {
        self.receiver.try_recv().ok()
    }
    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
}

impl Drop for Loader {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay_data::tests::Fixture;
    #[test]
    fn animated_load_rejects_invalid_frame_and_stale_attempt_without_losing_worker() {
        let fixture = Fixture::new();
        let loader = Loader::default();
        let request = |frame| Request {
            workspace: fixture.0.clone(),
            manifest: fixture.0.join("attempts/a/manifest.json"),
            attempt: "a".into(),
            frame,
            kind: Kind::Motion,
            animate: true,
            results: false,
        };
        let receive = || {
            loader
                .receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
        };
        loader.submit(request(99)).unwrap();
        assert!(receive().result.is_err());
        loader.submit(request(1)).unwrap();
        assert_eq!(receive().result.unwrap().scene.revision, Some(1));
        fixture.write(
            "manifest.json",
            serde_json::json!({
                "schema":"ecos.replay.v1", "status":"recording", "attempt_id":"b"
            }),
        );
        loader.submit(request(2)).unwrap();
        assert!(receive().result.is_err());
    }
    #[test]
    fn latest_seek_restores_exact_target_without_accepting_old_work() {
        let fixture = Fixture::new();
        let loader = Loader::default();
        let request = |frame| Request {
            workspace: fixture.0.clone(),
            manifest: fixture.0.join("attempts/a/manifest.json"),
            attempt: "a".into(),
            frame,
            kind: Kind::Hold,
            animate: false,
            results: false,
        };
        loader.submit(request(2)).unwrap();
        let latest = loader.submit(request(0)).unwrap();
        loop {
            let reply = loader
                .receiver
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            if reply.generation == latest {
                let scene = reply.result.unwrap().scene;
                assert_eq!(scene.revision, Some(0));
                assert_eq!(scene.objects["inst:a"].bbox, [0, 0, 5, 5]);
                break;
            }
        }
    }
}
