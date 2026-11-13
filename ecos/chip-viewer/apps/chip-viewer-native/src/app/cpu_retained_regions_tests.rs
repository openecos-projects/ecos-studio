use super::*;
use chip_display::LayerStyle;
use chip_render::geometry2d::GeometryPass;
use chip_view_db::ShapeGeometry;

#[derive(Default)]
struct Commands(Vec<PaintCommand>);

impl PaintSink for Commands {
    fn paint(&mut self, command: PaintCommand) {
        self.0.push(command);
    }
}

fn records() -> Vec<(Rect32, ShapeGeometry, LayerStyle)> {
    let mut result = Vec::new();
    for index in 0..600 {
        let bbox = Rect32 {
            lx: (index * 73 % 997) - 15,
            ly: (index * 137 % 991) - 20,
            hx: (index * 73 % 997) + [1, 2, 8, 19, 39, 71][index as usize % 6],
            hy: (index * 137 % 991) + [1, 2, 9, 23, 41][index as usize % 5],
        };
        let mut style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
        style.rgba = [173, 61, 237, [31, 112, 173, 255][index as usize % 4]];
        style.frame_rgba = [37, 191, 83, [31, 112, 173, 255][index as usize % 4]];
        style.fill_pattern = FillPattern::Solid;
        style.line_width_px = 1;
        result.push((bbox, ShapeGeometry::Rect(bbox), style));
    }
    for (index, pattern) in [
        FillPattern::SparseDots,
        FillPattern::DenseDots,
        FillPattern::DiagonalHatch,
        FillPattern::CrossHatch,
        FillPattern::HorizontalHatch,
        FillPattern::VerticalHatch,
        FillPattern::Grid,
        FillPattern::XMark,
        FillPattern::Hollow,
    ]
    .into_iter()
    .enumerate()
    {
        let bbox = Rect32 {
            lx: -60,
            ly: index as i32 * 100,
            hx: 200,
            hy: index as i32 * 100 + 100,
        };
        let mut style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
        style.fill_pattern = pattern;
        result.push((bbox, ShapeGeometry::Rect(bbox), style));
    }
    let bbox = Rect32 {
        lx: 800,
        ly: 50,
        hx: 1000,
        hy: 150,
    };
    let style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
    result.push((
        bbox,
        ShapeGeometry::Line(LinePayload {
            begin: Point32 { x: 800, y: 50 },
            end: Point32 { x: 1000, y: 150 },
            width: 4,
            ..Default::default()
        }),
        style,
    ));
    result.push((
        bbox,
        ShapeGeometry::Point(PointPayload {
            point: Point32 { x: 920, y: 100 },
            ..Default::default()
        }),
        style,
    ));
    result
}

fn project(records: &[(Rect32, ShapeGeometry, LayerStyle)], key: &SceneKey) -> Vec<PaintCommand> {
    let pass = GeometryPass::new(key.world, key.canvas, key.zoom, key.pan);
    let mut commands = Commands::default();
    for (bbox, geometry, style) in records {
        if bbox.intersects(key.viewport) {
            pass.draw(*geometry, style, &mut commands);
        }
    }
    commands.0
}

