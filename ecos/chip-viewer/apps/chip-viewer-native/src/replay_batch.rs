//! Retained static geometry and compact dynamic meshes for Replay's 2D canvas.
use crate::{replay_index::SceneIndex, replay_motion::Motion, replay_reveal::Reveal};
use chipgeom_format::replay::{Object, Scene};
use egui::{Color32, Mesh, Pos2, Rect};
use std::sync::Arc;

type Key = (Rect, [i64; 4], u32, Option<usize>);

#[derive(Default)]
pub struct CanvasCache {
    pub key: Option<Key>,
    pub base: Arc<Mesh>,
    pub highlights: Arc<Mesh>,
    pub dynamic: Vec<AnimatedObject>,
    pub ghosts: Arc<Mesh>,
    pub deleted: Arc<Mesh>,
    pub animation: crate::replay_gpu_animation::Animation,
    pub gpu_animated: bool,
}

pub struct AnimatedObject {
    pub id: String,
    pub object: Arc<Object>,
    pub touched: bool,
}

impl CanvasCache {
    pub fn prepare(
        &mut self,
        key: Key,
        scene: &Scene,
        index: &SceneIndex,
        motion: &Motion,
        reveal: &Reveal,
        viewport: [i64; 4],
        focused: bool,
        project: &impl Fn(i64, i64) -> Pos2,
        scale: f32,
    ) {
        let mut base = Mesh::default();
        let mut highlights = Mesh::default();
        // Resolve subpixel static vias as pixel coverage at full-chip scale.
        // Exact DBU geometry remains available when zoom/focus changes the key.
        let mut via_coverage = std::collections::HashMap::<(i32, i32), f32>::new();
        self.dynamic.clear();
        for (id, object) in index.visible(viewport) {
            if object.kind == "track_grid" && f32::from_bits(key.2) < 2.0 && !focused {
                continue;
            }
            let touched =
                matches!(object.kind.as_str(), "instance" | "macro") && scene.touched.contains(id);
            if motion.contains(id) || reveal.contains(id) {
                self.dynamic.push(AnimatedObject {
                    id: id.to_owned(),
                    object: object.clone(),
                    touched,
                });
            } else {
                if object.kind == "via" {
                    let [lx, ly, hx, hy] = object.bbox;
                    let bounds = Rect::from_two_pos(project(lx, ly), project(hx, hy));
                    if bounds.width() < 1.0 && bounds.height() < 1.0 {
                        let center = bounds.center();
                        *via_coverage
                            .entry((center.x.floor() as i32, center.y.floor() as i32))
                            .or_default() += bounds.area();
                        continue;
                    }
                }
                paint_object(
                    &mut base,
                    &mut highlights,
                    id,
                    object,
                    touched,
                    motion,
                    reveal,
                    project,
                    scale,
                    key.0,
                );
            }
        }
        // Accumulate in constant time, then keep deterministic mesh order.
        let mut via_pixels: Vec<_> = via_coverage.into_iter().collect();
        via_pixels.sort_unstable_by_key(|(pixel, _)| *pixel);
        for ((x, y), coverage) in via_pixels {
            base.add_colored_rect(
                Rect::from_min_size(Pos2::new(x as f32, y as f32), egui::Vec2::splat(1.0)),
                Color32::from_rgb(255, 211, 112).gamma_multiply(coverage.min(1.0)),
            );
        }
        let color = Color32::from_rgb(245, 121, 101);
        let mut ghosts = Mesh::default();
        for object in &reveal.ghosts {
            let [lx, ly, hx, hy] = object.bbox;
            let rect = Rect::from_two_pos(project(lx, ly), project(hx, hy));
            if rect.intersects(key.0) {
                outline(&mut ghosts, rect, 1.0, color, 1.0);
            }
        }
        let mut deleted = Mesh::default();
        for object in scene.deleted.values() {
            let [lx, ly, hx, hy] = object.bbox;
            let rect = Rect::from_two_pos(project(lx, ly), project(hx, hy));
            if rect.intersects(key.0) {
                outline(&mut deleted, rect, 1.2, color, 1.0);
                line(
                    &mut deleted,
                    rect.left_top(),
                    rect.right_bottom(),
                    1.2,
                    color,
                );
                line(
                    &mut deleted,
                    rect.left_bottom(),
                    rect.right_top(),
                    1.2,
                    color,
                );
            }
        }
        self.ghosts = Arc::new(ghosts);
        self.deleted = Arc::new(deleted);
        self.base = Arc::new(base);
        self.highlights = Arc::new(highlights);
        self.key = Some(key);
    }
}

