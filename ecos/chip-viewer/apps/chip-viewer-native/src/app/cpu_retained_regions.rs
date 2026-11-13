use super::*;
use chip_display::LayerStyle;
use chip_render::geometry2d::{GeometryPass, PaintCommand, PaintSink};
use chip_view_db::ShapeGeometry;
use std::ops::Range;

const TILE: usize = 8;
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[cfg(test)]
#[path = "cpu_retained_copy_tests.rs"]
mod copy_tests;

struct Record {
    bbox: Rect32,
    geometry: ShapeGeometry,
    style: LayerStyle,
    commands: Range<usize>,
}

pub(in crate::app) struct RegionModel {
    key: SceneKey,
    tessellator: egui::epaint::Tessellator,
    records: Vec<Record>,
    commands: Vec<PaintCommand>,
}

pub(in crate::app) struct Regions {
    size: [u32; 2],
    columns: usize,
    invalid: Vec<bool>,
    #[cfg(test)]
    scale: f32,
    proof: Option<CameraProof>,
}

struct CameraProof {
    source: SceneKey,
    current: SceneKey,
}

impl RegionModel {
    pub(super) fn new(request: &SceneRequest) -> Option<Self> {
        let key = &request.key;
        let world = request.data_bounds?;
        let view = key.viewport;
        if key.screen_size.contains(&0)
            || !key.canvas.is_finite()
            || !key.canvas.is_positive()
            || !key.pan.is_finite()
            || !key.zoom.is_finite()
            || key.zoom <= 0.0
            || key.screen_size.into_iter().any(|side| side > 16384)
            || u64::from(key.screen_size[0]) * u64::from(key.screen_size[1]) > 16_777_216
        {
            return None;
        }
        if view.lx > world.lx || view.ly > world.ly || view.hx < world.hx || view.hy < world.hy {
            return None;
        }
        if key.cache_overlays
            && (!request.db.unrouted_net_guides().is_empty()
                || request.db.grid_metadata().iter().any(|grid| {
                    parameterized_grid_is_visible(
                        grid,
                        &request.grid_layers,
                        key.visibility,
                        key.zoom,
                    )
                }))
        {
            return None;
        }
        geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        Some(Self {
            key: key.clone(),
            tessellator: request.tessellator.clone(),
            records: Vec::new(),
            commands: Vec::new(),
        })
    }

    pub(super) fn push(
        &mut self,
        bbox: Rect32,
        geometry: ShapeGeometry,
        style: LayerStyle,
        commands: &[PaintCommand],
    ) -> bool {
        let start = self.commands.len();
        self.commands.extend_from_slice(commands);
        self.records.push(Record {
            bbox,
            geometry,
            style,
            commands: start..self.commands.len(),
        });
        self.byte_len() <= MAX_BYTES
    }

    pub(in crate::app) fn byte_len(&self) -> usize {
        self.records.capacity() * size_of::<Record>()
            + self.commands.capacity() * size_of::<PaintCommand>()
    }

    pub(in crate::app) fn compose(
        &self,
        key: &SceneKey,
        regions: &Regions,
        source: &[u8],
    ) -> Option<Vec<u8>> {
        let size = key.screen_size;
        let count = size[0] as usize * size[1] as usize;
        if source.len() != count * 4
            || regions.size != size
            || regions
                .proof
                .as_ref()
                .is_none_or(|proof| proof.source != self.key || proof.current != *key)
        {
            return None;
        }
        let pan = (key.pan - self.key.pan) * key.pixels_per_point;
        let mut pixels = key.background.to_array().repeat(count);
        for (tile_row, invalid) in regions.invalid.chunks(regions.columns).enumerate() {
            let mut column = 0;
            while column < invalid.len() {
                if invalid[column] {
                    column += 1;
                    continue;
                }
                let left = column * TILE;
                while column < invalid.len() && !invalid[column] {
                    column += 1;
                }
                let right = (column * TILE).min(size[0] as usize);
                let top = tile_row * TILE;
                let bottom = (top + TILE).min(size[1] as usize);
                let source_column = (left as i32 - pan.x as i32) as usize;
                for row in top..bottom {
                    let source_row = (row as i32 - pan.y as i32) as usize;
                    let old = ((size[1] as usize - 1 - source_row) * size[0] as usize
                        + source_column)
                        * 4;
                    let new = ((size[1] as usize - 1 - row) * size[0] as usize + left) * 4;
                    let bytes = (right - left) * 4;
                    pixels[new..new + bytes].copy_from_slice(&source[old..old + bytes]);
                }
            }
        }
        Some(pixels)
    }

