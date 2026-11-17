use super::*;
use crate::replay::data::tests::Fixture;
use serde_json::json;
use sha2::{Digest, Sha256};

#[test]
fn shared_geometry_rejects_changed_content_and_stale_attempts() {
    let fixture = Fixture::new();
    let geometry = fixture.0.join("step/output/geometry");
    let attempt = geometry.join("replay/attempts/a");
    std::fs::create_dir_all(&attempt).unwrap();
    let native = b"schema_version=1\nshape_count=0\nowner_count=0\npayload_size=0\nmeta=nodes.bin\nshapes=nodes.bin\nowners=nodes.bin\npayload=nodes.bin\nnames=nodes.bin\nname_index=nodes.bin\nsidmap=nodes.bin\nview=nodes.bin\n";
    std::fs::write(geometry.join("nodes.bin"), b"data").unwrap();
    std::fs::write(geometry.join("geometry.manifest"), native).unwrap();
    let mut manifest: serde_json::Value =
        read(&fixture.0.join("attempts/a/manifest.json")).unwrap();
    manifest["shared_geometry"] = json!({
        "manifest":"geometry.manifest","clock_tree":false,"files":{
            "geometry.manifest":{"size":native.len(),"sha256":format!("{:x}",Sha256::digest(native))},
            "nodes.bin":{"size":4,"sha256":format!("{:x}",Sha256::digest(b"data"))}
        }
    });
    fixture.write(
        "step/output/geometry/replay/attempts/a/manifest.json",
        manifest,
    );
    fixture.write(
        "step/output/geometry/replay/manifest.json",
        json!({"status":"complete","attempt_id":"a"}),
    );
    let mut record = Recording::open(&fixture.0, &attempt.join("manifest.json")).unwrap();
    assert_eq!(
        record.final_geometry_path().unwrap(),
        Some(geometry.join("geometry.manifest").canonicalize().unwrap())
    );
    assert!(record.clock_tree_path().unwrap().is_none());
    let saved = record
        .manifest
        .shared_geometry
        .as_mut()
        .unwrap()
        .files
        .remove("nodes.bin")
        .unwrap();
    assert!(record
        .final_geometry_path()
        .unwrap_err()
        .to_string()
        .contains("Unindexed"));
    record
        .manifest
        .shared_geometry
        .as_mut()
        .unwrap()
        .files
        .insert("nodes.bin".into(), saved);
    std::fs::write(geometry.join("nodes.bin"), b"edit").unwrap();
    assert!(record
        .final_geometry_path()
        .unwrap_err()
        .to_string()
        .contains("checksum"));
    fixture.write(
        "step/output/geometry/replay/manifest.json",
        json!({"status":"recording","attempt_id":"b"}),
    );
    assert!(record
        .final_geometry_path()
        .unwrap_err()
        .to_string()
        .contains("invalidated"));
}
