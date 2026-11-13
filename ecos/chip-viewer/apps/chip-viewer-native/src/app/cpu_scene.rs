//! Retained exact 2D geometry for the software fallback.
//!
//! One coordinator coalesces camera requests and prepares ordered chunks on a
//! bounded worker group. Completed frames stay available during refinement;
//! stale work is cancelled without waiting on the UI thread.

use super::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar};

#[path = "cpu_scene_builder.rs"]
mod builder;
#[cfg(any(test, not(target_os = "linux")))]
use builder::build_scene;

#[path = "cpu_geometry.rs"]
mod geometry;

#[path = "cpu_labels.rs"]
mod labels;

#[path = "cpu_overlays.rs"]
mod overlays;

#[path = "cpu_axis_grid.rs"]
mod axis_grid;

#[path = "cpu_progress.rs"]
pub(super) mod progress;

#[path = "cpu_history.rs"]
mod history;

#[cfg(target_os = "linux")]
#[path = "cpu_initial_pixels.rs"]
mod initial_pixels;

#[path = "cpu_scene_worker.rs"]
mod worker;

#[cfg(target_os = "linux")]
#[path = "cpu_offscreen.rs"]
mod offscreen;

#[cfg(target_os = "linux")]
#[path = "cpu_sparse_rects.rs"]
pub(super) mod sparse_rects;

#[path = "cpu_retained_regions.rs"]
pub(super) mod retained_regions;

#[cfg(test)]
#[path = "cpu_scene_tests.rs"]
mod tests;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct SceneKey {
    epoch: u64,
    layers: u64,
    visibility: ObjectVisibility,
    world: Rect32,
    viewport: Rect32,
    canvas: egui::Rect,
    zoom: f32,
    pan: egui::Vec2,
    pixels_per_point: f32,
    tessellation: egui::epaint::TessellationOptions,
    font_texture_size: [usize; 2],
    selected: Option<ShapeId>,
    highlighted: BTreeSet<ShapeId>,
    screen_size: [u32; 2],
    background: egui::Color32,
    grid_bounds: Rect32,
    cache_overlays: bool,
}

pub(super) struct SceneRequest {
    key: SceneKey,
    db: Arc<ChipViewDb>,
    data_bounds: Option<Rect32>,
    layer_ids: Vec<LayerId>,
    layers: LayerRenderIndex,
    zoom_rules: ZoomVisibilityRules,
    tessellator: egui::epaint::Tessellator,
    repaint: egui::Context,
    glow: bool,
    glow_renderer: Option<String>,
    label_fonts: egui::FontDefinitions,
    label_texture_side: usize,
    overlay_labels: ShapeLabelCollector,
    grid_layers: Vec<LayerUiState>,
    publication: progress::Publication,
}

type LabelCompletion = OnceLock<(Arc<ResolvedLabels>, Duration)>;

pub(super) struct CpuScene {
    key: SceneKey,
    pub(super) meshes: Vec<egui::ClippedPrimitive>,
    fallback_meshes: OnceLock<Vec<Arc<egui::Mesh>>>,
    pub(super) generation: u64,
    labels: labels::Candidates,
    pub(super) drawn: usize,
    pub(super) primitives: usize,
    pub(super) build_duration: Duration,
    pub(super) pipeline_duration: Duration,
    pub(super) query_duration: Duration,
    pub(super) filter_duration: Duration,
    pub(super) bitmap: Option<Arc<[u8]>>,
    pub(super) retained: Option<Arc<retained_regions::RegionModel>>,
    pub(super) raster_duration: Duration,
    completed_labels: Arc<LabelCompletion>,
    pub(super) overlay_drawn: usize,
}

struct WorkerInbox {
    request: Mutex<Option<(u64, SceneRequest, Option<Arc<CpuScene>>)>>,
    wake: Condvar,
    generation: AtomicU64,
    stopped: AtomicBool,
    #[cfg(target_os = "linux")]
    initial_evidence: progress::InitialEvidence,
}

pub(super) struct CpuSceneCache {
    raster: Arc<super::cpu_raster::CpuRasterCache>,
    progress: Arc<progress::ProgressMailbox>,
    #[cfg(target_os = "linux")]
    initial_pixels: initial_pixels::Pool,
    history: history::CpuSceneHistory,
    inbox: Arc<WorkerInbox>,
    responses: Receiver<(u64, Arc<CpuScene>)>,
    key: Option<SceneKey>,
    ready: Option<Arc<CpuScene>>,
    anchor: Option<Arc<CpuScene>>,
    pending: Option<SceneRequest>,
    restored: bool,
}

