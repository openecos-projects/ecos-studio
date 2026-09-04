//! GPU-instanced canvas renderer implementation for Chip Viewer

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};

pub const GPU_CANVAS_ENV: &str = "ECOS_GPU_CANVAS";
pub const GPU_CANVAS_DEBUG_ENV: &str = "ECOS_GPU_CANVAS_DEBUG";

pub const PATTERN_MIN_SIZE_PX: f32 = 20.0;
pub const MIN_SHAPE_SCREEN_SIZE: f32 = 2.0;

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CanvasUniform {
    pub world_center_dbu: [f32; 2],
    pub canvas_center_px: [f32; 2],
    pub scale_px_per_dbu: f32,
    pub pixels_per_point: f32,
    pub pattern_min_size_px: f32,
    pub min_shape_screen_size: f32,
    pub screen_size_px: [f32; 2],
    pub is_interacting: f32,
    pub global_alpha: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuShapeInstance {
    pub rect_dbu: [i32; 4],
    pub fill_rgba: u32,
    pub frame_rgba: u32,
    pub pattern_bits: u32,
    pub line_width_px: f32,
}

pub const GPU_TILE_SIZE_DBU: i32 = 600_000;

pub fn tile_coords_for_bbox(bbox: chipgeom_format::Rect32, tile_size: i32) -> Vec<(i32, i32)> {
    if tile_size <= 0 {
        return vec![(0, 0)];
    }
    let min_tx = (bbox.lx as f64 / tile_size as f64).floor() as i32;
    let max_tx = (bbox.hx as f64 / tile_size as f64).floor() as i32;
    let min_ty = (bbox.ly as f64 / tile_size as f64).floor() as i32;
    let max_ty = (bbox.hy as f64 / tile_size as f64).floor() as i32;

    let mut tiles = Vec::new();
    for tx in min_tx..=max_tx {
        for ty in min_ty..=max_ty {
            tiles.push((tx, ty));
        }
    }
    tiles
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct GpuBufferKey {
    pub geometry_epoch: u64,
    pub tile_x: i32,
    pub tile_y: i32,
    pub zoom_tier: u8,
    pub layer_visibility_hash: u64,
    pub object_visibility_bits: u32,
}

impl GpuBufferKey {
    pub fn compute_layer_visibility_hash(
        visible_layers: &BTreeMap<chipgeom_format::LayerId, bool>,
    ) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        for (layer_id, visible) in visible_layers {
            layer_id.hash(&mut hasher);
            visible.hash(&mut hasher);
        }
        hasher.finish()
    }

    pub fn zoom_tier(zoom: f32) -> u8 {
        if zoom > 1.25 {
            1
        } else {
            0
        }
    }
}

pub struct GpuCanvasState {
    pub enabled: bool,
    pub failed: bool,
    pub target_format: wgpu::TextureFormat,
}

impl GpuCanvasState {
    pub fn new_from_env(target_format: wgpu::TextureFormat) -> Self {
        Self::new_with_wgpu(true, target_format)
    }

    pub fn new_with_wgpu(has_wgpu: bool, target_format: wgpu::TextureFormat) -> Self {
        if !has_wgpu {
            return Self::cpu_only(target_format);
        }
        let env_var = std::env::var("ECOS_GPU_CANVAS").unwrap_or_else(|_| "1".to_string());
        let force_cpu = std::env::var("ECOS_FORCE_CPU")
            .ok()
            .map(|v| env_flag_requested(Some(&v)))
            .unwrap_or(false);
        let enabled = env_flag_requested(Some(&env_var)) && !force_cpu;
        Self {
            enabled,
            failed: false,
            target_format,
        }
    }

    pub fn cpu_only(target_format: wgpu::TextureFormat) -> Self {
        Self {
            enabled: false,
            failed: false,
            target_format,
        }
    }
}

pub fn env_flag_requested(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        ["1", "true", "yes", "on"]
            .iter()
            .any(|enabled| value.trim().eq_ignore_ascii_case(enabled))
    })
}

