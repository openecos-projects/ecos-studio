use super::*;
use crate::replay_data::{read, tests::Fixture};
use serde_json::json;

fn app(fixture: &Fixture) -> ReplayApp {
    std::fs::create_dir_all(fixture.0.join("home")).unwrap();
    fixture.write(
        "home/flow.json",
        json!({"steps":[{"name":"place","state":"Success"}]}),
    );
    fixture.write("catalog.json", json!({
        "schema":"ecos.replay.catalog.v1", "workspace":fixture.0,
        "steps":[{"name":"place", "seconds":3600.0,
            "manifest":fixture.0.join("attempts/a/manifest.json"),"reason":"","metrics":[],"nodes":[]}]
    }));
    let mut app = ReplayApp::open(&fixture.0.join("catalog.json")).unwrap();
    let plans = app
        .preparation
        .take()
        .unwrap()
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    app.total = plans.iter().map(|plan| plan.seconds).sum();
    app.plans = plans;
    app.select(0, 0.0, false);
    app.finish_loading_for_test();
    app
}

#[test]
fn filler_rows_play_as_one_fast_sweep_with_exact_seeks_and_complete_highlights() {
    let fixture = Fixture::new();
    let mut manifest: serde_json::Value =
        read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
    let frames = manifest["frames"].as_array_mut().unwrap();
    frames.truncate(1);
    frames[0]["state_domain"] = json!("native_input");
    let mut touched = Vec::new();
    for i in 1..=42 {
        let row = i <= 41;
        frames.push(json!({
            "sequence":i,"elapsed_ns":i * 1_000_000_000u64,
            "phase":if row {"filler_row"} else {"committed_database"},
            "subflow":if row {"run filler"} else {"save results"},
            "state_domain":"native_committed","path":format!("frames/{i}.json"),
            "checkpoint":false
        }));
        let mut upsert = serde_json::Map::new();
        if row {
            let id = format!("inst:filler{i}");
            touched.push(id.clone());
            upsert.insert(
                id,
                json!({"kind":"instance","master":format!("FILL{}",i%3),
                "bbox":[0,i*10,5,i*10+5]}),
            );
        }
        fixture.write(
            &format!("attempts/a/frames/{i}.json"),
            json!({
                "sequence":i,"base_revision":i-1,"checkpoint":false,
                "upsert":upsert,"remove":[],"touched":touched
            }),
        );
    }
    manifest["duration_ns"] = json!(43_000_000_000u64);
    fixture.write("attempts/a/manifest.json", manifest);
    let mut app = app(&fixture);
    assert_eq!(app.plans[0].clips.len(), 3);
    let clip = &app.plans[0].clips[1];
    assert_eq!(clip.kind, Kind::Filler { first: 1 });
    assert_eq!(clip.frame, 41);
    assert!((clip.end - clip.start - 1.5).abs() < 1e-9);
    let start = clip.start;
    let middle = (clip.start + clip.end) / 2.0;
    app.select(0, start, false);
    app.finish_loading_for_test();
    for id in &touched {
        assert_eq!(app.reveal.fraction(id), 0.0);
    }
    assert!(!app.reveal.contains("inst:a"));
    app.select(0, middle, false);
    app.finish_loading_for_test();
    assert_eq!(app.reveal.fraction("inst:filler1"), 1.0);
    assert_eq!(app.reveal.fraction("inst:filler41"), 0.0);
    assert!(app.reveal.fraction("inst:filler21") > 0.0);
    assert!(app.reveal.fraction("inst:filler21") < 1.0);
    assert_eq!(app.recording.as_ref().unwrap().scene.touched.len(), 41);

    let node = app.plans[0].display_at_frame(20).unwrap();
    assert!(node > start && node < middle);
    app.select_node_frame(0, node, Some((20.0, Some(20))));
    app.finish_loading_for_test();
    assert!(!app.reveal.active());
    assert_eq!(app.recording.as_ref().unwrap().scene.revision, Some(20));
    assert_eq!(app.recording.as_ref().unwrap().scene.objects.len(), 21);
    app.select(0, middle, false);
    app.finish_loading_for_test();
    assert_eq!(app.reveal.fraction("inst:filler1"), 1.0);
    assert_eq!(app.reveal.fraction("inst:filler41"), 0.0);
    app.select_node(0, app.total, None);
    app.finish_loading_for_test();
    let mut expected = fixture.open();
    expected.seek_frame(42).unwrap();
    assert_eq!(app.recording.as_ref().unwrap().scene, expected.scene);
    assert!(app.complete);
    assert!(!app.reveal.active());
    assert!((app.plans[0].seconds - app.plans[0].process_seconds - 2.0).abs() < 1e-9);
}

