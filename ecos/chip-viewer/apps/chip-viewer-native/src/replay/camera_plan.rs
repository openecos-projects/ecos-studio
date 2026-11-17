//! Deterministic stage cameras use display time, never navigation wall time.
use crate::camera3d::{OrbitCamera, Vec3};
use chipgeom_format::Rect32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Preset {
    pub pitch: f32,
    pub yaw: f32,
}
impl Preset {
    pub fn for_phase(step: &str, phase: &str, map: bool) -> Self {
        let step = step.to_ascii_lowercase().replace([' ', '_', '-'], "");
        let phase = phase.to_ascii_lowercase();
        let pitch = if map {
            86.0
        } else if phase.contains("pdn")
            || phase.contains("power_grid")
            || matches!(
                phase.as_str(),
                "rails" | "stripes" | "rings" | "layer_macro_connect" | "io_core_connect"
            )
        {
            36.0
        } else if step == "route" {
            if phase.contains("pin_access") {
                72.0
            } else if phase.contains("track_assignment") {
                46.0
            } else if phase.contains("detailed")
                || phase.contains("patch")
                || phase.contains("repair")
                || phase.contains("best_route")
                || phase.contains("routing_check")
                || phase.contains("committed")
            {
                36.0
            } else {
                60.0
            }
        } else {
            match step.as_str() {
                "macroplacement" => 60.0,
                "place" | "preplace" | "filler" | "prefloorplan" | "postfloorplan" => 76.0,
                "legalization" => 82.0,
                "diffsizing" | "timingoptimization" => 65.0,
                "cts" => 55.0,
                "drc" | "antennacheck" => 70.0,
                "poweranalysis" | "emir" => 80.0,
                "harden" => 38.0,
                _ => 55.0,
            }
        };
        Self {
            pitch,
            yaw: if pitch < 65.0 { 45.0 } else { -90.0 },
        }
    }
    pub fn camera(self, world: Rect32, height: f32, aspect: f32) -> OrbitCamera {
        let mut camera = OrbitCamera::default();
        camera.fit_world_with_aspect(
            Vec3::new(world.lx as f32, world.ly as f32, 0.0),
            Vec3::new(world.hx as f32, world.hy as f32, height),
            height,
            aspect,
        );
        camera.pitch = self.pitch.to_radians();
        camera.yaw = self.yaw.to_radians();
        // Fit the actual projected box for this preset, rather than retaining
        // the conservative diagonal sphere fit intended for arbitrary orbit.
        for _ in 0..3 {
            let matrix = camera.view_proj(aspect);
            let mut extent = 0.0_f32;
            for x in [world.lx, world.hx] {
                for y in [world.ly, world.hy] {
                    for z in [0.0, height * camera.z_scale] {
                        let p = matrix.transform_point([x as f32, y as f32, z, 1.0]);
                        if p[3] > 0.0 {
                            extent = extent.max((p[0] / p[3]).abs()).max((p[1] / p[3]).abs());
                        }
                    }
                }
            }
            if extent > 0.0 {
                camera.distance *= (extent / 0.86).clamp(0.6, 1.5);
            }
        }
        camera
    }
}
pub fn blend(a: Preset, b: Preset, fraction: f32) -> Preset {
    let t = fraction.clamp(0.0, 1.0);
    let t = t * t * (3.0 - 2.0 * t);
    let delta = (b.yaw - a.yaw + 180.0).rem_euclid(360.0) - 180.0;
    Preset {
        pitch: a.pitch + (b.pitch - a.pitch) * t,
        yaw: a.yaw + delta * t,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn semantic_phases_choose_cameras_without_requiring_a_full_flow() {
        assert_eq!(
            Preset::for_phase("place", "pre_optimizer_step", false).pitch,
            76.0
        );
        assert_eq!(
            Preset::for_phase("place", "committed_database", true).pitch,
            86.0
        );
        assert_eq!(
            Preset::for_phase("route", "pin_access_candidates", false).pitch,
            72.0
        );
        assert_eq!(
            Preset::for_phase("route", "detailed_route_wave", false).pitch,
            36.0
        );
        assert_eq!(
            Preset::for_phase("custom", "pdn_stripes", false).pitch,
            36.0
        );
        assert_eq!(
            blend(
                Preset {
                    pitch: 40.0,
                    yaw: 170.0
                },
                Preset {
                    pitch: 80.0,
                    yaw: -170.0
                },
                0.5
            ),
            Preset {
                pitch: 60.0,
                yaw: 180.0
            }
        );
    }
}