pub fn fill_pattern_id(pattern: chip_display::FillPattern) -> u32 {
    match pattern {
        chip_display::FillPattern::Hollow => 0,
        chip_display::FillPattern::Solid => 1,
        chip_display::FillPattern::SparseDots => 2,
        chip_display::FillPattern::DenseDots => 3,
        chip_display::FillPattern::DiagonalHatch => 4,
        chip_display::FillPattern::CrossHatch => 5,
        chip_display::FillPattern::HorizontalHatch => 6,
        chip_display::FillPattern::VerticalHatch => 7,
        chip_display::FillPattern::Grid => 8,
        chip_display::FillPattern::XMark => 9,
    }
}

pub fn pack_rgba_u32(rgba: [u8; 4]) -> u32 {
    u32::from_le_bytes(rgba)
}

pub const WGSL_CANVAS_SHADER: &str = r#"
struct CanvasUniform {
    world_center_dbu: vec2<f32>,
    canvas_center_px: vec2<f32>,
    scale_px_per_dbu: f32,
    pixels_per_point: f32,
    pattern_min_size_px: f32,
    min_shape_screen_size: f32,
    screen_size_px: vec2<f32>,
    is_interacting: f32,
    global_alpha: f32,
};

struct GpuShapeInstance {
    rect_dbu: vec4<i32>,
    fill_rgba: u32,
    frame_rgba: u32,
    pattern_bits: u32,
    line_width_px: f32,
};

@group(0) @binding(0) var<uniform> u_canvas: CanvasUniform;
@group(0) @binding(1) var<storage, read> s_instances: array<GpuShapeInstance>;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_uv: vec2<f32>,
    @location(1) rect_size_px: vec2<f32>,
    @location(2) @interpolate(flat) instance_idx: u32,
    @location(3) @interpolate(flat) shape_type: u32,
    @location(4) line_p1_px: vec2<f32>,
    @location(5) line_p2_px: vec2<f32>,
};

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    var quad_positions = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 1.0)
    );

    let unit_pos = quad_positions[vertex_index];
    let inst = s_instances[instance_index];
    let shape_type = inst.pattern_bits >> 16u;

    var screen_min: vec2<f32>;
    var screen_max: vec2<f32>;
    var line_p1_px = vec2<f32>(0.0);
    var line_p2_px = vec2<f32>(0.0);

    if shape_type == 0u {
        // Rect
        let world_min = vec2<f32>(f32(inst.rect_dbu.x), f32(inst.rect_dbu.y));
        let world_max = vec2<f32>(f32(inst.rect_dbu.z), f32(inst.rect_dbu.w));

        screen_min = vec2<f32>(
            u_canvas.canvas_center_px.x + (world_min.x - u_canvas.world_center_dbu.x) * u_canvas.scale_px_per_dbu,
            u_canvas.canvas_center_px.y - (world_max.y - u_canvas.world_center_dbu.y) * u_canvas.scale_px_per_dbu
        );
        screen_max = vec2<f32>(
            u_canvas.canvas_center_px.x + (world_max.x - u_canvas.world_center_dbu.x) * u_canvas.scale_px_per_dbu,
            u_canvas.canvas_center_px.y - (world_min.y - u_canvas.world_center_dbu.y) * u_canvas.scale_px_per_dbu
        );
    } else if shape_type == 1u {
        // Line
        let p1_world = vec2<f32>(f32(inst.rect_dbu.x), f32(inst.rect_dbu.y));
        let p2_world = vec2<f32>(f32(inst.rect_dbu.z), f32(inst.rect_dbu.w));
        
        let p1_screen = vec2<f32>(
            u_canvas.canvas_center_px.x + (p1_world.x - u_canvas.world_center_dbu.x) * u_canvas.scale_px_per_dbu,
            u_canvas.canvas_center_px.y - (p1_world.y - u_canvas.world_center_dbu.y) * u_canvas.scale_px_per_dbu
        );
        let p2_screen = vec2<f32>(
            u_canvas.canvas_center_px.x + (p2_world.x - u_canvas.world_center_dbu.x) * u_canvas.scale_px_per_dbu,
            u_canvas.canvas_center_px.y - (p2_world.y - u_canvas.world_center_dbu.y) * u_canvas.scale_px_per_dbu
        );
        
        let w = max(inst.line_width_px, u_canvas.min_shape_screen_size) * 0.5;
        screen_min = min(p1_screen, p2_screen) - vec2<f32>(w);
        screen_max = max(p1_screen, p2_screen) + vec2<f32>(w);
        
        // Pass line endpoints in quad-local pixel coordinates
        line_p1_px = p1_screen - screen_min;
        line_p2_px = p2_screen - screen_min;
    } else {
        // Point
        let p_world = vec2<f32>(f32(inst.rect_dbu.x), f32(inst.rect_dbu.y));
        let p_screen = vec2<f32>(
            u_canvas.canvas_center_px.x + (p_world.x - u_canvas.world_center_dbu.x) * u_canvas.scale_px_per_dbu,
            u_canvas.canvas_center_px.y - (p_world.y - u_canvas.world_center_dbu.y) * u_canvas.scale_px_per_dbu
        );
        let r = max(u_canvas.min_shape_screen_size, 2.0);
        screen_min = p_screen - vec2<f32>(r);
        screen_max = p_screen + vec2<f32>(r);
        line_p1_px = p_screen - screen_min; // center in quad-local coords
    }

    let screen_pos = mix(screen_min, screen_max, unit_pos);
    let rect_size_px = abs(screen_max - screen_min);

    let ndc_x = (screen_pos.x / u_canvas.screen_size_px.x) * 2.0 - 1.0;
    let ndc_y = 1.0 - (screen_pos.y / u_canvas.screen_size_px.y) * 2.0;

    var out: VertexOutput;
    out.clip_position = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
    out.local_uv = unit_pos;
    out.rect_size_px = rect_size_px;
    out.instance_idx = instance_index;
    out.shape_type = shape_type;
    out.line_p1_px = line_p1_px;
    out.line_p2_px = line_p2_px;
    return out;
}

