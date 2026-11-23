use super::*;

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_expired_budget_keeps_first_chunk_of_every_layer_in_exact_order() {
    use chip_render::geometry2d::GeometryPass;
    let fixture = Fixture::new();
    let request = layered_request_with_spread(&fixture, 1024, true);
    let partial = builder::build_initial_scene_with_budget(&request, &|| true, &|| false)
        .expect("time budget must not erase already prepared layer chunks");
    let ui = builder::build_ui_initial_scene(&request).unwrap();
    assert!(
        partial.covers_initial_records(&ui),
        "expired refinement must preserve dispersed UI seeds"
    );
    for layer in [1, 2] {
        assert!(
            ui.initial_records.as_ref().unwrap().iter().any(|&id| {
                let shape = request.db.find_shape(id).unwrap();
                shape.layer_id == layer && shape.bbox.ly >= i32::from(layer) * 40 + 16
            }),
            "layer {layer} must have a spatially dispersed UI sample beyond the low-ID first block"
        );
    }
    let mut expected_count = 0;
    let pass = GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    let mut expected = geometry::GeometryMeshSink::for_raster_with_patterns(
        request.tessellator.clone(),
        request.key.canvas,
        request.key.tessellation,
        request.key.pixels_per_point,
        Arc::clone(&request.pattern_textures),
    );
    for &layer in &request.layer_ids {
        let ids = request
            .db
            .query_layers_intersect(&[layer], request.key.viewport);
        let mut required = ids.into_iter().take(32).collect::<BTreeSet<_>>();
        for &id in ui.initial_records.as_ref().unwrap().iter() {
            if request.db.find_shape(id).unwrap().layer_id == layer {
                required.insert(id);
            }
        }
        expected_count += required.len();
        for id in required {
            let shape = request.db.find_shape(id).unwrap();
            let owner = request.db.owner_for_shape(shape);
            let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            let style =
                visible_style_for_shape_fast(shape, owner, owner_type, &request.layers).unwrap();
            pass.draw(request.db.shape_geometry(shape), &style, &mut expected);
        }
    }
    assert_eq!(
        partial.drawn, expected_count,
        "UI tails must be appended once, in layer/shape order"
    );
    let flatten = |meshes: &[egui::ClippedPrimitive]| {
        meshes
            .iter()
            .flat_map(|primitive| {
                let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                    unreachable!()
                };
                mesh.indices
                    .iter()
                    .map(|index| {
                        (
                            primitive.clip_rect,
                            mesh.texture_id,
                            mesh.vertices[*index as usize],
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        flatten(&partial.meshes),
        flatten(&expected.finish()),
        "round-robin preparation must emit exact layer/shape order, colors and UVs"
    );
    let mut renderer = renderer();
    let (pixels, _) = renderer
        .rasterize_initial_seeds(&partial, &request, || true)
        .unwrap()
        .unwrap();
    let (ui_pixels, _) = renderer
        .rasterize_initial_seeds(&ui, &request, || true)
        .unwrap()
        .unwrap();
    for (before, after) in ui_pixels.chunks_exact(4).zip(pixels.chunks_exact(4)) {
        if before == [237, 61, 47, 255] || before == [41, 211, 117, 255] {
            assert_eq!(
                after, before,
                "expired refinement erased spatially dispersed colored UI geometry"
            );
        }
    }
    for color in [[237, 61, 47, 255], [41, 211, 117, 255]] {
        assert!(
            pixels.chunks_exact(4).any(|pixel| pixel == color),
            "deadline starved visible layer {color:?}"
        );
    }
    let cancelled = AtomicBool::new(false);
    assert!(builder::build_initial_scene_with_budget(&request, &|| !cancelled.load(Ordering::Relaxed), &|| {
        cancelled.store(true, Ordering::Relaxed); false
    }).is_none(), "generation cancellation must discard partial geometry even after every layer prepared a chunk");
}

#[test]
fn initial_progress_ui_geometry_stays_within_256_candidate_quota() {
    let fixture = Fixture::new();
    let request = layered_request_with_spread(&fixture, 1024, true);
    let ui = builder::build_ui_initial_scene(&request).unwrap();
    assert!(ui.drawn > 0);
    assert!(
        ui.drawn <= 256,
        "UI seed drew {} shapes, exceeding its hard geometry quota",
        ui.drawn
    );
}

fn attach_priority_cache(request: &mut SceneRequest) {
    let mut capture =
        PriorityBuilder::new(request).expect("fixture viewport must cover complete source input");
    for &layer in &request.layer_ids {
        for id in request
            .db
            .query_layers_intersect(&[layer], request.key.viewport)
        {
            let shape = request.db.find_shape(id).unwrap();
            let owner = request.db.owner_for_shape(shape);
            let kind = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            let style = visible_style_for_shape_fast(shape, owner, kind, &request.layers).unwrap();
            capture.observe(id, shape.bbox, style);
        }
    }
    request.priority = Some(capture.finish(&|| true).unwrap());
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_cached_priority_uses_512_records_and_real_source_order() {
    let fixture = Fixture::new();
    let mut request = layered_request_with_spread(&fixture, 1024, true);
    attach_priority_cache(&mut request);
    let priority = request.priority.as_ref().unwrap().select(&request, 384);
    assert_eq!(
        priority.len(),
        384,
        "cache fixture must fill the priority quota"
    );
    let ui = builder::build_ui_initial_scene(&request).unwrap();
    let records = ui.initial_records.as_ref().unwrap();
    assert!(records.len() > 256 && records.len() <= 512);
    assert!(priority
        .iter()
        .all(|&(_, id)| records.binary_search(&id).is_ok()));
    assert!(ui.labels.snapshot().is_empty());
    let mut renderer = renderer();
    let (actual, _) = renderer
        .rasterize_initial_seeds(&ui, &request, || true)
        .unwrap()
        .unwrap();
    for color in [[237, 61, 47, 255], [41, 211, 117, 255]] {
        assert!(
            actual.chunks_exact(4).any(|pixel| pixel == color),
            "mixed sample lost a colored source layer {color:?}"
        );
    }
    let mut expected = geometry::GeometryMeshSink::for_raster_with_patterns(
        request.tessellator.clone(),
        request.key.canvas,
        request.key.tessellation,
        request.key.pixels_per_point,
        Arc::clone(&request.pattern_textures),
    );
    let pass = chip_render::geometry2d::GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    for &layer in &request.layer_ids {
        for &id in records.iter() {
            let shape = request.db.find_shape(id).unwrap();
            if shape.layer_id != layer {
                continue;
            }
            let owner = request.db.owner_for_shape(shape);
            let kind = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
            let style = visible_style_for_shape_fast(shape, owner, kind, &request.layers).unwrap();
            pass.draw(request.db.shape_geometry(shape), &style, &mut expected);
        }
    }
    let triangles = |primitives: &[egui::ClippedPrimitive]| {
        primitives
            .iter()
            .flat_map(|primitive| {
                let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                    unreachable!()
                };
                mesh.indices
                    .iter()
                    .map(|index| {
                        (
                            primitive.clip_rect,
                            mesh.texture_id,
                            mesh.vertices[*index as usize],
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        triangles(&ui.meshes),
        triangles(&expected.finish()),
        "priority ranking must not reorder original layer/shape alpha composition"
    );
    // An incompatible cache is unusable: restore the spatial fallback budget,
    // rather than silently retaining the 512-record cached policy.
    request.key.epoch += 1;
    let fallback = builder::build_ui_initial_scene(&request).unwrap();
    assert!(fallback.initial_records.as_ref().unwrap().len() <= 256);
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn initial_progress_expired_refinement_preserves_priority_and_spatial_ui_ids() {
    let fixture = Fixture::new();
    let mut request = layered_request_with_spread(&fixture, 4096, true);
    attach_priority_cache(&mut request);
    let ui = builder::build_ui_initial_scene(&request).unwrap();
    let required = ui.initial_records.as_ref().unwrap();
    let refined = builder::build_initial_scene_with_budget(&request, &|| true, &|| false).unwrap();
    assert!(required.len() > 256 && required.len() <= 512);
    assert!(
        refined.covers_initial_records(&ui),
        "priority IDs outside the spatial prefix must survive deadline expiry"
    );
    let prepared = refined.initial_records.as_ref().unwrap();
    assert!(prepared.windows(2).all(|ids| ids[0] < ids[1]));
    assert!(required.iter().all(|id| prepared.binary_search(id).is_ok()));
    let mut renderer = renderer();
    let (before, _) = renderer
        .rasterize_initial_seeds(&ui, &request, || true)
        .unwrap()
        .unwrap();
    let (after, _) = renderer
        .rasterize_initial_seeds(&refined, &request, || true)
        .unwrap()
        .unwrap();
    let mut checked = 0;
    for (before, after) in before.chunks_exact(4).zip(after.chunks_exact(4)) {
        if before == [237, 61, 47, 255] || before == [41, 211, 117, 255] {
            assert_eq!(
                after, before,
                "protected UI geometry vanished from cached refinement"
            );
            checked += 1;
        }
    }
    assert!(
        checked >= 576,
        "vacuous preservation check: {checked} colored pixels"
    );
}
