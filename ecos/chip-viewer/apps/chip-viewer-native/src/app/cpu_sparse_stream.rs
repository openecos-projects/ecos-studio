use super::*;
use chip_render::geometry2d::PaintSink;

impl OffscreenRenderer {
    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn build_sparse_updates(
        &mut self,
        request: &SceneRequest,
        is_current: impl Fn() -> bool + Sync,
        publish: impl FnMut(Vec<u8>, usize),
    ) -> Result<Option<CpuScene>, String> {
        assert!(self.sparse_profile, "uncertified sparse blend profile");
        self.build_sparse_ready(
            sparse_rects::SparseRects::new(request).unwrap(),
            request,
            is_current,
            publish,
            Some([Duration::ZERO; 2]),
            |_| {},
        )
    }

    pub(super) fn build_sparse_ready(
        &mut self,
        mut kernel: sparse_rects::SparseRects,
        request: &SceneRequest,
        is_current: impl Fn() -> bool + Sync,
        mut publish: impl FnMut(Vec<u8>, usize),
        intervals: Option<[Duration; 2]>,
        prepared: impl FnOnce(&CpuScene),
    ) -> Result<Option<CpuScene>, String> {
        let started = Instant::now();
        let Some(mut raster) = RasterStream::begin(
            &mut self.painter,
            &mut self.compact,
            &mut self.targets,
            request,
            None,
        )?
        else {
            return Ok(None);
        };
        let mut pixels = kernel.blank(request.key.background);
        if let Some(trace) = &mut raster.trace {
            trace.backend = "ordered_sparse_rectangles";
        }
        let mut mesh_mode = false;
        let mut sequence = 0;
        let mut next_snapshot = intervals.map(|_| started);
        let mut duration = started.elapsed();
        let mut error = None;
        let scene = builder::build_command_stream(request, &is_current, |packet| {
            let consumed = Instant::now();
            let current = (|| -> Result<bool, String> {
                if !is_current() {
                    return Ok(false);
                }
                let start = kernel.len();
                match packet {
                    builder::PaintPacket::Commands(commands) => {
                        sequence += commands.len();
                        if mesh_mode {
                            let mut sink = geometry::GeometryMeshSink::for_raster(
                                request.tessellator.clone(),
                                request.key.canvas,
                                request.key.tessellation,
                                request.key.pixels_per_point,
                            );
                            for (index, command) in commands.into_iter().enumerate() {
                                if index % 256 == 0 && !is_current() {
                                    return Ok(false);
                                }
                                sink.paint(command);
                            }
                            let meshes = sink.finish();
                            let packed = geometry::pack_meshes(&meshes);
                            if !raster.push(&meshes, &packed, &is_current, &mut |_, _| {})? {
                                return Ok(false);
                            }
                        } else {
                            let append_at = Instant::now();
                            if kernel.append(&commands, request, &is_current).is_none() {
                                return Ok(false);
                            }
                            if let Some(trace) = &mut raster.trace {
                                trace.command_append_ms += trace::milliseconds(append_at.elapsed());
                                trace.software_operations = kernel.len();
                                trace.repair_tiles = kernel.repair_tiles();
                            }
                        }
                    }
                    builder::PaintPacket::Overlays { meshes, shapes } => {
                        sequence += meshes.len();
                        let exact = !mesh_mode
                            && kernel.append_axis_overlays(&shapes, request, &is_current);
                        if !exact && !mesh_mode && !meshes.is_empty() {
                            if !raster.resolve_sparse(
                                &mut kernel,
                                &mut pixels,
                                &mut mesh_mode,
                                &is_current,
                            )? {
                                return Ok(false);
                            }
                            if !mesh_mode {
                                raster
                                    .target
                                    .as_ref()
                                    .unwrap()
                                    .upload(raster.painter.gl(), &pixels);
                                mesh_mode = true;
                                if let Some(trace) = &mut raster.trace {
                                    trace.backend = "ordered_sparse_overlays_gl";
                                }
                            }
                        }
                        if mesh_mode {
                            let packed = geometry::pack_meshes(&meshes);
                            if !raster.push(&meshes, &packed, &is_current, &mut |_, _| {})? {
                                return Ok(false);
                            }
                        } else if !exact {
                            kernel.append_meshes(meshes);
                        }
                    }
                }
                let early_partial = !mesh_mode
                    && kernel.has_holes()
                    && next_snapshot.is_some_and(|at| Instant::now() >= at);
                if early_partial {
                    let paint_at = Instant::now();
                    if !kernel.render_since(start, &mut pixels, &is_current) {
                        return Ok(false);
                    }
                    if let Some(trace) = &mut raster.trace {
                        trace.rectangle_paint_ms += trace::milliseconds(paint_at.elapsed());
                    }
                    if kernel
                        .prepare_partial(&mut pixels, request.key.background, &is_current)
                        .is_some()
                    {
                        publish(std::mem::take(&mut pixels), sequence);
                        pixels = kernel.blank(request.key.background);
                        if !kernel.render_since(0, &mut pixels, &is_current) {
                            return Ok(false);
                        }
                        next_snapshot = intervals.map(|intervals| Instant::now() + intervals[1]);
                    }
                }
                if !mesh_mode && kernel.prefers_meshes() {
                    mesh_mode = true;
                    if !raster.replay_sparse(&mut kernel, &is_current)? {
                        return Ok(false);
                    }
                    pixels = Vec::new();
                } else if !mesh_mode && !early_partial {
                    let paint_at = Instant::now();
                    if !kernel.render_since(start, &mut pixels, &is_current) {
                        return Ok(false);
                    }
                    if let Some(trace) = &mut raster.trace {
                        trace.rectangle_paint_ms += trace::milliseconds(paint_at.elapsed());
                    }
                }
                if sequence > 0 && next_snapshot.is_some_and(|at| Instant::now() >= at) {
                    if !raster.resolve_sparse(
                        &mut kernel,
                        &mut pixels,
                        &mut mesh_mode,
                        &is_current,
                    )? {
                        return Ok(false);
                    }
                    let snapshot = if mesh_mode {
                        raster.readback(trace::ReadbackKind::Progressive)?
                    } else {
                        std::mem::take(&mut pixels)
                    };
                    if !is_current() {
                        return Ok(false);
                    }
                    publish(snapshot, sequence);
                    if !mesh_mode {
                        pixels = kernel.blank(request.key.background);
                        if !kernel.render_since(0, &mut pixels, &is_current) {
                            return Ok(false);
                        }
                    }
                    next_snapshot = intervals.map(|intervals| Instant::now() + intervals[1]);
                }
                Ok(is_current())
            })();
            duration += consumed.elapsed();
            match current {
                Ok(current) => current,
                Err(failure) => {
                    error = Some(failure);
                    false
                }
            }
        });
        if let Some(error) = error {
            return Err(error);
        }
        let Some(mut scene) = scene else {
            return Ok(None);
        };
        prepared(&scene);
        let finished = Instant::now();
        if !raster.resolve_sparse(&mut kernel, &mut pixels, &mut mesh_mode, &is_current)? {
            return Ok(None);
        }
        if mesh_mode {
            let Some((complete, _)) = raster.finish(&is_current)? else {
                return Ok(None);
            };
            pixels = complete;
        } else {
            if let Some(trace) = raster.trace.take() {
                trace.record(trace::TraceOutcome::Complete);
            }
        }
        if !is_current() {
            return Ok(None);
        }
        scene.raster_duration = duration + finished.elapsed();
        scene.pipeline_duration = started.elapsed();
        scene.bitmap = Some(pixels.into());
        if mesh_mode {
            scene.retained = None;
        }
        Ok(Some(scene))
    }
}

