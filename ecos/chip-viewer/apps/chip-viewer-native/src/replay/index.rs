//! Spatial index of the current revision, including swept motion bounds.
use crate::replay::motion::Motion;
use chipgeom_format::replay::{Object, Scene};
use rstar::{RTree, RTreeObject, AABB};
use std::sync::Arc;

struct Entry {
    id: String,
    object: Arc<Object>,
}
// RTree bulk loading repeatedly sorts/moves entries. Keep names and object
// references stationary; only compact bounds and slots participate in sorting.
struct Bounds {
    slot: usize,
    envelope: AABB<[i64; 2]>,
}
impl RTreeObject for Bounds {
    type Envelope = AABB<[i64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}
#[derive(Default)]
pub struct SceneIndex {
    entries: Vec<Entry>,
    tree: RTree<Bounds>,
}
impl SceneIndex {
    pub fn build(scene: &Scene, motion: &Motion) -> Self {
        let mut entries = Vec::with_capacity(scene.objects.len());
        let bounds = scene
            .objects
            .iter()
            .filter_map(|(id, object)| {
                if object
                    .attributes
                    .get("placed")
                    .and_then(serde_json::Value::as_bool)
                    == Some(false)
                {
                    return None;
                }
                let a = object.bbox;
                let b = motion.bounds(id, a);
                let slot = entries.len();
                entries.push(Entry {
                    id: id.clone(),
                    object: object.clone(),
                });
                Some(Bounds {
                    slot,
                    envelope: AABB::from_corners(
                        [a[0].min(b[0]), a[1].min(b[1])],
                        [a[2].max(b[2]), a[3].max(b[3])],
                    ),
                })
            })
            .collect();
        Self {
            entries,
            tree: RTree::bulk_load(bounds),
        }
    }
    pub fn visible(&self, bounds: [i64; 4]) -> impl Iterator<Item = (&str, &Arc<Object>)> {
        self.tree
            .locate_in_envelope_intersecting(AABB::from_corners(
                [bounds[0], bounds[1]],
                [bounds[2], bounds[3]],
            ))
            .map(|bounds| {
                let entry = &self.entries[bounds.slot];
                (entry.id.as_str(), &entry.object)
            })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn compact_slots_keep_objects_and_swept_bounds_after_tree_partitioning() {
        let mut objects = std::collections::BTreeMap::new();
        for i in 0..33 {
            let x = if i == 0 { 0 } else { 1000 + i * 50 };
            objects.insert(
                format!("cell:{i}"),
                serde_json::from_value(json!({
                    "kind":"instance","bbox":[x,0,x+10,10]
                }))
                .unwrap(),
            );
        }
        let before = Scene {
            objects: objects.into(),
            revision: Some(0),
            ..Default::default()
        };
        let mut after = before.clone();
        Arc::make_mut(Arc::make_mut(&mut after.objects).get_mut("cell:0").unwrap()).bbox =
            [100, 0, 110, 10];
        after.revision = Some(1);
        let frames = (0..2)
            .map(|i| {
                serde_json::from_value(json!({
                    "sequence":i,"elapsed_ns":i,"phase":"pre_optimizer_step","subflow":"place",
                    "state_domain":"algorithm_state","path":"f","checkpoint":false
                }))
                .unwrap()
            })
            .collect::<Vec<_>>();
        let mut motion = Motion::default();
        motion.begin(&before, &after, &frames);
        let index = SceneIndex::build(&after, &motion);
        assert_eq!(
            index
                .visible([50, 0, 60, 10])
                .map(|(id, _)| id)
                .collect::<Vec<_>>(),
            vec!["cell:0"]
        );
        for i in 1..33 {
            let x = 1000 + i * 50;
            let visible = index.visible([x, 0, x + 10, 10]).collect::<Vec<_>>();
            assert_eq!(visible.len(), 1);
            assert_eq!(visible[0].0, format!("cell:{i}"));
            assert!(Arc::ptr_eq(visible[0].1, &after.objects[visible[0].0]));
        }
    }

    #[test]
    fn viewport_query_excludes_offscreen_and_unplaced_objects() {
        let scene = Scene {
            objects: serde_json::from_value(json!({
                "visible":{"kind":"instance","bbox":[0,0,10,10]},
                "offscreen":{"kind":"instance","bbox":[100,100,110,110]},
                "unplaced":{"kind":"instance","bbox":[0,0,10,10],"placed":false}
            }))
            .unwrap(),
            ..Default::default()
        };
        let index = SceneIndex::build(&scene, &Motion::default());
        assert_eq!(
            index
                .visible([2, 2, 8, 8])
                .map(|(id, _)| id)
                .collect::<Vec<_>>(),
            vec!["visible"]
        );
    }
}
