use super::*;

fn geometry_inbox(generation: u64) -> Arc<WorkerInbox> {
    Arc::new(WorkerInbox {
        request: Mutex::new(None),
        wake: Condvar::new(),
        generation: AtomicU64::new(generation),
        stopped: AtomicBool::new(false),
        #[cfg(target_os = "linux")]
        initial_evidence: progress::InitialEvidence::new(None),
    })
}

fn wait_for_labels(completed: &LabelCompletion) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while completed.get().is_none() {
        assert!(
            Instant::now() < deadline,
            "label worker never completed the current scene"
        );
        thread::sleep(Duration::from_millis(2));
    }
}

fn scene_with_candidate(request: &SceneRequest) -> CpuScene {
    let mut scene = builder::build_with_workers(request, &|| true, 1).unwrap();
    scene.labels.insert(ShapeLabelCandidate {
        key: ShapeLabelKey::Owner {
            owner_type: OwnerType::InstanceBBox as u8,
            owner_id: 901,
        },
        anchor_rect: request.key.canvas,
        text: "worker-owned-candidate".to_string(),
        kind: ShapeLabelKind::Instance,
        rank_area: request.key.canvas.area(),
        selected: true,
        highlighted: false,
    });
    scene
}

#[test]
fn label_job_shares_inputs_and_can_finish_after_geometry_scene_is_dropped() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.5);
    let scene = scene_with_candidate(&request);
    let expected = labels::LabelResolver::default()
        .resolve(&request, &scene.labels.snapshot(), || true)
        .unwrap();
    let completed = Arc::clone(&scene.completed_labels);
    let worker = labels::LabelWorker::new(geometry_inbox(7));
    worker.submit(&request, 7, &scene);
    worker.submit(&request, 7, &scene);
    drop(scene);
    wait_for_labels(&completed);
    assert_eq!(*completed.get().unwrap().0, expected);
}

#[test]
fn obsolete_generation_is_rejected_and_cached_unfinished_labels_can_resume() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.0);
    let scene = scene_with_candidate(&request);
    let expected = labels::LabelResolver::default()
        .resolve(&request, &scene.labels.snapshot(), || true)
        .unwrap();
    let inbox = geometry_inbox(9);
    let worker = labels::LabelWorker::new(Arc::clone(&inbox));
    worker.submit(&request, 8, &scene);
    assert!(!scene.labels_ready());
    worker.submit(&request, 9, &scene);
    inbox.generation.store(10, Ordering::Relaxed);
    worker.submit(&request, 10, &scene);
    wait_for_labels(&scene.completed_labels);
    assert_eq!(*scene.resolved_labels(), expected);
    let started = Instant::now();
    drop(worker);
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn full_ready_retires_raw_candidates_while_scene_and_cached_completion_stay_alive() {
    let fixture = Fixture::new();
    let request = fixture.request(2.612572, 1.0);
    let scene = Arc::new(scene_with_candidate(&request));
    let candidates = scene.labels.snapshot();
    assert!(!candidates.is_empty());
    let expected = labels::LabelResolver::default()
        .resolve(&request, &candidates, || true)
        .unwrap();
    assert!(!expected.labels.is_empty());
    let retired = Arc::downgrade(&candidates);
    drop(candidates);
    let completed = Arc::clone(&scene.completed_labels);
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&scene));
    let worker = labels::LabelWorker::new(geometry_inbox(11));
    worker.submit(&request, 11, &scene);
    wait_for_labels(&completed);
    assert!(retired.upgrade().is_none());
    assert!(scene.labels.snapshot().is_empty());
    assert_eq!(*scene.resolved_labels(), expected);
    let restored = history.get(&request.key).unwrap();
    assert_eq!(*restored.resolved_labels(), expected);
    worker.submit(&request, 11, &restored);
    assert_eq!(*restored.resolved_labels(), expected);
}

