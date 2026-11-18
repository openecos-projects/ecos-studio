use super::*;

#[test]
fn initial_progress_equal_primitive_counts_still_present_a_new_refinement() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mailbox = progress::ProgressMailbox::default();
    let first = mailbox.publish_initial(progress::ProgressFrame::new(
        request.key.clone(),
        7,
        64,
        [137, 71, 29, 255].repeat(640 * 480),
    ));
    let second = mailbox.publish_initial(progress::ProgressFrame::new(
        request.key.clone(),
        7,
        64,
        [31, 151, 83, 255].repeat(640 * 480),
    ));
    let renderer = renderer();
    renderer.with_context(|gl| {
        let presentation = crate::app::cpu_raster::test_support::Presentation::new(
            Arc::clone(gl),
            &request.key,
            fixture.ctx.clone(),
        );
        let first_pixels = presentation.paint(None, &request.key, Some(&first));
        let second_pixels = presentation.paint(None, &request.key, Some(&second));
        let offset = ((479 - 100) * 640 + 100) * 4;
        assert_eq!(&first_pixels[offset..offset + 4], &[137, 71, 29, 255]);
        assert_eq!(&second_pixels[offset..offset + 4], &[31, 151, 83, 255]);
        assert_ne!(first.sequence, second.sequence);
    });
}
#[test]
fn initial_progress_ui_first_callback_draws_current_geometry_without_worker_or_readback() {
    let renderer = renderer();
    let fixture = Fixture::new();
    let mut request = layered_request(&fixture, 8);
    request.glow = true;
    let key = request.key.clone();
    let expected_seeds = builder::build_ui_initial_scene(&request).unwrap();
    assert!(expected_seeds.drawn > 0);
    renderer.with_context(|gl| {
        let presentation = crate::app::cpu_raster::test_support::Presentation::new(
            Arc::clone(gl),
            &key,
            fixture.ctx.clone(),
        );
        let mut cache = CpuSceneCache::default();
        cache.inbox.stopped.store(true, Ordering::Relaxed);
        cache.inbox.wake.notify_one();
        cache.raster = Arc::clone(&presentation.cache);
        let ready = cache.get_or_request(request);
        assert!(ready.is_none());
        assert!(
            cache
                .progress
                .current(&key, cache.inbox.generation.load(Ordering::Relaxed))
                .is_none(),
            "test must have no worker bitmap"
        );
        let actual = presentation.paint_queued(
            |painter| cache.paint_glow(None, painter, key.background),
            || {},
        );
        for color in [[237, 61, 47, 255], [41, 211, 117, 255]] {
            assert!(
                actual.chunks_exact(4).any(|pixel| pixel == color),
                "first callback is missing a visible layer: {color:?}"
            );
        }
        assert!(cache.raster.is_partial(&key));
        assert!(!cache.raster.is_preview(&key));
        assert!(
            cache.raster.scene_for(&key).is_none(),
            "UI seeds must never enter complete history"
        );
        // A compatible but different camera cannot display the prior seed.
        let mut next = fixture.request(2.0, 1.0);
        next.key = key.clone();
        next.key.zoom = 2.0;
        next.key.epoch += 1;
        next.glow = true;
        next.db = Arc::clone(&fixture.db);
        let next_key = next.key.clone();
        let _ = cache.get_or_request(next);
        assert!(
            !cache.raster.is_partial(&next_key),
            "old generation must not count as current partial before callback"
        );
    });
}
#[test]
fn initial_progress_pending_selection_keeps_rich_equivalent_geometry() {
    let mut renderer = renderer();
    let fixture = Fixture::new();
    let request = layered_request(&fixture, 8);
    let seeds = builder::build_initial_scene(&request, &|| true).unwrap();
    let (rich, _) = renderer
        .rasterize_initial_seeds(&seeds, &request, || true)
        .unwrap()
        .unwrap();
    let progress = Arc::new(progress::ProgressFrame::new(
        request.key.clone(),
        4,
        32_768,
        rich.clone(),
    ));
    let mut next = request.key.clone();
    next.selected = Some(1);
    next.highlighted.insert(2);
    assert!(next.same_geometry(&request.key));
    let mut sparse = builder::build_ui_initial_scene(&request).unwrap();
    sparse.key = next.clone();
    sparse.generation = 5;
    sparse.meshes.truncate(1);
    let sparse = Arc::new(sparse);
    renderer.with_context(|gl| {
        let presentation = crate::app::cpu_raster::test_support::Presentation::new(
            Arc::clone(gl),
            &request.key,
            fixture.ctx.clone(),
        );
        assert_eq!(
            presentation.paint(None, &request.key, Some(&progress)),
            rich
        );
        let mailbox = Arc::new(progress::ProgressMailbox::default());
        let actual = presentation.paint_queued(
            |painter| {
                presentation.cache.paint_with_initial(
                    None,
                    Some(&sparse),
                    &next,
                    Arc::clone(&mailbox),
                    5,
                    painter,
                    next.background,
                );
            },
            || {},
        );
        assert_eq!(
            actual, rich,
            "selection refresh must not replace rich geometry with a smaller seed"
        );
        assert!(presentation.cache.is_partial(&next));
        assert!(!presentation.cache.is_preview(&next));
        assert!(presentation.cache.scene_for(&next).is_none());
    });
}
#[test]
fn initial_progress_incompatible_anchor_cleanup_preserves_the_new_first_seed() {
    let mut renderer = renderer();
    let fixture = Fixture::new();
    let mut request = layered_request(&fixture, 8);
    let mut completed = builder::build_initial_scene(&request, &|| true).unwrap();
    completed.bitmap = Some(
        renderer
            .rasterize_initial_seeds(&completed, &request, || true)
            .unwrap()
            .unwrap()
            .0
            .into(),
    );
    let completed = Arc::new(completed);
    request.key.epoch += 1;
    request.key.background = egui::Color32::from_rgb(13, 29, 51);
    let mut seeds = builder::build_ui_initial_scene(&request).unwrap();
    seeds.generation = 7;
    let seeds = Arc::new(seeds);
    renderer.with_context(|gl| {
        let presentation = crate::app::cpu_raster::test_support::Presentation::new(
            Arc::clone(gl),
            completed.key(),
            fixture.ctx.clone(),
        );
        presentation.paint(Some(&completed), completed.key(), None);
        let mailbox = Arc::new(progress::ProgressMailbox::default());
        let actual = presentation.paint_queued(
            |painter| {
                presentation.cache.paint_with_initial(
                    None,
                    Some(&seeds),
                    &request.key,
                    Arc::clone(&mailbox),
                    7,
                    painter,
                    request.key.background,
                );
            },
            || {},
        );
        assert!(
            actual
                .chunks_exact(4)
                .any(|pixel| pixel == [237, 61, 47, 255]),
            "cleanup must happen before drawing new seed"
        );
        assert!(presentation.cache.is_partial(&request.key));
        assert!(presentation.cache.scene_for(&request.key).is_none());
    });
}
