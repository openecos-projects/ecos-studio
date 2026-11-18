use super::*;

#[test]
fn initial_progress_real_gl_seeds_preserve_textures_and_exact_completion_order() {
    let mut renderer =
        offscreen::OffscreenRenderer::new("").expect("initial GL seeds require EGL; do not skip");
    let fixture = Fixture::new();
    let mut request = layered_request(&fixture, 1);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&fixture.ctx));
    for (&layer, style) in &mut request.layers.style_map {
        if layer > 0 {
            style.fill_pattern = FillPattern::DenseDots;
            style.frame_rgba = style.rgba;
        }
    }
    let seeds =
        builder::build_initial_scene(&request, &|| true).expect("all visible layers prepare");
    let (initial, _) = renderer
        .rasterize_initial_seeds(&seeds, &request, &|| true)
        .unwrap()
        .unwrap();
    for column in [50, 86] {
        assert!(
            (100..120).any(|row| initial
                [((127 - row) * 128 + column) * 4..((127 - row) * 128 + column) * 4 + 3]
                .iter()
                .max()
                .unwrap()
                > &100),
            "managed pattern layer missing at {column}"
        );
    }
    let mut exact_meshes = Vec::new();
    builder::build_raster_stream(&request, &|| true, |meshes, _| {
        exact_meshes.extend_from_slice(meshes);
        true
    })
    .unwrap();
    let mut exact_scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    exact_scene.meshes = exact_meshes;
    let (reference, _) = renderer
        .rasterize_updates(&exact_scene, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap();
    assert_eq!(
        initial, reference,
        "all sampled layers must match independent fresh GL in exact order"
    );
    // An exact stream starts with a clean target after the seed readback. In
    // particular, translucent contributors are not painted over seeds twice.
    let mut complete_request = request;
    complete_request.publication = progress::Publication::Complete;
    let completed = renderer
        .build_streaming_scene(
            &complete_request,
            || true,
            |_, _| panic!("complete-only request published a prefix"),
        )
        .unwrap()
        .unwrap();
    assert_eq!(completed.bitmap.as_deref().unwrap(), reference);
    let mut wrong = complete_request;
    wrong.key.zoom = 2.0;
    assert!(renderer
        .rasterize_initial_seeds(&seeds, &wrong, || true)
        .unwrap()
        .is_none());
}

#[test]
fn initial_progress_real_gl_seeds_keep_clipped_mesh_geometry_erased_by_cpu_holes() {
    let mut renderer =
        offscreen::OffscreenRenderer::new("").expect("initial GL seeds require EGL; do not skip");
    let fixture = Fixture::new();
    let mut request = layered_request(&fixture, 1);
    request.key.pan = egui::vec2(-59.0, 0.0);
    request.key.viewport = screen_to_world_rect(
        request.key.canvas,
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    let red = request
        .db
        .query_layers_intersect(&[1], request.key.viewport);
    let shape = request.db.find_shape(red[0]).unwrap();
    let rect = chip_render::geometry2d::GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    )
    .project(request.db.shape_geometry(shape))
    .bounds()
    .intersect(request.key.canvas);
    let raster = geometry::PixelRectRasterizer::new(1.0, request.key.tessellation).unwrap();
    assert!(
        raster
            .rectangles(PaintCommand::FillRect {
                rect,
                rgba: [237, 61, 47, 255]
            })
            .is_none(),
        "regression must exercise a clipped fill requiring mesh rasterization"
    );
    let seeds = builder::build_initial_scene(&request, &|| true).unwrap();
    let (actual, _) = renderer
        .rasterize_initial_seeds(&seeds, &request, || true)
        .unwrap()
        .unwrap();
    assert!(
        actual
            .chunks_exact(4)
            .any(|pixel| pixel[0] > pixel[1] * 2 && pixel[0] > 32),
        "GL must keep feathered clipped red geometry"
    );
}

