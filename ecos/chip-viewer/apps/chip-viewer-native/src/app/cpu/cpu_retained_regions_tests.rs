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

fn managed_meshes(
    request: &SceneRequest,
    commands: &[PaintCommand],
) -> Vec<egui::ClippedPrimitive> {
    let mut sink = geometry::GeometryMeshSink::for_raster_with_patterns(
        request.tessellator.clone(),
        request.key.canvas,
        request.key.tessellation,
        request.key.pixels_per_point,
        Arc::clone(&request.pattern_textures),
    );
    for &command in commands {
        sink.paint(command);
    }
    sink.finish()
}

fn assert_current_pixels(
    actual: &[u8],
    expected: &[u8],
    request: &SceneRequest,
    commands: &[PaintCommand],
    certified: bool,
    context: &str,
) {
    assert_eq!(actual.len(), expected.len());
    let patterns = commands
        .iter()
        .filter_map(|command| match command {
            PaintCommand::PatternRect { rect, .. } => Some(*rect),
            _ => None,
        })
        .collect::<Vec<_>>();
    let mut differences = Vec::new();
    for (index, (actual, expected)) in actual
        .chunks_exact(4)
        .zip(expected.chunks_exact(4))
        .enumerate()
    {
        let column = index % request.key.screen_size[0] as usize;
        let row =
            request.key.screen_size[1] as usize - 1 - index / request.key.screen_size[0] as usize;
        let point = egui::pos2(
            (column as f32 + 0.5) / request.key.pixels_per_point,
            (row as f32 + 0.5) / request.key.pixels_per_point,
        );
        // Existing sparse managed-texture allowance, confined to its profile
        // and target footprint. Solids and actual GL repairs remain byte exact.
        let allowance = if certified && patterns.iter().any(|rect| rect.contains(point)) {
            2
        } else {
            0
        };
        if actual
            .iter()
            .zip(expected)
            .any(|(a, b)| a.abs_diff(*b) > allowance)
            && differences.len() < 8
        {
            differences.push((column, row, actual.to_vec(), expected.to_vec()));
        }
    }
    assert!(differences.is_empty(), "{context}: {differences:?}");
}

