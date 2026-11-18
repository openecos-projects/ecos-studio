use chip_render::geometry2d::{PaintCommand, PaintSink};
use std::sync::Arc;

#[path = "cpu_geometry_pack.rs"]
mod pack;
pub(super) use pack::{pack_meshes, PackedMesh, PackedVertex};

#[path = "cpu_pixel_rect.rs"]
mod pixel_rect;

pub(super) use pixel_rect::PixelRectRasterizer;

pub(super) const MAX_MESH_INDICES: usize = 12_288;

#[derive(Clone, Copy)]
pub(super) enum GeometryOutput {
    Reference,
    ExactRaster,
}

pub(super) struct GeometryMeshSink {
    tessellator: egui::epaint::Tessellator,
    canvas: egui::Rect,
    mesh: egui::Mesh,
    batches: Vec<egui::ClippedPrimitive>,
    debug_shapes: Option<Vec<egui::epaint::ClippedShape>>,
    colors: [([u8; 4], egui::Color32); 2],
    pixel_rects: Option<pixel_rect::PixelRectRasterizer>,
    patterns: Option<Arc<super::PatternTextureSet>>,
}

impl GeometryMeshSink {
    pub(super) fn new(
        mut tessellator: egui::epaint::Tessellator,
        canvas: egui::Rect,
        options: egui::epaint::TessellationOptions,
    ) -> Self {
        tessellator.set_clip_rect(canvas);
        Self {
            tessellator,
            canvas,
            mesh: egui::Mesh::default(),
            batches: Vec::new(),
            debug_shapes: (options.debug_paint_clip_rects || options.debug_ignore_clip_rects)
                .then(Vec::new),
            colors: [([0; 4], egui::Color32::TRANSPARENT); 2],
            pixel_rects: None,
            patterns: None,
        }
    }

    pub(super) fn new_with_patterns(
        tessellator: egui::epaint::Tessellator,
        canvas: egui::Rect,
        options: egui::epaint::TessellationOptions,
        patterns: Arc<super::PatternTextureSet>,
    ) -> Self {
        let mut sink = Self::new(tessellator, canvas, options);
        sink.patterns = Some(patterns);
        sink
    }

    pub(super) fn for_raster(
        tessellator: egui::epaint::Tessellator,
        canvas: egui::Rect,
        options: egui::epaint::TessellationOptions,
        pixels_per_point: f32,
    ) -> Self {
        let mut sink = Self::new(tessellator, canvas, options);
        sink.pixel_rects = pixel_rect::PixelRectRasterizer::new(pixels_per_point, options);
        sink
    }

    pub(super) fn for_raster_with_patterns(
        tessellator: egui::epaint::Tessellator,
        canvas: egui::Rect,
        options: egui::epaint::TessellationOptions,
        pixels_per_point: f32,
        patterns: Arc<super::PatternTextureSet>,
    ) -> Self {
        let mut sink = Self::for_raster(tessellator, canvas, options, pixels_per_point);
        sink.patterns = Some(patterns);
        sink
    }

    fn color(&mut self, rgba: [u8; 4]) -> egui::Color32 {
        if self.colors[0].0 != rgba {
            if self.colors[1].0 != rgba {
                self.colors[1] = (rgba, super::color32(rgba));
            }
            self.colors.swap(0, 1);
        }
        self.colors[0].1
    }

    fn flush(&mut self) {
        if !self.mesh.is_empty() {
            self.batches.push(egui::ClippedPrimitive {
                clip_rect: self.canvas,
                primitive: egui::epaint::Primitive::Mesh(std::mem::take(&mut self.mesh)),
            });
        }
    }

    fn use_texture(&mut self, texture_id: egui::TextureId) {
        if self.mesh.is_empty() {
            self.mesh.texture_id = texture_id;
        } else if self.mesh.texture_id != texture_id {
            self.flush();
            self.mesh.texture_id = texture_id;
        }
    }

    fn use_default_texture(&mut self) {
        self.use_texture(egui::TextureId::default());
    }

    fn paint_pattern_rect(
        &mut self,
        rect: egui::Rect,
        pattern: chip_display::FillPattern,
        rgba: [u8; 4],
    ) -> bool {
        let Some((texture_id, [tile_width, tile_height])) = self
            .patterns
            .as_ref()
            .and_then(|patterns| patterns.spec(pattern))
        else {
            return false;
        };
        self.use_texture(texture_id);
        let color = self.color(rgba);
        self.mesh.add_rect_with_uv(
            rect,
            egui::Rect::from_min_max(
                egui::pos2(0.0, 0.0),
                egui::pos2(rect.width() / tile_width, rect.height() / tile_height),
            ),
            color,
        );
        if self.mesh.indices.len() >= MAX_MESH_INDICES - 256 {
            self.flush();
        }
        true
    }

    pub(super) fn finish(mut self) -> Vec<egui::ClippedPrimitive> {
        if let Some(shapes) = self.debug_shapes.take() {
            return self.tessellator.tessellate_shapes(shapes);
        }
        self.flush();
        self.batches
    }
}

impl PaintSink for GeometryMeshSink {
    fn paint(&mut self, command: PaintCommand) {
        if !self.canvas.is_positive() {
            return;
        }
        if let PaintCommand::PatternRect {
            rect,
            pattern,
            rgba,
        } = command
        {
            if self.debug_shapes.is_some() || !self.paint_pattern_rect(rect, pattern, rgba) {
                chip_render::geometry2d::paint_pattern_fallback(self, rect, pattern, rgba);
            }
            return;
        }
        if let Some(raster) = self.pixel_rects {
            let rgba = match command {
                PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
                    Some(rgba)
                }
                PaintCommand::Line { rgba, .. } => Some(rgba),
                PaintCommand::Disc { .. } => None,
                PaintCommand::PatternRect { .. } => unreachable!(),
            };
            if let Some(rgba) = rgba {
                self.use_default_texture();
                let color = self.color(rgba);
                if raster.paint(command, color, &mut self.mesh)
                    || raster.paint_axis(command, color, self.canvas, &mut self.mesh)
                {
                    if self.mesh.indices.len() >= MAX_MESH_INDICES - 256 {
                        self.flush();
                    }
                    return;
                }
            }
        }
        self.use_default_texture();
        let shape = match command {
            PaintCommand::FillRect { rect, rgba } => {
                egui::Shape::rect_filled(rect, 0.0, self.color(rgba))
            }
            PaintCommand::PatternRect { .. } => unreachable!(),
            PaintCommand::FrameRect { rect, width, rgba } => egui::Shape::rect_stroke(
                rect,
                0.0,
                egui::Stroke::new(width, self.color(rgba)),
                egui::StrokeKind::Inside,
            ),
            PaintCommand::Line {
                points,
                width,
                rgba,
            } => egui::Shape::line_segment(points, egui::Stroke::new(width, self.color(rgba))),
            PaintCommand::Disc {
                center,
                radius,
                rgba,
            } => egui::Shape::circle_filled(center, radius, self.color(rgba)),
        };
        if let Some(shapes) = &mut self.debug_shapes {
            shapes.push(egui::epaint::ClippedShape {
                clip_rect: self.canvas,
                shape,
            });
            return;
        }
        self.tessellator.tessellate_shape(shape, &mut self.mesh);
        if self.mesh.indices.len() >= MAX_MESH_INDICES - 256 {
            self.flush();
        }
    }
}
