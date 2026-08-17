#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    pub const UNIT_Z: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 1.0,
    };

    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn to_array(self) -> [f32; 3] {
        [self.x, self.y, self.z]
    }

    pub fn length(self) -> f32 {
        self.x.hypot(self.y).hypot(self.z)
    }

    pub fn normalized(self) -> Self {
        let length = self.length();
        if length <= f32::EPSILON {
            Self::ZERO
        } else {
            Self::new(self.x / length, self.y / length, self.z / length)
        }
    }

    pub fn dot(self, other: Self) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(self, other: Self) -> Self {
        Self::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    pub fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }

    pub fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }

    pub fn scale(self, value: f32) -> Self {
        Self::new(self.x * value, self.y * value, self.z * value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat4 {
    pub cols: [[f32; 4]; 4],
}

impl Mat4 {
    pub fn from_cols(cols: [[f32; 4]; 4]) -> Self {
        Self { cols }
    }

    pub fn mul(self, other: Self) -> Self {
        let mut cols = [[0.0; 4]; 4];
        for c in 0..4 {
            for r in 0..4 {
                cols[c][r] = (0..4).map(|k| self.cols[k][r] * other.cols[c][k]).sum();
            }
        }
        Self { cols }
    }

    pub fn transform_point(self, point: [f32; 4]) -> [f32; 4] {
        let mut out = [0.0; 4];
        for r in 0..4 {
            out[r] = (0..4).map(|c| self.cols[c][r] * point[c]).sum();
        }
        out
    }

    pub fn invert(self) -> Option<Self> {
        let m = self.cols;
        let mut inv = [[0.0; 4]; 4];

        inv[0][0] =
            m[1][1] * m[2][2] * m[3][3] - m[1][1] * m[2][3] * m[3][2] - m[2][1] * m[1][2] * m[3][3]
                + m[2][1] * m[1][3] * m[3][2]
                + m[3][1] * m[1][2] * m[2][3]
                - m[3][1] * m[1][3] * m[2][2];
        inv[1][0] = -m[1][0] * m[2][2] * m[3][3]
            + m[1][0] * m[2][3] * m[3][2]
            + m[2][0] * m[1][2] * m[3][3]
            - m[2][0] * m[1][3] * m[3][2]
            - m[3][0] * m[1][2] * m[2][3]
            + m[3][0] * m[1][3] * m[2][2];
        inv[2][0] =
            m[1][0] * m[2][1] * m[3][3] - m[1][0] * m[2][3] * m[3][1] - m[2][0] * m[1][1] * m[3][3]
                + m[2][0] * m[1][3] * m[3][1]
                + m[3][0] * m[1][1] * m[2][3]
                - m[3][0] * m[1][3] * m[2][1];
        inv[3][0] = -m[1][0] * m[2][1] * m[3][2]
            + m[1][0] * m[2][2] * m[3][1]
            + m[2][0] * m[1][1] * m[3][2]
            - m[2][0] * m[1][2] * m[3][1]
            - m[3][0] * m[1][1] * m[2][2]
            + m[3][0] * m[1][2] * m[2][1];
        inv[0][1] = -m[0][1] * m[2][2] * m[3][3]
            + m[0][1] * m[2][3] * m[3][2]
            + m[2][1] * m[0][2] * m[3][3]
            - m[2][1] * m[0][3] * m[3][2]
            - m[3][1] * m[0][2] * m[2][3]
            + m[3][1] * m[0][3] * m[2][2];
        inv[1][1] =
            m[0][0] * m[2][2] * m[3][3] - m[0][0] * m[2][3] * m[3][2] - m[2][0] * m[0][2] * m[3][3]
                + m[2][0] * m[0][3] * m[3][2]
                + m[3][0] * m[0][2] * m[2][3]
                - m[3][0] * m[0][3] * m[2][2];
        inv[2][1] = -m[0][0] * m[2][1] * m[3][3]
            + m[0][0] * m[2][3] * m[3][1]
            + m[2][0] * m[0][1] * m[3][3]
            - m[2][0] * m[0][3] * m[3][1]
            - m[3][0] * m[0][1] * m[2][3]
            + m[3][0] * m[0][3] * m[2][1];
        inv[3][1] =
            m[0][0] * m[2][1] * m[3][2] - m[0][0] * m[2][2] * m[3][1] - m[2][0] * m[0][1] * m[3][2]
                + m[2][0] * m[0][2] * m[3][1]
                + m[3][0] * m[0][1] * m[2][2]
                - m[3][0] * m[0][2] * m[2][1];
        inv[0][2] =
            m[0][1] * m[1][2] * m[3][3] - m[0][1] * m[1][3] * m[3][2] - m[1][1] * m[0][2] * m[3][3]
                + m[1][1] * m[0][3] * m[3][2]
                + m[3][1] * m[0][2] * m[1][3]
                - m[3][1] * m[0][3] * m[1][2];
        inv[1][2] = -m[0][0] * m[1][2] * m[3][3]
            + m[0][0] * m[1][3] * m[3][2]
            + m[1][0] * m[0][2] * m[3][3]
            - m[1][0] * m[0][3] * m[3][2]
            - m[3][0] * m[0][2] * m[1][3]
            + m[3][0] * m[0][3] * m[1][2];
        inv[2][2] =
            m[0][0] * m[1][1] * m[3][3] - m[0][0] * m[1][3] * m[3][1] - m[1][0] * m[0][1] * m[3][3]
                + m[1][0] * m[0][3] * m[3][1]
                + m[3][0] * m[0][1] * m[1][3]
                - m[3][0] * m[0][3] * m[1][1];
        inv[3][2] = -m[0][0] * m[1][1] * m[3][2]
            + m[0][0] * m[1][2] * m[3][1]
            + m[1][0] * m[0][1] * m[3][2]
            - m[1][0] * m[0][2] * m[3][1]
            - m[3][0] * m[0][1] * m[1][2]
            + m[3][0] * m[0][2] * m[1][1];
        inv[0][3] = -m[0][1] * m[1][2] * m[2][3]
            + m[0][1] * m[1][3] * m[2][2]
            + m[1][1] * m[0][2] * m[2][3]
            - m[1][1] * m[0][3] * m[2][2]
            - m[2][1] * m[0][2] * m[1][3]
            + m[2][1] * m[0][3] * m[1][2];
        inv[1][3] =
            m[0][0] * m[1][2] * m[2][3] - m[0][0] * m[1][3] * m[2][2] - m[1][0] * m[0][2] * m[2][3]
                + m[1][0] * m[0][3] * m[2][2]
                + m[2][0] * m[0][2] * m[1][3]
                - m[2][0] * m[0][3] * m[1][2];
        inv[2][3] = -m[0][0] * m[1][1] * m[2][3]
            + m[0][0] * m[1][3] * m[2][1]
            + m[1][0] * m[0][1] * m[2][3]
            - m[1][0] * m[0][3] * m[2][1]
            - m[2][0] * m[0][1] * m[1][3]
            + m[2][0] * m[0][3] * m[1][1];
        inv[3][3] =
            m[0][0] * m[1][1] * m[2][2] - m[0][0] * m[1][2] * m[2][1] - m[1][0] * m[0][1] * m[2][2]
                + m[1][0] * m[0][2] * m[2][1]
                + m[2][0] * m[0][1] * m[1][2]
                - m[2][0] * m[0][2] * m[1][1];

        let det =
            m[0][0] * inv[0][0] + m[0][1] * inv[1][0] + m[0][2] * inv[2][0] + m[0][3] * inv[3][0];
        if det.abs() <= 1e-8 {
            return None;
        }
        let inv_det = 1.0 / det;
        for col in &mut inv {
            for value in col {
                *value *= inv_det;
            }
        }
        Some(Self { cols: inv })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray3 {
    pub origin: Vec3,
    pub direction: Vec3,
}

impl Ray3 {
    pub fn point_at(self, t: f32) -> Vec3 {
        self.origin.add(self.direction.scale(t))
    }

    pub fn intersect_z_plane(self, z: f32) -> Option<Vec3> {
        if self.direction.z.abs() <= 1e-6 {
            return None;
        }
        let t = (z - self.origin.z) / self.direction.z;
        (t >= 0.0).then(|| self.point_at(t))
    }

    pub fn intersect_aabb(self, min: Vec3, max: Vec3) -> Option<f32> {
        let mut tmin = 0.0_f32;
        let mut tmax = f32::INFINITY;
        for (origin, dir, min_b, max_b) in [
            (self.origin.x, self.direction.x, min.x, max.x),
            (self.origin.y, self.direction.y, min.y, max.y),
            (self.origin.z, self.direction.z, min.z, max.z),
        ] {
            if dir.abs() <= 1e-8 {
                if origin < min_b || origin > max_b {
                    return None;
                }
                continue;
            }
            let inv = 1.0 / dir;
            let mut t0 = (min_b - origin) * inv;
            let mut t1 = (max_b - origin) * inv;
            if t0 > t1 {
                std::mem::swap(&mut t0, &mut t1);
            }
            tmin = tmin.max(t0);
            tmax = tmax.min(t1);
            if tmax < tmin {
                return None;
            }
        }
        let t = if tmin >= 0.0 { tmin } else { tmax };
        (t >= 0.0).then_some(t)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrbitCamera {
    pub target: Vec3,
    pub distance: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub z_scale: f32,
    pub fov_y: f32,
}

impl Default for OrbitCamera {
    fn default() -> Self {
        Self {
            target: Vec3::ZERO,
            distance: 1.0,
            yaw: 45_f32.to_radians(),
            pitch: 38_f32.to_radians(),
            z_scale: 1.0,
            fov_y: 40_f32.to_radians(),
        }
    }
}

impl OrbitCamera {
    pub const MIN_PITCH: f32 = 6_f32.to_radians();
    pub const MAX_PITCH: f32 = 88_f32.to_radians();

    pub fn fit_world(&mut self, world_min: Vec3, world_max: Vec3, stack_height: f32) {
        self.fit_world_with_aspect(world_min, world_max, stack_height, 1.0);
    }

    pub fn fit_world_with_aspect(
        &mut self,
        world_min: Vec3,
        world_max: Vec3,
        stack_height: f32,
        aspect: f32,
    ) {
        let width = (world_max.x - world_min.x).max(1.0);
        let height = (world_max.y - world_min.y).max(1.0);
        self.z_scale = auto_z_scale(width, height, stack_height);
        self.target = Vec3::new(
            (world_min.x + world_max.x) * 0.5,
            (world_min.y + world_max.y) * 0.5,
            stack_height * self.z_scale * 0.45,
        );
        self.yaw = 45_f32.to_radians();
        self.pitch = 38_f32.to_radians();
        self.distance = fit_camera_distance(
            width.hypot(height),
            stack_height * self.z_scale,
            self.fov_y,
            aspect,
        );
    }

    pub fn set_iso(&mut self) {
        self.yaw = 45_f32.to_radians();
        self.pitch = 38_f32.to_radians();
    }

    pub fn set_top(&mut self) {
        self.yaw = -90_f32.to_radians();
        self.pitch = Self::MAX_PITCH;
    }

    pub fn set_front(&mut self) {
        self.yaw = -90_f32.to_radians();
        self.pitch = 12_f32.to_radians();
    }

    pub fn focus_xy(&mut self, x: f32, y: f32, span: f32, stack_height: f32) {
        self.target.x = x;
        self.target.y = y;
        self.target.z = stack_height * self.z_scale * 0.45;
        self.distance = span.max(1.0) * 2.4;
    }

    pub fn eye(self) -> Vec3 {
        let cos_pitch = self.pitch.cos();
        Vec3::new(
            self.target.x + self.distance * cos_pitch * self.yaw.cos(),
            self.target.y + self.distance * cos_pitch * self.yaw.sin(),
            self.target.z + self.distance * self.pitch.sin(),
        )
    }

    pub fn orbit(&mut self, delta_yaw: f32, delta_pitch: f32) {
        self.yaw += delta_yaw;
        self.pitch = (self.pitch + delta_pitch).clamp(Self::MIN_PITCH, Self::MAX_PITCH);
    }

    pub fn zoom(&mut self, factor: f32) {
        self.zoom_toward(factor, None);
    }

    pub fn zoom_toward(&mut self, factor: f32, pivot: Option<Vec3>) {
        let factor = factor.clamp(0.05, 20.0);
        let new_distance = (self.distance * factor).clamp(1.0, 1.0e12);
        if let Some(pivot) = pivot {
            let ratio = new_distance / self.distance.max(1.0);
            self.target = pivot.add(self.target.sub(pivot).scale(ratio));
        }
        self.distance = new_distance;
    }

    pub fn pan(&mut self, delta_x: f32, delta_y: f32) {
        let eye = self.eye();
        let forward = self.target.sub(eye).normalized();
        let right = forward.cross(Vec3::UNIT_Z).normalized();
        let up = right.cross(forward).normalized();
        let scale = self.distance * 0.0025;
        self.target = self
            .target
            .add(right.scale(-delta_x * scale))
            .add(up.scale(delta_y * scale));
    }

    pub fn view_proj(self, aspect: f32) -> Mat4 {
        let eye = self.eye();
        let view = look_at(eye, self.target, Vec3::UNIT_Z);
        let near = (self.distance * 0.01).max(1.0);
        let far = (self.distance * 20.0).max(near * 10.0);
        perspective(self.fov_y, aspect.max(0.05), near, far).mul(view)
    }

    pub fn ray_from_screen(
        self,
        pos: [f32; 2],
        canvas_min: [f32; 2],
        canvas_size: [f32; 2],
    ) -> Option<Ray3> {
        if canvas_size[0] <= 1.0 || canvas_size[1] <= 1.0 {
            return None;
        }
        let ndc_x = ((pos[0] - canvas_min[0]) / canvas_size[0]) * 2.0 - 1.0;
        let ndc_y = 1.0 - ((pos[1] - canvas_min[1]) / canvas_size[1]) * 2.0;
        let inv = self.view_proj(canvas_size[0] / canvas_size[1]).invert()?;
        let near = unproject(inv, [ndc_x, ndc_y, 0.0])?;
        let far = unproject(inv, [ndc_x, ndc_y, 1.0])?;
        Some(Ray3 {
            origin: near,
            direction: far.sub(near).normalized(),
        })
    }
}

pub fn fit_camera_distance(diagonal: f32, stack_height: f32, fov_y: f32, aspect: f32) -> f32 {
    let diagonal = diagonal.max(1.0);
    let extent = diagonal.max(stack_height.max(0.0));
    let half_fov = (fov_y * 0.5).max(0.05);
    let aspect = aspect.max(0.2);
    // Iso yaw presents the die diagonal on screen. Keep a margin so the
    // near edge and metal stack stay inside the canvas after Fit.
    let framed = extent * 1.22;
    framed / (2.0 * half_fov.tan() * aspect.min(1.0))
}

fn auto_z_scale(world_width: f32, world_height: f32, stack_height: f32) -> f32 {
    let stack_height = stack_height.max(1.0);
    let diagonal = world_width.hypot(world_height).max(1.0);
    (diagonal * 0.02 / stack_height).clamp(0.1, 4.0)
}

pub fn look_at(eye: Vec3, target: Vec3, up: Vec3) -> Mat4 {
    let forward = target.sub(eye).normalized();
    let right = forward.cross(up).normalized();
    let up = right.cross(forward).normalized();
    Mat4::from_cols([
        [right.x, up.x, -forward.x, 0.0],
        [right.y, up.y, -forward.y, 0.0],
        [right.z, up.z, -forward.z, 0.0],
        [-right.dot(eye), -up.dot(eye), forward.dot(eye), 1.0],
    ])
}

pub fn perspective(fov_y: f32, aspect: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / (fov_y * 0.5).tan();
    Mat4::from_cols([
        [f / aspect, 0.0, 0.0, 0.0],
        [0.0, f, 0.0, 0.0],
        [0.0, 0.0, far / (near - far), -1.0],
        [0.0, 0.0, (far * near) / (near - far), 0.0],
    ])
}

fn unproject(inv_view_proj: Mat4, ndc: [f32; 3]) -> Option<Vec3> {
    let clip = inv_view_proj.transform_point([ndc[0], ndc[1], ndc[2], 1.0]);
    if clip[3].abs() <= 1e-8 {
        return None;
    }
    Some(Vec3::new(
        clip[0] / clip[3],
        clip[1] / clip[3],
        clip[2] / clip[3],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orbit_eye_sits_above_target_at_top_view() {
        let mut camera = OrbitCamera::default();
        camera.target = Vec3::new(10.0, 20.0, 0.0);
        camera.distance = 100.0;
        camera.set_top();
        let eye = camera.eye();
        assert!(eye.z > camera.target.z);
        assert!((eye.x - camera.target.x).abs() < 10.0);
        assert!((eye.y - camera.target.y).abs() < 10.0);
    }

    #[test]
    fn ray_hits_unit_aabb() {
        let ray = Ray3 {
            origin: Vec3::new(-10.0, 0.5, 0.5),
            direction: Vec3::new(1.0, 0.0, 0.0),
        };
        let t = ray
            .intersect_aabb(Vec3::new(0.0, 0.0, 0.0), Vec3::new(1.0, 1.0, 1.0))
            .unwrap();
        assert!((t - 10.0).abs() < 1e-4);
    }

    #[test]
    fn view_proj_is_invertible() {
        let camera = OrbitCamera {
            target: Vec3::new(100.0, 200.0, 10.0),
            distance: 500.0,
            ..OrbitCamera::default()
        };
        assert!(camera.view_proj(1.5).invert().is_some());
    }

    #[test]
    fn fit_world_backs_up_enough_to_frame_iso_silhouette() {
        let mut camera = OrbitCamera::default();
        camera.fit_world_with_aspect(
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(10_000.0, 8_000.0, 0.0),
            4_000.0,
            1.35,
        );
        let diagonal = 10_000.0_f32.hypot(8_000.0);
        assert!(camera.distance > diagonal * 1.45);
        assert!(camera.distance < diagonal * 2.4);
        let tight = fit_camera_distance(diagonal, 0.0, camera.fov_y, 0.7);
        let wide = fit_camera_distance(diagonal, 0.0, camera.fov_y, 1.6);
        assert!(tight > wide);
    }

    #[test]
    fn zoom_toward_keeps_pivot_and_shortens_distance() {
        let mut camera = OrbitCamera {
            target: Vec3::new(100.0, 100.0, 10.0),
            distance: 400.0,
            ..OrbitCamera::default()
        };
        let pivot = Vec3::new(80.0, 90.0, 0.0);
        camera.zoom_toward(0.5, Some(pivot));
        assert!((camera.distance - 200.0).abs() < 1e-3);
        assert!((camera.target.x - 90.0).abs() < 1e-3);
        assert!((camera.target.y - 95.0).abs() < 1e-3);
    }
}
