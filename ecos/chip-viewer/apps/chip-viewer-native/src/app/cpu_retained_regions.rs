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
    recomposable: bool,
    coverage: bool,
}

pub(in crate::app) struct RegionModel {
    key: SceneKey,
    pattern_textures: Arc<PatternTextureSet>,
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
            pattern_textures: Arc::clone(&request.pattern_textures),
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
        let supported = commands
            .iter()
            .copied()
            .all(|command| self.supported_command(command));
        let coverage = commands
            .iter()
            .copied()
            .all(|command| self.coverage_command(command));
        let recomposable = matches!(geometry, ShapeGeometry::Rect(_)) && supported;
        let coverage = matches!(geometry, ShapeGeometry::Rect(_)) && coverage;
        let start = self.commands.len();
        self.commands.extend_from_slice(commands);
        self.records.push(Record {
            bbox,
            geometry,
            style,
            commands: start..self.commands.len(),
            recomposable,
            coverage,
        });
        self.byte_len() <= MAX_BYTES
    }

    pub(in crate::app) fn byte_len(&self) -> usize {
        self.records.capacity() * size_of::<Record>()
            + self.commands.capacity() * size_of::<PaintCommand>()
    }

    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn is_recomposable(&self) -> bool {
        self.records.iter().all(|record| record.recomposable)
    }

    fn supported_command(&self, command: PaintCommand) -> bool {
        match command {
            PaintCommand::FillRect { .. } | PaintCommand::FrameRect { .. } => {
                geometry::PixelRectRasterizer::new(self.key.pixels_per_point, self.key.tessellation)
                    .is_some_and(|raster| raster.rectangles(command).is_some())
            }
            PaintCommand::PatternRect { pattern, .. } => {
                self.pattern_textures.spec(pattern).is_some()
            }
            PaintCommand::Line { .. } | PaintCommand::Disc { .. } => false,
        }
    }

    fn coverage_command(&self, command: PaintCommand) -> bool {
        matches!(
            command,
            PaintCommand::FillRect { .. } | PaintCommand::FrameRect { .. }
        ) && self.supported_command(command)
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
        if !self.records.is_empty() && self.records.iter().all(|record| record.coverage) {
            if let Some(candidate) = self.shifted_coverage(key) {
                copy_valid_tiles(&mut pixels, &candidate, regions);
                return Some(pixels);
            }
        }
        if !self.records.is_empty() && self.records.iter().all(|record| record.recomposable) {
            if let Some(candidate) = self.recompose(key) {
                copy_valid_tiles(&mut pixels, &candidate, regions);
                return Some(pixels);
            }
        }
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

    /// Moves geometry-only commands by the integral physical-pixel pan. The
    /// command colors are applied only after the move, so the retained source
    /// is geometry coverage rather than a translated final RGBA image.
    fn shifted_coverage(&self, key: &SceneKey) -> Option<Vec<u8>> {
        let raster = geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        let delta = key.pan - self.key.pan;
        let mut pixels = key
            .background
            .to_array()
            .repeat(key.screen_size[0] as usize * key.screen_size[1] as usize);
        for record in &self.records {
            if !record.coverage {
                continue;
            }
            for &command in &self.commands[record.commands.clone()] {
                let command = translate_coverage_command(command, delta)?;
                paint_recomposed_command(
                    command,
                    raster,
                    key,
                    &self.pattern_textures,
                    &mut pixels,
                )?;
            }
        }
        Some(pixels)
    }

    /// Rebuilds destination style from retained geometry commands. The result
    /// is only copied into tiles proven valid by `validate`; uncovered tiles
    /// are intentionally left for the current-camera damage render.
    fn recompose(&self, key: &SceneKey) -> Option<Vec<u8>> {
        let raster = geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        let size = key.screen_size;
        let mut pixels = key
            .background
            .to_array()
            .repeat(size[0] as usize * size[1] as usize);
        let pass = GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
        let mut commands = Commands::default();
        for record in &self.records {
            if !record.recomposable {
                continue;
            }
            commands.0.clear();
            if record.bbox.intersects(key.viewport) {
                pass.draw(record.geometry, &record.style, &mut commands);
            }
            for &command in &commands.0 {
                paint_recomposed_command(
                    command,
                    raster,
                    key,
                    &self.pattern_textures,
                    &mut pixels,
                )?;
            }
        }
        Some(pixels)
    }

    pub(in crate::app) fn validate(&self, key: &SceneKey, _workers: usize) -> Option<Regions> {
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
        let mut result = Regions::new(key);
        for index in 0..result.invalid.len() {
            let tile = result.tile(index);
            result.invalid[index] = !overlap.contains_rect(tile);
        }
        if !self.records.is_empty() {
            if self.records.iter().any(|record| !record.recomposable) {
                let source_pass =
                    GeometryPass::new(source.world, source.canvas, source.zoom, source.pan);
                let current_pass = GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
                for record in &self.records {
                    if record.coverage {
                        continue;
                    }
                    result.exclude(footprint(&source_pass, source, record.geometry).translate(pan));
                    result.exclude(footprint(&current_pass, key, record.geometry));
                }
            }
            result.proof = Some(CameraProof {
                source: source.clone(),
                current: key.clone(),
            });
            return Some(result);
        }
        result.proof = Some(CameraProof {
            source: source.clone(),
            current: key.clone(),
        });
        Some(result)
    }
}

