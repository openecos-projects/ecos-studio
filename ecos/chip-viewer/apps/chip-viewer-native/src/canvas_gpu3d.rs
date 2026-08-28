use std::sync::Arc;

use crate::camera3d::OrbitCamera;
use crate::canvas_gpu::pack_rgba_u32;

pub const MAX_3D_INSTANCES: usize = 2_500_000;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Hash)]
pub enum ShadingStyle {
    #[default]
    Normal = 0,
    Cartoon = 1,
    Tech = 2,
    Iridescent = 3,
    Translucent = 4,
}

impl ShadingStyle {
    pub const ALL: &'static [ShadingStyle] = &[
        ShadingStyle::Normal,
        ShadingStyle::Cartoon,
        ShadingStyle::Tech,
        ShadingStyle::Iridescent,
        ShadingStyle::Translucent,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Normal => "Normal",
            Self::Cartoon => "Cartoon",
            Self::Tech => "Tech",
            Self::Iridescent => "Iridescent",
            Self::Translucent => "Translucent",
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CanvasUniform3d {
    pub view_proj: [[f32; 4]; 4],
    pub camera_pos: [f32; 3],
    pub z_scale: f32,
    pub light_dir: [f32; 3],
    pub distance: f32,
    pub bg_color: [f32; 4],
    pub render_flags: u32,
    pub z_cut: f32,
    pub shading_mode: u32,
    pub time: f32,
    pub lighting_mode: u32,
    pub _pad_uniform: [u32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuShapeInstance3d {
    pub rect_dbu: [i32; 4],
    pub z0: f32,
    pub z1: f32,
    pub fill_rgba: u32,
    pub material_params: u32,
    pub semantic_info: u32,
    pub flags: u32,
    pub _pad: [u32; 2],
}

impl CanvasUniform3d {
    pub fn from_camera(
        camera: OrbitCamera,
        aspect: f32,
        bg_color: [f32; 4],
        show_grid: bool,
        show_fog: bool,
        z_cut: f32,
        shading_style: ShadingStyle,
        lighting_preset: chip_display::LightingPreset,
        time: f32,
    ) -> Self {
        let view_proj = camera.view_proj(aspect);
        let light = match lighting_preset {
            chip_display::LightingPreset::Laboratory => {
                crate::camera3d::Vec3::new(0.0, 0.0, 1.0).normalized()
            }
            chip_display::LightingPreset::Dramatic => {
                crate::camera3d::Vec3::new(0.70, -0.45, 0.55).normalized()
            }
            chip_display::LightingPreset::Blueprint => {
                crate::camera3d::Vec3::new(0.20, -0.20, 0.95).normalized()
            }
            chip_display::LightingPreset::Softbox => {
                crate::camera3d::Vec3::new(0.35, -0.35, 0.85).normalized()
            }
            chip_display::LightingPreset::Studio => {
                crate::camera3d::Vec3::new(0.45, -0.25, 0.86).normalized()
            }
        };
        let mut flags = 0u32;
        if show_grid {
            flags |= 1;
        }
        if show_fog {
            flags |= 2;
        }
        Self {
            view_proj: view_proj.cols,
            camera_pos: camera.eye().to_array(),
            z_scale: camera.z_scale,
            light_dir: light.to_array(),
            distance: camera.distance,
            bg_color,
            render_flags: flags,
            z_cut,
            shading_mode: shading_style as u32,
            time,
            lighting_mode: lighting_preset as u32,
            _pad_uniform: [0; 3],
        }
    }
}

pub fn build_gpu_instances_3d(
    shapes: impl Iterator<
        Item = (
            chip_view_db::ShapeGeometry,
            chip_display::LayerStyle,
            f32,
            f32,
        ),
    >,
) -> Vec<GpuShapeInstance3d> {
    let with_role = shapes.map(|(g, s, z0, z1)| {
        let role = chip_display::LayerRole::Metal { level: 1 };
        let mat = chip_display::MaterialKind::from_role(role);
        (g, s, role, mat, z0, z1, 0)
    });
    build_gpu_instances_3d_with_flags(with_role)
}

pub fn build_gpu_instances_3d_with_flags(
    shapes: impl Iterator<
        Item = (
            chip_view_db::ShapeGeometry,
            chip_display::LayerStyle,
            chip_display::LayerRole,
            chip_display::MaterialKind,
            f32,
            f32,
            u32,
        ),
    >,
) -> Vec<GpuShapeInstance3d> {
    let mut instances = Vec::new();
    for (geometry, style, role, material, z0, z1, extra_flags) in shapes {
        if instances.len() >= MAX_3D_INSTANCES {
            break;
        }
        let Some((rect_dbu, flags)) = geometry_to_instance(geometry) else {
            continue;
        };
        let params = material.default_params();
        let material_params = chip_display::MaterialKind::pack_params(params);
        let semantic_info =
            chip_display::MaterialKind::pack_semantic_info(role, material, 0, style.layer_id);
        instances.push(GpuShapeInstance3d {
            rect_dbu,
            z0,
            z1: z1.max(z0 + 1.0),
            fill_rgba: pack_rgba_u32(layer_style_rgba_3d(&style, params.alpha)),
            material_params,
            semantic_info,
            flags: flags | extra_flags,
            _pad: [0, 0],
        });
    }
    instances
}

pub fn slab_instance(
    rect: chipgeom_format::Rect32,
    z0: f32,
    z1: f32,
    rgba: [u8; 4],
    material_params: u32,
    semantic_info: u32,
    flags: u32,
) -> GpuShapeInstance3d {
    GpuShapeInstance3d {
        rect_dbu: [rect.lx, rect.ly, rect.hx, rect.hy],
        z0,
        z1: z1.max(z0 + 1.0),
        fill_rgba: pack_rgba_u32(rgba),
        material_params,
        semantic_info,
        flags,
        _pad: [0, 0],
    }
}

pub fn layer_style_rgba_3d(style: &chip_display::LayerStyle, _alpha: f32) -> [u8; 4] {
    let rgb = if style.fill_alpha == 0 {
        [
            style.frame_rgba[0],
            style.frame_rgba[1],
            style.frame_rgba[2],
        ]
    } else {
        [style.rgba[0], style.rgba[1], style.rgba[2]]
    };
    [rgb[0], rgb[1], rgb[2], 255]
}

fn geometry_to_instance(geometry: chip_view_db::ShapeGeometry) -> Option<([i32; 4], u32)> {
    match geometry {
        chip_view_db::ShapeGeometry::Rect(rect) => {
            if rect.hx <= rect.lx || rect.hy <= rect.ly {
                return None;
            }
            Some(([rect.lx, rect.ly, rect.hx, rect.hy], 0))
        }
        chip_view_db::ShapeGeometry::Line(line) => Some((line_to_rect_dbu(line), 1)),
        chip_view_db::ShapeGeometry::Point(point) => {
            let half = 80;
            Some((
                [
                    point.point.x.saturating_sub(half),
                    point.point.y.saturating_sub(half),
                    point.point.x.saturating_add(half),
                    point.point.y.saturating_add(half),
                ],
                2,
            ))
        }
    }
}

fn line_to_rect_dbu(line: chipgeom_format::LinePayload) -> [i32; 4] {
    let width = line.width.abs().max(80);
    let half = (width / 2).max(40);
    if line.begin.y == line.end.y {
        let y = line.begin.y;
        [
            line.begin.x.min(line.end.x),
            y.saturating_sub(half),
            line.begin.x.max(line.end.x),
            y.saturating_add(half),
        ]
    } else if line.begin.x == line.end.x {
        let x = line.begin.x;
        [
            x.saturating_sub(half),
            line.begin.y.min(line.end.y),
            x.saturating_add(half),
            line.begin.y.max(line.end.y),
        ]
    } else {
        [
            line.begin.x.min(line.end.x).saturating_sub(half),
            line.begin.y.min(line.end.y).saturating_sub(half),
            line.begin.x.max(line.end.x).saturating_add(half),
            line.begin.y.max(line.end.y).saturating_add(half),
        ]
    }
}

pub const FLAG_LINE: u32 = 1;
pub const FLAG_POINT: u32 = 2;
pub const FLAG_GROUND_GRID: u32 = 4;
pub const FLAG_SELECTED: u32 = 8;
pub const FLAG_HIGHLIGHTED: u32 = 16;
pub const FLAG_FLAT: u32 = 32;
pub const FLAG_OVERVIEW_TILE: u32 = 64;

pub fn ground_grid_instance(world: chipgeom_format::Rect32) -> GpuShapeInstance3d {
    let diag = die_diagonal(world);
    let pad = (diag * 2.5).max(100_000.0) as i32;
    GpuShapeInstance3d {
        rect_dbu: [
            world.lx.saturating_sub(pad),
            world.ly.saturating_sub(pad),
            world.hx.saturating_add(pad),
            world.hy.saturating_add(pad),
        ],
        z0: -2.0,
        z1: 0.0,
        fill_rgba: pack_rgba_u32([40, 45, 55, 255]),
        material_params: 0,
        semantic_info: 0,
        flags: FLAG_GROUND_GRID,
        _pad: [0, 0],
    }
}

const WGSL_SCENE_SHADER: &str = r#"
struct Uniform3d {
    view_proj: mat4x4<f32>,
    camera_pos: vec3<f32>,
    z_scale: f32,
    light_dir: vec3<f32>,
    distance: f32,
    bg_color: vec4<f32>,
    render_flags: u32,
    z_cut: f32,
    shading_mode: u32,
    time: f32,
    lighting_mode: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

struct Instance3d {
    rect_dbu: vec4<i32>,
    z0: f32,
    z1: f32,
    fill_rgba: u32,
    material_params: u32,
    semantic_info: u32,
    flags: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> u_scene: Uniform3d;
@group(0) @binding(1) var<storage, read> s_instances: array<Instance3d>;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_normal: vec3<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) @interpolate(flat) instance_idx: u32,
};

fn unpack_rgba(packed: u32) -> vec4<f32> {
    let r = f32(packed & 0xFFu) / 255.0;
    let g = f32((packed >> 8u) & 0xFFu) / 255.0;
    let b = f32((packed >> 16u) & 0xFFu) / 255.0;
    let a = f32((packed >> 24u) & 0xFFu) / 255.0;
    return vec4<f32>(r, g, b, a);
}

struct MaterialUnpacked {
    metalness: f32,
    roughness: f32,
    specular: f32,
    emission: f32,
    role_id: u32,
    material_kind: u32,
    layer_level: u32,
    layer_id: u32,
};

fn unpack_material(inst: Instance3d) -> MaterialUnpacked {
    var out: MaterialUnpacked;
    out.metalness = f32(inst.material_params & 0xFFu) / 255.0;
    out.roughness = f32((inst.material_params >> 8u) & 0xFFu) / 255.0;
    out.specular = f32((inst.material_params >> 16u) & 0xFFu) / 255.0;
    out.emission = f32((inst.material_params >> 24u) & 0xFFu) / 255.0;

    out.role_id = inst.semantic_info & 0xFFu;
    out.material_kind = (inst.semantic_info >> 8u) & 0xFFu;
    out.layer_level = (inst.semantic_info >> 16u) & 0xFFu;
    out.layer_id = (inst.semantic_info >> 24u) & 0xFFu;
    return out;
}

fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
    return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

fn spectral_rainbow(t: f32) -> vec3<f32> {
    // Continuous visible spectrum mapping: Red -> Orange -> Gold -> Green -> Cyan -> Blue -> Violet -> Magenta
    let p = fract(t);
    let r = clamp(abs(p * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    let g = clamp(2.0 - abs(p * 6.0 - 2.0), 0.0, 1.0);
    let b = clamp(2.0 - abs(p * 6.0 - 4.0), 0.0, 1.0);
    let rose = pow(sin(p * 3.14159), 2.0) * 0.12;
    return clamp(vec3<f32>(r, g, b) + vec3<f32>(rose * 0.6, 0.0, rose), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn material_iridescence_weight(material_kind: u32) -> f32 {
    if material_kind == 7u { return 0.70; } // Passivation (strongest optical interference)
    if material_kind == 2u { return 0.35; } // Copper (broad gold -> violet -> blue)
    if material_kind == 3u || material_kind == 11u { return 0.28; } // Aluminum / RDL
    if material_kind == 5u { return 0.20; } // Poly
    if material_kind == 0u { return 0.12; } // Silicon
    if material_kind == 4u || material_kind == 6u { return 0.08; } // Tungsten / Via
    return 0.0;
}

struct LightingResult {
    key_diffuse: vec3<f32>,
    fill_diffuse: vec3<f32>,
    ambient_diffuse: vec3<f32>,
    key_specular: f32,
    rim_factor: f32,
};

fn compute_lighting(n: vec3<f32>, v: vec3<f32>, l_world: vec3<f32>, mode: u32, roughness: f32) -> LightingResult {
    var res: LightingResult;
    let n_dot_v = max(dot(n, v), 0.0);
    let spec_power = mix(24.0, 96.0, 1.0 - roughness);

    let key_dir = normalize(l_world);
    let key_ndotl = max(dot(n, key_dir), 0.0);

    let fill_dir = normalize(vec3<f32>(-key_dir.x * 0.5, -key_dir.y * 0.5, 0.85));
    let fill_ndotl = max(dot(n, fill_dir), 0.0);

    let h = normalize(key_dir + v);
    let n_dot_h = max(dot(n, h), 0.0);
    let spec = pow(n_dot_h, spec_power);

    let up = n.z * 0.5 + 0.5;

    let is_sidewall = 1.0 - max(n.z, 0.0);
    let rim_term = is_sidewall * pow(1.0 - n_dot_v, 2.5);

    if mode == 1u {
        res.key_diffuse = vec3<f32>(0.45 * key_ndotl);
        res.fill_diffuse = vec3<f32>(0.30 * fill_ndotl);
        res.ambient_diffuse = vec3<f32>(mix(0.70, 0.90, up));
        res.key_specular = spec * 0.15;
        res.rim_factor = 0.04 * rim_term;
    } else if mode == 2u {
        res.key_diffuse = vec3<f32>(1.00, 0.96, 0.92) * (0.80 * pow(key_ndotl, 1.1));
        res.fill_diffuse = vec3<f32>(0.85, 0.92, 1.00) * (0.35 * fill_ndotl);
        res.ambient_diffuse = vec3<f32>(mix(0.40, 0.60, up));
        res.key_specular = spec * 0.45;
        res.rim_factor = 0.20 * rim_term;
    } else if mode == 3u {
        res.key_diffuse = vec3<f32>(0.75, 0.92, 1.00) * (0.55 * key_ndotl);
        res.fill_diffuse = vec3<f32>(0.40, 0.65, 0.90) * (0.35 * fill_ndotl);
        res.ambient_diffuse = vec3<f32>(mix(0.55, 0.75, up)) * vec3<f32>(0.75, 0.9, 1.0);
        res.key_specular = spec * 0.35;
        res.rim_factor = 0.25 * rim_term;
    } else if mode == 4u {
        res.key_diffuse = vec3<f32>(1.00, 0.98, 0.95) * (0.50 * smoothstep(0.0, 0.8, key_ndotl));
        res.fill_diffuse = vec3<f32>(0.92, 0.96, 1.00) * (0.40 * fill_ndotl);
        res.ambient_diffuse = vec3<f32>(mix(0.65, 0.80, up));
        res.key_specular = spec * 0.25;
        res.rim_factor = 0.15 * rim_term;
    } else {
        let warm_key = vec3<f32>(1.00, 0.96, 0.90) * (0.65 * key_ndotl);
        let cool_fill = vec3<f32>(0.88, 0.94, 1.00) * (0.35 * fill_ndotl);
        res.key_diffuse = warm_key;
        res.fill_diffuse = cool_fill;
        res.ambient_diffuse = vec3<f32>(mix(0.60, 0.78, up));
        res.key_specular = spec * 0.35;
        res.rim_factor = 0.18 * rim_term;
    }
    return res;
}

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    let face = vertex_index / 6u;
    let corner = vertex_index % 6u;

    var out: VertexOutput;
    out.instance_idx = instance_index;

    let inst = s_instances[instance_index];
    let is_ground_grid = (inst.flags & 4u) != 0u;

    if !is_ground_grid && u_scene.z_cut > 0.0 && inst.z0 > u_scene.z_cut {
        out.clip_position = vec4<f32>(0.0, 0.0, 0.0, 0.0);
        out.world_normal = vec3<f32>(0.0, 0.0, 1.0);
        out.world_position = vec3<f32>(0.0);
        return out;
    }

    var face_normals = array<vec3<f32>, 6>(
        vec3<f32>(0.0, 0.0, -1.0),
        vec3<f32>(0.0, 0.0, 1.0),
        vec3<f32>(0.0, -1.0, 0.0),
        vec3<f32>(0.0, 1.0, 0.0),
        vec3<f32>(-1.0, 0.0, 0.0),
        vec3<f32>(1.0, 0.0, 0.0),
    );
    var face_uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 1.0),
    );

    let uv = face_uvs[corner];
    let min_xy = vec2<f32>(f32(inst.rect_dbu.x), f32(inst.rect_dbu.y));
    let max_xy = vec2<f32>(f32(inst.rect_dbu.z), f32(inst.rect_dbu.w));
    let z0 = inst.z0 * u_scene.z_scale;
    let z1 = inst.z1 * u_scene.z_scale;

    var position = vec3<f32>(0.0);
    if face == 0u {
        position = vec3<f32>(mix(min_xy.x, max_xy.x, uv.x), mix(min_xy.y, max_xy.y, 1.0 - uv.y), z0);
    } else if face == 1u {
        position = vec3<f32>(mix(min_xy.x, max_xy.x, uv.x), mix(min_xy.y, max_xy.y, uv.y), z1);
    } else if face == 2u {
        position = vec3<f32>(mix(min_xy.x, max_xy.x, uv.x), min_xy.y, mix(z0, z1, uv.y));
    } else if face == 3u {
        position = vec3<f32>(mix(max_xy.x, min_xy.x, uv.x), max_xy.y, mix(z0, z1, uv.y));
    } else if face == 4u {
        position = vec3<f32>(min_xy.x, mix(max_xy.y, min_xy.y, uv.x), mix(z0, z1, uv.y));
    } else {
        position = vec3<f32>(max_xy.x, mix(min_xy.y, max_xy.y, uv.x), mix(z0, z1, uv.y));
    }

    out.clip_position = u_scene.view_proj * vec4<f32>(position, 1.0);
    out.world_normal = face_normals[face];
    out.world_position = position;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let inst = s_instances[in.instance_idx];

    if ((inst.flags & 4u) != 0u) {
        discard;
    }

    if (in.world_position.z > u_scene.z_cut * u_scene.z_scale) {
        discard;
    }

    let mat = unpack_material(inst);
    let rgba = unpack_rgba(inst.fill_rgba);
    let albedo = rgba.rgb;
    let n = normalize(in.world_normal);
    let v = normalize(u_scene.camera_pos - in.world_position);
    let l_world = normalize(u_scene.light_dir);
    let n_dot_v = max(dot(n, v), 0.0);
    let is_sidewall = 1.0 - max(n.z, 0.0);

    let lighting = compute_lighting(n, v, l_world, u_scene.lighting_mode, mat.roughness);

    let is_via_mat = (mat.material_kind == 6u || mat.role_id == 2u || (mat.role_id >= 50u && mat.role_id <= 80u));
    let contact_ao = select(1.0, 0.82, is_via_mat && is_sidewall > 0.8);

    let pixel_size_dbu = max(fwidth(in.world_position.x), fwidth(in.world_position.y));
    let feature_w_px = f32(inst.rect_dbu.z - inst.rect_dbu.x) / max(pixel_size_dbu, 1.0);
    let feature_h_px = f32(inst.rect_dbu.w - inst.rect_dbu.y) / max(pixel_size_dbu, 1.0);
    let min_feature_px = min(feature_w_px, feature_h_px);
    let freq_damp = smoothstep(1.0, 5.0, min_feature_px);

    let is_overview = (inst.flags & 64u) != 0u;
    let feature_fade = select(smoothstep(4.0, 12.0, min_feature_px), 0.0, is_overview);

    let pos_xy = in.world_position.xy;
    let d_min = min(abs(pos_xy.x - f32(inst.rect_dbu.x)), abs(pos_xy.y - f32(inst.rect_dbu.y)));
    let d_max = min(abs(pos_xy.x - f32(inst.rect_dbu.z)), abs(pos_xy.y - f32(inst.rect_dbu.w)));
    let edge_dist_px = min(d_min, d_max) / max(pixel_size_dbu, 1.0);
    let bevel_edge = smoothstep(1.5, 0.0, edge_dist_px) * feature_fade * max(n.z, 0.0) * 0.08 * freq_damp;

    var color = albedo;
    var alpha = 1.0;

    if (u_scene.shading_mode == 0u) {
        let f0 = mix(vec3<f32>(0.04 * mat.specular), albedo, mat.metalness);
        let f_term = mix(f0, vec3<f32>(1.0), pow(1.0 - n_dot_v, 5.0) * is_sidewall * freq_damp);

        let total_diffuse = albedo * mix(1.0, 0.88, mat.metalness) * (lighting.key_diffuse + lighting.fill_diffuse + lighting.ambient_diffuse);
        let total_specular = (f_term * lighting.key_specular + vec3<f32>(lighting.rim_factor * (mat.metalness * 0.25 + 0.15))) * freq_damp;

        color = (total_diffuse * contact_ao + total_specular + albedo * bevel_edge) + vec3<f32>(mat.emission);
        alpha = 1.0;

    } else if (u_scene.shading_mode == 1u) {
        let n_dot_l = max(dot(n, l_world), 0.0);
        let cel_step = select(select(select(0.55, 0.80, n_dot_l > 0.15), 1.05, n_dot_l > 0.45), 1.30, n_dot_l > 0.75);

        let is_edge = n_dot_v < 0.26 && is_sidewall > 0.5 && freq_damp > 0.5;
        let edge_tint = albedo * 0.28;
        let base_cel = albedo * cel_step * contact_ao + vec3<f32>(max(n.z, 0.0) * 0.15);

        color = select(base_cel, edge_tint, is_edge);
        alpha = 1.0;

    } else if (u_scene.shading_mode == 2u) {
        var sem_color = albedo;
        if (mat.material_kind == 2u || mat.material_kind == 3u) {
            sem_color = vec3<f32>(0.0, 0.85, 1.0);
        } else if (mat.material_kind == 11u || mat.role_id >= 90u) {
            sem_color = vec3<f32>(1.0, 0.75, 0.15);
        } else if (mat.material_kind == 6u) {
            sem_color = vec3<f32>(0.15, 0.50, 1.0);
        } else if (mat.material_kind == 5u) {
            sem_color = vec3<f32>(0.85, 0.0, 1.0);
        } else if (mat.material_kind == 9u) {
            sem_color = vec3<f32>(0.0, 0.90, 0.45);
        } else if (mat.material_kind == 8u) {
            sem_color = vec3<f32>(1.0, 0.15, 0.25);
        }

        let edge_glow = pow(1.0 - n_dot_v, 2.0) * 1.5 * is_sidewall * freq_damp;
        let body_tint = sem_color * 0.75;

        color = body_tint + sem_color * edge_glow;
        alpha = mix(0.45, 0.95, clamp(edge_glow, 0.0, 1.0));

    } else if (u_scene.shading_mode == 3u) {
        // Continuous thin-film optical shift without cyclic rings
        let view_tilt = clamp(1.0 - n_dot_v, 0.0, 1.0);
        let fresnel_irid = pow(view_tilt, 2.4);

        let phase = view_tilt * 0.40 + in.world_position.z * 0.0008;

        let spectral_color = spectral_rainbow(phase);
        let irid_weight = material_iridescence_weight(mat.material_kind);
        let iridescence_strength = fresnel_irid * irid_weight * 0.38 * freq_damp;

        let f0 = mix(vec3<f32>(0.04 * mat.specular), albedo, mat.metalness);
        let f_term = mix(f0, vec3<f32>(1.0), pow(view_tilt, 5.0) * is_sidewall * freq_damp);

        let diffuse = albedo * mix(1.0, 0.88, mat.metalness) * (lighting.key_diffuse + lighting.fill_diffuse + lighting.ambient_diffuse);
        let specular = (f_term * lighting.key_specular + vec3<f32>(lighting.rim_factor * (mat.metalness * 0.25 + 0.15))) * freq_damp;
        let base_lit = (diffuse * contact_ao + specular + albedo * bevel_edge);

        let iridescent_lit = mix(albedo, spectral_color, 0.45) * (lighting.key_diffuse + lighting.ambient_diffuse) + specular;
        color = mix(base_lit, iridescent_lit, iridescence_strength) + vec3<f32>(mat.emission);
        alpha = 1.0;

    } else {
        let edge_glow = pow(1.0 - n_dot_v, 2.2) * 2.0 * is_sidewall * freq_damp;
        let emissive_core = albedo * 0.75;
        color = emissive_core + albedo * edge_glow;
        alpha = mix(0.60, 1.0, clamp(edge_glow * 0.5, 0.0, 1.0));
    }

    if ((inst.flags & 8u) != 0u) {
        // Selected: Cyan accent
        color = mix(color, vec3<f32>(0.25, 0.85, 1.00), 0.55);
    }
    if ((inst.flags & 16u) != 0u) {
        // Highlighted: Amber/Gold accent
        color = mix(color, vec3<f32>(1.00, 0.85, 0.20), 0.55);
    }

    color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

    return vec4<f32>(color, alpha);
}
"#;

const WGSL_BLIT_SHADER: &str = r#"
@group(0) @binding(0) var color_tex: texture_2d<f32>;
@group(0) @binding(1) var color_samp: sampler;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    var uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 0.0),
    );
    var out: VertexOutput;
    out.clip_position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    out.uv = uvs[vertex_index];
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(color_tex, color_samp, in.uv);
}
"#;

const WGSL_MIP_DOWNSAMPLE_SHADER: &str = r#"
@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var src_samp: sampler;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
    );
    var uvs = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 0.0),
    );
    var out: VertexOutput;
    out.clip_position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    out.uv = uvs[vertex_index];
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(src_tex, src_samp, in.uv);
}
"#;

