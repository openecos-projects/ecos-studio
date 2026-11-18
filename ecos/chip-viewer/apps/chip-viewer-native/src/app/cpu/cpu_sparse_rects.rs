use super::*;
use chip_render::geometry2d::{PaintCommand, PaintSink};
use eframe::glow::{self, HasContext};

#[path = "cpu_sparse_coverage.rs"]
mod coverage;

#[path = "cpu_sparse_grid.rs"]
mod grid;

const TILE: i32 = 8;
const MAX_RESIDUAL_BATCH_EXTENT_PX: f32 = 32.0;

#[path = "cpu_sparse_budget.rs"]
mod budget;

#[path = "cpu_sparse_repairs.rs"]
mod repairs;

pub(in crate::app) fn certified_profile(gl: &glow::Context) -> bool {
    unsafe {
        gl.get_parameter_string(glow::RENDERER) == "llvmpipe (LLVM 20.1.2, 256 bits)"
            && gl.get_parameter_string(glow::VERSION)
                == "4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.2"
    }
}

enum Operation {
    Rect([u16; 4], egui::Color32),
    Pattern(Box<PatternOperation>),
    Residual(usize),
}

#[derive(Clone, Copy)]
struct PatternOperation {
    rect: egui::Rect,
    pattern: chip_display::FillPattern,
    color: egui::Color32,
}