fn compose_and_repair(
    renderer: &mut offscreen::OffscreenRenderer,
    request: &SceneRequest,
    model: &retained_regions::RegionModel,
    source: &[u8],
) -> (retained_regions::Regions, Vec<u8>, Vec<u8>) {
    let regions = renderer
        .with_context(|gl| model.prepare_for_gl(&request.key, 4, gl))
        .expect("target plan must prepare on the actual GL profile");
    let composed = model.compose(&request.key, &regions, source).unwrap();
    assert_eq!(
        composed,
        model
            .compose(&request.key, &regions, &vec![0x5a; source.len()])
            .unwrap(),
        "target composition must not depend on source RGBA"
    );
    let repairs = regions.repair_meshes(&request.key).unwrap_or_else(|| {
        panic!(
            "retained corpus exceeds GL repair budget: DPR {}, {} damage clips",
            request.key.pixels_per_point,
            regions.damage_clips(&request.key).len()
        )
    });
    assert!(
        !repairs.is_empty(),
        "fixture must exercise target GL repairs"
    );
    let repair = pixels(renderer, request, repairs);
    let mut finished = composed.clone();
    let [width, height] = request.key.screen_size;
    let scale = request.key.pixels_per_point;
    for damage in regions.damage_clips(&request.key) {
        let left = (damage.left() * scale).round().max(0.0) as usize;
        let right = (damage.right() * scale).round().min(width as f32) as usize;
        let top = (damage.top() * scale).round().max(0.0) as usize;
        let bottom = (damage.bottom() * scale).round().min(height as f32) as usize;
        for row in top..bottom {
            let start = ((height as usize - 1 - row) * width as usize + left) * 4;
            let end = start + (right - left) * 4;
            finished[start..end].copy_from_slice(&repair[start..end]);
        }
    }
    (regions, composed, finished)
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_regions_match_fresh_gl_at_every_declared_pixel_after_interrupted_pans() {
    let mut renderer = offscreen::OffscreenRenderer::new("").expect("retained oracle requires EGL");
    let certified = renderer.with_context(|gl| sparse_rects::certified_profile(gl));
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
        request.pattern_textures = Arc::new(PatternTextureSet::new(&fixture.ctx));
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
        let source_meshes = managed_meshes(&request, &source_commands);
        let source = pixels(&mut renderer, &request, source_meshes);
        for pan in [
            egui::vec2(4.0, 3.0),
            egui::vec2(37.0, -19.0),
            egui::vec2(-23.0, 11.0),
        ] {
            let mut current = fixture.request(1.0, scale);
            current.key = request.key.clone();
            current.pattern_textures = Arc::clone(&request.pattern_textures);
            current.key.pan += pan / scale;
            current.key.viewport = screen_to_world_rect(
                current.key.canvas,
                current.key.world,
                current.key.canvas,
                current.key.zoom,
                current.key.pan,
            );
            let commands = project(&records, &current.key);
            let target_meshes = managed_meshes(&current, &commands);
            let target = pixels(&mut renderer, &current, target_meshes);
            let (regions, composed, repaired) =
                compose_and_repair(&mut renderer, &current, &model, &source);
            let mut expected = current.key.background.to_array().repeat(512 * 512);
            let mut compared = 0;
            let mut foreground = 0;
            for clip in regions.clips() {
                for row in (clip.top() * scale) as usize..(clip.bottom() * scale) as usize {
                    let start = ((511 - row) * 512 + (clip.left() * scale) as usize) * 4;
                    let end = ((511 - row) * 512 + (clip.right() * scale) as usize) * 4;
                    expected[start..end].copy_from_slice(&target[start..end]);
                    compared += (end - start) / 4;
                    foreground += target[start..end]
                        .chunks_exact(4)
                        .filter(|pixel| *pixel != current.key.background.to_array())
                        .count();
                }
            }
            if certified {
                assert!(
                    compared >= 10_000,
                    "vacuous certified CPU validity DPR {scale}, pan {pan:?}: {compared}"
                );
                assert!(
                    foreground > 0,
                    "certified CPU plan retained only background"
                );
            }
            assert_current_pixels(
                &composed,
                &expected,
                &current,
                &commands,
                certified,
                &format!("complete composed image DPR {scale}, pan {pan:?}"),
            );
            assert_current_pixels(
                &repaired,
                &target,
                &current,
                &commands,
                certified,
                &format!("complete repaired target DPR {scale}, pan {pan:?}"),
            );
            let mut wrong = current.key.clone();
            wrong.pan.x += 0.5;
            assert!(model.compose(&wrong, &regions, &source).is_none());
        }
    }
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_rectangles_and_patterns_recompose_without_using_old_rgba() {
    let mut renderer = offscreen::OffscreenRenderer::new("").expect("retained oracle requires EGL");
    let certified = renderer.with_context(|gl| sparse_rects::certified_profile(gl));
    let fixture = Fixture::new();
    let all_records = records();
    let mut records = all_records
        .iter()
        .copied()
        .filter(|(bbox, _, style)| {
            (bbox.lx >= 50
                && bbox.ly >= 50
                && bbox.hx <= 950
                && bbox.hy <= 950
                && bbox.hx - bbox.lx >= 30
                && bbox.hy - bbox.ly >= 30)
                || (bbox.lx == -60 && style.fill_pattern != FillPattern::XMark)
        })
        .take(32)
        .collect::<Vec<_>>();
    records.extend(
        all_records
            .into_iter()
            .filter(|(bbox, _, style)| bbox.lx == -60 && style.fill_pattern != FillPattern::XMark),
    );
    let mut request = fixture.request(1.0, 1.0);
    request.pattern_textures = Arc::new(PatternTextureSet::new(&fixture.ctx));
    request.key.screen_size = [512, 512];
    request.key.canvas =
        egui::Rect::from_min_max(egui::pos2(11.25, 15.5), egui::pos2(499.5, 501.25));
    request.key.pan = egui::vec2(0.0, 0.0);
    let mut model = retained_regions::RegionModel::new(&request).unwrap();
    let source_pass = GeometryPass::new(
        request.key.world,
        request.key.canvas,
        request.key.zoom,
        request.key.pan,
    );
    let mut commands = Commands::default();
    for (bbox, geometry, style) in &records {
        commands.0.clear();
        source_pass.draw(*geometry, style, &mut commands);
        assert!(model.push(*bbox, *geometry, *style, &commands.0));
    }
    assert!(model.is_recomposable());

    let mut current = fixture.request(1.0, 1.0);
    current.key = request.key.clone();
    current.pattern_textures = Arc::clone(&request.pattern_textures);
    current.key.pan = egui::vec2(4.0, 3.0);
    current.key.viewport = screen_to_world_rect(
        current.key.canvas,
        current.key.world,
        current.key.canvas,
        current.key.zoom,
        current.key.pan,
    );
    let target_commands = project(&records, &current.key);
    assert!(target_commands
        .iter()
        .any(|command| matches!(command, PaintCommand::PatternRect { .. })));
    let target = pixels(
        &mut renderer,
        &current,
        managed_meshes(&current, &target_commands),
    );
    let sentinel =
        vec![0x5a; current.key.screen_size[0] as usize * current.key.screen_size[1] as usize * 4];
    let (regions, composed, repaired) =
        compose_and_repair(&mut renderer, &current, &model, &sentinel);
    let mut compared = 0;
    let mut foreground = 0;
    for clip in regions.clips() {
        for row in clip.top() as usize..clip.bottom() as usize {
            for column in clip.left() as usize..clip.right() as usize {
                let offset = ((current.key.screen_size[1] as usize - 1 - row)
                    * current.key.screen_size[0] as usize
                    + column)
                    * 4;
                assert_ne!(&composed[offset..offset + 4], &[0x5a; 4]);
                foreground +=
                    usize::from(composed[offset..offset + 4] != current.key.background.to_array());
                compared += 1;
            }
        }
    }
    if certified {
        assert!(
            compared >= 10_000,
            "vacuous certified CPU region: {compared}"
        );
        assert!(
            foreground > 0,
            "certified CPU plan retained only background"
        );
    }
    assert_current_pixels(
        &repaired,
        &target,
        &current,
        &target_commands,
        certified,
        "managed patterns plus repairs must match the complete target",
    );
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
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_models_reject_visible_grid_overlays_and_mesh_fallback() {
    let mut renderer = offscreen::OffscreenRenderer::new("").expect("retained oracle requires EGL");
    let mut fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let scene = if renderer.with_context(|gl| sparse_rects::certified_profile(gl)) {
        renderer.build_sparse_updates(&request, || true, |_, _| {})
    } else {
        renderer.build_streaming_updates(&request, || true, |_, _| {}, None)
    }
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
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn retained_capture_presents_only_valid_current_pixels_and_keeps_full_completion_separate() {
    let mut renderer = offscreen::OffscreenRenderer::new("").expect("retained oracle requires EGL");
    let fixture = Fixture::new();
    let mut request = fixture.request(0.05, 1.0);
    request.layer_ids = vec![2];
    let mut source_commands = Vec::new();
    let mut source = builder::build_command_stream(&request, &|| true, |packet| {
        if let builder::PaintPacket::Commands(paint) = packet {
            source_commands.extend(paint);
        }
        true
    })
    .unwrap();
    source.bitmap = Some(
        pixels(
            &mut renderer,
            &request,
            managed_meshes(&request, &source_commands),
        )
        .into(),
    );
    let model = source
        .retained
        .as_ref()
        .expect("complete world input retained");
    assert!(model.byte_len() > 0);
    assert!(
        !source.labels_ready(),
        "the retained source must not pre-complete label recovery"
    );
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
    let regions = renderer
        .with_context(|gl| model.prepare_for_gl(&current.key, 4, gl))
        .unwrap();
    assert!(!regions.clips().is_empty());
    let mut commands = Vec::new();
    builder::build_command_stream(&current, &|| true, |packet| {
        if let builder::PaintPacket::Commands(paint) = packet {
            commands.extend(paint);
        }
        true
    })
    .unwrap();
    let target_meshes = managed_meshes(&current, &commands);
    let target = pixels(&mut renderer, &current, target_meshes);
    let source = Arc::new(source);
    renderer.with_context(|gl| {
        let presentation = crate::app::cpu_raster::test_support::Presentation::new(
            Arc::clone(gl),
            &request.key,
            fixture.ctx.clone(),
        );
        presentation.paint(Some(&source), &request.key, None);
        let actual = presentation.paint_until_retained(None, &current.key, None);
        assert_eq!(
            actual, target,
            "target composition plus ordered GL repairs presents every current pixel"
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