#[test]
fn final_change_animates_before_results_and_reverse_seek_is_deterministic() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    let clip = app.plans[0].clips.last().unwrap();
    let midpoint = (clip.start + clip.end) / 2.0;
    app.select(0, midpoint, false);
    app.finish_loading_for_test();
    assert!(!app.complete);
    assert!(app.reveal.active());
    assert_eq!(app.recording.as_ref().unwrap().scene.revision, Some(2));
    let fraction = app.reveal.fraction("inst:a");
    assert!(fraction > 0.0 && fraction < 1.0);
    app.select(0, app.plans[0].process_seconds, false);
    app.finish_loading_for_test();
    assert!(app.complete);
    assert!(!app.reveal.active());
    app.select(0, midpoint, false);
    app.finish_loading_for_test();
    assert_eq!(app.reveal.fraction("inst:a"), fraction);
    app.select_node(0, app.total, None);
    app.finish_loading_for_test();
    assert!(app.complete);
    assert_eq!(
        app.recording.as_ref().unwrap().scene.objects["inst:a"].bbox,
        [20, 0, 25, 5]
    );
    assert!(!app.reveal.active());
}

#[test]
fn motion_pause_resume_speed_and_result_hold_share_the_display_clock() {
    let fixture = Fixture::new();
    let mut manifest: serde_json::Value =
        read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
    for frame in manifest["frames"].as_array_mut().unwrap() {
        frame["phase"] = json!("pre_optimizer_step");
    }
    fixture.write("attempts/a/manifest.json", manifest);
    let mut app = app(&fixture);
    let clip = &app.plans[0].clips[1];
    assert_eq!(clip.kind, Kind::Motion);
    let midpoint = (clip.start + clip.end) / 2.0;
    app.select(0, midpoint, false);
    app.finish_loading_for_test();
    let position = app.position;
    let target = app.recording.as_ref().unwrap().scene.objects["inst:a"].bbox;
    let paused_bounds = app.motion.bounds("inst:a", target);
    assert_eq!(paused_bounds, [5, 0, 10, 5]);
    app.playing = false;
    // A paused UI tick never advances or resets the clip.
    app.advance_playback(0.5);
    app.finish_loading_for_test();
    assert_eq!(app.position, position);
    assert_eq!(app.motion.bounds("inst:a", target), paused_bounds);
    app.playing = true;
    app.speed = 2.0;
    app.advance_playback(0.025);
    app.finish_loading_for_test();
    assert!((app.position - position - 0.05).abs() < 1e-9);
    assert!(app.motion.bounds("inst:a", target)[0] > paused_bounds[0]);
    app.select(0, app.plans[0].process_seconds, false);
    app.finish_loading_for_test();
    let results = app.position;
    app.advance_playback(0.5);
    app.finish_loading_for_test();
    assert_eq!(app.position, results + 1.0);
    assert!(app.complete);
    app.advance_playback(0.5);
    app.finish_loading_for_test();
    assert_eq!(app.position, app.total);
    app.advance_playback(0.01);
    app.finish_loading_for_test();
    assert!(!app.playing);
}

