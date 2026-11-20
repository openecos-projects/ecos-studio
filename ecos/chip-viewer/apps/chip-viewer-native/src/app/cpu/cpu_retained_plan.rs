//! A target-camera proof and ordered repair recipe. Only residual commands go
//! through tessellation; supported rectangles and textures keep their fast path.
use super::*;

enum Operation {
    Cpu(PaintCommand),
    Meshes(Vec<egui::ClippedPrimitive>),
}

pub(super) struct Plan {
    operations: Vec<Operation>,
    cpu_style: bool,
    textures: Arc<PatternTextureSet>,
    tessellator: egui::epaint::Tessellator,
}

impl Plan {
    pub(super) fn prepare(
        model: &RegionModel,
        key: &SceneKey,
        regions: &mut Regions,
        cpu_style: bool,
        is_current: &impl Fn() -> bool,
    ) -> Option<Self> {
        let raster = geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        let pass = GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
        let mut commands = Commands::default();
        let mut operations = Vec::new();
        let mut mesh_bytes = 0;
        for (index, record) in model.records.iter().enumerate() {
            if index % 64 == 0 && !is_current() {
                return None;
            }
            commands.0.clear();
            if record.bbox.intersects(key.viewport) {
                pass.draw(record.geometry, &record.style, &mut commands);
            }
            for &command in &commands.0 {
                let supported = match command {
                    PaintCommand::FillRect { .. } | PaintCommand::FrameRect { .. } => {
                        raster.rectangles(command).is_some()
                    }
                    PaintCommand::PatternRect { rect, pattern, .. } => {
                        rect.is_finite() && model.pattern_textures.spec(pattern).is_some()
                    }
                    PaintCommand::Line { .. } | PaintCommand::Disc { .. } => false,
                };
                if supported {
                    operations.push(Operation::Cpu(command));
                } else {
                    let mut sink = geometry::GeometryMeshSink::for_raster_with_patterns(
                        model.tessellator.clone(),
                        key.canvas,
                        key.tessellation,
                        key.pixels_per_point,
                        Arc::clone(&model.pattern_textures),
                    );
                    sink.paint(command);
                    let meshes = sink.finish();
                    for primitive in &meshes {
                        mesh_bytes += primitive_bytes(primitive);
                        if cpu_style {
                            exclude_mesh(regions, key, primitive, is_current)?;
                        }
                    }
                    operations.push(Operation::Meshes(meshes));
                }
                if operations.capacity() * size_of::<Operation>() + mesh_bytes > MAX_BYTES {
                    return None;
                }
            }
        }
        is_current().then_some(Self {
            operations,
            cpu_style,
            textures: Arc::clone(&model.pattern_textures),
            tessellator: model.tessellator.clone(),
        })
    }

    pub(super) fn paint(
        &self,
        key: &SceneKey,
        textures: &PatternTextureSet,
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<u8>> {
        let raster = geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        let mut pixels = blank_pixels(key, is_current)?;
        if self.cpu_style {
            for (index, operation) in self.operations.iter().enumerate() {
                if index % 64 == 0 && !is_current() {
                    return None;
                }
                if let Operation::Cpu(command) = *operation {
                    paint_recomposed_command(
                        command,
                        raster,
                        key,
                        textures,
                        &mut pixels,
                        is_current,
                    )?;
                }
            }
        }
        is_current().then_some(pixels)
    }

    pub(super) fn repair_meshes(
        &self,
        key: &SceneKey,
        damage: &[egui::Rect],
        is_current: &impl Fn() -> bool,
    ) -> Option<Vec<egui::ClippedPrimitive>> {
        let raster = geometry::PixelRectRasterizer::new(key.pixels_per_point, key.tessellation)?;
        let mut output = Vec::new();
        let mut bytes = 0;
        // Replay every contributor in damage, in original order. CPU runs use
        // direct quad batching; only the cached residuals were tessellated.
        let mut sink = self.sink(key);
        let mut pending = 0;
        for (index, operation) in self.operations.iter().enumerate() {
            if index % 64 == 0 && !is_current() {
                return None;
            }
            match operation {
                Operation::Cpu(command) => {
                    let mut intersects = false;
                    for rect in cpu_rectangles(*command, raster)? {
                        for (index, clip) in damage.iter().enumerate() {
                            if index % 64 == 0 && !is_current() {
                                return None;
                            }
                            if rect.intersect(*clip).is_positive() {
                                intersects = true;
                                break;
                            }
                        }
                        if intersects {
                            break;
                        }
                    }
                    if intersects {
                        sink.paint(*command);
                        pending += 1;
                    }
                    // Bound temporary mesh storage even for a very large plan.
                    if pending >= 1024 {
                        append_repairs(
                            &mut output,
                            &mut bytes,
                            &sink.finish(),
                            damage,
                            is_current,
                        )?;
                        sink = self.sink(key);
                        pending = 0;
                    }
                }
                Operation::Meshes(meshes) => {
                    if pending > 0 {
                        append_repairs(
                            &mut output,
                            &mut bytes,
                            &sink.finish(),
                            damage,
                            is_current,
                        )?;
                        sink = self.sink(key);
                        pending = 0;
                    }
                    append_repairs(&mut output, &mut bytes, meshes, damage, is_current)?;
                }
            }
        }
        append_repairs(&mut output, &mut bytes, &sink.finish(), damage, is_current)?;
        is_current().then_some(output)
    }

    fn sink(&self, key: &SceneKey) -> geometry::GeometryMeshSink {
        geometry::GeometryMeshSink::for_raster_with_patterns(
            self.tessellator.clone(),
            key.canvas,
            key.tessellation,
            key.pixels_per_point,
            Arc::clone(&self.textures),
        )
    }
}

fn primitive_bytes(primitive: &egui::ClippedPrimitive) -> usize {
    let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
        unreachable!("CPU geometry contains no callbacks")
    };
    mesh.vertices.len() * size_of::<egui::epaint::Vertex>()
        + mesh.indices.len() * size_of::<u32>()
        + size_of::<egui::ClippedPrimitive>()
}