const WGSL_GRID_SHADER: &str = r#"
struct Uniform3d {
    view_proj: mat4x4<f32>,
    camera_pos: vec3<f32>,
    z_scale: f32,
    light_dir: vec3<f32>,
    distance: f32,
    bg_color: vec4<f32>,
    render_flags: u32,
    z_cut: f32,
    shading_mode: u32,
    time: f32,
    lighting_mode: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> u_scene: Uniform3d;

struct GridVertexInput {
    @location(0) position: vec2<f32>,
    @location(1) is_major: f32,
};

struct GridVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_pos: vec2<f32>,
    @location(1) is_major: f32,
    @location(2) alpha_fade: f32,
};

@vertex
fn vs_grid(in: GridVertexInput) -> GridVertexOutput {
    var out: GridVertexOutput;

    // Adaptive power-of-two grid step based on camera distance
    let log_dist = log2(max(u_scene.distance, 100.0) * 0.05);
    let step_power = floor(log_dist);
    let grid_step = pow(2.0, step_power) * 100.0;

    // Toroidal looping: snap grid center to nearest (grid_step * 5.0) under camera
    let snapped_center = floor(u_scene.camera_pos.xy / (grid_step * 5.0)) * (grid_step * 5.0);
    let world_xy = snapped_center + in.position * grid_step;
    let world_pos = vec3<f32>(world_xy, -0.5);

    out.clip_position = u_scene.view_proj * vec4<f32>(world_pos, 1.0);
    out.world_pos = world_xy;
    out.is_major = in.is_major;

    // Radial horizon fade
    let dist_from_cam = length(world_xy - u_scene.camera_pos.xy);
    let max_radius = grid_step * 45.0;
    out.alpha_fade = 1.0 - smoothstep(max_radius * 0.45, max_radius, dist_from_cam);

    return out;
}

