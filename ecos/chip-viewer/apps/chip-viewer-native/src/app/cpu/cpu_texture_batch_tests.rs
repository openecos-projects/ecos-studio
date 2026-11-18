use super::*;
use crate::app::cpu_raster::target::RasterTarget;
use crate::app::cpu_scene::{offscreen::OffscreenRenderer, tests::Fixture};
use chip_display::FillPattern;

const PATTERNS: [FillPattern; 7] = [
    FillPattern::SparseDots,
    FillPattern::DenseDots,
    FillPattern::DiagonalHatch,
    FillPattern::CrossHatch,
    FillPattern::HorizontalHatch,
    FillPattern::VerticalHatch,
    FillPattern::Grid,
];

fn quad(
    rect: egui::Rect,
    texture: egui::TextureId,
    uv: egui::Rect,
    color: egui::Color32,
    clip: egui::Rect,
) -> egui::ClippedPrimitive {
    let mut mesh = egui::Mesh::with_texture(texture);
    mesh.add_rect_with_uv(rect, uv, color);
    egui::ClippedPrimitive {
        clip_rect: clip,
        primitive: egui::epaint::Primitive::Mesh(mesh),
    }
}

fn white(rect: egui::Rect, color: egui::Color32, clip: egui::Rect) -> egui::ClippedPrimitive {
    quad(
        rect,
        egui::TextureId::default(),
        egui::Rect::from_min_max(egui::epaint::WHITE_UV, egui::epaint::WHITE_UV),
        color,
        clip,
    )
}

fn read(gl: &glow::Context, size: [u32; 2]) -> Vec<u8> {
    let mut pixels = vec![0; size[0] as usize * size[1] as usize * 4];
    unsafe {
        gl.read_pixels(
            0,
            0,
            size[0] as i32,
            size[1] as i32,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        );
        assert_eq!(gl.get_error(), glow::NO_ERROR);
    }
    pixels
}

fn check(
    request: &SceneRequest,
    meshes: &[egui::ClippedPrimitive],
    unknown: Option<egui::TextureId>,
) -> (usize, usize, bool) {
    let renderer =
        OffscreenRenderer::new("").expect("texture batch oracle requires an actual EGL renderer");
    renderer.with_context(|gl| {
        unsafe {
            eprintln!(
                "Texture batch oracle: renderer={}, version={}",
                gl.get_parameter_string(glow::RENDERER),
                gl.get_parameter_string(glow::VERSION)
            );
        }
        let mut painter = eframe::egui_glow::Painter::new(Arc::clone(gl), "", None, true).unwrap();
        let target = RasterTarget::new(gl, request.key.screen_size).unwrap();
        request.pattern_textures.upload_for(&mut painter, meshes);
        painter.set_texture(
            egui::TextureId::default(),
            &egui::epaint::ImageDelta::full(
                request.repaint.fonts(egui::epaint::Fonts::image),
                egui::TextureOptions::LINEAR,
            ),
        );
        if let Some(texture) = unknown {
            painter.set_texture(
                texture,
                &egui::epaint::ImageDelta::full(
                    egui::ColorImage::new(
                        [2, 2],
                        egui::Color32::from_rgba_premultiplied(29, 79, 13, 112),
                    ),
                    egui::TextureOptions::LINEAR_REPEAT,
                ),
            );
        }
        // Nonzero sampler/texture state on higher units must survive batching.
        let sentinel = unsafe { gl.create_texture().unwrap() };
        let sampler = unsafe { gl.create_sampler().unwrap() };
        unsafe {
            gl.active_texture(glow::TEXTURE0 + 3);
            gl.bind_texture(glow::TEXTURE_2D, Some(sentinel));
            gl.bind_sampler(3, Some(sampler));
            gl.active_texture(glow::TEXTURE0);
        }
        target.clear(gl, request.key.background);
        painter.paint_primitives(
            request.key.screen_size,
            request.key.pixels_per_point,
            meshes,
        );
        let expected = read(gl, request.key.screen_size);
        target.clear(gl, request.key.background);
        let mut compact = CompactPainter::default();
        compact.paint(
            &mut painter,
            &request.key,
            &request.pattern_textures,
            meshes,
            &geometry::pack_meshes(meshes),
        );
        let actual = read(gl, request.key.screen_size);
        let first = actual
            .iter()
            .zip(&expected)
            .enumerate()
            .filter(|(_, (a, b))| a != b)
            .take(12)
            .collect::<Vec<_>>();
        assert!(
            first.is_empty(),
            "DPR {}: nonidentical bytes {first:?}",
            request.key.pixels_per_point
        );
        assert!(
            expected
                .chunks_exact(4)
                .any(|pixel| pixel != request.key.background.to_array()),
            "empty oracle"
        );
        let certified = certified_profile(gl);
        if certified {
            assert!(
                compact.textures.draws > 0,
                "certified multi-texture path must draw"
            );
        } else {
            assert_eq!(
                compact.textures.draws, 0,
                "uncertified profiles must use the original painter"
            );
        }
        unsafe {
            gl.active_texture(glow::TEXTURE0 + 3);
            assert_eq!(
                gl.get_parameter_texture(glow::TEXTURE_BINDING_2D),
                Some(sentinel)
            );
            assert_eq!(
                gl.get_parameter_sampler(glow::SAMPLER_BINDING),
                Some(sampler)
            );
            gl.bind_texture(glow::TEXTURE_2D, None);
            gl.bind_sampler(3, None);
            gl.active_texture(glow::TEXTURE0);
            gl.delete_sampler(sampler);
            gl.delete_texture(sentinel);
        }
        let stats = (
            compact.textures.draws,
            compact.textures.fallbacks,
            certified,
        );
        compact.destroy(gl);
        painter.destroy();
        target.destroy(gl);
        stats
    })
}