fn srgb_to_linear(srgb: f32) -> f32 {
    if srgb <= 0.04045 {
        return srgb / 12.92;
    } else {
        return pow((srgb + 0.055) / 1.055, 2.4);
    }
}

fn unpack_rgba(packed: u32) -> vec4<f32> {
    let r = f32(packed & 0xFFu) / 255.0;
    let g = f32((packed >> 8u) & 0xFFu) / 255.0;
    let b = f32((packed >> 16u) & 0xFFu) / 255.0;
    let a = f32((packed >> 24u) & 0xFFu) / 255.0;
    return vec4<f32>(r, g, b, a);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let inst = s_instances[in.instance_idx];
    let fill_color = unpack_rgba(inst.fill_rgba);
    let frame_color = unpack_rgba(inst.frame_rgba);

    let rect_px = in.rect_size_px;
    let pixel_pos = in.local_uv * rect_px;

    let pattern_id = inst.pattern_bits & 0xFFFFu;
    let can_pattern = rect_px.x >= u_canvas.pattern_min_size_px && rect_px.y >= u_canvas.pattern_min_size_px;

    var is_filled = false;

    if u_canvas.is_interacting > 0.5 && pattern_id > 1u {
        is_filled = true;
    } else {
        switch pattern_id {
            case 1u: {
                is_filled = true;
            }
            case 2u: {
                if can_pattern {
                    let mod_pos = fract((pixel_pos - vec2<f32>(2.0)) / 9.0) * 9.0;
                    if length(mod_pos - vec2<f32>(0.8)) < 0.8 {
                        is_filled = true;
                    }
                }
            }
            case 3u: {
                if can_pattern {
                    let mod_pos = fract((pixel_pos - vec2<f32>(2.0)) / 5.0) * 5.0;
                    if length(mod_pos - vec2<f32>(0.8)) < 0.8 {
                        is_filled = true;
                    }
                }
            }
            case 4u, 5u: {
                if can_pattern {
                    let d = pixel_pos.x + pixel_pos.y;
                    if fract(d / 8.0) * 8.0 < 1.0 {
                        is_filled = true;
                    }
                    if pattern_id == 5u {
                        let d2 = pixel_pos.x - pixel_pos.y;
                        if fract(d2 / 8.0) * 8.0 < 1.0 {
                            is_filled = true;
                        }
                    }
                }
            }
            case 6u, 7u, 8u: {
                if can_pattern {
                    if pattern_id == 6u || pattern_id == 8u {
                        if fract((pixel_pos.y - 4.0) / 10.0) * 10.0 < 1.0 {
                            is_filled = true;
                        }
                    }
                    if pattern_id == 7u || pattern_id == 8u {
                        if fract((pixel_pos.x - 4.0) / 10.0) * 10.0 < 1.0 {
                            is_filled = true;
                        }
                    }
                }
            }
            case 9u: {
                if can_pattern {
                    let inset = 1.5;
                    let inner_size = rect_px - vec2<f32>(inset * 2.0);
                    if inner_size.x > 0.0 && inner_size.y > 0.0 {
                        let p = pixel_pos - vec2<f32>(inset);
                        let len = length(inner_size);
                        let d1 = abs(p.y * inner_size.x - p.x * inner_size.y) / len;
                        let p2 = vec2<f32>(p.x, inner_size.y - p.y);
                        let d2 = abs(p2.y * inner_size.x - p2.x * inner_size.y) / len;
                        if (d1 < 0.75 || d2 < 0.75) && p.x >= 0.0 && p.x <= inner_size.x && p.y >= 0.0 && p.y <= inner_size.y {
                            is_filled = true;
                        }
                    }
                } else {
                    is_filled = true;
                }
            }
            default: {}
        }
    }

    let fill_a = fill_color.a;
    let fill_rgb = fill_color.rgb * fill_a;
    
    var frame_a = frame_color.a;
    if rect_px.x < u_canvas.pattern_min_size_px || rect_px.y < u_canvas.pattern_min_size_px {
        frame_a = min(frame_a, 112.0 / 255.0);
    }
    let frame_rgb = frame_color.rgb * frame_a;

    var out_rgb = vec3<f32>(0.0);
    var out_a = 0.0;
    
    if is_filled {
        out_rgb = fill_rgb;
        out_a = fill_a;
    }

    if rect_px.x >= u_canvas.min_shape_screen_size || rect_px.y >= u_canvas.min_shape_screen_size {
        let stroke_w = max(inst.line_width_px, 1.0);
        var dist_to_edge = 0.0;
        if in.shape_type == 0u { // Rect
            dist_to_edge = min(min(pixel_pos.x, rect_px.x - pixel_pos.x), min(pixel_pos.y, rect_px.y - pixel_pos.y));
        } else if in.shape_type == 1u { // Line
            let pa = pixel_pos - in.line_p1_px;
            let ba = in.line_p2_px - in.line_p1_px;
            let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            let d = length(pa - ba * h);
            let radius = max(inst.line_width_px, u_canvas.min_shape_screen_size) * 0.5;
            dist_to_edge = radius - d;
            
            if dist_to_edge < 0.0 {
                is_filled = false; // Outside capsule
            }
        } else { // Point
            let d = length(pixel_pos - in.line_p1_px); // line_p1_px holds center
            let radius = max(u_canvas.min_shape_screen_size, 2.0) * 0.5; // smaller radius for point
            dist_to_edge = radius - d;
            
            if dist_to_edge < 0.0 {
                is_filled = false; // Outside circle
            }
        }
        
        if !is_filled {
            out_rgb = vec3<f32>(0.0);
            out_a = 0.0;
        }

        if dist_to_edge >= 0.0 && dist_to_edge <= stroke_w {
            out_rgb = frame_rgb + out_rgb * (1.0 - frame_a);
            out_a = frame_a + out_a * (1.0 - frame_a);
        }
    }

    return vec4<f32>(out_rgb * u_canvas.global_alpha, out_a * u_canvas.global_alpha);
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_canvas_env_flag_parsing() {
        for value in ["1", "true", "TRUE", "yes", "on"] {
            assert!(env_flag_requested(Some(value)));
        }
        for value in ["0", "false", "off", ""] {
            assert!(!env_flag_requested(Some(value)));
        }
        assert!(!env_flag_requested(None));
    }

    #[test]
    fn gpu_canvas_state_fallback_when_wgpu_unavailable() {
        let state = GpuCanvasState::new_with_wgpu(false, wgpu::TextureFormat::Bgra8Unorm);
        assert!(!state.enabled);
        assert!(!state.failed);

        let cpu_state = GpuCanvasState::cpu_only(wgpu::TextureFormat::Bgra8Unorm);
        assert!(!cpu_state.enabled);
        assert!(!cpu_state.failed);
    }

    #[test]
    fn test_tile_coords_single_tile() {
        let bbox = chipgeom_format::Rect32 {
            lx: 100,
            ly: 100,
            hx: 500,
            hy: 500,
        };
        let tiles = tile_coords_for_bbox(bbox, 1000);
        assert_eq!(tiles, vec![(0, 0)]);
    }

    #[test]
    fn test_tile_coords_straddle_boundary() {
        let bbox = chipgeom_format::Rect32 {
            lx: 800,
            ly: 800,
            hx: 1200,
            hy: 1200,
        };
        let tiles = tile_coords_for_bbox(bbox, 1000);
        assert_eq!(tiles, vec![(0, 0), (0, 1), (1, 0), (1, 1)]);
    }

    #[test]
    fn test_tile_coords_large_bbox() {
        let bbox = chipgeom_format::Rect32 {
            lx: 0,
            ly: 0,
            hx: 2500,
            hy: 1500,
        };
        let tiles = tile_coords_for_bbox(bbox, 1000);
        assert_eq!(tiles.len(), 6); // 3 x 2
    }

    #[test]
    fn fill_pattern_mapping_covers_all_patterns() {
        assert_eq!(fill_pattern_id(chip_display::FillPattern::Hollow), 0);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::Solid), 1);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::SparseDots), 2);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::DenseDots), 3);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::DiagonalHatch), 4);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::CrossHatch), 5);
        assert_eq!(
            fill_pattern_id(chip_display::FillPattern::HorizontalHatch),
            6
        );
        assert_eq!(fill_pattern_id(chip_display::FillPattern::VerticalHatch), 7);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::Grid), 8);
        assert_eq!(fill_pattern_id(chip_display::FillPattern::XMark), 9);
    }

    #[test]
    fn pack_rgba_u32_roundtrips_bytes() {
        let rgba = [0x12, 0x34, 0x56, 0x78];
        let packed = pack_rgba_u32(rgba);
        assert_eq!(packed.to_le_bytes(), rgba);
    }

    #[test]
    fn heatmap_texture_row_alignment_calculation() {
        let width = 20u32;
        let unpadded_bytes_per_row = (4 * width) as usize;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        assert_eq!(padded_bytes_per_row, 256);
        assert_eq!(padded_bytes_per_row % 256, 0);
    }
}

