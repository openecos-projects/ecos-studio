//! Animate recorded routed geometry. Cell arcs use cell/pin highlights, never flylines.
use crate::timing_route::{Resolver, Route};
use chipgeom_format::replay_analysis::{Analysis, Item};
use egui::{Align2, Color32, FontId, Pos2, Rect, Stroke};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const CORNER_SECONDS: f64 = 6.0;
const DRAW_FRACTION: f32 = 0.75;

#[derive(Default)]
pub struct Labels {
    occupied: Vec<Rect>,
    shown: BTreeSet<(i32, i32, String)>,
}

#[derive(Default)]
pub struct TimingPath {
    pub points: Vec<Option<[i64; 2]>>,
    stages: Vec<Stage>,
    pub routed: usize,
    pub unresolved: usize,
}
struct Stage {
    route: Option<Arc<Route>>,
    cell: Option<[i64; 4]>,
    delay: Option<f64>,
}

/// Old captures split setup and hold; regroup by the source file/corner in memory.
/// Unknown labels remain separate, never merge unrelated sources by a guessed prefix.
pub fn group_corners(data: &mut Analysis) {
    let mut groups = BTreeMap::<String, usize>::new();
    let mut result: Vec<chipgeom_format::replay_analysis::View> = Vec::new();
    for mut view in data.views.drain(..) {
        if view.kind != "timing" {
            result.push(view);
            continue;
        }
        let corner = view.summary["corner"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                view.label
                    .rsplit_once(" · ")
                    .filter(|(_, kind)| matches!(*kind, "setup" | "hold"))
                    .map_or_else(|| view.label.clone(), |(corner, _)| corner.to_owned())
            });
        if let Some(&index) = groups.get(&corner) {
            result[index].items.append(&mut view.items);
        } else {
            groups.insert(corner.clone(), result.len());
            view.label = corner.clone();
            view.summary["corner"] = corner.into();
            result.push(view);
        }
    }
    for view in &mut result {
        if view.kind == "timing" {
            view.items.sort_by(|a, b| {
                let order = |i: &Item| {
                    if i.details["analysis_type"] == "setup" {
                        0
                    } else {
                        1
                    }
                };
                order(a).cmp(&order(b)).then_with(|| {
                    a.value
                        .unwrap_or(f64::INFINITY)
                        .total_cmp(&b.value.unwrap_or(f64::INFINITY))
                })
            });
            view.summary["reported_paths"] = view.items.len().into();
            view.summary["playback"] = "All setup/hold paths in this corner play together".into();
        }
    }
    data.views = result;
}

pub fn lookup_pin(name: &str, pins: &BTreeMap<String, [i64; 2]>) -> Option<[i64; 2]> {
    pins.get(name).copied().or_else(|| {
        name.rsplit_once(':')
            .and_then(|(instance, pin)| pins.get(&format!("{instance}/{pin}")).copied())
    })
}

impl TimingPath {
    pub fn resolve(item: &Item, resolver: &mut Resolver) -> Self {
        let mut path = Self::default();
        let Some(stages) = item.details["stages"].as_array() else {
            path.unresolved = 1;
            return path;
        };
        let start = item.details["start_point"].as_str();
        let first = stages
            .iter()
            .position(|s| s["pin"].as_str() == start)
            .unwrap_or(0);
        let stages = &stages[first..];
        let endpoint = |s: &serde_json::Value| -> (String, String) {
            (
                s["pin"].as_str().unwrap_or_default().to_owned(),
                s["instance"].as_str().unwrap_or_default().to_owned(),
            )
        };
        for (i, s) in stages.iter().enumerate() {
            let (pin, instance) = endpoint(s);
            let geometry = resolver.pin(&pin, &instance);
            path.points.push(geometry.center);
            if i == 0 {
                continue;
            }
            let mut stage = Stage {
                route: None,
                cell: None,
                delay: s["incremental_delay_ns"].as_f64().filter(|v| v.is_finite()),
            };
            let (previous, previous_instance) = endpoint(&stages[i - 1]);
            match s["kind"].as_str() {
                Some("net_arc") => {
                    stage.route =
                        resolver.route((&previous, &previous_instance), (&pin, &instance));
                    if stage.route.is_some() {
                        path.routed += 1;
                    } else {
                        path.unresolved += 1;
                    }
                }
                Some("cell_arc") if !instance.is_empty() && instance == previous_instance => {
                    // No cell-internal route is in the report. Mark its real pin area only.
                    stage.cell = geometry.bbox;
                    if stage.cell.is_none() {
                        path.unresolved += 1;
                    }
                }
                _ => {
                    path.unresolved += 1;
                }
            }
            path.stages.push(stage);
        }
        path
    }