pub(super) struct SparseRects {
    operations: budget::Operations,
    residuals: Vec<Vec<egui::ClippedPrimitive>>,
    holes: Vec<u64>,
    columns: usize,
    size: [u32; 2],
    clip: [i32; 4],
    pixels_per_point: f32,
    residual_count: usize,
    colors: [([u8; 4], egui::Color32); 2],
    pattern_textures: Arc<PatternTextureSet>,
    auxiliary_bytes: usize,
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
            operations: Default::default(),
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
            pattern_textures: Arc::clone(&request.pattern_textures),
            auxiliary_bytes: 0,
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
        let mut residual_sink = None;
        let mut residual_bounds = None;
        for (index, &command) in commands.iter().enumerate() {
            if index % 256 == 0 && !is_current() {
                return None;
            }
            if let PaintCommand::PatternRect {
                rect,
                pattern,
                rgba,
            } = command
            {
                if self.pattern_textures.spec(pattern).is_some() {
                    self.finish_residual_sink(&mut residual_sink);
                    residual_bounds = None;
                    self.push_operation(Operation::Pattern(Box::new(PatternOperation {
                        rect,
                        pattern,
                        color: color32(rgba),
                    })));
                    self.auxiliary_bytes += size_of::<PatternOperation>();
                    continue;
                }
            }
            if let Some(rectangles) = raster.rectangles(command) {
                self.finish_residual_sink(&mut residual_sink);
                residual_bounds = None;
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
                        self.push_operation(Operation::Rect(
                            bounds.map(|coordinate| coordinate as u16),
                            color,
                        ));
                    }
                }
            } else {
                let bounds = command_bounds(command, key.pixels_per_point).intersect(key.canvas);
                let next_bounds =
                    residual_bounds.map_or(bounds, |previous: egui::Rect| previous.union(bounds));
                let command_extent_px = bounds.size() * key.pixels_per_point;
                let command_fits_batch = bounds.is_finite()
                    && bounds.is_positive()
                    && command_extent_px.x <= MAX_RESIDUAL_BATCH_EXTENT_PX
                    && command_extent_px.y <= MAX_RESIDUAL_BATCH_EXTENT_PX;
                let batch_extent_px = next_bounds.size() * key.pixels_per_point;
                let fits_current_batch = command_fits_batch
                    && batch_extent_px.x <= MAX_RESIDUAL_BATCH_EXTENT_PX
                    && batch_extent_px.y <= MAX_RESIDUAL_BATCH_EXTENT_PX;
                if residual_sink.is_some() && !fits_current_batch {
                    self.finish_residual_sink(&mut residual_sink);
                    residual_bounds = None;
                }
                let sink = residual_sink.get_or_insert_with(|| {
                    geometry::GeometryMeshSink::for_raster_with_patterns(
                        request.tessellator.clone(),
                        key.canvas,
                        key.tessellation,
                        key.pixels_per_point,
                        Arc::clone(&request.pattern_textures),
                    )
                });
                sink.paint(command);
                if command_fits_batch {
                    residual_bounds = Some(
                        residual_bounds
                            .map_or(bounds, |previous: egui::Rect| previous.union(bounds)),
                    );
                } else {
                    self.finish_residual_sink(&mut residual_sink);
                    residual_bounds = None;
                }
            }
        }
        self.finish_residual_sink(&mut residual_sink);
        is_current().then_some(start)
    }

    fn finish_residual_sink(&mut self, sink: &mut Option<geometry::GeometryMeshSink>) {
        if let Some(sink) = sink.take() {
            self.append_meshes(sink.finish());
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
        self.mesh_preference().is_some()
    }

    pub(super) fn mesh_preference(&self) -> Option<&'static str> {
        let tiles = self.columns * (self.size[1] as usize).div_ceil(TILE as usize);
        let holes = self.repair_tiles();
        if self.retained_bytes() > budget::MAX_BYTES {
            Some("retained_memory")
        } else if self.operations.len() >= 256 && self.residual_count * 32 > self.operations.len() {
            Some("residual_density")
        } else if holes * 4 > tiles {
            Some("damage_coverage")
        } else {
            None
        }
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

    #[cfg(test)]
    fn repair_meshes(
        &self,
        canvas: egui::Rect,
        is_current: &impl Fn() -> bool,
        budget: usize,
    ) -> Option<Vec<egui::ClippedPrimitive>> {
        let mut output = Vec::new();
        let mut bytes = 0;
        self.stream_repairs(canvas, is_current, 1024 * 1024, |meshes| {
            for primitive in &meshes {
                if let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive {
                    bytes += mesh.vertices.len() * size_of::<egui::epaint::Vertex>()
                        + mesh.indices.len() * size_of::<u32>();
                }
            }
            output.extend(meshes);
            bytes <= budget
        })
        .then_some(output)
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
        let mut pixels = Vec::new();
        self.reset_pixels(&mut pixels, background);
        pixels
    }

    pub(super) fn reset_pixels(&self, pixels: &mut Vec<u8>, background: egui::Color32) {
        pixels.resize(self.size[0] as usize * self.size[1] as usize * 4, 0);
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&background.to_array());
        }
    }

    pub(super) fn render_since(
        &self,
        start: usize,
        pixels: &mut [u8],
        is_current: &impl Fn() -> bool,
    ) -> bool {
        for (index, operation) in self.operations.since(start).enumerate() {
            if index % 256 == 0 && !is_current() {
                return false;
            }
            match operation {
                Operation::Rect(bounds, color) => {
                    self.paint_rect(*bounds, *color, pixels, is_current);
                }
                Operation::Pattern(operation) => {
                    self.paint_pattern(**operation, pixels, is_current);
                }
                Operation::Residual(_) => {}
            }
        }
        is_current()
    }

    fn paint_rect(
        &self,
        bounds: [u16; 4],
        color: egui::Color32,
        pixels: &mut [u8],
        is_current: &impl Fn() -> bool,
    ) {
        let [left, top, right, bottom] = bounds.map(i32::from);
        paint_pixels(
            self.size,
            left..right,
            top..bottom,
            color.to_array(),
            pixels,
            is_current,
        );
    }

    fn paint_pattern(
        &self,
        operation: PatternOperation,
        pixels: &mut [u8],
        is_current: &impl Fn() -> bool,
    ) {
        let [left, top, right, bottom] = self.bounds(operation.rect);
        let tile = self
            .pattern_textures
            .spec(operation.pattern)
            .map(|(_, tile)| tile)
            .unwrap();
        for row in top..bottom {
            if row % 64 == 0 && !is_current() {
                return;
            }
            for column in left..right {
                let point = egui::pos2(
                    (column as f32 + 0.5) / self.pixels_per_point,
                    (row as f32 + 0.5) / self.pixels_per_point,
                );
                if point.x <= operation.rect.left()
                    || point.x >= operation.rect.right()
                    || point.y <= operation.rect.top()
                    || point.y >= operation.rect.bottom()
                {
                    continue;
                }
                let uv = [
                    (point.x - operation.rect.left()) / tile[0],
                    (point.y - operation.rect.top()) / tile[1],
                ];
                let mask = self.pattern_textures.sample(operation.pattern, uv).unwrap();
                if mask[0] == 0 && mask[3] == 0 {
                    continue;
                }
                let mut source = operation.color.to_array();
                for channel in 0..4 {
                    source[channel] = multiply(source[channel], mask[channel]);
                }
                let offset = ((self.size[1] as i32 - 1 - row) as usize * self.size[0] as usize
                    + column as usize)
                    * 4;
                blend_pixel(&mut pixels[offset..offset + 4], source);
            }
        }
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
        for operation in std::mem::take(&mut self.operations).into_operations() {
            match operation {
                Operation::Rect(bounds, color) => {
                    bucket
                        .mesh
                        .add_colored_rect(rect_points(bounds, scale), color);
                    if bucket.mesh.indices.len() >= geometry::MAX_MESH_INDICES {
                        bucket.flush();
                    }
                }
                Operation::Pattern(operation) => {
                    bucket.append(pattern_primitive(
                        *operation,
                        &self.pattern_textures,
                        canvas,
                    ));
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

fn command_bounds(command: PaintCommand, pixels_per_point: f32) -> egui::Rect {
    let pixel = 1.0 / pixels_per_point;
    match command {
        PaintCommand::FillRect { rect, .. } | PaintCommand::PatternRect { rect, .. } => {
            rect.expand(pixel)
        }
        PaintCommand::FrameRect { rect, .. } => rect.expand(pixel),
        PaintCommand::Line { points, width, .. } => {
            egui::Rect::from_two_pos(points[0], points[1]).expand(width.abs() * 0.5 + pixel)
        }
        PaintCommand::Disc { center, radius, .. } => {
            egui::Rect::from_center_size(center, egui::Vec2::splat(radius.abs() * 2.0))
                .expand(pixel)
        }
    }
}

fn pattern_primitive(
    operation: PatternOperation,
    textures: &PatternTextureSet,
    canvas: egui::Rect,
) -> egui::ClippedPrimitive {
    let (texture_id, [tile_width, tile_height]) = textures.spec(operation.pattern).unwrap();
    let mut mesh = egui::Mesh::default();
    mesh.texture_id = texture_id;
    mesh.add_rect_with_uv(
        operation.rect,
        egui::Rect::from_min_max(
            egui::Pos2::ZERO,
            egui::pos2(
                operation.rect.width() / tile_width,
                operation.rect.height() / tile_height,
            ),
        ),
        operation.color,
    );
    egui::ClippedPrimitive {
        clip_rect: canvas,
        primitive: egui::epaint::Primitive::Mesh(mesh),
    }
}

fn paint_pixels(
    size: [u32; 2],
    columns: std::ops::Range<i32>,
    rows: std::ops::Range<i32>,
    source: [u8; 4],
    pixels: &mut [u8],
    is_current: &impl Fn() -> bool,
) {
    for row in rows {
        if row % 64 == 0 && !is_current() {
            return;
        }
        let start =
            ((size[1] as i32 - 1 - row) as usize * size[0] as usize + columns.start as usize) * 4;
        let end = start + columns.len() * 4;
        for pixel in pixels[start..end].chunks_exact_mut(4) {
            blend_pixel(pixel, source);
        }
    }
}

fn blend_pixel(destination: &mut [u8], source: [u8; 4]) {
    if source[3] == 255 {
        destination.copy_from_slice(&source);
        return;
    }
    let alpha = destination[3];
    for channel in 0..3 {
        destination[channel] =
            source[channel].saturating_add(multiply(destination[channel], 255 - source[3]));
    }
    destination[3] = alpha.saturating_add(multiply(source[3], 255 - alpha));
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
