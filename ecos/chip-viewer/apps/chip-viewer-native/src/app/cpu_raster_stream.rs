use super::*;

#[path = "cpu_sparse_stream.rs"]
mod sparse;

pub(super) struct RasterStream<'a> {
    painter: &'a mut eframe::egui_glow::Painter,
    compact: &'a mut compact::CompactPainter,
    targets: &'a mut RasterTargetPool,
    target: Option<RasterTarget>,
    font: font::RasterFont,
    request: &'a SceneRequest,
    key: SceneKey,
    sequence: usize,
    next_snapshot: Option<Instant>,
    snapshot_interval: Duration,
    first_snapshot: bool,
    raster_duration: Duration,
    trace: Option<trace::RasterTrace>,
}

impl OffscreenRenderer {
    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn rasterize_stream_primitives(
        &mut self,
        request: &SceneRequest,
        meshes: &[egui::ClippedPrimitive],
        is_current: impl Fn() -> bool,
        mut publish: impl FnMut(Vec<u8>, usize),
    ) -> Result<Option<(Vec<u8>, Duration)>, String> {
        if !is_current() {
            return Ok(None);
        }
        let Some(mut raster) = RasterStream::begin(
            &mut self.painter,
            &mut self.compact,
            &mut self.targets,
            request,
            Some([Duration::ZERO; 2]),
        )?
        else {
            return Ok(None);
        };
        for primitive in meshes {
            let batch = std::slice::from_ref(primitive);
            if !raster.push(
                batch,
                &geometry::pack_meshes(batch),
                &is_current,
                &mut publish,
            )? {
                return Ok(None);
            }
        }
        raster.finish(&is_current)
    }

    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn build_streaming_scene(
        &mut self,
        request: &SceneRequest,
        is_current: impl Fn() -> bool + Sync,
        publish: impl FnMut(Vec<u8>, usize),
    ) -> Result<Option<CpuScene>, String> {
        self.build_streaming_scene_with_prepared(request, is_current, publish, |_| {})
    }

    pub(in crate::app::cpu_scene) fn build_streaming_scene_with_prepared(
        &mut self,
        request: &SceneRequest,
        is_current: impl Fn() -> bool + Sync,
        publish: impl FnMut(Vec<u8>, usize),
        prepared: impl FnOnce(&CpuScene),
    ) -> Result<Option<CpuScene>, String> {
        let intervals = match request.publication {
            progress::Publication::Complete => None,
            progress::Publication::Progressive => {
                Some([Duration::from_millis(25), Duration::from_millis(500)])
            }
        };
        if self.sparse_profile
            && !cfg!(debug_assertions)
            && std::env::var_os("ECOS_DISABLE_SPARSE_RECTS").is_none()
        {
            if let Some(kernel) = sparse_rects::SparseRects::new(request) {
                return self
                    .build_sparse_ready(kernel, request, is_current, publish, intervals, prepared);
            }
        }
        self.build_streaming_ready(request, is_current, publish, intervals, prepared)
    }

    #[cfg(test)]
    pub(in crate::app::cpu_scene) fn build_streaming_updates(
        &mut self,
        request: &SceneRequest,
        is_current: impl Fn() -> bool + Sync,
        publish: impl FnMut(Vec<u8>, usize),
        intervals: Option<[Duration; 2]>,
    ) -> Result<Option<CpuScene>, String> {
        self.build_streaming_ready(request, is_current, publish, intervals, |_| {})
    }