use wgpu::util::DeviceExt;

pub const MAX_CACHED_TILE_BUFFERS: usize = 128;

pub struct GpuBufferCacheEntry {
    pub instance_buffer: wgpu::Buffer,
    pub count: u32,
    pub bind_group: wgpu::BindGroup,
    pub last_used_frame: u64,
}

pub struct CanvasGpuResources {
    pub pipeline: wgpu::RenderPipeline,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub uniform_buffer: wgpu::Buffer,
    pub instance_buffers: std::collections::HashMap<GpuBufferKey, GpuBufferCacheEntry>,
}

impl CanvasGpuResources {
    pub fn new(device: &wgpu::Device, render_format: wgpu::TextureFormat) -> Option<Self> {
        if device.limits().max_storage_buffers_per_shader_stage < 1 {
            log::warn!("GPU device lacks storage buffers; GPU canvas disabled");
            return None;
        }

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Canvas Uniform Buffer"),
            size: std::mem::size_of::<CanvasUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("WGSL_CANVAS_SHADER"),
            source: wgpu::ShaderSource::Wgsl(WGSL_CANVAS_SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Canvas Bind Group Layout"),
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

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Canvas Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Canvas Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: render_format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        Some(Self {
            pipeline,
            bind_group_layout,
            uniform_buffer,
            instance_buffers: std::collections::HashMap::new(),
        })
    }
}

pub fn device_supports_storage_buffers(device: &wgpu::Device) -> bool {
    device.limits().max_storage_buffers_per_shader_stage >= 1
}

pub struct CanvasGpuCallback {
    pub uniform: CanvasUniform,
    pub instances: std::sync::Arc<Vec<GpuShapeInstance>>,
    pub buffer_key: GpuBufferKey,
    pub frame_counter: u64,
    pub target_format: wgpu::TextureFormat,
}

impl egui_wgpu::CallbackTrait for CanvasGpuCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen_descriptor: &egui_wgpu::ScreenDescriptor,
        _egui_encoder: &mut wgpu::CommandEncoder,
        callback_resources: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        if !device_supports_storage_buffers(device) {
            return Vec::new();
        }
        if callback_resources.get::<CanvasGpuResources>().is_none() {
            if let Some(res) = CanvasGpuResources::new(device, self.target_format) {
                callback_resources.insert(res);
            }
        }
        let Some(resources) = callback_resources.get_mut::<CanvasGpuResources>() else {
            return Vec::new();
        };

