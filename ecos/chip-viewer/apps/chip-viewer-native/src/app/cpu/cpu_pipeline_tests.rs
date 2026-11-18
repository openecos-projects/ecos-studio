use super::*;

fn ordered_vertices(meshes: &[egui::ClippedPrimitive]) -> Vec<(egui::Rect, egui::epaint::Vertex)> {
    meshes
        .iter()
        .flat_map(|primitive| {
            let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                unreachable!()
            };
            mesh.indices
                .iter()
                .map(move |index| (primitive.clip_rect, mesh.vertices[*index as usize]))
        })
        .collect()
}

#[test]
fn streaming_preparation_preserves_geometry_labels_and_cancellation() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.5);
    let expected = builder::build_with_workers(&request, &|| true, 4).unwrap();
    let mut streamed = Vec::new();
    let actual = builder::build_streaming(&request, &|| true, |meshes| {
        streamed.extend(ordered_vertices(meshes));
        true
    })
    .unwrap();
    assert_eq!(streamed, ordered_vertices(&expected.meshes));
    assert_eq!(ordered_vertices(&actual.meshes), streamed);
    assert_eq!(
        (actual.drawn, actual.primitives),
        (expected.drawn, expected.primitives)
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
    assert!(builder::build_streaming(&request, &|| true, |_| false).is_none());
}

#[cfg(target_os = "linux")]
#[test]
fn pipelined_gl_pixels_and_every_publication_match_ordered_prefixes() {
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL pipeline check unavailable");
        return;
    };
    for (zoom, dpr) in [(1.0, 1.0), (2.612572, 1.5), (6.8255, 2.0)] {
        let mut request = fixture.request(zoom, dpr);
        request.key.pan = egui::vec2(-0.25, 0.375);
        let mut updates = Vec::new();
        let actual = renderer
            .build_streaming_updates(
                &request,
                || true,
                |pixels, sequence| updates.push((pixels, sequence)),
                Some([Duration::ZERO; 2]),
            )
            .unwrap()
            .unwrap();
        let mut oracle = builder::build_with_workers(&request, &|| true, 4).unwrap();
        let expected = renderer
            .rasterize_updates(&oracle, &request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(actual.bitmap.as_deref(), Some(expected.as_slice()));
        assert!(!updates.is_empty());
        for (pixels, sequence) in updates {
            oracle.meshes = actual.meshes[..sequence].to_vec();
            let expected = renderer
                .rasterize_updates(&oracle, &request, || true, |_, _| {}, None)
                .unwrap()
                .unwrap()
                .0;
            assert_eq!(pixels, expected);
        }
        let current = AtomicBool::new(true);
        assert!(renderer
            .build_streaming_scene(
                &request,
                || { current.swap(false, Ordering::Relaxed) },
                |_, _| panic!("cancelled stream published")
            )
            .unwrap()
            .is_none());
        let current = AtomicBool::new(true);
        assert!(renderer
            .build_streaming_updates(
                &request,
                || current.load(Ordering::Relaxed),
                |_, _| current.store(false, Ordering::Relaxed),
                Some([Duration::ZERO; 2])
            )
            .unwrap()
            .is_none());
        let completed = renderer
            .build_streaming_updates(
                &request,
                || true,
                |_, _| panic!("final-only stream published"),
                None,
            )
            .unwrap()
            .unwrap();
        assert_eq!(completed.bitmap, actual.bitmap);
    }
}

#[cfg(target_os = "linux")]
#[test]
fn queued_gl_work_publishes_a_bounded_prefix_before_the_wall_timer() {
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL queued-work check unavailable");
        return;
    };
    let request = fixture.request(1.0, 1.0);
    let mut updates = Vec::new();
    let complete = renderer
        .build_streaming_updates(
            &request,
            || true,
            |pixels, sequence| updates.push((pixels, sequence)),
            Some([Duration::from_secs(3600); 2]),
        )
        .unwrap()
        .unwrap();
    assert_eq!(updates.len(), 1);
    let (pixels, sequence) = &updates[0];
    assert!(*sequence < complete.meshes.len());
    assert!(*sequence <= 4);
    let mut prefix = builder::build_with_workers(&request, &|| true, 4).unwrap();
    prefix.meshes = complete.meshes[..*sequence].to_vec();
    assert_eq!(
        *pixels,
        renderer
            .rasterize_updates(&prefix, &request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap()
            .0
    );
}

