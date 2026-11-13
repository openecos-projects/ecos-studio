use super::*;
use chip_render::geometry2d::GeometryPass;
use chipgeom_format::{LinePayload, PointPayload};

fn tessellator(
    ctx: &egui::Context,
    pixels_per_point: f32,
    options: egui::epaint::TessellationOptions,
) -> egui::epaint::Tessellator {
    ctx.fonts(|fonts| {
        let atlas = fonts.texture_atlas();
        let atlas = atlas.lock();
        egui::epaint::Tessellator::new(
            pixels_per_point,
            options,
            atlas.size(),
            atlas.prepared_discs(),
        )
    })
}

fn triangles(
    primitives: &[egui::ClippedPrimitive],
) -> Vec<(egui::Rect, egui::TextureId, [egui::epaint::Vertex; 3])> {
    primitives
        .iter()
        .flat_map(|primitive| {
            let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
                panic!("unexpected callback");
            };
            mesh.indices.chunks_exact(3).map(move |indices| {
                (
                    primitive.clip_rect,
                    mesh.texture_id,
                    [indices[0], indices[1], indices[2]].map(|index| mesh.vertices[index as usize]),
                )
            })
        })
        .collect()
}

#[test]
fn streaming_kernel_matches_legacy_painter_for_every_style_and_camera() {
    use chip_render::geometry2d;
    assert_eq!(geometry2d::MIN_SHAPE_SCREEN_SIZE, MIN_SHAPE_SCREEN_SIZE);
    assert_eq!(geometry2d::PATTERN_MIN_SIZE_PX, PATTERN_MIN_SIZE_PX);
    assert_eq!(
        geometry2d::PATTERN_FRAME_FADE_SIZE_PX,
        PATTERN_FRAME_FADE_SIZE_PX
    );
    assert_eq!(
        geometry2d::MAX_PATTERN_OPS_PER_SHAPE,
        MAX_PATTERN_OPS_PER_SHAPE
    );
    let ctx = egui::Context::default();
    let _ = ctx.run(egui::RawInput::default(), |_| {});
    let world = Rect32 {
        lx: -100,
        ly: -200,
        hx: 900,
        hy: 800,
    };
    let canvas = egui::Rect::from_min_max(egui::pos2(19.5, 27.25), egui::pos2(519.5, 427.25));
    let geometries = [
        ShapeGeometry::Rect(Rect32 {
            lx: -200,
            ly: -300,
            hx: 800,
            hy: 700,
        }),
        ShapeGeometry::Rect(Rect32 {
            lx: 200,
            ly: 100,
            hx: 630,
            hy: 550,
        }),
        ShapeGeometry::Rect(Rect32 {
            lx: 300,
            ly: 300,
            hx: 300,
            hy: 300,
        }),
        ShapeGeometry::Rect(Rect32 {
            lx: 500,
            ly: 500,
            hx: 540,
            hy: 550,
        }),
        ShapeGeometry::Rect(Rect32 {
            lx: 1000,
            ly: 1000,
            hx: 1100,
            hy: 1100,
        }),
        ShapeGeometry::Line(LinePayload {
            begin: Point32 { x: -100, y: 750 },
            end: Point32 { x: 800, y: -100 },
            width: -7,
            ..Default::default()
        }),
        ShapeGeometry::Point(PointPayload {
            point: Point32 { x: 400, y: 400 },
            ..Default::default()
        }),
    ];
    let patterns = [
        FillPattern::Hollow,
        FillPattern::Solid,
        FillPattern::SparseDots,
        FillPattern::DenseDots,
        FillPattern::DiagonalHatch,
        FillPattern::CrossHatch,
        FillPattern::HorizontalHatch,
        FillPattern::VerticalHatch,
        FillPattern::Grid,
        FillPattern::XMark,
    ];
    for (zoom, pan, pixels_per_point) in [
        (0.05, egui::Vec2::ZERO, 1.0),
        (1.0, egui::Vec2::ZERO, 1.0),
        (2.612572, egui::vec2(-17.25, 23.75), 1.5),
        (6.83, egui::vec2(125.0, -72.0), 2.0),
    ] {
        for option in 0..5 {
            let mut options = egui::epaint::TessellationOptions::default();
            match option {
                0 => {}
                1 => options.feathering = false,
                2 => options.prerasterized_discs = false,
                3 => options.debug_paint_clip_rects = true,
                4 => options.debug_ignore_clip_rects = true,
                _ => unreachable!(),
            }
            let mut sink = geometry::GeometryMeshSink::new(
                tessellator(&ctx, pixels_per_point, options),
                canvas,
                options,
            );
            let pass = GeometryPass::new(world, canvas, zoom, pan);
            let mut actual_count = 0;
            let output = ctx.run(
                egui::RawInput {
                    screen_rect: Some(canvas),
                    ..Default::default()
                },
                |ctx| {
                    let painter = ctx
                        .layer_painter(egui::LayerId::background())
                        .with_clip_rect(canvas);
                    for (index, pattern) in patterns.iter().enumerate() {
                        let style = LayerStyle {
                            fill_pattern: *pattern,
                            rgba: [51, 180, 231, [0, 1, 91, 255][index % 4]],
                            frame_rgba: [223, 41, 70, [255, 173, 1, 0][index % 4]],
                            line_width_px: (index % 5) as u8,
                            ..LayerStyle::default_for_layer(1, chip_display::ColorTheme::default())
                        };
                        for geometry in geometries {
                            actual_count += pass.draw(geometry, &style, &mut sink);
                            paint_styled_shape_geometry(
                                &painter, geometry, world, canvas, zoom, pan, &style,
                            );
                        }
                    }
                },
            );
            let expected =
                tessellator(&ctx, pixels_per_point, options).tessellate_shapes(output.shapes);
            let actual = builder::prepare_meshes(sink.finish());
            assert!(actual_count > 0, "zoom {zoom}, options {option}");
            assert_eq!(
                triangles(&actual),
                triangles(&expected),
                "zoom {zoom}, options {option}"
            );
        }
    }
}