        queue.write_buffer(
            &resources.uniform_buffer,
            0,
            bytemuck::bytes_of(&self.uniform),
        );

        if self.instances.is_empty() {
            return Vec::new();
        }

        // Evict buffers from old geometry epochs
        resources
            .instance_buffers
            .retain(|key, _| key.geometry_epoch == self.buffer_key.geometry_epoch);

        if !resources.instance_buffers.contains_key(&self.buffer_key) {
            // LRU eviction if too many tiles are cached (skipping tiles used in the current frame)
            if resources.instance_buffers.len() >= MAX_CACHED_TILE_BUFFERS {
                if let Some(oldest_key) = resources
                    .instance_buffers
                    .iter()
                    .filter(|(_, entry)| entry.last_used_frame < self.frame_counter)
                    .min_by_key(|(_, entry)| entry.last_used_frame)
                    .map(|(k, _)| *k)
                {
                    resources.instance_buffers.remove(&oldest_key);
                }
            }

            let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Canvas Instance Buffer"),
                contents: bytemuck::cast_slice(&self.instances),
                usage: wgpu::BufferUsages::STORAGE,
            });

            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Canvas Bind Group"),
                layout: &resources.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: resources.uniform_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: buffer.as_entire_binding(),
                    },
                ],
            });

            resources.instance_buffers.insert(
                self.buffer_key,
                GpuBufferCacheEntry {
                    instance_buffer: buffer,
                    count: self.instances.len() as u32,
                    bind_group,
                    last_used_frame: self.frame_counter,
                },
            );
        } else {
            if let Some(entry) = resources.instance_buffers.get_mut(&self.buffer_key) {
                entry.last_used_frame = self.frame_counter;
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
        let Some(resources) = callback_resources.get::<CanvasGpuResources>() else {
            return;
        };
        if let Some(entry) = resources.instance_buffers.get(&self.buffer_key) {
            if entry.count == 0 {
                return;
            }

            let clip = info.clip_rect_in_pixels();
            let clip_min_x = clip.left_px.max(0) as u32;
            let clip_min_y = clip.top_px.max(0) as u32;
            let clip_w = clip.width_px.max(0) as u32;
            let clip_h = clip.height_px.max(0) as u32;

            if clip_w > 0 && clip_h > 0 {
                render_pass.set_scissor_rect(clip_min_x, clip_min_y, clip_w, clip_h);
            }

            render_pass.set_pipeline(&resources.pipeline);
            render_pass.set_bind_group(0, &entry.bind_group, &[]);
            render_pass.draw(0..6, 0..entry.count);
        }
    }
}

