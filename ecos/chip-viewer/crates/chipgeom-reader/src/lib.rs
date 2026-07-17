use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chipgeom_format::{
    GeometryDeltaRecord, GeometryFileHeader, GeometryFileKind, GeometryMetaRecord,
    GeometryNameRecord, GeometrySidMapRecord, GeometryViewTileRecord, NameId, OwnerRef,
    ShapeRecord, GEOMETRY_FILE_HEADER_SIZE, GEOMETRY_FILE_MAGIC, GEOMETRY_SCHEMA_VERSION,
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
    pub design_name: Option<String>,
    pub design_version: Option<String>,
    pub dbu_per_micron: Option<u32>,
    pub manufacture_grid: Option<i32>,
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
    pub sites: Option<PathBuf>,
    pub masters: Option<PathBuf>,
    pub vias: Option<PathBuf>,
    pub grids: Option<PathBuf>,
    pub connectivity: Option<PathBuf>,
    pub nets: Option<PathBuf>,
    pub buses: Option<PathBuf>,
    pub groups: Option<PathBuf>,
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
    pub min_spacing: i32,
    pub min_area: i32,
    pub min_step: i32,
    pub cut_spacing: i32,
    pub enclosure_below: String,
    pub enclosure_above: String,
    pub lef58_rule_count: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SiteMetadata {
    pub name: String,
    pub site_class: String,
    pub symmetry: String,
    pub orient: String,
    pub width: i32,
    pub height: i32,
    pub is_overlap: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MasterMetadata {
    pub name: String,
    pub master_type: String,
    pub site: String,
    pub symmetry: String,
    pub origin_x: i64,
    pub origin_y: i64,
    pub width: u32,
    pub height: u32,
    pub term_count: u32,
    pub obs_count: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ViaMetadata {
    pub name: String,
    pub master_name: String,
    pub via_type: String,
    pub rule_name: String,
    pub bottom_layer: String,
    pub cut_layer: String,
    pub top_layer: String,
    pub cut_width: i32,
    pub cut_height: i32,
    pub cut_spacing_x: i32,
    pub cut_spacing_y: i32,
    pub enclosure_bottom_x: i32,
    pub enclosure_bottom_y: i32,
    pub enclosure_top_x: i32,
    pub enclosure_top_y: i32,
    pub rows: i32,
    pub cols: i32,
    pub is_default: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GridMetadata {
    pub grid_type: String,
    pub index: u32,
    pub direction: String,
    pub start: i64,
    pub step: i64,
    pub count: u32,
    pub width: i32,
    pub layer_names: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConnectivityMetadata {
    pub net_name: String,
    pub net_kind: String,
    pub endpoint_type: String,
    pub instance_name: String,
    pub pin_name: String,
    pub master_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NetMetadata {
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BusMetadata {
    pub name: String,
    pub bus_type: String,
    pub left: u32,
    pub right: u32,
    pub net_count: u32,
    pub pin_count: u32,
    pub net_names: Vec<String>,
    pub pin_names: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupMetadata {
    pub name: String,
    pub region_name: String,
    pub instance_count: u32,
    pub instance_names: Vec<String>,
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
    site_metadata: Vec<SiteMetadata>,
    master_metadata: Vec<MasterMetadata>,
    via_metadata: Vec<ViaMetadata>,
    grid_metadata: Vec<GridMetadata>,
    connectivity_metadata: Vec<ConnectivityMetadata>,
    net_metadata: Vec<NetMetadata>,
    bus_metadata: Vec<BusMetadata>,
    group_metadata: Vec<GroupMetadata>,
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
        let site_metadata = read_site_metadata(manifest.sites.as_deref())?;
        let master_metadata = read_master_metadata(manifest.masters.as_deref())?;
        let via_metadata = read_via_metadata(manifest.vias.as_deref())?;
        let grid_metadata = read_grid_metadata(manifest.grids.as_deref())?;
        let connectivity_metadata = read_connectivity_metadata(manifest.connectivity.as_deref())?;
        let net_metadata = read_net_metadata(manifest.nets.as_deref())?;
        let bus_metadata = read_bus_metadata(manifest.buses.as_deref())?;
        let group_metadata = read_group_metadata(manifest.groups.as_deref())?;

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
            site_metadata,
            master_metadata,
            via_metadata,
            grid_metadata,
            connectivity_metadata,
            net_metadata,
            bus_metadata,
            group_metadata,
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

    pub fn site_metadata(&self) -> &[SiteMetadata] {
        &self.site_metadata
    }

    pub fn master_metadata(&self) -> &[MasterMetadata] {
        &self.master_metadata
    }

    pub fn via_metadata(&self) -> &[ViaMetadata] {
        &self.via_metadata
    }

    pub fn grid_metadata(&self) -> &[GridMetadata] {
        &self.grid_metadata
    }

    pub fn connectivity_metadata(&self) -> &[ConnectivityMetadata] {
        &self.connectivity_metadata
    }

    pub fn net_metadata(&self) -> &[NetMetadata] {
        &self.net_metadata
    }

    pub fn bus_metadata(&self) -> &[BusMetadata] {
        &self.bus_metadata
    }

    pub fn group_metadata(&self) -> &[GroupMetadata] {
        &self.group_metadata
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

    pub fn name_by_id(&self, name_id: NameId) -> Option<&str> {
        if name_id == 0 {
            return None;
        }
        self.name_records()
            .get(name_id.saturating_sub(1) as usize)
            .and_then(|record| self.owner_name(record))
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
    let optional_string = |key: &'static str| -> Option<String> {
        values
            .get(key)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    let optional_u32 = |key: &'static str| -> Result<Option<u32>> {
        values
            .get(key)
            .map(|value| value.parse().with_context(|| format!("invalid {key}")))
            .transpose()
    };
    let optional_i32 = |key: &'static str| -> Result<Option<i32>> {
        values
            .get(key)
            .map(|value| value.parse().with_context(|| format!("invalid {key}")))
            .transpose()
    };

    Ok(GeometryManifest {
        path: path.to_path_buf(),
        schema_version: required("schema_version")?.parse()?,
        design_name: optional_string("design_name"),
        design_version: optional_string("design_version"),
        dbu_per_micron: optional_u32("dbu_per_micron")?,
        manufacture_grid: optional_i32("manufacture_grid")?,
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
        sites: values.get("sites").map(|value| base.join(value)),
        masters: values.get("masters").map(|value| base.join(value)),
        vias: values.get("vias").map(|value| base.join(value)),
        grids: values.get("grids").map(|value| base.join(value)),
        connectivity: values.get("connectivity").map(|value| base.join(value)),
        nets: values.get("nets").map(|value| base.join(value)),
        buses: values.get("buses").map(|value| base.join(value)),
        groups: values.get("groups").map(|value| base.join(value)),
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
        let min_spacing = optional_layer_i32(fields.get(8), "min_spacing", line_index)?;
        let min_area = optional_layer_i32(fields.get(9), "min_area", line_index)?;
        let min_step = optional_layer_i32(fields.get(10), "min_step", line_index)?;
        let cut_spacing = optional_layer_i32(fields.get(11), "cut_spacing", line_index)?;
        let enclosure_below = optional_layer_string(fields.get(12));
        let enclosure_above = optional_layer_string(fields.get(13));
        let lef58_rule_count = optional_layer_u32(fields.get(14), "lef58_rule_count", line_index)?;
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
            min_spacing,
            min_area,
            min_step,
            cut_spacing,
            enclosure_below,
            enclosure_above,
            lef58_rule_count,
        });
    }
    Ok(layers)
}

fn optional_layer_i32(value: Option<&&str>, field: &str, line_index: usize) -> Result<i32> {
    value
        .map(|value| {
            value
                .parse()
                .with_context(|| format!("invalid {field} on line {}", line_index + 1))
        })
        .unwrap_or(Ok(0))
}

fn optional_layer_u32(value: Option<&&str>, field: &str, line_index: usize) -> Result<u32> {
    value
        .map(|value| {
            value
                .parse()
                .with_context(|| format!("invalid {field} on line {}", line_index + 1))
        })
        .unwrap_or(Ok(0))
}

fn optional_layer_string(value: Option<&&str>) -> String {
    value.map_or_else(String::new, |value| value.trim().to_string())
}

fn non_empty_layer_field(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn read_site_metadata(path: Option<&Path>) -> Result<Vec<SiteMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut sites = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"name") {
            continue;
        }
        if fields.len() < 7 {
            anyhow::bail!(
                "invalid site metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        sites.push(SiteMetadata {
            name: metadata_string(fields[0]),
            site_class: metadata_string_with_fallback(fields[1], "unknown"),
            symmetry: metadata_string(fields[2]),
            orient: metadata_string(fields[3]),
            width: parse_metadata_i32(fields[4], "width", line_index)?,
            height: parse_metadata_i32(fields[5], "height", line_index)?,
            is_overlap: parse_metadata_bool(fields[6], "is_overlap", line_index)?,
        });
    }
    Ok(sites)
}

fn read_master_metadata(path: Option<&Path>) -> Result<Vec<MasterMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut masters = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"name") {
            continue;
        }
        if fields.len() < 10 {
            anyhow::bail!(
                "invalid master metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        masters.push(MasterMetadata {
            name: metadata_string(fields[0]),
            master_type: metadata_string_with_fallback(fields[1], "unknown"),
            site: metadata_string(fields[2]),
            symmetry: metadata_string(fields[3]),
            origin_x: parse_metadata_i64(fields[4], "origin_x", line_index)?,
            origin_y: parse_metadata_i64(fields[5], "origin_y", line_index)?,
            width: parse_metadata_u32(fields[6], "width", line_index)?,
            height: parse_metadata_u32(fields[7], "height", line_index)?,
            term_count: parse_metadata_u32(fields[8], "term_count", line_index)?,
            obs_count: parse_metadata_u32(fields[9], "obs_count", line_index)?,
        });
    }
    Ok(masters)
}

fn read_via_metadata(path: Option<&Path>) -> Result<Vec<ViaMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut vias = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"name") {
            continue;
        }
        if fields.len() < 18 {
            anyhow::bail!(
                "invalid via metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        vias.push(ViaMetadata {
            name: metadata_string(fields[0]),
            master_name: metadata_string(fields[1]),
            via_type: metadata_string_with_fallback(fields[2], "unknown"),
            rule_name: metadata_string(fields[3]),
            bottom_layer: metadata_string(fields[4]),
            cut_layer: metadata_string(fields[5]),
            top_layer: metadata_string(fields[6]),
            cut_width: parse_metadata_i32(fields[7], "cut_width", line_index)?,
            cut_height: parse_metadata_i32(fields[8], "cut_height", line_index)?,
            cut_spacing_x: parse_metadata_i32(fields[9], "cut_spacing_x", line_index)?,
            cut_spacing_y: parse_metadata_i32(fields[10], "cut_spacing_y", line_index)?,
            enclosure_bottom_x: parse_metadata_i32(fields[11], "enclosure_bottom_x", line_index)?,
            enclosure_bottom_y: parse_metadata_i32(fields[12], "enclosure_bottom_y", line_index)?,
            enclosure_top_x: parse_metadata_i32(fields[13], "enclosure_top_x", line_index)?,
            enclosure_top_y: parse_metadata_i32(fields[14], "enclosure_top_y", line_index)?,
            rows: parse_metadata_i32(fields[15], "rows", line_index)?,
            cols: parse_metadata_i32(fields[16], "cols", line_index)?,
            is_default: parse_metadata_bool(fields[17], "default", line_index)?,
        });
    }
    Ok(vias)
}

