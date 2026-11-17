use super::*;
use chipgeom_format::display::*;
use serde_json::json;

#[test]
fn binary_ir_preserves_scale_sparse_cells_and_rejects_duplicates() {
    let directory = std::env::temp_dir().join(format!("ecos-ir-binary-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("ir.gdisplay");
    let write = |duplicate: bool| {
        let meta = serde_json::to_vec(&json!({"kind":"ir","key":"ir:test","label":"VDD", "rows":2,"columns":2,"unit":"V","maximum":0.004})).unwrap();
        let mut bytes = MAGIC.to_vec();
        for value in [VERSION, CELLS, meta.len() as u32, CELL_SIZE as u32] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend(2u64.to_le_bytes());
        bytes.extend(0u64.to_le_bytes());
        bytes.extend(meta);
        for (row, col, bounds, value) in [
            (0u32, 0u32, [-10i32, 0, 0, 10], 0.001f64),
            (if duplicate { 0 } else { 1 }, 0, [-10, -10, 0, 0], 0.003),
        ] {
            bytes.extend(row.to_le_bytes());
            bytes.extend(col.to_le_bytes());
            for coordinate in bounds {
                bytes.extend(coordinate.to_le_bytes());
            }
            bytes.extend(value.to_le_bytes());
        }
        std::fs::write(&path, bytes).unwrap();
    };
    write(false);
    let map = load(&path).unwrap();
    assert_eq!(
        (
            map.value(0, 0),
            map.value(1, 0),
            map.value(0, 1),
            map.min(),
            map.max()
        ),
        (Some(1.0), Some(3.0), None, 0.0, 4.0)
    );
    assert_eq!(map.bbox(1, 0).unwrap().ly, -10);
    write(true);
    assert!(load(&path).unwrap_err().to_string().contains("Duplicate"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
#[ignore = "requires ECOS_DISPLAY_MANIFEST from a real native GCD solve"]
fn real_geometry_ir_matches_retained_solver_json() {
    let manifest = PathBuf::from(std::env::var("ECOS_DISPLAY_MANIFEST").unwrap());
    let source = PathBuf::from(std::env::var("ECOS_DISPLAY_SOLVER_JSON").unwrap());
    let legacy: serde_json::Value =
        serde_json::from_slice(&std::fs::read(source).unwrap()).unwrap();
    let db = chip_view_db::ChipViewDb::open(&manifest).unwrap();
    assert!(!db.snapshot().connectivity_metadata().is_empty());
    let categories = discover(&manifest).unwrap();
    assert_eq!(categories.len(), 2);
    let mut networks = 0;
    for (path, asset) in assets(&manifest).unwrap() {
        if asset.metadata["kind"] != "ir" || asset.metadata["layer"] != "" {
            continue;
        }
        let view = legacy["views"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["summary"]["net"] == asset.metadata["network"])
            .unwrap();
        let expected = view["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["value"].as_f64().unwrap())
            .fold(0.0, f64::max)
            * 1000.0;
        let map = load(&path).unwrap();
        assert_eq!(map.max(), expected);
        assert_eq!(
            map.cells()
                .filter_map(|((r, c), _)| map.value(r, c))
                .fold(0.0, f64::max),
            expected
        );
        println!(
            "{} nodes={} max={expected:.12} mV",
            asset.metadata["network"], asset.metadata["nodes"]
        );
        networks += 1;
    }
    assert_eq!(networks, 2);
}

#[test]
#[ignore = "requires ECOS_RCX_MANIFEST and ECOS_RCX_EXPECTED from a real extraction"]
fn real_geometry_rcx_matches_structured_spef_values() {
    let manifest = PathBuf::from(std::env::var("ECOS_RCX_MANIFEST").unwrap());
    let expected: Vec<serde_json::Value> = serde_json::from_slice(
        &std::fs::read(std::env::var("ECOS_RCX_EXPECTED").unwrap()).unwrap(),
    )
    .unwrap();
    let mut corners = 0;
    let mut nets = 0;
    for (_, asset) in assets(&manifest).unwrap() {
        if asset.metadata["kind"] != "rcx" {
            continue;
        }
        let view = expected
            .iter()
            .find(|v| v["label"] == asset.metadata["label"])
            .unwrap();
        assert_eq!(asset.count, view["items"].as_array().unwrap().len());
        for i in 0..asset.count {
            let item: chipgeom_format::replay_analysis::Item = asset.record(i).unwrap();
            assert_eq!(item.label, view["items"][i]["label"].as_str().unwrap());
            assert_eq!(item.value, view["items"][i]["value"].as_f64());
            assert_eq!(item.nets, vec![item.label.clone()]);
            nets += 1;
        }
        corners += 1;
    }
    assert_eq!(corners, expected.len());
    assert!(corners > 0 && nets > 0);
    println!("RCX verified {corners} corners, {nets} net capacitances and identities");
}