#[test]
fn subflow_node_shows_its_exact_frame_instead_of_the_next_animation() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    let display = app.plans[0].display_at_source(1.0);
    let clip = &app.plans[0].clips[1];
    app.select(0, (clip.start + clip.end) / 2.0, false);
    app.finish_loading_for_test();
    assert!(app.reveal.active());
    app.select_node(0, display, Some(1.0));
    app.finish_loading_for_test();
    assert!(!app.complete);
    assert!(!app.reveal.active());
    assert_eq!(app.recording.as_ref().unwrap().scene.revision, Some(1));
    assert_eq!(
        app.recording.as_ref().unwrap().scene.objects["inst:a"].bbox,
        [10, 0, 15, 5]
    );
}

#[test]
fn rerun_rejects_prepared_plan_before_loading_another_clip() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    fixture.write(
        "manifest.json",
        json!({"status":"recording","attempt_id":"b"}),
    );
    app.select(0, app.plans[0].clips[1].start, false);
    app.finish_loading_for_test();
    assert!(app.error.contains("invalidated"));
    assert!(app.recording.is_none());
}

#[test]
fn maps_follow_completion_and_speed_without_leaking_into_process_seek() {
    let fixture = Fixture::new();
    let maps = fixture.0.join("attempts/a/maps/density_map");
    std::fs::create_dir_all(&maps).unwrap();
    std::fs::write(
        maps.join("layout.csv"),
        "pixel_row,pixel_col,lx,ly,ux,uy\n0,0,0,0,10,10\n",
    )
    .unwrap();
    std::fs::write(maps.join("a.csv"), "0.1\n").unwrap();
    std::fs::write(maps.join("b.csv"), "0.8\n").unwrap();
    let mut manifest: serde_json::Value =
        read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
    manifest["maps"] = json!("maps");
    fixture.write("attempts/a/manifest.json", manifest);
    let mut app = app(&fixture);
    let process = app.plans[0].process_seconds;
    assert_eq!(app.total, process + RESULT_SECONDS + 2.0 * MAP_SECONDS);
    app.select(0, process, false);
    app.finish_loading_for_test();
    assert!(app.complete);
    assert_eq!(app.maps.selected, None);
    app.playing = true;
    app.speed = 4.0;
    app.advance_playback(0.5);
    app.finish_loading_for_test();
    assert_eq!(app.maps.selected, Some(0));
    assert!(app.maps.error.is_empty());
    app.advance_playback(0.5);
    app.finish_loading_for_test();
    assert_eq!(app.maps.selected, Some(1));
    app.playing = false;
    app.advance_playback(0.5);
    app.finish_loading_for_test();
    assert_eq!(app.maps.selected, Some(1));
    app.select(0, process - 0.1, false);
    app.finish_loading_for_test();
    assert!(!app.complete);
    assert_eq!(app.maps.selected, None);
    app.select_node(0, app.total, None);
    app.finish_loading_for_test();
    assert!(app.complete);
    assert_eq!(app.maps.selected, None);
}

#[test]
fn frame_sequence_takes_priority_over_ambiguous_node_timestamp() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    let display = app.plans[0].display_at_frame(1).unwrap();
    // The timestamp would select a later state; the recorded frame ID wins.
    app.select_node_frame(0, display, Some((100.0, Some(1))));
    app.finish_loading_for_test();
    assert_eq!(app.recording.as_ref().unwrap().scene.revision, Some(1));
    assert!(!app.complete);
    assert!(!app.reveal.active());
}