fn read_grid_metadata(path: Option<&Path>) -> Result<Vec<GridMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut grids = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"type") {
            continue;
        }
        if fields.len() < 8 {
            anyhow::bail!(
                "invalid grid metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        grids.push(GridMetadata {
            grid_type: metadata_string_with_fallback(fields[0], "unknown"),
            index: parse_metadata_u32(fields[1], "index", line_index)?,
            direction: metadata_string_with_fallback(fields[2], "unknown"),
            start: parse_metadata_i64(fields[3], "start", line_index)?,
            step: parse_metadata_i64(fields[4], "step", line_index)?,
            count: parse_metadata_u32(fields[5], "count", line_index)?,
            width: parse_metadata_i32(fields[6], "width", line_index)?,
            layer_names: metadata_list(fields[7]),
        });
    }
    Ok(grids)
}

fn read_connectivity_metadata(path: Option<&Path>) -> Result<Vec<ConnectivityMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut connectivity = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"net") {
            continue;
        }
        if fields.len() < 6 {
            anyhow::bail!(
                "invalid connectivity metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        connectivity.push(ConnectivityMetadata {
            net_name: metadata_string(fields[0]),
            net_kind: metadata_string_with_fallback(fields[1], "other"),
            endpoint_type: metadata_string_with_fallback(fields[2], "unknown"),
            instance_name: metadata_string(fields[3]),
            pin_name: metadata_string(fields[4]),
            master_name: metadata_string(fields[5]),
        });
    }
    Ok(connectivity)
}

