use super::*;

fn vertex(position: egui::Pos2, color: egui::Color32) -> egui::epaint::Vertex {
    egui::epaint::Vertex {
        pos: position,
        uv: egui::epaint::WHITE_UV,
        color,
    }
}

#[test]
fn compact_storage_preserves_float_bits_premultiplied_color_and_triangle_order() {
    let mesh = egui::Mesh {
        vertices: vec![
            vertex(
                egui::pos2(-0.0, 0.125),
                egui::Color32::from_rgba_premultiplied(23, 61, 17, 91),
            ),
            vertex(egui::pos2(0.33333334, -16384.5), egui::Color32::TRANSPARENT),
            vertex(egui::pos2(3.75, 919.125), egui::Color32::WHITE),
        ],
        indices: vec![0, 1, 2, 2, 1, 0],
        ..Default::default()
    };
    let packed = PackedMesh::new(&mesh).unwrap();
    assert_eq!(std::mem::size_of::<PackedVertex>(), 12);
    assert_eq!(packed.indices, [0, 1, 2, 2, 1, 0]);
    for (packed, original) in packed.vertices.iter().zip(&mesh.vertices) {
        assert_eq!(
            packed.position.map(f32::to_bits),
            [original.pos.x.to_bits(), original.pos.y.to_bits()]
        );
        assert_eq!(packed.color, original.color.to_array());
    }
}

#[test]
fn compact_eligibility_rejects_textures_bad_indices_and_overflow_without_narrowing() {
    let mut mesh = egui::Mesh {
        vertices: vec![vertex(egui::Pos2::ZERO, egui::Color32::WHITE); 65536],
        indices: vec![65534, 1, 0],
        ..Default::default()
    };
    let packed = PackedMesh::new(&mesh).unwrap();
    assert_eq!(packed.indices, [65534, 1, 0]);
    mesh.indices[0] = 65535;
    assert!(PackedMesh::new(&mesh).is_none());
    mesh.indices[0] = 65534;
    mesh.vertices.push(mesh.vertices[0]);
    assert!(PackedMesh::new(&mesh).is_none());
    mesh.vertices.truncate(3);
    mesh.indices = vec![0, 1, 2];
    mesh.texture_id = egui::TextureId::User(17);
    assert!(PackedMesh::new(&mesh).is_none());
    mesh.texture_id = egui::TextureId::default();
    mesh.vertices[1].uv = egui::pos2(0.125, 0.75);
    assert!(PackedMesh::new(&mesh).is_none());
    mesh.vertices[1].uv = egui::epaint::WHITE_UV;
    mesh.indices[2] = 3;
    assert!(PackedMesh::new(&mesh).is_none());
    mesh.indices[2] = 2;
    let packed = PackedMesh::new(&mesh).unwrap();
    assert_eq!(packed.indices, [0, 1, 2]);
}
