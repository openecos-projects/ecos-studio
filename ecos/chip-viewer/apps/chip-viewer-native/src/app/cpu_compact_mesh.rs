use super::*;

use geometry::{PackedMesh, PackedVertex};

#[derive(Default)]
enum Backend {
    #[default]
    Pending,
    Ready(Buffers),
    Reference,
}

#[derive(Default)]
pub(super) struct CompactPainter {
    backend: Backend,
}

struct Buffers {
    array: glow::VertexArray,
    vertices: glow::Buffer,
    indices: glow::Buffer,
    texture_coordinate: u32,
}

impl CompactPainter {
    pub(super) fn paint(
        &mut self,
        painter: &mut eframe::egui_glow::Painter,
        key: &SceneKey,
        batch: &[egui::ClippedPrimitive],
        prepared: &[Option<PackedMesh>],
    ) -> usize {
        if matches!(self.backend, Backend::Reference) || prepared.len() != batch.len() {
            painter.paint_primitives(key.screen_size, key.pixels_per_point, batch);
            return reference_bytes(batch);
        }
        painter.paint_primitives(key.screen_size, key.pixels_per_point, &[]);
        let gl = Arc::clone(painter.gl());
        if matches!(self.backend, Backend::Pending) {
            self.backend = match Buffers::new(&gl) {
                Ok(buffers) => Backend::Ready(buffers),
                Err(error) => {
                    eprintln!(
                        "Compact vertex storage unavailable; using original painter: {error}"
                    );
                    Backend::Reference
                }
            };
        }
        let mut bound = false;
        let mut bytes = 0;
        for (primitive, prepared) in batch.iter().zip(prepared) {
            if let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive {
                if let Some(prepared) = prepared {
                    if let Backend::Ready(buffers) = &self.backend {
                        if let Some(texture) = painter.texture(mesh.texture_id) {
                            if !bound {
                                buffers.bind(&gl);
                                bound = true;
                            }
                            let [left, top, right, bottom] = [
                                primitive.clip_rect.left(),
                                primitive.clip_rect.top(),
                                primitive.clip_rect.right(),
                                primitive.clip_rect.bottom(),
                            ]
                            .map(|value| (value * key.pixels_per_point).round() as i32);
                            let left = left.clamp(0, key.screen_size[0] as i32);
                            let top = top.clamp(0, key.screen_size[1] as i32);
                            let right = right.clamp(left, key.screen_size[0] as i32);
                            let bottom = bottom.clamp(top, key.screen_size[1] as i32);
                            unsafe {
                                gl.scissor(
                                    left,
                                    key.screen_size[1] as i32 - bottom,
                                    right - left,
                                    bottom - top,
                                );
                                gl.buffer_data_u8_slice(
                                    glow::ARRAY_BUFFER,
                                    bytemuck::cast_slice(&prepared.vertices),
                                    glow::STREAM_DRAW,
                                );
                                gl.buffer_data_u8_slice(
                                    glow::ELEMENT_ARRAY_BUFFER,
                                    bytemuck::cast_slice(&prepared.indices),
                                    glow::STREAM_DRAW,
                                );
                                gl.bind_texture(glow::TEXTURE_2D, Some(texture));
                                gl.draw_elements(
                                    glow::TRIANGLES,
                                    prepared.indices.len() as i32,
                                    glow::UNSIGNED_SHORT,
                                    0,
                                );
                            }
                            bytes += prepared.vertices.len() * size_of::<PackedVertex>()
                                + prepared.indices.len() * size_of::<u16>();
                            continue;
                        }
                    }
                }
            }
            painter.paint_primitives(
                key.screen_size,
                key.pixels_per_point,
                std::slice::from_ref(primitive),
            );
            bound = false;
            bytes += reference_bytes(std::slice::from_ref(primitive));
        }
        unsafe {
            gl.bind_vertex_array(None);
            gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, None);
            gl.disable(glow::SCISSOR_TEST);
        }
        bytes
    }

    pub(super) fn destroy(&mut self, gl: &glow::Context) {
        if let Backend::Ready(buffers) = std::mem::replace(&mut self.backend, Backend::Reference) {
            buffers.destroy(gl);
        }
    }
}

impl Buffers {
    fn new(gl: &glow::Context) -> Result<Self, String> {
        let program = unsafe { gl.get_parameter_program(glow::CURRENT_PROGRAM) }
            .ok_or("original painter has no active shader")?;
        let position = unsafe { gl.get_attrib_location(program, "a_pos") }
            .ok_or("original position attribute is unavailable")?;
        let color = unsafe { gl.get_attrib_location(program, "a_srgba") }
            .ok_or("original color attribute is unavailable")?;
        let texture_coordinate = unsafe { gl.get_attrib_location(program, "a_tc") }
            .ok_or("original texture coordinate is unavailable")?;
        let array = unsafe { gl.create_vertex_array()? };
        let vertices = match unsafe { gl.create_buffer() } {
            Ok(buffer) => buffer,
            Err(error) => {
                unsafe {
                    gl.delete_vertex_array(array);
                }
                return Err(error);
            }
        };
        let indices = match unsafe { gl.create_buffer() } {
            Ok(buffer) => buffer,
            Err(error) => {
                unsafe {
                    gl.delete_buffer(vertices);
                    gl.delete_vertex_array(array);
                }
                return Err(error);
            }
        };
        unsafe {
            gl.bind_vertex_array(Some(array));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(vertices));
            gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, Some(indices));
            gl.vertex_attrib_pointer_f32(
                position,
                2,
                glow::FLOAT,
                false,
                size_of::<PackedVertex>() as i32,
                0,
            );
            gl.enable_vertex_attrib_array(position);
            gl.vertex_attrib_pointer_f32(
                color,
                4,
                glow::UNSIGNED_BYTE,
                false,
                size_of::<PackedVertex>() as i32,
                8,
            );
            gl.enable_vertex_attrib_array(color);
            gl.disable_vertex_attrib_array(texture_coordinate);
            gl.bind_vertex_array(None);
        }
        Ok(Self {
            array,
            vertices,
            indices,
            texture_coordinate,
        })
    }

    fn bind(&self, gl: &glow::Context) {
        unsafe {
            gl.enable(glow::SCISSOR_TEST);
            gl.bind_vertex_array(Some(self.array));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(self.vertices));
            gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, Some(self.indices));
            gl.vertex_attrib_2_f32(
                self.texture_coordinate,
                egui::epaint::WHITE_UV.x,
                egui::epaint::WHITE_UV.y,
            );
        }
    }

    fn destroy(self, gl: &glow::Context) {
        unsafe {
            gl.delete_vertex_array(self.array);
            gl.delete_buffer(self.vertices);
            gl.delete_buffer(self.indices);
        }
    }
}

fn reference_bytes(batch: &[egui::ClippedPrimitive]) -> usize {
    batch
        .iter()
        .map(|primitive| match &primitive.primitive {
            egui::epaint::Primitive::Mesh(mesh) => {
                mesh.vertices.len() * size_of::<egui::epaint::Vertex>()
                    + mesh.indices.len() * size_of::<u32>()
            }
            egui::epaint::Primitive::Callback(_) => 0,
        })
        .sum()
}
