use super::*;
use crate::app::cpu_raster::test_support::Presentation;

fn assert_pixels(actual: &[u8], expected: &[u8]) {
    assert_eq!(actual.len(), expected.len());
    assert_eq!(
        actual
            .iter()
            .zip(expected)
            .position(|(actual, expected)| actual != expected),
        None
    );
}

fn renderer() -> Option<offscreen::OffscreenRenderer> {
    match offscreen::OffscreenRenderer::new("") {
        Ok(renderer) => Some(renderer),
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_INTERACTION_EGL").is_none(),
                "EGL interaction check required: {error}"
            );
            eprintln!("EGL interaction check unavailable: {error}");
            None
        }
    }
}

fn image(key: &SceneKey) -> Arc<[u8]> {
    let [width, height] = key.screen_size;
    let mut pixels = [0, 0, 0, 255].repeat(width as usize * height as usize);
    for screen_y in 160..180 {
        for screen_x in 200..220 {
            let offset = ((height as usize - 1 - screen_y) * width as usize + screen_x) * 4;
            pixels[offset..offset + 4].copy_from_slice(&[137, 71, 29, 255]);
        }
    }
    pixels.into()
}

#[test]
fn selection_keeps_complete_geometry_instead_of_replacing_it_with_a_partial_prefix() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    scene.bitmap = Some(image(&request.key));
    let scene = Arc::new(scene);
    let Some(renderer) = renderer() else { return };
    renderer.with_context(|gl| {
        let presentation = Presentation::new(Arc::clone(gl), &request.key, fixture.ctx.clone());
        let complete = presentation.paint(Some(&scene), &request.key, None);
        let mut selected = request.key.clone();
        selected.selected = Some(1);
        selected.highlighted.insert(2);
        let partial = Arc::new(progress::ProgressFrame {
            key: selected.clone(),
            generation: 2,
            sequence: 1,
            pixels: [0, 0, 0, 255].repeat(640 * 480).into(),
        });
        assert_pixels(
            &presentation.paint(None, &selected, Some(&partial)),
            &complete,
        );
        assert!(!presentation.cache.is_partial(&selected));
        assert!(!presentation.cache.is_preview(&selected));
        assert!(presentation.cache.scene_for(&selected).is_some());
    });
}

#[test]
fn selection_refresh_reuses_the_bitmap_through_the_actual_scene_coordinator() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    let pixels = image(&request.key);
    scene.bitmap = Some(Arc::clone(&pixels));
    let scene = Arc::new(scene);
    let mut cache = CpuSceneCache::default();
    cache.key = Some(request.key.clone());
    cache.ready = Some(Arc::clone(&scene));
    for selected in [Some(1), Some(2), None] {
        let mut request = fixture.request(1.0, 1.0);
        request.key.selected = selected;
        request.key.highlighted.insert(2);
        if let Some(shape_id) = selected {
            request.overlay_labels.insert(ShapeLabelCandidate {
                key: ShapeLabelKey::Owner {
                    owner_type: OwnerType::InstanceBBox as u8,
                    owner_id: shape_id,
                },
                anchor_rect: request.key.canvas,
                text: format!("selected-{shape_id}"),
                kind: ShapeLabelKind::Instance,
                rank_area: request.key.canvas.area(),
                selected: true,
                highlighted: false,
            });
        }
        let oracle = builder::build_with_workers(&request, &|| true, 1).unwrap();
        let expected = labels::LabelResolver::default()
            .resolve(&request, &oracle.labels.snapshot(), || true)
            .unwrap();
        assert_eq!(expected.labels.is_empty(), selected.is_none());
        let key = request.key.clone();
        let immediate = cache.get_or_request(request).unwrap();
        assert!(Arc::ptr_eq(immediate.bitmap.as_ref().unwrap(), &pixels));
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut request = fixture.request(1.0, 1.0);
            request.key = key.clone();
            if let Some(updated) = cache.get_or_request(request) {
                if updated.key == key && updated.labels_ready() {
                    assert!(Arc::ptr_eq(updated.bitmap.as_ref().unwrap(), &pixels));
                    assert_eq!(*updated.resolved_labels(), expected);
                    break;
                }
            }
            assert!(
                Instant::now() < deadline,
                "selection labels never completed"
            );
            thread::sleep(Duration::from_millis(1));
        }
    }
}

