use super::*;
use std::sync::atomic::AtomicUsize;
use std::sync::Barrier;

#[test]
fn layer_schedule_builds_a_ready_layer_while_the_first_query_is_blocked() {
    let (release, waiting) = mpsc::channel();
    let waiting = Mutex::new(waiting);
    let ready_builds = AtomicUsize::new(0);
    let mut output = Vec::new();
    let result = schedule::run(
        &[0, 1],
        2,
        &|| true,
        |layer| {
            if layer == 0 {
                waiting
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .expect("later-layer preparation must not wait for the head query");
                vec![0; 100]
            } else {
                vec![1; 20_000]
            }
        },
        |ids| {
            if ids[0] == 1 && ready_builds.fetch_add(1, Ordering::SeqCst) + 1 == 4 {
                // Fill every lookahead credit before allowing the first query
                // back. Its reserved credit must still permit forward progress.
                release.send(()).unwrap();
            }
            Some(ids)
        },
        |ids| {
            output.extend(ids);
            true
        },
    );
    assert!(result.is_some());
    assert_eq!(output, [vec![0; 100], vec![1; 20_000]].concat());
    assert!(ready_builds.load(Ordering::SeqCst) >= 4);
}

#[test]
fn layer_schedule_prefers_frontier_and_round_robins_when_frontier_is_blocked() {
    let mut state = Preparation::new(4, 8);
    for layer in &mut state.layers {
        layer.queried(vec![1; 50_000], 8);
    }
    let ranks = (0..8)
        .map(|_| state.take_build().unwrap().rank)
        .collect::<Vec<_>>();
    assert_eq!(ranks, [0; 8], "ready frontier receives the worker group");
    assert!(state.take_build().is_none(), "active-build limit");
    let mut state = Preparation::new(4, 8);
    for layer in &mut state.layers[1..] {
        layer.queried(vec![1; 50_000], 8);
    }
    let ranks = (0..8)
        .map(|_| state.take_build().unwrap().rank)
        .collect::<Vec<_>>();
    assert_eq!(ranks, [1, 2, 3, 1, 2, 3, 1, 2]);
    state.running_builds = 0;
    state.layers[0].queried(vec![0; 10], 8);
    assert_eq!(state.take_build().unwrap().rank, 0);
    state.running_builds -= 1;
    assert_eq!(
        state.take_build().unwrap().rank,
        1,
        "spare workers prepare later layers after all frontier IDs are dispatched"
    );
    let mut state = Preparation::new(3, 2);
    state.layers[1].queried(vec![1; 50_000], 2);
    for _ in 0..4 {
        assert_eq!(state.take_build().unwrap().rank, 1);
        state.running_builds -= 1;
    }
    assert!(
        state.take_build().is_none(),
        "later output storage is bounded"
    );
    state.layers[0].queried(vec![0; 50_000], 2);
    assert_eq!(state.take_build().unwrap().rank, 0);
    assert_eq!(state.outstanding, 5);
    assert_eq!(state.take_build().unwrap().rank, 0);
    assert_eq!(state.outstanding, 6);
    state.running_builds -= 1;
    assert!(
        state.take_build().is_none(),
        "the frontier gets one whole worker group of extra credit"
    );
}

#[test]
fn layer_schedule_saturated_lookahead_keeps_a_whole_frontier_worker_group_busy() {
    let (release, waiting) = mpsc::channel();
    let waiting = Mutex::new(waiting);
    let later = AtomicUsize::new(0);
    let live = (Mutex::new(0), Condvar::new());
    let mut output = Vec::new();
    assert!(schedule::run(
        &[0, 1],
        8,
        &|| true,
        |layer| {
            if layer == 0 {
                waiting
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                vec![0; 50_000]
            } else {
                vec![1; 100_000]
            }
        },
        |ids| {
            if ids[0] == 1 {
                if later.fetch_add(1, Ordering::SeqCst) + 1 == 16 {
                    release.send(()).unwrap();
                }
            } else {
                let mut count = live.0.lock().unwrap();
                *count += 1;
                live.1.notify_all();
                let (count, _) = live
                    .1
                    .wait_timeout_while(count, Duration::from_secs(3), |count| *count < 8)
                    .unwrap();
                assert!(*count >= 8, "saturated lookahead serialized the frontier");
            }
            Some(ids)
        },
        |ids| {
            output.extend(ids);
            true
        }
    )
    .is_some());
    assert_eq!(output, [vec![0; 50_000], vec![1; 100_000]].concat());
}

