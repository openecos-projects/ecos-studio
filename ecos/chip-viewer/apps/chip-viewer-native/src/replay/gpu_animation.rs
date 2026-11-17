//! Compile a display transition once. The GPU varies only its progress uniform;
//! exact captured objects and the software rendering path remain unchanged.
use crate::{
    replay::batch::{paint_object, AnimatedObject},
    replay::motion::Motion,
    replay::reveal::Reveal,
};
use egui::{Mesh, Pos2, Rect};
use std::sync::Arc;

#[repr(C)]
#[derive(Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct VertexMotion {
    pub offset: [f32; 2],
    pub start: f32,
    /// Negative means a continuous move; positive is a reveal interval.
    pub duration: f32,
}

#[derive(Default)]
pub struct AnimatedMesh {
    pub mesh: Arc<Mesh>,
    pub motion: Arc<Vec<VertexMotion>>,
}

#[derive(Default)]
pub struct Animation {
    pub geometry: AnimatedMesh,
    pub highlights: AnimatedMesh,
}

pub fn supported(object: &chipgeom_format::replay::Object) -> bool {
    !matches!(object.kind.as_str(), "die" | "core")
}

impl Animation {
    pub fn build(
        objects: &[AnimatedObject],
        motion: &Motion,
        reveal: &Reveal,
        project: &impl Fn(i64, i64) -> Pos2,
        scale: f32,
        viewport: Rect,
    ) -> Self {
        let mut geometry = Mesh::default();
        let mut highlights = Mesh::default();
        let mut geometry_motion = Vec::new();
        let mut highlight_motion = Vec::new();
        let still = Motion::default();
        let shown = Reveal::default();
        for item in objects.iter().filter(|item| supported(&item.object)) {
            let first = geometry.vertices.len();
            let first_highlight = highlights.vertices.len();
            paint_object(
                &mut geometry,
                &mut highlights,
                &item.id,
                &item.object,
                item.touched,
                &still,
                &shown,
                project,
                scale,
                viewport,
            );
            let bounds = item.object.bbox;
            let target =
                Rect::from_two_pos(project(bounds[0], bounds[1]), project(bounds[2], bounds[3]));
            let movement = motion
                .start_bounds(&item.id)
                .map(|start| project(start[0], start[1]) - project(bounds[0], bounds[1]));
            let timing = reveal.interval(&item.id);
            let initial = Reveal::bounds_at(&item.object, 0.0);
            let initial = Rect::from_two_pos(
                project(initial[0], initial[1]),
                project(initial[2], initial[3]),
            );
            let vertex = |pos: Pos2| {
                if let Some(offset) = movement {
                    return VertexMotion {
                        offset: [offset.x, offset.y],
                        start: 0.0,
                        duration: -1.0,
                    };
                }
                if let Some((start, duration)) = timing {
                    let relative = pos - target.min;
                    let from = initial.min
                        + egui::vec2(
                            relative.x * initial.width() / target.width().max(f32::EPSILON),
                            relative.y * initial.height() / target.height().max(f32::EPSILON),
                        );
                    return VertexMotion {
                        offset: [from.x - pos.x, from.y - pos.y],
                        start,
                        duration,
                    };
                }
                VertexMotion::default()
            };
            geometry_motion.extend(geometry.vertices[first..].iter().map(|v| vertex(v.pos)));
            highlight_motion.extend(
                highlights.vertices[first_highlight..]
                    .iter()
                    .map(|v| vertex(v.pos)),
            );
        }
        Self {
            geometry: AnimatedMesh {
                mesh: Arc::new(geometry),
                motion: Arc::new(geometry_motion),
            },
            highlights: AnimatedMesh {
                mesh: Arc::new(highlights),
                motion: Arc::new(highlight_motion),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chipgeom_format::replay::{Frame, Scene};
    use serde_json::json;

    #[test]
    fn compiled_motion_preserves_final_vertices_and_matches_captured_displacement() {
        let object =
            |x| serde_json::from_value(json!({"kind":"instance", "bbox":[x,0,x+10,10]})).unwrap();
        let before = Scene {
            objects: std::collections::BTreeMap::from([("cell".into(), object(0))]).into(),
            revision: Some(0),
            ..Default::default()
        };
        let after = Scene {
            objects: std::collections::BTreeMap::from([("cell".into(), object(20))]).into(),
            revision: Some(1),
            ..Default::default()
        };
        let frames: Vec<Frame> = (0..2)
            .map(|i| {
                serde_json::from_value(json!({
                    "sequence":i,"elapsed_ns":i,"phase":"pre_optimizer_step","subflow":"place",
                    "state_domain":"algorithm_state","path":"f","checkpoint":i==0
                }))
                .unwrap()
            })
            .collect();
        let mut motion = Motion::default();
        motion.begin(&before, &after, &frames);
        let objects = vec![AnimatedObject {
            id: "cell".into(),
            object: after.objects["cell"].clone(),
            touched: true,
        }];
        let project = |x, y| Pos2::new(x as f32, y as f32);
        let animation = Animation::build(
            &objects,
            &motion,
            &Reveal::default(),
            &project,
            1.0,
            Rect::EVERYTHING,
        );
        for mesh in [&animation.geometry, &animation.highlights] {
            assert!(!mesh.mesh.is_empty());
            assert_eq!(mesh.motion.len(), mesh.mesh.vertices.len());
            for data in mesh.motion.iter() {
                assert_eq!(data.offset, [-20.0, 0.0]);
                assert_eq!(data.duration, -1.0);
            }
        }
        let final_vertices = animation.geometry.mesh.vertices.clone();
        motion.set_progress(0.5);
        assert_eq!(
            motion.bounds("cell", after.objects["cell"].bbox),
            [10, 0, 20, 10]
        );
        assert_eq!(animation.geometry.mesh.vertices, final_vertices);
        assert_eq!(after.objects["cell"].bbox, [20, 0, 30, 10]);
    }
}