#[test]
fn selection_refresh_rejects_camera_style_and_cancelled_requests() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    let mut resolver = labels::LabelResolver::default();
    assert!(builder::refresh_labels(&request, &scene, &mut resolver, &|| false).is_none());
    let mut changed = fixture.request(2.0, 1.0);
    assert!(builder::refresh_labels(&changed, &scene, &mut resolver, &|| true).is_none());
    changed = fixture.request(1.0, 1.0);
    changed.key.layers += 1;
    assert!(builder::refresh_labels(&changed, &scene, &mut resolver, &|| true).is_none());
    changed.key = request.key.clone();
    changed.key.epoch += 1;
    assert!(builder::refresh_labels(&changed, &scene, &mut resolver, &|| true).is_none());
}

fn shifted(pixels: &[u8], size: [u32; 2], pan: [i32; 2]) -> Vec<u8> {
    let [width, height] = size.map(|side| side as i32);
    let mut expected = [0, 0, 0, 255].repeat(width as usize * height as usize);
    for source_y in 0..height {
        for source_x in 0..width {
            let target_x = source_x + pan[0];
            let target_y = source_y - pan[1];
            if (0..width).contains(&target_x) && (0..height).contains(&target_y) {
                let source = (source_y * width + source_x) as usize * 4;
                let target = (target_y * width + target_x) as usize * 4;
                expected[target..target + 4].copy_from_slice(&pixels[source..source + 4]);
            }
        }
    }
    expected
}

#[test]
fn pan_preserves_complete_overlap_and_fills_only_exposed_pixels_from_a_new_prefix() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    scene.bitmap = Some(image(&request.key));
    let scene = Arc::new(scene);
    let Some(renderer) = renderer() else { return };
    renderer.with_context(|gl| {
        let presentation = Presentation::new(Arc::clone(gl), &request.key, fixture.ctx.clone());
        presentation.paint(Some(&scene), &request.key, None);
        for (generation, [horizontal, vertical]) in
            [[37, 19], [-31, -17], [700, 0]].into_iter().enumerate()
        {
            let mut current = request.key.clone();
            current.pan = egui::vec2(horizontal as f32, vertical as f32);
            let prefix: Arc<[u8]> = [5, 103, 71, 255].repeat(640 * 480).into();
            let partial = Arc::new(progress::ProgressFrame {
                key: current.clone(),
                generation: generation as u64 + 2,
                sequence: 1,
                pixels: Arc::clone(&prefix),
            });
            let mut expected = shifted(
                scene.bitmap.as_ref().unwrap(),
                [640, 480],
                [horizontal, vertical],
            );
            let retained = current.destination(&request.key);
            for screen_y in 20..420 {
                for screen_x in 10..510 {
                    if !retained.contains(egui::pos2(screen_x as f32 + 0.5, screen_y as f32 + 0.5))
                    {
                        let offset = ((479 - screen_y) * 640 + screen_x) as usize * 4;
                        expected[offset..offset + 4].copy_from_slice(&prefix[offset..offset + 4]);
                    }
                }
            }
            assert_pixels(
                &presentation.paint(None, &current, Some(&partial)),
                &expected,
            );
            assert!(
                presentation.cache.is_preview(&current) || !retained.intersects(current.canvas)
            );
        }
    });
}

#[test]
fn presentation_zoom_discards_old_scale_instead_of_freezing_it() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    scene.bitmap = Some(image(&request.key));
    let scene = Arc::new(scene);
    let Some(renderer) = renderer() else { return };
    renderer.with_context(|gl| {
        let presentation = Presentation::new(Arc::clone(gl), &request.key, fixture.ctx.clone());
        assert_pixels(
            &presentation.paint(Some(&scene), &request.key, None),
            scene.bitmap.as_ref().unwrap(),
        );
        let current = fixture.request(2.6125715, 1.0).key;
        let pixels = presentation.paint(None, &current, None);
        assert_pixels(&pixels, &[0, 0, 0, 255].repeat(640 * 480));
        assert!(!presentation.cache.is_visible(&current));
        assert!(!presentation.cache.is_preview(&current));
        let mut next =
            builder::build_with_workers(&fixture.request(current.zoom, 1.0), &|| true, 1).unwrap();
        next.generation = 1;
        let mut pixels = image(&current).to_vec();
        for pixel in pixels.chunks_exact_mut(4) {
            if pixel[0] != 0 {
                pixel.copy_from_slice(&[31, 151, 83, 255]);
            }
        }
        next.bitmap = Some(pixels.into());
        let next = Arc::new(next);
        assert_pixels(
            &presentation.paint(Some(&next), &current, None),
            next.bitmap.as_ref().unwrap(),
        );
        assert!(presentation.cache.is_visible(&current));
        assert!(!presentation.cache.is_preview(&current));
        assert_pixels(
            &presentation.paint(None, &request.key, None),
            scene.bitmap.as_ref().unwrap(),
        );
    });
}

