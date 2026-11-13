use super::*;

impl SparseRects {
    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn partial_pixels(
        &self,
        pixels: &[u8],
        background: egui::Color32,
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<u8>> {
        let mut partial = pixels.to_vec();
        self.prepare_partial(&mut partial, background, is_current)?;
        Some(partial)
    }

    pub(in crate::app::cpu_scene) fn prepare_partial(
        &self,
        partial: &mut [u8],
        background: egui::Color32,
        is_current: &impl Fn() -> bool,
    ) -> Option<()> {
        if !is_current() {
            return None;
        }
        let background = background.to_array();
        for row in 0..self.size[1] as usize {
            if row % 64 == 0 && !is_current() {
                return None;
            }
            for column in 0..self.columns {
                let tile = row / TILE as usize * self.columns + column;
                if self.holes[tile / 64] & (1 << (tile % 64)) == 0 {
                    continue;
                }
                let left = column * TILE as usize;
                let right = (left + TILE as usize).min(self.size[0] as usize);
                let start = ((self.size[1] as usize - 1 - row) * self.size[0] as usize + left) * 4;
                for pixel in partial[start..start + (right - left) * 4].chunks_exact_mut(4) {
                    pixel.copy_from_slice(&background);
                }
            }
        }
        let visible = partial.chunks_exact(4).any(|pixel| pixel != background);
        (visible && is_current()).then_some(())
    }

    pub(in crate::app::cpu_scene) fn append_meshes(
        &mut self,
        mut meshes: Vec<egui::ClippedPrimitive>,
    ) {
        meshes.retain(|primitive| {
            let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                unreachable!("CPU geometry contains no callbacks")
            };
            let mut visible = false;
            for triangle in mesh.indices.chunks_exact(3) {
                let bounds = triangle.iter().fold(egui::Rect::NOTHING, |bounds, index| {
                    let position = mesh.vertices[*index as usize].pos;
                    bounds.union(egui::Rect::from_min_max(position, position))
                });
                let edge_padding = if self.pattern_textures.contains(mesh.texture_id) {
                    0.0
                } else {
                    1.0
                };
                let bounds =
                    self.bounds(bounds.expand(edge_padding).intersect(primitive.clip_rect));
                if bounds[2] <= bounds[0] || bounds[3] <= bounds[1] {
                    continue;
                }
                visible = true;
                for tile in self.tiles(bounds) {
                    self.holes[tile / 64] |= 1 << (tile % 64);
                }
            }
            visible
        });
        if !meshes.is_empty() {
            self.residual_count += 1;
            self.operations
                .push(Operation::Residual(self.residuals.len()));
            self.residuals.push(meshes);
        }
    }
}
