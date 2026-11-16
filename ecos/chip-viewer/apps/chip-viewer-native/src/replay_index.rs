//! Spatial index of the current revision, including swept motion bounds.
use crate::replay_motion::Motion;
use chipgeom_format::replay::{Object, Scene};
use rstar::{RTree, RTreeObject, AABB};
use std::sync::Arc;

struct Entry {
    id: String,
    object: Arc<Object>,
    envelope: AABB<[i64; 2]>,
}
impl RTreeObject for Entry {
    type Envelope = AABB<[i64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}
#[derive(Default)]
pub struct SceneIndex(RTree<Entry>);
impl SceneIndex {
    pub fn build(scene: &Scene, motion: &Motion) -> Self {
        Self(RTree::bulk_load(
            scene
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
                    Some(Entry {
                        id: id.clone(),
                        object: object.clone(),
                        envelope: AABB::from_corners(
                            [a[0].min(b[0]), a[1].min(b[1])],
                            [a[2].max(b[2]), a[3].max(b[3])],
                        ),
                    })
                })
                .collect(),
        ))
    }
    pub fn visible(&self, bounds: [i64; 4]) -> impl Iterator<Item = (&str, &Arc<Object>)> {
        self.0
            .locate_in_envelope_intersecting(AABB::from_corners(
                [bounds[0], bounds[1]],
                [bounds[2], bounds[3]],
            ))
            .map(|entry| (entry.id.as_str(), &entry.object))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