pub fn build_gpu_instances(
    shapes: impl Iterator<Item = (chip_view_db::ShapeGeometry, chip_display::LayerStyle)>,
) -> Vec<GpuShapeInstance> {
    let mut instances = Vec::new();
    for (geometry, style) in shapes {
        let (rect_dbu, shape_type) = match geometry {
            chip_view_db::ShapeGeometry::Rect(rect) => ([rect.lx, rect.ly, rect.hx, rect.hy], 0u32),
            chip_view_db::ShapeGeometry::Line(line) => {
                ([line.begin.x, line.begin.y, line.end.x, line.end.y], 1u32)
            }
            chip_view_db::ShapeGeometry::Point(point) => {
                ([point.point.x, point.point.y, 0, 0], 2u32)
            }
        };

        let mut fill_rgba = style.rgba;
        fill_rgba[3] = style.fill_alpha;

        let mut frame_rgba = style.frame_rgba;
        frame_rgba[3] = style.frame_alpha;

        let pattern_id = fill_pattern_id(style.fill_pattern);
        let pattern_bits = (shape_type << 16) | pattern_id;

        instances.push(GpuShapeInstance {
            rect_dbu,
            fill_rgba: pack_rgba_u32(fill_rgba),
            frame_rgba: pack_rgba_u32(frame_rgba),
            pattern_bits,
            line_width_px: style.line_width_px as f32,
        });
    }
    instances
}

