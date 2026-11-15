//! Display-only translation between captured Place samples. Never mutates Scene.
use chipgeom_format::replay::{Frame, Scene};
use std::collections::BTreeMap;

const TRANSITION_SECONDS: f64 = 0.3;

#[derive(Default)]
pub struct Motion {
    starts: BTreeMap<String, [i64; 4]>,
    elapsed: f64,
}

impl Motion {
    pub fn clear(&mut self) {
        self.starts.clear();
        self.elapsed = 0.0;
    }

    pub fn active(&self) -> bool {
        !self.starts.is_empty()
    }

    pub fn advance(&mut self, seconds: f64) {
        self.elapsed += seconds;
        if self.elapsed >= TRANSITION_SECONDS {
            self.clear();
        }
    }

    pub fn begin(&mut self, before: &Scene, after: &Scene, frames: &[Frame]) {
        self.clear();
        let (Some(a), Some(b)) = (before.revision, after.revision) else {
            return;
        };
        if b != a + 1 {
            return;
        }
        let (a, b) = (&frames[a], &frames[b]);
        // Legalization, rollback, commits and phase boundaries remain exact.
        // Only adjacent optimizer samples describe the same continuous phase.
        if a.phase != "pre_optimizer_step"
            || b.phase != a.phase
            || a.subflow != b.subflow
            || a.state_domain != "algorithm_state"
            || b.state_domain != a.state_domain
        {
            return;
        }
        for (id, new) in &after.objects {
            let Some(old) = before.objects.get(id) else {
                continue;
            };
            if matches!(new.kind.as_str(), "instance" | "macro")
                && old.kind == new.kind
                && old.master == new.master
                && old.orient == new.orient
                && old.bbox != new.bbox
                && old.bbox[2] - old.bbox[0] == new.bbox[2] - new.bbox[0]
                && old.bbox[3] - old.bbox[1] == new.bbox[3] - new.bbox[1]
            {
                self.starts.insert(id.clone(), old.bbox);
            }
        }
    }

    pub fn bounds(&self, id: &str, target: [i64; 4]) -> [i64; 4] {
        let Some(start) = self.starts.get(id) else {
            return target;
        };
        let t = (self.elapsed / TRANSITION_SECONDS).clamp(0.0, 1.0);
        let t = t * t * (3.0 - 2.0 * t);
        std::array::from_fn(|i| {
            (start[i] as f64 + (target[i] as f64 - start[i] as f64) * t).round() as i64
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (Scene, Scene, Vec<Frame>) {
        let old = serde_json::from_value(json!({
            "kind":"instance", "bbox":[0,0,10,10], "master":"INV", "orient":"N"
        }))
        .unwrap();
        let new = serde_json::from_value(json!({
            "kind":"instance", "bbox":[100,40,110,50], "master":"INV", "orient":"N"
        }))
        .unwrap();
        let before = Scene {
            objects: BTreeMap::from([("inst:a".into(), old)]),
            revision: Some(0),
            ..Default::default()
        };
        let after = Scene {
            objects: BTreeMap::from([("inst:a".into(), new)]),
            revision: Some(1),
            ..Default::default()
        };
        let frames = (0..2).map(|i| serde_json::from_value(json!({
            "sequence":i,"elapsed_ns":i*100_000_000,"phase":"pre_optimizer_step",
            "subflow":"run placement","state_domain":"algorithm_state","path":"frame.json","checkpoint":i==0
        })).unwrap()).collect();
        (before, after, frames)
    }

    #[test]
    fn smooth_translation_preserves_samples_and_lands_exactly() {
        let (before, after, frames) = fixture();
        let original = after.clone();
        let target = after.objects["inst:a"].bbox;
        let mut motion = Motion::default();
        motion.begin(&before, &after, &frames);
        assert_eq!(
            motion.bounds("inst:a", target),
            before.objects["inst:a"].bbox
        );
        motion.advance(TRANSITION_SECONDS / 2.0);
        assert_eq!(motion.bounds("inst:a", target), [50, 20, 60, 30]);
        motion.advance(TRANSITION_SECONDS / 2.0);
        assert_eq!(motion.bounds("inst:a", target), target);
        assert!(!motion.active());
        assert_eq!(after, original);
    }

    #[test]
    fn seek_pause_and_structural_changes_never_interpolate() {
        let (before, mut after, mut frames) = fixture();
        let target = after.objects["inst:a"].bbox;
        let mut motion = Motion::default();
        motion.begin(&before, &after, &frames);
        motion.clear();
        assert_eq!(motion.bounds("inst:a", target), target);
        after.objects.get_mut("inst:a").unwrap().master = "BUF".into();
        motion.begin(&before, &after, &frames);
        assert!(!motion.active());
        after.objects.get_mut("inst:a").unwrap().master = "INV".into();
        frames[1].phase = "after_legalization".into();
        motion.begin(&before, &after, &frames);
        assert!(!motion.active());
        frames[1].phase = "pre_optimizer_step".into();
        motion.begin(&after, &before, &frames);
        assert!(!motion.active());
    }
}
