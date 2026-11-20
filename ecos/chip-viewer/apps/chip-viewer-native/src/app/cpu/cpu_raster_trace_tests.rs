use super::*;

#[test]
fn submission_accounts_for_every_transferred_vertex_and_index() {
    let mut mesh = egui::Mesh::default();
    mesh.add_colored_rect(
        egui::Rect::from_min_size(egui::Pos2::ZERO, egui::Vec2::splat(10.0)),
        egui::Color32::WHITE,
    );
    let primitives = vec![egui::ClippedPrimitive {
        clip_rect: egui::Rect::EVERYTHING,
        primitive: egui::epaint::Primitive::Mesh(mesh),
    }];
    let mut trace = RasterTrace::new(PathBuf::new(), 2.5, [2048, 1280], [2048, 256]);
    let bytes = 4 * size_of::<egui::epaint::Vertex>() + 6 * size_of::<u32>();
    trace.submitted(&primitives, Duration::from_micros(1250), bytes);
    trace.submitted(&primitives, Duration::from_micros(2500), bytes);
    assert_eq!(
        (
            trace.meshes,
            trace.vertices,
            trace.indices,
            trace.geometry_upload_bytes,
            trace.submit_ms
        ),
        (
            2,
            8,
            12,
            8 * size_of::<egui::epaint::Vertex>() + 12 * size_of::<u32>(),
            3.75
        )
    );
    let compact_bytes = 4 * 12 + 6 * size_of::<u16>();
    trace.submitted(&primitives, Duration::ZERO, compact_bytes);
    let value = serde_json::to_value(&trace).unwrap();
    assert_eq!(value["geometry_upload_bytes"], 2 * bytes + compact_bytes);
    assert_eq!(value["white_meshes"], 3);
    assert!(value.get("output").is_none());
    assert!(value.get("started").is_none());
}

#[test]
fn trace_records_readback_units_and_an_explicit_nonpresented_outcome() {
    let directory = crate::app::tests::temp_snapshot_dir("raster-trace");
    let output = directory.join("trace.jsonl");
    let mut trace = RasterTrace::new(output.clone(), 2.5, [2048, 1280], [2048, 256]);
    trace.readbacks.push(Readback {
        kind: ReadbackKind::Progressive,
        sequence: 4,
        finish_wait_ms: 2.5,
        read_pixels_ms: 1.25,
        bytes: 2048 * 1280 * 4,
    });
    trace.record(TraceOutcome::Incomplete);
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(record["outcome"], "incomplete");
    assert_eq!(
        record["raster"]["readbacks"],
        serde_json::json!([{
            "kind": "progressive", "sequence": 4, "finish_wait_ms": 2.5,
            "read_pixels_ms": 1.25, "bytes": 2048 * 1280 * 4,
        }])
    );
    fs::remove_dir_all(directory).unwrap();
}
