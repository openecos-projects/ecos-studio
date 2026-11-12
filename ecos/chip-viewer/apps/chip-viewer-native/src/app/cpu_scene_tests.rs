use super::*;
use crate::app::tests::{
    layer_state, temp_snapshot_dir, write_empty_geometry_file, write_empty_snapshot,
};
use chipgeom_format::{GeometryFileKind, GeometryMetaRecord, LinePayload, PointPayload};

#[path = "cpu_camera_tests.rs"]
mod camera_tests;

#[path = "cpu_overlay_tests.rs"]
mod overlay_tests;

#[path = "cpu_progress_tests.rs"]
mod progress_tests;

#[path = "cpu_geometry_tests.rs"]
mod geometry_tests;

#[cfg(target_os = "linux")]
#[path = "cpu_pixel_rect_tests.rs"]
mod pixel_rect_tests;

#[path = "cpu_pipeline_tests.rs"]
mod pipeline_tests;

#[cfg(target_os = "linux")]
#[path = "cpu_present_targets_tests.rs"]
mod present_targets_tests;

#[path = "cpu_labels_parallel_tests.rs"]
mod labels_parallel_tests;

#[path = "cpu_label_worker_tests.rs"]
mod label_worker_tests;

struct Fixture {
    path: PathBuf,
    db: Arc<ChipViewDb>,
    ctx: egui::Context,
    layers: LayerRenderIndex,
}

impl Fixture {
    fn new() -> Self {
        let path = temp_snapshot_dir("cpu-exact-scene");
        write_empty_snapshot(&path, false);
        let owners: Vec<_> = [
            OwnerType::InstanceBBox,
            OwnerType::NetWireSegment,
            OwnerType::Via,
            OwnerType::Obs,
            OwnerType::Fill,
            OwnerType::Row,
        ]
        .into_iter()
        .enumerate()
        .map(|(index, owner_type)| OwnerRef {
            owner_type: owner_type as u8,
            owner_id: index as u64 + 1,
            ..Default::default()
        })
        .collect();
        let mut shapes: Vec<_> = owners
            .iter()
            .enumerate()
            .map(|(index, _)| ShapeRecord {
                id: index as u64 + 1,
                layer_id: (index % 2 + 1) as u16,
                owner_index: index as u32,
                kind: ShapeKind::Rect as u8,
                state: ShapeState::Alive as u8,
                bbox: Rect32 {
                    lx: index as i32 * 35,
                    ly: 30,
                    hx: 800,
                    hy: 700,
                },
                ..Default::default()
            })
            .collect();
        let line = LinePayload {
            begin: Point32 { x: 20, y: 600 },
            end: Point32 { x: 950, y: 100 },
            width: 6,
            ..Default::default()
        };
        let point = PointPayload {
            point: Point32 { x: 430, y: 340 },
            ..Default::default()
        };
        let mut payload = bytemuck::bytes_of(&line).to_vec();
        payload.extend_from_slice(bytemuck::bytes_of(&point));
        for (kind, offset, size) in [
            (ShapeKind::Line, 0, size_of::<LinePayload>()),
            (
                ShapeKind::Point,
                size_of::<LinePayload>(),
                size_of::<PointPayload>(),
            ),
        ] {
            shapes.push(ShapeRecord {
                id: shapes.len() as u64 + 1,
                kind: kind as u8,
                layer_id: 1,
                state: ShapeState::Alive as u8,
                payload_offset: offset as u64,
                payload_size: size as u32,
                bbox: Rect32 {
                    lx: 0,
                    ly: 0,
                    hx: 1000,
                    hy: 1000,
                },
                ..Default::default()
            });
        }
        let mut deleted = shapes[0];
        deleted.id = 99;
        deleted.state = ShapeState::Deleted as u8;
        shapes.push(deleted);
        let meta = GeometryMetaRecord {
            shape_count: shapes.len() as u64,
            owner_count: owners.len() as u64,
            payload_size: payload.len() as u64,
            ..Default::default()
        };
        let sidmap: Vec<_> = shapes
            .iter()
            .map(|shape| chipgeom_format::GeometrySidMapRecord {
                shape_id: shape.id,
                owner: owners[shape.owner_index as usize],
            })
            .collect();
        for (name, kind, size, bytes) in [
            (
                "meta",
                GeometryFileKind::Meta,
                size_of::<GeometryMetaRecord>(),
                bytemuck::bytes_of(&meta),
            ),
            (
                "shapes",
                GeometryFileKind::Shapes,
                size_of::<ShapeRecord>(),
                bytemuck::cast_slice(&shapes),
            ),
            (
                "owners",
                GeometryFileKind::Owners,
                size_of::<OwnerRef>(),
                bytemuck::cast_slice(&owners),
            ),
            ("payload", GeometryFileKind::Payload, 1, payload.as_slice()),
            (
                "sidmap",
                GeometryFileKind::SidMap,
                size_of::<chipgeom_format::GeometrySidMapRecord>(),
                bytemuck::cast_slice(&sidmap),
            ),
        ] {
            write_empty_geometry_file(
                &path.join(format!("geometry.{name}.bin")),
                kind,
                size as u32,
                bytes,
            );
        }
        let tile = chipgeom_format::GeometryViewTileRecord::default();
        write_empty_geometry_file(
            &path.join("geometry.view.bin"),
            GeometryFileKind::View,
            size_of::<chipgeom_format::GeometryViewTileRecord>() as u32,
            bytemuck::bytes_of(&tile),
        );
        let manifest_path = path.join("geometry.manifest");
        let manifest = fs::read_to_string(&manifest_path)
            .unwrap()
            .replace("shape_count=0", &format!("shape_count={}", shapes.len()))
            .replace("owner_count=0", &format!("owner_count={}", owners.len()))
            .replace("payload_size=0", &format!("payload_size={}", payload.len()));
        fs::write(&manifest_path, manifest).unwrap();
        let ctx = egui::Context::default();
        let _output = ctx.run(egui::RawInput::default(), |_| {});
        Self {
            path,
            db: Arc::new(ChipViewDb::open(manifest_path).unwrap()),
            ctx,
            layers: LayerRenderIndex::new(&[layer_state(1, true), layer_state(2, true)]),
        }
    }