#[test]
fn retained_regions_match_fresh_gl_at_every_declared_pixel_after_interrupted_pans() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let records = records();
    for scale in [1.0, 2.0, 4.0] {
        let mut request = fixture.request(1.0, scale);
        request.key.screen_size = [512, 512];
        request.key.canvas = egui::Rect::from_min_max(
            egui::pos2(11.25, 15.5) / scale,
            egui::pos2(499.5, 501.25) / scale,
        );
        request.key.pan = egui::vec2(0.125, -0.375) / scale;
        request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 51, 83);
        let mut model = retained_regions::RegionModel::new(&request).unwrap();
        let pass = GeometryPass::new(
            request.key.world,
            request.key.canvas,
            request.key.zoom,
            request.key.pan,
        );
        let mut commands = Commands::default();
        for (bbox, geometry, style) in &records {
            commands.0.clear();
            pass.draw(*geometry, style, &mut commands);
            assert!(model.push(*bbox, *geometry, *style, &commands.0));
        }
        let source_commands = project(&records, &request.key);
        let source_meshes = meshes(
            &fixture,
            &request,
            &source_commands,
            geometry::GeometryOutput::ExactRaster,
        );
        let source = pixels(&mut renderer, &request, source_meshes);
        for pan in [
            egui::vec2(4.0, 3.0),
            egui::vec2(37.0, -19.0),
            egui::vec2(-23.0, 11.0),
        ] {
            let mut current = fixture.request(1.0, scale);
            current.key = request.key.clone();
            current.key.pan += pan / scale;
            current.key.viewport = screen_to_world_rect(
                current.key.canvas,
                current.key.world,
                current.key.canvas,
                current.key.zoom,
                current.key.pan,
            );
            let regions = model.validate(&current.key, 4).unwrap();
            let clips = regions.clips();
            let commands = project(&records, &current.key);
            let target_meshes = meshes(
                &fixture,
                &current,
                &commands,
                geometry::GeometryOutput::ExactRaster,
            );
            let target = pixels(&mut renderer, &current, target_meshes);
            let composed = model.compose(&current.key, &regions, &source).unwrap();
            let mut expected = current.key.background.to_array().repeat(512 * 512);
            let mut compared = 0;
            for clip in clips {
                for row in (clip.top() * scale) as usize..(clip.bottom() * scale) as usize {
                    let start = ((511 - row) * 512 + (clip.left() * scale) as usize) * 4;
                    let end = ((511 - row) * 512 + (clip.right() * scale) as usize) * 4;
                    expected[start..end].copy_from_slice(&target[start..end]);
                    for column in (clip.left() * scale) as usize..(clip.right() * scale) as usize {
                        let source_row = (row as i32 - pan.y as i32) as usize;
                        let source_column = (column as i32 - pan.x as i32) as usize;
                        let old = ((511 - source_row) * 512 + source_column) * 4;
                        let new = ((511 - row) * 512 + column) * 4;
                        assert_eq!(
                            &source[old..old + 4],
                            &target[new..new + 4],
                            "DPR {scale}, pan {pan:?}, pixel {column},{row}"
                        );
                        compared += 1;
                    }
                }
            }
            assert!(
                compared >= 10_000,
                "vacuous validity DPR {scale}, pan {pan:?}: {compared}"
            );
            assert_eq!(
                composed
                    .iter()
                    .zip(&expected)
                    .position(|(actual, expected)| actual != expected),
                None,
                "complete composed image DPR {scale}, pan {pan:?}"
            );
            let mut wrong = current.key.clone();
            wrong.pan.x += 0.5;
            assert!(model.compose(&wrong, &regions, &source).is_none());
        }
    }
}

#[test]
fn retained_regions_reject_unproven_camera_and_style_changes() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let model = retained_regions::RegionModel::new(&request).unwrap();
    for change in [
        |key: &mut SceneKey| key.pan.x += 0.25,
        |key: &mut SceneKey| key.zoom = 1.000001,
        |key: &mut SceneKey| key.layers += 1,
        |key: &mut SceneKey| key.epoch += 1,
        |key: &mut SceneKey| key.world.hx += 1,
        |key: &mut SceneKey| key.canvas.max.x += 1.0,
        |key: &mut SceneKey| key.screen_size[0] += 1,
        |key: &mut SceneKey| key.pixels_per_point = 2.0,
        |key: &mut SceneKey| key.tessellation.feathering = false,
    ] {
        let mut key = request.key.clone();
        change(&mut key);
        assert!(model.validate(&key, 4).is_none());
    }
    let mut cropped = fixture.request(1.0, 1.0);
    cropped.key.viewport.hx -= 1;
    assert!(retained_regions::RegionModel::new(&cropped).is_none());
    cropped.key.world = cropped.key.viewport;
    assert!(retained_regions::RegionModel::new(&cropped).is_none());
}

