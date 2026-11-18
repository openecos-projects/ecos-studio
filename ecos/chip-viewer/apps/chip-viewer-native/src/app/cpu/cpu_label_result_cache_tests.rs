use super::*;
use crate::app::cpu_scene::{builder, tests::Fixture};
use crate::app::ResolvedLabels;
use std::time::Duration;

fn completed_scene(request: &super::super::SceneRequest) -> CpuScene {
    let scene = builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    assert!(scene
        .completed_labels
        .set((Arc::new(ResolvedLabels::default()), Duration::ZERO))
        .is_ok());
    scene
}

#[test]
fn fit_label_result_survives_overlay_flag_and_high_zoom_replacements() {
    let fixture = Fixture::new();
    let fit = fixture.request(1.0, 1.0);
    let fit_scene = completed_scene(&fit);
    let mut cache = LabelResultCache::default();
    cache.remember(&fit_scene);

    let mut high = fit.clone();
    high.key.zoom = 2.0;
    high.key.cache_overlays = true;
    cache.remember(&completed_scene(&high));

    let mut returned_fit = fit.key.clone();
    returned_fit.cache_overlays = true;
    let (candidates, completed) = cache.reusable(&returned_fit).unwrap();
    assert!(Arc::ptr_eq(&completed, &fit_scene.completed_labels));
    assert!(!candidates.needs_rebuild());
    assert!(cache.reusable(&high.key).is_none());
}

#[test]
fn changed_label_context_replaces_cached_result() {
    let fixture = Fixture::new();
    let fit = fixture.request(1.0, 1.0);
    let fit_scene = completed_scene(&fit);
    let mut cache = LabelResultCache::default();
    cache.remember(&fit_scene);

    let mut changed = fit.clone();
    changed.key.epoch += 1;
    let changed_scene = completed_scene(&changed);
    cache.remember(&changed_scene);

    assert!(cache.reusable(&fit.key).is_none());
    assert!(cache.reusable(&changed.key).is_some());
}