pub fn paint_object(
    mesh: &mut Mesh,
    highlights: &mut Mesh,
    id: &str,
    object: &Object,
    touched: bool,
    motion: &Motion,
    reveal: &Reveal,
    project: &impl Fn(i64, i64) -> Pos2,
    scale: f32,
    viewport: Rect,
) {
    if object
        .attributes
        .get("placed")
        .and_then(serde_json::Value::as_bool)
        == Some(false)
    {
        return;
    }
    let fraction = reveal.fraction(id);
    if fraction <= 0.0 {
        return;
    }
    let [x1, y1, x2, y2] = motion.bounds(id, Reveal::bounds_at(object, fraction));
    let bounds = Rect::from_two_pos(project(x1, y1), project(x2, y2));
    if !bounds.intersects(viewport) {
        return;
    }
    let color = match object.kind.as_str() {
        "macro" => Color32::from_rgb(124, 151, 214),
        "pdn" => Color32::from_rgb(177, 143, 88),
        "wire" => layer_color(&object.layer),
        "via" => Color32::from_rgb(255, 211, 112),
        "pin" => Color32::from_rgb(112, 219, 198),
        "row" => Color32::from_rgb(36, 64, 54),
        "track_grid" => Color32::from_rgb(75, 89, 105),
        "die" => Color32::from_rgb(131, 193, 234),
        "core" => Color32::from_rgb(218, 175, 107),
        "access_point" => Color32::from_rgb(255, 190, 90),
        _ => Color32::from_rgb(70, 147, 129),
    }
    .gamma_multiply(fraction);
    if object.kind == "access_point" {
        mesh.add_colored_rect(
            Rect::from_center_size(project(x1, y1), egui::vec2(3.0, 3.0)),
            color,
        );
        return;
    }
    if matches!(object.kind.as_str(), "die" | "core") {
        outline(mesh, bounds, 1.5, color, fraction);
        return;
    }
    if let Some(segment) = object.attributes.get("segment") {
        let point = |key: &str| -> Option<Pos2> {
            let values = segment.get(key)?.as_array()?;
            Some(project(values.first()?.as_i64()?, values.get(1)?.as_i64()?))
        };
        if let (Some(begin), Some(end)) = (point("begin"), point("end")) {
            let width = segment["width"].as_f64().unwrap_or(0.0) as f32 * scale;
            line(mesh, begin, end, width.max(0.7), color);
            return;
        }
    }
    if !matches!(object.kind.as_str(), "row" | "halo") {
        mesh.add_colored_rect(bounds, color);
    }
    if touched && matches!(object.kind.as_str(), "instance" | "macro") {
        outline(
            highlights,
            bounds,
            1.2,
            Color32::from_rgb(255, 157, 185).gamma_multiply(fraction),
            1.0,
        );
    } else if matches!(object.kind.as_str(), "row" | "halo" | "instance" | "macro") {
        outline(mesh, bounds, 0.5, color, 1.0);
    }
}

fn line(mesh: &mut Mesh, start: Pos2, end: Pos2, width: f32, color: Color32) {
    if start == end {
        mesh.add_colored_rect(
            Rect::from_center_size(start, egui::vec2(width, width)),
            color,
        );
        return;
    }
    let normal = (end - start).normalized().rot90() * (width / 2.0);
    let base = mesh.vertices.len() as u32;
    for point in [start - normal, start + normal, end - normal, end + normal] {
        mesh.colored_vertex(point, color);
    }
    mesh.add_triangle(base, base + 1, base + 2);
    mesh.add_triangle(base + 1, base + 2, base + 3);
}

fn outline(mesh: &mut Mesh, rect: Rect, width: f32, color: Color32, fraction: f32) {
    if rect.width().min(rect.height()) <= width * 2.0 {
        mesh.add_colored_rect(rect, color);
        return;
    }
    let r = rect.shrink(width / 2.0);
    let corners = [
        r.left_top(),
        r.right_top(),
        r.right_bottom(),
        r.left_bottom(),
        r.left_top(),
    ];
    let mut remaining = 2.0 * (r.width() + r.height()) * fraction;
    for points in corners.windows(2) {
        let edge = points[1] - points[0];
        let length = edge.length();
        if remaining <= 0.0 {
            break;
        }
        line(
            mesh,
            points[0],
            points[0] + edge * (remaining / length.max(0.001)).min(1.0),
            width,
            color,
        );
        remaining -= length;
    }
}

