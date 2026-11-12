use chip_render::geometry2d::{PaintCommand, PaintSink};

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
        }
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
        if let Some(raster) = self.pixel_rects {
            let rgba = match command {
                PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
                    Some(rgba)
                }
                PaintCommand::Line { .. } | PaintCommand::Disc { .. } => None,
            };
            if let Some(rgba) = rgba {
                let color = self.color(rgba);
                if raster.paint(command, color, &mut self.mesh) {
                    if self.mesh.indices.len() >= MAX_MESH_INDICES - 256 {
                        self.flush();
                    }
                    return;
                }
            }
        }
        let shape = match command {
            PaintCommand::FillRect { rect, rgba } => {
                egui::Shape::rect_filled(rect, 0.0, self.color(rgba))
            }
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