@fragment
fn fs_grid(in: GridVertexOutput) -> @location(0) vec4<f32> {
    if ((u_scene.render_flags & 1u) == 0u) {
        discard;
    }
    let base_color = select(vec3<f32>(0.22, 0.28, 0.38), vec3<f32>(0.38, 0.48, 0.62), in.is_major > 0.5);
    let alpha = select(0.28, 0.65, in.is_major > 0.5) * in.alpha_fade;

    if (alpha <= 0.005) {
        discard;
    }
    return vec4<f32>(base_color, alpha);
}
"#;

fn create_grid_vertex_buffer(device: &wgpu::Device) -> (wgpu::Buffer, u32) {
    let mut vertices: Vec<f32> = Vec::new();
    let half_lines = 50;

    for i in -half_lines..=half_lines {
        let coord = i as f32;
        let is_major = if i % 5 == 0 { 1.0_f32 } else { 0.0_f32 };
        let bound = half_lines as f32;

        // Horizontal line: [-bound, coord] -> [bound, coord]
        vertices.extend_from_slice(&[-bound, coord, is_major]);
        vertices.extend_from_slice(&[bound, coord, is_major]);

        // Vertical line: [coord, -bound] -> [coord, bound]
        vertices.extend_from_slice(&[coord, -bound, is_major]);
        vertices.extend_from_slice(&[coord, bound, is_major]);
    }

    let count = (vertices.len() / 3) as u32;
    use wgpu::util::DeviceExt;
    let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Canvas 3D Grid VBO"),
        contents: bytemuck::cast_slice(&vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    (buffer, count)
}

pub struct OverviewBakeTarget {
    pub texture: wgpu::Texture,
    pub full_view: wgpu::TextureView,
    pub mip_views: Vec<wgpu::TextureView>,
    pub msaa_color_view: wgpu::TextureView,
    pub msaa_depth_view: wgpu::TextureView,
    pub sampler: wgpu::Sampler,
    pub size: u32,
    pub mip_count: u32,
    pub cache_key: Option<u64>,
}

impl OverviewBakeTarget {
    pub fn new(device: &wgpu::Device, size: u32) -> Self {
        let mip_count = (size as f32).log2().floor() as u32 + 1;
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Overview Bake Texture Mips"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 1,
            },
            mip_level_count: mip_count,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let msaa_color = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Overview Bake MSAA Color"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let msaa_depth = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Overview Bake MSAA Depth"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let full_view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Overview Bake Full View"),
            format: None,
            dimension: Some(wgpu::TextureViewDimension::D2),
            aspect: wgpu::TextureAspect::All,
            base_mip_level: 0,
            mip_level_count: Some(mip_count),
            base_array_layer: 0,
            array_layer_count: None,
            ..Default::default()
        });
        let mip_views: Vec<_> = (0..mip_count)
            .map(|mip| {
                texture.create_view(&wgpu::TextureViewDescriptor {
                    label: Some(&format!("Overview Bake Mip View {}", mip)),
                    format: None,
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    aspect: wgpu::TextureAspect::All,
                    base_mip_level: mip,
                    mip_level_count: Some(1),
                    base_array_layer: 0,
                    array_layer_count: None,
                    ..Default::default()
                })
            })
            .collect();
        let msaa_color_view = msaa_color.create_view(&wgpu::TextureViewDescriptor::default());
        let msaa_depth_view = msaa_depth.create_view(&wgpu::TextureViewDescriptor::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Overview Bake Anisotropic Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            anisotropy_clamp: 16,
            ..Default::default()
        });

        Self {
            texture,
            full_view,
            mip_views,
            msaa_color_view,
            msaa_depth_view,
            sampler,
            size,
            mip_count,
            cache_key: None,
        }
    }
}

