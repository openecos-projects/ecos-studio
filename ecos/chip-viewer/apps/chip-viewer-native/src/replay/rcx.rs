//! Replay SPEF membership on native routed geometry, shared across all corners.
use crate::replay::data::Recording;
use anyhow::{Context, Result};
use chipgeom_format::{replay_analysis::Analysis, OwnerType};
use egui::{Color32, Painter, Pos2, Stroke};
use std::{collections::BTreeMap, ops::Range, sync::Arc};

pub const CORNER_SECONDS: f64 = 4.0;

#[derive(Default)]
pub struct RcxOverlay {
    views: Vec<Vec<Arc<Net>>>,
}
#[derive(Default)]
struct Net {
    shapes: Vec<([i64; 4], u16)>,
    bounds: Option<[i64; 4]>,
}
impl RcxOverlay {
    pub fn load(record: &Recording, data: &Analysis) -> Result<Self> {
        if !data.views.iter().any(|v| v.kind == "rcx") {
            return Ok(Self::default());
        }
        let path = record
            .final_geometry_path()?
            .context("No recorded native geometry for RCX")?;
        let db = chip_view_db::ChipViewDb::open(path)?;
        let aliases = spef_aliases(db.net_metadata().iter().map(|n| n.name.as_str()));
        let mut nets = BTreeMap::<String, Arc<Net>>::new();
        let mut overlay = Self::default();
        for view in &data.views {
            let mut geometries = Vec::new();
            if view.kind == "rcx" {
                for item in &view.items {
                    let name = item.nets.first().unwrap_or(&item.label);
                    let net = nets.entry(name.clone()).or_insert_with(|| {
                        let mut net = Net::default();
                        let native_name = if db.net_kind_for_name(name).is_some() {
                            name.as_str()
                        } else {
                            aliases
                                .get(&name.replace('\\', ""))
                                .copied()
                                .flatten()
                                .unwrap_or(name)
                        };
                        for id in db.query_owner_name_for_owner_types(
                            native_name,
                            &[OwnerType::NetWireSegment, OwnerType::Via],
                        ) {
                            if let Some(s) = db.find_shape(id) {
                                let b = [
                                    s.bbox.lx.into(),
                                    s.bbox.ly.into(),
                                    s.bbox.hx.into(),
                                    s.bbox.hy.into(),
                                ];
                                net.shapes.push((b, s.layer_id));
                                net.bounds = Some(net.bounds.map_or(b, |a| {
                                    [
                                        a[0].min(b[0]),
                                        a[1].min(b[1]),
                                        a[2].max(b[2]),
                                        a[3].max(b[3]),
                                    ]
                                }));
                            }
                        }
                        Arc::new(net)
                    });
                    geometries.push(net.clone());
                }
            }
            overlay.views.push(geometries);
        }
        Ok(overlay)
    }

    pub fn bounds(&self, view: usize, item: usize) -> Option<[i64; 4]> {
        self.views.get(view)?.get(item)?.bounds
    }

    pub fn missing(&self, view: usize) -> usize {
        self.views.get(view).map_or(0, |nets| {
            nets.iter().filter(|n| n.shapes.is_empty()).count()
        })
    }

    pub fn paint(
        &self,
        painter: &Painter,
        project: impl Fn(i64, i64, Option<u16>) -> Pos2,
        view: usize,
        values: &[chipgeom_format::replay_analysis::Item],
        progress: f32,
        selected: Option<usize>,
    ) {
        let Some(nets) = self.views.get(view) else {
            return;
        };
        let range = selected.map_or_else(
            || window(progress, nets.len()),
            |i| i..i.saturating_add(1).min(nets.len()),
        );
        let maximum = values
            .iter()
            .filter_map(|i| i.value)
            .fold(0.0, f64::max)
            .max(f64::EPSILON);
        for i in range.clone() {
            let fraction = (values[i].value.unwrap_or(0.0) / maximum).clamp(0.0, 1.0) as f32;
            let color = Color32::from_rgb(
                (80.0 + 175.0 * fraction) as u8,
                (210.0 - 140.0 * fraction) as u8,
                150,
            );
            let fade = if selected.is_some() {
                1.0
            } else {
                let width = (nets.len() / 8).clamp(16, 512) as f32;
                let age = (progress.clamp(0.0, 1.0) * nets.len() as f32 - i as f32) / width;
                let entrance = (age / 0.15).clamp(0.0, 1.0);
                entrance * entrance * (3.0 - 2.0 * entrance) * (1.0 - age).clamp(0.0, 1.0)
            };
            let color = color.gamma_multiply(fade);
            for &(b, layer) in &nets[i].shapes {
                // Native wire/via rectangles provide the path and layer. Only
                // the highlight's screen width is enlarged for visibility.
                let (a, z) = if b[2] - b[0] >= b[3] - b[1] {
                    let y = b[1] + (b[3] - b[1]) / 2;
                    ([b[0], y], [b[2], y])
                } else {
                    let x = b[0] + (b[2] - b[0]) / 2;
                    ([x, b[1]], [x, b[3]])
                };
                painter.line_segment(
                    [
                        project(a[0], a[1], Some(layer)),
                        project(z[0], z[1], Some(layer)),
                    ],
                    Stroke::new(1.8, color),
                );
            }
        }
    }
}