#[test]
fn retained_models_reject_visible_grid_overlays_and_mesh_fallback() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let mut fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let scene = renderer
        .build_sparse_updates(&request, || true, |_, _| {})
        .unwrap()
        .unwrap();
    assert!(scene.bitmap.is_some());
    assert!(scene.retained.is_none());
    fs::write(
        fixture.path.join("geometry.grids.txt"),
        "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\ntrack\t0\tx\t0\t20\t51\t1\t\n",
    )
    .unwrap();
    fixture.db = Arc::new(ChipViewDb::open(fixture.path.join("geometry.manifest")).unwrap());
    let mut request = fixture.request(2.0, 1.0);
    request.key.cache_overlays = true;
    assert!(retained_regions::RegionModel::new(&request).is_none());
    request.key.cache_overlays = false;
    assert!(retained_regions::RegionModel::new(&request).is_some());
}

#[test]
fn retained_capture_presents_only_valid_current_pixels_and_keeps_full_completion_separate() {
    let Some(mut renderer) = coverage_blend_tests::renderer() else {
        return;
    };
    let fixture = Fixture::new();
    let mut request = fixture.request(0.05, 1.0);
    request.layer_ids = vec![2];
    let source = renderer
        .build_sparse_updates(&request, || true, |_, _| {})
        .unwrap()
        .unwrap();
    let model = source
        .retained
        .as_ref()
        .expect("complete world input retained");
    assert!(model.byte_len() > 0);
    let mut current = fixture.request(0.05, 1.0);
    current.layer_ids = vec![2];
    current.key.pan = egui::vec2(31.0, -17.0);
    current.key.viewport = screen_to_world_rect(
        current.key.canvas,
        current.key.world,
        current.key.canvas,
        current.key.zoom,
        current.key.pan,
    );
    let clips = model.validate(&current.key, 4).unwrap().clips();
    assert!(!clips.is_empty());
    let mut commands = Vec::new();
    builder::build_command_stream(&current, &|| true, |packet| {
        if let builder::PaintPacket::Commands(paint) = packet {
            commands.extend(paint);
        }
        true
    })
    .unwrap();
    let target_meshes = meshes(
        &fixture,
        &current,
        &commands,
        geometry::GeometryOutput::ExactRaster,
    );
    let target = pixels(&mut renderer, &current, target_meshes);
    let source = Arc::new(source);
    renderer.with_context(|gl| {
        let presentation = crate::app::cpu_raster::test_support::Presentation::new(
            Arc::clone(gl),
            &request.key,
            fixture.ctx.clone(),
        );
        presentation.paint(Some(&source), &request.key, None);
        let actual = presentation.paint(None, &current.key, None);
        let mut expected = [0, 0, 0, 255].repeat(640 * 480);
        for clip in &clips {
            for row in clip.top() as usize..clip.bottom() as usize {
                let start = ((479 - row) * 640 + clip.left() as usize) * 4;
                let end = ((479 - row) * 640 + clip.right() as usize) * 4;
                expected[start..end].copy_from_slice(&target[start..end]);
            }
        }
        assert_eq!(
            actual, expected,
            "actual blits match fresh current regions and clear every other pixel"
        );
        assert!(presentation.cache.is_partial(&current.key));
        assert!(!presentation.cache.is_preview(&current.key));
        assert!(presentation.cache.scene_for(&current.key).is_none());
        assert!(!presentation
            .cache
            .is_ready(&builder::build_with_workers(&current, &|| true, 1).unwrap()));
        let complete = renderer_scene(&current, target.clone());
        assert_eq!(
            presentation.paint(Some(&complete), &current.key, None),
            target
        );
        assert!(!presentation.cache.is_partial(&current.key));
        assert!(!presentation.cache.is_preview(&current.key));
    });
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&source));
    assert!(
        history.byte_len()
            >= source.bitmap.as_ref().unwrap().len() + source.retained.as_ref().unwrap().byte_len()
    );
    let mut selected = fixture.request(0.05, 1.0);
    selected.key.selected = Some(1);
    let refreshed = builder::refresh_labels(
        &selected,
        &source,
        &mut labels::LabelResolver::default(),
        &|| true,
    )
    .unwrap();
    assert!(Arc::ptr_eq(
        refreshed.retained.as_ref().unwrap(),
        source.retained.as_ref().unwrap()
    ));
}

fn renderer_scene(request: &SceneRequest, bitmap: Vec<u8>) -> Arc<CpuScene> {
    let mut scene = builder::build_with_workers(request, &|| true, 1).unwrap();
    scene.bitmap = Some(bitmap.into());
    Arc::new(scene)
}
