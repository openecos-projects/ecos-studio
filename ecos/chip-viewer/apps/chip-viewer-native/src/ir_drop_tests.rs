use super::*;
use serde_json::json;

fn view() -> View {
    serde_json::from_value(
        json!({"label":"VDD · IR drop","kind":"ir","unit":"V","basis":"final","items":[
            {"bboxes":[[-20,-10,-20,-10]],"value":0.001,"details":{"layer":"MET1"}},
            {"bboxes":[[-20,-10,-20,-10]],"value":0.002,"details":{"layer":"MET1"}},
            {"bboxes":[[-20,-10,-20,-10]],"value":0.003,"details":{"layer":"MET2"}},
            {"bboxes":[[100,200,100,200]],"value":0.0,"details":{"layer":"MET2"}}
        ]}),
    )
    .unwrap()
}

#[test]
fn ir_drop_preserves_maxima_units_holes_boundaries_and_layer_scale() {
    let map = IrDrop::from_view(&view()).unwrap();
    let data = &map.all;
    assert_eq!(
        (map.samples, map.layers.len(), data.min(), data.max()),
        (4, 2, 0.0, 3.0)
    );
    assert!(data.rows() <= 32 && data.columns() <= 32);
    let occupied: Vec<_> = data
        .cells()
        .filter_map(|((r, c), b)| data.value(r, c).map(|v| (r, c, b, v)))
        .collect();
    assert_eq!(occupied.len(), 2);
    assert!(occupied.iter().any(|(_, _, b, v)| b.lx <= -20
        && b.hx > -20
        && b.ly <= -10
        && b.hy > -10
        && *v == 3.0));
    assert!(occupied.iter().any(|(_, _, b, v)| b.lx <= 100
        && b.hx > 100
        && b.ly <= 200
        && b.hy > 200
        && *v == 0.0));
    let layer = map.data(Some("MET1"));
    assert_eq!((layer.min(), layer.max()), (0.0, 3.0));
    let ((r, c), _) = layer
        .cells()
        .find(|((r, c), _)| layer.value(*r, *c).is_some())
        .unwrap();
    assert_eq!(layer.value(r, c), Some(2.0));
    assert!((layer.normalized_value(r, c).unwrap() - 2.0 / 3.0).abs() < 1e-6);
    assert!(data.value(data.rows() / 2, data.columns() / 2).is_none());
}

#[test]
fn ir_drop_zero_and_single_point_are_cold_and_spatially_valid() {
    let mut v = view();
    v.items.truncate(1);
    v.items[0].value = Some(0.0);
    let map = IrDrop::from_view(&v).unwrap();
    assert_eq!(
        (
            map.all.rows(),
            map.all.columns(),
            map.all.normalized_value(0, 0)
        ),
        (1, 1, Some(0.0))
    );
    assert_eq!(
        map.all.bbox(0, 0),
        Some(Rect32 {
            lx: -20,
            ly: -10,
            hx: -19,
            hy: -9
        })
    );
}

#[test]
fn ir_drop_rejects_untrusted_units_positions_layers_and_values() {
    let mut v = view();
    v.unit = "mV".into();
    assert!(IrDrop::from_view(&v).is_err());
    let mut v = view();
    v.items[0].value = Some(f64::NAN);
    assert!(IrDrop::from_view(&v).is_err());
    v.items[0].value = Some(-1.0);
    assert!(IrDrop::from_view(&v).is_err());
    let mut v = view();
    v.items[0].bboxes[0][2] += 1;
    assert!(IrDrop::from_view(&v).is_err());
    let mut v = view();
    v.items[0].details = json!({});
    assert!(IrDrop::from_view(&v).is_err());
    let mut v = view();
    v.items[0].bboxes = vec![[i64::MAX; 4]];
    assert!(IrDrop::from_view(&v).is_err());
}

#[test]
fn ir_drop_reveal_is_seekable_and_projects_all_four_corners() {
    let map = IrDrop::from_view(&view()).unwrap();
    let render = |progress| {
        let ctx = egui::Context::default();
        ctx.run(egui::RawInput::default(), |ctx| {
            paint(
                &map.all,
                &ctx.layer_painter(egui::LayerId::background()),
                |x, y| Pos2::new((x + y) as f32, (y - x) as f32),
                progress,
            )
        })
        .shapes
    };
    assert!(render(0.0).is_empty());
    let half = render(0.5);
    let full = render(1.0);
    let egui::Shape::Mesh(half_mesh) = &half[0].shape else {
        panic!("Expected projected mesh")
    };
    let egui::Shape::Mesh(full_mesh) = &full[0].shape else {
        panic!("Expected projected mesh")
    };
    assert_eq!((half_mesh.vertices.len(), full_mesh.vertices.len()), (4, 8));
    assert_eq!(half, render(0.5));
    assert_eq!(&half_mesh.vertices[..], &full_mesh.vertices[..4]);
    assert_ne!(half_mesh.vertices[0].pos.y, half_mesh.vertices[1].pos.y);
    assert_ne!(half_mesh.vertices[1].pos.x, half_mesh.vertices[2].pos.x);
}

#[test]
fn ir_drop_colormap_brightness_increases() {
    let mut previous = 0.0;
    for i in 0..=100 {
        let [r, g, b, _] = ColormapMode::Inferno.sample(i as f32 / 100.0);
        let luminance = 0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b);
        assert!(luminance >= previous);
        previous = luminance;
    }
}

#[test]
fn ir_drop_catalog_rejects_stale_snapshot_and_keeps_network_layer_choices() {
    use sha2::{Digest, Sha256};
    let root = std::env::temp_dir().join(format!("ecos-ir-catalog-{}", std::process::id()));
    std::fs::create_dir_all(root.join("ir")).unwrap();
    let manifest = root.join("geometry.manifest");
    std::fs::write(&manifest, "dbu_per_micron=1000\n").unwrap();
    let mut payload = json!({"schema":"ecos.emir.ir.v1","coordinate_unit":"dbu","dbu_per_micron":1000,
    "geometry_manifest_sha256":format!("{:x}",Sha256::digest(std::fs::read(&manifest).unwrap())),
    "views":[{"label":"VSS","kind":"ir","basis":"final","unit":"V","items":[
        {"value":0.00001,"bboxes":[[2,3,2,3]],"details":{"layer":"MET1"}},
        {"value":0.00002,"bboxes":[[4,5,4,5]],"details":{"layer":"MET2"}}
    ]}]});
    let path = root.join("ir/ir_drop.json");
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    let catalog = crate::map_data::MapCatalog::discover(&root.join("ir")).unwrap();
    assert_eq!(
        (
            catalog.categories.len(),
            catalog.item_count(),
            catalog.warnings.len()
        ),
        (1, 3, 0)
    );
    let items = &catalog.categories[0].items;
    assert_ne!(items[0].source.key(), items[1].source.key());
    for item in items {
        assert_eq!(item.source.load(None).unwrap().max(), 0.02);
    }
    std::fs::write(&manifest, "dbu_per_micron=2000\n").unwrap();
    assert!(load(&path).unwrap_err().to_string().contains("mismatch"));
    payload["geometry_manifest_sha256"] = serde_json::Value::Null;
    payload["coordinate_unit"] = json!("um");
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    assert!(load(&path).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
