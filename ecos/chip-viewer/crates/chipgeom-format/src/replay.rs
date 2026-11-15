//! Versioned, sampled physical-bounds replay contract. No synthetic frames.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const SCHEMA: &str = "ecos.replay.v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum Orientation {
    Code(i64),
    Name(String),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Object {
    pub kind: String,
    pub bbox: [i64; 4],
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub layer: String,
    #[serde(default)]
    pub master: String,
    #[serde(default)]
    pub orient: Option<Orientation>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Frame {
    pub sequence: usize,
    pub elapsed_ns: u64,
    pub phase: String,
    pub subflow: String,
    pub state_domain: String,
    pub path: String,
    pub checkpoint: bool,
    #[serde(default)]
    pub metrics: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Manifest {
    pub schema: String,
    pub status: String,
    pub attempt_id: String,
    pub duration_ns: u64,
    pub frames: Vec<Frame>,
    #[serde(default)]
    pub maps: Option<String>,
    #[serde(default)]
    pub geometry_detail: Option<String>,
    #[serde(default)]
    pub clock_tree_manifest: Option<String>,
    #[serde(default)]
    pub started_at_unix_ns: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct Delta {
    pub sequence: usize,
    pub base_revision: i64,
    pub checkpoint: bool,
    pub upsert: BTreeMap<String, Object>,
    pub remove: Vec<String>,
    pub touched: BTreeSet<String>,
}

#[derive(Clone, Default, Debug, PartialEq)]
pub struct Scene {
    pub objects: BTreeMap<String, Object>,
    pub touched: BTreeSet<String>,
    pub revision: Option<usize>,
}

impl Scene {
    pub fn apply(&mut self, delta: Delta) -> Result<(), &'static str> {
        if !delta.checkpoint && self.revision.map(|n| n as i64) != Some(delta.base_revision) {
            return Err("Replay revision gap");
        }
        if delta
            .upsert
            .values()
            .any(|o| o.bbox[2] < o.bbox[0] || o.bbox[3] < o.bbox[1])
        {
            return Err("Invalid Replay bounds");
        }
        if delta.checkpoint {
            self.objects.clear();
        }
        for key in delta.remove {
            self.objects.remove(&key);
        }
        self.objects.extend(delta.upsert);
        self.touched = delta.touched;
        self.revision = Some(delta.sequence);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn delta(sequence: usize, checkpoint: bool, x: i64) -> Delta {
        Delta {
            sequence,
            base_revision: sequence as i64 - 1,
            checkpoint,
            upsert: BTreeMap::from([(
                "a".into(),
                Object {
                    kind: "instance".into(),
                    bbox: [x, 0, x + 10, 10],
                    name: "a".into(),
                    layer: String::new(),
                    master: String::new(),
                    orient: None,
                },
            )]),
            remove: vec![],
            touched: BTreeSet::from(["a".into()]),
        }
    }
    #[test]
    fn replay_accepts_native_and_named_orientation_metadata() {
        for (value, expected) in [
            (serde_json::json!(1), Some(Orientation::Code(1))),
            (serde_json::json!("N"), Some(Orientation::Name("N".into()))),
            (serde_json::Value::Null, None),
        ] {
            let object: Object = serde_json::from_value(serde_json::json!({
                "kind":"instance", "bbox":[0,0,10,10], "orient":value
            }))
            .unwrap();
            assert_eq!(object.orient, expected);
        }
    }

    #[test]
    fn restore_checkpoint_replaces_future_state_and_highlights() {
        let mut scene = Scene::default();
        scene.apply(delta(0, true, 0)).unwrap();
        let initial = scene.clone();
        scene.apply(delta(1, false, 20)).unwrap();
        assert_ne!(scene, initial);
        scene.apply(delta(0, true, 0)).unwrap();
        assert_eq!(scene, initial);
        assert!(scene.apply(delta(3, false, 30)).is_err());
        assert_eq!(scene, initial);
    }
}
