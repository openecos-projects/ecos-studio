//! Display-time clips derived from real changes; never rewrites capture timestamps.
use crate::replay_data::{Catalog, Recording};
use crate::replay_maps::ReplayMaps;
use crate::replay_motion::{compatible_frames, compatible_objects};
use crate::replay_reveal::group;
use anyhow::Result;
use chipgeom_format::replay::{Delta, Frame, Scene};
use std::collections::BTreeMap;
use std::sync::mpsc::{self, Receiver};

pub const RESULT_SECONDS: f64 = 2.0;
pub const MAP_SECONDS: f64 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Hold,
    Motion,
    Reveal,
}

#[derive(Debug)]
pub struct Clip {
    pub frame: usize,
    pub start: f64,
    pub end: f64,
    pub kind: Kind,
}

pub struct StepPlan {
    pub clips: Vec<Clip>,
    pub process_seconds: f64,
    pub seconds: f64,
    pub attempt_id: Option<String>,
    pub error: String,
    frame_ends: Vec<f64>,
    source_ns: Vec<u64>,
}

impl StepPlan {
    pub fn unavailable(error: String) -> Self {
        Self {
            clips: Vec::new(),
            process_seconds: 0.0,
            seconds: RESULT_SECONDS,
            attempt_id: None,
            error,
            frame_ends: Vec::new(),
            source_ns: Vec::new(),
        }
    }

    pub fn build(recording: &Recording, maps: usize) -> Result<Self> {
        let frames = &recording.manifest.frames;
        let mut scene = Scene::default();
        let mut clips = Vec::new();
        for (i, frame) in frames.iter().enumerate() {
            let delta = recording.delta(i)?;
            let (kind, seconds) = classify(&scene, &delta, frames, i);
            // Applying every delta also validates revision continuity and bounds.
            scene.apply(delta).map_err(anyhow::Error::msg)?;
            if seconds > 0.0 {
                clips.push(Clip {
                    frame: i,
                    start: 0.0,
                    end: seconds,
                    kind,
                });
            }
            debug_assert_eq!(scene.revision, Some(frame.sequence));
        }
        recording.check_current()?;
        Ok(Self::assemble(
            clips,
            frames,
            maps,
            recording.manifest.attempt_id.clone(),
        ))
    }

    fn assemble(mut clips: Vec<Clip>, frames: &[Frame], maps: usize, attempt: String) -> Self {
        let mut duration = 0.0;
        for clip in &mut clips {
            clip.start = duration;
            duration += clip.end;
            clip.end = duration;
        }
        let mut frame_ends = vec![0.0; frames.len()];
        let mut cursor = 0;
        let mut last = 0.0;
        for (i, value) in frame_ends.iter_mut().enumerate() {
            if clips.get(cursor).is_some_and(|clip| clip.frame == i) {
                last = clips[cursor].end;
                cursor += 1;
            }
            *value = last;
        }
        Self {
            clips,
            process_seconds: duration,
            seconds: duration + RESULT_SECONDS + maps as f64 * MAP_SECONDS,
            attempt_id: Some(attempt),
            error: String::new(),
            frame_ends,
            source_ns: frames.iter().map(|frame| frame.elapsed_ns).collect(),
        }
    }

    pub fn clip_at(&self, seconds: f64) -> Option<usize> {
        let index = self.clips.partition_point(|clip| clip.end <= seconds);
        (index < self.clips.len()).then_some(index)
    }

    /// Subflow end markers map to completed changes, never into a transition.
    pub fn display_at_source(&self, seconds: f64) -> f64 {
        self.frame_at_source(seconds)
            .map_or(0.0, |i| self.frame_ends[i])
    }

    pub fn frame_at_source(&self, seconds: f64) -> Option<usize> {
        let ns = (seconds * 1e9).round();
        self.source_ns
            .partition_point(|time| *time as f64 <= ns)
            .checked_sub(1)
    }
}