#[test]
fn layer_schedule_bounds_query_concurrency_and_prepared_output_storage() {
    for workers in [0usize, 1, 2, 8, 32] {
        let query_workers = workers.clamp(2, 4);
        let barrier = Barrier::new(query_workers);
        let query_live = AtomicUsize::new(0);
        let query_peak = AtomicUsize::new(0);
        let prepared_live = AtomicUsize::new(0);
        let prepared_peak = AtomicUsize::new(0);
        let layers = (0..12).collect::<Vec<_>>();
        let mut count = 0;
        let result = schedule::run(
            &layers,
            workers,
            &|| true,
            |layer| {
                let live = query_live.fetch_add(1, Ordering::SeqCst) + 1;
                query_peak.fetch_max(live, Ordering::SeqCst);
                if (layer as usize) < query_workers {
                    barrier.wait();
                }
                query_live.fetch_sub(1, Ordering::SeqCst);
                vec![u64::from(layer); 12_000]
            },
            |ids| {
                let live = prepared_live.fetch_add(1, Ordering::SeqCst) + 1;
                prepared_peak.fetch_max(live, Ordering::SeqCst);
                Some(ids)
            },
            |ids| {
                count += ids.len();
                prepared_live.fetch_sub(1, Ordering::SeqCst);
                true
            },
        );
        assert!(result.is_some());
        assert_eq!(count, 12 * 12_000);
        assert_eq!(query_peak.load(Ordering::SeqCst), query_workers);
        assert!(prepared_peak.load(Ordering::SeqCst) <= 3 * workers.clamp(1, 8));
        assert_eq!(prepared_live.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn layer_schedule_preserves_requested_order_duplicates_and_empty_layers() {
    for workers in [1, 2, 8] {
        let layers = [2, 0, 1, 2];
        let query = |layer| {
            (0..u64::from(layer) * 5_000)
                .map(|index| u64::from(layer) * 10_000 + index / 2)
                .collect::<Vec<_>>()
        };
        let expected = layers.into_iter().flat_map(query).collect::<Vec<_>>();
        let mut actual = Vec::new();
        assert!(schedule::run(
            &layers,
            workers,
            &|| true,
            query,
            |ids| {
                assert!(!ids.is_empty() && ids.len() <= MAX_IDS);
                Some(ids)
            },
            |ids| {
                actual.extend(ids);
                true
            }
        )
        .is_some());
        assert_eq!(actual, expected);
    }
}

#[test]
fn layer_schedule_cancellation_rejects_late_results_and_stops_new_queries() {
    let current = AtomicBool::new(true);
    let queries = AtomicUsize::new(0);
    let result = schedule::run(
        &(0..64).collect::<Vec<_>>(),
        2,
        &|| current.load(Ordering::Acquire),
        |_| {
            queries.fetch_add(1, Ordering::SeqCst);
            current.store(false, Ordering::Release);
            vec![1; 10_000]
        },
        |_| panic!("cancelled query must not build"),
        |_: ()| panic!("cancelled result must not publish"),
    );
    assert!(result.is_none());
    assert!(queries.load(Ordering::SeqCst) <= 2);
    assert!(schedule::run(&[], 0, &|| false, |_| Vec::new(), Some, |_| true).is_none());
    assert_eq!(
        schedule::run(&[], 0, &|| true, |_| Vec::new(), Some, |_| true),
        Some(Duration::ZERO)
    );
}

#[test]
fn layer_schedule_failures_release_pending_workers_without_consumer_ack() {
    for failure in [0, 1, 100] {
        let mut count = 0;
        assert!(schedule::run(
            &[0, 1, 2, 3],
            4,
            &|| true,
            |_| vec![1; 100_000],
            Some,
            |_| {
                count += 1;
                count != failure + 1
            }
        )
        .is_none());
    }
    assert!(schedule::run(
        &[0, 1, 2],
        4,
        &|| true,
        |_| vec![1],
        |_| None::<()>,
        |_| true
    )
    .is_none());
}

#[test]
fn layer_schedule_query_and_builder_panics_release_scoped_workers() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    for query_panic in [false, true] {
        let result = catch_unwind(AssertUnwindSafe(|| {
            schedule::run(
                &[0, 1, 2],
                4,
                &|| true,
                |layer| {
                    assert!(!query_panic || layer != 0, "query failure");
                    vec![1; 1000]
                },
                |_| {
                    assert!(query_panic, "build failure");
                    Some(())
                },
                |_| true,
            )
        }));
        assert!(result.is_err());
    }
}

#[test]
fn layer_schedule_query_lookahead_stays_inside_its_fixed_window() {
    let mut preparation = Preparation::new(64, 8);
    assert_eq!(preparation.query_limit(), 8);
    preparation.frontier = 12;
    assert_eq!(preparation.query_limit(), 20);
    preparation.frontier = 63;
    assert_eq!(preparation.query_limit(), 64);
}

#[test]
fn layer_schedule_consumer_panic_does_not_leave_idle_workers_blocked() {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    let result = catch_unwind(AssertUnwindSafe(|| {
        schedule::run(
            &[0, 1, 2, 3],
            4,
            &|| true,
            |_| vec![1; 50_000],
            Some,
            |_| panic!("consumer failed"),
        )
    }));
    assert!(result.is_err());
}

#[test]
fn layer_schedule_same_binary_baseline_preserves_identical_ordered_contributions() {
    let layers = [3, 0, 1, 3, 2];
    let query = |layer| {
        (0..u64::from(layer) * 9_001)
            .map(|id| (u64::from(layer) << 32) | id)
            .collect::<Vec<_>>()
    };
    let mut reference = Vec::new();
    assert!(baseline::run(&layers, 4, &|| true, query, Some, |ids| {
        reference.extend(ids);
        true
    })
    .is_some());
    let mut actual = Vec::new();
    assert!(schedule::run(&layers, 4, &|| true, query, Some, |ids| {
        actual.extend(ids);
        true
    })
    .is_some());
    assert_eq!(actual, reference);
}

#[cfg(target_os = "linux")]
#[test]
fn layer_schedule_actual_gl_matches_baseline_with_translucent_overlapping_layers() {
    use crate::app::cpu_scene::{builder, offscreen, tests::Fixture};
    let fixture = Fixture::new();
    let mut request = fixture.request(1.0, 1.0);
    request.layer_ids = vec![2, 1, 2];
    for style in request.layers.style_map.values_mut() {
        style.fill_pattern = chip_display::FillPattern::Solid;
        style.rgba[3] = 112;
        style.frame_rgba[3] = 173;
    }
    let prepare = |scheduled: bool| {
        let mut scene = builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
        let query = |layer| {
            request
                .db
                .query_cached_layer_intersect(layer, request.key.viewport)
        };
        let build = |ids: Vec<ShapeId>| {
            build_chunk(
                &request,
                &ids,
                &|| true,
                geometry::GeometryOutput::ExactRaster,
            )
        };
        let consume = |chunk: CpuScene| {
            scene.meshes.extend(chunk.meshes);
            true
        };
        let result = if scheduled {
            schedule::run(&request.layer_ids, 4, &|| true, query, build, consume)
        } else {
            baseline::run(&request.layer_ids, 4, &|| true, query, build, consume)
        };
        assert!(result.is_some());
        scene
    };
    let reference = prepare(false);
    let actual = prepare(true);
    let mut renderer =
        offscreen::OffscreenRenderer::new("").expect("layer-order oracle requires actual EGL");
    let expected = renderer
        .rasterize_updates(&reference, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    let got = renderer
        .rasterize_updates(&actual, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    assert!(expected
        .chunks_exact(4)
        .any(|pixel| pixel != request.key.background.to_array()));
    assert_eq!(
        got, expected,
        "concurrent layer preparation must not reorder source-over operations"
    );
}

#[test]
#[ignore = "requires ECOS_COVERAGE_MANIFEST; production command preparation attribution, no GL"]
fn layer_schedule_real_design_command_stream_cost() {
    use crate::app::cpu_scene::{builder, tests::Fixture};
    let path = std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
    let fixture = Fixture::new();
    let opened = Instant::now();
    let db = Arc::new(ChipViewDb::open(path).unwrap());
    let open_ms = opened.elapsed().as_secs_f64() * 1000.0;
    let world = db.stats().bbox.unwrap();
    let visibility_by_layer = db
        .layer_catalog()
        .into_iter()
        .map(|layer| (layer.layer_id, true))
        .collect();
    let layers = layer_ui_states(&db, &visibility_by_layer, chip_display::ColorTheme::Foundry);
    for zoom in [1.0, 2.612572] {
        let mut request = fixture.request(zoom, 1.0);
        request.db = Arc::clone(&db);
        request.data_bounds = Some(world);
        request.layers = LayerRenderIndex::new(&layers);
        request.grid_layers = layers.clone();
        request.zoom_rules = ZoomVisibilityRules::new(&db);
        request.layer_ids = render_query_layer_ids(&layers, request.key.visibility);
        request.key.world = world;
        request.key.grid_bounds = world;
        request.key.screen_size = [2048, 1280];
        request.key.canvas =
            egui::Rect::from_min_max(egui::pos2(320.0, 8.0), egui::pos2(1676.0, 1254.0));
        request.key.viewport = screen_to_world_rect(
            request.key.canvas,
            world,
            request.key.canvas,
            zoom,
            egui::Vec2::ZERO,
        );
        let started = Instant::now();
        let mut packets = 0;
        let mut commands = 0;
        let mut largest_packet = 0;
        let mut first_packet_ms = None;
        let scene = builder::build_command_stream(
            &request,
            &|| started.elapsed() < Duration::from_secs(120),
            |packet| {
                if let builder::PaintPacket::Commands(paint) = packet {
                    packets += 1;
                    commands += paint.len();
                    largest_packet = largest_packet.max(paint.len());
                    first_packet_ms.get_or_insert_with(|| started.elapsed().as_secs_f64() * 1000.0);
                }
                true
            },
        )
        .expect("production command stream must complete within diagnostic timeout");
        assert!(scene.drawn > 0 && commands > 0);
        eprintln!(
            "{}",
            serde_json::json!({
                "diagnostic_only": true,
                "scheduler": std::env::var_os("ECOS_DISABLE_LAYER_SCHEDULER").is_none(),
                "zoom": zoom, "db_open_ms": open_ms,
                "workers": builder::worker_count(), "layers": request.layer_ids.len(),
                "elapsed_ms": started.elapsed().as_secs_f64() * 1000.0,
                "pipeline_ms": scene.pipeline_duration.as_secs_f64() * 1000.0,
                "build_ms": scene.build_duration.as_secs_f64() * 1000.0,
                "query_summed_ms": scene.query_duration.as_secs_f64() * 1000.0,
                "filter_max_ms": scene.filter_duration.as_secs_f64() * 1000.0,
                "drawn": scene.drawn, "primitives": scene.primitives,
                "packets": packets, "commands": commands, "largest_packet": largest_packet,
                "first_packet_ms": first_packet_ms,
                "priority_bytes": scene.priority.as_ref().map_or(0, |cache| cache.byte_len()),
                "retained_bytes": scene.retained.as_ref().map_or(0, |model| model.byte_len()),
            })
        );
    }
}
