use anyhow::{ensure, Context, Result};
use chipgeom_format::replay::{Delta, Manifest, Scene, SCHEMA};
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
}

impl Recording {
    pub fn delta(&self, index: usize) -> Result<Delta> {
        let frame = &self.manifest.frames[index];
        let delta: Delta = read(&within(&self.root, &self.root.join(&frame.path))?)?;
        ensure!(
            delta.sequence == index && delta.checkpoint == frame.checkpoint,
            "Frame identity mismatch"
        );
        Ok(delta)
    }

    pub fn map_root(&self) -> Result<Option<PathBuf>> {
        self.manifest
            .maps
            .as_ref()
            .map(|path| within(&self.root, &self.root.join(path)))
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
            manifest.schema == SCHEMA && manifest.status == "complete",
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
        };
        result.check_current()?;
        Ok(result)
    }

    pub fn check_current(&self) -> Result<()> {
        let pointer: serde_json::Value = read(&self.pointer)?;
        ensure!(
            pointer["status"] == "complete" && pointer["attempt_id"] == self.manifest.attempt_id,
            "Replay invalidated by a rerun. Reopen after completion."
        );
        Ok(())
    }

    /// Restore by identity, including distinct samples with equal timestamps.
    pub fn seek_frame(&mut self, target: usize) -> Result<()> {
        self.check_current()?;
        ensure!(target < self.manifest.frames.len(), "Missing Replay frame");
        if self.scene.revision == Some(target) {
            return Ok(());
        }
        let (start, mut next) = if self.scene.revision.is_some_and(|r| r < target) {
            (self.scene.revision.unwrap() + 1, self.scene.clone())
        } else {
            let start = (0..=target)
                .rev()
                .find(|&i| self.manifest.frames[i].checkpoint)
                .context("Missing checkpoint")?;
            (start, Scene::default())
        };
        for i in start..=target {
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
