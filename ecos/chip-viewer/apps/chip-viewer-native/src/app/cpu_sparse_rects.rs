use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};

const TILE: i32 = 32;

enum Operation {
    Rect([u16; 4], egui::Color32),
    Residual(usize),
}

pub(super) struct SparseRects {
    operations: Vec<Operation>,
    residuals: Vec<Vec<egui::ClippedPrimitive>>,
    holes: Vec<u64>,
    columns: usize,
    size: [u32; 2],
    clip: [i32; 4],
    pixels_per_point: f32,
    residual_count: usize,
    colors: [([u8; 4], egui::Color32); 2],
}

impl SparseRects {
    #[cfg(test)]
    pub(super) fn prepare(commands: &[PaintCommand], request: &SceneRequest) -> Option<Self> {
        let mut result = Self::new(request)?;
        result.append(commands, request, &|| true)?;
        Some(result)
    }

    pub(super) fn new(request: &SceneRequest) -> Option<Self> {
        let key = &request.key;
        if key.screen_size.contains(&0) || key.screen_size.into_iter().any(|side| side > 16384) {
            return None;
        }
        geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        if u64::from(key.screen_size[0]) * u64::from(key.screen_size[1]) > 16_777_216 {
            return None;
        }
        let columns = (key.screen_size[0] as usize).div_ceil(TILE as usize);
        let rows = (key.screen_size[1] as usize).div_ceil(TILE as usize);
        let mut result = Self {
            operations: Vec::new(),
            residuals: Vec::new(),
            holes: vec![0; (columns * rows).div_ceil(64)],
            columns,
            size: key.screen_size,
            clip: [
                key.canvas.left(),
                key.canvas.top(),
                key.canvas.right(),
                key.canvas.bottom(),
            ]
            .map(|coordinate| (coordinate * key.pixels_per_point).round() as i32),
            pixels_per_point: key.pixels_per_point,
            residual_count: 0,
            colors: [([0; 4], egui::Color32::TRANSPARENT); 2],
        };
        result.clip[0] = result.clip[0].clamp(0, result.size[0] as i32);
        result.clip[1] = result.clip[1].clamp(0, result.size[1] as i32);
        result.clip[2] = result.clip[2].clamp(result.clip[0], result.size[0] as i32);
        result.clip[3] = result.clip[3].clamp(result.clip[1], result.size[1] as i32);
        Some(result)
    }