struct OffscreenTarget {
    color_view: wgpu::TextureView,
    msaa_color_view: wgpu::TextureView,
    msaa_depth_view: wgpu::TextureView,
    blit_bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
}

struct CanvasGpu3dResources {
    scene_pipeline: wgpu::RenderPipeline,
    grid_pipeline: wgpu::RenderPipeline,
    grid_vertex_buffer: wgpu::Buffer,
    grid_vertex_count: u32,
    grid_bind_group: wgpu::BindGroup,
    blit_pipeline: wgpu::RenderPipeline,
    downsample_pipeline: wgpu::RenderPipeline,
    scene_bind_group_layout: wgpu::BindGroupLayout,
    blit_bind_group_layout: wgpu::BindGroupLayout,
    downsample_bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    instance_buffer: wgpu::Buffer,
    scene_bind_group: wgpu::BindGroup,
    sampler: wgpu::Sampler,
    current_key: Option<u64>,
    instance_count: u32,
    offscreen: Option<OffscreenTarget>,
    bake_target: Option<OverviewBakeTarget>,
}

impl CanvasGpu3dResources {
    fn new(device: &wgpu::Device, target_format: wgpu::TextureFormat) -> Self {
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Canvas 3D Uniform Buffer"),
            size: std::mem::size_of::<CanvasUniform3d>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Canvas 3D Persistent Instance Buffer"),
            size: (MAX_3D_INSTANCES * std::mem::size_of::<GpuShapeInstance3d>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let scene_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_SCENE_3D_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_SCENE_SHADER.into()),
        });
        let grid_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_GRID_3D_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_GRID_SHADER.into()),
        });
        let blit_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_BLIT_3D_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_BLIT_SHADER.into()),
        });
        let downsample_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_MIP_DOWNSAMPLE_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_MIP_DOWNSAMPLE_SHADER.into()),
        });
        let scene_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Canvas 3D Scene Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });
        let scene_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Canvas 3D Scene Bind Group"),
            layout: &scene_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: instance_buffer.as_entire_binding(),
                },
            ],
        });
        let grid_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Canvas 3D Grid Bind Group Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let grid_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Canvas 3D Grid Bind Group"),
            layout: &grid_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });
        let blit_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Canvas 3D Blit Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let downsample_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Canvas 3D Downsample Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let scene_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Canvas 3D Scene Pipeline Layout"),
                bind_group_layouts: &[&scene_bind_group_layout],
                push_constant_ranges: &[],
            });
        let grid_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Canvas 3D Grid Pipeline Layout"),
            bind_group_layouts: &[&grid_bind_group_layout],
            push_constant_ranges: &[],
        });
        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Canvas 3D Blit Pipeline Layout"),
            bind_group_layouts: &[&blit_bind_group_layout],
            push_constant_ranges: &[],
        });
        let downsample_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Canvas 3D Downsample Pipeline Layout"),
                bind_group_layouts: &[&downsample_bind_group_layout],
                push_constant_ranges: &[],
            });
        let scene_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Canvas 3D Scene Pipeline"),
            layout: Some(&scene_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &scene_shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &scene_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });
        let (grid_vertex_buffer, grid_vertex_count) = create_grid_vertex_buffer(device);
        let grid_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Canvas 3D Grid Pipeline"),
            layout: Some(&grid_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &grid_shader,
                entry_point: Some("vs_grid"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: (3 * std::mem::size_of::<f32>()) as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: (2 * std::mem::size_of::<f32>()) as wgpu::BufferAddress,
                            shader_location: 1,
                        },
                    ],
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &grid_shader,
                entry_point: Some("fs_grid"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: false,
                depth_compare: wgpu::CompareFunction::LessEqual,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });
        let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Canvas 3D Blit Pipeline"),
            layout: Some(&blit_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &blit_shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &blit_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });
        let downsample_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Canvas 3D Downsample Pipeline"),
            layout: Some(&downsample_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &downsample_shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &downsample_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Canvas 3D Sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            anisotropy_clamp: 16,
            ..Default::default()
        });
        Self {
            scene_pipeline,
            grid_pipeline,
            grid_vertex_buffer,
            grid_vertex_count,
            grid_bind_group,
            blit_pipeline,
            downsample_pipeline,
            scene_bind_group_layout,
            blit_bind_group_layout,
            downsample_bind_group_layout,
            uniform_buffer,
            instance_buffer,
            scene_bind_group,
            sampler,
            current_key: None,
            instance_count: 0,
            offscreen: None,
            bake_target: None,
        }
    }

    fn ensure_offscreen(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if self
            .offscreen
            .as_ref()
            .is_some_and(|target| target.width == width && target.height == height)
        {
            return;
        }
        let color = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Canvas 3D Color Resolve"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let msaa_color = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Canvas 3D Color MSAA"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let msaa_depth = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Canvas 3D Depth MSAA"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let color_view = color.create_view(&wgpu::TextureViewDescriptor::default());
        let msaa_color_view = msaa_color.create_view(&wgpu::TextureViewDescriptor::default());
        let msaa_depth_view = msaa_depth.create_view(&wgpu::TextureViewDescriptor::default());
        let blit_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Canvas 3D Blit Bind Group"),
            layout: &self.blit_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&color_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        self.offscreen = Some(OffscreenTarget {
            color_view,
            msaa_color_view,
            msaa_depth_view,
            blit_bind_group,
            width,
            height,
        });
    }

    fn ensure_scene(&mut self, queue: &wgpu::Queue, instances: &[GpuShapeInstance3d], key: u64) {
        if self.current_key == Some(key) && self.instance_count == instances.len() as u32 {
            return;
        }
        if !instances.is_empty() {
            let count = instances.len().min(MAX_3D_INSTANCES);
            queue.write_buffer(
                &self.instance_buffer,
                0,
                bytemuck::cast_slice(&instances[..count]),
            );
            self.instance_count = count as u32;
        } else {
            self.instance_count = 0;
        }
        self.current_key = Some(key);
    }

    pub fn ensure_bake_target(&mut self, device: &wgpu::Device) -> &mut OverviewBakeTarget {
        if self.bake_target.is_none() {
            self.bake_target = Some(OverviewBakeTarget::new(device, 2048));
        }
        self.bake_target.as_mut().unwrap()
    }

    pub fn generate_mipmaps(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        target: &OverviewBakeTarget,
    ) {
        for mip in 0..(target.mip_count - 1) {
            let src_view = &target.mip_views[mip as usize];
            let dst_view = &target.mip_views[(mip + 1) as usize];
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Mip Downsample Bind Group"),
                layout: &self.downsample_bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(src_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&target.sampler),
                    },
                ],
            });
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Mip Downsample Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: dst_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.downsample_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..6, 0..1);
        }
    }
}

