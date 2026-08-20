use crate::camera3d::{OrbitCamera, Vec3};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InputProfile {
    pub zoom_per_notch_2d: f32,
    pub zoom_per_notch_3d: f32,
    pub fine_zoom_3d: f32,
    pub pan_speed_3d: f32,
    pub orbit_speed_3d: f32,
    pub damping_drag_tau: f32,
    pub damping_release_tau: f32,
}

impl Default for InputProfile {
    fn default() -> Self {
        Self {
            zoom_per_notch_2d: 1.35,
            zoom_per_notch_3d: 1.08,
            fine_zoom_3d: 1.02,
            pan_speed_3d: 0.0025,
            orbit_speed_3d: 0.005,
            damping_drag_tau: 0.090,
            damping_release_tau: 0.250,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraController3d {
    pub current: OrbitCamera,
    pub target: OrbitCamera,
    pub profile: InputProfile,
    pub is_dragging: bool,
    pub yaw_vel: f32,
    pub pitch_vel: f32,
}

impl Default for CameraController3d {
    fn default() -> Self {
        let cam = OrbitCamera::default();
        Self {
            current: cam,
            target: cam,
            profile: InputProfile::default(),
            is_dragging: false,
            yaw_vel: 0.0,
            pitch_vel: 0.0,
        }
    }
}

impl CameraController3d {
    pub fn new(camera: OrbitCamera) -> Self {
        Self {
            current: camera,
            target: camera,
            profile: InputProfile::default(),
            is_dragging: false,
            yaw_vel: 0.0,
            pitch_vel: 0.0,
        }
    }

    pub fn snap_to_target(&mut self) {
        self.current = self.target;
        self.yaw_vel = 0.0;
        self.pitch_vel = 0.0;
    }

    pub fn set_target(&mut self, camera: OrbitCamera) {
        self.target = camera;
    }

    pub fn cancel_inertia(&mut self) {
        self.yaw_vel = 0.0;
        self.pitch_vel = 0.0;
    }

    pub fn start_drag(&mut self) {
        self.is_dragging = true;
        self.cancel_inertia();
    }

    pub fn stop_drag(&mut self) {
        self.is_dragging = false;
    }

    pub fn orbit(&mut self, delta_screen_x: f32, delta_screen_y: f32, modifier_scale: f32) {
        let speed = self.profile.orbit_speed_3d * modifier_scale;
        let dyaw = delta_screen_x * speed;
        let dpitch = -delta_screen_y * speed;
        self.target.orbit(dyaw, dpitch);
        self.yaw_vel = dyaw * 12.0;
        self.pitch_vel = dpitch * 12.0;
    }

    pub fn pan(&mut self, delta_screen_x: f32, delta_screen_y: f32, modifier_scale: f32) {
        self.cancel_inertia();
        let speed = modifier_scale;
        self.target
            .pan(delta_screen_x * speed, delta_screen_y * speed);
    }

    pub fn move_pivot(&mut self, delta_x: f32, delta_y: f32) {
        self.cancel_inertia();
        let eye = self.target.eye();
        let forward = self.target.target.sub(eye).normalized();
        let right = forward.cross(Vec3::UNIT_Z).normalized();
        let up = right.cross(forward).normalized();
        let step = self.target.distance * 0.10;
        self.target.target = self
            .target
            .target
            .add(right.scale(delta_x * step))
            .add(up.scale(delta_y * step));
    }

    pub fn dolly_steps(&mut self, steps: f32, pivot: Option<Vec3>, fine: bool) {
        self.cancel_inertia();
        let factor = if fine {
            self.profile.fine_zoom_3d
        } else {
            self.profile.zoom_per_notch_3d
        };
        let mult = factor.powf(-steps);
        self.target.zoom_toward(mult, pivot);
    }

    pub fn set_iso(&mut self) {
        self.cancel_inertia();
        self.target.set_iso();
    }

    pub fn set_top(&mut self) {
        self.cancel_inertia();
        self.target.set_top();
    }

    pub fn set_front(&mut self) {
        self.cancel_inertia();
        self.target.set_front();
    }

    pub fn fit_world(&mut self, world_min: Vec3, world_max: Vec3, stack_height: f32) {
        self.cancel_inertia();
        self.target.fit_world(world_min, world_max, stack_height);
    }

    pub fn fit_world_with_aspect(
        &mut self,
        world_min: Vec3,
        world_max: Vec3,
        stack_height: f32,
        aspect: f32,
    ) {
        self.cancel_inertia();
        self.target
            .fit_world_with_aspect(world_min, world_max, stack_height, aspect);
    }

    pub fn focus_xy(&mut self, x: f32, y: f32, span: f32, stack_height: f32) {
        self.cancel_inertia();
        self.target.focus_xy(x, y, span, stack_height);
    }

    pub fn update(&mut self, dt: f32) -> bool {
        let dt = dt.clamp(0.001, 0.1);

        // If inertia is active after release, apply decaying velocity to target
        if !self.is_dragging {
            if self.yaw_vel.abs() > 1e-4 || self.pitch_vel.abs() > 1e-4 {
                self.target.orbit(self.yaw_vel * dt, self.pitch_vel * dt);
                let decay = (-dt / self.profile.damping_release_tau).exp();
                self.yaw_vel *= decay;
                self.pitch_vel *= decay;
            } else {
                self.yaw_vel = 0.0;
                self.pitch_vel = 0.0;
            }
        }

        let tau = if self.is_dragging {
            self.profile.damping_drag_tau
        } else {
            self.profile.damping_release_tau
        };
        let alpha = 1.0 - (-dt / tau).exp();

        let dist_diff = (self.target.distance - self.current.distance).abs();
        let target_diff = self.target.target.sub(self.current.target).length();
        let yaw_diff = (self.target.yaw - self.current.yaw).abs();
        let pitch_diff = (self.target.pitch - self.current.pitch).abs();
        let z_scale_diff = (self.target.z_scale - self.current.z_scale).abs();

        let is_moving = dist_diff > 1e-3
            || target_diff > 1e-2
            || yaw_diff > 1e-4
            || pitch_diff > 1e-4
            || z_scale_diff > 1e-4
            || self.yaw_vel.abs() > 1e-4
            || self.pitch_vel.abs() > 1e-4;

        if is_moving {
            self.current.distance += (self.target.distance - self.current.distance) * alpha;
            self.current.target = self
                .current
                .target
                .add(self.target.target.sub(self.current.target).scale(alpha));
            self.current.yaw += (self.target.yaw - self.current.yaw) * alpha;
            self.current.pitch += (self.target.pitch - self.current.pitch) * alpha;
            self.current.z_scale += (self.target.z_scale - self.current.z_scale) * alpha;
            self.current.fov_y = self.target.fov_y;
        } else {
            self.current = self.target;
        }

        is_moving
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_profile_separates_2d_and_3d_zoom() {
        let profile = InputProfile::default();
        assert!(profile.zoom_per_notch_2d > profile.zoom_per_notch_3d);
        assert!((profile.zoom_per_notch_3d - 1.08).abs() < 1e-3);
    }

    #[test]
    fn camera_controller_damping_converges() {
        let mut ctrl = CameraController3d::default();
        ctrl.target.distance = 500.0;
        ctrl.current.distance = 100.0;

        // Simulate 0.5s of frame updates (at 60fps, dt ~ 0.016s)
        for _ in 0..30 {
            ctrl.update(0.0166);
        }

        assert!((ctrl.current.distance - 500.0).abs() < 60.0);

        // After another 1.0s (60 frames), should fully converge
        for _ in 0..60 {
            ctrl.update(0.0166);
        }
        assert!((ctrl.current.distance - 500.0).abs() < 2.0);
    }

    #[test]
    fn cancel_inertia_clears_velocity() {
        let mut ctrl = CameraController3d::default();
        ctrl.yaw_vel = 5.0;
        ctrl.pitch_vel = -3.0;
        ctrl.cancel_inertia();
        assert_eq!(ctrl.yaw_vel, 0.0);
        assert_eq!(ctrl.pitch_vel, 0.0);
    }
}