#[test]
fn shared_label_source_concurrent_retirement_keeps_the_complete_compact_cache() {
    use std::sync::Barrier;
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    for _ in 0..16 {
        let mut source = labels::Candidates::default();
        for id in 0..128 {
            source.insert(ShapeLabelCandidate {
                key: ShapeLabelKey::Owner {
                    owner_type: OwnerType::InstanceBBox as u8,
                    owner_id: id,
                },
                anchor_rect: request.key.canvas,
                text: format!("concurrent-retirement-{id}"),
                kind: ShapeLabelKind::Instance,
                rank_area: request.key.canvas.area(),
                selected: false,
                highlighted: false,
            });
        }
        let raw = source.snapshot();
        let retired = Arc::downgrade(&raw);
        let expected = raw.compact(request.key.canvas);
        let expected_bytes = expected.retained_bytes();
        let measure = |text: &str, size| egui::vec2(text.len() as f32 * size * 0.5, size);
        let expected = expected.resolve(request.key.canvas, measure);
        drop(raw);
        let barrier = Barrier::new(8);
        let cached = thread::scope(|scope| {
            let tasks: Vec<_> = (0..8)
                .map(|_| {
                    let (source, barrier) = (source.clone(), &barrier);
                    scope.spawn(move || {
                        barrier.wait();
                        drop(source.retire(request.key.canvas));
                        source.reusable().expect("compact source must be published")
                    })
                })
                .collect();
            tasks
                .into_iter()
                .map(|task| task.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert!(retired.upgrade().is_none());
        assert!(source.snapshot().is_empty());
        assert_eq!(source.byte_len(), expected_bytes);
        for cache in &cached {
            assert!(Arc::ptr_eq(cache, &cached[0]));
            assert_eq!(cache.resolve(request.key.canvas, measure), expected);
        }
    }
}

#[test]
fn selection_refresh_retires_cancelled_raw_source_and_charges_shared_history_entries() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let mut previous = scene_with_candidate(&request);
    let pixels: Arc<[u8]> = vec![0; 640 * 480 * 4].into();
    previous.bitmap = Some(Arc::clone(&pixels));
    let previous = Arc::new(previous);
    let worker = labels::LabelWorker::new(geometry_inbox(9));
    worker.submit(&request, 8, &previous);
    assert!(!previous.labels_ready());
    let raw = previous.labels.snapshot();
    assert!(!raw.is_empty());
    let previous_expected = labels::LabelResolver::default()
        .resolve(&request, &raw, || true)
        .unwrap();
    let retired = Arc::downgrade(&raw);
    let mut next = fixture.request(1.0, 1.0);
    next.key.selected = Some(1);
    let expected = labels::LabelResolver::default()
        .resolve(&next, &raw, || true)
        .unwrap();
    drop(raw);
    let mut history = history::CpuSceneHistory::default();
    history.insert(Arc::clone(&previous));
    let before = history.byte_len();
    let refreshed = builder::refresh_labels(
        &next,
        &previous,
        &mut labels::LabelResolver::default(),
        &|| true,
    )
    .unwrap();
    assert!(refreshed.labels_ready());
    assert_eq!(*refreshed.resolved_labels(), expected);
    assert!(Arc::ptr_eq(refreshed.bitmap.as_ref().unwrap(), &pixels));
    assert!(retired.upgrade().is_none());
    assert!(previous.labels.snapshot().is_empty());
    let compact = previous.labels.reusable().unwrap();
    let bytes = compact.retained_bytes();
    assert!(bytes > 0);
    assert_eq!(previous.labels.byte_len(), bytes);
    assert!(Arc::ptr_eq(&compact, &refreshed.labels.reusable().unwrap()));
    assert_eq!(history.byte_len(), before + bytes);
    let refreshed_bytes = pixels.len()
        + refreshed
            .retained
            .as_ref()
            .map_or(0, |model| model.byte_len())
        + refreshed
            .priority
            .as_ref()
            .map_or(0, |cache| cache.byte_len())
        + bytes;
    history.insert(Arc::new(refreshed));
    assert_eq!(history.byte_len(), before + bytes + refreshed_bytes);
    let restored = history.get(&next.key).unwrap();
    assert!(restored.labels.snapshot().is_empty());
    assert!(Arc::ptr_eq(&compact, &restored.labels.reusable().unwrap()));
    assert_eq!(*restored.resolved_labels(), expected);
    // The cancelled original scene still has no label completion. Restoring
    // that history key must consume the shared compact source after raw retire.
    let restored_previous = history.get(&request.key).unwrap();
    assert!(!restored_previous.labels_ready());
    worker.submit(&request, 9, &restored_previous);
    wait_for_labels(&restored_previous.completed_labels);
    assert_eq!(*restored_previous.resolved_labels(), previous_expected);
}

#[test]
fn cancelled_warm_label_marker_preserves_db_ordinary_labels_across_selection_refreshes() {
    use chipgeom_format::{GeometryFileKind, GeometryMetaRecord, GeometryNameRecord};
    let fixture = Fixture::new();
    let path = fixture.path.join("warm-source-named-labels");
    fs::create_dir_all(&path).unwrap();
    write_empty_snapshot(&path, false);
    let names = ["ordinary-first-net", "ordinary-other-net"];
    let owners: Vec<_> = names
        .iter()
        .enumerate()
        .map(|(index, _)| OwnerRef {
            owner_type: OwnerType::NetWireSegment as u8,
            owner_id: index as u64 + 1,
            name_id: index as u32 + 1,
            ..Default::default()
        })
        .collect();
    let shapes: Vec<_> = [
        Rect32 {
            lx: 50,
            ly: 50,
            hx: 450,
            hy: 350,
        },
        Rect32 {
            lx: 500,
            ly: 600,
            hx: 950,
            hy: 950,
        },
    ]
    .into_iter()
    .enumerate()
    .map(|(index, bbox)| ShapeRecord {
        id: index as u64 + 1,
        layer_id: index as u16 + 1,
        owner_index: index as u32,
        kind: ShapeKind::Rect as u8,
        state: ShapeState::Alive as u8,
        bbox,
        ..Default::default()
    })
    .collect();
    let mut text = Vec::new();
    let name_records: Vec<_> = names
        .iter()
        .zip(&owners)
        .map(|(name, owner)| {
            let record = GeometryNameRecord {
                owner_type: owner.owner_type,
                owner_id: owner.owner_id,
                name_offset: text.len() as u64,
                name_size: name.len() as u32,
                ..Default::default()
            };
            text.extend_from_slice(name.as_bytes());
            record
        })
        .collect();
    let meta = GeometryMetaRecord {
        shape_count: shapes.len() as u64,
        owner_count: owners.len() as u64,
        name_record_count: name_records.len() as u64,
        name_payload_size: text.len() as u64,
        next_shape_id: 3,
        ..Default::default()
    };
    let sidmap: Vec<_> = shapes
        .iter()
        .map(|shape| chipgeom_format::GeometrySidMapRecord {
            shape_id: shape.id,
            owner: owners[shape.owner_index as usize],
        })
        .collect();
    let tile = chipgeom_format::GeometryViewTileRecord::default();
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
        ("names", GeometryFileKind::Names, 1, text.as_slice()),
        (
            "name_index",
            GeometryFileKind::NameIndex,
            size_of::<GeometryNameRecord>(),
            bytemuck::cast_slice(&name_records),
        ),
        (
            "sidmap",
            GeometryFileKind::SidMap,
            size_of::<chipgeom_format::GeometrySidMapRecord>(),
            bytemuck::cast_slice(&sidmap),
        ),
        (
            "view",
            GeometryFileKind::View,
            size_of::<chipgeom_format::GeometryViewTileRecord>(),
            bytemuck::bytes_of(&tile),
        ),
    ] {
        write_empty_geometry_file(
            &path.join(format!("geometry.{name}.bin")),
            kind,
            size as u32,
            bytes,
        );
    }
    let manifest = path.join("geometry.manifest");
    let content = fs::read_to_string(&manifest)
        .unwrap()
        .replace("shape_count=0", "shape_count=2")
        .replace("owner_count=0", "owner_count=2");
    fs::write(&manifest, content).unwrap();
    let mut request = fixture.request(1.0, 1.0);
    request.db = Arc::new(ChipViewDb::open(manifest).unwrap());
    request.data_bounds = request.db.stats().bbox;
    request.zoom_rules = ZoomVisibilityRules::new(&request.db);
    assert!(request.overlay_labels.is_empty());
    let fresh = builder::build_with_workers(&request, &|| true, 1).unwrap();
    let ordinary = fresh.labels.snapshot();
    let mut resolver = labels::LabelResolver::default();
    let expected = resolver.resolve(&request, &ordinary, || true).unwrap();
    assert_eq!(expected.labels.len(), 2);
    assert!(expected.labels.iter().all(|label| !label.selected));

    let warm = builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    warm.labels.require_rebuild();
    let inbox = geometry_inbox(20);
    let worker = labels::LabelWorker::new(Arc::clone(&inbox));
    // Cancel the early generation before its submission can run. This leaves
    // exactly the empty raw source + rebuild marker of a cancelled warm job.
    inbox.generation.store(21, Ordering::Release);
    worker.submit(&request, 20, &warm);
    drop(worker);
    assert!(!warm.labels_ready());
    assert!(warm.labels.needs_rebuild());
    assert!(warm.labels.snapshot().is_empty());
    assert!(warm.labels.reusable().is_none());

    let mut previous = warm;
    let mut shared = None;
    for selected in [Some(1), Some(2), None] {
        let mut next = request.clone();
        next.key.selected = selected;
        let expected = resolver.resolve(&next, &ordinary, || true).unwrap();
        assert_eq!(expected.candidate_count, 2);
        assert_eq!(expected.labels.len(), 2);
        let refreshed = builder::refresh_labels(&next, &previous, &mut resolver, &|| true).unwrap();
        assert!(refreshed.labels_ready());
        assert_eq!(*refreshed.resolved_labels(), expected);
        assert!(!refreshed.labels.needs_rebuild());
        assert!(refreshed.labels.snapshot().is_empty());
        let reusable = refreshed.labels.reusable().unwrap();
        assert_eq!(refreshed.labels.byte_len(), reusable.retained_bytes());
        if let Some(first) = &shared {
            assert!(Arc::ptr_eq(first, &reusable));
        } else {
            shared = Some(reusable);
        }
        previous = refreshed;
    }
    assert_eq!(*previous.resolved_labels(), expected);
}

#[cfg(target_os = "linux")]
#[test]
fn labels_can_finish_before_the_geometry_raster_readback() {
    let fixture = Fixture::new();
    let request = fixture.request(1.0, 1.0);
    let worker = labels::LabelWorker::new(geometry_inbox(3));
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL label-overlap check unavailable");
        return;
    };
    let scene = renderer
        .build_streaming_scene_with_prepared(
            &request,
            || true,
            |_, _| {},
            |scene| {
                assert!(scene.bitmap.is_none());
                worker.submit(&request, 3, scene);
                wait_for_labels(&scene.completed_labels);
            },
        )
        .unwrap()
        .unwrap();
    assert!(scene.bitmap.is_some());
    assert!(scene.labels_ready());
}