impl RasterStream<'_> {
    fn replay_sparse(
        &mut self,
        kernel: &mut sparse_rects::SparseRects,
        is_current: &impl Fn() -> bool,
    ) -> Result<bool, String> {
        self.reset();
        if let Some(trace) = &mut self.trace {
            trace.backend = "ordered_sparse_fallback_gl";
        }
        let mut failure = None;
        let current = kernel.drain_meshes(self.key.canvas, |meshes| {
            let packed = geometry::pack_meshes(&meshes);
            match self.push(&meshes, &packed, is_current, &mut |_, _| {}) {
                Ok(current) => current,
                Err(error) => {
                    failure = Some(error);
                    false
                }
            }
        });
        failure.map_or(Ok(current), Err)
    }

    fn resolve_sparse(
        &mut self,
        kernel: &mut sparse_rects::SparseRects,
        pixels: &mut Vec<u8>,
        mesh_mode: &mut bool,
        is_current: &impl Fn() -> bool,
    ) -> Result<bool, String> {
        if !is_current() {
            return Ok(false);
        }
        if !*mesh_mode && kernel.has_holes() {
            let prepare_at = Instant::now();
            let meshes = kernel.try_residual_meshes(self.key.canvas, is_current);
            if let Some(trace) = &mut self.trace {
                trace.repair_tiles = kernel.repair_tiles();
                trace.repair_prepare_ms += trace::milliseconds(prepare_at.elapsed());
            }
            if let Some(meshes) = meshes {
                let Some(repair) = self.repair(&meshes, is_current)? else {
                    return Ok(false);
                };
                kernel.merge(pixels, &repair);
            } else if is_current() {
                *mesh_mode = true;
                if !self.replay_sparse(kernel, is_current)? {
                    return Ok(false);
                }
                *pixels = Vec::new();
            } else {
                return Ok(false);
            }
        }
        Ok(is_current())
    }
}