impl Default for CpuSceneCache {
    fn default() -> Self {
        let inbox = Arc::new(WorkerInbox {
            request: Mutex::new(None),
            wake: Condvar::new(),
            generation: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
            #[cfg(target_os = "linux")]
            initial_evidence: progress::InitialEvidence::new(
                std::env::var_os("ECOS_RENDER_PROGRESS_EVIDENCE").map(PathBuf::from),
            ),
        });
        let progress = Arc::new(progress::ProgressMailbox::default());
        let (outgoing, responses) = mpsc::channel();
        worker::spawn(Arc::clone(&inbox), Arc::clone(&progress), outgoing);
        Self {
            raster: Arc::default(),
            progress,
            #[cfg(target_os = "linux")]
            initial_pixels: Default::default(),
            history: history::CpuSceneHistory::default(),
            inbox,
            responses,
            key: None,
            ready: None,
            anchor: None,
            pending: None,
            restored: false,
        }
    }
}

impl Drop for CpuSceneCache {
    fn drop(&mut self) {
        let _pending = self.inbox.request.lock().unwrap();
        self.inbox.stopped.store(true, Ordering::Relaxed);
        self.inbox.wake.notify_one();
    }
}

impl CpuSceneCache {
    pub(super) fn get_or_request(&mut self, mut request: SceneRequest) -> Option<Arc<CpuScene>> {
        if self.raster.failed() {
            request.glow = false;
        }
        let rebuild = self.raster.failed()
            && self
                .ready
                .as_ref()
                .is_some_and(|scene| scene.bitmap.is_some() && scene.meshes.is_empty());
        if rebuild {
            self.ready = None;
            self.history.clear();
            self.key = None;
        }
        if self.key.as_ref() != Some(&request.key) {
            let retained = self
                .ready
                .as_ref()
                .filter(|scene| scene.key.same_geometry(&request.key))
                .map(Arc::clone);
            let invalidates_history = self.key.as_ref().is_some_and(|key| {
                !key.compatible(&request.key)
                    || key.canvas != request.key.canvas
                    || key.screen_size != request.key.screen_size
            });
            request.publication = progress::Publication::Progressive;
            if self
                .anchor
                .as_ref()
                .is_some_and(|scene| !scene.key.compatible(&request.key))
            {
                self.anchor = None;
            }
            self.key = Some(request.key.clone());
            if invalidates_history {
                self.history.clear();
                self.ready = None;
            } else if let Some(previous) = self.ready.take() {
                self.history.insert(previous);
            }
            self.ready = (!self.raster.failed())
                .then(|| {
                    self.history
                        .get(&request.key)
                        .or_else(|| self.raster.scene_for(&request.key))
                })
                .flatten()
                .or_else(|| {
                    self.anchor
                        .as_ref()
                        .filter(|scene| scene.key == request.key)
                        .map(Arc::clone)
                })
                .or(retained);
            self.restored = self.ready.is_some();
            self.inbox.generation.fetch_add(1, Ordering::Relaxed);
            self.progress.clear();
            *self.inbox.request.lock().unwrap() = None;
            self.pending = self
                .ready
                .as_ref()
                .is_none_or(|scene| scene.key != request.key || !scene.labels_ready())
                .then_some(request);
        }
        if self.pending.is_some() {
            let generation = self.inbox.generation.load(Ordering::Relaxed);
            #[cfg(target_os = "linux")]
            if self.ready.is_none() {
                if let Some(request) = self.pending.as_ref().filter(|request| {
                    request.glow && self.raster.supports_initial_progress(&request.key)
                }) {
                    let mut pixels = self.initial_pixels.take(
                        request.key.screen_size[0] as usize
                            * request.key.screen_size[1] as usize
                            * 4,
                    );
                    if let Some(sequence) = builder::build_initial_progress(request, &mut pixels) {
                        let frame = self.progress.publish(progress::ProgressFrame::new(
                            request.key.clone(),
                            generation,
                            sequence,
                            pixels,
                        ));
                        self.initial_pixels.keep(Arc::clone(&frame.pixels));
                        if let Err(error) = self.inbox.initial_evidence.enqueue(frame) {
                            eprintln!("Initial progress evidence unavailable: {error}");
                        }
                    } else {
                        self.initial_pixels.keep(Arc::new(pixels));
                    }
                }
            }
            *self.inbox.request.lock().unwrap() = self
                .pending
                .take()
                .map(|request| (generation, request, self.ready.clone()));
            self.inbox.wake.notify_one();
        }
        while let Ok((generation, scene)) = self.responses.try_recv() {
            if generation == self.inbox.generation.load(Ordering::Relaxed) {
                if self.anchor.is_none() {
                    self.anchor = Some(Arc::clone(&scene));
                }
                self.ready = Some(scene);
            }
        }
        self.ready.as_ref().map(Arc::clone)
    }