// SPEF names can carry repeated escaping of hierarchy/bus punctuation. Resolve
// only unambiguous aliases of actual native nets; exact native names win first.
fn spef_aliases<'a>(names: impl Iterator<Item = &'a str>) -> BTreeMap<String, Option<&'a str>> {
    let mut aliases = BTreeMap::new();
    for name in names {
        aliases
            .entry(name.replace('\\', ""))
            .and_modify(|previous| {
                if *previous != Some(name) {
                    *previous = None;
                }
            })
            .or_insert(Some(name));
    }
    aliases
}

// A bounded moving highlight avoids saturating large layouts or drawing every
// already visited net every frame. The base layout remains fully visible.
fn window(progress: f32, count: usize) -> Range<usize> {
    let end = ((progress.clamp(0.0, 1.0) * count as f32).ceil() as usize).min(count);
    end.saturating_sub((count / 8).clamp(16, 512))..end
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spef_escaping_does_not_merge_ambiguous_native_nets() {
        let aliases = spef_aliases(["core.n[0]", "a\\b", "ab"].into_iter());
        assert_eq!(
            aliases.get(&r"core\\.n\[0\]".replace('\\', "")),
            Some(&Some("core.n[0]"))
        );
        assert_eq!(aliases.get("ab"), Some(&None));
    }
    #[test]
    #[ignore = "set ECOS_REPLAY_TEST_CATALOG to a newly generated Replay catalog"]
    fn real_rcx_nets_resolve_and_share_native_geometry_across_corners() {
        let path = std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap();
        let catalog: crate::replay::data::Catalog =
            crate::replay::data::read(std::path::Path::new(&path)).unwrap();
        let step = catalog.steps.iter().find(|s| s.name == "RCX").unwrap();
        let record = Recording::open(&catalog.workspace, step.manifest.as_ref().unwrap()).unwrap();
        let data = crate::replay::analysis_data::load(&record).unwrap();
        assert_eq!(data.schema, "ecos.replay.analysis.v2");
        let overlay = RcxOverlay::load(&record, &data).unwrap();
        let mut unique = BTreeMap::<String, Arc<Net>>::new();
        for (index, view) in data.views.iter().enumerate() {
            assert_eq!(view.kind, "rcx");
            assert_eq!(
                overlay.missing(index),
                0,
                "{} has missing native nets",
                view.label
            );
            assert_eq!(view.items.len(), overlay.views[index].len());
            for (item, net) in view.items.iter().zip(&overlay.views[index]) {
                if let Some(previous) = unique.get(&item.label) {
                    assert!(Arc::ptr_eq(previous, net));
                } else {
                    unique.insert(item.label.clone(), net.clone());
                }
            }
        }
        println!(
            "RCX: {} corners, {} unique nets, {} native shapes shared across corners",
            data.views.len(),
            unique.len(),
            unique.values().map(|n| n.shapes.len()).sum::<usize>()
        );
        assert!(!unique.is_empty());
    }
    #[test]
    fn highlight_window_is_bounded_and_seekable() {
        assert_eq!(window(0.0, 8079), 0..0);
        assert_eq!(window(1.0, 8079), 7567..8079);
        assert_eq!(window(0.5, 100), 34..50);
        assert_eq!(window(1.0, 2), 0..2);
        assert_eq!(window(0.5, 0), 0..0);
    }
    #[test]
    fn routed_highlights_keep_native_layers_in_both_projections() {
        let overlay = RcxOverlay {
            views: vec![vec![Arc::new(Net {
                shapes: vec![([0, 0, 100, 4], 3), ([98, 0, 102, 100], 7)],
                bounds: Some([0, 0, 102, 100]),
            })]],
        };
        let values = vec![Item::default()];
        for rotated in [false, true] {
            let calls = std::cell::RefCell::new(Vec::new());
            let ctx = egui::Context::default();
            let _ = ctx.run(Default::default(), |ctx| {
                overlay.paint(
                    &ctx.layer_painter(egui::LayerId::background()),
                    |x, y, layer| {
                        calls.borrow_mut().push((x, y, layer));
                        Pos2::new(
                            x as f32,
                            y as f32
                                + if rotated {
                                    f32::from(layer.unwrap()) * 20.0
                                } else {
                                    0.0
                                },
                        )
                    },
                    0,
                    &values,
                    1.0,
                    None,
                )
            });
            assert_eq!(
                *calls.borrow(),
                [
                    (0, 2, Some(3)),
                    (100, 2, Some(3)),
                    (100, 0, Some(7)),
                    (100, 100, Some(7))
                ]
            );
        }
    }
    use chipgeom_format::replay_analysis::Item;
}
