use super::*;
use eframe::glow::{self, HasContext};

fn multiply(left: u8, right: u8) -> u8 {
    let product = u32::from(left) * u32::from(right);
    ((product + (product >> 8) + 128) >> 8) as u8
}

pub(super) fn transition(destination: [u8; 4], source: [u8; 4]) -> [u8; 4] {
    let mut result = [0; 4];
    for channel in 0..3 {
        result[channel] =
            source[channel].saturating_add(multiply(destination[channel], 255 - source[3]));
    }
    result[3] = destination[3].saturating_add(multiply(source[3], 255 - destination[3]));
    result
}

pub(super) fn renderer() -> Option<offscreen::OffscreenRenderer> {
    let expected = std::env::var("ECOS_COVERAGE_GL_RENDERER").unwrap_or_default();
    let renderer = match offscreen::OffscreenRenderer::new(&expected) {
        Ok(renderer) => renderer,
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_COVERAGE_EGL").is_none(),
                "required coverage EGL unavailable: {error}"
            );
            eprintln!("Coverage blend profile not certified: {error}");
            return None;
        }
    };
    let (name, version) = renderer.with_context(|gl| unsafe {
        (
            gl.get_parameter_string(glow::RENDERER),
            gl.get_parameter_string(glow::VERSION),
        )
    });
    eprintln!("Coverage blend oracle renderer={name}, version={version}");
    if !name.contains("llvmpipe") {
        assert!(
            std::env::var_os("ECOS_REQUIRE_COVERAGE_EGL").is_none(),
            "required llvmpipe coverage profile differs from {name}"
        );
        eprintln!("Coverage blend profile not certified on {name}");
        return None;
    }
    Some(renderer)
}

fn primitive(mesh: egui::Mesh, clip_rect: egui::Rect) -> egui::ClippedPrimitive {
    egui::ClippedPrimitive {
        clip_rect,
        primitive: egui::epaint::Primitive::Mesh(mesh),
    }
}

fn sample(pixels: &[u8], size: [u32; 2], column: usize, row: usize) -> [u8; 4] {
    let index = ((size[1] as usize - 1 - row) * size[0] as usize + column) * 4;
    pixels[index..index + 4].try_into().unwrap()
}