    pub(super) fn paint_background(
        &self,
        painter: &egui::Painter,
        frame: egui::Rect,
        color: egui::Color32,
    ) -> bool {
        self.raster.paint_background(painter, frame, color)
    }

    pub(super) fn central_frame(&self, context: &egui::Context) -> egui::Frame {
        self.raster.central_frame(context)
    }

    pub(super) fn paint_glow(
        &self,
        scene: Option<&Arc<CpuScene>>,
        painter: &egui::Painter,
        background: egui::Color32,
    ) {
        if let Some(key) = &self.key {
            self.raster.paint(
                scene,
                key,
                Arc::clone(&self.progress),
                self.inbox.generation.load(Ordering::Relaxed),
                painter,
                background,
            );
        }
    }

    pub(super) fn destroy_glow(&self) {
        self.raster.destroy();
    }

    pub(super) fn raster_ready(&self, scene: &CpuScene) -> bool {
        self.raster.is_ready(scene)
    }

    pub(super) fn labels_ready(&self, scene: &CpuScene) -> bool {
        self.key.as_ref() == Some(&scene.key) && scene.labels_ready()
    }

    pub(super) fn rasterizations(&self) -> usize {
        self.raster.rasterizations()
    }

    pub(super) fn history_bytes(&self) -> usize {
        self.history.byte_len()
    }

    pub(super) fn restored(&self) -> bool {
        self.restored
    }

    pub(super) fn paint_ms(&self) -> f32 {
        self.raster.paint_ms()
    }

    pub(super) fn raster_visible(&self) -> bool {
        if self.raster.failed() {
            return self.ready.is_some();
        }
        self.key
            .as_ref()
            .is_some_and(|key| self.raster.is_visible(key))
    }

    pub(super) fn record_glow_stats(
        &self,
        painter: &egui::Painter,
        stats: &CanvasRenderStats,
    ) -> bool {
        if self.raster.failed() {
            return false;
        }
        if let Some(key) = &self.key {
            self.raster
                .queue_stats(painter, key, stats.clone(), record_render_stats);
            return true;
        }
        false
    }

    pub(super) fn raster_preview(&self) -> bool {
        self.key
            .as_ref()
            .is_some_and(|key| self.raster.is_preview(key))
    }

    pub(super) fn raster_partial(&self) -> bool {
        self.key
            .as_ref()
            .is_some_and(|key| self.raster.is_partial(key))
    }

    pub(super) fn retained_stats(&self) -> (usize, f32) {
        self.key
            .as_ref()
            .map_or((0, 0.0), |key| self.raster.retained_stats(key))
    }
}

impl SceneKey {
    pub(super) fn screen_size(&self) -> [u32; 2] {
        self.screen_size
    }

    pub(super) fn compatible(&self, other: &Self) -> bool {
        self.epoch == other.epoch
            && self.layers == other.layers
            && self.visibility == other.visibility
            && self.world == other.world
            && self.pixels_per_point == other.pixels_per_point
            && self.tessellation == other.tessellation
            && self.background == other.background
            && self.grid_bounds == other.grid_bounds
            && self.cache_overlays == other.cache_overlays
    }

    pub(super) fn same_geometry(&self, other: &Self) -> bool {
        self.compatible(other)
            && self.viewport == other.viewport
            && self.canvas == other.canvas
            && self.zoom == other.zoom
            && self.pan == other.pan
            && self.font_texture_size == other.font_texture_size
            && self.screen_size == other.screen_size
    }

    pub(super) fn destination(&self, source: &Self) -> egui::Rect {
        let ratio = world_to_screen_scale(self.world, self.canvas, self.zoom)
            / world_to_screen_scale(source.world, source.canvas, source.zoom);
        let old_center = source.canvas.center() + source.pan;
        let new_center = self.canvas.center() + self.pan;
        egui::Rect::from_min_max(
            new_center + (source.canvas.min - old_center) * ratio,
            new_center + (source.canvas.max - old_center) * ratio,
        )
    }

