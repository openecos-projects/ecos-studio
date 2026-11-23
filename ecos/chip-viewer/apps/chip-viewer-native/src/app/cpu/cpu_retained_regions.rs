use super::*;
use chip_display::LayerStyle;
use chip_render::geometry2d::{GeometryPass, PaintCommand, PaintSink};
use chip_view_db::ShapeGeometry;

const TILE: usize = 8;
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[path = "cpu_retained_plan.rs"]
mod plan;

#[path = "cpu_retained_worker.rs"]
pub(in crate::app) mod worker;

#[cfg(test)]
#[path = "cpu_retained_copy_tests.rs"]
mod copy_tests;

#[cfg(test)]
#[path = "cpu_retained_cancel_tests.rs"]
mod cancel_tests;

#[cfg(all(test, target_os = "linux"))]
#[path = "cpu_retained_regression_tests.rs"]
mod regression_tests;

struct Record {
    bbox: Rect32,
    geometry: ShapeGeometry,
    style: LayerStyle,
    #[cfg(test)]
    recomposable: bool,
}

pub(in crate::app) struct RegionModel {
    key: SceneKey,
    pattern_textures: Arc<PatternTextureSet>,
    records: Vec<Record>,
    tessellator: egui::epaint::Tessellator,
    identity: Arc<()>,
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
    identity: Arc<()>,
    records: usize,
    plan: plan::Plan,
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
            tessellator: request.tessellator.clone(),
            identity: Arc::new(()),
        })
    }

    pub(super) fn push(
        &mut self,
        bbox: Rect32,
        geometry: ShapeGeometry,
        style: LayerStyle,
        commands: &[PaintCommand],
    ) -> bool {
        // Source commands are useful diagnostics, never target eligibility proof.
        #[cfg(not(test))]
        let _ = commands;
        self.records.push(Record {
            bbox,
            geometry,
            style,
            #[cfg(test)]
            recomposable: matches!(geometry, ShapeGeometry::Rect(_))
                && commands
                    .iter()
                    .all(|&command| self.supported_command(command)),
        });
        self.byte_len() <= MAX_BYTES
    }

    pub(in crate::app) fn byte_len(&self) -> usize {
        self.records.capacity() * size_of::<Record>()
    }

    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn is_recomposable(&self) -> bool {
        self.records.iter().all(|record| record.recomposable)
    }

    #[cfg(test)]
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

    /// Compose only the commands prepared for this exact target. Old RGBA is
    /// never a fallback for failed preparation, changed clipping, or GL style.
    #[cfg(test)]
    pub(in crate::app) fn compose(
        &self,
        key: &SceneKey,
        regions: &Regions,
        source: &[u8],
    ) -> Option<Vec<u8>> {
        self.compose_current(key, regions, source, &|| true)
    }

    pub(in crate::app) fn compose_current(
        &self,
        key: &SceneKey,
        regions: &Regions,
        source: &[u8],
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<u8>> {
        let count = key.screen_size[0] as usize * key.screen_size[1] as usize;
        let proof = regions.proof.as_ref()?;
        if source.len() != count * 4
            || regions.size != key.screen_size
            || proof.source != self.key
            || proof.current != *key
            || !Arc::ptr_eq(&proof.identity, &self.identity)
            || proof.records != self.records.len()
        {
            return None;
        }
        let candidate = proof.plan.paint(key, &self.pattern_textures, is_current)?;
        let mut pixels = blank_pixels(key, is_current)?;
        copy_valid_tiles_current(&mut pixels, &candidate, regions, is_current)?;
        is_current().then_some(pixels)
    }

    /// Presentation must use the actual GL profile. Uncertified blend/texture
    /// implementations replay target meshes instead of trusting CPU byte math.
    #[cfg(test)]
    pub(in crate::app) fn prepare_for_gl(
        &self,
        key: &SceneKey,
        workers: usize,
        gl: &eframe::glow::Context,
    ) -> Option<Regions> {
        #[cfg(target_os = "linux")]
        let cpu_style = sparse_rects::certified_profile(gl);
        #[cfg(not(target_os = "linux"))]
        let cpu_style = {
            let _ = gl;
            false
        };
        let _ = workers;
        self.prepare_current(key, cpu_style, &|| true)
    }

    /// The CPU-only seam is for the certified sparse rendering profile.
    #[cfg(test)]
    pub(in crate::app) fn validate(&self, key: &SceneKey, workers: usize) -> Option<Regions> {
        let _ = workers;
        self.prepare_current(key, true, &|| true)
    }

    /// The GL profile is captured by the presenter with its context current.
    /// This preparation uses only immutable CPU data and can run on a worker.
    pub(in crate::app) fn prepare_current(
        &self,
        key: &SceneKey,
        cpu_style: bool,
        is_current: &impl Fn() -> bool,
    ) -> Option<Regions> {
        if !is_current() {
            return None;
        }
        let source = &self.key;
        let pan = (key.pan - source.pan) * key.pixels_per_point;
        if !source.compatible(key)
            || source.zoom != key.zoom
            || source.canvas != key.canvas
            || source.screen_size != key.screen_size
            || source.font_texture_size != key.font_texture_size
            || source.selected != key.selected
            || source.highlighted != key.highlighted
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
            if index % 4096 == 0 && !is_current() {
                return None;
            }
            let tile = result.tile(index);
            // Unknown blend profiles replay the canvas once in GL. Splitting
            // damage around every command duplicates large meshes per clip.
            result.invalid[index] = if cpu_style {
                !overlap.contains_rect(tile)
            } else {
                tile.intersects(clip)
            };
        }
        let plan = plan::Plan::prepare(self, key, &mut result, cpu_style, is_current)?;
        result.proof = Some(CameraProof {
            source: source.clone(),
            current: key.clone(),
            identity: Arc::clone(&self.identity),
            records: self.records.len(),
            plan,
        });
        is_current().then_some(result)
    }
}