#[test]
fn coverage_negative_models_lose_multiplicity_order_and_intermediate_quantization() {
    let fill = [0, 0, 0, 128];
    let frame = [0, 0, 0, 64];
    let background = [3, 3, 3, 255];
    let twice = transition(transition(background, fill), fill);
    assert_eq!(twice, [0, 0, 0, 255]);
    assert_ne!(twice, transition(background, fill));
    let folded = (3.0_f64 * (127.0_f64 / 255.0).powi(2)).round() as u8;
    assert_ne!(twice[0], folded);
    let background = [5, 5, 5, 255];
    assert_eq!(
        transition(transition(transition(background, fill), frame), fill)[0],
        0
    );
    assert_eq!(
        transition(transition(transition(background, fill), fill), frame)[0],
        1
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn coverage_byte_transition_matches_gl_destination_ramps_and_flat_source_phases() {
    let Some(mut renderer) = renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [512, 256];
    request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(512.0, 256.0));
    request.key.background = egui::Color32::TRANSPARENT;
    let mut sources: Vec<_> = [0, 31, 64, 112, 128, 173, 254, 255]
        .into_iter()
        .flat_map(|alpha| [[0, 0, 0, alpha], [173, 61, 237, alpha]])
        .map(color32)
        .collect();
    for &theme in chip_display::ColorTheme::ALL {
        for layer in 1..=16 {
            let style = chip_display::LayerStyle::default_for_layer(layer, theme);
            sources.extend([color32(style.rgba), color32(style.frame_rgba)]);
        }
    }
    sources.sort_unstable_by_key(|color| color.to_array());
    sources.dedup();
    eprintln!(
        "Coverage blend oracle: {} sources, 256 destination values, four phases, eight rows",
        sources.len()
    );
    for offset in [[0, 0], [1, 1], [17, 23], [128, 128]] {
        let mut ramp = egui::Mesh::default();
        for value in 0..256 {
            let destination = [
                value as u8,
                255 - value as u8,
                (value * 37) as u8,
                value as u8,
            ];
            ramp.add_colored_rect(
                egui::Rect::from_min_size(
                    egui::pos2((offset[0] + value) as f32, offset[1] as f32),
                    egui::vec2(1.0, 8.0),
                ),
                egui::Color32::from_rgba_premultiplied(
                    destination[0],
                    destination[1],
                    destination[2],
                    destination[3],
                ),
            );
        }
        let base = primitive(ramp, request.key.canvas);
        let initial = pixels(&mut renderer, &request, vec![base.clone()]);
        for value in 0..256 {
            assert_eq!(
                sample(
                    &initial,
                    request.key.screen_size,
                    offset[0] + value,
                    offset[1]
                ),
                [
                    value as u8,
                    255 - value as u8,
                    (value * 37) as u8,
                    value as u8
                ]
            );
        }
        for source in &sources {
            let mut mesh = egui::Mesh::default();
            mesh.add_colored_rect(
                egui::Rect::from_min_size(
                    egui::pos2(offset[0] as f32, offset[1] as f32),
                    egui::vec2(256.0, 8.0),
                ),
                *source,
            );
            let actual = pixels(
                &mut renderer,
                &request,
                vec![base.clone(), primitive(mesh, request.key.canvas)],
            );
            for row in offset[1]..offset[1] + 8 {
                for value in 0..256 {
                    let destination =
                        sample(&initial, request.key.screen_size, offset[0] + value, row);
                    assert_eq!(
                        sample(&actual, request.key.screen_size, offset[0] + value, row),
                        transition(destination, source.to_array()),
                        "source={source:?}, destination={destination:?}, position=({}, {row})",
                        offset[0] + value,
                    );
                }
            }
        }
    }
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn coverage_fractional_source_control_is_phase_sensitive() {
    let Some(mut renderer) = renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [128, 256];
    request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(128.0, 256.0));
    let mut mesh = egui::Mesh::default();
    mesh.add_colored_rect(request.key.canvas, egui::Color32::BLACK);
    for vertex in &mut mesh.vertices {
        if vertex.pos.x > 0.0 {
            vertex.color = egui::Color32::from_rgb(1, 1, 1);
        }
    }
    let actual = pixels(
        &mut renderer,
        &request,
        vec![primitive(mesh, request.key.canvas)],
    );
    let values: std::collections::BTreeSet<_> = (0..256)
        .map(|row| sample(&actual, request.key.screen_size, 64, row)[0])
        .collect();
    assert_eq!(values, [0, 1].into_iter().collect());
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn coverage_gl_prefixes_expose_wrong_union_and_unordered_count_models() {
    let Some(mut renderer) = renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [64, 64];
    request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(64.0, 64.0));
    let fill = [0, 0, 0, 128];
    let frame = [0, 0, 0, 64];
    for (background, words) in [
        (3, vec![vec![fill], vec![fill, fill]]),
        (5, vec![vec![fill, frame, fill], vec![fill, fill, frame]]),
    ] {
        request.key.background = egui::Color32::from_rgb(background, background, background);
        let mut results = Vec::new();
        for word in words {
            let mut expected = request.key.background.to_array();
            let mut commands = Vec::new();
            for source in word {
                expected = transition(expected, color32(source).to_array());
                commands.push(PaintCommand::FillRect {
                    rect: egui::Rect::from_min_max(egui::pos2(8.0, 8.0), egui::pos2(56.0, 56.0)),
                    rgba: source,
                });
                let output = meshes(
                    &fixture,
                    &request,
                    &commands,
                    geometry::GeometryOutput::ExactRaster,
                );
                let actual = pixels(&mut renderer, &request, output);
                assert_eq!(sample(&actual, request.key.screen_size, 32, 32), expected);
            }
            results.push(expected);
        }
        assert_ne!(results[0], results[1]);
    }
}
