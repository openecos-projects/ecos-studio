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
    pub delta: PathBuf,
    pub view: PathBuf,
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
    delta: Mmap,
    view: Mmap,
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
        let delta = mmap_checked(
            &manifest.delta,
            GeometryFileKind::Delta,
            core::mem::size_of::<GeometryDeltaRecord>() as u32,
        )?;
        let view = mmap_checked(
            &manifest.view,
            GeometryFileKind::View,
            core::mem::size_of::<GeometryViewTileRecord>() as u32,
        )?;

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
        cast_records(&self.delta)
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
            delta: self.delta.len(),
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
        delta: base.join(required("delta")?),
        view: base.join(required("view")?),
    })
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
}