fn layer_color(layer: &str) -> Color32 {
    const COLORS: [Color32; 6] = [
        Color32::from_rgb(73, 183, 217),
        Color32::from_rgb(239, 126, 101),
        Color32::from_rgb(144, 194, 104),
        Color32::from_rgb(204, 144, 220),
        Color32::from_rgb(232, 192, 93),
        Color32::from_rgb(93, 145, 232),
    ];
    let index = layer
        .parse::<usize>()
        .unwrap_or_else(|_| layer.bytes().map(usize::from).sum());
    COLORS[index % COLORS.len()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tiny_vias_accumulate_coverage_in_deterministic_pixel_order() {
        let scene = Scene {
            objects: serde_json::from_value(json!({
                "a":{"kind":"via","bbox":[10,10,12,12]},
                "b":{"kind":"via","bbox":[12,10,14,12]},
                "c":{"kind":"via","bbox":[25,10,27,12]}
            }))
            .unwrap(),
            ..Default::default()
        };
        let index = SceneIndex::build(&scene, &Motion::default());
        let rect = Rect::from_min_max(Pos2::ZERO, Pos2::new(100.0, 100.0));
        let mut cache = CanvasCache::default();
        for _ in 0..3 {
            cache.prepare(
                (rect, [0, 0, 100, 100], 1.0_f32.to_bits(), None),
                &scene,
                &index,
                &Motion::default(),
                &Reveal::default(),
                [0, 0, 100, 100],
                false,
                &|x, y| Pos2::new(x as f32 / 10.0, y as f32 / 10.0),
                0.1,
            );
            let mut expected = Mesh::default();
            let color = Color32::from_rgb(255, 211, 112);
            for (x, coverage) in [(1.0, 0.08), (2.0, 0.04)] {
                expected.add_colored_rect(
                    Rect::from_min_size(Pos2::new(x, 1.0), egui::Vec2::splat(1.0)),
                    color.gamma_multiply(coverage),
                );
            }
            assert_eq!(*cache.base, expected);
        }
    }

    #[test]
    fn retained_mesh_excludes_moving_objects_and_never_mutates_scene() {
        let before: Scene = Scene {
            objects: serde_json::from_value(json!({
                "die":{"kind":"die","bbox":[0,0,100,100]},
                "a":{"kind":"instance","bbox":[0,0,10,10]},
                "wire":{"kind":"wire","bbox":[0,40,100,45]}
            }))
            .unwrap(),
            revision: Some(0),
            ..Default::default()
        };
        let mut after = before.clone();
        Arc::make_mut(Arc::make_mut(&mut after.objects).get_mut("a").unwrap()).bbox =
            [20, 0, 30, 10];
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
        let reveal = Reveal::default();
        let index = SceneIndex::build(&after, &motion);
        let mut cache = CanvasCache::default();
        let rect = Rect::from_min_max(Pos2::ZERO, Pos2::new(100.0, 100.0));
        let key = (rect, [0, 0, 100, 100], 1.0_f32.to_bits(), Some(1));
        cache.prepare(
            key,
            &after,
            &index,
            &motion,
            &reveal,
            [0, 0, 100, 100],
            false,
            &|x, y| Pos2::new(x as f32, y as f32),
            1.0,
        );
        assert_eq!(
            cache
                .dynamic
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a"]
        );
        assert!(Arc::ptr_eq(&cache.dynamic[0].object, &after.objects["a"]));
        assert!(cache.base.is_valid() && !cache.base.is_empty());
        assert_eq!(before.objects["a"].bbox, [0, 0, 10, 10]);
        assert_eq!(after.objects["a"].bbox, [20, 0, 30, 10]);
        let mut mesh = Mesh::default();
        line(&mut mesh, Pos2::ZERO, Pos2::ZERO, 1.0, Color32::WHITE);
        assert!(mesh.vertices.iter().all(|v| v.pos.is_finite()));
    }
}
