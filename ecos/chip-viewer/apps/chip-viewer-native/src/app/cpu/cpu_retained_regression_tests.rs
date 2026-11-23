//! Linux GL regressions for target preparation, composition, and ordered repairs.
//! EGL failure is an error, never a successful skip.

use super::*;
use crate::app::cpu_scene::{offscreen::OffscreenRenderer, tests::Fixture};
use chip_display::{ColorTheme, FillPattern};
use chipgeom_format::{Point32, PointPayload};
use eframe::glow::HasContext as _;

#[derive(Clone, Copy)]
struct Input {
    bbox: Rect32,
    geometry: ShapeGeometry,
    style: LayerStyle,
}

fn rectangle(bounds: [i32; 4], pattern: FillPattern, rgba: [u8; 4]) -> Input {
    let [lx, ly, hx, hy] = bounds;
    let bbox = Rect32 { lx, ly, hx, hy };
    let mut style = LayerStyle::default_for_layer(1, ColorTheme::Vivid);
    style.fill_pattern = pattern;
    style.rgba = rgba;
    // Isolate the fill; GeometryPass still emits a real frame command.
    style.frame_rgba = [0; 4];
    style.line_width_px = 1;
    Input {
        bbox,
        geometry: ShapeGeometry::Rect(bbox),
        style,
    }
}

fn point(x: i32, y: i32) -> Input {
    let mut input = rectangle([x, y, x, y], FillPattern::Solid, [255; 4]);
    input.geometry = ShapeGeometry::Point(PointPayload {
        point: Point32 { x, y },
        ..Default::default()
    });
    input.style.frame_rgba = [255; 4];
    input
}

fn viewport(key: &SceneKey) -> Rect32 {
    screen_to_world_rect(key.canvas, key.world, key.canvas, key.zoom, key.pan)
}

fn request(
    fixture: &Fixture,
    inputs: &[Input],
    zoom: f32,
    pan: egui::Vec2,
    scale: f32,
) -> SceneRequest {
    let mut request = fixture.request(zoom, scale);
    request.key.world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 128,
        hy: 128,
    };
    request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(128.0, 128.0));
    request.key.screen_size = [(128.0 * scale) as u32; 2];
    request.key.pan = pan;
    request.key.viewport = viewport(&request.key);
    request.key.background = egui::Color32::from_rgb(13, 29, 51);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&request.repaint));
    request.data_bounds = Some(inputs.iter().fold(inputs[0].bbox, |bounds, input| Rect32 {
        lx: bounds.lx.min(input.bbox.lx),
        ly: bounds.ly.min(input.bbox.ly),
        hx: bounds.hx.max(input.bbox.hx),
        hy: bounds.hy.max(input.bbox.hy),
    }));
    request
}

fn commands(input: Input, key: &SceneKey) -> Vec<PaintCommand> {
    let mut commands = Commands::default();
    if input.bbox.intersects(key.viewport) {
        GeometryPass::new(key.world, key.canvas, key.zoom, key.pan).draw(
            input.geometry,
            &input.style,
            &mut commands,
        );
    }
    commands.0
}

fn fresh(renderer: &mut OffscreenRenderer, request: &SceneRequest, inputs: &[Input]) -> Vec<u8> {
    // Use the production ExactRaster mesh path, including managed pattern
    // textures, rather than the compatibility pattern geometry fallback.
    let mut sink = geometry::GeometryMeshSink::for_raster_with_patterns(
        request.tessellator.clone(),
        request.key.canvas,
        request.key.tessellation,
        request.key.pixels_per_point,
        Arc::clone(&request.pattern_textures),
    );
    for &input in inputs {
        for command in commands(input, &request.key) {
            sink.paint(command);
        }
    }
    let mut scene = builder::build_with_workers(request, &|| true, 1).unwrap();
    scene.meshes = sink.finish();
    renderer
        .rasterize_updates(&scene, request, || true, |_, _| {}, None)
        .expect("fresh GL rendering failed")
        .expect("fresh GL rendering was cancelled")
        .0
}

fn check_pan(inputs: &[Input], zoom: f32, source_pan: egui::Vec2, delta: egui::Vec2) {
    check_pan_at_scale(inputs, zoom, source_pan, delta, 1.0);
}