fn cpu_rectangles(
    command: PaintCommand,
    raster: geometry::PixelRectRasterizer,
) -> Option<impl Iterator<Item = egui::Rect>> {
    let (mut rectangles, mut count) = ([egui::Rect::NOTHING; 4], 0);
    match command {
        PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
            if color32(rgba) != egui::Color32::TRANSPARENT {
                for rect in raster.rectangles(command)? {
                    rectangles[count] = rect;
                    count += 1;
                }
            }
        }
        PaintCommand::PatternRect { rect, rgba, .. } => {
            if color32(rgba) != egui::Color32::TRANSPARENT {
                rectangles[0] = rect;
                count = 1;
            }
        }
        PaintCommand::Line { .. } | PaintCommand::Disc { .. } => return None,
    }
    Some(rectangles.into_iter().take(count))
}

fn append_repairs(
    output: &mut Vec<egui::ClippedPrimitive>,
    bytes: &mut usize,
    primitives: &[egui::ClippedPrimitive],
    damage: &[egui::Rect],
    is_current: &impl Fn() -> bool,
) -> Option<()> {
    for primitive in primitives {
        if !is_current() {
            return None;
        }
        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
            return None;
        };
        let bounds = mesh.calc_bounds();
        for (index, &clip) in damage.iter().enumerate() {
            if index % 64 == 0 && !is_current() {
                return None;
            }
            let clip = clip.intersect(primitive.clip_rect);
            if !clip.intersect(bounds).is_positive() {
                continue;
            }
            *bytes += primitive_bytes(primitive);
            if *bytes > 32 * 1024 * 1024 {
                return None;
            }
            output.push(egui::ClippedPrimitive {
                clip_rect: clip,
                primitive: primitive.primitive.clone(),
            });
        }
    }
    Some(())
}

fn exclude_mesh(
    regions: &mut Regions,
    key: &SceneKey,
    primitive: &egui::ClippedPrimitive,
    is_current: &impl Fn() -> bool,
) -> Option<()> {
    let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
        unreachable!("CPU geometry contains no callbacks")
    };
    // Use the emitted triangles, including feather vertices and point radius.
    // World bounds plus arbitrary padding miss these footprints (and invalidate
    // empty interiors of large frames). The scissor is in physical pixels.
    for (index, triangle) in mesh.indices.chunks_exact(3).enumerate() {
        if index % 64 == 0 && !is_current() {
            return None;
        }
        let bounds = triangle.iter().fold(egui::Rect::NOTHING, |bounds, index| {
            let pos = mesh.vertices[*index as usize].pos * key.pixels_per_point;
            bounds.union(egui::Rect::from_min_max(pos, pos))
        });
        regions.exclude(bounds.intersect(physical_clip(key)));
    }
    Some(())
}
