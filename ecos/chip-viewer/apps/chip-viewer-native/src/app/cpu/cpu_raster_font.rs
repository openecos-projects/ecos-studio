use super::*;

pub(super) struct RasterFont {
    atlas_loaded: bool,
}

impl RasterFont {
    pub(super) fn new(painter: &mut eframe::egui_glow::Painter) -> Self {
        painter.set_texture(
            egui::TextureId::default(),
            &egui::epaint::ImageDelta::full(
                egui::epaint::FontImage {
                    size: [1, 1],
                    pixels: vec![1.0],
                },
                egui::TextureOptions::LINEAR,
            ),
        );
        Self {
            atlas_loaded: false,
        }
    }

    pub(super) fn prepare(
        &mut self,
        painter: &mut eframe::egui_glow::Painter,
        request: &SceneRequest,
        meshes: &[egui::ClippedPrimitive],
        packed: &[Option<geometry::PackedMesh>],
        mut trace: Option<&mut trace::RasterTrace>,
    ) -> bool {
        request.pattern_textures.upload_for(painter, meshes);
        if self.atlas_loaded
            || !meshes.iter().zip(packed).any(|(primitive, packed)| {
                packed.is_none()
                    && matches!(&primitive.primitive,
                        egui::epaint::Primitive::Mesh(mesh)
                            if mesh.texture_id == egui::TextureId::default()
                                && mesh.vertices.iter().any(|vertex| vertex.uv != egui::epaint::WHITE_UV))
            })
        {
            return true;
        }
        let started = Instant::now();
        let image = request.repaint.fonts(egui::epaint::Fonts::image);
        if let Some(trace) = trace.as_mut() {
            trace.font_copy_ms += trace::milliseconds(started.elapsed());
        }
        if image.size != request.key.font_texture_size {
            return false;
        }
        let started = Instant::now();
        painter.set_texture(
            egui::TextureId::default(),
            &egui::epaint::ImageDelta::full(image, egui::TextureOptions::LINEAR),
        );
        if let Some(trace) = trace {
            trace.font_upload_ms += trace::milliseconds(started.elapsed());
        }
        self.atlas_loaded = true;
        true
    }
}