#[test]
fn initial_progress_skips_named_labels_and_preserves_exact_geometry() {
    use crate::app::tests::write_empty_geometry_file;
    use chipgeom_format::{GeometryFileKind, GeometryMetaRecord, GeometryNameRecord};
    let fixture = Fixture::new();
    let mut request = layered_request(&fixture, 1);
    let source = fixture.path.join("initial-layers-1-false");
    let named = fixture.path.join("initial-named-labels");
    fs::create_dir_all(&named).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        fs::copy(entry.path(), named.join(entry.file_name())).unwrap();
    }
    let owner = OwnerRef {
        owner_type: OwnerType::NetWireSegment as u8,
        owner_id: 1,
        name_id: 1,
        ..Default::default()
    };
    let name = b"seed-net-with-label";
    let name_record = GeometryNameRecord {
        owner_type: owner.owner_type,
        owner_id: owner.owner_id,
        name_size: name.len() as u32,
        ..Default::default()
    };
    let meta = GeometryMetaRecord {
        shape_count: 3,
        owner_count: 1,
        name_record_count: 1,
        name_payload_size: name.len() as u64,
        ..Default::default()
    };
    for (file, kind, size, bytes) in [
        (
            "meta",
            GeometryFileKind::Meta,
            size_of::<GeometryMetaRecord>(),
            bytemuck::bytes_of(&meta),
        ),
        (
            "owners",
            GeometryFileKind::Owners,
            size_of::<OwnerRef>(),
            bytemuck::bytes_of(&owner),
        ),
        ("names", GeometryFileKind::Names, 1, name.as_slice()),
        (
            "name_index",
            GeometryFileKind::NameIndex,
            size_of::<GeometryNameRecord>(),
            bytemuck::bytes_of(&name_record),
        ),
    ] {
        write_empty_geometry_file(
            &named.join(format!("geometry.{file}.bin")),
            kind,
            size as u32,
            bytes,
        );
    }
    let manifest = named.join("geometry.manifest");
    let text = fs::read_to_string(&manifest)
        .unwrap()
        .replace("owner_count=0", "owner_count=1")
        .replace("name_record_count=0", "name_record_count=1")
        .replace(
            "name_payload_size=0",
            &format!("name_payload_size={}", name.len()),
        );
    fs::write(&manifest, text).unwrap();
    request.db = Arc::new(ChipViewDb::open(manifest).unwrap());
    request.zoom_rules = ZoomVisibilityRules::new(&request.db);
    let mut exact = builder::build_with_workers(&request, &|| true, 1).unwrap();
    assert!(
        !exact.labels.snapshot().is_empty(),
        "the exact path must actually collect named labels"
    );
    let seeds = builder::build_initial_scene(&request, &|| true).unwrap();
    assert!(
        seeds.labels.snapshot().is_empty(),
        "initial geometry must not allocate unused label candidates"
    );
    exact.meshes.clear();
    builder::build_raster_stream(&request, &|| true, |meshes, _| {
        exact.meshes.extend_from_slice(meshes);
        true
    })
    .unwrap();
    let triangles = |scene: &CpuScene| {
        scene
            .meshes
            .iter()
            .flat_map(|primitive| {
                let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                    unreachable!()
                };
                mesh.indices
                    .iter()
                    .map(|index| mesh.vertices[*index as usize])
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        triangles(&seeds),
        triangles(&exact),
        "skipping labels must preserve geometry, UVs, premultiplied colors and order"
    );
}

#[test]
fn initial_progress_large_seed_batches_preserve_translucent_texture_order_and_cancellation() {
    let fixture = Fixture::new();
    let mut request = layered_request(&fixture, 128);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&fixture.ctx));
    for (&layer, style) in &mut request.layers.style_map {
        if layer > 0 {
            style.fill_pattern = FillPattern::DenseDots;
            style.rgba[3] = 112;
            style.frame_rgba = [37, 191, 83, 173];
        }
    }
    let seeds = builder::build_initial_scene(&request, &|| true).unwrap();
    assert!(
        seeds.meshes.len() > 256,
        "regression must cross the seed batch boundary"
    );
    let mut renderer = renderer();
    let (actual, _) = renderer
        .rasterize_initial_seeds(&seeds, &request, || true)
        .unwrap()
        .unwrap();
    let (expected, _) = renderer
        .rasterize_updates(&seeds, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap();
    assert_eq!(
        actual, expected,
        "seed batching must preserve UVs, blend order, and multiplicity"
    );
    let checks = std::cell::Cell::new(0);
    assert!(renderer
        .rasterize_initial_seeds(&seeds, &request, || {
            let count = checks.get() + 1;
            checks.set(count);
            count <= 2
        })
        .unwrap()
        .is_none());
    assert_eq!(
        checks.get(),
        3,
        "cancellation must be checked before the second seed batch"
    );
}
