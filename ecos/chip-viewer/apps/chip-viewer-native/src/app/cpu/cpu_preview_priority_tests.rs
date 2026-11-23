use super::*;
use crate::app::cpu_scene::tests::Fixture;

fn request(fixture: &Fixture) -> SceneRequest {
    let mut request = fixture.request(1.0, 1.0);
    request.data_bounds = Some(request.key.world);
    request.key.viewport = request.key.world;
    request
}

fn record(id: u64, layer: LayerId, side: i32) -> PreviewRecord {
    let mut style = LayerStyle::default_for_layer(layer, chip_display::ColorTheme::Vivid);
    style.rgba = [255, 31, 19, 255];
    PreviewRecord::new(
        id,
        Rect32 {
            lx: 0,
            ly: 0,
            hx: side,
            hy: 1,
        },
        style,
    )
}

#[test]
fn priority_capture_is_bounded_and_keeps_the_longest_real_records() {
    let fixture = Fixture::new();
    let request = request(&fixture);
    let mut builder = PriorityBuilder::new(&request).unwrap();
    for id in 0..10_000 {
        builder.push(record(id, 1, id as i32 + 1));
    }
    let cache = builder.finish(&|| true).unwrap();
    assert_eq!(cache.records.len(), PER_LAYER);
    assert!(cache
        .records
        .iter()
        .all(|record| record.id >= 10_000 - PER_LAYER as u64));
    assert!(cache.byte_len() < MAX_BYTES);
    let mut builder = PriorityBuilder::new(&request).unwrap();
    for layer in 0..32 {
        for id in 0..PER_LAYER {
            builder.push(record(id as u64, layer, 100));
        }
    }
    assert!(
        builder.finish(&|| true).is_none(),
        "overflow must discard rather than publish an incomplete cache"
    );
}

#[test]
fn priority_capture_requires_full_source_and_cancelled_chunks_never_finish() {
    let fixture = Fixture::new();
    let mut request = request(&fixture);
    request.key.viewport.hx -= 1;
    assert!(PriorityBuilder::new(&request).is_none());
    request.key.viewport = request.key.world;
    let builder = PriorityBuilder::new(&request).unwrap();
    assert!(builder.finish(&|| false).is_none());
    let mut a = PriorityBuilder::new(&request).unwrap();
    let mut b = PriorityBuilder::new(&request).unwrap();
    b.push(record(1, 1, 200));
    assert!(a.merge(b, &|| false).is_none());
}

#[test]
fn priority_record_order_agrees_with_equality_for_all_ties() {
    let a = record(1, 1, 10);
    for mut b in [a; 5].into_iter().enumerate().map(|(index, mut b)| {
        match index {
            0 => {
                b.bbox.lx += 1;
                b.bbox.hx += 1;
            }
            1 => {
                b.bbox.ly += 1;
                b.bbox.hy += 1;
            }
            2 => b.layer += 1,
            3 => b.chromatic = !b.chromatic,
            _ => {}
        }
        b
    }) {
        assert_eq!(a.cmp(&b) == Compare::Equal, a == b);
        b.id += 1;
        assert_ne!(a.cmp(&b), Compare::Equal);
    }
}

#[test]
fn priority_selection_is_compatible_bounded_and_ordered_without_database_access() {
    let fixture = Fixture::new();
    let mut request = request(&fixture);
    let mut builder = PriorityBuilder::new(&request).unwrap();
    for layer in [1, 2] {
        for id in 0..100 {
            let mut r = record(9_000_000 + id, layer, 100 + id as i32);
            r.bbox.lx += 400;
            r.bbox.hx += 400;
            r.bbox.ly += 500;
            r.bbox.hy += 500;
            builder.push(r);
        }
    }
    let cache = builder.finish(&|| true).unwrap();
    request.layer_ids = vec![2, 1];
    request.key.zoom = 2.6;
    let selected = cache.select(&request, 16);
    assert_eq!(selected.len(), 16);
    assert!(selected.windows(2).all(|pair| {
        let key = |(layer, id): (LayerId, ShapeId)| {
            (
                request
                    .layer_ids
                    .iter()
                    .position(|candidate| *candidate == layer)
                    .unwrap(),
                id,
            )
        };
        key(pair[0]) < key(pair[1])
    }));
    assert!(
        selected.iter().all(|&(_, id)| id >= 9_000_000),
        "synthetic IDs are never looked up while ranking"
    );
    request.key.epoch += 1;
    assert!(cache.select(&request, 16).is_empty());
    request.key.epoch -= 1;
    request.layers.style_map.get_mut(&1).unwrap().rgba = [1, 2, 3, 4];
    assert!(!cache.compatible(&request));
}

#[test]
fn priority_layer_subset_cannot_masquerade_as_a_full_layer_cache() {
    let fixture = Fixture::new();
    let mut request = request(&fixture);
    request.layer_ids = vec![2];
    let mut builder = PriorityBuilder::new(&request).unwrap();
    builder.push(record(1, 2, 100));
    let cache = builder.finish(&|| true).unwrap();
    assert!(cache.compatible(&request));
    request.layer_ids = vec![1, 2];
    assert!(!cache.compatible(&request));
    assert!(cache.select(&request, 512).is_empty());
}

#[test]
fn priority_merge_overflow_discards_only_hints_and_keeps_the_scene() {
    let fixture = Fixture::new();
    let request = request(&fixture);
    let mut scene = builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
    scene.drawn = 123;
    for layer in 0..32 {
        let mut local = PriorityBuilder::new(&request).unwrap();
        for id in 0..PER_LAYER {
            local.push(record(id as u64, layer, 100));
        }
        let mut chunk = builder::empty_scene(&request.key, Arc::clone(&request.pattern_textures));
        chunk.priority_collector = Some(local);
        assert!(builder::merge_priority(&mut scene, &mut chunk, &|| true).is_some());
        assert!(chunk.priority_collector.is_none());
    }
    builder::finish_priority(&request, &mut scene, &|| true);
    assert_eq!(scene.drawn, 123);
    assert!(scene.priority.is_none());
    assert!(scene.priority_collector.is_none());
}

#[test]
#[cfg(target_os = "linux")]
fn priority_complete_stream_captures_once_and_history_selection_share_the_arc() {
    let fixture = Fixture::new();
    let request = request(&fixture);
    let command = builder::build_command_stream(&request, &|| true, |_| true).unwrap();
    let raster = builder::build_raster_stream(&request, &|| true, |_, _| true).unwrap();
    let command_cache = Arc::clone(command.priority.as_ref().unwrap());
    let raster_cache = raster.priority.as_ref().unwrap();
    assert_eq!(command_cache.records, raster_cache.records);
    assert!(command.priority_collector.is_none() && raster.priority_collector.is_none());
    assert!(builder::build_raster_stream(&request, &|| true, |_, _| false).is_none());
    let mut history = history::CpuSceneHistory::default();
    let command = Arc::new(command);
    history.insert(Arc::clone(&command));
    assert!(Arc::ptr_eq(
        &history.priority(&request).unwrap(),
        &command_cache
    ));
    let mut next = request;
    next.priority = Some(Arc::clone(&command_cache));
    assert!(
        PriorityBuilder::new(&next).is_none(),
        "compatible completed hints are reused without recapture"
    );
}
