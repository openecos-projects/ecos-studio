//! Reuse same-scale geometry while the current camera is prepared separately.

use super::cpu_scene::progress::{ProgressFrame, ProgressMailbox};
use super::cpu_scene::{CpuScene, SceneKey};
use super::*;
use eframe::glow::{self, HasContext};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

#[cfg(all(test, target_os = "linux"))]
#[path = "cpu_presentation_test_support.rs"]
pub(super) mod test_support;

#[path = "cpu_raster_target.rs"]
pub(super) mod target;
use target::RasterTarget;

#[path = "cpu_present_targets.rs"]
pub(super) mod targets;
use targets::PresentationTargets;

#[path = "cpu_present_trace.rs"]
mod trace;
use trace::PresentTrace;

#[path = "cpu_pan_presentation.rs"]
mod pan;

#[path = "cpu_presentation_stats.rs"]
mod stats;

#[path = "cpu_canvas_background.rs"]
pub(super) mod background;

#[derive(Default)]
pub(super) struct CpuRasterCache {
    resources: Mutex<Option<RasterResources>>,
    failed: AtomicBool,
    rasterizations: AtomicUsize,
    paint_micros: AtomicUsize,
    #[cfg(target_os = "linux")]
    sparse_prefix: AtomicBool,
}

impl CpuRasterCache {
    pub(super) fn paint_background(
        &self,
        painter: &egui::Painter,
        frame: egui::Rect,
        color: egui::Color32,
    ) -> bool {
        #[cfg(target_os = "linux")]
        if !self.failed.load(Ordering::Relaxed) && self.sparse_prefix.load(Ordering::Relaxed) {
            return background::queue(painter, frame, color);
        }
        let _ = (painter, frame, color);
        false
    }

    pub(super) fn paint(
        self: &Arc<Self>,
        scene: Option<&Arc<CpuScene>>,
        key: &SceneKey,
        progress: Arc<ProgressMailbox>,
        generation: u64,
        painter: &egui::Painter,
        background: egui::Color32,
    ) {
        if self.failed.load(Ordering::Relaxed) {
            if let Some(scene) = scene {
                scene.paint(painter);
            }
            return;
        }
        if let Some(resources) = self.resources.lock().unwrap().as_mut() {
            resources.prepare_retained(key);
        }
        let cache = Arc::clone(self);
        let scene = scene.map(Arc::clone);
        let key = key.clone();
        let ctx = painter.ctx().clone();
        painter.add(egui::PaintCallback {
            rect: painter.clip_rect(),
            callback: Arc::new(eframe::egui_glow::CallbackFn::new(move |info, parent| {
                let started = Instant::now();
                let mut trace = PresentTrace::enabled();
                let mut resources = cache.resources.lock().unwrap();
                trace.mark("resources_lock");
                let result = (|| {
                    if resources.is_none() {
                        *resources = Some(RasterResources::new(Arc::clone(parent.gl()))?);
                        #[cfg(target_os = "linux")]
                        cache.sparse_prefix.store(
                            super::cpu_scene::sparse_rects::certified_profile(parent.gl()),
                            Ordering::Relaxed,
                        );
                    }
                    trace.mark("resources_setup");
                    let progress = progress.current(&key, generation);
                    resources.as_mut().unwrap().paint(
                        &info,
                        scene.as_ref(),
                        &key,
                        progress.as_ref(),
                        &ctx,
                        background,
                        &mut trace,
                    )
                })();
                trace.record(&result);
                match result {
                    Ok(completed) => {
                        if completed {
                            cache.rasterizations.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Err(error) => {
                        eprintln!("Exact raster cache disabled; falling back to meshes: {error}");
                        cache.disable();
                        ctx.request_repaint();
                    }
                }
                cache
                    .paint_micros
                    .store(started.elapsed().as_micros() as usize, Ordering::Relaxed);
            })),
        });
    }

    pub(super) fn destroy(&self) {
        if let Some(mut resources) = self.resources.lock().unwrap().take() {
            resources.destroy();
        }
    }

    #[cfg(target_os = "linux")]
    pub(super) fn supports_initial_progress(&self, key: &SceneKey) -> bool {
        !self.failed.load(Ordering::Relaxed)
            && self.sparse_prefix.load(Ordering::Relaxed)
            && self
                .resources
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|resources| {
                    !resources.frames().any(|frame| {
                        frame.scene.retained.is_some()
                            && key
                                .raster_destination(frame.scene.key())
                                .is_some_and(|destination| destination.intersects(key.canvas()))
                    })
                })
    }

    pub(super) fn is_ready(&self, scene: &CpuScene) -> bool {
        self.failed.load(Ordering::Relaxed)
            || self
                .resources
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|resources| {
                    resources
                        .frames()
                        .any(|frame| frame.scene.key().same_geometry(scene.key()))
                })
    }

