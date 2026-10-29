use bytemuck::{Pod, Zeroable};

pub const CLOCK_TREE_SCHEMA_VERSION: u32 = 1;

#[repr(u16)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockTreeStage {
    #[default]
    Unknown = 0,
    PostFloorplan = 1,
    Cts = 2,
    Filler = 3,
}

#[repr(u16)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockTreeStatus {
    #[default]
    Unavailable = 0,
    NoClocks = 1,
    TopologyOnly = 2,
    PartialTiming = 3,
    CompleteTiming = 4,
}

#[repr(u16)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockTreeAnalysisSource {
    #[default]
    None = 0,
    CtsFastSta = 1,
    IstaTypical = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockNodeKind {
    #[default]
    Unknown = 0,
    RootPort = 1,
    InternalRoot = 2,
    BufferInput = 3,
    BufferOutput = 4,
    InverterInput = 5,
    InverterOutput = 6,
    IcgInput = 7,
    IcgOutput = 8,
    Sink = 9,
    MacroBoundary = 10,
    OtherBoundary = 11,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockEdgeKind {
    #[default]
    Unknown = 0,
    Net = 1,
    Cell = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockEdgeTransition {
    #[default]
    Rise = 0,
    Fall = 1,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ClockTreeMetaRecord {
    pub schema_version: u32,
    pub stage: u16,
    pub status: u16,
    pub analysis_source: u16,
    pub flags: u16,
    pub dbu_per_micron: u32,
    pub node_count: u64,
    pub edge_count: u64,
    pub timing_count: u64,
    pub string_size: u64,
    pub temperature_c: f64,
    pub clock_count: u32,
    pub root_count: u32,
    pub rc_corner_offset: u32,
    pub rc_corner_size: u32,
    pub liberty_corner_offset: u32,
    pub liberty_corner_size: u32,
    pub diagnostics_offset: u32,
    pub diagnostics_size: u32,
    pub producer_fingerprint: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct ClockRecord {
    pub clock_id: u32,
    pub master_clock_id: u32,
    pub root_node_first: u32,
    pub root_node_count: u32,
    pub node_first: u32,
    pub node_count: u32,
    pub edge_first: u32,
    pub edge_count: u32,
    pub sink_count: u32,
    pub flags: u8,
    pub source_edge: u8,
    pub reserved0: u16,
    pub name_offset: u32,
    pub name_size: u32,
    pub diagnostics_offset: u32,
    pub diagnostics_size: u32,
    pub reserved1: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct ClockNodeRecord {
    pub node_id: u32,
    pub clock_id: u32,
    pub kind: u8,
    pub flags: u8,
    pub reserved0: u16,
    pub owner_index: u32,
    pub instance_offset: u32,
    pub instance_size: u32,
    pub pin_offset: u32,
    pub pin_size: u32,
    pub master_offset: u32,
    pub master_size: u32,
    pub x: i32,
    pub y: i32,
    pub reserved1: u32,
    pub reserved2: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pod, Zeroable)]
pub struct ClockEdgeRecord {
    pub edge_id: u32,
    pub from_node: u32,
    pub to_node: u32,
    pub kind: u8,
    pub polarity: u8,
    pub flags: u16,
    pub net_offset: u32,
    pub net_size: u32,
    pub cell_offset: u32,
    pub cell_size: u32,
    pub object_ref: u64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ClockTimingRecord {
    pub node_id: u32,
    pub flags: u16,
    pub source_edge: u8,
    pub local_edge: u8,
    pub predecessor_node: u32,
    pub reserved0: u32,
    pub arrival_ns: f64,
    pub slew_ns: f64,
    pub scenario_offset: u32,
    pub scenario_size: u32,
    pub reserved1: u32,
    pub reserved2: u32,
}

pub const CLOCK_NODE_POSITION_VALID: u8 = 1 << 0;
pub const CLOCK_NODE_OWNER_VALID: u8 = 1 << 1;
pub const CLOCK_NODE_TIMING_VALID: u8 = 1 << 2;
pub const CLOCK_NODE_ROOT: u8 = 1 << 3;
pub const CLOCK_NODE_SINK: u8 = 1 << 4;
pub const CLOCK_TIMING_ARRIVAL_VALID: u16 = 1 << 0;
pub const CLOCK_TIMING_SLEW_VALID: u16 = 1 << 1;
pub const CLOCK_TIMING_PREDECESSOR_VALID: u16 = 1 << 2;

impl ClockTreeStage {
    pub fn from_raw(value: u16) -> Option<Self> {
        Some(match value {
            0 => Self::Unknown,
            1 => Self::PostFloorplan,
            2 => Self::Cts,
            3 => Self::Filler,
            _ => return None,
        })
    }
}

impl ClockTreeStatus {
    pub fn from_raw(value: u16) -> Option<Self> {
        Some(match value {
            0 => Self::Unavailable,
            1 => Self::NoClocks,
            2 => Self::TopologyOnly,
            3 => Self::PartialTiming,
            4 => Self::CompleteTiming,
            _ => return None,
        })
    }
}

impl ClockTreeAnalysisSource {
    pub fn from_raw(value: u16) -> Option<Self> {
        Some(match value {
            0 => Self::None,
            1 => Self::CtsFastSta,
            2 => Self::IstaTypical,
            _ => return None,
        })
    }
}

impl ClockNodeKind {
    pub fn from_raw(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Unknown,
            1 => Self::RootPort,
            2 => Self::InternalRoot,
            3 => Self::BufferInput,
            4 => Self::BufferOutput,
            5 => Self::InverterInput,
            6 => Self::InverterOutput,
            7 => Self::IcgInput,
            8 => Self::IcgOutput,
            9 => Self::Sink,
            10 => Self::MacroBoundary,
            11 => Self::OtherBoundary,
            _ => return None,
        })
    }
}

impl ClockEdgeKind {
    pub fn from_raw(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Unknown,
            1 => Self::Net,
            2 => Self::Cell,
            _ => return None,
        })
    }
}

impl ClockEdgeTransition {
    pub fn from_raw(value: u8) -> Option<Self> {
        Some(match value {
            0 => Self::Rise,
            1 => Self::Fall,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_tree_layout_sizes_match_cpp() {
        assert_eq!(core::mem::size_of::<ClockTreeMetaRecord>(), 96);
        assert_eq!(core::mem::size_of::<ClockRecord>(), 64);
        assert_eq!(core::mem::size_of::<ClockNodeRecord>(), 56);
        assert_eq!(core::mem::size_of::<ClockEdgeRecord>(), 40);
        assert_eq!(core::mem::size_of::<ClockTimingRecord>(), 48);
        assert_eq!(core::mem::align_of::<ClockTreeMetaRecord>(), 8);
    }
}