#[cfg(target_os = "linux")]
#[test]
fn compact_draws_restore_state_around_textured_meshes_callbacks_and_fractional_clips() {
    use eframe::glow::HasContext;
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL compact fallback check unavailable");
        return;
    };
    for dpr in [1.0, 1.25, 1.5, 2.0, 4.0] {
        let mut request = fixture.request(1.0, dpr);
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 41, 83);
        let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
        scene.meshes.clear();
        for index in 0..40 {
            let mut mesh = egui::Mesh::default();
            mesh.add_colored_rect(
                egui::Rect::from_min_size(
                    egui::pos2((index % 8) as f32 * 17.25, 3.125),
                    egui::vec2(91.5, 139.875),
                ),
                egui::Color32::from_rgba_premultiplied(61, 23, 71, 93),
            );
            if index % 3 == 1 {
                for vertex in &mut mesh.vertices {
                    vertex.uv = egui::pos2(0.125, 0.25);
                }
            }
            if index % 5 == 2 {
                mesh.indices.extend([0, 1, 3]);
            }
            let clip_rect =
                egui::Rect::from_min_max(egui::pos2(-7.25, 11.875), egui::pos2(211.375, 153.75));
            scene.meshes.push(egui::ClippedPrimitive {
                clip_rect,
                primitive: egui::epaint::Primitive::Mesh(mesh),
            });
            if index == 3 || index == 20 {
                scene.meshes.push(egui::ClippedPrimitive {
                    clip_rect,
                    primitive: egui::epaint::Primitive::Callback(egui::PaintCallback {
                        rect: clip_rect,
                        callback: Arc::new(eframe::egui_glow::CallbackFn::new(
                            |_, painter| unsafe {
                                let gl = painter.gl();
                                gl.disable(eframe::glow::BLEND);
                                gl.viewport(0, 0, 1, 1);
                                gl.color_mask(false, false, false, false);
                                gl.use_program(None);
                            },
                        )),
                    }),
                });
            }
        }
        let expected = renderer
            .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(
            renderer.rasterize_compact(&scene, &request).unwrap(),
            expected
        );
    }
}

#[cfg(target_os = "linux")]
#[test]
fn compact_submission_preserves_local_indices_beyond_a_shared_u16_vertex_range() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.25);
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL compact local-index check unavailable");
        return;
    };
    let mut scene = builder::build_with_workers(&request, &|| true, 1).unwrap();
    scene.meshes.clear();
    for index in 0..18 {
        let mut mesh = egui::Mesh::default();
        mesh.vertices.resize(
            65536,
            egui::epaint::Vertex {
                pos: egui::Pos2::ZERO,
                uv: egui::epaint::WHITE_UV,
                color: egui::Color32::from_rgba_premultiplied(41, 67, 17, 83),
            },
        );
        let last = if index == 9 { 65535 } else { 65534 };
        mesh.vertices[last - 2].pos = egui::pos2(index as f32 * 3.25, 11.125);
        mesh.vertices[last - 1].pos = egui::pos2(157.875, 37.25 + index as f32);
        mesh.vertices[last].pos = egui::pos2(43.5, 173.375);
        mesh.indices = vec![(last - 2) as u32, (last - 1) as u32, last as u32];
        scene.meshes.push(egui::ClippedPrimitive {
            clip_rect: egui::Rect::from_min_max(
                egui::pos2(3.25, 7.875),
                egui::pos2(149.125, 169.75),
            ),
            primitive: egui::epaint::Primitive::Mesh(mesh),
        });
    }
    assert_eq!(
        geometry::pack_meshes(&scene.meshes)
            .iter()
            .map(Option::is_some)
            .collect::<Vec<_>>(),
        (0..18).map(|index| index != 9).collect::<Vec<_>>()
    );
    let expected = renderer
        .rasterize_updates(&scene, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    let actual = renderer.rasterize_compact(&scene, &request).unwrap();
    let differences: Vec<_> = actual
        .chunks_exact(4)
        .zip(expected.chunks_exact(4))
        .enumerate()
        .filter(|(_, (actual, expected))| actual != expected)
        .take(8)
        .collect();
    assert!(differences.is_empty(), "RGBA differences: {differences:?}");
}