    #[cfg(test)]
    pub fn routed_strokes(&self) -> impl Iterator<Item = &crate::timing_route::Stroke> {
        self.stages
            .iter()
            .filter_map(|s| s.route.as_ref())
            .flat_map(|r| &r.strokes)
    }

    pub fn paint(
        &self,
        painter: &egui::Painter,
        project: &impl Fn(i64, i64, Option<u16>) -> Pos2,
        item: &Item,
        progress: f32,
        occupied: &mut Labels,
        emphasized: bool,
    ) {
        let color = if item.details["analysis_type"] == "hold" {
            Color32::from_rgb(90, 210, 240)
        } else {
            Color32::from_rgb(255, 177, 92)
        };
        let color = color.gamma_multiply(if emphasized { 1.0 } else { 0.75 });
        let progress = (progress / DRAW_FRACTION).clamp(0.0, 1.0);
        let mut last_point = None;
        for (i, stage) in self.stages.iter().enumerate() {
            let fraction = segment_progress(progress, self.stages.len(), i);
            if fraction <= 0.0 {
                break;
            }
            if let Some(route) = &stage.route {
                let mut remaining = route.length * fraction as f64;
                let mut label_at = None;
                let mut distance = 0.0;
                for stroke in &route.strokes {
                    let length = stroke.length();
                    let a = project(stroke.a.x, stroke.a.y, Some(stroke.a.layer));
                    let b = project(stroke.b.x, stroke.b.y, Some(stroke.b.layer));
                    if label_at.is_none() && distance + length >= route.length * 0.5 {
                        label_at =
                            Some(a.lerp(b, ((route.length * 0.5 - distance) / length) as f32));
                    }
                    distance += length;
                    if remaining <= 0.0 {
                        continue;
                    }
                    let f = (remaining / length).clamp(0.0, 1.0) as f32;
                    let tip = a.lerp(b, f);
                    painter.line_segment(
                        [a, tip],
                        Stroke::new(
                            if emphasized { 4.5 } else { 3.5 },
                            color.gamma_multiply(0.18),
                        ),
                    );
                    painter.line_segment(
                        [a, tip],
                        Stroke::new(if emphasized { 2.0 } else { 1.35 }, color),
                    );
                    last_point = Some(tip);
                    if f < 1.0 {
                        painter.circle_filled(tip, 4.0, color.gamma_multiply(0.4));
                        painter.circle_filled(tip, 1.8, Color32::WHITE);
                    }
                    remaining -= length;
                }
                if fraction >= 1.0 {
                    if let Some(at) = label_at {
                        label(
                            painter,
                            at,
                            &format!("{} ns", number(stage.delay, false)),
                            color,
                            occupied,
                        );
                    }
                }
            } else if let Some(b) = stage.cell {
                let points = vec![
                    project(b[0], b[1], None),
                    project(b[2], b[1], None),
                    project(b[2], b[3], None),
                    project(b[0], b[3], None),
                ];
                painter.add(egui::Shape::closed_line(
                    points,
                    Stroke::new(1.2, color.gamma_multiply(fraction)),
                ));
                if fraction >= 1.0 {
                    label(
                        painter,
                        project((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, None),
                        &format!("cell {} ns", number(stage.delay, false)),
                        color,
                        occupied,
                    );
                }
            }
        }
        if progress >= 1.0 {
            if let Some(end) = last_point {
                let d = &item.details;
                label(
                    painter,
                    end,
                    &format!(
                        "{} · slack {} ns\nArrival {} · Required {} ns",
                        d["analysis_type"].as_str().unwrap_or("path"),
                        number(d["slack_ns"].as_f64(), true),
                        number(d["arrival_ns"].as_f64(), false),
                        number(d["required_ns"].as_f64(), false)
                    ),
                    color,
                    occupied,
                );
            }
        }
    }
}

fn number(value: Option<f64>, signed: bool) -> String {
    value.filter(|v| v.is_finite()).map_or_else(
        || "N/A".into(),
        |v| {
            if v != 0.0 && v.abs() < 0.001 {
                format!("{v:.3e}")
            } else if signed {
                format!("{v:+.3}")
            } else {
                format!("{v:.3}")
            }
        },
    )
}

fn segment_progress(progress: f32, count: usize, index: usize) -> f32 {
    (progress * count as f32 - index as f32).clamp(0.0, 1.0)
}

fn label(painter: &egui::Painter, anchor: Pos2, text: &str, color: Color32, occupied: &mut Labels) {
    if !painter.clip_rect().contains(anchor)
        || !occupied.shown.insert((
            anchor.x.round() as i32,
            anchor.y.round() as i32,
            text.to_owned(),
        ))
    {
        return;
    }
    let galley = painter.layout_no_wrap(text.into(), FontId::proportional(10.0), color);
    let size = galley.size() + egui::vec2(8.0, 4.0);
    // Small callouts stay tied to their projected segments in both 2D and 3D.
    // Stagger nearby labels instead of stacking illegible text on the wire.
    let rect = (0..10)
        .map(|i| {
            let offset = egui::vec2(
                8.0,
                (i / 2 + 1) as f32 * 18.0 * if i % 2 == 0 { -1.0 } else { 1.0 },
            );
            let clip = painter.clip_rect().shrink(3.0);
            let position = anchor + offset;
            Rect::from_min_size(
                egui::pos2(
                    position
                        .x
                        .clamp(clip.left(), (clip.right() - size.x).max(clip.left())),
                    position
                        .y
                        .clamp(clip.top(), (clip.bottom() - size.y).max(clip.top())),
                ),
                size,
            )
        })
        .find(|r| {
            painter.clip_rect().contains_rect(*r)
                && occupied
                    .occupied
                    .iter()
                    .all(|o| !o.intersects(r.expand(2.0)))
        });
    if let Some(rect) = rect {
        let elbow = Pos2::new(rect.center().x, anchor.y);
        painter.add(egui::Shape::line(
            vec![anchor, elbow, rect.center()],
            Stroke::new(0.6, color.gamma_multiply(0.5)),
        ));
        painter.rect_filled(rect, 3.0, Color32::from_rgba_unmultiplied(15, 22, 32, 230));
        painter.text(
            rect.center(),
            Align2::CENTER_CENTER,
            text,
            FontId::proportional(10.0),
            color,
        );
        occupied.occupied.push(rect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn setup_and_hold_in_each_corner_share_one_six_second_clip() {
        let mut data:Analysis=serde_json::from_value(serde_json::json!({"schema":"ecos.replay.analysis.v1","views":[
            {"label":"slow · setup","kind":"timing","basis":"final","items":[{"label":"s","details":{"analysis_type":"setup"}}]},
            {"label":"slow · hold","kind":"timing","basis":"final","items":[{"label":"h","details":{"analysis_type":"hold"}}]},
            {"label":"fast · setup","kind":"timing","basis":"final","items":[{"label":"f"}]}]})).unwrap();
        group_corners(&mut data);
        assert_eq!(
            data.views
                .iter()
                .map(|v| (&*v.label, v.items.len()))
                .collect::<Vec<_>>(),
            vec![("slow", 2), ("fast", 1)]
        );
        assert_eq!(CORNER_SECONDS, 6.0);
    }
    #[test]
    fn segment_tip_is_continuous_and_unknown_delay_is_not_zero() {
        assert!((segment_progress(0.21, 4, 0) - 0.84).abs() < 1e-6);
        assert!((segment_progress(0.22, 4, 0) - 0.88).abs() < 1e-6);
        assert_eq!(number(None, false), "N/A");
        assert_eq!(
            lookup_pin("u:Q", &BTreeMap::from([("u/Q".into(), [1, 2])])),
            Some([1, 2])
        );
    }
}
