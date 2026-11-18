//! Ordered batches of font/white and managed pattern meshes. A batch has one
//! scissor and at most eight texture slots; it never sorts or flattens layers.
use super::super::PatternTextureSet;
use super::*;

#[path = "cpu_texture_batch_shader.rs"]
mod shader;

const MAX_BYTES: usize = 8 * 1024 * 1024;

/// Only this exact desktop driver profile passed the ordered mask/DPR byte
/// oracle. llvmpipe's shader rounding differs even with explicit gradients;
/// untested versions and renderers retain the original painter.
fn certified_profile(gl: &glow::Context) -> bool {
    unsafe {
        gl.get_parameter_string(glow::RENDERER) == "SVGA3D; build: RELEASE;  LLVM;"
            && gl.get_parameter_string(glow::VERSION)
                == "4.3 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.2"
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    position: [f32; 2],
    uv: [f32; 2],
    color: [u8; 4],
    slot: u32,
}

#[derive(Default)]
pub(in crate::app) struct TextureBatch {
    buffers: Option<Buffers>,
    unavailable: bool,
    vertices: Vec<Vertex>,
    indices: Vec<u32>,
    textures: Vec<(egui::TextureId, glow::Texture)>,
    clip: Option<egui::Rect>,
    last_slot: usize,
    #[cfg(test)]
    pub(super) draws: usize,
    #[cfg(test)]
    pub(super) fallbacks: usize,
}

struct Buffers {
    program: shader::Program,
    array: glow::VertexArray,
    vertices: glow::Buffer,
    indices: glow::Buffer,
    sampler_objects: bool,
}

impl TextureBatch {
    /// `None` leaves drawing to the compact/reference path. Upload patterns
    /// before resolving their actual GL handles through the original painter.
    pub(in crate::app) fn paint(
        &mut self,
        painter: &mut eframe::egui_glow::Painter,
        key: &SceneKey,
        patterns: &PatternTextureSet,
        batch: &[egui::ClippedPrimitive],
    ) -> Option<usize> {
        if self.unavailable || !batch.iter().any(|primitive| {
            matches!(&primitive.primitive, egui::epaint::Primitive::Mesh(mesh) if patterns.contains(mesh.texture_id))
        }) {
            return None;
        }
        let gl = Arc::clone(painter.gl());
        if self.buffers.is_none() {
            if !certified_profile(&gl) {
                self.unavailable = true;
                return None;
            }
            match Buffers::new(&gl) {
                Ok(buffers) => self.buffers = Some(buffers),
                Err(error) => {
                    eprintln!(
                        "Managed texture batching unavailable; using original painter: {error}"
                    );
                    self.unavailable = true;
                    return None;
                }
            }
        }
        patterns.upload_for(painter, batch);
        let mut bytes = 0;
        for primitive in batch {
            let mesh = match &primitive.primitive {
                egui::epaint::Primitive::Mesh(mesh)
                    if mesh.is_valid()
                        && ((mesh.texture_id == egui::TextureId::default()
                            && mesh
                                .vertices
                                .iter()
                                .all(|vertex| vertex.uv == egui::epaint::WHITE_UV))
                            || patterns.contains(mesh.texture_id))
                        && mesh.vertices.len() * size_of::<Vertex>() + mesh.indices.len() * 4
                            <= MAX_BYTES =>
                {
                    Some(mesh)
                }
                _ => None,
            };
            let texture = mesh.and_then(|mesh| painter.texture(mesh.texture_id));
            let font = painter.texture(egui::TextureId::default());
            let (Some(mesh), Some(texture), Some(font)) = (mesh, texture, font) else {
                bytes += self.flush(painter, key);
                painter.paint_primitives(
                    key.screen_size,
                    key.pixels_per_point,
                    std::slice::from_ref(primitive),
                );
                bytes += reference_bytes(std::slice::from_ref(primitive));
                #[cfg(test)]
                {
                    self.fallbacks += 1;
                }
                continue;
            };
            let additional = mesh.vertices.len() * size_of::<Vertex>() + mesh.indices.len() * 4;
            let changed_clip = self.clip.is_some_and(|clip| clip != primitive.clip_rect);
            let full = self.textures.len() == 8
                && !self.textures.iter().any(|(id, _)| *id == mesh.texture_id);
            if changed_clip
                || full
                || self.vertices.len() * size_of::<Vertex>() + self.indices.len() * 4 + additional
                    > MAX_BYTES
            {
                bytes += self.flush(painter, key);
            }
            if self.clip.is_none() {
                self.clip = Some(primitive.clip_rect);
                self.textures.push((egui::TextureId::default(), font));
            }
            let slot = self
                .textures
                .iter()
                .position(|(id, _)| *id == mesh.texture_id)
                .unwrap_or_else(|| {
                    self.textures.push((mesh.texture_id, texture));
                    self.textures.len() - 1
                });
            let base = self.vertices.len() as u32;
            self.vertices
                .extend(mesh.vertices.iter().map(|vertex| Vertex {
                    position: [vertex.pos.x, vertex.pos.y],
                    uv: [vertex.uv.x, vertex.uv.y],
                    color: vertex.color.to_array(),
                    slot: slot as u32,
                }));
            self.indices
                .extend(mesh.indices.iter().map(|index| base + index));
            self.last_slot = slot;
        }
        bytes += self.flush(painter, key);
        Some(bytes)
    }

    fn flush(&mut self, painter: &mut eframe::egui_glow::Painter, key: &SceneKey) -> usize {
        let mut bytes = 0;
        if !self.indices.is_empty() {
            // Restore the original blend/gamma/viewport state after callbacks,
            // then use exactly the same state with the multi-texture program.
            painter.paint_primitives(key.screen_size, key.pixels_per_point, &[]);
            self.buffers.as_ref().unwrap().draw(painter.gl(), key, self);
            bytes = self.vertices.len() * size_of::<Vertex>() + self.indices.len() * 4;
            #[cfg(test)]
            {
                self.draws += 1;
            }
        }
        self.vertices.clear();
        self.indices.clear();
        self.textures.clear();
        self.clip = None;
        bytes
    }

    pub(in crate::app) fn destroy(&mut self, gl: &glow::Context) {
        if let Some(buffers) = self.buffers.take() {
            buffers.destroy(gl);
        }
        self.unavailable = true;
    }
}

impl Buffers {
    fn new(gl: &glow::Context) -> Result<Self, String> {
        if gl.version().is_embedded
            || gl.version().major < 3
            || unsafe { gl.get_parameter_i32(glow::MAX_TEXTURE_IMAGE_UNITS) } < 8
        {
            return Err("requires desktop OpenGL 3 with eight fragment texture units".into());
        }
        let program = shader::Program::new(gl)?;
        let mut array = None;
        let mut vertices = None;
        let mut indices = None;
        let result = (|| unsafe {
            array = Some(gl.create_vertex_array()?);
            vertices = Some(gl.create_buffer()?);
            indices = Some(gl.create_buffer()?);
            gl.bind_vertex_array(array);
            gl.bind_buffer(glow::ARRAY_BUFFER, vertices);
            gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, indices);
            for (index, count, kind, offset) in [
                (0, 2, glow::FLOAT, 0),
                (1, 2, glow::FLOAT, 8),
                (2, 4, glow::UNSIGNED_BYTE, 16),
            ] {
                gl.vertex_attrib_pointer_f32(
                    index,
                    count,
                    kind,
                    false,
                    size_of::<Vertex>() as i32,
                    offset,
                );
                gl.enable_vertex_attrib_array(index);
            }
            gl.vertex_attrib_pointer_i32(3, 1, glow::UNSIGNED_INT, size_of::<Vertex>() as i32, 20);
            gl.enable_vertex_attrib_array(3);
            gl.bind_vertex_array(None);
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            unsafe {
                if let Some(array) = array {
                    gl.delete_vertex_array(array);
                }
                if let Some(buffer) = vertices {
                    gl.delete_buffer(buffer);
                }
                if let Some(buffer) = indices {
                    gl.delete_buffer(buffer);
                }
                gl.delete_program(program.program);
            }
            return Err(error);
        }
        Ok(Self {
            program,
            array: array.unwrap(),
            vertices: vertices.unwrap(),
            indices: indices.unwrap(),
            sampler_objects: gl.version().major > 3 || gl.version().minor >= 3,
        })
    }

    fn draw(&self, gl: &glow::Context, key: &SceneKey, batch: &TextureBatch) {
        let mut previous = [None; 8];
        let mut samplers = [None; 8];
        self.program.bind(gl, key);
        unsafe {
            gl.active_texture(glow::TEXTURE0);
            let sampler = self
                .sampler_objects
                .then(|| gl.get_parameter_sampler(glow::SAMPLER_BINDING))
                .flatten();
            // Bind all samplers, even unused slots, to complete texture objects.
            for index in 0..8 {
                gl.active_texture(glow::TEXTURE0 + index as u32);
                if index > 0 {
                    previous[index] = gl.get_parameter_texture(glow::TEXTURE_BINDING_2D);
                    if self.sampler_objects {
                        samplers[index] = gl.get_parameter_sampler(glow::SAMPLER_BINDING);
                    }
                }
                let texture = batch.textures.get(index).unwrap_or(&batch.textures[0]).1;
                gl.bind_texture(glow::TEXTURE_2D, Some(texture));
                if self.sampler_objects {
                    gl.bind_sampler(index as u32, sampler);
                }
            }
            gl.active_texture(glow::TEXTURE0);
            gl.enable(glow::SCISSOR_TEST);
            let clip = batch.clip.unwrap();
            let [left, top, right, bottom] = [clip.left(), clip.top(), clip.right(), clip.bottom()]
                .map(|value| (value * key.pixels_per_point).round() as i32);
            let left = left.clamp(0, key.screen_size[0] as i32);
            let top = top.clamp(0, key.screen_size[1] as i32);
            let right = right.clamp(left, key.screen_size[0] as i32);
            let bottom = bottom.clamp(top, key.screen_size[1] as i32);
            gl.scissor(
                left,
                key.screen_size[1] as i32 - bottom,
                right - left,
                bottom - top,
            );
            gl.bind_vertex_array(Some(self.array));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(self.vertices));
            gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, Some(self.indices));
            gl.buffer_data_u8_slice(
                glow::ARRAY_BUFFER,
                bytemuck::cast_slice(&batch.vertices),
                glow::STREAM_DRAW,
            );
            gl.buffer_data_u8_slice(
                glow::ELEMENT_ARRAY_BUFFER,
                bytemuck::cast_slice(&batch.indices),
                glow::STREAM_DRAW,
            );
            gl.draw_elements(
                glow::TRIANGLES,
                batch.indices.len() as i32,
                glow::UNSIGNED_INT,
                0,
            );
            for index in 1..8 {
                gl.active_texture(glow::TEXTURE0 + index as u32);
                gl.bind_texture(glow::TEXTURE_2D, previous[index]);
                if self.sampler_objects {
                    gl.bind_sampler(index as u32, samplers[index]);
                }
            }
            gl.active_texture(glow::TEXTURE0);
            gl.bind_texture(glow::TEXTURE_2D, Some(batch.textures[batch.last_slot].1));
            gl.bind_vertex_array(None);
            gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, None);
            gl.disable(glow::SCISSOR_TEST);
        }
    }

    fn destroy(self, gl: &glow::Context) {
        unsafe {
            gl.delete_program(self.program.program);
            gl.delete_vertex_array(self.array);
            gl.delete_buffer(self.vertices);
            gl.delete_buffer(self.indices);
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "cpu_texture_batch_tests.rs"]
mod tests;
