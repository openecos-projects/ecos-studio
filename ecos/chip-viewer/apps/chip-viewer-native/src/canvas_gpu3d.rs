use std::sync::Arc;

use crate::camera3d::OrbitCamera;
use crate::canvas_gpu::pack_rgba_u32;
use bytemuck::{Pod, Zeroable};

pub const MAX_3D_INSTANCES: usize = 180_000;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct CanvasUniform3d {
    pub view_proj: [[f32; 4]; 4],
    pub camera_pos: [f32; 3],
    pub z_scale: f32,
    pub light_dir: [f32; 3],
    pub _pad: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct GpuShapeInstance3d {
    pub rect_dbu: [i32; 4],
    pub z0: f32,
    pub z1: f32,
    pub fill_rgba: u32,
    pub flags: u32,
}

impl CanvasUniform3d {
    pub fn from_camera(camera: OrbitCamera, aspect: f32) -> Self {
        let view_proj = camera.view_proj(aspect);
        let light = crate::camera3d::Vec3::new(0.62, -0.18, 0.76).normalized();
        Self {
            view_proj: view_proj.cols,
            camera_pos: camera.eye().to_array(),
            z_scale: camera.z_scale,
            light_dir: light.to_array(),
            _pad: 0.0,
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
    let mut instances = Vec::new();
    for (geometry, style, z0, z1) in shapes {
        if instances.len() >= MAX_3D_INSTANCES {
            break;
        }
        let Some((rect_dbu, flags)) = geometry_to_instance(geometry) else {
            continue;
        };
        instances.push(GpuShapeInstance3d {
            rect_dbu,
            z0,
            z1: z1.max(z0 + 1.0),
            fill_rgba: pack_rgba_u32(layer_style_rgba_3d(&style)),
            flags,
        });
    }
    instances
}

pub fn slab_instance(
    rect: chipgeom_format::Rect32,
    z0: f32,
    z1: f32,
    rgba: [u8; 4],
) -> GpuShapeInstance3d {
    GpuShapeInstance3d {
        rect_dbu: [rect.lx, rect.ly, rect.hx, rect.hy],
        z0,
        z1: z1.max(z0 + 1.0),
        fill_rgba: pack_rgba_u32(rgba),
        flags: 0,
    }
}

pub fn layer_style_rgba_3d(style: &chip_display::LayerStyle) -> [u8; 4] {
    let source = if style.fill_alpha == 0 {
        [
            style.frame_rgba[0],
            style.frame_rgba[1],
            style.frame_rgba[2],
        ]
    } else {
        [style.rgba[0], style.rgba[1], style.rgba[2]]
    };
    let rgb = tech_layer_rgb(source);
    [rgb[0], rgb[1], rgb[2], 208]
}

fn tech_layer_rgb(rgb: [u8; 3]) -> [u8; 3] {
    const PAIRS: [([u8; 3], [u8; 3]); 14] = [
        ([126, 204, 255], [36, 214, 255]),
        ([255, 211, 111], [255, 164, 32]),
        ([119, 225, 175], [18, 232, 158]),
        ([255, 150, 185], [255, 58, 138]),
        ([176, 155, 255], [164, 112, 255]),
        ([255, 236, 150], [255, 210, 88]),
        ([255, 218, 112], [255, 188, 56]),
        ([255, 244, 186], [255, 226, 132]),
        ([242, 224, 255], [206, 184, 255]),
        ([108, 222, 236], [40, 236, 248]),
        ([255, 216, 120], [255, 176, 48]),
        ([255, 224, 142], [255, 198, 84]),
        ([160, 242, 255], [96, 236, 255]),
        ([84, 168, 255], [48, 168, 255]),
    ];
    let mut best = None;
    for (source, tech) in PAIRS {
        let dist = rgb_distance2(rgb, source);
        if best.is_none_or(|(best_dist, _)| dist < best_dist) {
            best = Some((dist, tech));
        }
    }
    if let Some((dist, tech)) = best {
        if dist <= 28 * 28 {
            return tech;
        }
    }
    neonize_rgb(rgb)
}

fn rgb_distance2(lhs: [u8; 3], rhs: [u8; 3]) -> i32 {
    let dr = i32::from(lhs[0]) - i32::from(rhs[0]);
    let dg = i32::from(lhs[1]) - i32::from(rhs[1]);
    let db = i32::from(lhs[2]) - i32::from(rhs[2]);
    dr * dr + dg * dg + db * db
}

fn neonize_rgb(rgb: [u8; 3]) -> [u8; 3] {
    let max = rgb.into_iter().max().unwrap_or(0) as f32;
    let min = rgb.into_iter().min().unwrap_or(0) as f32;
    if max - min < 8.0 {
        return [72, 196, 220];
    }
    let mid = (f32::from(rgb[0]) + f32::from(rgb[1]) + f32::from(rgb[2])) / 3.0;
    let boosted = rgb.map(|channel| {
        let value = mid + (f32::from(channel) - mid) * 1.55;
        value.clamp(16.0, 255.0)
    });
    let peak = boosted.into_iter().fold(1.0_f32, f32::max);
    boosted.map(|channel| ((channel / peak) * 232.0).round().clamp(24.0, 255.0) as u8)
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

const WGSL_SCENE_SHADER: &str = r#"
struct Uniform3d {
    view_proj: mat4x4<f32>,
    camera_pos: vec3<f32>,
    z_scale: f32,
    light_dir: vec3<f32>,
    pad: f32,
};

struct Instance3d {
    rect_dbu: vec4<i32>,
    z0: f32,
    z1: f32,
    fill_rgba: u32,
    flags: u32,
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

fn srgb_to_linear(srgb: f32) -> f32 {
    if srgb <= 0.04045 {
        return srgb / 12.92;
    }
    return pow((srgb + 0.055) / 1.055, 2.4);
}

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
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

    let face = vertex_index / 6u;
    let corner = vertex_index % 6u;
    let uv = face_uvs[corner];
    let inst = s_instances[instance_index];
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

    var out: VertexOutput;
    out.clip_position = u_scene.view_proj * vec4<f32>(position, 1.0);
    out.world_normal = face_normals[face];
    out.world_position = position;
    out.instance_idx = instance_index;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let inst = s_instances[in.instance_idx];
    let rgba = unpack_rgba(inst.fill_rgba);
    let albedo = vec3<f32>(
        srgb_to_linear(rgba.x),
        srgb_to_linear(rgba.y),
        srgb_to_linear(rgba.z),
    );
    let normal = normalize(in.world_normal);
    let view_dir = normalize(u_scene.camera_pos - in.world_position);
    let light_dir = normalize(u_scene.light_dir);
    let half_dir = normalize(light_dir + view_dir);
    let n_dot_l = max(dot(normal, light_dir), 0.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);
    let spec = pow(max(dot(normal, half_dir), 0.0), 42.0);
    let fresnel = pow(1.0 - n_dot_v, 3.0);
    let wrap = max(dot(normal, normalize(vec3<f32>(-light_dir.x, -light_dir.y, 0.35))), 0.0);

    let ambient = albedo * 0.08;
    let key = albedo * n_dot_l * 1.05;
    let fill = albedo * wrap * 0.16;
    let rim = vec3<f32>(0.18, 0.78, 1.0) * fresnel * (0.28 + 0.62 * (1.0 - n_dot_l));
    let highlight = vec3<f32>(0.82, 0.96, 1.0) * spec * 0.62;
    let color = ambient + key + fill + rim + highlight;
    return vec4<f32>(color * rgba.w, rgba.w);
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

struct OffscreenTarget {
    color_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    blit_bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
}

struct CanvasGpu3dResources {
    scene_pipeline: wgpu::RenderPipeline,
    blit_pipeline: wgpu::RenderPipeline,
    scene_bind_group_layout: wgpu::BindGroupLayout,
    blit_bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    instance_buffer: Option<wgpu::Buffer>,
    instance_capacity: u32,
    scene_bind_group: Option<wgpu::BindGroup>,
    offscreen: Option<OffscreenTarget>,
}

impl CanvasGpu3dResources {
    fn new(device: &wgpu::Device, target_format: wgpu::TextureFormat) -> Self {
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Canvas 3D Uniform Buffer"),
            size: std::mem::size_of::<CanvasUniform3d>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let scene_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_SCENE_3D_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_SCENE_SHADER.into()),
        });
        let blit_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_BLIT_3D_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_BLIT_SHADER.into()),
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
        let scene_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Canvas 3D Scene Pipeline Layout"),
                bind_group_layouts: &[&scene_bind_group_layout],
                push_constant_ranges: &[],
            });
        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Canvas 3D Blit Pipeline Layout"),
            bind_group_layouts: &[&blit_bind_group_layout],
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
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
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
            multisample: wgpu::MultisampleState::default(),
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
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Canvas 3D Sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            scene_pipeline,
            blit_pipeline,
            scene_bind_group_layout,
            blit_bind_group_layout,
            uniform_buffer,
            sampler,
            instance_buffer: None,
            instance_capacity: 0,
            scene_bind_group: None,
            offscreen: None,
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
            label: Some("Canvas 3D Color"),
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
        let depth = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Canvas 3D Depth"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let color_view = color.create_view(&wgpu::TextureViewDescriptor::default());
        let depth_view = depth.create_view(&wgpu::TextureViewDescriptor::default());
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
            depth_view,
            blit_bind_group,
            width,
            height,
        });
    }

    fn upload_instances(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        instances: &[GpuShapeInstance3d],
    ) {
        let count = instances.len().max(1) as u32;
        if self.instance_capacity < count {
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Canvas 3D Instance Buffer"),
                size: (count as u64).max(64) * std::mem::size_of::<GpuShapeInstance3d>() as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.instance_capacity = count.max(64);
            self.instance_buffer = Some(buffer);
            self.scene_bind_group = None;
        }
        if let Some(buffer) = &self.instance_buffer {
            if !instances.is_empty() {
                queue.write_buffer(buffer, 0, bytemuck::cast_slice(instances));
            }
            if self.scene_bind_group.is_none() {
                self.scene_bind_group =
                    Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("Canvas 3D Scene Bind Group"),
                        layout: &self.scene_bind_group_layout,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: self.uniform_buffer.as_entire_binding(),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: buffer.as_entire_binding(),
                            },
                        ],
                    }));
            }
        }
    }
}