pub struct CanvasGpu3dCallback {
    pub uniform: CanvasUniform3d,
    pub instances: Arc<Vec<GpuShapeInstance3d>>,
    pub instances_key: u64,
    pub target_pixels: [u32; 2],
    pub target_format: wgpu::TextureFormat,
}

impl egui_wgpu::CallbackTrait for CanvasGpu3dCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen_descriptor: &egui_wgpu::ScreenDescriptor,
        egui_encoder: &mut wgpu::CommandEncoder,
        callback_resources: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        if device.limits().max_storage_buffers_per_shader_stage < 1 {
            return Vec::new();
        }
        if callback_resources.get::<CanvasGpu3dResources>().is_none() {
            callback_resources.insert(CanvasGpu3dResources::new(device, self.target_format));
        }
        let Some(resources) = callback_resources.get_mut::<CanvasGpu3dResources>() else {
            return Vec::new();
        };
        let width = self.target_pixels[0].max(1);
        let height = self.target_pixels[1].max(1);
        resources.ensure_offscreen(device, width, height);
        resources.ensure_scene(queue, &self.instances, self.instances_key);
        queue.write_buffer(
            &resources.uniform_buffer,
            0,
            bytemuck::bytes_of(&self.uniform),
        );
        let Some(offscreen) = resources.offscreen.as_ref() else {
            return Vec::new();
        };
        {
            let mut pass = egui_encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Canvas 3D Scene Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &offscreen.msaa_color_view,
                    resolve_target: Some(&offscreen.color_view),
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: self.uniform.bg_color[0] as f64,
                            g: self.uniform.bg_color[1] as f64,
                            b: self.uniform.bg_color[2] as f64,
                            a: self.uniform.bg_color[3] as f64,
                        }),
                        store: wgpu::StoreOp::Discard,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &offscreen.msaa_depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            if (self.uniform.render_flags & 1) != 0 {
                pass.set_pipeline(&resources.grid_pipeline);
                pass.set_bind_group(0, &resources.grid_bind_group, &[]);
                pass.set_vertex_buffer(0, resources.grid_vertex_buffer.slice(..));
                pass.draw(0..resources.grid_vertex_count, 0..1);
            }
            if resources.instance_count > 0 {
                pass.set_pipeline(&resources.scene_pipeline);
                pass.set_bind_group(0, &resources.scene_bind_group, &[]);
                pass.draw(6..36, 0..resources.instance_count);
            }
        }
        Vec::new()
    }

    fn paint(
        &self,
        info: egui::PaintCallbackInfo,
        render_pass: &mut wgpu::RenderPass<'static>,
        callback_resources: &egui_wgpu::CallbackResources,
    ) {
        let Some(resources) = callback_resources.get::<CanvasGpu3dResources>() else {
            return;
        };
        let Some(offscreen) = resources.offscreen.as_ref() else {
            return;
        };
        let clip = info.clip_rect_in_pixels();
        let clip_min_x = clip.left_px.max(0) as u32;
        let clip_min_y = clip.top_px.max(0) as u32;
        let clip_w = clip.width_px.max(0) as u32;
        let clip_h = clip.height_px.max(0) as u32;
        if clip_w == 0 || clip_h == 0 {
            return;
        }
        render_pass.set_scissor_rect(clip_min_x, clip_min_y, clip_w, clip_h);
        render_pass.set_pipeline(&resources.blit_pipeline);
        render_pass.set_bind_group(0, &offscreen.blit_bind_group, &[]);
        render_pass.draw(0..6, 0..1);
    }
}

