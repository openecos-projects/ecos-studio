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
    app
}

#[test]
fn final_change_animates_before_results_and_reverse_seek_is_deterministic() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    let clip = app.plans[0].clips.last().unwrap();
    let midpoint = (clip.start + clip.end) / 2.0;
    app.select(0, midpoint, false);
    assert!(!app.complete);
    assert!(app.reveal.active());
    assert_eq!(app.recording.as_ref().unwrap().scene.revision, Some(2));
    let fraction = app.reveal.fraction("inst:a");
    assert!(fraction > 0.0 && fraction < 1.0);
    app.select(0, app.plans[0].process_seconds, false);
    assert!(app.complete);
    assert!(!app.reveal.active());
    app.select(0, midpoint, false);
    assert_eq!(app.reveal.fraction("inst:a"), fraction);
    app.select_node(0, app.total, None);
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
    let position = app.position;
    let target = app.recording.as_ref().unwrap().scene.objects["inst:a"].bbox;
    let paused_bounds = app.motion.bounds("inst:a", target);
    assert_eq!(paused_bounds, [5, 0, 10, 5]);
    app.playing = false;
    // A paused UI tick never advances or resets the clip.
    app.advance_playback(0.5);
    assert_eq!(app.position, position);
    assert_eq!(app.motion.bounds("inst:a", target), paused_bounds);
    app.playing = true;
    app.speed = 2.0;
    app.advance_playback(0.025);
    assert!((app.position - position - 0.05).abs() < 1e-9);
    assert!(app.motion.bounds("inst:a", target)[0] > paused_bounds[0]);
    app.select(0, app.plans[0].process_seconds, false);
    let results = app.position;
    app.advance_playback(0.5);
    assert_eq!(app.position, results + 1.0);
    assert!(app.complete);
    app.advance_playback(0.5);
    assert_eq!(app.position, app.total);
    app.advance_playback(0.01);
    assert!(!app.playing);
}

#[test]
fn subflow_node_shows_its_exact_frame_instead_of_the_next_animation() {
    let fixture = Fixture::new();
    let mut app = app(&fixture);
    let display = app.plans[0].display_at_source(1.0);
    app.select_node(0, display, Some(1.0));
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
    assert!(app.complete);
    assert_eq!(app.maps.selected, None);
    app.playing = true;
    app.speed = 4.0;
    app.advance_playback(0.5);
    assert_eq!(app.maps.selected, Some(0));
    assert!(app.maps.error.is_empty());
    app.advance_playback(0.5);
    assert_eq!(app.maps.selected, Some(1));
    app.playing = false;
    app.advance_playback(0.5);
    assert_eq!(app.maps.selected, Some(1));
    app.select(0, process - 0.1, false);
    assert!(!app.complete);
    assert_eq!(app.maps.selected, None);
    app.select_node(0, app.total, None);
    assert!(app.complete);
    assert_eq!(app.maps.selected, None);
}
