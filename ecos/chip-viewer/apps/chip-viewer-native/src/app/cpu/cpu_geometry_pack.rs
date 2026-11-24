#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub(in crate::app::cpu_scene) struct PackedVertex {
    pub(in crate::app::cpu_scene) position: [f32; 2],
    pub(in crate::app::cpu_scene) color: [u8; 4],
}

pub(in crate::app::cpu_scene) struct PackedMesh {
    pub(in crate::app::cpu_scene) vertices: Vec<PackedVertex>,
    pub(in crate::app::cpu_scene) indices: Vec<u16>,
}

impl PackedMesh {
    pub(in crate::app::cpu_scene) fn new(mesh: &egui::Mesh) -> Option<Self> {
        if mesh.texture_id != egui::TextureId::default()
            || mesh.vertices.len() > usize::from(u16::MAX) + 1
        {
            return None;
        }
        let mut vertices = Vec::with_capacity(mesh.vertices.len());
        let mut indices = Vec::with_capacity(mesh.indices.len());
        for vertex in &mesh.vertices {
            if vertex.uv != egui::epaint::WHITE_UV {
                return None;
            }
            vertices.push(PackedVertex {
                position: [vertex.pos.x, vertex.pos.y],
                color: vertex.color.to_array(),
            });
        }
        for index in &mesh.indices {
            if *index >= u32::from(u16::MAX) || *index as usize >= mesh.vertices.len() {
                return None;
            }
            indices.push(u16::try_from(*index).ok()?);
        }
        Some(Self { vertices, indices })
    }
}

pub(in crate::app::cpu_scene) fn pack_meshes(
    meshes: &[egui::ClippedPrimitive],
) -> Vec<Option<PackedMesh>> {
    meshes
        .iter()
        .map(|primitive| match &primitive.primitive {
            egui::epaint::Primitive::Mesh(mesh) => PackedMesh::new(mesh),
            egui::epaint::Primitive::Callback(_) => None,
        })
        .collect()
}

#[cfg(test)]
#[path = "cpu_compact_mesh_tests.rs"]
mod tests;