pub fn query_rect_for_camera(
    camera: OrbitCamera,
    world: chipgeom_format::Rect32,
    aspect: f32,
) -> chipgeom_format::Rect32 {
    let eye = camera.eye();
    let target = camera.target;
    let mut lx = eye.x.min(target.x);
    let mut hx = eye.x.max(target.x);
    let mut ly = eye.y.min(target.y);
    let mut hy = eye.y.max(target.y);

    // Intersect frustum corner rays with ground plane z=0
    if let Some(inv) = camera.view_proj(aspect).invert() {
        for &(ndc_x, ndc_y) in &[
            (-1.0, -1.0),
            (1.0, -1.0),
            (-1.0, 1.0),
            (1.0, 1.0),
            (0.0, 0.0),
            (-1.0, 0.0),
            (1.0, 0.0),
        ] {
            if let (Some(near), Some(far)) = (
                crate::camera3d::unproject(inv, [ndc_x, ndc_y, 0.0]),
                crate::camera3d::unproject(inv, [ndc_x, ndc_y, 1.0]),
            ) {
                let dir = far.sub(near);
                if dir.z.abs() > 1e-5 {
                    let t = -near.z / dir.z;
                    if t > 0.0 && t < camera.distance * 10.0 {
                        let p = near.add(dir.scale(t));
                        lx = lx.min(p.x);
                        hx = hx.max(p.x);
                        ly = ly.min(p.y);
                        hy = hy.max(p.y);
                    }
                }
            }
        }
    }

    // Expand by camera reach so side pans are smooth
    let reach =
        (camera.distance * (camera.fov_y * 0.5).tan() * aspect.max(1.0)).max(camera.distance * 0.5);
    lx = lx.min(target.x - reach);
    hx = hx.max(target.x + reach);
    ly = ly.min(target.y - reach);
    hy = hy.max(target.y + reach);

    let pad_x = (hx - lx) * 0.20;
    let pad_y = (hy - ly) * 0.20;

    chipgeom_format::Rect32 {
        lx: ((lx - pad_x).floor() as i32).max(world.lx),
        ly: ((ly - pad_y).floor() as i32).max(world.ly),
        hx: ((hx + pad_x).ceil() as i32).min(world.hx).max(world.lx + 1),
        hy: ((hy + pad_y).ceil() as i32).min(world.hy).max(world.ly + 1),
    }
}

