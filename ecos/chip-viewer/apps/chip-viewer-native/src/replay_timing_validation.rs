//! Read-only validation against a real STA recording, including physical route coverage.
use super::*;

#[test]
#[ignore = "set ECOS_REPLAY_TEST_CATALOG to a real STA recording"]
fn real_sta_corner_routes_follow_frozen_native_geometry() {
    let file = std::env::var("ECOS_REPLAY_TEST_CATALOG").unwrap();
    let catalog: crate::replay_data::Catalog = read(std::path::Path::new(&file)).unwrap();
    let step = catalog.steps.iter().find(|s| s.name == "sta").unwrap();
    let mut recording =
        Recording::open(&catalog.workspace, step.manifest.as_ref().unwrap()).unwrap();
    recording
        .seek_frame(recording.manifest.frames.len() - 1)
        .unwrap();
    let mut analysis = ReplayAnalysis::open(&recording);
    analysis.resolve(&recording.scene);
    analysis.resolve_routes(&recording);
    assert!(analysis.error.is_empty(), "{}", analysis.error);
    let mut total = 0;
    let mut unresolved = 0;
    for (view, geometry) in analysis.data.views.iter().zip(&analysis.geometry) {
        if view.kind != "timing" {
            continue;
        }
        let routed: usize = geometry
            .iter()
            .filter_map(|g| g.timing.as_ref())
            .map(|p| p.routed)
            .sum();
        let missing: usize = geometry.iter().map(|g| g.missing).sum();
        println!(
            "{}: {} paths, {routed} routed net arcs, {missing} unresolved",
            view.label,
            view.items.len()
        );
        assert!(view
            .items
            .iter()
            .any(|i| i.details["analysis_type"] == "setup"));
        assert!(view
            .items
            .iter()
            .any(|i| i.details["analysis_type"] == "hold"));
        for path in geometry.iter().filter_map(|g| g.timing.as_ref()) {
            for stroke in path.routed_strokes() {
                if stroke.a.layer == stroke.b.layer {
                    assert!(
                        stroke.a.x == stroke.b.x || stroke.a.y == stroke.b.y,
                        "Diagonal routing stroke"
                    );
                } else {
                    assert_eq!(
                        (stroke.a.x, stroke.a.y),
                        (stroke.b.x, stroke.b.y),
                        "Via must only change Z"
                    );
                }
            }
        }
        total += routed;
        unresolved += missing;
    }
    assert!(total > 0);
    assert_eq!(
        unresolved, 0,
        "Real STA data should resolve every recorded net arc"
    );
    assert!(
        analysis.duration() <= 60.0,
        "Corner playback must not scale with path count"
    );
    println!("Total duration: {} s", analysis.duration());
}