#[test]
fn dual_view_loads_one_revision_and_pause_keeps_camera_and_geometry_progress() {
    let fixture = Fixture::new();
    let mut application = app(&fixture);
    application.view3d.enabled = true;
    application.view3d.needs_prepare = true;
    let clip = &application.plans[0].clips[1];
    let midpoint = (clip.start + clip.end) * 0.5;
    application.select(0, midpoint, false);
    application.finish_loading_for_test();
    assert!(application.view3d.error.is_empty());
    let visual = application.view3d.scene.as_ref().unwrap();
    assert_eq!(visual.ids, vec![Some("inst:a".into())]);
    let progress = application
        .reveal
        .progress()
        .unwrap_or_else(|| application.motion.progress());
    let expected = application.motion.bounds(
        "inst:a",
        application.reveal.bounds(
            "inst:a",
            &application.recording.as_ref().unwrap().scene.objects["inst:a"],
        ),
    );
    let actual = crate::replay_scene3d::bounds_at(&visual.instances[0], progress);
    assert!(actual
        .iter()
        .zip(expected)
        .all(|(a, b)| (*a - b as f32).abs() <= 1.0));
    let camera = application.camera_preset();
    application.playing = false;
    application.advance_playback(1.0);
    assert_eq!(application.camera_preset(), camera);
    assert_eq!(application.position, midpoint);
    application.select_node_frame(0, midpoint, Some((0.0, Some(0))));
    application.finish_loading_for_test();
    assert_eq!(
        application.recording.as_ref().unwrap().scene.revision,
        Some(0)
    );
    assert_eq!(
        application.view3d.scene.as_ref().unwrap().instances[0].animation,
        [0.0; 4]
    );
    application.view3d.automatic = false;
    let manual = application.view3d.camera.current;
    application.select(0, application.total, true);
    application.finish_loading_for_test();
    assert!(!application.view3d.automatic);
    assert_eq!(application.view3d.camera.current, manual);
    application.set_three_d(false);
    application.finish_loading_for_test();
    assert!(application.view3d.scene.is_none());
    assert!(application.complete);
}

#[test]
fn disabling_three_d_preserves_a_pending_exact_node() {
    let fixture = Fixture::new();
    let mut application = app(&fixture);
    application.view3d.enabled = true;
    application.view3d.needs_prepare = true;
    let clip = &application.plans[0].clips[1];
    let midpoint = (clip.start + clip.end) * 0.5;
    application.select_node_frame(0, midpoint, Some((0.0, Some(0))));
    application.set_three_d(false);
    application.finish_loading_for_test();
    assert_eq!(
        application.recording.as_ref().unwrap().scene.revision,
        Some(0)
    );
    assert!(application.camera_exact);
    assert!(!application.complete);
    assert!(application.view3d.scene.is_none());
}

#[test]
fn enabling_three_d_starts_slow_iso_rotation_until_manual_control() {
    let view = crate::replay::view3d::View3d::default();
    assert!((view.z_scale - 1.35).abs() < f32::EPSILON);
    assert!(!view.auto_spin);
    assert!(view.spin_yaw.is_none());
    assert!(!view.fit_requested);

    let mut view = view;
    view.enabled = true;
    view.auto_spin = true;
    view.spin_yaw = Some(45.0_f32.to_radians());
    let start = view.spin_yaw.unwrap();
    view.spin_yaw = Some(start + 0.5_f32.to_radians());
    assert!(view.spin_yaw.unwrap() > start);

    view.auto_spin = false;
    view.spin_yaw = None;
    view.fit_requested = true;
    assert!(!view.auto_spin);
    assert!(view.spin_yaw.is_none());
    assert!(view.fit_requested);
}

#[test]
fn clock_reveal_is_completion_only_and_obeys_seek_pause_and_speed() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    let process = app.plans[0].process_seconds;
    assert_eq!(app.clock_progress(), None);
    app.select(0, process, false);
    app.finish_loading_for_test();
    assert_eq!(app.clock_progress(), Some(0.0));
    app.playing = true;
    app.speed = 2.0;
    app.advance_playback(0.35);
    app.finish_loading_for_test();
    assert!((app.clock_progress().unwrap() - 0.5).abs() < 1e-9);
    app.playing = false;
    app.advance_playback(0.5);
    assert!((app.clock_progress().unwrap() - 0.5).abs() < 1e-9);
    app.select(0, process, true);
    app.finish_loading_for_test();
    assert_eq!(app.clock_progress(), Some(1.0));
    app.select(0, process - 0.1, false);
    app.finish_loading_for_test();
    assert_eq!(app.clock_progress(), None);
    app.select(0, process + 0.35, false);
    app.finish_loading_for_test();
    assert!((app.clock_progress().unwrap() - 0.25).abs() < 1e-9);
    app.error = "Replay attempt replaced".into();
    assert_eq!(app.clock_progress(), None);
}