    pub(super) fn append(
        &mut self,
        commands: &[PaintCommand],
        request: &SceneRequest,
        is_current: &impl Fn() -> bool,
    ) -> Option<usize> {
        let start = self.operations.len();
        let key = &request.key;
        let raster = geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        for (index, &command) in commands.iter().enumerate() {
            if index % 256 == 0 && !is_current() {
                return None;
            }
            if let Some(rectangles) = raster.rectangles(command) {
                let rgba = match command {
                    PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
                        rgba
                    }
                    _ => unreachable!(),
                };
                let color = if self.colors[0].0 == rgba {
                    self.colors[0].1
                } else if self.colors[1].0 == rgba {
                    self.colors.swap(0, 1);
                    self.colors[0].1
                } else {
                    self.colors[1] = self.colors[0];
                    let color = color32(rgba);
                    self.colors[0] = (rgba, color);
                    color
                };
                if color == egui::Color32::TRANSPARENT {
                    continue;
                }
                for rect in rectangles {
                    if [rect.left(), rect.top(), rect.right(), rect.bottom()]
                        .into_iter()
                        .any(|coordinate| (coordinate * key.pixels_per_point).fract() != 0.0)
                    {
                        return None;
                    }
                    let bounds = self.bounds(rect);
                    if bounds[2] > bounds[0] && bounds[3] > bounds[1] {
                        self.operations.push(Operation::Rect(
                            bounds.map(|coordinate| coordinate as u16),
                            color,
                        ));
                    }
                }
            } else {
                let mut sink = geometry::GeometryMeshSink::new(
                    request.tessellator.clone(),
                    key.canvas,
                    key.tessellation,
                );
                sink.paint(command);
                let meshes = sink.finish();
                self.append_meshes(meshes);
            }
        }
        is_current().then_some(start)
    }

    pub(super) fn append_meshes(&mut self, meshes: Vec<egui::ClippedPrimitive>) {
        for primitive in &meshes {
            let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                unreachable!("CPU geometry contains no callbacks")
            };
            let bounds = mesh
                .vertices
                .iter()
                .fold(egui::Rect::NOTHING, |bounds, vertex| {
                    bounds.union(egui::Rect::from_min_max(vertex.pos, vertex.pos))
                });
            let bounds = self.bounds(bounds.expand(1.0).intersect(primitive.clip_rect));
            for tile in self.tiles(bounds) {
                self.holes[tile / 64] |= 1 << (tile % 64);
            }
        }
        if !meshes.is_empty() {
            self.residual_count += 1;
            self.operations
                .push(Operation::Residual(self.residuals.len()));
            self.residuals.push(meshes);
        }
    }

    pub(super) fn len(&self) -> usize {
        self.operations.len()
    }

    pub(super) fn has_holes(&self) -> bool {
        self.holes.iter().any(|word| *word != 0)
    }

    pub(super) fn repair_tiles(&self) -> usize {
        self.holes
            .iter()
            .map(|word| word.count_ones() as usize)
            .sum()
    }

    pub(super) fn prefers_meshes(&self) -> bool {
        let tiles = self.columns * (self.size[1] as usize).div_ceil(TILE as usize);
        let holes = self.repair_tiles();
        self.operations.len() > 1_000_000
            || (self.operations.len() >= 256 && self.residual_count * 32 > self.operations.len())
            || holes * 4 > tiles
    }

    fn bounds(&self, rect: egui::Rect) -> [i32; 4] {
        let scale = self.pixels_per_point;
        let mut bounds = [
            (rect.left() * scale).floor() as i32,
            (rect.top() * scale).floor() as i32,
            (rect.right() * scale).ceil() as i32,
            (rect.bottom() * scale).ceil() as i32,
        ];
        for (index, coordinate) in bounds.iter_mut().enumerate() {
            *coordinate = (*coordinate).clamp(self.clip[index % 2], self.clip[2 + index % 2]);
        }
        bounds
    }

    fn tiles(&self, [left, top, right, bottom]: [i32; 4]) -> impl Iterator<Item = usize> {
        let columns = self.columns;
        (top / TILE..(bottom + TILE - 1) / TILE).flat_map(move |row| {
            (left / TILE..(right + TILE - 1) / TILE)
                .map(move |column| row as usize * columns + column as usize)
        })
    }

    #[cfg(test)]
    pub(super) fn residual_meshes(&self, canvas: egui::Rect) -> Vec<egui::ClippedPrimitive> {
        self.repair_meshes(canvas, &|| true, usize::MAX).unwrap()
    }

    pub(super) fn try_residual_meshes(
        &self,
        canvas: egui::Rect,
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<egui::ClippedPrimitive>> {
        self.repair_meshes(canvas, is_current, 32 * 1024 * 1024)
    }

    fn repair_meshes(
        &self,
        canvas: egui::Rect,
        is_current: &impl Fn() -> bool,
        budget: usize,
    ) -> Option<Vec<egui::ClippedPrimitive>> {
        let (mut buckets, regions) = self.repair_regions(canvas);
        let mut seen = vec![0; buckets.len()];
        let mut stamp = 0;
        let mut bytes = 0;
        for (index, operation) in self.operations.iter().enumerate() {
            if index % 256 == 0 && !is_current() {
                return None;
            }
            match operation {
                Operation::Rect(bounds, color) => {
                    stamp += 1;
                    for tile in self.tiles(bounds.map(i32::from)) {
                        let region = regions[tile];
                        if region != usize::MAX && seen[region] != stamp {
                            seen[region] = stamp;
                            let bucket = &mut buckets[region];
                            bytes += 4 * size_of::<egui::epaint::Vertex>() + 6 * size_of::<u32>();
                            if bytes > budget {
                                return None;
                            }
                            bucket.mesh.add_colored_rect(
                                rect_points(*bounds, self.pixels_per_point),
                                *color,
                            );
                            if bucket.mesh.indices.len() >= geometry::MAX_MESH_INDICES {
                                bucket.flush();
                            }
                        }
                    }
                }
                Operation::Residual(residual) => {
                    for primitive in &self.residuals[*residual] {
                        stamp += 1;
                        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                            unreachable!()
                        };
                        let bounds =
                            mesh.vertices
                                .iter()
                                .fold(egui::Rect::NOTHING, |bounds, vertex| {
                                    bounds.union(egui::Rect::from_min_max(vertex.pos, vertex.pos))
                                });
                        for tile in self.tiles(self.bounds(bounds.expand(1.0))) {
                            let region = regions[tile];
                            if region != usize::MAX && seen[region] != stamp {
                                seen[region] = stamp;
                                let bucket = &mut buckets[region];
                                bytes += mesh.vertices.len() * size_of::<egui::epaint::Vertex>()
                                    + mesh.indices.len() * size_of::<u32>()
                                    + size_of::<egui::ClippedPrimitive>();
                                if bytes > budget {
                                    return None;
                                }
                                let mut primitive = primitive.clone();
                                primitive.clip_rect = bucket.canvas.intersect(primitive.clip_rect);
                                bucket.append(primitive);
                            }
                        }
                    }
                }
            }
        }
        Some(
            buckets
                .into_iter()
                .flat_map(|mut bucket| {
                    bucket.flush();
                    bucket.output
                })
                .collect(),
        )
    }

    fn repair_regions(&self, canvas: egui::Rect) -> (Vec<RepairBucket>, Vec<usize>) {
        let rows = (self.size[1] as usize).div_ceil(TILE as usize);
        let mut regions = vec![usize::MAX; self.columns * rows];
        let mut buckets: Vec<RepairBucket> = Vec::new();
        let mut previous = BTreeMap::<(usize, usize), usize>::new();
        for row in 0..rows {
            let mut current = BTreeMap::new();
            let mut column = 0;
            while column < self.columns {
                let tile = row * self.columns + column;
                if self.holes[tile / 64] & (1 << (tile % 64)) == 0 {
                    column += 1;
                    continue;
                }
                let left = column;
                while column < self.columns {
                    let tile = row * self.columns + column;
                    if self.holes[tile / 64] & (1 << (tile % 64)) == 0 {
                        break;
                    }
                    column += 1;
                }
                let key = (left, column);
                let bottom = (row + 1) as f32 * TILE as f32 / self.pixels_per_point;
                let region = if let Some(&region) = previous.get(&key) {
                    buckets[region].canvas.max.y = bottom.min(canvas.bottom());
                    region
                } else {
                    let region = buckets.len();
                    buckets.push(RepairBucket {
                        canvas: egui::Rect::from_min_max(
                            egui::pos2(left as f32 * TILE as f32, row as f32 * TILE as f32)
                                / self.pixels_per_point,
                            egui::pos2(column as f32 * TILE as f32 / self.pixels_per_point, bottom),
                        )
                        .intersect(canvas),
                        mesh: Default::default(),
                        output: Vec::new(),
                    });
                    region
                };
                regions[row * self.columns + left..row * self.columns + column].fill(region);
                current.insert(key, region);
            }
            previous = current;
        }
        (buckets, regions)
    }

    #[cfg(test)]
    pub(super) fn render(&self, background: egui::Color32) -> Vec<u8> {
        let mut pixels = self.blank(background);
        self.render_since(0, &mut pixels, &|| true);
        pixels
    }

    pub(super) fn blank(&self, background: egui::Color32) -> Vec<u8> {
        let mut pixels = vec![0; self.size[0] as usize * self.size[1] as usize * 4];
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&background.to_array());
        }
        pixels
    }

    pub(super) fn render_since(
        &self,
        start: usize,
        pixels: &mut [u8],
        is_current: &impl Fn() -> bool,
    ) -> bool {
        for (index, operation) in self.operations[start..].iter().enumerate() {
            if index % 256 == 0 && !is_current() {
                return false;
            }
            if let Operation::Rect(bounds, color) = operation {
                let [left, top, right, bottom] = bounds.map(i32::from);
                let source = color.to_array();
                for row in top..bottom {
                    if row % 64 == 0 && !is_current() {
                        return false;
                    }
                    let start = ((self.size[1] as i32 - 1 - row) as usize * self.size[0] as usize
                        + left as usize)
                        * 4;
                    let end = start + (right - left) as usize * 4;
                    for pixel in pixels[start..end].chunks_exact_mut(4) {
                        if source[3] == 255 {
                            pixel.copy_from_slice(&source);
                            continue;
                        }
                        let alpha = pixel[3];
                        for channel in 0..3 {
                            pixel[channel] = source[channel]
                                .saturating_add(multiply(pixel[channel], 255 - source[3]));
                        }
                        pixel[3] = alpha.saturating_add(multiply(source[3], 255 - alpha));
                    }
                }
            }
        }
        is_current()
    }

    pub(super) fn drain_meshes(
        &mut self,
        canvas: egui::Rect,
        mut consume: impl FnMut(Vec<egui::ClippedPrimitive>) -> bool,
    ) -> bool {
        let mut bucket = RepairBucket {
            canvas,
            mesh: Default::default(),
            output: Vec::new(),
        };
        let scale = self.pixels_per_point;
        let mut residuals = std::mem::take(&mut self.residuals);
        for operation in self.operations.drain(..) {
            match operation {
                Operation::Rect(bounds, color) => {
                    bucket
                        .mesh
                        .add_colored_rect(rect_points(bounds, scale), color);
                    if bucket.mesh.indices.len() >= geometry::MAX_MESH_INDICES {
                        bucket.flush();
                    }
                }
                Operation::Residual(residual) => {
                    for primitive in std::mem::take(&mut residuals[residual]) {
                        bucket.append(primitive);
                    }
                }
            }
            if bucket.output.len() >= 16 && !consume(std::mem::take(&mut bucket.output)) {
                return false;
            }
        }
        bucket.flush();
        consume(bucket.output)
    }

    pub(super) fn merge(&self, pixels: &mut [u8], residual: &[u8]) {
        assert_eq!(
            pixels.len(),
            self.size[0] as usize * self.size[1] as usize * 4
        );
        assert_eq!(pixels.len(), residual.len());
        for row in 0..self.size[1] as i32 {
            for column in 0..self.columns {
                let tile = row as usize / TILE as usize * self.columns + column;
                if self.holes[tile / 64] & (1 << (tile % 64)) == 0 {
                    continue;
                }
                let left = column * TILE as usize;
                let right = (left + TILE as usize).min(self.size[0] as usize);
                let start =
                    ((self.size[1] as i32 - 1 - row) as usize * self.size[0] as usize + left) * 4;
                pixels[start..start + (right - left) * 4]
                    .copy_from_slice(&residual[start..start + (right - left) * 4]);
            }
        }
    }
}

