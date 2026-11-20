use std::sync::{Arc, Mutex};

use eframe::egui_glow::CallbackFn;
use eframe::glow::{self, HasContext};

use super::cpu_raster::target::RasterTarget;
use super::cpu_scene::{CpuScene, SceneKey};
use super::{egui, ActiveHeatmap, LoadedViewer};

#[derive(Default)]
pub(super) struct HeatmapComposition {
    frame: Arc<Mutex<Option<Frame>>>,
}

#[derive(Clone)]
pub(super) struct Key {
    scene: SceneKey,
    generation: u64,
    style: OverlayStyle,
    clip: egui::Rect,
}

#[derive(Clone)]
struct OverlayStyle {
    colors_revision: Arc<()>,
    opacity: f32,
    guides_ready: bool,
}

impl OverlayStyle {
    fn new(heatmap: &ActiveHeatmap, guides_ready: bool) -> Self {
        Self {
            colors_revision: Arc::clone(&heatmap.colors_revision),
            opacity: heatmap.opacity,
            guides_ready,
        }
    }

    fn matches(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.colors_revision, &other.colors_revision)
            && self.opacity == other.opacity
            && self.guides_ready == other.guides_ready
    }
}

impl Key {
    pub(super) fn new(
        scene: &CpuScene,
        heatmap: &ActiveHeatmap,
        guides_ready: bool,
        painter: &egui::Painter,
    ) -> Self {
        Self {
            scene: scene.key().clone(),
            generation: scene.generation,
            style: OverlayStyle::new(heatmap, guides_ready),
            clip: painter.clip_rect(),
        }
    }

    fn matches(&self, other: &Self) -> bool {
        self.generation == other.generation
            && self.scene == other.scene
            && self.style.matches(&other.style)
            && self.clip == other.clip
    }
}

struct Frame {
    key: Key,
    target: RasterTarget,
    overlay_count: usize,
}

pub(super) enum Composition {
    Reused(usize),
    Capture(Key),
}

pub(super) struct CachedComposition {
    frame: Arc<Mutex<Option<Frame>>>,
    key: Key,
    overlay_count: usize,
}

impl CachedComposition {
    pub(super) fn present(&self, gl: &glow::Context, info: &egui::PaintCallbackInfo) -> bool {
        let mut cache = self
            .frame
            .lock()
            .expect("heatmap composition lock poisoned");
        let Some(frame) = cache.as_ref().filter(|frame| frame.key.matches(&self.key)) else {
            return false;
        };
        if info.screen_size_px == self.key.scene.screen_size()
            && copy(gl, info, &frame.target, CopyDirection::Present)
        {
            return true;
        }
        if let Some(frame) = cache.take() {
            frame.target.destroy(gl);
        }
        false
    }
}

impl LoadedViewer {
    pub(super) fn paint_glow_scene(
        &self,
        scene: Option<&Arc<CpuScene>>,
        painter: &egui::Painter,
        background: egui::Color32,
        activity: super::gpu_overview::CameraActivity,
    ) -> Option<Composition> {
        let key = scene.and_then(|scene| {
            let map = self.active_heatmap.as_ref()?;
            (self.analysis_tab == super::AnalysisTab::Map
                && matches!(activity, super::gpu_overview::CameraActivity::Settled)
                && self.cpu_scene_cache.has_exact_raster(scene))
            .then(|| {
                Key::new(
                    scene,
                    map,
                    self.unrouted_net_guides.get().is_some(),
                    painter,
                )
            })
        });
        let cached = key
            .as_ref()
            .and_then(|key| self.heatmap_composition.cached(key));
        let reused = cached.as_ref().map(|cached| cached.overlay_count);
        self.cpu_scene_cache
            .paint_glow(scene, painter, background, cached);
        reused
            .map(Composition::Reused)
            .or_else(|| key.map(Composition::Capture))
    }
}

impl HeatmapComposition {
    fn cached(&self, key: &Key) -> Option<CachedComposition> {
        let cache = self
            .frame
            .lock()
            .expect("heatmap composition lock poisoned");
        let frame = cache.as_ref().filter(|frame| frame.key.matches(key))?;
        Some(CachedComposition {
            frame: Arc::clone(&self.frame),
            key: key.clone(),
            overlay_count: frame.overlay_count,
        })
    }

    pub(super) fn paint_pan(
        &self,
        painter: &egui::Painter,
        scene: &SceneKey,
        heatmap: &ActiveHeatmap,
        guides_ready: bool,
    ) -> Option<PanPreview> {
        self.paint_pan_with_style(painter, scene, &OverlayStyle::new(heatmap, guides_ready))
    }