    fn build_streaming_ready(
        &mut self,
        request: &SceneRequest,
        is_current: impl Fn() -> bool + Sync,
        mut publish: impl FnMut(Vec<u8>, usize),
        intervals: Option<[Duration; 2]>,
        prepared: impl FnOnce(&CpuScene),
    ) -> Result<Option<CpuScene>, String> {
        let started = Instant::now();
        if !is_current() {
            return Ok(None);
        }
        let Some(mut raster) = RasterStream::begin(
            &mut self.painter,
            &mut self.compact,
            &mut self.targets,
            request,
            intervals,
        )?
        else {
            return Ok(None);
        };
        let mut error = None;
        let scene =
            builder::build_raster_stream(request, &is_current, |meshes, packed| {
                match raster.push(meshes, packed, &is_current, &mut publish) {
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
        let Some((pixels, duration)) = raster.finish(&is_current)? else {
            return Ok(None);
        };
        scene.bitmap = Some(pixels.into());
        scene.raster_duration = duration;
        scene.pipeline_duration = started.elapsed();
        Ok(Some(scene))
    }
}

impl<'a> RasterStream<'a> {
    fn reset(&mut self) {
        self.target
            .as_ref()
            .unwrap()
            .clear(self.painter.gl(), self.key.background);
        self.sequence = 0;
    }

    fn repair(
        &mut self,
        meshes: &[egui::ClippedPrimitive],
        is_current: &impl Fn() -> bool,
    ) -> Result<Option<Vec<u8>>, String> {
        self.reset();
        let packed = geometry::pack_meshes(meshes);
        if !self.push(meshes, &packed, is_current, &mut |_, _| {})? || !is_current() {
            return Ok(None);
        }
        let pixels = self.readback(trace::ReadbackKind::Complete)?;
        Ok(is_current().then_some(pixels))
    }

    fn begin(
        painter: &'a mut eframe::egui_glow::Painter,
        compact: &'a mut compact::CompactPainter,
        targets: &'a mut RasterTargetPool,
        request: &'a SceneRequest,
        intervals: Option<[Duration; 2]>,
    ) -> Result<Option<Self>, String> {
        let started = Instant::now();
        let key = &request.key;
        let mut trace = trace::RasterTrace::enabled(key);
        let atlas_size = request
            .repaint
            .fonts(|fonts| fonts.texture_atlas().lock().size());
        if atlas_size != key.font_texture_size {
            return Ok(None);
        }
        let phase = Instant::now();
        let target = targets.acquire(painter.gl(), key.screen_size)?;
        if let Some(trace) = &mut trace {
            trace.framebuffer_ms = trace::milliseconds(phase.elapsed());
        }
        let phase = Instant::now();
        let font = font::RasterFont::new(painter);
        if let Some(trace) = &mut trace {
            trace.font_upload_ms = trace::milliseconds(phase.elapsed());
        }
        let phase = Instant::now();
        target.clear(painter.gl(), key.background);
        if let Some(trace) = &mut trace {
            trace.clear_ms = trace::milliseconds(phase.elapsed());
        }
        Ok(Some(Self {
            painter,
            compact,
            targets,
            target: Some(target),
            font,
            request,
            key: key.clone(),
            sequence: 0,
            next_snapshot: intervals.map(|intervals| started + intervals[0]),
            snapshot_interval: intervals.map_or(Duration::ZERO, |intervals| intervals[1]),
            first_snapshot: intervals.is_some(),
            raster_duration: started.elapsed(),
            trace,
        }))
    }

    fn push(
        &mut self,
        mut meshes: &[egui::ClippedPrimitive],
        mut packed: &[Option<geometry::PackedMesh>],
        is_current: &impl Fn() -> bool,
        publish: &mut impl FnMut(Vec<u8>, usize),
    ) -> Result<bool, String> {
        while !meshes.is_empty() {
            if !is_current() {
                return Ok(false);
            }
            let started = Instant::now();
            let batch_size = if self.first_snapshot {
                4usize.saturating_sub(self.sequence).max(1)
            } else {
                16
            };
            let (batch, remaining) = meshes.split_at(meshes.len().min(batch_size));
            let (prepared, remaining_packed) = packed.split_at(batch.len());
            meshes = remaining;
            packed = remaining_packed;
            if !self.font.prepare(
                self.painter,
                self.request,
                batch,
                prepared,
                self.trace.as_mut(),
            ) {
                return Ok(false);
            }
            let uploaded_bytes = self.compact.paint(self.painter, &self.key, batch, prepared);
            self.sequence += batch.len();
            self.raster_duration += started.elapsed();
            if let Some(trace) = &mut self.trace {
                trace.submitted(batch, started.elapsed(), uploaded_bytes);
            }
            if self.next_snapshot.is_some_and(|at| Instant::now() >= at)
                || (self.first_snapshot && self.sequence > 0)
            {
                let started = Instant::now();
                let pixels = self.readback(trace::ReadbackKind::Progressive)?;
                self.raster_duration += started.elapsed();
                if !is_current() {
                    return Ok(false);
                }
                publish(pixels, self.sequence);
                self.first_snapshot = false;
                self.next_snapshot = Some(Instant::now() + self.snapshot_interval);
            }
        }
        Ok(is_current())
    }

    fn finish(
        mut self,
        is_current: &impl Fn() -> bool,
    ) -> Result<Option<(Vec<u8>, Duration)>, String> {
        if !is_current() {
            return Ok(None);
        }
        let started = Instant::now();
        let pixels = self.readback(trace::ReadbackKind::Complete)?;
        self.raster_duration += started.elapsed();
        let current = is_current();
        if let Some(trace) = self.trace.take() {
            trace.record(if current {
                trace::TraceOutcome::Complete
            } else {
                trace::TraceOutcome::Incomplete
            });
        }
        Ok(current.then_some((pixels, self.raster_duration)))
    }

    fn readback(&mut self, kind: trace::ReadbackKind) -> Result<Vec<u8>, String> {
        if let Some(trace) = &mut self.trace {
            trace.read_pixels(self.painter.gl(), self.sequence, kind)
        } else {
            read_pixels(self.painter.gl(), self.key.screen_size)
        }
    }
}

impl Drop for RasterStream<'_> {
    fn drop(&mut self) {
        if let Some(trace) = self.trace.take() {
            trace.record(trace::TraceOutcome::Incomplete);
        }
        if let Some(target) = self.target.take() {
            self.targets.retire(self.painter.gl(), target);
        }
    }
}
