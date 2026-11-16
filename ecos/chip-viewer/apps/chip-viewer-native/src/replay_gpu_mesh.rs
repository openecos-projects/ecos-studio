//! Keep immutable Replay meshes on the GPU across animation frames. Each slot
//! owns only its current mesh; changing scenes cannot accumulate GPU history.
use crate::replay_gpu_animation::{AnimatedMesh, VertexMotion};
use egui::{Mesh, Painter};
use std::sync::Arc;
use wgpu::util::DeviceExt;

#[derive(Clone, Copy)]
pub enum Slot {
    Base,
    Ghosts,
    Deleted,
    Highlights,
    Dynamic,
    DynamicHighlights,
}

pub fn paint(
    painter: &Painter,
    mesh: Arc<Mesh>,
    slot: Slot,
    format: Option<wgpu::TextureFormat>,
    opacity: f32,
) {
    if mesh.is_empty() || opacity <= 0.0 {
        return;
    }
    if let Some(format) = format {
        painter.add(egui_wgpu::Callback::new_paint_callback(
            painter.ctx().screen_rect(),
            Draw {
                mesh,
                slot,
                format,
                opacity,
                animation: None,
                progress: 1.0,
            },
        ));
    } else {
        let mut painter = painter.clone();
        painter.multiply_opacity(opacity);
        painter.add(egui::Shape::Mesh(mesh));
    }
}

pub fn paint_animated(
    painter: &Painter,
    mesh: &AnimatedMesh,
    slot: Slot,
    format: wgpu::TextureFormat,
    progress: f32,
) {
    if mesh.mesh.is_empty() {
        return;
    }
    painter.add(egui_wgpu::Callback::new_paint_callback(
        painter.ctx().screen_rect(),
        Draw {
            mesh: mesh.mesh.clone(),
            slot,
            format,
            opacity: 1.0,
            animation: Some(mesh.motion.clone()),
            progress,
        },
    ));
}

struct Draw {
    mesh: Arc<Mesh>,
    slot: Slot,
    format: wgpu::TextureFormat,
    opacity: f32,
    animation: Option<Arc<Vec<VertexMotion>>>,
    progress: f32,
}
struct Buffers {
    mesh: Arc<Mesh>,
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    uniform: wgpu::Buffer,
    group: wgpu::BindGroup,
}
struct Resources {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    slots: [Option<Buffers>; 6],
}

impl Resources {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("replay retained mesh"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX,
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
            label: Some("replay retained mesh"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("replay retained mesh"),
            source: wgpu::ShaderSource::Wgsl(include_str!("replay_gpu_mesh.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("replay retained mesh"), layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: Some("vertex"), compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<egui::epaint::Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Unorm8x4],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: Some(if format.is_srgb() { "fragment_linear" } else { "fragment_gamma" }),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
            }),
            primitive: Default::default(), depth_stencil: None, multisample: Default::default(),
            multiview: None, cache: None,
        });
        Self {
            pipeline,
            layout,
            slots: std::array::from_fn(|_| None),
        }
    }
}