fn classify(scene: &Scene, delta: &Delta, frames: &[Frame], i: usize) -> (Kind, f64) {
    let frame = &frames[i];
    if i == 0 && frame.state_domain == "native_input" {
        return (Kind::Hold, 0.35);
    }
    let removed = delta.remove.iter().any(|id| scene.objects.contains_key(id))
        || (delta.checkpoint
            && scene
                .objects
                .keys()
                .any(|id| !delta.upsert.contains_key(id)));
    let mut motion = !removed && i > 0 && compatible_frames(&frames[i - 1], frame);
    let mut groups = BTreeMap::new();
    let mut largest_move = 0.0_f64;
    for (id, object) in delta.upsert.iter() {
        let old = scene.objects.get(id);
        if old == Some(object) {
            continue;
        }
        motion &= old.is_some_and(|old| compatible_objects(old, object));
        if let Some(old) = old {
            let dx = (object.bbox[0] - old.bbox[0]) as f64;
            let dy = (object.bbox[1] - old.bbox[1]) as f64;
            largest_move = largest_move.max(dx.hypot(dy));
        }
        if let Some(key) = group(object) {
            *groups.entry(key).or_insert(0usize) += 1;
        }
    }
    for (id, [dx, dy]) in &delta.translate {
        if let Some(object) = scene.objects.get(id) {
            largest_move = largest_move.max((*dx as f64).hypot(*dy as f64));
            if let Some(key) = group(object) {
                *groups.entry(key).or_insert(0usize) += 1;
            }
        }
    }
    if !groups.is_empty() || removed {
        if motion {
            let extent = scene.objects.get("die").map_or(1.0, |die| {
                ((die.bbox[2] - die.bbox[0]) as f64)
                    .hypot((die.bbox[3] - die.bbox[1]) as f64)
                    .max(1.0)
            });
            return (
                Kind::Motion,
                (0.3 + (largest_move / extent).sqrt() * 2.0).clamp(0.3, 1.2),
            );
        }
        let seconds = groups
            .values()
            .map(|n| if *n > 1 { 1.1 } else { 0.6 })
            .sum::<f64>();
        return (Kind::Reveal, seconds.clamp(0.6, 6.0));
    }
    let boundary =
        i == 0 || frames[i - 1].subflow != frame.subflow || frames[i - 1].phase != frame.phase;
    let metrics = i > 0 && frames[i - 1].metrics != frame.metrics;
    if metrics {
        (Kind::Hold, 0.5)
    } else if boundary {
        (Kind::Hold, 0.25)
    } else {
        (Kind::Hold, 0.0)
    }
}

