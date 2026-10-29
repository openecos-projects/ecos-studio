use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use bytemuck::Pod;
use chipgeom_format::{
    ClockEdgeKind, ClockEdgeRecord, ClockEdgeTransition, ClockNodeKind, ClockNodeRecord,
    ClockRecord, ClockTimingRecord, ClockTreeAnalysisSource, ClockTreeMetaRecord, ClockTreeStage,
    ClockTreeStatus, GeometryFileHeader, GeometryFileKind, CLOCK_TIMING_ARRIVAL_VALID,
    CLOCK_TIMING_PREDECESSOR_VALID, CLOCK_TIMING_SLEW_VALID, CLOCK_TREE_SCHEMA_VERSION,
    GEOMETRY_FILE_HEADER_SIZE, GEOMETRY_FILE_MAGIC, GEOMETRY_SCHEMA_VERSION,
};

use crate::GeometryManifest;

#[derive(Clone, Debug, Default)]
pub struct ClockTreeSnapshot {
    pub meta: ClockTreeMetaRecord,
    pub clocks: Vec<ClockRecord>,
    pub nodes: Vec<ClockNodeRecord>,
    pub edges: Vec<ClockEdgeRecord>,
    pub timing: Vec<ClockTimingRecord>,
    pub roots: Vec<u32>,
    pub strings: Vec<u8>,
}

impl ClockTreeSnapshot {
    pub fn stage(&self) -> Option<ClockTreeStage> {
        ClockTreeStage::from_raw(self.meta.stage)
    }

    pub fn status(&self) -> Option<ClockTreeStatus> {
        ClockTreeStatus::from_raw(self.meta.status)
    }

    pub fn analysis_source(&self) -> Option<ClockTreeAnalysisSource> {
        ClockTreeAnalysisSource::from_raw(self.meta.analysis_source)
    }

    pub fn string(&self, offset: u32, size: u32) -> Option<&str> {
        let begin = offset as usize;
        let end = begin.checked_add(size as usize)?;
        std::str::from_utf8(self.strings.get(begin..end)?).ok()
    }

    pub fn clock_name(&self, clock: &ClockRecord) -> Option<&str> {
        self.string(clock.name_offset, clock.name_size)
    }

    pub fn node_instance(&self, node: &ClockNodeRecord) -> Option<&str> {
        self.string(node.instance_offset, node.instance_size)
    }

    pub fn node_pin(&self, node: &ClockNodeRecord) -> Option<&str> {
        self.string(node.pin_offset, node.pin_size)
    }

    pub fn node_master(&self, node: &ClockNodeRecord) -> Option<&str> {
        self.string(node.master_offset, node.master_size)
    }
}

pub(crate) enum ClockTreeRead {
    Absent,
    Available(ClockTreeSnapshot),
    Invalid(String),
}

pub(crate) fn load(manifest: &GeometryManifest) -> ClockTreeRead {
    if let Some(error) = &manifest.clock_tree_error {
        return ClockTreeRead::Invalid(error.clone());
    }
    let paths = ClockTreePaths::from_manifest(manifest);
    let Some(paths) = paths else {
        return ClockTreeRead::Absent;
    };
    match read_snapshot(manifest, &paths) {
        Ok(snapshot) => ClockTreeRead::Available(snapshot),
        Err(error) => ClockTreeRead::Invalid(format!("{error:#}")),
    }
}

struct ClockTreePaths {
    meta: PathBuf,
    nodes: PathBuf,
    edges: PathBuf,
    timing: PathBuf,
    strings: PathBuf,
}

impl ClockTreePaths {
    fn from_manifest(manifest: &GeometryManifest) -> Option<Self> {
        Some(Self {
            meta: manifest.clock_tree_meta.clone()?,
            nodes: manifest.clock_tree_nodes.clone()?,
            edges: manifest.clock_tree_edges.clone()?,
            timing: manifest.clock_tree_timing.clone()?,
            strings: manifest.clock_tree_strings.clone()?,
        })
    }
}

