use anyhow::{bail, ensure, Context, Result};
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
    root: PathBuf,
    pointer: PathBuf,
    pub scene: Scene,
}

impl Recording {
    pub fn next_frame_seconds(&self) -> Option<f64> {
        let index = self.scene.revision.map_or(0, |revision| revision + 1);
        self.manifest
            .frames
            .get(index)
            .map(|frame| frame.elapsed_ns as f64 / 1e9)
    }

    pub fn map_root(&self) -> Result<Option<PathBuf>> {
        self.manifest
            .maps
            .as_ref()
            .map(|path| within(&self.root, &self.root.join(path)))
            .transpose()
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
                && manifest
                    .frames
                    .last()
                    .is_some_and(|f| f.state_domain == "native_committed"),
            "Missing committed result"
        );
        let pointer = root
            .parent()
            .and_then(Path::parent)
            .context("Invalid attempt path")?
            .join("manifest.json");
        let result = Self {
            manifest,
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

    pub fn seek(&mut self, seconds: f64, complete: bool) -> Result<Option<usize>> {
        self.check_current()?;
        // Adding/removing the flow offset can round a frame boundary slightly
        // down. Compare at the recording's nanosecond precision to avoid
        // repeatedly stopping immediately before the same next frame.
        let elapsed_ns = (seconds * 1e9).round();
        let target = if complete {
            Some(self.manifest.frames.len() - 1)
        } else {
            self.manifest
                .frames
                .iter()
                .rposition(|f| f.elapsed_ns as f64 <= elapsed_ns)
        };
        let Some(target) = target else {
            self.scene = Scene::default();
            return Ok(None);
        };
        if self.scene.revision == Some(target) {
            return Ok(Some(target));
        }
        let start = if self.scene.revision.is_some_and(|r| r < target) {
            self.scene.revision.unwrap() + 1
        } else {
            self.scene = Scene::default();
            (0..=target)
                .rev()
                .find(|&i| self.manifest.frames[i].checkpoint)
                .context("Missing checkpoint")?
        };
        let mut next = self.scene.clone();
        for i in start..=target {
            let frame = &self.manifest.frames[i];
            let delta: Delta = read(&within(&self.root, &self.root.join(&frame.path))?)?;
            if delta.sequence != i || delta.checkpoint != frame.checkpoint {
                bail!("Frame identity mismatch");
            }
            next.apply(delta).map_err(anyhow::Error::msg)?;
        }
        self.scene = next;
        Ok(Some(target))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
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
        fn write(&self, path: &str, value: serde_json::Value) {
            std::fs::write(self.0.join(path), serde_json::to_vec(&value).unwrap()).unwrap();
        }
        fn open(&self) -> Recording {
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
        recording.seek(0.0, false).unwrap();
        let first = recording.scene.clone();
        recording.seek(2.0, true).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [20, 0, 25, 5]);
        recording.seek(1.5, false).unwrap();
        assert_eq!(recording.scene.objects["inst:a"].bbox, [10, 0, 15, 5]);
        assert!(recording.scene.touched.contains("inst:a"));
        recording.seek(0.0, false).unwrap();
        assert_eq!(recording.scene, first);
    }

    #[test]
    fn next_frame_boundary_survives_timeline_offset_rounding() {
        let fixture = Fixture::new();
        let mut recording = fixture.open();
        assert_eq!(recording.next_frame_seconds(), Some(0.0));
        recording.seek(0.0, false).unwrap();
        assert_eq!(recording.next_frame_seconds(), Some(1.0));
        recording.seek(1.0 - f64::EPSILON, false).unwrap();
        assert_eq!(recording.scene.revision, Some(1));
        assert_eq!(recording.next_frame_seconds(), Some(2.0));
        recording.seek(3.0, true).unwrap();
        assert_eq!(recording.next_frame_seconds(), None);
    }

    #[test]
    fn rerun_and_missing_delta_are_not_silently_replayed() {
        let fixture = Fixture::new();
        let mut recording = fixture.open();
        recording.seek(0.0, false).unwrap();
        let first = recording.scene.clone();
        std::fs::remove_file(fixture.0.join("attempts/a/frames/1.json")).unwrap();
        assert!(recording.seek(2.0, true).is_err());
        assert_eq!(recording.scene, first);
        fixture.write(
            "manifest.json",
            json!({"status":"recording","attempt_id":"b"}),
        );
        assert!(recording
            .seek(0.0, false)
            .unwrap_err()
            .to_string()
            .contains("invalidated"));
    }
}