    pub(super) fn scene_for(&self, key: &SceneKey) -> Option<Arc<CpuScene>> {
        self.resources
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|resources| {
                resources
                    .frames()
                    .find(|frame| frame.scene.key() == key)
                    .or_else(|| {
                        resources
                            .frames()
                            .find(|frame| frame.scene.key().same_geometry(key))
                    })
                    .map(|frame| Arc::clone(&frame.scene))
            })
    }

    pub(super) fn is_visible(&self, key: &SceneKey) -> bool {
        self.resources
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|resources| {
                resources
                    .presentation_source(key)
                    .is_some_and(|source| key.destination(source.key()).intersects(key.canvas()))
            })
    }

    pub(super) fn is_preview(&self, key: &SceneKey) -> bool {
        if self.failed.load(Ordering::Relaxed) {
            return false;
        }
        self.resources
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|resources| {
                resources.presentation_source(key).is_some_and(|source| {
                    !source.key().same_geometry(key)
                        && resources.retained_for(key, source.key()).is_none()
                        && key.destination(source.key()).intersects(key.canvas())
                })
            })
    }

    pub(super) fn is_partial(&self, key: &SceneKey) -> bool {
        self.resources
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|resources| {
                resources.presentation_source(key).is_some_and(|source| {
                    resources.retained_for(key, source.key()).is_some()
                        || matches!(source, RasterSource::Partial(frame) if frame.frame.key == *key)
                })
            })
    }

    pub(super) fn rasterizations(&self) -> usize {
        self.rasterizations.load(Ordering::Relaxed)
    }

    pub(super) fn failed(&self) -> bool {
        self.failed.load(Ordering::Relaxed)
    }

    pub(super) fn disable(&self) {
        self.failed.store(true, Ordering::Relaxed);
    }

    pub(super) fn paint_ms(&self) -> f32 {
        self.paint_micros.load(Ordering::Relaxed) as f32 / 1000.0
    }

    pub(super) fn retained_stats(&self, key: &SceneKey) -> (usize, f32) {
        self.resources
            .lock()
            .unwrap()
            .as_ref()
            .map_or((0, 0.0), |resources| resources.retained_stats(key))
    }
}

struct RasterFrame {
    scene: Arc<CpuScene>,
    target: RasterTarget,
    background: egui::Color32,
}

struct RasterBuild {
    frame: RasterFrame,
    next_mesh: usize,
}

struct RasterResources {
    painter: eframe::egui_glow::Painter,
    targets: PresentationTargets,
    anchor: Option<RasterFrame>,
    front: Option<RasterFrame>,
    building: Option<RasterBuild>,
    progress: Option<ProgressTarget>,
    retained_pan: Option<pan::RetainedPan>,
    retained_target: Option<pan::RetainedTarget>,
}

struct ProgressTarget {
    target: RasterTarget,
    frame: Arc<ProgressFrame>,
}

enum RasterSource<'a> {
    Complete(&'a RasterFrame),
    Partial(&'a ProgressTarget),
}

impl RasterSource<'_> {
    fn key(&self) -> &SceneKey {
        match self {
            Self::Complete(frame) => frame.scene.key(),
            Self::Partial(frame) => &frame.frame.key,
        }
    }

    fn target(&self) -> &RasterTarget {
        match self {
            Self::Complete(frame) => &frame.target,
            Self::Partial(frame) => &frame.target,
        }
    }
}

