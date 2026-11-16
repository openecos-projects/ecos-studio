use super::*;
use crate::app::cpu_scene::tests::Fixture;
use std::cell::Cell;

fn model(fixture: &Fixture, records: usize) -> (SceneKey, RegionModel) {
    let request = fixture.request(1.0, 1.0);
    let mut model = RegionModel::new(&request).unwrap();
    let bbox = Rect32 {
        lx: 100,
        ly: 100,
        hx: 900,
        hy: 900,
    };
    let mut style = LayerStyle::default_for_layer(1, chip_display::ColorTheme::Vivid);
    style.fill_pattern = chip_display::FillPattern::Solid;
    for _ in 0..records {
        assert!(model.push(bbox, ShapeGeometry::Rect(bbox), style, &[]));
    }
    let mut key = request.key;
    key.pan.x += 4.0;
    (key, model)
}

#[test]
fn interrupted_preparation_exits_during_record_traversal() {
    let fixture = Fixture::new();
    let (key, model) = model(&fixture, 1024);
    let calls = Cell::new(0);
    let current = || {
        calls.set(calls.get() + 1);
        calls.get() <= 5
    };
    assert!(model.prepare_current(&key, true, &current).is_none());
    assert!(calls.get() > 1 && calls.get() < 1024);
}

#[test]
fn interrupted_composition_cannot_return_a_partly_colored_bitmap() {
    let fixture = Fixture::new();
    let (key, model) = model(&fixture, 1);
    let regions = model.prepare_current(&key, true, &|| true).unwrap();
    let source = vec![0; key.screen_size[0] as usize * key.screen_size[1] as usize * 4];
    let calls = Cell::new(0);
    let current = || {
        calls.set(calls.get() + 1);
        calls.get() <= 18
    };
    assert!(model
        .compose_current(&key, &regions, &source, &current)
        .is_none());
    assert!(
        calls.get() > 18,
        "composition must poll cancellation during pixel work"
    );
}

#[test]
fn interrupted_damage_and_mesh_preparation_cannot_publish_incomplete_repairs() {
    let fixture = Fixture::new();
    let (key, model) = model(&fixture, 128);
    let regions = model.prepare_current(&key, false, &|| true).unwrap();
    let calls = Cell::new(0);
    let current = || {
        calls.set(calls.get() + 1);
        calls.get() <= 18
    };
    assert!(regions.repair_meshes_current(&key, &current).is_none());
    assert!(calls.get() > 18);
}

#[test]
fn uncertified_profile_uses_one_canvas_repair_instead_of_per_shape_damage() {
    let fixture = Fixture::new();
    let (key, model) = model(&fixture, 128);
    let regions = model.prepare_current(&key, false, &|| true).unwrap();
    assert_eq!(regions.damage_clips(&key), vec![key.canvas]);
    assert!(regions.repair_meshes_current(&key, &|| true).is_some());
    assert!(
        regions.invalid.iter().enumerate().all(|(index, invalid)| {
            *invalid || !regions.tile(index).intersects(physical_clip(&key))
        }),
        "only background outside the canvas may remain CPU-valid"
    );
}
