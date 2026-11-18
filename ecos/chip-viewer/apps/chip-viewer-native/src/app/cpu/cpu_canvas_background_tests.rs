use super::*;
use crate::app::cpu_raster::{background, test_support::Presentation, CpuRasterCache};

#[test]
fn central_panel_clear_matches_original_frame_with_side_panels_and_content() {
    let fixture = Fixture::new();
    let renderer = match offscreen::OffscreenRenderer::new("") {
        Ok(renderer) => renderer,
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_INTERACTION_EGL").is_none(),
                "{error}"
            );
            return;
        }
    };
    renderer.with_context(|gl| {
        if !sparse_rects::certified_profile(gl) {
            assert!(std::env::var_os("ECOS_COVERAGE_GL_RENDERER").is_none());
            return;
        }
        for scale in [1.0, 2.0, 4.0] {
            fixture.ctx.set_pixels_per_point(scale);
            let _ = fixture.ctx.run(egui::RawInput::default(), |_| {});
            let mut key = fixture.request(1.0, scale).key;
            key.screen_size = [509, 503];
            key.canvas =
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(509.0, 503.0) / scale);
            let presentation = Presentation::new(Arc::clone(gl), &key, fixture.ctx.clone());
            for width in [0.0, 81.0, 121.0] {
                let paint = |painter: &egui::Painter, fast| {
                    let context = painter.ctx();
                    if width > 0.0 {
                        egui::SidePanel::left("background-left-oracle")
                            .resizable(false)
                            .exact_width(width / scale)
                            .show(context, |ui| {
                                ui.label("Layers");
                            });
                    }
                    let frame = if fast {
                        let frame = presentation.cache.central_frame(context);
                        if width == 0.0 {
                            assert_eq!(frame.fill, egui::Color32::TRANSPARENT);
                        }
                        frame
                    } else {
                        egui::Frame::central_panel(&context.style())
                    };
                    egui::CentralPanel::default()
                        .frame(frame)
                        .show(context, |ui| {
                            ui.painter().rect_filled(
                                ui.max_rect(),
                                0.0,
                                egui::Color32::from_rgb(24, 24, 28),
                            );
                            ui.label("Layout geometry");
                            ui.painter().line_segment(
                                [ui.min_rect().min, ui.max_rect().max],
                                egui::Stroke::new(1.0, egui::Color32::from_rgb(193, 73, 37)),
                            );
                        });
                };
                let expected = presentation.paint_queued(|painter| paint(painter, false), || {});
                let actual = presentation.paint_queued(|painter| paint(painter, true), || {});
                assert_eq!(
                    actual
                        .iter()
                        .zip(&expected)
                        .position(|(actual, expected)| actual != expected),
                    None,
                    "DPR {scale}, side width {width}"
                );
            }
        }
    });
}

