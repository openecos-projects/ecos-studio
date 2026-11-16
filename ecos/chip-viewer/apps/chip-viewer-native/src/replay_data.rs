use anyhow::{ensure, Context, Result};
use chipgeom_format::replay::{Delta, Manifest, Scene, SCHEMA, SCHEMA_V2};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
pub struct Step {
    pub name: String,
    pub seconds: f64,
    pub manifest: Option<PathBuf>,
    pub reason: String,
    pub metrics: Vec<serde_json::Value>,
    #[serde(default)]
    pub nodes: Vec<Node>,
}

#[derive(Deserialize)]
pub struct Node {
    pub seconds: f64,
    pub label: String,
}

#[derive(Deserialize)]
pub struct Catalog {
    pub schema: String,
    pub workspace: PathBuf,
    pub steps: Vec<Step>,
}

pub fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    ensure!(
        path.metadata()?.len() <= 256 * 1024 * 1024,
        "Replay file exceeds 256 MiB"
    );
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

pub fn within(root: &Path, path: &Path) -> Result<PathBuf> {
    let resolved = path.canonicalize()?;
    ensure!(
        resolved.starts_with(root.canonicalize()?),
        "Replay path escapes its root"
    );
    Ok(resolved)
}

pub struct Recording {
    pub manifest: Manifest,
    workspace: PathBuf,
    root: PathBuf,
    pointer: PathBuf,
    pub scene: Scene,
    cache: std::cell::RefCell<crate::replay_cache::DeltaCache>,
    anchor: std::cell::RefCell<Option<Delta>>,
}

impl Recording {
    pub fn asset(&self, path: &str) -> Result<PathBuf> {
        let resolved = within(&self.root, &self.root.join(path))?;
        if let Some(expected) = self.manifest.files.get(path) {
            crate::replay_integrity::verify(&resolved, expected)?;
        } else {
            ensure!(self.manifest.files.is_empty(), "Unindexed Replay asset");
        }
        Ok(resolved)
    }

    fn verify_folder(&self, folder: &str) -> Result<()> {
        for path in self.manifest.files.keys() {
            if std::path::Path::new(path).starts_with(folder) {
                self.asset(path)?;
            }
        }
        Ok(())
    }

    pub fn delta(&self, index: usize) -> Result<Delta> {
        let mut delta = self.raw_delta(index)?;
        if let Some(base) = delta.base_checkpoint {
            ensure!(
                self.manifest.schema == SCHEMA_V2 && base == 0 && index > 0 && delta.checkpoint,
                "Invalid Replay checkpoint base"
            );
            ensure!(
                delta.translate.is_empty(),
                "Referenced checkpoint contains translations"
            );
            let mut baseline = self.raw_delta(base)?;
            ensure!(
                baseline.checkpoint && baseline.base_checkpoint.is_none(),
                "Invalid Replay anchor"
            );
            for id in &delta.remove {
                baseline.upsert.remove(id);
            }
            baseline.upsert.extend(delta.upsert);
            delta.upsert = baseline.upsert;
            delta.remove.clear();
            delta.base_checkpoint = None;
        }
        Ok(delta)
    }

    fn raw_delta(&self, index: usize) -> Result<Delta> {
        if index == 0 {
            if let Some(delta) = self.anchor.borrow().as_ref() {
                return Ok(delta.clone());
            }
        }
        if let Some(delta) = self.cache.borrow_mut().get(index) {
            return Ok(delta);
        }
        let frame = &self.manifest.frames[index];
        let path = self.asset(&frame.path)?;
        let delta: Delta = match frame.encoding.as_deref().unwrap_or("json") {
            "json" | "json+base" => read(&path)?,
            "gzip+json" | "gzip+json+base" => {
                use std::io::Read;
                let decoder = flate2::read::GzDecoder::new(std::fs::File::open(&path)?);
                let mut data = Vec::new();
                decoder.take(256 * 1024 * 1024 + 1).read_to_end(&mut data)?;
                ensure!(
                    data.len() <= 256 * 1024 * 1024,
                    "Decoded Replay frame exceeds 256 MiB"
                );
                serde_json::from_slice(&data)?
            }
            _ => anyhow::bail!("Unsupported Replay frame encoding"),
        };
        ensure!(
            delta.sequence == index && delta.checkpoint == frame.checkpoint,
            "Frame identity mismatch"
        );
        ensure!(
            delta.base_checkpoint.is_some()
                == frame
                    .encoding
                    .as_deref()
                    .is_some_and(|e| e.ends_with("+base")),
            "Checkpoint base/encoding mismatch"
        );
        if index == 0
            && self
                .manifest
                .frames
                .iter()
                .any(|f| f.encoding.as_deref().is_some_and(|e| e.ends_with("+base")))
        {
            // One shared immutable anchor, not a historical scene cache. Current
            // scenes share its unchanged objects; dynamic cache remains bounded.
            *self.anchor.borrow_mut() = Some(delta.clone());
        } else {
            self.cache.borrow_mut().insert(index, &delta);
        }
        Ok(delta)
    }