pub struct CanvasGpu3dCallback {
    pub uniform: CanvasUniform3d,
    pub instances: Arc<Vec<GpuShapeInstance3d>>,
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
        if callback_resources.get::<CanvasGpu3dResources>().is_none() {
            callback_resources.insert(CanvasGpu3dResources::new(device, self.target_format));
        }
        let resources: &mut CanvasGpu3dResources = callback_resources.get_mut().unwrap();
        let width = self.target_pixels[0].max(1);
        let height = self.target_pixels[1].max(1);
        resources.ensure_offscreen(device, width, height);
        resources.upload_instances(device, queue, &self.instances);
        queue.write_buffer(
            &resources.uniform_buffer,
            0,
            bytemuck::bytes_of(&self.uniform),
        );
        let Some(offscreen) = resources.offscreen.as_ref() else {
            return Vec::new();
        };
        let Some(bind_group) = resources.scene_bind_group.as_ref() else {
            return Vec::new();
        };
        {
            let mut pass = egui_encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Canvas 3D Scene Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &offscreen.color_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &offscreen.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            if !self.instances.is_empty() {
                pass.set_pipeline(&resources.scene_pipeline);
                pass.set_bind_group(0, bind_group, &[]);
                pass.draw(0..36, 0..self.instances.len() as u32);
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
        let resources: &CanvasGpu3dResources = callback_resources.get().unwrap();
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
    let half_y = camera.distance * (camera.fov_y * 0.5).tan();
    let half_x = half_y * aspect.max(0.25);
    let pad = half_x.max(half_y) * 1.35;
    let lx = (camera.target.x - pad).floor() as i32;
    let ly = (camera.target.y - pad).floor() as i32;
    let hx = (camera.target.x + pad).ceil() as i32;
    let hy = (camera.target.y + pad).ceil() as i32;
    chipgeom_format::Rect32 {
        lx: lx.max(world.lx),
        ly: ly.max(world.ly),
        hx: hx.min(world.hx).max(lx + 1),
        hy: hy.min(world.hy).max(ly + 1),
    }
}

pub fn die_diagonal(world: chipgeom_format::Rect32) -> f32 {
    let width = (world.hx - world.lx).max(1) as f32;
    let height = (world.hy - world.ly).max(1) as f32;
    width.hypot(height)
}

pub fn use_overview_slabs(camera: OrbitCamera, world: chipgeom_format::Rect32) -> bool {
    camera.distance > die_diagonal(world) * 0.9
}

pub const OVERVIEW_INSTANCE_BUDGET: usize = 48_000;

pub fn overview_lod_level(camera: OrbitCamera, world: chipgeom_format::Rect32) -> u8 {
    let ratio = camera.distance / die_diagonal(world).max(1.0);
    if ratio > 1.0 {
        3
    } else if ratio > 0.5 {
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

pub fn overview_tile_rgba_3d(style: &chip_display::LayerStyle, shape_count: u32) -> [u8; 4] {
    let mut rgba = layer_style_rgba_3d(style);
    let occupancy = 90.0 + (shape_count.max(1) as f32).sqrt() * 8.0;
    rgba[3] = occupancy.round().clamp(90.0, 210.0) as u8;
    rgba
}

pub fn push_overview_tile_instance(
    instances: &mut Vec<GpuShapeInstance3d>,
    bbox: chipgeom_format::Rect32,
    shape_count: u32,
    z0: f32,
    z1: f32,
    style: &chip_display::LayerStyle,
) -> bool {
    if shape_count == 0 || instances.len() >= MAX_3D_INSTANCES {
        return false;
    }
    if bbox.hx <= bbox.lx || bbox.hy <= bbox.ly {
        return false;
    }
    instances.push(slab_instance(
        bbox,
        z0,
        z1,
        overview_tile_rgba_3d(style, shape_count),
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
            chip_display::LayerStyle::default_for_layer(1),
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
        assert_eq!(std::mem::size_of::<GpuShapeInstance3d>(), 32);
    }

    #[test]
    fn three_d_fill_uses_opaque_tech_metal_color() {
        let style = chip_display::LayerStyle::default_for_metadata(1, "MET1", 0);
        let rgba = layer_style_rgba_3d(&style);
        assert_eq!(rgba[3], 208);
        assert!(rgba[2] > rgba[0]);
        assert_ne!(&rgba[..3], &style.rgba[..3]);
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
        camera.fit_world(
            crate::camera3d::Vec3::new(world.lx as f32, world.ly as f32, 0.0),
            crate::camera3d::Vec3::new(world.hx as f32, world.hy as f32, 0.0),
            4_000.0,
        );
        assert!(use_overview_slabs(camera, world));
        assert_eq!(overview_lod_level(camera, world), 3);
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
        let style = chip_display::LayerStyle::default_for_metadata(1, "MET1", 0);
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
        assert!(instances[0].fill_rgba >> 24 < 208);
    }

    #[test]
    fn denser_overview_tiles_use_higher_alpha() {
        let style = chip_display::LayerStyle::default_for_metadata(2, "MET2", 1);
        let sparse = overview_tile_rgba_3d(&style, 1);
        let dense = overview_tile_rgba_3d(&style, 10_000);
        assert!(dense[3] > sparse[3]);
        assert_eq!(&dense[..3], &sparse[..3]);
    }
}