    fn request(&self, zoom: f32, pixels_per_point: f32) -> SceneRequest {
        let mut visibility = ObjectVisibility::default();
        visibility.set_all_visible(true);
        let world = Rect32 {
            lx: 0,
            ly: 0,
            hx: 1000,
            hy: 1000,
        };
        let tessellation = egui::epaint::TessellationOptions::default();
        let (font_texture_size, tessellator) = self.ctx.fonts(|fonts| {
            let atlas = fonts.texture_atlas();
            let atlas = atlas.lock();
            (
                atlas.size(),
                egui::epaint::Tessellator::new(
                    pixels_per_point,
                    tessellation,
                    atlas.size(),
                    atlas.prepared_discs(),
                ),
            )
        });
        SceneRequest {
            key: SceneKey {
                epoch: 1,
                layers: 1,
                visibility,
                world,
                viewport: world,
                canvas: egui::Rect::from_min_max(egui::pos2(10.0, 20.0), egui::pos2(510.0, 420.0)),
                zoom,
                pan: egui::Vec2::ZERO,
                pixels_per_point,
                tessellation,
                font_texture_size,
                selected: None,
                highlighted: BTreeSet::new(),
                screen_size: [640, 480],
                background: egui::Color32::BLACK,
                grid_bounds: world,
                cache_overlays: false,
            },
            db: Arc::clone(&self.db),
            layer_ids: vec![1, 2],
            layers: self.layers.clone(),
            zoom_rules: ZoomVisibilityRules::new(&self.db),
            tessellator,
            repaint: self.ctx.clone(),
            glow: false,
            glow_renderer: None,
            label_fonts: egui::FontDefinitions::default(),
            label_texture_side: 2048,
            overlay_labels: ShapeLabelCollector::default(),
            grid_layers: vec![layer_state(1, true), layer_state(2, true)],
            publication: progress::Publication::Progressive,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).unwrap();
    }
}