    fn paint_pan_with_style(
        &self,
        painter: &egui::Painter,
        scene: &SceneKey,
        style: &OverlayStyle,
    ) -> Option<PanPreview> {
        let cache = self.frame.lock().unwrap();
        let frame = cache.as_ref()?;
        let clip = painter.clip_rect();
        if frame.key.clip != clip || !frame.key.style.matches(style) {
            return None;
        }
        let delta = scene.pan_pixels_from(&frame.key.scene)?;
        let scale = scene.pixels_per_point();
        let screen_size = scene.screen_size();
        let pixels = PixelRect::from_clip(clip, scale, screen_size);
        let overlap = pixels.overlap_after_pan(delta)?;
        let source = overlap.translate([-delta[0], -delta[1]]);
        // Translate the last complete composition for visual feedback while
        // the exact raster for this camera is pending. Never capture this copy.
        let preview = PanPreview {
            overlay_count: frame.overlay_count,
            exposed: pixels
                .exposed_by(overlap)
                .map(|strip| strip.to_points(scale)),
        };
        let key = frame.key.clone();
        drop(cache);
        let cache = Arc::clone(&self.frame);
        let ctx = painter.ctx().clone();
        painter.add(egui::PaintCallback {
            rect: clip,
            callback: Arc::new(CallbackFn::new(move |info, parent| {
                let gl = parent.gl();
                let mut cache = cache.lock().unwrap();
                if let Some(frame) = cache.as_ref().filter(|frame| frame.key.matches(&key)) {
                    if info.screen_size_px == screen_size
                        && blit(
                            gl,
                            Some(frame.target.framebuffer),
                            source.relative_to(pixels).gl_bounds(frame.target.size[1]),
                            overlap.gl_bounds(screen_size[1]),
                            CopyDirection::Present,
                        )
                    {
                        return;
                    }
                    if let Some(frame) = cache.take() {
                        frame.target.destroy(gl);
                    }
                }
                ctx.request_repaint();
            })),
        });
        Some(preview)
    }

    pub(super) fn capture(&self, painter: &egui::Painter, key: Key, overlay_count: usize) {
        let cache = Arc::clone(&self.frame);
        // This runs after the heatmap, tracks and guides, before labels and
        // selection markers. Keep the original blending against the layout.
        painter.add(egui::PaintCallback {
            rect: key.clip,
            callback: Arc::new(CallbackFn::new(move |info, parent| {
                let gl = parent.gl();
                if info.screen_size_px != key.scene.screen_size() {
                    return;
                }
                let Some(size) = dimensions(&info) else {
                    return;
                };
                // SAFETY: The callback runs with the native window context current.
                if unsafe { gl.get_parameter_i32(glow::SAMPLES) } > 1 {
                    return;
                }
                let mut cache = cache.lock().unwrap();
                let target = match cache.take() {
                    Some(frame) if frame.target.size == size => Ok(frame.target),
                    Some(frame) => {
                        frame.target.destroy(gl);
                        allocate(gl, size)
                    }
                    None => allocate(gl, size),
                };
                if let Ok(target) = target {
                    if copy(gl, &info, &target, CopyDirection::Capture) {
                        *cache = Some(Frame {
                            key: key.clone(),
                            target,
                            overlay_count,
                        });
                    } else {
                        target.destroy(gl);
                    }
                }
            })),
        });
    }

    pub(super) fn destroy(&self, gl: &glow::Context) {
        if let Some(frame) = self.frame.lock().unwrap().take() {
            frame.target.destroy(gl);
        }
    }
}

pub(super) struct PanPreview {
    pub(super) overlay_count: usize,
    pub(super) exposed: [egui::Rect; 4],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PixelRect([i32; 4]);

impl PixelRect {
    fn from_clip(clip: egui::Rect, scale: f32, screen_size: [u32; 2]) -> Self {
        let clip = egui::epaint::ViewportInPixels::from_points(&clip, scale, screen_size);
        Self([
            clip.left_px,
            clip.top_px,
            clip.left_px + clip.width_px,
            clip.top_px + clip.height_px,
        ])
    }

    fn overlap_after_pan(self, delta: [i32; 2]) -> Option<Self> {
        let [left, top, right, bottom] = self.0;
        if delta[0].unsigned_abs() >= (right - left) as u32
            || delta[1].unsigned_abs() >= (bottom - top) as u32
        {
            return None;
        }
        let [x0, y0, x1, y1] = self.translate(delta).0;
        Some(Self([
            left.max(x0),
            top.max(y0),
            right.min(x1),
            bottom.min(y1),
        ]))
    }

