use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chipgeom_format::{
    GeometryDeltaRecord, GeometryFileHeader, GeometryFileKind, GeometryMetaRecord,
    GeometryNameRecord, GeometrySidMapRecord, GeometryViewTileRecord, OwnerRef, ShapeRecord,
    GEOMETRY_FILE_HEADER_SIZE, GEOMETRY_FILE_MAGIC, GEOMETRY_SCHEMA_VERSION,
};
use memmap2::{Mmap, MmapOptions};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GeometryReadError {
    #[error("manifest is missing key {0}")]
    MissingManifestKey(&'static str),
    #[error("invalid header in {path}: {reason}")]
    InvalidHeader { path: PathBuf, reason: String },
}

#[derive(Clone, Debug, Default)]
pub struct GeometryManifest {
    pub path: PathBuf,
    pub schema_version: u32,
    pub shape_count: u64,
    pub owner_count: u64,
    pub payload_size: u64,
    pub meta: PathBuf,
    pub shapes: PathBuf,
    pub owners: PathBuf,
    pub payload: PathBuf,
    pub names: PathBuf,
    pub name_index: PathBuf,
    pub sidmap: PathBuf,
    pub delta: Option<PathBuf>,
    pub view: PathBuf,
    pub layers: Option<PathBuf>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LayerMetadata {
    pub layer_id: u16,
    pub order: u32,
    pub name: String,
    pub layer_type: String,
    pub direction: String,
    pub width: i32,
    pub pitch_x: i32,
    pub pitch_y: i32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GeometryMappedBytes {
    pub meta: usize,
    pub shapes: usize,
    pub owners: usize,
    pub payload: usize,
    pub names: usize,
    pub name_index: usize,
    pub sidmap: usize,
    pub delta: usize,
    pub view: usize,
}

impl GeometryMappedBytes {
    pub fn total(self) -> usize {
        self.meta
            + self.shapes
            + self.owners
            + self.payload
            + self.names
            + self.name_index
            + self.sidmap
            + self.delta
            + self.view
    }
}

pub struct GeometrySnapshot {
    manifest: GeometryManifest,
    meta: Mmap,
    shapes: Mmap,
    owners: Mmap,
    payload: Mmap,
    names: Mmap,
    name_index: Mmap,
    sidmap: Mmap,
    delta: GeometryDeltaStorage,
    view: Mmap,
    layer_metadata: Vec<LayerMetadata>,
}

enum GeometryDeltaStorage {
    Mapped(Mmap),
    LegacyEmpty(Vec<u8>),
}

impl GeometryDeltaStorage {
    fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Mapped(mmap) => mmap,
            Self::LegacyEmpty(bytes) => bytes,
        }
    }

    fn mapped_len(&self) -> usize {
        match self {
            Self::Mapped(mmap) => mmap.len(),
            Self::LegacyEmpty(_) => 0,
        }
    }
}

impl GeometrySnapshot {
    pub fn open(manifest_path: impl AsRef<Path>) -> Result<Self> {
        let manifest = read_manifest(manifest_path.as_ref())?;
        let meta = mmap_checked(
            &manifest.meta,
            GeometryFileKind::Meta,
            core::mem::size_of::<GeometryMetaRecord>() as u32,
        )?;
        let shapes = mmap_checked(
            &manifest.shapes,
            GeometryFileKind::Shapes,
            core::mem::size_of::<ShapeRecord>() as u32,
        )?;
        let owners = mmap_checked(
            &manifest.owners,
            GeometryFileKind::Owners,
            core::mem::size_of::<OwnerRef>() as u32,
        )?;
        let payload = mmap_checked(&manifest.payload, GeometryFileKind::Payload, 1)?;
        let names = mmap_checked(&manifest.names, GeometryFileKind::Names, 1)?;
        let name_index = mmap_checked(
            &manifest.name_index,
            GeometryFileKind::NameIndex,
            core::mem::size_of::<GeometryNameRecord>() as u32,
        )?;
        let sidmap = mmap_checked(
            &manifest.sidmap,
            GeometryFileKind::SidMap,
            core::mem::size_of::<GeometrySidMapRecord>() as u32,
        )?;
        let delta = match &manifest.delta {
            Some(delta_path) => GeometryDeltaStorage::Mapped(mmap_checked(
                delta_path,
                GeometryFileKind::Delta,
                core::mem::size_of::<GeometryDeltaRecord>() as u32,
            )?),
            None => GeometryDeltaStorage::LegacyEmpty(empty_geometry_file_bytes(
                GeometryFileKind::Delta,
                core::mem::size_of::<GeometryDeltaRecord>() as u32,
            )),
        };
        let view = mmap_checked(
            &manifest.view,
            GeometryFileKind::View,
            core::mem::size_of::<GeometryViewTileRecord>() as u32,
        )?;
        let layer_metadata = read_layer_metadata(manifest.layers.as_deref())?;

        let snapshot = Self {
            manifest,
            meta,
            shapes,
            owners,
            payload,
            names,
            name_index,
            sidmap,
            delta,
            view,
            layer_metadata,
        };
        snapshot.validate_manifest_counts()?;
        Ok(snapshot)
    }

    pub fn manifest(&self) -> &GeometryManifest {
        &self.manifest
    }

    pub fn shapes(&self) -> &[ShapeRecord] {
        cast_records(&self.shapes)
    }

    pub fn meta_records(&self) -> &[GeometryMetaRecord] {
        cast_records(&self.meta)
    }

    pub fn owners(&self) -> &[OwnerRef] {
        cast_records(&self.owners)
    }

    pub fn payload_bytes(&self) -> &[u8] {
        payload_bytes(&self.payload)
    }

    pub fn name_bytes(&self) -> &[u8] {
        payload_bytes(&self.names)
    }

    pub fn name_records(&self) -> &[GeometryNameRecord] {
        cast_records(&self.name_index)
    }

    pub fn sidmap_records(&self) -> &[GeometrySidMapRecord] {
        cast_records(&self.sidmap)
    }

    pub fn view_tile_records(&self) -> &[GeometryViewTileRecord] {
        cast_records(&self.view)
    }

    pub fn delta_records(&self) -> &[GeometryDeltaRecord] {
        cast_records(self.delta.as_bytes())
    }

    pub fn layer_metadata(&self) -> &[LayerMetadata] {
        &self.layer_metadata
    }

    pub fn mapped_bytes(&self) -> GeometryMappedBytes {
        GeometryMappedBytes {
            meta: self.meta.len(),
            shapes: self.shapes.len(),
            owners: self.owners.len(),
            payload: self.payload.len(),
            names: self.names.len(),
            name_index: self.name_index.len(),
            sidmap: self.sidmap.len(),
            delta: self.delta.mapped_len(),
            view: self.view.len(),
        }
    }

    pub fn owner_name(&self, record: &GeometryNameRecord) -> Option<&str> {
        let begin = record.name_offset as usize;
        let end = begin.checked_add(record.name_size as usize)?;
        std::str::from_utf8(self.name_bytes().get(begin..end)?).ok()
    }

    fn validate_manifest_counts(&self) -> Result<()> {
        if self.manifest.shape_count != self.shapes().len() as u64 {
            anyhow::bail!("manifest shape_count does not match geometry.shapes.bin");
        }
        if self.manifest.owner_count != self.owners().len() as u64 {
            anyhow::bail!("manifest owner_count does not match geometry.owners.bin");
        }
        if self.manifest.payload_size != self.payload_bytes().len() as u64 {
            anyhow::bail!("manifest payload_size does not match geometry.payload.bin");
        }
        let [meta] = self.meta_records() else {
            anyhow::bail!("geometry.meta.bin must contain exactly one record");
        };
        if meta.shape_count != self.shapes().len() as u64
            || meta.owner_count != self.owners().len() as u64
            || meta.payload_size != self.payload_bytes().len() as u64
            || meta.name_record_count != self.name_records().len() as u64
            || meta.name_payload_size != self.name_bytes().len() as u64
        {
            anyhow::bail!("geometry.meta.bin counts do not match snapshot files");
        }
        if self.sidmap_records().len() != self.shapes().len() {
            anyhow::bail!("geometry.sidmap.bin count does not match geometry.shapes.bin");
        }
        if self.view_tile_records().is_empty() && !self.shapes().is_empty() {
            anyhow::bail!(
                "geometry.view.bin must contain view tile records for non-empty snapshots"
            );
        }
        Ok(())
    }
}

fn read_manifest(path: &Path) -> Result<GeometryManifest> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut values = HashMap::new();
    for line in content.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        values.insert(key.trim().to_string(), value.trim().to_string());
    }

    let base = path.parent().unwrap_or_else(|| Path::new("."));
    let required = |key: &'static str| -> Result<String> {
        values
            .get(key)
            .cloned()
            .ok_or_else(|| GeometryReadError::MissingManifestKey(key).into())
    };
    let parse_u64 = |key: &'static str| -> Result<u64> { Ok(required(key)?.parse()?) };

    Ok(GeometryManifest {
        path: path.to_path_buf(),
        schema_version: required("schema_version")?.parse()?,
        shape_count: parse_u64("shape_count")?,
        owner_count: parse_u64("owner_count")?,
        payload_size: parse_u64("payload_size")?,
        meta: base.join(required("meta")?),
        shapes: base.join(required("shapes")?),
        owners: base.join(required("owners")?),
        payload: base.join(required("payload")?),
        names: base.join(required("names")?),
        name_index: base.join(required("name_index")?),
        sidmap: base.join(required("sidmap")?),
        delta: values.get("delta").map(|value| base.join(value)),
        view: base.join(required("view")?),
        layers: values.get("layers").map(|value| base.join(value)),
    })
}

