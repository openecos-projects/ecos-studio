use super::*;

#[test]
fn sparse_rectangles_preserve_full_rgba_with_ordered_gl_repair() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.key.screen_size = [256, 256];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(7.25, 11.5) / scale,
            egui::pos2(249.5, 253.25) / scale,
        );
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        let mut commands = Vec::new();
        for index in 0..140 {
            let rect = egui::Rect::from_min_size(
                egui::pos2(
                    (index % 11) as f32 * 17.0 - 7.125,
                    (index / 11) as f32 * 16.0 - 9.49,
                ) / scale,
                egui::vec2(
                    [2.0, 3.0, 4.0, 19.0, 100.0][index % 5],
                    [2.0, 4.0, 19.0, 130.0][index % 4],
                ) / scale,
            );
            let rgba = [173, 61, 237, [0, 31, 112, 173, 255][index % 5]];
            commands.push(PaintCommand::FillRect { rect, rgba });
            commands.push(PaintCommand::FrameRect {
                rect,
                rgba: [37, 191, 83, 112],
                width: 1.0 / scale,
            });
            if index % 13 == 0 {
                commands.push(PaintCommand::Disc {
                    center: rect.center(),
                    radius: 2.25 / scale,
                    rgba,
                });
                commands.push(PaintCommand::Line {
                    points: [rect.min, rect.max],
                    width: 1.25 / scale,
                    rgba,
                });
            }
        }
        for prefix in [0, 1, 4, 17, 101, commands.len()] {
            let commands = &commands[..prefix];
            let prepared = sparse_rects::SparseRects::prepare(commands, &request).unwrap();
            let mut candidate = prepared.render(request.key.background);
            let repair = prepared.residual_meshes(request.key.canvas);
            let repair = pixels(&mut renderer, &request, repair);
            prepared.merge(&mut candidate, &repair);
            let reference = meshes(
                &fixture,
                &request,
                commands,
                geometry::GeometryOutput::ExactRaster,
            );
            let reference = pixels(&mut renderer, &request, reference);
            let changed = candidate
                .iter()
                .zip(&reference)
                .filter(|(left, right)| left != right)
                .count();
            assert_eq!(changed, 0, "DPR {scale}, prefix {prefix}");
        }
    }
}

#[test]
fn sparse_stream_preserves_each_command_prefix_labels_overlays_and_cancellation() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let mut fixture = Fixture::new();
    fs::write(
        fixture.path.join("geometry.grids.txt"),
        "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\ntrack\t0\tx\t0\t20\t51\t1\t\ngcell\t1\ty\t0\t100\t11\t2\t\n",
    ).unwrap();
    fixture.db = Arc::new(ChipViewDb::open(fixture.path.join("geometry.manifest")).unwrap());
    for (zoom, scale) in [(1.0, 1.0), (2.612572, 2.0), (16.0, 4.0)] {
        let mut request = fixture.request(zoom, scale);
        request.key.cache_overlays = true;
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        request.key.pan = egui::vec2(-0.25, 0.375);
        let mut prefix_meshes = Vec::new();
        let mut prefixes = Vec::new();
        let mut sequence = 0;
        let expected = builder::build_command_stream(&request, &|| true, |packet| {
            match packet {
                builder::PaintPacket::Commands(commands) => {
                    sequence += commands.len();
                    prefix_meshes.extend(meshes(
                        &fixture,
                        &request,
                        &commands,
                        geometry::GeometryOutput::ExactRaster,
                    ));
                }
                builder::PaintPacket::Overlays(meshes) => {
                    sequence += meshes.len();
                    prefix_meshes.extend(meshes);
                }
            }
            if sequence > 0 {
                prefixes.push((
                    sequence,
                    pixels(&mut renderer, &request, prefix_meshes.clone()),
                ));
            }
            true
        })
        .unwrap();
        if zoom > 1.25 {
            assert!(expected.overlay_drawn > 0);
        }
        let mut updates = Vec::new();
        let actual = renderer
            .build_sparse_updates(
                &request,
                || true,
                |pixels, sequence| updates.push((sequence, pixels)),
            )
            .unwrap()
            .unwrap();
        assert_eq!(updates.len(), prefixes.len());
        for ((actual_sequence, actual), (expected_sequence, expected)) in
            updates.iter().zip(&prefixes)
        {
            assert_eq!(actual_sequence, expected_sequence);
            assert_eq!(
                actual
                    .iter()
                    .zip(expected)
                    .filter(|(left, right)| left != right)
                    .count(),
                0,
                "zoom {zoom}, DPR {scale}, prefix {actual_sequence}"
            );
        }
        let complete = actual.bitmap.as_deref().unwrap();
        let expected_pixels = &prefixes.last().unwrap().1;
        assert_eq!(complete.len(), expected_pixels.len());
        assert_eq!(
            complete
                .iter()
                .zip(expected_pixels)
                .filter(|(left, right)| left != right)
                .count(),
            0
        );
        assert_eq!(
            (actual.drawn, actual.primitives, actual.overlay_drawn),
            (expected.drawn, expected.primitives, expected.overlay_drawn)
        );
        assert_eq!(
            actual
                .labels
                .snapshot()
                .resolve(request.key.canvas, |_, _| egui::vec2(3.0, 3.0)),
            expected
                .labels
                .snapshot()
                .resolve(request.key.canvas, |_, _| egui::vec2(3.0, 3.0))
        );
        let current = AtomicBool::new(true);
        assert!(renderer
            .build_sparse_updates(
                &request,
                || current.load(Ordering::Relaxed),
                |_, _| current.store(false, Ordering::Relaxed),
            )
            .unwrap()
            .is_none());
    }
}

