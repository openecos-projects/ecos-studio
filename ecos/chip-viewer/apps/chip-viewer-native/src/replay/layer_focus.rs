//! Display-only layer policy. All transitions are functions of the replay cursor.
use super::{data::Recording, ReplayApp};
use crate::canvas_gpu3d::{CanvasUniform3d, GpuShapeInstance3d};
use chip_display::LayerRole;
use chipgeom_format::replay::Object;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Style {
    /// Other, cells, signal geometry, power geometry.
    pub classes: [f32; 4],
    /// Focus lower/upper Z and context coverage below/above it.
    pub band: [f32; 4],
}
impl Default for Style {
    fn default() -> Self {
        Self {
            classes: [1.0; 4],
            band: [-f32::MAX, f32::MAX, 1.0, 1.0],
        }
    }
}
impl Style {
    pub fn coverage(self, class: u32, z: f32) -> f32 {
        self.classes[class.min(3) as usize]
            * if z < self.band[0] {
                self.band[2]
            } else if z > self.band[1] {
                self.band[3]
            } else {
                1.0
            }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transition {
    pub from: Style,
    pub to: Style,
    pub fraction: f32,
}
impl Transition {
    pub fn between(from: Style, to: Style, fraction: f32) -> Self {
        Self {
            from,
            to,
            fraction: smooth(fraction),
        }
    }
    pub fn apply(self, uniform: &mut CanvasUniform3d) {
        uniform.replay_classes_from = self.from.classes;
        uniform.replay_classes_to = self.to.classes;
        uniform.replay_band_from = self.from.band;
        uniform.replay_band_to = self.to.band;
        uniform.replay_blend = [self.fraction, 0.0, 0.0, 0.0];
    }
    pub fn coverage(self, instance: &GpuShapeInstance3d) -> f32 {
        let z = (instance.z0 + instance.z1) * 0.5;
        let a = self.from.coverage(instance._pad[1], z);
        let b = self.to.coverage(instance._pad[1], z);
        a + (b - a) * self.fraction
    }
}
pub fn smooth(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
pub fn class(object: &Object) -> u32 {
    match object.kind.as_str() {
        "instance" | "macro" => 1,
        "wire" | "via" | "route" | "route_patch" | "guide" => 2,
        "pdn" => 3,
        _ => 0,
    }
}

pub fn for_phase(step: &str, phase: &str, active_band: Option<[f32; 2]>) -> Style {
    let step = step.to_ascii_lowercase().replace([' ', '_', '-'], "");
    let phase = phase.to_ascii_lowercase();
    let pdn = phase.contains("pdn")
        || phase.contains("power_grid")
        || matches!(
            phase.as_str(),
            "rails" | "stripes" | "rings" | "layer_macro_connect" | "io_core_connect"
        );
    let mut style = Style::default();
    if pdn {
        style.classes = [1.0, 0.45, 0.25, 1.0];
        if let Some([lo, hi]) = active_band {
            style.band = [lo, hi, 0.25, 0.0];
        }
    } else if step == "route" {
        style.classes = [1.0, 0.3, 1.0, 0.0];
        if let Some([lo, hi]) = active_band {
            style.band = [lo, hi, 0.25, 0.0];
        }
    } else if matches!(
        step.as_str(),
        "floorplan"
            | "prefloorplan"
            | "postfloorplan"
            | "macroplacement"
            | "preplace"
            | "place"
            | "legalization"
            | "diffopt"
            | "diffsizing"
            | "timingoptimization"
            | "cts"
            | "filler"
    ) {
        style.classes = [1.0, 1.0, 0.0, 0.0];
    }
    style
}

#[derive(Clone, Debug)]
pub struct RoutingLayer {
    pub id: u16,
    pub name: String,
    pub z0: f32,
    pub z1: f32,
}

/// Small metadata only: no geometry duplication and no inference from layer names.
pub fn routing_layers(record: &Recording) -> anyhow::Result<Vec<RoutingLayer>> {
    let Some(path) = record.final_geometry_path()? else {
        return Ok(Vec::new());
    };
    let manifest = chipgeom_reader::read_manifest(&path)?;
    let Some(layers) = manifest.layers else {
        return Ok(Vec::new());
    };
    let path = super::data::within(path.parent().unwrap(), &layers)?;
    let mut layers = chipgeom_reader::read_layer_metadata(Some(&path))?;
    layers.sort_by_key(|l| (l.order, l.layer_id));
    let stack = chip_display::heuristic_layer_stack(layers.iter().map(|l| {
        (
            l.layer_id,
            LayerRole::from_metadata(&l.name, &l.layer_type),
            l.order,
        )
    }));
    Ok(layers
        .into_iter()
        .filter(|l| {
            matches!(
                LayerRole::from_metadata(&l.name, &l.layer_type),
                LayerRole::Metal { .. }
                    | LayerRole::TopMetal { .. }
                    | LayerRole::Routing
                    | LayerRole::Rdl
            )
        })
        .filter_map(|l| {
            stack.band(l.layer_id).map(|band| RoutingLayer {
                id: l.layer_id,
                name: l.name,
                z0: band.z0 + 300.0,
                z1: band.z1 + 300.0,
            })
        })
        .collect())
}

impl ReplayApp {
    pub(super) fn layer_transition(&self) -> Transition {
        if !self.view3d.auto_layers || self.completion_node_selected {
            return Transition::default();
        }
        if let Some(scan) = self
            .analysis
            .drc_scan()
            .filter(|_| self.complete && self.pending.is_none())
        {
            return scan.transition;
        }
        let Some(record) = &self.recording else {
            return Transition::default();
        };
        let Some(revision) = record.scene.revision else {
            return Transition::default();
        };
        let Some(frame) = record.manifest.frames.get(revision) else {
            return Transition::default();
        };
        let step = &self.catalog.steps[self.step].name;
        let band_for_label = |label: &str| {
            self.view3d.scene.as_ref().and_then(|scene| {
                let (kind, name) = label.split_once(" · ")?;
                matches!(kind, "PDN" | "wire" | "via" | "route")
                    .then_some(name)
                    .and_then(|name| {
                        scene.metadata.layers.get(name).or_else(|| {
                            let id = name.parse::<u16>().ok()?;
                            scene
                                .metadata
                                .layers
                                .values()
                                .find(|(layer_id, _, _)| *layer_id == id)
                        })
                    })
                    .and_then(|(id, _, _)| scene.metadata.stack.band(*id))
                    .map(|band| [band.z0 + 300.0, band.z1 + 300.0])
            })
        };
        let band = band_for_label(self.reveal.label()).or_else(|| {
            self.view3d
                .scene
                .as_ref()
                .and_then(|scene| scene.active_band)
        });
        let target = for_phase(step, &frame.phase, band);
        let local = self.position - self.starts[self.step];
        if self.complete {
            return Transition::between(
                target,
                Style::default(),
                ((local - self.plans[self.step].process_seconds) / 0.45) as f32,
            );
        }
        if self.camera_exact {
            return Transition::between(target, target, 1.0);
        }
        if let Some((current, previous, fraction)) = self.reveal.group_transition() {
            if band_for_label(current).is_some() && target.band != Style::default().band {
                let prior = previous.and_then(band_for_label).or(band);
                return Transition::between(for_phase(step, &frame.phase, prior), target, fraction);
            }
        }
        let Some(clip) = self.active_clip.map(|i| &self.plans[self.step].clips[i]) else {
            return Transition::between(target, target, 1.0);
        };
        let previous = revision.checked_sub(1).map_or_else(Style::default, |i| {
            for_phase(step, &record.manifest.frames[i].phase, band)
        });
        Transition::between(previous, target, ((local - clip.start) / 0.35) as f32)
    }
}

#[cfg(test)]
#[path = "layer_focus_tests.rs"]
mod tests;
