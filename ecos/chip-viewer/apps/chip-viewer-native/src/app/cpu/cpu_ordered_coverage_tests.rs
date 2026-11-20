use super::*;
use ordered_coverage::{OrderedCoverage, Unsupported};

fn commands() -> Vec<PaintCommand> {
    let mut commands = Vec::new();
    for (bounds, rgba) in [
        ([-12, -8, 247, 254], [173, 61, 237, 31]),
        ([7, 11, 118, 121], [37, 191, 83, 97]),
        ([17, 23, 20, 26], [173, 61, 237, 112]),
        ([17, 23, 21, 27], [73, 191, 83, 173]),
        ([21, 23, 25, 27], [173, 61, 237, 254]),
        ([0, 0, 256, 256], [37, 191, 83, 0]),
        ([15, 19, 255, 257], [37, 191, 83, 255]),
        ([254, 3, 291, 130], [173, 61, 237, 173]),
        ([-129, 24, 9, 135], [73, 191, 83, 128]),
        ([16380, 16380, 16384, 16384], [173, 61, 237, 112]),
    ] {
        let [left, top, right, bottom] = bounds.map(|value| value as f32);
        let rect = egui::Rect::from_min_max(egui::pos2(left, top), egui::pos2(right, bottom));
        commands.push(PaintCommand::FillRect { rect, rgba });
        commands.push(PaintCommand::FrameRect {
            rect,
            rgba,
            width: 1.0,
        });
    }
    commands.extend([commands[2], commands[3], commands[2], commands[3]]);
    commands
}

fn shifted(command: PaintCommand, delta: egui::Vec2) -> PaintCommand {
    match command {
        PaintCommand::FillRect { rect, rgba } => PaintCommand::FillRect {
            rect: rect.translate(delta),
            rgba,
        },
        PaintCommand::FrameRect { rect, rgba, width } => PaintCommand::FrameRect {
            rect: rect.translate(delta),
            rgba,
            width,
        },
        _ => unreachable!(),
    }
}

#[test]
fn coverage_ordered_spans_match_every_gl_prefix_with_clipping_and_translucency() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [256, 256];
    let commands = commands();
    for (clip, background) in [
        ([0, 0, 256, 256], egui::Color32::BLACK),
        (
            [7, 11, 118, 121],
            egui::Color32::from_rgba_premultiplied(13, 29, 51, 83),
        ),
        ([3, 5, 250, 252], egui::Color32::TRANSPARENT),
    ] {
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(clip[0] as f32, clip[1] as f32),
            egui::pos2(clip[2] as f32, clip[3] as f32),
        );
        request.key.background = background;
        for prefix in 0..=commands.len() {
            let commands = &commands[..prefix];
            let coverage =
                OrderedCoverage::try_commands(commands, 1.0, request.key.tessellation).unwrap();
            let candidate = coverage
                .render(request.key.screen_size, clip, background.to_array())
                .unwrap();
            let incumbent = meshes(
                &fixture,
                &request,
                commands,
                geometry::GeometryOutput::ExactRaster,
            );
            let actual = pixels(&mut renderer, &request, incumbent);
            assert_eq!(
                candidate, actual,
                "ordered span prefix {prefix}, clip={clip:?}"
            );
            let reference = meshes(
                &fixture,
                &request,
                commands,
                geometry::GeometryOutput::Reference,
            );
            let reference = pixels(&mut renderer, &request, reference);
            assert_eq!(
                actual, reference,
                "inherited adapter difference at prefix {prefix}"
            );
        }
    }
}

