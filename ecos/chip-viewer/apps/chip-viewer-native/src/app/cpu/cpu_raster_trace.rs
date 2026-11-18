use super::*;

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ReadbackKind {
    Progressive,
    Complete,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum TraceOutcome {
    Complete,
    Incomplete,
}

#[derive(Serialize)]
struct Readback {
    kind: ReadbackKind,
    sequence: usize,
    finish_wait_ms: f64,
    read_pixels_ms: f64,
    bytes: usize,
}

#[derive(Serialize)]
pub(super) struct RasterTrace {
    pub(super) backend: &'static str,
    pub(super) software_operations: usize,
    pub(super) software_retained_bytes: usize,
    pub(super) fallback_reason: Option<&'static str>,
    pub(super) repair_tiles: usize,
    pub(super) command_append_ms: f64,
    pub(super) rectangle_paint_ms: f64,
    pub(super) repair_prepare_ms: f64,
    #[serde(skip)]
    output: PathBuf,
    #[serde(skip)]
    started: Instant,
    zoom: f32,
    screen_size_px: [u32; 2],
    atlas_size: [usize; 2],
    pub(super) font_copy_ms: f64,
    pub(super) framebuffer_ms: f64,
    pub(super) font_upload_ms: f64,
    pub(super) clear_ms: f64,
    submit_ms: f64,
    meshes: usize,
    vertices: usize,
    indices: usize,
    geometry_upload_bytes: usize,
    white_meshes: usize,
    readbacks: Vec<Readback>,
}

impl RasterTrace {
    pub(super) fn enabled(key: &SceneKey) -> Option<Self> {
        let output = std::env::var_os("ECOS_RENDER_RASTER_TRACE")?;
        if output.is_empty() {
            return None;
        }
        Some(Self::new(
            output.into(),
            key.zoom,
            key.screen_size,
            key.font_texture_size,
        ))
    }

    fn new(output: PathBuf, zoom: f32, screen_size_px: [u32; 2], atlas_size: [usize; 2]) -> Self {
        Self {
            backend: "ordered_gl",
            software_operations: 0,
            software_retained_bytes: 0,
            fallback_reason: None,
            repair_tiles: 0,
            command_append_ms: 0.0,
            rectangle_paint_ms: 0.0,
            repair_prepare_ms: 0.0,
            output,
            started: Instant::now(),
            zoom,
            screen_size_px,
            atlas_size,
            font_copy_ms: 0.0,
            framebuffer_ms: 0.0,
            font_upload_ms: 0.0,
            clear_ms: 0.0,
            submit_ms: 0.0,
            meshes: 0,
            vertices: 0,
            indices: 0,
            geometry_upload_bytes: 0,
            white_meshes: 0,
            readbacks: Vec::new(),
        }
    }

    pub(super) fn submitted(
        &mut self,
        batch: &[egui::ClippedPrimitive],
        elapsed: Duration,
        uploaded_bytes: usize,
    ) {
        self.submit_ms += milliseconds(elapsed);
        self.geometry_upload_bytes += uploaded_bytes;
        for primitive in batch {
            if let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive {
                self.meshes += 1;
                self.vertices += mesh.vertices.len();
                self.indices += mesh.indices.len();
                self.white_meshes += usize::from(
                    mesh.texture_id == egui::TextureId::default()
                        && mesh
                            .vertices
                            .iter()
                            .all(|vertex| vertex.uv == egui::epaint::WHITE_UV),
                );
            }
        }
    }

    /// Diagnostic-only synchronization separates queued render waits from the
    /// subsequent readback call; this mode is not an acceptance timing run.
    pub(super) fn read_pixels(
        &mut self,
        gl: &glow::Context,
        sequence: usize,
        kind: ReadbackKind,
    ) -> Result<Vec<u8>, String> {
        let started = Instant::now();
        unsafe { gl.finish() };
        let finish_wait_ms = milliseconds(started.elapsed());
        let started = Instant::now();
        let pixels = super::read_pixels(gl, self.screen_size_px)?;
        self.readbacks.push(Readback {
            kind,
            sequence,
            finish_wait_ms,
            read_pixels_ms: milliseconds(started.elapsed()),
            bytes: pixels.len(),
        });
        Ok(pixels)
    }

    pub(super) fn record(self, outcome: TraceOutcome) {
        let wall_ms = milliseconds(self.started.elapsed());
        let write = || -> Result<(), Box<dyn std::error::Error>> {
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.output)?;
            serde_json::to_writer(
                &mut file,
                &serde_json::json!({
                    "outcome": outcome, "wall_ms": wall_ms, "raster": self,
                }),
            )?;
            writeln!(file)?;
            Ok(())
        };
        if let Err(error) = write() {
            eprintln!("Raster diagnostic trace unavailable: {error}");
        }
    }
}

pub(super) fn milliseconds(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

#[cfg(test)]
#[path = "cpu_raster_trace_tests.rs"]
mod tests;
