use super::*;

fn renderer() -> Option<offscreen::OffscreenRenderer> {
    match offscreen::OffscreenRenderer::new("") {
        Ok(renderer) => Some(renderer),
        Err(error) => {
            assert!(
                std::env::var_os("ECOS_REQUIRE_INTERACTION_EGL").is_none(),
                "EGL font texture check required: {error}"
            );
            eprintln!("EGL font texture check unavailable: {error}");
            None
        }
    }
}

#[test]
fn white_geometry_does_not_upload_the_font_atlas_across_camera_changes() {
    let fixture = Fixture::new();
    let Some(mut renderer) = renderer() else {
        return;
    };
    let mut images = Vec::new();
    for zoom in [1.0, 2.612572, 6.8255] {
        let mut request = fixture.request(zoom, 1.0);
        request.key.tessellation.prerasterized_discs = false;
        request.tessellator = fixture.ctx.fonts(|fonts| {
            let atlas = fonts.texture_atlas();
            let atlas = atlas.lock();
            egui::epaint::Tessellator::new(
                request.key.pixels_per_point,
                request.key.tessellation,
                atlas.size(),
                atlas.prepared_discs(),
            )
        });
        let actual = renderer
            .build_streaming_updates(&request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap();
        assert!(request.key.font_texture_size[0] > 1);
        assert!(actual.meshes.iter().all(|primitive| {
            matches!(&primitive.primitive, egui::epaint::Primitive::Mesh(mesh)
                if mesh.vertices.iter().all(|vertex| vertex.uv == egui::epaint::WHITE_UV))
        }));
        let texture = renderer
            .font_texture_pixels(request.key.font_texture_size.into_iter().product::<usize>() * 4);
        assert_eq!(&texture[..4], &[255; 4]);
        assert!(texture[4..].iter().all(|value| *value == 13));
        images.push((request, actual));
    }
    for (request, actual) in images {
        let reference = builder::build_with_workers(&request, &|| true, 1).unwrap();
        let expected = renderer
            .rasterize_updates(&reference, &request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(actual.bitmap.as_deref(), Some(expected.as_slice()));
    }
}

#[test]
fn deferred_atlas_upload_matches_every_mixed_prefix_and_refreshes_same_size_content() {
    let fixture = Fixture::new();
    let Some(mut renderer) = renderer() else {
        return;
    };
    let mut previous_size = None;
    for coverage in [0.25, 0.75] {
        let location = fixture.ctx.fonts(|fonts| {
            let atlas = fonts.texture_atlas();
            let mut atlas = atlas.lock();
            let (location, image) = atlas.allocate((1, 1));
            image[location] = coverage;
            location
        });
        let request = fixture.request(1.0, 1.0);
        if let Some(size) = previous_size {
            assert_eq!(request.key.font_texture_size, size);
        }
        previous_size = Some(request.key.font_texture_size);
        let uv = egui::pos2(
            (location.0 as f32 + 0.5) / request.key.font_texture_size[0] as f32,
            (location.1 as f32 + 0.5) / request.key.font_texture_size[1] as f32,
        );
        let bounds = egui::Rect::from_min_max(egui::pos2(40.0, 50.0), egui::pos2(90.0, 110.0));
        let mut white = egui::Mesh::default();
        white.add_colored_rect(bounds, egui::Color32::from_rgb(83, 141, 37));
        let mut textured = egui::Mesh::default();
        textured.add_rect_with_uv(
            bounds.translate(egui::vec2(25.0, 15.0)),
            egui::Rect::from_min_max(uv, uv),
            egui::Color32::WHITE,
        );
        let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
        scene.meshes = [white, textured]
            .into_iter()
            .map(|mesh| egui::ClippedPrimitive {
                clip_rect: request.key.canvas,
                primitive: egui::epaint::Primitive::Mesh(mesh),
            })
            .collect();
        let mut updates = Vec::new();
        let actual = renderer
            .rasterize_stream_primitives(
                &request,
                &scene.meshes,
                || true,
                |pixels, sequence| updates.push((pixels, sequence)),
            )
            .unwrap()
            .unwrap()
            .0;
        let expected = renderer
            .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(actual, expected);
        assert_eq!(updates.len(), 2);
        for (pixels, sequence) in updates {
            let mut prefix = builder::build_with_workers(&request, &|| true, 1).unwrap();
            prefix.meshes = scene.meshes[..sequence].to_vec();
            let expected = renderer
                .rasterize_updates(&prefix, &request, || true, |_, _| {}, None)
                .unwrap()
                .unwrap()
                .0;
            assert_eq!(pixels, expected);
        }
        assert!(renderer
            .rasterize_stream_primitives(
                &request,
                &scene.meshes,
                || false,
                |_, _| { panic!("cancelled font stream published") }
            )
            .unwrap()
            .is_none());
        let current = AtomicBool::new(true);
        assert!(renderer
            .rasterize_stream_primitives(
                &request,
                &scene.meshes,
                || current.load(Ordering::Relaxed),
                |_, _| current.store(false, Ordering::Relaxed),
            )
            .unwrap()
            .is_none());
    }
}

#[test]
fn white_and_textured_streams_reject_an_obsolete_atlas_size() {
    let fixture = Fixture::new();
    let Some(mut renderer) = renderer() else {
        return;
    };
    let mut request = fixture.request(1.0, 1.0);
    request.key.font_texture_size[1] += 1;
    assert!(renderer
        .build_streaming_updates(
            &request,
            || true,
            |_, _| panic!("obsolete atlas published"),
            None
        )
        .unwrap()
        .is_none());
}