#[test]
fn cached_mesh_matches_original_rect_line_point_draw_order_and_colors() {
    let fixture = Fixture::new();
    for (zoom, pixels_per_point) in [(1.0, 1.0), (2.0, 1.5)] {
        let mut request = fixture.request(zoom, pixels_per_point);
        let scene = build_scene(&mut request, || true).unwrap();
        let key = &request.key;
        let mut drawn = 0;
        let output = fixture.ctx.run(
            egui::RawInput {
                screen_rect: Some(key.canvas),
                ..Default::default()
            },
            |ctx| {
                let painter = ctx
                    .layer_painter(egui::LayerId::background())
                    .with_clip_rect(key.canvas);
                for shape_id in fixture
                    .db
                    .query_layers_intersect(&request.layer_ids, key.viewport)
                {
                    let shape = fixture.db.find_shape(shape_id).unwrap();
                    let owner = fixture.db.owner_for_shape(shape);
                    let owner_type = owner.and_then(|owner| OwnerType::from_raw(owner.owner_type));
                    let category =
                        owner.and_then(|owner| drawing_category_for_owner(&fixture.db, owner));
                    if !is_renderable_shape(shape)
                        || !request.zoom_rules.is_drawn_at_zoom(owner_type, zoom)
                        || !shape_is_visible_fast(
                            shape,
                            owner_type,
                            category,
                            &request.layers,
                            &key.visibility,
                        )
                    {
                        continue;
                    }
                    let style =
                        visible_style_for_shape_fast(shape, owner, owner_type, &request.layers)
                            .unwrap();
                    if paint_styled_shape_geometry(
                        &painter,
                        fixture.db.shape_geometry(shape),
                        key.world,
                        key.canvas,
                        zoom,
                        key.pan,
                        &style,
                    ) > 0
                    {
                        drawn += 1;
                    }
                }
            },
        );
        let expected = fixture.ctx.fonts(|fonts| {
            let atlas = fonts.texture_atlas();
            let atlas = atlas.lock();
            egui::epaint::Tessellator::new(
                pixels_per_point,
                key.tessellation,
                atlas.size(),
                atlas.prepared_discs(),
            )
            .tessellate_shapes(output.shapes)
        });
        assert_eq!(scene.drawn, drawn);
        let cached_output = fixture.ctx.run(
            egui::RawInput {
                screen_rect: Some(key.canvas),
                ..Default::default()
            },
            |ctx| {
                scene.paint(
                    &ctx.layer_painter(egui::LayerId::background())
                        .with_clip_rect(key.canvas),
                )
            },
        );
        let actual = fixture.ctx.fonts(|fonts| {
            let atlas = fonts.texture_atlas();
            let atlas = atlas.lock();
            egui::epaint::Tessellator::new(
                pixels_per_point,
                key.tessellation,
                atlas.size(),
                atlas.prepared_discs(),
            )
            .tessellate_shapes(cached_output.shapes)
        });
        let meshes = |primitives: Vec<egui::ClippedPrimitive>| {
            primitives
                .into_iter()
                .map(|primitive| {
                    let egui::epaint::Primitive::Mesh(mesh) = primitive.primitive else {
                        panic!("unexpected callback in exact geometry");
                    };
                    (primitive.clip_rect, mesh)
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(meshes(actual), meshes(expected));
    }
}

#[test]
fn cancelled_scene_never_reaches_the_ui() {
    let fixture = Fixture::new();
    assert!(build_scene(&mut fixture.request(1.0, 1.0), || false).is_none());
}

#[test]
fn cancellation_after_streaming_geometry_discards_the_built_meshes() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let fixture = Fixture::new();
    let checks = AtomicUsize::new(0);
    let scene = builder::build_with_workers(
        &fixture.request(1.0, 1.0),
        &|| checks.fetch_add(1, Ordering::Relaxed) < 3,
        1,
    );
    assert!(scene.is_none());
    assert!(checks.load(Ordering::Relaxed) >= 4);
}

#[test]
fn background_label_layout_matches_ui_with_selection_dpi_and_font_changes() {
    let fixture = Fixture::new();
    let mut resolver = labels::LabelResolver::default();
    for pixels_per_point in [1.0, 1.5, 2.0] {
        for reverse_fonts in [false, true] {
            let mut request = fixture.request(1.0, pixels_per_point);
            if reverse_fonts {
                request
                    .label_fonts
                    .families
                    .get_mut(&egui::FontFamily::Proportional)
                    .unwrap()
                    .reverse();
            }
            let mut collector = ShapeLabelCollector::default();
            for (index, kind) in [
                ShapeLabelKind::Instance,
                ShapeLabelKind::Pin,
                ShapeLabelKind::IoPin,
                ShapeLabelKind::Net,
                ShapeLabelKind::Pdn,
            ]
            .into_iter()
            .enumerate()
            {
                let candidate = ShapeLabelCandidate {
                    key: ShapeLabelKey::Owner {
                        owner_type: kind as u8,
                        owner_id: index as u64,
                    },
                    anchor_rect: egui::Rect::from_min_size(
                        egui::pos2(25.0 + index as f32 * 20.0, 40.0 + index as f32 * 40.0),
                        egui::vec2(180.0, 60.0),
                    ),
                    text: format!("cell{index}/data_buffer[123]"),
                    kind,
                    rank_area: 10800.0,
                    selected: false,
                    highlighted: index == 1,
                };
                collector.insert(candidate.clone());
                if index == 0 {
                    let mut selected = candidate;
                    selected.selected = true;
                    request.overlay_labels.insert(selected);
                }
            }
            let reference_fonts = egui::epaint::Fonts::new(
                pixels_per_point,
                request.label_texture_side,
                request.label_fonts.clone(),
            );
            let expected = collector.resolve_with(
                &request.overlay_labels,
                request.key.canvas,
                |text, size| {
                    reference_fonts
                        .layout_no_wrap(
                            text.to_owned(),
                            egui::FontId::proportional(size),
                            egui::Color32::WHITE,
                        )
                        .size()
                },
            );
            assert!(!expected.labels.is_empty());
            assert!(expected.labels.iter().any(|label| label.selected));
            let actual = resolver.resolve(&request, &collector, || true).unwrap();
            assert_eq!(actual, expected);
            assert_eq!(
                resolver.resolve(&request, &collector, || true),
                Some(expected)
            );
            assert!(resolver.resolve(&request, &collector, || false).is_none());
        }
    }
}

#[test]
fn idle_repaint_reuses_scene_and_visibility_changes_discard_stale_results() {
    let fixture = Fixture::new();
    let mut cache = CpuSceneCache::default();
    assert!(cache.get_or_request(fixture.request(1.0, 1.0)).is_none());
    let wait_for_scene = |cache: &mut CpuSceneCache| {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(scene) = cache.get_or_request(fixture.request(1.0, 1.0)) {
                break scene;
            }
            assert!(Instant::now() < deadline, "scene worker did not finish");
            thread::sleep(Duration::from_millis(5));
        }
    };
    let first = wait_for_scene(&mut cache);
    let second = wait_for_scene(&mut cache);
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(cache.inbox.generation.load(Ordering::Relaxed), 1);
    let mut hidden = fixture.request(1.0, 1.0);
    hidden.key.visibility.set_all_visible(false);
    assert!(cache.get_or_request(hidden).is_none());
    let refreshed = wait_for_scene(&mut cache);
    assert_eq!(first.drawn, refreshed.drawn);
    assert!(!Arc::ptr_eq(&first, &refreshed));
    assert_eq!(cache.inbox.generation.load(Ordering::Relaxed), 3);
}

#[test]
fn scene_key_tracks_geometry_camera_labels_dpi_and_tessellation() {
    let fixture = Fixture::new();
    let key = fixture.request(1.0, 1.0).key;
    let mut replacements = Vec::new();
    let mut changed = key.clone();
    changed.epoch += 1;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.layers += 1;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.zoom = 2.0;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.pan.x += 1.0;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.canvas.max.x += 1.0;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.world.hx += 1;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.pixels_per_point = 2.0;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.selected = Some(1);
    replacements.push(changed);
    let mut changed = key.clone();
    changed.highlighted.insert(1);
    replacements.push(changed);
    let mut changed = key.clone();
    changed.font_texture_size[1] += 1;
    replacements.push(changed);
    let mut changed = key.clone();
    changed.tessellation.feathering = false;
    replacements.push(changed);
    for changed in replacements {
        assert_ne!(key, changed);
    }
}

#[test]
fn returning_to_completed_anchor_reuses_exact_scene_without_rebuilding() {
    let fixture = Fixture::new();
    let mut cache = CpuSceneCache::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    let first = loop {
        if let Some(scene) = cache.get_or_request(fixture.request(1.0, 1.0)) {
            break scene;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    };
    assert!(cache.get_or_request(fixture.request(2.0, 1.0)).is_none());
    let restored = cache
        .get_or_request(fixture.request(1.0, 1.0))
        .expect("returning to a completed camera must not clear its exact scene");
    assert!(Arc::ptr_eq(&first, &restored));
}