fn read_layer_metadata(path: Option<&Path>) -> Result<Vec<LayerMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut layers = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"layer_id") {
            continue;
        }
        if fields.len() < 8 {
            anyhow::bail!(
                "invalid layer metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }

        let layer_id: u16 = fields[0]
            .parse()
            .with_context(|| format!("invalid layer_id on line {}", line_index + 1))?;
        let order: u32 = fields[1]
            .parse()
            .with_context(|| format!("invalid order on line {}", line_index + 1))?;
        let width: i32 = fields[4]
            .parse()
            .with_context(|| format!("invalid width on line {}", line_index + 1))?;
        let pitch_x: i32 = fields[5]
            .parse()
            .with_context(|| format!("invalid pitch_x on line {}", line_index + 1))?;
        let pitch_y: i32 = fields[6]
            .parse()
            .with_context(|| format!("invalid pitch_y on line {}", line_index + 1))?;
        let name = non_empty_layer_field(fields[7], &format!("L{layer_id}"));
        layers.push(LayerMetadata {
            layer_id,
            order,
            name,
            layer_type: non_empty_layer_field(fields[2], "unknown"),
            direction: non_empty_layer_field(fields[3], "unknown"),
            width,
            pitch_x,
            pitch_y,
        });
    }
    Ok(layers)
}

