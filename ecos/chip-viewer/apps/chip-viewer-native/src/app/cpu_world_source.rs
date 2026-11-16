//! Bounded, filtered world rectangles in the complete source stream's order.
//! This reuses accepted source records, not masters, meshes or old RGBA. Capture
//! before screen culling, finish only after the entire ordered stream succeeds,
//! and discard the builder as soon as push returns false. Labels are separate.
use super::{SceneKey, SceneRequest};
use chip_display::LayerStyle;
use chip_render::geometry2d::{GeometryPass, PaintCommand, PaintSink};
use chip_view_db::{ChipViewDb, ShapeGeometry};
use chipgeom_format::{LayerId, Rect32};
use std::collections::BTreeSet;
use std::mem::{size_of, size_of_val};
use std::sync::{Arc, OnceLock, Weak};

const PAGE_RECORDS: usize = 4096;
const MAX_BYTES: usize = 64 * 1024 * 1024;

fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var_os("ECOS_DISABLE_WORLD_SOURCE").is_none())
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app::cpu_scene) struct Record {
    rect: Rect32,
    style_id: u16,
    padding: u16,
}

struct Key {
    scene: SceneKey,
    db: Weak<ChipViewDb>,
    bounds: Rect32,
    styles: Box<[(LayerId, LayerStyle)]>,
    visibility: Box<[(LayerId, bool)]>,
    layers: Box<[LayerId]>,
    context: bool,
    grid_rules: (bool, bool),
}

impl Key {
    fn new(request: &SceneRequest, bounds: Rect32) -> Self {
        let key = &request.key;
        // Selection/highlight sets are unrelated to filtered base geometry.
        // Do not clone their potentially large allocations into this key.
        let scene = SceneKey {
            epoch: key.epoch,
            layers: key.layers,
            visibility: key.visibility,
            world: key.world,
            viewport: key.viewport,
            canvas: key.canvas,
            zoom: key.zoom,
            pan: key.pan,
            pixels_per_point: key.pixels_per_point,
            tessellation: key.tessellation,
            font_texture_size: key.font_texture_size,
            selected: None,
            highlighted: BTreeSet::new(),
            screen_size: key.screen_size,
            background: key.background,
            grid_bounds: key.grid_bounds,
            cache_overlays: key.cache_overlays,
        };
        Self {
            scene,
            db: Arc::downgrade(&request.db),
            bounds,
            styles: request
                .layers
                .style_map
                .iter()
                .map(|(&id, &s)| (id, s))
                .collect(),
            visibility: request
                .layers
                .visible_layer_map
                .iter()
                .map(|(&id, &v)| (id, v))
                .collect(),
            layers: request.layer_ids.clone().into_boxed_slice(),
            context: key.zoom > 1.25,
            grid_rules: (
                request.zoom_rules.track_grid_suppressed,
                request.zoom_rules.gcell_grid_suppressed,
            ),
        }
    }

    fn same_content(&self, request: &SceneRequest) -> bool {
        self.scene.epoch == request.key.epoch
            && self.scene.layers == request.key.layers
            && self.scene.visibility == request.key.visibility
            && self.db.as_ptr() == Arc::as_ptr(&request.db)
            && request.data_bounds == Some(self.bounds)
            && self.grid_rules
                == (
                    request.zoom_rules.track_grid_suppressed,
                    request.zoom_rules.gcell_grid_suppressed,
                )
            && self.layers.as_ref() == request.layer_ids.as_slice()
            && self.styles.len() == request.layers.style_map.len()
            && self
                .styles
                .iter()
                .zip(&request.layers.style_map)
                .all(|((a, b), (c, d))| a == c && b == d)
            && self.visibility.len() == request.layers.visible_layer_map.len()
            && self
                .visibility
                .iter()
                .zip(&request.layers.visible_layer_map)
                .all(|((a, b), (c, d))| a == c && b == d)
    }

    fn allocated_bytes(&self) -> usize {
        size_of_val(self.styles.as_ref())
            + size_of_val(self.visibility.as_ref())
            + size_of_val(self.layers.as_ref())
    }
}

pub(in crate::app::cpu_scene) struct WorldSource {
    key: Key,
    pages: Vec<Vec<Record>>,
    palette: Vec<LayerStyle>,
    record_bytes: usize,
    valid: bool,
}

impl WorldSource {
    pub(in crate::app::cpu_scene) fn byte_len(&self) -> usize {
        size_of::<Self>()
            + self.key.allocated_bytes()
            + self.record_bytes
            + self.pages.capacity() * size_of::<Vec<Record>>()
            + self.palette.capacity() * size_of::<LayerStyle>()
    }

    pub(in crate::app::cpu_scene) fn compatible(&self, request: &SceneRequest) -> bool {
        self.same_content(request) && self.key.context == (request.key.zoom > 1.25)
    }

    pub(in crate::app::cpu_scene) fn should_replace(&self, current: &Self) -> bool {
        // Keep the fit source across high-zoom requests so returning to the
        // full layout does not repeat its complete spatial query and filtering.
        current.key.context || !self.key.context
    }

    /// Retain the complete source across a zoom visibility-bucket miss. Only
    /// compatible requests may replay it; same_content is a retention predicate.
    pub(in crate::app::cpu_scene) fn same_content(&self, request: &SceneRequest) -> bool {
        enabled() && self.valid && self.key.same_content(request)
    }

    pub(in crate::app::cpu_scene) fn chunks(&self) -> impl Iterator<Item = &[Record]> {
        self.pages.iter().map(Vec::as_slice)
    }

