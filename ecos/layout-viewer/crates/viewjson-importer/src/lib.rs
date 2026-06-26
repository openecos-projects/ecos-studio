use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use flate2::read::GzDecoder;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ViewJsonPackage {
    pub root: PathBuf,
}

pub fn open_viewjson_package(root: impl AsRef<Path>) -> Result<ViewJsonPackage> {
    Ok(ViewJsonPackage {
        root: root.as_ref().to_path_buf(),
    })
}

pub fn is_gzip_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gz"))
}

fn open_json_reader(path: &Path) -> Result<Box<dyn Read>> {
    let file = File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    if is_gzip_path(path) {
        Ok(Box::new(GzDecoder::new(file)))
    } else {
        Ok(Box::new(file))
    }
}

pub fn open_json_buf_reader(path: &Path) -> Result<BufReader<Box<dyn Read>>> {
    Ok(BufReader::new(open_json_reader(path)?))
}

pub fn read_json_value(path: &Path) -> Result<Value> {
    let reader = open_json_buf_reader(path)?;
    serde_json::from_reader(reader).with_context(|| format!("failed to parse {}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::write::GzEncoder;
    use flate2::Compression;
    use serde_json::json;
    use tempfile::TempDir;

    use super::*;

    fn write_gz_json(path: &Path, value: &Value) {
        let parent = path.parent().expect("gzip json path has a parent");
        std::fs::create_dir_all(parent).unwrap();
        let file = File::create(path).unwrap();
        let mut encoder = GzEncoder::new(file, Compression::default());
        encoder
            .write_all(serde_json::to_vec(value).unwrap().as_slice())
            .unwrap();
        encoder.finish().unwrap();
    }

    #[test]
    fn read_json_value_supports_gzip_files() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("tech/layers.json.gz");
        let payload = json!({
            "schema": "ecc.view.v1",
            "kind": "layers",
            "data": [{ "id": 0, "name": "MET1", "type": "ROUTING", "order": 0, "direction": "HORIZONTAL" }]
        });
        write_gz_json(&path, &payload);

        let value = read_json_value(&path).unwrap();
        assert_eq!(value["kind"], "layers");
        assert_eq!(value["data"][0]["name"], "MET1");
    }

    #[test]
    fn open_json_buf_reader_streams_gzip_data_arrays() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("design/instances.json.gz");
        let payload = json!({
            "schema": "ecc.view.v1",
            "kind": "instances",
            "data": [
                { "id": 1, "name": "u1", "master_id": 0, "bbox": [0, 0, 100, 100] }
            ]
        });
        write_gz_json(&path, &payload);

        let reader = open_json_buf_reader(&path).unwrap();
        let value: Value = serde_json::from_reader(reader).unwrap();
        assert_eq!(value["data"].as_array().unwrap().len(), 1);
    }
}