fn read_net_metadata(path: Option<&Path>) -> Result<Vec<NetMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut nets = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"name") {
            continue;
        }
        if fields.len() < 2 {
            anyhow::bail!(
                "invalid net metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        nets.push(NetMetadata {
            name: metadata_string(fields[0]),
            kind: metadata_string_with_fallback(fields[1], "other"),
        });
    }
    Ok(nets)
}

fn read_bus_metadata(path: Option<&Path>) -> Result<Vec<BusMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut buses = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"name") {
            continue;
        }
        if fields.len() < 6 {
            anyhow::bail!(
                "invalid bus metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        buses.push(BusMetadata {
            name: metadata_string(fields[0]),
            bus_type: metadata_string_with_fallback(fields[1], "unknown"),
            left: parse_metadata_u32(fields[2], "left", line_index)?,
            right: parse_metadata_u32(fields[3], "right", line_index)?,
            net_count: parse_metadata_u32(fields[4], "net_count", line_index)?,
            pin_count: parse_metadata_u32(fields[5], "pin_count", line_index)?,
            net_names: fields
                .get(6)
                .map_or_else(Vec::new, |value| metadata_list(value)),
            pin_names: fields
                .get(7)
                .map_or_else(Vec::new, |value| metadata_list(value)),
        });
    }
    Ok(buses)
}

