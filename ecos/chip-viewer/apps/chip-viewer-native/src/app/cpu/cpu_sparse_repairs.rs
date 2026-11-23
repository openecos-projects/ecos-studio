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
        let damage = DamagePrefix::new(&self.holes, self.columns, self.size[1]);
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
            let mut add_region = |region: usize| {
                if region == usize::MAX || seen[region] == index {
                    return true;
                }
                seen[region] = index;
                let list = &mut contributors[region];
                let before = list.capacity();
                list.push(id);
                reference_bytes += (list.capacity() - before) * size_of::<u32>();
                reference_bytes <= MAX_REFERENCE_BYTES
            };
            let mut record = |[left, top, right, bottom]: [i32; 4]| {
                if left >= right || top >= bottom {
                    return true;
                }
                let left = left as usize / TILE as usize;
                let top = top as usize / TILE as usize;
                let right = (right as usize).div_ceil(TILE as usize);
                let bottom = (bottom as usize).div_ceil(TILE as usize);
                // A single tile already has a direct lookup in the region map.
                if left + 1 == right && top + 1 == bottom {
                    return add_region(regions[top * self.columns + left]);
                }
                if damage.intersects(left, top, right, bottom) {
                    for row in top..bottom {
                        let start = row * self.columns;
                        for &region in &regions[start + left..start + right] {
                            if !add_region(region) {
                                return false;
                            }
                        }
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
                    for mesh in &self.residuals[*residual] {
                        if !record(mesh.bounds.map(i32::from)) {
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
                        for mesh in &self.residuals[*residual] {
                            let mut primitive = mesh.primitive.clone();
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

/// A summed-area table over the damage tile mask. The table makes the common
/// no-intersection case constant time even when an operation covers a large
/// rectangle of otherwise clean tiles.
struct DamagePrefix {
    columns: usize,
    sums: Vec<u32>,
}

impl DamagePrefix {
    fn new(holes: &[u64], columns: usize, height: u32) -> Self {
        let rows = (height as usize).div_ceil(TILE as usize);
        let stride = columns + 1;
        let mut sums = vec![0; (rows + 1) * stride];
        for row in 0..rows {
            let mut row_sum = 0;
            for column in 0..columns {
                let tile = row * columns + column;
                if holes[tile / 64] & (1 << (tile % 64)) != 0 {
                    row_sum += 1;
                }
                sums[(row + 1) * stride + column + 1] = sums[row * stride + column + 1] + row_sum;
            }
        }
        Self { columns, sums }
    }

    fn intersects(&self, left: usize, top: usize, right: usize, bottom: usize) -> bool {
        let stride = self.columns + 1;
        let sum = |row: usize, column: usize| self.sums[row * stride + column];
        sum(bottom, right) + sum(top, left) > sum(top, right) + sum(bottom, left)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_matches_tile_mask_across_word_and_row_boundaries() {
        let holes = [1 << 17, 1 | 1 << 3];
        let columns = 17;
        let rows = 4;
        let prefix = DamagePrefix::new(&holes, columns, rows as u32 * TILE as u32 - 3);
        for top in 0..rows {
            for bottom in top..=rows {
                for left in 0..columns {
                    for right in left..=columns {
                        let covered = (top..bottom).any(|row| {
                            (left..right).any(|col| {
                                let tile = row * columns + col;
                                holes[tile / 64] & (1 << (tile % 64)) != 0
                            })
                        });
                        assert_eq!(prefix.intersects(left, top, right, bottom), covered);
                    }
                }
            }
        }
    }
}