pub struct HeatmapGpuResources(pub CanvasGpuResources);

pub struct HeatmapGpuCallback {
    pub uniform: CanvasUniform,
    pub instances: std::sync::Arc<Vec<GpuShapeInstance>>,
    pub buffer_key: GpuBufferKey,
    pub frame_counter: u64,
    pub target_format: wgpu::TextureFormat,
}

impl egui_wgpu::CallbackTrait for HeatmapGpuCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen_descriptor: &egui_wgpu::ScreenDescriptor,
        _egui_encoder: &mut wgpu::CommandEncoder,
        callback_resources: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        if !device_supports_storage_buffers(device) {
            return Vec::new();
        }
        if callback_resources.get::<HeatmapGpuResources>().is_none() {
            if let Some(res) = CanvasGpuResources::new(device, self.target_format) {
                callback_resources.insert(HeatmapGpuResources(res));
            }
        }
        let Some(resources_wrapper) = callback_resources.get_mut::<HeatmapGpuResources>() else {
            return Vec::new();
        };
        let resources = &mut resources_wrapper.0;

        queue.write_buffer(
            &resources.uniform_buffer,
            0,
            bytemuck::bytes_of(&self.uniform),
        );

        if self.instances.is_empty() {
            return Vec::new();
        }

        if !resources.instance_buffers.contains_key(&self.buffer_key) {
            let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Heatmap Instance Buffer"),
                contents: bytemuck::cast_slice(&self.instances),
                usage: wgpu::BufferUsages::STORAGE,
            });

            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Heatmap Bind Group"),
                layout: &resources.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: resources.uniform_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: buffer.as_entire_binding(),
                    },
                ],
            });

            resources.instance_buffers.insert(
                self.buffer_key,
                GpuBufferCacheEntry {
                    instance_buffer: buffer,
                    bind_group,
                    count: self.instances.len() as u32,
                    last_used_frame: self.frame_counter,
                },
            );
        }

        Vec::new()
    }

    fn paint(
        &self,
        info: egui::PaintCallbackInfo,
        render_pass: &mut wgpu::RenderPass<'static>,
        callback_resources: &egui_wgpu::CallbackResources,
    ) {
        let Some(resources_wrapper) = callback_resources.get::<HeatmapGpuResources>() else {
            return;
        };
        let resources = &resources_wrapper.0;

        if let Some(entry) = resources.instance_buffers.get(&self.buffer_key) {
            if entry.count == 0 {
                return;
            }

            let clip = info.clip_rect_in_pixels();
            let clip_min_x = clip.left_px.max(0) as u32;
            let clip_min_y = clip.top_px.max(0) as u32;
            let clip_w = clip.width_px.max(0) as u32;
            let clip_h = clip.height_px.max(0) as u32;

            if clip_w > 0 && clip_h > 0 {
                render_pass.set_scissor_rect(clip_min_x, clip_min_y, clip_w, clip_h);
            }

            render_pass.set_pipeline(&resources.pipeline);
            render_pass.set_bind_group(0, &entry.bind_group, &[]);
            render_pass.draw(0..6, 0..entry.count);
        }
    }
}
