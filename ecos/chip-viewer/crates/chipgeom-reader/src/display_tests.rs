use super::*;
use serde_json::json;

fn file(encoding: u32, count: u64, records: &[u8], offsets: &[u64]) -> tempfile::NamedTempFile {
    let metadata = serde_json::to_vec(&json!({"kind":"map","key":"test","label":"test"})).unwrap();
    let mut bytes = MAGIC.to_vec();
    for field in [
        VERSION,
        encoding,
        metadata.len() as u32,
        if encoding == CELLS { 32 } else { 0 },
    ] {
        bytes.extend(field.to_le_bytes());
    }
    bytes.extend(count.to_le_bytes());
    bytes.extend(
        if encoding == RECORDS {
            (HEADER_SIZE + metadata.len() + records.len()) as u64
        } else {
            0
        }
        .to_le_bytes(),
    );
    bytes.extend(metadata);
    bytes.extend(records);
    for offset in offsets {
        bytes.extend(offset.to_le_bytes());
    }
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), bytes).unwrap();
    file
}

#[test]
fn cells_preserve_signed_coordinates_and_full_precision() {
    let mut bytes = Vec::new();
    for number in [2i32, 3, -7, -5, 9, 11] {
        bytes.extend(number.to_le_bytes());
    }
    bytes.extend(0.000036671948637f64.to_le_bytes());
    let file = file(CELLS, 1, &bytes, &[]);
    let data = DisplayAsset::open(file.path()).unwrap();
    assert_eq!(
        data.cell(0).unwrap(),
        DisplayCell {
            row: 2,
            column: 3,
            bounds: Rect32 {
                lx: -7,
                ly: -5,
                hx: 9,
                hy: 11
            },
            value: 0.000036671948637
        }
    );
    assert!(data.cell(1).is_err());
}

#[test]
fn records_are_indexed_and_bad_offsets_or_truncation_are_rejected() {
    let first = json!({"layer":"MET1","nets":["a","b"],"voltage":1.08});
    let mut records = rmp_serde::to_vec_named(&first).unwrap();
    let split = records.len() as u64;
    records.extend(rmp_serde::to_vec_named(&json!([1, 2, 3])).unwrap());
    let good = file(RECORDS, 2, &records, &[0, split, records.len() as u64]);
    let data = DisplayAsset::open(good.path()).unwrap();
    assert_eq!(data.record::<Value>(0).unwrap(), first);
    assert_eq!(data.record::<Vec<i32>>(1).unwrap(), vec![1, 2, 3]);
    let bad = file(
        RECORDS,
        2,
        &records,
        &[0, records.len() as u64 + 1, records.len() as u64],
    );
    assert!(DisplayAsset::open(bad.path())
        .unwrap()
        .record::<Value>(0)
        .is_err());
    let truncated = file(CELLS, 2, &[0; CELL_SIZE], &[]);
    assert!(DisplayAsset::open(truncated.path()).is_err());
}

#[test]
#[ignore = "one-million-cell I/O benchmark; run in release with --nocapture"]
fn million_display_cells_benchmark() {
    use std::time::Instant;
    let count = 1_000_000usize;
    let mut bytes = Vec::with_capacity(count * CELL_SIZE);
    let mut text_rows = Vec::with_capacity(count);
    for i in 0..count {
        let row = (i / 1000) as u32;
        let column = (i % 1000) as u32;
        let bounds = [
            column as i32 * 10,
            row as i32 * 10,
            column as i32 * 10 + 10,
            row as i32 * 10 + 10,
        ];
        let value = i as f64 / count as f64;
        bytes.extend(row.to_le_bytes());
        bytes.extend(column.to_le_bytes());
        for coordinate in bounds {
            bytes.extend(coordinate.to_le_bytes());
        }
        bytes.extend(value.to_le_bytes());
        text_rows.push((row, column, bounds, value));
    }
    let binary = file(CELLS, count as u64, &bytes, &[]);
    let json = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(json.path(), serde_json::to_vec(&text_rows).unwrap()).unwrap();
    drop(bytes);
    drop(text_rows);
    let start = Instant::now();
    let asset = DisplayAsset::open(binary.path()).unwrap();
    let catalog = start.elapsed();
    let start = Instant::now();
    let mut sum = 0.0;
    for i in 0..asset.count {
        sum += asset.cell(i).unwrap().value;
    }
    let scan = start.elapsed();
    let start = Instant::now();
    let text = std::fs::read(json.path()).unwrap();
    let decoded: Vec<(u32, u32, [i32; 4], f64)> = serde_json::from_slice(&text).unwrap();
    let json_time = start.elapsed();
    assert!((sum - decoded.iter().map(|r| r.3).sum::<f64>()).abs() < 1e-6);
    println!("1M cells: binary={} bytes, JSON={} bytes, catalog={catalog:?}, mmap validated scan={scan:?}, JSON read+typed parse={json_time:?}",binary.path().metadata().unwrap().len(),text.len());
}

#[test]
fn manifest_rejects_duplicate_dataset_entries_and_traversal() {
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(
        file.path(),
        "display.0000=a.gdisplay\ndisplay.0000=b.gdisplay\n",
    )
    .unwrap();
    assert!(crate::read_manifest(file.path())
        .unwrap_err()
        .to_string()
        .contains("duplicate"));
    std::fs::write(file.path(), "schema_version=1\nshape_count=0\nowner_count=0\npayload_size=0\ndisplay.0000=../outside.gdisplay\n").unwrap();
    assert!(crate::read_manifest(file.path()).is_err());
}
