use super::*;
use std::collections::BTreeSet;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Unsupported {
    Dpi,
    Tessellation,
    Command,
    Coordinates,
    Stroke,
    Dimensions,
}

#[derive(Clone, Debug)]
struct RectOp {
    bounds: [i32; 4],
    source: [u8; 4],
}

#[derive(Clone, Debug)]
pub(super) struct OrderedCoverage {
    operations: Vec<RectOp>,
}

impl OrderedCoverage {
    pub(super) fn try_commands(
        commands: &[PaintCommand],
        pixels_per_point: f32,
        options: egui::epaint::TessellationOptions,
    ) -> Result<Self, Unsupported> {
        if pixels_per_point != 1.0 {
            return Err(Unsupported::Dpi);
        }
        let raster = geometry::PixelRectRasterizer::new(pixels_per_point, options)
            .ok_or(Unsupported::Tessellation)?;
        let mut operations = Vec::new();
        for &command in commands {
            let (rect, rgba) = match command {
                PaintCommand::FillRect { rect, rgba } => (rect, rgba),
                PaintCommand::FrameRect { rect, rgba, width } => {
                    if width != 1.0 {
                        return Err(Unsupported::Stroke);
                    }
                    (rect, rgba)
                }
                PaintCommand::Line { .. }
                | PaintCommand::Disc { .. }
                | PaintCommand::PatternRect { .. } => {
                    return Err(Unsupported::Command);
                }
            };
            if [rect.left(), rect.top(), rect.right(), rect.bottom()]
                .into_iter()
                .any(|value| !value.is_finite() || value.fract() != 0.0 || value.abs() > 16384.0)
            {
                return Err(Unsupported::Coordinates);
            }
            if rect.size().min_elem() < 3.0 {
                return Err(Unsupported::Dimensions);
            }
            let rectangles = raster.rectangles(command).ok_or(Unsupported::Coordinates)?;
            let source = color32(rgba).to_array();
            if source == [0; 4] {
                continue;
            }
            for rect in rectangles {
                operations.push(RectOp {
                    bounds: [rect.left(), rect.top(), rect.right(), rect.bottom()]
                        .map(|value| value as i32),
                    source,
                });
            }
        }
        Ok(Self { operations })
    }

    pub(super) fn shifted(&self, delta: [i32; 2]) -> Option<Self> {
        let mut shifted = self.clone();
        for operation in &mut shifted.operations {
            for (coordinate, change) in operation
                .bounds
                .iter_mut()
                .zip([delta[0], delta[1], delta[0], delta[1]])
            {
                *coordinate = coordinate.checked_add(change)?;
                if coordinate.unsigned_abs() > 16384 {
                    return None;
                }
            }
        }
        Some(shifted)
    }

    pub(super) fn render(
        &self,
        size: [u32; 2],
        clip: [i32; 4],
        background: [u8; 4],
    ) -> Option<Vec<u8>> {
        if size.into_iter().any(|side| side == 0 || side > 16384) {
            return None;
        }
        let length = (size[0] as usize)
            .checked_mul(size[1] as usize)?
            .checked_mul(4)?;
        let mut pixels = vec![0; length];
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&background);
        }
        let clip = [
            clip[0].clamp(0, size[0] as i32),
            clip[1].clamp(0, size[1] as i32),
            clip[2].clamp(0, size[0] as i32),
            clip[3].clamp(0, size[1] as i32),
        ];
        if clip[0] >= clip[2] || clip[1] >= clip[3] {
            return Some(pixels);
        }
        let mut events = Vec::with_capacity(self.operations.len() * 2);
        for (ordinal, operation) in self.operations.iter().enumerate() {
            let [left, top, right, bottom] = operation.bounds;
            if left < clip[2] && right > clip[0] && top < clip[3] && bottom > clip[1] {
                events.extend([
                    (top.max(clip[1]), ordinal, true),
                    (bottom.min(clip[3]), ordinal, false),
                ]);
            }
        }
        events.sort_unstable();
        let mut active = BTreeSet::new();
        let mut cursor = 0;
        let mut horizontal = Vec::new();
        let mut word = BTreeSet::new();
        while cursor < events.len() {
            let top = events[cursor].0;
            while cursor < events.len() && events[cursor].0 == top {
                let (_, ordinal, entering) = events[cursor];
                if entering {
                    active.insert(ordinal);
                } else {
                    active.remove(&ordinal);
                }
                cursor += 1;
            }
            let Some(&(bottom, _, _)) = events.get(cursor) else {
                break;
            };
            horizontal.clear();
            for &ordinal in &active {
                let [left, _, right, _] = self.operations[ordinal].bounds;
                horizontal.extend([
                    (left.max(clip[0]), ordinal, true),
                    (right.min(clip[2]), ordinal, false),
                ]);
            }
            horizontal.sort_unstable();
            word.clear();
            let mut cursor = 0;
            while cursor < horizontal.len() {
                let left = horizontal[cursor].0;
                while cursor < horizontal.len() && horizontal[cursor].0 == left {
                    let (_, ordinal, entering) = horizontal[cursor];
                    if entering {
                        word.insert(ordinal);
                    } else {
                        word.remove(&ordinal);
                    }
                    cursor += 1;
                }
                let Some(&(right, _, _)) = horizontal.get(cursor) else {
                    break;
                };
                if word.is_empty() {
                    continue;
                }
                let color = word.iter().fold(background, |destination, &ordinal| {
                    super::coverage_blend_tests::transition(
                        destination,
                        self.operations[ordinal].source,
                    )
                });
                for row in top..bottom {
                    let start = ((size[1] as i32 - 1 - row) as usize * size[0] as usize
                        + left as usize)
                        * 4;
                    let end = start + (right - left) as usize * 4;
                    for pixel in pixels[start..end].chunks_exact_mut(4) {
                        pixel.copy_from_slice(&color);
                    }
                }
            }
        }
        Some(pixels)
    }
}
