use super::*;
use wgpu::util::DeviceExt;

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn interaction_preserves_every_fill_pattern_pixel() {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    let Some(adapter) =
        pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))
    else {
        eprintln!("Skipping pixel test: no graphics adapter");
        return;
    };
    let (device, queue) =
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None))
            .unwrap();
    let resources = CanvasGpuResources::new(&device, wgpu::TextureFormat::Rgba8Unorm).unwrap();
    let mut shapes: Vec<_> = (0..10)
        .map(|pattern| GpuShapeInstance {
            rect_dbu: [8 + pattern * 64, 8, 56 + pattern * 64, 56],
            fill_rgba: pack_rgba_u32([40, 160, 230, 180]),
            frame_rgba: pack_rgba_u32([230, 170, 30, 220]),
            pattern_bits: pattern as u32 | (31 << 18),
            line_width_px: 1.0,
        })
        .collect();
    shapes.push(GpuShapeInstance {
        rect_dbu: [600, 8, 608, 16],
        fill_rgba: pack_rgba_u32([40, 160, 230, 180]),
        frame_rgba: pack_rgba_u32([230, 170, 30, 220]),
        pattern_bits: 8 | (31 << 18),
        line_width_px: 1.0,
    });
    let instances = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("pattern fixture"),
        contents: bytemuck::cast_slice(&shapes),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &resources.bind_group_layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: resources.uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: instances.as_entire_binding(),
            },
        ],
    });
    let render = |interacting| {
        let uniform = CanvasUniform {
            world_center_dbu: [0.0, 0.0],
            canvas_center_px: [0.0, 64.0],
            scale_px_per_dbu: 1.0,
            pixels_per_point: 1.0,
            pattern_min_size_px: PATTERN_MIN_SIZE_PX,
            min_shape_screen_size: MIN_SHAPE_SCREEN_SIZE,
            screen_size_px: [640.0, 64.0],
            is_interacting: interacting,
            global_alpha: 1.0,
            visibility_mask: u32::MAX,
            show_context: 1,
            pattern_frame_fade_size_px: PATTERN_FRAME_FADE_SIZE_PX,
            reserved: 0,
        };
        queue.write_buffer(&resources.uniform_buffer, 0, bytemuck::bytes_of(&uniform));
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 640,
                height: 64,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 640 * 64 * 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
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
            });
            pass.set_pipeline(&resources.pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.draw(0..6, 0..shapes.len() as u32);
        }
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(640 * 4),
                    rows_per_image: Some(64),
                },
            },
            texture.size(),
        );
        queue.submit([encoder.finish()]);
        let (send, receive) = std::sync::mpsc::channel();
        readback
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                send.send(result).unwrap();
            });
        device.poll(wgpu::Maintain::Wait);
        receive.recv().unwrap().unwrap();
        let pixels = readback.slice(..).get_mapped_range().to_vec();
        pixels
    };
    let stationary = render(0.0);
    let interacting = render(1.0);
    assert!(stationary.iter().any(|byte| *byte != 0));
    let small_grid_pixel = (52 * 640 + 604) * 4;
    assert!(stationary[small_grid_pixel + 3] > 0);
    let changed = stationary
        .chunks_exact(4)
        .zip(interacting.chunks_exact(4))
        .filter(|(before, during)| before != during)
        .count();
    assert_eq!(changed, 0, "interaction changed pattern pixels");
}