    pub fn map_root(&self) -> Result<Option<PathBuf>> {
        self.manifest
            .maps
            .as_ref()
            .map(|path| {
                self.verify_folder(path)?;
                within(&self.root, &self.root.join(path))
            })
            .transpose()
    }

    pub fn clock_tree(&self) -> Result<Option<chipgeom_reader::ClockTreeSnapshot>> {
        let Some(manifest_path) = self.clock_tree_path()? else {
            return Ok(None);
        };
        let database = chipgeom_reader::GeometrySnapshot::open(manifest_path)?;
        Ok(database.clock_tree()?.cloned())
    }

    fn clock_tree_path(&self) -> Result<Option<PathBuf>> {
        if let Some(path) = &self.manifest.frozen_clock_tree {
            self.verify_folder(
                std::path::Path::new(path)
                    .parent()
                    .context("Missing tree folder")?
                    .to_str()
                    .context("Invalid tree path")?,
            )?;
            return Ok(Some(self.asset(path)?));
        }
        if self.manifest.results_frozen {
            return Ok(None);
        }
        let manifest_path = if let Some(path) = &self.manifest.clock_tree_manifest {
            within(&self.workspace, &self.workspace.join(path))?
        } else {
            // Older Replay manifests only linked CTS. Other native stage trees
            // can be read from this step's own geometry snapshot if it was
            // written during this exact capture, never from a neighboring step.
            let Some(started) = self.manifest.started_at_unix_ns else {
                return Ok(None);
            };
            let geometry = self
                .root
                .ancestors()
                .nth(3)
                .context("Missing geometry directory")?;
            let candidate = geometry.join("geometry.manifest");
            if !candidate.exists() {
                return Ok(None);
            }
            let path = within(&self.workspace, &candidate)?;
            let modified = path.metadata()?.modified()?;
            let published = self.root.join("manifest.json").metadata()?.modified()?;
            let stamp = modified.duration_since(std::time::UNIX_EPOCH)?.as_nanos();
            if stamp < u128::from(started) || modified > published {
                return Ok(None);
            }
            path
        };
        Ok(Some(manifest_path))
    }

    pub fn open(workspace: &Path, path: &Path) -> Result<Self> {
        let path = within(workspace, path)?;
        let root = path
            .parent()
            .context("Missing attempt directory")?
            .to_path_buf();
        let manifest: Manifest = read(&path)?;
        ensure!(
            (manifest.schema == SCHEMA || manifest.schema == SCHEMA_V2)
                && (manifest.status == "complete"
                    || (manifest.status == "diagnostic_only"
                        && manifest.diagnostic_only
                        && manifest.flow_state.as_deref() == Some("Incomplete"))),
            "Replay attempt is incomplete or unsupported"
        );
        ensure!(!manifest.frames.is_empty(), "Empty Replay attempt");
        let mut elapsed = 0;
        for (i, frame) in manifest.frames.iter().enumerate() {
            ensure!(
                frame.sequence == i && frame.elapsed_ns >= elapsed,
                "Invalid Replay ordering"
            );
            ensure!(
                i != 0 || frame.checkpoint,
                "Replay must start at a checkpoint"
            );
            elapsed = frame.elapsed_ns;
        }
        ensure!(
            elapsed <= manifest.duration_ns
                && manifest.frames.last().is_some_and(|f| {
                    matches!(
                        f.state_domain.as_str(),
                        "native_committed" | "analysis_complete"
                    )
                }),
            "Missing committed or analysis result"
        );
        let pointer = root
            .parent()
            .and_then(Path::parent)
            .context("Invalid attempt path")?
            .join("manifest.json");
        let result = Self {
            manifest,
            workspace: workspace.canonicalize()?,
            root,
            pointer,
            scene: Scene::default(),
            cache: Default::default(),
            anchor: Default::default(),
        };
        result.check_current()?;
        let pointer: serde_json::Value = read(&result.pointer)?;
        if let Some(digest) = pointer["manifest_sha256"].as_str() {
            crate::replay_integrity::verify(
                &path,
                &chipgeom_format::replay::Fingerprint {
                    size: path.metadata()?.len(),
                    sha256: digest.into(),
                },
            )?;
        }
        Ok(result)
    }