#[test]
fn streaming_batches_preserve_large_ordered_translucent_scenes() {
    let ctx = egui::Context::default();
    let _ = ctx.run(egui::RawInput::default(), |_| {});
    let world = Rect32 {
        lx: 0,
        ly: 0,
        hx: 1000,
        hy: 1000,
    };
    let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1000.0, 1000.0));
    let options = egui::epaint::TessellationOptions::default();
    let pass = GeometryPass::new(world, canvas, 1.0, egui::Vec2::ZERO);
    let mut sink =
        geometry::GeometryMeshSink::new(tessellator(&ctx, 1.0, options), canvas, options);
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(canvas),
            ..Default::default()
        },
        |ctx| {
            let painter = ctx
                .layer_painter(egui::LayerId::background())
                .with_clip_rect(canvas);
            for index in 0..512 {
                let offset = index % 500;
                let geometry = ShapeGeometry::Rect(Rect32 {
                    lx: offset,
                    ly: offset,
                    hx: offset + 400,
                    hy: offset + 300,
                });
                let style = LayerStyle {
                    fill_pattern: if index % 2 == 0 {
                        FillPattern::Solid
                    } else {
                        FillPattern::CrossHatch
                    },
                    rgba: [index as u8, 80, 170, 91],
                    frame_rgba: [200, 70, 40, 131],
                    ..LayerStyle::default_for_layer(1, chip_display::ColorTheme::default())
                };
                pass.draw(geometry, &style, &mut sink);
                paint_styled_shape_geometry(
                    &painter,
                    geometry,
                    world,
                    canvas,
                    1.0,
                    egui::Vec2::ZERO,
                    &style,
                );
            }
        },
    );
    let expected = tessellator(&ctx, 1.0, options).tessellate_shapes(output.shapes);
    let actual = builder::prepare_meshes(sink.finish());
    assert!(actual.len() > 1);
    assert!(actual.iter().all(|primitive| {
        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
            return false;
        };
        mesh.indices.len() <= geometry::MAX_MESH_INDICES && mesh.is_valid()
    }));
    assert_eq!(triangles(&actual), triangles(&expected));
}

#[test]
fn repeated_pattern_uses_one_textured_quad_per_shape() {
    let ctx = egui::Context::default();
    let _ = ctx.run(egui::RawInput::default(), |_| {});
    let canvas = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1200.0, 1200.0));
    let options = egui::epaint::TessellationOptions::default();
    let patterns = Arc::new(PatternTextureSet::new(&ctx));
    let mut sink = geometry::GeometryMeshSink::new_with_patterns(
        tessellator(&ctx, 1.0, options),
        canvas,
        options,
        Arc::clone(&patterns),
    );
    let pass = GeometryPass::new(
        Rect32 {
            lx: 0,
            ly: 0,
            hx: 1200,
            hy: 1200,
        },
        canvas,
        1.0,
        egui::Vec2::ZERO,
    );
    pass.draw(
        ShapeGeometry::Rect(Rect32 {
            lx: 0,
            ly: 0,
            hx: 1200,
            hy: 1200,
        }),
        &LayerStyle {
            fill_pattern: FillPattern::Grid,
            rgba: [51, 180, 231, 173],
            frame_rgba: [223, 41, 70, 255],
            ..LayerStyle::default_for_layer(1, chip_display::ColorTheme::default())
        },
        &mut sink,
    );
    let meshes = builder::prepare_meshes(sink.finish());
    let pattern_mesh = meshes.iter().find_map(|primitive| {
        let egui::epaint::Primitive::Mesh(mesh) = &primitive.primitive else {
            return None;
        };
        (mesh.texture_id != egui::TextureId::default()).then_some(mesh)
    });
    let pattern_mesh = pattern_mesh.expect("grid should use a managed repeat texture");
    assert_eq!(pattern_mesh.vertices.len(), 4);
    assert_eq!(pattern_mesh.indices.len(), 6);
    assert!(pattern_mesh
        .vertices
        .iter()
        .any(|vertex| vertex.uv.x > 100.0 || vertex.uv.y > 100.0));
}