#[test]
fn sparse_incremental_repair_and_mesh_replay_preserve_order_and_clips() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut kernel = sparse_rects::SparseRects::new(&request).unwrap();
    let mut bitmap = kernel.blank(request.key.background);
    let mut reference = Vec::new();
    for step in 0..6 {
        let commands = [
            PaintCommand::FillRect {
                rect: request.key.canvas,
                rgba: [191, 29, 83, 112],
            },
            PaintCommand::Disc {
                center: egui::pos2(31.25 + step as f32 * 32.0, 64.5),
                radius: 3.25,
                rgba: [31, 191, 83, 173],
            },
        ];
        let start = kernel.append(&commands, &request, &|| true).unwrap();
        let mut overlay = meshes(
            &fixture,
            &request,
            &[PaintCommand::Line {
                points: [egui::pos2(15.25, 35.5), egui::pos2(240.0, 300.25)],
                width: 2.25,
                rgba: [93, 151, 239, 112],
            }],
            geometry::GeometryOutput::ExactRaster,
        );
        for primitive in &mut overlay {
            primitive.clip_rect =
                egui::Rect::from_min_max(egui::pos2(29.25, 45.5), egui::pos2(140.75, 100.25));
        }
        reference.extend(meshes(
            &fixture,
            &request,
            &commands,
            geometry::GeometryOutput::ExactRaster,
        ));
        reference.extend(overlay.clone());
        kernel.append_meshes(overlay);
        assert!(kernel.render_since(start, &mut bitmap, &|| true));
        let repair = pixels(
            &mut renderer,
            &request,
            kernel.residual_meshes(request.key.canvas),
        );
        kernel.merge(&mut bitmap, &repair);
        let expected = pixels(&mut renderer, &request, reference.clone());
        assert_eq!(
            bitmap
                .iter()
                .zip(expected)
                .filter(|(left, right)| **left != *right)
                .count(),
            0
        );
    }
    let mut replay = Vec::new();
    assert!(kernel.drain_meshes(request.key.canvas, |meshes| {
        replay.extend(meshes);
        true
    }));
    let expected = pixels(&mut renderer, &request, reference);
    let replay = pixels(&mut renderer, &request, replay);
    assert_eq!(
        replay
            .iter()
            .zip(expected)
            .filter(|(left, right)| **left != *right)
            .count(),
        0
    );
    assert_eq!(kernel.len(), 0);
    assert!(kernel.append(&[], &request, &|| false).is_none());
    assert!(!kernel.render_since(0, &mut bitmap, &|| false));
}