    pub fn check_current(&self) -> Result<()> {
        let pointer: serde_json::Value = read(&self.pointer)?;
        ensure!(
            pointer["status"] == self.manifest.status
                && pointer["attempt_id"] == self.manifest.attempt_id,
            "Replay invalidated by a rerun. Reopen after completion."
        );
        Ok(())
    }

    /// Restore by identity, including distinct samples with equal timestamps.
    pub fn seek_frame(&mut self, target: usize) -> Result<()> {
        self.seek_frame_if(target, || true)
    }

    pub fn seek_frame_if(&mut self, target: usize, alive: impl Fn() -> bool) -> Result<()> {
        self.check_current()?;
        ensure!(target < self.manifest.frames.len(), "Missing Replay frame");
        if self.scene.revision == Some(target) {
            return Ok(());
        }
        let checkpoint = (0..=target)
            .rev()
            .find(|&i| self.manifest.frames[i].checkpoint)
            .context("Missing checkpoint")?;
        let (start, mut next) = if self
            .scene
            .revision
            .is_some_and(|r| r < target && r >= checkpoint)
        {
            (self.scene.revision.unwrap() + 1, self.scene.clone())
        } else {
            (checkpoint, Scene::default())
        };
        for i in start..=target {
            ensure!(alive(), "Seek superseded");
            next.apply(self.delta(i)?).map_err(anyhow::Error::msg)?;
        }
        self.scene = next;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) struct Fixture(pub PathBuf);
    impl Fixture {
        pub(crate) fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "ecos-replay-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(root.join("attempts/a/frames")).unwrap();
            let fixture = Self(root);
            fixture.write(
                "manifest.json",
                json!({"schema":SCHEMA,"status":"complete","attempt_id":"a"}),
            );
            let frames=(0..3).map(|i|json!({"sequence":i,"elapsed_ns":i*1_000_000_000u64,"phase":"sample","subflow":"run placement","state_domain":if i==2 {"native_committed"}else{"algorithm_state"},"path":format!("frames/{i}.json"),"checkpoint":i==0})).collect::<Vec<_>>();
            fixture.write("attempts/a/manifest.json",json!({"schema":SCHEMA,"status":"complete","attempt_id":"a","duration_ns":3_000_000_000u64,"frames":frames}));
            for i in 0..3 {
                fixture.write(&format!("attempts/a/frames/{i}.json"),json!({"sequence":i,"base_revision":i-1,"checkpoint":i==0,"upsert":{"inst:a":{"kind":"instance","bbox":[i*10,0,i*10+5,5]}},"remove":[],"touched":if i==0 {vec![]}else{vec!["inst:a"]}}));
            }
            fixture
        }
        pub(crate) fn write(&self, path: &str, value: serde_json::Value) {
            std::fs::write(self.0.join(path), serde_json::to_vec(&value).unwrap()).unwrap();
        }
        pub(crate) fn open(&self) -> Recording {
            Recording::open(&self.0, &self.0.join("attempts/a/manifest.json")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn referenced_checkpoint_restores_input_and_applies_removals_on_random_seek() {
        let fixture = Fixture::new();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        manifest["schema"] = json!(SCHEMA_V2);
        manifest["frames"][2]["checkpoint"] = json!(true);
        manifest["frames"][2]["encoding"] = json!("json+base");
        fixture.write("attempts/a/manifest.json", manifest);
        fixture.write(
            "attempts/a/frames/2.json",
            json!({
                "sequence":2,"base_revision":1,"checkpoint":true,"base_checkpoint":0,
                "upsert":{"inst:b":{"kind":"instance","bbox":[50,0,55,5]}},
                "remove":["inst:a"],"touched":["inst:a","inst:b"]
            }),
        );
        let mut recording = fixture.open();
        recording.seek_frame(2).unwrap();
        let final_scene = recording.scene.clone();
        assert_eq!(
            final_scene.objects.keys().collect::<Vec<_>>(),
            vec!["inst:b"]
        );
        recording.seek_frame(0).unwrap();
        assert!(recording.scene.objects.contains_key("inst:a"));
        recording.seek_frame(2).unwrap();
        assert_eq!(recording.scene, final_scene);
        assert!(recording.anchor.borrow().is_some());
    }

    #[test]
    fn v2_explicit_gzip_encoding_and_translation_restore_exact_scene() {
        use std::io::Write;
        let fixture = Fixture::new();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        manifest["schema"] = json!(SCHEMA_V2);
        manifest["frames"][1]["encoding"] = json!("gzip+json");
        fixture.write("attempts/a/manifest.json", manifest);
        let delta = json!({"sequence":1,"base_revision":0,"checkpoint":false,
        "upsert":{},"translate":{"inst:a":[10,0]},"remove":[],"touched":["inst:a"]});
        let mut compressed = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        compressed
            .write_all(&serde_json::to_vec(&delta).unwrap())
            .unwrap();
        std::fs::write(
            fixture.0.join("attempts/a/frames/1.json"),
            compressed.finish().unwrap(),
        )
        .unwrap();
        let mut recording = fixture.open();
        recording.seek_frame(1).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [10, 0, 15, 5]);
        recording.seek_frame(2).unwrap();
        recording.seek_frame(1).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [10, 0, 15, 5]);
    }