fn read_group_metadata(path: Option<&Path>) -> Result<Vec<GroupMetadata>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut groups = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.first() == Some(&"name") {
            continue;
        }
        if fields.len() < 3 {
            anyhow::bail!(
                "invalid group metadata line {} in {}",
                line_index + 1,
                path.display()
            );
        }
        groups.push(GroupMetadata {
            name: metadata_string(fields[0]),
            region_name: metadata_string(fields[1]),
            instance_count: parse_metadata_u32(fields[2], "instance_count", line_index)?,
            instance_names: fields
                .get(3)
                .map_or_else(Vec::new, |value| metadata_list(value)),
        });
    }
    Ok(groups)
}

fn metadata_string(value: &str) -> String {
    value.trim().to_string()
}

fn metadata_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn metadata_string_with_fallback(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_metadata_i32(value: &str, field: &str, line_index: usize) -> Result<i32> {
    value
        .parse()
        .with_context(|| format!("invalid {field} on line {}", line_index + 1))
}

fn parse_metadata_i64(value: &str, field: &str, line_index: usize) -> Result<i64> {
    value
        .parse()
        .with_context(|| format!("invalid {field} on line {}", line_index + 1))
}

fn parse_metadata_u32(value: &str, field: &str, line_index: usize) -> Result<u32> {
    value
        .parse()
        .with_context(|| format!("invalid {field} on line {}", line_index + 1))
}

fn parse_metadata_bool(value: &str, field: &str, line_index: usize) -> Result<bool> {
    match value.trim() {
        "1" | "true" | "TRUE" => Ok(true),
        "0" | "false" | "FALSE" => Ok(false),
        _ => anyhow::bail!("invalid {field} on line {}", line_index + 1),
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
        assert!(snapshot.site_metadata().is_empty());
        assert!(snapshot.master_metadata().is_empty());
        assert!(snapshot.via_metadata().is_empty());
        assert!(snapshot.grid_metadata().is_empty());
        assert!(snapshot.connectivity_metadata().is_empty());
        assert!(snapshot.net_metadata().is_empty());
        assert!(snapshot.bus_metadata().is_empty());
        assert!(snapshot.group_metadata().is_empty());
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
            "layer_id\torder\ttype\tdirection\twidth\tpitch_x\tpitch_y\tname\tmin_spacing\tmin_area\tmin_step\tcut_spacing\tenclosure_below\tenclosure_above\tlef58_rule_count\n\
             1\t7\trouting\thorizontal\t100\t200\t300\tM1\t70\t400\t50\t0\t\t\t5\n\
             2\t8\tcut\tunknown\t50\t0\t0\tVIA1\t0\t0\t0\t80\t1,2\t3,4\t2\n",
        )
        .unwrap();
        let sites_path = snapshot_dir.join("geometry.sites.txt");
        std::fs::write(
            &sites_path,
            "name\tclass\tsymmetry\torient\twidth\theight\tis_overlap\n\
             core_site\tCORE\tX\tN\t10\t20\t1\n",
        )
        .unwrap();
        let masters_path = snapshot_dir.join("geometry.masters.txt");
        std::fs::write(
            &masters_path,
            "name\ttype\tsite\tsymmetry\torigin_x\torigin_y\twidth\theight\tterm_count\tobs_count\n\
             INVX1\tCORE\tcore_site\tX,Y\t-1\t2\t30\t40\t3\t2\n",
        )
        .unwrap();
        let vias_path = snapshot_dir.join("geometry.vias.txt");
        std::fs::write(
            &vias_path,
            "name\tmaster\ttype\trule\tbottom\tcut\ttop\tcut_width\tcut_height\tcut_spacing_x\tcut_spacing_y\tenclosure_bottom_x\tenclosure_bottom_y\tenclosure_top_x\tenclosure_top_y\trows\tcols\tdefault\n\
             VIA12\tVIA12_MASTER\tgenerated\tVR12\tM1\tVIA12\tM2\t4\t5\t6\t7\t1\t2\t3\t4\t2\t3\t1\n",
        )
        .unwrap();
        let grids_path = snapshot_dir.join("geometry.grids.txt");
        std::fs::write(
            &grids_path,
            "type\tindex\tdirection\tstart\tstep\tcount\twidth\tlayers\n\
             track\t0\tx\t100\t200\t4\t2\tM1,M2\n\
             gcell\t0\ty\t50\t250\t3\t1\t\n",
        )
        .unwrap();
        let connectivity_path = snapshot_dir.join("geometry.connectivity.txt");
        std::fs::write(
            &connectivity_path,
            "net\tkind\tendpoint_type\tinstance\tpin\tmaster\n\
             clk\tclock\tinstance\tu0\tA\tINVX1\n\
             clk\tclock\tio\t\tclk_in\t\n",
        )
        .unwrap();
        let nets_path = snapshot_dir.join("geometry.nets.txt");
        std::fs::write(
            &nets_path,
            "name\tkind\n\
             clk\tclock\n\
             data\tunknown\n",
        )
        .unwrap();
        let buses_path = snapshot_dir.join("geometry.buses.txt");
        std::fs::write(
            &buses_path,
            "name\ttype\tleft\tright\tnet_count\tpin_count\tnets\tpins\n\
             data\tnet\t7\t0\t2\t1\tdata[0],data[1]\tDATA_IN\n",
        )
        .unwrap();
        let groups_path = snapshot_dir.join("geometry.groups.txt");
        std::fs::write(
            &groups_path,
            "name\tregion\tinstance_count\tinstances\n\
             cluster0\tregion0\t2\tu0,u1\n",
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
             layers=geometry.layers.txt\n\
             sites=geometry.sites.txt\n\
             masters=geometry.masters.txt\n\
             vias=geometry.vias.txt\n\
             grids=geometry.grids.txt\n\
             connectivity=geometry.connectivity.txt\n\
             nets=geometry.nets.txt\n\
             buses=geometry.buses.txt\n\
             groups=geometry.groups.txt\n",
        )
        .unwrap();

        let snapshot = GeometrySnapshot::open(snapshot_dir.join("geometry.manifest")).unwrap();

        assert_eq!(snapshot.manifest().layers.as_ref(), Some(&layers_path));
        assert_eq!(snapshot.manifest().sites.as_ref(), Some(&sites_path));
        assert_eq!(snapshot.manifest().masters.as_ref(), Some(&masters_path));
        assert_eq!(snapshot.manifest().vias.as_ref(), Some(&vias_path));
        assert_eq!(snapshot.manifest().grids.as_ref(), Some(&grids_path));
        assert_eq!(
            snapshot.manifest().connectivity.as_ref(),
            Some(&connectivity_path)
        );
        assert_eq!(snapshot.manifest().nets.as_ref(), Some(&nets_path));
        assert_eq!(snapshot.manifest().buses.as_ref(), Some(&buses_path));
        assert_eq!(snapshot.manifest().groups.as_ref(), Some(&groups_path));
        assert_eq!(snapshot.layer_metadata().len(), 2);
        assert_eq!(snapshot.layer_metadata()[0].layer_id, 1);
        assert_eq!(snapshot.layer_metadata()[0].order, 7);
        assert_eq!(snapshot.layer_metadata()[0].name, "M1");
        assert_eq!(snapshot.layer_metadata()[0].layer_type, "routing");
        assert_eq!(snapshot.layer_metadata()[0].direction, "horizontal");
        assert_eq!(snapshot.layer_metadata()[0].width, 100);
        assert_eq!(snapshot.layer_metadata()[0].pitch_x, 200);
        assert_eq!(snapshot.layer_metadata()[0].pitch_y, 300);
        assert_eq!(snapshot.layer_metadata()[0].min_spacing, 70);
        assert_eq!(snapshot.layer_metadata()[0].min_area, 400);
        assert_eq!(snapshot.layer_metadata()[0].min_step, 50);
        assert_eq!(snapshot.layer_metadata()[0].cut_spacing, 0);
        assert_eq!(snapshot.layer_metadata()[0].enclosure_below, "");
        assert_eq!(snapshot.layer_metadata()[0].enclosure_above, "");
        assert_eq!(snapshot.layer_metadata()[0].lef58_rule_count, 5);
        assert_eq!(snapshot.layer_metadata()[1].cut_spacing, 80);
        assert_eq!(snapshot.layer_metadata()[1].enclosure_below, "1,2");
        assert_eq!(snapshot.layer_metadata()[1].enclosure_above, "3,4");
        assert_eq!(snapshot.layer_metadata()[1].lef58_rule_count, 2);
        assert_eq!(
            snapshot.site_metadata(),
            &[SiteMetadata {
                name: "core_site".to_string(),
                site_class: "CORE".to_string(),
                symmetry: "X".to_string(),
                orient: "N".to_string(),
                width: 10,
                height: 20,
                is_overlap: true,
            }]
        );
        assert_eq!(
            snapshot.master_metadata(),
            &[MasterMetadata {
                name: "INVX1".to_string(),
                master_type: "CORE".to_string(),
                site: "core_site".to_string(),
                symmetry: "X,Y".to_string(),
                origin_x: -1,
                origin_y: 2,
                width: 30,
                height: 40,
                term_count: 3,
                obs_count: 2,
            }]
        );
        assert_eq!(
            snapshot.via_metadata(),
            &[ViaMetadata {
                name: "VIA12".to_string(),
                master_name: "VIA12_MASTER".to_string(),
                via_type: "generated".to_string(),
                rule_name: "VR12".to_string(),
                bottom_layer: "M1".to_string(),
                cut_layer: "VIA12".to_string(),
                top_layer: "M2".to_string(),
                cut_width: 4,
                cut_height: 5,
                cut_spacing_x: 6,
                cut_spacing_y: 7,
                enclosure_bottom_x: 1,
                enclosure_bottom_y: 2,
                enclosure_top_x: 3,
                enclosure_top_y: 4,
                rows: 2,
                cols: 3,
                is_default: true,
            }]
        );
        assert_eq!(
            snapshot.grid_metadata(),
            &[
                GridMetadata {
                    grid_type: "track".to_string(),
                    index: 0,
                    direction: "x".to_string(),
                    start: 100,
                    step: 200,
                    count: 4,
                    width: 2,
                    layer_names: vec!["M1".to_string(), "M2".to_string()],
                },
                GridMetadata {
                    grid_type: "gcell".to_string(),
                    index: 0,
                    direction: "y".to_string(),
                    start: 50,
                    step: 250,
                    count: 3,
                    width: 1,
                    layer_names: Vec::new(),
                },
            ]
        );
        assert_eq!(snapshot.connectivity_metadata().len(), 2);
        assert_eq!(snapshot.connectivity_metadata()[0].net_name, "clk");
        assert_eq!(snapshot.connectivity_metadata()[0].net_kind, "clock");
        assert_eq!(
            snapshot.connectivity_metadata()[0].endpoint_type,
            "instance"
        );
        assert_eq!(snapshot.connectivity_metadata()[0].instance_name, "u0");
        assert_eq!(snapshot.connectivity_metadata()[0].pin_name, "A");
        assert_eq!(snapshot.connectivity_metadata()[0].master_name, "INVX1");
        assert_eq!(
            snapshot.net_metadata(),
            &[
                NetMetadata {
                    name: "clk".to_string(),
                    kind: "clock".to_string(),
                },
                NetMetadata {
                    name: "data".to_string(),
                    kind: "unknown".to_string(),
                },
            ]
        );
        assert_eq!(
            snapshot.bus_metadata(),
            &[BusMetadata {
                name: "data".to_string(),
                bus_type: "net".to_string(),
                left: 7,
                right: 0,
                net_count: 2,
                pin_count: 1,
                net_names: vec!["data[0]".to_string(), "data[1]".to_string()],
                pin_names: vec!["DATA_IN".to_string()],
            }]
        );
        assert_eq!(
            snapshot.group_metadata(),
            &[GroupMetadata {
                name: "cluster0".to_string(),
                region_name: "region0".to_string(),
                instance_count: 2,
                instance_names: vec!["u0".to_string(), "u1".to_string()],
            }]
        );

        std::fs::remove_dir_all(snapshot_dir).unwrap();
    }

    #[test]
    fn reads_legacy_layer_metadata_without_rule_columns() {
        let snapshot_dir = temp_snapshot_dir("legacy-layer-metadata");
        let layers_path = snapshot_dir.join("geometry.layers.txt");
        std::fs::write(
            &layers_path,
            "layer_id\torder\ttype\tdirection\twidth\tpitch_x\tpitch_y\tname\n\
             1\t7\trouting\thorizontal\t100\t200\t300\tM1\n",
        )
        .unwrap();

        let layers = read_layer_metadata(Some(&layers_path)).unwrap();

        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].name, "M1");
        assert_eq!(layers[0].min_spacing, 0);
        assert_eq!(layers[0].min_area, 0);
        assert_eq!(layers[0].min_step, 0);
        assert_eq!(layers[0].cut_spacing, 0);
        assert_eq!(layers[0].enclosure_below, "");
        assert_eq!(layers[0].enclosure_above, "");
        assert_eq!(layers[0].lef58_rule_count, 0);

        std::fs::remove_dir_all(snapshot_dir).unwrap();
    }

    #[test]
    fn opens_manifest_with_design_metadata_fields() {
        let snapshot_dir = temp_snapshot_dir("design-metadata");
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
             design_name=uart_top\n\
             design_version=5.8\n\
             dbu_per_micron=2000\n\
             manufacture_grid=5\n\
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

        assert_eq!(snapshot.manifest().design_name.as_deref(), Some("uart_top"));
        assert_eq!(snapshot.manifest().design_version.as_deref(), Some("5.8"));
        assert_eq!(snapshot.manifest().dbu_per_micron, Some(2000));
        assert_eq!(snapshot.manifest().manufacture_grid, Some(5));

        std::fs::remove_dir_all(snapshot_dir).unwrap();
    }

    #[test]
    fn resolves_one_based_local_name_ids() {
        let snapshot_dir = temp_snapshot_dir("local-name-id");
        let local_name = b"via:VIA12";
        let name_record = GeometryNameRecord {
            name_offset: 0,
            name_size: local_name.len() as u32,
            ..GeometryNameRecord::default()
        };
        write_geometry_file(
            &snapshot_dir.join("geometry.meta.bin"),
            GeometryFileKind::Meta,
            core::mem::size_of::<GeometryMetaRecord>() as u32,
            bytemuck::bytes_of(&GeometryMetaRecord {
                next_shape_id: 1,
                name_record_count: 1,
                name_payload_size: local_name.len() as u64,
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
            local_name,
        );
        write_geometry_file(
            &snapshot_dir.join("geometry.name_index.bin"),
            GeometryFileKind::NameIndex,
            core::mem::size_of::<GeometryNameRecord>() as u32,
            bytemuck::bytes_of(&name_record),
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

        assert_eq!(snapshot.name_by_id(1), Some("via:VIA12"));
        assert_eq!(snapshot.name_by_id(0), None);
        assert_eq!(snapshot.name_by_id(2), None);

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