    fn exposed_by(self, overlap: Self) -> [Self; 4] {
        let [left, top, right, bottom] = self.0;
        let [x0, y0, x1, y1] = overlap.0;
        [
            Self([left, top, right, y0]),
            Self([left, y1, right, bottom]),
            Self([left, y0, x0, y1]),
            Self([x1, y0, right, y1]),
        ]
    }

    fn relative_to(self, origin: Self) -> Self {
        self.translate([-origin.0[0], -origin.0[1]])
    }

    fn translate(self, delta: [i32; 2]) -> Self {
        let [x0, y0, x1, y1] = self.0;
        Self([x0 + delta[0], y0 + delta[1], x1 + delta[0], y1 + delta[1]])
    }

    fn to_points(self, scale: f32) -> egui::Rect {
        let [x0, y0, x1, y1] = self.0.map(|value| value as f32 / scale);
        egui::Rect::from_min_max(egui::pos2(x0, y0), egui::pos2(x1, y1))
    }

    fn gl_bounds(self, height: u32) -> [i32; 4] {
        let [x0, y0, x1, y1] = self.0;
        [x0, height as i32 - y1, x1, height as i32 - y0]
    }
}

#[cfg(all(test, target_os = "linux"))]
pub(in crate::app) fn check_composition(
    scene: &CpuScene,
    pans: &[([i32; 2], SceneKey)],
    gl: &Arc<glow::Context>,
    render: impl Fn(&dyn Fn(&egui::Painter)) -> Vec<u8>,
) {
    let cache = HeatmapComposition::default();
    let key = Key {
        scene: scene.key().clone(),
        generation: scene.generation,
        style: OverlayStyle {
            colors_revision: Arc::new(()),
            opacity: 0.65,
            guides_ready: true,
        },
        clip: scene.key().canvas(),
    };
    let draw_composition = |painter: &egui::Painter, offset: egui::Vec2| {
        painter.rect_filled(key.clip, 0.0, egui::Color32::from_rgb(30, 60, 90));
        painter.rect_filled(
            key.clip.shrink(2.0).translate(offset),
            0.0,
            egui::Color32::from_rgba_unmultiplied(184, 83, 12, 166),
        );
        painter.line_segment(
            [
                key.clip.left_top() + offset,
                key.clip.right_bottom() + offset,
            ],
            egui::Stroke::new(2.0, egui::Color32::from_rgba_unmultiplied(12, 255, 80, 132)),
        );
    };
    let marker = |painter: &egui::Painter, color| {
        painter.circle_filled(key.clip.center(), 4.0, color);
    };
    let expected = render(&|painter| {
        draw_composition(painter, egui::Vec2::ZERO);
        marker(painter, egui::Color32::WHITE);
    });
    let first = render(&|painter| {
        assert!(cache.cached(&key).is_none());
        draw_composition(painter, egui::Vec2::ZERO);
        cache.capture(painter, key.clone(), 1);
        marker(painter, egui::Color32::RED);
    });
    let reused = render(&|painter| {
        let cached = cache.cached(&key).expect("the complete frame is cached");
        assert_eq!(cached.overlay_count, 1);
        painter.add(egui::PaintCallback {
            rect: key.clip,
            callback: Arc::new(CallbackFn::new(move |info, parent| {
                assert!(cached.present(parent.gl(), &info));
            })),
        });
        marker(painter, egui::Color32::WHITE);
    });
    assert_ne!(
        first, expected,
        "the post-composition marker must be visible"
    );
    assert_eq!(reused, expected);
    for &(delta, ref panned) in pans {
        let offset = egui::vec2(delta[0] as f32, delta[1] as f32) / panned.pixels_per_point();
        let expected = render(&|painter| {
            draw_composition(painter, offset);
            marker(painter, egui::Color32::WHITE);
        });
        let actual = render(&|painter| {
            let preview = cache
                .paint_pan_with_style(painter, panned, &key.style)
                .expect("compatible views should reuse their overlapping pixels");
            for strip in preview.exposed.into_iter().filter(egui::Rect::is_positive) {
                draw_composition(&painter.with_clip_rect(strip), offset);
            }
            marker(painter, egui::Color32::WHITE);
        });
        let width = panned.screen_size()[0] as usize;
        let differences = actual
            .chunks_exact(4)
            .zip(expected.chunks_exact(4))
            .enumerate()
            .map(|(index, (actual, expected))| {
                let error = actual
                    .iter()
                    .zip(expected)
                    .map(|(a, b)| a.abs_diff(*b))
                    .max();
                (index, actual, expected, error.unwrap_or(0))
            });
        let max_error = differences.clone().map(|(_, _, _, error)| error).max();
        // Translating rasterized edges can differ by two 8-bit levels from
        // interpolating the same edges at a new origin in the GL shader.
        let large = differences.filter(|(_, _, _, error)| *error > 2);
        assert!(
            large.clone().count() == 0,
            "translated composition for {delta:?} at DPR {}: maximum error {max_error:?}, {} mismatched pixels, first: {:?}",
            panned.pixels_per_point(),
            large.clone().count(),
            large
                .take(10)
                .map(|(index, actual, expected, _)| ((index % width, index / width), actual, expected))
                .collect::<Vec<_>>()
        );
    }
    let new_style = OverlayStyle {
        colors_revision: Arc::new(()),
        ..key.style.clone()
    };
    let new_opacity = OverlayStyle {
        opacity: 0.25,
        ..key.style.clone()
    };
    render(&|painter| {
        for style in [&new_style, &new_opacity] {
            assert!(cache
                .paint_pan_with_style(painter, &key.scene, style)
                .is_none());
            assert!(cache
                .cached(&Key {
                    style: style.clone(),
                    ..key.clone()
                })
                .is_none());
        }
    });
    cache.destroy(gl);
}

fn dimensions(info: &egui::PaintCallbackInfo) -> Option<[u32; 2]> {
    let clip = info.clip_rect_in_pixels();
    let size = [clip.width_px as u32, clip.height_px as u32];
    (!size.contains(&0) && u64::from(size[0]) * u64::from(size[1]) <= 16_777_216).then_some(size)
}

struct FramebufferBindings {
    draw: Option<glow::Framebuffer>,
    read: Option<glow::Framebuffer>,
}

impl FramebufferBindings {
    fn current(gl: &glow::Context) -> Self {
        // SAFETY: The callback runs with the native window context current.
        unsafe {
            Self {
                draw: gl.get_parameter_framebuffer(glow::DRAW_FRAMEBUFFER_BINDING),
                read: gl.get_parameter_framebuffer(glow::READ_FRAMEBUFFER_BINDING),
            }
        }
    }