#[test]
fn coverage_rejects_uncertified_inputs_instead_of_silently_snapping() {
    let options = egui::epaint::TessellationOptions::default();
    let valid = commands()[0];
    for scale in [0.0, 1.25, 1.5, 2.0, 4.0, f32::NAN] {
        assert_eq!(
            OrderedCoverage::try_commands(&[valid], scale, options).unwrap_err(),
            Unsupported::Dpi
        );
    }
    for offset in [0.125, 0.49, 0.5, 0.75, f32::INFINITY, f32::NAN, 17000.0] {
        let invalid = shifted(valid, egui::vec2(offset, 0.0));
        assert_eq!(
            OrderedCoverage::try_commands(&[valid, invalid, valid], 1.0, options).unwrap_err(),
            Unsupported::Coordinates
        );
    }
    let rect = egui::Rect::from_min_size(egui::pos2(12.0, 14.0), egui::vec2(20.0, 18.0));
    for command in [
        PaintCommand::Line {
            points: [rect.min, rect.max],
            width: 1.0,
            rgba: [128; 4],
        },
        PaintCommand::Disc {
            center: rect.center(),
            radius: 2.0,
            rgba: [128; 4],
        },
    ] {
        assert_eq!(
            OrderedCoverage::try_commands(&[valid, command], 1.0, options).unwrap_err(),
            Unsupported::Command
        );
    }
    for width in [0.0, 0.5, 2.0, 3.0, f32::NAN] {
        let command = PaintCommand::FrameRect {
            rect,
            width,
            rgba: [128; 4],
        };
        assert_eq!(
            OrderedCoverage::try_commands(&[command], 1.0, options).unwrap_err(),
            Unsupported::Stroke
        );
    }
    for size in [0.0, 1.0, 2.0] {
        let command = PaintCommand::FillRect {
            rect: egui::Rect::from_min_size(rect.min, egui::vec2(size, size)),
            rgba: [128; 4],
        };
        assert_eq!(
            OrderedCoverage::try_commands(&[command], 1.0, options).unwrap_err(),
            Unsupported::Dimensions
        );
    }
    for modified in [
        egui::epaint::TessellationOptions {
            feathering: false,
            ..options
        },
        egui::epaint::TessellationOptions {
            round_rects_to_pixels: false,
            ..options
        },
        egui::epaint::TessellationOptions {
            debug_ignore_clip_rects: true,
            ..options
        },
    ] {
        assert_eq!(
            OrderedCoverage::try_commands(&[valid], 1.0, modified).unwrap_err(),
            Unsupported::Tessellation
        );
    }
}

#[test]
fn coverage_integer_shift_matches_fresh_camera_and_only_certifies_visible_overlap() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [256, 256];
    request.key.canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(256.0, 256.0));
    request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
    let commands: Vec<_> = commands()
        .into_iter()
        .filter(|command| match command {
            PaintCommand::FillRect { rect, .. } | PaintCommand::FrameRect { rect, .. } => {
                rect.right() < 16000.0
            }
            _ => false,
        })
        .collect();
    for prefix in 1..=commands.len() {
        let commands = &commands[..prefix];
        let coverage =
            OrderedCoverage::try_commands(commands, 1.0, request.key.tessellation).unwrap();
        assert!(coverage.shifted([i32::MIN, 0]).is_none());
        assert!(coverage
            .render([0, 256], [0, 0, 256, 256], [0; 4])
            .is_none());
        let original = coverage
            .render(
                [256, 256],
                [0, 0, 256, 256],
                request.key.background.to_array(),
            )
            .unwrap();
        for delta in [[1, 0], [0, 1], [128, 0], [-1, 0], [0, -1]] {
            let moved = coverage.shifted(delta).unwrap();
            let candidate = moved
                .render(
                    [256, 256],
                    [0, 0, 256, 256],
                    request.key.background.to_array(),
                )
                .unwrap();
            let fresh: Vec<_> = commands
                .iter()
                .map(|&command| shifted(command, egui::vec2(delta[0] as f32, delta[1] as f32)))
                .collect();
            let reference = meshes(
                &fixture,
                &request,
                &fresh,
                geometry::GeometryOutput::ExactRaster,
            );
            let reference = pixels(&mut renderer, &request, reference);
            assert_eq!(candidate, reference, "shift {delta:?}, prefix {prefix}");
            for row in delta[1].max(0)..(256 + delta[1]).min(256) {
                for column in delta[0].max(0)..(256 + delta[0]).min(256) {
                    let sample = |image: &[u8], column, row| {
                        let offset = ((255 - row) * 256 + column) as usize * 4;
                        <[u8; 4]>::try_from(&image[offset..offset + 4]).unwrap()
                    };
                    assert_eq!(
                        sample(&candidate, column, row),
                        sample(&original, column - delta[0], row - delta[1])
                    );
                }
            }
        }
    }
}
