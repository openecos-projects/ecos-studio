//! Region-local ordered repair plans. Only compact operation indices are
//! retained; each disjoint scissor region submits bounded geometry batches.
use super::*;

const MAX_REFERENCE_BYTES: usize = 32 * 1024 * 1024;

impl SparseRects {
    pub(in crate::app::cpu_scene) fn stream_repairs(
        &self,
        canvas: egui::Rect,
        is_current: &impl Fn() -> bool,
        batch_bytes: usize,
        mut consume: impl FnMut(Vec<egui::ClippedPrimitive>) -> bool,
    ) -> bool {
        let (mut buckets, regions) = self.repair_regions(canvas);
        let mut contributors = vec![Vec::<u32>::new(); buckets.len()];
        let mut seen = vec![usize::MAX; buckets.len()];
        let mut reference_bytes = contributors.capacity() * size_of::<Vec<u32>>();
        for (index, operation) in self.operations.iter().enumerate() {
            if index % 256 == 0 && !is_current() {
                return false;
            }
            let Ok(id) = u32::try_from(index) else {
                return false;
            };
            let mut record = |bounds| {
                for tile in self.tiles(bounds) {
                    let region = regions[tile];
                    if region == usize::MAX || seen[region] == index {
                        continue;
                    }
                    seen[region] = index;
                    let list = &mut contributors[region];
                    let before = list.capacity();
                    list.push(id);
                    reference_bytes += (list.capacity() - before) * size_of::<u32>();
                    if reference_bytes > MAX_REFERENCE_BYTES {
                        return false;
                    }
                }
                true
            };
            match operation {
                Operation::Rect(bounds, _) => {
                    if !record(bounds.map(i32::from)) {
                        return false;
                    }
                }
                Operation::Pattern(operation) => {
                    if !record(self.bounds(operation.rect)) {
                        return false;
                    }
                }
                Operation::Residual(residual) => {
                    for primitive in &self.residuals[*residual] {
                        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                            unreachable!()
                        };
                        let bounds =
                            mesh.vertices
                                .iter()
                                .fold(egui::Rect::NOTHING, |bounds, vertex| {
                                    bounds.union(egui::Rect::from_min_max(vertex.pos, vertex.pos))
                                });
                        let padding = if self.pattern_textures.contains(mesh.texture_id) {
                            0.0
                        } else {
                            1.0
                        };
                        if !record(self.bounds(bounds.expand(padding))) {
                            return false;
                        }
                    }
                }
            }
        }
        for (bucket, contributors) in buckets.iter_mut().zip(contributors) {
            let mut bytes = 0;
            for (offset, id) in contributors.into_iter().enumerate() {
                if offset % 256 == 0 && !is_current() {
                    return false;
                }
                match self.operations.get(id as usize) {
                    Operation::Rect(bounds, color) => {
                        bucket
                            .mesh
                            .add_colored_rect(rect_points(*bounds, self.pixels_per_point), *color);
                        bytes += 4 * size_of::<egui::epaint::Vertex>() + 6 * size_of::<u32>();
                        if bucket.mesh.indices.len() >= geometry::MAX_MESH_INDICES {
                            bucket.flush();
                        }
                    }
                    Operation::Pattern(operation) => {
                        let mut primitive =
                            pattern_primitive(**operation, &self.pattern_textures, canvas);
                        primitive.clip_rect = primitive.clip_rect.intersect(bucket.canvas);
                        bytes += primitive_bytes(&primitive);
                        bucket.append(primitive);
                    }
                    Operation::Residual(residual) => {
                        for primitive in &self.residuals[*residual] {
                            let mut primitive = primitive.clone();
                            primitive.clip_rect = primitive.clip_rect.intersect(bucket.canvas);
                            bytes += primitive_bytes(&primitive);
                            bucket.append(primitive);
                            if bytes >= batch_bytes && !flush(bucket, &mut bytes, &mut consume) {
                                return false;
                            }
                        }
                    }
                }
                if bytes >= batch_bytes && !flush(bucket, &mut bytes, &mut consume) {
                    return false;
                }
            }
            if !is_current() || !flush(bucket, &mut bytes, &mut consume) {
                return false;
            }
        }
        is_current()
    }
}

fn primitive_bytes(primitive: &egui::ClippedPrimitive) -> usize {
    match &primitive.primitive {
        egui::epaint::Primitive::Mesh(mesh) => {
            mesh.vertices.len() * size_of::<egui::epaint::Vertex>()
                + mesh.indices.len() * size_of::<u32>()
        }
        egui::epaint::Primitive::Callback(_) => unreachable!(),
    }
}

fn flush(
    bucket: &mut RepairBucket,
    bytes: &mut usize,
    consume: &mut impl FnMut(Vec<egui::ClippedPrimitive>) -> bool,
) -> bool {
    bucket.flush();
    *bytes = 0;
    bucket.output.is_empty() || consume(std::mem::take(&mut bucket.output))
}