    pub(in crate::app) fn validate(&self, key: &SceneKey, workers: usize) -> Option<Regions> {
        let source = &self.key;
        let pan = (key.pan - source.pan) * key.pixels_per_point;
        if !source.compatible(key)
            || source.zoom != key.zoom
            || source.canvas != key.canvas
            || source.screen_size != key.screen_size
            || source.font_texture_size != key.font_texture_size
            || !pan.is_finite()
            || pan.x.fract() != 0.0
            || pan.y.fract() != 0.0
        {
            return None;
        }
        let clip = physical_clip(key);
        let overlap = clip.intersect(clip.translate(pan));
        if !overlap.is_positive() {
            return None;
        }
        let pass = GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
        let mut result = Regions::new(key);
        for index in 0..result.invalid.len() {
            let tile = result.tile(index);
            result.invalid[index] = !overlap.contains_rect(tile);
        }
        let partials = thread::scope(|scope| {
            self.records
                .chunks(self.records.len().div_ceil(workers.max(1)).max(1))
                .map(|records| {
                    let pass = &pass;
                    scope.spawn(move || {
                        let mut invalid = Regions::new(key);
                        let mut current = Commands::default();
                        let mut old = Footprints::new(source, &self.tessellator);
                        let mut new = Footprints::new(key, &self.tessellator);
                        for record in records {
                            current.0.clear();
                            if record.bbox.intersects(key.viewport) {
                                pass.draw(record.geometry, &record.style, &mut current);
                            }
                            old.reset();
                            new.reset();
                            for command in &self.commands[record.commands.clone()] {
                                old.paint(*command);
                            }
                            for command in &current.0 {
                                new.paint(*command);
                            }
                            for rect in &old.repairs {
                                invalid.exclude(rect.translate(pan));
                            }
                            for rect in &new.repairs {
                                invalid.exclude(*rect);
                            }
                            let mut previous = old.rectangles.iter().filter_map(|(rect, color)| {
                                let rect = rect.translate(pan).intersect(overlap);
                                rect.is_positive().then_some((rect, *color))
                            });
                            let mut current = new.rectangles.iter().filter_map(|(rect, color)| {
                                let rect = rect.intersect(overlap);
                                rect.is_positive().then_some((rect, *color))
                            });
                            loop {
                                match (previous.next(), current.next()) {
                                    (None, None) => break,
                                    (Some((previous, before)), Some((current, after)))
                                        if before == after =>
                                    {
                                        invalid.exclude_difference(previous, current)
                                    }
                                    (previous, current) => {
                                        for (rect, _) in previous.into_iter().chain(current) {
                                            invalid.exclude(rect);
                                        }
                                    }
                                }
                            }
                        }
                        invalid
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|task| task.join().expect("retained region worker panicked"))
                .collect::<Vec<_>>()
        });
        for partial in partials {
            for (invalid, other) in result.invalid.iter_mut().zip(partial.invalid) {
                *invalid |= other;
            }
        }
        result.proof = Some(CameraProof {
            source: source.clone(),
            current: key.clone(),
        });
        Some(result)
    }
}

impl Regions {
    pub(in crate::app) fn pixel_count(&self) -> usize {
        self.invalid
            .iter()
            .enumerate()
            .filter(|(_, invalid)| !**invalid)
            .map(|(index, _)| self.tile(index).area() as usize)
            .sum()
    }

    fn new(key: &SceneKey) -> Self {
        let columns = (key.screen_size[0] as usize).div_ceil(TILE);
        let rows = (key.screen_size[1] as usize).div_ceil(TILE);
        Self {
            size: key.screen_size,
            columns,
            invalid: vec![false; columns * rows],
            #[cfg(test)]
            scale: key.pixels_per_point,
            proof: None,
        }
    }

    fn tile(&self, index: usize) -> egui::Rect {
        let left = index % self.columns * TILE;
        let top = index / self.columns * TILE;
        egui::Rect::from_min_max(
            egui::pos2(left as f32, top as f32),
            egui::pos2(
                (left + TILE).min(self.size[0] as usize) as f32,
                (top + TILE).min(self.size[1] as usize) as f32,
            ),
        )
    }

    fn exclude(&mut self, rect: egui::Rect) {
        if !rect.is_positive() {
            return;
        }
        let left = (rect.left().max(0.0) / TILE as f32).floor() as usize;
        let top = (rect.top().max(0.0) / TILE as f32).floor() as usize;
        let right = (rect.right().max(0.0) / TILE as f32).ceil() as usize;
        let bottom = (rect.bottom().max(0.0) / TILE as f32).ceil() as usize;
        let rows = (self.size[1] as usize).div_ceil(TILE);
        for row in top.min(rows)..bottom.min(rows) {
            let start = row * self.columns;
            self.invalid[start + left.min(self.columns)..start + right.min(self.columns)]
                .fill(true);
        }
    }

    fn exclude_difference(&mut self, previous: egui::Rect, current: egui::Rect) {
        if previous == current {
            return;
        }
        let common = previous.intersect(current);
        if !common.is_positive() {
            self.exclude(previous);
            self.exclude(current);
            return;
        }
        for rect in [previous, current] {
            for difference in [
                egui::Rect::from_min_max(rect.min, egui::pos2(rect.right(), common.top())),
                egui::Rect::from_min_max(egui::pos2(rect.left(), common.bottom()), rect.max),
                egui::Rect::from_min_max(
                    egui::pos2(rect.left(), common.top()),
                    egui::pos2(common.left(), common.bottom()),
                ),
                egui::Rect::from_min_max(
                    egui::pos2(common.right(), common.top()),
                    egui::pos2(rect.right(), common.bottom()),
                ),
            ] {
                self.exclude(difference);
            }
        }
    }

    #[cfg(test)]
    pub(in crate::app) fn clips(&self) -> Vec<egui::Rect> {
        let mut output = Vec::new();
        for row in 0..self.invalid.len() / self.columns {
            let mut column = 0;
            while column < self.columns {
                if self.invalid[row * self.columns + column] {
                    column += 1;
                    continue;
                }
                let start = column;
                while column < self.columns && !self.invalid[row * self.columns + column] {
                    column += 1;
                }
                let rect = self
                    .tile(row * self.columns + start)
                    .union(self.tile(row * self.columns + column - 1));
                output.push(egui::Rect::from_min_max(
                    rect.min / self.scale,
                    rect.max / self.scale,
                ));
            }
        }
        output
    }
}

#[derive(Default)]
struct Commands(Vec<PaintCommand>);

impl PaintSink for Commands {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

struct Footprints<'a> {
    raster: geometry::PixelRectRasterizer,
    key: &'a SceneKey,
    tessellator: &'a egui::epaint::Tessellator,
    rectangles: Vec<(egui::Rect, [u8; 4])>,
    repairs: Vec<egui::Rect>,
}

impl<'a> Footprints<'a> {
    fn new(key: &'a SceneKey, tessellator: &'a egui::epaint::Tessellator) -> Self {
        Self {
            raster: geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)
                .unwrap(),
            key,
            tessellator,
            rectangles: Vec::new(),
            repairs: Vec::new(),
        }
    }

    fn reset(&mut self) {
        self.rectangles.clear();
        self.repairs.clear();
    }
}

impl PaintSink for Footprints<'_> {
    fn paint(&mut self, command: PaintCommand) {
        let scale = self.key.pixels_per_point;
        let clip = physical_clip(self.key);
        if let Some(rectangles) = self.raster.rectangles(command) {
            let rgba = match command {
                PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => rgba,
                _ => unreachable!(),
            };
            for rect in rectangles {
                let rect =
                    egui::Rect::from_min_max(rect.min * scale, rect.max * scale).intersect(clip);
                if rect.is_positive() {
                    self.rectangles.push((rect, rgba));
                }
            }
        } else {
            let mut sink = geometry::GeometryMeshSink::new(
                self.tessellator.clone(),
                self.key.canvas,
                self.key.tessellation,
            );
            sink.paint(command);
            for primitive in sink.finish() {
                let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive else {
                    unreachable!()
                };
                let bounds = mesh
                    .vertices
                    .iter()
                    .fold(egui::Rect::NOTHING, |bounds, vertex| {
                        bounds.union(egui::Rect::from_min_max(vertex.pos, vertex.pos))
                    });
                let bounds = bounds.expand(1.0).intersect(primitive.clip_rect);
                let rect = egui::Rect::from_min_max(
                    (bounds.min * scale).floor().max(clip.min),
                    (bounds.max * scale).ceil().min(clip.max),
                );
                if rect.is_positive() {
                    self.repairs.push(rect);
                }
            }
        }
    }
}

fn physical_clip(key: &SceneKey) -> egui::Rect {
    egui::Rect::from_min_max(
        (key.canvas.min * key.pixels_per_point)
            .round()
            .max(egui::Pos2::ZERO),
        (key.canvas.max * key.pixels_per_point)
            .round()
            .min(egui::pos2(
                key.screen_size[0] as f32,
                key.screen_size[1] as f32,
            )),
    )
}