pub fn die_diagonal(world: chipgeom_format::Rect32) -> f32 {
    let width = (world.hx - world.lx).max(1) as f32;
    let height = (world.hy - world.ly).max(1) as f32;
    width.hypot(height)
}

pub fn use_overview_slabs(camera: OrbitCamera, world: chipgeom_format::Rect32) -> bool {
    camera.distance > die_diagonal(world) * 3.5
}

pub fn overview_blend_factor(camera: OrbitCamera, world: chipgeom_format::Rect32) -> f32 {
    let diag = die_diagonal(world).max(1.0);
    let d_min = diag * 1.8;
    let d_max = diag * 4.2;
    let t = ((camera.distance - d_min) / (d_max - d_min).max(1.0)).clamp(0.0, 1.0);
    // Smoothstep curve for seamless perceptual crossfade
    t * t * (3.0 - 2.0 * t)
}

pub const OVERVIEW_INSTANCE_BUDGET: usize = 48_000;

pub fn overview_lod_level(camera: OrbitCamera, world: chipgeom_format::Rect32) -> u8 {
    let ratio = camera.distance / die_diagonal(world).max(1.0);
    if ratio > 6.0 {
        3
    } else if ratio > 3.0 {
        2
    } else {
        1
    }
}

pub fn tile_is_full_die(bbox: chipgeom_format::Rect32, world: chipgeom_format::Rect32) -> bool {
    let tile_w = i64::from((bbox.hx - bbox.lx).max(1));
    let tile_h = i64::from((bbox.hy - bbox.ly).max(1));
    let world_w = i64::from((world.hx - world.lx).max(1));
    let world_h = i64::from((world.hy - world.ly).max(1));
    tile_w.saturating_mul(tile_h) * 10 >= world_w.saturating_mul(world_h) * 7
}

pub fn choose_overview_lod(
    lods: impl IntoIterator<Item = (u8, usize, usize)>,
    budget: usize,
) -> Option<u8> {
    let mut fallback = None;
    for (lod, total, useful) in lods {
        if useful == 0 {
            continue;
        }
        fallback = Some(lod);
        if total <= budget {
            return Some(lod);
        }
    }
    fallback
}

pub fn hash_bbox_u32(bbox: chipgeom_format::Rect32) -> u32 {
    let mut h = 0x811c9dc5u32;
    for val in [bbox.lx, bbox.ly, bbox.hx, bbox.hy] {
        for b in val.to_le_bytes() {
            h ^= u32::from(b);
            h = h.wrapping_mul(0x01000193);
        }
    }
    h
}

pub fn overview_tile_rgba_3d(
    style: &chip_display::LayerStyle,
    bbox: chipgeom_format::Rect32,
    shape_count: u32,
) -> [u8; 4] {
    let [r, g, b, _] = layer_style_rgba_3d(style, 1.0);
    let log_count = (shape_count.max(1) as f32).log10().clamp(0.0, 4.0) / 4.0;
    let occupancy_boost = 0.38 + log_count * 0.62;

    // Spatial hash for deterministic floorplan hue & lightness micro-jitter
    let hash = hash_bbox_u32(bbox);
    let hue_jitter = ((hash & 0xFF) as f32 / 255.0 - 0.5) * 0.16;
    let light_jitter = (((hash >> 8) & 0xFF) as f32 / 255.0 - 0.5) * 0.10;

    let mut rf = (r as f32 / 255.0) * (occupancy_boost + light_jitter);
    let mut gf = (g as f32 / 255.0) * (occupancy_boost + light_jitter);
    let mut bf = (b as f32 / 255.0) * (occupancy_boost + light_jitter);

    // Subtle hue rotation to distinguish functional macro blocks
    if hue_jitter.abs() > 0.001 {
        let temp_r = rf;
        rf = (temp_r + gf * hue_jitter).max(0.0);
        gf = (gf + bf * hue_jitter).max(0.0);
        bf = (bf + temp_r * hue_jitter).max(0.0);
    }

    let alpha = (130.0 + log_count * 125.0).clamp(130.0, 255.0) as u8;
    [
        (rf.clamp(0.0, 1.0) * 255.0).round() as u8,
        (gf.clamp(0.0, 1.0) * 255.0).round() as u8,
        (bf.clamp(0.0, 1.0) * 255.0).round() as u8,
        alpha,
    ]
}