fn check_pan_at_scale(
    inputs: &[Input],
    zoom: f32,
    source_pan: egui::Vec2,
    delta: egui::Vec2,
    scale: f32,
) {
    let mut renderer = OffscreenRenderer::new("")
        .expect("retained regression requires a real EGL renderer; do not skip");
    let certified = renderer.with_context(|gl| unsafe {
        eprintln!(
            "retained regression GL renderer={}, version={}",
            gl.get_parameter_string(eframe::glow::RENDERER),
            gl.get_parameter_string(eframe::glow::VERSION),
        );
        sparse_rects::certified_profile(gl)
    });
    let fixture = Fixture::new();
    let mut request = request(&fixture, inputs, zoom, source_pan, scale);
    let mut model =
        RegionModel::new(&request).expect("source must cover the complete input bounds");
    for &input in inputs {
        let source_commands = commands(input, &request.key);
        assert!(model.push(input.bbox, input.geometry, input.style, &source_commands));
    }
    let source = fresh(&mut renderer, &request, inputs);
    request.key.pan += delta;
    request.key.viewport = viewport(&request.key);
    let target = fresh(&mut renderer, &request, inputs);
    let regions = renderer
        .with_context(|gl| model.prepare_for_gl(&request.key, 1, gl))
        .expect("integer pan must prepare a target proof");
    let mut actual = model
        .compose(&request.key, &regions, &source)
        .expect("validated pan must compose");

    // A sentinel source makes accidental copying observable even when the old
    // framebuffer would happen to match the target at some pixels.
    assert_eq!(
        actual,
        model
            .compose(&request.key, &regions, &vec![0x5a; source.len()])
            .unwrap(),
        "target style must not depend on old RGBA"
    );
    let repairs = regions
        .repair_meshes(&request.key)
        .expect("bounded GL repairs");
    let repair_count = repairs.len();
    let mut repair_scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    repair_scene.meshes = repairs;
    let repair = renderer
        .rasterize_updates(&repair_scene, &request, || true, |_, _| {}, None)
        .expect("repair GL failed")
        .expect("repair GL cancelled")
        .0;
    let [width, height] = request.key.screen_size;
    let total_foreground = target
        .chunks_exact(4)
        .filter(|pixel| *pixel != request.key.background.to_array())
        .count();
    let mut compared = 0;
    let mut foreground = 0;
    for clip in regions.clips() {
        for row in (clip.top() * scale) as usize..(clip.bottom() * scale) as usize {
            for column in (clip.left() * scale) as usize..(clip.right() * scale) as usize {
                let offset = ((height as usize - 1 - row) * width as usize + column) * 4;
                compared += 1;
                foreground +=
                    usize::from(target[offset..offset + 4] != request.key.background.to_array());
            }
        }
    }
    for clip in regions.damage_clips(&request.key) {
        for row in (clip.top() * scale) as usize..(clip.bottom() * scale) as usize {
            let start =
                ((height as usize - 1 - row) * width as usize + (clip.left() * scale) as usize) * 4;
            let end = start + (clip.width() * scale) as usize * 4;
            actual[start..end].copy_from_slice(&repair[start..end]);
        }
    }
    // Only managed texture sampling has the existing <=2-channel allowance.
    // Every solid-only scene remains byte exact, including translucent solids.
    let patterns = inputs
        .iter()
        .flat_map(|&input| commands(input, &request.key))
        .filter_map(|command| match command {
            PaintCommand::PatternRect { rect, .. } => Some(rect),
            _ => None,
        })
        .collect::<Vec<_>>();
    let mut differences = Vec::new();
    let mut final_foreground = 0;
    for row in 0..height as usize {
        for column in 0..width as usize {
            let offset = ((height as usize - 1 - row) * width as usize + column) * 4;
            let got = &actual[offset..offset + 4];
            let expected = &target[offset..offset + 4];
            final_foreground += usize::from(got != request.key.background.to_array());
            let pattern_pixel = patterns.iter().any(|rect| {
                rect.contains(egui::pos2(
                    (column as f32 + 0.5) / scale,
                    (row as f32 + 0.5) / scale,
                ))
            });
            let allowance = if certified && pattern_pixel { 2 } else { 0 };
            if got
                .iter()
                .zip(expected)
                .any(|(a, b)| a.abs_diff(*b) > allowance)
                && differences.len() < 8
            {
                differences.push((column, row, got.to_vec(), expected.to_vec()));
            }
        }
    }
    eprintln!(
        "retained regression DPR={scale}, pan={delta:?}: cpu_pixels={compared}, cpu_foreground={foreground}/{total_foreground}, repair_primitives={repair_count}, final_foreground={final_foreground}, first_differences={differences:?}"
    );
    if certified {
        assert!(compared >= 256, "vacuous valid region: {compared}");
    } else {
        assert!(
            repair_count > 0,
            "uncertified profiles must replay foreground in GL"
        );
    }
    assert!(
        total_foreground > 0 && final_foreground > 0,
        "foreground disappeared"
    );
    let raster =
        geometry::PixelRectRasterizer::new(request.key.pixels_per_point, request.key.tessellation)
            .unwrap();
    let supported_foreground = inputs
        .iter()
        .flat_map(|&input| commands(input, &request.key))
        .any(|command| match command {
            PaintCommand::PatternRect { rgba, .. } => rgba[3] > 0,
            PaintCommand::FillRect { rgba, .. } | PaintCommand::FrameRect { rgba, .. } => {
                rgba[3] > 0 && raster.rectangles(command).is_some()
            }
            _ => false,
        });
    if certified && supported_foreground {
        assert!(
            foreground > 0,
            "certified supported foreground was excluded"
        );
    }
    assert!(
        differences.is_empty(),
        "composed and repaired frame differs from fresh GL: {differences:?}"
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_translucent_solid_matches_fresh_gl() {
    check_pan(
        &[rectangle(
            [24, 24, 88, 88],
            FillPattern::Solid,
            [173, 61, 237, 112],
        )],
        1.0,
        egui::Vec2::ZERO,
        egui::vec2(4.0, 3.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_translucent_managed_pattern_matches_fresh_gl() {
    check_pan(
        &[rectangle(
            [24, 24, 88, 88],
            FillPattern::DenseDots,
            [173, 61, 237, 112],
        )],
        1.0,
        egui::Vec2::ZERO,
        egui::vec2(4.0, 3.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_source_frame_only_can_become_target_pattern() {
    // At zoom 8 the source viewport rounds to x=56..72 and includes the
    // entire input bbox. Its visible width is only 5px, so no PatternRect is
    // emitted. After an 8px pan the visible width is 8px and a pattern appears
    // inside the overlap. Source-only command eligibility cannot prove this.
    check_pan(
        &[rectangle(
            [56, 60, 57, 68],
            FillPattern::DenseDots,
            [255; 4],
        )],
        8.0,
        egui::vec2(-3.0, 0.0),
        egui::vec2(8.0, 0.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_supported_source_fill_can_need_target_mesh() {
    // The 15px source fill becomes a 1px clipped fill. ExactRaster rejects
    // that target command and the fresh renderer uses feathered tessellation.
    check_pan(
        &[rectangle([32, 112, 96, 127], FillPattern::Solid, [255; 4])],
        1.0,
        egui::Vec2::ZERO,
        egui::vec2(0.0, -15.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_recompose_failure_cannot_copy_unproven_source_pattern() {
    // The first record needs target mesh fallback; the second has a changed
    // clipped texture origin. Copying the old source after recompose returns
    // None cannot preserve the proof for either record.
    check_pan(
        &[
            rectangle([32, 112, 96, 127], FillPattern::Solid, [255; 4]),
            rectangle([0, 24, 96, 88], FillPattern::DenseDots, [255; 4]),
        ],
        1.0,
        egui::Vec2::ZERO,
        egui::vec2(-16.0, -15.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_mixed_pattern_and_point_matches_fresh_gl() {
    check_pan(
        &[
            rectangle([24, 24, 88, 88], FillPattern::Solid, [173, 61, 237, 112]),
            rectangle([16, 40, 104, 104], FillPattern::DenseDots, [255; 4]),
            point(112, 112),
        ],
        1.0,
        egui::Vec2::ZERO,
        egui::vec2(4.0, 3.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_mesh_repairs_preserve_translucent_draw_order() {
    check_pan(
        &[
            rectangle([24, 24, 96, 96], FillPattern::Solid, [173, 61, 237, 112]),
            point(64, 64),
            rectangle([32, 32, 88, 88], FillPattern::Solid, [37, 191, 83, 173]),
        ],
        1.0,
        egui::Vec2::ZERO,
        egui::vec2(-4.0, 3.0),
    );
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regression_fractional_camera_and_physical_pan_match_at_supported_dpi() {
    let inputs = [
        rectangle([24, 24, 88, 88], FillPattern::Solid, [173, 61, 237, 112]),
        rectangle(
            [16, 40, 104, 104],
            FillPattern::DenseDots,
            [201, 85, 33, 171],
        ),
        point(112, 112),
    ];
    for scale in [2.0, 4.0] {
        check_pan_at_scale(
            &inputs,
            1.0,
            egui::vec2(0.125, -0.375) / scale,
            egui::vec2(4.0, -3.0) / scale,
            scale,
        );
    }
}