fn non_empty_layer_field(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn empty_geometry_file_bytes(file_kind: GeometryFileKind, record_size: u32) -> Vec<u8> {
    let header = GeometryFileHeader {
        magic: GEOMETRY_FILE_MAGIC,
        schema_version: GEOMETRY_SCHEMA_VERSION,
        header_size: GEOMETRY_FILE_HEADER_SIZE as u32,
        file_kind: file_kind as u16,
        record_size,
        ..GeometryFileHeader::default()
    };
    bytemuck::bytes_of(&header).to_vec()
}

fn mmap_checked(
    path: &Path,
    expected_kind: GeometryFileKind,
    expected_record_size: u32,
) -> Result<Mmap> {
    let file = File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    let mmap = unsafe { MmapOptions::new().map(&file) }
        .with_context(|| format!("failed to mmap {}", path.display()))?;
    if mmap.len() < GEOMETRY_FILE_HEADER_SIZE {
        return Err(GeometryReadError::InvalidHeader {
            path: path.to_path_buf(),
            reason: "file is smaller than header".to_string(),
        }
        .into());
    }

    let header = file_header(&mmap);
    if header.magic != GEOMETRY_FILE_MAGIC {
        invalid_header(path, "bad magic")?;
    }
    if header.schema_version != GEOMETRY_SCHEMA_VERSION {
        invalid_header(path, "unsupported schema version")?;
    }
    if header.header_size as usize != GEOMETRY_FILE_HEADER_SIZE {
        invalid_header(path, "unexpected header size")?;
    }
    if header.file_kind != expected_kind as u16 {
        invalid_header(path, "unexpected file kind")?;
    }
    if header.record_size != expected_record_size {
        invalid_header(path, "unexpected record size")?;
    }
    if GEOMETRY_FILE_HEADER_SIZE + header.payload_size as usize != mmap.len() {
        invalid_header(path, "payload size does not match file size")?;
    }

    Ok(mmap)
}

fn invalid_header(path: &Path, reason: &str) -> Result<()> {
    Err(GeometryReadError::InvalidHeader {
        path: path.to_path_buf(),
        reason: reason.to_string(),
    }
    .into())
}

fn file_header(mmap: &[u8]) -> GeometryFileHeader {
    *bytemuck::from_bytes(&mmap[..GEOMETRY_FILE_HEADER_SIZE])
}

fn cast_records<T: bytemuck::Pod>(mmap: &[u8]) -> &[T] {
    bytemuck::cast_slice(payload_bytes(mmap))
}

fn payload_bytes(mmap: &[u8]) -> &[u8] {
    &mmap[GEOMETRY_FILE_HEADER_SIZE..]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn mapped_bytes_total_includes_every_geometry_file() {
        let mapped = GeometryMappedBytes {
            meta: 10,
            shapes: 20,
            owners: 30,
            payload: 40,
            names: 50,
            name_index: 60,
            sidmap: 70,
            delta: 80,
            view: 90,
        };

        assert_eq!(mapped.total(), 450);
    }

    #[test]
    fn opens_legacy_manifest_without_delta_file_as_empty_delta_log() {
        let snapshot_dir = temp_snapshot_dir("legacy-no-delta");
        write_geometry_file(
            &snapshot_dir.join("geometry.meta.bin"),
            GeometryFileKind::Meta,
            core::mem::size_of::<GeometryMetaRecord>() as u32,
            bytemuck::bytes_of(&GeometryMetaRecord {
                next_shape_id: 1,
                ..GeometryMetaRecord::default()
            }),
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.shapes.bin"),
            GeometryFileKind::Shapes,
            core::mem::size_of::<ShapeRecord>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.owners.bin"),
            GeometryFileKind::Owners,
            core::mem::size_of::<OwnerRef>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.payload.bin"),
            GeometryFileKind::Payload,
            1,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.names.bin"),
            GeometryFileKind::Names,
            1,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.name_index.bin"),
            GeometryFileKind::NameIndex,
            core::mem::size_of::<GeometryNameRecord>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.sidmap.bin"),
            GeometryFileKind::SidMap,
            core::mem::size_of::<GeometrySidMapRecord>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.view.bin"),
            GeometryFileKind::View,
            core::mem::size_of::<GeometryViewTileRecord>() as u32,
            &[],
        );
        std::fs::write(
            snapshot_dir.join("geometry.manifest"),
            "schema_version=1\n\
             shape_count=0\n\
             owner_count=0\n\
             payload_size=0\n\
             meta=geometry.meta.bin\n\
             shapes=geometry.shapes.bin\n\
             owners=geometry.owners.bin\n\
             payload=geometry.payload.bin\n\
             names=geometry.names.bin\n\
             name_index=geometry.name_index.bin\n\
             sidmap=geometry.sidmap.bin\n\
             view=geometry.view.bin\n",
        )
        .unwrap();

        let snapshot = GeometrySnapshot::open(snapshot_dir.join("geometry.manifest")).unwrap();

        assert!(snapshot.delta_records().is_empty());
        assert_eq!(snapshot.mapped_bytes().delta, 0);

        std::fs::remove_dir_all(snapshot_dir).unwrap();
    }

    #[test]
    fn opens_manifest_with_layer_metadata_file() {
        let snapshot_dir = temp_snapshot_dir("layer-metadata");
        write_geometry_file(
            &snapshot_dir.join("geometry.meta.bin"),
            GeometryFileKind::Meta,
            core::mem::size_of::<GeometryMetaRecord>() as u32,
            bytemuck::bytes_of(&GeometryMetaRecord {
                next_shape_id: 1,
                ..GeometryMetaRecord::default()
            }),
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.shapes.bin"),
            GeometryFileKind::Shapes,
            core::mem::size_of::<ShapeRecord>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.owners.bin"),
            GeometryFileKind::Owners,
            core::mem::size_of::<OwnerRef>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.payload.bin"),
            GeometryFileKind::Payload,
            1,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.names.bin"),
            GeometryFileKind::Names,
            1,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.name_index.bin"),
            GeometryFileKind::NameIndex,
            core::mem::size_of::<GeometryNameRecord>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.sidmap.bin"),
            GeometryFileKind::SidMap,
            core::mem::size_of::<GeometrySidMapRecord>() as u32,
            &[],
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.view.bin"),
            GeometryFileKind::View,
            core::mem::size_of::<GeometryViewTileRecord>() as u32,
            &[],
        );
        let layers_path = snapshot_dir.join("geometry.layers.txt");
        std::fs::write(
            &layers_path,
            "layer_id\torder\ttype\tdirection\twidth\tpitch_x\tpitch_y\tname\n\
             1\t7\trouting\thorizontal\t100\t200\t300\tM1\n\
             2\t8\tcut\tunknown\t50\t0\t0\tVIA1\n",
        )
        .unwrap();
        std::fs::write(
            snapshot_dir.join("geometry.manifest"),
            "schema_version=1\n\
             shape_count=0\n\
             owner_count=0\n\
             payload_size=0\n\
             meta=geometry.meta.bin\n\
             shapes=geometry.shapes.bin\n\
             owners=geometry.owners.bin\n\
             payload=geometry.payload.bin\n\
             names=geometry.names.bin\n\
             name_index=geometry.name_index.bin\n\
             sidmap=geometry.sidmap.bin\n\
             view=geometry.view.bin\n\
             layers=geometry.layers.txt\n",
        )
        .unwrap();

        let snapshot = GeometrySnapshot::open(snapshot_dir.join("geometry.manifest")).unwrap();

        assert_eq!(snapshot.manifest().layers.as_ref(), Some(&layers_path));
        assert_eq!(snapshot.layer_metadata().len(), 2);
        assert_eq!(snapshot.layer_metadata()[0].layer_id, 1);
        assert_eq!(snapshot.layer_metadata()[0].order, 7);
        assert_eq!(snapshot.layer_metadata()[0].name, "M1");
        assert_eq!(snapshot.layer_metadata()[0].layer_type, "routing");
        assert_eq!(snapshot.layer_metadata()[0].direction, "horizontal");
        assert_eq!(snapshot.layer_metadata()[0].width, 100);
        assert_eq!(snapshot.layer_metadata()[0].pitch_x, 200);
        assert_eq!(snapshot.layer_metadata()[0].pitch_y, 300);

        std::fs::remove_dir_all(snapshot_dir).unwrap();
    }

    fn temp_snapshot_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "chipgeom-reader-{test_name}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_geometry_file(
        path: &Path,
        file_kind: GeometryFileKind,
        record_size: u32,
        payload: &[u8],
    ) {
        let record_count = if record_size == 0 {
            0
        } else {
            payload.len() as u64 / record_size as u64
        };
        let header = GeometryFileHeader {
            magic: GEOMETRY_FILE_MAGIC,
            schema_version: GEOMETRY_SCHEMA_VERSION,
            header_size: GEOMETRY_FILE_HEADER_SIZE as u32,
            file_kind: file_kind as u16,
            record_size,
            record_count,
            payload_size: payload.len() as u64,
            ..GeometryFileHeader::default()
        };
        let mut file = File::create(path).unwrap();
        file.write_all(bytemuck::bytes_of(&header)).unwrap();
        file.write_all(payload).unwrap();
    }
}