#[cfg(test)]
fn copy_valid_tiles(destination: &mut [u8], source: &[u8], regions: &Regions) {
    copy_valid_tiles_current(destination, source, regions, &|| true).unwrap();
}

fn copy_valid_tiles_current(
    destination: &mut [u8],
    source: &[u8],
    regions: &Regions,
    is_current: &impl Fn() -> bool,
) -> Option<()> {
    let width = regions.size[0] as usize;
    let height = regions.size[1] as usize;
    for (tile_row, invalid) in regions.invalid.chunks(regions.columns).enumerate() {
        if tile_row % 4 == 0 && !is_current() {
            return None;
        }
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
    is_current().then_some(())
}

fn blank_pixels(key: &SceneKey, is_current: &impl Fn() -> bool) -> Option<Vec<u8>> {
    let width = key.screen_size[0] as usize;
    let height = key.screen_size[1] as usize;
    let mut pixels = Vec::with_capacity(width * height * 4);
    let background = key.background.to_array();
    for top in (0..height).step_by(32) {
        if !is_current() {
            return None;
        }
        let start = pixels.len();
        pixels.resize(width * (top + 32).min(height) * 4, 0);
        for pixel in pixels[start..].chunks_exact_mut(4) {
            pixel.copy_from_slice(&background);
        }
    }
    is_current().then_some(pixels)
}

fn paint_recomposed_command(
    command: PaintCommand,
    raster: geometry::PixelRectRasterizer,
    key: &SceneKey,
    pattern_textures: &PatternTextureSet,
    pixels: &mut [u8],
    is_current: &impl Fn() -> bool,
) -> Option<()> {
    match command {
        PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
            let source = color32(rgba).to_array();
            for rect in raster.rectangles(command)? {
                let Some([left, top, right, bottom]) = physical_bounds(rect, key) else {
                    continue;
                };
                for row in top..bottom {
                    if (row - top) % 32 == 0 && !is_current() {
                        return None;
                    }
                    let offset = ((key.screen_size[1] as usize - 1 - row)
                        * key.screen_size[0] as usize
                        + left)
                        * 4;
                    for pixel in pixels[offset..offset + (right - left) * 4].chunks_exact_mut(4) {
                        blend_recomposed_pixel(pixel, source);
                    }
                }
            }
        }
        PaintCommand::PatternRect {
            rect,
            pattern,
            rgba,
        } => {
            let Some([left, top, right, bottom]) = physical_bounds(rect, key) else {
                return Some(());
            };
            let tile = pattern_textures.spec(pattern)?.1;
            let color = color32(rgba).to_array();
            let scale = key.pixels_per_point;
            for row in top..bottom {
                if (row - top) % 32 == 0 && !is_current() {
                    return None;
                }
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
                    let mut source = color;
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
    /// Render these ordered meshes over the composed bitmap before presenting
    /// it. Damage pixels start at background, so translucent repairs blend once.
    /// Failure means the retained presentation must be discarded in full.
    #[cfg(test)]
    pub(in crate::app) fn repair_meshes(
        &self,
        key: &SceneKey,
    ) -> Option<Vec<egui::ClippedPrimitive>> {
        self.repair_meshes_current(key, &|| true)
    }

    pub(in crate::app) fn repair_meshes_current(
        &self,
        key: &SceneKey,
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<egui::ClippedPrimitive>> {
        let proof = self.proof.as_ref()?;
        if proof.current != *key {
            return None;
        }
        proof.plan.repair_meshes(
            key,
            &self.damage_clips_current(key, is_current)?,
            is_current,
        )
    }

    #[cfg(test)]
    pub(in crate::app) fn damage_clips(&self, key: &SceneKey) -> Vec<egui::Rect> {
        self.damage_clips_current(key, &|| true).unwrap()
    }

    fn damage_clips_current(
        &self,
        key: &SceneKey,
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<egui::Rect>> {
        let mut output = Vec::new();
        let mut previous = BTreeMap::<(usize, usize), usize>::new();
        for (row, invalid) in self.invalid.chunks(self.columns).enumerate() {
            if row % 4 == 0 && !is_current() {
                return None;
            }
            let mut current = BTreeMap::new();
            let mut column = 0;
            while column < invalid.len() {
                if !invalid[column] {
                    column += 1;
                    continue;
                }
                let left = column;
                while column < invalid.len() && invalid[column] {
                    column += 1;
                }
                let span = (left, column);
                let rect = self
                    .tile(row * self.columns + left)
                    .union(self.tile(row * self.columns + column - 1));
                let rect = egui::Rect::from_min_max(
                    rect.min / key.pixels_per_point,
                    rect.max / key.pixels_per_point,
                )
                .intersect(key.canvas);
                if !rect.is_positive() {
                    continue;
                }
                let index = if let Some(&index) = previous.get(&span) {
                    output[index] = egui::Rect::union(output[index], rect);
                    index
                } else {
                    let index = output.len();
                    output.push(rect);
                    index
                };
                current.insert(span, index);
            }
            previous = current;
        }
        is_current().then_some(output)
    }

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