fn read_snapshot(manifest: &GeometryManifest, paths: &ClockTreePaths) -> Result<ClockTreeSnapshot> {
    if manifest.clock_tree_schema_version != Some(CLOCK_TREE_SCHEMA_VERSION) {
        bail!("unsupported clock-tree manifest schema version");
    }
    let expected_parent = paths.meta.parent();
    for path in [&paths.nodes, &paths.edges, &paths.timing, &paths.strings] {
        if path.parent() != expected_parent {
            bail!("clock-tree files do not belong to one epoch");
        }
    }

    let (meta_header, meta_payload) = read_file(&paths.meta, GeometryFileKind::ClockTreeMeta)?;
    if meta_header.record_size != size_of::<ClockTreeMetaRecord>() as u32
        || meta_header.record_count != 1
    {
        bail!("invalid clock-tree metadata record shape");
    }
    let meta = read_record::<ClockTreeMetaRecord>(&meta_payload, 0, "clock-tree metadata")?;
    if meta.schema_version != CLOCK_TREE_SCHEMA_VERSION {
        bail!(
            "unsupported clock-tree schema version {}",
            meta.schema_version
        );
    }
    ClockTreeStage::from_raw(meta.stage).context("invalid clock-tree stage")?;
    ClockTreeStatus::from_raw(meta.status).context("invalid clock-tree status")?;
    ClockTreeAnalysisSource::from_raw(meta.analysis_source)
        .context("invalid clock-tree analysis source")?;

    let clock_bytes = record_bytes::<ClockRecord>(meta.clock_count as usize)?;
    let root_bytes = (meta.root_count as usize)
        .checked_mul(size_of::<u32>())
        .context("clock-tree root byte count overflow")?;
    let expected_meta_payload = size_of::<ClockTreeMetaRecord>()
        .checked_add(clock_bytes)
        .and_then(|value| value.checked_add(root_bytes))
        .context("clock-tree metadata size overflow")?;
    if meta_payload.len() != expected_meta_payload {
        bail!("clock-tree metadata payload length does not match its counts");
    }
    let clocks = cast_records::<ClockRecord>(
        &meta_payload
            [size_of::<ClockTreeMetaRecord>()..size_of::<ClockTreeMetaRecord>() + clock_bytes],
    )?;
    let roots_start = size_of::<ClockTreeMetaRecord>() + clock_bytes;
    let roots = cast_records::<u32>(&meta_payload[roots_start..])?;

    let (nodes_header, nodes_payload) = read_file(&paths.nodes, GeometryFileKind::ClockTreeNodes)?;
    let nodes = read_records::<ClockNodeRecord>(
        &nodes_header,
        &nodes_payload,
        meta.node_count,
        "clock-tree nodes",
    )?;
    let (edges_header, edges_payload) = read_file(&paths.edges, GeometryFileKind::ClockTreeEdges)?;
    let edges = read_records::<ClockEdgeRecord>(
        &edges_header,
        &edges_payload,
        meta.edge_count,
        "clock-tree edges",
    )?;
    let (timing_header, timing_payload) =
        read_file(&paths.timing, GeometryFileKind::ClockTreeTiming)?;
    let timing = read_records::<ClockTimingRecord>(
        &timing_header,
        &timing_payload,
        meta.timing_count,
        "clock-tree timing",
    )?;
    let (strings_header, strings_payload) =
        read_file(&paths.strings, GeometryFileKind::ClockTreeStrings)?;
    if strings_header.record_size != 1 || strings_header.record_count != meta.string_size {
        bail!("invalid clock-tree string record shape");
    }

    let snapshot = ClockTreeSnapshot {
        meta,
        clocks,
        nodes,
        edges,
        timing,
        roots,
        strings: strings_payload,
    };
    validate(&snapshot, manifest.owner_count)?;
    Ok(snapshot)
}