#[test]
fn presentation_keeps_partial_geometry_moving_across_consecutive_pans() {
    let fixture = Fixture::new();
    let source = fixture.request(2.6125715, 1.0).key;
    let progress = Arc::new(progress::ProgressFrame {
        key: source.clone(),
        generation: 4,
        sequence: 1,
        pixels: image(&source),
    });
    let Some(renderer) = renderer() else { return };
    renderer.with_context(|gl| {
        let presentation = Presentation::new(Arc::clone(gl), &source, fixture.ctx.clone());
        assert_pixels(
            &presentation.paint(None, &source, Some(&progress)),
            &progress.pixels,
        );
        for pan in [[37, -19], [74, 26], [-21, 11]] {
            let mut current = source.clone();
            current.pan = egui::vec2(pan[0] as f32, pan[1] as f32);
            assert_pixels(
                &presentation.paint(None, &current, None),
                &shifted(&progress.pixels, source.screen_size, pan),
            );
            assert!(presentation.cache.is_visible(&current));
            assert!(presentation.cache.is_preview(&current));
            assert!(!presentation.cache.is_partial(&current));
        }
    });
}

#[test]
fn presentation_adopts_current_progress_and_rejects_late_camera_results() {
    let fixture = Fixture::new();
    let source = fixture.request(2.6125715, 1.0).key;
    let previous = Arc::new(progress::ProgressFrame {
        key: source.clone(),
        generation: 4,
        sequence: 1,
        pixels: image(&source),
    });
    let Some(renderer) = renderer() else { return };
    renderer.with_context(|gl| {
        let presentation = Presentation::new(Arc::clone(gl), &source, fixture.ctx.clone());
        presentation.paint(None, &source, Some(&previous));
        let mut current = source.clone();
        current.pan = egui::vec2(37.0, -19.0);
        let progress = Arc::new(progress::ProgressFrame {
            key: current.clone(),
            generation: 5,
            sequence: 2,
            pixels: shifted(&previous.pixels, source.screen_size, [37, -19]).into(),
        });
        assert_pixels(
            &presentation.paint(None, &current, Some(&progress)),
            &progress.pixels,
        );
        assert!(presentation.cache.is_partial(&current));
        assert!(!presentation.cache.is_preview(&current));
        current.pan += egui::vec2(17.0, 23.0);
        assert_pixels(
            &presentation.paint(None, &current, Some(&previous)),
            &shifted(&progress.pixels, source.screen_size, [17, 23]),
        );
        assert!(presentation.cache.is_preview(&current));
        for changed in [
            fixture.request(1.0, 1.0).key,
            SceneKey {
                epoch: source.epoch + 1,
                ..source.clone()
            },
        ] {
            assert_pixels(
                &presentation.paint(None, &changed, Some(&previous)),
                &[0, 0, 0, 255].repeat(640 * 480),
            );
            assert!(!presentation.cache.is_visible(&changed));
        }
    });
}

#[test]
fn presentation_resizes_retained_partial_storage_before_current_upload() {
    let fixture = Fixture::new();
    let source = fixture.request(1.0, 1.0).key;
    let previous = Arc::new(progress::ProgressFrame {
        key: source.clone(),
        generation: 4,
        sequence: 1,
        pixels: image(&source),
    });
    let Some(renderer) = renderer() else { return };
    renderer.with_context(|gl| {
        let mut presentation = Presentation::new(Arc::clone(gl), &source, fixture.ctx.clone());
        presentation.paint(None, &source, Some(&previous));
        let mut current = source.clone();
        current.screen_size = [800, 480];
        assert!(current.same_raster_scale(&source));
        presentation.resize(&current);
        let progress = Arc::new(progress::ProgressFrame {
            key: current.clone(),
            generation: 5,
            sequence: 2,
            pixels: image(&current),
        });
        assert_pixels(
            &presentation.paint(None, &current, Some(&progress)),
            &progress.pixels,
        );
        assert!(presentation.cache.is_partial(&current));
    });
}