impl RasterResources {
    fn new(gl: Arc<glow::Context>) -> Result<Self, String> {
        if gl.version().major < 3 || unsafe { gl.get_parameter_i32(glow::SAMPLES) } > 1 {
            return Err(
                "exact framebuffer cache requires single-sample OpenGL 3 or newer".to_string(),
            );
        }
        let painter = eframe::egui_glow::Painter::new(gl, "", None, true)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            painter,
            targets: Default::default(),
            anchor: None,
            front: None,
            building: None,
            progress: None,
            retained_pan: None,
            retained_target: None,
        })
    }

    fn frames(&self) -> impl Iterator<Item = &RasterFrame> {
        self.front.iter().chain(self.anchor.iter())
    }

    fn source(&self, key: &SceneKey) -> Option<&RasterFrame> {
        self.frames()
            .find(|frame| frame.scene.key().same_geometry(key))
            .or_else(|| {
                self.frames()
                    .filter(|frame| {
                        frame.scene.key().compatible(key)
                            && key.same_raster_scale(frame.scene.key())
                            && key.destination(frame.scene.key()).intersects(key.canvas())
                    })
                    .max_by(|first, second| {
                        let coverage = |frame: &RasterFrame| {
                            key.destination(frame.scene.key())
                                .intersect(key.canvas())
                                .area()
                                .max(0.0)
                        };
                        coverage(first).total_cmp(&coverage(second))
                    })
            })
    }

    fn presentation_source(&self, key: &SceneKey) -> Option<RasterSource<'_>> {
        if !self
            .frames()
            .any(|frame| frame.scene.key().same_geometry(key))
        {
            if let Some(frame) = self
                .frames()
                .find(|frame| self.retained_for(key, frame.scene.key()).is_some())
            {
                return Some(RasterSource::Complete(frame));
            }
        }
        let completed = self.source(key);
        if let Some(frame) = completed {
            return Some(RasterSource::Complete(frame));
        }
        let progress = self
            .progress
            .as_ref()
            .filter(|frame| key.raster_destination(&frame.frame.key).is_some());
        if let Some(frame) = progress.filter(|frame| frame.frame.key == *key) {
            return Some(RasterSource::Partial(frame));
        }
        progress.map(RasterSource::Partial)
    }

    fn paint(
        &mut self,
        info: &egui::PaintCallbackInfo,
        scene: Option<&Arc<CpuScene>>,
        key: &SceneKey,
        progress: Option<&Arc<ProgressFrame>>,
        ctx: &egui::Context,
        background: egui::Color32,
        trace: &mut PresentTrace,
    ) -> Result<bool, String> {
        let gl = Arc::clone(self.painter.gl());
        let draw = unsafe { gl.get_parameter_framebuffer(glow::DRAW_FRAMEBUFFER_BINDING) };
        let read = unsafe { gl.get_parameter_framebuffer(glow::READ_FRAMEBUFFER_BINDING) };
        let result = self.paint_inner(info, scene, key, progress, ctx, background, draw, trace);
        unsafe {
            gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, draw);
            gl.bind_framebuffer(glow::READ_FRAMEBUFFER, read);
        }
        trace.mark("framebuffer_restore");
        result
    }

    fn paint_inner(
        &mut self,
        info: &egui::PaintCallbackInfo,
        scene: Option<&Arc<CpuScene>>,
        key: &SceneKey,
        progress: Option<&Arc<ProgressFrame>>,
        ctx: &egui::Context,
        background: egui::Color32,
        draw: Option<glow::Framebuffer>,
        trace: &mut PresentTrace,
    ) -> Result<bool, String> {
        let gl = Arc::clone(self.painter.gl());
        if self.anchor.as_ref().is_some_and(|frame| {
            !frame.scene.key().compatible(key) || frame.background != background
        }) {
            self.clear_frames();
        }
        trace.mark("compatibility_cleanup");
        self.targets.observe(key);
        let already_ready = self.frames().any(|frame| {
            frame.scene.key().same_geometry(key) && frame.target.size == info.screen_size_px
        });
        let mut completed = false;
        if !already_ready {
            if let Some(scene) = scene {
                completed = self.advance(info, scene, ctx, background, trace)?;
            }
        }
        let exact = self
            .frames()
            .any(|frame| frame.scene.key().same_geometry(key));
        if exact
            || self.progress.as_ref().is_some_and(|target| {
                target.target.size != info.screen_size_px
                    || key.raster_destination(&target.frame.key).is_none()
            })
        {
            if let Some(previous) = self.progress.take() {
                self.targets.retire(&gl, previous.target);
            }
        }
        trace.mark("advance");
        if !exact {
            if let Some(progress) = progress.filter(|frame| frame.key == *key) {
                if self.progress.as_ref().is_none_or(|target| {
                    target.frame.generation != progress.generation
                        || target.frame.sequence != progress.sequence
                }) {
                    if let Some(target) = &mut self.progress {
                        target.target.upload(&gl, &progress.pixels);
                        target.frame = Arc::clone(progress);
                    } else {
                        let target = self.targets.acquire(&gl, info.screen_size_px)?;
                        trace.mark("progress_allocation");
                        target.upload(&gl, &progress.pixels);
                        self.progress = Some(ProgressTarget {
                            target,
                            frame: Arc::clone(progress),
                        });
                    }
                }
            }
        }
        trace.mark("progress_upload");
        self.upload_retained(key)?;
        trace.mark("retained_upload");
        self.present(&gl, info, draw, key);
        if already_ready && self.targets.warm_when_idle(&gl, info.screen_size_px)? {
            trace.mark("idle_target_allocation");
        }
        let error = unsafe { gl.get_error() };
        trace.mark("blit");
        if error != glow::NO_ERROR {
            return Err(format!("exact framebuffer cache OpenGL error: {error}"));
        }
        Ok(completed)
    }

    fn advance(
        &mut self,
        info: &egui::PaintCallbackInfo,
        scene: &Arc<CpuScene>,
        ctx: &egui::Context,
        background: egui::Color32,
        trace: &mut PresentTrace,
    ) -> Result<bool, String> {
        let gl = Arc::clone(self.painter.gl());
        if self.building.as_ref().is_none_or(|build| {
            build.frame.scene.generation != scene.generation
                || build.frame.target.size != info.screen_size_px
        }) {
            if let Some(previous) = self.building.take() {
                self.targets.retire(&gl, previous.frame.target);
            }
            trace.mark("building_discard");
            let target = if self.progress.as_ref().is_some_and(|target| {
                target.frame.key == *scene.key() && target.target.size == info.screen_size_px
            }) {
                self.progress.take().unwrap().target
            } else {
                self.targets.acquire(&gl, info.screen_size_px)?
            };
            trace.mark("framebuffer_allocation");
            if let Some(pixels) = &scene.bitmap {
                if scene.key().screen_size() == info.screen_size_px {
                    target.upload(&gl, pixels);
                    trace.mark("bitmap_upload");
                    let frame = RasterFrame {
                        scene: Arc::clone(scene),
                        target,
                        background,
                    };
                    if self.anchor.is_none() {
                        self.anchor = Some(frame);
                    } else if let Some(previous) = self.front.replace(frame) {
                        self.targets.retire(&gl, previous.target);
                        trace.mark("old_target_release");
                        drop(previous.scene);
                        trace.mark("old_scene_destroy");
                    }
                    trace.mark("frame_replacement");
                    return Ok(true);
                }
            }
            self.painter.set_texture(
                egui::TextureId::default(),
                &egui::epaint::ImageDelta::full(
                    ctx.fonts(egui::epaint::Fonts::image),
                    egui::TextureOptions::LINEAR,
                ),
            );
            target.clear(&gl, background);
            self.building = Some(RasterBuild {
                frame: RasterFrame {
                    scene: Arc::clone(scene),
                    target,
                    background,
                },
                next_mesh: 0,
            });
        }
        let build = self.building.as_mut().unwrap();
        unsafe { gl.bind_framebuffer(glow::FRAMEBUFFER, Some(build.frame.target.framebuffer)) };
        let started = Instant::now();
        while build.next_mesh < scene.meshes.len() {
            self.painter.paint_primitives(
                info.screen_size_px,
                info.pixels_per_point,
                &scene.meshes[build.next_mesh..build.next_mesh + 1],
            );
            build.next_mesh += 1;
            if started.elapsed() >= Duration::from_millis(24) {
                break;
            }
        }
        if build.next_mesh < scene.meshes.len() {
            ctx.request_repaint();
            return Ok(false);
        }
        let frame = self.building.take().unwrap().frame;
        if self.anchor.is_none() {
            self.anchor = Some(frame);
        } else if let Some(previous) = self.front.replace(frame) {
            self.targets.retire(&gl, previous.target);
        }
        Ok(true)
    }

    fn clear_frames(&mut self) {
        let gl = self.painter.gl();
        self.retained_pan = None;
        if let Some(target) = self.retained_target.take() {
            target.target.destroy(gl);
        }
        for frame in self.anchor.take().into_iter().chain(self.front.take()) {
            frame.target.destroy(gl);
        }
        if let Some(build) = self.building.take() {
            build.frame.target.destroy(gl);
        }
        if let Some(progress) = self.progress.take() {
            progress.target.destroy(gl);
        }
        self.targets.destroy(gl);
    }

    fn destroy(&mut self) {
        self.clear_frames();
        self.painter.destroy();
    }
}