fn read_file(path: &Path, kind: GeometryFileKind) -> Result<(GeometryFileHeader, Vec<u8>)> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("failed to read clock-tree file {}", path.display()))?;
    if bytes.len() < GEOMETRY_FILE_HEADER_SIZE {
        bail!("clock-tree file is truncated: {}", path.display());
    }
    let header = read_record::<GeometryFileHeader>(&bytes, 0, "geometry file header")?;
    if header.magic != GEOMETRY_FILE_MAGIC
        || header.schema_version != GEOMETRY_SCHEMA_VERSION
        || header.header_size as usize != GEOMETRY_FILE_HEADER_SIZE
        || header.file_kind != kind as u16
    {
        bail!("invalid clock-tree header: {}", path.display());
    }
    let payload_size = usize::try_from(header.payload_size)
        .context("clock-tree payload size does not fit this platform")?;
    let expected_len = GEOMETRY_FILE_HEADER_SIZE
        .checked_add(payload_size)
        .context("clock-tree file size overflow")?;
    if bytes.len() != expected_len {
        bail!("clock-tree payload length is invalid: {}", path.display());
    }
    Ok((header, bytes[GEOMETRY_FILE_HEADER_SIZE..].to_vec()))
}

fn read_records<T: Pod>(
    header: &GeometryFileHeader,
    payload: &[u8],
    expected_count: u64,
    label: &str,
) -> Result<Vec<T>> {
    if header.record_size != size_of::<T>() as u32 || header.record_count != expected_count {
        bail!("invalid {label} record shape");
    }
    let expected_bytes = (expected_count as usize)
        .checked_mul(size_of::<T>())
        .context("clock-tree record byte count overflow")?;
    if payload.len() != expected_bytes {
        bail!("{label} payload length does not match record count");
    }
    cast_records(payload)
}

fn record_bytes<T>(count: usize) -> Result<usize> {
    count
        .checked_mul(size_of::<T>())
        .context("clock-tree record byte count overflow")
}

fn read_record<T: Pod>(bytes: &[u8], offset: usize, label: &str) -> Result<T> {
    let end = offset
        .checked_add(size_of::<T>())
        .context("clock-tree record offset overflow")?;
    let value = bytes
        .get(offset..end)
        .with_context(|| format!("truncated {label}"))?;
    Ok(bytemuck::pod_read_unaligned::<T>(value))
}

fn cast_records<T: Pod>(bytes: &[u8]) -> Result<Vec<T>> {
    if bytes.len() % size_of::<T>() != 0 {
        bail!("clock-tree record payload is not a whole number of records");
    }
    Ok(bytes
        .chunks_exact(size_of::<T>())
        .map(bytemuck::pod_read_unaligned::<T>)
        .collect())
}

fn string_ref<'a>(
    snapshot: &'a ClockTreeSnapshot,
    offset: u32,
    size: u32,
    label: &str,
) -> Result<&'a str> {
    if size == 0 {
        if offset != 0 {
            bail!("{label} has a non-zero offset for an empty string");
        }
        return Ok("");
    }
    let value = snapshot
        .string(offset, size)
        .with_context(|| format!("{label} string reference is out of bounds or not UTF-8"))?;
    Ok(value)
}