fn request(fixture: &Fixture, scale: f32) -> SceneRequest {
    let mut request = fixture.request(1.0, scale);
    request.key.screen_size = [257, 193];
    request.key.canvas = egui::Rect::from_min_max(
        egui::pos2(7.25, 11.75) / scale,
        egui::pos2(249.5, 187.25) / scale,
    );
    request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&request.repaint));
    request
}

#[test]
fn texture_batch_all_managed_masks_and_ordered_alpha_are_byte_exact_at_fractional_dpr() {
    let fixture = Fixture::new();
    for scale in [1.0, 1.25, 2.0, 4.0] {
        let request = request(&fixture, scale);
        let clip = request.key.canvas;
        let mut meshes = Vec::new();
        for index in 0..210 {
            let pattern = PATTERNS[index % 7];
            let (texture, _) = request.pattern_textures.spec(pattern).unwrap();
            let rect = egui::Rect::from_min_size(
                egui::pos2(
                    (index * 13 % 173) as f32 - 9.125,
                    (index * 19 % 151) as f32 - 7.375,
                ) / scale,
                egui::vec2(91.75, 53.125) / scale,
            );
            let color = egui::Color32::from_rgba_unmultiplied(
                (index * 37) as u8,
                (index * 71) as u8,
                (index * 137) as u8,
                [0, 31, 112, 173, 255][index % 5],
            );
            meshes.push(white(rect.shrink(0.375 / scale), color, clip));
            meshes.push(quad(
                rect,
                texture,
                egui::Rect::from_min_max(egui::pos2(-1.375, -0.625), egui::pos2(8.875, 11.125)),
                color,
                clip,
            ));
            meshes.push(white(rect.shrink(2.25 / scale), color, clip));
        }
        let (draws, fallbacks, certified) = check(&request, &meshes, None);
        assert_eq!((draws, fallbacks), if certified { (1, 0) } else { (0, 0) });
    }
}