struct RepairBucket {
    canvas: egui::Rect,
    mesh: egui::Mesh,
    output: Vec<egui::ClippedPrimitive>,
}

impl RepairBucket {
    fn append(&mut self, primitive: egui::ClippedPrimitive) {
        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
            unreachable!()
        };
        if primitive.clip_rect != self.canvas || mesh.texture_id != self.mesh.texture_id {
            self.flush();
            self.output.push(primitive);
            return;
        }
        if self.mesh.indices.len() + mesh.indices.len() > geometry::MAX_MESH_INDICES {
            self.flush();
        }
        let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive else {
            unreachable!()
        };
        self.mesh.append(mesh);
    }

    fn flush(&mut self) {
        if !self.mesh.is_empty() {
            self.output.push(egui::ClippedPrimitive {
                clip_rect: self.canvas,
                primitive: egui::epaint::Primitive::Mesh(std::mem::take(&mut self.mesh)),
            });
        }
    }
}

fn rect_points([left, top, right, bottom]: [u16; 4], scale: f32) -> egui::Rect {
    egui::Rect::from_min_max(
        egui::pos2(f32::from(left), f32::from(top)) / scale,
        egui::pos2(f32::from(right), f32::from(bottom)) / scale,
    )
}

fn multiply(left: u8, right: u8) -> u8 {
    let product = u32::from(left) * u32::from(right);
    ((product + (product >> 8) + 128) >> 8) as u8
}