pub fn push_overview_tile_instance(
    instances: &mut Vec<GpuShapeInstance3d>,
    bbox: chipgeom_format::Rect32,
    shape_count: u32,
    z0: f32,
    z1: f32,
    style: &chip_display::LayerStyle,
    role: chip_display::LayerRole,
) -> bool {
    if shape_count == 0 || instances.len() >= MAX_3D_INSTANCES {
        return false;
    }
    if bbox.hx <= bbox.lx || bbox.hy <= bbox.ly {
        return false;
    }
    let mat = chip_display::MaterialKind::from_role(role);
    let params = mat.default_params();
    let material_params = chip_display::MaterialKind::pack_params(params);
    let semantic_info =
        chip_display::MaterialKind::pack_semantic_info(role, mat, 0, style.layer_id);
    instances.push(slab_instance(
        bbox,
        z0,
        z1,
        overview_tile_rgba_3d(style, bbox, shape_count),
        material_params,
        semantic_info,
        FLAG_OVERVIEW_TILE,
    ));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_instances_use_axis_aligned_thickness() {
        let instances = build_gpu_instances_3d(std::iter::once((
            chip_view_db::ShapeGeometry::Line(chipgeom_format::LinePayload {
                begin: chipgeom_format::Point32 { x: 0, y: 10 },
                end: chipgeom_format::Point32 { x: 100, y: 10 },
                width: 8,
                flags: 0,
            }),
            chip_display::LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid),
            0.0,
            100.0,
        )));
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].rect_dbu[0], 0);
        assert_eq!(instances[0].rect_dbu[2], 100);
        assert!(instances[0].rect_dbu[3] > instances[0].rect_dbu[1]);
    }

    #[test]
    fn uniform_and_instance_layouts_are_aligned() {
        assert_eq!(std::mem::size_of::<CanvasUniform3d>() % 16, 0);
        assert_eq!(std::mem::size_of::<GpuShapeInstance3d>(), 48);
        assert_eq!(std::mem::size_of::<GpuShapeInstance3d>() % 16, 0);
    }

    #[test]
    fn three_d_fill_uses_opaque_tech_metal_color() {
        let style = chip_display::LayerStyle::default_for_metadata(
            1,
            "MET1",
            0,
            chip_display::ColorTheme::Vivid,
        );
        let rgba = layer_style_rgba_3d(&style, 1.0);
        assert_eq!(rgba[3], 255);
        assert_eq!(&rgba[..3], &style.rgba[..3]);
    }

    fn test_world() -> chipgeom_format::Rect32 {
        chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 10_000,
            hy: 8_000,
        }
    }

    #[test]
    fn fit_camera_uses_overview_tiles_instead_of_close_shapes() {
        let world = test_world();
        let mut camera = OrbitCamera::default();
        camera.distance = die_diagonal(world) * 5.0;
        assert!(use_overview_slabs(camera, world));
        assert_eq!(overview_lod_level(camera, world), 2);
        camera.distance = die_diagonal(world) * 0.4;
        assert!(!use_overview_slabs(camera, world));
        assert_eq!(overview_lod_level(camera, world), 1);
    }

    #[test]
    fn overview_lod_prefers_finer_tiles_and_skips_full_die_slabs() {
        let world = test_world();
        assert!(tile_is_full_die(world, world));
        assert!(!tile_is_full_die(
            chipgeom_format::Rect32 {
                lx: 100,
                ly: 100,
                hx: 400,
                hy: 400,
            },
            world,
        ));
        assert_eq!(
            choose_overview_lod([(0, 1_200, 1_200), (1, 80, 80), (3, 8, 0)], 48_000),
            Some(0)
        );
        assert_eq!(
            choose_overview_lod(
                [(0, 90_000, 90_000), (1, 12_000, 12_000), (3, 8, 8)],
                48_000
            ),
            Some(1)
        );
        assert_eq!(
            choose_overview_lod([(0, 8, 0), (1, 8, 0), (3, 8, 0)], 48_000),
            None
        );
    }

    #[test]
    fn overview_tiles_keep_snapshot_bboxes_not_full_die_slabs() {
        let world = test_world();
        let style = chip_display::LayerStyle::default_for_metadata(
            1,
            "MET1",
            0,
            chip_display::ColorTheme::Vivid,
        );
        let mut instances = Vec::new();
        let occupied = chipgeom_format::Rect32 {
            lx: 100,
            ly: 200,
            hx: 1_400,
            hy: 1_800,
        };
        assert!(push_overview_tile_instance(
            &mut instances,
            occupied,
            48,
            200.0,
            2_200.0,
            &style,
            chip_display::LayerRole::Metal { level: 1 },
        ));
        assert!(!push_overview_tile_instance(
            &mut instances,
            chipgeom_format::Rect32 {
                lx: 0,
                ly: 0,
                hx: 10,
                hy: 10,
            },
            0,
            200.0,
            2_200.0,
            &style,
            chip_display::LayerRole::Metal { level: 1 },
        ));
        assert_eq!(instances.len(), 1);
        assert_eq!(
            instances[0].rect_dbu,
            [occupied.lx, occupied.ly, occupied.hx, occupied.hy]
        );
        assert_ne!(
            instances[0].rect_dbu,
            [world.lx, world.ly, world.hx, world.hy]
        );
        assert!(instances[0].fill_rgba >> 24 >= 120);
    }

    #[test]
    fn denser_overview_tiles_use_higher_occupancy_brightness() {
        let style = chip_display::LayerStyle::default_for_metadata(
            2,
            "MET2",
            1,
            chip_display::ColorTheme::Vivid,
        );
        let bbox = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        let sparse = overview_tile_rgba_3d(&style, bbox, 1);
        let dense = overview_tile_rgba_3d(&style, bbox, 10_000);
        assert!(dense[3] >= sparse[3]);
        assert!(dense[0] >= sparse[0] && dense[1] >= sparse[1] && dense[2] >= sparse[2]);
        assert!(dense[0] > sparse[0] || dense[1] > sparse[1] || dense[2] > sparse[2]);
    }

    #[test]
    fn test_canvas_3d_render_pass_execution_all_styles() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter =
            pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()));
        let Some(adapter) = adapter else {
            return;
        };
        let device_result =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None));
        let Ok((device, queue)) = device_result else {
            return;
        };
        let mut resources = CanvasGpu3dResources::new(&device, wgpu::TextureFormat::Bgra8UnormSrgb);
        resources.ensure_offscreen(&device, 800, 600);
        let instances = vec![
            GpuShapeInstance3d {
                rect_dbu: [0, 0, 1000, 1000],
                z0: 0.0,
                z1: 100.0,
                fill_rgba: pack_rgba_u32([255, 0, 0, 255]),
                material_params: 0,
                semantic_info: 0,
                flags: 0,
                _pad: [0, 0],
            },
            ground_grid_instance(chipgeom_format::Rect32 {
                lx: -5000,
                ly: -5000,
                hx: 5000,
                hy: 5000,
            }),
        ];
        resources.ensure_scene(&queue, &instances, 1);

        for &shading_style in ShadingStyle::ALL {
            for &lighting_preset in chip_display::LightingPreset::ALL {
                let uniform = CanvasUniform3d::from_camera(
                    OrbitCamera::default(),
                    1.33,
                    [0.1, 0.1, 0.1, 1.0],
                    true,
                    true,
                    1e9,
                    shading_style,
                    lighting_preset,
                    1.5,
                );
                queue.write_buffer(&resources.uniform_buffer, 0, bytemuck::bytes_of(&uniform));
                let offscreen = resources.offscreen.as_ref().unwrap();
                let mut encoder =
                    device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Test Scene Pass"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &offscreen.msaa_color_view,
                            resolve_target: Some(&offscreen.color_view),
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                                store: wgpu::StoreOp::Discard,
                            },
                        })],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &offscreen.msaa_depth_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Clear(1.0),
                                store: wgpu::StoreOp::Discard,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    });
                    pass.set_pipeline(&resources.grid_pipeline);
                    pass.set_bind_group(0, &resources.grid_bind_group, &[]);
                    pass.set_vertex_buffer(0, resources.grid_vertex_buffer.slice(..));
                    pass.draw(0..resources.grid_vertex_count, 0..1);
                    pass.set_pipeline(&resources.scene_pipeline);
                    pass.set_bind_group(0, &resources.scene_bind_group, &[]);
                    pass.draw(6..36, 0..resources.instance_count);
                }
                queue.submit(Some(encoder.finish()));
            }
        }
    }

    #[test]
    fn overview_blend_factor_is_smooth_and_bounded() {
        let world = test_world();
        let mut camera = OrbitCamera::default();
        let diag = die_diagonal(world);
        camera.distance = diag * 1.0;
        assert_eq!(overview_blend_factor(camera, world), 0.0);
        camera.distance = diag * 3.0;
        let mid = overview_blend_factor(camera, world);
        assert!(mid > 0.0 && mid < 1.0);
        camera.distance = diag * 5.0;
        assert_eq!(overview_blend_factor(camera, world), 1.0);
    }

    #[test]
    fn test_overview_bake_target_creation_and_mipmaps() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter =
            pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()));
        let Some(adapter) = adapter else {
            return;
        };
        let device_result =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None));
        let Ok((device, queue)) = device_result else {
            return;
        };
        let mut resources = CanvasGpu3dResources::new(&device, wgpu::TextureFormat::Bgra8UnormSrgb);
        resources.ensure_bake_target(&device);
        let bake_target = resources.bake_target.as_ref().unwrap();
        assert_eq!(bake_target.size, 2048);
        assert_eq!(bake_target.mip_count, 12);
        assert_eq!(bake_target.mip_views.len(), 12);

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        let target = resources.bake_target.as_ref().unwrap();
        resources.generate_mipmaps(&device, &mut encoder, target);
        queue.submit(Some(encoder.finish()));
    }

    #[test]
    fn test_grid_vbo_and_pipeline_creation() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter =
            pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()));
        let Some(adapter) = adapter else {
            return;
        };
        let device_result =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None));
        let Ok((device, _queue)) = device_result else {
            return;
        };
        let resources = CanvasGpu3dResources::new(&device, wgpu::TextureFormat::Bgra8UnormSrgb);
        assert_eq!(resources.grid_vertex_count, 404);
    }
}
