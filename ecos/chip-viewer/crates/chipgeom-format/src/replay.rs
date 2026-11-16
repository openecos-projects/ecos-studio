//! Versioned, sampled physical-bounds replay contract. No synthetic frames.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const SCHEMA: &str = "ecos.replay.v1";
pub const SCHEMA_V2: &str = "ecos.replay.v2";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum Orientation {
    Code(i64),
    Name(String),
}

#[derive(Clone, Debug, Serialize, PartialEq)]
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
    #[serde(flatten)]
    pub attributes: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Frame {
    pub sequence: usize,
    pub elapsed_ns: u64,
    pub phase: String,
    pub subflow: String,
    pub state_domain: String,
    pub path: String,
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub logical: Option<String>,
    pub checkpoint: bool,
    #[serde(default)]
    pub metrics: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Fingerprint {
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Manifest {
    pub schema: String,
    pub status: String,
    #[serde(default)]
    pub diagnostic_only: bool,
    #[serde(default)]
    pub flow_state: Option<String>,
    pub attempt_id: String,
    pub duration_ns: u64,
    pub frames: Vec<Frame>,
    #[serde(default)]
    pub maps: Option<String>,
    #[serde(default)]
    pub analysis: Option<String>,
    #[serde(default)]
    pub analysis_view_count: usize,
    #[serde(default)]
    pub geometry_detail: Option<String>,
    #[serde(default)]
    pub capabilities: serde_json::Value,
    #[serde(default)]
    pub clock_tree_manifest: Option<String>,
    #[serde(default)]
    pub started_at_unix_ns: Option<u64>,
    #[serde(default)]
    pub frozen_clock_tree: Option<String>,
    #[serde(default)]
    pub results_frozen: bool,
    #[serde(default)]
    pub result_checklist: Option<serde_json::Value>,
    #[serde(default)]
    pub result_metrics: Vec<serde_json::Value>,
    #[serde(default)]
    pub files: BTreeMap<String, Fingerprint>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Delta {
    pub sequence: usize,
    pub base_revision: i64,
    pub checkpoint: bool,
    #[serde(default)]
    pub base_checkpoint: Option<usize>,
    pub upsert: BTreeMap<String, Arc<Object>>,
    pub remove: Vec<String>,
    #[serde(default)]
    pub translate: BTreeMap<String, [i64; 2]>,
    pub touched: BTreeSet<String>,
    #[serde(default)]
    pub deleted: BTreeMap<String, Object>,
    #[serde(default)]
    pub restored: BTreeSet<String>,
}

#[derive(Clone, Default, Debug, PartialEq)]
pub struct Scene {
    pub objects: BTreeMap<String, Arc<Object>>,
    pub touched: BTreeSet<String>,
    pub revision: Option<usize>,
    pub deleted: BTreeMap<String, Object>,
    pub restored: BTreeSet<String>,
}

impl Scene {
    pub fn apply(&mut self, delta: Delta) -> Result<(), &'static str> {
        if delta.base_checkpoint.is_some() {
            return Err("Replay checkpoint base was not resolved");
        }
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
        if delta.checkpoint && !delta.translate.is_empty() {
            return Err("Checkpoint cannot contain translations");
        }
        let mut translated = Vec::new();
        for (id, [dx, dy]) in &delta.translate {
            if delta.upsert.contains_key(id) || delta.remove.contains(id) {
                return Err("Conflicting Replay translation");
            }
            let mut object = self
                .objects
                .get(id)
                .ok_or("Translation references absent object")?
                .as_ref()
                .clone();
            if !matches!(object.kind.as_str(), "instance" | "macro") {
                return Err("Only instances can be translated");
            }
            for axis in 0..4 {
                object.bbox[axis] = object.bbox[axis]
                    .checked_add(if axis % 2 == 0 { *dx } else { *dy })
                    .ok_or("Translation coordinate overflow")?;
            }
            if let Some(pins) = object
                .attributes
                .get_mut("pins")
                .and_then(serde_json::Value::as_object_mut)
            {
                for pin in pins.values_mut() {
                    for (axis, offset) in [*dx, *dy].into_iter().enumerate() {
                        let coordinate = pin["position"][axis]
                            .as_i64()
                            .ok_or("Invalid pin position")?;
                        pin["position"][axis] = coordinate
                            .checked_add(offset)
                            .ok_or("Pin translation overflow")?
                            .into();
                    }
                }
            }
            translated.push((id.clone(), Arc::new(object)));
        }
        if delta.checkpoint {
            // A checkpoint already owns a complete ordered map. Move it rather
            // than reinserting every object into another tree on each seek.
            self.objects = delta.upsert;
        } else {
            for key in delta.remove {
                self.objects.remove(&key);
            }
            self.objects.extend(delta.upsert);
        }
        self.objects.extend(translated);
        self.touched = delta.touched;
        self.deleted = delta.deleted;
        self.restored = delta.restored;
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
            base_checkpoint: None,
            upsert: BTreeMap::from([(
                "a".into(),
                Arc::new(Object {
                    kind: "instance".into(),
                    bbox: [x, 0, x + 10, 10],
                    name: "a".into(),
                    layer: String::new(),
                    master: String::new(),
                    orient: None,
                    attributes: BTreeMap::new(),
                }),
            )]),
            remove: vec![],
            translate: BTreeMap::new(),
            touched: BTreeSet::from(["a".into()]),
            deleted: BTreeMap::new(),
            restored: BTreeSet::new(),
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

#[cfg(test)]
mod translation_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn translated_instances_keep_pins_exact_and_invalid_batch_is_atomic() {
        let mut scene = Scene::default();
        let initial = json!({"sequence":0,"base_revision":-1,"checkpoint":true,
            "upsert":{"a":{"kind":"instance","bbox":[1,2,4,6],
                "pins":{"A":{"net":"n","position":[2,3]}}}},"remove":[],"touched":[]});
        scene
            .apply(serde_json::from_value(initial).unwrap())
            .unwrap();
        let move_by = json!({"sequence":1,"base_revision":0,"checkpoint":false,
            "upsert":{},"translate":{"a":[10,-2]},"remove":[],"touched":["a"]});
        scene
            .apply(serde_json::from_value(move_by).unwrap())
            .unwrap();
        assert_eq!(scene.objects["a"].bbox, [11, 0, 14, 4]);
        assert_eq!(
            scene.objects["a"].attributes["pins"]["A"],
            json!({"net":"n","position":[12,1]})
        );
        let before = scene.clone();
        let bad = json!({"sequence":2,"base_revision":1,"checkpoint":false,
            "upsert":{},"translate":{"a":[1,1],"absent":[1,1]},"remove":[],"touched":[]});
        assert!(scene.apply(serde_json::from_value(bad).unwrap()).is_err());
        assert_eq!(scene, before);
    }
}