    fn restore(self, gl: &glow::Context) {
        // SAFETY: These bindings came from the current context and remain live.
        unsafe {
            gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, self.draw);
            gl.bind_framebuffer(glow::READ_FRAMEBUFFER, self.read);
        }
    }
}

fn allocate(gl: &glow::Context, size: [u32; 2]) -> Result<RasterTarget, String> {
    let bindings = FramebufferBindings::current(gl);
    let target = RasterTarget::new(gl, size);
    bindings.restore(gl);
    target
}

enum CopyDirection {
    Capture,
    Present,
}

fn copy(
    gl: &glow::Context,
    info: &egui::PaintCallbackInfo,
    target: &RasterTarget,
    direction: CopyDirection,
) -> bool {
    if dimensions(info) != Some(target.size) {
        return false;
    }
    let clip = info.clip_rect_in_pixels();
    let window = [
        clip.left_px,
        clip.from_bottom_px,
        clip.left_px + clip.width_px,
        clip.from_bottom_px + clip.height_px,
    ];
    let cached = [0, 0, clip.width_px, clip.height_px];
    let (src, dst) = match direction {
        CopyDirection::Capture => (window, cached),
        CopyDirection::Present => (cached, window),
    };
    blit(gl, Some(target.framebuffer), src, dst, direction)
}

fn blit(
    gl: &glow::Context,
    target: Option<glow::Framebuffer>,
    src: [i32; 4],
    dst: [i32; 4],
    direction: CopyDirection,
) -> bool {
    let bindings = FramebufferBindings::current(gl);
    let (read, draw) = match direction {
        CopyDirection::Capture => (bindings.draw, target),
        CopyDirection::Present => (target, bindings.draw),
    };
    // SAFETY: Both framebuffers belong to this context and the copy stays
    // inside the clipped canvas and the corresponding portion of the target.
    unsafe {
        let scissor = gl.is_enabled(glow::SCISSOR_TEST);
        gl.bind_framebuffer(glow::READ_FRAMEBUFFER, read);
        gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, draw);
        gl.disable(glow::SCISSOR_TEST);
        gl.blit_framebuffer(
            src[0],
            src[1],
            src[2],
            src[3],
            dst[0],
            dst[1],
            dst[2],
            dst[3],
            glow::COLOR_BUFFER_BIT,
            glow::NEAREST,
        );
        if scissor {
            gl.enable(glow::SCISSOR_TEST);
        }
    }
    bindings.restore(gl);
    // SAFETY: The same context remains current after restoring its bindings.
    unsafe { gl.get_error() == glow::NO_ERROR }
}