#[test]
fn canvas_background_clear_matches_original_rect_and_following_paint() {
    let fixture = Fixture::new();
    let renderer = match offscreen::OffscreenRenderer::new(
        &std::env::var("ECOS_COVERAGE_GL_RENDERER").unwrap_or_default(),
    ) {
        Ok(renderer) => renderer,
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_INTERACTION_EGL").is_none(),
                "EGL background check required: {error}"
            );
            return;
        }
    };
    renderer.with_context(|gl| {
        if !sparse_rects::certified_profile(gl) {
            assert!(
                std::env::var_os("ECOS_COVERAGE_GL_RENDERER").is_none(),
                "certified EGL profile required"
            );
            return;
        }
        for dpr in [1.0, 2.0, 4.0] {
            fixture.ctx.set_pixels_per_point(dpr);
            let _ = fixture.ctx.run(egui::RawInput::default(), |_| {});
            let mut key = fixture.request(1.0, dpr).key;
            key.screen_size = [321, 239];
            key.canvas = egui::Rect::from_min_max(
                egui::pos2(3.25, 5.5) / dpr,
                egui::pos2(318.75, 237.25) / dpr,
            );
            let presentation = Presentation::new(Arc::clone(gl), &key, fixture.ctx.clone());
            for color in [
                egui::Color32::BLACK,
                egui::Color32::WHITE,
                egui::Color32::from_rgb(13, 29, 51),
                egui::Color32::from_rgb(254, 127, 1),
            ] {
                for frame in [
                    egui::Rect::from_min_max(
                        egui::pos2(11.0, 17.0) / dpr,
                        egui::pos2(309.0, 231.0) / dpr,
                    ),
                    egui::Rect::from_min_max(
                        egui::pos2(-9.0, -7.0) / dpr,
                        egui::pos2(333.0, 247.0) / dpr,
                    ),
                ] {
                    for following in [false, true] {
                        let paint = |painter: &egui::Painter, fast| {
                            painter.rect_filled(
                                key.canvas,
                                0.0,
                                egui::Color32::from_rgb(73, 151, 239),
                            );
                            if fast {
                                assert!(
                                    presentation.cache.paint_background(painter, frame, color),
                                    "dpr={dpr} actual={} frame={frame:?}",
                                    painter.ctx().pixels_per_point()
                                );
                            } else {
                                painter.rect_filled(frame, 0.0, color);
                            }
                            if following {
                                painter.line_segment(
                                    [frame.min, frame.max],
                                    egui::Stroke::new(
                                        2.3 / dpr,
                                        egui::Color32::from_rgba_premultiplied(57, 83, 111, 173),
                                    ),
                                );
                                painter.text(
                                    key.canvas.center(),
                                    egui::Align2::CENTER_CENTER,
                                    "geometry 123",
                                    egui::FontId::proportional(14.0 / dpr),
                                    egui::Color32::WHITE,
                                );
                            }
                        };
                        let expected =
                            presentation.paint_queued(|painter| paint(painter, false), || {});
                        let actual =
                            presentation.paint_queued(|painter| paint(painter, true), || {});
                        let difference = actual
                            .iter()
                            .zip(&expected)
                            .position(|(actual, expected)| actual != expected);
                        assert_eq!(
                            difference, None,
                            "dpr={dpr} color={color:?} frame={frame:?} following={following}"
                        );
                    }
                }
            }
        }
    });
}

#[test]
fn canvas_background_keeps_original_path_for_unsupported_inputs_and_uncertified_cache() {
    let context = egui::Context::default();
    let frame = egui::Rect::from_min_size(egui::pos2(7.0, 13.0), egui::vec2(80.0, 90.0));
    for scale in [1.0, 1.25, 2.0, 4.0] {
        context.set_pixels_per_point(scale);
        let _ = context.run(egui::RawInput::default(), |context| {
            let painter = context.layer_painter(egui::LayerId::background());
            assert_eq!(
                CpuRasterCache::default().central_frame(context),
                egui::Frame::central_panel(&context.style())
            );
            assert!(!CpuRasterCache::default().paint_background(
                &painter,
                frame,
                egui::Color32::BLACK
            ));
            for (rect, color) in [
                (frame, egui::Color32::from_black_alpha(127)),
                (
                    frame.translate(egui::vec2(0.125, 0.125)),
                    egui::Color32::WHITE,
                ),
                (
                    egui::Rect::from_min_size(frame.min, egui::vec2(0.25, 0.5)),
                    egui::Color32::WHITE,
                ),
                (egui::Rect::NOTHING, egui::Color32::BLACK),
                (egui::Rect::EVERYTHING, egui::Color32::BLACK),
            ] {
                assert!(!background::queue(&painter, rect, color));
            }
            if scale == 1.25 {
                assert!(!background::queue(&painter, frame, egui::Color32::WHITE));
            }
            context.tessellation_options_mut(|options| options.feathering = false);
            assert!(!background::queue(&painter, frame, egui::Color32::WHITE));
            context.tessellation_options_mut(|options| *options = Default::default());
        });
    }
}