#[test]
fn texture_batch_preserves_font_uvs_clip_changes_and_callback_fallback_order() {
    let fixture = Fixture::new();
    for scale in [1.0, 1.25, 2.0] {
        let request = request(&fixture, scale);
        let clip = request.key.canvas;
        let rect = clip.expand(9.75 / scale);
        let (texture, _) = request
            .pattern_textures
            .spec(FillPattern::DenseDots)
            .unwrap();
        let pattern = || {
            quad(
                rect,
                texture,
                egui::Rect::from_min_max(egui::pos2(-0.375, 1.125), egui::pos2(19.75, 23.25)),
                egui::Color32::from_rgba_unmultiplied(173, 61, 237, 112),
                clip,
            )
        };
        let mut meshes = vec![pattern()];
        let output = request.repaint.run(
            egui::RawInput {
                screen_rect: Some(clip),
                ..Default::default()
            },
            |ctx| {
                let painter = ctx
                    .layer_painter(egui::LayerId::background())
                    .with_clip_rect(clip);
                painter.text(
                    clip.center(),
                    egui::Align2::CENTER_CENTER,
                    "KLayout 0.30.9\nαβ 012345",
                    egui::FontId::proportional(17.25 / scale),
                    egui::Color32::from_rgba_unmultiplied(211, 171, 73, 173),
                );
                painter.circle_filled(
                    clip.center(),
                    13.5 / scale,
                    egui::Color32::from_rgba_unmultiplied(37, 191, 83, 112),
                );
            },
        );
        meshes.extend(request.repaint.tessellate(output.shapes, scale));
        let unknown = egui::TextureId::User(991);
        meshes.push(quad(
            rect,
            unknown,
            egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(7.25, 5.375)),
            egui::Color32::WHITE,
            clip.shrink(19.5 / scale),
        ));
        meshes.push(pattern());
        meshes.push(egui::ClippedPrimitive {
            clip_rect: clip.shrink(43.25 / scale),
            primitive: egui::epaint::Primitive::Callback(egui::PaintCallback {
                rect: clip,
                callback: Arc::new(eframe::egui_glow::CallbackFn::new(|_, painter| unsafe {
                    let gl = painter.gl();
                    gl.clear_color(0.25, 0.5, 0.125, 0.75);
                    gl.clear(glow::COLOR_BUFFER_BIT);
                })),
            }),
        });
        let mut last = pattern();
        last.clip_rect = clip.shrink(7.75 / scale);
        meshes.push(last);
        meshes.push(pattern());
        let (draws, fallbacks, certified) = check(&request, &meshes, Some(unknown));
        if certified {
            assert!(draws >= 4);
            assert!(
                fallbacks >= 3,
                "font/nonwhite UV, unknown and callback must fall back"
            );
        } else {
            assert_eq!((draws, fallbacks), (0, 0));
        }
    }
}

#[test]
fn texture_batch_uses_u32_indices_above_the_compact_u16_vertex_limit() {
    let fixture = Fixture::new();
    let request = request(&fixture, 1.0);
    let clip = request.key.canvas;
    let (texture, _) = request
        .pattern_textures
        .spec(FillPattern::CrossHatch)
        .unwrap();
    let mut meshes = vec![quad(
        clip,
        texture,
        egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(23.25, 17.75)),
        egui::Color32::WHITE,
        clip,
    )];
    let mut mesh = egui::Mesh::default();
    for index in 0..17_000 {
        let rect = egui::Rect::from_min_size(
            egui::pos2((index % 251) as f32 + 0.125, (index / 251) as f32 * 2.25),
            egui::vec2(1.75, 2.125),
        );
        mesh.add_colored_rect(
            rect,
            egui::Color32::from_rgba_unmultiplied(173, 61, 237, 112),
        );
    }
    assert!(mesh.vertices.len() > 65_536);
    meshes.push(egui::ClippedPrimitive {
        clip_rect: clip,
        primitive: egui::epaint::Primitive::Mesh(mesh),
    });
    let (draws, fallbacks, certified) = check(&request, &meshes, None);
    assert_eq!((draws, fallbacks), if certified { (1, 0) } else { (0, 0) });
}