fn copy_valid_tiles(destination: &mut [u8], source: &[u8], regions: &Regions) {
    let width = regions.size[0] as usize;
    let height = regions.size[1] as usize;
    for (tile_row, invalid) in regions.invalid.chunks(regions.columns).enumerate() {
        let top = tile_row * TILE;
        let bottom = (top + TILE).min(height);
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
            let right = (column * TILE).min(width);
            for row in top..bottom {
                let offset = (height - 1 - row) * width * 4 + left * 4;
                let length = (right - left) * 4;
                destination[offset..offset + length]
                    .copy_from_slice(&source[offset..offset + length]);
            }
        }
    }
}

fn footprint(pass: &GeometryPass, key: &SceneKey, geometry: ShapeGeometry) -> egui::Rect {
    let bounds = pass.project(geometry).bounds();
    egui::Rect::from_min_max(
        bounds.min * key.pixels_per_point,
        bounds.max * key.pixels_per_point,
    )
    .expand(2.0)
    .intersect(physical_clip(key))
}

fn translate_coverage_command(command: PaintCommand, delta: egui::Vec2) -> Option<PaintCommand> {
    Some(match command {
        PaintCommand::FillRect { rect, rgba } => PaintCommand::FillRect {
            rect: rect.translate(delta),
            rgba,
        },
        PaintCommand::FrameRect { rect, width, rgba } => PaintCommand::FrameRect {
            rect: rect.translate(delta),
            width,
            rgba,
        },
        PaintCommand::PatternRect { .. }
        | PaintCommand::Line { .. }
        | PaintCommand::Disc { .. } => return None,
    })
}

fn paint_recomposed_command(
    command: PaintCommand,
    raster: geometry::PixelRectRasterizer,
    key: &SceneKey,
    pattern_textures: &PatternTextureSet,
    pixels: &mut [u8],
) -> Option<()> {
    match command {
        PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
            for rect in raster.rectangles(command)? {
                let Some([left, top, right, bottom]) = physical_bounds(rect, key) else {
                    continue;
                };
                for row in top..bottom {
                    let offset = ((key.screen_size[1] as usize - 1 - row)
                        * key.screen_size[0] as usize
                        + left)
                        * 4;
                    for pixel in pixels[offset..offset + (right - left) * 4].chunks_exact_mut(4) {
                        blend_recomposed_pixel(pixel, rgba);
                    }
                }
            }
        }
        PaintCommand::PatternRect {
            rect,
            pattern,
            rgba,
        } => {
            let [left, top, right, bottom] = physical_bounds(rect, key)?;
            let tile = pattern_textures.spec(pattern)?.1;
            let scale = key.pixels_per_point;
            for row in top..bottom {
                for column in left..right {
                    let point =
                        egui::pos2((column as f32 + 0.5) / scale, (row as f32 + 0.5) / scale);
                    if point.x <= rect.left()
                        || point.x >= rect.right()
                        || point.y <= rect.top()
                        || point.y >= rect.bottom()
                    {
                        continue;
                    }
                    let mask = pattern_textures.sample(
                        pattern,
                        [
                            (point.x - rect.left()) / tile[0],
                            (point.y - rect.top()) / tile[1],
                        ],
                    )?;
                    if mask[0] == 0 && mask[3] == 0 {
                        continue;
                    }
                    let mut source = rgba;
                    for channel in 0..4 {
                        source[channel] = multiply_recomposed(source[channel], mask[channel]);
                    }
                    let offset = ((key.screen_size[1] as usize - 1 - row)
                        * key.screen_size[0] as usize
                        + column)
                        * 4;
                    blend_recomposed_pixel(&mut pixels[offset..offset + 4], source);
                }
            }
        }
        PaintCommand::Line { .. } | PaintCommand::Disc { .. } => return None,
    }
    Some(())
}

fn physical_bounds(rect: egui::Rect, key: &SceneKey) -> Option<[usize; 4]> {
    let scale = key.pixels_per_point;
    let clip = physical_clip(key);
    let left = (rect.left() * scale)
        .floor()
        .max(clip.left())
        .min(clip.right()) as usize;
    let top = (rect.top() * scale)
        .floor()
        .max(clip.top())
        .min(clip.bottom()) as usize;
    let right = (rect.right() * scale)
        .ceil()
        .max(clip.left())
        .min(clip.right()) as usize;
    let bottom = (rect.bottom() * scale)
        .ceil()
        .max(clip.top())
        .min(clip.bottom()) as usize;
    (left < right && top < bottom).then_some([left, top, right, bottom])
}

fn blend_recomposed_pixel(destination: &mut [u8], source: [u8; 4]) {
    if source[3] == 255 {
        destination.copy_from_slice(&source);
        return;
    }
    let alpha = destination[3];
    for channel in 0..3 {
        destination[channel] = source[channel]
            .saturating_add(multiply_recomposed(destination[channel], 255 - source[3]));
    }
    destination[3] = alpha.saturating_add(multiply_recomposed(source[3], 255 - alpha));
}

fn multiply_recomposed(left: u8, right: u8) -> u8 {
    let product = u32::from(left) * u32::from(right);
    ((product + (product >> 8) + 128) >> 8) as u8
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