fn validate(snapshot: &ClockTreeSnapshot, owner_count: u64) -> Result<()> {
    let meta = &snapshot.meta;
    if meta.clock_count as usize != snapshot.clocks.len()
        || meta.node_count as usize != snapshot.nodes.len()
        || meta.edge_count as usize != snapshot.edges.len()
        || meta.timing_count as usize != snapshot.timing.len()
        || meta.root_count as usize != snapshot.roots.len()
        || meta.string_size as usize != snapshot.strings.len()
    {
        bail!("clock-tree metadata counts do not match its files");
    }
    string_ref(
        snapshot,
        meta.rc_corner_offset,
        meta.rc_corner_size,
        "RC corner",
    )?;
    string_ref(
        snapshot,
        meta.liberty_corner_offset,
        meta.liberty_corner_size,
        "Liberty corner",
    )?;
    string_ref(
        snapshot,
        meta.diagnostics_offset,
        meta.diagnostics_size,
        "diagnostics",
    )?;
    for root in &snapshot.roots {
        if *root as usize >= snapshot.nodes.len() {
            bail!("clock-tree root references an unknown node");
        }
    }
    for (index, clock) in snapshot.clocks.iter().enumerate() {
        if clock.clock_id as usize != index
            || clock.master_clock_id != u32::MAX
                && clock.master_clock_id as usize >= snapshot.clocks.len()
            || range_invalid(
                clock.root_node_first,
                clock.root_node_count,
                snapshot.roots.len(),
            )
            || range_invalid(clock.node_first, clock.node_count, snapshot.nodes.len())
            || range_invalid(clock.edge_first, clock.edge_count, snapshot.edges.len())
        {
            bail!("clock-tree clock record has invalid identity or bounds");
        }
        string_ref(snapshot, clock.name_offset, clock.name_size, "clock name")?;
        string_ref(
            snapshot,
            clock.diagnostics_offset,
            clock.diagnostics_size,
            "clock diagnostics",
        )?;
    }
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.node_id as usize != index || node.clock_id as usize >= snapshot.clocks.len() {
            bail!("clock-tree node record has invalid identity or clock");
        }
        ClockNodeKind::from_raw(node.kind).context("invalid clock-tree node kind")?;
        if node.owner_index != u32::MAX && node.owner_index as u64 >= owner_count {
            bail!("clock-tree node owner index is out of bounds");
        }
        string_ref(
            snapshot,
            node.instance_offset,
            node.instance_size,
            "instance",
        )?;
        string_ref(snapshot, node.pin_offset, node.pin_size, "pin")?;
        string_ref(snapshot, node.master_offset, node.master_size, "master")?;
    }
    for (index, edge) in snapshot.edges.iter().enumerate() {
        if edge.edge_id as usize != index
            || edge.from_node as usize >= snapshot.nodes.len()
            || edge.to_node as usize >= snapshot.nodes.len()
            || edge.from_node == edge.to_node
        {
            bail!("clock-tree edge record has invalid identity or node reference");
        }
        ClockEdgeKind::from_raw(edge.kind).context("invalid clock-tree edge kind")?;
        ClockEdgeTransition::from_raw(edge.polarity).context("invalid clock-tree edge polarity")?;
        string_ref(snapshot, edge.net_offset, edge.net_size, "net")?;
        string_ref(snapshot, edge.cell_offset, edge.cell_size, "cell")?;
    }
    for timing in &snapshot.timing {
        if timing.node_id as usize >= snapshot.nodes.len()
            || timing.predecessor_node != u32::MAX
                && timing.predecessor_node as usize >= snapshot.nodes.len()
        {
            bail!("clock-tree timing record has an invalid node reference");
        }
        ClockEdgeTransition::from_raw(timing.source_edge)
            .context("invalid clock-tree source transition")?;
        ClockEdgeTransition::from_raw(timing.local_edge)
            .context("invalid clock-tree local transition")?;
        if timing.flags
            & !(CLOCK_TIMING_ARRIVAL_VALID
                | CLOCK_TIMING_SLEW_VALID
                | CLOCK_TIMING_PREDECESSOR_VALID)
            != 0
        {
            bail!("clock-tree timing record has unknown flags");
        }
        if timing.flags & CLOCK_TIMING_ARRIVAL_VALID != 0
            && (!timing.arrival_ns.is_finite() || timing.arrival_ns < 0.0)
        {
            bail!("clock-tree timing arrival is invalid");
        }
        if timing.flags & CLOCK_TIMING_SLEW_VALID != 0
            && (!timing.slew_ns.is_finite() || timing.slew_ns < 0.0)
        {
            bail!("clock-tree timing slew is invalid");
        }
        string_ref(
            snapshot,
            timing.scenario_offset,
            timing.scenario_size,
            "timing scenario",
        )?;
    }
    Ok(())
}

fn range_invalid(first: u32, count: u32, len: usize) -> bool {
    (first as usize)
        .checked_add(count as usize)
        .map_or(true, |end| end > len)
}

use core::mem::size_of;
