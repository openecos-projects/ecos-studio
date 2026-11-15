//! Staged display of a captured Floorplan batch, not per-object EDA timestamps.
use chipgeom_format::replay::{Frame, Object, Scene};
use std::collections::BTreeMap;

struct Entry {
    start: f64,
    from: Option<[i64; 4]>,
}

#[derive(Default)]
pub struct Reveal {
    entries: BTreeMap<String, Entry>,
    groups: Vec<(f64, String)>,
    elapsed: f64,
    duration: f64,
}

impl Reveal {
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn active(&self) -> bool {
        self.elapsed < self.duration
    }
    pub fn advance(&mut self, seconds: f64) {
        self.elapsed += seconds;
        if self.elapsed >= self.duration {
            self.clear();
        }
    }
    pub fn label(&self) -> &str {
        self.groups
            .iter()
            .rev()
            .find(|(time, _)| *time <= self.elapsed)
            .map_or("", |(_, name)| name.as_str())
    }

    pub fn begin(&mut self, before: &Scene, after: &Scene, frames: &[Frame]) {
        self.clear();
        let (Some(a), Some(b)) = (before.revision, after.revision) else {
            return;
        };
        if b != a + 1 || frames[b].state_domain != "algorithm_state" {
            return;
        }
        let mut groups: BTreeMap<(u8, u32, String), Vec<(&String, &Object)>> = BTreeMap::new();
        for (id, object) in &after.objects {
            if before
                .objects
                .get(id)
                .is_some_and(|old| old.bbox == object.bbox)
            {
                continue;
            }
            let Some(key) = group(object) else {
                continue;
            };
            groups.entry(key).or_default().push((id, object));
        }
        for ((_, _, name), mut objects) in groups {
            // A deterministic left-to-right presentation within each type/layer.
            objects.sort_by_key(|(id, object)| (object.bbox[0], object.bbox[1], *id));
            let start = self.duration;
            self.groups.push((start, name));
            let count = objects.len();
            for (i, (id, object)) in objects.into_iter().enumerate() {
                let from = before
                    .objects
                    .get(id)
                    .filter(|old| {
                        old.kind == object.kind
                            && old.master == object.master
                            && old.orient == object.orient
                    })
                    .map(|old| old.bbox);
                self.entries.insert(
                    id.clone(),
                    Entry {
                        start: start
                            + if count > 1 {
                                0.7 * i as f64 / (count - 1) as f64
                            } else {
                                0.0
                            },
                        from,
                    },
                );
            }
            self.duration += if count > 1 { 1.1 } else { 0.6 };
        }
    }

    pub fn fraction(&self, id: &str) -> f32 {
        self.entries.get(id).map_or(1.0, |entry| {
            let t = ((self.elapsed - entry.start) / 0.4).clamp(0.0, 1.0);
            (t * t * (3.0 - 2.0 * t)) as f32
        })
    }

    pub fn bounds(&self, id: &str, object: &Object) -> [i64; 4] {
        let Some(entry) = self.entries.get(id) else {
            return object.bbox;
        };
        let t = self.fraction(id) as f64;
        if let Some(from) = entry.from {
            return std::array::from_fn(|i| {
                (from[i] as f64 + (object.bbox[i] - from[i]) as f64 * t).round() as i64
            });
        }
        let mut bounds = object.bbox;
        if matches!(object.kind.as_str(), "pdn" | "row" | "track_grid") {
            let axis = if bounds[2] - bounds[0] >= bounds[3] - bounds[1] {
                0
            } else {
                1
            };
            bounds[axis + 2] =
                bounds[axis] + ((bounds[axis + 2] - bounds[axis]) as f64 * t).round() as i64;
        }
        bounds
    }
}

fn group(object: &Object) -> Option<(u8, u32, String)> {
    let (rank, name) = match object.kind.as_str() {
        "die" => (0, "Die boundary".into()),
        "core" => (1, "Core boundary".into()),
        "row" => (2, "Placement rows".into()),
        "track_grid" => (3, "Routing tracks".into()),
        "pin" => (4, "IO pins".into()),
        "halo" => (5, "Macro halos".into()),
        "instance" | "macro" => (6, format!("Cells · {}", object.master)),
        "pdn" => (
            7,
            if object.layer.is_empty() {
                "PDN · connections".into()
            } else {
                format!("PDN · {}", object.layer)
            },
        ),
        _ => return None,
    };
    let layer = if object.kind == "pdn" {
        object
            .layer
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>()
            .parse()
            .unwrap_or(u32::MAX)
    } else {
        0
    };
    Some((rank, layer, name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn layers_types_and_positions_define_progressive_reveal_without_changing_scene() {
        let objects = serde_json::from_value(json!({
            "m10":{"kind":"pdn","layer":"MET10","bbox":[0,0,100,5]},
            "m2":{"kind":"pdn","layer":"MET2","bbox":[0,10,100,15]},
            "right":{"kind":"instance","master":"TAP","bbox":[90,0,100,10]},
            "left":{"kind":"instance","master":"TAP","bbox":[0,0,10,10]}
        }))
        .unwrap();
        let before = Scene {
            revision: Some(0),
            ..Default::default()
        };
        let after = Scene {
            objects,
            revision: Some(1),
            ..Default::default()
        };
        let original = after.clone();
        let frames: Vec<Frame> = (0..2)
            .map(|i| {
                serde_json::from_value(json!({
                    "sequence":i,"elapsed_ns":i,"phase":"stripes","subflow":"PDN",
                    "state_domain":"algorithm_state","path":"x","checkpoint":false
                }))
                .unwrap()
            })
            .collect();
        let mut reveal = Reveal::default();
        reveal.begin(&before, &after, &frames);
        reveal.advance(0.4);
        assert_eq!(reveal.fraction("left"), 1.0);
        assert_eq!(reveal.fraction("right"), 0.0);
        assert_eq!(reveal.fraction("m2"), 0.0);
        reveal.advance(0.9);
        assert_eq!(reveal.label(), "PDN · MET2");
        assert!(reveal.bounds("m2", &after.objects["m2"])[2] > 0);
        assert_eq!(reveal.fraction("m10"), 0.0);
        reveal.clear();
        assert_eq!(
            reveal.bounds("m10", &after.objects["m10"]),
            after.objects["m10"].bbox
        );
        assert_eq!(after, original);
    }
}