    /// Reproject this source's chunk through the ordinary geometry pass. The
    /// inclusive bbox test is the original DB query's intersection semantics.
    /// No DB, owner, filtering or style lookup is repeated here.
    pub(in crate::app::cpu_scene) fn commands(
        &self,
        records: &[Record],
        request: &SceneRequest,
        current: &impl Fn() -> bool,
    ) -> Option<(Vec<PaintCommand>, usize, usize)> {
        if !current() || !self.compatible(request) || !self.owns(records) {
            return None;
        }
        let key = &request.key;
        let pass = GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
        let mut output = Commands(Vec::new());
        let mut drawn = 0;
        let mut primitives = 0;
        for (index, record) in records.iter().enumerate() {
            if index % 64 == 0 && !current() {
                return None;
            }
            if !record.rect.intersects(key.viewport) {
                continue;
            }
            let style = self.palette.get(usize::from(record.style_id))?;
            let count = pass.draw(ShapeGeometry::Rect(record.rect), style, &mut output);
            drawn += usize::from(count > 0);
            primitives += count;
        }
        current().then_some((output.0, drawn, primitives))
    }

    fn owns(&self, records: &[Record]) -> bool {
        if records.is_empty() {
            return true;
        }
        let start = records.as_ptr() as usize;
        let end = start + size_of_val(records);
        self.pages.iter().any(|page| {
            let base = page.as_ptr() as usize;
            start >= base && end <= base + size_of_val(page.as_slice())
        })
    }
}

struct Commands(Vec<PaintCommand>);

impl PaintSink for Commands {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

pub(in crate::app::cpu_scene) struct Builder {
    source: WorldSource,
    last_style: Option<(LayerStyle, u16)>,
    limit: usize,
}

impl Builder {
    pub(in crate::app::cpu_scene) fn new(request: &SceneRequest) -> Option<Self> {
        enabled()
            .then(|| Self::with_limit(request, MAX_BYTES))
            .flatten()
    }

    fn with_limit(request: &SceneRequest, limit: usize) -> Option<Self> {
        let bounds = request.data_bounds?;
        let view = request.key.viewport;
        if view.lx > bounds.lx || view.ly > bounds.ly || view.hx < bounds.hx || view.hy < bounds.hy
        {
            return None;
        }
        let key_bytes = request
            .layers
            .style_map
            .len()
            .checked_mul(size_of::<(LayerId, LayerStyle)>())?
            .checked_add(
                request
                    .layers
                    .visible_layer_map
                    .len()
                    .checked_mul(size_of::<(LayerId, bool)>())?,
            )?
            .checked_add(request.layer_ids.len().checked_mul(size_of::<LayerId>())?)?;
        if size_of::<Self>().checked_add(key_bytes)? > limit {
            return None;
        }
        Some(Self {
            source: WorldSource {
                key: Key::new(request, bounds),
                pages: Vec::new(),
                palette: Vec::new(),
                record_bytes: 0,
                valid: true,
            },
            last_style: None,
            limit,
        })
    }

    pub(in crate::app::cpu_scene) fn push(
        &mut self,
        bbox: Rect32,
        geometry: ShapeGeometry,
        style: LayerStyle,
    ) -> bool {
        if !self.source.valid {
            return false;
        }
        if geometry != ShapeGeometry::Rect(bbox) {
            return self.reject();
        }
        let style_id = if let Some((_, id)) = self.last_style.filter(|(s, _)| *s == style) {
            id
        } else if let Some(index) = self.source.palette.iter().position(|s| *s == style) {
            index as u16
        } else {
            let Ok(id) = u16::try_from(self.source.palette.len()) else {
                return self.reject();
            };
            if self.source.palette.len() == self.source.palette.capacity()
                && (!self.room(size_of::<LayerStyle>())
                    || self.source.palette.try_reserve_exact(1).is_err())
            {
                return self.reject();
            }
            self.source.palette.push(style);
            id
        };
        self.last_style = Some((style, style_id));
        if self
            .source
            .pages
            .last()
            .is_none_or(|page| page.len() == PAGE_RECORDS)
        {
            let metadata = usize::from(self.source.pages.len() == self.source.pages.capacity())
                * size_of::<Vec<Record>>();
            if !self.room(PAGE_RECORDS * size_of::<Record>() + metadata)
                || self.source.pages.try_reserve_exact(1).is_err()
            {
                return self.reject();
            }
            let mut page = Vec::new();
            if page.try_reserve_exact(PAGE_RECORDS).is_err() {
                return self.reject();
            }
            self.source.record_bytes += page.capacity() * size_of::<Record>();
            self.source.pages.push(page);
        }
        if !self.room(0) {
            return self.reject();
        }
        self.source.pages.last_mut().unwrap().push(Record {
            rect: bbox,
            style_id,
            padding: 0,
        });
        true
    }

    fn room(&self, extra: usize) -> bool {
        self.source
            .byte_len()
            .checked_add(size_of::<Self>() - size_of::<WorldSource>())
            .and_then(|bytes| bytes.checked_add(extra))
            .is_some_and(|bytes| bytes <= self.limit)
    }

    fn reject(&mut self) -> bool {
        self.source.valid = false;
        self.source.pages = Vec::new();
        self.source.palette = Vec::new();
        self.source.record_bytes = 0;
        self.last_style = None;
        false
    }

    /// Caller certifies that the complete ordered stream succeeded. A failed
    /// push permanently invalidates this source even if the caller still finishes.
    pub(in crate::app::cpu_scene) fn finish(self) -> WorldSource {
        self.source
    }
}

#[cfg(test)]
#[path = "cpu_world_source_tests.rs"]
mod tests;
