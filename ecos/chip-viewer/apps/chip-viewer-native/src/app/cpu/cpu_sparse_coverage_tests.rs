use super::*;

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn sparse_partial_clears_every_unrepaired_tile_and_keeps_only_current_pixels() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.key.screen_size = [256, 256];
        request.key.canvas =
            egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(256.0, 256.0) / scale);
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        let commands = [
            PaintCommand::FillRect {
                rect: egui::Rect::from_min_max(egui::pos2(3.0, 7.0), egui::pos2(250.0, 249.0))
                    / scale,
                rgba: [71, 129, 239, 173],
            },
            PaintCommand::Disc {
                center: egui::pos2(70.25, 90.5) / scale,
                radius: 7.25 / scale,
                rgba: [173, 41, 117, 191],
            },
            PaintCommand::FillRect {
                rect: egui::Rect::from_min_max(egui::pos2(32.0, 64.0), egui::pos2(160.0, 128.0))
                    / scale,
                rgba: [113, 237, 47, 191],
            },
        ];
        let kernel = sparse_rects::SparseRects::prepare(&commands, &request).unwrap();
        let pixels = kernel.render(request.key.background);
        let mut in_place = pixels.clone();
        let allocation = in_place.as_ptr();
        kernel
            .prepare_partial(&mut in_place, request.key.background, &|| true)
            .unwrap();
        assert_eq!(in_place.as_ptr(), allocation);
        let partial = kernel
            .partial_pixels(&pixels, request.key.background, &|| true)
            .unwrap();
        let reference = meshes(
            &fixture,
            &request,
            &commands,
            geometry::GeometryOutput::ExactRaster,
        );
        let mut expected = super::pixels(&mut renderer, &request, reference);
        kernel.merge(&mut expected, &kernel.blank(request.key.background));
        assert_eq!(partial, expected, "DPR {scale}");
        assert_eq!(in_place, expected);
        assert!(partial
            .chunks_exact(4)
            .any(|pixel| pixel != request.key.background.to_array()));
        assert!(kernel
            .partial_pixels(&pixels, request.key.background, &|| false)
            .is_none());
        let empty = sparse_rects::SparseRects::new(&request).unwrap();
        assert!(empty
            .partial_pixels(
                &empty.blank(request.key.background),
                request.key.background,
                &|| true
            )
            .is_none());
    }
}

#[test]
fn fully_clipped_outline_meshes_do_not_trigger_density_fallback() {
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [1024, 768];
    request.key.canvas = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1024.0, 768.0));
    let mut commands = vec![
        PaintCommand::FillRect {
            rect: egui::Rect::from_min_max(egui::pos2(30.0, 40.0), egui::pos2(60.0, 70.0)),
            rgba: [71, 129, 239, 173],
        };
        256
    ];
    commands.extend(std::iter::repeat_n(
        PaintCommand::FrameRect {
            rect: egui::Rect::from_min_max(
                egui::pos2(-20000.0, -20000.0),
                egui::pos2(20000.0, 20000.0),
            ),
            width: 1.25,
            rgba: [117, 93, 241, 112],
        },
        16,
    ));
    let prepared = sparse_rects::SparseRects::prepare(&commands, &request).unwrap();
    assert!(!prepared.has_holes());
    assert_eq!(prepared.len(), 256);
    assert!(!prepared.prefers_meshes());
}

#[test]
fn large_outline_repairs_its_edges_without_abandoning_sparse_rendering() {
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.key.screen_size = [1024, 768];
    request.key.canvas = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1024.0, 768.0));
    let commands = [PaintCommand::FrameRect {
        rect: egui::Rect::from_min_max(egui::pos2(67.25, 70.5), egui::pos2(950.75, 698.25)),
        width: 1.25,
        rgba: [117, 93, 241, 112],
    }];
    let prepared = sparse_rects::SparseRects::prepare(&commands, &request).unwrap();
    assert!(prepared.has_holes());
    // The 1024x768 target has 128x96 damage tiles at eight pixels per tile.
    assert!(prepared.repair_tiles() < 128 * 96 / 4);
    assert!(!prepared.prefers_meshes());
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn triangle_repair_matches_full_gl_with_clipping_order_alpha_and_pixel_scales() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.key.screen_size = [1024, 768];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(7.25, 9.5) / scale,
            egui::pos2(1017.5, 759.25) / scale,
        );
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        let mut commands = vec![PaintCommand::FillRect {
            rect: egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1024.0, 768.0)) / scale,
            rgba: [71, 129, 239, 173],
        }];
        for (index, width) in [0.25, 1.25, 2.5, 7.75].into_iter().enumerate() {
            let inset = index as f32 * 10.75;
            commands.push(PaintCommand::FrameRect {
                rect: egui::Rect::from_min_max(
                    egui::pos2(inset - 9.25, inset + 70.5),
                    egui::pos2(950.75 - inset, 800.25 - inset),
                ) / scale,
                width: width / scale,
                rgba: [117, 93, 241, 112],
            });
            commands.push(PaintCommand::FillRect {
                rect: egui::Rect::from_min_max(
                    egui::pos2(32.0, 64.0 + index as f32 * 16.0),
                    egui::pos2(992.0, 128.0 + index as f32 * 16.0),
                ) / scale,
                rgba: [113, 237, 47, 191],
            });
            let prepared = sparse_rects::SparseRects::prepare(&commands, &request).unwrap();
            let mut actual = prepared.render(request.key.background);
            let mut repair_meshes = Vec::new();
            let mut batches = 0;
            assert!(
                prepared.stream_repairs(request.key.canvas, &|| true, 256, |meshes| {
                    batches += 1;
                    repair_meshes.extend(meshes);
                    true
                })
            );
            assert!(
                batches > 1,
                "repair oracle must cross bounded submission batches"
            );
            assert!(
                !prepared.stream_repairs(request.key.canvas, &|| false, 256, |_| {
                    panic!("cancelled repair submitted obsolete geometry")
                })
            );
            assert!(!prepared.stream_repairs(request.key.canvas, &|| true, 256, |_| false));
            let repair = pixels(&mut renderer, &request, repair_meshes);
            prepared.merge(&mut actual, &repair);
            let reference = meshes(
                &fixture,
                &request,
                &commands,
                geometry::GeometryOutput::ExactRaster,
            );
            assert_eq!(
                actual,
                pixels(&mut renderer, &request, reference),
                "scale {scale}, prefix {}",
                commands.len()
            );
        }
    }
}