    pub(super) fn same_raster_scale(&self, source: &Self) -> bool {
        let scale = world_to_screen_scale(self.world, self.canvas, self.zoom);
        let previous = world_to_screen_scale(source.world, source.canvas, source.zoom);
        (scale / previous - 1.0).abs() < 0.00001
    }

    pub(super) fn raster_destination(&self, source: &Self) -> Option<egui::Rect> {
        (self.compatible(source) && self.same_raster_scale(source))
            .then(|| self.destination(source))
    }

    pub(super) fn canvas(&self) -> egui::Rect {
        self.canvas
    }
}

impl CpuScene {
    pub(super) fn key(&self) -> &SceneKey {
        &self.key
    }

    pub(super) fn labels_ready(&self) -> bool {
        self.completed_labels.get().is_some()
    }

    pub(super) fn resolved_labels(&self) -> Arc<ResolvedLabels> {
        self.completed_labels
            .get()
            .map_or_else(Arc::default, |(labels, _)| Arc::clone(labels))
    }

    pub(super) fn label_duration(&self) -> Duration {
        self.completed_labels
            .get()
            .map_or(Duration::ZERO, |(_, duration)| *duration)
    }
}

impl CpuScene {
    pub(super) fn paint(&self, painter: &egui::Painter) {
        painter.extend(
            self.prepare_fallback()
                .iter()
                .map(|mesh| egui::Shape::Mesh(Arc::clone(mesh))),
        );
    }

    fn prepare_fallback(&self) -> &[Arc<egui::Mesh>] {
        self.fallback_meshes.get_or_init(|| {
            self.meshes
                .iter()
                .map(|primitive| {
                    let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                        unreachable!("CPU geometry contains no callbacks")
                    };
                    Arc::new(mesh.clone())
                })
                .collect()
        })
    }
}

impl LoadedViewer {
    pub(super) fn cpu_scene_request(
        &self,
        ctx: &egui::Context,
        world: Rect32,
        viewport: Rect32,
        canvas: egui::Rect,
        layer_ids: Vec<LayerId>,
        background: egui::Color32,
    ) -> SceneRequest {
        let pixels_per_point = ctx.pixels_per_point();
        let tessellation = ctx.tessellation_options(|options| *options);
        let (label_fonts, label_texture_side) = ctx.fonts(|fonts| {
            let definitions = fonts.lock().fonts.definitions().clone();
            (definitions, fonts.max_texture_side())
        });
        let (font_texture_size, tessellator) = ctx.fonts(|fonts| {
            let atlas = fonts.texture_atlas();
            let atlas = atlas.lock();
            (
                atlas.size(),
                egui::epaint::Tessellator::new(
                    pixels_per_point,
                    tessellation,
                    atlas.size(),
                    atlas.prepared_discs(),
                ),
            )
        });
        let mut overlay_labels = ShapeLabelCollector::default();
        if let Some(candidate) = self.selected_pin_label(world, canvas) {
            overlay_labels.insert(candidate);
        }
        SceneRequest {
            data_bounds: self.stats.bbox,
            key: SceneKey {
                epoch: self.geometry_epoch,
                layers: self.visibility_rules_cache.layer_visibility_hash,
                visibility: self.object_visibility,
                world,
                viewport,
                canvas,
                zoom: self.zoom,
                pan: self.pan,
                pixels_per_point,
                tessellation,
                font_texture_size,
                selected: self.selected,
                highlighted: self.highlighted.clone(),
                screen_size: ctx.input(|input| {
                    [input.screen_rect().width(), input.screen_rect().height()]
                        .map(|side| (side * pixels_per_point).round() as u32)
                }),
                background,
                grid_bounds: self.grid_bounds.unwrap_or(world),
                cache_overlays: self.analysis_tab != AnalysisTab::Map
                    || self.active_heatmap.is_none(),
            },
            db: Arc::clone(&self.db),
            layer_ids,
            layers: self.visibility_rules_cache.layer_index.clone(),
            zoom_rules: self.visibility_rules_cache.zoom_rules.clone(),
            tessellator,
            repaint: ctx.clone(),
            glow: self.glow_rendering,
            glow_renderer: self.glow_renderer.clone(),
            label_fonts,
            label_texture_side,
            overlay_labels,
            grid_layers: self.layers.clone(),
            publication: progress::Publication::Progressive,
        }
    }
}