    #[test]
    fn random_seek_restores_positions_and_cumulative_highlights() {
        let fixture = Fixture::new();
        let mut recording = fixture.open();
        recording.seek_frame(0).unwrap();
        let first = recording.scene.clone();
        recording.seek_frame(2).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [20, 0, 25, 5]);
        recording.seek_frame(1).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [10, 0, 15, 5]);
        assert!(recording.scene.touched.contains("inst:a"));
        recording.seek_frame(0).unwrap();
        assert_eq!(recording.scene, first);
    }

    #[test]
    fn rerun_and_missing_delta_are_not_silently_replayed() {
        let fixture = Fixture::new();
        let mut recording = fixture.open();
        recording.seek_frame(0).unwrap();
        let first = recording.scene.clone();
        std::fs::remove_file(fixture.0.join("attempts/a/frames/1.json")).unwrap();
        assert!(recording.seek_frame(2).is_err());
        assert_eq!(recording.scene, first);
        fixture.write(
            "manifest.json",
            json!({"status":"recording","attempt_id":"b"}),
        );
        assert!(recording
            .seek_frame(0)
            .unwrap_err()
            .to_string()
            .contains("invalidated"));
    }

    #[test]
    fn frame_identity_distinguishes_samples_with_equal_timestamps() {
        let fixture = Fixture::new();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        for frame in manifest["frames"].as_array_mut().unwrap() {
            frame["elapsed_ns"] = json!(0);
        }
        fixture.write("attempts/a/manifest.json", manifest);
        let mut recording = fixture.open();
        recording.seek_frame(1).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [10, 0, 15, 5]);
        recording.seek_frame(0).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [0, 0, 5, 5]);
    }

    #[test]
    fn legacy_clock_tree_reference_requires_this_attempts_fresh_snapshot() {
        let fixture = Fixture::new();
        let geometry = fixture.0.join("postFloorplan_ecc/output/geometry");
        let attempt = geometry.join("replay/attempts/a");
        std::fs::create_dir_all(&attempt).unwrap();
        std::fs::copy(
            fixture.0.join("manifest.json"),
            geometry.join("replay/manifest.json"),
        )
        .unwrap();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        manifest["started_at_unix_ns"] = json!(10_000_000_000u64);
        let manifest_path = attempt.join("manifest.json");
        std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let snapshot = geometry.join("geometry.manifest");
        std::fs::write(&snapshot, "geometry fixture").unwrap();
        let set_modified =
            |path: &Path, seconds| {
                std::fs::File::options()
                    .write(true)
                    .open(path)
                    .unwrap()
                    .set_times(std::fs::FileTimes::new().set_modified(
                        std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds),
                    ))
                    .unwrap();
            };
        set_modified(&manifest_path, 30);
        let recording = Recording::open(&fixture.0, &manifest_path).unwrap();
        set_modified(&snapshot, 20);
        assert_eq!(
            recording.clock_tree_path().unwrap(),
            Some(snapshot.canonicalize().unwrap())
        );
        set_modified(&snapshot, 5);
        assert_eq!(recording.clock_tree_path().unwrap(), None);
        set_modified(&snapshot, 35);
        assert_eq!(recording.clock_tree_path().unwrap(), None);
        let mut recording = recording;
        recording.manifest.started_at_unix_ns = None;
        set_modified(&snapshot, 20);
        assert_eq!(recording.clock_tree_path().unwrap(), None);
        let outside = Fixture::new();
        recording.manifest.clock_tree_manifest =
            Some(outside.0.join("manifest.json").display().to_string());
        assert!(recording
            .clock_tree_path()
            .unwrap_err()
            .to_string()
            .contains("escapes"));
    }
}