/// Read and compare frames off the UI thread. Only compact plans cross back.
pub fn prepare(catalog: &Catalog) -> Receiver<Vec<StepPlan>> {
    let (sender, receiver) = mpsc::channel();
    let workspace = catalog.workspace.clone();
    let paths = catalog
        .steps
        .iter()
        .map(|step| step.manifest.clone())
        .collect::<Vec<_>>();
    std::thread::spawn(move || {
        let plans = paths
            .into_iter()
            .map(|path| {
                let Some(path) = path else {
                    return StepPlan::unavailable(String::new());
                };
                let result = (|| -> Result<StepPlan> {
                    let recording = Recording::open(&workspace, &path)?;
                    let maps = recording
                        .map_root()?
                        .map_or(0, |root| ReplayMaps::open(&root).len());
                    StepPlan::build(&recording, maps + recording.manifest.analysis_view_count)
                })();
                result.unwrap_or_else(|error| StepPlan::unavailable(error.to_string()))
            })
            .collect();
        let _ = sender.send(plans);
    });
    receiver
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay_data::{read, tests::Fixture};
    use serde_json::json;

    #[test]
    fn idle_execution_time_does_not_change_display_and_final_delta_has_a_clip() {
        let fixture = Fixture::new();
        let ordinary = StepPlan::build(&fixture.open(), 0).unwrap();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        for (i, frame) in manifest["frames"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            frame["elapsed_ns"] = json!(i as u64 * 600_000_000_000);
        }
        manifest["duration_ns"] = json!(3_600_000_000_000u64);
        fixture.write("attempts/a/manifest.json", manifest);
        let slow = StepPlan::build(&fixture.open(), 2).unwrap();
        assert_eq!(ordinary.process_seconds, slow.process_seconds);
        assert_eq!(
            slow.seconds,
            slow.process_seconds + RESULT_SECONDS + 2.0 * MAP_SECONDS
        );
        let last = slow.clips.last().unwrap();
        assert_eq!((last.frame, last.kind), (2, Kind::Reveal));
        assert_eq!(slow.clip_at(last.start), Some(slow.clips.len() - 1));
        assert_eq!(slow.clip_at(slow.process_seconds), None);
        assert_eq!(slow.display_at_source(600.0), slow.clips[1].end);
    }

    #[test]
    fn repeated_checkpoints_collapse_but_metric_and_subflow_changes_survive() {
        let fixture = Fixture::new();
        let mut manifest: serde_json::Value =
            read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
        let baseline: serde_json::Value =
            read(&fixture.0.join("attempts/a/frames/0.json")).unwrap();
        for i in 1..3 {
            let mut delta = baseline.clone();
            delta["sequence"] = json!(i);
            fixture.write(&format!("attempts/a/frames/{i}.json"), delta);
            manifest["frames"][i]["checkpoint"] = json!(true);
        }
        fixture.write("attempts/a/manifest.json", manifest.clone());
        let same = StepPlan::build(&fixture.open(), 0).unwrap();
        assert_eq!(same.clips.len(), 1);
        assert_eq!(same.display_at_source(1.0), same.display_at_source(2.0));
        manifest["frames"][1]["metrics"] = json!({"overflow": 0.1});
        manifest["frames"][2]["metrics"] = json!({"overflow": 0.1});
        manifest["frames"][2]["subflow"] = json!("analysis");
        fixture.write("attempts/a/manifest.json", manifest);
        let changed = StepPlan::build(&fixture.open(), 0).unwrap();
        assert_eq!(
            changed
                .clips
                .iter()
                .map(|clip| (clip.frame, clip.kind))
                .collect::<Vec<_>>(),
            vec![(0, Kind::Reveal), (1, Kind::Hold), (2, Kind::Hold)]
        );
    }

    #[test]
    fn dense_motion_keeps_each_captured_transition_legible() {
        let frames = (0..100)
            .map(|i| {
                serde_json::from_value(json!({
            "sequence":i,"elapsed_ns":i,"phase":"pre_optimizer_step",
            "subflow":"placement","state_domain":"algorithm_state","path":"x","checkpoint":false
        })).unwrap()
            })
            .collect::<Vec<Frame>>();
        let clips = (0..100)
            .map(|i| Clip {
                frame: i,
                start: 0.0,
                end: 0.3,
                kind: Kind::Motion,
            })
            .collect();
        let plan = StepPlan::assemble(clips, &frames, 0, "a".into());
        assert_eq!(plan.clips.len(), 100);
        assert!((plan.process_seconds - 30.0).abs() < 1e-9);
        assert_eq!(plan.frame_at_source(0.000000099), Some(99));
    }

    #[test]
    fn deletion_and_layer_only_changes_are_visible() {
        let fixture = Fixture::new();
        fixture.write(
            "attempts/a/frames/1.json",
            json!({
                "sequence":1,"base_revision":0,"checkpoint":false,
                "upsert":{},"remove":["inst:a"],"touched":[]
            }),
        );
        let plan = StepPlan::build(&fixture.open(), 0).unwrap();
        assert_eq!(plan.clips[1].kind, Kind::Reveal);
        fixture.write(
            "attempts/a/frames/1.json",
            json!({
                "sequence":1,"base_revision":0,"checkpoint":false,
                "upsert":{"inst:a":{"kind":"instance","bbox":[0,0,5,5],"layer":"2"}},
                "remove":[],"touched":["inst:a"]
            }),
        );
        let plan = StepPlan::build(&fixture.open(), 0).unwrap();
        assert_eq!(plan.clips[1].kind, Kind::Reveal);
    }
}