impl egui_wgpu::CallbackTrait for Draw {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        screen: &egui_wgpu::ScreenDescriptor,
        _: &mut wgpu::CommandEncoder,
        resources: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        if resources.get::<Resources>().is_none() {
            resources.insert(Resources::new(device, self.format));
        }
        let resources = resources.get_mut::<Resources>().unwrap();
        let slot = &mut resources.slots[self.slot as usize];
        if !slot
            .as_ref()
            .is_some_and(|buffers| Arc::ptr_eq(&buffers.mesh, &self.mesh))
        {
            let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("replay mesh vertices"),
                contents: bytemuck::cast_slice(&self.mesh.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let indices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("replay mesh indices"),
                contents: bytemuck::cast_slice(&self.mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            let uniform = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("replay mesh viewport"),
                size: 32,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let dummy = [VertexMotion::default()];
            let animation = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("replay vertex animation"),
                contents: bytemuck::cast_slice(
                    self.animation.as_deref().map_or(&dummy[..], Vec::as_slice),
                ),
                usage: wgpu::BufferUsages::STORAGE,
            });
            let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("replay mesh viewport"),
                layout: &resources.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: animation.as_entire_binding(),
                    },
                ],
            });
            *slot = Some(Buffers {
                mesh: self.mesh.clone(),
                vertices,
                indices,
                uniform,
                group,
            });
        }
        let uniform = [
            screen.size_in_pixels[0] as f32 / screen.pixels_per_point,
            screen.size_in_pixels[1] as f32 / screen.pixels_per_point,
            self.opacity,
            self.progress,
            if self.animation.is_some() { 1.0 } else { 0.0 },
            0.0,
            0.0,
            0.0,
        ];
        queue.write_buffer(
            &slot.as_ref().unwrap().uniform,
            0,
            bytemuck::cast_slice(&uniform),
        );
        Vec::new()
    }

    fn paint(
        &self,
        _: egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &egui_wgpu::CallbackResources,
    ) {
        let Some(resources) = resources.get::<Resources>() else {
            return;
        };
        let Some(buffers) = &resources.slots[self.slot as usize] else {
            return;
        };
        pass.set_pipeline(&resources.pipeline);
        pass.set_bind_group(0, &buffers.group, &[]);
        pass.set_vertex_buffer(0, buffers.vertices.slice(..));
        pass.set_index_buffer(buffers.indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..buffers.mesh.indices.len() as u32, 0, 0..1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_wgpu::CallbackTrait;

    #[test]
    fn gpu_mesh_upload_and_both_color_targets_validate() {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let Some(adapter) = pollster::block_on(instance.request_adapter(&Default::default()))
        else {
            return;
        };
        let Ok((device, queue)) =
            pollster::block_on(adapter.request_device(&Default::default(), None))
        else {
            return;
        };
        for format in [
            wgpu::TextureFormat::Bgra8Unorm,
            wgpu::TextureFormat::Bgra8UnormSrgb,
        ] {
            device.push_error_scope(wgpu::ErrorFilter::Validation);
            let mut resources = egui_wgpu::CallbackResources::default();
            resources.insert(Resources::new(&device, format));
            let mut mesh = Mesh::default();
            mesh.add_colored_rect(
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(20.0, 10.0)),
                egui::Color32::RED,
            );
            let mut draw = Draw {
                mesh: Arc::new(mesh),
                slot: Slot::Base,
                format,
                opacity: 0.5,
                animation: None,
                progress: 0.5,
            };
            let mut encoder = device.create_command_encoder(&Default::default());
            let screen = egui_wgpu::ScreenDescriptor {
                size_in_pixels: [200, 100],
                pixels_per_point: 2.0,
            };
            draw.prepare(&device, &queue, &screen, &mut encoder, &mut resources);
            let cached = resources.get::<Resources>().unwrap().slots[0]
                .as_ref()
                .unwrap();
            assert!(Arc::ptr_eq(&cached.mesh, &draw.mesh));
            assert_eq!(cached.indices.size(), 6 * 4);
            // Render an interpolated move and inspect actual GPU pixels. The
            // rectangle moves right by 10 points at t=.5, with 2x pixel scaling.
            draw.mesh = Arc::new(draw.mesh.as_ref().clone());
            draw.animation = Some(Arc::new(vec![
                VertexMotion {
                    offset: [20.0, 0.0],
                    start: 0.0,
                    duration: -1.0,
                };
                draw.mesh.vertices.len()
            ]));
            draw.prepare(&device, &queue, &screen, &mut encoder, &mut resources);
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("replay GPU pixel validation"),
                size: wgpu::Extent3d {
                    width: 200,
                    height: 100,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            {
                let mut pass = encoder
                    .begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: None,
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: None,
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    })
                    .forget_lifetime();
                let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(100.0, 50.0));
                draw.paint(
                    egui::PaintCallbackInfo {
                        viewport: rect,
                        clip_rect: rect,
                        pixels_per_point: 2.0,
                        screen_size_px: [200, 100],
                    },
                    &mut pass,
                    &resources,
                );
            }
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 1024 * 100,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            encoder.copy_texture_to_buffer(
                texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(1024),
                        rows_per_image: None,
                    },
                },
                texture.size(),
            );
            queue.submit([encoder.finish()]);
            let (sender, receiver) = std::sync::mpsc::channel();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| {
                    sender.send(result).unwrap();
                });
            device.poll(wgpu::Maintain::Wait);
            receiver.recv().unwrap().unwrap();
            let bytes = buffer.slice(..).get_mapped_range();
            let pixel = |x: usize| &bytes[10 * 1024 + x * 4..10 * 1024 + x * 4 + 4];
            assert_eq!(pixel(5), &[0, 0, 0, 0]);
            let red = pixel(30);
            assert!(
                red[0] <= 1
                    && red[1] <= 1
                    && (126..=129).contains(&red[2])
                    && (126..=129).contains(&red[3]),
                "{format:?}: {red:?}"
            );
            assert_eq!(pixel(70), &[0, 0, 0, 0]);
            assert!(pollster::block_on(device.pop_error_scope()).is_none());
        }
    }
}
